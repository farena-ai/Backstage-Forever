"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { registerDiagnosticsHandlers } = require("../src/core/diagnostics-ipc.cjs");
function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-diagnostics-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, "data"); fs.mkdirSync(dataDir); const handlers = {}, writes = [], copies = []; let clock = 100000;
  const service = registerDiagnosticsHandlers({ handle: (n, fn) => handlers[n] = fn, collect: () => ({ profileCount: 2, notes: "PRIVATE_CANARY" }), now: () => clock, dataDir, getWindow: () => null, dialog: { showSaveDialog: async () => ({ filePath: path.join(dir, "report.txt"), canceled: false }) }, clipboard: { writeText: text => copies.push(text) }, writeFile: (p, text) => writes.push({ p, text }), ...overrides });
  return { ...service, handlers, writes, copies, dir, dataDir, tick: n => clock += n };
}
test("copy and export use exactly the immutable main-owned preview", async t => {
  const f = fixture(t), p = await f.handlers.diagnosticsPreview(); assert.match(p.id, /^[a-f0-9]{32}$/); assert.doesNotMatch(p.text, /PRIVATE_CANARY/);
  assert.deepEqual(await f.handlers.copyDiagnostics(p.id), { status: "copied" });
  assert.deepEqual(await f.handlers.exportDiagnostics(p.id), { status: "saved" });
  assert.equal(f.copies[0], p.text); assert.equal(f.writes[0].text, p.text);
});
test("strict arity and ID shape reject renderer data", async t => {
  const f = fixture(t); await assert.rejects(async () => f.handlers.diagnosticsPreview({ private: 1 }), /invalid/);
  const p = await f.handlers.diagnosticsPreview(); for (const args of [[], [p.id, "evil"], ["../secret"], [{}]]) for (const name of ["copyDiagnostics", "exportDiagnostics"]) await assert.rejects(async () => f.handlers[name](...args), /invalid/);
  assert.equal(f.writes.length + f.copies.length, 0);
});
test("regeneration expiry and reset retire old snapshots", async t => {
  const f = fixture(t), a = await f.handlers.diagnosticsPreview(), b = await f.handlers.diagnosticsPreview();
  await assert.rejects(async () => f.handlers.copyDiagnostics(a.id), /Prepare/); f.tick(300000);
  await assert.rejects(async () => f.handlers.copyDiagnostics(b.id), /Prepare/);
  const c = await f.handlers.diagnosticsPreview(); f.clear(); await assert.rejects(async () => f.handlers.exportDiagnostics(c.id), /Prepare/);
});
test("late dialog cannot save after regeneration reset or expiry", async t => {
  for (const mode of ["regenerate", "reset", "expire"]) {
    let release; const f = fixture(t, { dialog: { showSaveDialog: () => new Promise(r => release = r) } });
    const p = await f.handlers.diagnosticsPreview(), saving = f.handlers.exportDiagnostics(p.id);
    if (mode === "regenerate") await f.handlers.diagnosticsPreview(); if (mode === "reset") f.clear(); if (mode === "expire") f.tick(300000);
    release({ canceled: false, filePath: path.join(f.dir, "safe.txt") }); await assert.rejects(() => saving, /Prepare/); assert.equal(f.writes.length, 0);
  }
});
test("cancel returns a safe result without writing", async t => {
  const f = fixture(t, { dialog: { showSaveDialog: async () => ({ canceled: true }) } }); const p = await f.handlers.diagnosticsPreview();
  assert.deepEqual(await f.handlers.exportDiagnostics(p.id), { status: "cancelled" }); assert.equal(f.writes.length, 0);
});
test("data-folder normal and canonical alias destinations cannot overwrite app data", async t => {
  const f = fixture(t); const p = await f.handlers.diagnosticsPreview();
  const alias = path.join(f.dir, "alias"); fs.symlinkSync(f.dataDir, alias, process.platform === "win32" ? "junction" : "dir");
  for (const destination of [path.join(f.dataDir, "state.txt"), path.join(alias, "state.txt"), path.join(f.dir, "bad.json")]) {
    const g = fixture(t, { dataDir: f.dataDir, dialog: { showSaveDialog: async () => ({ filePath: destination }) } }); const preview = await g.handlers.diagnosticsPreview();
    await assert.rejects(() => g.handlers.exportDiagnostics(preview.id), /could not be saved/); assert.equal(g.writes.length, 0);
  }
  assert.ok(p.text);
});
test("native failures never expose free-form errors and preview failure invalidates old token", async t => {
  for (const overrides of [{ dialog: { showSaveDialog: async () => { throw Error("PRIVATE_CANARY"); } } }, { writeFile: () => { throw Error("PRIVATE_CANARY"); } }, { realpath: () => { throw Error("PRIVATE_CANARY"); } }, { exists: () => { throw Error("PRIVATE_CANARY"); } }]) {
    const f = fixture(t, overrides), p = await f.handlers.diagnosticsPreview(); await assert.rejects(() => f.handlers.exportDiagnostics(p.id), { message: "The report could not be saved. Choose a text file outside the app data folder." });
  }
  const f = fixture(t, { clipboard: { writeText: () => { throw Error("PRIVATE_CANARY"); } } }), p = await f.handlers.diagnosticsPreview(); await assert.rejects(async () => f.handlers.copyDiagnostics(p.id), { message: "The report could not be copied. Try again." });
  let fail = false; const g = fixture(t, { collect: () => { if (fail) throw Error("PRIVATE_CANARY"); return {}; } }); const first = await g.handlers.diagnosticsPreview(); fail = true;
  await assert.rejects(async () => g.handlers.diagnosticsPreview(), /could not be prepared/); await assert.rejects(async () => g.handlers.copyDiagnostics(first.id), /Prepare/);
});
test("late collection cannot become current after a newer preparation or reset", async t => {
  let release, delayed = true;
  const f = fixture(t, { collect: () => delayed ? new Promise(resolve => release = resolve) : {} });
  const old = f.handlers.diagnosticsPreview(); delayed = false; const current = await f.handlers.diagnosticsPreview(); release({ profileCount: 99 });
  await assert.rejects(() => old, /could not be prepared/); await f.handlers.copyDiagnostics(current.id); assert.equal(f.copies[0], current.text);
  delayed = true; const resetting = f.handlers.diagnosticsPreview(); f.clear(); release({}); await assert.rejects(() => resetting, /could not be prepared/);
});

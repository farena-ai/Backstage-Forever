"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { defaultState } = require("../src/core/validation.cjs");
const modulePath = "../src/core/recovery-checkpoints.cjs";
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bf-recovery-"));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.ok(fs.existsSync(path.resolve(__dirname, modulePath)), "recovery manager must exist");
  const { RecoveryCheckpoints } = require(modulePath);
  let now = Date.parse("2026-11-10T12:00:00.000Z");
  return { dir, manager: new RecoveryCheckpoints(dir, { now: () => now, ...options }), tick: () => now += 900000 };
}
const state = (notes = "private notes") => ({ ...defaultState(), profiles: [{ id: "p", name: "Synthetic", realm: "Fixture", className: "Mage", level: 10, notes, goals: [] }], memories: [{ profileId: "p", exchanges: [{ id: crypto.randomUUID(), createdAt: "2026-11-10T10:00:00.000Z", question: "MEMORY_SENTINEL", answer: "MEMORY_ANSWER" }] }] });
test("construction and listing are read-only; validated payload excludes memory", t => {
  const { dir, manager } = fixture(t); assert.deepEqual(manager.list(), []); assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(manager.status(), { phase: "ready", automatic: true, count: 0, latestAt: null });
  fs.writeFileSync(path.join(dir, "credentials.json"), "CREDENTIAL_SENTINEL");
  const point = manager.create(state(), "manual"); const loaded = manager.read(point.id);
  assert.equal(loaded.sha256, point.sha256); assert.equal(loaded.state.profiles[0].notes, "private notes"); assert.deepEqual(loaded.state.memories, []);
  const text = fs.readFileSync(path.join(dir, "recovery", point.id + ".json"), "utf8"); assert.doesNotMatch(text, /MEMORY_|CREDENTIAL_|memories/);
  assert.throws(() => manager.create({ bad: true }, "manual"));
});
test("save coalescing, deduplication, close/startup and manual/off are event driven", t => {
  const { manager, tick } = fixture(t); const first = manager.create(state("a"), "startup");
  assert.equal(manager.create(state("a"), "manual").id, first.id);
  assert.equal(manager.create(state("b"), "save"), null); tick(); manager.create(state("b"), "save");
  assert.equal(manager.list().length, 2); manager.setAutomatic(false); assert.equal(manager.create(state("c"), "close"), null);
  manager.create(state("c"), "manual"); assert.equal(manager.list().length, 3); manager.setAutomatic(true); manager.create(state("d"), "close"); assert.equal(manager.list().length, 3);
  assert.deepEqual(manager.list().map(p => manager.read(p.id).state.profiles[0].notes).sort(), ["b", "c", "d"]);
});
test("corrupt version/hash/time/name remains unused and unrelated sentinels survive clear", t => {
  const { dir, manager } = fixture(t); const p = manager.create(state(), "manual"), file = path.join(dir, "recovery", p.id + ".json");
  const good = JSON.parse(fs.readFileSync(file));
  for (const change of [{ version: 2 }, { sha256: "0".repeat(64) }, { createdAt: "tomorrow" }, { id: crypto.randomUUID() }]) {
    fs.writeFileSync(file, JSON.stringify({ ...good, ...change })); assert.deepEqual(manager.list(), []); assert.throws(() => manager.read(p.id));
  }
  fs.writeFileSync(path.join(dir, "recovery", "sentinel.txt"), "keep"); manager.clear();
  assert.deepEqual(fs.readdirSync(path.join(dir, "recovery")), ["sentinel.txt"]);
  assert.throws(() => manager.read("../state"));
});
test("limits count envelope bytes and preserve old points on rejected writes", t => {
  const { dir, manager } = fixture(t, { maxPointBytes: 1800, maxTotalBytes: 2800 });
  const p = manager.create(state("a"), "manual"); const before = fs.readFileSync(path.join(dir, "recovery", p.id + ".json"));
  assert.throws(() => manager.create(state("x".repeat(2000)), "manual"), /limit/i); assert.equal(manager.status().phase, "limit");
  assert.deepEqual(fs.readFileSync(path.join(dir, "recovery", p.id + ".json")), before);
  for (let i = 0; i < 5; i++) manager.create(state("note" + i), "manual");
  assert.ok(manager.list().reduce((sum, p) => sum + p.bytes, 0) <= 2800); assert.ok(manager.list().length <= 3);
});
test("hardlinks and child junctions cannot be followed, cleared or overwritten", t => {
  const { dir, manager } = fixture(t); fs.mkdirSync(path.join(dir, "outside")); fs.writeFileSync(path.join(dir, "outside", "sentinel"), "keep");
  fs.symlinkSync(path.join(dir, "outside"), path.join(dir, "recovery"), "junction");
  assert.throws(() => manager.create(state(), "manual")); assert.throws(() => manager.clear()); assert.equal(fs.readFileSync(path.join(dir, "outside", "sentinel"), "utf8"), "keep");
  fs.unlinkSync(path.join(dir, "recovery")); fs.mkdirSync(path.join(dir, "recovery"));
  const id = crypto.randomUUID(); fs.linkSync(path.join(dir, "outside", "sentinel"), path.join(dir, "recovery", id + ".json"));
  assert.throws(() => manager.read(id)); assert.throws(() => manager.clear());
});
test("legitimate root junction alias resolves canonically", t => {
  const { dir, manager } = fixture(t); const p = manager.create(state(), "manual");
  const alias = path.join(dir, "root-alias"); fs.symlinkSync(dir, alias, "junction");
  const { RecoveryCheckpoints } = require(modulePath); assert.equal(new RecoveryCheckpoints(alias, { now: manager.now }).read(p.id).sha256, p.sha256);
  fs.unlinkSync(alias);
});
test("real atomic rename failure preserves points and removes unique temporary files", t => {
  const { dir, manager } = fixture(t); const p = manager.create(state(), "manual");
  const prefs = path.join(dir, "recovery-preferences.json"); fs.mkdirSync(prefs);
  assert.throws(() => manager.setAutomatic(false)); assert.equal(manager.status().automatic, false);
  assert.equal(manager.read(p.id).id, p.id); assert.ok(!fs.readdirSync(dir).some(n => n.endsWith(".tmp")));
});
module.exports = { state };
test("existing malformed preferences fail closed without replacing an earlier opt-out", t => {
  const { dir, manager } = fixture(t); fs.writeFileSync(path.join(dir, "recovery-preferences.json"), '{"automatic":false,broken');
  assert.equal(manager.status().automatic, false); assert.equal(manager.status().phase, "unavailable"); assert.throws(() => manager.create(state(), "startup"));
  assert.equal(fs.readFileSync(path.join(dir, "recovery-preferences.json"), "utf8"), '{"automatic":false,broken'); assert.equal(fs.existsSync(path.join(dir, "recovery")), false);
  manager.setAutomatic(true); assert.equal(manager.status().automatic, true);
});
test("same-clock manual points retain creation order rather than random UUID order", t => {
  const { manager } = fixture(t); const first = manager.create(state("a"), "manual"), second = manager.create(state("b"), "manual");
  assert.ok(second.createdAt > first.createdAt);
  for (const note of ["c", "d", "e"]) manager.create(state(note), "manual");
  assert.deepEqual(manager.list().map(p => manager.read(p.id).state.profiles[0].notes), ["e", "d", "c"]);
});
test("explicit clear purges managed crash temporaries including raw memory while preserving lookalikes", t => {
  const { dir, manager } = fixture(t); const point = manager.create(state(), "manual");
  for (const stem of [point.id + ".json", "damaged-original.bin", "recovery-preferences.json"]) fs.writeFileSync(path.join(dir, "recovery", `${stem}.${crypto.randomUUID()}.tmp`), "PRIVATE_CRASH_MEMORY");
  fs.writeFileSync(path.join(dir, "recovery", "damaged-original.bin.not-a-uuid.tmp"), "unrelated");
  manager.clear(); assert.deepEqual(fs.readdirSync(path.join(dir, "recovery")), ["damaged-original.bin.not-a-uuid.tmp"]);
});
test("bounded enumeration refuses unknown-entry floods without deleting sentinels", t => {
  const { dir, manager } = fixture(t); manager.create(state(), "manual");
  for (let i = 0; i < 64; i++) fs.writeFileSync(path.join(dir, "recovery", `sentinel-${i}`), "keep");
  assert.equal(manager.status().phase, "unavailable"); assert.throws(() => manager.clear()); assert.equal(fs.readdirSync(path.join(dir, "recovery")).length, 65);
});
test("untrusted managed envelopes cannot exceed the aggregate read budget", t => {
  const { dir, manager } = fixture(t); const point = manager.create(state(), "manual"), envelope = JSON.parse(fs.readFileSync(path.join(dir, "recovery", point.id + ".json")));
  manager.maxTotalBytes = point.bytes * 2;
  for (let i = 0; i < 2; i++) { const id = crypto.randomUUID(); fs.writeFileSync(path.join(dir, "recovery", id + ".json"), JSON.stringify({ ...envelope, id })); }
  assert.throws(() => manager.list(), /unavailable/); assert.equal(manager.status().phase, "unavailable"); assert.equal(fs.readdirSync(path.join(dir, "recovery")).length, 3);
});
test("production 64 MiB bound refuses an oversized damaged original without changing it", t => {
  const { dir, manager } = fixture(t); const point = manager.create(state(), "manual"), file = path.join(dir, "state.json");
  const fd = fs.openSync(file, "w"); fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); fs.closeSync(fd);
  assert.throws(() => manager.prepareStartupRestore(point.id), /limit/); assert.equal(fs.statSync(file).size, 64 * 1024 * 1024 + 1); assert.equal(fs.existsSync(path.join(dir, "recovery", "damaged-original.bin")), false);
});
test("real Windows sharing locks reject checkpoint reads and atomic preference replacement", { skip: process.platform !== "win32" }, async t => {
  const { dir, manager } = fixture(t); const point = manager.create(state(), "manual"); manager.setAutomatic(true);
  const { spawn } = require("node:child_process"), script = '$a=[System.IO.File]::Open($env:BF_LOCK_POINT,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); $b=[System.IO.File]::Open($env:BF_LOCK_PREF,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null; $a.Dispose(); $b.Dispose()';
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, BF_LOCK_POINT: path.join(dir, "recovery", point.id + ".json"), BF_LOCK_PREF: path.join(dir, "recovery-preferences.json") } });
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", data => data.toString().includes("LOCKED") ? resolve() : reject(Error("Lock helper did not acquire files"))); child.once("error", reject); child.once("exit", code => reject(Error("Lock helper exited " + code))); });
    assert.throws(() => manager.read(point.id)); assert.throws(() => manager.setAutomatic(false)); assert.ok(!fs.readdirSync(dir).some(n => n.endsWith(".tmp")));
  } finally { child.stdin.end("release\n"); await new Promise(resolve => child.once("exit", resolve)); }
  assert.equal(manager.preference(), true); assert.equal(manager.read(point.id).sha256, point.sha256);
});

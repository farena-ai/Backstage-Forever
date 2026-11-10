"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { Store } = require("../src/core/store.cjs"), { defaultState } = require("../src/core/validation.cjs"), { CompanionContext } = require("../src/core/companion-context.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bf-recovery-ipc-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, {}), context = new CompanionContext(() => store.state), handlers = {};
  const file = path.resolve(__dirname, "../src/core/recovery-ipc.cjs"); assert.ok(fs.existsSync(file), "trusted recovery IPC must exist");
  let response = 1, pending, options, transactions = 0, epoch = 0;
  const service = require(file).registerRecoveryHandlers({ handle: (n, f) => handlers[n] = f, store, context, getEpoch: () => epoch, getWindow: () => ({}), dialog: { async showMessageBox(_window, o) { options = o; return pending ? await pending : { response }; } }, transaction: async operation => { transactions++; return operation(); } });
  return { dir, store, context, handlers, service, options: () => options, transactions: () => transactions, epoch: () => epoch++, cancel: () => response = 0, hold: () => { let resolve; pending = new Promise(r => resolve = r); return resolve; } };
}
test("strict arity/shape and bounded list/preview omit payload and paths", async t => {
  const f = fixture(t), h = f.handlers;
  for (const [name, args] of [["recoveryList", [1]], ["checkpointNow", [1]], ["clearCheckpoints", [1]], ["setRecoveryAutomatic", [1]], ["previewCheckpoint", ["../state"]], ["restoreCheckpoint", [{ id: "x", sha256: "0".repeat(64), payload: {} }]]]) await assert.rejects(async () => h[name](...args), /invalid/);
  const result = h.checkpointNow(); assert.equal(result.points.length, 1); const point = h.previewCheckpoint(result.points[0].id); assert.equal(typeof point.sha256, "string"); assert.equal(point.profileCount, 0); assert.doesNotMatch(JSON.stringify(point), /payload|state|fileHash|path|provider/);
});
test("restore requires current preview, native Cancel default and deliberate current safety copy", async t => {
  const f = fixture(t), p = f.handlers.checkpointNow().points[0];
  await assert.rejects(() => f.handlers.restoreCheckpoint({ id: p.id, sha256: p.sha256 }), /Preview/);
  const preview = f.handlers.previewCheckpoint(p.id); f.cancel(); assert.equal(await f.handlers.restoreCheckpoint({ id: preview.id, sha256: preview.sha256 }), null); assert.equal(f.transactions(), 0);
  assert.equal(f.options().defaultId, 0); assert.equal(f.options().cancelId, 0); assert.match(f.options().message, /safety point.*off/i); assert.match(f.options().message, /memory.*keys.*disconnect/i);
});
for (const race of ["context", "save", "epoch", "preview", "file"]) test(`late native restore rejected after ${race} changes`, async t => {
  const f = fixture(t), p = f.handlers.checkpointNow().points[0], preview = f.handlers.previewCheckpoint(p.id), release = f.hold();
  const pending = f.handlers.restoreCheckpoint({ id: preview.id, sha256: preview.sha256 });
  if (race === "context") f.context.invalidate("navigation");
  if (race === "save") f.store.saveState({ ...defaultState(), onboarded: true });
  if (race === "epoch") f.epoch();
  if (race === "preview") f.handlers.previewCheckpoint(p.id);
  if (race === "file") { const file = path.join(f.dir, "recovery", p.id + ".json"), point = JSON.parse(fs.readFileSync(file)); point.reason = "close"; fs.writeFileSync(file, JSON.stringify(point)); }
  release({ response: 1 }); await assert.rejects(() => pending, /Preview|changed/); assert.equal(f.transactions(), 0);
});
test("clear confirmation retains automatic choice, rejects stale confirmation and clears current preview", async t => {
  const f = fixture(t); f.handlers.setRecoveryAutomatic(false); const p = f.handlers.checkpointNow().points[0]; f.handlers.previewCheckpoint(p.id);
  const result = await f.handlers.clearCheckpoints(); assert.equal(result.status.automatic, false); assert.equal(result.points.length, 0);
  await assert.rejects(() => f.handlers.restoreCheckpoint({ id: p.id, sha256: p.sha256 }), /Preview/);
});
test("real persisted-disconnect sharing failure aborts the main replacement transaction", { skip: process.platform !== "win32" }, async t => {
  const f = fixture(t), { GameSync } = require("../src/core/game-sync.cjs"), { spawn } = require("node:child_process"), vm = require("node:vm");
  const game = new GameSync({ dataDir: f.dir, addonDir: path.join(__dirname, "../addon/BackstageForever"), runtime: { probe: async () => ({ state: "not-running" }) } }); await game.ready; t.after(() => game.close());
  f.store.saveState({ ...defaultState(), onboarded: true }); const point = f.store.recovery.create(f.store.state, "manual"); f.store.saveState({ ...f.store.state, followGameCharacter: false });
  const connection = path.join(f.dir, "game-connection.private.json"); fs.writeFileSync(connection, '{"root":"SYNTHETIC_SOURCE"}'); fs.writeFileSync(path.join(f.dir, "credentials.json"), "KEY_SENTINEL");
  const before = fs.readFileSync(f.store.file), source = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  const scope = { store: f.store, game, subscriptionEpoch: 0, gameActionEpoch: 0, resetting: false, latestObservation: null, latestObservationRoot: null, recovery: { clear() {} }, diagnostics: { clear() {} }, companionContext: f.context, catalogs: { clear() {} }, knowledge: { setContext() {} } };
  vm.runInNewContext(source.slice(source.indexOf("  async function replaceJournal("), source.indexOf("  recovery = registerRecoveryHandlers")) + "globalThis.replace = replaceJournal;", scope);
  const script = '$a=[System.IO.File]::Open($env:BF_LOCK_CONNECTION,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null; $a.Dispose()';
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, BF_LOCK_CONNECTION: connection } });
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", data => data.toString().includes("LOCKED") ? resolve() : reject(Error("Lock helper failed"))); child.once("error", reject); child.once("exit", code => reject(Error("Lock helper exited " + code))); });
    await assert.rejects(() => scope.replace(() => f.store.restoreCheckpoint(point.id, point.sha256)), /Recovery/);
    assert.deepEqual(fs.readFileSync(f.store.file), before); assert.equal(fs.readFileSync(path.join(f.dir, "credentials.json"), "utf8"), "KEY_SENTINEL"); assert.equal(fs.existsSync(connection), true);
    Object.assign(scope, { handle: (_name, fn) => scope.reset = fn, dialog: { showMessageBox: async () => ({ response: 1 }) }, win: {}, updater: { reset: async () => {} }, chatgpt: { reset() {} }, claude: { clearCredentials: async () => {} } }); scope.knowledge.reset = async () => {};
    vm.runInNewContext(source.slice(source.indexOf('  handle("resetData"'), source.indexOf('  handle("openLink"')), scope);
    await assert.rejects(() => scope.reset(), /Recovery/); assert.deepEqual(fs.readFileSync(f.store.file), before); assert.equal(fs.existsSync(connection), true);
  } finally { child.stdin.end("release\n"); await new Promise(resolve => child.once("exit", resolve)); }
  await scope.replace(() => f.store.restoreCheckpoint(point.id, point.sha256)); assert.equal(fs.existsSync(connection), false);
  let reconnected = 0; const reconnect = GameSync.prototype._connect; GameSync.prototype._connect = async () => { reconnected++; };
  try { const restarted = new GameSync({ dataDir: f.dir, addonDir: path.join(__dirname, "../addon/BackstageForever"), runtime: { probe: async () => ({ state: "not-running" }) } }); await restarted.ready; restarted.close(); assert.equal(reconnected, 0); } finally { GameSync.prototype._connect = reconnect; }
});

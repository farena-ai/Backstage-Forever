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

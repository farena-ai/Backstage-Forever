"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { Store, StoreStartupError } = require("../src/core/store.cjs");
const { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const state = (notes = "journal") => ({ ...defaultState(), profiles: [{ id: "p", name: "Synthetic", realm: "Fixture", className: "Mage", level: 10, notes, goals: [] }] });
const safe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: s => s.toString() };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bf-recovery-store-"));
  t.after(() => { assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store: new Store(dir, safe) };
}
test("successful startup protects existing journal; constructor and premature close never capture", t => {
  const { dir, store } = fixture(t); store.saveState(state()); assert.equal(typeof store.startRecovery, "function");
  assert.equal(fs.existsSync(path.join(dir, "recovery")), false); store.closeRecovery(); assert.equal(fs.existsSync(path.join(dir, "recovery")), false);
  store.startRecovery(); assert.equal(store.recoveryStatus().count, 1);
  store.saveState(state("changed")); assert.equal(store.recoveryStatus().count, 1); store.closeRecovery(); assert.equal(store.recoveryStatus().count, 2);
});
test("ordinary checkpoint storage failure does not block journaling", t => {
  const { dir, store } = fixture(t); assert.equal(typeof store.startRecovery, "function"); store.startRecovery();
  fs.writeFileSync(path.join(dir, "recovery"), "not a directory");
  store.saveState(state()); assert.equal(store.state.profiles.length, 1); assert.equal(store.recoveryStatus().phase, "unavailable");
});
test("import protects old state when enabled and aborts on safety failure; off remains explicit", t => {
  const { dir, store } = fixture(t); store.saveState(state("old")); assert.equal(typeof store.startRecovery, "function"); store.startRecovery();
  store.saveState(state("current")); store.importData(JSON.stringify(state("import"))); assert.equal(store.recovery.list().some(p => store.recovery.read(p.id).state.profiles[0].notes === "current"), true);
  store.saveState(state("unsaved")); fs.writeFileSync(path.join(dir, "recovery", crypto.randomUUID() + ".json"), "broken");
  assert.throws(() => store.importData(JSON.stringify(state("bad replacement")))); assert.equal(store.state.profiles[0].notes, "unsaved");
  store.recovery.setAutomatic(false); store.importData(JSON.stringify(state("off import"))); assert.equal(store.state.profiles[0].notes, "off import");
});
test("restore reads selected point before rotation, protects current even off, clears memory and retains keys", t => {
  const { store } = fixture(t); assert.equal(typeof store.restoreCheckpoint, "function"); store.startRecovery(); store.saveState(state("first"));
  const point = store.recovery.list()[0]; store.recovery.setAutomatic(false); store.saveState(state("latest"));
  store.saveMemories([{ profileId: "p", exchanges: [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), question: "PRIVATE_MEMORY", answer: "PRIVATE_ANSWER" }] }]); store.saveKey("openai", "KEY");
  store.restoreCheckpoint(point.id, point.sha256); assert.equal(store.state.profiles[0].notes, "first"); assert.deepEqual(store.state.memories, []); assert.equal(store.getKey("openai"), "KEY");
  assert.equal(store.recovery.list().some(p => store.recovery.read(p.id).state.profiles[0].notes === "latest"), true);
});
test("profile deletion purges all managed points/originals before commit and failure denies deletion", t => {
  const { dir, store } = fixture(t); assert.equal(typeof store.startRecovery, "function"); store.startRecovery(); store.saveState(state());
  fs.writeFileSync(path.join(dir, "recovery", "damaged-original.bin"), "private memory"); fs.writeFileSync(path.join(dir, "recovery", "sentinel.txt"), "keep");
  store.saveState(defaultState()); assert.equal(store.recoveryStatus().count, 0); assert.deepEqual(fs.readdirSync(path.join(dir, "recovery")), ["sentinel.txt"]);
  store.saveState(state()); const p = store.recovery.list()[0], file = path.join(dir, "recovery", p.id + ".json"); fs.linkSync(file, path.join(dir, "sentinel-link"));
  const original = fs.readFileSync(path.join(dir, "state.json")); assert.throws(() => store.saveState(defaultState())); assert.deepEqual(fs.readFileSync(path.join(dir, "state.json")), original);
});
test("reset clears preferences/history/originals without recapturing old state", t => {
  const { dir, store } = fixture(t); assert.equal(typeof store.startRecovery, "function"); store.startRecovery(); store.saveState(state()); store.recovery.setAutomatic(false);
  fs.writeFileSync(path.join(dir, "recovery", "damaged-original.bin"), "private"); store.reset(); store.closeRecovery(); assert.equal(store.recoveryStatus().count, 0); assert.equal(store.recoveryStatus().automatic, true); assert.equal(fs.existsSync(path.join(dir, "recovery-preferences.json")), false);
});
test("typed startup errors distinguish malformed journal, read failure and credentials without modifying bytes", t => {
  const { dir } = fixture(t); assert.equal(typeof StoreStartupError, "function");
  const file = path.join(dir, "state.json"); fs.writeFileSync(file, "bad journal"); assert.throws(() => new Store(dir, safe), e => e instanceof StoreStartupError && e.kind === "journal" && !e.message.includes("bad journal")); assert.equal(fs.readFileSync(file, "utf8"), "bad journal");
  fs.unlinkSync(file); fs.mkdirSync(file); assert.throws(() => new Store(dir, safe), e => e.kind === "journal"); fs.rmdirSync(file);
  fs.writeFileSync(path.join(dir, "credentials.json"), "bad keys"); assert.throws(() => new Store(dir, safe), e => e.kind === "credentials"); assert.equal(fs.existsSync(path.join(dir, "recovery")), false);
});

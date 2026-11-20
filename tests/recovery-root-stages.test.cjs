"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { randomUUID } = require("node:crypto");
const { Store } = require("../src/core/store.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const safe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: s => s.toString() };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bf-root-stages-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, safe);
  store.saveState({ ...defaultState(), activeProfileId: "p", profiles: [{ id: "p", name: "Synthetic", realm: "Fixture", className: "Mage", level: 10, notes: "private journal", goals: [] }] });
  store.saveKey("openai", "synthetic key");
  store.recovery.setAutomatic(false);
  const point = store.recovery.create(store.state, "manual");
  return { dir, store, point };
}

test("reset removes exact owned root crash stages, preserving near matches and external exports", t => {
  const { dir, store } = fixture(t);
  const uuid = randomUUID(), bytes = Buffer.from("private fixture bytes");
  const owned = ["state.json", "credentials.json", "recovery-preferences.json"].map(stem => `${stem}.${uuid}.tmp`);
  const external = fs.mkdtempSync(path.join(path.dirname(dir), "bf-root-export-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const unrelated = [`export.json.${uuid}.tmp`, `state.jsonX${uuid}.tmp`, `state.json.extra.${uuid}.tmp`, `credentials.json.${uuid}.tmp.bak`,
    "recovery-preferences.json.not-a-uuid.tmp", `state.json.${uuid.slice(0, 14)}1${uuid.slice(15)}.tmp`,
    `recovery/${owned[0]}`, path.relative(dir, path.join(external, owned[0]))];
  for (const name of [...owned, ...unrelated]) fs.writeFileSync(path.join(dir, name), bytes);
  assert.deepEqual(store.reset().profiles, []);
  for (const name of owned) assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} survived reset`);
  for (const name of unrelated) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
  const reopened = new Store(dir, safe); reopened.startRecovery(); reopened.closeRecovery();
  assert.deepEqual(reopened.state.profiles, []); assert.equal(reopened.getKey("openai"), "");
  assert.equal(reopened.recoveryStatus().count, 0); assert.equal(reopened.recoveryStatus().automatic, true);
});

test("blocked root stage rejects reset without changing canonical bytes or history, then retry succeeds", t => {
  const { dir, store, point } = fixture(t);
  const stage = path.join(dir, `credentials.json.${randomUUID()}.tmp`);
  fs.writeFileSync(stage, "private stage");
  const files = [store.file, store.keyFile, stage, path.join(dir, "recovery-preferences.json"), path.join(dir, "recovery", `${point.id}.json`)];
  const before = files.map(file => fs.readFileSync(file)), saved = store.state;
  const unlink = fs.unlinkSync;
  const fault = t.mock.method(fs, "unlinkSync", file => {
    if (file === stage) throw Object.assign(Error("private native error"), { code: "EPERM" });
    return unlink(file);
  });
  try { assert.throws(() => store.reset(), e => e.kind === "unavailable" && !e.message.includes("private")); }
  finally { fault.mock.restore(); }
  assert.deepEqual(files.map(file => fs.readFileSync(file)), before);
  assert.equal(store.state, saved); assert.equal(store.getKey("openai"), "synthetic key");
  assert.deepEqual(store.reset().profiles, []);
  assert.equal(fs.existsSync(stage), false);
  assert.equal(new Store(dir, safe).getKey("openai"), "");
});

test("reset refuses a directory with an owned stage name without deleting contents", t => {
  const { dir, store } = fixture(t);
  const stage = path.join(dir, `state.json.${randomUUID()}.tmp`), child = path.join(stage, "keep");
  fs.mkdirSync(stage); fs.writeFileSync(child, "keep");
  assert.throws(() => store.reset(), { kind: "unavailable" });
  assert.equal(fs.readFileSync(child, "utf8"), "keep");
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { Store } = require("../src/core/store.cjs");
const validation = require("../src/core/validation.cjs");
const budget = 256 * 1024 * 1024;
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("fixture:" + s),
  decryptString: (b) => b.toString().slice(8),
};
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-backup-v06-"));
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), resolved);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
    assert.ok(path.basename(resolved).startsWith("bf-backup-v06-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return dir;
}
function fullHistories() {
  const completedIds = Array.from({ length: 20000 }, (_, i) => i + 1);
  const profiles = Array.from({ length: 20 }, (_, i) => ({
    id: `example-${i}`,
    name: "Example",
    realm: "Realm",
    className: "Mage",
    level: 20,
    notes: `Private journal ${i}`,
    goals: [{ id: `goal-${i}`, text: "Private goal", done: false }],
    source: {
      kind: "wow-addon",
      id: `fixture-${i}`,
      updatedAt: "2026-11-09T00:00:00.000Z",
    },
    clientBuild: "1.60.1.70862",
    locale: "enUS",
    captureVersion: "0.6.0",
    history: { recent: [], completedIdsKnown: true, completedIds },
  }));
  return validation.validateState({
    ...validation.defaultState(),
    profiles,
    activeProfileId: profiles[0].id,
  });
}
function importHandler({ store, file, filesystem = fs }) {
  let handler;
  const calls = { confirm: 0, disconnect: 0, guidanceInvalidations: 0 };
  const source = fs.readFileSync(
    path.join(__dirname, "../src/main.cjs"),
    "utf8",
  );
  vm.runInNewContext(
    source.slice(source.indexOf("  async function replaceJournal("), source.indexOf("  recovery = registerRecoveryHandlers")) + source.slice(
      source.indexOf('  handle("importData"'),
      source.indexOf('  handle("resetData"'),
    ),
    {
      handle: (_, fn) => {
        handler = fn;
      },
      store,
      fs: filesystem,
      MAX_BACKUP_BYTES: require("../src/core/store.cjs").MAX_BACKUP_BYTES,
      v: validation,
      win: {},
      subscriptionEpoch: 0,
      resetting: false,
      recovery: { clear() {} }, diagnostics: { clear() {} }, latestObservationRoot: null,
      characterGuidance: { clear() { calls.guidanceInvalidations++; } },
      companionContext: new (require("../src/core/companion-context.cjs").CompanionContext)(() => store.state),
      gameActionEpoch: 0,
      latestObservation: null,
      catalogs: { clear() {} },
      knowledge: { setContext() {} },
      game: {
        async disconnect() {
          calls.disconnect++;
        },
      },
      dialog: {
        async showOpenDialog() {
          return { canceled: false, filePaths: [file] };
        },
        async showMessageBox() {
          calls.confirm++;
          return { response: 1 };
        },
      },
    },
  );
  return { handler, calls };
}
test("a large exported completion-history roster restores with journals and credentials intact", (t) => {
  const dir = directory(t);
  const source = new Store(path.join(dir, "source"), safe);
  source.saveState(fullHistories());
  source.saveKey("openai", "fake-source-key-not-exported");
  const backup = source.exportData();
  assert.ok(Buffer.byteLength(backup) > 4000000);
  assert.doesNotMatch(backup, /fake-source-key-not-exported/);
  const target = new Store(path.join(dir, "target"), safe);
  target.saveKey("openai", "fake-target-key-preserved");
  target.importData(backup);
  const restored = new Store(path.join(dir, "target"), safe);
  assert.deepEqual(restored.state, source.state);
  assert.equal(restored.state.profiles[19].history.completedIds.length, 20000);
  assert.equal(restored.state.profiles[19].history.completedIds.at(-1), 20000);
  assert.equal(restored.getKey("openai"), "fake-target-key-preserved");
});
test("the actual native-dialog import handler accepts the same larger valid backup", async (t) => {
  const dir = directory(t);
  const state = fullHistories();
  const file = path.join(dir, "backup.json");
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  const store = new Store(path.join(dir, "target"), safe);
  const { handler, calls } = importHandler({ store, file });
  await handler();
  assert.deepEqual(store.state, state);
  assert.equal(calls.confirm, 1);
  assert.equal(calls.disconnect, 1);
  assert.equal(calls.guidanceInvalidations, 1);
});
test("the native import budget refuses an oversized file before reading or confirming", async () => {
  let read = false;
  const store = {
    state: validation.defaultState(),
    importData() {
      throw Error("Unexpected import");
    },
  };
  const filesystem = {
    statSync: () => ({ size: budget + 1 }),
    readFileSync() {
      read = true;
      throw Error("Unexpected read");
    },
  };
  const { handler, calls } = importHandler({
    store,
    file: "synthetic-backup.json",
    filesystem,
  });
  await assert.rejects(handler(), /Invalid backup/);
  assert.equal(read, false);
  assert.equal(calls.confirm, 0);
  assert.equal(calls.disconnect, 0);
  assert.equal(calls.guidanceInvalidations, 0);
});

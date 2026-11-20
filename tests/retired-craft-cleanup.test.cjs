"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { Store } = require("../src/core/store.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const at = "2026-01-02T00:00:00.000Z", now = Date.parse(at) + 86400001;
const col = items => ({ observedAt: at, complete: true, items });
const profile = (id, extra = {}) => ({ id, name: id, realm: "Test Realm", className: "Mage", level: 40, notes: "Private history", goals: [], quests: [],
  clientBuild: "1.60.1.70862", source: { kind: "wow-addon", id, updatedAt: at }, readiness: { workshop: {
    professions: col([{ skillLineId: 171, professionId: 1, name: "Alchemy", rank: 20, maxRank: 75 }]),
    recipes: col([{ id: 101, name: "Same name", skillLineId: 171, reagentsKnown: true,
      reagents: [{ itemId: 99, required: 3 }], outputItemId: 201, outputMin: 1, outputMax: 1 }]),
    materials: { ...col([{ itemId: 201, count: 999, name: "PRIVATE STOCK" }]), scope: "bags-0-4" },
  } }, ...extra });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-local-craft-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, {}, { now: () => now });
  store.saveState({ ...defaultState(), profiles: [profile("alt")], activeProfileId: "alt" });
  return store;
}
const legacyFile = store => path.join(store.dir, "local-craft.json");
function seedLegacy(store) {
  fs.writeFileSync(legacyFile(store), "synthetic retired craft data");
}

for (const release of ["v1.13.0", "v1.12.1"]) {
  test(`${release} reset then same-ID reimport cannot revive a preview sidecar`, t => {
    const store = fixture(t), backup = store.exportData(), root = path.resolve(__dirname, "..");
    const git = spawnSync("git", ["cat-file", "-t", `${release}^{commit}`], { cwd: root, encoding: "utf8" });
    if (git.stdout?.trim() !== "commit") return t.skip(`${release} Git object unavailable`);
    const archive = path.join(store.dir, "release.tar");
    execFileSync("git", ["archive", "--format=tar", "-o", archive, release, "src/core"], { cwd: root });
    execFileSync("tar", ["-xf", path.basename(archive)], { cwd: store.dir });
    const { Store: OldStore } = require(path.join(store.dir, "src", "core", "store.cjs"));
    seedLegacy(store);
    const bytes = fs.readFileSync(legacyFile(store));
    const older = new OldStore(store.dir, {}, { now: () => now });
    assert.equal(older.state.activeProfileId, "alt");
    assert.deepEqual(older.reset().profiles, []);
    assert.equal(new OldStore(store.dir, {}, { now: () => now }).importData(backup).activeProfileId, "alt");
    assert.deepEqual(fs.readFileSync(legacyFile(store)), bytes, "the old writer leaves the sidecar behind");
    const reopened = new Store(store.dir, {}, { now: () => now });
    assert.equal(reopened.state.activeProfileId, "alt");
    assert.equal(reopened.changeLocalCraft, undefined);
    assert.doesNotMatch(JSON.stringify(reopened.state), /synthetic retired craft data/);
  });
}

test("failed reset promotion preserves exact journal and retired sidecar", t => {
  const store = fixture(t);
  const journal = fs.readFileSync(store.file);
  seedLegacy(store);
  const prefs = fs.readFileSync(legacyFile(store)), rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === store.file) throw Object.assign(new Error("blocked journal promotion"), { code: "EACCES" });
    return rename(from, to);
  };
  try { assert.throws(() => store.reset(), /blocked journal promotion/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(store.file), journal);
  assert.deepEqual(fs.readFileSync(legacyFile(store)), prefs);
  assert.equal(fs.readdirSync(store.dir).some(name => /^state\.json\..*\.tmp$/.test(name)), false);
  store.reset();
  assert.equal(fs.existsSync(legacyFile(store)), false);
});

test("full reset clears only the retired sidecar and its owned orphan stages", t => {
  const store = fixture(t), orphan = `${legacyFile(store)}.${randomUUID()}.tmp`;
  const unrelated = `${legacyFile(store)}.not-a-stage.tmp`, bytes = Buffer.from("private bytes");
  seedLegacy(store);
  for (const file of [orphan, unrelated]) fs.writeFileSync(file, bytes);
  store.reset();
  assert.equal(fs.existsSync(legacyFile(store)), false);
  assert.equal(fs.existsSync(orphan), false);
  assert.deepEqual(fs.readFileSync(unrelated), bytes);
});

test("EPERM on an obsolete sidecar cannot interrupt reset or skip other owned files", t => {
  const store = fixture(t), backup = store.exportData();
  seedLegacy(store);
  const sidecar = legacyFile(store), original = fs.readFileSync(sidecar);
  const orphan = `${sidecar}.${randomUUID()}.tmp`;
  fs.writeFileSync(orphan, original);
  const unlink = fs.unlinkSync, warn = console.warn, warnings = [];
  let attempts = 0;
  fs.unlinkSync = file => {
    if (file === sidecar) {
      attempts++;
      throw Object.assign(new Error("blocked obsolete sidecar"), { code: "EPERM" });
    }
    return unlink(file);
  };
  console.warn = (...args) => warnings.push(args);
  try { assert.deepEqual(store.reset().profiles, []); }
  finally { fs.unlinkSync = unlink; console.warn = warn; }
  assert.equal(attempts, 1);
  assert.deepEqual(warnings, [["Reset could not remove all retired local craft files."]]);
  assert.deepEqual(fs.readFileSync(sidecar), original);
  assert.equal(fs.existsSync(orphan), false);
  const reopened = new Store(store.dir, {}, { now: () => now });
  assert.deepEqual(reopened.state.profiles, []);
  reopened.importData(backup);
  reopened.reset();
  assert.equal(fs.existsSync(sidecar), false);
});

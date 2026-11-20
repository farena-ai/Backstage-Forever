"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { candidate, ledgerCraftLeads, localCraftLeads } = require("../src/core/local-craft.cjs");
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
const model = { batchDecision: { status: "planned", rows: [{itemId: 201, name: "Vial", missing: 3}, {itemId: 202, name: "Vial", missing: 3}] } };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-local-craft-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, {}, { now: () => now });
  store.saveState({ ...defaultState(), profiles: [profile("alt")], activeProfileId: "alt" });
  return store;
}
const craft = store => store.workshopCraft({ selectedRecipe: { id: 101 } });
const offer = store => craft(store).choice.token;
const legacyFile = store => path.join(store.dir, "local-craft.json");
function seedLegacy(store) {
  fs.writeFileSync(legacyFile(store), JSON.stringify([candidate(store.state.profiles[0], 101, now).choice]));
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
    assert.deepEqual(reopened.localCraft, []);
    assert.deepEqual(ledgerCraftLeads(reopened.state, reopened.localCraft, now), []);
  });
}

for (const replace of ["import", "restore", "reset", "delete"]) {
  test(`same-ID ${replace} rejects an outstanding offer but permits fresh opt-in`, t => {
    const store = fixture(t), backup = store.exportData(), previous = offer(store);
    if (replace === "import") store.importData(backup);
    if (replace === "restore") {
      const point = store.recovery.create(store.state, "manual");
      store.restoreCheckpoint(point.id, point.sha256);
    }
    if (replace === "reset") { store.reset(); store.importData(backup); }
    if (replace === "delete") {
      const state = store.state;
      store.saveState({ ...state, profiles: [], activeProfileId: null });
      store.saveState(state);
    }
    assert.equal(store.state.activeProfileId, "alt");
    assert.equal(store.changeLocalCraft("alt", previous), false);
    assert.equal(store.changeLocalCraft("alt", offer(store)), true);
  });
}

test("failed reset promotion preserves exact journal and live consent", t => {
  const store = fixture(t);
  assert.equal(store.changeLocalCraft("alt", offer(store)), true);
  const journal = fs.readFileSync(store.file), live = structuredClone(store.localCraft);
  const remove = craft(store).removeToken;
  seedLegacy(store);
  const prefs = fs.readFileSync(legacyFile(store)), rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === store.file) throw Object.assign(new Error("blocked journal promotion"), { code: "EACCES" });
    return rename(from, to);
  };
  try { assert.throws(() => store.reset(), /blocked journal promotion/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(store.file), journal);
  assert.deepEqual(store.localCraft, live);
  assert.equal(craft(store).enabled, true);
  assert.equal(craft(store).removeToken, remove);
  assert.deepEqual(fs.readFileSync(legacyFile(store)), prefs);
  assert.equal(fs.readdirSync(store.dir).some(name => /^state\.json\..*\.tmp$/.test(name)), false);
  store.reset();
  assert.deepEqual(store.localCraft, []);
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
  assert.equal(store.changeLocalCraft("alt", offer(store)), true);
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
  assert.deepEqual(store.localCraft, []);
  const reopened = new Store(store.dir, {}, { now: () => now });
  assert.deepEqual(reopened.state.profiles, []);
  reopened.importData(backup);
  assert.deepEqual(ledgerCraftLeads(reopened.state, reopened.localCraft, now), []);
  reopened.reset();
  assert.equal(fs.existsSync(sidecar), false);
});

test("only explicit, exact compatible consent yields a dated stock-free lead for a Workshop shortfall", () => {
  const main = profile("main"), alt = profile("alt"), other = profile("other", {clientBuild: "1.60.1.99999"});
  const state = { profiles: [main, alt, other], activeProfileId: main.id };
  const enrolled = [candidate(main, 101, now).choice, candidate(alt, 101, now).choice, candidate(other, 101, now).choice];
  const read = (choices, batch = model) => localCraftLeads(state, choices, batch, now);
  assert.deepEqual(read([]), []);
  assert.deepEqual(read(enrolled), [{ character: "alt", realm: "Test Realm", recipe: "Same name", itemId: 201, observedAt: at, stale: true }]);
  assert.deepEqual(read(enrolled, {batchDecision: {status: "unknown", rows: model.batchDecision.rows}}), []);
  assert.deepEqual(read(enrolled, {batchDecision: {status: "planned", rows: [{itemId: 201, missing: 0}]}}), []);
  alt.readiness.workshop.recipes.items[0].outputItemId = 202;
  assert.deepEqual(read(enrolled), [], "a new same-named result does not inherit consent");
});

test("candidate rejects missing ownership, unknown output, and dates beyond the save or clock", () => {
  const alt = profile("alt");
  assert.equal(candidate(alt, 101, Date.parse(at) - 1), null);
  assert.equal(candidate(alt, 102, now), null);
  const recipe = alt.readiness.workshop.recipes.items[0];
  delete recipe.outputItemId;
  assert.equal(candidate(alt, 101, now), null);
  recipe.outputItemId = 201;
  alt.readiness.workshop.professions.items = [];
  assert.equal(candidate(alt, 101, now), null);
  alt.readiness.workshop.professions.items = profile("alt").readiness.workshop.professions.items;
  alt.source.updatedAt = "2026-01-01T00:00:00.000Z";
  assert.equal(candidate(alt, 101, now), null);
});

test("session opt-in and opt-out leave journal and backup bytes unchanged", t => {
  const store = fixture(t), baseline = fs.readFileSync(store.file), backup = store.exportData(), token = offer(store);
  assert.equal(store.changeLocalCraft("alt-two", token), false);
  assert.equal(store.changeLocalCraft("alt", token), true);
  assert.deepEqual(store.localCraft, [candidate(store.state.profiles[0], 101, now).choice]);
  assert.deepEqual(fs.readFileSync(store.file), baseline);
  assert.equal(store.exportData(), backup);
  assert.equal(fs.existsSync(legacyFile(store)), false);
  const reopened = new Store(store.dir, {}, { now: () => now });
  assert.equal(craft(reopened).enabled, false);
  assert.equal(reopened.changeLocalCraft("alt", token), false);
  assert.equal(store.changeLocalCraft("alt", craft(store).removeToken), true);
  assert.equal(store.changeLocalCraft("alt", token), false, "opt-out also retires previous offers");
  assert.deepEqual(store.localCraft, []);
  assert.deepEqual(fs.readFileSync(store.file), baseline);
  assert.equal(store.exportData(), backup);
});

test("delete prunes exact owner, and backup replacement and reset retire all consent", t => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-local-craft-"));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const store = new Store(dir, {}, {now: () => now});
  const state = { ...defaultState(), profiles: [profile("alt"), profile("alt-two")], activeProfileId: "alt" };
  store.saveState(state);
  for (const p of store.state.profiles) {
    store.saveState({ ...store.state, activeProfileId: p.id });
    assert.equal(store.changeLocalCraft(p.id, offer(store)), true);
  }
  store.saveState({ ...store.state, profiles: [store.state.profiles[1]] });
  assert.deepEqual(store.localCraft.map(c => c.profileId), ["alt-two"]);
  const remove = craft(store).removeToken;
  store.importData(store.exportData());
  assert.deepEqual(store.localCraft, []);
  assert.equal(store.changeLocalCraft("alt-two", offer(store)), true);
  assert.equal(store.changeLocalCraft("alt-two", remove), false, "retired removal cannot affect fresh consent");
  store.reset();
  assert.deepEqual(store.localCraft, []);
});

test("startup recovery cannot restore journal characters with consent from the replaced journal", t => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-local-craft-"));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const store = new Store(dir, {}, {now: () => now});
  const alt = profile("alt");
  store.saveState({ ...defaultState(), profiles: [alt], activeProfileId: alt.id });
  const point = store.recovery.create(store.state, "manual");
  const token = offer(store);
  assert.equal(store.changeLocalCraft(alt.id, token), true);
  seedLegacy(store);
  const orphan = `${legacyFile(store)}.${randomUUID()}.tmp`;
  fs.copyFileSync(legacyFile(store), orphan);
  fs.writeFileSync(store.file, "damaged state");
  store.recovery.restoreDamaged(store.recovery.prepareStartupRestore(point.id));
  const reopened = new Store(dir, {});
  assert.equal(reopened.state.profiles[0].id, alt.id);
  assert.deepEqual(reopened.localCraft, []);
  assert.equal(reopened.changeLocalCraft(alt.id, token), false);
  assert.equal(fs.existsSync(legacyFile(store)), false);
  assert.equal(fs.existsSync(orphan), false);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { Store } = require("../src/core/store.cjs");
const { WishList } = require("../src/core/wishlist.cjs");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const build = "1.60.1.70862", t = 1700000100;
const defeat = { name: "Edwin VanCleef", encounterId: 1144, instanceMap: 36, instanceType: "party", difficultyId: 1, at: t - 1 };
const profile = { id: "main", clientBuild: build, source: { kind: "wow-addon", id: "Player-main", updatedAt: new Date(t * 1000).toISOString() } };
const quest = (id, complete = false, title = "Deadmines lookalike") => ({ id, title, complete, objectives: [] });
const model = (p, wished = [], key = "dm") => require("../src/core/dungeon-progression.cjs").dungeonProgression(key, p, wished, t * 1000);

test("projects exact saved Defias quest, starred gear goal and dated Deadmines defeat independently", () => {
  const result = model({ ...profile, quests: [quest(165), quest(166), quest(2040, true)], journal: { encounters: [defeat] } }, [999, 5202, 5202]);
  assert.equal(result.status, "available");
  assert.deepEqual(result.quests, [{ id: 166, title: "The Defias Brotherhood" }]);
  assert.deepEqual(result.gearGoals, [{ itemId: 5202, name: "Corsair's Overshirt", sourceName: "Edwin VanCleef" }]);
  assert.deepEqual(result.defeats, { captureBuild: null, rows: [{ name: defeat.name, encounterId: defeat.encounterId, at: defeat.at }], moreRetained: false });
});

test("a different reviewed save build cannot borrow the older build's gear source", () => {
  const result = model({ ...profile, clientBuild: "1.60.1.70888", quests: [quest(166)] }, [5202]);
  assert.equal(result.status, "available");
  assert.equal(result.gearGoals, null);
  assert.deepEqual(result.quests.map(q => q.id), [166]);
});

test("only the reviewed exact dungeon and compatible dated addon scope are admitted", () => {
  assert.equal(model(profile, [2041], "lbrs"), null);
  for (const p of [null, { ...profile, source: undefined }, { ...profile, source: { ...profile.source, updatedAt: new Date((t + 1) * 1000).toISOString() } },
    { ...profile, clientBuild: "1.60.1.70888-extra" }, { ...profile, clientBuild: "1.60.1.70900" }, { ...profile, clientBuild: null }]) {
    const result = model(p, [2041]);
    assert.equal(result.status, "unavailable");
    assert.equal(result.gearGoals, undefined);
    assert.equal(result.defeats, undefined);
  }
});

test("filters by exact map, party type and save clock before bounding dated repeats", () => {
  const retained = Array.from({ length: 100 }, (_, i) => ({ ...defeat, at: t - i }));
  const rows = [{ ...defeat, at: t + 1 }, { ...defeat, instanceMap: 1436 }, { ...defeat, instanceType: "raid" }, ...retained.slice(0, 96), retained[0]];
  const result = model({ ...profile, journal: { encounters: rows } });
  assert.deepEqual(result.defeats.rows.map(row => row.at), retained.slice(0, 5).map(row => row.at));
  assert.equal(result.defeats.moreRetained, true);
  for (const encounters of [undefined, [], [{ ...defeat, instanceMap: 47 }], [{ ...defeat, at: 0 }], retained.concat(defeat)]) {
    const empty = model({ ...profile, quests: [quest(2040)], journal: { encounters } });
    assert.deepEqual(empty.defeats.rows, []);
    assert.deepEqual(empty.quests.map(row => row.id), [2040]);
  }
});

test("real SavedVariables import, reopened Store and wish list isolate two same-name characters", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "dungeon-progression-"));
  try {
    const raw = { schema: 1, observedAt: t, activeId: "Player-A", characters: [
      { id: "Player-A", name: "Example", realm: "Fixture", className: "Mage", level: 20, updatedAt: t, clientBuild: build, quests: [quest(166)], journal: { encounters: [defeat] } },
      { id: "Player-B", name: "Example", realm: "Fixture", className: "Mage", level: 20, updatedAt: t, clientBuild: build, quests: [quest(165)] },
    ] };
    const imported = mergeSnapshot(defaultState(), parseSavedVariables(`BackstageForeverExport = [=[${JSON.stringify(raw)}]=]`));
    const store = new Store(dir);
    store.saveState(imported);
    new WishList(dir).set(imported.activeProfileId, 5202, true);
    const reopened = new Store(dir), wishes = new WishList(dir);
    const [a, b] = reopened.state.profiles.map(p => model(p, wishes.get(p.id)));
    assert.deepEqual([a.quests.length, a.gearGoals.length, a.defeats.rows.length], [1, 1, 1]);
    assert.deepEqual([b.quests.length, b.gearGoals.length, b.defeats.rows.length], [0, 0, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

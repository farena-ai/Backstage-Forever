"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { registerBossLootHandlers } = require("../src/core/boss-loot-ipc.cjs");
const build = "1.60.1.70888", at = "2026-11-19T20:00:00.000Z";
const profile = { id: "one", level: 35, className: "Warrior", faction: "Alliance", clientBuild: build,
  source: { kind: "wow-addon", updatedAt: at }, quests: [{ id: 166, complete: false }], readiness: { workshop: {
    professions: { observedAt: at, items: [{ skillLineId: 164, rank: 35, name: "Blacksmithing" }] },
    recipes: { observedAt: at, items: [{ id: 31, skillLineId: 164, name: "Saved recipe", outputItemId: 100,
      reagentsKnown: true, reagents: [{ itemId: 2840, required: 2 }] }] },
  } },
};
function setup({ p = profile, installed = build, resolve = id => ({ id, name: `Item ${id}`, classId: 4,
  subclassId: 1, inventoryType: id === 6682 ? 20 : 5, requiredLevel: 10, classes: null }), stars = { one: [6682], alt: [] } } = {}) {
  const handlers = new Map(), state = { activeProfileId: p?.id ?? null, profiles: p ? [p] : [] };
  registerBossLootHandlers({ handle: (k, fn) => handlers.set(k, fn), getState: () => state,
    gameData: { build: () => installed, items: ids => ids.map(resolve) }, getPack: () => null,
    wishlist: { get: id => stars[id] || [], set: () => assert.fail("read-only projection") } });
  return (profileId = p?.id, slot = "chest") => handlers.get("gearAcquisition")?.(profileId, slot);
}

test("one chest slot joins exact quest choice, merchant, saved recipe, and dungeon drop IDs", () => {
  const view = setup()();
  assert.equal(view?.status, "available");
  assert.deepEqual(view.leads.map(x => [x.kind, x.itemId, x.sourceId, x.qualification, x.wished]), [
    ["quest", 2041, 166, "saved-in-log", false], ["vendor", 285, 956, "historical", false],
    ["craft", 100, 31, "saved-recipe", false], ["dungeon", 6682, 4428, "historical", true],
  ]);
  assert.equal(view.leads[0].rewardChoice, true);
  assert.deepEqual(view.leads[2].reagents, [{ itemId: 2840, required: 2 }]);
  assert.equal(view.leads[3].instanceId, "rfk");
  assert.equal(view.leads[3].availableNow, null);
  assert.equal(view.leads[3].clientBuild, build);
  assert.equal(view.leads[0].requiredLevel, 10);
  assert.equal(view.leads[0].questMinLevel, 14);
  assert.ok(view.leads.every(row => !Object.hasOwn(row, "verdict") && !Object.hasOwn(row, "chance")));
});

test("wrong/unknown build, missing saved identity and incorrect picker ownership fail closed", () => {
  for (const options of [{ installed: "1.60.2.70862" }, { installed: null }, { p: null }, { p: { ...profile, source: null } }]) {
    assert.equal(setup(options)()?.status, "unavailable");
    assert.deepEqual(setup(options)().leads, []);
  }
  const otherBuild = "1.60.2.70862"; // another patch: the reference does not apply
  assert.deepEqual(setup({ p: { ...profile, clientBuild: otherBuild }, installed: otherBuild })().leads.map(x => x.kind), ["craft"]);
  assert.throws(() => setup()("alt"), /active character/i);
  assert.throws(() => setup()("one", "head"), /slot/i);
});

test("an absent exact in-log quest, incompatible vendor side, or missing owned skill does not qualify", () => {
  const w = profile.readiness.workshop;
  const p = { ...profile, id: "alt", faction: "Horde", quests: [{ id: 165 }], readiness: { workshop: {
    ...w, professions: { ...w.professions, items: [{ skillLineId: 165 }] },
  } } };
  const view = setup({ p })();
  assert.deepEqual(view?.leads.map(x => [x.kind, x.qualification, x.wished]), [
    ["quest", "reference-only", false], ["vendor", "reference-only", false], ["dungeon", "historical", false],
  ]);
  assert.equal(view.leads[1].observedFaction, "Alliance");
  assert.ok(view.gaps.craft);
});

test("item-name lookalikes and wrong slots cannot join; equip limits stay separate from a source", () => {
  const view = setup({ resolve: id => ({ id: id === 2041 ? 2042 : id, name: "Same name", classId: 4,
    inventoryType: id === 285 ? 7 : 20, requiredLevel: 40, classes: ["Mage"] }) })();
  assert.deepEqual(view?.leads.map(x => x.itemId), [100, 6682]);
  assert.ok(view.leads.every(x => x.requiredLevel === 40 && x.equipLevel === "not-met" && x.equipClass === "not-met"));
  assert.ok(view.gaps.quest && view.gaps.vendor);
});

test("future recipes and unknown reagents are not evidence that a craft can be planned", () => {
  const w = profile.readiness.workshop;
  for (const recipes of [{ ...w.recipes, observedAt: "2026-11-19T21:00:00.000Z" },
    { ...w.recipes, items: [{ ...w.recipes.items[0], reagentsKnown: false }] }]) {
    const p = { ...profile, readiness: { workshop: { ...w, recipes } } };
    assert.ok(setup({ p })()?.leads.every(x => x.kind !== "craft"));
  }
});

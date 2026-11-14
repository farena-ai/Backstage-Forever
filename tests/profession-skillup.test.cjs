"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { buildProfessionCoach } = require("../src/core/profession-coach.cjs");
const { skillColor, colorRank, skillUpCountdown, shoppingList, SKILL_COLORS } = require("../src/core/profession-skillup.cjs");

const at = "2026-11-11T12:00:00.000Z", col = (items) => ({ observedAt: at, complete: true, items });
const recipe = (id, name, difficulty, reagents, extra = {}) => ({ id, skillLineId: 171, name, canSkillUp: difficulty !== "trivial", ...(difficulty ? { difficulty } : {}), reagentsKnown: true, reagents, ...extra });
function seed(recipes, materials = [{ itemId: 765, count: 3 }]) {
  return {
    ...defaultState(), activeProfileId: "p",
    profiles: [{
      id: "p", name: "Synthetic", realm: "Synthetic", className: "Mage", level: 12, faction: "Horde", notes: "", goals: [],
      location: { zone: "The Barrens", subZone: "", mapId: 1413, x: 0.5, y: 0.3 },
      source: { kind: "wow-addon", id: "PRIVATE_SOURCE_ID", updatedAt: at }, clientBuild: "1.60.1.70862",
      readiness: { workshop: {
        professions: col([{ skillLineId: 171, professionId: 4, name: "Alchemy", rank: 20, maxRank: 75 }]),
        recipes: { ...col(recipes), complete: false },
        materials: { ...col(materials), scope: "bags-0-4" },
      } },
    }],
  };
}
const build = (s, o = {}) => buildProfessionCoach(s, "p", o, { acquisitionPack: loadAcquisitionPack(), vendorPack: loadVendorPack() });

test("colour chips map the client's difficulty to orange/yellow/green/grey and never infer grey", () => {
  assert.deepEqual(Object.values(SKILL_COLORS).map((c) => c.color), ["orange", "yellow", "green", "grey"]);
  assert.equal(skillColor({ difficulty: "optimal" }).color, "orange");
  assert.equal(skillColor({ difficulty: "trivial" }).chance, 0);
  assert.equal(skillColor({ canSkillUp: false }).color, "unknown");
  assert.equal(skillColor({ difficulty: "toString" }).color, "unknown");
  assert.ok(colorRank({ difficulty: "optimal" }) < colorRank({ difficulty: "medium" }));
  assert.ok(colorRank({ difficulty: "medium" }) < colorRank({}) && colorRank({}) < colorRank({ difficulty: "easy" }));
});

test("countdown is an estimate by colour: per point, to the cap, grey, unknown and at cap", () => {
  const p = { name: "Alchemy", rank: 20, maxRank: 75 };
  let c = skillUpCountdown(p, { name: "A", difficulty: "optimal", canSkillUp: true });
  assert.equal(c.estimate, true); assert.equal(c.craftsToCap, 55); assert.equal(c.craftsToNextPoint, 1); assert.match(c.detail, /^Estimate:/);
  c = skillUpCountdown(p, { name: "A", difficulty: "medium", canSkillUp: true });
  assert.equal(c.craftsToCap, Math.ceil(55 / 0.75)); assert.equal(c.craftsToNextPoint, 2); assert.equal(c.craftsPerPoint, 1.3);
  c = skillUpCountdown(p, { name: "A", difficulty: "easy", canSkillUp: true });
  assert.equal(c.craftsToCap, 220); assert.equal(c.craftsToNextPoint, 4);
  assert.equal(skillUpCountdown(p, { name: "A", difficulty: "trivial", canSkillUp: false }).status, "grey");
  assert.equal(skillUpCountdown(p, { name: "A", canSkillUp: true }).status, "unknown");
  assert.equal(skillUpCountdown(p, { name: "A", canSkillUp: false }).status, "grey");
  assert.equal(skillUpCountdown({ ...p, rank: 75 }, { name: "A", difficulty: "optimal" }).status, "at-cap");
  assert.equal(skillUpCountdown(null, { name: "A" }), null);
});

test("best next recipe prefers orange over yellow over green, then fewest missing, then fewest materials", () => {
  const recipes = [
    recipe(100, "Green tonic", "easy", [{ itemId: 765, name: "Silverleaf", required: 1 }]),
    recipe(101, "Yellow tonic", "medium", [{ itemId: 2447, name: "Peacebloom", required: 1 }]),
    recipe(102, "Orange heavy", "optimal", [{ itemId: 2447, name: "Peacebloom", required: 9 }]),
    recipe(103, "Orange light", "optimal", [{ itemId: 765, name: "Silverleaf", required: 5 }]),
    recipe(104, "Grey tonic", "trivial", [{ itemId: 765, name: "Silverleaf", required: 1 }]),
  ];
  let m = build(seed(recipes));
  assert.equal(m.selection.recipeId, 103);
  assert.equal(m.nextRecipe.id, 103); assert.equal(m.nextRecipe.color, "orange"); assert.match(m.nextRecipe.reason, /^Orange: always a skill-up · 1 material short/);
  assert.deepEqual(m.recipeChoices.map((r) => r.skill.color), ["green", "yellow", "orange", "orange", "grey"]);
  assert.equal(m.recipeChoices.find((r) => r.id === 104).levelingEligible, false);
  // Owned supply decides between equal colours.
  m = build(seed(recipes, [{ itemId: 2447, count: 9 }]));
  assert.equal(m.nextRecipe.id, 102); assert.match(m.nextRecipe.reason, /bags cover 1 craft/);
  // Without orange the yellow recipe leads; an explicit choice keeps the best pick visible.
  m = build(seed(recipes.filter((r) => r.difficulty !== "optimal")), { recipeId: 100 });
  assert.equal(m.selectedRecipe.id, 100); assert.equal(m.nextRecipe.id, 101);
  assert.equal(m.skillUp.color, "green"); assert.equal(m.skillUp.craftsToCap, 220);
  // Older saves without colours keep the previous supply ranking.
  m = build(seed(recipes.map(({ difficulty, ...r }) => ({ ...r, canSkillUp: true }))));
  assert.equal(m.nextRecipe.id, 100); assert.equal(m.nextRecipe.color, "unknown"); assert.equal(m.skillUp.status, "unknown");
});

test("shopping list aggregates N crafts and marks vendor (name + nearest map spot), gather and gather/buy", () => {
  const s = seed([recipe(100, "Mixed", "optimal", [
    { itemId: 765, name: "Silverleaf", required: 2 }, { itemId: 2320, name: "Coarse Thread", required: 1 }, { itemId: 999999, name: "Mystery", required: 3 },
  ])]);
  s.profiles[0].gathering = { schemaVersion: 1, status: "available", recording: true, observedAt: at, limited: false, totalRecords: 1, records: [
    { id: "wowf:herbalism:1617:1413:4000:3000:1.60.1.70862", method: "herbalism", entityId: 1617, itemIds: [999999], mapId: 1413, x: 0.4, y: 0.3, observedAt: at, clientBuild: "1.60.1.70862", name: "Silverleaf", evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true },
  ] };
  const m = build(s, { crafts: 4 });
  const list = m.shoppingList, by = (id) => list.rows.find((r) => r.itemId === id);
  assert.equal(list.crafts, 4);
  assert.equal(by(765).required, 8); assert.equal(by(765).need, 5); assert.equal(by(765).source, "vendor");
  assert.equal(by(765).vendor.name, "Hula'mahi"); assert.equal(by(765).vendor.mapName, "The Barrens"); assert.equal(by(765).vendor.mapId, 1413);
  assert.equal(by(2320).source, "vendor"); assert.ok(by(2320).vendor.name);
  assert.equal(by(999999).source, "gather"); assert.equal(by(999999).gather.yours, true); assert.equal(by(999999).gather.mapName, "The Barrens");
  assert.deepEqual(list.counts, { vendor: 2, gather: 1, other: 0 });
  const plain = shoppingList([{ itemId: 1, name: "X", required: 2, have: null, missing: null, quantityKind: "unknown", historicalSellers: null, acquisition: null }]);
  assert.equal(plain.rows[0].source, "other"); assert.equal(plain.rows[0].need, 2);
  assert.doesNotMatch(JSON.stringify(m.shoppingList), /PRIVATE_/);
});
test("without an exact bag count, equal colours rank by the fewest materials per craft", () => {
  const s = seed([
    recipe(100, "Heavy", "medium", [{ itemId: 2447, name: "Peacebloom", required: 6 }]),
    recipe(101, "Light", "medium", [{ itemId: 2447, name: "Peacebloom", required: 1 }, { itemId: 765, name: "Silverleaf", required: 1 }]),
  ]);
  s.profiles[0].readiness.workshop.materials.complete = false;
  const m = build(s);
  assert.equal(m.nextRecipe.id, 101); assert.match(m.nextRecipe.reason, /2 materials per craft/);
});

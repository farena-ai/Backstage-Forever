"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { defaultState } = require("../src/core/validation.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const at = "2026-11-11T12:00:00.000Z",
  col = (items) => ({ observedAt: at, complete: true, items });
function seed() {
  return {
    ...defaultState(),
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "Synthetic",
        realm: "Synthetic",
        className: "Mage",
        level: 12,
        faction: "Horde",
        notes: "PRIVATE_NOTES",
        goals: [{ id: "g", text: "PRIVATE_GOALS", done: false }],
        source: { kind: "wow-addon", id: "PRIVATE_SOURCE_ID", updatedAt: at },
        clientBuild: "1.60.1.70862",
        readiness: {
          workshop: {
            professions: col([
              {
                skillLineId: 171,
                professionId: 4,
                name: "Alchemy",
                rank: 20,
                maxRank: 75,
              },
            ]),
            recipes: {
              ...col([
                {
                  id: 100,
                  skillLineId: 171,
                  name: "Herbal tonic",
                  canSkillUp: true,
                  reagentsKnown: true,
                  reagents: [{ itemId: 765, name: "Silverleaf", required: 2 }],
                },
                {
                  id: 101,
                  skillLineId: 171,
                  name: "Plain tonic",
                  canSkillUp: true,
                  reagentsKnown: true,
                  reagents: [
                    { itemId: 2447, name: "Peacebloom", required: 20 },
                  ],
                },
              ]),
              complete: false,
            },
            materials: {
              ...col([{ itemId: 765, count: 3 }]),
              scope: "bags-0-4",
            },
          },
        },
      },
    ],
  };
}
function api() {
  assert.ok(
    fs.existsSync(
      require
        .resolve("../src/core/preparation.cjs")
        .replace("preparation.cjs", "profession-coach.cjs"),
    ),
    "Profession model missing",
  );
  return require("../src/core/profession-coach.cjs");
}
const build = (
  s = seed(),
  o = {},
  d = { acquisitionPack: loadAcquisitionPack(), vendorPack: loadVendorPack() },
) => api().buildProfessionCoach(s, "p", o, d);
test("automatic partial-catalog selection ranks observed supply and returns detached private-free exact batch rows", () => {
  const s = seed(),
    before = structuredClone(s);
  let m = build(s);
  assert.equal(m.selection.automatic, true);
  assert.equal(m.selection.recipeId, 100);
  assert.equal(m.recommendation.kind, "craft-ready");
  m = build(s, { crafts: 5 });
  assert.equal(m.shoppingRows.find((r) => r.itemId === 765).missing, 7);
  assert.equal(m.recommendation.kind, "materials-needed");
  assert.equal(m.ownedProfessionChoices.length, 1);
  assert.equal(m.recipeChoices.length, 2);
  assert.doesNotMatch(JSON.stringify(m), /PRIVATE_/);
  m.selectedRecipe.name = "changed";
  assert.deepEqual(s, before);
});
test("manual non-skillup stays a plan and unavailable or mismatched explicit choice is never silently changed", () => {
  const s = seed();
  s.profiles[0].readiness.workshop.recipes.items[0].canSkillUp = false;
  const m = build(s, { recipeId: 100 });
  assert.equal(m.selection.automatic, false);
  assert.equal(m.recommendation.kind, "craft-plan");
  assert.equal(m.planning.checklistAvailable, true);
  for (const o of [{ recipeId: 999 }, { recipeId: 100, skillLineId: 999 }]) {
    const m = build(s, o);
    assert.equal(m.selectedRecipe, null);
    assert.equal(m.selection.recipeId, o.recipeId);
    assert.equal(m.planning.checklistAvailable, false);
    assert.match(m.planning.reason, /unavailable|owned/i);
  }
});
test("partial, missing and stale inventory cannot manufacture absent zero or exact shortfall", () => {
  for (const change of [
    (w) => (w.materials.complete = false),
    (w) => (w.materials.observedAt = "2026-11-10T12:00:00.000Z"),
    (w) => delete w.materials,
  ]) {
    const s = seed();
    change(s.profiles[0].readiness.workshop);
    const m = build(s, { recipeId: 101 });
    assert.equal(m.shoppingRows[0].have, null);
    assert.equal(m.shoppingRows[0].missing, null);
    assert.equal(m.shoppingRows[0].quantityKind, "unknown");
    assert.notEqual(m.recommendation.kind, "craft-ready");
  }
});
test("newer rank and missing source suppress leveling, cap remains qualified, bounds and sparse inputs fail safely", () => {
  const s = seed(),
    w = s.profiles[0].readiness.workshop;
  w.recipes.observedAt = "2026-11-10T12:00:00.000Z";
  assert.equal(build(s).selectedRecipe, null);
  assert.equal(build(s, { recipeId: 100 }).recommendation.kind, "craft-plan");
  w.professions.items[0].rank = 75;
  assert.match(build(s).recommendation.detail, /training|higher rank/i);
  delete s.profiles[0].source;
  assert.notEqual(build(s).recommendation?.kind, "craft-ready");
  for (const o of [
    { crafts: 0 },
    { crafts: 21 },
    { crafts: 1.1 },
    { recipeId: 0 },
    { skillLineId: 2147483648 },
    { extra: true },
    [],
    null,
    Object.create({ crafts: 1 }),
  ])
    assert.throws(() => api().validateProfessionOptions(o));
  const bad = seed();
  delete bad.profiles[0].readiness.workshop.recipes.items[0];
  assert.throws(() => build(bad));
});
test("source kinds, build, context and limited stock stay qualified, missing references preserve planning", () => {
  let m = build();
  assert.equal(m.shoppingRows[0].acquisition.status, "qualified-historical");
  assert.equal(m.shoppingRows[0].acquisition.sources[0].requiredRank, null);
  m = build(seed(), { recipeId: 101 });
  assert.deepEqual(m.shoppingRows[0].acquisition.sources[0].context, [
    "bountifulHarvest:1",
  ]);
  const s = seed();
  s.profiles[0].clientBuild = "1.60.1.70888";
  assert.equal(build(s).shoppingRows[0].acquisition.status, "browse-only");
  m = build(seed(), {}, {});
  assert.equal(m.planning.checklistAvailable, true);
  assert.equal(m.acquisitionReference.status, "unavailable");
});
module.exports = { seed };

test("exact IDs preserve corpse context, limited stock, faction and missing coverage without fabricated availability", () => {
  const s = seed(),
    w = s.profiles[0].readiness.workshop;
  w.recipes.items[0].reagents = [
    { itemId: 2320, required: 1 },
    { itemId: 2589, required: 1 },
    { itemId: 10938, required: 1 },
  ];
  const pack = loadAcquisitionPack();
  pack.rows.find((r) => r.itemId === 2320).limitedStock = true;
  let m = build(
    s,
    { recipeId: 100 },
    { acquisitionPack: pack, vendorPack: loadVendorPack() },
  );
  assert.equal(m.shoppingRows[0].acquisition.sources[0].limitedStock, true);
  assert.equal(m.shoppingRows[0].acquisition.status, "qualified-historical");
  assert.equal(
    m.shoppingRows[1].acquisition.sources[0].kind,
    "creature-corpse-loot",
  );
  assert.deepEqual(m.shoppingRows[1].acquisition.sources[0].context, ["quest"]);
  assert.equal(m.shoppingRows[2].acquisition.status, "unknown");
  assert.doesNotMatch(JSON.stringify(m.shoppingRows[2]), /shard|disenchant/i);
  s.profiles[0].faction = "Alliance";
  m = build(s, { recipeId: 100 }, { acquisitionPack: pack });
  assert.equal(m.shoppingRows[0].acquisition.status, "browse-only");
});
test("ten bounded requirements stay safe at twenty attempts, eleven cannot plan, and Auto skips a profession without eligible entries", () => {
  const s = seed(),
    w = s.profiles[0].readiness.workshop;
  w.recipes.items[0].reagents = Array.from({ length: 10 }, (_, i) => ({
    itemId: i + 1,
    required: 100000,
  }));
  let m = build(s, { recipeId: 100, crafts: 20 });
  assert.equal(m.shoppingRows.length, 10);
  assert.equal(m.shoppingRows[0].required, 2000000);
  w.recipes.items[0].reagents.push({ itemId: 11, required: 1 });
  assert.equal(build(s, { recipeId: 100 }).planning.checklistAvailable, false);
  w.professions.items.unshift({
    skillLineId: 1,
    professionId: 1,
    name: "Empty profession",
    rank: 1,
    maxRank: 75,
  });
  assert.equal(build(s).selection.skillLineId, 171);
});

test('gathering rank and method references survive absent recipes and damaged optional packs',()=>{const s=seed(),w=s.profiles[0].readiness.workshop;w.professions.items=[{skillLineId:182,professionId:2,name:'Herbalism',rank:30,maxRank:75}];w.recipes.items=[];const m=build(s);assert.equal(m.profession.rank,30);assert.equal(m.gatheringReference.rows.length,3);assert.equal(m.selectedRecipe,null);assert.doesNotThrow(()=>build(s,{}, {acquisitionPack:{rows:{}}}));});

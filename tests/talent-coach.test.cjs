"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { BUILDS, plan, coach, maxPoints } = require("../src/core/talent-coach.cjs");
// A tiny synthetic tree with row gates and a prerequisite.
const tree = { tabs: [
  { name: "Arms", talents: [
    { id: 1, name: "Improved Heroic Strike", row: 0, column: 0, maxRank: 3 }, { id: 2, name: "Deflection", row: 0, column: 1, maxRank: 5 },
    { id: 3, name: "Improved Tactical Mastery", row: 1, column: 1, maxRank: 5 }, { id: 4, name: "Anger Management", row: 2, column: 1, maxRank: 1, prerequisites: [{ talentId: 3, rank: 5 }] },
    { id: 5, name: "Improved Rend", row: 0, column: 2, maxRank: 3 }, { id: 6, name: "Deep Wounds", row: 2, column: 2, maxRank: 3, prerequisites: [{ talentId: 5, rank: 3 }] },
  ] },
  { name: "Fury", talents: [{ id: 10, name: "Cruelty", row: 0, column: 2, maxRank: 5 }] },
] };

test("points: none before 10, one per level after, 51 at 60", () => {
  assert.deepEqual([1, 9, 10, 20, 60, 70].map(maxPoints), [0, 0, 1, 11, 51, 51]);
});
test("the plan obeys row gates and prerequisites and never exceeds ranks", () => {
  const p = plan(tree, "Warrior");
  const seen = new Map(), inTree = new Map();
  for (const s of p.order) {
    const t = tree.tabs.find((x) => x.name === s.tab).talents.find((x) => x.id === s.talentId);
    assert.ok((inTree.get(s.tab) || 0) >= t.row * 5, `${s.name} row gate`);
    for (const pre of t.prerequisites || []) assert.ok((seen.get(pre.talentId) || 0) >= pre.rank, `${s.name} prerequisite`);
    seen.set(s.talentId, (seen.get(s.talentId) || 0) + 1); inTree.set(s.tab, (inTree.get(s.tab) || 0) + 1);
    assert.ok(seen.get(s.talentId) <= t.maxRank);
  }
  assert.equal(p.order[0].name, "Improved Heroic Strike");
  assert.ok(p.order.some((s) => s.name === "Deep Wounds"), "prerequisite taken first so Deep Wounds fits");
});
test("coach: what you should have and what comes next at your level", () => {
  const c = coach(tree, "Warrior", 12);
  assert.equal(c.points, 3); assert.equal(c.spentByNow.length, 3); assert.equal(c.next[0].name, "Deflection");
  assert.equal(coach(tree, "Warrior", 5).spentByNow.length, 0);
  assert.equal(coach(tree, "Bard", 30), null);
});
test("every class has a path with a reason", () => {
  for (const c of ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]) { assert.ok(BUILDS[c]?.steps.length >= 10, c); assert.ok(BUILDS[c].why.length > 20); }
});

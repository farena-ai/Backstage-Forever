"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registerSheetComparison } = require("../src/core/sheet-comparison.cjs");

const build = "1.60.1.70888";
const chest = (id, stats, extra = {}) => ({ id, name: `Item ${id}`, classId: 4, subclassId: 1, inventoryType: 5, armor: 0, requiredLevel: 10, classes: null, stats, ...extra });
const stat = (stat, amount) => ({ stat, amount });
function fixture() {
  const profile = { id: "main", clientBuild: build, className: "Paladin", level: 30, faction: "Alliance",
    source: { kind: "wow-addon", updatedAt: "2026-11-19T00:00:00.000Z" },
    gearSets: { sets: [{ name: "A", savedAt: 1, items: [{ slot: 5, itemId: 2041 }] }, { name: "B", savedAt: 2, items: [{ slot: 5, itemId: 6682 }] }] } };
  const state = { activeProfileId: "main", profiles: [profile] };
  const table = new Map([[2041, chest(2041, [stat("Strength", 10)])], [6682, chest(6682, [stat("Healing", 20)], { inventoryType: 20 })]]);
  const reads = [];
  const wished = [6682, 999];
  const gameData = { build: () => build, items(ids) { reads.push(ids); return ids.map(id => table.get(id) || null); } };
  let call;
  registerSheetComparison({ handle(name, fn) { assert.equal(name, "sheetComparison"); call = fn; }, getState: () => state, gameData, wishlist: { get: id => id === "main" ? wished : [] } });
  return { profile, state, table, reads, wished, gameData, call, pair: (role, a = 2041, b = 6682) => call("main", role, "items", a, b) };
}

test("explicit role changes the weighted lead, with auditable contributions and separate wish intent", () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const leveling = f.pair("leveling");
  assert.equal(leveling.delta, -6);
  assert.deepEqual(leveling.rows, [{ stat: "Strength", weight: 1, a: 10, b: 0, points: -10 }, { stat: "Healing", weight: 0.2, a: 0, b: 20, points: 4 }]);
  const healer = f.pair("healer");
  assert.equal(healer.delta, 10);
  assert.equal(healer.options[1].pieces[0].wished, true);
  assert.equal(healer.options[0].pieces[0].wished, false);
  f.wished.length = 0;
  assert.equal(f.pair("healer").delta, 10);
  assert.deepEqual(f.state, before);
});

test("catalog joins exact reviewed 2D IDs for the active character only", () => {
  const f = fixture();
  const catalog = f.call("main");
  assert.deepEqual(catalog.leads.map(l => [l.itemId, l.kind]), [[2041, "quest"], [6682, "dungeon"]]);
  assert.deepEqual(catalog.wished, [6682, 999]);
  assert.throws(() => f.call("alt"), /active character changed/);
});

test("malformed or wrong-build comparisons never read installed item rows", () => {
  const f = fixture();
  for (const args of [["main", "healer", "items", "2041", 6682], ["main", "healer", "items", 0, 6682],
    ["main", "healer", "items", 2041, 2147483648], ["main", "healer", "items", 2041, 2041],
    ["main", "constructor", "items", 2041, 6682], ["main", ["healer"], "items", 2041, 6682],
    ["main", "healer", "sets", "A", "Other character's set"], ["main", "healer"]]) assert.throws(() => f.call(...args));
  f.profile.clientBuild = "1.60.2.70862";
  assert.match(f.pair("leveling").reason, /installed WoW Forever game on the same patch/);
  assert.deepEqual(f.reads, []);
});

test("missing or blocked equipment never becomes a ranked zero", () => {
  const f = fixture();
  for (const [it, message] of [[chest(42, []), /Exact item data unavailable/], [chest(6682, null), /Base stat data unavailable/],
    [chest(6682, [stat("Stat 423", 14)]), /Unscored base stat/], [chest(6682, [], { inventoryType: 0 }), /Not scoreable equipment/],
    [chest(6682, [], { requiredLevel: 40 }), /Requires level 40/]]) {
    f.table.set(6682, it);
    const model = f.pair("leveling");
    assert.equal(model.delta, null);
    assert.equal(model.options[1].score, null);
    assert.match(model.options[1].issues.join(" "), message);
  }
});

test("saved sets compare recorded combat slots without filling from worn gear", () => {
  const f = fixture();
  assert.equal(f.call("main", "healer", "sets", "A", "B").delta, 10);
  f.profile.gearSets.sets[0].items.unshift({ slot: 4, itemId: 26 });
  assert.equal(f.call("main", "healer", "sets", "A", "B").delta, 10);
  f.table.set(99, chest(99, [stat("Strength", 2)], { inventoryType: 1 }));
  f.profile.gearSets.sets[0].items.unshift({ slot: 1, itemId: 99 });
  const comparison = f.call("main", "healer", "sets", "A", "B");
  assert.equal(comparison.sameCoverage, false);
  assert.equal(comparison.delta, null);
  assert.equal(comparison.options[0].score, 12);
});

function hands(className, level, mainType, offType, offExtra = {}) {
  const f = fixture();
  Object.assign(f.profile, { className, level });
  for (const [index, set] of f.profile.gearSets.sets.entries()) {
    const main = 101 + 2 * index, off = main + 1;
    const weapon = (id, inventoryType) => ({ id, classId: 2, name: `Weapon ${id}`, subclassId: inventoryType === 17 ? 8 : 7,
      inventoryType, requiredLevel: 1, classes: null, stats: [], dps: id - 100 });
    f.table.set(main, weapon(main, mainType));
    set.items = [{ slot: 16, itemId: main }];
    if (offType !== null) {
      f.table.set(off, { ...weapon(off, offType), ...offExtra });
      set.items.push({ slot: 17, itemId: off });
    }
  }
  return { ...f, compare: () => f.call("main", "leveling", "sets", "A", "B") };
}

test("saved Rogue sets score exact one-handed weapons in either recorded hand", () => {
  const model = hands("Rogue", 30, 13, 13).compare();
  assert.equal(model.sameCoverage, true);
  assert.deepEqual(model.options.map(o => [o.issues, o.score]), [[[], 18], [[], 42]]);
  assert.equal(model.delta, 24);
  assert.deepEqual(model.rows, [{ stat: "Melee DPS", weight: 6, a: 3, b: 7, points: 24 }]);
  assert.equal(model.options[0].pieces[1].slot, "Off hand");
});

test("saved Warrior sets never rank a two-hander recorded in the off hand", () => {
  const f = hands("Warrior", 30, 13, 17);
  const model = f.compare();
  assert.equal(model.sameCoverage, true);
  assert.equal(model.delta, null);
  for (const [i, option] of model.options.entries()) {
    assert.equal(option.score, null);
    assert.match(option.issues.join(" "), new RegExp(`#${102 + 2 * i}: Not scoreable equipment for this slot`));
  }
  assert.equal(f.pair("leveling", 101, 102).delta, 6, "standalone two-hander remains scoreable");
});

test("saved ordinary offhand weapons require modeled dual-wield eligibility", () => {
  for (const [cls, level, blocker] of [["Warrior", 19, /Warriors cannot dual wield yet/], ["Paladin", 40, /Paladins cannot dual wield/],
    ["Shaman", 40, /Shamans cannot dual wield/]]) {
    const model = hands(cls, level, 13, 13, cls === "Shaman" ? { subclassId: 4 } : {}).compare();
    assert.equal(model.delta, null);
    assert.match(model.options[0].issues.join(" "), blocker);
  }
  assert.equal(hands("Warrior", 20, 13, 13).compare().delta, 24);
  assert.match(hands("Warrior", undefined, 13, 13).compare().reason, /class or level is unavailable/);
  assert.match(hands("Unknown", 30, 13, 13).compare().reason, /class or level is unavailable/);
});

test("saved hand compatibility distinguishes main-only, offhand-only, held items, and two-hand occupancy", () => {
  for (const [mainType, offType, extra, issue] of [
    [13, 21, {}, /Not scoreable equipment for this slot/],
    [22, null, {}, /Not scoreable equipment for this slot/],
    [17, 22, {}, /two-handed weapon and an off-hand item/],
    [17, 14, { classId: 4, subclassId: 6, armor: 10 }, /two-handed weapon and an off-hand item/],
    [17, 23, { classId: 4, subclassId: 0, armor: 0 }, /two-handed weapon and an off-hand item/],
  ]) {
    const model = hands("Warrior", 30, mainType, offType, extra).compare();
    assert.equal(model.delta, null);
    assert.match(model.options[0].issues.join(" "), issue);
  }
  assert.equal(hands("Warrior", 30, 17, null).compare().delta, 12);
  assert.equal(hands("Rogue", 30, 21, 22).compare().delta, 24);
  assert.equal(hands("Paladin", 30, 21, 14, { classId: 4, subclassId: 6, armor: 10 }).compare().delta, 12);
  assert.equal(hands("Paladin", 30, 21, 23, { classId: 4, subclassId: 0, armor: 0 }).compare().delta, 12);
  const incomplete = hands("Warrior", 30, 13, 13);
  incomplete.table.delete(102);
  assert.equal(incomplete.compare().delta, null);
  assert.match(incomplete.compare().options[0].issues.join(" "), /#102: Exact item data unavailable/);
});

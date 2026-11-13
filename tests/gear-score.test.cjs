"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreItem, compare, bestReward, blockers, WEIGHTS } = require("../src/core/gear-score.cjs");

// Shapes as game-data.cjs item() returns them.
const armor = (id, name, inventoryType, subclassId, armorValue, stats, extra = {}) => ({
  id, name, quality: 2, itemLevel: 25, requiredLevel: 20, classId: 4, subclassId, inventoryType, slot: null,
  kind: { 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield" }[subclassId] || "Miscellaneous",
  armor: armorValue, stats: Object.entries(stats).map(([stat, amount]) => ({ stat, amount })), damage: null, speed: null, dps: null,
  sellPrice: 1000, bonding: null, classes: null, iconFileId: 1, ...extra,
});
const weapon = (id, name, inventoryType, subclassId, dps, stats, extra = {}) => ({
  ...armor(id, name, inventoryType, 0, null, stats), classId: 2, subclassId, kind: "Weapon", requiredLevel: 5, dps, speed: 2.5, damage: { min: 1, max: 2 }, ...extra,
});

const agilityMail = armor(1, "Chain Vest", 5, 3, 210, { Agility: 6, Stamina: 3 });
const strengthPlate = armor(2, "Plated Chest", 5, 4, 380, { Strength: 7, Stamina: 4 });
const intCloth = armor(3, "Robe of Insight", 20, 1, 45, { Intellect: 6, Spirit: 3 });
const strMail = armor(4, "Warrior's Chain", 5, 3, 210, { Strength: 6, Stamina: 3 });
const heavySpikedMace = weapon(4778, "Heavy Spiked Mace", 17, 5, 12.5, { Strength: 6 });
const compactHammer = weapon(1009, "Compact Hammer", 21, 4, 7.0, { Stamina: 1 });
const buckler = armor(5, "Buckler", 14, 6, 300, { Stamina: 2 });

test("hunters prefer Agility mail over Strength plate (and wear mail only from level 40)", () => {
  const hunter40 = { className: "Hunter", level: 40 };
  assert.deepEqual(blockers(strengthPlate, hunter40), ["Hunters cannot wear plate"]);
  const pick = bestReward([strengthPlate, agilityMail], hunter40, {});
  assert.equal(pick.itemId, agilityMail.id);
  assert.equal(pick.upgrade, true);
  assert.ok(pick.reasons.includes("+6 Agility"));
  assert.deepEqual(blockers(agilityMail, { className: "Hunter", level: 30 }), ["Hunters can wear mail from level 40"]);
  // Warriors may wear either; at 40 Strength plate beats Agility mail.
  assert.equal(bestReward([agilityMail, strengthPlate], { className: "Warrior", level: 40 }, {}).itemId, strengthPlate.id);
  assert.equal(bestReward([agilityMail, strMail, strengthPlate], { className: "Warrior", level: 30 }, {}).itemId, strMail.id, "plate waits for level 40");
});

test("casters prefer Intellect cloth", () => {
  for (const className of ["Mage", "Priest", "Warlock"]) {
    const pick = bestReward([strengthPlate, agilityMail, intCloth], { className, level: 25 }, {});
    assert.equal(pick.itemId, intCloth.id, className);
    assert.ok(pick.reasons.includes("+6 Intellect"));
  }
});

test("warriors prefer a stronger two-hander over a one-hander plus shield", () => {
  const ctx = { className: "Warrior", level: 20 };
  const vsOneHander = compare(heavySpikedMace, [compactHammer], ctx);
  assert.equal(vsOneHander.better, true);
  assert.deepEqual(vsOneHander.reasons, ["+5.5 DPS", "+6 Strength", "-1 Stamina"]);
  // The two-hander replaces both hands, so the shield's value is counted against it.
  const pick = bestReward([compactHammer, heavySpikedMace], ctx, { 16: compactHammer, 17: buckler });
  assert.equal(pick.itemId, heavySpikedMace.id);
  assert.ok(pick.reasons.includes("-300 armor"));
  // Priests cannot learn two-handed maces at all.
  assert.deepEqual(compare(heavySpikedMace, [compactHammer], { className: "Priest", level: 20 }), { better: false, delta: 0, reasons: ["Priests cannot use weapons"] });
});

test("compare explains upgrades, downgrades and empty slots", () => {
  const ctx = { className: "Rogue", level: 20 };
  const gloves = armor(5299, "Gloves of the Moon", 10, 2, 48, { Stamina: 3, Agility: 3 });
  const worse = armor(6, "Old Gloves", 10, 2, 30, { Agility: 1 });
  assert.deepEqual(compare(gloves, worse, ctx), { better: true, delta: 3.38, reasons: ["+2 Agility", "+3 Stamina", "+18 armor"] });
  assert.equal(compare(worse, gloves, ctx).better, false);
  assert.equal(compare(gloves, null, ctx).reasons[0], "Fills an empty slot");
  assert.equal(compare(gloves, null, { ...ctx, equipmentKnown: false }).reasons.includes("Fills an empty slot"), false);
  assert.deepEqual(compare(gloves, gloves, ctx), { better: false, delta: 0, reasons: [] });
  assert.ok(compare(gloves, { id: 9, unknown: true, stats: [], armor: 0 }, ctx).reasons[0].startsWith("Compared without"));
});

test("bestReward compares rings against the weaker ring and falls back to vendor value", () => {
  const ctx = { className: "Mage", level: 25 };
  const ring = (id, int, sell = 100) => armor(id, `Ring ${id}`, 11, 0, 0, { Intellect: int }, { sellPrice: sell });
  const pick = bestReward([ring(10, 3)], ctx, { 11: ring(11, 5), 12: ring(12, 1) });
  assert.equal(pick.upgrade, true);
  assert.deepEqual(pick.reasons, ["+2 Intellect"]);
  const none = bestReward([{ itemId: 2, details: { ...strengthPlate, sellPrice: 50 } }, { itemId: 1, details: { ...agilityMail, sellPrice: 90 } }], ctx, {});
  assert.equal(none.itemId, agilityMail.id);
  assert.equal(none.index, 1);
  assert.equal(none.upgrade, false);
  assert.match(none.reasons[0], /sells for the most/);
  assert.equal(bestReward([], ctx, {}), null);
  assert.equal(bestReward([{ itemId: 3, count: 1 }], ctx, {}), null, "rewards without game facts are not judged");
  const noUpgrade = bestReward([ring(13, 1)], ctx, { 11: ring(11, 5), 12: ring(12, 4) });
  assert.equal(noUpgrade.upgrade, false);
  assert.match(noUpgrade.reasons[0], /No upgrade/);
});

test("usability rules: level, class lists, shields, wands, dual wield", () => {
  assert.deepEqual(blockers({ ...intCloth, requiredLevel: 30 }, { className: "Mage", level: 25 }), ["Requires level 30"]);
  assert.deepEqual(blockers({ ...intCloth, classes: ["Priest"] }, { className: "Mage", level: 25 }), ["Mages cannot use it"]);
  assert.deepEqual(blockers(buckler, { className: "Rogue", level: 25 }), ["Rogues cannot use shields"]);
  assert.equal(blockers(buckler, { className: "Shaman", level: 25 }).length, 0);
  const wand = weapon(7, "Wand", 26, 19, 9, {});
  assert.equal(blockers(wand, { className: "Priest", level: 10 }).length, 0);
  assert.equal(blockers(wand, { className: "Warrior", level: 10 }).length, 1);
  const offhand = weapon(8, "Off-hand Sword", 22, 7, 8, {});
  assert.deepEqual(blockers(offhand, { className: "Warrior", level: 10 }), ["Warriors cannot dual wield yet"]);
  assert.equal(blockers(offhand, { className: "Warrior", level: 20 }).length, 0);
  assert.equal(blockers(offhand, { className: "Rogue", level: 10 }).length, 0);
  // Cloaks are cloth but everyone wears them.
  assert.equal(blockers(armor(9, "Cloak", 16, 1, 10, {}), { className: "Warrior", level: 25 }).length, 0);
  // Wand DPS is what casters level with.
  assert.ok(scoreItem(wand, { className: "Priest", level: 10 }).score > scoreItem(wand, { className: "Warrior", level: 10 }).score);
  assert.ok(Object.keys(WEIGHTS).length === 9);
});

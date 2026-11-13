"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { gearReview } = require("../src/core/character-guidance-ipc.cjs");
test("gear review rates each slot against your level and lists the weakest first", () => {
  const model = { gear: { rows: [{ itemId: 1, slot: 5, slotLabel: "Chest" }, { itemId: 2, slot: 16, slotLabel: "Main hand" }, { itemId: 3, slot: 4, slotLabel: "Body" }] } };
  const items = { 1: { name: "Old Vest", slot: "Chest", itemLevel: 8, armor: 40, stats: [] }, 2: { name: "Fine Axe", slot: "Two-Hand", itemLevel: 19, dps: 9, damage: { min: 10, max: 20 }, stats: [{ stat: "Strength", amount: 3 }] }, 3: { name: "Shirt", slot: "Shirt", itemLevel: 1, stats: [] } };
  gearReview(model, { level: 20, className: "Warrior" }, { items: (ids) => ids.map((id) => items[id] || null) });
  const [chest, axe] = model.gear.rows;
  assert.equal(chest.rating, "replace"); assert.equal(axe.rating, "fresh");
  assert.deepEqual(model.gear.weakest.map((w) => w.name), ["Old Vest"], "shirts are never 'weak'");
  const untouched = { gear: { rows: [{ itemId: 1 }] } };
  gearReview(untouched, { level: 20 }, null);
  assert.equal(untouched.gear.weakest, undefined, "no game data, no change");
});

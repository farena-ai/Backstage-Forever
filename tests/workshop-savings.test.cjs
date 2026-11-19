"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { shoppingList } = require("../src/core/profession-skillup.cjs");

const NOW = 1760000000;
const profile = { id: "a", source: { kind: "wow-addon", updatedAt: new Date(NOW * 1000).toISOString() }, clientBuild: "1.60.1.70862",
  ledger: { prices: [{ id: 1, hist: [[5010, NOW - 1]] }, { id: 2, hist: [[999, NOW + 1]] }], bank: { seenAt: NOW, complete: true, items: [{ id: 1, n: 50 }] } } };
const herb = { itemId: 1, required: 3, have: 1, missing: 2, quantityKind: "exact" };
const vial = { itemId: 2, required: 1, have: 1, missing: 0, quantityKind: "exact" };
const batch = rows => shoppingList(rows, { crafts: 3, profile, profiles: [profile], now: NOW }).batchPurchaseEstimate;

test("batch savings use only the saved carried shortfall, not storage or prices for covered rows", () => {
  assert.equal(batch([herb, vial]), 10020);
});

test("any unknown quantity or missing dated buyout makes the full estimate unknown", () => {
  assert.equal(batch([herb, { ...vial, have: 0, missing: 1 }]), null);
  assert.equal(batch([herb, { ...vial, quantityKind: "lower-bound", missing: null }]), null);
  assert.equal(batch([]), null);
});

test("a covered batch has a zero purchase estimate", () => {
  assert.equal(batch([vial]), 0);
});
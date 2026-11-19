"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { shoppingList } = require("../src/core/profession-skillup.cjs");
const at = 1700000000;
const source = { kind: "wow-addon", updatedAt: new Date(at * 1000).toISOString() };
const place = (n, seenAt, complete = true) => ({ items: [{ id: 2589, n }], seenAt, complete });
const me = { id: "a", name: "Alpha", source, clientBuild: "1.60.1.70862", ledger: { bags: place(4, at), bank: place(10, at - 300), mail: place(10, at - 500, false) } };
const alt = { ...me, id: "b", name: "Beta", ledger: { bags: place(3, at - 20), mail: place(5, at - 50) } };
const row = { itemId: 2589, name: "Linen Cloth", required: 40, have: 4, missing: 36, quantityKind: "exact" };
const opts = { crafts: 20, profile: me, profiles: [me, alt], now: at + 60 };

test("overlapping last-seen stock is separated by location and never offsets the buy-all-shortfall projection", () => {
  const [r] = shoppingList([row], opts).rows;
  assert.equal(r.projectedPurchase, 36);
  assert.deepEqual(r.ownStorage.map(x => [x.place, x.count, x.seenAt, x.complete]), [["bank", 10, at - 300, true], ["mail", 10, at - 500, false]]);
  assert.deepEqual(r.altStock.map(x => [x.profileId, x.place, x.count]), [["b", "bags", 3], ["b", "mail", 5]]);
});

test("unknown carried supply has no purchase projection; observed zero is not unknown", () => {
  const [unknown, empty] = shoppingList([{ ...row, have: null, missing: null, quantityKind: "unknown" }, { ...row, have: 0, missing: 40 }], opts).rows;
  assert.equal(unknown.projectedPurchase, null);
  assert.equal(unknown.need, null);
  assert.equal(empty.projectedPurchase, 40);
});

test("cost is based only on dated, own, exact-item AH memory and never asserts supply", () => {
  const profile = { ...me, ledger: { ...me.ledger, prices: [{ id: 2589, hist: [[1, at + 1], [25, at - 60], [20, 0]] }] } };
  const [known, unknown, covered] = shoppingList([row, { ...row, itemId: 2590 }, { ...row, have: 40, missing: 0 }], { ...opts, profile, profiles: [profile, { ...alt, ledger: { prices: [{ id: 2590, hist: [[2, at]] }] } }] }).rows;
  assert.deepEqual(known.price, { source: "saved-auction-buyout", unitCopper: 25, seenAt: at - 60, ageSeconds: 120 });
  assert.equal(known.estimatedCopper, 900);
  assert.equal(unknown.estimatedCopper, null);
  assert.equal(covered.estimatedCopper, 0);
});

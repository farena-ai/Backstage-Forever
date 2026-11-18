"use strict";
// J30 (1.6): the profession shopping list knows what you already stored, on any character.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { shoppingList, elsewhereOf } = require("../src/core/profession-skillup.cjs");
const me = { id: "a", name: "Alpha", ledger: { bags: { items: [{ id: 2589, n: 4 }] }, bank: { items: [{ id: 2589, n: 10 }] } } };
const alt = { id: "b", name: "Beta", ledger: { bags: { items: [{ id: 2589, n: 3 }] }, mail: { items: [{ id: 2589, n: 5 }] } } };

test("elsewhere: your bank and mail first (bags are already counted), then other characters", () => {
  const e = elsewhereOf(2589, me, [alt, me]);
  assert.deepEqual(e.map((x) => [x.name, x.bags, x.bank, x.mail]), [["Alpha", 0, 10, 0], ["Beta", 3, 0, 5]]);
  assert.deepEqual(elsewhereOf(999, me, [me, alt]), []);
});

test("each shopping row says what is stored and what is still to get", () => {
  const list = shoppingList([{ itemId: 2589, name: "Linen Cloth", required: 40, have: 4, missing: 36, quantityKind: "exact" }], { crafts: 20, profile: me, profiles: [me, alt] });
  const r = list.rows[0];
  assert.equal(r.elsewhere.reduce((t, e) => t + e.total, 0), 18);
  assert.equal(r.stillToGet, 18);
  const page = fs.readFileSync(path.join(__dirname, "../src/renderer/preparation.js"), "utf8");
  assert.match(page, /Already stored:/);
  assert.match(page, /still to get/);
});

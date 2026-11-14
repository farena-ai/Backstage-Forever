"use strict";
// Ledger (0.35): validation of the addon block, the cross-character inventory, gold, price
// memory, cooldowns and reputations, and that none of it leaves the computer.
const test = require("node:test"), assert = require("node:assert/strict");
const L = require("../src/core/ledger.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
const T = 1763000000;
const ledger = (over = {}) => ({
  schemaVersion: 1, money: 1234567, moneyAt: T,
  bags: { seenAt: T, complete: true, items: [{ id: 2589, n: 25, q: 1, name: "Linen Cloth" }, { id: 118, n: 3, q: 1, name: "Minor Healing Potion" }] },
  bank: { seenAt: T - 86400, complete: true, items: [{ id: 2589, n: 10, q: 1, name: "Linen Cloth" }, { id: 2592, n: 40, q: 1 }] },
  mail: { seenAt: T - 3600, complete: true, letters: 2, money: 5000, expiresAt: T + 86400 * 3, items: [{ id: 2770, n: 8, q: 1, name: "Copper Ore" }] },
  reputations: { seenAt: T, factions: [{ id: 72, name: "Stormwind", standing: 6, min: 9000, max: 21000, value: 12000 }, { id: 76, name: "Orgrimmar", standing: 4, min: 0, max: 3000, value: 1500 }, { id: 576, name: "Timbermaw Hold", standing: 2, min: -6000, max: -3000, value: -4500 }] },
  cooldowns: [{ key: "transmute", spellId: 17187, readyAt: T + 7200 }, { key: "mooncloth", spellId: 18560, readyAt: T - 5 }],
  prices: [{ id: 2589, name: "Linen Cloth", q: 1, hist: [[80, T - 100], [60, T - 86400 * 2]] }, { id: 2770, name: "Copper Ore", hist: [[150, T - 3600]] }],
  pricesOn: true,
  ...over,
});
const profile = (id, faction, l) => ({ id, name: id, realm: "Synthetic", className: "Mage", level: 30, faction, notes: "", goals: [], ledger: l });

test("the addon block is validated strictly, bounded, and empty Lua tables read as empty lists", () => {
  const n = L.normalizeLedgerCapture(ledger({ unknown: "dropped", bags: { seenAt: T, items: {} } }));
  assert.equal(n.unknown, undefined);
  assert.deepEqual(n.bags.items, []);
  assert.deepEqual(L.normalizeLedgerCapture(n), n, "normalizing twice changes nothing");
  assert.deepEqual(L.normalizeLedgerCapture({ cooldowns: {}, prices: {} }), { schemaVersion: 1, cooldowns: [], prices: [] });
  for (const bad of [
    { schemaVersion: 2 },
    { money: -1 },
    { money: 1.5 },
    { bags: { seenAt: T, items: [{ id: 1, n: 0 }] } },
    { bags: { seenAt: T, items: [{ id: 1, n: 1 }, { id: 1, n: 2 }] } },
    { bags: { seenAt: T, items: Array.from({ length: 401 }, (_, i) => ({ id: i + 1, n: 1 })) } },
    { bags: { seenAt: T, items: [{ id: 1, n: 1, name: "bad\nname" }] } },
    { reputations: { seenAt: T, factions: [{ id: 72, name: "Stormwind", standing: 9, min: 0, max: 1, value: 0 }] } },
    { reputations: { seenAt: T, factions: [{ id: 72, name: "Stormwind", standing: 4, min: 5, max: 5, value: 5 }] } },
    { cooldowns: [{ key: "something-else", readyAt: T }] },
    { prices: [{ id: 5, hist: [] }] },
    { prices: [{ id: 5, hist: [[0, T]] }] },
    { prices: [{ id: 5, hist: Array.from({ length: 6 }, () => [1, T]) }] },
    { prices: Array.from({ length: 1501 }, (_, i) => ({ id: i + 1, hist: [[1, T]] })) },
  ]) assert.throws(() => L.normalizeLedgerCapture(ledger(bad)), JSON.stringify(bad).slice(0, 80));
});

test("a saved export carries the ledger into the profile; an invalid ledger is dropped, the character kept", () => {
  const raw = (l) => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: T, activeId: "Player-1", characters: [{ id: "Player-1", name: "Aeralyn", realm: "Synthetic", className: "Mage", level: 30, updatedAt: T, faction: "Alliance", ledger: l }] }));
  const parsed = parseSavedVariables(raw(ledger()));
  assert.equal(parsed.characters[0].ledger.money, 1234567);
  const state = mergeSnapshot(defaultState(), parsed);
  assert.equal(state.profiles[0].ledger.bank.items.length, 2);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  const bad = parseSavedVariables(raw(ledger({ money: "lots" })));
  assert.equal(bad.characters[0].ledger, undefined);
  assert.equal(bad.characters[0].name, "Aeralyn");
  const stored = structuredClone(state);
  stored.profiles[0].ledger.money = -5;
  assert.throws(() => validateState(stored));
  // A manual character cannot gain captured ledger data from a renderer form.
  const { mergeOrdinaryState } = require("../src/core/company-ipc.cjs");
  const manual = { ...defaultState(), profiles: [profile("Manual", "Horde", undefined)], activeProfileId: "Manual" };
  delete manual.profiles[0].ledger;
  const edited = structuredClone(manual); edited.profiles[0].ledger = L.normalizeLedgerCapture(ledger());
  assert.throws(() => mergeOrdinaryState(manual, edited, manual), /Captured game data/);
});

test("inventory across characters counts bags, bank and mail per character, and search matches every word", () => {
  const profiles = [profile("Aeralyn", "Alliance", L.normalizeLedgerCapture(ledger())), profile("Vaelric", "Horde", L.normalizeLedgerCapture(ledger({ bank: undefined, mail: undefined, bags: { seenAt: T, items: [{ id: 2589, n: 7, q: 1, name: "Linen Cloth" }] } }))), profile("Nobody", "Horde", undefined)];
  const facts = new Map([[2592, { name: "Wool Cloth", quality: 1 }]]);
  const rows = L.inventoryIndex(profiles, facts);
  const linen = rows.find((r) => r.itemId === 2589);
  assert.equal(linen.total, 42);
  assert.deepEqual(linen.holders.map((h) => [h.name, h.bags, h.bank, h.mail]), [["Aeralyn", 25, 10, 0], ["Vaelric", 7, 0, 0]]);
  assert.equal(linen.holders[1].bankSeenAt, null, "a bank never opened stays unknown");
  assert.equal(rows.find((r) => r.itemId === 2592).name, "Wool Cloth", "names come from the game facts when the capture has none");
  assert.deepEqual(L.searchInventory(rows, "cloth").map((r) => r.name), ["Linen Cloth", "Wool Cloth"]);
  assert.deepEqual(L.searchInventory(rows, "LINEN clo").map((r) => r.itemId), [2589]);
  assert.deepEqual(L.searchInventory(rows, "2770").map((r) => r.name), ["Copper Ore"]);
  assert.equal(L.searchInventory(rows, "nothing like this").length, 0);
  assert.deepEqual(L.itemIds(profiles), [118, 2589, 2592, 2770]);
});

test("gold totals, price memory across characters, inventory value and price lookup age", () => {
  const a = profile("Aeralyn", "Alliance", L.normalizeLedgerCapture(ledger()));
  const b = profile("Vaelric", "Horde", L.normalizeLedgerCapture(ledger({ money: 2000000, prices: [{ id: 2589, hist: [[95, T - 10]] }] })));
  const c = profile("Nogold", "Horde", L.normalizeLedgerCapture({ cooldowns: [], prices: [] }));
  const gold = L.goldTotals([a, b, c]);
  assert.equal(gold.total, 3234567);
  assert.deepEqual(gold.characters.map((x) => x.name), ["Vaelric", "Aeralyn"]);
  const index = L.priceIndex([a, b]);
  const linen = L.priceFor(index, 2589, T);
  assert.deepEqual(linen, { itemId: 2589, latest: 95, latestAt: T - 10, low: 60, lowAt: T - 86400 * 2, age: 10, observations: 3 });
  assert.equal(L.priceFor(index, 999, T), null);
  const value = L.inventoryValue(L.inventoryIndex([a, b]), index);
  assert.deepEqual(value.items.map((v) => [v.itemId, v.count, v.unit, v.value]), [[2589, 70, 95, 6650], [2770, 16, 150, 2400]]);
  assert.equal(value.total, 9050);
});

test("cooldowns read ready or ready in so long; reputations name standings for Alliance and Horde alike", () => {
  const a = profile("Aeralyn", "Alliance", L.normalizeLedgerCapture(ledger()));
  const cd = L.cooldownStatus(a, T);
  assert.deepEqual(cd.map((c) => [c.key, c.name, c.profession, c.ready, c.seconds]), [["mooncloth", "Mooncloth", "Tailoring", true, 0], ["transmute", "Transmute", "Alchemy", false, 7200]]);
  const rep = L.reputationView(a);
  assert.deepEqual(rep.factions.map((f) => [f.name, f.standingName, f.side]), [["Stormwind", "Honored", "Alliance"], ["Timbermaw Hold", "Hostile", null], ["Orgrimmar", "Neutral", "Horde"]]);
  assert.equal(rep.factions[0].current, 3000); assert.equal(rep.factions[0].need, 12000);
  assert.equal(rep.factions[1].current, 1500, "negative bars count from their own minimum");
  const h = L.reputationView({ ...a, faction: "Horde" });
  assert.equal(h.factions[0].name, "Orgrimmar", "a Horde character sees Horde factions first");
  assert.equal(L.reputationView(profile("x", "Horde", undefined)), null);
  const view = L.ledgerView({ activeProfileId: "Aeralyn", profiles: [a, profile("Manual", "Horde", undefined)] }, { now: T });
  assert.equal(view.characters.length, 2);
  assert.equal(view.characters[1].hasLedger, false);
  assert.equal(view.gold.total, 1234567);
  assert.equal(view.prices[0].itemId, 2589);
  assert.equal(view.characters[0].mail.letters, 2);
});

test("the ledger never leaves the computer: not in community observations or the AI profile", () => {
  const p = { ...profile("Aeralyn", "Alliance", L.normalizeLedgerCapture(ledger())), source: { kind: "wow-addon", id: "Player-1", updatedAt: new Date(T * 1000).toISOString() } };
  const obs = require("../src/core/community.cjs").collectObservations([p]);
  assert.doesNotMatch(JSON.stringify(obs), /Linen|1234567|Stormwind|17187|2589/);
  const approved = require("../src/core/providers.cjs").approvedProfile(p);
  assert.equal(approved.ledger, undefined);
  assert.doesNotMatch(JSON.stringify(approved), /Linen|1234567|Stormwind/);
  const fs = require("node:fs"), path = require("node:path");
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../src/core/community.cjs"), "utf8"), /ledger/);
});

"use strict";
// Character sheet, gear sets and gold goal (0.36): validation of the addon blocks, sync into the
// profile, the paper-doll view with where every set piece is, and the gold goal estimate.
const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../src/core/sheet.cjs");
const G = require("../src/core/gold-goal.cjs");
const L = require("../src/core/ledger.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
const T = 1763000000, DAY = 86400;
const stats = (over = {}) => ({ schemaVersion: 1, seenAt: T, strength: 52, agility: 31, stamina: 47, intellect: 120, spirit: 98, armor: 612, attackPower: 70, rangedAttackPower: 20, resist: { fire: 15, holy: 0 }, health: 980, power: 1450, powerKind: "mana", ...over });
const sets = (over = {}) => ({ schemaVersion: 1, sets: [
  { name: "Dungeon", savedAt: T - 100, items: [{ slot: 1, itemId: 1002, name: "Dungeon Helm" }, { slot: 16, itemId: 3001 }, { slot: 8, itemId: 5001, name: "Bank Boots" }, { slot: 13, itemId: 6001 }, { slot: 14, itemId: 7001 }] },
  { name: "Leveling", savedAt: T - 50, items: [{ slot: 1, itemId: 1001 }] },
], ...over });

test("stats and gear sets are validated strictly and bounded; empty Lua tables read as empty lists", () => {
  assert.deepEqual(S.normalizeStatsCapture(stats()), stats());
  assert.deepEqual(S.normalizeGearSetsCapture({ sets: {} }), { schemaVersion: 1, sets: [] });
  const n = S.normalizeGearSetsCapture(sets());
  assert.deepEqual(n.sets[0].items.map((i) => i.slot), [1, 8, 13, 14, 16], "items sorted by slot");
  assert.deepEqual(S.normalizeGearSetsCapture(n), n);
  for (const bad of [{ schemaVersion: 2 }, { strength: -1 }, { armor: 1.5 }, { resist: { fire: 5, light: 1 } }, { powerKind: "runic" }, { seenAt: undefined }, { surprise: 1 }])
    assert.throws(() => S.normalizeStatsCapture(stats(bad)), JSON.stringify(bad));
  const set = (s) => ({ schemaVersion: 1, sets: [s] });
  for (const bad of [
    set({ name: "", savedAt: T, items: [{ slot: 1, itemId: 1 }] }),
    set({ name: "x".repeat(25), savedAt: T, items: [{ slot: 1, itemId: 1 }] }),
    set({ name: "bad|name", savedAt: T, items: [{ slot: 1, itemId: 1 }] }),
    set({ name: "ok", savedAt: T, items: [] }),
    set({ name: "ok", savedAt: T, items: [{ slot: 20, itemId: 1 }] }),
    set({ name: "ok", savedAt: T, items: [{ slot: 1, itemId: 1 }, { slot: 1, itemId: 2 }] }),
    { sets: [{ name: "A", savedAt: T, items: [{ slot: 1, itemId: 1 }] }, { name: "a", savedAt: T, items: [{ slot: 1, itemId: 1 }] }] },
    { sets: Array.from({ length: 21 }, (_, i) => ({ name: "s" + i, savedAt: T, items: [{ slot: 1, itemId: 1 }] })) },
  ]) assert.throws(() => S.normalizeGearSetsCapture(bad), JSON.stringify(bad).slice(0, 80));
});

test("the ledger accepts the daily gold log oldest first, and nothing else", () => {
  assert.deepEqual(L.normalizeLedgerCapture({ moneyLog: [[100, T - DAY], [150, T]] }).moneyLog, [[100, T - DAY], [150, T]]);
  assert.deepEqual(L.normalizeLedgerCapture({ moneyLog: {} }).moneyLog, []);
  for (const bad of [[[100, T], [90, T - 1]], [[100, T], [100, T]], [[-1, T]], [[1, 2, 3]], Array.from({ length: 31 }, (_, i) => [1, T + i])])
    assert.throws(() => L.normalizeLedgerCapture({ moneyLog: bad }), JSON.stringify(bad).slice(0, 60));
});

test("a saved export carries stats and sets into the profile; invalid blocks are dropped, the character kept", () => {
  const raw = (over) => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: T, activeId: "Player-1", characters: [{ id: "Player-1", name: "Aeralyn", realm: "Synthetic", className: "Mage", level: 30, updatedAt: T, faction: "Alliance", stats: stats(), gearSets: sets(), ...over }] }));
  const state = mergeSnapshot(defaultState(), parseSavedVariables(raw({})));
  assert.equal(state.profiles[0].stats.intellect, 120);
  assert.equal(state.profiles[0].gearSets.sets.length, 2);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  const bad = parseSavedVariables(raw({ stats: { seenAt: "now" }, gearSets: { sets: [{ name: "" }] } })).characters[0];
  assert.equal(bad.stats, undefined); assert.equal(bad.gearSets, undefined); assert.equal(bad.name, "Aeralyn");
  // A newer save without sets clears them (deleted in game).
  const next = mergeSnapshot(state, parseSavedVariables(raw({ updatedAt: T + 5, gearSets: undefined })));
  assert.equal(next.profiles[0].gearSets, undefined);
  const stored = structuredClone(state); stored.profiles[0].stats.strength = -1;
  assert.throws(() => validateState(stored));
  // A manual character cannot gain captured sheet data from a renderer form.
  const { mergeOrdinaryState } = require("../src/core/company-ipc.cjs");
  const manual = validateState({ ...defaultState(), onboarded: true, profiles: [{ id: "m", name: "Manual", realm: "", className: "Mage", level: 5, notes: "", goals: [] }], activeProfileId: "m" });
  for (const key of ["stats", "gearSets"]) {
    const edited = structuredClone(manual); edited.profiles[0][key] = key === "stats" ? stats() : sets();
    assert.throws(() => mergeOrdinaryState(manual, edited, manual), /Captured game data/);
  }
});

test("the sheet lays out every slot, averages item level without shirt and tabard, and names missing slots", () => {
  const facts = new Map([
    [1001, { name: "Leveling Helm", quality: 2, itemLevel: 28, slot: "Head", iconFileId: 11 }],
    [3001, { name: "Greatsword", quality: 3, itemLevel: 30, slot: "Two-Hand" }],
    [9001, { name: "Shirt", quality: 1, itemLevel: 1, slot: "Shirt" }],
    [2001, { name: "Old Ring", quality: 1, itemLevel: 18, slot: "Finger" }],
  ]);
  const p = { id: "a", name: "Aeralyn", className: "Warrior", level: 30, faction: "Alliance", stats: stats(), readiness: { equipment: [{ slot: 1, itemId: 1001 }, { slot: 16, itemId: 3001 }, { slot: 4, itemId: 9001 }, { slot: 11, itemId: 2001, name: "Old Ring", itemLevel: 18 }, { slot: 5, itemId: 8888, name: "Captured Vest", quality: 2, itemLevel: 26 }] } };
  const v = S.sheetView(p, { facts, score: (it) => it.itemLevel / 2 });
  assert.equal(v.slots.length, 19);
  assert.deepEqual(v.slots.filter((s) => s.side === "bottom").map((s) => s.label), ["Main hand", "Off hand", "Ranged"]);
  assert.equal(v.averageItemLevel, 25.5, "(28 + 30 + 18 + 26) / 4, shirt not counted");
  assert.equal(v.countedSlots, 4);
  assert.ok(!v.missing.includes("Off hand"), "no off hand is needed next to a two-hander");
  assert.ok(!v.missing.includes("Shirt") && !v.missing.includes("Ranged") && !v.missing.includes("Tabard"));
  assert.ok(v.missing.includes("Neck") && v.missing.includes("Ring 2"));
  const ring = v.slots.find((s) => s.slot === 11).item;
  assert.equal(ring.rating, "replace"); assert.equal(ring.score, 9);
  const vest = v.slots.find((s) => s.slot === 5).item;
  assert.equal(vest.name, "Captured Vest", "the addon's name when the game tables do not know the item"); assert.equal(vest.known, false); assert.equal(vest.score, undefined);
  assert.deepEqual(v.weakest.map((w) => w.label), ["Ring 1", "Chest"]);
  assert.equal(v.wornScore, 38.5);
  assert.equal(v.stats.attackPower, 70);
  const unknown = S.sheetView({ id: "b", name: "Manual", level: 5 });
  assert.equal(unknown.equipmentKnown, false); assert.deepEqual(unknown.missing, [], "nothing is called missing when equipment was never seen");
});

test("each set piece is found worn, in the bags, bank or mail, or on another character; bag upgrades come from the verdict", () => {
  const facts = new Map([[1002, { name: "Dungeon Helm", quality: 3, itemLevel: 33 }], [3001, { name: "Greatsword", quality: 3, itemLevel: 30 }], [4100, { name: "Better Gloves", quality: 2, itemLevel: 31 }], [4200, { name: "Worse Gloves", quality: 1, itemLevel: 10 }]]);
  const me = { id: "a", name: "Aeralyn", className: "Warrior", level: 30, gearSets: S.normalizeGearSetsCapture(sets()),
    readiness: { equipment: [{ slot: 16, itemId: 3001 }, { slot: 1, itemId: 1001 }] },
    ledger: L.normalizeLedgerCapture({ bags: { seenAt: T, items: [{ id: 1002, n: 1 }, { id: 4100, n: 1 }, { id: 4200, n: 1 }] }, bank: { seenAt: T - DAY, items: [{ id: 5001, n: 1, name: "Bank Boots" }] }, mail: { seenAt: T - 60, items: [{ id: 6001, n: 1 }] } }) };
  const alt = { id: "b", name: "Vaelric", ledger: L.normalizeLedgerCapture({ bank: { seenAt: T, items: [{ id: 7001, n: 1 }] } }) };
  const verdict = (it) => (it.name === "Better Gloves" ? { verdict: "upgrade", text: "Upgrade for you", delta: 4.25 } : { verdict: "not-upgrade", text: "Not an upgrade" });
  const v = S.sheetView(me, { profiles: [me, alt], facts, score: (it) => it.itemLevel, verdict });
  const d = v.sets.find((s) => s.name === "Dungeon");
  const where = Object.fromEntries(d.items.map((i) => [i.itemId, i.where]));
  assert.deepEqual(where, { 1002: "bags", 3001: "worn", 5001: "bank", 6001: "mail", 7001: "other" });
  assert.equal(d.items.find((i) => i.itemId === 7001).holder, "Vaelric");
  assert.equal(d.items.find((i) => i.itemId === 5001).seenAt, T - DAY);
  assert.deepEqual(d.counts, { worn: 1, bags: 1, away: 3, missing: 0 });
  assert.equal(d.score, 63, "score of the pieces the game tables know");
  assert.equal(v.sets.find((s) => s.name === "Leveling").counts.worn, 1);
  assert.deepEqual(v.upgrades.map((u) => [u.name, u.where, u.delta]), [["Better Gloves", "bags", 4.3]]);
  const lonely = S.sheetView({ ...me, ledger: undefined }, { profiles: [] });
  assert.equal(lonely.sets[0].items.find((i) => i.itemId === 5001).where, "missing");
  assert.deepEqual(S.sheetItemIds(me), [1001, 1002, 3001, 4100, 4200, 5001, 6001, 7001]);
});

test("the gold goal is the player's own target; progress counts every character's gold", () => {
  assert.throws(() => G.goalFromInput({ gold: 0 })); assert.throws(() => G.goalFromInput({ gold: 1.5 })); assert.throws(() => G.goalFromInput({ gold: 10000001 }));
  assert.throws(() => G.goalFromInput({ gold: 5, extra: 1 })); assert.throws(() => G.goalFromInput({ gold: 5, label: 7 }));
  assert.equal(G.goalFromInput(null), null);
  const goal = G.goalFromInput({ gold: 100, label: "  Riding\nand mount " }, T);
  assert.deepEqual(goal, { copper: 1000000, label: "Ridingand mount", setAt: T });
  const p = (id, money, log) => ({ id, name: id, realm: "", className: "Mage", level: 40, notes: "", goals: [], ledger: L.normalizeLedgerCapture({ money, moneyAt: T, moneyLog: log }) });
  const state = validateState({ ...defaultState(), onboarded: true, profiles: [p("Aeralyn", 400000, [[100000, T - 4 * DAY], [400000, T]]), p("Vaelric", 200000, [[400000, T - 4 * DAY], [200000, T]])], activeProfileId: "Aeralyn", goldGoal: goal });
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  const v = G.goldGoalView(state, { now: T });
  assert.equal(v.have, 600000); assert.equal(v.left, 400000); assert.equal(v.progress, 0.6); assert.equal(v.activeMoney, 400000);
  assert.equal(v.rate.perDay, 25000, "gold mailed between your characters cancels out: 500000 to 600000 in 4 days");
  assert.equal(v.daysLeft, 16);
  assert.equal(v.referenceCosts, false, "the bundled reference has no riding or mount prices");
  for (const bad of [{ copper: 5 }, { copper: 15000, setAt: T }, { copper: 10000, setAt: T, label: "" }, { copper: 10000, setAt: T, more: 1 }])
    assert.throws(() => validateState({ ...state, goldGoal: bad }), JSON.stringify(bad));
  const noGoal = G.goldGoalView({ ...state, goldGoal: undefined }, { now: T });
  assert.equal(noGoal.goal, null); assert.equal(noGoal.have, 600000);
});

test("no estimate without a full day of history or while gold is falling; a reached goal says so", () => {
  const p = (money, log) => ({ id: "a", name: "a", ledger: { money, moneyAt: T, moneyLog: log } });
  assert.equal(G.recentRate([p(100, [[50, T - 3600], [100, T]])], T), null, "under a day");
  assert.equal(G.recentRate([p(100, [])], T), null, "a single sample");
  const falling = G.goldGoalView({ profiles: [p(100, [[500, T - 2 * DAY], [100, T]])], goldGoal: { copper: 10000, setAt: T } }, { now: T });
  assert.equal(falling.rate.perDay, -200); assert.equal(falling.daysLeft, null);
  const old = G.recentRate([p(1000, [[0, T - 40 * DAY], [500, T - 14 * DAY], [1000, T]])], T);
  assert.equal(old.days, 14, "only the last two weeks count"); assert.equal(old.gained, 500);
  const reached = G.goldGoalView({ profiles: [p(20000, [])], goldGoal: { copper: 10000, setAt: T } }, { now: T });
  assert.equal(reached.reached, true); assert.equal(reached.daysLeft, 0); assert.equal(reached.progress, 1);
});

test("sheet data never leaves the computer: not in community observations or the AI profile", () => {
  const p = { id: "a", name: "Aeralyn", realm: "S", className: "Mage", level: 30, notes: "", goals: [], stats: stats(), gearSets: sets(), source: { kind: "wow-addon", id: "Player-1", updatedAt: new Date(T * 1000).toISOString() } };
  assert.doesNotMatch(JSON.stringify(require("../src/core/community.cjs").collectObservations([p])), /Dungeon|1450|5001/);
  const approved = require("../src/core/providers.cjs").approvedProfile(p);
  assert.equal(approved.stats, undefined); assert.equal(approved.gearSets, undefined);
});

test("Sheet comparison shows the saved age of exact worn-item evidence", async (t) => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const { itemCard } = require("../src/core/boss-loot.cjs");
  const wornAt = T - 3 * DAY;
  const saved = new Date(wornAt * 1000).toISOString();
  for (const [label, itemId, updatedAt, expected, location, age] of [
    ["worn", 101, saved, wornAt, "Worn", "3 days ago"],
    ["same name in bank", 102, saved, T - 5 * DAY, "In the bank", "5 days ago"],
    ["undated worn", 101, undefined, null, "Worn", null],
    ["invalid worn date", 101, "not a date", null, "Worn", null],
    ["undated mail", 103, saved, 0, "In the mail", null],
    ["same name without evidence", 104, saved, undefined, "Ownership unknown", null],
  ]) await t.test(label, async () => {
    const profile = { source: updatedAt === undefined ? undefined : { updatedAt },
      readiness: { equipment: [{ slot: 1, itemId: 101, name: "Same name" }] },
      ledger: { bank: { seenAt: T - 5 * DAY, items: [{ id: 102, name: "Same name" }] },
        mail: { seenAt: 0, items: [{ id: 103, name: "Same name" }] } } };
    const card = itemCard(null, itemId, { profile, gameData: { items: (ids) => ids.map(() => ({ name: "Same name" })) }, wished: [104] });
    const panel = { innerHTML: "", querySelector: () => null };
    const parts = { ".page-hero": {}, "[data-sheet-body]": {}, "[data-sheet-compare]": panel };
    const root = { querySelector: (key) => parts[key] };
    const context = vm.createContext({ Date: class extends Date { static now() { return T * 1000; } },
      backstage: { characterSheet: async () => null, itemCard: async () => card },
      document: { querySelector: () => root, getElementById: () => ({ value: "a", addEventListener() {} }) } });
    context.window = context;
    for (const f of ["page-hero.js", "sheet.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", f), "utf8"), context);
    context.SheetView.focusItem("a", itemId); context.SheetView.mounted();
    await new Promise(setImmediate);
    assert.ok(panel.innerHTML.includes(`<strong>${location}</strong>`));
    if (age) assert.ok(panel.innerHTML.includes(`· Last saved</span> · ${age}`), panel.innerHTML);
    else assert.doesNotMatch(panel.innerHTML, /Last saved|ago|just now/);
    assert.equal(card.ownership?.seenAt, expected);
  });
});

test("a late Sheet comparison cannot replace the newer character's exact selected item", async () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  let root, profile = "a";
  const requests = [];
  const picker = { get value() { return profile; }, addEventListener(_type, fn) { this.change = fn; } };
  const mountRoot = () => {
    const panel = { innerHTML: "", querySelector: () => null };
    const parts = { ".page-hero": {}, "[data-sheet-body]": {}, "[data-sheet-compare]": panel };
    root = { querySelector: (key) => parts[key] };
    return panel;
  };
  const context = vm.createContext({ backstage: { characterSheet: async () => null, itemCard: (id, itemId) => new Promise(resolve => requests.push({ id, itemId, resolve })) }, document: { querySelector: () => root, getElementById: () => picker } });
  context.window = context;
  for (const f of ["page-hero.js", "sheet.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", f), "utf8"), context);
  const old = mountRoot();
  context.SheetView.focusItem("a", 5202); context.SheetView.mounted();
  profile = "b"; picker.change();
  const current = mountRoot();
  context.SheetView.focusItem("b", 2991); context.SheetView.mounted();
  assert.deepEqual(requests.map(({ id, itemId }) => [id, itemId]), [["a", 5202], ["b", 2991]]);
  requests[1].resolve({ itemId: 2991, item: { name: "Same name" }, ownership: null });
  await new Promise(setImmediate);
  requests[0].resolve({ itemId: 5202, item: { name: "Same name" }, ownership: { where: "bank" } });
  await new Promise(setImmediate);
  assert.equal(old.innerHTML, "");
  assert.match(current.innerHTML, /data-sheet-comparison="2991"[\s\S]*Ownership unknown/);
  assert.doesNotMatch(current.innerHTML, /5202|In the bank/);
});

test("the Sheet page paints the paper doll, stats, upgrades and sets; the gold goal card shows progress and pace", async () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const facts = new Map([[1002, { name: "Dungeon Helm", quality: 3, itemLevel: 33, iconFileId: 77 }], [3001, { name: "Greatsword", quality: 4, itemLevel: 30, slot: "Two-Hand" }], [4100, { name: "Better Gloves", quality: 2, itemLevel: 31 }]]);
  const me = { id: "a", name: "Aeralyn", className: "Warrior", race: "Human", faction: "Alliance", level: 30, stats: stats(), gearSets: S.normalizeGearSetsCapture(sets()),
    readiness: { equipment: [{ slot: 16, itemId: 3001 }, { slot: 1, itemId: 1001, name: "Leveling Helm", quality: 2, itemLevel: 20 }] },
    ledger: L.normalizeLedgerCapture({ bags: { seenAt: T, items: [{ id: 1002, n: 1 }, { id: 4100, n: 1 }] }, bank: { seenAt: T - DAY, items: [{ id: 5001, n: 1, name: "Bank Boots" }] } }) };
  const alt = { id: "b", name: "Vaelric", ledger: L.normalizeLedgerCapture({ bank: { seenAt: T, items: [{ id: 7001, n: 1 }] } }) };
  const view = S.sheetView(me, { profiles: [me, alt], facts, score: (it) => it.itemLevel, verdict: (it) => (it.name === "Better Gloves" ? { verdict: "upgrade", text: "Upgrade for you", delta: 2 } : { verdict: "not-upgrade" }) });
  let html = "";
  const root = { querySelector: (s) => s === ".page-hero" ? { set outerHTML(v) { html = v; } } : s === "[data-sheet-body]" ? { set innerHTML(v) { html += v; } } : null };
  const context = vm.createContext({ backstage: { characterSheet: async () => structuredClone(view) }, document: { querySelector: (s) => (s === "[data-sheet]" ? root : null), getElementById: () => ({ value: "a", addEventListener() {} }) }, structuredClone });
  context.window = context;
  for (const f of ["page-hero.js", "sheet.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", f), "utf8"), context);
  assert.match(context.SheetView.page(), /Opening your character sheet/);
  context.SheetView.mounted(); await new Promise((r) => setTimeout(r, 10));
  for (const re of [/Characters · Sheet/, /Aeralyn/, /data-sheet-slot="1" data-card-item="1001"/, /Leveling Helm/, /Time to replace/, /q-epic/, /Empty/, /average item level/, /Intellect<\/span><strong>120/, /Fire resistance/,
    /data-sheet-upgrade="4100"/, /Upgrade for you \(\+2\)/, /data-sheet-set="Dungeon"/, /In the bank <small>seen/, /On Vaelric \(bank\)/, /Not found/, /\/bf set wear Dungeon/])
    assert.match(html, re);
  assert.doesNotMatch(html, /data-sheet-slot="17"[^>]*sht-missing|sht-missing[^>]*data-sheet-slot="17"/, "no off hand needed next to a two-hander");

  const goalState = { activeProfileId: "a", goldGoal: { copper: 1000000, label: "Riding & mount", setAt: T }, profiles: [{ id: "a", name: "Aeralyn", ledger: L.normalizeLedgerCapture({ money: 600000, moneyAt: T, moneyLog: [[500000, T - 4 * DAY], [600000, T]] }) }] };
  const ledgerView = { ...L.ledgerView(goalState), goal: G.goldGoalView(goalState, { now: T }) };
  let lhtml = "";
  const lroot = () => ({ dataset: { ledger: "ledger-gold" }, querySelectorAll: () => [], querySelector: () => null, set outerHTML(v) { lhtml = v; } });
  const lc = vm.createContext({ backstage: { ledger: async () => structuredClone(ledgerView) }, document: { querySelector: (s) => (s === "[data-ledger]" ? lroot() : null) }, structuredClone });
  lc.window = lc;
  for (const f of ["page-hero.js", "ledger.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", f), "utf8"), lc);
  lc.LedgerView.gold(); lc.LedgerView.mounted(); await new Promise((r) => setTimeout(r, 10));
  for (const re of [/data-ledger-goal-card/, /Riding &amp; mount/, /aria-valuenow="60"/, /to go, about <strong>16 days<\/strong>/, /about 2g 50s a day over the last 4 days/, /Update goal/, /value="100"/])
    assert.match(lhtml, re);
  ledgerView.goal = G.goldGoalView({ ...goalState, goldGoal: undefined }, { now: T });
  lc.LedgerView.invalidate(); lc.LedgerView.mounted(); await new Promise((r) => setTimeout(r, 10));
  assert.match(lhtml, /open your riding trainer.s window and a mount vendor once/); assert.match(lhtml, />Set goal</);
});

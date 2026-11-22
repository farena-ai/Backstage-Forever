"use strict";
// Economy and history (E6, E7, E9, E11, G11): the desktop's own long memory of prices, gold and
// dungeon runs, craft profit from seen prices only, the cooldown calendar and its file export.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const E = require("../src/core/economy.cjs");
const L = require("../src/core/ledger.cjs");
const J = require("../src/core/journal-data.cjs");
const T = 1790000000, DAY = 86400;

test("price history keeps one point per Auction House visit, oldest first, within its bound", () => {
  const merged = E.mergePricePoints([[100, T], [90, T + 5 * DAY]], [[80, T + 5 * DAY + 600], [120, T - DAY], [100, T]]);
  assert.deepEqual(merged, [[120, T - DAY], [100, T], [80, T + 5 * DAY + 600]], "same visit folds to its lowest price and latest time");
  assert.deepEqual(E.mergePricePoints(merged, merged), merged, "merging the same capture again changes nothing");
  assert.deepEqual(E.mergePricePoints([["x", 1], [0, T], [5, -1], [7, T], null], []), [[7, T]], "bad points are dropped");
  const many = Array.from({ length: 100 }, (_, i) => [100 + i, T + i * DAY]);
  const kept = E.mergePricePoints(many, []);
  assert.equal(kept.length, E.LIMITS.pricePoints);
  assert.equal(kept[kept.length - 1][0], 199, "the newest points survive");
});

test("the usual price is the median; the below mark needs three visits and a price 15% under it", () => {
  assert.equal(E.median([]), null);
  assert.equal(E.median([[5, 1], [1, 2], [9, 3]]), 5);
  assert.equal(E.median([[10, 1], [20, 2]]), 15);
  const two = E.priceSummary([[100, T], [50, T + DAY]]);
  assert.equal(two.below, false, "two visits are not enough");
  const s = E.priceSummary([[100, T], [110, T + DAY], [90, T + 2 * DAY], [70, T + 3 * DAY]]);
  assert.equal(s.usual, 95); assert.equal(s.below, true); assert.equal(s.belowPercent, 26);
  assert.equal(s.low, 70); assert.equal(s.high, 110); assert.equal(s.visits, 4); assert.equal(s.latestAt, T + 3 * DAY);
  assert.equal(E.priceSummary([[100, T], [100, T + DAY], [90, T + 2 * DAY]]).below, false, "10% under is not marked");
  assert.equal(E.priceSummary([]), null);
});

const workshop = (recipes) => ({ professions: { observedAt: "2026-11-01T00:00:00.000Z", complete: true, items: [{ skillLineId: 171, professionId: 171, name: "Alchemy", rank: 100, maxRank: 150 }] },
  recipes: { observedAt: "2026-11-01T00:00:00.000Z", complete: true, items: recipes } });
const recipe = (id, name, outputItemId, reagents, extra = {}) => ({ id, skillLineId: 171, name, reagentsKnown: true, outputItemId, reagents: reagents.map(([itemId, required]) => ({ itemId, required })), ...extra });

test("craft profit uses only seen prices, each with its date, and says unknown when one is missing", () => {
  const profile = { id: "a", name: "Aeralyn", readiness: { workshop: workshop([
    recipe(1, "Healing Potion", 929, [[2453, 1], [3372, 1]]),
    recipe(2, "Elixir", 3383, [[785, 2], [3371, 1]]),
    recipe(3, "Swiftness Potion", 2459, [[2452, 1], [3372, 1]], { outputMin: 2, outputMax: 3 }),
    recipe(4, "No output", undefined, [[2453, 1]]),
    { id: 5, skillLineId: 171, name: "Unread", reagentsKnown: false, outputItemId: 5000, reagents: [] },
    recipe(6, "Loss maker", 6000, [[2453, 10]]),
  ]) } };
  const prices = new Map([[929, { latest: 900, latestAt: T }], [2453, { latest: 200, latestAt: T - DAY }], [3372, { latest: 600, latestAt: T - 2 * DAY }],
    [2459, { latest: 500, latestAt: T }], [2452, { latest: 100, latestAt: T }], [5000, { latest: 10, latestAt: T }], [6000, { latest: 100, latestAt: T }]]);
  const vendor = new Map([[3372, { unit: 400, at: T - 3 * DAY }]]);
  const facts = new Map([[929, { name: "Healing Potion", quality: 1, sellPrice: 75 }], [3383, { name: "Elixir of Wisdom", quality: 1, sellPrice: 60 }]]);
  const view = E.craftProfit(profile, { prices, vendor, vendorListed: new Set([3371]), facts });
  assert.deepEqual(view.rows.map((r) => r.recipeId), [3, 1, 6, 2, 5], "sorted by profit, unknown last; a recipe that makes no item is left out");
  const swift = view.rows[0];
  assert.equal(swift.cost, 500); assert.equal(swift.sell.total, 1000, "two made at the seen price"); assert.equal(swift.profit, 500); assert.equal(swift.madeUpTo, 3);
  const healing = view.rows[1];
  assert.equal(healing.cost, 600); assert.equal(healing.profit, 300);
  assert.deepEqual(healing.materials.map((m) => [m.source, m.unit, m.at]), [["auction", 200, T - DAY], ["vendor", 400, T - 3 * DAY]], "the cheaper seen price wins and keeps its date");
  assert.equal(healing.oldestAt, T - 3 * DAY);
  assert.equal(view.rows[2].profit, -1900, "a loss is shown as a loss");
  const elixir = view.rows[3];
  assert.equal(elixir.cost, null); assert.equal(elixir.sell, null); assert.equal(elixir.profit, null);
  assert.equal(elixir.vendorPays, 60, "what vendors pay comes from the player's own game files");
  assert.deepEqual(elixir.materials.map((m) => [m.cost, m.vendorListed]), [[null, false], [null, true]], "never guessed; the seller reference only says a vendor sells it");
  assert.equal(view.rows[4].materialsKnown, false); assert.equal(view.rows[4].profit, null);
  assert.equal(view.known, 3);
  assert.deepEqual(E.craftItemIds([profile]), [785, 929, 2452, 2453, 2459, 3371, 3372, 3383, 5000, 6000]);
  assert.deepEqual(E.craftProfit({ id: "x", name: "X" }).rows, []);
});

test("vendor prices seen in merchant windows are validated, bounded and merged newest first", () => {
  const ledger = L.normalizeLedgerCapture({ schemaVersion: 1, vendor: [{ id: 3372, cost: 400, n: 1, at: T }, { id: 2321, cost: 500, n: 5, at: T }] });
  assert.deepEqual(ledger.vendor, [{ id: 3372, cost: 400, n: 1, at: T }, { id: 2321, cost: 500, n: 5, at: T }]);
  assert.equal(L.normalizeLedgerCapture({ schemaVersion: 1 }).vendor, undefined, "an older addon simply has no block");
  for (const bad of [[{ id: 1, cost: 0, at: T }], [{ id: 1, cost: 5, at: T }, { id: 1, cost: 6, at: T }], [{ id: 1, cost: 5, n: 0, at: T }], "x", Array.from({ length: 201 }, (_, i) => ({ id: i + 1, cost: 1, at: T }))])
    assert.throws(() => L.normalizeLedgerCapture({ schemaVersion: 1, vendor: bad }), /Invalid ledger/);
  const index = E.vendorIndex([{ ledger }, { ledger: { vendor: [{ id: 3372, cost: 450, n: 1, at: T + DAY }, { id: 9, cost: 7, n: 2, at: T }] } }, {}]);
  assert.deepEqual(index.get(3372), { unit: 450, at: T + DAY }, "the newest sighting wins");
  assert.deepEqual(index.get(2321), { unit: 100, at: T }); assert.deepEqual(index.get(9), { unit: 4, at: T }, "a stack price is rounded up per unit");
});

test("gold over time keeps the last sample of each day and shows the change between samples", () => {
  const ledger = { moneyLog: [[1000, T], [1500, T + DAY]], money: 1800, moneyAt: T + DAY + 600 };
  const merged = E.mergeMoney([[900, T - DAY], [950, T - 100]], ledger);
  const day = (at) => Math.floor(at / DAY);
  assert.equal(new Set(merged.map((p) => day(p[1]))).size, merged.length, "one sample per day");
  assert.deepEqual(merged[merged.length - 1], [1800, T + DAY + 600], "the newest reading of a day replaces the earlier one");
  assert.deepEqual(E.mergeMoney(merged, ledger), merged, "absorbing the same save twice changes nothing");
  assert.equal(E.mergeMoney(Array.from({ length: 800 }, (_, i) => [i, T + i * DAY]), null).length, E.LIMITS.money);
  const view = E.moneyView([[1000, T], [1500, T + DAY], [1200, T + 4 * DAY]]);
  assert.equal(view.change, 200); assert.equal(view.low, 1000); assert.equal(view.high, 1500);
  assert.deepEqual(view.changes.map((c) => [c.change, c.days]), [[-300, 3], [500, 1]], "newest first, with the days between samples");
  assert.equal(E.moneyView([]), null);
  assert.deepEqual(E.moneyView([[5, T]]).changes, []);
});

const kill = (encounterId, name, instanceMap, at) => ({ encounterId, name, instanceMap, instanceType: "party", difficultyId: 1, at });
test("run history: timed visits get their bosses, older boss kills become untimed runs, and nothing is invented", () => {
  const start = T + 100 * DAY;
  const journal = J.normalizeJournalCapture({ levels: [], firsts: [], zones: [],
    encounters: [kill(1, "Rhahk'Zor", 36, T), kill(2, "Sneed", 36, T + 900), kill(1, "Rhahk'Zor", 36, T + 3 * DAY),
      kill(1, "Rhahk'Zor", 36, start + 300), kill(2, "Sneed", 36, start + 900), kill(7, "Rethilgore", 33, start + 5000)],
    runs: [{ instanceMap: 36, instanceType: "party", name: "The Deadmines", startedAt: start, endedAt: start + 1800, deaths: 1, loot: [{ id: 5191, n: 1 }] }] });
  const runs = E.absorbRuns([], journal);
  assert.equal(runs.length, 4);
  const [old1, old2, timed, other] = runs;
  assert.equal(old1.timed, false); assert.deepEqual(old1.bosses.map((b) => b.name), ["Rhahk'Zor", "Sneed"]);
  assert.equal(old1.deaths, null); assert.equal(old1.loot, null, "an untimed run has no deaths or loot to show");
  assert.equal(old2.bosses.length, 1, "a kill days later is another run");
  assert.equal(timed.timed, true); assert.equal(timed.deaths, 1); assert.deepEqual(timed.loot, [{ id: 5191, n: 1 }]); assert.equal(timed.bosses.length, 2);
  assert.equal(other.instanceMap, 33); assert.equal(other.timed, false);
  assert.deepEqual(E.absorbRuns(runs, journal), runs, "absorbing the same save again changes nothing");
  // A later save: the run grew, and the old kills fell out of the addon's short memory.
  const later = J.normalizeJournalCapture({ levels: [], firsts: [], zones: [], encounters: [kill(3, "Gilnid", 36, start + 1500)],
    runs: [{ instanceMap: 36, instanceType: "party", startedAt: start, endedAt: start + 2400, deaths: 2, loot: [{ id: 5191, n: 1 }, { id: 5202, n: 1 }] }] });
  const next = E.absorbRuns(runs, later);
  assert.equal(next.length, 4, "kept runs stay when the addon forgets them");
  const grown = next.find((r) => r.id === timed.id);
  assert.equal(grown.endedAt, start + 2400); assert.equal(grown.deaths, 2); assert.equal(grown.bosses.length, 3); assert.equal(grown.loot.length, 2); assert.equal(grown.name, "The Deadmines");
  assert.equal(E.absorbRuns(Array.from({ length: 400 }, (_, i) => ({ id: `36:${T + i * DAY}`, instanceMap: 36, instanceType: "party", timed: true, startedAt: T + i * DAY, endedAt: T + i * DAY + 60, deaths: 0, loot: [], bosses: [] })), null).length, E.LIMITS.runs);
  assert.deepEqual(E.absorbRuns([{ id: 5 }, null, { id: "x", instanceMap: 1, instanceType: "arena", startedAt: 1, endedAt: 2 }], null), [], "damaged kept runs are dropped");
});

test("personal best is the fastest timed run with as many bosses as the fullest run there", () => {
  const run = (startedAt, seconds, bosses, extra = {}) => ({ id: `36:${startedAt}`, instanceMap: 36, instanceType: "party", name: "The Deadmines", timed: true, startedAt, endedAt: startedAt + seconds, deaths: 0, loot: [],
    bosses: Array.from({ length: bosses }, (_, i) => ({ encounterId: i + 1, name: `Boss ${i + 1}`, at: startedAt + 10 + i })), ...extra });
  const runs = [run(T, 3000, 6), run(T + DAY, 600, 2), run(T + 2 * DAY, 2500, 6, { loot: [{ id: 5191, n: 2 }], deaths: 3 }),
    { id: "u:36:1", instanceMap: 36, instanceType: "party", timed: false, startedAt: T - DAY, endedAt: T - DAY + 500, deaths: null, loot: null, bosses: [{ encounterId: 1, name: "Boss 1", at: T - DAY }, { encounterId: 2, name: "Boss 2", at: T - DAY + 500 }] },
    { id: "u:33:1", instanceMap: 33, instanceType: "party", timed: false, startedAt: T, endedAt: T, deaths: null, loot: null, bosses: [{ encounterId: 9, name: "Rethilgore", at: T }] }];
  const view = E.runHistoryView(runs, { names: new Map([[36, { name: "The Deadmines", bosses: 6 }]]), facts: new Map([[5191, { name: "Cruel Barb", quality: 3 }]]) });
  assert.deepEqual(view.rows.map((r) => r.startedAt), [T + 2 * DAY, T + DAY, T, T, T - DAY].sort((a, b) => b - a), "newest first");
  const best = view.rows.filter((r) => r.personalBest);
  assert.equal(best.length, 1); assert.equal(best[0].seconds, 2500, "the quick two-boss visit is not a personal best");
  assert.deepEqual(best[0].loot, [{ itemId: 5191, count: 2, name: "Cruel Barb", quality: 3 }]);
  const dm = view.dungeons.find((d) => d.instanceMap === 36), sfk = view.dungeons.find((d) => d.instanceMap === 33);
  assert.equal(dm.bestSeconds, 2500); assert.equal(dm.runs, 4); assert.equal(dm.timedRuns, 3); assert.equal(dm.mostBosses, 6); assert.equal(dm.knownBosses, 6); assert.equal(dm.deaths, 3);
  assert.equal(sfk.bestSeconds, null, "no timed run, no best time"); assert.equal(sfk.name, "Instance 33"); assert.equal(sfk.deaths, null);
  const untimed = view.rows.find((r) => r.id === "u:36:1");
  assert.equal(untimed.seconds, null); assert.equal(untimed.bossSpanSeconds, 500); assert.equal(untimed.loot, null); assert.equal(untimed.name, "The Deadmines");
  assert.deepEqual(view.totals, { runs: 5, timed: 3, bosses: 17 });
  assert.deepEqual(E.runItemIds(runs), [5191]);
  assert.deepEqual(E.runHistoryView([]).rows, []);
});

test("the journal's optional runs block is validated on its own and never costs the rest of the journal", () => {
  const base = { levels: [{ level: 5, at: T }], firsts: [], zones: [3] };
  const good = { instanceMap: 36, instanceType: "party", name: "The Deadmines", startedAt: T, endedAt: T + 60, deaths: 1, loot: [{ id: 5, n: 1 }] };
  assert.deepEqual(J.normalizeJournalCapture({ ...base, runs: [good] }).runs, [good]);
  assert.deepEqual(J.normalizeJournalCapture({ ...base, runs: [{ ...good, loot: {} }] }).runs[0].loot, [], "Lua writes an empty list as {}");
  assert.equal(J.normalizeJournalCapture(base).runs, undefined);
  for (const bad of [[{ ...good, endedAt: T - 1 }], [{ ...good, instanceType: "pvp" }], [good, good], [{ ...good, loot: [{ id: 5, n: 1 }, { id: 5, n: 2 }] }], [{ ...good, name: "bad\u0001" }], "x", Array.from({ length: 61 }, (_, i) => ({ ...good, startedAt: T + i, endedAt: T + i }))]) {
    assert.throws(() => J.normalizeJournalCapture({ ...base, runs: bad }), /Invalid journal/);
    const kept = J.normalizeJournalCapture({ ...base, runs: bad }, { ignoreInvalidRuns: true });
    assert.equal(kept.runs, undefined); assert.equal(kept.levels.length, 1, "an invalid runs block is dropped alone");
  }
  assert.match(fs.readFileSync(path.join(__dirname, "../src/core/game-sync.cjs"), "utf8"), /ignoreInvalidEncounters: true, ignoreInvalidRuns: true/);
});

const ledgerWith = (extra) => L.normalizeLedgerCapture({ schemaVersion: 1, ...extra });
test("the calendar lists only saved cooldowns and mail, and notifications fire once each", () => {
  const profiles = [
    { id: "a", name: "Aeralyn", realm: "R", faction: "Alliance", ledger: ledgerWith({ cooldowns: [{ key: "transmute", readyAt: T + 3600 }, { key: "mooncloth", readyAt: T - 600 }], mail: { seenAt: T - DAY, complete: true, letters: 2, money: 0, expiresAt: T + DAY, items: [] } }) },
    { id: "v", name: "Vaelric", realm: "R", faction: "Horde", ledger: ledgerWith({ cooldowns: [{ key: "salt-shaker", readyAt: T - 10 * 3600 }], mail: { seenAt: T, complete: true, letters: 0, money: 0, expiresAt: T + 5 * DAY, items: [] } }) },
    { id: "n", name: "Nobody" },
  ];
  const events = E.calendarEvents(profiles, T);
  assert.deepEqual(events.map((e) => [e.character, e.kind, e.at - T, e.past]), [["Vaelric", "cooldown", -36000, true], ["Aeralyn", "cooldown", -600, true], ["Aeralyn", "cooldown", 3600, false], ["Aeralyn", "mail", DAY, false]],
    "an empty mailbox and a character without a ledger add nothing");
  assert.equal(events[2].title, "Transmute ready"); assert.equal(events[2].detail, "Alchemy");
  const due = E.dueNotifications(events, [], T);
  assert.deepEqual(due.map((n) => n.title), ["Mooncloth ready: Aeralyn", "Mail expires soon: Aeralyn"], "a cooldown ready for ten hours is old news; mail warns two days ahead");
  assert.match(due[1].body, /24 hours/);
  assert.deepEqual(E.dueNotifications(events, due.map((n) => n.key), T), [], "never twice");
  assert.equal(E.dueNotifications(events, [], T + 3600).some((n) => /Transmute/.test(n.title)), true);
  assert.match(E.localDay(T), /^\d{4}-\d{2}-\d{2}$/);
});

test("the calendar file is valid iCalendar text with only the events still ahead", () => {
  const events = [{ key: "a:cd:transmute:1", kind: "cooldown", at: T - 5, title: "Transmute ready", detail: "Alchemy", character: "Aeralyn", realm: "R" },
    { key: "a:mail:2", kind: "mail", at: T + DAY, title: "Mail expires", detail: "2 letters when the mailbox was last opened; a very long line that has to be folded because calendar files allow only seventy-five octets per line", character: "Zoë, the; Mage", realm: "Realm" }];
  const ics = E.calendarIcs(events, T);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")); assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, "an event already past is left out");
  assert.match(ics, /SUMMARY:Mail expires - Zoë\\, the\\; Mage/);
  assert.match(ics, new RegExp(`DTSTART:${new Date((T + DAY) * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`));
  assert.match(ics, /UID:a:mail:2@backstage-forever/);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  assert.ok(!/[^\r]\n/.test(ics), "CRLF line ends only");
  assert.ok(ics.split("\r\n").some((l) => l.startsWith(" ")), "long lines are folded");
  assert.equal((E.calendarIcs([], T).match(/VEVENT/g) || []).length, 0);
});

test("the store migrates old and damaged files safely and takes over the ledger's short price memory", () => {
  assert.deepEqual(E.migrate(null), { version: 1, prices: {}, money: {}, runs: {}, calendar: { notify: false, notified: [] } });
  assert.deepEqual(E.migrate("junk").prices, {});
  const migrated = E.migrate({ version: 0, prices: { a: { 2589: [[90, T], ["bad", 1]], "not-an-id": [[1, 1]], 5: "x" }, "": { 1: [[1, 1]] }, b: [] }, money: { a: [[5, T], [6, T + 10], "x"], b: "x" },
    runs: { a: [{ id: "36:1", instanceMap: 36, instanceType: "party", timed: true, startedAt: 1, endedAt: 2, deaths: 0, loot: [], bosses: [] }, { broken: true }] }, calendar: { notify: "yes", notified: ["k", 5] }, extra: 1 });
  assert.deepEqual(migrated.prices, { a: { 2589: [[90, T]] } }, "bad entries are dropped one by one");
  assert.deepEqual(migrated.money, { a: [[6, T + 10]] });
  assert.equal(migrated.runs.a.length, 1);
  assert.deepEqual(migrated.calendar, { notify: false, notified: ["k"] }, "notifications stay off unless really switched on");
  assert.equal(E.migrate({ prices: {}, calendar: { notify: true } }).calendar.notify, true);
  assert.deepEqual(E.migrate({ prices: { a: { 1: [[5, T]] } } }).runs, {}, "a file from before runs existed gains them empty");

  // First run after the update: the ledger's own five-point memory becomes the start of the history.
  const profile = (id, hist, extra = {}) => ({ id, name: id, ledger: ledgerWith({ money: 500, moneyAt: T + 2 * DAY, moneyLog: [[400, T + DAY]], prices: [{ id: 2589, hist }] }), ...extra });
  let data = E.absorb(null, [profile("a", [[90, T + 2 * DAY], [70, T]])]);
  assert.deepEqual(data.prices.a[2589], [[70, T], [90, T + 2 * DAY]]);
  assert.deepEqual(data.money.a, [[400, T + DAY], [500, T + 2 * DAY]]);
  // Later saves: the addon forgot the old points, the desktop did not.
  for (let i = 3; i < 12; i++) data = E.absorb(data, [profile("a", [[100 + i, T + i * DAY]])]);
  assert.equal(data.prices.a[2589].length, 11, "longer than the addon's five");
  assert.deepEqual(data.prices.a[2589][0], [70, T]);
  const again = E.absorb(data, [profile("a", [[111, T + 11 * DAY]])]);
  assert.deepEqual(again, data, "the same save twice changes nothing");
  const merged = E.mergedPriceHistory({ prices: { a: { 5: [[10, T]] }, b: { 5: [[8, T + DAY]], 6: [[1, T]] } } });
  assert.deepEqual(merged.get(5), [[10, T], [8, T + DAY]]); assert.deepEqual(merged.get(6), [[1, T]]);
  assert.equal(E.mergedPriceHistory({ prices: { a: { 5: [[10, T]] }, b: { 5: [[8, T + DAY]] } } }, ["a"]).get(5).length, 1);
  // A deleted character takes its history with it; a character without a ledger keeps what it has.
  const pruned = E.absorb(data, [{ id: "b", name: "b" }]);
  assert.deepEqual(pruned.prices, {}); assert.deepEqual(pruned.money, {});
  assert.deepEqual(E.absorb(data, [{ id: "a", name: "a" }]).prices.a, data.prices.a);
});

test("the store file is written only when something changed and survives an unreadable file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-economy-")), file = path.join(dir, "economy.json");
  try {
    let writes = 0;
    const write = (f, text) => { writes++; fs.writeFileSync(f, text); };
    const store = new E.EconomyStore({ file, write });
    const state = { profiles: [{ id: "a", name: "a", ledger: ledgerWith({ prices: [{ id: 5, hist: [[10, T]] }] }) }] };
    assert.equal(store.absorb(state), true); assert.equal(store.absorb(state), false); assert.equal(writes, 1);
    assert.equal(store.data.calendar.notify, false, "notifications are off by default");
    assert.equal(store.setNotify(true), true); store.markNotified(["k1", "k1", "k2"]);
    const reopened = new E.EconomyStore({ file, write });
    assert.deepEqual(reopened.data.prices.a[5], [[10, T]]); assert.equal(reopened.data.calendar.notify, true); assert.deepEqual(reopened.data.calendar.notified, ["k1", "k2"]);
    reopened.clear();
    assert.deepEqual(new E.EconomyStore({ file }).data.prices, {});
    fs.writeFileSync(file, "{ not json");
    const damaged = new E.EconomyStore({ file, write });
    assert.deepEqual(damaged.data.prices, {});
    assert.equal(damaged.absorb(state), true, "a fresh history starts instead of failing");
    const failing = new E.EconomyStore({ file, write: () => { throw Error("disk full"); } });
    assert.equal(failing.absorb({ profiles: [] }), false, "a failed write never throws into the save path");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the IPC layer adds history to the Ledger view, serves the calendar and run history, and notifies only when switched on", async () => {
  const { registerEconomyHandlers } = require("../src/core/economy-ipc.cjs");
  const handlers = {}, shown = [], written = [];
  let now = T;
  const a = { id: "a", name: "Aeralyn", realm: "R", faction: "Alliance",
    readiness: { workshop: workshop([recipe(1, "Healing Potion", 929, [[2453, 1]])]) },
    journal: J.normalizeJournalCapture({ levels: [], firsts: [], zones: [], encounters: [kill(1, "Rhahk'Zor", 36, T - 500)], runs: [{ instanceMap: 36, instanceType: "party", startedAt: T - 900, endedAt: T - 100, deaths: 0, loot: [{ id: 5191, n: 1 }] }] }),
    ledger: ledgerWith({ money: 700, moneyAt: T, moneyLog: [[500, T - DAY]], cooldowns: [{ key: "transmute", readyAt: T + 600 }],
      prices: [{ id: 929, hist: [[600, T], [900, T - 2 * DAY], [950, T - 4 * DAY]] }, { id: 2453, hist: [[200, T]] }] }) };
  const state = { activeProfileId: "a", profiles: [a, { id: "b", name: "Bank" }] };
  const economy = new E.EconomyStore({ file: null });
  economy.absorb(state);
  const pages = registerEconomyHandlers({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, economy, now: () => now,
    gameData: { items: (ids) => ids.map((id) => (id === 929 ? { name: "Healing Potion", quality: 1, sellPrice: 75 } : id === 5191 ? { name: "Cruel Barb", quality: 3 } : null)) },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: "C:/x/calendar.ics" }) }, getWindow: () => null,
    notify: (title, body) => shown.push([title, body]), writeFile: async (file, text) => { written.push([file, text]); } });
  const view = L.ledgerView(state, { now });
  const extras = pages.ledgerExtras(state, view);
  const potion = view.prices.find((p) => p.itemId === 929);
  assert.equal(potion.visits, 3); assert.equal(potion.usual, 900); assert.equal(potion.below, true); assert.equal(potion.belowPercent, 33); assert.equal(potion.spark.length, 3);
  assert.equal(extras.crafts.length, 1); assert.equal(extras.crafts[0].rows[0].profit, 400); assert.equal(extras.crafts[0].rows[0].outputName, "Healing Potion");
  assert.deepEqual(extras.money.map((m) => [m.name, m.change]), [["Aeralyn", 200]]);
  const calendar = handlers.economyCalendar();
  assert.equal(calendar.notify, false); assert.equal(calendar.events.length, 1); assert.equal(calendar.canNotify, true);
  now = T + 700;
  assert.equal(pages.tick(), 0, "off by default: nothing is shown");
  assert.equal(handlers.setCalendarNotify(true).notify, true);
  assert.equal(pages.tick(), 0, "what was already due when the switch was turned on is not news");
  state.profiles[0] = { ...a, ledger: ledgerWith({ cooldowns: [{ key: "transmute", readyAt: T + 900 }] }) };
  now = T + 1000;
  assert.equal(pages.tick(), 1); assert.equal(pages.tick(), 0);
  assert.deepEqual(shown, [["Transmute ready: Aeralyn", "Alchemy cooldown on Aeralyn is ready."]]);
  assert.deepEqual(await handlers.exportCalendar(), { saved: false, reason: "empty" });
  state.profiles[0] = { ...a, ledger: ledgerWith({ cooldowns: [{ key: "transmute", readyAt: now + 3600 }] }) };
  assert.deepEqual(await handlers.exportCalendar(), { saved: true, events: 1 });
  assert.equal(written[0][0], "C:/x/calendar.ics"); assert.match(written[0][1], /SUMMARY:Transmute ready - Aeralyn/);
  const runs = handlers.runHistory();
  assert.equal(runs.profileId, "a"); assert.equal(runs.rows.length, 1); assert.equal(runs.rows[0].name, "The Deadmines", "the bundled dungeon list names the instance");
  assert.equal(runs.rows[0].knownBosses, 6); assert.deepEqual(runs.rows[0].loot, [{ itemId: 5191, count: 1, name: "Cruel Barb", quality: 3 }]);
  assert.deepEqual(runs.characters, [{ profileId: "a", name: "Aeralyn", runs: 1 }, { profileId: "b", name: "Bank", runs: 0 }]);
  assert.equal(handlers.runHistory("b").rows.length, 0);
  assert.throws(() => handlers.runHistory(5)); assert.throws(() => handlers.setCalendarNotify("yes")); assert.throws(() => handlers.economyCalendar(1));
});

test("the pages render price history, craft profit, the gold chart, the calendar and run history without inline styles", async () => {
  const now = Math.floor(Date.now() / 1000);
  const view = { now, activeProfileId: "a", characters: [{ profileId: "a", name: "Aeralyn", hasLedger: true, cooldowns: [], mail: null }], gold: { total: 700, characters: [{ profileId: "a", name: "Aeralyn", money: 700 }] }, items: [], value: { total: 0, items: [] }, goal: null,
    prices: [{ itemId: 929, name: "Healing <Potion>", quality: 1, latest: 600, latestAt: now, low: 600, lowAt: now, observations: 3, usual: 900, visits: 3, below: true, belowPercent: 33, spark: [[950, now - 4 * DAY], [900, now - 2 * DAY], [600, now]] },
      { itemId: 5, name: "Once", quality: 1, latest: 5, latestAt: now, low: 5, lowAt: now, observations: 1, usual: 5, visits: 1, below: false, belowPercent: 0, spark: [[5, now]] }],
    money: [{ profileId: "a", name: "Aeralyn", points: [[500, now - DAY], [700, now]], first: 500, firstAt: now - DAY, last: 700, lastAt: now, change: 200, low: 500, high: 700, changes: [{ at: now, money: 700, change: 200, days: 1 }] }],
    crafts: [{ profileId: "a", name: "Aeralyn", complete: true, known: 1, rows: [
      { recipeId: 1, name: "Healing Potion", profession: "Alchemy", outputItemId: 929, outputName: "Healing Potion", quality: 1, made: 1, madeUpTo: null, materialsKnown: true, cost: 200, sell: { unit: 600, at: now, total: 600 }, vendorPays: 75, profit: 400, oldestAt: now,
        materials: [{ itemId: 2453, name: "Bruiseweed", quality: 1, required: 1, unit: 200, at: now, source: "auction", cost: 200, vendorListed: false }] },
      { recipeId: 2, name: "Elixir", profession: "Alchemy", outputItemId: 3383, outputName: "Elixir of Wisdom", quality: 1, made: 1, madeUpTo: null, materialsKnown: true, cost: null, sell: null, vendorPays: 60, profit: null, oldestAt: null,
        materials: [{ itemId: 3371, name: "Empty Vial", quality: 1, required: 1, unit: null, at: null, source: null, cost: null, vendorListed: true }] }] }], vendorPricesSeen: 0 };
  const calendar = { now, notify: false, canNotify: true, events: [
    { key: "a:cd:transmute:1", kind: "cooldown", at: now - 60, title: "Transmute ready", detail: "Alchemy", profileId: "a", character: "Aeralyn", realm: "R", faction: "Alliance", past: true },
    { key: "a:mail:2", kind: "mail", at: now + 3600, title: "Mail expires", detail: "2 letters when the mailbox was last opened", profileId: "a", character: "Aeralyn", realm: "R", faction: "Alliance", past: false }] };
  const runs = { profileId: "a", name: "Aeralyn", characters: [{ profileId: "a", name: "Aeralyn", runs: 2 }], totals: { runs: 2, timed: 1, bosses: 3 },
    dungeons: [{ instanceMap: 36, instanceType: "party", name: "The Deadmines", runs: 2, timedRuns: 1, mostBosses: 2, knownBosses: 6, bestSeconds: 2500, bestAt: now - DAY, lastAt: now - DAY, deaths: 1 }],
    rows: [{ id: "36:1", instanceMap: 36, instanceType: "party", name: "The Deadmines", timed: true, startedAt: now - DAY, endedAt: now - DAY + 2500, seconds: 2500, bossSpanSeconds: 600, deaths: 1, knownBosses: 6, bosses: [{ name: "Rhahk'Zor", at: 1 }, { name: "Sneed", at: 2 }], loot: [{ itemId: 5191, count: 1, name: "Cruel Barb", quality: 3 }], personalBest: true },
      { id: "u:36:1", instanceMap: 36, instanceType: "party", name: "The Deadmines", timed: false, startedAt: now - 9 * DAY, endedAt: now - 9 * DAY, seconds: null, bossSpanSeconds: null, deaths: null, knownBosses: 6, bosses: [{ name: "Rhahk'Zor", at: 1 }], loot: null, personalBest: false }] };
  let html = "", kind = "calendar";
  const root = (which) => ({ dataset: which, querySelectorAll: () => [], querySelector: () => null, set outerHTML(v) { html = v; } });
  const context = vm.createContext({ backstage: { ledger: async () => structuredClone(view), economyCalendar: async () => structuredClone(calendar), runHistory: async () => structuredClone(runs) }, structuredClone,
    document: { querySelector: (s) => (s === "[data-ledger]" ? root({ ledger: "ledger-gold" }) : s === "[data-economy]" || s === `[data-economy="${kind}"]` ? root({ economy: kind }) : null) } });
  context.window = context; const window = context;
  for (const f of ["page-hero.js", "ledger.js", "economy.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer", f), "utf8"), context);
  const V = window.LedgerView, X = window.EconomyView;
  V.gold(); V.mounted(); await new Promise((r) => setTimeout(r, 10));
  assert.match(html, /33% below your usual price/); assert.match(html, /<svg class="ldg-spark"/); assert.match(html, /Seen once/); assert.match(html, /Healing &lt;Potion&gt;/);
  assert.match(html, /Gold over time/); assert.match(html, /<svg class="ldg-chart"/); assert.match(html, /not at the start and end of each session/, "says what the gold chart cannot show");
  const crafts = V.crafts();
  assert.match(crafts, /data-ledger-craft-row="1"/); assert.match(crafts, /ldg-gain/); assert.match(crafts, /price never seen \(vendors sell it: open one in game\)/); assert.match(crafts, /Unknown/); assert.match(crafts, /vendors pay/);
  X.calendar(); X.mounted(); await new Promise((r) => setTimeout(r, 10));
  assert.match(html, /Cooldown calendar/); assert.match(html, /Transmute/); assert.match(html, /Mail expires/); assert.match(html, /data-eco-notify="on"/); assert.match(html, /aria-pressed="false"/, "notifications start off");
  assert.match(html, /Save calendar file/); assert.match(html, /eco-today/);
  kind = "runs";
  X.runs(); X.mounted(); await new Promise((r) => setTimeout(r, 10));
  assert.match(html, /Personal bests/); assert.match(html, /41m 40s/); assert.match(html, /data-eco-best/); assert.match(html, /Not timed/); assert.match(html, /Not recorded/); assert.match(html, /Cruel Barb/); assert.match(html, /2 of 6/);
  for (const page of [V.gold(), crafts, X.calendar(), X.runs()]) assert.doesNotMatch(page, /\sstyle=/, "the page's CSP forbids inline styles");
  const nav = fs.readFileSync(path.join(__dirname, "../src/renderer/player-navigation.js"), "utf8");
  for (const route of ['"ledger-crafts"', '"calendar"', '"run-history"']) assert.ok(nav.includes(route), `${route} is a sub-page, not a new section`);
  assert.equal((nav.match(/^    \["[a-z-]+", ".", "[A-Za-z ]+"\],$/gm) || []).length, 8, "still eight main sections");
});

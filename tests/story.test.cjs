"use strict";
// The story so far (W8) and the Journey's own small store: chapters only from saved evidence.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const S = require("../src/core/story.cjs");
const { JourneyStore, migrate, captureOf, LIMITS } = require("../src/core/journey-store.cjs");
const R = require("../src/core/level-race.cjs");
const T = 1790000000, DAY = 86400, H = 3600;
const names = { 1429: "Elwynn Forest", 1436: "Westfall", 1433: "Redridge Mountains" };
const mapName = (id) => names[id] || `Map ${id}`;
const day = (at) => `D${Math.round((at - T) / DAY)}`;
const profile = (over = {}) => ({ id: "a", name: "Aeralyn", className: "Mage", level: 14, source: { kind: "wow-addon", id: "s", updatedAt: new Date((T + 6 * DAY) * 1000).toISOString() },
  journal: { played: 90000, zones: [1429, 1436, 1433, 1453],
    levels: [{ level: 10, at: T, played: 40000 }, { level: 11, at: T + DAY, played: 50000 }, { level: 12, at: T + 2 * DAY, played: 54000 }, { level: 13, at: T + 4 * DAY, played: 70000 }, { level: 14, at: T + 5 * DAY, played: 85000 }],
    firsts: [{ key: "death", at: T + H }, { key: "dungeon", at: T + 4 * DAY + H }, { key: "flight", at: T - DAY }],
    givers: [{ q: 1, n: 5, m: 1429, x: 0.4, y: 0.6, at: T + 100 }, { q: 2, n: 6, m: 1429, x: 0.4, y: 0.6, at: T + 200 }, { q: 3, n: 7, m: 1436, x: 0.5, y: 0.5, at: T + DAY + 50 }, { q: 4, n: 8, m: 1436, x: 0.5, y: 0.5, at: T + 4 * DAY + 50 }] },
  history: { completedIdsKnown: true, completedIds: [101, 102, 103, 202, 900], recent: [{ id: 103, completedAt: T + 2 * DAY + 10 }, { id: 900, completedAt: T + 3 * DAY }] }, ...over });
const chains = { quests: new Map([[101, { id: 101, title: "A Messenger", next: 102 }], [102, { id: 102, title: "The Hunt", next: 103 }], [103, { id: 103, title: "The Defias Brotherhood", next: null }], [201, { id: 201, title: "Start", next: 202 }], [202, { id: 202, title: "The Coast Isn't Clear", next: null }], [900, { id: 900, title: "Alone", next: null }]]),
  prev: new Map([[102, 101], [103, 102], [202, 201]]) };
const runs = { totals: { runs: 2, timed: 1, bosses: 7 }, dungeons: [{ instanceMap: 36, instanceType: "party", name: "The Deadmines", runs: 2, timedRuns: 1, mostBosses: 6, knownBosses: 6, bestSeconds: 2500, lastAt: T + 5 * DAY }],
  rows: [{ id: "36:1", instanceMap: 36, instanceType: "party", name: "The Deadmines", timed: true, startedAt: T + 5 * DAY, seconds: 2500, deaths: 2, knownBosses: 6, bosses: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `B${n}`, at: T + 5 * DAY + n })), personalBest: true }] };

test("zones come from quests picked up and sessions, with the level the character had then", () => {
  const sessions = [{ startedAt: (T + 5 * DAY) * 1000, endedAt: (T + 5 * DAY + H) * 1000, zones: [1433], startLevel: 13, level: 14, deaths: 1 }, { startedAt: (T + 2 * DAY) * 1000, endedAt: (T + 2 * DAY + H) * 1000, zones: [1429, 1436], startLevel: 12, level: 12, deaths: 0 }];
  const z = S.zoneChapters(profile(), sessions);
  assert.deepEqual(z.map((x) => x.mapId), [1429, 1436, 1433], "in the order the character first worked in them");
  assert.deepEqual(z[0], { mapId: 1429, firstAt: T + 100, lastAt: T + 2 * DAY + H, minLevel: 10, maxLevel: 10, quests: 2, sessions: 1 }, "a session through two zones adds dates, not levels");
  assert.deepEqual([z[1].minLevel, z[1].maxLevel, z[1].quests], [11, 13, 2]);
  assert.deepEqual([z[2].minLevel, z[2].maxLevel, z[2].quests, z[2].sessions], [13, 14, 0, 1], "a session in one zone gives its level range");
  assert.equal(S.levelAt(S.datedLevels(profile()), T - 5), null, "before the first dated level the journal cannot tell");
  assert.deepEqual(S.zoneChapters({ journal: { givers: [{ q: 1, n: 1, m: 0, at: T }, { q: 2, n: 1, m: 5, at: 0 }] } }), []);
});

test("quest stories: dated from saved hand-ins, the rest named without a date", () => {
  const found = S.finishedChains(profile(), chains);
  assert.deepEqual(found.dated, [{ questId: 103, name: "The Defias Brotherhood", steps: 3, first: "A Messenger", at: T + 2 * DAY + 10 }]);
  assert.deepEqual(found.undated, [{ questId: 202, name: "The Coast Isn't Clear", steps: 2, first: "Start", at: null }]);
  assert.equal(S.chainFor(chains, 900), null, "a quest on its own is not a story"); assert.equal(S.chainFor(chains, 102), null, "a middle step does not finish one");
  const later = profile({ history: { completedIdsKnown: false, completedIds: [], recent: [{ id: 103, completedAt: T + 9 * DAY }] } });
  assert.deepEqual(S.finishedChains(later, chains), { dated: [], undated: [] }, "a hand-in after the save is not evidence, and an unknown list names nothing");
});

test("the page is short plain sentences, each from saved data", () => {
  const deaths = [{ at: (T + DAY) * 1000, mapId: 1436 }, { at: (T + 2 * DAY) * 1000, mapId: 1436 }, { at: (T + 3 * DAY) * 1000 }];
  const sessions = [{ startedAt: (T + DAY) * 1000, endedAt: (T + DAY + H) * 1000, zones: [1436], startLevel: 11, level: 11, deaths: 5 }];
  const s = S.story(profile(), { sessions, deaths, runs, chains, zonesDone: [{ mapId: 1429, name: "Elwynn Forest", done: 30, total: 32, min: 1, max: 10 }], mapName, day });
  assert.equal(s.enough, true); assert.equal(s.level, 14);
  assert.deepEqual(s.chapters.map((c) => c.key), ["zones", "levels", "firsts", "chains", "zones-done", "dungeons", "deaths"]);
  const of = (key) => s.chapters.find((c) => c.key === key).sentences;
  assert.deepEqual(of("zones"), ["Elwynn Forest at level 10: 2 quests picked up on D0.", "Westfall, levels 11 to 13: 2 quests picked up from D1 to D4.", "2 more zones visited, with no saved date."]);
  assert.deepEqual(of("levels"), ["From level 10 on D0 to level 14 on D5.", "25h 00m played in all.", "The quickest level was 11 to 12: 1h 07m of play."]);
  assert.deepEqual(of("firsts"), ["First dungeon: D4 at level 13.", "First death: D0 at level 10.", "First flight: D-1."], "no level is claimed before the first dated level-up");
  assert.deepEqual(of("chains"), ["Finished “The Defias Brotherhood”, a story of 3 quests, on D2.", "Also finished, date not saved: “The Coast Isn't Clear”."]);
  assert.deepEqual(of("zones-done"), ["Elwynn Forest: 30 of 32 known quests done."]);
  assert.deepEqual(of("dungeons"), ["The Deadmines: 2 runs, up to 6 bosses defeated of 6, fastest full run 42m. Last visit D5."]);
  assert.deepEqual(of("deaths"), ["Died 2 times in Westfall, last on D2.", "Died once where the place could not be read, last on D3.", "2 deaths inside The Deadmines on D5.", "Play sessions counted 5 deaths in all; for 2 of them the place was not saved."]);
  assert.deepEqual(s.cards.map((c) => c.kind), ["story", "level", "chain", "zone", "run"]);
  assert.deepEqual(s.cards[0].data.stats, [["Level", "14"], ["Zones", "2"], ["Dungeon runs", "2"], ["Deaths", "5"]]);
  assert.equal(s.cards[1].data.seconds, 15000, "the level card carries the last level's time");
  for (const c of s.chapters) for (const line of c.sentences) { assert.ok(line.length <= 240, line); assert.match(line, /[.]$/); }
  assert.doesNotMatch(JSON.stringify(s), /undefined|NaN|null level/);
});

test("with nothing saved the page says what is missing and tells no story", () => {
  const empty = S.story({ id: "b", name: "Bram", level: 3 }, { mapName, day });
  assert.equal(empty.enough, false); assert.deepEqual(empty.chapters, []); assert.deepEqual(empty.cards, []);
  assert.equal(empty.notSaved.length, 2); assert.match(empty.notSaved.join(" "), /No zone has a saved date yet/); assert.match(empty.notSaved.join(" "), /No level has a saved date yet/);
  const visited = S.story({ id: "b", name: "Bram", journal: { zones: [1429, 1436], levels: [], firsts: [{ key: "death", at: T }] } }, { mapName, day });
  assert.match(visited.notSaved[0], /2 zones visited, but when and at what level was not saved/);
  assert.match(visited.notSaved.join(" "), /Earlier deaths have no saved place/, "a death without a place is said to have none");
  assert.equal(S.story(null), null);
  const noRef = S.story(profile(), { mapName, day });
  assert.ok(!noRef.chapters.some((c) => c.key === "chains"), "without the quest reference no story is named");
});

test("the journey store keeps deaths, the capture before the newest, race friends and the overlay switch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-journey-")), file = path.join(dir, "journey.json");
  let writes = 0;
  const open = () => new JourneyStore({ file, validFriend: R.importCode, write: (f, text) => { writes++; fs.writeFileSync(f, text); } });
  const store = open();
  assert.deepEqual(store.data, { version: 1, deaths: {}, captures: {}, race: { name: "", friends: [] }, overlay: { enabled: false, port: null } });
  assert.equal(store.recordDeath("a", { at: 1000000, mapId: 1436 }), true);
  assert.equal(store.recordDeath("a", { at: 1005000, mapId: 1436 }), false, "the same death is noted once");
  assert.equal(store.recordDeath("a", { at: 0 }), false); assert.equal(store.recordDeath("__proto__", { at: 5000000 }), false); assert.equal(store.recordDeath("a", null), false);
  assert.equal(store.annotateDeath("a", 1003000, { tip: 2, killer: "Defias Pillager" }), true);
  assert.equal(store.annotateDeath("a", 9000000, { tip: 2 }), false);
  assert.deepEqual(store.deaths("a"), [{ at: 1000000, mapId: 1436, tip: 2, killer: "Defias Pillager" }]);
  for (let i = 0; i < LIMITS.deaths + 20; i++) store.recordDeath("b", { at: 2000000 + i * 60000 });
  assert.equal(store.deaths("b").length, LIMITS.deaths, "bounded");

  const p = profile();
  store.absorb({ profiles: [p, { id: "b", name: "Bram" }] });
  assert.deepEqual(store.captures("a"), { current: { savedAt: p.source.updatedAt, level: 14, played: 90000, quests: 5, money: null }, previous: null });
  store.absorb({ profiles: [p, { id: "b", name: "Bram" }] });
  assert.equal(store.captures("a").previous, null, "the same save again is not a new capture");
  const next = profile({ level: 15, source: { ...p.source, updatedAt: new Date((T + 7 * DAY) * 1000).toISOString() } });
  store.absorb({ profiles: [next, { id: "b", name: "Bram" }] });
  assert.equal(store.captures("a").current.level, 15); assert.equal(store.captures("a").previous.level, 14);
  store.absorb({ profiles: [p, { id: "b", name: "Bram" }] });
  assert.equal(store.captures("a").current.level, 15, "an older save never replaces a newer one");
  assert.equal(captureOf({ id: "x", source: { kind: "manual", updatedAt: p.source.updatedAt } }), null);
  store.absorb({ profiles: [next] });
  assert.deepEqual(store.deaths("b"), [], "a deleted character takes its notes with it");

  const code = R.exportCode(p, "Mia");
  assert.equal(store.addFriend(code), true); assert.equal(store.addFriend(code), false, "the same friend is not added twice");
  assert.throws(() => store.addFriend("BFRACE1.nope.0000000000"), /not a leveling race code/);
  assert.equal(store.setRaceName("  Frank "), "Frank"); assert.throws(() => store.setRaceName("x".repeat(30)), /24 characters/);
  for (let i = 0; i < LIMITS.friends - 1; i++) store.addFriend(R.exportCode(p, `Friend ${i}`));
  assert.throws(() => store.addFriend(R.exportCode(p, "One too many")), /at most 12 friends/);
  assert.equal(store.removeFriend(R.importCode(code).id), true); assert.equal(store.removeFriend("0000000000"), false);
  assert.deepEqual(store.setOverlay({ enabled: true, port: 51000 }), { enabled: true, port: 51000 });
  assert.deepEqual(store.setOverlay({ enabled: false, port: 80 }), { enabled: false, port: 51000 }, "a port outside the high range is ignored");

  const before = writes;
  const again = open();
  assert.deepEqual(again.data, store.data, "what was written loads back unchanged");
  again.absorb({ profiles: [next] });
  assert.equal(writes, before, "nothing new, nothing written");
  again.clear();
  assert.deepEqual(again.data.deaths, {}); assert.equal(again.data.overlay.enabled, false);
  fs.writeFileSync(file, "{broken");
  assert.deepEqual(open().data.captures, {}, "an unreadable file starts empty");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a damaged or hostile file is cleaned entry by entry", () => {
  const good = "2026-11-20T10:00:00.000Z";
  const out = migrate({ deaths: { a: [{ at: 5000000, mapId: 1436, tip: 9, killer: "x".repeat(200) }, { at: "x" }, null], ["__proto__"]: [{ at: 1 }], b: "no" },
    captures: { a: { current: { savedAt: good, level: 999, played: -1, quests: 5, money: 1.5 }, previous: { savedAt: "2026-11-21T10:00:00.000Z", level: 3 } }, b: { current: { savedAt: "yesterday" } }, c: 5 },
    race: { name: "N\u0000ame" + "x".repeat(60), friends: ["junk", 5, null] }, overlay: { enabled: "yes", port: 22 }, extra: { a: 1 } }, { validFriend: R.importCode });
  assert.deepEqual(out.deaths, { a: [{ at: 5000000, mapId: 1436 }] });
  assert.deepEqual(out.captures, { a: { current: { savedAt: good, level: null, played: null, quests: 5, money: null }, previous: null } }, "a 'previous' newer than 'current' is dropped");
  assert.equal(out.race.name.length, LIMITS.name); assert.deepEqual(out.race.friends, []);
  assert.deepEqual(out.overlay, { enabled: false, port: null }); assert.equal(out.extra, undefined);
  for (const junk of [null, 5, "x", [], undefined]) assert.equal(migrate(junk).version, 1);
});

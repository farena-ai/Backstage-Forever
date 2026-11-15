"use strict";
// World tracker (0.46, 3.2) and journey replay + share picture (0.46, 3.3).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { worldTracker, band } = require("../src/core/world-tracker.cjs");
const { PlaySession } = require("../src/core/play-session.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const zones = [
  { mapId: 1411, min: 1, max: 10, faction: "Horde" }, { mapId: 1429, min: 1, max: 10, faction: "Alliance" },
  { mapId: 1413, min: 10, max: 25, faction: "Contested" }, { mapId: 1440, min: 18, max: 30, faction: "Contested" },
];
const q = (id, sides) => ({ q: { id, level: 5, ...(sides ? { sides } : {}) } });
const quests = new Map([
  [1411, Array.from({ length: 10 }, (_, i) => q(100 + i))],
  [1429, [q(200)]],
  [1413, [q(300), q(301, ["Horde"]), q(302, ["Alliance"])]],
]);
const names = { 1411: "Durotar", 1429: "Elwynn Forest", 1413: "The Barrens", 1440: "Ashenvale" };
const continentOf = (id) => (id === 1429 ? "eastern-kingdoms" : "kalimdor");
const horde = { name: "Vael", level: 12, faction: "Horde", quests: [{ id: 300 }], journal: { zones: [1411, 1413] },
  history: { completedIdsKnown: true, completedIds: [100, 101, 102, 103, 104, 105, 106, 107, 108, 301] } };

test("zones for your faction only, quests counted for your side, finished zones starred, next zone suggested", () => {
  const v = worldTracker({ zones, quests, profile: horde, names, continentOf });
  const all = v.continents.flatMap((c) => c.zones);
  assert.deepEqual(all.map((z) => z.name), ["Durotar", "The Barrens", "Ashenvale"], "Elwynn is Alliance-only");
  const d = all[0], b = all[1];
  assert.deepEqual([d.done, d.total, d.percent, d.mastered, d.visited, d.fit, d.band], [9, 10, 90, true, true, "done", "1-10"]);
  assert.deepEqual([b.done, b.total, b.inLog, b.mastered, b.fit, b.band], [1, 2, 1, false, "now", "10-20"], "the Alliance quest doesn't count");
  assert.equal(all[2].total, 0); assert.equal(all[2].fit, "later", "six levels above you");
  assert.deepEqual(v.totals, { zones: 3, visited: 2, mastered: 1, done: 10, total: 12 });
  assert.deepEqual(v.suggestion, { mapId: 1413, name: "The Barrens", left: 1 });
  assert.equal(v.continents[0].id, "kalimdor");
});

test("Alliance gets the same: their own zones and quests", () => {
  const v = worldTracker({ zones, quests, profile: { name: "Ann", level: 5, faction: "Alliance", history: { completedIdsKnown: true, completedIds: [200] } }, names, continentOf });
  const all = v.continents.flatMap((c) => c.zones);
  assert.deepEqual(all.map((z) => z.name), ["Elwynn Forest", "The Barrens", "Ashenvale"]);
  assert.equal(all.find((z) => z.name === "The Barrens").total, 2);
  assert.equal(all[0].mastered, false, "one quest is too few to call a zone finished");
});

test("without known finished quests nothing is starred and the page says why", () => {
  const v = worldTracker({ zones, quests, profile: { name: "New", level: 2, faction: "Horde" }, names, continentOf });
  assert.equal(v.completedKnown, false); assert.equal(v.totals.mastered, 0);
  assert.equal(worldTracker({ zones, quests, profile: null }).character, null);
  assert.equal(band(1), "1-10"); assert.equal(band(55), "50-60");
});

test("trail points carry their time so a replay can show deaths and level-ups as they happened", () => {
  let t = 1000;
  const s = new PlaySession({ now: () => t });
  s.observe({ characterHash: "a", level: 10, xpPercent: 10, position: { mapId: 1411, x: 0.1, y: 0.1 } });
  t = 2000; s.observe({ characterHash: "a", level: 10, xpPercent: 20, position: { mapId: 1411, x: 0.2, y: 0.2 } });
  const tr = s.trail(1411);
  assert.equal(tr.points.length, 2); assert.equal(tr.points[1][2], 2000);
});

test("Zones, replay and the share picture are wired; the picture handler accepts only PNG bytes", () => {
  assert.match(read("src/renderer/player-navigation.js"), /\["zones","Zones"\]/);
  assert.match(read("src/renderer/app.js"), /zones: WorldTrackerView\.page/);
  assert.match(read("src/renderer/index.html"), /<script src="world-tracker\.js"><\/script>/);
  assert.match(read("src/preload.cjs"), /worldTracker: \(\) => invoke\("worldTracker"\)/);
  const wm = read("src/renderer/world-map.js");
  assert.match(wm, /data-wm-act="replay"/); assert.match(wm, /data-wm-act="share"/); assert.match(wm, /api\.saveSharePicture/);
  const main = read("src/main.cjs");
  assert.match(main, /handle\("saveSharePicture"/); assert.match(main, /0x89, 0x50, 0x4e, 0x47/);
  assert.match(read("src/renderer/commands.js"), /name: "Zones"/);
});

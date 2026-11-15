"use strict";
// Smarter companion (0.47, roadmap 4.4): planning tools and the offline "tonight" answer.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { createPlannerTools } = require("../src/core/companion-planner.cjs");
const { createCompanionTools } = require("../src/core/companion-tools.cjs");
const { quickAnswer, tonightAnswer } = require("../src/core/quick-answers.cjs");

const views = {
  nextStep: () => ({ profileId: "a", step: { kind: "turnin", title: "Hand in Call of Water", detail: "To Islen Waterseer at 70.0, 70.0", dir: "south-east" } }),
  alts: () => ({ cards: [
    { name: "Vael", level: 20, active: true, className: "Hunter", faction: "Horde", xp: { percent: 45 }, rested: { percent: 80, full: false }, bags: { free: 2, total: 64 }, money: 123456, professions: [{ name: "Skinning", rank: 90, maxRank: 150 }], daysAway: 0 },
    { name: "Ann", level: 25, active: false, className: "Mage", faction: "Alliance", rested: { percent: 150, full: true }, bags: null, money: null, professions: [], daysAway: 9 },
  ], tonight: [{ name: "Ann", reasons: ["rested XP is full"] }, { name: "Vael", reasons: ["80% of a level in rested XP"] }] }),
  worldTracker: () => ({ completedKnown: true, totals: { zones: 3 }, suggestion: { mapId: 1413, name: "The Barrens", left: 14 }, continents: [{ id: "kalimdor", zones: [{ name: "The Barrens", min: 10, max: 25, fit: "now", done: 20, total: 34, inLog: 5, mastered: false }, { name: "Durotar", min: 1, max: 10, fit: "done", done: 30, total: 31, mastered: true }] }] }),
  characterSheet: () => ({ averageItemLevel: 18, equipmentKnown: true, missing: ["Neck"], weakest: [{ label: "Chest", item: { name: "Rag Vest", itemLevel: 5 } }], upgrades: [{ label: "Legs", item: { name: "Barbed Leggings" }, where: "bags" }], sets: [{ name: "Leveling" }] }),
  dungeonAtlas: () => ({ level: 20, caution: "Baseline levels", entries: [{ name: "Wailing Caverns", kind: "dungeon", levels: { min: 17, max: 24 }, difficulty: "right", zone: "The Barrens", bosses: [{ name: "Mutanus" }], pickUp: [{ title: "Leaders of the Fang" }] }, { name: "Stockades", kind: "dungeon", levels: { min: 22, max: 30 }, difficulty: "hard", bosses: [] }] }),
  playSession: () => ({ active: true, activeMinutes: 40, startLevel: 19, level: 20, levelsGained: 0.8, levelsPerHour: 1.2, minutesToLevel: 30, deaths: 1, zones: [1413] }),
};

test("plan_tonight gathers the next step, rested XP, pace, zone, dungeons, gear and the other characters in one call", () => {
  const t = createPlannerTools(views), p = t.call("plan_tonight");
  assert.equal(p.status, "ok");
  assert.deepEqual(p.nextStep, { kind: "turnin", what: "Hand in Call of Water", detail: "To Islen Waterseer at 70.0, 70.0", direction: "south-east", progress: null });
  assert.deepEqual(p.character, { name: "Vael", level: 20, levelPercent: 45, restedPercent: 80, restedFull: false, freeBagSlots: 2 });
  assert.equal(p.zoneToClear.name, "The Barrens");
  assert.deepEqual(p.dungeonsForYou.map((d) => d.name), ["Wailing Caverns"], "hard ones are left for get_dungeons");
  assert.equal(p.gear.upgradesInBags[0].item, "Barbed Leggings");
  assert.deepEqual(p.otherCharacters.map((o) => o.name), ["Ann"], "the active character isn't suggested to itself");
  assert.equal(p.session.levelsPerHour, 1.2);
  assert.equal(t.call("get_zone_progress").zones.length, 1, "only zones near your level");
  assert.equal(t.call("get_characters").characters[0].gold, 12);
  assert.equal(t.call("get_dungeons").dungeons.length, 2);
  assert.equal(t.call("nope").status, "invalid");
  assert.equal(createPlannerTools({ alts: () => { throw Error("x"); } }).call("get_characters").status, "unavailable", "a failing view is just unavailable");
});

test("the planning tools are offered only when the character is shared with the companion", async () => {
  const profile = { id: "a", name: "Vael", level: 20, className: "Hunter", faction: "Horde", quests: [] };
  const off = createCompanionTools({ profile, shareProfile: false, planner: views });
  assert.ok(!off.definitions.some((d) => d.name === "plan_tonight"));
  const on = createCompanionTools({ profile, shareProfile: true, planner: views });
  assert.ok(on.definitions.some((d) => d.name === "plan_tonight"));
  assert.match(on.instruction, /call plan_tonight first/);
  const r = JSON.parse(await on.call("plan_tonight", "{}"));
  assert.equal(r.status, "ok"); assert.match(on.trace[0].summary, /Planned tonight/);
});

test("without an AI model, 'what should I do tonight?' gets an ordered plan from the same facts", () => {
  const tools = createCompanionTools({ profile: { id: "a", name: "Vael", level: 20, quests: [] }, shareProfile: true, planner: views });
  const a = quickAnswer("What should I do tonight?", { tools });
  assert.equal(a.topic, "tonight");
  assert.match(a.text, /\*\*Tonight for Vael\*\* \(level 20, 45% through, 80% of a level rested\)/);
  const order = ["Empty your bags first", "Hand in Call of Water", "clear The Barrens: 14 quests left", "Wailing Caverns", "Barbed Leggings"].map((s) => a.text.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), a.text);
  assert.match(a.text, /Ann: rested XP is full/);
  assert.equal(quickAnswer("who should I play tonight", { tools }).topic, "tonight");
  assert.equal(tonightAnswer({ status: "ok", character: null }), null);
  assert.equal(quickAnswer("what should I do tonight", { tools: createCompanionTools({ profile: { id: "a", name: "V", level: 2 }, shareProfile: false, planner: views }) }), null, "not shared: no plan");
});

test("main exposes the page views to the planner by name", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  assert.match(main, /views\[name\] = fn;/);
  assert.match(main, /planner: Object\.fromEntries\(\["nextStep", "alts", "worldTracker", "characterSheet", "dungeonAtlas", "playSession"\]/);
});

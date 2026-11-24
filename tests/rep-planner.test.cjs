"use strict";
// Roadmap C10: reputation planner. Only what the data supports, each number with its source.
const test = require("node:test"), assert = require("node:assert/strict");
const { repPlan, pointsNeeded, rewardAmount, STARTS } = require("../src/core/rep-planner.cjs");
const { registerGearPlanning } = require("../src/core/gear-planning-ipc.cjs");

const BUILD = "1.60.1.70888";
const faction = (id, name, standing, value) => ({ id, name, standing, min: STARTS[standing], max: STARTS[standing + 1] ?? 43000, value });
const profile = (extra = {}) => ({ id: "p1", name: "Vael", className: "Priest", level: 52, faction: "Horde", race: "Undead", clientBuild: BUILD,
  history: { completedIdsKnown: true, completedIds: [30], recent: [{ id: 31, title: "Recent" }] }, quests: [{ id: 21, title: "Scourge Report", complete: true }],
  ledger: { bags: { seenAt: 1795000000, complete: true, items: [{ id: 14047, n: 45, name: "Runecloth" }] }, bank: { seenAt: 1794000000, complete: true, items: [{ id: 14047, n: 20 }, { id: 12840, n: 60, name: "Minion's Scourgestone" }] },
    reputations: { seenAt: 1795000000, factions: [faction(68, "Undercity", 5, 4200), faction(529, "Argent Dawn", 4, 100), faction(72, "Stormwind", 8, 42500), { id: 999, name: "Odd Bar", standing: 4, min: 0, max: 100, value: 40 }] } }, ...extra });
const quest = (id, title, factionId, reward, extra = {}) => ({ id, title, level: 50, minLevel: 45, givers: [], turnIns: [], objectives: [], rewards: { reputation: [{ factionId, ...reward }] }, ...extra });
const pack = () => ({ build: BUILD, items: { 14047: { id: 14047, name: "Runecloth" } },
  npcs: { "npc:5": { id: 5, kind: "npc", name: "Ralston Farnsley", positions: [{ mapId: 1458, x: 0.5, y: 0.5 }], side: "Horde" }, "npc:6": { id: 6, kind: "npc", name: "Clavicus Knavingham", positions: [], side: "Alliance" } },
  quests: {
    10: quest(10, "Additional Runecloth", 68, { tier: 3 }, { turnIns: [{ id: 5, kind: "npc" }], objectives: [{ type: "item", objectId: 14047, required: 20 }] }),
    11: quest(11, "A Donation of Runecloth", 68, { tier: 6 }, { objectives: [{ type: "item", objectId: 14047, required: 60 }] }),
    12: quest(12, "Errand for the Queen", 68, { tier: 5 }, { givers: [{ id: 5, kind: "npc" }] }),
    13: quest(13, "Exact Errand", 68, { tier: 0, amount: 325 }),
    14: quest(14, "Angry Errand", 68, { tier: -5 }),
    15: quest(15, "Stormwind Only", 68, { tier: 5 }, { givers: [{ id: 6, kind: "npc" }] }),
    16: quest(16, "Collect the Head", 68, { tier: 5 }, { objectives: [{ type: "item", objectId: 500, required: 1 }] }),
    17: quest(17, "Too High", 68, { tier: 7 }, { minLevel: 58 }),
    18: quest(18, "Alliance Flagged", 68, { tier: 5 }, { sides: ["Alliance"] }),
    20: quest(20, "Minion's Scourgestones", 529, { tier: 2 }, { objectives: [{ type: "item", objectId: 12840, required: 20 }] }),
    21: quest(21, "Scourge Report", 529, { tier: 4 }),
    30: quest(30, "Finished Once", 68, { tier: 5 }),
    31: quest(31, "Recent", 68, { tier: 5 }),
  } });
const FACTS = { 14047: { name: "Runecloth", classId: 7, bonding: null }, 12840: { name: "Minion's Scourgestone", classId: 15, bonding: null }, 500: { name: "Head of a Foe", classId: 12, bonding: "Quest item" } };
const itemFact = (id) => FACTS[id] || null;

test("reward amounts: the recorded amount is exact, a bare tier is the standard amount, losses are not gains", () => {
  assert.deepEqual(rewardAmount({ tier: 0, amount: 325 }), { amount: 325, exact: true });
  assert.deepEqual(rewardAmount({ tier: 3 }), { amount: 50, exact: false });
  assert.deepEqual(rewardAmount({ tier: 6 }), { amount: 150, exact: false });
  assert.equal(rewardAmount({ tier: -5 }), null);
  assert.equal(rewardAmount({ tier: 0, amount: -2500 }), null);
  assert.equal(rewardAmount({ tier: 0 }), null);
});

test("points needed: the next standing from the saved bar, further ones only on the classic scale", () => {
  assert.deepEqual(pointsNeeded(faction(68, "U", 5, 4200), 6), { need: 4800, basis: "saved-bar" });
  assert.deepEqual(pointsNeeded(faction(68, "U", 5, 4200), 8), { need: 37800, basis: "classic-scale" });
  assert.deepEqual(pointsNeeded(faction(68, "U", 5, 4200), 5), { need: 0, basis: "reached" });
  assert.deepEqual(pointsNeeded({ standing: 4, min: 0, max: 100, value: 40 }, 5), { need: 60, basis: "saved-bar" });
  assert.deepEqual(pointsNeeded({ standing: 4, min: 0, max: 100, value: 40 }, 7), { need: null, basis: "unknown" }, "an unusual bar is never extrapolated");
});

test("goods hand-ins show how many are needed and how many you hold in bags and bank", () => {
  const plan = repPlan(profile(), pack(), { factionId: 68, standing: 6, itemFact });
  assert.equal(plan.status, "available"); assert.equal(plan.need, 4800); assert.equal(plan.target.name, "Honored");
  assert.deepEqual(plan.handIns.map((h) => h.id), [10, 11], "the one you can hand in most often first");
  const cloth = plan.handIns[0];
  assert.equal(cloth.amount, 50); assert.equal(cloth.exact, false);
  assert.equal(cloth.handInsNeeded, 96); assert.equal(cloth.heldHandIns, 3);
  assert.deepEqual(cloth.items, [{ itemId: 14047, required: 20, name: "Runecloth", bags: 45, bank: 20, held: 65 }]);
  assert.deepEqual(cloth.itemsNeeded, [{ itemId: 14047, name: "Runecloth", total: 1920, missing: 1855 }]);
  assert.deepEqual(cloth.turnIn, { name: "Ralston Farnsley", zone: "Undercity" });
  assert.equal(plan.handIns[1].heldHandIns, 1);
  assert.ok(plan.notes.some((n) => /does not record which hand-ins repeat/.test(n)), "repeatability is said to be unknown");
  assert.equal(plan.dungeons.supported, false);
  assert.match(plan.dungeons.note, /no reputation per kill/);
});

test("quests are filtered to this character and summed; a quest-item quest is not a goods hand-in", () => {
  const plan = repPlan(profile(), pack(), { factionId: 68, standing: 6, itemFact });
  assert.deepEqual(plan.quests.map((q) => q.id), [13, 12, 16, 17], "exact and bigger first; a quest above your level last");
  assert.equal(plan.quests[0].exact, true); assert.equal(plan.quests[3].later, true);
  assert.deepEqual(plan.quests[1].giver, { name: "Ralston Farnsley", zone: "Undercity" });
  // 325 + 100 + 100 for the open quests, plus 50 + 150 for one hand-in of each kind.
  assert.deepEqual(plan.totals, { handIns: 2, quests: 4, openQuests: 3, questPoints: 725, questsExact: false, doneQuests: 2, questsCover: false });
  const alliance = repPlan(profile({ faction: "Alliance", race: "Human" }), pack(), { factionId: 68, standing: 6, itemFact });
  assert.ok(alliance.quests.some((q) => q.id === 15) && alliance.quests.some((q) => q.id === 18) && !alliance.quests.some((q) => q.id === 12));
});

test("saved log status leads, and without game data a hand-in is never guessed", () => {
  const dawn = repPlan(profile(), pack(), { factionId: 529, standing: 5, itemFact });
  assert.equal(dawn.quests[0].status, "turn-in");
  assert.equal(dawn.handIns[0].heldHandIns, 3, "60 stones in the bank cover three hand-ins of 20");
  assert.deepEqual(dawn.handIns[0].items[0], { itemId: 12840, required: 20, name: "Minion's Scourgestone", bags: 0, bank: 60, held: 60 });
  const blind = repPlan(profile(), pack(), { factionId: 68, standing: 6 });
  assert.deepEqual(blind.handIns, []);
  assert.ok(blind.quests.some((q) => q.id === 10), "listed as an ordinary quest instead");
  assert.ok(blind.notes.some((n) => /not in your game data/.test(n)));
});

test("it refuses to guess: no standings, no pick, exalted, another patch, unknown history", () => {
  assert.equal(repPlan({ id: "x" }, pack(), { factionId: 68 }).status, "unavailable");
  assert.equal(repPlan(profile(), pack(), {}).status, "choose");
  const done = repPlan(profile(), pack(), { factionId: 72, standing: 8, itemFact });
  assert.equal(done.need, 0); assert.equal(done.target, null); assert.deepEqual(done.handIns, []);
  const other = repPlan(profile({ clientBuild: "1.60.2.1" }), pack(), { factionId: 68, standing: 6, itemFact });
  assert.equal(other.need, 4800); assert.deepEqual(other.quests, []);
  assert.ok(other.notes.some((n) => /another patch/.test(n)));
  const carried = repPlan(profile({ clientBuild: "1.60.1.71037" }), pack(), { factionId: 68, standing: 6, itemFact });
  assert.equal(carried.reference, "carried"); assert.equal(carried.quests.length, 4);
  const odd = repPlan(profile(), pack(), { factionId: 999, standing: 7, itemFact });
  assert.equal(odd.need, null);
  const noHistory = repPlan(profile({ history: {} }), pack(), { factionId: 68, standing: 6, itemFact });
  assert.ok(noHistory.quests.some((q) => q.id === 30)); assert.ok(noHistory.notes.some((n) => /Finished quests are not known/.test(n)));
  const wrongSide = repPlan(profile({ faction: "Alliance" }), pack(), { factionId: 68, standing: 6, itemFact });
  assert.ok(wrongSide.notes.some((n) => /belongs to the Horde/.test(n)));
});

test("IPC: any saved character can be planned; bad faction or standing is refused", () => {
  const handlers = {}, state = { activeProfileId: "p2", profiles: [profile(), { id: "p2", name: "Other" }] };
  registerGearPlanning({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, gameData: { build: () => BUILD, items: (ids) => ids.map((id) => FACTS[id] || null) },
    statWeights: { get: () => null }, gearPins: { get: () => ({}) }, wishlist: { get: () => [] }, questPack: () => pack() });
  assert.equal(handlers.repPlanner("p1", 68, 6).handIns.length, 2);
  assert.equal(handlers.repPlanner("p1", null, null).status, "choose");
  assert.equal(handlers.repPlanner("p2", 68, 6).status, "unavailable");
  assert.throws(() => handlers.repPlanner("p1", 68, 9), /Invalid standing/);
  assert.throws(() => handlers.repPlanner("p1", "68", 6), /Invalid faction/);
  assert.throws(() => handlers.repPlanner("nobody", 68, 6), /Choose a character/);
});

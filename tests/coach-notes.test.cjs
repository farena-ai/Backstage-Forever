"use strict";
// Coach's notes after a session (A4): only evidence saved between two captures; no made-up praise.
const test = require("node:test"), assert = require("node:assert/strict");
const { coachNotes, beatenSplits, TIP_CHANGE } = require("../src/core/coach-notes.cjs");
const T = 1790000000, DAY = 86400, H = 3600;
const iso = (at) => new Date(at * 1000).toISOString();
const mapName = (id) => ({ 1436: "Westfall" })[id] || `Map ${id}`;
const day = (at) => `D${Math.round((at - T) / DAY)}`;
const profile = (over = {}) => ({ id: "a", name: "Aeralyn", className: "Mage", level: 14, source: { kind: "wow-addon", id: "s", updatedAt: iso(T + DAY) },
  journal: { levels: [{ level: 12, at: T - DAY, played: 50000 }, { level: 13, at: T + H, played: 54000 }, { level: 14, at: T + 5 * H, played: 60000 }] },
  history: { completedIdsKnown: true, completedIds: [1, 2, 3, 4], recent: [{ id: 3, completedAt: T + 2 * H }, { id: 4, completedAt: T + 3 * H }, { id: 3, completedAt: T + 3 * H + 5 }, { id: 2, completedAt: T - H }] }, ...over });
const previous = { savedAt: iso(T), level: 12, played: 52000, quests: 2, money: 50000 };
const current = { savedAt: iso(T + DAY), level: 14, played: 61000, quests: 4, money: 85000 };
const step = { title: "Hand in Red Silk Bandanas", detail: "To Scout Riell at 56.0, 47.5" };
const session = (over = {}) => ({ startedAt: (T + H) * 1000, endedAt: (T + 6 * H) * 1000, minutes: 240, deaths: 0, zones: [1436], ...over });

test("what went well lists only counted, dated evidence from between the two saves", () => {
  const other = { id: "b", name: "Bram", journal: { levels: [{ level: 12, at: 1, played: 1000 }, { level: 13, at: 2, played: 9000 }, { level: 14, at: 3, played: 12000 }] } };
  const runs = [{ instanceMap: 36, name: "The Deadmines", timed: true, startedAt: T + 4 * H, seconds: 2500, deaths: 0, personalBest: true, bosses: [{ at: T + 4 * H + 60 }, { at: T + 4 * H + 90 }] },
    { instanceMap: 36, name: "The Deadmines", timed: true, startedAt: T - 9 * DAY, seconds: 4000, deaths: 0, personalBest: false, bosses: [{ at: 5 }, { at: 6 }] }];
  const badges = [{ name: "Level 10", earned: true, at: T - 5 * DAY }, { name: "Into the depths", earned: true, at: T + 4 * H }, { name: "Not yet", earned: false, at: null }];
  const n = coachNotes(profile(), { previous, current, others: [other], sessions: [session()], runs, badges, step, mapName, day });
  assert.equal(n.status, "ok"); assert.equal(n.from, T); assert.equal(n.to, T + DAY);
  assert.deepEqual(n.wentWell.map((w) => w.kind), ["levels", "quests", "best", "best", "bosses", "badges", "gold"]);
  assert.equal(n.wentWell[0].text, "You gained 2 levels and reached level 14.");
  assert.equal(n.wentWell[1].text, "You handed in 2 quests.", "the same quest handed in twice counts once; older hand-ins do not count");
  assert.match(n.wentWell[2].text, /level 12 to 13 in 1h 07m of play, 1h 07m faster than your other characters/);
  assert.deepEqual(n.wentWell[2].card, { kind: "best", data: { level: 12, seconds: 4000, previousSeconds: 8000 } });
  assert.equal(n.wentWell[3].text, "Your fastest full run of The Deadmines: 42m.");
  assert.equal(n.wentWell[4].text, "You defeated 2 dungeon bosses in The Deadmines.");
  assert.equal(n.wentWell[5].text, "You earned the badge “Into the depths”."); assert.equal(n.wentWell[6].text, "You are 3 gold richer.");
  assert.equal(n.change, null); assert.match(n.nothingToChange, /Nothing in the saved data points at something to change/);
  assert.deepEqual(n.tomorrow, step); assert.deepEqual(n.facts, { sessions: 1, minutes: 240, deaths: 0, levels: 2, quests: 2 });
});

test("a personal best needs another time to beat: one character alone earns none, and neither does a first run", () => {
  assert.deepEqual(beatenSplits(profile(), [], [13, 14]), [], "with one character every level is trivially the fastest");
  const slower = { journal: { levels: [{ level: 12, played: 0 }, { level: 13, played: 100 }] } };
  assert.deepEqual(beatenSplits(profile(), [slower], [13]), [], "a slower time than another character is not a best");
  const n = coachNotes(profile(), { previous, current, sessions: [session()], runs: [{ instanceMap: 36, name: "The Deadmines", timed: true, startedAt: T + 4 * H, seconds: 2500, deaths: 0, personalBest: true, bosses: [{ at: T + 4 * H + 60 }] }], mapName, day });
  assert.ok(!n.wentWell.some((w) => w.kind === "best"), "the only run of a dungeon is not praised as a best");
});

test("exactly one thing to change, the strongest repeated problem first", () => {
  const base = { previous, current, sessions: [session({ deaths: 4 })], step, mapName, day };
  const at = (h) => (T + h * H) * 1000;
  const same = coachNotes(profile(), { ...base, deaths: [{ at: at(1), mapId: 1436, tip: 1, killer: "Defias Pillager" }, { at: at(2), mapId: 1436, tip: 1, killer: "Defias Pillager" }, { at: at(3), mapId: 1436, tip: 3 }] });
  assert.deepEqual(same.change, { kind: "death-killer", text: "Defias Pillager killed you 2 times.", advice: TIP_CHANGE[1] });
  const cause = coachNotes(profile(), { ...base, deaths: [{ at: at(1), mapId: 1436, tip: 3 }, { at: at(2), mapId: 12, tip: 3 }, { at: at(3), tip: 1 }, { at: (T - DAY) * 1000, tip: 1 }] });
  assert.equal(cause.change.kind, "death-cause"); assert.equal(cause.change.text, "2 of your 3 deaths had the same cause: an enemy well above your level.", "a death before the window is not counted");
  const place = coachNotes(profile(), { ...base, deaths: [{ at: at(1), mapId: 1436 }, { at: at(2), mapId: 1436 }] });
  assert.equal(place.change.text, "You died 2 times in Westfall.");
  const run = coachNotes(profile(), { ...base, sessions: [session()], runs: [{ instanceMap: 36, name: "The Deadmines", timed: true, startedAt: T + 4 * H, seconds: 2500, deaths: 3, personalBest: false, bosses: [] }] });
  assert.equal(run.change.text, "You died 3 times inside The Deadmines.");
  const loose = coachNotes(profile(), { ...base, deaths: [{ at: at(1), mapId: 1436 }] });
  assert.deepEqual([loose.change.kind, loose.change.text], ["deaths", "You died 4 times, with no repeated cause or place in what was saved."]);
  const once = coachNotes(profile(), { ...base, sessions: [session({ deaths: 1 })], deaths: [{ at: at(1), mapId: 1436, tip: 2 }] });
  assert.equal(once.change, null, "one death is not a pattern");
});

test("a trainer visit is due only for ranks that could not be learned at the last visit", () => {
  const training = { seenAt: T - 2 * H, services: [{ name: "Frostbolt", rank: "Rank 3", level: 14, cost: 900 }, { name: "Fireball", rank: "Rank 2", level: 12, cost: 500 }, { name: "Blink", level: 20, cost: 2000 }, { name: "Arcane Missiles", rank: "Rank 2", level: 13, cost: 700 }] };
  const n = coachNotes(profile({ ledger: { training } }), { previous, current, sessions: [session()], step, mapName, day });
  assert.equal(n.change.kind, "trainer");
  assert.equal(n.change.text, "Your trainer has 2 ranks you could not learn at your last visit on D0: Frostbolt (Rank 3), Arcane Missiles (Rank 2).", "level 12 ranks were already on offer then; level 20 is not yet");
  assert.equal(n.change.advice, "Visit your class trainer before you head out again.");
  const visited = coachNotes(profile({ ledger: { training: { ...training, seenAt: T + 6 * H } } }), { previous, current, sessions: [session()], step, mapName, day });
  assert.equal(visited.change, null, "nothing is due after a visit at the current level");
  const unknown = coachNotes(profile({ journal: { levels: [] }, ledger: { training } }), { previous, current, sessions: [session()], step, mapName, day });
  assert.equal(unknown.change, null, "without a dated level at the last visit nothing is claimed");
});

test("too little evidence is said plainly, and a first save promises nothing", () => {
  const quiet = profile({ journal: { levels: [] }, history: { completedIdsKnown: true, completedIds: [1, 2], recent: [] } });
  const little = coachNotes(quiet, { previous, current: { ...current, level: 12, quests: 2, money: 50000 }, step, mapName, day });
  assert.equal(little.status, "too-little"); assert.deepEqual(little.wentWell, []); assert.equal(little.change, null);
  assert.equal(little.message, "Too little was saved between D0 and D1 to say anything useful: no level, no quest handed in, no play session and no death.");
  assert.deepEqual(little.tomorrow, step, "tomorrow's step still stands: it is not praise");
  const first = coachNotes(profile(), { previous: null, current, step, mapName, day });
  assert.equal(first.status, "first-save"); assert.match(first.message, /this is the first one the app has kept/); assert.deepEqual(first.wentWell, []);
  const none = coachNotes({ id: "m", name: "Manual" }, { step: null, mapName, day });
  assert.equal(none.status, "no-save"); assert.equal(none.tomorrow, null); assert.match(none.noStepReason, /No next step can be worked out/);
  assert.equal(coachNotes(null), null);
  const onlyBad = coachNotes(quiet, { previous, current: { ...current, level: 12, quests: 2, money: 50000 }, sessions: [session({ deaths: 3 })], step, mapName, day });
  assert.equal(onlyBad.status, "ok"); assert.deepEqual(onlyBad.wentWell, []);
  assert.equal(onlyBad.nothingWell, "Nothing in the saved data counts as going well this time: no level, no quest handed in, no badge.", "no praise is invented");
});

test("counts fall back to the difference between captures when dates are missing", () => {
  const undated = profile({ journal: { levels: [] }, history: { completedIdsKnown: true, completedIds: [1, 2, 3, 4, 5], recent: [] } });
  const n = coachNotes(undated, { previous, current: { ...current, quests: 5 }, step, mapName, day });
  assert.deepEqual(n.wentWell.slice(0, 2).map((w) => w.text), ["You went from level 12 to level 14.", "You handed in 3 quests."]);
});

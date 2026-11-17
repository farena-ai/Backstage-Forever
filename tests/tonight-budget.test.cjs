"use strict";
// 1.4 (J16): a plan sized to the time you have.
const test = require("node:test"), assert = require("node:assert/strict");
const Q = require("../src/core/quick-answers.cjs");
const plan = { status: "ok", character: { name: "Grukash", level: 16, restedPercent: 40, freeBagSlots: 2 }, nextStep: { what: "Hand in Raptor Thieves", detail: "to Darsok", direction: "north-west" },
  zoneToClear: { name: "The Barrens", left: 12 }, dungeonsForYou: [{ name: "Wailing Caverns", levels: "17-24" }], gear: { upgradesInBags: [] }, session: { levelsPerHour: 1.2 } };

test("minutes from everyday phrasing", () => {
  for (const [q, m] of [["i have 90 minutes", 90], ["got an hour", 60], ["2 hours tonight", 120], ["half an hour", 30], ["an hour and a half", 90], ["1.5h", 90], ["what should i do", null]]) assert.equal(Q.minutesIn(q), m, q);
});
test("the plan fits the time: short sessions skip the dungeon, long ones include it", () => {
  const short = Q.tonightAnswer(plan, { minutes: 30 }).text;
  assert.match(short, /30 minutes for Grukash/);
  assert.doesNotMatch(short, /Wailing Caverns/);
  assert.match(short, /Empty your bags/);
  const long = Q.tonightAnswer(plan, { minutes: 120 }).text;
  assert.match(long, /Wailing Caverns/);
  assert.match(long, /about 2\.4 levels/);
  assert.match(Q.tonightAnswer(plan).text, /Tonight for Grukash/, "no budget: the usual plan");
});
test("asking with a time routes to the plan", () => {
  const tools = { lookup: () => plan };
  assert.match(Q.quickAnswer("I have 45 minutes, what should I do?", { tools }).text, /45 minutes for Grukash/);
  assert.equal(Q.quickAnswer("where is the 30 minutes quest", { tools })?.topic === "tonight", false);
});

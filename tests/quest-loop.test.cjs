"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { recommendSteps } = require("../src/core/next-step.cjs");
const { buildLoop, advanceLoop } = require("../src/core/quest-loop.cjs");

const point = (mapId, x, y, extra) => ({ mapId, mapName: mapId === 1413 ? "The Barrens" : "Durotar", x, y, ...extra });
const ready = (id, x, extra) => ({ id, title: `Hand-in ${id}`, turnIn: point(1413, x, .3, { name: "Quest giver", evidence: "verified-turn-in", ...extra }) });
const active = (id, x, mapId = 1413) => ({ id, title: `Quest ${id}`, where: point(mapId, x, .3, { evidence: "recorded-objective" }) });
const advice = ({ ready: r = [], active: a = [], completed = [] } = {}) => ({ status: "ok", character: { position: point(1413, .5, .3) }, log: { ready: r, active: a, completed, live: true } });

test("a useful stop beside the player beats a distant hand-in; pinning and dismissing adjust the order", () => {
  const data = advice({ ready: [ready(1, .88), ready(2, .52, { guess: true, evidence: "likely-quest-giver" })], active: [active(3, .51)] });
  assert.equal(recommendSteps(data)[0].questId, 3);
  assert.match(recommendSteps(data)[0].reason, /nearby/i);
  assert.equal(recommendSteps(data, { pinnedQuest: 1 })[0].questId, 1);
  assert.ok(recommendSteps(data, { hidden: ["quest:3"] }).every(step => step.questId !== 3));
  assert.equal(recommendSteps(data).find(step => step.questId === 2).evidence, "likely-quest-giver");
});

test("a route groups nearby trustworthy stops and only advances on positive quest observations", () => {
  const data = advice({ ready: [ready(1, .53), ready(6, .54, { guess: true, evidence: "likely-quest-giver" })], active: [active(2, .57), active(3, .60), active(4, .52, 1411), active(5, .93)] });
  const route = buildLoop(data);
  assert.deepEqual(route.stops.map(stop => stop.questId), [1, 2, 3]);
  assert.equal(advanceLoop(route, advice()).currentIndex, 0, "missing or abandoned quests are not completed");
  const advanced = advanceLoop(route, advice({ completed: [1], ready: [ready(2, .65)] }));
  assert.deepEqual(advanced.stops.map(stop => stop.done), [true, true, false]);
  assert.equal(advanced.currentIndex, 2);
  assert.equal(advanceLoop(advanced, advice()).currentIndex, 2, "transient evidence loss does not undo progress");
  assert.equal(advanceLoop(advanced, advice({ completed: [3] })).currentIndex, -1);
  assert.equal(buildLoop(advice({ active: [active(3, .51)] })), null);
});

test("a repeatable quest already in completion history cannot silently advance a new loop", () => {
  const data = advice({ ready: [ready(1, .51), ready(2, .53), ready(3, .55)], completed: [1] });
  const loop = buildLoop(data);
  assert.deepEqual(loop.stops.map(stop => stop.questId), [2, 3]);
  assert.equal(advanceLoop(loop, data).currentIndex, 0);
});

test("an older saved quest log cannot advance a loop started from live information", () => {
  const savedAt = "2026-11-28T11:00:00.000Z";
  const data = advice({ ready: [ready(1, .53)], active: [active(2, .57)] });
  data.character.savedAt = savedAt;
  const route = buildLoop(data);
  const fallback = { character: { savedAt }, log: { live: false, completed: [1], ready: [ready(2, .65)] } };
  assert.equal(advanceLoop(route, fallback).currentIndex, 0);
  assert.equal(advanceLoop(route, { ...fallback, log: { ...fallback.log, liveCompleted: [1] } }).currentIndex, 1);
  assert.equal(advanceLoop(route, { ...fallback, character: { savedAt: "2026-11-28T11:01:00.000Z" } }).currentIndex, -1);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { PlaySession, GAP_MS } = require("../src/core/play-session.cjs");

const frame = (o = {}) => ({ characterHash: 7, combat: false, dead: false, level: 10, xpPercent: 0, position: { mapId: 1411, x: 0.5, y: 0.5 }, ...o });

test("pace counts only active play and estimates time to level", () => {
  let t = 0;
  const s = new PlaySession({ now: () => t });
  for (let i = 0; i <= 30; i++) { t = i * 30000; s.observe(frame({ xpPercent: i, position: { mapId: 1411, x: 0.5 + i * 0.01, y: 0.5 } })); }
  // 15 minutes of play, 30% of a level: 1.2 levels/hour, 70% left -> 35 minutes.
  let sum = s.summary();
  assert.equal(sum.activeMinutes, 15);
  assert.equal(sum.levelsPerHour, 1.2);
  assert.equal(sum.minutesToLevel, 35);
  // A long break is not counted.
  t += GAP_MS * 20; s.observe(frame({ xpPercent: 30 }));
  assert.equal(s.summary().activeMinutes, 15);
});

test("level-ups and deaths become events with places, and the trail follows movement", () => {
  let t = 0;
  const s = new PlaySession({ now: () => t });
  s.observe(frame({ xpPercent: 90 }));
  t += 1000; s.observe(frame({ xpPercent: 95, position: { mapId: 1411, x: 0.51, y: 0.5 } }));
  t += 1000; const up = s.observe(frame({ level: 11, xpPercent: 2, position: { mapId: 1411, x: 0.52, y: 0.5 } }));
  assert.deepEqual(up.map((e) => [e.kind, e.level]), [["level", 11]]);
  t += 1000; const died = s.observe(frame({ level: 11, dead: true, position: { mapId: 1411, x: 0.53, y: 0.5 } }));
  assert.deepEqual(died.map((e) => e.kind), ["death"]);
  t += 1000; assert.deepEqual(s.observe(frame({ level: 11, dead: true })), [], "one death per death");
  t += 1000; s.observe(frame({ level: 11, position: { mapId: 1411, x: 0.5205, y: 0.5 } }));
  const tr = s.trail(1411);
  assert.equal(tr.points.length, 3, "tiny moves and ghost runs are not added");
  assert.equal(tr.deaths.length, 1); assert.equal(tr.levelUps[0].level, 11);
  const sum = s.summary();
  assert.equal(sum.deaths, 1); assert.equal(sum.levelsGained, 0.12); assert.deepEqual(sum.zones, [1411]);
  assert.deepEqual(s.trail(1454).points, []);
});

test("switching characters starts a new session; empty input is ignored", () => {
  const s = new PlaySession({ now: () => 0 });
  assert.deepEqual(s.observe(null), []);
  assert.equal(s.summary().active, false);
  s.observe(frame());
  s.observe(frame({ characterHash: 8, level: 30 }));
  assert.equal(s.summary().startLevel, 30);
});

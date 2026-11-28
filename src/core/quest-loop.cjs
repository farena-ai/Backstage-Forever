"use strict";

const { direction, recommendSteps } = require("./next-step.cjs");

const MAX_LEG = .24;
const TRUSTED = new Set(["verified-turn-in", "recorded-objective", "game-waypoint"]);

function buildLoop(advice, options) {
  const origin = advice?.character?.position;
  if (!origin || advice.character.dead) return null;
  const alreadyCompleted = new Set(advice.log?.completed);
  const near = recommendSteps(advice, options).filter(step => !alreadyCompleted.has(step.questId) && TRUSTED.has(step.evidence) && direction(origin, step.where)?.distance <= MAX_LEG);
  if (near.length < 2) return null;
  const stops = [{ ...near.shift(), done: false }];
  while (near.length && stops.length < 3) {
    const from = stops.at(-1).where;
    near.sort((a, b) => direction(from, a.where).distance - direction(from, b.where).distance);
    if (direction(from, near[0].where).distance > MAX_LEG) break;
    stops.push({ ...near.shift(), done: false });
  }
  return stops.length < 2 ? null : { mapId: origin.mapId, savedAtStart: advice.character.savedAt || null, stops, currentIndex: 0 };
}

function advanceLoop(loop, advice) {
  if (!loop || !advice?.log) return loop;
  const newerSave = Date.parse(advice.character?.savedAt) > (Date.parse(loop.savedAtStart) || 0);
  const freshLog = advice.log.live || newerSave;
  const completed = new Set(freshLog ? advice.log.completed || [] : advice.log.liveCompleted || []);
  const ready = new Set(freshLog ? (advice.log.ready || []).map(quest => quest.id) : []);
  const stops = loop.stops.map(stop => {
    const done = stop.done || completed.has(stop.questId) || (stop.kind === "objective" && ready.has(stop.questId));
    return done === stop.done ? stop : { ...stop, done };
  });
  return { ...loop, stops, currentIndex: stops.findIndex(stop => !stop.done) };
}

module.exports = { buildLoop, advanceLoop };

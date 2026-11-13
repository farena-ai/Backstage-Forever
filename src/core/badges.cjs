"use strict";
// Badges: milestones a character has earned, from its own saved data. Each badge says plainly
// what it's for and, when locked, what's left to earn it.
const { splits } = require("./journal-data.cjs");

const BADGES = [
  ...[10, 20, 30, 40, 50, 60].map((n) => ({ id: `level-${n}`, group: "Levels", name: `Level ${n}`, how: `Reach level ${n}.`, test: (c) => ({ done: c.level >= n, have: c.level, need: n }) })),
  ...[[25, "Errand runner"], [100, "Quest hero"], [500, "Living legend"]].map(([n, name]) => ({ id: `quests-${n}`, group: "Quests", name, how: `Complete ${n} quests.`, test: (c) => ({ done: c.quests >= n, have: c.quests, need: n }) })),
  ...[[5, "Wanderer"], [15, "Pathfinder"], [30, "World explorer"]].map(([n, name]) => ({ id: `explorer-${n}`, group: "Exploring", name, how: `Visit ${n} zones.`, test: (c) => ({ done: c.zones >= n, have: c.zones, need: n }) })),
  { id: "first-dungeon", group: "Firsts", name: "Into the depths", how: "Enter your first dungeon.", test: (c) => ({ done: c.firsts.has("dungeon") }) },
  { id: "first-flight", group: "Firsts", name: "Taking wing", how: "Take your first flight.", test: (c) => ({ done: c.firsts.has("flight") }) },
  { id: "first-mount", group: "Firsts", name: "Saddle up", how: "Ride your own mount.", test: (c) => ({ done: c.firsts.has("mount") }) },
  { id: "first-group", group: "Firsts", name: "Better together", how: "Join a group.", test: (c) => ({ done: c.firsts.has("group") }) },
  { id: "first-hearth", group: "Firsts", name: "Home again", how: "Use your Hearthstone.", test: (c) => ({ done: c.firsts.has("hearth") }) },
  { id: "first-rested", group: "Firsts", name: "Well rested", how: "Earn a rested bonus by logging out in an inn or city.", test: (c) => ({ done: c.firsts.has("rested") }) },
  { id: "first-death", group: "Firsts", name: "Back from the dead", how: "Die once (it happens to everyone) and run back.", test: (c) => ({ done: c.firsts.has("death") }) },
  { id: "speed", group: "Speed", name: "Fast learner", how: "Gain a level in under one hour of play.", test: (c) => ({ done: c.fastest !== null && c.fastest < 3600 }) },
];

function facts(profile) {
  const j = profile?.journal || {};
  const sp = splits(profile);
  return {
    level: Number(profile?.level) || 0,
    quests: profile?.history?.completedIdsKnown ? profile.history.completedIds.length : Number(profile?.history?.completedCount) || 0,
    zones: (j.zones || []).length,
    firsts: new Set((j.firsts || []).map((f) => f.key)),
    firstAt: new Map((j.firsts || []).map((f) => [f.key, f.at])),
    fastest: sp.length ? Math.min(...sp.map((s) => s.seconds)) : null,
  };
}
/** Every badge with earned/locked state and progress, plus a count. */
function badgesFor(profile) {
  const f = facts(profile);
  const list = BADGES.map((b) => {
    const r = b.test(f);
    const key = b.id.startsWith("first-") ? b.id.slice(6) : null;
    return { id: b.id, group: b.group, name: b.name, how: b.how, earned: Boolean(r.done), ...(r.need ? { progress: { have: Math.min(r.have, r.need), need: r.need } } : {}), ...(key && f.firstAt.get(key) ? { at: f.firstAt.get(key) } : {}) };
  });
  return { earned: list.filter((b) => b.earned).length, total: list.length, badges: list };
}
/** Rested planner: classic rules (5% of a level per 8 hours in an inn or city, up to 150%). */
function rested(profile) {
  const p = profile?.progress;
  if (!p || !Number.isFinite(p.max) || p.max <= 0) return null;
  const r = Number.isFinite(p.rested) ? p.rested : 0;
  const pct = Math.round((r / p.max) * 100);
  const capPct = 150, toCap = Math.max(0, capPct - pct);
  return { xp: r, percentOfLevel: pct, capPercent: capPct, hoursToCap: Math.ceil((toCap / 5) * 8), perNight: 5 };
}
module.exports = { badgesFor, rested, BADGES };

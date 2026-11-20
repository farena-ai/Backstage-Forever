"use strict";
// Desktop policy only. Route order is reference data, not a record of play.
const { savedBuild, reviewStatus } = require("./patch-impact.cjs");
const { ALIASES, RACES, raceBits } = require("./guided-route.cjs");
const MAX_SKIPS = 512;
const MAX_SAVE_AGE = 24 * 60 * 60 * 1000;
const point = (s) => Number.isSafeInteger(s.mapId) && s.mapId > 0 &&
  [s.x, s.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);

function recover({ route, profile, pack, skips = [], now = Date.now() }) {
  const result = { step: null, reason: null, map: null, fallback: null, skipped: [] };
  const stop = (reason) => ({ ...result, reason });
  if (!profile) return stop("no-character");
  // Keep the existing future/stale timestamp fallbacks below the build check.
  if (reviewStatus(savedBuild(profile, Infinity), pack ? [pack.build] : []) !== "reviewed") return stop("build");
  if (!["Alliance", "Horde"].includes(profile.faction) || (route && route.faction !== profile.faction)) return stop("route-side");
  const skip = new Set(skips.slice(0, MAX_SKIPS));
  result.skipped = route?.steps.filter((s) => skip.has(s.id)).map((s) => s.id) || [];
  const savedAt = Date.parse(profile.source.updatedAt);
  const elapsed = now - savedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return stop("unknown-save-time");
  if (elapsed >= MAX_SAVE_AGE) return stop("stale-save");
  result.freshUntil = savedAt + MAX_SAVE_AGE;

  const log = new Map((profile.quests || []).map((q) => [q.id, q]));
  const historyKnown = profile.history?.completedIdsKnown === true;
  const done = new Set(historyKnown ? profile.history.completedIds : []);
  const race = ALIASES[profile.race?.replace(/\s/g, "")] || profile.race;
  const compatible = (q) => q && (!q.sides?.length || q.sides.includes(profile.faction)) &&
    (!q.raceMask || (raceBits(q.raceMask) & RACES[race]) !== 0);
  const referenceMatches = (q, saved) => q && (profile.locale && profile.locale !== "enUS" || q.title === saved.title);
  const fallback = () => {
    const saved = [...log.values()].filter((q) => compatible(pack.quests[q.id]) && referenceMatches(pack.quests[q.id], q))
      .sort((a, b) => a.id - b.id)[0];
    return saved ? { id: saved.id, title: saved.title } : null;
  };
  const blocked = (reason) => ({ ...stop(reason), fallback: fallback() });
  if (!route) return blocked("no-route");

  const past = (s) => {
    if (s.kind === "travel") return profile.location?.mapId === s.mapId || profile.level >= s.level + 5;
    // Age out old absent steps without treating them as completed. Never age out a current quest.
    const settled = (id) => !log.has(id) && (done.has(id) || profile.level >= s.level + 5);
    if (s.kind === "pickup") return s.ids.every((id) => log.has(id) || settled(id));
    if (s.kind === "class") return s.ids.some((id) => log.has(id) || done.has(id)) || profile.level >= s.level + 2;
    if (s.kind === "objective") return s.ids.every((id) => log.get(id)?.complete || settled(id));
    return s.ids.every(settled);
  };
  const index = route.steps.findIndex((s) => !skip.has(s.id) && !past(s));
  if (index < 0) return blocked("end");
  const s = route.steps[index];
  result.step = { ...s, index };
  if (s.kind === "travel") return blocked("travel");
  const ids = s.ids.filter((id) => !done.has(id) || log.has(id));
  if (ids.some((id) => !pack.quests[id])) return blocked("reference");
  if (ids.some((id) => !compatible(pack.quests[id]))) return blocked("quest-side");
  if (!point(s)) return blocked("missing-location");
  if (s.kind === "pickup" || s.kind === "class") {
    if (ids.some((id) => pack.quests[id].minLevel > profile.level)) return blocked("level");
    if (!historyKnown) return blocked("unknown-history");
    if (Object.values(pack.quests).some((q) => ids.includes(q.nextQuestId) && !done.has(q.id))) return blocked("prerequisite");
    return blocked("unconfirmed-pickup");
  }
  const id = ids.length === 1 ? ids[0] : null;
  const saved = log.get(id);
  if (!saved) return blocked("not-in-log");
  if (!referenceMatches(pack.quests[id], saved)) return blocked("reference");
  if (s.kind === "turnin" && !saved.complete) return blocked("not-ready");
  return { ...result, quest: { id, title: saved.title }, map: { questId: id, profileId: profile.id, mapId: s.mapId, x: s.x, y: s.y } };
}

module.exports = { recover, MAX_SKIPS };

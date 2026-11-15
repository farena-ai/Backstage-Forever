"use strict";
// World tracker (0.46, roadmap 3.2): every zone from 1 to 60 for your faction, coloured by its
// level band, with "Durotar 18/22 quests" progress and a badge for zones you've finished.
// Pure: the leveling pack's zones, the quest index by giver zone and one saved profile.
const BANDS = [[1, 10, "1-10"], [10, 20, "10-20"], [20, 30, "20-30"], [30, 40, "30-40"], [40, 50, "40-50"], [50, 61, "50-60"]];
const MASTERED = 0.9, MIN_QUESTS = 5;
const band = (min) => (BANDS.find(([lo, hi]) => min >= lo && min < hi) || BANDS[BANDS.length - 1])[2];

function fitFor(zone, level) {
  if (!Number.isInteger(level)) return "unknown";
  if (level > zone.max) return "done";
  if (level >= zone.min) return "now";
  return zone.min - level <= 4 ? "soon" : "later";
}

/**
 * zones: [{ mapId, min, max, faction }] from the leveling pack; quests: Map mapId -> [{ q }];
 * profile: the saved character; names: mapId -> name; continentOf: mapId -> "kalimdor" | ...
 */
function worldTracker({ zones, quests, profile, names = {}, continentOf = () => "world" }) {
  const faction = profile?.faction === "Horde" || profile?.faction === "Alliance" ? profile.faction : null;
  const known = Boolean(profile?.history?.completedIdsKnown);
  const done = new Set(known ? profile.history.completedIds : []);
  const inLog = new Set((profile?.quests || []).map((q) => q.id));
  const visited = new Set(profile?.journal?.zones || []);
  const level = Number.isInteger(profile?.level) ? profile.level : null;
  const rows = [];
  for (const z of zones || []) {
    if (faction && z.faction !== "Contested" && z.faction !== faction) continue;
    const list = (quests.get(z.mapId) || []).map(({ q }) => q).filter((q) => !faction || !q.sides?.length || q.sides.includes(faction));
    const total = list.length, finished = list.filter((q) => done.has(q.id)).length, active = list.filter((q) => inLog.has(q.id)).length;
    rows.push({
      mapId: z.mapId, name: names[z.mapId] || `Map ${z.mapId}`, min: z.min, max: z.max, faction: z.faction, band: band(z.min),
      continent: continentOf(z.mapId), total, done: finished, inLog: active, percent: total ? Math.round((finished / total) * 100) : 0,
      mastered: known && total >= MIN_QUESTS && finished / total >= MASTERED, visited: visited.has(z.mapId), fit: fitFor(z, level),
    });
  }
  rows.sort((a, b) => a.min - b.min || a.max - b.max || a.name.localeCompare(b.name));
  const continents = [];
  for (const r of rows) { let c = continents.find((x) => x.id === r.continent); if (!c) continents.push((c = { id: r.continent, zones: [] })); c.zones.push(r); }
  const next = rows.filter((r) => r.fit === "now" && r.total > r.done).sort((a, b) => (b.total - b.done) - (a.total - a.done))[0] || null;
  return {
    character: profile ? { name: profile.name, level, faction } : null, completedKnown: known, continents,
    totals: { zones: rows.length, visited: rows.filter((r) => r.visited).length, mastered: rows.filter((r) => r.mastered).length, done: rows.reduce((s, r) => s + r.done, 0), total: rows.reduce((s, r) => s + r.total, 0) },
    suggestion: next ? { mapId: next.mapId, name: next.name, left: next.total - next.done } : null,
  };
}
module.exports = { worldTracker, band, BANDS };

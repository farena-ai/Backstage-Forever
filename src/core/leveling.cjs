"use strict";
// Leveling advisor: where to level next, which quests to grab there, and when to train.
// Combines a small reviewed zone table (data/forever-leveling) with quests observed in play,
// which override the table where they exist. Everything is local; nothing is fetched.
const fs = require("node:fs");
const path = require("node:path");
const { MAP_NAMES } = require("./companion-tools.cjs");

const mapName = (id) => MAP_NAMES[id] || `Map ${id}`;
const WINDOW_BELOW = 3, WINDOW_ABOVE = 2;
// Kalimdor zones and cities; everything else in the table is the Eastern Kingdoms.
const KALIMDOR = new Set([1411, 1412, 1413, 1414, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457]);
const continent = (mapId) => (KALIMDOR.has(mapId) ? "kalimdor" : "eastern-kingdoms");

function loadLevelingPack(file = path.join(__dirname, "..", "..", "data", "forever-leveling", "pack.json")) {
  const pack = JSON.parse(fs.readFileSync(file, "utf8"));
  validateLevelingPack(pack);
  return pack;
}
function validateLevelingPack(pack) {
  const fail = (m) => { throw Error(`Invalid leveling pack: ${m}`); };
  if (!pack || pack.schemaVersion !== 1 || pack.kind !== "backstage-leveling" || !Array.isArray(pack.zones)) fail("header");
  const seen = new Set();
  for (const z of pack.zones) {
    if (!Number.isSafeInteger(z.mapId) || !MAP_NAMES[z.mapId]) fail(`unknown map ${z.mapId}`);
    if (seen.has(z.mapId)) fail(`duplicate ${z.mapId}`);
    seen.add(z.mapId);
    if (!Number.isInteger(z.min) || !Number.isInteger(z.max) || z.min < 1 || z.max > 60 || z.min >= z.max) fail(`levels ${z.mapId}`);
    if (!["Horde", "Alliance", "Contested"].includes(z.faction)) fail(`faction ${z.mapId}`);
    for (const [f, towns] of Object.entries(z.towns || {})) if (!["Horde", "Alliance"].includes(f) || !Array.isArray(towns) || towns.some((t) => typeof t !== "string" || !t)) fail(`towns ${z.mapId}`);
  }
  return true;
}

// Quest givers grouped by the zone they stand in (first known position), built once.
function questIndex(pack) {
  const byMap = new Map();
  for (const q of Object.values(pack?.quests || {})) {
    if (!q.level || !q.givers?.length) continue;
    const g = q.givers.find((r) => r.kind === "npc") || q.givers[0];
    const n = pack.npcs?.[`${g.kind}:${g.id}`];
    const p = n?.positions?.[0];
    if (!p) continue;
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId).push({ q, giver: { npcId: n.id, name: n.name, x: p.x, y: p.y } });
  }
  return byMap;
}

// The densest spot among points: where most of a zone's quests for you start.
function hubOf(points) {
  let best = null, bestN = -1;
  for (const a of points) {
    const near = points.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.06);
    if (near.length > bestN) { bestN = near.length; best = { x: near.reduce((s, p) => s + p.x, 0) / near.length, y: near.reduce((s, p) => s + p.y, 0) / near.length, count: near.length }; }
  }
  return best;
}

class LevelingAdvisor {
  constructor({ getState, knowledge, insights, pack = null, getLive = null }) {
    this.getState = getState;
    this.getLive = getLive; // () => live frame bound to the selected character, or null
    this.knowledge = knowledge;
    this.insights = insights;
    this.pack = pack || loadLevelingPack();
    this._quests = null;
  }
  quests() { return (this._quests ||= questIndex(this.knowledge?.bundled?.pack || null)); }
  profile(profileId) { const s = this.getState(); return s.profiles.find((p) => p.id === (profileId || s.activeProfileId)) || null; }

  fit(zone, level) {
    if (level > zone.max) return "done";
    if (level >= zone.min && level <= zone.max - 1) return "now";
    if (level < zone.min && zone.min - level <= 4) return "soon";
    return level < zone.min ? "later" : "done";
  }
  // Quests a character can actually pick up in a zone right now.
  available(mapId, profile) {
    const level = profile.level, faction = profile.faction || null;
    const active = new Set((profile.quests || []).map((q) => q.id));
    const done = new Set(profile.history?.completedIdsKnown ? profile.history.completedIds : []);
    return (this.quests().get(mapId) || []).filter(({ q }) =>
      !active.has(q.id) && !done.has(q.id) &&
      (!q.minLevel || q.minLevel <= level) && q.level >= level - WINDOW_BELOW && q.level <= level + WINDOW_ABOVE &&
      (!faction || !q.sides?.length || q.sides.includes(faction)));
  }
  observedBand(mapId) {
    const lv = (this.quests().get(mapId) || []).filter(({ q }) => q.observedInPlay).map(({ q }) => q.level).sort((a, b) => a - b);
    if (lv.length < 8) return null;
    return { min: lv[Math.floor(lv.length * 0.1)], max: lv[Math.floor(lv.length * 0.9)], quests: lv.length };
  }

  advise(profileId) {
    let p = this.profile(profileId);
    if (!p) return { status: "no-character" };
    if (!Number.isInteger(p.level) || p.level < 1) return { status: "no-level", name: p.name };
    let live = null;
    try { live = this.getLive?.() || null; } catch {}
    const level = Math.max(p.level, Number.isInteger(live?.level) ? live.level : 0), faction = p.faction === "Horde" || p.faction === "Alliance" ? p.faction : null;
    const where = live?.position ? { mapId: live.position.mapId, x: live.position.x, y: live.position.y } : p.location;
    const here = Number.isSafeInteger(where?.mapId) ? where.mapId : null;
    // Live quest pages (addon 0.25+) beat the last save: quests turned in since then are done,
    // and the log is exactly what's in the game right now.
    const pack = this.knowledge?.bundled?.pack || null;
    const liveLog = Array.isArray(live?.questLog) ? live.questLog : null;
    const turnedIn = Array.isArray(live?.turnedIn) ? live.turnedIn : [];
    const saved = p.history?.completedIdsKnown ? p.history.completedIds : [];
    const done = new Set([...saved, ...turnedIn]);
    let quests = p.quests || [];
    if (liveLog) {
      const byId = new Map(quests.map((q) => [q.id, q]));
      quests = liveLog.map((e) => { const q = byId.get(e.id); return q ? { ...q, complete: e.complete } : { id: e.id, title: pack?.quests?.[e.id]?.title || `Quest ${e.id}`, complete: e.complete, objectives: [] }; });
    } else quests = quests.filter((q) => !done.has(q.id));
    const history = { ...(p.history || {}), completedIds: [...done], completedIdsKnown: Boolean(p.history?.completedIdsKnown || turnedIn.length) };
    const justDone = turnedIn.slice(0, 5).map((id) => ({ id, title: pack?.quests?.[id]?.title || (p.quests || []).find((q) => q.id === id)?.title || `Quest ${id}` }));
    p = { ...p, level, location: where, quests, history };
    const zones = [];
    for (const z of this.pack.zones) {
      if (faction && z.faction !== "Contested" && z.faction !== faction) continue;
      const band = this.observedBand(z.mapId);
      const range = band ? { min: Math.max(1, Math.min(z.min, band.min)), max: Math.max(z.max, band.max), observed: true } : { min: z.min, max: z.max, observed: false };
      const fit = this.fit(range, level);
      if (fit === "later" || fit === "done") continue;
      const avail = this.available(z.mapId, p);
      const towns = (faction ? z.towns?.[faction] : Object.values(z.towns || {}).flat()) || [];
      const hub = hubOf(avail.map((a) => a.giver));
      // Quests on offer matter most; then staying close (same zone, same continent); then the band's middle.
      let score = (fit === "now" ? 10 : 2) + Math.min(avail.length, 10) + Math.log2(1 + avail.length) * 2 - Math.abs((range.min + range.max) / 2 - level) * 0.3;
      if (z.mapId === here) score += 4;
      else if (here && continent(here) === continent(z.mapId)) score += 3;
      if (z.starter) {
        const own = z.starter.some((r) => r.toLowerCase() === String(p.race || "").toLowerCase());
        // Another race's starting area is a long trip for a new character: never suggest it before level 10.
        if (!own && p.race && level < 10 && z.mapId !== here) continue;
        score += own ? 6 : -4;
      }
      if (faction && !towns.length) score -= 3; // nowhere friendly to hand quests in
      zones.push({
        mapId: z.mapId, name: mapName(z.mapId), min: range.min, max: range.max, observedLevels: range.observed, fit, towns,
        available: avail.length, hub: hub && { x: +hub.x.toFixed(4), y: +hub.y.toFixed(4), quests: hub.count },
        quests: avail.sort((a, b) => a.q.level - b.q.level).slice(0, 8).map(({ q, giver }) => ({ id: q.id, title: q.title, level: q.level, giver: giver.name, npcId: giver.npcId, x: giver.x, y: giver.y })),
        score: +score.toFixed(2),
      });
    }
    zones.sort((a, b) => b.score - a.score);
    const next = zones.find((z) => z.fit === "now") || zones[0] || null;
    // Alternatives with nothing recorded are noise unless nothing else exists.
    const shown = zones.filter((z, i) => i === 0 || z.available > 0);
    return {
      status: "ok",
      character: { savedAt: p.source?.updatedAt || null, name: p.name, level, faction, className: p.className || null, race: p.race || null, zone: here ? mapName(here) : null, live: Boolean(live?.position), xp: p.progress && Number.isFinite(p.progress.max) && p.progress.max > 0 ? { current: p.progress.current, max: p.progress.max, rested: Number.isFinite(p.progress.rested) ? p.progress.rested : 0, savedLevel: p.level } : null, xpPercent: Number.isFinite(live?.xpPercent) ? live.xpPercent : null, dead: Boolean(live?.dead), position: where && Number.isFinite(where.x) ? { mapId: where.mapId, x: where.x, y: where.y } : null },
      next: next && { ...next, why: this.why(next, p, here) },
      zones: (shown.length ? shown : zones).slice(0, 6),
      training: this.training(p),
      log: { ...this.log(p), justDone, live: Boolean(liveLog) },
      source: this.pack.source,
    };
  }
  // Your quest log in "where do I go" terms: hand-ins with the NPC's spot, then open quests.
  log(p) {
    const pack = this.knowledge?.bundled?.pack || null;
    const spot = (ref) => { const n = ref && pack?.npcs?.[`${ref.kind}:${ref.id}`]; const pos = n?.positions?.[0]; return n ? { name: n.name, npcId: n.id, mapId: pos?.mapId ?? null, mapName: pos ? mapName(pos.mapId) : null, x: pos?.x ?? null, y: pos?.y ?? null } : null; };
    const ready = [], active = [];
    for (const q of p.quests || []) {
      const rec = pack?.quests?.[q.id] || null;
      // Without a recorded hand-in NPC, quests usually go back to whoever gave them.
      if (q.complete) { const t = spot(rec?.turnIns?.[0]); const g = t ? null : spot(rec?.givers?.[0]); ready.push({ id: q.id, title: q.title, level: rec?.level ?? null, turnIn: t || (g && { ...g, guess: true }) }); }
      else {
        const objs = q.objectives || [];
        const loc = rec?.objectiveLocations?.find((o) => !objs[o.index - 1]?.done)?.positions?.[0] || null;
        active.push({ id: q.id, title: q.title, level: rec?.level ?? null, done: objs.filter((o) => o.done).length, total: objs.length,
          next: objs.find((o) => !o.done)?.text || null, where: loc ? { mapId: loc.mapId, mapName: mapName(loc.mapId), x: loc.x, y: loc.y } : null });
      }
    }
    const here = p.location?.mapId;
    const near = (w) => (here != null && w?.mapId === here ? Math.hypot((w.x ?? 0) - (p.location.x ?? 0), (w.y ?? 0) - (p.location.y ?? 0)) : 9);
    ready.sort((a, b) => near(a.turnIn) - near(b.turnIn));
    active.sort((a, b) => near(a.where) - near(b.where) || (a.level ?? 99) - (b.level ?? 99));
    return { inLog: (p.quests || []).length, ready, active };
  }
  why(z, p, here) {
    const parts = [];
    if (z.mapId === here) parts.push("you're already here");
    parts.push(`levels ${z.min}–${z.max}${z.observedLevels ? " (seen in play)" : ""}`);
    if (z.available) parts.push(`${z.available} quest${z.available === 1 ? "" : "s"} for your level`);
    if (z.towns.length) parts.push(`base: ${z.towns[0]}`);
    return parts.join(" · ");
  }
  // Class training: what's new for you now, and when the next batch comes.
  training(p) {
    if (!p.className) return null;
    const title = `${p.className} trainer`.toLowerCase();
    const sameClass = (this.insights?.trainers || []).filter((t) => String(t.title || "").toLowerCase() === title);
    const trainers = sameClass.filter((t) => !p.faction || !t.observedReactionsByFaction || (t.observedReactionsByFaction[p.faction] || []).some((r) => r >= 4));
    if (!trainers.length) return { className: p.className, trainer: null, newNow: [], nextAt: null, nextSpells: [], spellsFromOtherTrainers: false };
    const here = p.location;
    const dist = (t) => { const pos = t.positions?.[0]; if (!pos) return 99; return pos.mapId === here?.mapId ? Math.hypot(pos.x - here.x, pos.y - here.y) : 10; };
    const t = [...trainers].sort((a, b) => dist(a) - dist(b))[0];
    // Union of spells across this class's trainers (each one only lists what was observed).
    const levelled = (rows) => {
      const spells = new Map();
      for (const tr of rows) for (const s of tr.services || []) { const k = `${s.name}|${s.rankText || ""}`; if (!spells.has(k) || (s.observedLevel || 0) > (spells.get(k).level || 0)) spells.set(k, { name: s.name, rank: s.rankText || null, level: s.observedLevel || 0, spellId: s.spellId || null }); }
      return [...spells.values()].filter((s) => s.level > 0);
    };
    // Class spells are class-wide: when your faction's trainers have no recorded spell levels,
    // borrow the list from any same-class trainer but keep your faction's trainer as the place to go.
    let all = levelled(trainers), spellsFromOtherTrainers = false;
    if (!all.length) { all = levelled(sameClass); spellsFromOtherTrainers = all.length > 0; }
    const newNow = all.filter((s) => s.level <= p.level && s.level >= p.level - 1).sort((a, b) => a.name.localeCompare(b.name));
    const nextAt = all.filter((s) => s.level > p.level).reduce((m, s) => Math.min(m, s.level), Infinity);
    const pos = t.positions?.[0];
    return {
      className: p.className,
      trainer: { npcId: t.id, name: t.name, title: t.title, mapId: pos?.mapId ?? null, mapName: pos ? mapName(pos.mapId) : null, x: pos?.x ?? null, y: pos?.y ?? null },
      newNow, nextAt: Number.isFinite(nextAt) ? nextAt : null,
      nextSpells: Number.isFinite(nextAt) ? all.filter((s) => s.level === nextAt).map((s) => ({ name: s.name, rank: s.rank })) : [],
      // Trainer planner: the next three training levels and what each brings.
      upcoming: [...new Set(all.filter((s) => s.level > p.level).map((s) => s.level))].sort((a, b) => a - b).slice(0, 3)
        .map((lv) => ({ level: lv, spells: all.filter((s) => s.level === lv).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ name: s.name, rank: s.rank, spellId: s.spellId })) })),
      spellsFromOtherTrainers,
    };
  }
}

module.exports = { LevelingAdvisor, loadLevelingPack, validateLevelingPack, hubOf };

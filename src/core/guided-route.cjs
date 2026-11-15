"use strict";
// Guided route (0.50, roadmap 4.1): one step-by-step leveling route per starting zone, built from
// the bundled, source-labelled quest data and then hand-reviewed (data/forever-route/reviews.json).
// Pure. Each route runs zone by zone in level order: pick up what the giver has for you, do the
// objectives we know an area for, hand in, each phase walked nearest-first. It goes as far as the
// data does; the in-game zone guide and Now's "Where to level" take over after that.
const { MAP_NAMES } = require("./companion-tools.cjs");
const KALIMDOR = new Set([1411, 1412, 1413, 1414, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457]);
const continent = (m) => (KALIMDOR.has(m) ? "K" : "E");
const name = (m) => MAP_NAMES[m] || `Map ${m}`;
const BELOW = 4, ABOVE = 2, MIN_ZONE_QUESTS = 3, MERGE = 0.012;
// Race bits in the quest data's race mask (low 32 bits), and where each race starts.
const RACES = { Human: 0x1, Orc: 0x2, Dwarf: 0x4, "Night Elf": 0x8, Undead: 0x10, Tauren: 0x20, Gnome: 0x40, Troll: 0x80 };
const ALIASES = { Scourge: "Undead", NightElf: "Night Elf" };
const raceBits = (mask) => (typeof mask === "string" && /^[0-9a-f]{16}$/i.test(mask) ? parseInt(mask.slice(8), 16) >>> 0 : 0xffffffff);
const singleRace = (mask) => { const b = raceBits(mask); return b !== 0 && (b & (b - 1)) === 0; };

function spot(pack, ref) {
  const n = ref && pack.npcs?.[`${ref.kind}:${ref.id}`];
  const p = n?.positions?.[0];
  return n && p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { npc: n.name, mapId: p.mapId, x: p.x, y: p.y } : null;
}
function questsByZone(pack, faction, race = null) {
  const by = new Map(), bit = race ? RACES[race] : 0;
  for (const q of Object.values(pack.quests || {})) {
    if (!q.level || (q.sides?.length && !q.sides.includes(faction))) continue;
    if (bit && !(raceBits(q.raceMask) & bit)) continue;
    const g = spot(pack, q.givers?.find((r) => r.kind === "npc") || q.givers?.[0]);
    if (!g) continue;
    const t = spot(pack, q.turnIns?.find((r) => r.kind === "npc") || q.turnIns?.[0]);
    const o = (q.objectiveLocations || []).map((l) => l.positions?.[0]).find((p) => p && Number.isFinite(p.x) && p.mapId === g.mapId) || null;
    const row = { id: q.id, title: q.title, level: q.level, minLevel: q.minLevel || 1, giver: g, turnIn: t, objective: o, single: singleRace(q.raceMask) };
    if (!by.has(g.mapId)) by.set(g.mapId, []);
    by.get(g.mapId).push(row);
  }
  return by;
}
/** Nearest-first walk from (x, y) over items with { x, y }. */
function walk(items, from) {
  const pool = items.slice(), out = [];
  let cx = from?.x ?? 0.5, cy = from?.y ?? 0.5;
  while (pool.length) {
    let best = 0, bd = Infinity;
    pool.forEach((p, i) => { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = i; } });
    const p = pool.splice(best, 1)[0]; out.push(p); cx = p.x; cy = p.y;
  }
  return out;
}
const pickupText = (s) => (s.quests.length > 1 ? `Pick up ${s.quests.length} quests from ${s.npc}: ${s.quests.slice(0, 3).map((q) => q.title).join(", ")}${s.quests.length > 3 ? "…" : ""}` : `Pick up “${s.quests[0].title}” from ${s.npc}`);

/** One wave: pick-ups (merged per giver), objectives, hand-ins, each walked nearest-first. */
function wave(quests, mapId, from) {
  const picks = [], steps = [];
  // Class quests: a giver offering three or more one-race quests at the same level (the class
  // tablets and letters). Without class data they become one step: take the one for your class.
  const classy = new Set();
  const groups = new Map();
  for (const q of quests) if (q.single) { const k = q.giver.npc + "|" + q.level; groups.set(k, [...(groups.get(k) || []), q]); }
  const CLASSY = /\b(Letter|Tablet|Note|Rune|Sigil|Scroll|Parchment|Glyphs?)\b/;
  for (const g of groups.values()) if (g.length >= 3 || g.every((q) => CLASSY.test(q.title))) {
    for (const q of g) classy.add(q.id);
    steps.push({ kind: "class", ids: g.map((q) => q.id), text: `Talk to ${g[0].giver.npc}: take the quest for your class, if they have one`, npc: g[0].giver.npc, mapId, x: g[0].giver.x, y: g[0].giver.y, level: g[0].level });
  }
  quests = quests.filter((q) => !classy.has(q.id));
  if (!from) { const low = quests.slice().sort((a, b) => a.level - b.level)[0]; if (low) from = low.giver; }
  for (const q of quests) {
    const near = picks.find((p) => p.npc === q.giver.npc && Math.hypot(p.x - q.giver.x, p.y - q.giver.y) <= MERGE);
    if (near) near.quests.push(q); else picks.push({ kind: "pickup", npc: q.giver.npc, mapId, x: q.giver.x, y: q.giver.y, quests: [q] });
  }
  steps.push(...walk(picks, from).map((p) => ({ kind: "pickup", ids: p.quests.map((q) => q.id), text: pickupText(p), npc: p.npc, mapId, x: p.x, y: p.y, level: Math.min(...p.quests.map((q) => q.level)) })));
  const last = () => steps[steps.length - 1] || from;
  const objs = walk(quests.filter((q) => q.objective).map((q) => ({ ...q.objective, q })), last());
  for (const o of objs) steps.push({ kind: "objective", ids: [o.q.id], text: `“${o.q.title}”: do the objectives around here`, mapId, x: o.x, y: o.y, level: o.q.level });
  const turns = walk(quests.filter((q) => q.turnIn).map((q) => ({ ...q.turnIn, q })), last());
  for (const t of turns) steps.push({ kind: "turnin", ids: [t.q.id], text: `Hand in “${t.q.title}” to ${t.npc}`, npc: t.npc, mapId: t.mapId, x: t.x, y: t.y, level: t.q.level });
  return steps;
}

/** A route from one starting zone. zones: the leveling pack's zones. */
function buildRoute({ pack, zones, start, faction, race = null, byZone = questsByZone(pack, faction, race) }) {
  const open = zones.filter((z) => z.mapId !== start.mapId && !z.starter && (z.faction === faction || z.faction === "Contested"));
  const steps = [], used = new Set(), visited = [];
  let level = 1, here = start.mapId, last = null, zone = start;
  while (zone) {
    const pool = (byZone.get(zone.mapId) || []).filter((q) => !used.has(q.id) && q.level >= level - BELOW && q.level <= zone.max + ABOVE).sort((a, b) => a.level - b.level || a.id - b.id);
    if (pool.length >= MIN_ZONE_QUESTS || zone === start) {
      if (zone !== start) steps.push({ kind: "travel", ids: [], text: `Head to ${name(zone.mapId)} (levels ${zone.min}–${zone.max})`, mapId: zone.mapId, x: pool[0]?.giver.x ?? null, y: pool[0]?.giver.y ?? null, level: Math.max(level, zone.min) });
      let rest = pool;
      while (rest.length) {
        let now = rest.filter((q) => q.level <= level + ABOVE && q.minLevel <= level + ABOVE);
        if (!now.length) { level = Math.max(level + 1, Math.min(...rest.map((q) => Math.max(q.level, q.minLevel))) - ABOVE); continue; }
        for (const q of now) used.add(q.id);
        const ws = wave(now, zone.mapId, last);
        steps.push(...ws); if (ws.length) last = ws[ws.length - 1];
        level = Math.max(level, Math.max(...now.map((q) => q.level)));
        rest = rest.filter((q) => !used.has(q.id));
      }
      here = zone.mapId;
    }
    visited.push(zone.mapId);
    // Next zone: the lowest band you're ready for, staying on this continent when there's a choice.
    const ready = open.filter((z) => !visited.includes(z.mapId) && z.min <= level + 3);
    const pick = ready.sort((a, b) => (continent(a.mapId) !== continent(here)) - (continent(b.mapId) !== continent(here)) || a.min - b.min || a.max - b.max)[0];
    if (pick) { zone = pick; continue; }
    const later = open.filter((z) => !visited.includes(z.mapId) && (byZone.get(z.mapId) || []).some((q) => !used.has(q.id) && q.level >= level - BELOW)).sort((a, b) => a.min - b.min)[0];
    if (later) { level = later.min - 3; zone = later; continue; }
    zone = null;
  }
  const real = steps.filter((s) => s.kind !== "travel");
  return { key: race || String(start.mapId), race, start: start.mapId, startName: name(start.mapId), faction, races: start.starter, steps: steps.filter((s, i) => !(s.kind === "travel" && steps[i + 1]?.kind === "travel")).map((s) => ({ id: `${s.kind}:${s.ids.join("+") || s.mapId}`, ...s })),
    reachesLevel: real.length ? Math.max(...real.map((s) => s.level)) : 1, startsLevel: real.length ? Math.min(...real.map((s) => s.level)) : null,
    gaps: gapsOf(real), zones: [start.mapId, ...steps.filter((s) => s.kind === "travel").map((s) => s.mapId)].filter((m, i, a) => a.indexOf(m) === i) };
}

/** Level ranges the route has no steps for (start, and jumps of more than 3 levels). */
function gapsOf(steps) {
  const levels = [...new Set(steps.map((s) => s.level))].sort((a, b) => a - b), out = [];
  if (levels.length && levels[0] > 2) out.push({ from: 1, to: levels[0] - 1 });
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 3) out.push({ from: levels[i - 1] + 1, to: levels[i] - 1 });
  return out;
}
/** Hand review (reviews.json): skipped steps drop out, approved ones are marked. */
function applyReview(route, review) {
  if (!review) return { ...route, reviewed: 0 };
  const skip = new Set(review.skip || []), ok = new Set(review.approved || []);
  const steps = route.steps.filter((s) => !skip.has(s.id)).map((s) => (ok.has(s.id) ? { ...s, approved: true } : s));
  return { ...route, steps, reviewed: steps.filter((s) => s.approved).length };
}

/** The same rules as the addon's BackstageForeverGuideDone (scripts/guide-runtime.lua). */
function stepDone(s, st) {
  const ids = s.ids || [], lvl = s.level || 1, level = st.level || 1;
  // A quest you don't hold can't be handed in or worked on; its pick-up step comes first.
  if (s.kind === "turnin") return ids.every((id) => st.completed.has(id) || !st.inLog.has(id));
  if (level >= lvl + 5) return true;
  if (s.kind === "pickup") return ids.every((id) => st.completed.has(id) || st.inLog.has(id));
  if (s.kind === "class") return level >= lvl + 2 || ids.some((id) => st.completed.has(id) || st.inLog.has(id));
  if (s.kind === "objective") return ids.every((id) => st.completed.has(id) || st.complete.has(id) || !st.inLog.has(id));
  if (s.kind === "travel") return st.mapId === s.mapId;
  return false;
}
/** Where a character is on a route: the first step not behind them (same as the addon). */
function position(route, { completed = [], inLog = [], complete = [], level = 1, mapId = null } = {}, skipped = []) {
  const st = { completed: new Set(completed), inLog: new Set(inLog), complete: new Set(complete), level, mapId }, skip = new Set(skipped);
  const steps = route?.steps || [], done = new Array(steps.length).fill(false);
  for (let i = steps.length - 1; i >= 0; i--) {
    let d = skip.has(steps[i].id) || stepDone(steps[i], st);
    if (steps[i].kind === "travel" && !d) for (let j = i + 1; j < Math.min(steps.length, i + 7); j++) if (done[j] && steps[j].kind === "pickup") { d = true; break; }
    done[i] = d;
  }
  const at = done.indexOf(false);
  return at < 0 ? { ended: true, index: steps.length, total: steps.length, done: steps.length } : { ended: false, index: at, total: steps.length, done: done.filter(Boolean).length };
}

function buildGuidedRoutes({ pack, zones, reviews = null }) {
  const routes = [];
  for (const race of Object.keys(RACES)) {
    const start = zones.find((z) => z.starter?.some((r) => (ALIASES[r] || r) === race));
    if (!start) continue;
    routes.push(applyReview(buildRoute({ pack, zones, start, faction: start.faction, race }), reviews?.routes?.[race] || null));
  }
  const coverage = {};
  for (const f of ["Horde", "Alliance"]) {
    const mine = routes.filter((r) => r.faction === f);
    coverage[f] = { routes: mine.length, reachesLevel: mine.length ? Math.min(...mine.map((r) => r.reachesLevel)) : 0, best: mine.length ? Math.max(...mine.map((r) => r.reachesLevel)) : 0, steps: mine.reduce((t, r) => t + r.steps.length, 0) };
  }
  return { routes, coverage };
}
module.exports = { buildGuidedRoutes, buildRoute, applyReview, walk, questsByZone, raceBits, position, stepDone, RACES, ALIASES };

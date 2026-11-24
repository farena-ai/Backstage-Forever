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

function spot(pack, ref, learned = null) {
  const n = ref && pack.npcs?.[`${ref.kind}:${ref.id}`];
  const p = n?.positions?.[0];
  if (n && p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { npc: n.name, mapId: p.mapId, x: p.x, y: p.y };
  // 1.4 (J14): a position the player's own characters learned, or the NPC location pack.
  const l = ref && ref.kind !== "object" ? learned?.npcs?.get(ref.id) : null;
  return l ? { npc: n?.name || l.name || "the quest giver", mapId: l.mapId, x: l.x, y: l.y, learned: true } : null;
}
/**
 * 1.4 (J14): quest givers learned from play (journal givers of every character) plus the NPC
 * location pack. npcs: npcId -> { mapId, x, y, name? }; quests: questId -> npcId.
 */
function learnedGivers(profiles = [], npcLocations = null) {
  const npcs = new Map(), quests = new Map();
  for (const n of npcLocations?.npcs || []) { const p = n?.positions?.[0]; if (Number.isSafeInteger(n.id) && p && Number.isFinite(p.x)) npcs.set(n.id, { mapId: p.mapId, x: p.x, y: p.y, name: n.name || null }); }
  for (const pr of profiles || []) for (const g of pr?.journal?.givers || []) {
    if (!npcs.has(g.n) || npcs.get(g.n).fromPlay !== true) npcs.set(g.n, { mapId: g.m, x: g.x, y: g.y, name: npcs.get(g.n)?.name || null, fromPlay: true });
    if (!quests.has(g.q)) quests.set(g.q, g.n);
  }
  return { npcs, quests };
}
function questsByZone(pack, faction, race = null, learned = null, flags = null) {
  const by = new Map(), bit = race ? RACES[race] : 0;
  for (const q of Object.values(pack.quests || {})) {
    if (!q.level || (q.sides?.length && !q.sides.includes(faction))) continue;
    if (bit && !(raceBits(q.raceMask) & bit)) continue;
    const giverRef = q.givers?.find((r) => r.kind === "npc") || q.givers?.[0] || (learned?.quests?.has(q.id) ? { kind: "npc", id: learned.quests.get(q.id) } : null);
    const g = spot(pack, giverRef, learned);
    if (!g) continue;
    const t = spot(pack, q.turnIns?.find((r) => r.kind === "npc") || q.turnIns?.[0], learned);
    const o = (q.objectiveLocations || []).map((l) => l.positions?.[0]).find((p) => p && Number.isFinite(p.x) && p.mapId === g.mapId) || null;
    const row = { id: q.id, title: q.title, level: q.level, minLevel: q.minLevel || 1, giver: g, turnIn: t, objective: o, single: singleRace(q.raceMask), ...(flags?.get(q.id) || null) };
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
// hub (the "fewest trips" variant): givers standing close together become one stop, and every
// quest that goes back to the same person is handed in together.
function wave(quests, mapId, from, hub = 0, first = null) {
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
    const near = picks.find((p) => (hub || p.npc === q.giver.npc) && Math.hypot(p.x - q.giver.x, p.y - q.giver.y) <= (hub || MERGE));
    if (near) near.quests.push(q); else picks.push({ kind: "pickup", npc: q.giver.npc, mapId, x: q.giver.x, y: q.giver.y, quests: [q] });
  }
  steps.push(...walk(picks, from).map((p) => ({ kind: "pickup", ids: p.quests.map((q) => q.id), text: hub && new Set(p.quests.map((q) => q.giver.npc)).size > 1 ? `Pick up ${p.quests.length} quests in one stop around ${p.npc}: ${p.quests.slice(0, 3).map((q) => q.title).join(", ")}${p.quests.length > 3 ? "…" : ""}` : pickupText(p), npc: p.npc, mapId, x: p.x, y: p.y, level: Math.min(...p.quests.map((q) => q.level)) })));
  const last = () => steps[steps.length - 1] || from;
  // first (the duo variant): objectives of the quests it picks out are walked before the others.
  const spots = quests.filter((q) => q.objective).map((q) => ({ ...q.objective, q }));
  const lead = first ? walk(spots.filter((o) => first(o.q)), last()) : [];
  const objs = first ? [...lead, ...walk(spots.filter((o) => !first(o.q)), lead[lead.length - 1] || last())] : walk(spots, last());
  for (const o of objs) steps.push({ kind: "objective", ids: [o.q.id], text: `“${o.q.title}”: do the objectives around here`, mapId, x: o.x, y: o.y, level: o.q.level });
  const turns = walk(quests.filter((q) => q.turnIn).map((q) => ({ ...q.turnIn, q })), last());
  if (hub) {
    const stops = [];
    for (const t of turns) { const s = stops.find((x) => x.npc === t.npc && x.mapId === t.mapId && Math.hypot(x.x - t.x, x.y - t.y) <= MERGE); if (s) s.quests.push(t.q); else stops.push({ npc: t.npc, mapId: t.mapId, x: t.x, y: t.y, quests: [t.q] }); }
    for (const t of stops) steps.push({ kind: "turnin", ids: t.quests.map((q) => q.id), text: t.quests.length > 1 ? `Hand in ${t.quests.length} quests to ${t.npc}: ${t.quests.slice(0, 3).map((q) => q.title).join(", ")}${t.quests.length > 3 ? "…" : ""}` : `Hand in “${t.quests[0].title}” to ${t.npc}`, npc: t.npc, mapId: t.mapId, x: t.x, y: t.y, level: Math.min(...t.quests.map((q) => q.level)) });
    return steps;
  }
  for (const t of turns) steps.push({ kind: "turnin", ids: [t.q.id], text: `Hand in “${t.q.title}” to ${t.npc}`, npc: t.npc, mapId: t.mapId, x: t.x, y: t.y, level: t.q.level });
  return steps;
}

/**
 * A route from one starting zone. zones: the leveling pack's zones.
 * tune (roadmap Q8, see route-variants.cjs) changes the same engine and nothing else:
 *  above/below: how far over and under your level a quest may be; batch: extra levels taken in
 *  one round; hub: radius within which givers become one stop; keep(q): false leaves a quest out;
 *  flags: questId -> { elite, dungeon } from the data; dungeons: visits to insert, each
 *  { key, name, min, max, faction, mapId, x, y } with its quests held back until the visit.
 */
function buildRoute({ pack, zones, start, faction, race = null, learned = null, tune = null, byZone = questsByZone(pack, faction, race, learned, tune?.flags || null) }) {
  const ABOVE = Number.isInteger(tune?.above) ? tune.above : 2, BELOW = Number.isInteger(tune?.below) ? tune.below : 4, BATCH = Number.isInteger(tune?.batch) ? tune.batch : 0, HUB = Number.isFinite(tune?.hub) ? tune.hub : 0;
  const keep = typeof tune?.keep === "function" ? tune.keep : null;
  const visits = (tune?.dungeons || []).filter((d) => !d.faction || d.faction === faction).sort((a, b) => a.min - b.min || (a.key < b.key ? -1 : 1));
  const held = new Set(visits.map((d) => d.key)), entered = new Set();
  const wanted = (q) => (!keep || keep(q)) && !(q.dungeon && held.has(q.dungeon));
  // Dungeon-heavy: once you are two levels into a dungeon's band, collect its quests, go in, hand in.
  const dungeonStops = (level, steps, used) => {
    for (const d of visits) {
      const at = Math.min(d.max, d.min + 2);
      if (entered.has(d.key) || level < at) continue;
      entered.add(d.key);
      if (level > d.max + 2) continue; // the route jumped past it: say nothing rather than send you back
      const mine = [...byZone.values()].flat().filter((q) => q.dungeon === d.key && !used.has(q.id) && (!keep || keep(q)) && q.minLevel <= at + ABOVE).sort((a, b) => a.giver.mapId - b.giver.mapId || a.id - b.id);
      for (const q of mine) { used.add(q.id); steps.push({ kind: "pickup", ids: [q.id], text: `For ${d.name}: pick up “${q.title}” from ${q.giver.npc}`, npc: q.giver.npc, mapId: q.giver.mapId, x: q.giver.x, y: q.giver.y, level: at }); }
      steps.push({ kind: "dungeon", ids: [], dungeon: d.key, text: `Dungeon visit: ${d.name} (levels ${d.min}–${d.max}). Bring a full group.${mine.length ? ` You carry ${mine.length} quest${mine.length === 1 ? "" : "s"} for it.` : " No quest for it is known in the data."}`, mapId: d.mapId, x: d.x, y: d.y, level: at });
      for (const q of mine) if (q.turnIn) steps.push({ kind: "turnin", ids: [q.id], text: `Hand in “${q.title}” to ${q.turnIn.npc}`, npc: q.turnIn.npc, mapId: q.turnIn.mapId, x: q.turnIn.x, y: q.turnIn.y, level: at });
    }
  };
  const open = zones.filter((z) => z.mapId !== start.mapId && !z.starter && (z.faction === faction || z.faction === "Contested"));
  const steps = [], used = new Set(), visited = [];
  let level = 1, here = start.mapId, last = null, zone = start;
  while (zone) {
    const pool = (byZone.get(zone.mapId) || []).filter((q) => !used.has(q.id) && wanted(q) && q.level >= level - BELOW && q.level <= zone.max + ABOVE).sort((a, b) => a.level - b.level || a.id - b.id);
    if (pool.length >= MIN_ZONE_QUESTS || zone === start) {
      if (zone !== start) steps.push({ kind: "travel", ids: [], text: `Head to ${name(zone.mapId)} (levels ${zone.min}–${zone.max})`, mapId: zone.mapId, x: pool[0]?.giver.x ?? null, y: pool[0]?.giver.y ?? null, level: Math.max(level, zone.min) });
      let rest = pool;
      while (rest.length) {
        let now = rest.filter((q) => q.level <= level + ABOVE + BATCH && q.minLevel <= level + ABOVE);
        if (!now.length) { level = Math.max(level + 1, Math.min(...rest.map((q) => Math.max(q.level, q.minLevel))) - ABOVE); continue; }
        for (const q of now) used.add(q.id);
        const ws = wave(now, zone.mapId, last, HUB, tune?.order === "group" ? (q) => Boolean(q.elite || q.dungeon) : null);
        steps.push(...ws); if (ws.length) last = ws[ws.length - 1];
        level = Math.max(level, Math.max(...now.map((q) => q.level)));
        if (visits.length) dungeonStops(level, steps, used);
        rest = rest.filter((q) => !used.has(q.id));
      }
      here = zone.mapId;
    }
    visited.push(zone.mapId);
    // Next zone: the lowest band you're ready for, staying on this continent when there's a choice.
    const ready = open.filter((z) => !visited.includes(z.mapId) && z.min <= level + 3);
    const pick = ready.sort((a, b) => (continent(a.mapId) !== continent(here)) - (continent(b.mapId) !== continent(here)) || a.min - b.min || a.max - b.max)[0];
    if (pick) { zone = pick; continue; }
    const later = open.filter((z) => !visited.includes(z.mapId) && (byZone.get(z.mapId) || []).some((q) => !used.has(q.id) && wanted(q) && q.level >= level - BELOW)).sort((a, b) => a.min - b.min)[0];
    if (later) { level = later.min - 3; zone = later; continue; }
    zone = null;
  }
  const real = steps.filter((s) => s.kind !== "travel");
  return { key: race || String(start.mapId), race, start: start.mapId, startName: name(start.mapId), faction, races: start.starter, steps: steps.filter((s, i) => !(s.kind === "travel" && steps[i + 1]?.kind === "travel")).map((s) => ({ id: `${s.kind}:${s.kind === "dungeon" ? s.dungeon : s.ids.join("+") || s.mapId}`, ...s })),
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
// review: { skip: [stepId], approved: [stepId], moves: [[stepId, afterStepId | null], ...] }.
// Moves apply in order: the step goes right after afterStepId (null: to the start). keepSkipped
// leaves skipped steps in place, marked, for the review page.
function applyReview(route, review, { keepSkipped = false } = {}) {
  if (!review) return { ...route, reviewed: 0, skipped: 0 };
  const skip = new Set(review.skip || []), ok = new Set(review.approved || []);
  let steps = route.steps.slice();
  for (const m of Array.isArray(review.moves) ? review.moves : []) {
    if (!Array.isArray(m)) continue;
    const from = steps.findIndex((s) => s.id === m[0]);
    if (from < 0) continue;
    const [step] = steps.splice(from, 1);
    const after = m[1] === null ? -1 : steps.findIndex((s) => s.id === m[1]);
    if (m[1] !== null && after < 0) { steps.splice(from, 0, step); continue; }
    steps.splice(after + 1, 0, step);
  }
  steps = steps.filter((s) => keepSkipped || !skip.has(s.id)).map((s) => ({ ...s, ...(ok.has(s.id) ? { approved: true } : {}), ...(skip.has(s.id) ? { skipped: true } : {}) }));
  return { ...route, steps, reviewed: steps.filter((s) => s.approved).length, skipped: skip.size };
}
/** Bundled review plus this computer's edits (later wins): per race, union of lists, moves appended. */
function mergeReviews(base, local) {
  const out = { version: 1, routes: {} };
  for (const src of [base, local]) for (const [race, r] of Object.entries(src?.routes || {})) {
    const o = (out.routes[race] ||= { skip: [], approved: [], moves: [] });
    for (const k of ["skip", "approved"]) for (const id of r[k] || []) if (!o[k].includes(id)) o[k].push(id);
    for (const id of r.unskip || []) o.skip = o.skip.filter((x) => x !== id);
    for (const id of r.unapprove || []) o.approved = o.approved.filter((x) => x !== id);
    o.moves.push(...(r.moves || []));
  }
  return out;
}
/** One review action on a local review (pure): approve, skip, clear, up or down, given the current route. */
function reviewAction(local, race, id, action, route) {
  const out = structuredClone(local || { version: 1, routes: {} });
  out.version = 1; out.routes ||= {};
  const r = (out.routes[race] ||= { skip: [], approved: [], moves: [], unskip: [], unapprove: [] });
  for (const k of ["skip", "approved", "moves", "unskip", "unapprove"]) r[k] ||= [];
  const drop = (k) => { r[k] = r[k].filter((x) => x !== id); };
  if (action === "approve") { drop("unapprove"); if (!r.approved.includes(id)) r.approved.push(id); drop("skip"); }
  else if (action === "skip") { drop("unskip"); if (!r.skip.includes(id)) r.skip.push(id); drop("approved"); }
  else if (action === "clear") { drop("skip"); drop("approved"); r.unskip.push(id); r.unapprove.push(id); }
  else if (action === "up" || action === "down") {
    const ids = (route?.steps || []).map((s) => s.id), i = ids.indexOf(id);
    if (i < 0) throw Error("Unknown step.");
    if (action === "up" && i > 0) r.moves.push([id, i > 1 ? ids[i - 2] : null]);
    if (action === "down" && i < ids.length - 1) r.moves.push([id, ids[i + 1]]);
  } else throw Error("Unknown review action.");
  return out;
}
/** What goes into data/forever-route/reviews.json: the merged review, without the local-only undo lists. */
function exportReview(base, local) {
  const m = mergeReviews(base, local);
  for (const r of Object.values(m.routes)) { delete r.unskip; delete r.unapprove; }
  return { version: 1, note: base?.note || "Hand review of the guided routes (roadmap 4.1).", routes: m.routes };
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
  return false; // a dungeon visit or your own step: behind you once you skip it or outlevel it
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

function buildGuidedRoutes({ pack, zones, reviews = null, raw = null, learned = null, tune = null }) {
  const routes = [];
  for (const race of Object.keys(RACES)) {
    const start = zones.find((z) => z.starter?.some((r) => (ALIASES[r] || r) === race));
    if (!start) continue;
    const built = buildRoute({ pack, zones, start, faction: start.faction, race, learned, tune });
    if (raw) raw[race] = built; // unreviewed, for the review page
    routes.push(applyReview(built, reviews?.routes?.[race] || null));
  }
  const coverage = {};
  for (const f of ["Horde", "Alliance"]) {
    const mine = routes.filter((r) => r.faction === f);
    coverage[f] = { routes: mine.length, reachesLevel: mine.length ? Math.min(...mine.map((r) => r.reachesLevel)) : 0, best: mine.length ? Math.max(...mine.map((r) => r.reachesLevel)) : 0, steps: mine.reduce((t, r) => t + r.steps.length, 0) };
  }
  return { routes, coverage };
}
module.exports = { buildGuidedRoutes, buildRoute, learnedGivers, applyReview, mergeReviews, reviewAction, exportReview, walk, questsByZone, raceBits, position, stepDone, RACES, ALIASES };

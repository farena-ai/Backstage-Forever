"use strict";
// Gathering loops (roadmap E4): a closed walk through the herb or ore spots known for one zone,
// kept to what the character's skill can gather. Pure: spots in, numbered stops out.
// A loop is a suggestion drawn from past spots; it never claims a node is up.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");

const PROFESSIONS = Object.freeze({
  herbalism: { label: "Herbalism", kind: "herb", skillLine: 182, code: "h", word: "herb" },
  mining: { label: "Mining", kind: "ore", skillLine: 186, code: "o", word: "ore" },
});
// Skill each classic node needs, matched on the node's English name (the same table the addon uses).
const NODE_SKILL = Object.freeze([
  ["Copper Vein", 1, "ore"], ["Tin Vein", 65, "ore"], ["Incendicite", 65, "ore"], ["Silver Vein", 75, "ore"], ["Lesser Bloodstone", 75, "ore"], ["Iron Deposit", 125, "ore"], ["Indurium", 150, "ore"], ["Gold Vein", 155, "ore"],
  ["Mithril Deposit", 175, "ore"], ["Truesilver Deposit", 230, "ore"], ["Dark Iron Deposit", 230, "ore"], ["Small Thorium Vein", 245, "ore"], ["Ooze Covered Thorium Vein", 245, "ore"], ["Rich Thorium Vein", 275, "ore"], ["Ooze Covered Rich Thorium Vein", 275, "ore"],
  ["Peacebloom", 1, "herb"], ["Silverleaf", 1, "herb"], ["Earthroot", 15, "herb"], ["Mageroyal", 50, "herb"], ["Briarthorn", 70, "herb"], ["Stranglekelp", 85, "herb"], ["Bruiseweed", 100, "herb"], ["Wild Steelbloom", 115, "herb"], ["Grave Moss", 120, "herb"],
  ["Kingsblood", 125, "herb"], ["Liferoot", 150, "herb"], ["Fadeleaf", 160, "herb"], ["Goldthorn", 170, "herb"], ["Khadgar's Whisker", 185, "herb"], ["Wintersbite", 195, "herb"], ["Firebloom", 205, "herb"], ["Purple Lotus", 210, "herb"],
  ["Arthas' Tears", 220, "herb"], ["Sungrass", 230, "herb"], ["Blindweed", 235, "herb"], ["Ghost Mushroom", 245, "herb"], ["Gromsblood", 250, "herb"], ["Golden Sansam", 260, "herb"], ["Dreamfoil", 270, "herb"],
  ["Mountain Silversage", 280, "herb"], ["Plaguebloom", 285, "herb"], ["Icecap", 290, "herb"], ["Black Lotus", 300, "herb"],
]);
/** The known node a name belongs to (longest name it contains), or null. */
function nodeInfo(name) {
  if (typeof name !== "string" || !name || name.length > 120) return null;
  let best = null;
  for (const row of NODE_SKILL) if (name.includes(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  return best ? { node: best[0], skill: best[1], kind: best[2] } : null;
}
const nodeSkill = (name) => nodeInfo(name)?.skill ?? null;

const MAX_STOPS = 40, MAX_SPOTS = 3000, MIN_STOPS = 3, JOIN = 0.022, WALK_YARDS_PER_SECOND = 7;
const frac = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

// Stops: spots closer than JOIN (about 2% of the map) share one stop at their middle.
function cluster(spots, scale) {
  const out = [];
  for (const s of spots) {
    let home = null, near = JOIN;
    for (const c of out) { const d = Math.hypot((c.x - s.x) * scale.w, (c.y - s.y) * scale.h); if (d <= near) { near = d; home = c; } }
    if (!home) { home = { x: s.x, y: s.y, sx: 0, sy: 0, spots: 0, names: new Map() }; out.push(home); }
    home.sx += s.x; home.sy += s.y; home.spots++; home.x = home.sx / home.spots; home.y = home.sy / home.spots;
    if (s.name) home.names.set(s.name, (home.names.get(s.name) || 0) + 1);
  }
  return out;
}
function tourLength(order, d) { let t = 0; for (let i = 0; i < order.length; i++) t += d(order[i], order[(i + 1) % order.length]); return t; }
// Nearest neighbour from the first stop, then 2-opt until no swap shortens the closed loop.
function orderLoop(stops, d, first = 0) {
  const n = stops.length, left = new Set(stops.keys()), order = [first];
  left.delete(first);
  while (left.size) { const at = order[order.length - 1]; let best = -1, far = Infinity; for (const i of left) { const v = d(at, i); if (v < far - 1e-12) { far = v; best = i; } } order.push(best); left.delete(best); }
  for (let pass = 0, better = true; better && pass < 60; pass++) {
    better = false;
    for (let i = 0; i < n - 1; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = order[i], b = order[i + 1], c = order[j], e = order[(j + 1) % n];
      if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 1e-9) { for (let l = i + 1, r = j; l < r; l++, r--) [order[l], order[r]] = [order[r], order[l]]; better = true; }
    }
  }
  return order;
}

/**
 * spots: [{ x, y, name?, source? }] on one map for one profession ("yours", "community" or "reference").
 * options: skill (number, or null when not known), size { width, height } of the map in yards (optional),
 * start { x, y } (optional: the loop begins at the stop nearest to it), maxStops.
 */
function buildLoop(spots, { skill = null, size = null, start = null, maxStops = MAX_STOPS } = {}) {
  const yards = size && size.width > 0 && size.height > 0 && Number.isFinite(size.width) && Number.isFinite(size.height) ? size : null;
  // Zone maps are drawn three wide to two high; real yards when the zone's size is known.
  const scale = yards ? { w: 1, h: yards.height / yards.width } : { w: 1, h: 2 / 3 };
  const basedOn = { spots: 0, yours: 0, community: 0, reference: 0, tooHigh: 0, unknownSkill: 0, stops: 0, leftOut: 0 };
  const have = Number.isFinite(skill) ? skill : null;
  const use = [];
  for (const s of (Array.isArray(spots) ? spots : []).slice(0, MAX_SPOTS)) {
    if (!s || !frac(s.x) || !frac(s.y)) continue;
    const need = nodeSkill(s.name);
    if (need === null) basedOn.unknownSkill++;
    else if (have !== null && need > have) { basedOn.tooHigh++; continue; }
    const source = s.source === "community" || s.source === "reference" ? s.source : "yours";
    basedOn[source]++; basedOn.spots++;
    use.push({ x: s.x, y: s.y, name: typeof s.name === "string" ? s.name.slice(0, 120) : null });
  }
  use.sort((a, b) => a.x - b.x || a.y - b.y || String(a.name).localeCompare(String(b.name)));
  let stops = cluster(use, scale);
  const cap = Math.max(MIN_STOPS, Math.min(MAX_STOPS, Number.isInteger(maxStops) ? maxStops : MAX_STOPS));
  if (stops.length > cap) {
    // Too many stops for one walk: keep the busiest ones.
    const kept = [...stops].sort((a, b) => b.spots - a.spots || a.x - b.x || a.y - b.y).slice(0, cap);
    basedOn.leftOut = stops.length - kept.length;
    stops = stops.filter((s) => kept.includes(s));
  }
  basedOn.stops = stops.length;
  const skillNote = have === null ? "Your skill is not known, so no spot was left out for skill." : basedOn.tooHigh ? `${basedOn.tooHigh} ${basedOn.tooHigh === 1 ? "spot needs" : "spots need"} more skill than you have and ${basedOn.tooHigh === 1 ? "is" : "are"} left out.` : null;
  if (stops.length < MIN_STOPS) {
    return { status: "too-few", stops: [], length: null, basedOn, skillNote,
      note: basedOn.spots === 0 ? (basedOn.tooHigh ? "Every spot known here needs more skill than you have." : "No spots are known here yet.") : `Only ${basedOn.spots} ${basedOn.spots === 1 ? "spot" : "spots"} in ${stops.length} ${stops.length === 1 ? "place" : "places"} here. A loop needs at least ${MIN_STOPS} places.` };
  }
  const d = (i, j) => Math.hypot((stops[i].x - stops[j].x) * scale.w, (stops[i].y - stops[j].y) * scale.h);
  let first = 0;
  if (start && frac(start.x) && frac(start.y)) { let far = Infinity; stops.forEach((s, i) => { const v = Math.hypot((s.x - start.x) * scale.w, (s.y - start.y) * scale.h); if (v < far) { far = v; first = i; } }); }
  const order = orderLoop(stops, d, first);
  const map = tourLength(order, d);
  const total = yards ? Math.round(map * yards.width) : null;
  const out = order.map((i, n) => {
    const s = stops[i];
    return { n: n + 1, x: +s.x.toFixed(4), y: +s.y.toFixed(4), spots: s.spots, names: [...s.names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name) };
  });
  const parts = [];
  if (basedOn.yours) parts.push(`${basedOn.yours} of your own`);
  if (basedOn.community) parts.push(`${basedOn.community} from the community`);
  if (basedOn.reference) parts.push(`${basedOn.reference} from the bundled reference`);
  return {
    status: "ok", stops: out, basedOn, skillNote,
    length: { map: +map.toFixed(4), yards: total, walkMinutes: total ? Math.max(1, Math.round(total / WALK_YARDS_PER_SECOND / 60)) : null },
    note: `Based on ${basedOn.spots} past ${basedOn.spots === 1 ? "spot" : "spots"} (${parts.join(", ")}). Past spots, not live nodes.` + (basedOn.leftOut ? ` ${basedOn.leftOut} quieter ${basedOn.leftOut === 1 ? "place is" : "places are"} left out to keep the walk short.` : ""),
  };
}

/** Every known spot for a profession, per map: yours, the community's and the bundled reference. */
function collectSpots({ profile = null, community = null, worldPack = null, acquisitionPack = null, profession, extra = true } = {}) {
  const p = PROFESSIONS[profession]; if (!p) return new Map();
  const byMap = new Map(), seen = new Set();
  const add = (mapId, x, y, name, source) => {
    if (!Number.isSafeInteger(mapId) || !frac(x) || !frac(y)) return;
    // The same node type in the same half-percent square counts once; your own spot wins.
    const key = `${mapId}:${name}:${Math.round(x * 200)}:${Math.round(y * 200)}`;
    if (seen.has(key)) return; seen.add(key);
    if (!byMap.has(mapId)) byMap.set(mapId, []);
    byMap.get(mapId).push({ x, y, name: name || null, source });
  };
  for (const r of profile?.gathering?.records || []) if (r.method === profession) add(r.mapId, r.x, r.y, r.name, "yours");
  if (!extra) return byMap;
  for (const [mapId, nodes] of community?.nodesByMap || []) for (const n of nodes) if (n.kind === p.kind) add(mapId, n.x, n.y, n.name, "community");
  for (const n of worldPack?.nodes || []) if (n.kind === p.kind) for (const q of n.positions) add(q.mapId, q.x, q.y, n.name, "reference");
  for (const r of acquisitionPack?.rows || []) {
    if (r.kind !== "gathered-object-loot" || nodeInfo(r.referenceName)?.kind !== p.kind) continue;
    for (const q of r.positions || []) add(q.mapId, q.x, q.y, r.referenceName, "reference");
  }
  return byMap;
}
/** The character's skill in a gathering profession from the last save, or null. */
function professionSkill(profile, profession) {
  const line = PROFESSIONS[profession]?.skillLine;
  const row = (profile?.readiness?.workshop?.professions?.items || []).find((i) => i?.skillLineId === line);
  return row && Number.isSafeInteger(row.rank) && row.rank >= 0 && row.rank <= 10000 ? row.rank : null;
}

// The loop chosen for the game, per character. One small file in the app data folder.
const MAX_PROFILES = 100;
function cleanChoice(raw) {
  if (!raw || typeof raw !== "object" || !Number.isSafeInteger(raw.mapId) || raw.mapId < 1 || raw.mapId > 2147483647 || !PROFESSIONS[raw.profession]) return null;
  if (!Array.isArray(raw.stops) || raw.stops.length < MIN_STOPS || raw.stops.length > MAX_STOPS) return null;
  const stops = [];
  for (const s of raw.stops) { if (!Array.isArray(s) || !frac(s[0]) || !frac(s[1])) return null; stops.push([Math.round(s[0] * 10000) / 10000, Math.round(s[1] * 10000) / 10000]); }
  return { mapId: raw.mapId, profession: raw.profession, stops };
}
class GatheringLoops {
  constructor(dir) {
    this.file = path.join(dir, "gathering-loops.json");
    this.profiles = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw?.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles))
        for (const [k, v] of Object.entries(raw.profiles).slice(0, MAX_PROFILES)) { const c = cleanChoice(v); if (c && k.length <= 100) this.profiles[k] = c; }
    } catch {}
  }
  get(profileId) { const c = typeof profileId === "string" ? this.profiles[profileId] : null; return c ? { ...c, stops: c.stops.map((s) => [...s]) } : null; }
  set(profileId, choice) {
    if (typeof profileId !== "string" || !profileId || profileId.length > 100) throw Error("Choose a character first.");
    if (choice === null) delete this.profiles[profileId];
    else {
      const c = cleanChoice(choice); if (!c) throw Error("This loop cannot be sent to the game.");
      if (!this.profiles[profileId] && Object.keys(this.profiles).length >= MAX_PROFILES) throw Error("Too many characters have a loop.");
      this.profiles[profileId] = c;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomic(this.file, JSON.stringify({ schemaVersion: 1, profiles: this.profiles }) + "\n");
    return this.get(profileId);
  }
  clear() { this.profiles = {}; try { fs.rmSync(this.file, { force: true }); } catch {} }
}
module.exports = { PROFESSIONS, NODE_SKILL, MAX_STOPS, MIN_STOPS, nodeInfo, nodeSkill, buildLoop, collectSpots, professionSkill, cleanChoice, GatheringLoops };

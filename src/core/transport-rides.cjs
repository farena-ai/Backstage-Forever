"use strict";
// Boats, zeppelins, airships and the tram for the travel planner (roadmap Q15, D3).
// Three sources, kept apart:
//   - the bundled pack says which moving transports exist (name, path number, speed): upstream data;
//   - the player's own game files say where each one stops and how long its path is (TaxiPathNode,
//     read by game-data.cjs transportPaths()) and name the flight points beside the stops;
//   - the tram is only in the published travel reference (data/forever-travel): no place, no time.
// Worked out here and labelled so by the planner: the ride time (path length over speed), the
// name of a stop (the flight point beside it) and the faction (the flight points at its stops).
const { MAP_NAMES } = require("./map-names.cjs");
const { toWorld } = require("./transport-data.cjs");

const TOWN_YARDS = 1000; // a flight point this close names a stop and gives the stop its town's faction
const SAME_PLACE = 40; // two stops this close are one stop
const PLACE_WORD = Object.freeze({ boat: "dock", zeppelin: "zeppelin tower", airship: "airship dock" });
const SIDE = Object.freeze({ 1: "Alliance", 2: "Horde" });
const CITY_OF = Object.freeze({ stormwind: 1453, ironforge: 1455 });
const flat = (a, b) => Math.hypot(a.wx - b.wx, a.wy - b.wy);
const finite = (n) => typeof n === "number" && Number.isFinite(n);

/** Seconds to ride `yards` at `speed`, speeding up from the dock and slowing down into the next one. */
function rideSeconds(yards, speed, accel) {
  if (!(yards > 0) || !(speed > 0)) return 0;
  if (!(accel > 0)) return yards / speed;
  return yards >= (speed * speed) / accel ? yards / speed + speed / accel : 2 * Math.sqrt(yards / accel);
}
/** The named zone whose map holds a world position: the smallest one, so a city wins over the land around it. */
function zoneAt(pack, instance, wx, wy) {
  let best = null;
  for (const [id, m] of Object.entries(pack.maps || {})) {
    if (m.instance !== instance || !MAP_NAMES[id]) continue;
    const x = (wy - m.x0) / (m.x1 - m.x0), y = (wx - m.y0) / (m.y1 - m.y0);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue;
    const area = Math.abs((m.x1 - m.x0) * (m.y1 - m.y0));
    if (!best || area < best.area) best = { area, name: MAP_NAMES[id] };
  }
  return best ? best.name : null;
}
function readPath(p) {
  if (!p || !Array.isArray(p.stops) || !Array.isArray(p.yards) || p.stops.length < 2 || p.stops.length > 6 || p.yards.length !== p.stops.length) return null;
  const stops = [];
  for (const s of p.stops) {
    if (!Array.isArray(s) || !Number.isSafeInteger(s[0]) || s[0] < 0 || !finite(s[1]) || !finite(s[2]) || !Number.isSafeInteger(s[3]) || s[3] < 0 || s[3] > 3600) return null;
    stops.push({ instance: s[0], wx: s[1], wy: s[2], delay: s[3] });
  }
  if (!p.yards.every((y) => Number.isSafeInteger(y) && y >= 0 && y <= 1000000)) return null;
  return { stops, yards: p.yards };
}
/** Real flight points (the ones a faction can use) from the game files, as places. */
function townPoints(game) {
  const out = [];
  for (const [id, p] of Object.entries(game?.points || {})) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || !p[0] || !Number.isSafeInteger(p[1]) || !finite(p[2]) || !finite(p[3]) || !(p[4] >= 1 && p[4] <= 3)) continue;
    out.push({ id: Number(id), town: p[0].split(",")[0].trim().slice(0, 60), instance: p[1], wx: p[2], wy: p[3], sides: p[4] });
  }
  return out;
}
function oneTransport(pack, t, raw, towns) {
  // Stops at the same spot are one place (a ferry that calls at its home dock twice in a round).
  const places = [], placeOf = raw.stops.map((s) => {
    let i = places.findIndex((q) => q.instance === s.instance && flat(q, s) <= SAME_PLACE);
    if (i < 0) { places.push({ instance: s.instance, wx: s.wx, wy: s.wy }); i = places.length - 1; }
    return i;
  });
  if (places.length < 2) return null;
  // The flight point beside a stop gives its name; if two stops share one, the nearer stop keeps it.
  const near = places.map((q) => towns.filter((p) => p.instance === q.instance && flat(p, q) <= TOWN_YARDS).map((p) => ({ p, yards: flat(p, q) })).sort((a, b) => a.yards - b.yards));
  const stops = places.map((q, i) => {
    const mine = near[i][0], rival = mine && near.some((list, j) => j !== i && list[0] && list[0].p.town === mine.p.town && list[0].yards < mine.yards);
    const town = mine && !rival ? mine.p.town : null, zone = zoneAt(pack, q.instance, q.wx, q.wy);
    // Its faction: every flight point of that town (Booty Bay has one for each side).
    const sides = town ? near[i].filter((x) => x.p.town === town).reduce((n, x) => n | x.p.sides, 0) : 0;
    const word = PLACE_WORD[t.mode];
    return { key: `ride:${t.id}:${i}`, label: town || zone ? `${town || zone} ${word}` : `${word[0].toUpperCase()}${word.slice(1)} with no recorded name`, named: !!(town || zone), instance: q.instance, wx: q.wx, wy: q.wy, sides, townYards: town ? Math.round(mine.yards) : null };
  });
  // A faction only where every stop stands at flight points of that faction alone.
  const common = stops.reduce((n, s) => n & s.sides, 3), known = stops.every((s) => s.sides);
  const side = !known ? null : SIDE[common] || "Both";
  const n = raw.stops.length, hop = raw.yards.map((y) => rideSeconds(y, t.speed, t.accel));
  // From each stop forward along the loop to every other one, staying on board at the stops between.
  // `dock` is how long it lies at the stop where the ride starts.
  const best = new Map();
  for (let i = 0; i < n; i++) {
    let seconds = 0, yards = 0; const via = [];
    for (let k = 0; k < n - 1; k++) {
      const at = (i + k) % n, next = (at + 1) % n;
      if (k > 0) { seconds += raw.stops[at].delay; if (placeOf[at] !== placeOf[i] && !via.includes(placeOf[at])) via.push(placeOf[at]); }
      seconds += hop[at]; yards += raw.yards[at];
      const from = placeOf[i], to = placeOf[next];
      if (to === from) break;
      const key = `${from}>${to}`, have = best.get(key);
      if (!have || seconds < have.seconds) best.set(key, { from, to, seconds: Math.max(1, Math.round(seconds)), dock: raw.stops[i].delay, yards, via: via.filter((v) => v !== to).map((v) => stops[v].label) });
    }
  }
  const round = Math.round(hop.reduce((a, b) => a + b, 0) + raw.stops.reduce((a, s) => a + s.delay, 0));
  // A placeholder name upstream recorded ("TEST Ship") is not shown as the vessel's name.
  return { id: t.id, name: /^test\b/i.test(t.name) ? null : t.name, mode: t.mode, side, sideFrom: side ? "flight-points" : null, timing: "estimated", stops, rides: [...best.values()], roundSeconds: round, source: "game-files" };
}
/** The tram of the published travel reference: both ends stand in at the middle of their city. */
function tram(pack, reference) {
  const edges = (reference?.edges || []).filter((e) => e.mode === "tram"), nodes = new Map((reference?.nodes || []).map((n) => [n.id, n]));
  const ends = [];
  for (const e of edges) for (const id of [e.from, e.to]) {
    const mapId = CITY_OF[nodes.get(id)?.cityId];
    if (!mapId) return null;
    if (!ends.some((x) => x.id === id)) ends.push({ id, mapId });
  }
  if (ends.length !== 2 || !edges.length) return null;
  const stops = [];
  for (const [i, end] of ends.entries()) {
    const w = toWorld(pack, end.mapId, 0.5, 0.5);
    if (!w) return null;
    stops.push({ key: `ride:tram:${i}`, label: `${MAP_NAMES[end.mapId]} tram station`, named: true, instance: w.instance, wx: w.wx, wy: w.wy, sides: 0, townYards: null, approximate: true });
  }
  const sides = new Set(edges.map((e) => e.faction));
  const index = (id) => ends.findIndex((x) => x.id === id);
  return {
    id: "tram", name: "Deeprun Tram", mode: "tram", side: sides.size === 1 && ["Alliance", "Horde"].includes([...sides][0]) ? [...sides][0] : null, sideFrom: "reference", timing: "unknown", stops,
    rides: edges.map((e) => ({ from: index(e.from), to: index(e.to), seconds: null, dock: null, yards: null, via: [] })), roundSeconds: null, source: "reference",
  };
}
/**
 * pack: the transport pack (pack.transports); game: { points, paths } from the player's game files
 * or null; reference: the published travel reference or null.
 * Returns { transports, known, unread, gameFiles }: `known` is how many the pack names, `unread`
 * how many of those have no usable path in the game files.
 */
function transportRides(pack, game = null, reference = null) {
  const listed = Array.isArray(pack?.transports) ? pack.transports : [], transports = [];
  const towns = townPoints(game), paths = game && typeof game.paths === "object" && game.paths ? game.paths : null;
  let unread = 0;
  for (const t of listed) {
    const raw = paths ? readPath(paths[t.pathId]) : null, row = raw ? oneTransport(pack, t, raw, towns) : null;
    if (row) transports.push(row); else unread++;
  }
  const rail = tram(pack, reference);
  if (rail) transports.push(rail);
  return { transports, known: listed.length, unread, gameFiles: !!paths };
}

module.exports = { TOWN_YARDS, PLACE_WORD, rideSeconds, zoneAt, transportRides };

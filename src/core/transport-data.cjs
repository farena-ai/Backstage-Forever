"use strict";
// Transport graph (roadmap D3): every flight point and connection that upstream players saw,
// for both factions, with the observed flight seconds and costs where upstream has them.
// Built offline by scripts/build-forever-transport.cjs from Efficient Games flights.json and
// npcs.json (CC BY 4.0). Upstream has no flight point names, no boats and no zeppelins.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");

const FILES = Object.freeze(["flights.json", "npcs.json"]);
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMITS = Object.freeze({ "flights.json": 512 * 1024, "npcs.json": 4 * 1024 * 1024 });
const PACK_LIMIT = 256 * 1024, MAX_BUILDS = 16, MAX_NODES = 400, MAX_EDGES = 4000, MAX_ROUTES = 8000, MAX_MAPS = 200;
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const SIDES = Object.freeze(["Alliance", "Horde", "Both"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (why = "") => { throw Error("Invalid transport data." + (why ? " " + why : "")); };
const int = (n, max = 2147483647) => Number.isSafeInteger(n) && n > 0 && n <= max;
const num = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
const text = (s, max = 80) => typeof s === "string" && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const round = (n, d) => Number(n.toFixed(d)) + 0; // + 0 turns -0 into 0
const dist = (a, b) => Math.hypot(a.wx - b.wx, a.wy - b.wy);

// Lower weighted median of a { seconds: count } histogram.
function medianSeconds(hist) {
  const rows = Object.entries(hist).map(([s, c]) => [Number(s), c]).sort((a, b) => a[0] - b[0]);
  const total = rows.reduce((n, r) => n + r[1], 0);
  let seen = 0;
  for (const [s, c] of rows) { seen += c; if (seen * 2 >= total) return s; }
  return null;
}
function position(p) {
  if (!p || !int(p.uiMap, 1000000) || !num(p.mapX, 0, 1) || !num(p.mapY, 0, 1) || !num(p.worldX, -100000, 100000) || !num(p.worldY, -100000, 100000) || !Number.isSafeInteger(p.instance) || p.instance < 0 || p.instance > 100000) return null;
  return { mapId: p.uiMap, x: p.mapX, y: p.mapY, wx: p.worldX, wy: p.worldY, instance: p.instance };
}
// One straight line through the points (least squares): value = at0 + (at1 - at0) * t.
function line(points, t, v) {
  const n = points.length; let st = 0, sv = 0, stt = 0, stv = 0;
  for (const p of points) { st += p[t]; sv += p[v]; stt += p[t] * p[t]; stv += p[t] * p[v]; }
  const den = n * stt - st * st;
  if (Math.abs(den) < 1e-9) return null;
  const slope = (n * stv - st * sv) / den, at0 = (sv - slope * st) / n;
  return { at0, slope };
}
// Zone map position -> world position, fitted from the upstream points that carry both.
// In this client the map's x runs along world Y and the map's y along world X.
function fitMap(points) {
  const fit = (list) => {
    const a = line(list, "x", "wy"), b = line(list, "y", "wx");
    return a && b ? { a, b } : null;
  };
  const spread = (list, k) => Math.max(...list.map((p) => p[k])) - Math.min(...list.map((p) => p[k]));
  let list = points, f = fit(list);
  if (!f) return null;
  const off = (p) => Math.max(Math.abs(f.a.at0 + f.a.slope * p.x - p.wy), Math.abs(f.b.at0 + f.b.slope * p.y - p.wx));
  // Median-based trim: points recorded on another map level (caves, upper floors) do not fit.
  const errors = list.map(off).sort((x, y) => x - y), cut = Math.max(20, errors[Math.floor(errors.length / 2)] * 4);
  list = list.filter((p) => off(p) <= cut); f = fit(list);
  if (!f || list.length < 3 || list.length * 5 < points.length * 4 || spread(list, "x") < 0.03 || spread(list, "y") < 0.03) return null;
  if (list.some((p) => off(p) > 20) || new Set(list.map((p) => p.instance)).size !== 1) return null;
  return { instance: list[0].instance, x0: round(f.a.at0, 1), x1: round(f.a.at0 + f.a.slope, 1), y0: round(f.b.at0, 1), y1: round(f.b.at0 + f.b.slope, 1), points: list.length };
}
/** Zone map position (0..1) to world yards with a pack map row; null when the map is not covered. */
function toWorld(pack, mapId, x, y) {
  const m = pack?.maps?.[mapId];
  if (!m || !num(x, 0, 1) || !num(y, 0, 1)) return null;
  return { instance: m.instance, wy: m.x0 + (m.x1 - m.x0) * x, wx: m.y0 + (m.y1 - m.y0) * y };
}

/**
 * builds: [{ build, files: { "flights.json": Buffer, "npcs.json": Buffer } }], newest first.
 * The newest build that reports a fact wins; flight seconds are pooled over all builds.
 */
function compileTransport(builds, { commit }) {
  if (!Array.isArray(builds) || !builds.length || builds.length > MAX_BUILDS || !/^[a-f0-9]{40}$/.test(commit || "")) fail();
  const masters = new Map(), npcs = new Map(), routes = new Map(), fitPoints = new Map();
  const dates = [];
  const counts = { droppedRoutes: 0, routesWithoutHops: 0 };
  const point = (p) => { const q = position(p); if (q) { if (!fitPoints.has(q.mapId)) fitPoints.set(q.mapId, []); fitPoints.get(q.mapId).push(q); } return q; };
  for (const { build, files } of builds) {
    if (!BUILD_RE.test(build)) fail();
    const flights = JSON.parse(files["flights.json"]), people = JSON.parse(files["npcs.json"]);
    if (flights?.meta?.dataset !== "flights" || people?.meta?.dataset !== "npcs" || flights.meta.clientBuild !== build || people.meta.clientBuild !== build) fail("Source metadata.");
    dates.push(flights.meta.collectedOn.first, flights.meta.collectedOn.last);
    for (const [key, n] of Object.entries(people.npcs || {})) {
      const id = Number(key); if (!/^[1-9]\d*$/.test(key) || !int(id)) continue;
      const positions = (Array.isArray(n?.positions) ? n.positions : []).map(point).filter(Boolean);
      const row = npcs.get(id) || {};
      if (!row.side && (n?.side === "Alliance" || n?.side === "Horde")) row.side = n.side;
      if (!row.position && positions[0] && (n.interactions || []).includes("TaxiNode")) row.position = positions[0];
      npcs.set(id, row);
    }
    for (const [key, m] of Object.entries(flights.masters || {})) {
      const id = Number(key);
      if (!/^[1-9]\d*$/.test(key) || !int(id) || !text(m?.name) || !int(m?.node)) fail("Flight master.");
      if (!masters.has(m.node)) masters.set(m.node, { npcId: id, name: m.name });
    }
    for (const [key, r] of Object.entries(flights.routes || {})) {
      const m = /^([1-9]\d*)>([1-9]\d*)$/.exec(key), from = m && Number(m[1]), to = m && Number(m[2]);
      if (!m || !int(from) || !int(to) || from === to || !r || typeof r !== "object") { counts.droppedRoutes++; continue; }
      const row = routes.get(key) || { from, to, hist: {} };
      routes.set(key, row);
      if (!row.hops && Array.isArray(r.hops) && r.hops.length >= 2 && r.hops.length <= 40 && r.hops.every((h) => int(h)) && r.hops[0] === from && r.hops.at(-1) === to && new Set(r.hops).size === r.hops.length) row.hops = [...r.hops];
      for (const [s, c] of Object.entries(r.seconds || {})) if (/^[1-9]\d{0,4}$/.test(s) && int(c, 100000)) row.hist[s] = (row.hist[s] || 0) + c;
      // Reputation standing 4 and 5 (neutral, friendly) pay the full price; 6 and up pay 10% less.
      const costs = r.costs || {};
      const full = costs["5"] ?? costs["4"], honored = costs["6"] ?? costs["7"];
      if (row.cost === undefined && Number.isSafeInteger(full) && full >= 0 && full <= 10000000) row.cost = full;
      if (row.honored === undefined && Number.isSafeInteger(honored) && honored >= 0 && honored <= 10000000) row.honored = honored;
      for (const a of Array.isArray(r.arrivals) ? r.arrivals : []) { const q = point(a); if (q && !row.arrival) row.arrival = q; }
    }
  }
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id }); return nodes.get(id); };
  const edges = new Map(), multi = [];
  const direct = (r) => ({ from: r.from, to: r.to, seconds: medianSeconds(r.hist), samples: Object.values(r.hist).reduce((n, c) => n + c, 0), cost: r.cost ?? null, honored: r.honored ?? null });
  for (const [key, r] of routes) {
    if (!r.hops) {
      // A flight a player took without the hop list: a direct edge only when the reverse is one.
      const back = routes.get(`${r.to}>${r.from}`);
      if (back?.hops?.length === 2) r.hops = [r.from, r.to]; else { counts.routesWithoutHops++; continue; }
    }
    if (r.hops.length === 2) edges.set(key, direct(r)); else multi.push({ from: r.from, to: r.to, hops: r.hops, seconds: medianSeconds(r.hist), cost: r.cost ?? null, honored: r.honored ?? null });
  }
  // Each hop of a longer observed route is a real connection, even if nobody priced it alone.
  for (const r of multi) for (let i = 0; i + 1 < r.hops.length; i++) {
    const key = `${r.hops[i]}>${r.hops[i + 1]}`;
    if (!edges.has(key)) edges.set(key, { from: r.hops[i], to: r.hops[i + 1], seconds: null, samples: 0, cost: null, honored: null });
  }
  for (const e of edges.values()) { node(e.from); node(e.to); }
  for (const [id, m] of masters) node(id).master = m;
  for (const [key, r] of routes) if (r.arrival && nodes.has(r.to) && !nodes.get(r.to).arrival) nodes.get(r.to).arrival = r.arrival;
  // Faction: the flight master's recorded side; otherwise the side of the masters it links to.
  const linked = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const e of edges.values()) { linked.get(e.from).add(e.to); linked.get(e.to).add(e.from); }
  const masterSide = (id) => { const m = nodes.get(id).master; return m ? npcs.get(m.npcId)?.side || null : null; };
  const out = [];
  for (const n of [...nodes.values()].sort((a, b) => a.id - b.id)) {
    const row = { id: n.id, npcId: n.master?.npcId ?? null, master: n.master?.name ?? null, side: null, sideFrom: null, mapId: null, x: null, y: null, wx: null, wy: null, instance: null, positionFrom: null };
    const own = masterSide(n.id);
    if (own) { row.side = own; row.sideFrom = "master"; }
    else {
      const seen = new Set([...linked.get(n.id)].map(masterSide).filter(Boolean));
      if (seen.size) { row.side = seen.size > 1 ? "Both" : [...seen][0]; row.sideFrom = "links"; }
    }
    const p = (n.master && npcs.get(n.master.npcId)?.position) || n.arrival || null;
    if (p) Object.assign(row, { mapId: p.mapId, x: round(p.x, 4), y: round(p.y, 4), wx: round(p.wx, 1), wy: round(p.wy, 1), instance: p.instance, positionFrom: n.master && npcs.get(n.master.npcId)?.position ? "master" : "arrival" });
    out.push(row);
  }
  const maps = {};
  for (const [mapId, points] of [...fitPoints].sort((a, b) => a[0] - b[0])) { const f = fitMap(points); if (f && Object.keys(maps).length < MAX_MAPS) maps[mapId] = f; }
  // Typical flight speed over the timed direct edges, used only for labelled estimates.
  const byId = new Map(out.map((n) => [n.id, n]));
  const speeds = [...edges.values()].map((e) => { const a = byId.get(e.from), b = byId.get(e.to); return e.seconds && a.wx !== null && b.wx !== null && a.instance === b.instance ? dist(a, b) / e.seconds : null; }).filter(Boolean).sort((a, b) => a - b);
  const edgeList = [...edges.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  const pack = {
    schemaVersion: 1, kind: "forever-transport", product: "wowf", build: builds[0].build, builds: builds.map((b) => b.build), sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION,
    collectedOn: { first: dates.sort()[0], last: dates.at(-1) },
    flightSpeed: speeds.length ? round(speeds[Math.floor((speeds.length - 1) / 2)], 2) : null,
    counts: { nodes: out.length, edges: edgeList.length, timedEdges: edgeList.filter((e) => e.seconds).length, pricedEdges: edgeList.filter((e) => e.cost !== null || e.honored !== null).length, routes: multi.length, timedRoutes: multi.filter((r) => r.seconds).length, placedNodes: out.filter((n) => n.wx !== null).length, ...counts },
    nodes: out, edges: edgeList, routes: multi.sort((a, b) => a.from - b.from || a.to - b.to), maps,
  };
  return validateTransportPack(pack);
}

function validateTransportPack(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-transport" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(p.sourceCommit || "")) fail("Header.");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > MAX_BUILDS || p.builds[0] !== p.build || p.builds.some((b) => !BUILD_RE.test(b)) || new Set(p.builds).size !== p.builds.length) fail("Builds.");
  if (!/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.first || "") || !/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.last || "") || p.collectedOn.first > p.collectedOn.last) fail("Dates.");
  if (p.flightSpeed !== null && !num(p.flightSpeed, 1, 200)) fail("Speed.");
  if (!Array.isArray(p.nodes) || p.nodes.length > MAX_NODES || !Array.isArray(p.edges) || p.edges.length > MAX_EDGES || !Array.isArray(p.routes) || p.routes.length > MAX_ROUTES) fail("Sizes.");
  const ids = new Set();
  for (const n of p.nodes) {
    if (!int(n.id) || ids.has(n.id)) fail("Node id.");
    ids.add(n.id);
    if ((n.npcId === null) !== (n.master === null) || (n.npcId !== null && (!int(n.npcId) || !text(n.master)))) fail("Master.");
    if ((n.side === null) !== (n.sideFrom === null) || (n.side !== null && (!SIDES.includes(n.side) || !["master", "links"].includes(n.sideFrom))) || (n.sideFrom === "master" && n.side === "Both")) fail("Side.");
    if (n.wx === null) { if ([n.mapId, n.x, n.y, n.wy, n.instance, n.positionFrom].some((v) => v !== null)) fail("Position."); }
    else if (!int(n.mapId, 1000000) || !num(n.x, 0, 1) || !num(n.y, 0, 1) || !num(n.wx, -100000, 100000) || !num(n.wy, -100000, 100000) || !Number.isSafeInteger(n.instance) || n.instance < 0 || !["master", "arrival"].includes(n.positionFrom)) fail("Position.");
  }
  const price = (v) => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= 10000000);
  const secs = (v) => v === null || int(v, 99999);
  const keys = new Set();
  for (const e of p.edges) {
    const key = `${e.from}>${e.to}`;
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to || keys.has(key) || !secs(e.seconds) || !price(e.cost) || !price(e.honored) || !Number.isSafeInteger(e.samples) || e.samples < 0 || (e.seconds === null) !== (e.samples === 0)) fail("Edge.");
    keys.add(key);
  }
  const routeKeys = new Set();
  for (const r of p.routes) {
    const key = `${r.from}>${r.to}`;
    if (routeKeys.has(key) || keys.has(key) || !Array.isArray(r.hops) || r.hops.length < 3 || r.hops.length > 40 || r.hops[0] !== r.from || r.hops.at(-1) !== r.to || new Set(r.hops).size !== r.hops.length || !secs(r.seconds) || !price(r.cost) || !price(r.honored)) fail("Route.");
    for (let i = 0; i + 1 < r.hops.length; i++) if (!keys.has(`${r.hops[i]}>${r.hops[i + 1]}`)) fail("Route hop.");
    routeKeys.add(key);
  }
  if (!p.maps || typeof p.maps !== "object" || Array.isArray(p.maps) || Object.keys(p.maps).length > MAX_MAPS) fail("Maps.");
  for (const [k, m] of Object.entries(p.maps)) if (!/^[1-9]\d{0,6}$/.test(k) || !Number.isSafeInteger(m.instance) || m.instance < 0 || ![m.x0, m.x1, m.y0, m.y1].every((v) => num(v, -100000, 100000)) || m.x0 === m.x1 || m.y0 === m.y1 || !int(m.points, 1000000)) fail("Map.");
  const c = p.counts;
  if (!c || c.nodes !== p.nodes.length || c.edges !== p.edges.length || c.routes !== p.routes.length || c.timedEdges !== p.edges.filter((e) => e.seconds).length || c.timedRoutes !== p.routes.filter((r) => r.seconds).length || c.placedNodes !== p.nodes.filter((n) => n.wx !== null).length) fail("Counts.");
  return p;
}
let cached = null;
function loadTransportPack(file = path.join(__dirname, "../../data/forever-transport/pack.json")) {
  const bundled = arguments.length === 0;
  if (bundled && cached) return cached;
  if (fs.statSync(file).size > PACK_LIMIT) fail("Pack too large.");
  const pack = validateTransportPack(JSON.parse(fs.readFileSync(file)));
  if (bundled) cached = pack;
  return pack;
}
module.exports = { FILES, ATTRIBUTION, RAW_LIMITS, PACK_LIMIT, MAX_BUILDS, BUILD_RE, hash, medianSeconds, fitMap, toWorld, compileTransport, validateTransportPack, loadTransportPack };

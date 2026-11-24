"use strict";
// Travel planner (roadmap Q15): compares going on foot, flying, boats and zeppelins and the
// Hearthstone between two places, fastest first. Pure: the transport pack, the rides
// (transport-rides.cjs) and the character facts come in, options go out.
// Flight times and prices are what players saw; anything worked out here is marked as an estimate.
// A boat or zeppelin ride never includes the wait for the next departure: nobody can know it.
const { MAP_NAMES } = require("./map-names.cjs");
const { toWorld } = require("./transport-data.cjs");

const RUN_SPEED = 7; // yards per second on foot
const HEARTH_CAST = 10; // seconds
const CITY_MAPS = new Set([1453, 1454, 1455, 1456, 1457, 1458]);
const NEAREST = 3;
const dist = (a, b) => Math.hypot(a.wx - b.wx, a.wy - b.wy);
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const zoneName = (mapId) => MAP_NAMES[mapId] || null;

/** Display name of a flight point: the game's own name when a character saw it, else the zone and flight master. */
function nodeLabel(node, names = {}) {
  const own = names[node.id];
  if (own) return own;
  const zone = zoneName(node.mapId);
  if (zone && CITY_MAPS.has(node.mapId)) return zone;
  if (zone) return node.master ? `${zone} (${node.master})` : `${zone} flight point`;
  return node.master ? `Flight master ${node.master}` : `Flight point ${node.id}`;
}
/**
 * The bundled flight graph with what the player's own game files add (game-data.cjs flights()):
 * the game's name for every flight point, a place for points nobody recorded one for, and the
 * price of connections nobody saw a price for. Observed places and prices are never replaced.
 * Returns { pack, names, filled: { names, places, prices } }; `pack` is the same object when
 * the game files add nothing.
 */
function withGameFiles(pack, game) {
  const filled = { names: 0, places: 0, prices: 0 }, names = {};
  if (!game || typeof game.points !== "object" || !game.points) return { pack, names, filled };
  const nodes = pack.nodes.map((n) => {
    const p = game.points[n.id];
    if (!Array.isArray(p) || typeof p[0] !== "string" || !p[0] || p[0].length > 80) return n;
    names[n.id] = p[0]; filled.names++;
    if (n.wx !== null || !Number.isFinite(p[2]) || !Number.isFinite(p[3]) || !Number.isSafeInteger(p[1])) return n;
    filled.places++;
    return { ...n, wx: p[2], wy: p[3], instance: p[1], positionFrom: "game" };
  });
  const edges = pack.edges.map((e) => {
    const c = game.costs?.[`${e.from}>${e.to}`];
    if (e.cost !== null || e.honored !== null || !Number.isSafeInteger(c) || c < 0 || c > 10000000) return e;
    filled.prices++;
    return { ...e, cost: c };
  });
  return { pack: filled.places || filled.prices ? { ...pack, nodes, edges } : pack, names, filled };
}
const otherSide = (faction) => (faction === "Alliance" ? "Horde" : faction === "Horde" ? "Alliance" : null);

/** Flight points this character may use, and whether that is known or assumed. */
function usableNodes(pack, character = {}) {
  const ids = new Set(pack.nodes.map((n) => n.id));
  if (Array.isArray(character.knownNodes)) return { allowed: new Set(character.knownNodes.filter((id) => ids.has(id))), assumed: false };
  const other = otherSide(character.faction);
  // Only a flight master's own recorded side rules a point out; a side worked out from links does not.
  return { allowed: new Set(pack.nodes.filter((n) => !(other && n.sideFrom === "master" && n.side === other)).map((n) => n.id)), assumed: true };
}

function graph(pack) {
  if (pack._graph) return pack._graph;
  const nodes = new Map(pack.nodes.map((n) => [n.id, n])), edges = new Map(), out = new Map(), routes = new Map();
  const timed = pack.edges.filter((e) => e.seconds).map((e) => e.seconds).sort((a, b) => a - b);
  const typical = timed.length ? timed[Math.floor((timed.length - 1) / 2)] : 180;
  for (const e of pack.edges) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    let seconds = e.seconds, timing = "observed";
    if (!seconds) {
      if (pack.flightSpeed && a.wx !== null && b.wx !== null && a.instance === b.instance) { seconds = Math.max(20, Math.round(dist(a, b) / pack.flightSpeed)); timing = "estimated"; }
      else { seconds = typical; timing = "unknown"; }
    }
    // Full price as seen; otherwise worked out from the Honored price (always 10% less upstream).
    const cost = e.cost !== null ? e.cost : e.honored !== null ? Math.round(e.honored / 0.9) : null;
    const leg = { from: e.from, to: e.to, seconds, timing, cost, costFrom: e.cost !== null ? "full" : e.honored !== null ? "honored" : null };
    edges.set(`${e.from}>${e.to}`, leg);
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(leg);
  }
  for (const r of pack.routes) routes.set(`${r.from}>${r.to}`, r);
  const g = { nodes, edges, out, routes };
  Object.defineProperty(pack, "_graph", { value: g, enumerable: false });
  return g;
}
function summarize(g, hops, observed = null) {
  const legs = [];
  for (let i = 0; i + 1 < hops.length; i++) legs.push({ ...g.edges.get(`${hops[i]}>${hops[i + 1]}`) });
  const estimated = legs.filter((l) => l.timing === "estimated").length, unknown = legs.filter((l) => l.timing === "unknown").length;
  let seconds = legs.reduce((n, l) => n + l.seconds, 0), timing = unknown ? "unknown" : estimated ? "estimated" : "observed";
  // A whole flight a player timed beats the sum of its hops (the bird does not land in between).
  if (observed?.seconds) { seconds = observed.seconds; timing = "observed"; }
  const priced = legs.every((l) => l.cost !== null);
  let cost = priced ? legs.reduce((n, l) => n + l.cost, 0) : null, costEstimated = priced && legs.some((l) => l.costFrom !== "full");
  if (observed && observed.cost !== null) { cost = observed.cost; costEstimated = false; }
  else if (observed && observed.honored !== null && cost === null) { cost = Math.round(observed.honored / 0.9); costEstimated = true; }
  return { hops: [...hops], legs, seconds, timing, estimatedLegs: observed?.seconds ? 0 : estimated, unknownLegs: observed?.seconds ? 0 : unknown, cost, costEstimated, source: observed ? "game-route" : hops.length === 2 ? "direct" : "worked-out" };
}
/**
 * Best flight between two flight points using only the allowed points.
 * The game's own route (as players saw it offered) wins when every hop is allowed;
 * otherwise Dijkstra over the single connections by seconds.
 */
function flightRoute(pack, from, to, allowed) {
  const g = graph(pack);
  if (from === to || !g.nodes.has(from) || !g.nodes.has(to)) return null;
  const ok = (id) => !allowed || allowed.has(id);
  if (!ok(from) || !ok(to)) return null;
  if (g.edges.has(`${from}>${to}`)) return summarize(g, [from, to]);
  const seen = g.routes.get(`${from}>${to}`);
  if (seen && seen.hops.every(ok)) return summarize(g, seen.hops, seen);
  const best = new Map([[from, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let at = null, d = Infinity;
    for (const [id, v] of best) if (!done.has(id) && v < d) { at = id; d = v; }
    if (at === null) return null;
    if (at === to) break;
    done.add(at);
    for (const leg of g.out.get(at) || []) {
      if (!ok(leg.to) || done.has(leg.to)) continue;
      const v = d + leg.seconds;
      if (v < (best.get(leg.to) ?? Infinity)) { best.set(leg.to, v); prev.set(leg.to, at); }
    }
  }
  const hops = [to];
  while (hops[0] !== from) hops.unshift(prev.get(hops[0]));
  return summarize(g, hops);
}

/** A place in world yards. spec: { nodeId } | { mapId, x, y } | { mapId } (the middle of that zone). */
function place(pack, spec, names) {
  if (!spec) return null;
  if (Number.isSafeInteger(spec.nodeId)) {
    const n = graph(pack).nodes.get(spec.nodeId);
    if (!n) return null;
    return { kind: "node", nodeId: n.id, label: nodeLabel(n, names), mapId: n.mapId, instance: n.instance, wx: n.wx, wy: n.wy, placed: n.wx !== null };
  }
  if (!Number.isSafeInteger(spec.mapId)) return null;
  const exact = typeof spec.x === "number" && typeof spec.y === "number";
  const w = toWorld(pack, spec.mapId, exact ? spec.x : 0.5, exact ? spec.y : 0.5);
  const zone = zoneName(spec.mapId) || `Map ${spec.mapId}`;
  return { kind: exact ? "point" : "zone", mapId: spec.mapId, label: spec.label || (exact ? zone : `${zone} (middle of the zone)`), instance: w ? w.instance : null, wx: w ? w.wx : null, wy: w ? w.wy : null, placed: !!w };
}
function nearestNodes(pack, p, allowed, limit = NEAREST) {
  if (!p?.placed) return [];
  return pack.nodes.filter((n) => allowed.has(n.id) && n.wx !== null && n.instance === p.instance).map((n) => ({ node: n, yards: dist(n, p) })).sort((a, b) => a.yards - b.yards).slice(0, limit);
}
const walkLeg = (from, to, yards) => ({ kind: "walk", from, to, yards: Math.round(yards), seconds: Math.round(yards / RUN_SPEED), timing: "estimated" });

function flightOption(pack, a, b, allowed, assumed, names) {
  const g = graph(pack);
  const starts = a.kind === "node" && allowed.has(a.nodeId) ? [{ node: g.nodes.get(a.nodeId), yards: 0 }] : nearestNodes(pack, a, allowed);
  let ends;
  if (b.kind === "node" && allowed.has(b.nodeId)) ends = [{ node: g.nodes.get(b.nodeId), yards: 0 }];
  else if (b.kind === "zone") {
    const inZone = pack.nodes.filter((n) => allowed.has(n.id) && n.mapId === b.mapId).map((node) => ({ node, yards: 0 }));
    ends = inZone.length ? inZone : nearestNodes(pack, b, allowed);
  } else ends = nearestNodes(pack, b, allowed);
  let best = null;
  for (const s of starts) for (const e of ends) {
    if (s.node.id === e.node.id) continue;
    const route = flightRoute(pack, s.node.id, e.node.id, allowed);
    if (!route) continue;
    const seconds = s.yards / RUN_SPEED + route.seconds + e.yards / RUN_SPEED;
    if (!best || seconds < best.seconds) best = { seconds, s, e, route };
  }
  if (!best) return null;
  const label = (id) => nodeLabel(g.nodes.get(id), names);
  const legs = [];
  if (best.s.yards > 15) legs.push(walkLeg(a.label, label(best.s.node.id), best.s.yards));
  for (const l of best.route.legs) legs.push({ kind: "fly", from: label(l.from), to: label(l.to), fromNode: l.from, toNode: l.to, seconds: l.seconds, timing: l.timing, cost: l.cost });
  if (best.e.yards > 15) legs.push(walkLeg(label(best.e.node.id), b.label, best.e.yards));
  const notes = [];
  if (assumed) notes.push("If you know these flight points. The app has no saved list of the flight points this character has learned.");
  if (best.route.source === "game-route" && best.route.timing === "observed" && Math.abs(best.route.legs.reduce((n, l) => n + l.seconds, 0) - best.route.seconds) > 3) notes.push("One flight: the bird does not land in between. The leg times add up to more than the flight takes.");
  if (best.route.estimatedLegs) notes.push(`${best.route.estimatedLegs} of ${best.route.legs.length} flight legs have no recorded time; they are estimated from the distance.`);
  if (best.route.unknownLegs) notes.push(`${best.route.unknownLegs} of ${best.route.legs.length} flight legs have no recorded time and no known place; a typical flight time stands in.`);
  if (best.route.cost === null) notes.push("The price was not recorded for every leg.");
  else if (best.route.costEstimated) notes.push("Part of the price was only seen at Honored reputation; the full price is worked out from the 10% discount.");
  if (b.kind === "node" && !allowed.has(b.nodeId)) notes.push(`${b.label} is not among your learned flight points, so this lands at the nearest one you know.`);
  return {
    kind: "flight", title: "Fly", seconds: Math.round(best.seconds), exact: best.route.timing === "observed" && legs.every((l) => l.kind === "fly"),
    cost: best.route.cost, costEstimated: best.route.costEstimated, flightSeconds: best.route.seconds, flightTiming: best.route.timing, assumed, legs, notes, hops: best.route.hops,
  };
}
function walkOption(a, b) {
  if (!a.placed || !b.placed || a.instance !== b.instance) return null;
  const yards = dist(a, b);
  if (yards < 15) return null;
  return { kind: "walk", title: "On foot", seconds: Math.round(yards / RUN_SPEED), exact: false, cost: 0, costEstimated: false, legs: [walkLeg(a.label, b.label, yards)], notes: ["A straight line at running speed. Roads, hills and water make the real trip longer."] };
}
function landOptions(pack, a, b, allowed, assumed, names) {
  return [walkOption(a, b), flightOption(pack, a, b, allowed, assumed, names)].filter(Boolean).sort((x, y) => x.seconds - y.seconds);
}
const MODE_TITLE = Object.freeze({ boat: "Boat", zeppelin: "Zeppelin", airship: "Airship", tram: "Tram" });
const MODE_THE = Object.freeze({ boat: "the boat", zeppelin: "the zeppelin", airship: "the airship", tram: "the tram" });
const minutes = (seconds) => Math.max(1, Math.round(seconds / 60));
const stopPlace = (s) => ({ kind: "point", label: s.label, mapId: null, instance: s.instance, wx: s.wx, wy: s.wy, placed: true });
const mayBoard = (t, faction) => !(otherSide(faction) && t.side === otherSide(faction));
/** The best way over land between two placed points: nothing to do when they are the same spot. */
function landLink(pack, p, q, allowed, assumed, names, memo, pk, qk) {
  if (!p.placed || !q.placed || p.instance !== q.instance) return null;
  const key = `${pk}>${qk}`;
  if (memo.has(key)) return memo.get(key);
  const best = dist(p, q) < 15 ? { seconds: 0, legs: [], notes: [], cost: 0, costEstimated: false } : landOptions(pack, p, q, allowed, assumed, names)[0] || null;
  memo.set(key, best);
  return best;
}
/**
 * The fastest trip that takes at least one boat, zeppelin or airship: over land to a stop, the ride,
 * over land again, as often as needed. Rides without a known time (the tram) are left to tramOption.
 */
function rideOption(pack, a, b, allowed, assumed, names, rides, faction) {
  const usable = (rides?.transports || []).filter((t) => t.timing !== "unknown" && mayBoard(t, faction));
  if (!usable.length || !a.placed || !b.placed) return null;
  // Points: 0 the start, 1 the end, then every stop. A state is a point and whether a ride was taken.
  const points = [a, b], out = new Map();
  for (const t of usable) {
    const base = points.length;
    for (const s of t.stops) points.push(stopPlace(s));
    for (const r of t.rides) { const u = base + r.from; if (!out.has(u)) out.set(u, []); out.get(u).push({ to: base + r.to, t, r }); }
  }
  const memo = new Map(), land = (u, v) => landLink(pack, points[u], points[v], allowed, assumed, names, memo, u, v);
  const id = (u, rode) => u * 2 + (rode ? 1 : 0), best = new Map([[id(0, false), 0]]), prev = new Map(), done = new Set(), goal = id(1, true);
  for (;;) {
    let at = null, d = Infinity;
    for (const [k, v] of best) if (!done.has(k) && v < d) { at = k; d = v; }
    if (at === null) return null;
    if (at === goal) break;
    done.add(at);
    const u = at >> 1, rode = !!(at & 1), relax = (k, v, how) => { if (!done.has(k) && v < (best.get(k) ?? Infinity)) { best.set(k, v); prev.set(k, { from: at, how }); } };
    // Staying on board for another leg costs the time it lies at this stop, like the one long ride does.
    for (const e of out.get(u) || []) relax(id(e.to, true), d + e.r.seconds + (prev.get(at)?.how.ride?.t === e.t ? e.r.dock || 0 : 0), { ride: e });
    // Over land: never straight from the start to the end, and never two land links in a row.
    if (prev.get(at)?.how.land) continue;
    for (let v = 1; v < points.length; v++) {
      if (v === u || (v === 1 && !rode) || (u === 0 && v === 1)) continue;
      const link = land(u, v);
      if (link) relax(id(v, rode), d + link.seconds, { land: link });
    }
  }
  const steps = [];
  for (let k = goal; prev.has(k); k = prev.get(k).from) steps.unshift(prev.get(k).how);
  const legs = [], notes = new Set(), used = [];
  let cost = 0, costEstimated = false;
  for (const how of steps) {
    if (how.land) {
      legs.push(...how.land.legs); for (const n of how.land.notes) notes.add(n);
      if (how.land.cost === null || cost === null) cost = null; else { cost += how.land.cost; costEstimated ||= how.land.costEstimated; }
    } else {
      const { t, r } = how.ride;
      legs.push({ kind: "ride", mode: t.mode, name: t.name, from: t.stops[r.from].label, to: t.stops[r.to].label, via: r.via, seconds: r.seconds, timing: "estimated" });
      if (!used.includes(t)) used.push(t);
    }
  }
  const list = [`The wait for the next departure is not in the time: nobody can know where ${used.length === 1 ? MODE_THE[used[0].mode] : "each transport"} is when you get there.`,
    "Ride times are worked out from the path in your game files and the recorded speed; they are estimates."];
  for (const t of used) {
    const which = `${MODE_THE[t.mode]}${t.name ? ` (${t.name})` : ""}`;
    if (t.roundSeconds) list.push(`Worked out the same way, a full round of ${which} takes about ${minutes(t.roundSeconds)} min.`);
    if (!t.side) list.push(`The data does not say which faction may board ${which}.`);
    else if (!faction && t.side !== "Both") list.push(`${which[0].toUpperCase()}${which.slice(1)} counts as ${t.side === "Alliance" ? "an Alliance" : "a Horde"} transport: its stops stand at ${t.side} flight points.`);
  }
  // Walking from one dock to the next one in the same town is a change, not a trip.
  for (const l of legs) if (l.kind === "walk" && l.from === l.to) l.change = true;
  const rideLegs = legs.filter((l) => l.kind === "ride");
  return {
    kind: "ride", mode: rideLegs[0].mode, title: MODE_TITLE[rideLegs[0].mode], seconds: Math.round(best.get(goal)), exact: false, plusWait: true, rides: rideLegs.length,
    cost, costEstimated, legs, notes: [...list, ...notes],
  };
}
/** The tram: known only from the published travel reference, with no place of its own and no time. */
function tramOption(pack, a, b, allowed, assumed, names, rides, faction) {
  const t = (rides?.transports || []).find((x) => x.timing === "unknown" && mayBoard(x, faction));
  if (!t || !a.placed || !b.placed) return null;
  let pick = null;
  const memo = new Map();
  for (const r of t.rides) {
    const from = stopPlace(t.stops[r.from]), to = stopPlace(t.stops[r.to]);
    const before = landLink(pack, a, from, allowed, assumed, names, memo, "a", `s${r.from}`), after = landLink(pack, to, b, allowed, assumed, names, memo, `s${r.to}`, "b");
    if (!before || !after) continue;
    const seconds = before.seconds + after.seconds;
    if (!pick || seconds < pick.seconds) pick = { seconds, before, after, r };
  }
  if (!pick) return null;
  const cost = pick.before.cost === null || pick.after.cost === null ? null : pick.before.cost + pick.after.cost;
  const notes = new Set([
    `${t.name}: known from a published travel guide for this game, not from recorded data. Where its stations stand and how long the ride takes are not recorded, so the time is left open and this is never ranked.`,
    "The legs before and after are measured to the middle of each city.",
    ...(t.side && !faction ? [`The guide lists it for ${t.side} characters.`] : []), ...pick.before.notes, ...pick.after.notes,
  ]);
  return {
    kind: "ride", mode: t.mode, title: MODE_TITLE[t.mode], seconds: Math.round(pick.seconds), exact: false, plusWait: true, unknownTime: true, reference: true, rides: 1,
    cost, costEstimated: pick.before.costEstimated || pick.after.costEstimated,
    legs: [...pick.before.legs, { kind: "ride", mode: t.mode, name: t.name, from: t.stops[pick.r.from].label, to: t.stops[pick.r.to].label, via: [], seconds: null, timing: "unknown" }, ...pick.after.legs], notes: [...notes],
  };
}
/** Where a Hearthstone lands, as a placed point; matches a bare inn name against flight point and zone names. */
function hearthPlace(pack, hearth, names) {
  if (!hearth || typeof hearth.name !== "string" || !hearth.name.trim()) return null;
  const label = `${hearth.name} (your Hearthstone)`;
  if (Number.isSafeInteger(hearth.mapId) && typeof hearth.x === "number") { const p = place(pack, { mapId: hearth.mapId, x: hearth.x, y: hearth.y, label }, names); if (p?.placed) return p; }
  const bare = (s) => norm(s).replace(/^the /, "");
  const want = bare(hearth.name);
  const node = pack.nodes.find((n) => {
    if (n.wx === null) return false;
    const own = bare(names[n.id]);
    return (own && (own === want || own.startsWith(want + " "))) || (CITY_MAPS.has(n.mapId) && bare(zoneName(n.mapId)) === want);
  });
  if (node) return { kind: "point", label, mapId: node.mapId, instance: node.instance, wx: node.wx, wy: node.wy, placed: true, approximate: true };
  return { kind: "point", label, placed: false };
}
/**
 * from/to: { nodeId } | { mapId, x, y } | { mapId }.
 * character: { faction, knownNodes: number[] | null, names: { nodeId: name }, hearth: { name, mapId, x, y, readyAt } | null }.
 * now: epoch seconds. rides: transportRides(...) or null (no boats, zeppelins or tram then).
 * Returns options fastest first; a ride's time never includes the wait, and an option whose
 * time is not known (unknownTime) comes last.
 */
function planTrip(pack, { from, to, character = {}, now = Math.floor(Date.now() / 1000), rides = null } = {}) {
  const names = character.names || {};
  const a = place(pack, from, names), b = place(pack, to, names);
  const result = { status: "ok", from: a, to: b, options: [], notes: [], coverage: `Flight times and prices are what players recorded on game builds ${pack.builds.at(-1).split(".").pop()} to ${pack.build.split(".").pop()} (${pack.counts.timedEdges} of ${pack.counts.edges} connections timed).`, transportNote: transportNote(rides) };
  if (!a || !b) { result.status = "unknown-place"; return result; }
  if (!a.placed) result.notes.push(`The app does not know where ${a.label} is on the map, so it cannot measure a walk from there.`);
  if (!b.placed) result.notes.push(`Nobody has recorded where ${b.label} is on the map, so there is no walking estimate to it.`);
  const { allowed, assumed } = usableNodes(pack, character);
  if (!assumed && !allowed.size) result.notes.push("This character has no learned flight points saved yet. Open a flight map in game, then /reload.");
  result.options.push(...landOptions(pack, a, b, allowed, assumed, names));
  const byRide = (p, q) => rideOption(pack, p, q, allowed, assumed, names, rides, character.faction);
  // A ride is worth showing when nothing else gets there, or when it beats the fastest way over land.
  const ride = byRide(a, b);
  if (ride && (!result.options.length || ride.seconds < result.options[0].seconds)) result.options.push(ride);
  const h = hearthPlace(pack, character.hearth, names);
  if (h && h.placed) {
    const wait = Number.isFinite(character.hearth.readyAt) ? Math.max(0, Math.round(character.hearth.readyAt - now)) : 0;
    const near = b.placed && h.instance === b.instance && dist(h, b) < 15;
    const onward = near ? [] : [...landOptions(pack, h, b, allowed, assumed, names), byRide(h, b)].filter(Boolean).sort((x, y) => x.seconds - y.seconds);
    const rest = onward[0] || null;
    if (near || rest) {
      const legs = [];
      if (wait) legs.push({ kind: "wait", seconds: wait, timing: "observed" });
      legs.push({ kind: "hearth", to: character.hearth.name, seconds: HEARTH_CAST, timing: "observed" });
      if (rest) legs.push(...rest.legs);
      const notes = [];
      if (!Number.isFinite(character.hearth.readyAt)) notes.push("The app does not know your Hearthstone cooldown; this assumes it is ready.");
      if (h.approximate) notes.push("The inn's exact spot was not recorded; the flight point of the same name stands in.");
      if (rest) notes.push(...rest.notes);
      result.options.push({ kind: "hearth", title: "Hearthstone", seconds: wait + HEARTH_CAST + (rest ? rest.seconds : 0), exact: false, cost: rest ? rest.cost : 0, costEstimated: rest ? rest.costEstimated : false, legs, notes, waits: wait, then: rest ? rest.kind : null, ...(rest?.plusWait ? { plusWait: true, rides: rest.rides } : {}) });
    }
  } else if (h) result.notes.push(`Your Hearthstone goes to ${character.hearth.name}, but the app does not know where that is on the map yet. Set it at an innkeeper again with the addon running and it will remember the spot.`);
  else result.notes.push("Hearthstone: the saved character data does not say where it takes you.");
  result.options.sort((x, y) => x.seconds - y.seconds);
  // The tram has no time, so it cannot be ranked: it is offered last, and only where the way to and
  // from it is shorter than the fastest timed option.
  const rail = tramOption(pack, a, b, allowed, assumed, names, rides, character.faction);
  if (rail && (!result.options.length || rail.seconds < result.options[0].seconds)) result.options.push(rail);
  if (!result.options.length) {
    result.status = "no-route";
    const apart = a.placed && b.placed && a.instance !== b.instance;
    result.notes.push(!apart ? "No recorded flight connects these places for this character."
      : !rides?.gameFiles ? "These places are on different continents. Where boats and zeppelins stop is read from your own game files, and no game folder is connected, so the app cannot cross the sea yet."
      : "These places are on different continents, and no boat or zeppelin this character can board connects them in the data.");
  }
  return result;
}

/** What the planner knows about boats, zeppelins, airships and the tram, in one plain sentence or two. */
function transportNote(rides) {
  if (!rides) return "Boats, zeppelins, the tram and portals are not in this data.";
  const read = rides.transports.filter((t) => t.source === "game-files").length, rail = rides.transports.some((t) => t.source === "reference");
  const tail = `${rail ? " The Deeprun Tram is known only from a published guide: no place and no time." : " The tram is not in this data."} Portals are not in this data.`;
  if (!rides.known) return `No boat or zeppelin is in this data.${tail}`;
  if (!rides.gameFiles) return `The data names ${rides.known} boats, zeppelins and airships but not where they stop. That is read from your own game files once a game folder is connected.${tail}`;
  return `Boats, zeppelins and airships: the data names ${rides.known}; ${read} have their stops in your game files. Stops, ride times and factions are worked out from those files and are estimates. The wait for the next departure is never known.${tail}`;
}
/** Everything a player can pick as a place: flight points, then zones the pack can place. */
function destinations(pack, { names = {}, faction = null } = {}) {
  const other = otherSide(faction);
  const out = pack.nodes.filter((n) => !(other && n.sideFrom === "master" && n.side === other)).map((n) => ({
    id: `node:${n.id}`, kind: "flight", label: nodeLabel(n, names), sub: [zoneName(n.mapId), n.master ? `flight master ${n.master}` : null, n.side && n.side !== "Both" ? n.side : null].filter(Boolean).join(" · ") || "Place not recorded yet",
    search: norm([names[n.id], zoneName(n.mapId), n.master, `flight point ${n.id}`].filter(Boolean).join(" ")),
  }));
  for (const mapId of Object.keys(pack.maps).map(Number)) if (zoneName(mapId)) out.push({ id: `zone:${mapId}`, kind: "zone", label: zoneName(mapId), sub: CITY_MAPS.has(mapId) ? "City" : "Zone", search: norm(zoneName(mapId)) });
  return out.sort((x, y) => x.label.localeCompare(y.label) || x.id.localeCompare(y.id));
}
function searchDestinations(list, query, limit = 12) {
  const q = norm(query);
  if (!q) return list.slice(0, limit);
  const words = q.split(" ");
  return list.map((d) => ({ d, hay: `${norm(d.label)} ${d.search}` })).filter(({ hay }) => words.every((w) => hay.includes(w)))
    .sort((x, y) => Number(norm(y.d.label).startsWith(q)) - Number(norm(x.d.label).startsWith(q)) || x.d.label.localeCompare(y.d.label)).slice(0, limit).map(({ d }) => d);
}
const parsePlace = (id) => { const m = /^(node|zone):(\d{1,9})$/.exec(String(id || "")); return m ? (m[1] === "node" ? { nodeId: Number(m[2]) } : { mapId: Number(m[2]) }) : null; };

/** The planner's view of a saved character: learned flight points, their names, Hearthstone, position. */
function characterFacts(profile, profiles = []) {
  const names = {};
  for (const p of [...profiles, profile]) for (const n of p?.travel?.nodes || []) if (n.name) names[n.id] = n.name;
  const t = profile?.travel || null;
  const loc = profile?.location;
  return {
    faction: ["Alliance", "Horde"].includes(profile?.faction) ? profile.faction : null,
    knownNodes: t && t.nodes.length ? t.nodes.filter((n) => n.known).map((n) => n.id) : null,
    names,
    hearth: t?.bind ? { ...t.bind, readyAt: t.hearthReadyAt ?? null } : null,
    position: loc && Number.isSafeInteger(loc.mapId) && typeof loc.x === "number" && typeof loc.y === "number" ? { mapId: loc.mapId, x: loc.x, y: loc.y } : null,
    zone: typeof loc?.zone === "string" ? loc.zone : null,
    money: Number.isSafeInteger(profile?.ledger?.money) ? profile.ledger.money : null,
  };
}

const TRAVEL_LIMITS = Object.freeze({ nodes: 400, name: 80 });
/** Strict shape of the addon's saved travel block: { seenAt, nodes: [{ id, name?, known }], bind?, hearthReadyAt? }. */
function normalizeTravelCapture(t) {
  const bad = () => { throw Error("Invalid travel capture."); };
  const text = (s) => typeof s === "string" && s.length > 0 && s.length <= TRAVEL_LIMITS.name && !/[\x00-\x1f\x7f]/.test(s);
  const stamp = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 253402300799;
  if (!t || typeof t !== "object" || Array.isArray(t) || !stamp(t.seenAt)) bad();
  for (const k of Object.keys(t)) if (!["seenAt", "nodes", "bind", "hearthReadyAt"].includes(k)) bad();
  const list = Array.isArray(t.nodes) ? t.nodes : t.nodes && typeof t.nodes === "object" && !Object.keys(t.nodes).length ? [] : bad();
  if (list.length > TRAVEL_LIMITS.nodes) bad();
  const seen = new Set(), nodes = [];
  for (const n of list) {
    if (!n || !Number.isSafeInteger(n.id) || n.id < 1 || n.id > 2147483647 || seen.has(n.id) || typeof n.known !== "boolean" || (n.name !== undefined && !text(n.name))) bad();
    seen.add(n.id);
    nodes.push(n.name === undefined ? { id: n.id, known: n.known } : { id: n.id, name: n.name, known: n.known });
  }
  const out = { seenAt: t.seenAt, nodes: nodes.sort((a, b) => a.id - b.id) };
  if (t.bind !== undefined) {
    const b = t.bind;
    if (!b || typeof b !== "object" || !text(b.name)) bad();
    out.bind = { name: b.name };
    if (b.mapId !== undefined) {
      if (!Number.isSafeInteger(b.mapId) || b.mapId < 1 || b.mapId > 1000000 || typeof b.x !== "number" || typeof b.y !== "number" || !(b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1)) bad();
      Object.assign(out.bind, { mapId: b.mapId, x: b.x, y: b.y });
    }
  }
  if (t.hearthReadyAt !== undefined) { if (!stamp(t.hearthReadyAt)) bad(); out.hearthReadyAt = t.hearthReadyAt; }
  return out;
}

module.exports = { RUN_SPEED, HEARTH_CAST, MODE_TITLE, transportNote, rideOption, tramOption, withGameFiles, nodeLabel, usableNodes, flightRoute, planTrip, destinations, searchDestinations, parsePlace, characterFacts, normalizeTravelCapture, TRAVEL_LIMITS };

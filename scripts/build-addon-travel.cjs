"use strict";
// Offline build tool: compiles the small in-game data for /bf fly and /bf train from the
// bundled transport and trainer packs into one Lua table.
//   flights.nodes[id] = { m map, x, y map position, wx, wy world yards, i continent, s side (A/H/B),
//                         f = true when the side is the flight master's own, n flight master }
//   flights.edges[from][to] = { seconds (0 unknown), copper (-1 unknown), 1 when the price is worked out }
//   flights.routes["from>to"] = { h hops, s seconds (0 unknown), c copper (-1 unknown) }
//   flights.maps[mapId] = { i continent, x0, x1, y0, y1 }  (zone map position -> world yards)
//   train[Class] = rows { spell id, level, copper (-1 unknown), name, rank, kind }, level known only
// Usage: node scripts/build-addon-travel.cjs [--check]
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const out = path.join(root, "addon", "BackstageForever", "BackstageForeverTravelData.lua");
const { loadTransportPack } = require("../src/core/transport-data.cjs");
const { loadTrainerPack, priceOf } = require("../src/core/trainer-data.cjs");
const MAX_BYTES = 96 * 1024;

function luaString(value) {
  return '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
}
function lit(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return luaString(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return "{" + v.map(lit).join(",") + "}";
  return "{" + Object.keys(v).sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? a - b : a.localeCompare(b))).filter((k) => v[k] !== undefined && v[k] !== null).map((k) => (/^[A-Za-z_]\w*$/.test(k) ? k : `[${/^\d+$/.test(k) ? k : luaString(k)}]`) + "=" + lit(v[k])).join(",") + "}";
}
const SIDE = { Alliance: "A", Horde: "H", Both: "B" };
const KIND = { class: undefined, portal: "p", pet: "t" };

/** Bundled packs by default; tests pass small packs. */
function compile(t = loadTransportPack(), tr = loadTrainerPack()) {
  const nodes = {}, edges = {}, routes = {}, maps = {};
  for (const n of t.nodes) nodes[n.id] = { m: n.mapId, x: n.x, y: n.y, wx: n.wx, wy: n.wy, i: n.instance, s: SIDE[n.side], f: n.sideFrom === "master" ? true : undefined, n: n.master };
  for (const e of t.edges) {
    const worked = e.cost === null && e.honored !== null;
    const row = [e.seconds || 0, e.cost !== null ? e.cost : worked ? Math.round(e.honored / 0.9) : -1];
    if (worked) row.push(1);
    (edges[e.from] ||= {})[e.to] = row;
  }
  for (const r of t.routes) routes[`${r.from}>${r.to}`] = { h: r.hops, s: r.seconds || 0, c: r.cost !== null ? r.cost : r.honored !== null ? Math.round(r.honored / 0.9) : -1 };
  // Only the zone maps a flight point sits on, or a neighbour could stand on: every fitted map.
  for (const [id, m] of Object.entries(t.maps)) maps[id] = { i: m.instance, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1 };
  const train = {};
  for (const [name, rows] of Object.entries(tr.classes)) {
    train[name] = rows.filter((r) => r.level > 0).map((r) => { const p = priceOf(r); const row = [r.id, r.level, p.copper === null ? -1 : p.copper, r.name, r.rank || ""]; if (KIND[r.from]) row.push(KIND[r.from]); return row; });
  }
  const data = { build: t.build, trainBuild: tr.build, speed: t.flightSpeed, flights: { nodes, edges, routes, maps }, train };
  const text = [
    "-- Generated offline by scripts/build-addon-travel.cjs; do not edit.",
    "-- Flight points, flight times, flight prices and trainer costs from Efficient Games",
    "-- (https://efficient.games), licensed under CC BY 4.0. They are what players saw; a 0 time or",
    "-- a -1 price means nobody recorded it. Flight point names are not in this data.",
    "BackstageForeverTravelData=" + lit(data),
    "",
  ].join("\n");
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error(`BackstageForeverTravelData.lua would be ${Buffer.byteLength(text)} bytes; the cap is ${MAX_BYTES}.`);
  return text;
}

if (require.main === module) {
  const text = compile();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== text) { console.error("BackstageForeverTravelData.lua is stale; run npm run build:addon-travel."); process.exit(1); }
    console.log(`In-game travel and trainer data reproduction passed (${Buffer.byteLength(text)} bytes).`);
  } else {
    fs.writeFileSync(out, text);
    console.log(`Wrote ${path.relative(root, out)} (${Buffer.byteLength(text)} bytes).`);
  }
}
module.exports = { compile, MAX_BYTES };

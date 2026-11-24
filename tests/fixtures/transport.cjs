"use strict";
// A tiny synthetic upstream snapshot for the transport graph tests: five flight points on one map.
//   1 (Ann, Horde) -100s/1s-> 2 (Bob, Horde) -200s/3s-> 3 (Cid, Horde) -> 4 (no master, never placed)
//   2 -> 3 -> 5 is only seen as hops of a longer route, so 3>5 has no time and no price.
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const commit = "a".repeat(40), build = "1.60.1.100", older = "1.60.1.90";
const meta = (dataset, clientBuild, first = "2026-11-10", last = "2026-11-12") => ({ attribution: ATTRIBUTION, clientBuild, collectedOn: { first, last }, dataset, license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources: 2 });
const at = (mapX, mapY) => ({ instance: 1, uiMap: 1413, mapX, mapY, worldX: 1000 - 1000 * mapY, worldY: 1000 - 1000 * mapX });
const master = (name, side, x, y) => ({ name, side, interactions: ["Gossip", "TaxiNode"], positions: [at(x, y)] });
function flights(clientBuild = build) {
  return {
    meta: meta("flights", clientBuild),
    masters: { 11: { name: "Ann", node: 1, sources: 1 }, 12: { name: "Bob", node: 2, sources: 1 }, 13: { name: "Cid", node: 3, sources: 1 } },
    routes: {
      "1>2": { hops: [1, 2], seconds: { 100: 2, 104: 1 }, costs: { 5: 100, 6: 90 }, arrivals: [at(0.5, 0.5)], sources: 2 },
      "2>1": { hops: [2, 1], costs: { 6: 90 }, sources: 1 },
      "2>3": { hops: [2, 3], seconds: { 200: 1 }, costs: { 5: 300 }, sources: 1 },
      "3>2": { hops: [3, 2], costs: { 5: 300 }, sources: 1 },
      "1>3": { hops: [1, 2, 3], seconds: { 280: 1 }, costs: { 5: 400 }, sources: 1 },
      "3>4": { hops: [3, 4], costs: { 5: 50 }, sources: 1 },
      "2>5": { hops: [2, 3, 5], costs: { 5: 700 }, sources: 1 },
    },
  };
}
function npcs(clientBuild = build) {
  return { meta: meta("npcs", clientBuild), npcs: { 11: master("Ann", "Horde", 0.1, 0.1), 12: master("Bob", "Horde", 0.5, 0.5), 13: master("Cid", "Horde", 0.9, 0.9), 14: { name: "Guard", positions: [at(0.3, 0.7)], interactions: ["Gossip"] } }, objects: {}, approached: {} };
}
// Moving transports as upstream records them (object type 15: data = [path, speed, acceleration]).
// 9004 is of an unknown model, 9005 has no path and 9008 is a chest: none of them is a transport.
function objects(clientBuild = build) {
  const row = (name, displayId, data, type = 15) => ({ type, name, displayId, data: [...data, 0, 0, 0], size: 1, sources: 1 });
  return { meta: { ...meta("object_details", clientBuild), locale: "enUS" }, objects: {
    9001: row("Zeppelin - Anntown to Hordeport", 3031, [70, 30, 1]), 9002: row("Sea Lark", 3015, [71, 30, 1]), 9003: row("Long Ferry", 3015, [72, 30, 1]),
    9004: row("Odd Thing", 77, [75, 30, 1]), 9005: row("Pathless", 3015, [0, 30, 1]), 9006: row("TEST Ship", 3015, [73, 30, 0]), 9007: row("Cloud Skycutter", 126793, [74, 30, 1]), 9008: row("Chest", 10, [43, 1683, 0], 3),
  } };
}
// What the player's game files add (game-data.cjs flights() and transportPaths()). Flight points:
// [name, continent, x, y, sides (1 Alliance, 2 Horde, 3 both, 0 not a real flight point)].
// Kalimdor (1) is the fixture map; Eastern Kingdoms (0) has Eastdock (Alliance), Hordeport (Horde) and
// Midport, which has a flight point for each side.
function game() {
  return {
    points: {
      1: ["Anntown, The Barrens", 1, 900, 900, 2], 2: ["Bobville, The Barrens", 1, 500, 500, 2], 3: ["Cidport, The Barrens", 1, 100, 100, 3],
      50: ["Eastdock, Elwynn", 0, 500, 500, 1], 51: ["Hordeport, Elwynn", 0, 100, 100, 2], 52: ["Midport, Elwynn", 0, 900, 900, 1], 53: ["Midport, Elwynn", 0, 905, 900, 2], 60: ["Transport, Anntown Zeppelins", 1, 880, 901, 0],
    },
    costs: {},
    paths: {
      70: { stops: [[1, 880, 900, 60], [0, 120, 100, 60]], yards: [3000, 1500] },
      71: { stops: [[1, 100, 130, 60], [0, 500, 520, 60]], yards: [3000, 3000] },
      72: { stops: [[1, 100, 130, 45], [0, 2600, 2600, 45], [0, 7000, 7000, 45]], yards: [3000, 3000, 3000] },
      73: { stops: [[1, 100, 70, 60], [0, 900, 880, 60]], yards: [3000, 3000] },
    },
  };
}
// The tram as the published travel reference has it (data/forever-travel): no place, no time.
function reference() {
  const edge = (from, to) => ({ id: `tram-${from}-${to}`, from, to, mode: "tram", faction: "Alliance", scope: "published-forever-guidance", sourceIds: ["E4"] });
  return { nodes: [{ id: "stormwind-tram", label: "Stormwind tram entrance", cityId: "stormwind" }, { id: "ironforge-tram", label: "Ironforge tram entrance", cityId: "ironforge" }], edges: [edge("stormwind-tram", "ironforge-tram"), edge("ironforge-tram", "stormwind-tram")] };
}
const buffers = (f = flights(), n = npcs(), o = null) => ({ "flights.json": Buffer.from(JSON.stringify(f)), "npcs.json": Buffer.from(JSON.stringify(n)), ...(o ? { "object_details.enUS.json": Buffer.from(JSON.stringify(o)) } : {}) });
module.exports = { ATTRIBUTION, commit, build, older, meta, at, flights, npcs, objects, game, reference, buffers };

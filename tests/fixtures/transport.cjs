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
const buffers = (f = flights(), n = npcs()) => ({ "flights.json": Buffer.from(JSON.stringify(f)), "npcs.json": Buffer.from(JSON.stringify(n)) });
module.exports = { ATTRIBUTION, commit, build, older, meta, at, flights, npcs, buffers };

"use strict";
// Synthetic facts; publisher attribution: data/forever-vendors/NOTICE.
const { ATTRIBUTION } = require("../../src/core/knowledge.cjs");
const commit = "23f9636486d3d60479dc0bcee2356053c33faf2c", build = "1.60.1.70862";
function fixture() {
  const meta = dataset => ({ product: "wowf", clientBuild: build, schemaVersion: 1, dataset, license: "CC BY 4.0", attribution: ATTRIBUTION, sources: 3, collectedOn: { first: "2026-11-07", last: "2026-11-09" } });
  return {
    "vendors.json": { meta: meta("vendors"), vendors: { 10: { name: "Synthetic seller", sources: 2, lastSeen: "2026-11-08", positions: [{ uiMap: 1456, mapX: 0.4, mapY: 0.5 }], entries: { "item:2320": { itemId: 2320, name: "Coarse Thread", sources: 1, stack: 5, costs: { 5: 10 } } } } } },
    "npcs.json": { meta: meta("npcs"), npcs: { 10: { name: "Synthetic seller", interactions: ["Merchant"], side: "Horde" } } },
    "creatures.json": { meta: meta("creatures"), creatures: { 10: { name: "Synthetic seller", sources: 2, reactions: { Horde: [4, 5] } } } },
  };
}

module.exports = { fixture, commit, build };

"use strict";
// The bundled packs the world search index reads, straight from disk. The app passes the copies it
// already holds (see main.cjs); the addon finder compiler and the tests use this.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "..");

function sourcesFromDisk() {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const optional = (fn) => { try { return fn(); } catch { return null; } };
  const knowledgePack = read("data/forever/pack.json");
  const vendorPack = optional(() => require("./vendor-facts.cjs").loadVendorPack());
  const insights = optional(() => require("./insights-data.cjs").loadBundledInsights());
  const worldPack = optional(() => require("./world-finds.cjs").loadWorldPack());
  const transport = optional(() => require("./transport-data.cjs").loadTransportPack());
  const acquisitionPack = optional(() => require("./acquisition-data.cjs").loadAcquisitionPack());
  const pins = require("./world-map.cjs").buildStaticIndex({
    knowledgePack, npcReference: optional(() => read("data/forever-npc-locations/pack.json")),
    travelReference: optional(() => require("./travel-data.cjs").loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json")))),
    vendorPack, insights, acquisitionPack, worldPack,
  });
  const { buildAtlas, loadEncounters } = require("./dungeon-atlas.cjs");
  return {
    knowledgePack, pins, vendorPack, insights, worldPack, transport,
    trainerPack: optional(() => require("./trainer-data.cjs").loadTrainerPack()),
    lootPack: optional(() => require("./loot-data.cjs").loadLootPack()),
    bossLootPack: optional(() => require("./boss-loot-data.cjs").loadBossLootPack()),
    atlas: optional(() => buildAtlas({ profile: null, encounters: loadEncounters(), knowledgePack })),
    creatures: optional(() => require("./creature-data.cjs").creatureIndex(require("./creature-data.cjs").loadCreaturePack())),
    levelingZones: optional(() => require("./leveling.cjs").loadLevelingPack().zones),
    instanceNames: optional(() => require("./boss-loot.cjs").INSTANCE_NAMES) || {},
    commands: optional(() => require("../renderer/commands.js")),
  };
}
module.exports = { sourcesFromDisk };

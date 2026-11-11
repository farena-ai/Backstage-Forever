"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { WorldMap } = require("../src/core/world-map.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const index = new KnowledgeIndex(read("data/forever/pack.json"));
function make(profile, live = null) {
  const state = { activeProfileId: "A", profiles: [{ id: "A", ...profile }] };
  return new WorldMap({ getState: () => state, knowledge: { bundled: index, index: () => index }, npcReference: read("data/forever-npc-locations/pack.json"), travelReference: loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json"))), vendorPack: loadVendorPack(), insights: loadBundledInsights(), acquisitionPack: loadAcquisitionPack(), live: { status: () => ({ frame: live }) } });
}
const player = { name: "P", level: 15, faction: "Horde", location: { zone: "The Barrens", mapId: 1413, x: 0.52, y: 0.29 }, quests: [{ id: 96, title: "Call of Water", complete: true, objectives: [] }], gathering: { records: [{ id: "g1", method: "mining", mapId: 1413, x: 0.4, y: 0.5, name: "Copper Vein", observedAt: "2026-11-11T10:00:00Z" }] } };

test("a zone map combines references, quests, finds and the saved position", () => {
  const m = make(player).build({});
  assert.equal(m.mapId, 1413);
  assert.equal(m.mapName, "The Barrens");
  assert.ok(m.counts["quest-turnin"] >= 1 && m.counts["quest-giver"] >= 5 && m.counts.flight >= 1 && m.counts.vendor >= 5);
  assert.equal(m.pins.find((p) => p.kind === "find").gather, "ore");
  assert.ok(m.pins.some((p) => p.kind === "town" && p.label === "Crossroads"));
  assert.deepEqual(m.player.saved && [m.player.saved.x, m.player.saved.y], [0.52, 0.29]);
  assert.equal(m.player.live, null);
  // Quests to pick up stay within a sensible level window and respect faction.
  assert.ok(m.pins.filter((p) => p.kind === "quest-giver").every((p) => !/\(level (2[0-9]|[3-9]\d)\)/.test(p.sub)));
});

test("the live position leads, and frames from another character are ignored", () => {
  const { identityHash } = require("../src/core/live-bridge.cjs");
  const frame = { characterHash: identityHash("guid-A"), position: { mapId: 1456, x: 0.5, y: 0.5, facing: 1 }, mounted: false };
  const mine = make({ ...player, source: { kind: "wow-addon", id: "guid-A" } }, frame).build({});
  assert.equal(mine.mapId, 1456);
  assert.deepEqual([mine.player.live.x, mine.player.live.y], [0.5, 0.5]);
  const other = make({ ...player, source: { kind: "wow-addon", id: "guid-B" } }, frame).build({});
  assert.equal(other.mapId, 1413);
  assert.equal(other.player.live, null);
});

test("search finds flight masters, trainers and named NPCs across zones, nearest first", () => {
  const wm = make(player);
  const flights = wm.search("flight master").results;
  assert.ok(flights.length >= 3);
  assert.equal(flights[0].label, "Devrak", "the Barrens flight master is nearest");
  assert.ok(wm.search("trainer").results.every((r) => r.kind === "trainer"));
  assert.equal(wm.search("Cairne Bloodhoof").results[0].mapName, "Thunder Bluff");
  assert.throws(() => wm.search(""));
  assert.throws(() => wm.build([]));
});

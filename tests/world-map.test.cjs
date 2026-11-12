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
  const { identityHash, rememberLiveKey } = require("../src/core/live-bridge.cjs");
  // Profiles hold a digest of the GUID; the live key is learned when SavedVariables are read.
  rememberLiveKey("digest-A", "guid-A"); rememberLiveKey("digest-B", "guid-B");
  const frame = { characterHash: identityHash("guid-A"), position: { mapId: 1456, x: 0.5, y: 0.5, facing: 1 }, mounted: false };
  const mine = make({ ...player, source: { kind: "wow-addon", id: "digest-A" } }, frame).build({});
  assert.equal(mine.mapId, 1456);
  assert.deepEqual([mine.player.live.x, mine.player.live.y], [0.5, 0.5]);
  const other = make({ ...player, source: { kind: "wow-addon", id: "digest-B" } }, frame).build({});
  assert.equal(other.mapId, 1413);
  assert.equal(other.player.live, null);
});

test("search finds flight masters, trainers and named NPCs across zones, nearest first", () => {
  const wm = make(player);
  const flights = wm.search("flight master").results;
  assert.ok(flights.length >= 3);
  assert.equal(flights[0].label, "Devrak", "the Barrens flight master is nearest");
  assert.ok(wm.search("trainer").results.every((r) => r.kind === "class-trainer" || r.kind === "profession-trainer"));
  assert.equal(wm.search("Cairne Bloodhoof").results[0].mapName, "Thunder Bluff");
  assert.throws(() => wm.search(""));
  assert.throws(() => wm.build([]));
});

test("a live frame never binds to a character whose live key has not been read", () => {
  const { identityHash } = require("../src/core/live-bridge.cjs");
  const frame = { characterHash: identityHash("guid-unread"), position: { mapId: 1456, x: 0.5, y: 0.5, facing: 1 }, mounted: false };
  const m = make({ ...player, source: { kind: "wow-addon", id: "digest-never-read" } }, frame).build({});
  assert.equal(m.player.live, null);
});

test("the map explains a live frame from a new or different character instead of ignoring it", () => {
  const { identityHash, rememberLiveKey } = require("../src/core/live-bridge.cjs");
  rememberLiveKey("digest-mine", "guid-mine"); rememberLiveKey("digest-alt", "guid-alt");
  const at = { position: { mapId: 1456, x: 0.5, y: 0.5, facing: 1 }, mounted: false };
  const me = { ...player, source: { kind: "wow-addon", id: "digest-mine" } };
  const fresh = make(me, { ...at, characterHash: identityHash("guid-brand-new") }).build({});
  assert.equal(fresh.player.live, null);
  assert.equal(fresh.player.liveIssue, "unsaved-character");
  assert.equal(fresh.player.liveKey, identityHash("guid-mine"));
  assert.equal(make(me, { ...at, characterHash: identityHash("guid-alt") }).build({}).player.liveIssue, "other-character");
  assert.equal(make(me, { ...at, characterHash: identityHash("guid-mine") }).build({}).player.liveIssue, null);
});

test("trainers split into class and profession pins, and NPCs carry their faction", () => {
  const { trainerKind, friendlyTo } = require("../src/core/world-map.cjs");
  assert.equal(trainerKind("Priest Trainer"), "class-trainer");
  assert.equal(trainerKind("Weapon Master"), "class-trainer");
  assert.equal(trainerKind("Journeyman Tailor"), "profession-trainer");
  assert.equal(trainerKind("Mining Trainer"), "profession-trainer");
  assert.deepEqual(friendlyTo({ Horde: [5], Alliance: [1] }), ["Horde"]);
  const tirisfal = make({ ...player, level: 3, location: { zone: "Tirisfal Glades", mapId: 1420, x: 0.3, y: 0.7 } }).build({ mapId: 1420 });
  assert.ok(tirisfal.counts["class-trainer"] >= 1 && tirisfal.counts["profession-trainer"] >= 1);
  assert.equal(tirisfal.counts.trainer, undefined);
  // An Alliance character sees Horde-only NPCs marked, not counted.
  const ally = make({ ...player, faction: "Alliance", level: 3 }).build({ mapId: 1420 });
  assert.ok(ally.counts.otherFaction > 0);
  assert.ok(ally.pins.filter((p) => p.otherFaction).every((p) => !p.sides.includes("Alliance")));
});

test("an NPC card says who they are and what they offer this character", () => {
  const wm = make({ ...player, level: 3, faction: "Horde", className: "Priest", quests: [] });
  const priest = wm.npc(2123);
  assert.equal(priest.trainer.forYou, true);
  const asMage = make({ ...player, level: 3, faction: "Horde", className: "Mage", quests: [] }).npc(2123);
  assert.equal(asMage.trainer.forYou, false);
  assert.ok(asMage.trainer.services.every((sv) => sv.learnable === null), "another class's spells are never 'learnable now'");
  assert.equal(priest.name, "Dark Cleric Duesten");
  assert.ok(priest.roles.includes("Priest Trainer"));
  assert.deepEqual(priest.sides, ["Horde"]);
  assert.equal(priest.trainer.kind, "class-trainer");
  assert.ok(priest.trainer.services.some((s) => s.learnable === true) && priest.trainer.services.some((s) => s.learnable === false), "splits learnable now vs later at level 3");
  assert.ok(priest.questsGiven.some((q) => q.title === "In Favor of Darkness" && q.status === "too-high"));
  const vendor = wm.npc(2115);
  assert.ok(vendor.vendor.items.length >= 2 && vendor.roles.includes("Vendor"));
  assert.equal(wm.npc(999999999), null);
  assert.throws(() => wm.npc("2123"));
});

test("searching a specific trainer ranks the exact match above any nearby trainer", () => {
  const r = make(player).search("hunter trainer").results;
  assert.match(r[0].sub, /Hunter Trainer/);
});

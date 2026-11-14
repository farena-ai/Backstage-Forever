"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { WorldMap } = require("../src/core/world-map.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");
const { loadCreaturePack, creatureIndex } = require("../src/core/creature-data.cjs");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const index = new KnowledgeIndex(read("data/forever/pack.json"));
function make(profile, live = null) {
  const state = { activeProfileId: "A", profiles: [{ id: "A", ...profile }] };
  return new WorldMap({ getState: () => state, knowledge: { bundled: index, index: () => index }, npcReference: read("data/forever-npc-locations/pack.json"), travelReference: loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json"))), vendorPack: loadVendorPack(), insights: loadBundledInsights(), acquisitionPack: loadAcquisitionPack(), creaturePack: loadCreaturePack(), live: { status: () => ({ frame: live }) } });
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

test("classic difficulty colours follow the grey threshold and the +3/+5 steps", () => {
  const { difficulty, greyLevel } = require("../src/core/world-map.cjs");
  assert.deepEqual([1, 5, 10, 20, 39, 40, 60].map(greyLevel), [0, 0, 4, 13, 31, 31, 47]);
  const at = (L) => (m) => difficulty(L, m);
  assert.deepEqual([4, 5, 8, 12, 13, 14, 15, 30].map(at(10)), ["grey", "green", "yellow", "yellow", "orange", "orange", "red", "red"]);
  assert.deepEqual([1, 2, 4, 6, 8].map(at(3)), ["yellow", "yellow", "yellow", "orange", "red"], "nothing is grey or green within two levels");
  assert.deepEqual([1, 2].map(at(5)), ["green", "green"], "nothing is grey up to level 5");
  assert.deepEqual([1, 2, 3].map(at(6)), ["grey", "green", "green"]);
  assert.deepEqual([22, 23, 27, 28, 32, 33, 35].map(at(30)), ["grey", "green", "green", "yellow", "yellow", "orange", "red"]);
  assert.deepEqual([47, 48, 57, 58, 62, 63, 65].map(at(60)), ["grey", "green", "green", "yellow", "yellow", "orange", "red"]);
  assert.equal(difficulty(20, null, true), "red", "a skull is always red");
  assert.equal(difficulty(null, 10), null, "no level, no colour");
});

test("objective spots become a centre and radius per cluster; lone far spots are dropped", () => {
  const { areaShapes } = require("../src/core/world-map.cjs");
  const around = (x, y, n, d = 0.008) => Array.from({ length: n }, (_, i) => ({ mapId: 1, x: x + d * Math.cos(i), y: y + d * Math.sin(i) }));
  const shapes = areaShapes([...around(0.5, 0.5, 10), ...around(0.8, 0.2, 4), { mapId: 1, x: 0.1, y: 0.9 }]);
  assert.equal(shapes.length, 2);
  assert.ok(Math.abs(shapes[0].x - 0.5) < 0.003 && Math.abs(shapes[0].y - 0.5) < 0.003 && shapes[0].spots === 10);
  assert.ok(shapes[0].radius >= 0.018 && shapes[0].radius <= 0.03, "radius covers the spots with a little margin");
  assert.equal(shapes[1].spots, 4);
  assert.deepEqual(areaShapes([{ mapId: 1, x: 0.3, y: 0.3 }]), [{ x: 0.3, y: 0.3, radius: 0.018, spots: 1 }]);
  assert.deepEqual(areaShapes([]), []);
  // A huge spread is capped.
  assert.ok(areaShapes(Array.from({ length: 30 }, (_, i) => ({ mapId: 1, x: 0.1 + i * 0.02, y: 0.5 })))[0].radius <= 0.12);
});

test("objective areas name the creature, its levels, your difficulty colour and elite warnings", () => {
  const { objectiveAreas, hostileCamps } = require("../src/core/world-map.cjs");
  const spots = (x, y) => Array.from({ length: 6 }, (_, i) => ({ mapId: 1411, x: x + i * 0.004, y }));
  const record = { id: 900, title: "Pirate Trouble", objectives: [{ index: 1, type: "monster", required: 12, objectId: 3381 }, { index: 2, type: "monster", required: 1, objectId: 448 }, { index: 3, type: "item", required: 5, objectId: 5 }, { index: 4, type: "monster", required: 1, objectId: 3098 }] };
  const locs = [{ index: 1, type: "monster", positions: spots(0.6, 0.4) }, { index: 2, type: "monster", positions: spots(0.2, 0.2) }, { index: 3, type: "item", positions: [...spots(0.7, 0.7), { mapId: 1413, x: 0.1, y: 0.1 }] }, { index: 4, type: "monster", positions: spots(0.4, 0.8) }];
  const index = { pack: { build: "b", quests: {}, npcs: {}, creatures: { 3381: { name: "Southsea Brigand" }, 448: { name: "Hogger" } }, items: { 5: { name: "Shiny Shell" } } },
    details: () => ({ status: "match", record, objectiveLocations: locs, turnIns: [] }) };
  const profile = { level: 10, faction: "Horde", quests: [{ id: 900, title: "Pirate Trouble", complete: false, objectives: [{ text: "3/12 Southsea Brigand slain", done: false }, { text: "0/1 Hogger slain", done: false }, { text: "0/5 Shiny Shell", done: false }, { text: "1/1 Mottled Boar slain", done: true }] }] };
  const areas = objectiveAreas(profile, index, creatureIndex(loadCreaturePack()), 1411);
  assert.deepEqual(areas.map((a) => a.label), ["Kill 12 Southsea Brigand", "Kill Hogger", "Collect 5 Shiny Shell"], "done objectives and other maps are left out");
  const [brigand, hogger, shells] = areas;
  assert.equal(brigand.kind, "objective-area");
  assert.equal(brigand.questTitle, "Pirate Trouble");
  assert.equal(brigand.status, "active");
  assert.equal(brigand.progress, "3/12 Southsea Brigand slain");
  assert.equal(brigand.levels, "12–13");
  assert.equal(brigand.difficulty, "orange", "level 13 is +3 for a level 10");
  assert.equal(brigand.creature.hostile, true);
  assert.equal(brigand.warning, null);
  assert.ok(Math.abs(brigand.x - 0.61) < 0.001 && brigand.y === 0.4 && brigand.radius >= 0.018);
  assert.equal(hogger.creature.elite, true);
  assert.equal(hogger.difficulty, "yellow");
  assert.match(hogger.warning, /^Hogger is elite \(level 11\): much tougher than a normal enemy\. Bring a group/);
  assert.equal(shells.creature, null);
  assert.equal(shells.difficulty, null);
  // At level 16 Hogger is green and soloable (grey from 17), and the camp list warns once per creature.
  const later = objectiveAreas({ ...profile, level: 16 }, index, creatureIndex(loadCreaturePack()), 1411);
  assert.equal(later[1].difficulty, "green");
  assert.match(later[1].warning, /You out-level it/);
  const camps = hostileCamps(areas);
  assert.deepEqual(camps.map((c) => [c.name, c.levels, c.elite, c.quests.map((q) => q.title)]), [["Hogger", "11", true, ["Pirate Trouble"]]]);
  assert.equal(camps[0].areaId, hogger.id);
  // Without the creature reference the areas remain, without levels or colours.
  assert.equal(objectiveAreas(profile, index, null, 1411)[0].levels, null);
});

test("zone maps carry objective areas and hostile camps for the selected character", () => {
  const durotar = make({ ...player, level: 6, location: { zone: "Durotar", mapId: 1411, x: 0.5, y: 0.5 }, quests: [] }).build({ mapId: 1411 });
  assert.ok(durotar.areas.length >= 10);
  assert.equal(durotar.counts["objective-area"], durotar.areas.length);
  assert.ok(durotar.areas.every((a) => a.mapId === 1411 && a.radius > 0 && a.radius <= 0.12 && a.status === "available"));
  const sailor = durotar.areas.find((a) => a.target === "Kul Tiras Sailor");
  assert.equal(sailor.difficulty, "yellow");
  assert.equal(sailor.creature.hostile, true);
  const barrens = make({ ...player, level: 20 }).build({ mapId: 1413 });
  const pillager = barrens.camps.find((c) => c.name === "Outraged Pillager");
  assert.ok(pillager?.elite && /elite/.test(pillager.warning));
  // An Alliance character never gets Horde-only quest areas.
  const elwynn = make({ ...player, faction: "Alliance", level: 6, quests: [] }).build({ mapId: 1429 });
  assert.ok(elwynn.areas.length >= 5 && elwynn.areas.some((a) => a.target === "Kobold Worker"));
  const quests = read("data/forever/pack.json").quests;
  const allyDurotar = make({ ...player, faction: "Alliance", level: 6, quests: [] }).build({ mapId: 1411 }).areas;
  assert.ok(allyDurotar.length < durotar.areas.length && allyDurotar.every((a) => !quests[a.questId].sides?.length || quests[a.questId].sides.includes("Alliance")));
});

test("your remembered herbs, ore and chests become find pins and a per-zone heat map", () => {
  const { findPins, gatheringHeat } = require("../src/core/world-map.cjs");
  const rec = (method, mapId, x, y) => ({ id: `wowf:${method}:1:${mapId}:${x}:${y}:1.60.1.70888`, method, entityId: 1, itemIds: [2770], mapId, x, y, observedAt: "2026-11-11T12:00:00.000Z", clientBuild: "1.60.1.70888", name: method === "chest" ? "Battered Chest" : "Node", evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true });
  const profile = { gathering: { records: [rec("herbalism", 1411, 0.1, 0.1), rec("herbalism", 1411, 0.12, 0.1), rec("mining", 1411, 0.5, 0.5), rec("chest", 1411, 0.7, 0.2), rec("mining", 1413, 0.4, 0.4), rec("chest", 1411, 2, 0.2)] } };
  const pins = findPins(profile, 1411);
  assert.deepEqual(pins.map((p) => p.gather), ["herb", "herb", "ore", "chest"]);
  assert.match(pins[3].sub, /chest you opened/);
  const heat = gatheringHeat(profile, 1411);
  assert.equal(heat.points.length, 4);
  assert.deepEqual(heat.totals, { herb: 2, ore: 1, chest: 1 });
  assert.deepEqual(heat.zones.map((z) => [z.mapId, z.herb, z.ore, z.chest, z.total]), [[1411, 2, 1, 1, 4], [1413, 0, 1, 0, 1]]);
  assert.equal(heat.zones[0].mapName, "Durotar");
  assert.deepEqual(gatheringHeat(null, 1411), { points: [], totals: { herb: 0, ore: 0, chest: 0 }, zones: [] });
});

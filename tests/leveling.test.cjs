"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { LevelingAdvisor, loadLevelingPack, validateLevelingPack, hubOf } = require("../src/core/leveling.cjs");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const pack = read("data/forever/pack.json"), insights = read("data/forever-insights/pack.json");
const advisor = (profile) => new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", ...profile }] }), knowledge: { bundled: { pack } }, insights });

test("the reviewed zone table is valid and covers every faction's 1-60 path", () => {
  const p = loadLevelingPack();
  for (const f of ["Horde", "Alliance"]) {
    for (let lvl = 1; lvl <= 60; lvl++) assert.ok(p.zones.some((z) => (z.faction === f || z.faction === "Contested") && z.min <= lvl && lvl <= z.max), `${f} has a zone at ${lvl}`);
  }
  assert.throws(() => validateLevelingPack({ ...p, zones: [{ ...p.zones[0], mapId: 1 }] }), /unknown map/);
  assert.throws(() => validateLevelingPack({ ...p, zones: [p.zones[0], p.zones[0]] }), /duplicate/);
});

test("a level 16 Horde hunter near Orgrimmar is sent to the Barrens with quests and a hub", () => {
  const r = advisor({ level: 16, faction: "Horde", className: "Hunter", race: "Orc", location: { mapId: 1454, x: 0.5, y: 0.5 }, quests: [] }).advise();
  assert.equal(r.status, "ok");
  assert.equal(r.next.name, "The Barrens");
  assert.ok(r.next.available >= 10 && r.next.quests.length > 0 && r.next.hub);
  assert.match(r.next.why, /quests for your level/);
  assert.ok(r.zones.every((z) => z.available > 0 || z === r.zones[0]));
  assert.ok(r.training.trainer, "a Horde hunter trainer is known");
  assert.ok(r.training.nextAt > 16);
});

test("a new undead priest stays in Tirisfal, and quests already taken or done are not offered", () => {
  const base = { level: 1, faction: "Horde", className: "Priest", race: "Undead", location: { mapId: 1420, x: 0.3, y: 0.7 } };
  const fresh = advisor({ ...base, quests: [] }).advise();
  assert.equal(fresh.next.name, "Tirisfal Glades");
  assert.match(fresh.next.why, /already here/);
  assert.equal(fresh.training.nextAt, 6);
  const taken = fresh.next.quests[0];
  const later = advisor({ ...base, quests: [{ id: taken.id, title: taken.title, complete: false, objectives: [] }] }).advise();
  assert.ok(!later.next.quests.some((q) => q.id === taken.id));
});

test("Alliance characters never get Horde-only zones, and odd input is handled", () => {
  const r = advisor({ level: 12, faction: "Alliance", race: "Human", location: { mapId: 1429, x: 0.4, y: 0.6 } }).advise();
  const table = loadLevelingPack().zones;
  assert.ok(r.zones.every((z) => table.find((t) => t.mapId === z.mapId).faction !== "Horde"));
  assert.equal(advisor({ level: null }).advise().status, "no-level");
  assert.equal(new LevelingAdvisor({ getState: () => ({ activeProfileId: null, profiles: [] }), knowledge: null, insights: null }).advise().status, "no-character");
  assert.deepEqual(hubOf([]), null);
});

test("a finished quest with no recorded hand-in points back to its quest giver", () => {
  const r = advisor({ level: 7, faction: "Horde", className: "Priest", race: "Undead", location: { mapId: 1420, x: 0.6, y: 0.5 }, quests: [{ id: 97961, title: "Camping 101: Tailoring", complete: true, objectives: [] }] }).advise();
  const g = r.log.ready.find((q) => q.id === 97961);
  assert.ok(g.turnIn && g.turnIn.guess === true && g.turnIn.mapId === 1420);
});

test("an observed empty quest log is distinct from a missing one", () => {
  assert.equal(advisor({ level: 15 }).advise().log.known, false);
  assert.equal(advisor({ level: 15, quests: [] }).advise().log.known, true);
});

test("recorded objectives require a matching objective and game waypoints stay in their quest phase", () => {
  const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const profile = { id: "A", level: 6, faction: "Alliance", captureVersion: "1.29.3", clientBuild: pack.build,
    source: { kind: "wow-addon", updatedAt: "2026-11-28T12:00:00.000Z" },
    quests: [{ id: 6, title: "Bounty on Garrick Padfoot", complete: false, objectives: [] }] };
  const point = { mapId: 1429, x: .5, y: .4 };
  let live;
  const make = new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [profile] }), knowledge: { bundled: new KnowledgeIndex(pack) }, insights, getLive: () => live });
  assert.equal(make.advise().log.active[0].where.evidence, "reference");
  profile.quests[0].objectives.push({ type: "item", required: 1, done: false });
  assert.equal(make.advise().log.active[0].where.evidence, "recorded-objective");
  profile.quests[0].destination = point;
  assert.deepEqual(make.advise().log.active[0].where, { ...point, mapName: "Elwynn Forest", evidence: "game-waypoint" });
  live = { questLog: [{ id: 6, complete: true }] };
  assert.notEqual(make.advise().log.ready[0].turnIn?.evidence, "game-waypoint");
});

test("a level 5 Human Warrior in Elwynn Forest gets Alliance zones and quests from the bundled data", () => {
  const r = advisor({ level: 5, faction: "Alliance", className: "Warrior", race: "Human", location: { mapId: 1429, x: 0.45, y: 0.55 }, quests: [] }).advise();
  assert.equal(r.status, "ok");
  assert.equal(r.next.name, "Elwynn Forest");
  assert.ok(r.next.available >= 10 && r.next.quests.length > 0 && r.next.hub, "Elwynn quest givers are known");
  assert.ok(r.next.quests.every((q) => q.level >= 2 && q.level <= 7 && Number.isFinite(q.x)));
  const table = loadLevelingPack().zones;
  assert.ok(r.zones.every((z) => table.find((t) => t.mapId === z.mapId).faction !== "Horde"));
  assert.ok(r.training && r.training.className === "Warrior");
  assert.ok(!r.zones.some((z) => z.name === "Teldrassil" || z.name === "Dun Morogh"), "another race's starting area is never suggested to a new character");
  const elf = advisor({ level: 5, faction: "Alliance", className: "Hunter", race: "Night Elf", location: { mapId: 1438, x: 0.55, y: 0.6 }, quests: [] }).advise();
  assert.equal(elf.next.name, "Teldrassil");
  assert.ok(!elf.zones.some((z) => z.name === "Elwynn Forest"));
});

test("Alliance class training points to an Alliance trainer location with spells", () => {
  const priest = advisor({ level: 5, faction: "Alliance", className: "Priest", race: "Human", location: { mapId: 1429, x: 0.45, y: 0.55 }, quests: [] }).advise().training;
  assert.equal(priest.trainer.mapId, 1429);
  assert.equal(priest.trainer.mapName, "Elwynn Forest");
  assert.equal(priest.nextAt, 6);
  assert.equal(priest.spellsFromOtherTrainers, false);
  const hunter = advisor({ level: 10, faction: "Alliance", className: "Hunter", race: "Human", location: { mapId: 1429, x: 0.45, y: 0.55 }, quests: [] }).advise().training;
  assert.ok(hunter.trainer && [1429, 1453].includes(hunter.trainer.mapId));
});

test("training falls back to same-class spells when the faction's trainer has no recorded spell levels", () => {
  const service = (spellId, name, observedLevel) => ({ spellId, name, rankText: "Rank 1", observedLevel, skillRank: 0, sources: 1 });
  const trainer = (id, name, faction, mapId, services) => ({ id, name, title: "Warrior Trainer", trainerType: 0, sources: 1, npcSources: 1, creatureSources: 1, titleSources: 1, lastSeen: "2026-11-10", positions: [{ mapId, x: 0.4, y: 0.6 }], observedReactionsByFaction: { [faction]: [5] }, services });
  const synthetic = { trainers: [
    trainer(1, "Alliance Mentor", "Alliance", 1429, [service(100, "Battle Shout", 0)]),
    trainer(2, "Horde Mentor", "Horde", 1411, [service(100, "Battle Shout", 4), service(101, "Rend", 4), service(102, "Charge", 6)]),
  ] };
  const make = (faction, mapId) => new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", level: 4, faction, className: "Warrior", race: "Human", location: { mapId, x: 0.4, y: 0.6 }, quests: [] }] }), knowledge: { bundled: { pack } }, insights: synthetic }).advise().training;
  const a = make("Alliance", 1429);
  assert.equal(a.trainer.name, "Alliance Mentor", "location stays with the player's faction trainer");
  assert.equal(a.trainer.mapId, 1429);
  assert.equal(a.spellsFromOtherTrainers, true);
  assert.deepEqual(a.newNow.map((s) => s.name), ["Battle Shout", "Rend"]);
  assert.equal(a.nextAt, 6);
  const h = make("Horde", 1411);
  assert.equal(h.trainer.name, "Horde Mentor");
  assert.equal(h.spellsFromOtherTrainers, false);
  const none = new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", level: 4, faction: "Alliance", className: "Warrior" }] }), knowledge: null, insights: { trainers: [synthetic.trainers[1]] } }).advise().training;
  assert.equal(none.trainer, null, "an other-faction trainer is never offered as a location");
});

test("live quest pages beat the last save: turned-in quests leave Now and show as Completed", () => {
  const q = (id) => ({ id, title: pack.quests[id].title });
  const barrens = Object.values(pack.quests).filter((x) => x.level >= 14 && x.level <= 18 && x.sides?.includes("Horde")).slice(0, 3).map((x) => x.id);
  const [a, b, c] = barrens;
  const profile = { level: 16, faction: "Horde", className: "Hunter", race: "Orc", location: null, history: { completedIdsKnown: true, completedIds: [] },
    quests: [{ ...q(a), complete: true, objectives: [] }, { ...q(b), complete: false, objectives: [{ text: "0/1", done: false }] }] };
  const make = (live) => new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", ...profile }] }), knowledge: { bundled: { pack } }, insights, getLive: () => live });
  // No location saved and no live frame: Now still advises (used to crash sorting the log).
  assert.equal(make(null).advise().status, "ok");
  // Live: a was handed in, b is now complete, c was just picked up.
  const r = make({ level: 16, position: { mapId: 1413, x: 0.5, y: 0.3 }, questLog: [{ id: b, complete: true }, { id: c, complete: false }], turnedIn: [a] }).advise();
  assert.deepEqual(r.log.ready.map((x) => x.id), [b]);
  assert.deepEqual(r.log.active.map((x) => x.id), [c]);
  assert.deepEqual(r.log.justDone.map((x) => x.id), [a]);
  assert.equal(r.log.live, true);
  const offered = r.zones.flatMap((z) => z.quests.map((x) => x.id));
  assert.ok(!offered.includes(a), "a turned-in quest is never offered again");
  // Saved log only: a quest the save already lists as completed is not shown as to-do.
  profile.history.completedIds = [a];
  const s = make(null).advise();
  assert.ok(!s.log.ready.some((x) => x.id === a));
});

test("Companion preview counts and titles come from the complete live log, including a known empty log", () => {
  const { liveQuestPreview } = require("../src/core/leveling.cjs");
  const character = { quests: [{ id: 7, title: "Saved title", complete: true }, { id: 9, title: "No longer active" }] };
  const reference = { quests: { 8: { title: "New quest" } } };
  assert.equal(liveQuestPreview(character, {}, reference), null);
  assert.deepEqual(liveQuestPreview(character, { questLog: [] }, reference), { count: 0, ready: 0, entries: [] });
  assert.deepEqual(liveQuestPreview(character, { questLog: [{ id: 7, complete: false }, { id: 8, complete: true }] }, reference), {
    count: 2, ready: 1, entries: [{ title: "New quest", complete: true }, { title: "Saved title", complete: false }],
  });
});

test("1.0.1: a class trainer in your zone comes first; with none, the capital next door comes before the other side of the sea", () => {
  // Found on a real Mac: a level 4 Troll mage in Durotar was sent to Isabella in Tirisfal Glades.
  const mage = { level: 4, faction: "Horde", className: "Mage", race: "Troll", location: { mapId: 1411, x: 0.42, y: 0.68 }, quests: [] };
  // The bundled data now knows Mai'ah, the mage trainer in Durotar's starting valley: your own zone comes first.
  const own = advisor(mage).advise().training;
  assert.equal(own.trainer.mapName, "Durotar", JSON.stringify(own.trainer));
  // Without a mage trainer in Durotar (the data this was found on), it is Orgrimmar next door.
  const noDurotarMage = { ...insights, trainers: insights.trainers.filter((x) => !(x.title === "Mage Trainer" && x.positions.some((p) => p.mapId === 1411))) };
  const t = new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", ...mage }] }), knowledge: { bundled: { pack } }, insights: noDurotarMage }).advise().training;
  assert.equal(t.trainer.mapName, "Orgrimmar", JSON.stringify(t.trainer));
  const uc = advisor({ level: 4, faction: "Horde", className: "Mage", race: "Undead", location: { mapId: 1420, x: 0.3, y: 0.66 }, quests: [] }).advise().training;
  assert.equal(uc.trainer.mapName, "Tirisfal Glades", "an Undead mage in Tirisfal still trains there");
});

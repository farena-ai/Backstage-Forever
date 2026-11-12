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

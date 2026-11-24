"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const R = require("../src/core/encounter-roster.cjs");
const A = require("../src/core/dungeon-atlas.cjs");
const inv = require("./pack-invariants.cjs");
const COMMIT = "a".repeat(40);
const raw = (build, encounters) => ({ build, files: { "encounters.json": Buffer.from(JSON.stringify({ meta: { dataset: "encounters", clientBuild: build, collectedOn: { first: "2026-11-10", last: "2026-11-12" } }, encounters })) } });
const builds = [
  raw("1.60.1.200", { 5: { name: "New Name", map: 48, kills: 1, runs: 1, pulls: 2, bosses: [70] }, 6: { name: "Босс", map: 48, kills: 1, runs: 1, pulls: 1 }, 7: { name: "Moved", map: 49, kills: 1, runs: 1, pulls: 1 } }),
  raw("1.60.1.100", { 5: { name: "Old Name", map: 48, kills: 2, runs: 2, pulls: 2, bosses: [71, 70] }, 7: { name: "Moved", map: 50, kills: 4, runs: 4, pulls: 4 }, 8: { name: "Bad", map: 48, kills: -1, runs: 1, pulls: 1 } }),
];

test("fights join by encounter id over the builds; counts add up, the newest name wins", () => {
  const p = R.compileRoster(builds, { commit: COMMIT });
  assert.deepEqual(p.encounters, [
    { id: 5, name: "New Name", instanceMap: 48, kills: 3, runs: 3, pulls: 4, npcIds: [70, 71], builds: 2 },
    { id: 7, name: "Moved", instanceMap: 49, kills: 1, runs: 1, pulls: 1, npcIds: [], builds: 1 },
  ]);
  assert.deepEqual(p.counts, { encounters: 2, instances: 2, dropped: 3 }, "another language, another instance for the same id, and a broken row are left out");
  for (const bad of [{ ...p, kind: "forever-encounters" }, { ...p, encounters: [p.encounters[0], p.encounters[0]] }, { ...p, counts: { ...p.counts, instances: 9 } }, { ...p, encounters: [{ ...p.encounters[0], name: "<b>" }, p.encounters[1]] }])
    assert.throws(() => R.validateRoster(bad), /Invalid encounter roster data/);
  assert.equal(R.loadRoster(path.join(__dirname, "nothing-here.json")), null);
});

test("the bundled roster matches its lock and notice and feeds the dungeon atlas", () => {
  const tool = require("../scripts/build-forever-encounters.cjs");
  const pack = tool.checkBundle(), lock = tool.readLock();
  inv.assertNewestFirst(pack.builds, 1);
  assert.match(lock.commit, inv.COMMIT); assert.match(lock.compiled.sha256, inv.SHA256);
  assert.deepEqual(R.loadRoster(), pack); assert.deepEqual(A.loadEncounters(), pack);
  assert.ok(pack.counts.encounters >= 100 && pack.counts.instances >= 15, JSON.stringify(pack.counts));
  const notice = fs.readFileSync(path.join(__dirname, "../data/forever-encounter-roster/NOTICE"), "utf8");
  assert.ok(notice.includes(`${pack.counts.encounters} boss fights in ${pack.counts.instances} instances`) && notice.includes("no boss"));
  const atlas = A.buildAtlas({ encounters: pack });
  const seen = atlas.entries.filter((e) => !e.foreverOriginal && e.bosses.some((b) => b.observedInForever));
  assert.ok(seen.length >= 10, `baseline dungeons with a boss seen in Forever: ${seen.length}`);
  assert.ok(atlas.entries.filter((e) => e.foreverOriginal).length >= 5);
  assert.match(atlas.attribution, new RegExp(`observed through ${pack.collectedOn.last}`));
  // Hand-written tips stay where they were: a tip never comes from the roster.
  for (const e of atlas.entries.filter((x) => x.foreverOriginal)) for (const b of e.bosses) assert.equal(b.tip, undefined);
});

test("the Companion's dated answer keeps its own pinned single-build file", () => {
  const pinned = A.loadPinnedEncounters();
  assert.equal(pinned.kind, "forever-encounters"); assert.equal(pinned.source.name, "encounters.json");
  assert.notEqual(pinned.kind, R.loadRoster().kind);
});

test("a recorded name one letter off a baseline boss is the same boss", () => {
  assert.equal(A.sameBoss("Geilhast", "Gelihast"), true);
  assert.equal(A.sameBoss("Mr. Smite", "Mr Smite"), true);
  assert.equal(A.sameBoss("Kresh", "Skum"), false);
  assert.equal(A.sameBoss("Lord Cobrahn", "Lord Pythas"), false);
  assert.equal(A.sameBoss("Herod", "Herob"), false, "short names must match exactly");
  const atlas = A.buildAtlas({ encounters: { encounters: [{ id: 1, name: "Geilhast", instanceMap: 48, kills: 3, runs: 3 }] } });
  const bfd = atlas.entries.find((e) => e.id === "bfd");
  assert.equal(bfd.bosses.find((b) => b.name === "Gelihast").kills, 3); assert.deepEqual(bfd.observedOnly, []);
});

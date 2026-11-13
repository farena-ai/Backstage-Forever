"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const data = require("../src/core/creature-data.cjs");
const { SOURCES, COMMIT, BUILDS } = require("../src/core/creature-sources.cjs");
const compiler = require("../scripts/build-forever-creatures.cjs");
const file = path.join(__dirname, "../data/forever-creatures/pack.json");
const bundled = () => JSON.parse(fs.readFileSync(file));

test("the bundled creature pack is pinned, small and carries levels, flags and hostility", () => {
  assert.ok(fs.statSync(file).size < 400 * 1024, "under 400 KB");
  const p = data.validateCreaturePack(bundled());
  assert.equal(p.build, "1.60.1.70888");
  assert.deepEqual(p.builds, BUILDS);
  assert.deepEqual(compiler.coverage(p), compiler.COVERAGE);
  const by = data.creatureIndex(p);
  assert.deepEqual(by.get(3381), { id: 3381, name: "Southsea Brigand", minLevel: 12, maxLevel: 13, hostileTo: ["Horde"], sources: 3 });
  const hogger = by.get(448);
  assert.equal(hogger.elite, true);
  assert.deepEqual(hogger.hostileTo, ["Alliance"]);
  // Neutral beasts (reaction 4) are not hostile; skull-level bosses keep no numeric range.
  assert.deepEqual(by.get(3098).hostileTo, []);
  const thrall = by.get(4949);
  assert.equal(thrall.skull, true);
  assert.equal(thrall.minLevel, null);
  assert.doesNotMatch(JSON.stringify(p), /"(?:positions|worldX|xp|combatLog|deaths|rep|seen)":/);
  assert.equal(data.loadCreaturePack(), data.loadCreaturePack(), "loaded once");
});

test("offline check validates the bundle, lock, coverage and license", () => {
  assert.equal(compiler.checkBundle(), true);
  // Recompiles byte-identically when the raw upstream files are available locally.
  const dir = path.join(__dirname, "../work/creature-source");
  if (fs.existsSync(path.join(dir, SOURCES[0].build, "creatures.json"))) {
    const r = compiler.compile(dir);
    assert.equal(r.pack, fs.readFileSync(file, "utf8"));
  }
});

const single = (source, creatures) => data.validateCreaturePack({
  schemaVersion: 1, kind: "forever-creatures", product: "wowf", build: source.build, builds: [source.build], sourceCommit: COMMIT,
  license: "CC BY 4.0", attribution: source.meta.attribution, hostility: data.HOSTILITY, sources: [structuredClone(source)], creatures,
}, { pinned: false });

test("per-build packs merge newest-first: widest levels, unioned flags and hostility, newest name", () => {
  const newer = single(SOURCES[0], [
    { id: 1, name: "New Name", minLevel: 10, maxLevel: 11, hostileTo: ["Horde"], sources: 1 },
    { id: 2, name: null, minLevel: 5, maxLevel: 5, hostileTo: [], sources: 2 },
  ]);
  const older = single(SOURCES[1], [
    { id: 1, name: "Old Name", minLevel: 9, maxLevel: 12, elite: true, hostileTo: ["Alliance"], sources: 4 },
    { id: 2, name: "Named Later", minLevel: null, maxLevel: null, skull: true, hostileTo: ["Alliance"], sources: 1 },
    { id: 3, name: "Only Old", minLevel: 30, maxLevel: 31, rare: true, hostileTo: [], sources: 1 },
  ]);
  const m = data.mergeCreaturePacks([newer, older]);
  assert.deepEqual(m.builds, [SOURCES[0].build, SOURCES[1].build]);
  assert.deepEqual(m.creatures, [
    { id: 1, name: "New Name", minLevel: 9, maxLevel: 12, elite: true, hostileTo: ["Alliance", "Horde"], sources: 4 },
    { id: 2, name: "Named Later", minLevel: 5, maxLevel: 5, skull: true, hostileTo: ["Alliance"], sources: 2 },
    { id: 3, name: "Only Old", minLevel: 30, maxLevel: 31, rare: true, hostileTo: [], sources: 1 },
  ]);
  assert.throws(() => data.validateCreaturePack(m), "a partial merge is not the pinned bundle");
  assert.throws(() => data.mergeCreaturePacks([]));
});

test("normalization reads reactions 3 or lower as hostile and skips combat-log-only rows", () => {
  const src = SOURCES[2];
  assert.throws(() => data.normalizeCreatures(Buffer.from("{}"), src), "hash and size are pinned");
  // The real raw format, checked through the same per-row rules on a hand-made sample.
  const raw = { meta: src.meta, creatures: {
    10: { classifications: ["rareelite"], levels: { 20: 1, 22: 3 }, name: "Camp Boss", reactions: { Horde: [4, 3], Alliance: [5] }, seen: 4, sources: 2 },
    11: { combatLog: { name: "Log Only", levels: { 3: 1 } } },
    12: { classifications: ["worldboss"], levels: { "-1": 2 }, name: "Big One", reactions: { Alliance: [1] }, seen: 2, sources: 1 },
  } };
  const bytes = Buffer.from(JSON.stringify(raw));
  const fake = { ...structuredClone(src), bytes: bytes.length, sha256: data.hash(bytes) };
  const p = data.normalizeCreatures(bytes, fake);
  assert.deepEqual(p.creatures, [
    { id: 10, name: "Camp Boss", minLevel: 20, maxLevel: 22, elite: true, rare: true, hostileTo: ["Horde"], sources: 2 },
    { id: 12, name: "Big One", minLevel: null, maxLevel: null, worldboss: true, skull: true, hostileTo: ["Alliance"], sources: 1 },
  ]);
  for (const bad of [{ levels: { 70: 1 } }, { reactions: { Horde: [9] } }, { reactions: { Pirates: [2] } }, { classifications: ["boss"] }]) {
    const r = structuredClone(raw); Object.assign(r.creatures[10], bad);
    const b = Buffer.from(JSON.stringify(r));
    assert.throws(() => data.normalizeCreatures(b, { ...structuredClone(src), bytes: b.length, sha256: data.hash(b) }));
  }
});

test("the runtime validator rejects unknown keys, bad bounds, duplicates, false flags and oversize", () => {
  const original = bundled();
  for (const edit of [
    (p) => (p.private = 1), (p) => (p.creatures[0].positions = []), (p) => p.creatures.push(p.creatures[0]),
    (p) => (p.creatures[0].minLevel = 0), (p) => (p.creatures[0].maxLevel = 64), (p) => { p.creatures[0].minLevel = 9; p.creatures[0].maxLevel = 8; },
    (p) => (p.creatures[0].elite = false), (p) => (p.creatures[0].hostileTo = ["Horde", "Alliance"]), (p) => (p.creatures[0].hostileTo = ["Scourge"]),
    (p) => (p.creatures[0].name = "x".repeat(201)), (p) => (p.creatures[0].sources = 99), (p) => (p.sourceCommit = "bad"),
    (p) => { p.creatures[0].minLevel = null; delete p.creatures[0].skull; }, (p) => (p.hostility = "changed"),
    (p) => (p.creatures = Array.from({ length: 8001 }, (_, i) => ({ ...p.creatures[0], id: i + 1 }))),
  ]) { const p = structuredClone(original); edit(p); assert.throws(() => data.validateCreaturePack(p)); }
});

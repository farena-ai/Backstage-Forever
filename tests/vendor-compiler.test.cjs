"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { assertNewestFirst, COMMIT, SHA256 } = require("./pack-invariants.cjs");
// The pins move with every data refresh, so these tests compare pack, lock and compiler
// coverage with each other instead of repeating one snapshot's commit, sizes and counts.
test("immutable quest pin records exact byte hashes of the six required files per merged build and current coverage", () => {
  const lock = require("../data/forever/source-lock.json"), pack = require("../data/forever/pack.json"), { FILES } = require("../src/core/knowledge.cjs");
  assert.match(lock.commit, COMMIT); assert.equal(pack.sourceCommit, lock.commit);
  assertNewestFirst(lock.builds.map((b) => b.build)); assert.equal(lock.build, lock.builds[0].build); assert.equal(pack.build, lock.build);
  const primary = lock.builds[0].files;
  for (const name of FILES) { assert.ok(primary[name].bytes > 0); assert.match(primary[name].sha256, SHA256); assert.equal(pack.files[name].sha256, primary[name].sha256); assert.equal(pack.files[name].bytes, primary[name].bytes); }
  for (const b of lock.builds) { for (const name of FILES) assert.ok(b.files[name], `${b.build} ${name}`); for (const [name, f] of Object.entries(b.files)) { assert.equal(f.meta.license, "CC BY 4.0"); assert.equal(f.meta.clientBuild, b.build); assert.match(f.sha256, SHA256); assert.equal(pack.builds.find((p) => p.build === b.build).files[name].sha256, f.sha256); } }
  // Never below the first four-build pack.
  assert.ok(pack.counts.quests >= 4916 && pack.counts.npcs >= 978 && pack.counts.objects >= 91, JSON.stringify(pack.counts));
  assert.equal(pack.counts.quests, Object.keys(pack.quests).length);
});
test("seller compiler verifies locked bytes and exact metadata per build, merges builds and reproduces bundle offline without research files", t => {
  const modulePath = path.join(__dirname, "../scripts/build-forever-vendors.cjs"); assert.ok(fs.existsSync(modulePath), "Locked seller compiler must exist");
  const { compile, checkBundle } = require(modulePath), { fixture, commit, build } = require("./fixtures/vendor-facts.cjs"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-vendor-compiler-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const older = "1.60.1.70790", builds = [];
  for (const b of [build, older]) {
    const raw = fixture(b), files = {}; fs.mkdirSync(path.join(dir, b));
    if (b === older) { raw["vendors.json"].vendors[10].entries["item:2321"] = { itemId: 2321, name: "Fine Thread", sources: 1 }; raw["vendors.json"].vendors[10].repairs = true; }
    for (const [name, data] of Object.entries(raw)) { const bytes = Buffer.from(JSON.stringify(data)); fs.writeFileSync(path.join(dir, b, name), bytes); files[name] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), meta: data.meta }; }
    builds.push({ build: b, files });
  }
  const lock = { publisher: "Efficient Games", repository: "JIVESCORP/eg-link-output-wowf", product: "wowf", license: "CC BY 4.0", attribution: require("../src/core/knowledge.cjs").ATTRIBUTION, build, commit, builds };
  const a = compile(dir, lock), pack = JSON.parse(a.pack); assert.equal(a.pack, compile(dir, lock).pack);
  assert.equal(pack.counts.vendors, 1); assert.deepEqual(pack.builds, [build, older]);
  assert.deepEqual(pack.vendors[0].listings.map(r => r.itemId), [2320, 2321]); assert.equal(pack.vendors[0].repairs, true);
  const bad = structuredClone(lock); bad.builds[1].files["vendors.json"].meta.dataset = "wrong"; assert.throws(() => compile(dir, bad), /metadata mismatch/);
  assert.throws(() => compile(dir, { ...lock, build: older }), /Invalid historical seller source lock/);
  fs.appendFileSync(path.join(dir, older, "vendors.json"), " "); assert.throws(() => compile(dir, lock), /hash mismatch/);
  assert.equal(checkBundle(), true);
});

test("separate seller pin merges three immutable inputs from every pinned build with honest Alliance and Horde coverage", () => {
  const lock = require("../data/forever-vendors/source-lock.json"), pack = require("../data/forever-vendors/pack.json"), { COVERAGE, coverage } = require("../scripts/build-forever-vendors.cjs");
  assert.match(lock.commit, COMMIT); assert.equal(pack.sourceCommit, lock.commit);
  assertNewestFirst(pack.builds); assert.equal(pack.build, pack.builds[0]); assert.equal(lock.build, pack.build);
  assert.deepEqual(pack.builds, require("../data/forever/pack.json").builds.map(b => b.build), "the same builds as the quest pack");
  const inputs = ["creatures.json", "npcs.json", "vendors.json"];
  assert.deepEqual(lock.builds.map(b => b.build), pack.builds);
  for (const b of lock.builds) { assert.deepEqual(Object.keys(b.files).sort(), inputs); for (const [name, f] of Object.entries(b.files)) { assert.ok(f.bytes > 0); assert.match(f.sha256, SHA256); assert.ok(f.url.endsWith(`/${lock.commit}/data/wowf/${b.build}/${name}`)); assert.equal(f.meta.license, "CC BY 4.0"); assert.equal(f.meta.clientBuild, b.build); } }
  assert.ok(lock.builds.some(b => b.files["creatures.json"].bytes > 1024 * 1024), "a creatures.json over the old 1 MiB input cap is accepted");
  // Counts describe the rows, agree with the compiler's pinned coverage and never fall below the first four-build pack.
  assert.deepEqual(coverage(pack), { ...COVERAGE });
  assert.equal(pack.counts.vendors, pack.vendors.length); assert.equal(pack.counts.listings, pack.vendors.reduce((n, v) => n + v.listings.length, 0));
  assert.ok(pack.counts.vendors >= 291 && pack.counts.listings >= 4322, JSON.stringify(pack.counts));
  const friendly = f => pack.vendors.filter(v => v.observedReactionsByFaction[f]?.length && v.observedReactionsByFaction[f].every(r => r >= 4 && r <= 8));
  assert.equal(friendly("Alliance").length, COVERAGE.alliance); assert.equal(friendly("Horde").length, COVERAGE.horde);
  assert.ok(friendly("Alliance").length >= 62 && friendly("Horde").length >= 229);
  const inZone = (f, mapId) => friendly(f).filter(v => v.positions.some(p => p.mapId === mapId)).length;
  assert.ok(inZone("Alliance", 1429) >= 12 && inZone("Alliance", 1453) >= 13 && inZone("Horde", 1454) >= 21, "Elwynn, Stormwind and Orgrimmar sellers");
  assert.equal(pack.vendors.filter(v => v.repairs).length, COVERAGE.repairs); assert.ok(COVERAGE.repairs >= 85);
  assert.doesNotMatch(JSON.stringify(pack), /"(?:side|price|stock|costs|costItems|stack|visits)"/);
  assert.deepEqual(require("../src/core/knowledge.cjs").FILES, ["quests.enUS.json", "npcs.json", "creature_details.enUS.json", "item_hotfixes.enUS.json", "turn_ins.json", "objectives.json"]);
});

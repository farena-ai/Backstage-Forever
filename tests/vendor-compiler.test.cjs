"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
test("new immutable quest pin records exact six byte hashes per merged build and current coverage", () => {
  const lock = require("../data/forever/source-lock.json"), pack = require("../data/forever/pack.json");
  assert.equal(lock.commit, "164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1");
  const exact = { "quests.enUS.json": [5178761, "433fc57290a162eca1c688c277a96234d39b7198edb1326ed4d6ec8fa4a65d60"], "npcs.json": [298166, "c2b1b2e0ab58c187835428223c23f87c5a43bb36af51d20f1c6fd1c28fa60722"] };
  const primary = lock.builds[0].files;
  for (const [name, [bytes, sha256]] of Object.entries(exact)) { assert.equal(primary[name].bytes, bytes); assert.equal(primary[name].sha256, sha256); assert.equal(pack.files[name].sha256, sha256); }
  for (const b of lock.builds) for (const [name, f] of Object.entries(b.files)) { assert.equal(f.meta.license, "CC BY 4.0"); assert.equal(f.meta.clientBuild, b.build); assert.equal(pack.builds.find((p) => p.build === b.build).files[name].sha256, f.sha256); }
  assert.equal(pack.counts.quests, 4916); assert.equal(pack.counts.npcs, 978); assert.equal(pack.counts.objects, 91);
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

test("separate seller pin merges three immutable inputs from four builds with honest Alliance and Horde coverage", () => {
  const lock = require("../data/forever-vendors/source-lock.json"), pack = require("../data/forever-vendors/pack.json");
  assert.equal(lock.commit, "164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1"); assert.equal(pack.sourceCommit, lock.commit);
  assert.deepEqual(pack.builds, ["1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"]); assert.equal(pack.build, "1.60.1.70888");
  const exact = { "vendors.json": [234773, "c3da2ed0c0d62e15ee261370dceb23557faaf14aaef579fa7d11067c9cdd9cfd"], "npcs.json": [298166, "c2b1b2e0ab58c187835428223c23f87c5a43bb36af51d20f1c6fd1c28fa60722"], "creatures.json": [565733, "1bf31b9f4462987773d6f76d269b179153b022442753ec8ead11092e84c2f13a"] };
  assert.deepEqual(lock.builds.map(b => b.build), pack.builds);
  for (const [name, [bytes, sha256]] of Object.entries(exact)) { assert.equal(lock.builds[0].files[name].bytes, bytes); assert.equal(lock.builds[0].files[name].sha256, sha256); }
  for (const b of lock.builds) { assert.deepEqual(Object.keys(b.files).sort(), Object.keys(exact).sort()); for (const f of Object.values(b.files)) { assert.equal(f.meta.license, "CC BY 4.0"); assert.equal(f.meta.clientBuild, b.build); } }
  assert.ok(lock.builds[1].files["creatures.json"].bytes > 1024 * 1024, "70862 creatures.json is over the old 1 MiB input cap");
  assert.deepEqual(pack.counts, { vendors: 291, listings: 4322, droppedVendors: 2, droppedListings: 0, droppedPositions: 0 });
  const friendly = f => pack.vendors.filter(v => v.observedReactionsByFaction[f]?.length && v.observedReactionsByFaction[f].every(r => r >= 4 && r <= 8));
  assert.equal(friendly("Alliance").length, 62); assert.equal(friendly("Horde").length, 229);
  const inZone = (f, mapId) => friendly(f).filter(v => v.positions.some(p => p.mapId === mapId)).length;
  assert.equal(inZone("Alliance", 1429), 12); assert.equal(inZone("Alliance", 1453), 13); assert.equal(inZone("Horde", 1454), 21);
  assert.equal(pack.vendors.filter(v => v.repairs).length, 85);
  assert.doesNotMatch(JSON.stringify(pack), /"(?:side|price|stock|costs|costItems|stack|visits)"/);
  assert.deepEqual(require("../src/core/knowledge.cjs").FILES, ["quests.enUS.json", "npcs.json", "creature_details.enUS.json", "item_hotfixes.enUS.json", "turn_ins.json", "objectives.json"]);
});

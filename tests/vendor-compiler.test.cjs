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
test("seller compiler verifies locked bytes and exact metadata, reproduces bundle offline without research files", t => {
  const modulePath = path.join(__dirname, "../scripts/build-forever-vendors.cjs"); assert.ok(fs.existsSync(modulePath), "Locked seller compiler must exist");
  const { compile, checkBundle } = require(modulePath), { fixture, commit, build } = require("./fixtures/vendor-facts.cjs"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-vendor-compiler-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raw = fixture(), files = {};
  for (const [name, data] of Object.entries(raw)) { const bytes = Buffer.from(JSON.stringify(data)); fs.writeFileSync(path.join(dir, name), bytes); files[name] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), meta: data.meta }; }
  const lock = { publisher: "Efficient Games", repository: "JIVESCORP/eg-link-output-wowf", product: "wowf", license: "CC BY 4.0", build, commit, files };
  const a = compile(dir, lock); assert.equal(a.pack, compile(dir, lock).pack); assert.equal(JSON.parse(a.pack).counts.vendors, 1);
  const bad = structuredClone(lock); bad.files["vendors.json"].meta.dataset = "wrong"; assert.throws(() => compile(dir, bad), /metadata mismatch/);
  fs.appendFileSync(path.join(dir, "vendors.json"), " "); assert.throws(() => compile(dir, lock), /hash mismatch/);
  assert.equal(checkBundle(), true);
});

test("separate seller pin has exactly three immutable compatible inputs and honest compiled coverage", () => {
  const lock = require("../data/forever-vendors/source-lock.json"), pack = require("../data/forever-vendors/pack.json");
  assert.equal(lock.commit, "23f9636486d3d60479dc0bcee2356053c33faf2c");
  const exact = { "vendors.json": [240965, "8f9eebe8ef227deadbcef1eaad79aae4ca75e51240903db7fa2c25225ba1a5da"], "npcs.json": [499984, "aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded"], "creatures.json": [797697, "f39ef280ce15d5162b2068e9deab438f1de0c3af0f19351a24e49d5deffa5ffc"] };
  assert.deepEqual(Object.keys(lock.files).sort(), Object.keys(exact).sort());
  for (const [name, [bytes, sha256]] of Object.entries(exact)) { assert.equal(lock.files[name].bytes, bytes); assert.equal(lock.files[name].sha256, sha256); assert.equal(lock.files[name].meta.license, "CC BY 4.0"); assert.equal(lock.files[name].meta.clientBuild, pack.build); }
  assert.deepEqual(pack.counts, { vendors: 91, listings: 1301, droppedVendors: 2, droppedListings: 0, droppedPositions: 0 });
  assert.equal(pack.vendors.filter(v => v.observedReactionsByFaction.Alliance?.length).length, 0);
  assert.equal(pack.vendors.filter(v => v.observedReactionsByFaction.Horde?.every(r => r >= 4 && r <= 8)).length, 91);
  assert.doesNotMatch(JSON.stringify(pack), /"(?:side|price|stock|costs|costItems|stack)"/);
  assert.deepEqual(require("../src/core/knowledge.cjs").FILES, ["quests.enUS.json", "npcs.json", "creature_details.enUS.json", "item_hotfixes.enUS.json", "turn_ins.json", "objectives.json"]);
});

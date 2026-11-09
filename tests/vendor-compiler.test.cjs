"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
test("new immutable quest pin records exact six byte hashes and current coverage", () => {
  const lock = require("../data/forever/source-lock.json"), pack = require("../data/forever/pack.json");
  assert.equal(lock.commit, "23f9636486d3d60479dc0bcee2356053c33faf2c");
  const exact = { "quests.enUS.json": [4141584, "fece8cc749952f9a3eb8eeb223e6ebaea3d4d8244dd6ebd7c18091e93f5bed47"], "npcs.json": [499984, "aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded"], "creature_details.enUS.json": [1241957, "72afc6745c756677b4e101ce164ce07436dec522bc8c12edcffe4604b05d4815"], "item_hotfixes.enUS.json": [644620, "8e8bf3106d50a8d0aaff6407c819c7e30e4410c892d5c93530534bfa07512f61"], "turn_ins.json": [156520, "bac5562db3bb9c8ae2f95faecedfa284cd987f28baec9f9efdf08f08ead6db4b"], "objectives.json": [175063, "3079a4124789c0dc651c3c35322f204338d54445e92c10940e0a4716f75beff9"] };
  for (const [name, [bytes, sha256]] of Object.entries(exact)) { assert.equal(lock.files[name].bytes, bytes); assert.equal(lock.files[name].sha256, sha256); assert.equal(lock.files[name].meta.license, "CC BY 4.0"); assert.equal(lock.files[name].meta.clientBuild, lock.build); assert.equal(pack.files[name].sha256, sha256); }
  assert.equal(pack.counts.quests, 3884); assert.equal(pack.counts.npcs, 341); assert.equal(pack.counts.objects, 36);
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

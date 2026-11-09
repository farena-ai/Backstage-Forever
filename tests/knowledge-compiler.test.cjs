const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
test("compiler verifies hashes and reproducibly compiles six factual fixture inputs offline", (t) => {
  const { compile } = require("../scripts/build-forever-data.cjs");
  const { fixture, commit, build } = require("./fixtures/forever-facts.cjs"),
    { hash } = require("../src/core/knowledge.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-compile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {};
  for (const [name, value] of Object.entries(fixture())) {
    const bytes = JSON.stringify(value);
    fs.writeFileSync(path.join(dir, name), bytes);
    files[name] = { bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  }
  const fixtureLock = {
    product: "wowf",
    license: "CC BY 4.0",
    build,
    commit,
    files,
  };
  const result = compile(dir, fixtureLock);
  assert.equal(result.pack, compile(dir, fixtureLock).pack);
  assert.equal(JSON.parse(result.pack).quests["1061"].nextQuestId, 1062);
  fs.appendFileSync(path.join(dir, "npcs.json"), " ");
  assert.throws(() => compile(dir, fixtureLock), /hash mismatch/);
  const lock = JSON.parse(fs.readFileSync("data/forever/source-lock.json"));
  assert.equal(lock.files["npcs.json"].coverage.npcs, 206);
  assert.equal(lock.files["objectives.json"].coverage.quests, 97);
});

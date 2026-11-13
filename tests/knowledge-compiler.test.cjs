const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
test("compiler verifies hashes and reproducibly merges six factual fixture inputs per build offline", (t) => {
  const { compile } = require("../scripts/build-forever-data.cjs");
  const { fixture, commit, build } = require("./fixtures/forever-facts.cjs"),
    { hash } = require("../src/core/knowledge.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-compile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const older = "1.60.1.70000";
  const builds = [build, older].map((b) => {
    fs.mkdirSync(path.join(dir, b));
    const files = {};
    for (const [name, value] of Object.entries(fixture())) {
      value.meta.clientBuild = b;
      if (b === older && name === "npcs.json")
        value.npcs[3216].positions.push({ uiMap: 1429, mapX: 0.25, mapY: 0.75 });
      const bytes = JSON.stringify(value);
      fs.writeFileSync(path.join(dir, b, name), bytes);
      files[name] = { bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
    }
    return { build: b, files };
  });
  const fixtureLock = { product: "wowf", license: "CC BY 4.0", build, commit, builds };
  const result = compile(dir, fixtureLock);
  assert.equal(result.pack, compile(dir, fixtureLock).pack);
  const pack = JSON.parse(result.pack);
  assert.equal(pack.quests["1061"].nextQuestId, 1062);
  assert.equal(pack.build, build);
  assert.deepEqual(pack.builds.map((b) => b.build), [build, older]);
  assert.ok(pack.npcs["npc:3216"].positions.some((p) => p.mapId === 1429), "older build positions merge in");
  assert.deepEqual(JSON.parse(result.lock).builds.map((b) => b.build), [build, older]);
  assert.throws(() => compile(dir, { ...fixtureLock, build: older }), /Invalid source lock/);
  fs.appendFileSync(path.join(dir, older, "npcs.json"), " ");
  assert.throws(() => compile(dir, fixtureLock), /hash mismatch/);
  const lock = JSON.parse(fs.readFileSync("data/forever/source-lock.json"));
  assert.equal(lock.build, "1.60.1.70888");
  assert.deepEqual(lock.builds.map((b) => b.build), ["1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"]);
  assert.equal(lock.builds[1].files["npcs.json"].coverage.npcs, 507);
  assert.equal(lock.builds[3].files["objectives.json"].coverage.quests, 297);
  assert.equal(lock.builds[0].files["vendors.json"].coverage.vendors, 79);
  assert.equal(lock.builds[3].files["tooltip_scan.enUS.json"].coverage.items, 1924);
  assert.equal(lock.builds[0].files["tooltip_scan.enUS.json"], undefined, "optional files are listed only where upstream published them");
});

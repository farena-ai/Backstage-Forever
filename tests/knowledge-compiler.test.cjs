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
  // The bundled lock is re-pinned on every data refresh: check its shape against the pack, not literal values.
  const { FILES, OPTIONAL_FILES } = require("../src/core/knowledge.cjs");
  const { assertNewestFirst, COMMIT, SHA256 } = require("./pack-invariants.cjs");
  const bundled = JSON.parse(fs.readFileSync("data/forever/pack.json"));
  assert.match(lock.commit, COMMIT);
  assert.equal(lock.commit, bundled.sourceCommit);
  assertNewestFirst(lock.builds.map((b) => b.build));
  assert.equal(lock.build, lock.builds[0].build, "the newest build is the pack's own");
  assert.deepEqual(lock.builds.map((b) => b.build), bundled.builds.map((b) => b.build));
  for (const [i, b] of lock.builds.entries()) {
    for (const name of FILES) assert.ok(b.files[name], `${b.build} ${name}`);
    for (const [name, file] of Object.entries(b.files)) {
      assert.ok(FILES.includes(name) || OPTIONAL_FILES.includes(name), name);
      assert.match(file.sha256, SHA256);
      assert.ok(file.bytes > 0 && file.url.includes(`/${lock.commit}/data/wowf/${b.build}/${name}`));
      assert.equal(file.meta.clientBuild, b.build);
      assert.ok(Object.values(file.coverage).length && Object.values(file.coverage).every((n) => Number.isInteger(n) && n >= 0), `${b.build} ${name} coverage`);
      assert.equal(bundled.builds[i].files[name].sha256, file.sha256, "the pack records the same source bytes");
    }
    assert.ok(b.files["quests.enUS.json"].coverage.quests > 0 && b.files["npcs.json"].coverage.npcs > 0);
  }
  const scans = lock.builds.filter((b) => b.files["tooltip_scan.enUS.json"]);
  assert.ok(scans.length > 0 && scans.length < lock.builds.length, "optional files are listed only where upstream published them");
  assert.ok(scans.every((b) => b.files["tooltip_scan.enUS.json"].coverage.items > 0));
});

"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { fixture } = require("./fixtures/insights.cjs");
function api() {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "../scripts/build-forever-insights.cjs"),
    ),
    "Reproducible insights compiler must exist",
  );
  return require("../scripts/build-forever-insights.cjs");
}
test("Windows checkouts preserve LF bytes for all four generated insight resources", () => {
  const files = ["pack.json", "source-lock.json", "LICENSE", "NOTICE"].map(
    (n) => "data/forever-insights/" + n,
  );
  const result = require("node:child_process").spawnSync(
    "git",
    ["check-attr", "eol", "--", ...files],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  const rows = result.stdout.trim().split(/\r?\n/);
  assert.equal(rows.length, 4);
  for (const row of rows) assert.match(row, /: eol: lf$/);
});
test("offline bundled validation checks every build's seven immutable source locks, coverage and compiled integrity", () => {
  assert.equal(api().checkBundle(), true);
  const p = require("../data/forever-insights/pack.json");
  assert.deepEqual(p.coverage, {
    quests: 4916,
    sharing: 4847,
    durations: 37,
    startItems: 1189,
    dropLists: 186,
    trainers: 113,
    services: 5552,
    uniqueSpells: 1427,
    items: 6670,
  });
  assert.equal(p.build, "1.60.1.70888");
  assert.deepEqual(p.builds, ["1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"]);
  assert.equal(p.sources.length, 7 * p.builds.length);
  const alliance = p.trainers.filter((t) => t.observedReactionsByFaction.Alliance?.some((r) => r >= 4));
  assert.ok(alliance.some((t) => t.positions.some((q) => q.mapId === 1429)), "an Elwynn Forest trainer");
  assert.ok(alliance.some((t) => t.positions.some((q) => q.mapId === 1453)), "a Stormwind trainer");
});
test("compiler rejects changed original source bytes and forged immutable locks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-insights-compile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const build of require("../src/core/insights-sources.cjs").BUILDS) {
    fs.mkdirSync(path.join(dir, build));
    for (const [n, d] of Object.entries(fixture()))
      fs.writeFileSync(path.join(dir, build, n), JSON.stringify(d));
  }
  assert.throws(() => api().compile(dir), /hash|bytes/i);
  const lock = structuredClone(
    require("../data/forever-insights/source-lock.json"),
  );
  lock.files = lock.files.filter((s) => s.name !== "trainers.json");
  assert.throws(() => api().compile(dir, lock), /lock|provenance/i);
});
test("each source hash, byte count, URL and exact metadata is independently pinned", () => {
  const original = require("../data/forever-insights/source-lock.json");
  for (const index of original.files.keys())
    for (const mutate of [
      (s) => (s.sha256 = "a".repeat(64)),
      (s) => s.bytes++,
      (s) => (s.url = "https://example.invalid/data"),
      (s) => s.meta.sources++,
    ]) {
      const lock = structuredClone(original);
      mutate(lock.files[index]);
      assert.throws(() => api().compile("unused", lock), /lock|provenance/);
    }
});
test("offline CLI rejects extra options instead of silently checking a different request", () => {
  const run = require("node:child_process").spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/build-forever-insights.cjs"),
      "--wrong",
      "--check",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Invalid.*arguments/);
});

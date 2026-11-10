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
test("offline bundled validation checks seven immutable source locks, coverage and compiled integrity", () => {
  assert.equal(api().checkBundle(), true);
  const p = require("../data/forever-insights/pack.json");
  assert.deepEqual(p.coverage, {
    quests: 3884,
    sharing: 3677,
    durations: 33,
    startItems: 928,
    dropLists: 131,
    trainers: 34,
    services: 2074,
    uniqueSpells: 1139,
    items: 5014,
  });
});
test("compiler rejects changed original source bytes and forged immutable locks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-insights-compile-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [n, d] of Object.entries(fixture()))
    fs.writeFileSync(path.join(dir, n), JSON.stringify(d));
  assert.throws(() => api().compile(dir), /hash|bytes/i);
  const lock = structuredClone(
    require("../data/forever-insights/source-lock.json"),
  );
  delete lock.files["trainers.json"];
  assert.throws(() => api().compile(dir, lock), /lock|provenance/i);
});
test("each source hash, byte count, URL and exact metadata is independently pinned", () => {
  const original = require("../data/forever-insights/source-lock.json");
  for (const name of Object.keys(original.files))
    for (const mutate of [
      (s) => (s.sha256 = "a".repeat(64)),
      (s) => s.bytes++,
      (s) => (s.url = "https://example.invalid/data"),
      (s) => s.meta.sources++,
    ]) {
      const lock = structuredClone(original);
      mutate(lock.files[name]);
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

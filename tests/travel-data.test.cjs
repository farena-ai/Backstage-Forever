"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
function api() {
  assert.ok(
    fs.existsSync(path.join(root, "src/core/travel-data.cjs")),
    "Travel validator must exist",
  );
  return require("../src/core/travel-data.cjs");
}
function compiler() {
  assert.ok(
    fs.existsSync(path.join(root, "scripts/build-forever-travel.cjs")),
    "Travel compiler must exist",
  );
  return require("../scripts/build-forever-travel.cjs");
}
function pack() {
  api();
  return JSON.parse(
    fs.readFileSync(path.join(root, "data/forever-travel/pack.json")),
  );
}
function reject(mutate) {
  const p = pack();
  mutate(p);
  assert.throws(
    () => api().loadTravelReference(Buffer.from(JSON.stringify(p))),
    /travel/i,
  );
}
test("bounded shipped pack validates with six independent flights and original one-way curation", () => {
  const p = api().loadTravelReference(Buffer.from(JSON.stringify(pack())));
  assert.equal(p.product, "wowf");
  assert.equal(p.edges.filter((e) => e.mode === "flight").length, 6);
  assert.equal(p.edges.length, 16);
  assert.ok(
    p.edges.some(
      (e) =>
        e.from === "orgrimmar" &&
        e.to === "thunder-bluff" &&
        e.mode === "flight",
    ),
  );
  assert.equal(p.negatives.length, 1);
  assert.equal(p.negatives[0].from, "orgrimmar");
  assert.equal(p.itineraries.length, 1);
  assert.ok(!p.nodes.some((n) => n.taxiNode === 77));
  assert.ok(!JSON.stringify(p).includes("worldX"));
});
test("validator rejects malformed JSON, oversized bytes, wrong schemas and unknown top-level keys", () => {
  assert.throws(
    () => api().loadTravelReference(Buffer.alloc(256 * 1024 + 1)),
    /travel/i,
  );
  assert.throws(() => api().loadTravelReference("{"), /travel/i);
  for (const mutate of [
    (p) => (p.schemaVersion = 2),
    (p) => (p.product = "wow"),
    (p) => (p.build = "1.2"),
    (p) => (p.extra = true),
    (p) => (p.nodes = null),
  ])
    reject(mutate);
});
test("validator rejects invalid, duplicate and colliding identifiers and aliases atomically", () => {
  for (const mutate of [
    (p) => (p.nodes[0].id = "__proto__"),
    (p) => p.nodes.push(p.nodes[0]),
    (p) => p.nodes[1].aliases.push(p.nodes[0].aliases[0]),
    (p) => p.nodes[0].aliases.push(...["a", "b", "c", "d", "e"]),
    (p) => (p.nodes[0].label = "bad\ntext"),
    (p) => (p.nodes[0].aliases[0] = "https://evil.invalid"),
  ])
    reject(mutate);
});
test("validator rejects endpoints, modes, factions, provenance dates and positions outside contract", () => {
  for (const mutate of [
    (p) => (p.edges[0].from = "unknown"),
    (p) => (p.edges[0].mode = "portal"),
    (p) => (p.edges[0].faction = "Everyone"),
    (p) => (p.edges[0].sourceIds = ["unknown"]),
    (p) => (p.sources[0].url = "https://evil.invalid/"),
    (p) => (p.sources[0].observedOn = "2026-02-30"),
    (p) => (p.sources[1].build = "1.60.1.70862"),
    (p) => (p.nodes[0].position = { uiMap: 1, mapX: 1.1, mapY: 0 }),
    (p) => (p.edges[0].conditional = false),
    (p) => (p.edges[0].seconds = 225),
  ])
    reject(mutate);
});
test("validator rejects contradictions, duplicated edges and bounded array overflow", () => {
  for (const mutate of [
    (p) => (p.negatives[0].mode = "flight"),
    (p) => p.edges.push(p.edges[0]),
    (p) => (p.itineraries[0].steps = Array(13).fill("Walk")),
    (p) => (p.edges[0].sourceIds = Array(9).fill("E1")),
    (p) => (p.sources = Array(33).fill(p.sources[0])),
    (p) => (p.nodes = Array(65).fill(p.nodes[0])),
    (p) => (p.edges = Array(129).fill(p.edges[0])),
    (p) => (p.negatives = Array(17).fill(p.negatives[0])),
    (p) => (p.itineraries = Array(17).fill(p.itineraries[0])),
  ])
    reject(mutate);
});
test("valid-looking edited factual wording and removed coverage cannot bypass immutable provenance", () => {
  for (const mutate of [
    (p) =>
      (p.itineraries[0].steps[0] =
        "Use the permanent portal to Thunder Bluff."),
    (p) => (p.edges[0].steps[0] = "This flight is always unlocked."),
    (p) => (p.nodes[0].label = "Invented City"),
    (p) => p.edges.pop(),
  ])
    reject(mutate);
});
test("immutable source lock rejects independently forged bytes, hashes, metadata and URLs before reads", () => {
  compiler();
  const original = require("../data/forever-travel/source-lock.json");
  for (const name of Object.keys(original.files))
    for (const mutate of [
      (s) => s.bytes++,
      (s) => (s.sha256 = "a".repeat(64)),
      (s) => s.meta.sources++,
      (s) => (s.url = "https://evil.invalid"),
    ]) {
      const lock = structuredClone(original);
      mutate(lock.files[name]);
      assert.throws(
        () => compiler().compile("not-used", lock),
        /lock|provenance/i,
      );
    }
});
test("offline check verifies shipped lock, pack, license and notice without raw source access", () => {
  assert.equal(compiler().checkBundle(), true);
  const result = spawnSync(
    process.execPath,
    ["scripts/build-forever-travel.cjs", "--check"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TRAVEL_SOURCE_DIR: "Z:/not-present" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /offline/i);
});
test("Windows checkout preserves generated bytes and CLI rejects ambiguous options", () => {
  const files = [
    "pack.json",
    "source-lock.json",
    "NOTICE",
    "LICENSE-CC-BY-4.0.txt",
  ].map((n) => "data/forever-travel/" + n);
  const r = spawnSync("git", ["check-attr", "eol", "--", ...files], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  for (const row of r.stdout.trim().split(/\r?\n/))
    assert.match(row, /: eol: lf$/);
  for (const args of [
    ["--bad", "--check"],
    ["--check", "--check"],
    ["--source-dir"],
    [],
  ]) {
    compiler();
    const r = spawnSync(
      process.execPath,
      ["scripts/build-forever-travel.cjs", ...args],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
  }
});
test(
  "actual pinned raw bytes reproduce shipped artifacts; changed bytes fail closed",
  { skip: !process.env.TRAVEL_SOURCE_DIR },
  (t) => {
    const source = process.env.TRAVEL_SOURCE_DIR;
    const first = compiler().compile(source),
      second = compiler().compile(source);
    assert.deepEqual(first, second);
    assert.equal(
      first.pack,
      fs.readFileSync(path.join(root, "data/forever-travel/pack.json"), "utf8"),
    );
    assert.equal(
      first.lock,
      fs.readFileSync(
        path.join(root, "data/forever-travel/source-lock.json"),
        "utf8",
      ),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-travel-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const n of ["flights.json", "npcs.json", "quests.enUS.json"])
      fs.copyFileSync(path.join(source, n), path.join(dir, n));
    const file = path.join(dir, "flights.json"),
      original = fs.readFileSync(file);
    const changed = Buffer.from(original);
    changed[changed.indexOf(Buffer.from("Doras"))] = 88;
    fs.writeFileSync(file, changed);
    assert.throws(() => compiler().compile(dir), /hash/i);
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from(" ")]));
    assert.throws(() => compiler().compile(dir), /bytes/i);
  },
);

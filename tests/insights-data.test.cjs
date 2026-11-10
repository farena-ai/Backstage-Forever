"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { fixture, commit, build } = require("./fixtures/insights.cjs");
function api() {
  assert.ok(
    fs.existsSync(path.join(__dirname, "../src/core/insights-data.cjs")),
    "Offline insights API must exist",
  );
  return require("../src/core/insights-data.cjs");
}
const normalize = (r = fixture()) =>
  api().normalizeInsights(r, { commit, build });
test("seven inputs retain exact metadata, sharing disagreement, static quest fields and trainer listings", () => {
  const p = normalize();
  assert.equal(p.quests.length, 2);
  assert.equal(p.sources.length, 7);
  assert.deepEqual(p.quests[0].sharing, {
    supportedCount: 2,
    unsupportedCount: 1,
    scanSources: 3,
  });
  assert.equal(p.quests[0].timeLimitSeconds, 60);
  assert.equal(p.quests[0].startItemId, 20);
  assert.deepEqual(p.quests[0].itemDrops, [{ itemId: 21, count: 2 }]);
  assert.deepEqual(
    p.trainers[0].services.map((s) => s.observedLevel),
    [20, 0],
  );
  assert.equal(p.coverage.uniqueSpells, 2);
  assert.equal(p.items.length, 1);
  assert.equal(p.observationNamesLocale, "unspecified");
  assert.doesNotMatch(
    JSON.stringify(p),
    /PRIVATE_|UNVERIFIED_ABILITY|costs|raceMask|description|abilities/,
  );
  assert.deepEqual(api().validateInsights(p), p);
  assert.deepEqual(normalize(), p);
});
test("exact ID/title and four-source Trainer joins fail closed and count omitted rows", () => {
  const r = fixture();
  r["quest_scan.json"].described[10].title = "Other";
  r["npcs.json"].npcs[30].interactions = ["Merchant"];
  const p = normalize(r);
  assert.equal(p.quests[0].sharing, undefined);
  assert.equal(p.trainers.length, 0);
  assert.equal(p.dropped.sharingRows, 1);
  assert.equal(p.dropped.trainerRows, 1);
  for (const file of [
    "npcs.json",
    "creatures.json",
    "creature_details.enUS.json",
  ]) {
    const raw = fixture();
    raw[file][file === "npcs.json" ? "npcs" : "creatures"][30].name =
      "Mismatch";
    assert.equal(normalize(raw).trainers.length, 0);
  }
});
test("scan-only sharing observations never manufacture quests and are counted as unjoined rows", () => {
  const raw = fixture();
  raw["quest_scan.json"].described[999] = { title: "Scan only", sources: 1 };
  raw["quest_scan.json"].pushable[999] = { true: 1 };
  const pack = normalize(raw);
  assert.equal(pack.quests.length, 2);
  assert.equal(pack.dropped.sharingRows, 1);
  assert.equal(
    pack.quests.some((q) => q.id === 999),
    false,
  );
});
test("malformed optional facts are omitted with explicit counters", () => {
  const r = fixture();
  r["quests.enUS.json"].quests[10].timeLimitSeconds = -1;
  r["quests.enUS.json"].quests[10].startItemId = 0;
  r["quests.enUS.json"].quests[10].itemDrops.push({ itemId: 0, count: 1 });
  r["trainers.json"].trainers[30].positions.push({
    uiMap: 1,
    mapX: Infinity,
    mapY: 0.5,
  });
  r["trainers.json"].trainers[30].services[41].level = -1;
  const p = normalize(r);
  assert.equal(p.quests[0].timeLimitSeconds, undefined);
  assert.equal(p.quests[0].startItemId, undefined);
  assert.equal(p.dropped.questFields, 2);
  assert.equal(p.dropped.itemDrops, 1);
  assert.equal(p.dropped.positions, 1);
  assert.equal(p.dropped.services, 1);
});
for (const field of ["true", "false"]) {
  test(`present null sharing ${field} is omitted and counted rather than converted to zero`, () => {
    const raw = fixture();
    raw["quest_scan.json"].pushable[10][field] = null;
    const pack = normalize(raw);
    assert.equal(pack.quests[0].sharing, undefined);
    assert.equal(pack.dropped.sharingRows, 1);
  });
}
test("only missing sharing properties default to zero, and an explicit zero stays a valid count", () => {
  for (const sharing of [{ false: 1 }, { true: 0, false: 1 }]) {
    const raw = fixture();
    raw["quest_scan.json"].pushable[10] = sharing;
    const pack = normalize(raw);
    assert.deepEqual(pack.quests[0].sharing, {
      supportedCount: 0,
      unsupportedCount: 1,
      scanSources: 3,
    });
    assert.equal(pack.dropped.sharingRows, 0);
  }
});
test("source identities, metadata and bounded input shapes reject wholesale", () => {
  api();
  for (const mutate of [
    (r) => delete r["trainers.json"],
    (r) => (r["quest_scan.json"].meta.locale = "enUS"),
    (r) => (r["quests.enUS.json"].meta.clientBuild = "1.60.1.0"),
    (r) => (r["creatures.json"].meta.collectedOn.last = "2026-02-30"),
    (r) => (r["npcs.json"].meta.sources = 0),
    (r) => (r["trainers.json"] = " ".repeat(4 * 1024 * 1024 + 1)),
    (r) => (r["quests.enUS.json"].quests = Array(5001).fill({})),
  ]) {
    const r = fixture();
    mutate(r);
    assert.throws(() => normalize(r));
  }
  assert.throws(() =>
    api().normalizeInsights(fixture(), { commit: "main", build }),
  );
});
test("all seven exact metadata descriptors and aggregate input size are enforced", () => {
  for (const name of Object.keys(fixture())) {
    const r = fixture();
    r[name].meta.attribution = "Unlicensed";
    assert.throws(() => normalize(r), /metadata/);
  }
  const r = fixture();
  for (const name of Object.keys(r).slice(0, 4)) {
    const json = JSON.stringify(r[name]);
    r[name] = json + " ".repeat(4 * 1024 * 1024 - json.length);
  }
  assert.throws(() => normalize(r), /size/);
});
test("optional malformed names, counts, levels and duplicate drop IDs never become promoted facts", () => {
  const r = fixture();
  r["quests.enUS.json"].quests[12] = { title: "PRIVATE\nNAME", sources: 1 };
  r["quest_scan.json"].pushable[10].true = 4;
  r["quests.enUS.json"].quests[10].itemDrops.push({ itemId: 21, count: 3 });
  r["item_hotfixes.enUS.json"].items[20].name = "Bad\nName";
  r["trainers.json"].trainers[30].services[41].name = "x".repeat(201);
  const p = normalize(r);
  assert.equal(p.dropped.questRows, 1);
  assert.equal(p.dropped.sharingRows, 1);
  assert.equal(p.dropped.itemDrops, 1);
  assert.equal(p.dropped.items, 2);
  assert.equal(p.dropped.services, 1);
  assert.equal(p.quests[0].sharing, undefined);
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE/);
});
test("compiled null optional sharing and oversized collections are rejected rather than reinterpreted", () => {
  for (const mutate of [
    (p) => (p.quests[1].sharing = null),
    (p) => (p.quests[0].itemDrops = Array(11).fill({ itemId: 1, count: 1 })),
    (p) =>
      (p.trainers[0].positions = Array(21).fill({ mapId: 1, x: 0.1, y: 0.2 })),
    (p) =>
      (p.trainers[0].services = Array(501).fill(p.trainers[0].services[0])),
    (p) => (p.trainers[0].observedReactionsByFaction.Horde = [3, 3]),
  ]) {
    const p = normalize();
    mutate(p);
    assert.throws(() => api().validateInsights(p));
  }
});
test("compiled strict schema rejects injected private fields, malformed bounds and forged coverage", () => {
  for (const mutate of [
    (p) => (p.notes = "PRIVATE"),
    (p) => (p.quests[0].sources = 0),
    (p) => (p.quests[0].title = "bad\ntext"),
    (p) => (p.quests[0].sharing.supportedCount = -1),
    (p) => (p.quests[0].itemDrops[0].count = 0),
    (p) => (p.trainers[0].positions[0].x = NaN),
    (p) => (p.trainers[0].lastSeen = "2026-02-30"),
    (p) => (p.trainers[0].services[0].observedLevel = 1001),
    (p) => (p.trainers[0].services[0].skillRank = 10001),
    (p) => (p.trainers[0].services[0].rankText = "x".repeat(101)),
    (p) => p.coverage.quests++,
    (p) => p.sources.pop(),
    (p) => p.quests.push(p.quests[0]),
  ]) {
    const p = normalize();
    mutate(p);
    assert.throws(() => api().validateInsights(p));
  }
});
test("missing, invalid and oversized bundled optional insights disable only this feature", (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bf-insights-"));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const f = path.join(d, "pack.json");
  assert.equal(api().loadBundledInsights(f), null);
  fs.writeFileSync(f, "{}");
  assert.equal(api().loadBundledInsights(f), null);
  fs.writeFileSync(f, " ".repeat(2 * 1024 * 1024 + 1));
  assert.equal(api().loadBundledInsights(f), null);
  fs.writeFileSync(f, JSON.stringify(normalize()));
  assert.deepEqual(api().loadBundledInsights(f), normalize());
});
test("quest projection qualifies build, locale, title and unknown evidence without changing caller state", () => {
  const p = normalize(),
    q = { id: 10, title: "Synthetic Errand", build, locale: "enUS" };
  const f = api().questInsights(p, q);
  assert.equal(f.status, "available");
  assert.equal(f.sharing.status, "mixed");
  assert.equal(f.startItem.name, "Synthetic Starter");
  assert.equal(f.itemDrops[0].name, "Item #21");
  for (const change of [
    { build: "1.60.1.0" },
    { locale: "deDE" },
    { title: "Other" },
    { id: 999 },
  ])
    assert.notEqual(
      api().questInsights(p, { ...q, ...change }).status,
      "available",
    );
  assert.equal(
    api().questInsights(p, { id: 11, title: "Unknown Sharing" }).sharing.status,
    "unknown",
  );
  assert.equal(api().questInsights(null, q), null);
  f.itemDrops[0].name = "Changed";
  assert.equal(api().questInsights(p, q).itemDrops[0].name, "Item #21");
  assert.equal(api().itemInsights(p, [20, 21]).length, 2);
  assert.equal(
    api().trainerInsights(p, { query: "Synthetic", limit: 1 }).length,
    1,
  );
  assert.throws(() => api().trainerInsights(p, { limit: 101 }));
});

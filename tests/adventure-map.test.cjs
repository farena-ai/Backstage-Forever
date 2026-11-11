"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { seed, col } = require("./adventure-map-fixture.cjs");
const refs = () => ({
  acquisitionPack:
    require("../src/core/acquisition-data.cjs").loadAcquisitionPack(),
  vendorPack: require("../src/core/vendor-facts.cjs").loadVendorPack(),
});
function api() {
  assert.ok(
    fs.existsSync(
      require("node:path").join(__dirname, "../src/core/adventure-map.cjs"),
    ),
    "Adventure Map model missing",
  );
  return require("../src/core/adventure-map.cjs");
}
const build = (s = seed(), o = {}, d = refs()) =>
  api().buildAdventureMap(s, "p", o, d);
test("exact recorded geometry, all quest candidates, zero position, detached public whitelist", () => {
  const s = seed();
  s.profiles[0].quests = Array.from({ length: 25 }, (_, i) => ({
    ...s.profiles[0].quests[0],
    id: i + 1,
  }));
  const before = structuredClone(s),
    m = build(s);
  assert.equal(m.points.filter((p) => p.kind === "quest").length, 25);
  assert.ok(
    m.points.some(
      (p) =>
        p.kind === "find" &&
        p.mapId === 1411 &&
        p.x === 0.5027 &&
        p.y === 0.4874 &&
        p.qualification === "own-recorded",
    ),
  );
  assert.equal(m.playerPosition.x, 0);
  assert.ok(m.points.length <= 128);
  assert.doesNotMatch(
    JSON.stringify(m),
    /PRIVATE_|questStep|command|https?:|sourceKey/,
  );
  m.points[0].title = "Mutated";
  assert.deepEqual(s, before);
});
test("no invented location, same-map bounds and selected reference area", () => {
  let s = seed();
  delete s.profiles[0].location.x;
  assert.equal(build(s).playerPosition, null);
  let m = build(s, { mapId: 999999 });
  assert.equal(m.playerPosition, null);
  assert.equal(m.points.length, 0);
  assert.equal(m.view.label, "Map 999999");
  delete s.profiles[0].location;
  m = build(s);
  assert.equal(m.playerPosition, null);
  assert.equal(m.view.kind, "reference");
  assert.match(m.view.label, /Map/);
});
test("missing, invalid, unavailable retained and empty gathering are distinct and never resurrect geometry", () => {
  const s = seed();
  delete s.profiles[0].gathering;
  assert.equal(build(s).gathering.status, "missing");
  s.profiles[0].gathering = { schemaVersion: 1, records: [] };
  let m = build(s);
  assert.equal(m.gathering.status, "invalid");
  assert.ok(m.points.some((p) => p.kind === "quest"));
  assert.ok(!m.points.some((p) => p.kind === "find"));
  s.profiles[0].gathering = seed().profiles[0].gathering;
  s.profiles[0].gathering.status = "unavailable";
  assert.equal(build(s).gathering.status, "unavailable");
  assert.ok(build(s).points.some((p) => p.kind === "find"));
  s.profiles[0].gathering.records = [];
  s.profiles[0].gathering.totalRecords = 0;
  assert.equal(build(s).gathering.shown, 0);
});
test("manual journal never becomes current evidence; reference failure preserves saved observations", () => {
  const s = seed();
  delete s.profiles[0].source;
  const m = build(s, { layers: { olderReferences: true } });
  assert.equal(m.source.kind, "manual");
  assert.equal(m.playerPosition, null);
  assert.ok(!m.points.some((p) => p.kind === "quest" || p.kind === "find"));
  const d = build(seed(), {}, { acquisitionPack: {}, vendorPack: {} });
  assert.equal(d.references.acquisition.status, "unavailable");
  assert.ok(d.points.some((p) => p.kind === "quest"));
  assert.ok(d.points.some((p) => p.kind === "find"));
});
test("matching build references, older browse toggle, material union and relevant method defaults", () => {
  const s = seed();
  let m = build(s);
  assert.equal(m.layers.ore, true);
  assert.equal(m.layers.herbs, false);
  const copper = m.points.filter(
    (p) => p.kind === "material" && p.layer === "ore",
  );
  assert.ok(copper.length);
  assert.ok(
    copper.some((p) => p.itemIds.includes(2770) && p.itemIds.includes(2835)),
  );
  assert.ok(copper.every((p) => p.qualification === "qualified-historical"));
  s.profiles[0].clientBuild = "1.60.1.70888";
  assert.equal(build(s).points.filter((p) => p.kind === "material").length, 0);
  m = build(s, { layers: { olderReferences: true } });
  assert.ok(
    m.points.some(
      (p) => p.kind === "material" && p.qualification === "browse-only",
    ),
  );
  assert.ok(m.points.some((p) => p.kind === "quest"));
});
test("strict options reject forged coordinates, loose booleans, prototype and numeric overflow", () => {
  for (const o of [
    null,
    [],
    { x: 0.2 },
    { profile: {} },
    { layers: { ore: 1 } },
    { layers: { evil: true } },
    { mapId: 0 },
    { mapId: NaN },
    { goal: { recipeId: "1" } },
    { goal: { crafts: 21 } },
    Object.create({ mapId: 1 }),
  ])
    assert.throws(() => api().validateAdventureMapOptions(o));
  assert.deepEqual(
    api().validateAdventureMapOptions({
      layers: { ore: false },
      goal: { crafts: 2 },
      mapId: 1411,
    }),
    { layers: { ore: false }, goal: { crafts: 2 }, mapId: 1411 },
  );
});

test("unordered seller/acquisition identities merge authorities and retain stock/context/faction qualifications", () => {
  const s = seed(),
    p = s.profiles[0];
  p.faction = "Horde";
  p.location = { mapId: 1456, zone: "Saved city" };
  p.readiness.workshop.professions = col([
    {
      skillLineId: 171,
      professionId: 1,
      name: "Alchemy",
      rank: 20,
      maxRank: 75,
    },
  ]);
  p.readiness.workshop.recipes = col([
    {
      id: 100,
      skillLineId: 171,
      name: "Thread plan",
      canSkillUp: true,
      reagentsKnown: true,
      reagents: [{ itemId: 2320, name: "Coarse Thread", required: 1 }],
    },
  ]);
  const d = refs(),
    row = d.acquisitionPack.rows.find((r) => r.itemId === 2320);
  row.limitedStock = true;
  row.positions.reverse();
  let m = build(s, {}, d),
    mahu = m.points.filter((p) => p.title === "Mahu");
  assert.equal(mahu.length, 2);
  assert.ok(mahu.every((p) => p.sources.length === 2));
  assert.ok(mahu.every((p) => p.sources.some((s) => s.limitedStock === true)));
  assert.ok(
    mahu.every((p) =>
      p.sources.some((s) => s.authority === "seller-reference"),
    ),
  );
  p.faction = "Alliance";
  assert.equal(
    build(s, {}, d).points.filter((p) => p.title === "Mahu").length,
    0,
  );
  m = build(s, { layers: { olderReferences: true } }, d);
  assert.ok(
    m.points
      .filter((p) => p.title === "Mahu")
      .every((p) => p.qualification === "browse-only"),
  );
});
test("unknown material and partial bags cannot invent shortage or a source", () => {
  const s = seed(),
    p = s.profiles[0];
  p.readiness.workshop.professions = col([
    {
      skillLineId: 171,
      professionId: 1,
      name: "Alchemy",
      rank: 20,
      maxRank: 75,
    },
  ]);
  p.readiness.workshop.recipes = col([
    {
      id: 100,
      skillLineId: 171,
      name: "Unknown recipe",
      canSkillUp: true,
      reagentsKnown: true,
      reagents: [{ itemId: 999999, name: "Unobserved material", required: 1 }],
    },
  ]);
  p.readiness.workshop.materials.complete = false;
  const m = build(s);
  assert.ok(!m.points.some((p) => p.kind === "material"));
  assert.doesNotMatch(JSON.stringify(m), /"missing":|"required":|"have":/);
});
test("real knowledge index preserves observed quest build/title/phase qualification even with old browsing enabled", () => {
  const s = seed(),
    p = s.profiles[0],
    { KnowledgeIndex } = require("../src/core/knowledge.cjs"),
    knowledge = new KnowledgeIndex(require("../data/forever/pack.json"));
  p.locale = "enUS";
  p.captureVersion = "0.12.3";
  p.quests = [
    {
      id: 1061,
      title: "The Spirits of Stonetalon",
      complete: true,
      objectives: [],
    },
  ];
  const d = { ...refs(), knowledge };
  let m = build(s, { mapId: 1413 }, d);
  assert.ok(
    m.points.some(
      (p) => p.kind === "quest" && p.qualification === "qualified-historical",
    ),
  );
  p.clientBuild = "1.60.1.70888";
  assert.ok(
    !build(
      s,
      { mapId: 1413, layers: { olderReferences: true } },
      d,
    ).points.some((p) => p.kind === "quest"),
  );
  p.clientBuild = "1.60.1.70862";
  p.quests[0].title = "An unrelated title";
  assert.ok(
    !build(
      s,
      { mapId: 1413, layers: { olderReferences: true } },
      d,
    ).points.some((p) => p.kind === "quest"),
  );
  p.quests[0].title = "The Spirits of Stonetalon";
  p.quests[0].complete = false;
  p.quests[0].objectives = [{ text: "Unobserved objective", done: false }];
  const expected = knowledge.destination(p, 1061, "o"),
    actual = build(
      s,
      { mapId: 1413, layers: { olderReferences: true } },
      d,
    ).points.find((p) => p.kind === "quest");
  assert.equal(actual?.x, expected?.x);
  assert.equal(actual?.y, expected?.y);
  assert.equal(actual?.evidence, expected?.evidence);
});

test("merged material points keep per-source material identity with stock and context", () => {
  const m = build();
  const copper = m.points.find(
    (p) => p.kind === "material" && p.itemIds.includes(2770),
  );
  assert.ok(copper.sources.some((s) => s.itemIds?.includes(2770)));
  assert.ok(copper.sources.some((s) => s.itemIds?.includes(2835)));
});

test("all 64 normalized personal records remain bounded and partial count never becomes a spawn count", () => {
  const s = seed(),
    g = s.profiles[0].gathering,
    original = g.records[0];
  g.limited = true;
  g.totalRecords = 128;
  g.records = Array.from({ length: 64 }, (_, i) => {
    const x = i / 100;
    return {
      ...original,
      id: `wowf:mining:1731:1411:${Math.floor(x * 10000 + 0.5)}:4874:1.60.1.70862`,
      x,
    };
  });
  const m = build(s);
  assert.equal(m.gathering.totalRecords, 128);
  assert.equal(m.gathering.limited, true);
  assert.equal(m.gathering.shown, 64);
  assert.equal(m.points.filter((p) => p.kind === "find").length, 64);
  assert.ok(m.counts.total <= 128);
  assert.doesNotMatch(
    JSON.stringify(m),
    /spawnCount|availableNow|quantityGathered/,
  );
});

test("reusable raw fixture passes actual SavedVariables parse and profile merge before map projection", () => {
  const raw = require("./adventure-map-fixture.cjs").capture(),
    snapshot = require("../src/core/game-sync.cjs").parseSavedVariables(
      "BackstageForeverExport = " + JSON.stringify(JSON.stringify(raw)),
    ),
    state = require("../src/core/profile-sync.cjs").mergeSnapshot(
      require("../src/core/validation.cjs").defaultState(),
      snapshot,
    ),
    m = api().buildAdventureMap(state, state.activeProfileId, {}, refs());
  assert.equal(m.points.find((p) => p.kind === "find").x, 0.5027);
  assert.equal(m.points.find((p) => p.kind === "find").y, 0.4874);
  assert.equal(state.profiles[0].gathering.schemaVersion, 1);
});

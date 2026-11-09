const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeData,
  KnowledgeIndex,
  validatePack,
  FILES,
} = require("../src/core/knowledge.cjs");
const commit = "156f29c9af78b1586883e8eb94a13467eb89638c";
const build = "1.60.1.70862";
const raw = require("./fixtures/forever-facts.cjs").fixture();
const pack = normalizeData(raw, { commit, build });
const index = new KnowledgeIndex(pack);
const profile = (id = 1061, title = "The Spirits of Stonetalon") => ({
  source: { kind: "wow-addon", updatedAt: "2026-11-09T00:00:00.000Z" },
  clientBuild: build,
  locale: "enUS",
  captureVersion: "0.6.0",
  level: 20,
  faction: "Horde",
  quests: [{ id, title, complete: true, objectives: [] }],
  history: { recent: [], completedIdsKnown: true, completedIds: [] },
});
test("compiler retains exact live facts, independent observations, and no narrative", () => {
  assert.equal(pack.quests["1061"].nextQuestId, 1062);
  assert.equal(pack.quests["5729"].turnIns[0].id, 3216);
  assert.equal(pack.quests["5730"].turnIns[0].id, 4949);
  assert.deepEqual(
    pack.quests["5730"].rewards.choices.map((r) => r.itemId),
    [15443, 15445, 15424, 15444],
  );
  assert.equal(pack.quests["98024"].title, pack.quests["854"].title);
  assert.notEqual(pack.quests["98024"].raceMask, pack.quests["854"].raceMask);
  assert.equal(pack.quests["98024"].turnIns.length, 0);
  assert.equal(pack.quests["98024"].mentions[0].id, 3429);
  assert.equal(pack.npcs["npc:3429"].positions[0].x, 0.5154);
  assert.equal(pack.npcs["npc:4049"].positions[0].mapId, 1413);
  assert.equal(pack.creatures["3429"].name, "Thork");
  assert.equal(
    pack.items["15443"].name,
    pack.quests["5730"].rewards.choices[0].name,
  );
  const shipped = require("../data/forever/pack.json");
  assert.equal(shipped.counts.npcs, 341);
  assert.equal(shipped.counts.objects, 36);
  assert.equal(shipped.counts.approachedObjects, 341);
  assert.equal(shipped.counts.objectiveQuests, 162);
  assert.doesNotMatch(
    JSON.stringify(pack),
    /"description"|worldX|worldY|prerequisites|xpDifficulty/,
  );
  assert.equal(validatePack(pack).build, build);
});
test("metadata rejects mixed build, product, schema, locale, license and oversized input", () => {
  for (const [key, value] of Object.entries({
    clientBuild: "1.60.1.1",
    product: "wow_classic_beta",
    schemaVersion: 2,
    locale: "deDE",
    license: "unknown",
  })) {
    const altered = structuredClone(raw);
    altered["quests.enUS.json"].meta[key] = value;
    assert.throws(() => normalizeData(altered, { commit, build }));
  }
  assert.throws(() => normalizeData(raw, { commit: "main", build }));
  assert.throws(() =>
    normalizeData(
      { ...raw, "quests.enUS.json": " ".repeat(5 * 1024 * 1024) },
      { commit, build },
    ),
  );
});
test("normalized cache validation rejects bad optional facts, links and coordinates", () => {
  for (const change of [
    (p) => (p.quests["1061"].level = "20"),
    (p) => (p.quests["1061"].turnIns = [{ id: -1, kind: "npc" }]),
    (p) => (p.quests["1062"].objectiveLocations[0].positions[0].x = 2),
    (p) => (p.quests["1061"].rewards.moneyCopper = -1),
  ]) {
    const p = structuredClone(pack);
    change(p);
    assert.throws(() => validatePack(p));
  }
});
test("invalid optional records are dropped; bounded strings remain literal data", () => {
  const altered = structuredClone(raw);
  altered["quests.enUS.json"].quests["999999"] = {
    title: "<script>alert(1)</script>",
    sources: 1,
  };
  altered["quests.enUS.json"].quests["999998"] = {
    title: "bad\u0000",
    sources: 1,
  };
  altered["npcs.json"].npcs["4049"].positions.unshift({
    uiMap: 1413,
    mapX: Infinity,
    mapY: 0,
  });
  const p = normalizeData(altered, { commit, build });
  assert.equal(p.quests["999999"].title, "<script>alert(1)</script>");
  assert.equal(p.quests["999998"], undefined);
  assert.ok(p.counts.dropped > 0);
  assert.equal(p.npcs["npc:4049"].positions[0].x, 0.3528);
});
test("exact ID/build/title matching never borrows same-title quests", () => {
  assert.equal(index.details(profile(), 1061).status, "match");
  assert.equal(
    index.details({ ...profile(), clientBuild: "1.60.1.9" }, 1061).status,
    "missing",
  );
  assert.equal(
    index.details(profile(98024, "Journey to the Crossroads"), 98024).record.id,
    98024,
  );
  assert.equal(
    index.details(profile(98024, "Other title"), 98024).status,
    "conflict",
  );
  assert.equal(
    index.details({ ...profile(98024, "Other title"), locale: "deDE" }, 98024)
      .status,
    "match",
  );
  assert.equal(index.details({}, 1061).status, "reference");
  assert.equal(
    index.details({ ...profile(), source: undefined }, 1061).status,
    "reference",
  );
  assert.equal(
    index.destination({ ...profile(), source: undefined }, 1061, "t"),
    null,
  );
  assert.equal(index.details(profile(), 99999999).status, "missing");
  assert.equal(index.destination(profile(), 1061, "t").x, 0.3528);
  assert.equal(
    index.destination({ ...profile(), clientBuild: undefined }, 1061, "t"),
    null,
  );
});
test("search is bounded, stable, observed-only by default, with active reference support", () => {
  assert.ok(index.search("", profile()).some((q) => q.id === 1061));
  assert.ok(!index.search("1", {}).some((q) => q.id === 1));
  assert.ok(
    index
      .search("1", {}, { includeReferenceOnly: true })
      .some((q) => q.id === 1),
  );
  assert.ok(index.search("", {}).length <= 30);
  assert.throws(() => index.search("x".repeat(121), {}));
  assert.throws(() => index.search("", {}, { url: "https://bad" }));
});
test("search matches and displays the active game title while identifying English reference conflicts", () => {
  const current = "Changed current game title",
    p = profile(1061, current);
  for (const query of [current, "1061", "The Spirits of Stonetalon"]) {
    const row = index.search(query, p).find((q) => q.id === 1061);
    assert.ok(row, query);
    assert.equal(row.title, current);
    assert.equal(row.referenceTitle, "The Spirits of Stonetalon");
    assert.equal(row.status, "conflict");
  }
  const translated = index.search("Aktueller Titel", {
    ...profile(1061, "Aktueller Titel"),
    locale: "deDE",
  })[0];
  assert.equal(translated.id, 1061);
  assert.equal(translated.title, "Aktueller Titel");
  assert.equal(translated.referenceTitle, "The Spirits of Stonetalon");
  assert.equal(translated.status, "match");
});
test("malformed optional offer and take observations cannot establish playability or NPC edges", () => {
  for (const field of ["offers", "takes"])
    for (const observation of [
      null,
      [],
      ["title"],
      false,
      42,
      "title",
      {},
      { title: 42 },
      { title: "" },
      { title: "   " },
      { title: "x".repeat(201) },
      { title: "bad\u0000" },
      { title: "Valid title", level: "20" },
    ]) {
      const changed = structuredClone(raw);
      changed["npcs.json"].npcs["4049"][field]["1"] = observation;
      const normalized = normalizeData(changed, { commit, build });
      assert.equal(
        normalized.quests["1"].observedInPlay,
        false,
        field + JSON.stringify(observation),
      );
      assert.deepEqual(
        normalized.quests["1"][field === "offers" ? "givers" : "turnIns"],
        [],
      );
      assert.equal(normalized.counts.dropped, pack.counts.dropped + 1);
      assert.equal(normalized.quests["1061"].turnIns[0].id, 4049);
      assert.equal(normalized.quests["1062"].givers[0].id, 4049);
    }
  for (const field of ["offers", "takes"]) {
    const changed = structuredClone(raw);
    changed["npcs.json"].npcs["4049"][field]["1"] = {
      title: "Observed title",
      level: 0,
    };
    const normalized = normalizeData(changed, { commit, build });
    assert.equal(normalized.quests["1"].observedInPlay, true);
    assert.equal(
      normalized.quests["1"][field === "offers" ? "givers" : "turnIns"][0].id,
      4049,
    );
  }
});
test("bounded chain walk detects cycles and missing nodes without prerequisites", () => {
  const p = structuredClone(pack);
  p.quests["1062"].nextQuestId = 1061;
  assert.ok(
    new KnowledgeIndex(p)
      .details(profile(), 1061)
      .warnings.some((s) => /cycle/i.test(s)),
  );
  p.quests["1062"].nextQuestId = 999999;
  const details = new KnowledgeIndex(p).details(profile(), 1061);
  assert.ok(details.chain.length <= 12);
  assert.ok(
    details.chain.some((q) => q.id === 999999 && q.status === "missing"),
  );
  p.quests["1062"].nextQuestId = undefined;
  p.quests["5729"].nextQuestId = 1062;
  assert.equal(
    new KnowledgeIndex(p)
      .details(profile(), 1062)
      .warnings.some((s) => /cycle/i.test(s)),
    false,
  );
});
test("followups require positive complete history and observed compatible next quest", () => {
  const p = profile();
  p.quests = [];
  p.history.completedIds = [1061];
  assert.equal(index.followUps(p)[0].questId, 1062);
  assert.match(index.followUps(p)[0].label, /Check availability/);
  for (const changed of [
    { history: { recent: [], completedIds: [1061] } },
    { level: 1 },
    { faction: "Alliance" },
    {
      history: {
        recent: [],
        completedIdsKnown: true,
        completedIds: [1061, 1062],
      },
    },
  ])
    assert.deepEqual(index.followUps({ ...p, ...changed }), []);
});
test("waypoint command uses sourced coordinates and capture proof only", () => {
  assert.equal(
    index.waypoint(profile(), 1061, "t"),
    "/bf guide 1061 t 1413 0.3528 0.2786 1.60.1.70862",
  );
  assert.throws(
    () =>
      index.waypoint({ ...profile(), captureVersion: undefined }, 1061, "t"),
    /reload/i,
  );
  assert.throws(() => index.waypoint(profile(), 1061, "evil"));
  assert.throws(() => index.waypoint(profile(), 1061, "o"));
});
test("quest waypoint resolution prioritizes valid actual points without changing reference destinations", () => {
  for (const [phase, complete] of [
    ["t", true],
    ["o", false],
  ]) {
    const p = profile();
    p.quests[0].complete = complete;
    p.quests[0].destination = {
      mapId: 999,
      x: 0.1,
      y: 0.2,
      text: "Game destination",
    };
    assert.equal(
      index.waypoint(p, 1061, phase),
      `/bf guide 1061 ${phase} 999 0.1000 0.2000 ${build}`,
    );
    const preview = index.resolveWaypoint(p, 1061, phase);
    assert.equal(preview.canCopy, true);
    assert.equal(preview.source, "game");
    assert.equal(preview.destination.mapId, 999);
    assert.equal(index.destination(p, 1061, phase).mapId, 1413);
    assert.equal(index.resolveWaypoint(p, 1061, "r").source, "reference");
    assert.equal(index.resolveWaypoint(p, 1061, "r").destination.mapId, 1413);
    for (const q of [
      { ...p.quests[0], id: 999999, title: "Missing reference" },
      { ...p.quests[0], title: "Conflicting reference" },
    ]) {
      const altered = { ...p, quests: [q] };
      assert.equal(index.resolveWaypoint(altered, q.id, phase).source, "game");
      assert.match(index.waypoint(altered, q.id, phase), / 999 0.1000 0.2000 /);
    }
  }
  assert.equal(index.resolveWaypoint(profile(), 1061, "t").source, "reference");
  const blankText = profile();
  blankText.quests[0].destination = { mapId: 999, x: 0.1, y: 0.2, text: "" };
  assert.equal(index.resolveWaypoint(blankText, 1061, "t").source, "game");
  const nonActive = { ...profile(), quests: [] };
  const marker = index.resolveWaypoint(nonActive, 5730, "r");
  assert.equal(marker.destination.id, 3216);
  assert.equal(marker.destination.evidence, "observed-quest-giver");
});
test("actual quest waypoints preserve capture, build, profile, phase and coordinate refusal boundaries", () => {
  const p = profile();
  p.quests[0].destination = { mapId: 999, x: 0.1, y: 0.2 };
  for (const altered of [
    { ...p, captureVersion: undefined },
    { ...p, source: undefined },
    { ...p, clientBuild: "1.60.1.999" },
    { ...p, quests: [] },
  ]) {
    assert.equal(index.resolveWaypoint(altered, 1061, "t").canCopy, false);
    assert.throws(() => index.waypoint(altered, 1061, "t"));
  }
  for (const phase of ["o", "evil", {}, null]) {
    assert.equal(index.resolveWaypoint(p, 1061, phase).canCopy, false);
    assert.throws(() => index.waypoint(p, 1061, phase));
  }
  for (const destination of [
    { mapId: 0, x: 0.1, y: 0.2 },
    { mapId: 1.5, x: 0.1, y: 0.2 },
    { mapId: 999, x: NaN, y: 0.2 },
    { mapId: 999, x: 0.1, y: Infinity },
    { mapId: 999, x: -0.1, y: 0.2 },
    { mapId: 999, x: 0.1, y: 1.1 },
    null,
    [],
  ]) {
    const altered = { ...p, quests: [{ ...p.quests[0], destination }] };
    assert.equal(index.resolveWaypoint(altered, 1061, "t").canCopy, false);
    assert.throws(() => index.waypoint(altered, 1061, "t"));
  }
});

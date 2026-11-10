"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { registerKnowledgeHandlers } = require("../src/core/knowledge-ipc.cjs"),
  { KnowledgeIndex } = require("../src/core/knowledge.cjs"),
  { fixture, commit, build } = require("./fixtures/insights.cjs");
for (const scenario of [
  "conflicting-primary-title",
  "missing-primary-row",
  "manual-reference-title-conflict",
  "matching-manual-reference",
]) {
  test(`supplementary gate respects the actual KnowledgeIndex ${scenario}`, () => {
    const index = new KnowledgeIndex(
      structuredClone(require("../data/forever/pack.json")),
    );
    const title = index.pack.quests[138].title;
    const pack = require("../src/core/insights-data.cjs").normalizeInsights(
      fixture(),
      { commit, build },
    );
    pack.quests[0].id = 138;
    pack.quests[0].title = title;
    const manual =
      scenario.startsWith("manual") || scenario === "matching-manual-reference";
    const p = {
      id: "p",
      ...(manual
        ? {}
        : {
            clientBuild: build,
            locale: "enUS",
            source: {
              kind: "wow-addon",
              updatedAt: "2026-11-09T12:00:00.000Z",
            },
            quests: [{ id: 138, title, complete: false, objectives: [] }],
          }),
    };
    if (scenario.includes("title"))
      index.pack.quests[138].title = "Conflicting primary reference title";
    if (scenario === "missing-primary-row") delete index.pack.quests[138];
    const handlers = {},
      register = (getInsights) =>
        registerKnowledgeHandlers({
          handle: (name, fn) => (handlers[name] = fn),
          knowledge: { setContext() {}, index: () => index },
          getState: () => ({ profiles: [p], activeProfileId: "p" }),
          connected: () => false,
          clipboard: { writeText() {} },
          getInsights,
        });
    register();
    const legacy = handlers.questDetails("p", 138);
    assert.equal(
      legacy.status,
      scenario === "conflicting-primary-title"
        ? "conflict"
        : scenario === "missing-primary-row"
          ? "missing"
          : "reference",
    );
    register(() => pack);
    const enriched = handlers.questDetails("p", 138);
    assert.equal(
      enriched.insights.status,
      scenario === "matching-manual-reference" ? "available" : "unavailable",
    );
      if (scenario === "missing-primary-row") assert.match(enriched.insights.reason, /missing/);
    delete enriched.insights;
    assert.deepEqual(
      enriched,
      legacy,
      "Enrichment never alters the primary record or waypoint",
    );
    register(() => null);
    assert.deepEqual(
      handlers.questDetails("p", 138),
      legacy,
      "Null optional pack retains the exact legacy object",
    );
  });
}
test("optional insights leave legacy detail byte shape and automatic context unchanged; additions require exact reference source", () => {
  const index = new KnowledgeIndex(
      structuredClone(require("../data/forever/pack.json")),
    ),
    p = {
      id: "p",
      clientBuild: build,
      locale: "enUS",
      source: { kind: "wow-addon", updatedAt: "2026-11-09T12:00:00.000Z" },
      quests: [
        {
          id: 138,
          title: "Captain Sander's Hidden Treasure",
          complete: false,
          objectives: [],
        },
      ],
    },
    handlers = {};
  const knowledge = { setContext() {}, index: () => index },
    state = () => ({ profiles: [p], activeProfileId: "p" });
  const register = (extra) =>
    registerKnowledgeHandlers({
      handle: (k, f) => (handlers[k] = f),
      knowledge,
      getState: state,
      connected: () => false,
      clipboard: { writeText() {} },
      ...extra,
    });
  register();
  const old = handlers.questDetails("p", 138),
    context = handlers.contextPreview("p", true, "138");
  assert.equal(Object.hasOwn(old, "insights"), false);
  const pack = require("../src/core/insights-data.cjs").normalizeInsights(
    fixture(),
    { commit, build },
  );
  pack.quests[0].id = 138;
  pack.quests[0].title = p.quests[0].title;
  register({ getInsights: () => pack });
  assert.equal(handlers.questDetails("p", 138).insights.status, "available");
  assert.deepEqual(handlers.contextPreview("p", true, "138"), context);
  const enriched = handlers.questDetails("p", 138);
  delete enriched.insights;
  assert.deepEqual(enriched, old);
  p.quests[0].title = "Different";
  assert.equal(handlers.questDetails("p", 138).insights.status, "unavailable");
  p.quests[0].title = pack.quests[0].title;
  p.clientBuild = "1.60.1.0";
  assert.equal(handlers.questDetails("p", 138).insights.status, "unavailable");
  p.clientBuild = build;
  p.locale = "deDE";
  assert.equal(handlers.questDetails("p", 138).insights.status, "unavailable");
  p.locale = "enUS";
  index.pack.sourceCommit = "a".repeat(40);
  assert.equal(handlers.questDetails("p", 138).insights.status, "unavailable");
  register({ getInsights: () => null });
  assert.deepEqual(handlers.questDetails("p", 138), {
    ...index.details(p, 138),
    waypoint: index.resolveWaypoint(p, 138, "o"),
  });
});

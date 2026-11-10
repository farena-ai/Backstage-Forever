"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { registerKnowledgeHandlers } = require("../src/core/knowledge-ipc.cjs"),
  { KnowledgeIndex } = require("../src/core/knowledge.cjs"),
  { fixture, commit, build } = require("./fixtures/insights.cjs");
test("optional insights leave legacy detail byte shape and automatic context unchanged; additions require exact reference source", () => {
  const index = new KnowledgeIndex(require("../data/forever/pack.json")),
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

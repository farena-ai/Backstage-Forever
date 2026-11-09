const { test } = require("node:test"),
  assert = require("node:assert/strict");
test("knowledge IPC accepts bounded queries only, selects sourced clipboard coordinates and shares exact preview helper", () => {
  const {
      registerKnowledgeHandlers,
    } = require("../src/core/knowledge-ipc.cjs"),
    { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const index = new KnowledgeIndex(require("../data/forever/pack.json")),
    handlers = {};
  let clipboard;
  const p = {
    id: "p",
    name: "Example",
    className: "Mage",
    level: 20,
    clientBuild: index.pack.build,
    captureVersion: "0.6.0",
    source: {
      kind: "wow-addon",
      updatedAt: "2026-11-09T00:00:00.000Z",
      id: "PRIVATE",
    },
    quests: [
      {
        id: 1061,
        title: "The Spirits of Stonetalon",
        complete: true,
        objectives: [],
      },
    ],
  };
  const knowledge = {
    setContext() {},
    status: () => ({ phase: "ready" }),
    index: () => index,
    refresh: () => ({ phase: "ready" }),
    setAutomatic: (automatic) => ({ automatic }),
  };
  registerKnowledgeHandlers({
    handle: (n, fn) => (handlers[n] = fn),
    knowledge,
    getState: () => ({ profiles: [p], activeProfileId: "p" }),
    connected: () => true,
    clipboard: { writeText: (t) => (clipboard = t) },
  });
  assert.equal(handlers.questDetails("p", 1061).status, "match");
  assert.equal(handlers.searchQuests("1061", "p", {})[0].id, 1061);
  assert.equal(handlers.copyQuestWaypoint("p", 1061, "t").command, clipboard);
  assert.match(clipboard, /^\/bf guide 1061 t 1413/);
  assert.deepEqual(
    handlers.contextPreview("p", true, "1061"),
    require("../src/core/providers.cjs").approvedProfile(p, {
      knowledge: index,
      prompt: "1061",
    }),
  );
  assert.equal(handlers.contextPreview(null, false, "1061"), null);
  for (const [name, args] of [
    ["knowledgeStatus", ["url"]],
    ["refreshKnowledge", [{}]],
    ["setKnowledgeAutomatic", ["true"]],
    ["searchQuests", ["x".repeat(121), "p", {}]],
    ["searchQuests", ["", "p", { url: "https://bad" }]],
    ["questDetails", ["p", "1061"]],
    ["questDetails", ["absent", 1061]],
    ["copyQuestWaypoint", ["p", 1061, { mapId: 1, x: 1, y: 1 }]],
    ["copyQuestWaypoint", ["p", 1061, "t", { x: 1 }]],
    ["contextPreview", ["p", "yes", "1061"]],
  ])
    assert.throws(() => handlers[name](...args), name);
});

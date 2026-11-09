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
  for (const [phase, complete] of [
    ["t", true],
    ["o", false],
  ]) {
    p.quests[0].complete = complete;
    p.quests[0].destination = { mapId: 999, x: 0.123456, y: 0.2 };
    const descriptor = handlers.questDetails("p", 1061).waypoint;
    const copied = handlers.copyQuestWaypoint("p", 1061, phase);
    const parts = copied.command.split(" ");
    assert.equal(descriptor.phase, phase);
    assert.equal(descriptor.source, "game");
    assert.equal(descriptor.canCopy, true);
    assert.equal(descriptor.destination.mapId, Number(parts[4]));
    assert.equal(descriptor.destination.x, Number(parts[5]));
    assert.equal(descriptor.destination.y, Number(parts[6]));
    assert.match(copied.message, /quest waypoint/);
    assert.doesNotMatch(copied.message, /reference marker/);
  }
  for (const [id, title, status] of [
    [1061, "Conflicting game title", "conflict"],
    [999999, "Missing community record", "missing"],
  ]) {
    p.quests[0] = { ...p.quests[0], id, title };
    const details = handlers.questDetails("p", id);
    assert.equal(details.status, status);
    assert.equal(details.waypoint.source, "game");
    assert.equal(details.waypoint.canCopy, true);
    assert.match(
      handlers.copyQuestWaypoint("p", id, "o").command,
      / 999 0.1235 0.2000 /,
    );
  }
  p.quests[0] = {
    ...p.quests[0],
    id: 1061,
    title: "The Spirits of Stonetalon",
  };
  p.captureVersion = undefined;
  const disabled = handlers.questDetails("p", 1061).waypoint;
  assert.equal(disabled.canCopy, false);
  assert.match(disabled.reason, /reload/i);
  const previousClipboard = clipboard;
  assert.throws(() => handlers.copyQuestWaypoint("p", 1061, "o"));
  assert.equal(clipboard, previousClipboard);
  p.captureVersion = "0.6.0";
  p.quests = [];
  const reference = handlers.questDetails("p", 5730).waypoint;
  assert.equal(reference.phase, "r");
  assert.equal(reference.source, "reference");
  assert.equal(reference.destination.id, 3216);
  const copiedReference = handlers.copyQuestWaypoint("p", 5730, "r");
  assert.match(copiedReference.message, /reference marker/);
  assert.ok(
    copiedReference.command.includes(
      ` ${reference.destination.mapId} ${reference.destination.x.toFixed(4)} ${reference.destination.y.toFixed(4)} `,
    ),
  );
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

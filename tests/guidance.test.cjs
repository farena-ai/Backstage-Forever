const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGuidance,
  validateGuidanceOptions,
} = require("../src/core/guidance.cjs");
const { buildBrief } = require("../src/core/adventure.cjs");
const now = Date.parse("2026-11-09T12:00:00.000Z");
const quest = (id, extra = {}) => ({
  id,
  title: `Quest ${id}`,
  complete: false,
  objectives: [{ text: "Observed objective", done: false }],
  ...extra,
});
const profile = {
  level: 12,
  location: { zone: "Forest", mapId: 1 },
  source: { kind: "wow-addon", updatedAt: new Date(now).toISOString() },
  quests: [
    quest(1, { level: 40 }),
    quest(2, { zone: "Forest", level: 12 }),
    quest(3, { complete: true }),
  ],
};
test("guidance prioritizes ready then nearby, preserves source and never mutates", () => {
  const before = structuredClone(profile),
    g = buildGuidance(profile, { now });
  assert.equal(g.version, 1);
  assert.equal(g.status, "ready");
  assert.deepEqual(
    g.steps.map((s) => s.questId),
    [3, 2, 1],
  );
  assert.deepEqual(g.steps[0].source, {
    kind: "game-snapshot",
    observedAt: profile.source.updatedAt,
    questId: 3,
  });
  assert.equal(g.steps[0].kind, "turn-in");
  assert.equal(g.freshness.status, "fresh");
  assert.deepEqual(profile, before);
  assert.deepEqual(buildBrief(profile, { now }).guidance, g);
});
test("unknown empty manual stale and completed objectives have honest states", () => {
  assert.equal(buildGuidance(null, { now }).status, "unavailable");
  assert.equal(
    buildGuidance({ ...profile, quests: [] }, { now }).status,
    "empty",
  );
  assert.equal(
    buildGuidance({ ...profile, source: undefined }, { now }).status,
    "unavailable",
  );
  assert.equal(
    buildGuidance(profile, { now: now + 16 * 60000 }).freshness.status,
    "stale",
  );
  assert.equal(
    buildGuidance(
      {
        ...profile,
        quests: [quest(1, { objectives: [{ text: "Done", done: true }] })],
      },
      { now },
    ).steps.length,
    0,
  );
});
test("limits steps without time claims and validates public options", () => {
  const p = {
    ...profile,
    quests: Array.from({ length: 12 }, (_, i) => quest(i + 1)),
  };
  for (const [minutes, n] of [
    [15, 3],
    [30, 5],
    [60, 8],
  ])
    assert.equal(buildGuidance(p, { now, minutes }).steps.length, n);
  assert.deepEqual(
    buildGuidance(profile, { now, focus: "turn-ins" }).steps.map(
      (s) => s.questId,
    ),
    [3],
  );
  for (const bad of [
    null,
    [],
    { minutes: 25 },
    { focus: "combat" },
    { now: 1 },
    { x: 1 },
  ])
    assert.throws(() => validateGuidanceOptions(bad));
  assert.deepEqual(validateGuidanceOptions(), {
    minutes: 30,
    focus: "balanced",
  });
});
test("nearby limits unfinished work to observed zone/map but retains known turn-ins", () => {
  assert.deepEqual(
    buildGuidance(profile, { now, focus: "nearby" }).steps.map(
      (s) => s.questId,
    ),
    [3, 2],
  );
  const empty = buildGuidance(
    { ...profile, quests: [quest(1)] },
    { now, focus: "nearby" },
  );
  assert.equal(empty.status, "empty");
  assert.match(empty.headline, /zone or map/);
  const turns = buildGuidance(
    { ...profile, quests: [quest(1)] },
    { now, focus: "turn-ins" },
  );
  assert.equal(turns.status, "empty");
  assert.match(turns.headline, /ready to turn in/);
});
test("duplicate evidence rejected, stable id ties and only observed destinations", () => {
  assert.throws(() =>
    buildGuidance({ ...profile, quests: [quest(1), quest(1)] }, { now }),
  );
  assert.deepEqual(
    buildGuidance(
      { ...profile, quests: [quest(9), quest(4)] },
      { now },
    ).steps.map((s) => s.questId),
    [4, 9],
  );
  const g = buildGuidance(
    {
      ...profile,
      quests: [
        quest(1, {
          objectives: [
            { text: "Done", done: true },
            { text: "Open", done: false },
          ],
          destination: { mapId: 1, x: 0.2, y: 0.3 },
        }),
      ],
    },
    { now },
  );
  assert.deepEqual(g.steps[0].objectives, [{ text: "Open", done: false }]);
  assert.deepEqual(g.steps[0].destination, { mapId: 1, x: 0.2, y: 0.3 });
});
test("guidance IPC validates actual handler and preload forwards bounded options", () => {
  const fs = require("node:fs"),
    vm = require("node:vm"),
    { createRequire } = require("node:module"),
    path = require("node:path");
  const main = path.resolve(__dirname, "../src/main.cjs"),
    text = fs.readFileSync(main, "utf8");
  let callback;
  vm.runInNewContext(
    text.slice(
      text.indexOf('  handle("guidancePlan"'),
      text.indexOf('  handle("gameStatus"'),
    ),
    {
      handle: (name, fn) => (callback = fn),
      v: require("../src/core/validation.cjs"),
      store: { state: { profiles: [{ ...profile, id: "p" }] } },
      knowledge: { index: () => undefined },
      require: createRequire(main),
    },
  );
  assert.equal(callback("p", { minutes: 15, focus: "nearby" }).status, "ready");
  for (const args of [
    [null, {}],
    ["absent", {}],
    ["p", { minutes: 0 }],
    ["p", { now: 1 }],
    ["p", null],
  ])
    assert.throws(() => callback(...args));
  let api, request;
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../src/preload.cjs"), "utf8"),
    {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_, value) => (api = value) },
        ipcRenderer: {
          invoke: (...args) => {
            request = args;
            return Promise.resolve();
          },
        },
      }),
    },
  );
  api.guidancePlan("p", { minutes: 15, focus: "nearby" });
  assert.equal(request[0], "backstage:guidancePlan");
  assert.equal(request[1], "p");
  assert.equal(request[2].minutes, 15);
});

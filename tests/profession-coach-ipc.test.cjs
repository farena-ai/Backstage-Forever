"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const { defaultState } = require("../src/core/validation.cjs");
const seed = () => ({
  ...defaultState(),
  activeProfileId: "p",
  profiles: [
    {
      id: "p",
      name: "Synthetic",
      realm: "Realm",
      className: "Mage",
      level: 12,
      notes: "PRIVATE_NOTES",
      goals: [],
      source: {
        kind: "wow-addon",
        id: "PRIVATE_SOURCE_ID",
        updatedAt: "2026-11-11T12:00:00.000Z",
      },
      clientBuild: "1.60.1.70862",
      quests: [],
      readiness: { bags: { free: 1, total: 16 } },
    },
  ],
});
function setup() {
  assert.ok(
    fs.existsSync(path.join(__dirname, "../src/core/profession-coach-ipc.cjs")),
    "Read-only coach endpoint missing",
  );
  let state = seed();
  const handlers = {};
  require("../src/core/profession-coach-ipc.cjs").registerProfessionCoachHandlers(
    { handle: (n, f) => (handlers[n] = f), getState: () => state },
  );
  return { handlers, state };
}
test("strict coach endpoint rejects forged inputs and requires current main-owned saved profile", () => {
  const f = setup(),
    read = f.handlers.professionCoach;
  for (const args of [
    [],
    ["p"],
    ["p", undefined],
    ["p", null],
    ["p", []],
    ["p", {}, "extra"],
    ["p", { mode: "raid" }],
    ["p", { profile: f.state.profiles[0] }],
    ["p", { source: "FORGED" }],
    ["wrong", {}],
    [null, {}],
  ])
    assert.throws(() => read(...args));
  const before = structuredClone(f.state),
    out = read("p", {});
  assert.equal(out.planning.checklistAvailable, false);
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE_/);
  assert.deepEqual(f.state, before);
  f.state.profiles[0].readiness.bags.free = 4;
  assert.equal(read("p", {}).planning.checklistAvailable, false);
  f.state.activeProfileId = null;
  assert.throws(() => read("p", {}));
});
test("preload exposes exact read-only endpoint and forwards extras for rejection", async () => {
  let api, request;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8"),
    {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_n, a) => (api = a) },
        ipcRenderer: {
          invoke: (...args) => {
            request = args;
            return Promise.resolve();
          },
        },
      }),
    },
  );
  assert.equal(typeof api.professionCoach, "function");
  await api.professionCoach("p", {}, "extra");
  assert.deepEqual(Array.from(request), [
    "backstage:professionCoach",
    "p",
    {},
    "extra",
  ]);
});

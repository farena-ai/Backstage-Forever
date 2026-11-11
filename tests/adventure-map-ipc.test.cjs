const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { seed } = require("./adventure-map-fixture.cjs");
function fixture() {
  assert.ok(
    fs.existsSync(
      require("node:path").join(__dirname, "../src/core/adventure-map-ipc.cjs"),
    ),
    "Map IPC missing",
  );
  let state = seed();
  const handlers = {};
  require("../src/core/adventure-map-ipc.cjs").registerAdventureMapHandlers({
    handle: (k, f) => (handlers[k] = f),
    getState: () => state,
  });
  return {
    call: (...args) => handlers.adventureMap(...args),
    set: (s) => (state = s),
  };
}
test("main owns exact two argument current character read and refuses fallback / forged authority", () => {
  const f = fixture();
  assert.equal(f.call("p", {}).character.id, "p");
  for (const args of [
    ["p"],
    ["p", {}, {}],
    ["p", { profile: seed() }],
    ["other", {}],
    ["p", undefined],
  ])
    assert.throws(() => f.call(...args));
  const s = seed();
  s.activeProfileId = "missing";
  f.set(s);
  assert.throws(() => f.call("p", {}));
});
test("read has no mutation, receipt is not inferred from imported gathering, no private payload", () => {
  const s = seed(),
    before = structuredClone(s),
    f = fixture();
  f.set(s);
  const m = f.call("p", {});
  assert.deepEqual(s, before);
  assert.equal(m.gathering.formatReceived, false);
  assert.doesNotMatch(JSON.stringify(m), /PRIVATE_|command|sourceKey|https?:/);
});

test("connected format receipt is main-owned and never accepted from renderer options", () => {
  const s = seed(),
    handlers = {};
  let receipt = false;
  require("../src/core/adventure-map-ipc.cjs").registerAdventureMapHandlers({
    handle: (k, f) => (handlers[k] = f),
    getState: () => s,
    gatheringReceipt: (p) => receipt && p.source.id === s.profiles[0].source.id,
  });
  assert.equal(handlers.adventureMap("p", {}).gathering.formatReceived, false);
  receipt = true;
  assert.equal(handlers.adventureMap("p", {}).gathering.formatReceived, true);
  assert.throws(() => handlers.adventureMap("p", { formatReceived: true }));
});
test("preload preserves extra arity for rejection and exposes no new control capability", async () => {
  let exposed, args;
  require("node:vm").runInNewContext(
    fs.readFileSync(require.resolve("../src/preload.cjs"), "utf8"),
    {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_n, a) => (exposed = a) },
        ipcRenderer: {
          invoke: (...a) => {
            args = a;
            return Promise.resolve();
          },
          on() {},
          removeListener() {},
        },
      }),
    },
  );
  await exposed.adventureMap("p", {}, "extra");
  assert.equal(args.length, 4);
  assert.equal(args[0], "backstage:adventureMap");
});

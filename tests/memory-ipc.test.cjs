"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { registerMemoryHandlers } = require("../src/core/memory-ipc.cjs");
test("memory handlers reject extra and missing arguments and route each narrow operation", () => {
  const handlers = {}, calls = [], memory = Object.fromEntries(["list", "draft", "save", "remove", "clear"].map(method => [method, input => { calls.push([method, input]); return method; }]));
  registerMemoryHandlers({ handle: (name, fn) => handlers[name] = fn, memory, context: { notify: input => input }, getState: () => ({ profiles: [], activeProfileId: null, memories: [] }) });
  assert.equal(Object.keys(handlers).length, 7);
  for (const handler of Object.values(handlers)) { assert.throws(() => handler()); assert.throws(() => handler({}, {})); }
  assert.equal(handlers.memoryList("p"), "list"); assert.equal(handlers.memoryDraft("p"), "draft");
  assert.equal(handlers.saveMemory({}), "save"); assert.equal(handlers.deleteMemory({}), "remove"); assert.equal(handlers.clearMemory("p"), "clear");
  assert.deepEqual(handlers.companionContext({ profileId: null, view: "ai" }), { profileId: null, view: "ai" });
  assert.deepEqual(handlers.memoryPreview({ profileId: null, prompt: "Where is Stormwind?", memoryIds: [] }), { prompt: "Where is Stormwind?", excerpts: [] }); assert.equal(calls.length, 5);
});

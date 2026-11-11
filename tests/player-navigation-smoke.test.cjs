"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const { ensureCompanionTools } = require("../scripts/player-navigation.cjs");

test("companion tool opening waits for the native toggle acknowledgement after click", async () => {
  const panel = { open: false, addEventListener(_event, listener) { this.toggle = listener; } };
  let deliver;
  const delivered = new Promise((resolve) => { deliver = resolve; });
  const locator = {
    evaluate: async (fn) => fn(panel),
    locator: () => ({ click: async () => { panel.open = true; } }),
  };
  const page = {
    locator: () => locator,
    waitForFunction: async (fn, arg) => {
      await delivered;
      assert.equal(vm.runInNewContext(`(${fn})(arg)`, {
        arg, document: { querySelector: () => panel },
      }), true);
    },
  };
  let completed = false;
  const opening = ensureCompanionTools(page, "voice").then(() => { completed = true; });
  await new Promise(setImmediate);
  assert.equal(panel.open, true, "The native default already changed open state");
  assert.equal(completed, false, "Click completion alone must not acknowledge the queued toggle");
  panel.toggle();
  deliver();
  await opening;
  assert.equal(completed, true);
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const listeners = {},
    pending = [],
    summary = { textContent: "" };
  const controls = new Map();
  const control = (key) => {
    if (!controls.has(key))
      controls.set(key, {
        textContent: "",
        value: "",
        disabled: false,
        dataset: {},
        setAttribute() {},
        querySelector: control,
      });
    return controls.get(key);
  };
  const node = {
    dataset: {},
    querySelector: control,
    querySelectorAll: () => [],
    contains: () => false,
  };
  const root = {
    querySelector: (key) =>
      key === "[data-voice]"
        ? node
        : key.includes("> summary")
          ? summary
          : control(key),
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const document = {
    body: {},
    activeElement: null,
    hidden: false,
    addEventListener() {},
    hasFocus: () => false,
  };
  const window = { addEventListener() {} };
  const context = {
    window,
    document,
    Intl,
    setTimeout: () => 1,
    clearTimeout() {},
    PlayerNavigation: { reveal() {} },
    InteractionGuard: {
      create: () => ({ defer: () => false, invalidate() {} }),
    },
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/renderer/voice.js"), "utf8"),
    context,
  );
  const api = {
    voiceCapabilities: () =>
      new Promise((resolve, reject) => pending.push({ resolve, reject })),
    voiceCancel: async () => ({ phase: "stopped" }),
    voiceSpeak: async () => ({
      sessionId: "fake",
      phase: "speaking",
      message: "Speaking",
    }),
    voiceStop: async () => {
      throw Error("Synthetic unconfirmed stop");
    },
  };
  window.Voice.init({
    root,
    api,
    active: () => true,
    esc: String,
    busy: () => false,
    answer: () => "Synthetic answer",
    ready: async () => {},
    profileId: () => "Alpha",
  });
  const click = (selector) =>
    listeners.click({
      target: {
        closest: (key) =>
          key === selector ? { dataset: { voiceRead: "answer" } } : null,
      },
    });
  const ready = {
    message: "Ready locally",
    recognition: { available: true, cultures: ["en-US"] },
    synthesis: { available: true, voices: [] },
  };
  return {
    voice: window.Voice,
    pending,
    summary,
    node,
    ready,
    click,
    status: () => control("[data-voice-status]").textContent,
  };
}
test("folded initial capability rejection remains discoverable and a successful retry clears only that error", async () => {
  const f = fixture();
  f.voice.mounted();
  await f.voice.close();
  f.pending.shift().reject(Error("synthetic failure"));
  await settle();
  assert.match(f.summary.textContent, /Needs attention/);
  assert.match(f.status(), /Local voice could not be checked/);
  assert.equal(
    f.node.dataset.phase,
    "idle",
    "Capability failure does not become an audio phase",
  );
  f.click("[data-voice-check]");
  f.pending.shift().resolve(f.ready);
  await settle();
  assert.doesNotMatch(f.summary.textContent, /Needs attention/);
  assert.equal(f.status(), "Ready locally");
});
test("late capability rejection or success cannot mark or clear a replacement owner", async () => {
  for (const outcome of ["reject", "resolve"]) {
    const f = fixture();
    f.voice.mounted();
    const old = f.pending.shift();
    f.voice.invalidate();
    old[outcome](outcome === "resolve" ? f.ready : Error("obsolete"));
    await settle();
    assert.doesNotMatch(f.summary.textContent, /Needs attention/);
    assert.doesNotMatch(f.status(), /could not be checked|Ready locally/);
    f.voice.mounted();
    f.pending.shift().reject(Error("current"));
    await settle();
    assert.match(f.summary.textContent, /Needs attention/);
    f.click("[data-voice-check]");
    f.pending.shift().resolve(f.ready);
    await settle();
    assert.equal(f.status(), "Ready locally");
  }
});
test("capability failure and successful retry cannot erase an unconfirmed audio stop error", async () => {
  const f = fixture();
  f.voice.mounted();
  f.pending.shift().resolve(f.ready);
  await settle();
  f.click("[data-voice-read]");
  await settle();
  await f.voice.close();
  assert.equal(f.node.dataset.phase, "error");
  assert.match(f.status(), /could not confirm it stopped/);
  f.click("[data-voice-check]");
  f.pending.shift().reject(Error("capability failure"));
  await settle();
  assert.match(f.status(), /could not confirm it stopped/);
  f.click("[data-voice-check]");
  f.pending.shift().resolve(f.ready);
  await settle();
  assert.equal(f.node.dataset.phase, "error");
  assert.match(f.summary.textContent, /Needs attention/);
  assert.match(f.status(), /could not confirm it stopped/);
});

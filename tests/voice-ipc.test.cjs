"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { registerVoiceHandlers } = require("../src/core/voice-ipc.cjs");
test("voice IPC preserves exact arity and preload does not discard extra arguments", async () => {
  const handlers = {}, calls = [], voice = Object.fromEntries(["capabilities", "start", "status", "stop", "speak", "cancel"].map(k => [k, (...args) => { calls.push([k, ...args]); return true; }]));
  registerVoiceHandlers({ handle: (name, fn) => handlers[name] = fn, voice });
  let bridge; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8"), { require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => bridge = value }, ipcRenderer: { invoke: (channel, ...args) => Promise.resolve().then(() => handlers[channel.slice(10)](...args)) } }) });
  for (const name of Object.keys(handlers)) { assert.equal(typeof bridge[name], "function"); const zero = ["voiceCapabilities", "voiceCancel"].includes(name); await assert.rejects(() => bridge[name](...(zero ? [1] : []))); await assert.rejects(() => bridge[name](1, 2)); assert.equal(await bridge[name](...(zero ? [] : ["request"])), true); }
  assert.equal(calls.length, 6);
});

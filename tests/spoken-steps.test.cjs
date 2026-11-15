"use strict";
// Spoken next steps (0.45, roadmap 3.5).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function harness({ step, voices = [{ id: "Microsoft Zira", culture: "en-US", name: "Zira" }], on = false } = {}) {
  const store = new Map(on ? [["bf-spoken-steps-v1", JSON.stringify({ on: true })]] : []), spoken = [], listeners = {};
  let intervals = 0;
  const current = { step };
  const ctx = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { readyState: "complete", addEventListener: (e, f) => { listeners[e] = f; }, querySelectorAll: () => [] },
    setInterval: () => ++intervals, clearInterval: () => {}, Date,
    window: { backstage: { nextStep: async () => ({ profileId: "p1", step: current.step }), voiceCapabilities: async () => ({ synthesis: { available: voices.length > 0, voices } }), voiceSpeak: async (input) => { spoken.push(input); return { phase: "starting" }; } } },
  };
  vm.createContext(ctx); vm.runInContext(read("src/renderer/spoken-steps.js"), ctx);
  const click = (act) => listeners.click({ target: { closest: () => ({ dataset: { spokenAct: act } }) } });
  return { S: ctx.window.SpokenSteps, spoken, store, current, click, intervals: () => intervals };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

test("pure helpers: a step's identity changes with progress; English voice preferred, saved voice kept", () => {
  const { S } = harness();
  const k = S._pure.stepKey;
  assert.notEqual(k({ kind: "objective", questId: 2, title: "Raptor Thieves", progress: "1/2" }), k({ kind: "objective", questId: 2, title: "Raptor Thieves", progress: "2/2" }));
  assert.equal(k(null), null);
  const list = [{ id: "de", culture: "de-DE" }, { id: "en", culture: "en-GB" }];
  assert.equal(S._pure.pickVoice(list, null).id, "en"); assert.equal(S._pure.pickVoice(list, "de").id, "de"); assert.equal(S._pure.pickVoice([], null), null);
});

test("off by default: nothing is read; switching on reads the step once, with the active character and an installed voice", async () => {
  const h = harness({ step: { kind: "turnin", questId: 1, title: "Hand in Call of Water", spoken: "Hand in Call of Water to Islen Waterseer, south-east." } });
  assert.match(h.S.control(), /Speak steps/); assert.equal(h.intervals(), 0);
  await flush(); assert.equal(h.spoken.length, 0);
  h.click("toggle"); await flush();
  assert.equal(JSON.parse(h.store.get("bf-spoken-steps-v1")).on, true);
  assert.equal(h.spoken.length, 1);
  assert.deepEqual({ ...h.spoken[0] }, { profileId: "p1", text: "Hand in Call of Water to Islen Waterseer, south-east.", voiceId: "Microsoft Zira" });
  assert.match(h.S.control(), /Speaking steps/); assert.match(h.S.control(), /Say again/);
  h.click("again"); await flush(); assert.equal(h.spoken.length, 2, "Say again repeats it");
  h.click("toggle"); await flush(); h.click("again"); await flush();
  assert.equal(h.spoken.length, 2, "off: silent, even on Say again");
});

test("without a Windows voice it says so instead of failing", async () => {
  const h = harness({ voices: [], step: { kind: "zone", title: "Head to The Barrens", spoken: "Head to The Barrens." } });
  h.click("toggle"); await flush();
  assert.equal(h.spoken.length, 0); assert.match(h.S.control(), /No Windows voice is installed/);
});

test("spoken steps are wired: handler, preload, Now control, script, help", () => {
  assert.match(read("src/main.cjs"), /handle\("nextStep"/);
  assert.match(read("src/preload.cjs"), /nextStep: \(\) => invoke\("nextStep"\)/);
  assert.match(read("src/renderer/now.js"), /SpokenSteps\.control\(\)/);
  assert.match(read("src/renderer/index.html"), /<script src="spoken-steps\.js"><\/script>/);
  assert.match(read("src/renderer/commands.js"), /name: "Spoken steps"/);
});

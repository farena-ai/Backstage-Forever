"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const { recommendSteps } = require("../src/core/next-step.cjs");
const src = (name) => readFileSync(join(__dirname, "../src/renderer", `${name}.js`), "utf8");

function dashboard(overrides = {}, toon = {}, { storage = new Map(), state, day = new Date(2026, 10, 18) } = {}) {
  const character = { name: "Rolica", className: "Priest", race: "Undead", sex: "female", level: 15, xp: { savedLevel: 15, current: 300, max: 500, rested: 100 }, ...toon };
  const body = { innerHTML: "", querySelectorAll: () => [] };
  const header = { dataset: { nowIdentity: "" }, outerHTML: "", querySelector: () => null, contains: () => false };
  let click;
  const root = { addEventListener: (_name, handler) => { click = handler; } };
  const active = { value: "active" };
  const nodes = { "[data-now]": root, '[data-now] > [data-page-hero="now"]': header, "[data-now-body]": body, "#active-character": active };
  const globals = {
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [day.getTime()])); } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: (sel) => nodes[sel] },
    BF_PORTRAITS: ["undead-female-priest"],
    backstage: {
      levelingAdvice: async () => {
        const advice = { status: "ok", character, zones: [], log: { inLog: 1, ready: [{ title: "Finish the task", id: 42 }], active: [] } };
        return { ...advice, recommendations: recommendSteps(advice) };
      },
      gameStatus: async () => ({ connected: false }),
      liveLinkStatus: async () => ({ signal: "old-addon" }),
      weekly: async () => ({ reminders: [{ kind: "mail", text: "Check your mail" }] }),
      ...overrides,
    },
  };
  globals.window = globals;
  for (const script of ["page-hero", "objectives", "now"]) runInNewContext(src(script), globals);
  globals.ObjectiveView.init(() => state);
  const view = globals.NowView;
  return { view, header, body, active,
    click: (selector, stopPropagation) => click({ target: { closest: s => s === selector ? {} : null }, stopPropagation }),
    remount() { nodes["[data-now]"] = { ...root }; view.mounted(); },
    async mount() { view.mounted(); await new Promise(setImmediate); return body.innerHTML; } };
}

test("next action precedes notices, support cards and visible setup", async () => {
  const html = await dashboard().mount();
  const next = html.indexOf("Do this next");
  assert.ok(next >= 0);
  for (const label of ["Get set up", "Check your mail", "now-reload", "Quest log"]) assert.ok(html.indexOf(label) > next, `${label} follows next action`);
  assert.match(html, /Hand in “Finish the task”/);
  assert.match(html, /data-quest-open="42"/);
  assert.match(html, /Open Game connection/);
  assert.doesNotMatch(html, /now-col|<details[^>]*now-setup/);
});

test("setup is the first action when the character is missing", async () => {
  const html = await dashboard({ levelingAdvice: async () => ({ status: "no-character" }) }).mount();
  assert.match(html, /Do this next[\s\S]*Connect your WoW Forever folder[\s\S]*Get set up/);
});

test("the active character uses the shared PageHero portrait markup", async () => {
  const app = dashboard();
  await app.mount();
  assert.match(app.header.outerHTML, /class="ph-crest ph-portrait" src="art\/portraits\/undead-female-priest.webp"/);
  const fallback = dashboard({}, { sex: null });
  await fallback.mount();
  assert.match(fallback.header.outerHTML, /class="ph-crest" src="art\/classes\/priest.png"/);
});

test("recent session bars reflect recorded gains, including zero, without a second XP bar", async () => {
  const base = Date.UTC(2026, 0, 6, 12);
  const entry = (day, levelsGained) => ({ startedAt: base + day * 86400000, levelsGained });
  const html = await dashboard({ journey: async () => ({ id: "active", name: "Rolica", history: { sessions: [entry(4, 1.125), entry(2, 0), entry(0, 0.5)] } }) }).mount();
  assert.match(html, /Level gain by session/);
  assert.deepEqual([...html.matchAll(/data-gain="([\d.]+)"/g)].map((m) => Number(m[1])), [0.5, 0, 1.125]);
  assert.match(html, /60%/);
  assert.doesNotMatch(html, /class="now-xp"/);
});

test("without matching history, current XP is labeled from a valid same-level save", async () => {
  const app = dashboard({ journey: async () => ({ id: "other", name: "Rolica", history: { sessions: [{ startedAt: 1, levelsGained: 1 }] } }) });
  const html = await app.mount();
  assert.doesNotMatch(html, /data-gain=/);
  assert.match(html, /aria-label="60% through level 15"/);
  assert.match(html, /from your last save/);
  const stale = await dashboard({}, { xp: { savedLevel: 14, current: 300, max: 500 } }).mount();
  assert.match(stale, /No XP reading yet/);
  assert.doesNotMatch(stale, /class="now-xp"/);
});

const priority = html => html.match(/<article class="[^"]*\bnow-next\b[^"]*"[^>]*>([\s\S]*?)<\/article>/)?.[1] || "";
const savedAt = "2026-11-17T18:00:00.000Z";
function pinnedState() {
  return { activeProfileId: "active", profiles: [{ id: "active", name: "Rolica", source: { id: "source", updatedAt: savedAt }, clientBuild: "fixture", quests: [{ id: 99, objectives: [{ text: "Collect 3 herbs" }] }] }],
    objectives: [{ id: "pin", profileId: "active", sourceId: "source", build: "fixture", kind: "quest", questId: 99, title: "Herbal aid" }] };
}

test("the valid active pin is the sole prominent recommendation and explains its saved evidence", async () => {
  const html = await dashboard({}, {}, { state: pinnedState() }).mount();
  assert.match(priority(html), /Herbal aid[\s\S]*Collect 3 herbs[\s\S]*Why this\?[\s\S]*pinned[\s\S]*Character snapshot[\s\S]*Resume quest/);
  assert.equal((html.match(/data-now-objective/g) || []).length, 1);
  assert.doesNotMatch(priority(html), /Finish the task/);
});

test("returning briefing ages the character save independently of live advice", async () => {
  const html = await dashboard({}, { live: true }, { state: pinnedState(), day: new Date("2026-11-18T00:00:00Z") }).mount();
  assert.match(priority(html), /Returning briefing[\s\S]*Herbal aid[\s\S]*Collect 3 herbs[\s\S]*Last character save: 6 hr ago · not live/);
  assert.equal((priority(html).match(/data-objective-resume=/g) || []).length, 1);
});

test("a blocked returning quest keeps the original pin and offers only manual review", async () => {
  for (const [modify, reason] of [
    [p => { p.source.updatedAt = "2026-11-15T00:00:00Z"; }, /last save is too old/i],
    [p => { p.source.updatedAt = "2026-11-19T00:00:00Z"; }, /save time is unknown/i],
    [p => { p.quests = [{ ...p.quests[0], id: 100 }]; }, /not in the last saved quest log/i],
  ]) {
    const state = pinnedState();
    modify(state.profiles[0]);
    const before = JSON.stringify(state);
    const html = priority(await dashboard({}, { live: true }, { state, day: new Date("2026-11-18T00:00:00Z") }).mount());
    assert.match(html, /Herbal aid[\s\S]*Plan B[\s\S]*No supported next step/);
    assert.match(html, reason);
    assert.match(html, /data-objective-resume="pin">Review pinned quest/);
    assert.doesNotMatch(html, /Collect 3 herbs|Resume quest|data-now-map|data-quest-open/);
    assert.equal(JSON.stringify(state), before);
  }
});

test("the ready quest stage requires a hand-in, not a completed turn-in", async () => {
  const state = pinnedState();
  state.profiles[0].quests[0].complete = true;
  const html = priority(await dashboard({}, {}, { state, day: new Date("2026-11-18T00:00:00Z") }).mount());
  assert.match(html, /Required: hand in this quest[\s\S]*Ready to turn in is not a completed turn-in/);
  assert.match(html, /data-objective-resume="pin">Resume quest/);
});

test("a pending picker change cannot show or dispatch the outgoing pin", async () => {
  const app = dashboard({}, {}, { state: pinnedState() });
  await app.mount();
  app.active.value = "other";
  let stopped = false;
  app.click("[data-objective-resume]", () => { stopped = true; });
  assert.ok(stopped);
  app.remount();
  assert.doesNotMatch(app.body.innerHTML, /Herbal aid|data-objective-resume/);
});

test("Not now hides only today's suggestion for this character without clearing the pin", async () => {
  const state = pinnedState(), storage = new Map();
  const app = dashboard({}, { savedAt }, { state, storage });
  assert.match(await app.mount(), /data-now-dismiss/);
  app.click("[data-now-dismiss]");
  assert.match(priority(app.body.innerHTML), /Finish the task[\s\S]*Why this\?[\s\S]*saved quest log/);
  assert.equal(state.objectives[0].id, "pin");
  assert.match(await dashboard({}, { savedAt }, { state, storage }).mount(), /Your objective[\s\S]*Herbal aid/);
  const other = dashboard({}, {}, { storage });
  other.active.value = "other";
  assert.match(priority(await other.mount()), /Finish the task/);
  const tomorrow = dashboard({}, {}, { state, storage, day: new Date(2026, 10, 19) });
  assert.match(priority(await tomorrow.mount()), /Herbal aid/);
});

test("a new pin can lead today after the old one is dismissed", async () => {
  const storage = new Map(), state = pinnedState();
  const app = dashboard({}, {}, { storage, state });
  await app.mount();
  app.click("[data-now-dismiss]");
  state.objectives[0] = { ...state.objectives[0], id: "new-pin", title: "New goal" };
  app.remount();
  assert.match(priority(app.body.innerHTML), /New goal/);
});

test("dismissing a pinned quest does not immediately recommend the same quest from the log", async () => {
  const app = dashboard({ levelingAdvice: async () => ({ status: "ok", character: { name: "Rolica", level: 20 }, zones: [], log: { inLog: 1, ready: [], active: [{ id: 99, title: "Herbal aid" }] } }) }, {}, { state: pinnedState() });
  await app.mount();
  app.click("[data-now-dismiss]");
  assert.match(priority(app.body.innerHTML), /No more suggestions/);
  assert.match(app.body.innerHTML, /data-quest-open="99"/);
});

test("completed and mismatched pins remain visible without leading Now", async () => {
  for (const change of [{ completion: { at: savedAt } }, { build: "other" }]) {
    const state = pinnedState();
    Object.assign(state.objectives[0], change);
    const html = await dashboard({}, {}, { state }).mount();
    assert.match(priority(html), /Finish the task/);
    assert.match(html, /Your objective[\s\S]*Herbal aid/);
    assert.doesNotMatch(html, /data-objective-resume/);
  }
});

test("an unobserved quest log does not read as zero quests", async () => {
  const html = await dashboard({ levelingAdvice: async () => ({ status: "ok", character: { name: "Rolica", level: 20 }, zones: [], log: { known: false, inLog: 0, ready: [], active: [] } }) }).mount();
  assert.match(html, /No quest log has been observed/);
  assert.doesNotMatch(html, /Quest log <small>0|quest log is empty|from your last save<\/span><\/h2>/);
});

test("a delayed recommendation cannot replace the newly selected character's action", async () => {
  const reply = title => {
    const result = { status: "ok", character: { name: title, level: 20 }, zones: [], log: { inLog: 1, ready: [{ id: 50, title }], active: [] } };
    return { ...result, recommendations: recommendSteps(result) };
  };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const app = dashboard({ levelingAdvice: () => ++calls === 1 ? pending : Promise.resolve(reply("Bravo")) });
  await app.mount();
  app.active.value = "bravo";
  app.remount();
  await new Promise(setImmediate);
  assert.match(priority(app.body.innerHTML), /Bravo/);
  release(reply("Alpha"));
  await new Promise(setImmediate);
  assert.match(priority(app.body.innerHTML), /Bravo/);
  assert.doesNotMatch(app.body.innerHTML, /Alpha/);
});

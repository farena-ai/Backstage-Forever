"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const src = (name) => readFileSync(join(__dirname, "../src/renderer", `${name}.js`), "utf8");

function dashboard(overrides = {}, toon = {}) {
  const character = { name: "Rolica", className: "Priest", race: "Undead", sex: "female", level: 15, xp: { savedLevel: 15, current: 300, max: 500, rested: 100 }, ...toon };
  const body = { innerHTML: "", querySelectorAll: () => [] };
  const header = { dataset: { nowIdentity: "" }, outerHTML: "", querySelector: () => null, contains: () => false };
  const root = { addEventListener() {} };
  const active = { value: "active" };
  const nodes = { "[data-now]": root, '[data-now] > [data-page-hero="now"]': header, "[data-now-body]": body, "#active-character": active };
  const globals = {
    document: { querySelector: (sel) => nodes[sel] },
    BF_PORTRAITS: ["undead-female-priest"],
    backstage: {
      levelingAdvice: async () => ({ status: "ok", character, zones: [], log: { inLog: 1, ready: [{ title: "Finish the task", id: 42 }], active: [] } }),
      gameStatus: async () => ({ connected: false }),
      liveLinkStatus: async () => ({ signal: "old-addon" }),
      weekly: async () => ({ reminders: [{ kind: "mail", text: "Check your mail" }] }),
      ...overrides,
    },
  };
  globals.window = globals;
  for (const script of ["page-hero", "now"]) runInNewContext(src(script), globals);
  const view = globals.NowView;
  return { view, header, body, active, async mount() { view.mounted(); await new Promise(setImmediate); return body.innerHTML; } };
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

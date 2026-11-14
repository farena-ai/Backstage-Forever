"use strict";
// Creature levels and elite flags reach the quest page (IPC + tiles) and the World Map area card.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { registerKnowledgeHandlers } = require("../src/core/knowledge-ipc.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { loadCreaturePack } = require("../src/core/creature-data.cjs");

function handlers(getCreatures) {
  const index = new KnowledgeIndex(structuredClone(require("../data/forever/pack.json")));
  const h = {};
  registerKnowledgeHandlers({ handle: (n, fn) => (h[n] = fn), knowledge: { setContext() {}, index: () => index }, getState: () => ({ profiles: [{ id: "p" }], activeProfileId: "p" }), connected: () => false, clipboard: { writeText() {} }, ...(getCreatures ? { getCreatures } : {}) });
  return h;
}

test("quest details add objective creature levels and flags only when the creature reference knows them", () => {
  const plain = handlers().questDetails("p", 7);
  assert.equal("objectiveCreatures" in plain, false, "no creature reference: the legacy shape is unchanged");
  const h = handlers(() => loadCreaturePack());
  const kobolds = h.questDetails("p", 7);
  assert.deepEqual(kobolds.objectiveCreatures, { 1: { name: "Kobold Vermin", minLevel: 1, maxLevel: 2, elite: false, rare: false } });
  const { objectiveCreatures, ...rest } = kobolds;
  { const strip = (o) => { const c = { ...o }; delete c.howTo; return c; }; assert.deepEqual(strip(rest), strip(plain), "nothing else changes (the how-to reflects the new data)"); }
  assert.ok(Object.values(h.questDetails("p", 541).objectiveCreatures).some((c) => c.elite), "Battle of Hillsbrad has an elite kill");
  // Quests without kill objectives the reference knows stay without the field.
  const items = Object.values(require("../data/forever/pack.json").quests).find((q) => q.objectives?.length && q.objectives.every((o) => o.type === "item"));
  assert.equal("objectiveCreatures" in h.questDetails("p", items.id), false);
  assert.equal("objectiveCreatures" in handlers(() => null).questDetails("p", 7), false);
});

function questGuide() {
  const root = { addEventListener() {}, querySelector: (s) => (s === ".quest-guide" ? {} : null), querySelectorAll: () => [] };
  const c = { window: {}, document: { activeElement: null, addEventListener() {} }, setTimeout, clearTimeout, queueMicrotask, console };
  vm.createContext(c);
  for (const [f, n] of [["interaction", "InteractionGuard"], ["player-navigation", "PlayerNavigation"], ["page-hero", "PageHero"], ["quest-guide", "QuestGuide"]]) { vm.runInContext(fs.readFileSync(require.resolve(`../src/renderer/${f}.js`), "utf8"), c); c[n] = c.window[n]; }
  let details = {};
  c.QuestGuide.init({ root, esc: (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("'", "&#39;"), portrait: () => "", notify() {}, api: { questDetails: async () => details } });
  c.QuestGuide.sync({ id: "a", name: "A", className: "Hunter", faction: "Horde", quests: [{ id: 1, title: "Pirate Trouble", complete: false }] });
  return { c, set: (d) => (details = d) };
}

test("objective tiles show the creature level range and an Elite chip, and open the matching map area", async () => {
  const { c, set } = questGuide();
  const spots = [{ mapId: 1411, x: 0.6, y: 0.4 }, { mapId: 1411, x: 0.62, y: 0.4 }];
  set({ status: "match", record: { title: "Pirate Trouble", objectives: [] }, chain: [], waypoint: null, mapNames: { 1411: "Durotar" },
    objectiveLocations: [{ index: 1, required: 12, positions: spots }, { index: 2, required: 1, positions: spots }, { index: 3, required: 5, positions: spots }],
    objectiveNames: { 1: { type: "monster", name: "Southsea Brigand" }, 2: { type: "monster", name: "Hogger" }, 3: { type: "item", name: "Shell" } },
    objectiveCreatures: { 1: { name: "Southsea Brigand", minLevel: 12, maxLevel: 13, elite: false, rare: false }, 2: { name: "Hogger", minLevel: 11, maxLevel: 11, elite: true, rare: false } } });
  await c.QuestGuide.open(1);
  const html = c.QuestGuide.page();
  const tiles = html.split('class="quest-where-tile quest-where-objective"').slice(1);
  assert.equal(tiles.length, 3);
  assert.match(tiles[0], /<strong>Kill 12 Southsea Brigand<\/strong><span class="quest-where-chips"><span class="quest-chip quest-chip-level">lvl 12–13<\/span><\/span>/);
  assert.doesNotMatch(tiles[0], /Elite/);
  assert.match(tiles[1], /lvl 11<\/span><span class="quest-chip quest-chip-elite"[^>]*>Elite<\/span>/);
  assert.doesNotMatch(tiles[2], /quest-chip/, "item objectives have no creature chips");
  const focus = JSON.parse(tiles[1].match(/data-map-focus='([^']*)'/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  assert.equal(focus.kind, "objective-area");
  assert.equal(focus.questId, 1);
  assert.equal(focus.index, 2);
  assert.ok(focus.goal.steps.some((s) => /Hogger is elite/.test(s)));
});

function worldMapView() {
  const c = { window: { addEventListener() {} }, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve("../src/renderer/world-map.js"), "utf8"), c);
  return c.window.WorldMapView;
}

test("the World Map area card states the objective, quest, levels, difficulty and elite warning in plain words", () => {
  const view = worldMapView();
  const model = { mapName: "Durotar", player: { level: 10, saved: { x: 0.5, y: 0.5 } } };
  const area = { id: "oa:900:2:0", kind: "objective-area", questId: 900, questTitle: "Pirate <Trouble>", status: "active", index: 2, type: "monster", label: "Kill Hogger", target: "Hogger", progress: "0/1 Hogger slain", x: 0.2, y: 0.2, radius: 0.03, spots: 6,
    creature: { id: 448, name: "Hogger", minLevel: 11, maxLevel: 11, elite: true, hostile: true }, levels: "11", difficulty: "yellow", warning: "Hogger is elite (level 11): much tougher than a normal enemy. Bring a group, or come back a few levels higher.", source: "Your quest log + reference" };
  const html = view._areaCard(area, model);
  assert.match(html, /<h3>Kill Hogger<\/h3><p class="wm-sub">Pirate &lt;Trouble&gt;<\/p>/, "text is escaped");
  assert.match(html, /In your quest log/);
  assert.match(html, /Your progress: <strong>0\/1 Hogger slain<\/strong>/);
  assert.match(html, /<strong>Hogger<\/strong> · level 11 <span class="wm-diff wm-diff-yellow">an even fight at 10<\/span> <span class="wm-elite">Elite<\/span><br><small>Attacks on sight\.<\/small>/);
  assert.match(html, /<p class="wm-warn" role="note">Hogger is elite \(level 11\): much tougher than a normal enemy\. Bring a group/);
  assert.match(html, /data-quest-open="900">Open quest/);
  assert.match(html, /data-wm-act="focus-area">Show on map/);
  assert.match(html, /From your last saved spot: <strong>northwest, across the zone<\/strong>|From your last saved spot: <strong>northwest, a short ride<\/strong>/);
  assert.doesNotMatch(html, /style=/, "no inline styles (CSP)");
  const plain = view._areaCard({ ...area, status: "available", creature: null, levels: null, difficulty: null, warning: null, progress: null, label: "Collect 5 Shell", spots: 1 }, model);
  assert.match(plain, /Quest you could pick up \(check availability in game\)/);
  assert.match(plain, /Based on 1 spot where/);
  assert.doesNotMatch(plain, /wm-warn|wm-elite|wm-diff|Your progress/);
});

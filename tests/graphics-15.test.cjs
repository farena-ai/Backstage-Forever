"use strict";
// 1.5 (J19-J21): flowing routes and footprints, velvet loot trays and final-boss art, big moments.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("J19: the route to a dialed-in target flows and the target pulses, still under reduced motion; footprints mark the trail", () => {
  const s = read("src/renderer/world-map.js");
  assert.match(s, /ctx\.lineDashOffset = -\(flow % 18\)/);
  assert.match(s, /prefers-reduced-motion: reduce/);
  assert.match(s, /const pulse = still\(\) \? 0 :/);
  assert.match(s, /if \(!focused \|\| !canvas\?\.isConnected \|\| still\(\) \|\| document\.hidden\) return;/, "the loop stops when nothing is dialed in or the page is hidden");
  assert.match(s, /ctx\.ellipse\(0, 0, 3\.6, 2, 0, 0, 7\)/, "footprints");
});

test("J20: loot on velvet trays; each atlas card with painted art shows its final boss", () => {
  assert.match(read("src/renderer/dungeon-atlas.css"), /\.loot-boss \.loot-grid \{[^}]*radial-gradient/);
  const art = read("src/renderer/boss-art.js");
  const ids = JSON.parse(art.match(/Object\.freeze\((\[[^\]]*\])\)/)[1]);
  assert.ok(ids.length >= 20, "most dungeons and raids have a final-boss painting");
  for (const id of ids) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/bosses", id + ".webp")), `art/bosses/${id}.webp`);
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf("boss-art.js") > -1 && html.indexOf("boss-art.js") < html.indexOf("dungeon-atlas.js"));
  assert.match(read("src/renderer/dungeon-atlas.js"), /art\/bosses\/\$\{esc\(e\.id\)\}\.webp/);
});

test("J21: the big badges get the big moment, and a finished zone is celebrated once", () => {
  const j = read("src/renderer/journey.js");
  assert.match(j, /const BIG = new Set\(\["first-mount", "level-40", "level-60"/);
  assert.match(read("src/renderer/journey.css"), /\.bf-badge-pop\.big \{/);
  const store = new Map();
  const shown = [];
  const ctx = { window: {}, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, document: { querySelector: () => null } };
  ctx.window.backstage = {}; ctx.window.JourneyView = { celebrate: (o) => shown.push(o) };
  ctx.window.PageHero = { render: () => "" };
  vm.createContext(ctx); ctx.PageHero = ctx.window.PageHero;
  vm.runInContext(read("src/renderer/world-tracker.js"), ctx);
  const W = ctx.window.WorldTrackerView;
  W._announce({ name: "A", zones: [{ mapId: 1, name: "Durotar", mastered: true, done: 20, total: 22 }] });
  assert.equal(shown.length, 0, "the first look is the baseline");
  W._announce({ name: "A", zones: [{ mapId: 1, name: "Durotar", mastered: true, done: 20, total: 22 }, { mapId: 2, name: "The Barrens", mastered: true, done: 40, total: 44 }] });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "The Barrens");
  assert.equal(shown[0].big, true);
  W._announce({ name: "A", zones: [{ mapId: 1, mastered: true }, { mapId: 2, mastered: true }] });
  assert.equal(shown.length, 1, "once per zone");
});

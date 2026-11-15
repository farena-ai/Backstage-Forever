"use strict";
// Characters → All characters (0.43, roadmap 3.7).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const A = require("../src/core/alts.cjs");
const { validateProgress } = require("../src/core/quest-data.cjs");
const NOW = 1763200000, H = 3600;
const iso = (t) => new Date(t * 1000).toISOString();
const prof = (o = {}) => ({ realm: "Forever", className: "Mage", faction: "Horde", race: "Troll", level: 20, ...o, id: o.id || "a", name: o.name || "Ann",
  progress: "progress" in o && o.progress === undefined ? undefined : { current: 500, max: 1000, rested: 0, ...(o.progress || {}) }, source: { kind: "wow-addon", id: "x", updatedAt: iso(o.saved ?? NOW) } });

test("rested XP grows from the save: inn rate, a quarter outside, capped at 150%, a range when the place is unknown", () => {
  assert.equal(A.restedNow(prof({ progress: { resting: true } }), NOW + 16 * H).percent, 10, "two 8-hour nights in an inn: 10%");
  assert.equal(A.restedNow(prof({ progress: { resting: false } }), NOW + 16 * H).percent, 3, "outside: a quarter (2.5%)");
  const full = A.restedNow(prof({ progress: { rested: 1400, resting: true } }), NOW + 100 * H);
  assert.equal(full.percent, 150); assert.equal(full.full, true);
  const unknown = A.restedNow(prof(), NOW + 32 * H);
  assert.equal(unknown.known, false); assert.equal(unknown.percent, 20); assert.equal(unknown.lowPercent, 5);
  assert.equal(A.restedNow(prof({ level: 60 }), NOW), null, "nothing to rest for at 60");
  assert.equal(A.restedNow(prof({ progress: undefined }), NOW), null);
});

test("who to play tonight: full rested first, then near riding, long breaks; full bags are a warning, 60s rarely", () => {
  const v = A.altsView({ activeProfileId: "b", profiles: [
    prof({ id: "a", name: "Ann", level: 25, progress: { rested: 1500, resting: true } }),
    prof({ id: "b", name: "Bo", level: 39, readiness: { bags: { free: 2, total: 64 } } }),
    prof({ id: "c", name: "Cy", level: 60, ledger: { money: 1234567 } }),
    prof({ id: "d", name: "Dee", level: 12, saved: NOW - 20 * 86400, progress: { resting: false } }),
  ] }, { now: NOW });
  assert.deepEqual(v.tonight.map((s) => s.name), ["Ann", "Dee", "Bo"]);
  assert.match(v.tonight[0].reasons[0], /full/);
  assert.ok(v.tonight[2].reasons.some((r) => /one level from 40/.test(r)) && v.tonight[2].reasons.some((r) => /2 free bag slots/.test(r)));
  assert.match(v.tonight[1].reasons.join(" "), /75% of a level in rested XP.*not played for 20 days/);
  assert.deepEqual(v.cards.map((c) => c.name), ["Cy", "Bo", "Ann", "Dee"], "highest level first");
  assert.equal(v.cards.find((c) => c.name === "Bo").active, true);
  assert.equal(v.totals.money, 1234567); assert.equal(v.totals.maxLevel, 1);
  assert.deepEqual(A.altsView({ profiles: [] }).tonight, []);
});

test("the capture can say whether you logged out resting; anything else is refused", () => {
  assert.deepEqual(validateProgress({ current: 1, max: 2, rested: 3, resting: true }), { current: 1, max: 2, rested: 3, resting: true });
  assert.throws(() => validateProgress({ current: 1, max: 2, resting: "yes" }));
  const lua = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForever.lua"), "utf8");
  assert.match(lua, /resting=call\(IsResting\)==true/);
});

test("the All characters page lists every card and picks tonight's character; Switch uses the shell's picker", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.match(read("src/renderer/player-navigation.js"), /\["alts", "All characters"\]/);
  assert.match(read("src/renderer/app.js"), /alts: AltsView\.page/);
  assert.match(read("src/renderer/index.html"), /<script src="alts\.js"><\/script>/);
  assert.match(read("src/preload.cjs"), /alts: \(\) => invoke\("alts"\)/);
  const view = A.altsView({ activeProfileId: "a", profiles: [prof({ id: "a", name: "Ann <b>", progress: { rested: 1500, resting: true } }), prof({ id: "b", name: "Bo", level: 38 })] }, { now: NOW });
  const ctx = { window: { backstage: { alts: async () => view } }, PageHero: { render: (o) => `<h1>${o.title}</h1>`, classCrest: () => "art/classes/mage.png" }, document: { querySelector: () => null } };
  vm.createContext(ctx); vm.runInContext(read("src/renderer/alts.js"), ctx);
  ctx.window.AltsView._state();
  // Render with data in place.
  const src = read("src/renderer/alts.js").replace("let data = null,", "let data = globalThis.__view,");
  const ctx2 = { ...ctx, __view: view, window: { backstage: ctx.window.backstage } }; vm.createContext(ctx2); vm.runInContext(src, ctx2);
  const html = ctx2.window.AltsView.page();
  assert.match(html, /Play Ann &lt;b&gt;/);
  assert.match(html, /data-alt-play="b"/); assert.doesNotMatch(html, /data-alt-play="a"/, "no switch button on the active character");
  assert.match(html, /Playing now/);
  assert.match(html, /150%<\/strong> rested \(full\)/);
});

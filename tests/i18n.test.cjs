"use strict";
// Translations (0.53, roadmap 4.3 part 2).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const { luaPattern, luaReplacement } = require("../scripts/build-locales.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("format templates become anchored Lua patterns with captures in order", () => {
  assert.equal(luaPattern("Waypoint set: %s at %.1f, %.1f."), "^Waypoint set: (.-) at (%-?[%d%.]+), (%-?[%d%.]+)%.$");
  assert.equal(luaPattern("%d XP/hour"), "^(%-?%d+) XP/hour$");
  assert.equal(luaPattern("%d h %02d min (100%)"), "^(%-?%d+) h (%-?%d+) min %(100%%%)$");
  assert.equal(luaReplacement("%d EP/Stunde (100%)"), "%1 EP/Stunde (100%%)");
  assert.equal(luaReplacement("Wegpunkt: %s bei %.1f, %.1f."), "Wegpunkt: %1 bei %2, %3.");
});

test("the dictionary is current, machine translation is labelled, commands and placeholders are untouched", () => {
  assert.equal(spawnSync(process.execPath, ["scripts/build-locales.cjs", "--check"], { cwd: root, encoding: "utf8" }).status, 0, "locales are built from data/i18n");
  const de = JSON.parse(read("data/i18n/de.json"));
  assert.equal(de.machineTranslated, true);
  assert.ok(Object.keys(de.app).length > 300, "most app text"); assert.ok(Object.keys(de.addon.plain).length > 30 && Object.keys(de.addon.templates).length > 20);
  const codes = (s) => (s.match(/%[0-9.]*[sdf]|\|c[0-9a-f]{8}|\|r/gi) || []).sort().join(" ");
  const cmds = (s) => (s.match(/\/bf(?: [a-z]+)+/g) || []).join("|");
  for (const [en, v] of [...Object.entries(de.app), ...Object.entries(de.addon.plain), ...Object.entries(de.addon.templates)]) {
    assert.equal(codes(v), codes(en), `placeholders changed: ${en}`);
    for (const c of en.match(/\/bf [a-z]+/g) || []) assert.ok(v.includes(c), `command lost: ${en} -> ${v}`);
  }
  void cmds;
});

test("in game: German clients get German messages, others English, and unknown text passes through", () => {
  const de = JSON.parse(read("data/i18n/de.json"));
  const [en, want] = Object.entries(de.addon.plain).find(([k]) => !/^\s/.test(k));
  const tmpl = Object.keys(de.addon.templates).find((k) => /^[^%]*%d XP\/hour$/.test(k)) || Object.keys(de.addon.templates).find((k) => (k.match(/%d/g) || []).length === 1 && !/%s|%\./.test(k));
  const sample = tmpl.replace(/%0?\d*d/, "42");
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua')
print(BackstageForeverTr(${JSON.stringify(en)}))
print(BackstageForeverTr(${JSON.stringify(sample)}))
print(BackstageForeverTr('Something new'))
print(BackstageForeverTr(nil)==nil)
`).split("\n");
  assert.equal(out[0], want); assert.match(out[1], /42/); assert.notEqual(out[1], sample, `template ${tmpl}`);
  assert.equal(out[2], "Something new"); assert.equal(out[3], "true");
  assert.equal(lua(String.raw`GetLocale=function() return 'enUS' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua')
print(BackstageForeverTr(${JSON.stringify(en)}))`), en);
});

test("the compact Adventure Compass speaks German on German clients (0.54)", () => {
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua')
for _,s in ipairs({'Adventure Compass','Quests: 3 in your log','2 ready to hand in','1,840 XP to level up','Pace: 12,400 XP/hour','next level in about 9 min','Next:','Drag the title to move  ·  /bf help  ·  /bf show'}) do print(BackstageForeverTr(s)) end
`).split("\n");
  assert.deepEqual(out, ["Abenteuer-Kompass", "Quests: 3 in deinem Log", "2 bereit zur Abgabe", "1,840 EP bis zum Stufenaufstieg", "Tempo: 12,400 EP/Stunde", "nächste Stufe in etwa 9 min", "Als Nächstes:", "Titel ziehen zum Verschieben  ·  /bf help  ·  /bf show"]);
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /heading:SetText\(T\('Adventure Compass'\)\)/);
  assert.match(hud, /hint:SetText\(T\(/);
});

test("every addon chat helper and the message box go through the translator", () => {
  const dir = path.join(root, "addon/BackstageForever");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".lua"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of s.matchAll(/'Backstage Forever: '\.\.(\S+?)\)/g)) assert.ok(m[1].startsWith("(BackstageForeverTr or tostring)") || m[1].startsWith("(latest"), `${f}: ${m[0]}`);
  }
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /title=BackstageForeverTr\(title\);if sub then sub=BackstageForeverTr\(sub\) end/);
  assert.equal(read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).find((l) => l.endsWith(".lua")), "BackstageForeverLocale.lua", "loads first");
});

function i18n({ pref = null, dict = { "Your next step": "Dein nächster Schritt", "Open map": "Karte öffnen" } } = {}) {
  const store = new Map(pref ? [["bf-lang-v1", pref]] : []);
  const html = { dataset: {}, lang: "en" };
  const text = (v, parent) => ({ nodeType: 3, nodeValue: v, parentElement: parent });
  const el = (attrs = {}, kids = [], skip = false) => { const e = { nodeType: 1, attrs, childNodes: [], getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, matches: () => skip, closest: () => (skip ? e : null) }; e.childNodes = kids.map((k) => (typeof k === "string" ? text(k, e) : k)); return e; };
  const body = el({}, []);
  const ctx = { window: { BF_LOCALE_DE: dict }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, location: { reload() { ctx.reloaded = true; } },
    document: { readyState: "complete", body, documentElement: html, addEventListener() {} }, MutationObserver: undefined };
  vm.createContext(ctx); vm.runInContext(read("src/renderer/i18n.js"), ctx);
  return { I: ctx.window.I18n, html, el, body, ctx };
}

test("the app follows the game's language unless you pick one; whole text pieces and labels are swapped", () => {
  const { I, html, el } = i18n();
  assert.equal(I.resolve("auto", "deDE"), "de"); assert.equal(I.resolve("auto", "enUS"), "en"); assert.equal(I.resolve("en", "deDE"), "en"); assert.equal(I.resolve("de", "enUS"), "de");
  assert.equal(I.lang, "en");
  I.setGameLocale("deDE");
  assert.equal(I.lang, "de"); assert.equal(html.lang, "de"); assert.equal(html.dataset.machineTranslated, "true");
  const btn = el({ title: "Open map" }, ["  Your next step  ", "Untranslated words"]);
  const skipped = el({}, ["Your next step"], true);
  I.apply(el({}, [btn, skipped]));
  assert.equal(btn.childNodes[0].nodeValue, "  Dein nächster Schritt  ", "spacing kept");
  assert.equal(btn.childNodes[1].nodeValue, "Untranslated words");
  assert.equal(btn.attrs.title, "Karte öffnen");
  assert.equal(skipped.childNodes[0].nodeValue, "Your next step", "data-no-translate and inputs stay as they are");
  assert.match(I.control(), /Deutsch \(machine-translated\)/);
  const english = i18n({ pref: "en" }); english.I.setGameLocale("deDE"); assert.equal(english.I.lang, "en", "a chosen language wins over the game's");
});

test("wiring: dictionary before the translator, the game locale passed in, the picker on the Field guide, the mark in the menu", () => {
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf('src="locales/de.js"') < html.indexOf('src="i18n.js"') && html.indexOf('src="i18n.js"') < html.indexOf('src="app.js"'));
  const app = read("src/renderer/app.js");
  assert.match(app, /window\.I18n\?\.setGameLocale\(selected\?\.locale \|\| null\)/); assert.match(app, /I18n\.control\(\)/);
  assert.match(read("src/renderer/styles.css"), /html\[data-machine-translated="true"\] \.rail-bottom \.status::after \{ content: " · maschinell übersetzt"/);
  assert.match(read(".github/workflows/ci.yml"), /npm run check:locales/);
});

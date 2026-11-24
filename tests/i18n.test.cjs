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

// More languages (roadmap P1): every data/i18n/<lang>.json is held to the same rules, and to German's key list.
const { LANG_CODES, GAME_LOCALES, languageFile } = require("../scripts/build-locales.cjs");
const dictOf = (lang) => JSON.parse(read(`data/i18n/${lang}.json`));
const SECTIONS = [["app", (d) => d.app], ["appTemplates", (d) => d.appTemplates], ["addon.plain", (d) => d.addon.plain], ["addon.templates", (d) => d.addon.templates]];

test("every language file is compiled, named in its own words and loaded by the app before the translator", () => {
  for (const lang of ["de", "es", "fr"]) assert.ok(LANG_CODES.includes(lang), `${lang} ships`);
  assert.deepEqual(LANG_CODES, fs.readdirSync(path.join(root, "data/i18n")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort(), "nothing in data/i18n is left out");
  const html = read("src/renderer/index.html"), lua = read("addon/BackstageForever/BackstageForeverLocale.lua");
  const claimed = new Set();
  for (const lang of LANG_CODES) {
    const d = dictOf(lang);
    assert.ok(typeof d.name === "string" && d.name.trim() && !/english|german|french|spanish/i.test(d.name), `${lang}: its own name`);
    if (d.machineTranslated) assert.ok(typeof d.machineNote === "string" && d.machineNote.trim(), `${lang}: says machine-translated in its own words`);
    const at = html.indexOf(`<script src="locales/${lang}.js"></script>`);
    assert.ok(at > 0 && at < html.indexOf('<script src="i18n.js"></script>'), `${lang}: loaded before i18n.js`);
    assert.ok(fs.existsSync(path.join(root, "src/renderer/locales", `${lang}.js`)), `${lang}: compiled for the app`);
    for (const code of d.gameLocales || GAME_LOCALES[lang]) { assert.ok(!claimed.has(code), `${code} once`); claimed.add(code); assert.ok(read(`addon/BackstageForever/${languageFile(lang)}`).includes(`"${code}"`), `${lang}: the addon serves ${code}`); }
  }
  assert.deepEqual(GAME_LOCALES.es, ["esES", "esMX"], "both Spanish clients get Spanish");
  // B10: the lookup holds no text; each language has its own file, well under the 1 MB an addon file may reach.
  assert.ok(Buffer.byteLength(lua) < 8 * 1024, "the lookup stays tiny");
  for (const lang of LANG_CODES) assert.ok(Buffer.byteLength(read(`addon/BackstageForever/${languageFile(lang)}`)) < 512 * 1024, `${lang}: its file stays under 512 KB`);
});

for (const lang of LANG_CODES) {
  test(`${lang}: complete against German, nothing empty, placeholders, colour codes and commands untouched`, () => {
    const d = dictOf(lang), de = dictOf("de");
    assert.equal(d.version, 1);
    const codes = (s) => (s.match(/%[0-9.]*[sdf]|\|c[0-9a-f]{8}|\|r/gi) || []).sort().join(" ");
    const order = (s) => (s.match(/%(?:0?\d*)?(?:\.\d+)?[sdf]/g) || []).join(" ");
    const ph = (s) => (s.match(/\{#?\d+\}/g) || []).map((x) => x.replace("#", "")).sort().join(" ");
    for (const [name, pick] of SECTIONS) {
      const mine = pick(d) || {}, theirs = pick(de);
      const missing = Object.keys(theirs).filter((k) => !Object.hasOwn(mine, k));
      assert.deepEqual(missing.slice(0, 5), [], `${lang} ${name}: ${missing.length} keys German has are missing`);
      for (const [en, v] of Object.entries(mine)) {
        assert.ok(typeof v === "string" && v.trim(), `${lang} ${name}: empty value for ${en}`);
        assert.equal(codes(v), codes(en), `${lang} ${name}: format or colour codes changed: ${en}`);
        for (const c of en.match(/\/bf [a-z]+/g) || []) assert.ok(v.includes(c), `${lang} ${name}: command lost: ${en} -> ${v}`);
        if (/\/reload/.test(en)) assert.ok(v.includes("/reload"), `${lang} ${name}: /reload lost: ${en}`);
        assert.equal(/^\s/.test(v), /^\s/.test(en), `${lang} ${name}: leading space changed: ${en}`);
        assert.equal(/\s$/.test(v), /\s$/.test(en), `${lang} ${name}: trailing space changed: ${en}`);
      }
    }
    // Addon templates fill captures in order, so the codes must come in the English order.
    for (const [en, v] of Object.entries(d.addon.templates)) assert.equal(order(v), order(en), `${lang}: format codes reordered: ${en}`);
    for (const [en, v] of Object.entries(d.appTemplates)) { assert.equal(ph(v), ph(en), `${lang}: placeholders changed: ${en}`); }
  });

  test(`${lang}: the compiled app dictionary loads, and its templates compile and translate`, () => {
    const d = dictOf(lang), U = lang.toUpperCase();
    const window = {}, html = { dataset: {} };
    const ctx = vm.createContext({ window, document: { readyState: "complete", documentElement: html, body: null, addEventListener() {} }, localStorage: { getItem: () => lang, setItem() {} }, location: { reload() {} }, Object });
    vm.runInContext(read(`src/renderer/locales/${lang}.js`), ctx);
    assert.equal(window[`BF_LOCALE_${U}_META`].name, d.name);
    assert.equal(window[`BF_LOCALE_${U}_TEMPLATES`].length, Object.keys(d.appTemplates).length, "every template compiled");
    for (const [src] of window[`BF_LOCALE_${U}_TEMPLATES`]) assert.doesNotThrow(() => new RegExp(src));
    vm.runInContext(read("src/renderer/i18n.js"), ctx);
    const I = window.I18n;
    assert.equal(I.lang, lang); assert.equal(html.lang, lang);
    assert.equal(I.NAMES[lang], d.machineTranslated ? `${d.name} (${d.machineNote})` : d.name);
    for (const code of d.gameLocales || GAME_LOCALES[lang]) assert.equal(I.resolve("auto", code), lang, `${code} shows ${lang}`);
    assert.equal(I.tr("Hand in 3 finished quests"), d.appTemplates["Hand in {#0} finished quests"].replace("{0}", "3"));
    assert.equal(I.tr("Open Now"), d.app["Open Now"]);
    const points = I.tr("You have 3 talent points waiting to be spent.");
    assert.ok(points.includes("3") && !/[{}]/.test(points), `a translation may write {0} or {#0}: ${points}`);
    assert.equal(I.tr("Secrets of the Dreamers"), null);
  });

  test(`${lang}: in game its clients get its messages and templates`, () => {
    const d = dictOf(lang);
    const [en, want] = Object.entries(d.addon.plain).find(([k, v]) => !/^\s/.test(k) && k !== v);
    for (const code of d.gameLocales || GAME_LOCALES[lang]) {
      const out = lua(String.raw`
GetLocale=function() return '${code}' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
print(BackstageForeverTr(${JSON.stringify(en)}))
print(BackstageForeverTr('Waypoint set: Thork at 51.5, 30.9. Follow the arrow on your minimap and screen.'))
print(BackstageForeverTr('7 h 05 min'))
print(tostring(BackstageForeverTranslated))
`).split("\n");
      assert.equal(out[0], want, code);
      assert.equal(out[1], d.addon.templates["Waypoint set: %s at %.1f, %.1f. Follow the arrow on your minimap and screen."].replace("%s", "Thork").replace("%.1f", "51.5").replace("%.1f", "30.9"), code);
      assert.equal(out[2], d.addon.templates["%d h %02d min"].replace("%d", "7").replace("%02d", "05"), code);
      assert.equal(out[3], "true");
    }
  });
}

test("a language nobody translated stays English in game and in the app", () => {
  assert.equal(lua(String.raw`GetLocale=function() return 'koKR' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
print(BackstageForeverTr('Adventure Compass'), tostring(BackstageForeverTranslated))`), "Adventure Compass\tfalse");
});

test("in game: German clients get German messages, others English, and unknown text passes through", () => {
  const de = JSON.parse(read("data/i18n/de.json"));
  const [en, want] = Object.entries(de.addon.plain).find(([k]) => !/^\s/.test(k));
  const tmpl = Object.keys(de.addon.templates).find((k) => /^[^%]*%d XP\/hour$/.test(k)) || Object.keys(de.addon.templates).find((k) => (k.match(/%d/g) || []).length === 1 && !/%s|%\./.test(k));
  const sample = tmpl.replace(/%0?\d*d/, "42");
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
print(BackstageForeverTr(${JSON.stringify(en)}))
print(BackstageForeverTr(${JSON.stringify(sample)}))
print(BackstageForeverTr('Something new'))
print(BackstageForeverTr(nil)==nil)
`).split("\n");
  assert.equal(out[0], want); assert.match(out[1], /42/); assert.notEqual(out[1], sample, `template ${tmpl}`);
  assert.equal(out[2], "Something new"); assert.equal(out[3], "true");
  assert.equal(lua(String.raw`GetLocale=function() return 'enUS' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
print(BackstageForeverTr(${JSON.stringify(en)}))`), en);
});

test("the compact Adventure Compass speaks German on German clients (0.54)", () => {
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
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

function i18n({ pref = null, meta = null, dict = { "Your next step": "Dein nächster Schritt", "Open map": "Karte öffnen" } } = {}) {
  const store = new Map(pref ? [["bf-lang-v1", pref]] : []);
  const html = { dataset: {}, lang: "en" };
  const text = (v, parent) => ({ nodeType: 3, nodeValue: v, parentElement: parent });
  const el = (attrs = {}, kids = [], skip = false) => { const e = { nodeType: 1, attrs, childNodes: [], getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, matches: () => skip, closest: () => (skip ? e : null) }; e.childNodes = kids.map((k) => (typeof k === "string" ? text(k, e) : k)); return e; };
  const body = el({}, []);
  const ctx = { window: { BF_LOCALE_DE: dict, ...(meta ? { BF_LOCALE_DE_META: meta } : {}) }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, location: { reload() { ctx.reloaded = true; } },
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
  assert.match(I.control(), />de \(machine-translated\)</, "a dictionary without details still lists");
  const named = i18n({ meta: { name: "Deutsch", machineTranslated: true, machineNote: "maschinell übersetzt", gameLocales: ["deDE"] } });
  assert.match(named.I.control(), /<option value="auto"[^>]*>Same as the game<\/option><option value="en"[^>]*>English<\/option><option value="de"[^>]*>Deutsch \(maschinell übersetzt\)<\/option>/);
  assert.equal(named.I.resolve("auto", "frFR"), "en", "no French dictionary loaded here, so English");
  const reviewed = i18n({ meta: { name: "Deutsch", machineTranslated: false, gameLocales: ["deDE"] } }); reviewed.I.setGameLocale("deDE");
  assert.equal(reviewed.I.NAMES.de, "Deutsch"); assert.equal(reviewed.html.dataset.machineTranslated, "false", "a reviewed language is not marked");
  const english = i18n({ pref: "en" }); english.I.setGameLocale("deDE"); assert.equal(english.I.lang, "en", "a chosen language wins over the game's");
});

test("wiring: dictionary before the translator, the game locale passed in, the picker on the Field guide, the mark in the menu", () => {
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf('src="locales/de.js"') < html.indexOf('src="i18n.js"') && html.indexOf('src="i18n.js"') < html.indexOf('src="app.js"'));
  const app = read("src/renderer/app.js");
  assert.match(app, /window\.I18n\?\.setGameLocale\(selected\?\.locale \|\| null\)/); assert.match(app, /I18n\.control\(\)/);
  assert.match(read("src/renderer/styles.css"), /html\[data-machine-translated="true"\] \.rail-bottom \.status::after \{ content: var\(--bf-machine-note, " · machine-translated"\)/);
  assert.match(read("src/renderer/i18n.js"), /setProperty\?\.\("--bf-machine-note", JSON\.stringify\(" · " \+ \(META\[lang\]\?\.machineNote/, "the mark is written in the shown language");
  assert.match(read(".github/workflows/ci.yml"), /npm run check:locales/);
});

test("app sentences with numbers and names translate through templates (0.57)", () => {
  const { appPattern } = require("../scripts/build-locales.cjs");
  assert.equal(appPattern("Hand in {#0} finished quests"), "^Hand in ([0-9][0-9.,:/%–-]*) finished quests$");
  assert.equal(appPattern("Switch to {0}"), "^Switch to (.+?)$");
  assert.equal(appPattern("Level {0}: come back around {1} (x)."), String.raw`^Level (.+?): come back around (.+?) \(x\)\.$`);
  const de = JSON.parse(read("data/i18n/de.json"));
  const ph = (s) => (s.match(/\{#?\d+\}/g) || []).map((x) => x.replace("#", "")).sort().join(" ");
  assert.ok(Object.keys(de.appTemplates || {}).length > 40, "the common sentences with numbers");
  for (const [en, v] of Object.entries(de.appTemplates)) assert.equal(ph(v), ph(en), `placeholders changed: ${en}`);
  const window = {}, storage = { getItem: () => "de", setItem() {} };
  const document = { readyState: "complete", documentElement: { dataset: {} }, body: null, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: storage, location: { reload() {} }, Object });
  vm.runInContext(read("src/renderer/locales/de.js"), ctx);
  vm.runInContext(read("src/renderer/i18n.js"), ctx);
  const I = window.I18n;
  assert.equal(I.lang, "de");
  assert.equal(I.tr("Hand in 3 finished quests"), "Gib 3 fertige Quests ab");
  assert.equal(I.tr("Level 21: come back around 29"), "Stufe 21: komm um Stufe 29 wieder");
  assert.equal(I.tr("Secrets of the Dreamers"), null, "number placeholders never take names");
  assert.equal(I.tr("Something nobody wrote"), null);
  // Number slots written as {#0} in the translation are filled too (they showed as "{#0} Halte").
  assert.equal(I.tr("40 stops"), "40 Halte");
  assert.equal(I.tr("about 19,890 yards"), "etwa 19,890 Yards");
  for (const [en] of Object.entries(de.appTemplates)) {
    const sample = en.replace(/\{#\d+\}/g, "7").replace(/\{\d+\}/g, "Name"), out = I.tr(sample);
    if (out !== null) assert.doesNotMatch(out, /\{#?\d+\}/, `a slot is left unfilled: ${en}`);
  }
});

test("one date format across the newer screens, in the shown language (B6)", () => {
  const { I } = i18n();
  const at = new Date(2026, 10, 24, 14, 5).getTime();
  assert.equal(I.when(at, "date"), "24 Nov 2026", "English is written day first, like the app's own sentences");
  assert.equal(I.when(at, "day"), "24 Nov");
  assert.equal(I.when(at, "time"), "14:05");
  assert.equal(I.when(at), "24 Nov 2026, 14:05");
  assert.equal(I.when(new Date(at), "month"), "November 2026");
  assert.match(I.when(at, "longDay"), /^Tuesday,? 24 November 2026$/);
  assert.equal(I.when(NaN), ""); assert.equal(I.when("nonsense"), "");
  assert.equal(I.when(at, "no such kind"), I.when(at));
  const de = i18n({ pref: "de" }).I;
  assert.equal(de.lang, "de"); assert.match(de.when(at, "date"), /^24\. Nov\.? 2026$/);
  // Journey, badges, run history, the ledger and the recipe book all ask the one helper.
  for (const file of ["journey.js", "journey-extras.js", "journey-more.js", "badges.js", "economy.js", "ledger.js", "recipe-book.js"]) {
    const src = read(`src/renderer/${file}`);
    assert.match(src, /window\.I18n\?\.when/, file);
    assert.doesNotMatch(src, /toLocale(Date|Time)String\(/, `${file} formats a date on its own`);
  }
});

test("B10: one small lookup and one text file per language; every entry survives the trip", () => {
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  const toc = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  const files = LANG_CODES.map(languageFile);
  assert.deepEqual(files.slice(0, 3), ["BackstageForeverLocaleDe.lua", "BackstageForeverLocaleEs.lua", "BackstageForeverLocaleFr.lua"]);
  assert.deepEqual(toc.slice(0, 1 + files.length), ["BackstageForeverLocale.lua", ...files], "the lookup loads first, the languages right after it");
  for (const name of ["BackstageForeverLocale.lua", ...files]) assert.ok(ADDON_FILES.includes(name), `the installer owns ${name}`);
  const lookup = read("addon/BackstageForever/BackstageForeverLocale.lua");
  assert.doesNotMatch(lookup, /Abenteuer|Aventura|Aventure/, "no text in the lookup");
  const loadAll = "dofile('addon/BackstageForever/BackstageForeverLocale.lua')" + files.map((n) => ` dofile('addon/BackstageForever/${n}')`).join("");
  for (const lang of LANG_CODES) {
    const d = dictOf(lang), code = (d.gameLocales || GAME_LOCALES[lang])[0];
    const text = read(`addon/BackstageForever/${languageFile(lang)}`);
    assert.doesNotMatch(text, /\r/, `${lang}: no carriage return in the long text`);
    assert.equal((text.match(/BackstageForeverLocaleLoad\(/g) || []).length, 1);
    // Every plain entry, including the ones with tabs, line breaks, backslashes, quotes and brackets.
    const plain = Object.entries(d.addon.plain).filter(([k, v]) => typeof v === "string" && v.trim() && k !== v);
    const lit = (v) => '"' + [...Buffer.from(v, "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
    const out = lua(`GetLocale=function() return '${code}' end\n${loadAll}\nlocal bad,n=0,0\nlocal first\nfor _,row in ipairs({${plain.map(([k, v]) => `{${lit(k)},${lit(v)}}`).join(",")}}) do n=n+1 if BackstageForeverTr(row[1])~=row[2] then bad=bad+1 first=first or row[1] end end\nprint(n,bad,tostring(first),tostring(BackstageForeverTranslated),BackstageForeverLocaleName)`);
    assert.equal(out, `${plain.length}\t0\tnil\ttrue\t${code}`, lang);
    assert.ok(plain.length > 800, `${lang}: ${plain.length} entries`);
  }
  // Another language's file is handed over but never taken apart; a damaged call changes nothing.
  assert.equal(lua(`GetLocale=function() return 'enUS' end\n${loadAll}\nprint(BackstageForeverTr('Adventure Compass'),tostring(BackstageForeverTranslated),tostring(BackstageForeverLocaleLoad({'deDE'},'a\\tb\\n','')),tostring(BackstageForeverLocaleLoad({'enUS'},nil,'')),tostring(BackstageForeverLocaleLoad(nil,'','')))`), "Adventure Compass\tfalse\tfalse\tfalse\tfalse");
  // The escapes: a tab, a line break and a backslash inside a text come back as written.
  assert.equal(lua(`GetLocale=function() return 'xxXX' end\ndofile('addon/BackstageForever/BackstageForeverLocale.lua')\nprint(tostring(BackstageForeverLocaleLoad({'xxXX'},'a\\\\tb\\\\nc\\\\\\\\d\\tx\\\\ty\\n','^(%d+) q$\\t%1 Q\\n')))\nprint(BackstageForeverTr('a\\tb\\nc\\\\d')=='x\\ty',BackstageForeverTr('7 q'))`), "true\ntrue\t7 Q");
  // A language file loaded without the lookup does nothing and does not fail.
  assert.equal(lua(`dofile('addon/BackstageForever/${files[0]}')\nprint(tostring(BackstageForeverTr))`), "nil");
});

"use strict";
// Keeps Help → Commands honest: every /bf command the addon handles is explained there,
// and the page never lists a command the addon does not handle.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { CATALOG, FEATURES, APP } = require("../src/renderer/commands.js");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function handledWords() {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  const slash = hud.slice(hud.indexOf("SlashCmdList.BACKSTAGEFOREVER="));
  const words = new Set();
  for (const m of slash.matchAll(/match\('\^(\w+)/g)) words.add(m[1]);
  for (const m of slash.matchAll(/word=='(\w+)'/g)) words.add(m[1]);
  for (const m of slash.matchAll(/message=='(\w*)'/g)) words.add(m[1]);
  return words;
}

test("every /bf command the addon handles is on the Commands page, and nothing else", () => {
  const handled = handledWords();
  assert.ok(handled.size >= 15, `parsed ${[...handled].join(",")}`);
  const listed = new Set(CATALOG.map((c) => c.word));
  assert.deepEqual([...handled].filter((w) => !listed.has(w)).sort(), [], "missing from the Commands page");
  assert.deepEqual([...listed].filter((w) => !handled.has(w)).sort(), [], "listed but not handled by the addon");
});

test("each entry explains itself in plain words with a usable example", () => {
  const seen = new Set();
  for (const c of CATALOG) {
    assert.ok(!seen.has(c.command), `duplicate ${c.command}`); seen.add(c.command);
    for (const k of ["group", "command", "what", "when", "example"]) assert.ok(typeof c[k] === "string" && c[k].trim(), `${c.command}: ${k}`);
    assert.ok(c.command.startsWith("/bf"), c.command);
    assert.ok(c.example.startsWith(`/bf${c.word ? " " + c.word : ""}`), `${c.command} example ${c.example}`);
    assert.ok(c.what.length <= 260, `${c.command} is too long to scan`);
  }
  for (const f of FEATURES) assert.ok(f.name && f.where && f.what);
  for (const a of APP) assert.ok(a.name && a.what);
});

test("/bf help in game only mentions commands the page explains", () => {
  const assist = read("addon/BackstageForever/BackstageForeverAssist.lua");
  const help = assist.slice(assist.indexOf("if cmd=='help'"), assist.indexOf("for _,l in ipairs(lines)"));
  const words = [...help.matchAll(/'\/bf (\w+)/g)].map((m) => m[1]);
  assert.ok(words.length >= 6);
  const listed = new Set(CATALOG.map((c) => c.word));
  for (const w of words) assert.ok(listed.has(w), `/bf ${w} in game help but not on the Commands page`);
});

test("the Commands page is reachable from Help", () => {
  assert.match(read("src/renderer/player-navigation.js"), /\["commands", "Commands"\]/);
  assert.match(read("src/renderer/app.js"), /commands: CommandsView\.page/);
  const html = read("src/renderer/index.html");
  assert.match(html, /<script src="commands\.js"><\/script>/);
  assert.match(html, /href="commands\.css"/);
});

test("every art file the pages reference ships with the app", () => {
  const referenced = new Set();
  for (const f of ["src/renderer/now.css", "src/renderer/commands.css", "src/renderer/styles.css", "src/renderer/page-hero.css", "src/renderer/command-center.css"]) for (const m of read(f).matchAll(/url\("(art\/[^"]+)"\)/g)) referenced.add(m[1]);
  for (const m of read("src/renderer/commands.js").matchAll(/"([a-z-]+)"/g)) if (fs.existsSync(path.join(root, "src/renderer/art/icons", m[1] + ".png"))) referenced.add(`art/icons/${m[1]}.png`);
  assert.ok(referenced.size >= 10, [...referenced].join(","));
  for (const r of referenced) assert.ok(fs.existsSync(path.join(root, "src/renderer", r)), `missing ${r}`);
  for (const g of new Set(CATALOG.map((c) => c.group))) assert.match(read("src/renderer/commands.js"), new RegExp(`"${g}": "`), `no crest for ${g}`);
});

test("every Now step has its painted crest", () => {
  const now = read("src/renderer/now.js");
  const kinds = [...now.match(/const ICON = \{([^}]*)\}/)[1].matchAll(/"?([a-z-]+)"?:/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 5, kinds.join(","));
  for (const k of kinds) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/steps", k + ".png")), `missing crest ${k}`);
  const wm = read("src/renderer/world-map.js"), pins = /for \(const k of (\[[^\]]+\])\)/.exec(wm.slice(wm.indexOf("const PAINTED")));
  for (const k of JSON.parse(pins[1])) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/pins", k + ".png")), `missing map pin art ${k}`);
  for (const b of require("../src/core/badges.cjs").BADGES) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/badges", b.id + ".png")), `missing badge art ${b.id}`);
  const biomes = new Set([...(now + read("src/renderer/zone-art.js")).matchAll(/\d+: "([a-z]+)"/g)].map((m) => m[1]));
  assert.ok(biomes.has("warcamp") && biomes.has("citadel"), "capital cities have vistas");
  for (const b of biomes) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/zones", b + ".webp")), `missing vista ${b}`);
});

test("every page banner has its painting, layered over a fallback, and the companion has its crest", () => {
  const css = read("src/renderer/page-hero.css");
  global.window = {}; eval(read("src/renderer/page-hero.js")); const { ART } = window.PageHero; delete global.window;
  for (const key of ART) {
    const rule = new RegExp(`\.ph-art-${key}::before \{ background-image: ([^;]+);`).exec(css);
    assert.ok(rule, `no banner rule for ${key}`);
    const urls = [...rule[1].matchAll(/url\("(art\/[^"]+)"\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 1, key);
    for (const u of urls) assert.ok(fs.existsSync(path.join(root, "src/renderer", u)), `missing ${u}`);
    if (!["now", "settings"].includes(key)) assert.deepEqual(urls, [`art/heroes/${key}.webp`, "art/hero-help.webp"], `${key} paints its own hero over the fallback`);
  }
  assert.ok(fs.existsSync(path.join(root, "src/renderer/art/pins/companion.png")), "companion crest");
  assert.match(read("src/renderer/free-ai.css"), /art\/pins\/companion\.png/, "the companion page uses its own crest");
  assert.match(read("src/renderer/index.html"), /href="page-hero\.css"/); assert.match(read("src/renderer/index.html"), /src="page-hero\.js"/);
});

test("quest how-to steps and coverage meters use art that exists and fits", () => {
  const how = JSON.parse(read("src/renderer/quest-guide.js").match(/const HOW_ICON = (\{[^}]*\})/)[1].replace(/(\w+|"[^"]+"):/g, (m, k) => `"${k.replace(/"/g, "")}":`));
  for (const v of Object.values(how)) assert.ok(fs.existsSync(path.join(root, "src/renderer/art", v + ".png")), v);
  assert.notEqual(how.item, how["turn-in"], "collecting an item is not a hand-in");
  const cov = [...read("src/renderer/coverage.js").matchAll(/\["(\w+)", "[^"]+", "([a-z/-]+)", \d+\]/g)];
  assert.ok(cov.length >= 6);
  for (const [, , art] of cov) assert.ok(fs.existsSync(path.join(root, "src/renderer/art", art + ".png")), art);
  const by = Object.fromEntries(cov.map(([, k, a]) => [k, a]));
  assert.equal(by.professionTrainers, "pins/profession-trainer"); assert.equal(by.questGivers, "pins/quest-giver");
});

test("every class has its crest", () => {
  for (const c of ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/classes", c + ".png")), c);
});

test("Help → Commands explains the loot browser, the wish list and hover cards", () => {
  const app = APP.map((a) => `${a.name} ${a.what}`).join("\n");
  assert.match(app, /Loot/); assert.match(app, /wish list/); assert.match(app, /Upgrade for you/);
  assert.match(app, /Hover cards/); assert.match(app, /an item or an NPC/);
});

test("Help → Commands lists the live strip placement and safe/compact modes the addon accepts", () => {
  const live = CATALOG.filter((c) => c.word === "live").map((c) => c.command);
  assert.ok(live.includes("/bf live pos topleft|topright|bottomleft|bottomright"), live.join(" / "));
  assert.ok(live.includes("/bf live safe|compact"), live.join(" / "));
  const addon = read("addon/BackstageForever/BackstageForeverLive.lua");
  const parse = addon.slice(addon.indexOf("function BackstageForeverLiveParse"), addon.indexOf("function BackstageForeverLiveCommand"));
  for (const w of ["pos", "safe", "compact"]) assert.match(parse, new RegExp(`'${w}'`), `addon parses /bf live ${w}`);
  for (const corner of ["topleft", "topright", "bottomleft", "bottomright"]) assert.match(addon, new RegExp(`${corner}='[A-Z]+'`), corner);
});

test("live link status shows the strip's mode, placement and the remote desktop tip", () => {
  const vm = require("node:vm");
  const c = { window: {}, document: { querySelectorAll: () => [], addEventListener() {} }, setInterval() {} };
  vm.createContext(c);
  vm.runInContext(read("src/renderer/live-link.js"), c);
  const L = c.window.LiveLink;
  assert.equal(L.stripLine({ enabled: true, strip: { mode: "compact", corner: "topright", width: 84, height: 4, idle: false } }), "Mode: Compact · Placement: top-right · 84×4 px");
  assert.equal(L.stripLine({ enabled: true, strip: { mode: "safe", corner: "bottomleft", width: 456, height: 12, idle: true } }), "Mode: Safe · Placement: bottom-left · 456×12 px · idle (nothing changing)");
  assert.equal(L.stripLine({ enabled: false, strip: { mode: "compact", corner: "topleft", width: 84, height: 4 } }), "");
  assert.match(L.markup(), /Type \/bf live safe if the link drops over remote desktop\./);
  assert.match(read("src/renderer/now.js"), /Type <code>\/bf live safe<\/code> if the link drops over remote desktop/);
  assert.match(read("src/renderer/now.js"), /sig === "compact-unreadable"/);
});

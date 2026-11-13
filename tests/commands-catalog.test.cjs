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
  for (const f of ["src/renderer/now.css", "src/renderer/commands.css", "src/renderer/styles.css"]) for (const m of read(f).matchAll(/url\("(art\/[^"]+)"\)/g)) referenced.add(m[1]);
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

test("every class has its crest", () => {
  for (const c of ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/classes", c + ".png")), c);
});

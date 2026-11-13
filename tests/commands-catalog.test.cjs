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

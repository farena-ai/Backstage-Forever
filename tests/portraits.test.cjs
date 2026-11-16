"use strict";
// Character portraits matched on race, sex and class (0.58).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
function hero(list) {
  const window = { BF_PORTRAITS: list }, ctx = vm.createContext({ window });
  vm.runInContext(fs.readFileSync(path.join(root, "src/renderer/page-hero.js"), "utf8"), ctx);
  return window.PageHero;
}

test("the most specific shipped portrait wins: race+sex+class, then race+sex, then class+sex, then the class crest", () => {
  const H = hero(["undead-female-priest", "undead-male", "priest-female", "mage-male"]);
  const rolica = { name: "Rolica", race: "Undead", sex: "female", className: "Priest", faction: "Horde" };
  assert.equal(H.portrait(rolica), "art/portraits/undead-female-priest.webp", "Rolica is a female undead priest");
  assert.equal(H.portrait({ ...rolica, race: "Forsaken" }), "art/portraits/undead-female-priest.webp", "Forsaken is the same race");
  assert.equal(H.portrait({ ...rolica, sex: "male" }), "art/portraits/undead-male.webp");
  assert.equal(H.portrait({ ...rolica, race: "Troll" }), "art/portraits/priest-female.webp");
  assert.equal(H.portrait({ race: "Troll", sex: "male", className: "Priest" }), "art/classes/priest.png", "no troll or male-priest painting yet: the crest");
  assert.equal(H.portrait({ race: "Undead", className: "Priest" }), "art/classes/priest.png", "unknown sex never guesses one");
  assert.equal(H.portrait("Mage"), "art/classes/mage.png", "a class name alone still works");
  assert.equal(H.portrait({ race: "Undead", sex: "female", className: "Paladin\"><img" }), "", "unknown classes give no art, never markup");
});

test("the portrait list matches the paintings that ship, and every listed file exists", () => {
  const r = spawnSync(process.execPath, ["scripts/build-portraits.cjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { list } = require("../scripts/build-portraits.cjs");
  for (const key of list()) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/portraits", key + ".webp")));
  assert.match(fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8"), /<script src="portraits\.js"><\/script><script src="page-hero\.js"><\/script>/);
});

test("every dungeon and raid in the atlas has its own painting, credited in the art notice", () => {
  const { BASELINE } = require("../src/core/dungeon-atlas.cjs");
  const atlas = fs.readFileSync(path.join(root, "src/renderer/dungeon-atlas.js"), "utf8");
  const listed = JSON.parse(atlas.match(/const ART = new Set\((\[[^\]]+\])\)/)[1]);
  assert.deepEqual([...listed].sort(), BASELINE.map((r) => r[0]).sort());
  for (const id of listed) {
    const file = path.join(root, "src/renderer/art/dungeons", id + ".webp");
    assert.ok(fs.existsSync(file), id);
    assert.ok(fs.statSync(file).size < 200 * 1024, `${id} stays small`);
  }
  const notice = fs.readFileSync(path.join(root, "src/renderer/art/NOTICE.md"), "utf8");
  assert.match(notice, /`dungeons\/\*\.webp`.*local(?:ly)? with ComfyUI/);
  assert.match(notice, /`portraits\/\*\.webp`.*local(?:ly)? with ComfyUI/);
});

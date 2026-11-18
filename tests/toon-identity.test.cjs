"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const renderer = path.join(__dirname, "../src/renderer");
const source = (file) => fs.readFileSync(path.join(renderer, file), "utf8");
function load(keys) {
  const window = {}, ctx = vm.createContext({ window });
  vm.runInContext(source("portraits.js"), ctx);
  if (keys) window.BF_PORTRAITS = keys;
  vm.runInContext(source("page-hero.js"), ctx);
  return window.PageHero;
}
const priest = { race: "Forsaken", sex: "Female", className: "Priest", faction: "Horde" };

test("every combination in the shipped portrait manifest renders matched archetype art", () => {
  const hero = load();
  const set = require("../scripts/build-portraits.cjs").list();
  assert.equal(set.length, 112);
  for (const key of set) {
    const [race, sex, className] = key.split("-");
    const art = `art/portraits/${key}.webp`;
    assert.equal(hero.portrait({ race, sex, className }), art, key);
    assert.ok(hero.render({ character: { race, sex, className } }).includes(`src="${art}"`), key);
  }
});

test("a known toon gets original race/sex/class art identified as an archetype, not a likeness", () => {
  const hero = load();
  const html = hero.render({ art: "characters", title: "Rolica", character: priest });
  assert.match(html, /data-ph-faction="horde"/);
  assert.match(html, /undead-female-priest\.webp/);
  assert.match(html, /art\/classes\/priest\.png/);
  for (const text of ["Horde", "Forsaken", "Female", "Priest", "Archetype art — not your exact face or gear"]) assert.ok(html.includes(text), text);
  assert.equal(hero.portrait(priest), "art/portraits/undead-female-priest.webp");
});

test("unknown sex, unsupported tuples, or custom classes don't borrow a different character portrait", () => {
  const hero = load();
  for (const character of [{ race: "Orc", sex: "female", className: "Priest" }, { ...priest, sex: "unknown" }]) {
    const html = hero.render({ character });
    assert.match(html, /Class crest — no matching portrait/);
    assert.match(html, /art\/classes\/priest\.png/);
    assert.doesNotMatch(html, /art\/portraits\//);
  }
  const html = hero.render({ character: { race: "<script>", className: 'Custom <Mage>', sex: "unknown", faction: "neutral" } });
  assert.match(html, /data-ph-faction="neutral"/);
  assert.match(html, /Journal seal — no matching portrait/);
  assert.match(html, /Custom &lt;Mage&gt;/);
  assert.doesNotMatch(html, /<script>|art\/portraits\//);
});

test("partial art stays compatible for path consumers, without substituting a different class/race on identity heroes", () => {
  const hero = load(["undead-female", "priest-female"]);
  assert.equal(hero.portrait(priest), "art/portraits/undead-female.webp");
  assert.match(hero.render({ character: priest }), /Class crest — no matching portrait/);
  const html = hero.render({ crest: hero.portrait(priest) });
  assert.match(html, /Race archetype art/);
  assert.match(html, /not your exact face or gear/);
});

test("existing Adventure/Characters crest calls gain honest labels; crestHtml keeps precedence", () => {
  const hero = load();
  const legacy = hero.render({ art: "adventure", crest: hero.portrait(priest) });
  assert.match(legacy, /Forsaken/);
  assert.match(legacy, /Archetype art/);
  assert.match(hero.render({ art: "characters", crest: hero.classCrest("Priest") }), /Class crest/);
  assert.doesNotMatch(hero.render({ art: "badges", crest: hero.classCrest("Priest") }), /ph-identity/);
  assert.match(hero.render({ art: "now", crestHtml: '<img data-now-crest alt="">', character: priest }), /data-now-crest/);
  assert.match(hero.render({ character: priest, motion: false }), /data-ph-motion="off"/);
});

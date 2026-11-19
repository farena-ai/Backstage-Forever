"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(require.resolve("../src/renderer/talents.js"), "utf8");
const window = {};
const controls = { frostbolt: { checked: false }, iceLance: { checked: false } };
const result = { innerHTML: "" };
const panel = { querySelector(selector) {
  if (selector === "[data-academy-result]") return result;
  return controls[selector.match(/="(\w+)"/)?.[1]];
} };
vm.runInNewContext(source, { window, document: { querySelector: selector => selector === "[data-academy-dps]" ? panel : null } });
const view = window.TalentsView;
const mage = { id: "mage", className: "Mage", level: 23, clientBuild: "1.60.1.70959", source: { kind: "wow-addon", id: "mage-source", updatedAt: "2026-11-19T09:00:00Z" } };

test("only the selected, matching addon Mage save can open the rank checklist", () => {
  for (const level of [23, 24, 25]) {
    const markup = view.academy({ ...mage, level });
    assert.match(markup, /Frostbolt, Rank 4/);
    assert.match(markup, /Ice Lance, Rank 1/);
    assert.match(markup, /1\.60\.1\.70959/);
    assert.doesNotMatch(markup, /Opener|Single-target priority| checked(?:\s|>)/);
  }
  for (const p of [null, { ...mage, source: null }, { ...mage, source: { ...mage.source, kind: "manual" } },
    { ...mage, clientBuild: undefined }, { ...mage, clientBuild: "1.60.1.70888" },
    { ...mage, clientBuild: "1.60.1.70959 " }, { ...mage, level: 22 }, { ...mage, level: 26 },
    { ...mage, className: "Warlock" }]) {
    assert.doesNotMatch(view.academy(p), /data-academy-rank|Opener|Single-target priority/);
  }
});

test("the guide is withheld until both exact ranks are self-confirmed and is removed if either is cleared", () => {
  view.mounted();
  for (const [frostbolt, iceLance] of [[false, false], [true, false], [false, true], [true, true], [false, true]]) {
    controls.frostbolt.checked = frostbolt;
    controls.iceLance.checked = iceLance;
    panel.onchange();
    if (frostbolt && iceLance) {
      assert.match(result.innerHTML, /Opener/);
      assert.match(result.innerHTML, /Single-target priority/);
      assert.match(result.innerHTML, /mana/i);
      assert.match(result.innerHTML, /shared cooldown/i);
      assert.match(result.innerHTML, /19 Nov 2026/);
      assert.doesNotMatch(result.innerHTML, /triple|best DPS|guaranteed/i);
    } else assert.equal(result.innerHTML, "");
  }
});

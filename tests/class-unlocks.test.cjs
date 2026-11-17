"use strict";
// 1.3 (J9): class quests and key unlocks.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { classUnlocks, UNLOCKS, ALL_CLASSES } = require("../src/core/class-unlocks.cjs");

test("every class has unlocks in level order, each with what and how", () => {
  assert.deepEqual([...ALL_CLASSES].sort(), ["Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"]);
  for (const [cls, rows] of Object.entries(UNLOCKS)) {
    assert.ok(rows.length >= 2, cls);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].level >= rows[i - 1].level, `${cls} in level order`);
    for (const r of rows) { assert.ok(r.what && r.how && ["quest", "train"].includes(r.kind), `${cls} ${r.what}`); assert.ok(r.how.length <= 200); }
  }
});

test("past, now and later around the character's level", () => {
  const u = classUnlocks("Shaman", 11);
  assert.deepEqual(u.rows.map((r) => r.state), ["past", "now", "later", "later", "later"]);
  assert.equal(u.next.level, 20);
  assert.equal(classUnlocks("Nobody", 10), null);
});

test("the Talents page shows the unlocks even without talent trees", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  assert.match(main, /return \{ available: false, unlocks,/);
  const page = fs.readFileSync(path.join(__dirname, "../src/renderer/talents.js"), "utf8");
  assert.match(page, /if \(!data\.available\) return unlocksCard\(data\.unlocks\)/);
  assert.match(page, /Class quests and key unlocks/);
});

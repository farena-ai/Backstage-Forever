"use strict";
// G12 review (0.54): "Pick these up first" only lists quests near the dungeon's own levels.
const test = require("node:test"), assert = require("node:assert/strict");
const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");

test("a quest that only mentions the dungeon at the wrong level is not a pick-up", () => {
  const quest = (id, title, level) => ({ id, title, level, minLevel: level, objectiveEvidence: "", objectives: [], givers: [] });
  const knowledgePack = { quests: { 1: quest(1, "Into the Sunken Temple", 51), 2: quest(2, "Camping 101: the Sunken Temple lore", 6), 3: quest(3, "Sunken Temple holiday treats", 60) }, npcs: {}, creatures: {} };
  const profile = { level: 50, faction: "Horde", quests: [], history: { completedIds: [] } };
  const temple = buildAtlas({ profile, knowledgePack }).entries.find((e) => e.name === "Sunken Temple");
  assert.deepEqual(temple.pickUp.map((q) => q.id), [1]);
});

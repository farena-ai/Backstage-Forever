"use strict";
// Synthetic rows with the bundled build's exact pinned metadata (current commit/build).
const { COMMIT: commit, BUILD: build, SOURCES } = require("../../src/core/insights-sources.cjs");
function fixture() {
  const out = {};
  for (const file of [
    "quests.enUS.json",
    "quest_scan.json",
    "trainers.json",
    "npcs.json",
    "creatures.json",
    "creature_details.enUS.json",
    "item_hotfixes.enUS.json",
  ]) {
    out[file] = {
      meta: structuredClone(
        SOURCES.find((s) => s.build === build && s.name === file).meta,
      ),
    };
  }
  out["quests.enUS.json"].quests = {
    10: {
      title: "Synthetic Errand",
      sources: 2,
      startItemId: 20,
      timeLimitSeconds: 60,
      itemDrops: [{ itemId: 21, count: 2 }],
      description: "PRIVATE_NARRATIVE",
      raceMask: "ffff",
    },
    11: { title: "Unknown Sharing", sources: 1 },
  };
  Object.assign(out["quest_scan.json"], {
    described: { 10: { title: "Synthetic Errand", sources: 3 } },
    pushable: { 10: { true: 2, false: 1 } },
    noData: [],
    frequency: {},
    repeatable: {},
  });
  out["trainers.json"].trainers = {
    30: {
      name: "Synthetic Mentor",
      lastSeen: "2026-11-09",
      trainerType: 0,
      sources: 2,
      positions: [{ uiMap: 1, mapX: 0.25, mapY: 0.5 }],
      services: {
        40: {
          spellId: 40,
          name: "Synthetic Spell",
          rankText: "Rank 1",
          level: 20,
          skillRank: 0,
          sources: 1,
          abilities: ["UNVERIFIED_ABILITY"],
          costs: { 1: 100 },
        },
        41: {
          spellId: 41,
          name: "Unknown Requirement",
          level: 0,
          skillRank: 0,
          sources: 2,
        },
      },
    },
  };
  out["npcs.json"].npcs = {
    30: { name: "Synthetic Mentor", interactions: ["Trainer"], sources: 3 },
  };
  out["creatures.json"].creatures = {
    30: { name: "Synthetic Mentor", reactions: { Horde: [4, 5] }, sources: 2 },
  };
  out["creature_details.enUS.json"].creatures = {
    30: { name: "Synthetic Mentor", title: "Mage Trainer", sources: 1 },
  };
  out["item_hotfixes.enUS.json"].items = {
    20: {
      status: "valid",
      name: "Synthetic Starter",
      sources: 1,
      description: "PRIVATE_ITEM_NARRATIVE",
    },
    21: { status: "invalid", name: "Invalid Name", sources: 1 },
  };
  return out;
}
module.exports = { fixture, commit, build };

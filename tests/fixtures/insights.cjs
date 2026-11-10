"use strict";
const commit = "23f9636486d3d60479dc0bcee2356053c33faf2c",
  build = "1.60.1.70862";
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
    const cache = file.includes(".enUS"),
      dataset = file.split(".")[0];
    out[file] = {
      meta: {
        attribution:
          "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
        ...(cache
          ? {
              cacheFiles: dataset === "item_hotfixes" ? 66 : 68,
              cachesLeftOut: 0,
            }
          : {}),
        clientBuild: build,
        collectedOn: {
          first: cache || dataset === "creatures" ? "2026-11-07" : "2026-11-09",
          last: "2026-11-09",
        },
        ...(dataset === "creatures" ? { combatLogUploads: 7 } : {}),
        dataset,
        license: "CC BY 4.0",
        ...(cache ? { locale: "enUS" } : {}),
        product: "wowf",
        schemaVersion: 1,
        sources: 3,
      },
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

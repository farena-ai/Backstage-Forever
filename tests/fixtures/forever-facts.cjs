// Small factual/synthetic fixtures only. Publisher facts: data/forever/NOTICE (CC BY 4.0).
const { FILES, ATTRIBUTION } = require("../../src/core/knowledge.cjs");
const build = "1.60.1.70862",
  commit = "156f29c9af78b1586883e8eb94a13467eb89638c";
function fixture() {
  const pack = require("../../data/forever/pack.json");
  const raw = Object.fromEntries(
    FILES.map((name) => [
      name,
      {
        meta: {
          dataset: name.split(".")[0],
          product: "wowf",
          clientBuild: build,
          schemaVersion: 1,
          license: "CC BY 4.0",
          attribution: ATTRIBUTION,
          sources: 3,
          collectedOn: { first: "2026-11-07", last: "2026-11-08" },
          ...(name.includes(".enUS.") ? { locale: "enUS" } : {}),
        },
      },
    ]),
  );
  const ids = [1, 1061, 1062, 5727, 5728, 5729, 5730, 98024, 854];
  raw["quests.enUS.json"].quests = Object.fromEntries(
    ids.map((id) => {
      const q = pack.quests[id];
      return [
        id,
        {
          title: q.title,
          sources: q.sources,
          ...(q.level !== undefined ? { level: q.level } : {}),
          ...(q.minLevel !== undefined ? { minLevel: q.minLevel } : {}),
          ...(q.nextQuestId ? { nextQuestId: q.nextQuestId } : {}),
          raceMask: q.raceMask,
          objectivesText: q.objectiveEvidence,
          objectives: q.objectives.map((o) => ({
            storageIndex: o.index - 1,
            type: o.type,
            amount: o.required,
            objectId: o.objectId,
          })),
          rewards: {
            items: q.rewards.items,
            choices: q.rewards.choices,
            money: q.rewards.moneyCopper,
          },
        },
      ];
    }),
  );
  raw["npcs.json"].npcs = {};
  raw["npcs.json"].objects = {};
  raw["npcs.json"].approached = {};
  for (const id of [3216, 4949, 3429, 4049]) {
    const n = pack.npcs[`npc:${id}`];
    raw["npcs.json"].npcs[id] = {
      name: n.name,
      sources: n.sources,
      side: n.side,
      lastSeen: n.lastSeen,
      positions: n.positions.map((p) => ({
        uiMap: p.mapId,
        mapX: p.x,
        mapY: p.y,
      })),
      offers: {},
      takes: {},
    };
    for (const qid of ids)
      for (const [input, output] of [
        ["offers", "givers"],
        ["takes", "turnIns"],
      ])
        if (
          pack.quests[qid][output].some((r) => r.id === id && r.kind === "npc")
        )
          raw["npcs.json"].npcs[id][input][qid] = {
            title: pack.quests[qid].title,
          };
  }
  raw["creature_details.enUS.json"].creatures = {
    3429: { name: "Thork", sources: 2 },
  };
  raw["item_hotfixes.enUS.json"].items = {};
  for (const r of pack.quests[5730].rewards.choices)
    raw["item_hotfixes.enUS.json"].items[r.itemId] = {
      status: "valid",
      name: r.name,
      sources: 1,
    };
  raw["turn_ins.json"].quests = { 1061: [{ level: 20, xp: 100, sources: 1 }] };
  raw["turn_ins.json"].withLegacy = {};
  raw["objectives.json"].quests = {
    1062: {
      1: {
        type: "monster",
        required: 15,
        gains: 2,
        sources: 1,
        positions: [{ uiMap: 1413, mapX: 0.4, mapY: 0.5 }],
      },
    },
  };
  raw["objectives.json"].completed = {};
  raw["objectives.json"].failed = {};
  raw["objectives.json"].gossip = {};
  return raw;
}
module.exports = { fixture, build, commit };

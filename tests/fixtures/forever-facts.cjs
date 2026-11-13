// Small factual/synthetic fixtures only. Publisher facts: data/forever/NOTICE (CC BY 4.0).
const { FILES, ATTRIBUTION } = require("../../src/core/knowledge.cjs");
const build = "1.60.1.70862",
  commit = "156f29c9af78b1586883e8eb94a13467eb89638c";
// Frozen subset of the original single-build reference (commit 23f96364, build 1.60.1.70862),
// so these fixtures do not drift when the bundled multi-build pack is refreshed.
const SNAPSHOT = {"quests":{"1":{"id":1,"title":"The \"Chow\" Quest (123)aa","sources":2,"observedInPlay":false,"givers":[],"turnIns":[],"objectiveLocations":[],"mentions":[],"rewards":{"items":[],"choices":[]},"level":4,"minLevel":1,"raceMask":"ffffffffffffffff","objectiveEvidence":"Kill Kobold Vermin, 2 of em.","objectives":[]},"854":{"id":854,"title":"Journey to the Crossroads","sources":1,"observedInPlay":false,"givers":[],"turnIns":[],"objectiveLocations":[],"mentions":[{"id":3429,"kind":"npc","relationship":"mentioned-in-objective"}],"rewards":{"items":[],"choices":[]},"level":12,"minLevel":9,"raceMask":"0000000000000020","objectiveEvidence":"Speak with Thork at the Crossroads in the Barrens.","objectives":[]},"1061":{"id":1061,"title":"The Spirits of Stonetalon","sources":3,"observedInPlay":true,"givers":[{"id":4047,"kind":"npc"}],"turnIns":[{"id":4049,"kind":"npc"}],"objectiveLocations":[],"mentions":[{"id":4049,"kind":"npc","relationship":"mentioned-in-objective"}],"rewards":{"items":[],"choices":[]},"level":17,"minLevel":13,"nextQuestId":1062,"raceMask":"ffffffffffffffff","objectiveEvidence":"Speak with Seereth Stonebreak in the Stonetalon Mountains.","objectives":[],"sides":["Horde"],"observedXP":[{"level":15,"xp":320,"sources":1}]},"1062":{"id":1062,"title":"Goblin Invaders","sources":3,"observedInPlay":true,"givers":[{"id":4049,"kind":"npc"}],"turnIns":[],"objectiveLocations":[],"mentions":[],"rewards":{"items":[],"choices":[],"moneyCopper":1100},"level":19,"minLevel":13,"raceMask":"ffffffffffffffff","objectiveEvidence":"Kill 15 Venture Co. Loggers, then return to Seereth Stonebreak on the border of Stonetalon and the Barrens.","objectives":[{"index":1,"type":"monster","required":15,"objectId":3989}],"sides":["Horde"]},"5727":{"id":5727,"title":"Hidden Enemies","sources":1,"observedInPlay":true,"givers":[{"id":4949,"kind":"npc"}],"turnIns":[{"id":4949,"kind":"npc"}],"objectiveLocations":[{"index":1,"type":"monster","required":1,"gains":2,"sources":1,"positions":[{"mapId":1454,"x":0.4961,"y":0.5052}]}],"mentions":[],"rewards":{"items":[],"choices":[]},"level":12,"minLevel":9,"nextQuestId":5728,"raceMask":"ffffffffffffffff","objectiveEvidence":"Take the Lieutenant's Insignia to Neeru Fireblade and speak to him. Gauge if he believes you are a member of the Burning Blade and then return to Thrall in Orgrimmar.","objectives":[{"index":1,"type":"monster","required":1,"objectId":3216,"text":"Gauge Neeru Fireblade's reaction"}],"sides":["Horde"],"observedXP":[{"level":12,"xp":460,"sources":1},{"level":12,"xp":460,"sources":1}]},"5728":{"id":5728,"title":"Hidden Enemies","sources":3,"observedInPlay":true,"givers":[{"id":4949,"kind":"npc"}],"turnIns":[{"id":4949,"kind":"npc"}],"objectiveLocations":[{"index":1,"type":"monster","required":1,"gains":1,"sources":1,"positions":[]},{"index":2,"type":"monster","required":1,"gains":1,"sources":1,"positions":[]}],"mentions":[],"rewards":{"items":[],"choices":[],"moneyCopper":800},"level":16,"minLevel":9,"nextQuestId":5729,"raceMask":"ffffffffffffffff","objectiveEvidence":"Kill Bazzalan and Jergosh the Invoker before returning to Thrall in Orgrimmar.","objectives":[{"index":1,"type":"monster","required":1,"objectId":11519},{"index":2,"type":"monster","required":1,"objectId":11518}],"sides":["Horde"],"observedXP":[{"level":15,"xp":2350,"sources":1}]},"5729":{"id":5729,"title":"Hidden Enemies","sources":1,"observedInPlay":true,"givers":[{"id":4949,"kind":"npc"}],"turnIns":[{"id":3216,"kind":"npc"}],"objectiveLocations":[],"mentions":[{"id":3216,"kind":"npc","relationship":"mentioned-in-objective"}],"rewards":{"items":[],"choices":[]},"level":15,"minLevel":9,"nextQuestId":5730,"raceMask":"ffffffffffffffff","objectiveEvidence":"Speak to Neeru Fireblade in Orgrimmar.","objectives":[],"sides":["Horde"],"observedXP":[{"level":15,"xp":110,"sources":1}]},"5730":{"id":5730,"title":"Hidden Enemies","sources":1,"observedInPlay":true,"givers":[{"id":3216,"kind":"npc"}],"turnIns":[{"id":4949,"kind":"npc"}],"objectiveLocations":[],"mentions":[{"id":4949,"kind":"npc","relationship":"mentioned-in-objective"}],"rewards":{"items":[],"choices":[{"itemId":15443,"count":1,"name":"Kris of Orgrimmar"},{"itemId":15445,"count":1,"name":"Hammer of Orgrimmar"},{"itemId":15424,"count":1,"name":"Axe of Orgrimmar"},{"itemId":15444,"count":1,"name":"Staff of Orgrimmar"}]},"level":16,"minLevel":9,"raceMask":"ffffffffffffffff","objectiveEvidence":"Speak to Thrall in Orgrimmar and tell him what you've learned.","objectives":[],"sides":["Horde"],"observedXP":[{"level":15,"xp":1450,"sources":1}]},"98024":{"id":98024,"title":"Journey to the Crossroads","sources":2,"observedInPlay":false,"givers":[],"turnIns":[],"objectiveLocations":[],"mentions":[{"id":3429,"kind":"npc","relationship":"mentioned-in-objective"}],"rewards":{"items":[],"choices":[],"moneyCopper":300},"level":13,"minLevel":7,"raceMask":"0000000200000000","objectiveEvidence":"Report To Thork at The Crossroads in The Barrens.","objectives":[]}},"npcs":{"npc:3216":{"id":3216,"kind":"npc","name":"Neeru Fireblade","sources":1,"positions":[{"mapId":1454,"x":0.4975,"y":0.5054}],"lastSeen":"2026-11-07","side":"Horde"},"npc:4949":{"id":4949,"kind":"npc","name":"Thrall","sources":1,"positions":[{"mapId":1454,"x":0.3202,"y":0.378}],"lastSeen":"2026-11-07","side":"Horde"},"npc:3429":{"id":3429,"kind":"npc","name":"Thork","sources":3,"positions":[{"mapId":1413,"x":0.5154,"y":0.3089},{"mapId":1413,"x":0.5152,"y":0.3082}],"lastSeen":"2026-11-08","side":"Horde"},"npc:4049":{"id":4049,"kind":"npc","name":"Seereth Stonebreak","sources":1,"positions":[{"mapId":1413,"x":0.3528,"y":0.2786}],"lastSeen":"2026-11-07","side":"Horde"}}};
function fixture() {
  const pack = SNAPSHOT;
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

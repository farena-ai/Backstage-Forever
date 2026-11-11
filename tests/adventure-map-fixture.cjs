"use strict";
const { defaultState } = require("../src/core/validation.cjs");
const at = "2026-11-11T12:00:00.000Z",
  col = (items) => ({ observedAt: at, complete: true, items });
function seed() {
  return {
    ...defaultState(),
    onboarded: true,
    activeProfileId: "p",
    profiles: [
      {
        id: "p",
        name: "Aeralyn",
        realm: "Fictional",
        className: "Hunter",
        level: 12,
        faction: "Alliance",
        notes: "PRIVATE_NOTES",
        goals: [],
        source: {
          kind: "wow-addon",
          id: "PRIVATE_GUID_PRIVATE_SOURCE_ID_PRIVATE_PATH",
          updatedAt: at,
        },
        clientBuild: "1.60.1.70862",
        location: { mapId: 1411, zone: "Saved fictional coast", x: 0, y: 0.4 },
        quests: [
          {
            id: 1,
            title: "A saved errand",
            complete: false,
            objectives: [{ text: "Explore", done: false }],
            destination: { mapId: 1411, x: 0.2, y: 0.3 },
          },
        ],
        gathering: {
          schemaVersion: 1,
          status: "available",
          recording: true,
          observedAt: at,
          limited: false,
          totalRecords: 1,
          records: [
            {
              id: "wowf:mining:1731:1411:5027:4874:1.60.1.70862",
              method: "mining",
              entityId: 1731,
              itemIds: [2770, 2835],
              mapId: 1411,
              x: 0.5027,
              y: 0.4874,
              observedAt: at,
              clientBuild: "1.60.1.70862",
              name: "Recorded copper interaction",
              evidence: "observed-gathering-loot",
              precision: "recorded-standing-point",
              approximate: true,
            },
          ],
        },
        readiness: {
          workshop: {
            professions: col([
              {
                skillLineId: 186,
                professionId: 1,
                name: "Mining",
                rank: 20,
                maxRank: 75,
              },
            ]),
            recipes: col([]),
            materials: { ...col([]), scope: "bags-0-4" },
          },
        },
      },
    ],
  };
}
// Raw fictional addon export for source and copied-package acceptance gates.
function capture(now = Math.floor(Date.now() / 1000), faction = "Alliance") {
  const p = seed().profiles[0],
    id = "Synthetic-Map-" + faction;
  const workshop = structuredClone(p.readiness.workshop);
  for (const collection of Object.values(workshop)) collection.observedAt = now;
  const gathering = structuredClone(p.gathering);
  gathering.observedAt = now;
  for (const record of gathering.records) record.observedAt = now;
  return {
    schema: 1,
    observedAt: now,
    activeId: id,
    characters: [
      {
        id,
        name: faction === "Horde" ? "Vaelric" : "Aeralyn",
        realm: p.realm,
        className: faction === "Horde" ? "Mage" : "Hunter",
        level: p.level,
        faction,
        updatedAt: now,
        clientBuild: p.clientBuild,
        captureVersion: require("../package.json").version,
        locale: "enUS",
        location: { ...p.location, subZone: "" },
        quests: p.quests,
        readiness: { workshop },
        gathering,
      },
    ],
  };
}
module.exports = { seed, capture, at, col };

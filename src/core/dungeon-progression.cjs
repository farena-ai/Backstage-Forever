"use strict";
const { normalizeEncounterHistory, savedSource } = require("./journal-data.cjs");

// Exact quest and gear relations: docs/LIVE-D03-DUNGEON-PROGRESSION.md.
const QUEST_BUILDS = new Set(["1.60.1.70862", "1.60.1.70888"]);
const INSTANCE_MAP = 36;
const DISPLAY_LIMIT = 5;
const QUESTS = [
  { id: 166, title: "The Defias Brotherhood" },
  { id: 2040, title: "Underground Assault" },
];
const GEAR_BUILD = "1.60.1.70862";
const GEAR_GOAL = { itemId: 5202, name: "Corsair's Overshirt", sourceName: "Edwin VanCleef" };

function dungeonProgression(instanceId, profile, wished = [], now = Date.now()) {
  if (instanceId !== "dm") return null;
  const source = savedSource(profile);
  const savedAt = Date.parse(source?.updatedAt);
  if (!(savedAt <= now)) return { status: "unavailable", reason: "A dated addon save is required to see this character’s progression." };
  const { clientBuild } = profile;
  if (!QUEST_BUILDS.has(clientBuild)) return { status: "unavailable", reason: "No Deadmines progression review matches this character’s saved build." };

  let retained = [];
  try {
    retained = normalizeEncounterHistory(profile.journal?.encounters)
      .filter(row => row.instanceMap === INSTANCE_MAP && row.instanceType === "party" && row.at * 1000 <= savedAt)
      .sort((a, b) => b.at - a.at);
  } catch { /* A malformed optional block is unavailable, not proof of zero defeats. */ }

  return {
    status: "available", clientBuild, savedAt: source.updatedAt,
    owner: { profileId: profile.id, sourceId: source.id },
    // A retained row has its own event time but no capture build. Do not attach the save's build to it.
    defeats: { captureBuild: null, moreRetained: retained.length > DISPLAY_LIMIT,
      rows: retained.slice(0, DISPLAY_LIMIT).map(({ name, encounterId, at }) => ({ name, encounterId, at })) },
    quests: QUESTS.filter(row => profile.quests?.some(q => q.id === row.id && q.complete === false)).map(row => ({ ...row })),
    gearGoals: clientBuild !== GEAR_BUILD ? null : wished.includes(GEAR_GOAL.itemId) ? [{ ...GEAR_GOAL }] : [],
  };
}

module.exports = { dungeonProgression };

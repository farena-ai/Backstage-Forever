"use strict";

// Proposed G1 fact only. No v1 endpoint, settings, storage or route consumer.
const FIELDS = ["questId", "npcId", "mapId", "build", "x", "y"];
const BUILD = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const MAX_ID = 2147483647;
const GRID = 200; // 0.5% of a map; matches the v1 coordinate convention.
const isRecord = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const isId = (value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_ID;
const isCoord = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const rounded = (value) => Math.round(value * GRID) / GRID || 0;

function validateQuestGiverFact(fact, supportedBuilds) {
  if (!isRecord(fact) || Reflect.ownKeys(fact).length !== FIELDS.length ||
      !FIELDS.every((key) => Object.hasOwn(fact, key))) return null;
  const { questId, npcId, mapId, build, x, y } = fact;
  if (!isId(questId) || !isId(npcId) || !isId(mapId) || !isCoord(x) || !isCoord(y) ||
      typeof build !== "string" || !BUILD.test(build) ||
      !(supportedBuilds instanceof Set) || !supportedBuilds.has(build)) return null;
  return { questId, npcId, mapId, build, x: rounded(x), y: rounded(y) };
}

function projectQuestGiverFact(observation, options) {
  if (!isRecord(options) || !Object.hasOwn(options, "shareQuestGivers") || options.shareQuestGivers !== true) return null;
  // Do not infer the build or the quest/NPC link from the surrounding profile.
  // The current journal's pending-NPC + accept pairing is not this evidence.
  if (!isRecord(observation) || !["evidence", "clientBuild", "q", "n", "m", "x", "y"].every((key) => Object.hasOwn(observation, key)) ||
      observation.evidence !== "quest-accept-exact") return null;
  const { q, n, m, x, y, clientBuild } = observation;
  return validateQuestGiverFact({ questId: q, npcId: n, mapId: m, build: clientBuild, x, y },
    Object.hasOwn(options, "supportedBuilds") ? options.supportedBuilds : undefined);
}

module.exports = { validateQuestGiverFact, projectQuestGiverFact };

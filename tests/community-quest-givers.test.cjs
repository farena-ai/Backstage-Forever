"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestGiverFact, projectQuestGiverFact } = require("../src/core/community-quest-givers.cjs");
const { normalizeJournalCapture } = require("../src/core/journal-data.cjs");
const { collectObservations, planBatches, submitBody, validatePack } = require("../src/core/community.cjs");
const { validateSubmit } = require("../community-server/lib/validate.js");

const build = "1.60.1.70888";
const supportedBuilds = new Set([build]); // Fixture policy, not production approval.
const fact = Object.freeze({ questId: 2990, npcId: 4567, mapId: 1446, build, x: 0.51234, y: 0.29321 });
const rounded = { ...fact, x: 0.51, y: 0.295 };

test("the proposed fact is allow-listed, rounded and canonical", () => {
  assert.deepEqual(validateQuestGiverFact(fact, supportedBuilds), rounded);
  assert.deepEqual(validateQuestGiverFact(rounded, supportedBuilds), rounded);
  assert.deepEqual(validateQuestGiverFact({ ...fact, x: 0, y: 1 }, supportedBuilds), { ...rounded, x: 0, y: 1 });
});

test("the fact rejects malformed or unsupported build provenance", () => {
  assert.equal(validateQuestGiverFact(fact), null);
  assert.equal(validateQuestGiverFact({ ...fact, build: "1.60.1.70862" }, supportedBuilds), null);
  for (const bad of [undefined, "1.60.1", `${build}\n`, 70888]) {
    assert.equal(validateQuestGiverFact({ ...fact, build: bad }, new Set([bad])), null);
  }
});

test("the fact rejects private fields, missing keys, and invalid IDs and coordinates", () => {
  for (const key of ["character", "realm", "guid", "at", "history", "source", "installId", "name"]) {
    assert.equal(validateQuestGiverFact({ ...fact, [key]: "private" }, supportedBuilds), null, key);
  }
  for (const key of ["questId", "npcId", "mapId"]) {
    for (const value of [undefined, 0, -1, 1.1, "22", 2147483648]) {
      assert.equal(validateQuestGiverFact({ ...fact, [key]: value }, supportedBuilds), null, key);
    }
    const missing = { ...fact };
    delete missing[key];
    assert.equal(validateQuestGiverFact(missing, supportedBuilds), null, key);
  }
  for (const key of ["x", "y"]) {
    for (const value of [null, -0.001, 1.001, "0.5", Infinity, NaN]) {
      assert.equal(validateQuestGiverFact({ ...fact, [key]: value }, supportedBuilds), null, key);
    }
  }
  for (const value of [null, [fact], Object.create(fact)]) {
    assert.equal(validateQuestGiverFact(value, supportedBuilds), null);
  }
});

// Synthetic linked acceptance only. No current capture produces this evidence.
const observation = Object.freeze({ evidence: "quest-accept-exact", clientBuild: build,
  q: fact.questId, n: fact.npcId, m: fact.mapId, x: fact.x, y: fact.y,
  character: "TestHero", realm: "TestRealm", guid: "Player-1-123", at: 1700000000, history: [{ q: 12 }] });
const optedIn = { shareQuestGivers: true, supportedBuilds };

test("projection is off unless the separate consent flag is explicitly true", () => {
  for (const options of [undefined, null, { supportedBuilds, share: true, enabled: true },
    { supportedBuilds, shareQuestGivers: false }, { supportedBuilds, shareQuestGivers: "true" }, Object.create(optedIn)]) {
    assert.equal(projectQuestGiverFact(observation, options), null);
  }
  assert.equal(projectQuestGiverFact(observation, { shareQuestGivers: true }), null);
});

test("projection returns only the rounded fact, never the raw observation", () => {
  assert.deepEqual(projectQuestGiverFact(observation, optedIn), rounded);
});

test("legacy journal, reference and incomplete accept rows cannot qualify", () => {
  const [legacy] = normalizeJournalCapture({ givers: [{ q: fact.questId, n: fact.npcId, m: fact.mapId, x: fact.x, y: fact.y, at: 1700000000 }] }).givers;
  for (const row of [legacy, { ...legacy, clientBuild: build },
    { ...observation, evidence: "observed-quest-giver" }, { ...observation, evidence: "reference" },
    { ...observation, clientBuild: "1.60.1.70862" }, { ...observation, clientBuild: undefined },
    { ...observation, n: undefined }, { ...observation, q: undefined }, { ...observation, m: undefined },
    { ...observation, x: NaN }, Object.create(observation), null]) {
    assert.equal(projectQuestGiverFact(row, { ...optedIn, clientBuild: build }), null);
  }
});

test("v1 still plans only legacy categories and rejects the proposed fact section", () => {
  const profile = { source: { kind: "wow-addon" }, clientBuild: build,
    gathering: { records: [{ method: "herbalism", entityId: 1617, mapId: fact.mapId, x: fact.x, y: fact.y }] },
    journal: { givers: [observation] } };
  const batch = planBatches(collectObservations([profile]))[0];
  const body = submitBody({ installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", batch });
  assert.deepEqual(body.observations, { nodes: [{ kind: "herb", objectId: 1617, mapId: 1446, x: 0.51, y: 0.295 }] });
  assert.equal(validateSubmit(body).nodes.length, 1);
  const questGivers = [projectQuestGiverFact(observation, optedIn)];
  assert.throws(() => validateSubmit({ ...body, observations: { ...body.observations, questGivers } }),
    { name: "ValidationError", path: "observations.questGivers" });
});

test("the legacy pack reader does not turn a new section into any known reference", () => {
  const pack = { format: 1, version: "fixture", generatedAt: "2026-11-18T00:00:00.000Z", minInstalls: 3 };
  const questGivers = { columns: [...Object.keys(rounded), "installs"], rows: [[...Object.values(rounded), 3]] };
  assert.deepEqual(validatePack({ ...pack, questGivers }), validatePack(pack));
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { defaultState } = require("../src/core/validation.cjs");

const stamp = 1700000000;
const encounters = Array.from({ length: 100 }, (_, i) => ({
  encounterId: i + 1, name: `Boss ${i + 1}`, instanceMap: 36,
  instanceType: "party", difficultyId: 1, at: stamp + i,
}));
function snapshot(id, time, journal) {
  const raw = { schema: 1, observedAt: time, activeId: id, characters: [
    { id, name: "Example", realm: "Fixture", className: "Mage", level: 20, updatedAt: time, journal },
  ] };
  return parseSavedVariables(`BackstageForeverExport = [=[${JSON.stringify(raw)}]=]`);
}

test("newer same-source saves preserve only encounter history when the optional block is unavailable", () => {
  const alpha = "Player-fixture-alpha";
  const first = mergeSnapshot(defaultState(), snapshot(alpha, stamp + 100, {
    encounters, levels: [{ level: 20, at: stamp }], firsts: [{ key: "dungeon", at: stamp }], played: 123,
  }));
  for (const journal of [undefined, { played: 456 }, { played: 456, encounters: [{ ...encounters[0], instanceType: "none" }] }]) {
    const seen = snapshot(alpha, stamp + 101, journal);
    assert.equal(seen.characters[0].journal?.encounters, undefined);
    const [profile] = mergeSnapshot(first, seen).profiles;
    assert.deepEqual(profile.journal, { levels: [], firsts: [], zones: [], encounters, ...(journal ? { played: 456 } : {}) });
  }
  const fresh = { ...encounters[0], at: stamp + 101 };
  const latest = mergeSnapshot(first, snapshot(alpha, stamp + 102, { encounters: [fresh] }));
  assert.deepEqual(latest.profiles[0].journal.encounters, [fresh], "a valid newer block remains authoritative");
  assert.deepEqual(mergeSnapshot(latest, snapshot(alpha, stamp + 101, { encounters })).profiles[0].journal.encounters, [fresh]);
  const other = mergeSnapshot(first, snapshot("Player-fixture-beta", stamp + 101));
  assert.equal(other.profiles[1].journal, undefined, "a different source with the same name cannot inherit proof");
});

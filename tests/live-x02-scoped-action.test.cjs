"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { scopedQuest } = require("../src/renderer/commands.js");

const profile = {
  id: "saved-profile", clientBuild: "1.60.1.70888", source: { kind: "wow-addon", id: "Fixture-Source" },
  quests: [{ id: 1061, title: "A shared title", complete: true, destination: { mapId: 1413, x: 0.123456, y: 0.654321 } },
    { id: 1062, title: "A shared title", complete: true, destination: { mapId: 1413, x: 0.123456, y: 0.654321 } }],
};
const destination = { mapId: 1413, x: 0.1235, y: 0.6543 };
const waypoint = { source: "game", canCopy: true, phase: "t", destination };

test("a saved quest marker round-trips via the same numeric ID and exact saved point, not its title", () => {
  const action = scopedQuest.create(profile, 1061, waypoint);
  assert.ok(action);
  const map = scopedQuest.mapTarget(JSON.parse(JSON.stringify(action)), profile);
  assert.equal(map.questId, 1061);
  assert.deepEqual({ mapId: map.mapId, x: map.x, y: map.y }, destination);
  assert.equal(scopedQuest.returnQuestId(JSON.parse(JSON.stringify(map.scopedQuest)), profile), 1061);
});

test("a stale character, source, build, phase or point cannot open Map or return to Guide", () => {
  const action = scopedQuest.create(profile, 1061, waypoint);
  for (const changed of [
    { ...profile, id: "another-profile" },
    { ...profile, source: { kind: "wow-addon", id: "another-source" } },
    { ...profile, source: { ...profile.source, kind: "manual" } },
    { ...profile, clientBuild: "1.60.1.70790" },
    { ...profile, quests: [profile.quests[1]] },
    { ...profile, quests: [{ ...profile.quests[0], complete: false }] },
    { ...profile, quests: [{ ...profile.quests[0], destination: { ...destination, x: 0.75 } }] },
  ]) {
    assert.equal(scopedQuest.mapTarget(action, changed), null);
    assert.equal(scopedQuest.returnQuestId(action, changed), null);
  }
});

test("approximate, unproven, and malformed markers cannot become scoped actions", () => {
  for (const marker of [null, { ...waypoint, source: "reference" }, { ...waypoint, canCopy: false },
    { ...waypoint, phase: "r" }, { ...waypoint, destination: { ...destination, x: "0.1235" } },
    { ...waypoint, destination: { ...destination, mapId: 1411 } }]) {
    assert.equal(scopedQuest.create(profile, 1061, marker), null);
  }
  assert.equal(scopedQuest.create({ ...profile, clientBuild: "unknown" }, 1061, waypoint), null);
  assert.equal(scopedQuest.create(profile, "1061", waypoint), null);
  const action = scopedQuest.create(profile, 1061, waypoint);
  assert.equal(scopedQuest.returnQuestId({ ...action, kind: "unknown" }, profile), null);
  assert.equal(scopedQuest.returnQuestId({ ...action, command: "/bf next" }, profile), null);
});

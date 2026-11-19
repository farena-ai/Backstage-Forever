"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { recover } = require("../src/core/desktop-route-recovery.cjs");
const build = "1.60.1.70888";
const quest = (id, fields = {}) => ({ id, title: `Quest ${id}`, sides: ["Horde"], minLevel: 1, ...fields });
const pack = { build, quests: { 2: quest(2), 3: quest(3), 4: quest(4, { sides: ["Alliance"] }), 5: quest(5, { nextQuestId: 2 }) } };
const step = (id, kind, fields = {}) => ({ id: `${kind}:${id}`, kind, ids: [id], level: 1, text: `${kind} ${id}`, mapId: 1411, x: .4, y: .6, ...fields });
const profile = { id: "one", faction: "Horde", race: "Orc", level: 2, clientBuild: build, source: { kind: "wow-addon", updatedAt: "2026-11-12T00:00:00Z" }, history: { completedIdsKnown: true, completedIds: [] }, quests: [] };
const project = (steps, p = {}, skips = []) => recover({ route: { faction: "Horde", steps }, profile: { ...profile, ...p }, pack, skips });

test("an in-log objective gets an exact scoped reference point", () => {
  const r = project([step(2, "objective")], { quests: [quest(2)] });
  assert.equal(r.reason, null);
  assert.deepEqual(r.map, { questId: 2, profileId: "one", mapId: 1411, x: .4, y: .6 });
});

test("a missing giver and unresolved chain never become directions; one compatible saved quest wins by ID", () => {
  const p = { quests: [quest(4), quest(3), quest(5)] };
  const r = project([step(2, "pickup", { x: null })], p);
  assert.equal(r.reason, "missing-location");
  assert.equal(r.map, null);
  assert.equal(r.fallback.id, 3);
  assert.equal(project([step(2, "pickup")], p).reason, "prerequisite");
  assert.equal(project([step(2, "pickup")], { history: null }).reason, "unknown-history");
});

test("wrong and unknown builds are browse-only; wrong-side routes and quest steps are not actionable", () => {
  for (const clientBuild of ["1.60.1.70862", undefined]) {
    const r = project([step(2, "objective")], { clientBuild, quests: [quest(2)] });
    assert.deepEqual([r.reason, r.map, r.fallback], ["build", null, null]);
  }
  assert.equal(project([step(2, "objective")], { faction: "Alliance" }).reason, "route-side");
  assert.equal(project([step(4, "objective")], { quests: [quest(4)] }).reason, "quest-side");
});

test("current log takes precedence over old completion; missing hand-ins aren't marked done", () => {
  const history = { completedIdsKnown: true, completedIds: [2] };
  const rows = [step(2, "objective"), step(2, "turnin"), step(3, "turnin")];
  assert.equal(project(rows, { history, quests: [quest(2)] }).step.id, "objective:2");
  assert.equal(project(rows, { history, quests: [quest(2, { complete: true })] }).step.id, "turnin:2");
  const r = project(rows, { history });
  assert.equal(r.step.id, "turnin:3");
  assert.equal(r.reason, "not-in-log");
  assert.equal(r.fallback, null);
});

test("skips are explicit step IDs, separately counted, reversible, and never imply completion", () => {
  const rows = [step(2, "pickup"), step(2, "turnin"), step(3, "turnin")];
  const r = project(rows, {}, ["pickup:2", "stale:99"]);
  assert.equal(r.step.id, "turnin:2");
  assert.deepEqual(r.skipped, ["pickup:2"]);
  assert.equal(project(rows, {}, r.skipped.concat("turnin:2", "turnin:3")).reason, "end");
  assert.equal(project(rows).step.id, "pickup:2");
});

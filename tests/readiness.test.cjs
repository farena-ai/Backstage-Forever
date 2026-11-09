const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateReadiness } = require("../src/core/readiness.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const readiness = {
  equipment: [
    { slot: 1, itemId: 123, name: "Observed helm", quality: 2, itemLevel: 12 },
  ],
  bags: { free: 4, total: 16 },
};
test("readiness is optional bounded and strips no unknown access-bearing fields", () => {
  assert.equal(validateReadiness(undefined), undefined);
  assert.deepEqual(validateReadiness(readiness), readiness);
  for (const bad of [
    { equipment: [{ slot: 20, itemId: 1 }] },
    { equipment: [{ slot: 1, itemId: 0 }] },
    {
      equipment: [
        { slot: 1, itemId: 1 },
        { slot: 1, itemId: 2 },
      ],
    },
    { equipment: [], bags: { free: 5, total: 4 } },
    { equipment: [], money: 1 },
    { equipment: [{ slot: 1, itemId: 1, name: "x".repeat(201) }] },
    { equipment: [{ slot: 1, itemId: 1, quality: 9 }] },
    { equipment: [], bags: { free: 0, total: 1001 } },
  ])
    assert.throws(() => validateReadiness(bad));
});
test("schema1 parser state backup and merge preserve readiness plus private journal", () => {
  const c = {
    id: "synthetic",
    name: "Example",
    realm: "Realm",
    className: "Mage",
    level: 12,
    updatedAt: 1700000000,
    readiness,
  };
  const raw =
    "BackstageForeverExport = " +
    JSON.stringify(
      JSON.stringify({
        schema: 1,
        characters: [c],
        activeId: c.id,
        observedAt: c.updatedAt,
      }),
    );
  const snapshot = parseSavedVariables(raw),
    state = mergeSnapshot(defaultState(), snapshot);
  assert.deepEqual(state.profiles[0].readiness, readiness);
  state.profiles[0].notes = "private";
  state.profiles[0].goals = [{ id: "g", text: "Private goal", done: false }];
  snapshot.characters[0].updatedAt = "2024-01-01T00:00:00.000Z";
  snapshot.observedAt = snapshot.characters[0].updatedAt;
  const next = mergeSnapshot(state, snapshot);
  assert.equal(next.profiles[0].notes, "private");
  assert.equal(next.profiles[0].goals[0].text, "Private goal");
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(next))), next);
});
test("readiness remains excluded from consented provider contexts", () => {
  const approved = require("../src/core/providers.cjs").approvedProfile({
    name: "Example",
    readiness,
  });
  assert.equal(approved.readiness, undefined);
  assert.doesNotMatch(JSON.stringify(approved), /Observed helm|123/);
});

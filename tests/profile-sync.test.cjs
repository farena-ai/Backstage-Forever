"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { mergeUserEdits } = require("../src/core/profile-sync.cjs");
const old = "2026-01-01T00:00:00.000Z",
  newer = "2026-01-02T00:00:00.000Z";
const character = (id = "a", extra = {}) => ({
  id,
  name: "Example",
  realm: "Test Realm",
  className: "Mage",
  level: 10,
  updatedAt: old,
  ...extra,
});
const snapshot = (
  characters,
  activeId = characters[0]?.id ?? null,
  observedAt = newer,
) => ({ characters, activeId, observedAt });
const manual = (id = "manual", extra = {}) => ({
  id,
  name: "Example",
  realm: "Test Realm",
  className: "Warrior",
  level: 1,
  notes: "Keep my notes",
  goals: [{ id: "goal", text: "Explore", done: true }],
  ...extra,
});
test("adds stable profiles, selects active and deeply clones both inputs", () => {
  const input = defaultState(),
    shot = snapshot(
      [
        character("a", { location: { zone: "Forest", x: 0.5 } }),
        character("b", { name: "Other" }),
      ],
      "b",
    );
  const result = mergeSnapshot(input, shot);
  assert.equal(result.profiles.length, 2);
  assert.equal(
    result.profiles.find((p) => p.id === result.activeProfileId).source.id,
    "b",
  );
  assert.deepEqual(validateState(result), result);
  assert.deepEqual(mergeSnapshot(input, shot), result);
  result.profiles[0].location.zone = "Changed";
  assert.equal(shot.characters[0].location.zone, "Forest");
  assert.equal(input.profiles.length, 0);
});
test("migrates only one exact manual match and preserves notes, goals and unrelated profiles", () => {
  const input = {
    ...defaultState(),
    profiles: [manual(), manual("other", { name: "Unrelated" })],
    activeProfileId: "other",
  };
  const result = mergeSnapshot(input, snapshot([character()]));
  assert.equal(result.profiles.length, 2);
  assert.equal(result.profiles[0].id, "manual");
  assert.deepEqual(result.profiles[0].goals, input.profiles[0].goals);
  assert.equal(result.profiles[0].notes, "Keep my notes");
  assert.equal(result.profiles[0].className, "Mage");
  assert.deepEqual(result.profiles[1], input.profiles[1]);
  result.profiles[0].goals[0].done = false;
  assert.equal(input.profiles[0].goals[0].done, true);
});
test("ambiguous manual matches remain manual", () => {
  const input = { ...defaultState(), profiles: [manual("one"), manual("two")] };
  const result = mergeSnapshot(input, snapshot([character()]));
  assert.equal(result.profiles.length, 3);
  assert.equal(result.profiles[0].source, undefined);
  assert.equal(result.profiles[1].source, undefined);
});
test("stable identity updates newer fields despite rename and rejects stale and equal changes", () => {
  const first = mergeSnapshot(defaultState(), snapshot([character()]));
  first.profiles[0].notes = "Retain";
  const latest = mergeSnapshot(
    first,
    snapshot([
      character("a", {
        name: "Renamed",
        level: 20,
        race: "Human",
        faction: "Alliance",
        location: { zone: "City" },
        updatedAt: newer,
      }),
    ]),
  );
  assert.equal(latest.profiles.length, 1);
  assert.equal(latest.profiles[0].id, first.profiles[0].id);
  assert.equal(latest.profiles[0].name, "Renamed");
  assert.equal(latest.profiles[0].notes, "Retain");
  assert.deepEqual(mergeSnapshot(latest, snapshot([character()])), latest);
  assert.deepEqual(
    mergeSnapshot(
      latest,
      snapshot([character("a", { updatedAt: newer, level: 3 })]),
    ),
    latest,
  );
});
test("stale exports do not change active selection", () => {
  const state = mergeSnapshot(
    defaultState(),
    snapshot(
      [
        character("a", { updatedAt: newer }),
        character("b", { name: "Other", updatedAt: newer }),
      ],
      "b",
    ),
  );
  const result = mergeSnapshot(state, snapshot([character()], "a", old));
  assert.equal(result.activeProfileId, state.activeProfileId);
});
test("explicit selection preference preserves chosen character while roster continues updating", () => {
  const state = mergeSnapshot(
    defaultState(),
    snapshot([character("a"), character("b", { name: "Other" })], "b"),
  );
  state.followGameCharacter = false;
  const result = mergeSnapshot(
    state,
    snapshot([character("a", { level: 22, updatedAt: newer })], "a", newer),
  );
  assert.equal(result.activeProfileId, state.activeProfileId);
  assert.equal(result.profiles.find((p) => p.source.id === "a").level, 22);
  assert.throws(() => validateState({ ...state, followGameCharacter: "yes" }));
});
test("profile cap skips additions while updating existing profiles and preserving selection", () => {
  const state = {
    ...defaultState(),
    profiles: Array.from({ length: 100 }, (_, i) =>
      manual(`p${i}`, { name: `Person${i}` }),
    ),
    activeProfileId: "p99",
  };
  const result = mergeSnapshot(
    state,
    snapshot(
      [character("new"), character("known", { name: "Person0" })],
      "new",
    ),
  );
  assert.equal(result.profiles.length, 100);
  assert.equal(result.profiles[0].source.id, "known");
  assert.equal(result.activeProfileId, "p99");
});
test("duplicate source identities and invalid snapshots fail without mutating inputs", () => {
  assert.throws(() =>
    mergeSnapshot(defaultState(), snapshot([character(), character()])),
  );
  assert.throws(() =>
    mergeSnapshot(
      defaultState(),
      snapshot([character("a", { updatedAt: "invalid" })]),
    ),
  );
  assert.throws(() =>
    mergeSnapshot(defaultState(), snapshot([character("a", { level: -1 })])),
  );
  const source = { kind: "wow-addon", id: "a", updatedAt: old };
  assert.throws(() =>
    mergeSnapshot(
      {
        ...defaultState(),
        profiles: [manual("a", { source }), manual("b", { source })],
      },
      snapshot([]),
    ),
  );
});
test("two imported identities sharing a name cannot claim a manual profile", () => {
  const state = { ...defaultState(), profiles: [manual()] };
  const result = mergeSnapshot(
    state,
    snapshot([character("a"), character("b")]),
  );
  assert.equal(result.profiles.length, 3);
  assert.equal(result.profiles[0].source, undefined);
});
test("latest export can select another known character without a level change", () => {
  const characters = [character("a"), character("b", { name: "Other" })];
  const first = mergeSnapshot(defaultState(), snapshot(characters, "a", old));
  const next = mergeSnapshot(first, snapshot(characters, "b", newer));
  assert.equal(
    next.profiles.find((p) => p.id === next.activeProfileId).source.id,
    "b",
  );
  assert.deepEqual(next.profiles, first.profiles);
});
test("missing snapshot optionals clear stale game data only on a newer record", () => {
  const first = mergeSnapshot(
    defaultState(),
    snapshot([character("a", { location: { zone: "City" }, race: "Human" })]),
  );
  const next = mergeSnapshot(
    first,
    snapshot([character("a", { updatedAt: newer })]),
  );
  assert.equal(next.profiles[0].location, undefined);
  assert.equal(next.profiles[0].race, undefined);
  assert.equal(first.profiles[0].location.zone, "City");
});
test("stale journal edits preserve concurrent imported levels, new characters and active selection", () => {
  const base = mergeSnapshot(
    defaultState(),
    snapshot([character("a")], "a", old),
  );
  const current = mergeSnapshot(
    base,
    snapshot(
      [
        character("a", { level: 11, updatedAt: newer }),
        character("b", { name: "Second", level: 20, updatedAt: newer }),
      ],
      "b",
      newer,
    ),
  );
  const edited = structuredClone(base);
  edited.profiles[0].notes = "Edited while playing";
  const merged = mergeUserEdits(current, edited, base);
  assert.equal(merged.profiles.length, 2);
  assert.equal(merged.profiles[0].level, 11);
  assert.equal(merged.profiles[0].notes, "Edited while playing");
  assert.equal(merged.activeProfileId, current.activeProfileId);
  assert.equal(merged.followGameCharacter, undefined);
});
test("three-way edits apply explicit deletion, selection and goals without resurrecting removed profiles", () => {
  const base = {
    ...defaultState(),
    profiles: [manual("a"), manual("b", { name: "Second" })],
    activeProfileId: "a",
  };
  const edited = structuredClone(base);
  edited.profiles.shift();
  edited.activeProfileId = "b";
  const merged = mergeUserEdits(base, edited, base);
  assert.equal(merged.profiles.length, 1);
  assert.equal(merged.activeProfileId, "b");
  const concurrentlyDeleted = {
    ...base,
    profiles: [base.profiles[1]],
    activeProfileId: "b",
  };
  const stale = structuredClone(base);
  stale.profiles[0].notes = "stale";
  assert.equal(
    mergeUserEdits(concurrentlyDeleted, stale, base).profiles.length,
    1,
  );
});
test("quest and XP updates require newer observed data; unavailable clears old observation", () => {
  const q = [{ id: 1, title: "Known", complete: false, objectives: [] }];
  let s = mergeSnapshot(
    defaultState(),
    snapshot([
      character("a", { quests: q, progress: { current: 10, max: 100 } }),
    ]),
  );
  s = mergeSnapshot(s, snapshot([character("a", { updatedAt: newer })]));
  assert.equal(s.profiles[0].quests, undefined);
  assert.equal(s.profiles[0].progress, undefined);
  s = mergeSnapshot(
    s,
    snapshot([character("a", { updatedAt: old, quests: [] })]),
  );
  assert.equal(s.profiles[0].quests, undefined);
  s = mergeSnapshot(
    s,
    snapshot([
      character("a", {
        updatedAt: "2026-01-03T00:00:00.000Z",
        quests: [],
        progress: { current: 20, max: 100 },
      }),
    ]),
  );
  assert.deepEqual(s.profiles[0].quests, []);
  assert.equal(s.profiles[0].progress.current, 20);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const modulePath = "../src/core/desktop-view-presets.cjs";

test("without a preset, desktop disclosures retain their existing closed defaults", () => {
  assert.doesNotThrow(() => require.resolve(modulePath), "desktop view resolver must exist");
  const { resolveViewPreferences } = require(modulePath);
  for (const absent of [undefined, null]) {
    assert.deepEqual(resolveViewPreferences(absent), { nowMoreSuggestions: false, preparationSources: false });
  }
});

test("preview lists only the disclosure defaults that an explicit apply would change", () => {
  const { previewViewPreset, applyViewPreset, resolveViewPreferences } = require(modulePath);
  const record = null;
  for (const [preset, nowMoreSuggestions, preparationSources] of [
    ["compact", false, false], ["guided", true, false], ["planner", true, true]
  ]) {
    const changes = [
      ...(nowMoreSuggestions ? [{ key: "nowMoreSuggestions", from: false, to: true }] : []),
      ...(preparationSources ? [{ key: "preparationSources", from: false, to: true }] : [])
    ];
    assert.deepEqual(previewViewPreset(record, preset), { preset, changes });
    assert.deepEqual(resolveViewPreferences(record), { nowMoreSuggestions: false, preparationSources: false });
    const next = applyViewPreset(record, preset);
    assert.deepEqual(next, { version: 1, preset, overrides: {} });
    assert.deepEqual(resolveViewPreferences(next), { nowMoreSuggestions, preparationSources });
  }
});

test("an explicit override wins across preset changes and reopening serialized preferences", () => {
  const { applyViewPreset, setViewOverride, previewViewPreset, resolveViewPreferences } = require(modulePath);
  const next = setViewOverride(null, "nowMoreSuggestions", false);
  assert.deepEqual(previewViewPreset(next, "planner"), {
    preset: "planner", changes: [{ key: "preparationSources", from: false, to: true }]
  });
  const reopened = JSON.parse(JSON.stringify(applyViewPreset(next, "planner")));
  assert.deepEqual(resolveViewPreferences(reopened), { nowMoreSuggestions: false, preparationSources: true });
  assert.deepEqual(resolveViewPreferences(setViewOverride(reopened, "nowMoreSuggestions", null)),
    { nowMoreSuggestions: true, preparationSources: true });
});

test("reset clears only the supplied desktop view record", () => {
  const { applyViewPreset, resetViewPreferences, resolveViewPreferences } = require(modulePath);
  const a = Object.freeze(applyViewPreset(null, "planner"));
  const b = applyViewPreset(null, "guided");
  assert.equal(resetViewPreferences(a), null);
  assert.deepEqual(resolveViewPreferences(null), { nowMoreSuggestions: false, preparationSources: false });
  assert.deepEqual(resolveViewPreferences(a), { nowMoreSuggestions: true, preparationSources: true });
  assert.deepEqual(resolveViewPreferences(b), { nowMoreSuggestions: true, preparationSources: false });
});

test("malformed or unsupported records read as defaults and cannot be overwritten by A2", () => {
  const { applyViewPreset, previewViewPreset, resetViewPreferences, resolveViewPreferences, setViewOverride } = require(modulePath);
  for (const record of [false, [], {},
    { version: 2, preset: "planner", overrides: {} },
    { version: "1", preset: "planner", overrides: {} },
    { version: 1, preset: "toString", overrides: {} },
    { version: 1, preset: "planner", overrides: [] },
    { version: 1, preset: "planner", overrides: { nowMoreSuggestions: "false" } },
    { version: 1, preset: "planner", overrides: { shareCharacter: true } },
    { version: 1, preset: "planner", overrides: {}, live: true },
    Object.create({ version: 1, preset: "planner", overrides: {} })
  ]) {
    assert.deepEqual(resolveViewPreferences(record), { nowMoreSuggestions: false, preparationSources: false });
    assert.throws(() => previewViewPreset(record, "compact"), TypeError);
    assert.throws(() => applyViewPreset(record, "compact"), TypeError);
    assert.throws(() => setViewOverride(record, "preparationSources", true), TypeError);
    assert.throws(() => resetViewPreferences(record), TypeError);
  }
});

test("desktop preset commands reject settings and values outside the presentation allowlist", () => {
  const { applyViewPreset, previewViewPreset, setViewOverride } = require(modulePath);
  for (const preset of [null, "Planner", "toString", "__proto__", ["planner"]]) {
    assert.throws(() => applyViewPreset(null, preset), TypeError);
    assert.throws(() => previewViewPreset(null, preset), TypeError);
  }
  for (const key of ["shareCharacter", "liveEnabled", "notificationPermission", "characterGoal", "__proto__", ["preparationSources"]]) {
    assert.throws(() => setViewOverride(null, key, true), TypeError);
  }
  for (const value of ["false", 0, undefined, {}]) {
    assert.throws(() => setViewOverride(null, "preparationSources", value), TypeError);
  }
});

test("a discarded preview leaves the current display and unrelated preferences unchanged", () => {
  const { applyViewPreset, previewViewPreset, resolveViewPreferences } = require(modulePath);
  const desktopView = applyViewPreset(null, "guided");
  Object.freeze(desktopView.overrides);
  const preferences = Object.freeze({ desktopView: Object.freeze(desktopView),
    shareCharacter: false, liveEnabled: false, notificationPermission: "denied", characterGoal: "quest" });
  const before = JSON.stringify(preferences);
  const preview = previewViewPreset(preferences.desktopView, "planner");
  assert.deepEqual(preview.changes, [{ key: "preparationSources", from: false, to: true }]);
  assert.deepEqual(resolveViewPreferences(preferences.desktopView), { nowMoreSuggestions: true, preparationSources: false });
  const applied = applyViewPreset(preferences.desktopView, "planner");
  assert.deepEqual(Object.keys(applied), ["version", "preset", "overrides"]);
  assert.equal(JSON.stringify(preferences), before);
});

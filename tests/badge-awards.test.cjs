"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { badgeBook } = require("../src/core/badges.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { Store } = require("../src/core/store.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

const at = (day) => `2026-11-0${day}T12:00:00.000Z`;
const character = (id, day, rank, name = id) => ({
  id, name, realm: "Test", className: "Mage", level: 40, updatedAt: at(day),
  ...(rank === undefined ? {} : { readiness: { workshop: { professions: {
    observedAt: at(day), complete: true,
    items: [{ skillLineId: 171, professionId: 1001, name: "Alchemy", rank, maxRank: 300 }],
  } } } }),
});
const merge = (state, ...characters) => mergeSnapshot(state, {
  characters, activeId: characters[0].id, observedAt: characters[0].updatedAt,
});
const id150 = "profession-alchemy-150", id300 = "profession-alchemy-300";
const badge = (state, id = id150, profileId) => badgeBook(state, profileId).book.badges.find(b => b.id === id);

test("a confirmed profession award survives downgrade, omission and desktop restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lj-badge-awards-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  store.saveState(merge(store.state, character("owner", 2, 150), character("other", 2, 10)));
  assert.equal(badge(store.state).earned, true);
  store.saveState(merge(store.state, character("owner", 3, 20, "Renamed")));
  assert.equal(badge(store.state).earned, true, "a lower rank does not revoke the award");
  assert.deepEqual(badge(store.state, id300).progress, { have: 20, need: 300 });
  store.saveState(merge(store.state, character("owner", 4, undefined, "Renamed")));
  store = new Store(dir);
  const award = badge(store.state);
  assert.equal(award.earned, true);
  assert.equal(award.progressUnavailable, undefined);
  assert.equal(award.at, undefined, "snapshot time is not an achievement date");
  assert.equal(badge(store.state, id300).progressUnavailable, true);
  const book = badgeBook(store.state);
  assert.deepEqual(book.holders[id150], ["Renamed"]);
  assert.deepEqual(book.recent, []);
  assert.equal(badge(store.state, id150, store.state.profiles[1].id).earned, false);
});

test("legacy saved evidence is retained before its first replacement", () => {
  const initial = merge(defaultState(), character("owner", 2, 150));
  delete initial.profiles[0].badgeAwards; // An older desktop backup has no latch yet.
  const updated = merge(initial, character("owner", 3));
  assert.equal(badge(updated).earned, true);
  assert.equal(Object.hasOwn(initial.profiles[0], "badgeAwards"), false, "merge does not mutate its input");
});

test("equal and older snapshots cannot fabricate profession awards", () => {
  const initial = merge(defaultState(), character("owner", 2, 149));
  const stale = merge(initial, character("owner", 1, 300));
  const equal = merge(stale, character("owner", 2, 300));
  const updated = merge(equal, character("owner", 3));
  assert.equal(badge(updated).earned, false);
  assert.equal(badge(updated, id300).earned, false);
});

test("validated backups can carry only unique character profession award IDs on saved characters", () => {
  const state = merge(defaultState(), character("owner", 2));
  const profile = state.profiles[0];
  profile.badgeAwards = [id150];
  assert.deepEqual(validateState(state).profiles[0].badgeAwards, [id150]);
  for (const invalid of [null, id150, [id150, id150], ["account-classes-3"], ["level-10"], ["invented"], Array(25).fill(id150)]) {
    profile.badgeAwards = invalid;
    assert.throws(() => validateState(state));
  }
  profile.badgeAwards = [id150];
  delete profile.source;
  assert.throws(() => validateState(state));
  assert.throws(() => merge(defaultState(), { ...character("owner", 2), badgeAwards: [id150] }));
});

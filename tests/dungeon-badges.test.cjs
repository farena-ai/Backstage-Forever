"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { badgesFor, badgeBook } = require("../src/core/badges.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { Store } = require("../src/core/store.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

const FIRST = "dungeon-first-victory", COLLECTION = "dungeon-victories-5";
const stamp = 1700000000;
const win = (encounterId, extras = {}) => ({
  encounterId, name: "Fixture Boss", instanceMap: 36, instanceType: "party", difficultyId: 1, at: stamp, ...extras,
});
const character = (id, updatedAt, journal) => ({ id, name: id, realm: "Fixture", className: "Mage", level: 20, updatedAt, journal });
function snapshot(...characters) {
  const { id: activeId, updatedAt: observedAt } = characters[0];
  const json = JSON.stringify({ schema: 1, activeId, observedAt, characters });
  return parseSavedVariables(`BackstageForeverExport = [=[${json}]=]`);
}
const merge = (state, ...characters) => mergeSnapshot(state, snapshot(...characters));
const find = (profile, id) => badgesFor(profile, { desktop: true }).badges.find(b => b.id === id);

test("dungeon entry, raid wins, and unsourced journals are not dungeon victory proof", () => {
  const state = merge(defaultState(), character("Visitor", stamp, {
    firsts: [{ key: "dungeon", at: stamp }], encounters: [win(1, { instanceType: "raid" })],
  }));
  const [profile] = state.profiles;
  assert.equal(badgesFor(profile).badges.find(b => b.id === "first-dungeon").earned, true);
  assert.equal(badgesFor(profile).badges.some(b => b.id === FIRST), false);
  assert.equal(find(profile, FIRST).earned, false);
  assert.equal(find({ journal: { encounters: [win(1)] } }, FIRST).earned, false);
  assert.equal(find(profile, COLLECTION).progressUnavailable, true);
});

test("collection counts distinct party map and encounter pairs, not attempts, names or difficulty", () => {
  const [profile] = merge(defaultState(), character("Owner", stamp + 1, { encounters: [
    win(1), win(1), win(1, { at: stamp + 1, difficultyId: 2, name: "Localized" }),
    win(1, { instanceMap: 99 }), win(2), win(3, { instanceType: "raid" }),
  ] })).profiles;
  assert.equal(find(profile, FIRST).earned, true);
  assert.equal(find(profile, FIRST).desktopOnly, true);
  assert.deepEqual(find(profile, COLLECTION).progress, { have: 3, need: 5 });
  assert.deepEqual(profile.badgeAwards, [FIRST]);
});

test("earned dungeon badges survive bounded history replacement, restart and a character switch", (t) => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "bf-dungeon-badges-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  store.saveState(merge(store.state, character("Owner", stamp, { encounters: [1, 2, 3, 4, 5].map(id => win(id)) })));
  // An older desktop backup can contain qualifying rows without latched awards.
  const legacy = structuredClone(store.state);
  delete legacy.profiles[0].badgeAwards;
  assert.equal(find(legacy.profiles[0], COLLECTION).earned, true);
  store.saveState(merge(legacy, character("Owner", stamp + 1, { encounters: [win(6)] }), character("Alt", stamp + 1)));
  store.saveState(merge(store.state, character("Alt", stamp + 2)));
  store = new Store(dir);
  const [owner, alt] = store.state.profiles;
  const book = badgeBook(store.state, owner.id);
  assert.ok(book.groups.includes("Dungeons"));
  assert.deepEqual(book.holders[COLLECTION], [owner.name]);
  assert.deepEqual(find(owner, COLLECTION).progress, { have: 5, need: 5 });
  assert.equal(find(owner, COLLECTION).earned, true);
  assert.equal(find(owner, FIRST).at, undefined, "an ID-only latch doesn't guess dates");
  assert.equal(find(alt, FIRST).earned, false);
  assert.equal(badgeBook(store.state).character.id, alt.id);
});

test("stale, equal, malformed and future observations cannot latch victory badges", () => {
  const initial = merge(defaultState(), character("Owner", stamp + 1));
  const stale = merge(initial, character("Owner", stamp, { encounters: [win(1)] }));
  const equal = merge(stale, character("Owner", stamp + 1, { encounters: [win(1)] }));
  const malformed = merge(equal, character("Owner", stamp + 2, { encounters: [win(0)] }));
  const future = merge(malformed, character("Owner", stamp + 3, { encounters: [win(1, { at: stamp + 4 })] }));
  const omitted = merge(future, character("Owner", stamp + 5));
  for (const state of [stale, equal, malformed, future, omitted]) {
    assert.equal(find(state.profiles[0], FIRST).earned, false);
    assert.equal(state.profiles[0].badgeAwards, undefined);
  }
});

test("backup award allowlist accepts dungeon and profession IDs together, but snapshots cannot inject awards", () => {
  const state = merge(defaultState(), character("Owner", stamp));
  state.profiles[0].badgeAwards = [FIRST, "profession-alchemy-150"];
  assert.deepEqual(validateState(state).profiles[0].badgeAwards, state.profiles[0].badgeAwards);
  state.profiles[0].badgeAwards = [FIRST, FIRST];
  assert.throws(() => validateState(state));
  assert.throws(() => mergeSnapshot(defaultState(), {
    ...snapshot(character("Owner", stamp)),
    characters: [{ ...snapshot(character("Owner", stamp)).characters[0], badgeAwards: [FIRST] }],
  }));
});

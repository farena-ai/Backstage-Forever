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
const { defaultState } = require("../src/core/validation.cjs");

const stamp = 1795000000, build = "1.60.1.70888", oldBuild = "1.60.1.70862";
const storm = "rep-stormwind-revered", exalted = "rep-stormwind-exalted";
const row = (fields = {}) => ({ id: 72, name: "Sturmwind", standing: 7, min: 21000, max: 42000, value: 21000, observedAt: stamp, observedBuild: build, ...fields });
const ledger = (factions, seenAt = stamp) => ({ reputations: { seenAt, factions } });
const character = (fields = {}) => ({ id: "Owner", name: "Traveler", realm: "Fixture", className: "Mage", faction: "Alliance", level: 25, updatedAt: stamp, clientBuild: build, ...fields });
function merge(state, ...characters) {
  const { id: activeId, updatedAt: observedAt } = characters[0];
  return mergeSnapshot(state, parseSavedVariables(`BackstageForeverExport = [=[${JSON.stringify({ schema: 1, activeId, observedAt, characters })}]=]`));
}
const badge = (p, id = storm) => badgesFor(p, { desktop: true }).badges.find(b => b.id === id);
const profileWith = (ledger, fields) => merge(defaultState(), character({ ledger, ...fields })).profiles[0];

test("each medal uses the exact numeric faction and standing, not the saved name or bar value", () => {
  for (const [id, key, faction, name] of [[72, "stormwind", "Alliance", "Stormwind"], [76, "orgrimmar", "Horde", "Orgrimmar"], [576, "timbermaw-hold", "Horde", "Timbermaw Hold"]]) {
    const first = `rep-${key}-revered`, last = `rep-${key}-exalted`;
    for (const standing of [6, 7, 8]) {
      const profile = profileWith(ledger([row({ id, standing, name: "Localized name", value: 42000 })]), { faction });
      assert.deepEqual(profile.badgeAwards, standing === 8 ? [first, last] : standing === 7 ? [first] : undefined);
      assert.ok(badge(profile, first), `desktop catalog is missing ${first}`);
      assert.equal(badge(profile, first).name, `${name} · Revered`);
      assert.equal(badge(profile, last).earned, standing === 8);
      assert.deepEqual(badge(profile, last).progress, { have: standing, need: 8 });
      assert.equal(badge(profile, first).at, undefined);
      assert.equal(badge(profile, first).desktopOnly, true);
      assert.ok(!badgesFor(profile).badges.some(b => b.id === first || b.id === last));
    }
  }
  const wrong = profileWith(ledger([row({ id: 47, name: "Stormwind", standing: 8 })]));
  assert.equal(badge(wrong).progressUnavailable, true);
  assert.equal(wrong.badgeAwards, undefined);
  assert.equal(badgesFor(wrong).badges.find(b => b.id === "rep-exalted").earned, true);
});

test("missing, hidden, future, mismatched, malformed and wrong-side observations cannot award medals", () => {
  for (const [capture, fields] of [
    [undefined],
    [ledger([row({ observedAt: undefined, observedBuild: undefined })])],
    [ledger([row({ observedBuild: undefined })])],
    [ledger([row({ observedAt: stamp - 1 })])],
    [ledger([row({ observedAt: stamp + 1 })], stamp + 1)],
    [ledger([row({ observedAt: stamp + 1 })])],
    [ledger([row({ observedBuild: oldBuild })])],
    [ledger([row({ standing: "7" })])],
    [ledger([row(), row({ standing: 8 })])],
    [ledger([row()]), { clientBuild: undefined }],
    [ledger([row()]), { faction: undefined }],
    [ledger([row()]), { faction: "Horde" }],
  ]) {
    const profile = profileWith(capture, fields);
    assert.equal(profile.badgeAwards, undefined);
    assert.equal(badge(profile).earned, false);
    assert.equal(badge(profile).progress, undefined);
    assert.equal(badge(profile).progressUnavailable, true);
  }
  assert.equal(badge({ ledger: ledger([row()]), clientBuild: build, faction: "Alliance" }).earned, false);
  assert.equal(badge(profileWith(ledger([row({ id: 576 })]), { faction: undefined }), "rep-timbermaw-hold-revered").earned, true);
});

test("only accepted character-owned saves latch medals; later omissions and restart preserve them", (t) => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "bf-reputation-medals-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  const alt = character({ id: "Alt" }); // Same displayed name, different saved identity.
  store.saveState(merge(store.state, character({ ledger: ledger([row({ standing: 6 })]) }), alt));
  for (const updatedAt of [stamp - 1, stamp]) {
    const state = merge(store.state, character({ updatedAt, ledger: ledger([row({ standing: 8, observedAt: updatedAt })], updatedAt) }));
    assert.deepEqual(badgeBook(state).holders[storm], []);
  }
  const hidden = ledger([row({ standing: 8 }), row({ id: 47, observedAt: stamp + 1 })], stamp + 1);
  store.saveState(merge(store.state, character({ updatedAt: stamp + 1, ledger: hidden }), alt));
  assert.equal(badge(store.state.profiles[0]).progressUnavailable, true);
  store.saveState(merge(store.state, character({ updatedAt: stamp + 2, ledger: ledger([row({ observedAt: stamp + 2 })], stamp + 2) }), alt));
  store.saveState(merge(store.state, { ...alt, updatedAt: stamp + 3 }, character({ updatedAt: stamp + 3, clientBuild: oldBuild })));
  store = new Store(dir);
  const [owner, other] = store.state.profiles;
  assert.equal(owner.ledger, undefined);
  assert.deepEqual(owner.badgeAwards, [storm]);
  assert.deepEqual(badgeBook(store.state, owner.id).holders[storm], [owner.name]);
  assert.equal(badge(owner).earned, true);
  assert.equal(badge(owner).at, undefined);
  assert.equal(badge(owner, exalted).earned, false);
  assert.equal(badge(other).earned, false);
  assert.equal(badgeBook(store.state).character.id, other.id);
});

test("a pre-medal save backfills before the first newer save can replace the standing", () => {
  const state = merge(defaultState(), character({ ledger: ledger([row()]) }));
  delete state.profiles[0].badgeAwards;
  const updatedAt = stamp + 1;
  const [profile] = merge(state, character({ updatedAt, ledger: ledger([row({ standing: 6, observedAt: updatedAt })], updatedAt) })).profiles;
  assert.equal(profile.ledger.reputations.factions[0].standing, 6);
  assert.deepEqual(profile.badgeAwards, [storm]);
  assert.equal(badge(profile).earned, true);
});

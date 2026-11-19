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
const pack = require("../data/forever/pack.json");

const chains = [
  ["quest-chain-defias-westfall", [65, 132, 135, 141, 142]],
  ["quest-chain-husbands-revenge", [440, 441, 530]],
  ["quest-chain-missing-shipment", [887, 890, 892, 888]],
];
const builds = ["1.60.1.70888", "1.60.1.70862"];
const [defias, ids] = chains[0];
const stamp = 1795000000;
const history = (...ids) => ({ recent: [], completedIdsKnown: true, completedIds: [...ids].sort((a, b) => a - b) });
const character = (id, fields = {}) => ({ id, name: id, realm: "Fixture", className: "Mage", level: 25, updatedAt: stamp, clientBuild: builds[0], ...fields });
function merge(state, ...characters) {
  const { id: activeId, updatedAt: observedAt } = characters[0];
  const saved = `BackstageForeverExport = [=[${JSON.stringify({ schema: 1, activeId, observedAt, characters })}]=]`;
  return mergeSnapshot(state, parseSavedVariables(saved));
}
const find = (p, id = defias) => badgesFor(p, { desktop: true }).badges.find(b => b.id === id);

for (const [id, steps] of chains) {
  test(`${id} needs all reviewed quest IDs on each verified build`, () => {
    for (const [index, questId] of steps.entries()) {
      const quest = pack.quests[questId];
      assert.equal(quest.nextQuestId, steps[index + 1]);
      assert.ok(quest.turnIns.length > 0, `quest ${questId} has played turn-in evidence in the bundled pack`);
    }
    for (const clientBuild of builds) {
      const [profile] = merge(defaultState(), character("Owner", { clientBuild, locale: "deDE", history: history(...steps) })).profiles;
      assert.deepEqual(profile.badgeAwards, [id]);
      assert.deepEqual(find(profile, id).progress, { have: steps.length, need: steps.length });
      assert.equal(find(profile, id).earned, true);
      assert.equal(find(profile, id).desktopOnly, true);
      assert.equal(find(profile, id).at, undefined);
      assert.ok(!badgesFor(profile).badges.some(b => b.id === id));
      for (const missing of steps) {
        const [partial] = merge(defaultState(), character("Partial", { clientBuild, history: history(...steps.filter(q => q !== missing), 155, 166) })).profiles;
        assert.equal(find(partial, id).earned, false);
        assert.deepEqual(find(partial, id).progress, { have: steps.length - 1, need: steps.length });
        assert.deepEqual(find(partial, id).questSteps, steps.map(questId => ({
          questId, title: pack.quests[questId].title, confirmed: questId !== missing,
        })));
      }
    }
  });
}

test("known empty history is zero; unsupported builds and counts without known IDs are unavailable", () => {
  const zero = merge(defaultState(), character("Zero", { history: history() })).profiles[0];
  assert.deepEqual(find(zero).progress, { have: 0, need: ids.length });
  assert.deepEqual(find(zero).questSteps?.map(step => step.confirmed), ids.map(() => false));
  for (const fields of [
    { clientBuild: undefined, history: history(...ids) },
    { clientBuild: "1.60.1.70840", history: history(...ids) },
    { history: { recent: [], completedCount: 500 } },
    { history: { ...history(...ids), completedIdsKnown: false } },
    { history: { recent: ids.map(id => ({ id, title: "Same title", completedAt: stamp + 1 })) } },
  ]) {
    const [profile] = merge(defaultState(), character("Owner", fields)).profiles;
    assert.equal(profile.badgeAwards, undefined);
    assert.equal(find(profile).earned, false);
    assert.equal(find(profile).progress, undefined);
    assert.equal(find(profile).progressUnavailable, true);
    assert.equal(find(profile).questSteps, undefined);
  }
  assert.throws(() => merge(defaultState(), character("Malformed", {
    history: { ...history(...ids), completedIds: [...ids, ids[0]] },
  })), /Invalid quest or experience snapshot/);
  assert.equal(find({ clientBuild: builds[0], history: history(...ids) }).earned, false);
});

test("qualifying saved awards are character-owned and survive history loss and restart", (t) => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "bf-quest-badge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  store.saveState(merge(store.state, character("Owner", { history: history(...ids.slice(0, -1)) }), character("Alt", { history: history(ids.at(-1)) })));
  assert.deepEqual(badgeBook(store.state).holders[defias], []);
  for (const updatedAt of [stamp - 1, stamp]) {
    const stale = merge(store.state, character("Owner", { updatedAt, history: history(...ids) }));
    assert.equal(find(stale.profiles[0]).earned, false);
  }
  store.saveState(merge(store.state, character("Owner", { updatedAt: stamp + 1, history: history(...ids) })));
  store.saveState(merge(store.state, character("Alt", { updatedAt: stamp + 2 }), character("Owner", { updatedAt: stamp + 2, clientBuild: "1.60.1.79999" })));
  store = new Store(dir);
  const [owner, alt] = store.state.profiles;
  assert.equal(owner.history, undefined);
  assert.deepEqual(owner.badgeAwards, [defias]);
  assert.deepEqual(badgeBook(store.state, owner.id).holders[defias], [owner.name]);
  assert.equal(find(owner).earned, true);
  assert.equal(find(owner).at, undefined);
  assert.equal(find(owner).questSteps, undefined);
  assert.equal(find(alt).earned, false);
  assert.equal(find(alt).questSteps, undefined);
  assert.equal(badgeBook(store.state).character.id, alt.id);
});

test("legacy completion evidence is recognized before its first replacement", () => {
  const state = merge(defaultState(), character("Owner", { history: history(...ids) }));
  delete state.profiles[0].badgeAwards;
  assert.equal(find(state.profiles[0]).earned, true);
  const [profile] = merge(state, character("Owner", { updatedAt: stamp + 1 })).profiles;
  assert.equal(profile.history, undefined);
  assert.deepEqual(profile.badgeAwards, [defias]);
});

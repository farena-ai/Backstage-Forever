"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerKnowledgeHandlers } = require("../src/core/knowledge-ipc.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");

const item = (id, name, inventoryType, classId, subclassId, extra) => ({
  id, name, quality: 2, itemLevel: 15, requiredLevel: 10, classId, subclassId, inventoryType, slot: null, kind: null, armor: null, stats: [],
  damage: null, speed: null, dps: null, sellPrice: 100, bonding: null, classes: null, iconFileId: 1, ...extra,
});
// Quest 9 "The Killing Fields": leather pants, cloth robe or a bow.
const FACTS = {
  3578: item(3578, "Harvester's Pants", 7, 4, 2, { armor: 61, stats: [{ stat: "Spirit", amount: 3 }, { stat: "Agility", amount: 2 }] }),
  1561: item(1561, "Harvester's Robe", 20, 4, 1, { armor: 28, stats: [{ stat: "Spell Power", amount: 2 }, { stat: "Spirit", amount: 2 }] }),
  276695: item(276695, "Harvester's Pestslayer", 15, 2, 2, { dps: 6, damage: { min: 9, max: 17 }, speed: 2.2, stats: [{ stat: "Agility", amount: 3 }, { stat: "Stamina", amount: 3 }] }),
  2504: item(2504, "Worn Shortbow", 15, 2, 2, { dps: 1.7, requiredLevel: 1 }),
};

function setup(profile, gameData) {
  const index = new KnowledgeIndex(structuredClone(require("../data/forever/pack.json")));
  const handlers = {};
  registerKnowledgeHandlers({
    handle: (name, fn) => (handlers[name] = fn),
    knowledge: { setContext() {}, index: () => index },
    getState: () => ({ profiles: [profile], activeProfileId: profile.id }),
    connected: () => false,
    clipboard: { writeText() {} },
    ...(gameData ? { gameData } : {}),
  });
  return handlers;
}

test("quest details gain reward facts and a pick only when game data is available", () => {
  const profile = { id: "p", className: "Hunter", level: 15, readiness: { equipment: [{ slot: 18, itemId: 2504 }, { slot: 7, itemId: 999999 }] } };
  const plain = setup(profile).questDetails("p", 9);
  assert.equal(plain.rewards.choices.length, 3);
  assert.ok(plain.rewards.choices.every((c) => !("details" in c)));
  assert.equal("rewardPick" in plain, false);

  const asked = [];
  const gameData = { items: (ids) => { asked.push(ids); return ids.map((id) => FACTS[id] || null); } };
  const rich = setup(profile, gameData).questDetails("p", 9);
  assert.deepEqual(rich.rewards.choices.map(({ details, ...rest }) => rest), plain.rewards.choices, "existing reward fields are unchanged");
  assert.deepEqual(rich.rewards.choices.map((c) => c.details.name), ["Harvester's Pants", "Harvester's Robe", "Harvester's Pestslayer"]);
  assert.equal(rich.rewardPick.itemId, 276695);
  assert.equal(rich.rewardPick.upgrade, true);
  assert.equal(rich.rewardPick.equipmentKnown, true);
  assert.ok(rich.rewardPick.reasons.includes("+4.3 ranged DPS"));
  const { rewards, rewardPick, ...rest } = rich;
  const { rewards: r0, ...plainRest } = plain;
  assert.deepEqual(rest, plainRest, "nothing else changes");
  assert.deepEqual(asked[1], [2504, 999999], "worn items are looked up from the saved equipment");

  // A caster with unknown equipment gets the robe, without claiming an empty slot.
  const mage = setup({ id: "m", className: "Mage", level: 15 }, gameData).questDetails("m", 9);
  assert.equal(mage.rewardPick.itemId, 1561);
  assert.equal(mage.rewardPick.equipmentKnown, false);
  assert.equal(mage.rewardPick.reasons.includes("Fills an empty slot"), false);

  // No class: facts are attached but nothing is picked. No facts at all: shape is unchanged.
  assert.equal("rewardPick" in setup({ id: "x" }, gameData).questDetails("x", 9), false);
  assert.deepEqual(setup(profile, { items: (ids) => ids.map(() => null) }).questDetails("p", 9), plain);
  assert.deepEqual(setup(profile, { items: () => { throw Error("boom"); } }).questDetails("p", 9), plain);
});

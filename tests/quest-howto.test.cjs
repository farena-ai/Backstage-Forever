"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { buildHowTo, hints, objectHint } = require("../src/core/quest-howto.cjs");
const base = (objectives, extra = {}) => ({ record: { title: "T", objectives, objectiveEvidence: "Do the thing." }, givers: [{ name: "Giver", positions: [{ mapId: 1, x: 0.5, y: 0.5 }] }], turnIns: [], mapNames: { 1: "Durotar" }, ...extra });
test("own looting beats community data, and says object vs creature", () => {
  const d = base([{ index: 1, type: "item", required: 8, objectId: 9 }], { objectiveNames: { 1: { name: "Elixir" } }, itemSources: [{ itemId: 9, sources: [{ kind: "object", name: "Bottle Crate", positions: [{ mapId: 1, x: 0.094, y: 0.678 }] }] }] });
  const h = buildHowTo(d, { loot: { items: { 9: [{ kind: "npc", id: 5, name: "Gnoll", chance: 0.3, drops: 4 }] } } });
  assert.match(h.steps[0].text, /Collect 8 Elixir: you've already found these, so pick them up from “Bottle Crate”/);
  assert.match(h.steps[0].text, /Durotar around 9\.4, 67\.8/);
  assert.deepEqual(h.basis, ["your own looting"]);
  assert.match(h.steps.at(-1).text, /Hand it in to Giver/);
});
test("community drops list creatures with their chance; objects are clickable", () => {
  const d = base([{ index: 1, type: "item", required: 4, objectId: 9 }], { objectiveNames: { 1: { name: "Tusk" } } });
  const h = buildHowTo(d, { loot: { items: { 9: [{ kind: "npc", id: 5, name: "Boar", chance: 0.4, drops: 9 }, { kind: "object", id: 7, name: "Tusk Pile", chance: 1, drops: 3 }] } } });
  assert.match(h.steps[0].text, /found in “Tusk Pile” \(click them in the world\); or dropped by Boar \(40% of kills\)/);
});
test("kill objectives carry levels and an elite warning", () => {
  const d = base([{ index: 1, type: "monster", required: 6, objectId: 3 }], { objectiveNames: { 1: { name: "Brute" } }, objectiveCreatures: { 1: { minLevel: 14, maxLevel: 16, elite: true } } });
  const h = buildHowTo(d);
  assert.match(h.steps[0].text, /Kill 6 Brute \(level 14–16\)/); assert.match(h.steps[0].warn, /Elite/);
});
test("with nothing known, the quest text decides objects vs drops and it is marked a guess", () => {
  const d = base([{ index: 1, type: "item", required: 8, objectId: 9 }], { questText: { description: "Travel to the ruins of Shadowvale. Recover some bottles for me." } });
  const h = buildHowTo(d);
  assert.ok(h.steps[0].guess); assert.match(h.steps[0].text, /clickable objects/);
  assert.deepEqual(h.questSays, ["Travel to the ruins of Shadowvale.", "Recover some bottles for me."]);
  assert.ok(objectHint("bottles lying in the ruins")); assert.ok(!objectHint("Slay the gnolls"));
  assert.equal(hints("").length, 0);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { quickAnswer, questQuery } = require("../src/core/quick-answers.cjs");
const { createCompanionTools } = require("../src/core/companion-tools.cjs");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { LevelingAdvisor } = require("../src/core/leveling.cjs");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const pack = read("data/forever/pack.json"), insights = read("data/forever-insights/pack.json");
const elixir = Object.values(pack.quests).find((q) => q.title === "That Shadowvale Green Elixir");

function setup(profile) {
  const index = new KnowledgeIndex(pack);
  const tools = createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index, contextOptions: {} });
  const advisor = new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [profile] }), knowledge: { bundled: { pack } }, insights });
  return { tools, advise: () => advisor.advise("A") };
}
const hunter = { id: "A", name: "Vael", level: 16, faction: "Horde", className: "Hunter", race: "Orc", location: { mapId: 1413, x: 0.5, y: 0.3 }, quests: [], history: { completedIdsKnown: true, completedIds: [] } };

test("question scaffolding is stripped to the quest title", () => {
  assert.equal(questQuery("how do I do That Shadowvale Green Elixir?"), "shadowvale green elixir");
  assert.equal(questQuery('help with "Raptor Thieves" please'), "Raptor Thieves");
});
test("how do I do <quest> answers with steps, without any AI model", { skip: !elixir && "quest not in pack" }, () => {
  const a = quickAnswer("how do I do That Shadowvale Green Elixir?", setup(hunter));
  assert.equal(a.kind, "quick"); assert.equal(a.topic, "quest"); assert.equal(a.questId, elixir.id);
  assert.match(a.text, /How to do it:/);
  assert.match(a.text, /Bottle/);
});
test("what should I do next uses the Now advice", () => {
  const a = quickAnswer("What should I do next?", setup(hunter));
  assert.equal(a.topic, "next");
  assert.match(a.text, /Level in The Barrens/);
});
test("what do I train names the trainer and spells", () => {
  const a = quickAnswer("what can I learn at my trainer", setup(hunter));
  assert.equal(a.topic, "train");
  assert.match(a.text, /Nearest trainer: .+/);
});
test("other questions are left to the AI model (or the no-model message)", () => {
  assert.equal(quickAnswer("tell me a story about orcs", setup(hunter)), null);
  assert.equal(quickAnswer("", setup(hunter)), null);
});

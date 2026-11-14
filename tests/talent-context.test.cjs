"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const T = require("../src/core/talent-context.cjs");
const { quickAnswer } = require("../src/core/quick-answers.cjs");
const { CompanionContext } = require("../src/core/companion-context.cjs");
const { CompanionRequest } = require("../src/core/companion-request.cjs");
const { MemoryService } = require("../src/core/memory.cjs");
const { CompanionService } = require("../src/core/companion-service.cjs");
const providers = require("../src/core/providers.cjs");

const file = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "talents-synthetic.json"), "utf8"));
const source = { trees: (c) => file.data.talents[c] || null, build: () => file.build };
// The real failing exchange: level 16 Undead Priest, Horde, "Use my active character" on.
const rolica = { id: "R", name: "Rolica", className: "Priest", race: "Undead", faction: "Horde", level: 16 };
const alliance = { ...rolica, race: "Human", faction: "Alliance" };
const resolve = (q, o = {}) => T.resolveTalentQuestion(q, { profile: rolica, shareProfile: true, source, ...o });
const REAL = [
  "For Holy talents what are the best for the first 7",
  "I see twilight focus, improved renew, holy specialization, spell warding, divine fury",
  "so in those where should the first 7 go",
  "I need the first 7 talents for holy spec",
];

test("intent: talent words, talent names, follow-ups; ordinary questions are not talent questions", () => {
  for (const q of ["what talents should I take", "is my spec ok", "should I respec", "how many talent points at 20", "what does Improved Renew do"]) assert.equal(resolve(q)?.intent, "strong", q);
  for (const q of ["Spell Warding or Divine Fury?", "best build for leveling", "Improved renew only goes to 3/3"]) assert.ok(resolve(q), q);
  for (const q of ["Where should I level?", "how do I get from org to tb", "what do I train", "where is the innkeeper"]) assert.equal(resolve(q), null, q);
  assert.ok(resolve(REAL[2], { previousQuestion: REAL[1] }), "follow-up keeps the talent topic");
  assert.equal(T.resolveTalentQuestion(REAL[2], { source }), null, "alone, with no class to go on, that sentence is not a talent question");
});

test("class: named class beats the character, the character's class next, else ask (no talent data)", () => {
  assert.equal(resolve("warrior talents").className, "Warrior");
  assert.equal(resolve("what talents should I take").className, "Priest");
  assert.equal(resolve("first 5 arms talents").className, "Warrior", "a tree only warriors have");
  const off = T.resolveTalentQuestion("what talents should I take", { profile: rolica, shareProfile: false, source });
  assert.equal(off.status, "ask"); assert.match(off.text, /Which class/);
  assert.equal(T.talentBlock(off), "", "asking sends no talent data");
  assert.equal(T.resolveTalentQuestion("what talents should a priest take", { shareProfile: false, source }).className, "Priest");
  assert.equal(T.resolveTalentQuestion("what does Mortal Strike do", { shareProfile: false, source }).className, "Warrior", "one class owns the talent");
  const missing = T.resolveTalentQuestion("mage talents", { source });
  assert.equal(missing.status, "unavailable"); assert.match(missing.text, /can't read the Mage talent trees/);
  assert.match(T.talentBlock(missing), /not available.*never use retail|Never use retail/is);
  // Faction-neutral: the same answer for Alliance and Horde.
  assert.equal(T.talentQuickAnswer(resolve(REAL[3])).text, T.talentQuickAnswer(resolve(REAL[3], { profile: alliance })).text);
});

test("regression: every phrasing of the real exchange gets the real Holy tree with max ranks and tier gates", () => {
  let prev = null;
  for (const q of REAL) {
    const r = resolve(q, { previousQuestion: prev });
    assert.equal(r?.status, "ok", q); assert.equal(r.className, "Priest", q); assert.equal(r.tabName, "Holy", q);
    const b = T.talentBlock(r);
    assert.match(b, /WoW Forever's actual talent trees/);
    assert.match(b, /Never use retail/);
    assert.match(b, /Tier N of a tree opens once \(N-1\)\*5 points/);
    assert.match(b, /level 16 .*7 talent points available; with 7 points all in one tree, tiers 1-2 can be reached \(tier 2 from point 6\)/);
    assert.match(b, /Tier 1 \(needs 0 points in Holy\):\n {2}- Twilight Focus \(max rank 2\)/);
    assert.match(b, /Improved Renew \(max rank 3\)/);
    assert.match(b, /Holy Specialization \(max rank 5\)/);
    assert.match(b, /Tier 2 \(needs 5 points in Holy\):\n {2}- Spell Warding \(max rank 5\)/);
    assert.match(b, /Searing Light \(max rank 2; requires Holy Specialization 5\/5\)/, "prerequisite ids become names");
    assert.match(b, /Lightwell \(max rank 1; requires Spirit of Redemption 1\/1\)/);
    assert.match(b, /Holy Nova \(max rank 1\): no description in the game data/);
    assert.match(b, /\(unnamed talent in the game data\) \(max rank 2\)/);
    assert.match(b, /values may be for one rank/);
    assert.match(b, /rank 5 text: Increases the amount healed by your spells by 10%/, "a max-rank description is given only when the data has one");
    assert.doesNotMatch(b, /Improved Spirit|Improved Power Word: Shield|Renew \(max rank 5\)/);
    assert.ok(b.indexOf("Holy tree:") < b.indexOf("Discipline tree:"), "the asked tree comes first");
    prev = q;
  }
});

test("regression: offline 'first 7 holy talents' lists only real talents, real max ranks, tier gates", () => {
  for (const [q, prev] of [[REAL[3], null], [REAL[0], null], [REAL[2], REAL[1]]]) {
    const a = T.talentQuickAnswer(resolve(q, { previousQuestion: prev }));
    assert.equal(a.topic, "talent-tree", q);
    assert.match(a.text, /First 7 points in Holy \(Priest\)/);
    assert.match(a.text, /Points 1-5 can only go in tier 1:\n• Twilight Focus \(max 2\).*\n• Improved Renew \(max 3\).*\n• Holy Specialization \(max 5\)/);
    assert.match(a.text, /Points 6-7 can also go in tier 2 \(it opens after 5 points in Holy\):\n• Spell Warding \(max 5\).*\n• Divine Fury \(max 5\)/);
    assert.doesNotMatch(a.text, /tier 3|Holy Nova|Improved Spirit|Power Word: Shield/);
    assert.match(a.text, /From WoW Forever's talent data in your game client \(build 0\.0\.0\.test\)/);
  }
});

test("offline answers: what does <talent> do, what should I take, points at level N", () => {
  const d = T.talentQuickAnswer(resolve("what does improved renw do?"));
  assert.match(d.text, /\*\*Improved Renew\*\*: Priest, Holy tree, tier 1 \(needs 0 points in Holy\), max rank 3\./);
  assert.match(d.text, /talent data in your game client/);
  assert.match(T.talentQuickAnswer(resolve("what does holy nova do")).text, /no description/);
  const cross = T.talentQuickAnswer(T.resolveTalentQuestion("what does Deflection do", { source }));
  assert.match(cross.text, /Warrior, Arms tree, tier 1/);
  const plan = T.talentQuickAnswer(resolve("what talents should I take"));
  assert.equal(plan.topic, "talent-plan");
  assert.match(plan.text, /Priest talents at level 16\*\*: Backstage path Shadow/);
  assert.match(plan.text, /You have 7 points at level 16/);
  assert.match(plan.text, /Spirit Tap 1-5\/5 \(Shadow tier 1\)/);
  assert.match(plan.text, /don't exist in your game's trees/, "path talents missing from the game are named as missing, never invented");
  const lvl = T.talentQuickAnswer(resolve("what talents should I take at level 12"));
  assert.match(lvl.text, /at level 12/); assert.match(lvl.text, /You have 3 points/);
  const pts = T.talentQuickAnswer(T.resolveTalentQuestion("how many talent points at level 30", { source }));
  assert.equal(pts.topic, "talent-points"); assert.match(pts.text, /21 talent points at level 30/);
  assert.match(T.talentQuickAnswer(T.resolveTalentQuestion("how many talent points do I get", { source })).text, /level N gives N − 9/);
  // Through the shared quick-answer path too.
  assert.equal(quickAnswer("what does improved renew do", { talent: resolve("what does improved renew do") }).topic, "talent");
});

test("block size stays bounded: a large synthetic class is trimmed to the budget, whole lines only", () => {
  const big = { className: "Druid", classId: 11, tabs: ["Balance", "Feral Combat", "Restoration"].map((name, i) => ({ id: 900 + i, name, order: i, talents: Array.from({ length: 22 }, (_, k) => ({ id: 9000 + i * 100 + k, row: Math.floor(k / 3), column: k % 3, maxRank: 5, ranks: [1, 2, 3, 4, 5], name: `${name} Talent ${k}`, descriptions: ["x".repeat(400), null, null, null, "y".repeat(400)], prerequisites: k ? [{ talentId: 9000 + i * 100 + k - 1, rank: 1 }] : [] })) })) };
  const src = { trees: (c) => (c === "Druid" ? big : null), build: () => "b" };
  const r = T.resolveTalentQuestion("druid talents at level 40", { source: src });
  const full = T.talentBlock(r);
  assert.ok(full.length <= T.TALENT_MAX, `${full.length}`);
  assert.match(full, /Never use retail/);
  const small = T.talentBlock(r, { maxChars: 3000 });
  assert.ok(small.length <= 3000, `${small.length}`); assert.match(small, /Never use retail/);
  for (const c of ["Priest", "Warrior"]) assert.ok(T.talentBlock(resolve(`${c} talents`)).length < 6000);
});

// --- Companion service: what reaches the AI, and what never leaves the app ------------------------
function fixture({ provider = "ollama", authMode = "api", model = "fixture", shared = true, travel = null } = {}) {
  const state = { activeProfileId: "R", profiles: [{ ...rolica }], provider: { id: provider, model, endpoint: "http://localhost:11434", authMode }, memories: [] };
  const store = { state, getKey: () => "KEY" }, context = new CompanionContext(() => state), requests = new CompanionRequest(context), memory = new MemoryService({ store, context }), seen = [];
  const transport = async (i) => { seen.push(i); return "Answer"; };
  const service = new CompanionService({ store, context, requests, memory, ai: { ...providers, ask: transport }, chatgpt: { ask: transport }, claude: { ask: transport }, knowledge: { index: () => undefined }, travel, lookups: false, talents: source });
  const ask = (prompt) => service.ask({ provider, prompt, profileId: "R", shareProfile: shared, memoryIds: [] });
  return { seen, ask, service };
}
test("service: each real phrasing sends the Holy block to the model; follow-ups keep it", async () => {
  const f = fixture();
  for (const q of REAL) {
    const r = await f.ask(q);
    assert.equal(r.kind, "ai", q);
    const ctx = f.seen.at(-1).context;
    assert.match(ctx, /WoW Forever talents for Priest/, q);
    assert.match(ctx, /Improved Renew \(max rank 3\)/, q);
    assert.ok(ctx.length < 20000, "within the provider context limit");
  }
  assert.equal(f.seen.length, REAL.length);
});
test("service: Claude subscription gets the block as its own field", async () => {
  const f = fixture({ provider: "anthropic", authMode: "subscription" });
  await f.ask(REAL[0]);
  assert.match(f.seen[0].talents, /Twilight Focus \(max rank 2\)/);
});
test("service: sharing off and no class named asks which class, without any AI call or talent data", async () => {
  const f = fixture({ shared: false });
  const r = await f.ask("what talents should I take");
  assert.equal(r.kind, "quick"); assert.equal(r.topic, "talent-class"); assert.match(r.text, /Which class/);
  assert.equal(f.seen.length, 0);
  await f.ask("Where should I level?");
  assert.doesNotMatch(f.seen[0].context || "", /talent/i, "unrelated questions carry no talent data");
});
test("service: no model answers talent questions offline", async () => {
  const f = fixture({ model: "" });
  const r = await f.ask(REAL[3]);
  assert.equal(r.kind, "quick"); assert.equal(r.topic, "talent-tree"); assert.match(r.text, /Improved Renew \(max 3\)/);
});
test("service: 'Improved renew only goes to 3/3' is a talent remark, never the travel reference", async () => {
  const calls = [];
  const travel = { resolve: (q) => { calls.push(q); return { text: "Which destination or transport stop do you mean from Improved renew only goes?" }; }, clear() {}, commit: (x) => x };
  const f = fixture({ travel });
  await f.ask(REAL[3]);
  const r = await f.ask("Improved renew only goes to 3/3");
  assert.equal(r.kind, "ai"); assert.deepEqual(calls, []);
  assert.match(f.seen.at(-1).context, /Improved Renew \(max rank 3\)/);
  const g = fixture({ travel });
  await g.ask("how do I get from org to tb");
  assert.deepEqual(calls, ["how do I get from org to tb"], "real trips still use the travel reference");
});

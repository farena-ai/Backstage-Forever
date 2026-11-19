"use strict";
// The companion benchmark as a gate (0.58): 100 real player questions with answers checked against
// WoW Forever's own data. A change may not make the companion understand less or answer worse.
const test = require("node:test"), assert = require("node:assert/strict");
const { runBench, loadQuestions, makeService, PROFILES } = require("../scripts/companion-bench.cjs");
const { buildProfessionCoach } = require("../src/core/profession-coach.cjs");

const INTENTS = new Set(["npc-location", "travel", "trainer", "vendor", "item-source", "quest-next", "quest-turnin", "quest-info", "dungeon", "profession", "rp", "lore", "refuse", "clarify"]);

test("every benchmark question names a known character, a real intent and the data it was checked against", () => {
  const qs = loadQuestions();
  assert.equal(qs.length, 100);
  assert.equal(new Set(qs.map((q) => q.id)).size, 100);
  for (const q of qs) {
    assert.ok(INTENTS.has(q.expect.intent), `${q.id}: ${q.expect.intent}`);
    assert.ok(["horde-priest-21", "horde-hunter-16", "alliance-warrior-12", "alliance-mage-34", "none"].includes(q.profile), q.id);
    assert.ok(typeof q.evidence === "string" && q.evidence.length > 10, `${q.id} cites its evidence`);
  }
  // Alliance matters as much as Horde.
  const horde = qs.filter((q) => q.profile.startsWith("horde")).length, alliance = qs.filter((q) => q.profile.startsWith("alliance")).length;
  assert.ok(Math.abs(horde - alliance) <= 10, `balanced factions (${horde} Horde, ${alliance} Alliance)`);
});

test("the companion understands and answers from Forever data at least as well as 0.58 did", { timeout: 120000 }, async () => {
  const r = await runBench();
  // 0.57 baseline: covered 15%, correct locally 5%, understood 19%.
  assert.ok(r.scores.covered >= 95, `covered ${r.scores.covered}%`);
  assert.ok(r.scores.localCorrect >= 92, `correct locally ${r.scores.localCorrect}%`);
  assert.ok(r.scores.understood >= 97, `understood ${r.scores.understood}%`);
  assert.deepEqual(r.abstention, { n: 8, correct: 8 });
  assert.equal(r.byCategory.refuse.local, r.byCategory.refuse.n, "every cheating or off-topic request is declined");
  for (const k of ["npc-location", "travel", "trainer", "vendor", "item-source", "dungeon"]) assert.ok(r.byCategory[k].local >= r.byCategory[k].n - 1, `${k}: ${r.byCategory[k].local}/${r.byCategory[k].n}`);
  assert.equal(r.rows.filter((x) => x.error).length, 0, r.rows.filter((x) => x.error).map((x) => `${x.id}: ${x.error}`).join("; "));
});

test("questions written without seeing the companion's code are understood and answered too (held-out set, 0.59)", { timeout: 120000 }, async () => {
  const qs = loadQuestions("heldout");
  assert.equal(qs.length, 60);
  for (const q of qs) assert.ok(INTENTS.has(q.expect.intent) && q.evidence, q.id);
  const r = await runBench({ questions: qs });
  // First measured at 56.7% covered, 46.7% correct locally, 61.7% understood.
  assert.ok(r.scores.covered >= 95, `covered ${r.scores.covered}%`);
  assert.ok(r.scores.localCorrect >= 85, `correct locally ${r.scores.localCorrect}%`);
  assert.ok(r.scores.understood >= 88, `understood ${r.scores.understood}%`);
  assert.deepEqual(r.abstention, { n: 7, correct: 7 });
  assert.equal(r.byCategory.refuse.local, r.byCategory.refuse.n);
});

test("1.4 (J15): boss tips, class unlocks and reputation questions are answered locally", async () => {
  const { runBench } = require("../scripts/companion-bench.cjs");
  const qs = require("./fixtures/companion-bench/unlocks.json").questions;
  const res = await runBench({ questions: qs });
  const rows = res.rows || res;
  assert.equal(rows.length, 9);
  const wrong = rows.filter((r) => !r.localCorrect).map((r) => `${r.id} → ${r.route}: ${r.text}`);
  assert.deepEqual(wrong, []);
});

const workshopAt = "2026-11-11T12:00:00.000Z";
const supplyQuestion = "What materials do I need for recipe #2330 for 2 crafts?";
function workshopService({ model = false, build = "1.60.1.70862" } = {}) {
  const profile = structuredClone(PROFILES["alliance-mage-34"]);
  delete profile.updatedAt;
  profile.realm = "Synthetic";
  profile.clientBuild = build;
  profile.source.updatedAt = workshopAt;
  const col = items => ({ items, observedAt: workshopAt, complete: true });
  profile.readiness = { workshop: {
    professions: col([{ skillLineId: 171, professionId: 4, name: "Alchemy", rank: 20, maxRank: 75 }]),
    recipes: col([{ id: 2330, name: "Minor Healing Potion", skillLineId: 171, canSkillUp: true,
      reagentsKnown: true, reagents: [{ itemId: 765, name: "Silverleaf", required: 2 }] }]),
    materials: { ...col([{ itemId: 765, count: 3 }]), scope: "bags-0-4" },
  } };
  const { service, store, seen } = makeService(profile, { model });
  return { service, store, seen, profileId: profile.id, ask: (prompt = supplyQuestion, shareProfile = true) =>
    service.ask({ provider: "ollama", prompt, profileId: store.state.activeProfileId, shareProfile, memoryIds: [] }) };
}

test("E1: exact recipe material answers use the Workshop carried projection without a provider", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("offline answer requested the network"));
  for (const model of [false, true]) {
    const { store, seen, profileId, ask } = workshopService({ model });
    const [row] = buildProfessionCoach(store.state, profileId, { recipeId: 2330, crafts: 2 }).shoppingList.rows;
    const before = structuredClone(store.state);
    store.getKey = () => assert.fail("offline answer read credentials");
    const reply = await ask();
    assert.equal(reply.kind, "quick");
    assert.equal(reply.topic, "profession-materials");
    assert.match(reply.text, /Minor Healing Potion \(recipe #2330\)/);
    assert.match(reply.text, /Tinkla.*1\.60\.1\.70862.*2026-11-11/);
    assert.ok(reply.text.includes(`${row.name} (item #${row.itemId}): ${row.required} required, ${row.have} saved carried, ${row.projectedPurchase} short`), reply.text);
    assert.match(reply.text, /not live/i);
    assert.deepEqual(seen, []);
    assert.deepEqual(store.state, before);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("E1: Workshop exchanges never join provider history or correction continuity", async () => {
  const { ask, seen, service, profileId } = workshopService({ model: true });
  const ordinary = "Which pet should my hunter use in WoW Forever?";
  assert.equal((await ask(ordinary)).kind, "ai");
  const local = await ask();
  assert.match(local.text, /Tinkla.*1\.60\.1\.70862.*2026-11-11/);
  assert.match(local.text, /3 saved carried, 1 short/);
  assert.equal(seen.length, 1);
  const correction = service.session.prepare({ owner: service.owner(profileId), shareProfile: true, memoryIds: [],
    prompt: "This is for wow forever, not retail" });
  assert.equal(correction.questionForEvidence, ordinary);
  const next = await ask("Tell me some lore about the Titans.");
  assert.equal(next.kind, "ai");
  assert.doesNotMatch(seen[1].prompt, /recipe #2330|Silverleaf|Tinkla|70862|2026-11-11|saved carried/);
  assert.ok(seen[1].prompt.includes(ordinary), "ordinary provider continuity survives the offline exchange");
  assert.equal(next.conversation.usedTurns, 1);
  assert.equal(local.conversation.usedTurns, 0);
});

test("E1: a sharing change on a Workshop turn still retires earlier provider history", async () => {
  const { ask, seen } = workshopService({ model: true });
  assert.equal((await ask("Which pet should my hunter use in WoW Forever?")).kind, "ai");
  const off = await ask(supplyQuestion, false);
  assert.match(off.text, /Use my active character/);
  assert.equal(off.conversation.resetReason, "scope-change");
  assert.equal(seen.length, 1);
  const next = "Tell me some lore about the Titans.";
  assert.equal((await ask(next)).kind, "ai");
  assert.equal(seen[1].prompt, next);
});

test("E1: a matching reference is historical only, and cannot follow the active character across builds", async () => {
  const { store, ask, seen } = workshopService({ model: true });
  assert.match((await ask()).text, /Historical gathering reference: Silverleaf .*70862.*current availability and access unknown/);
  const alt = structuredClone(store.state.profiles[0]);
  Object.assign(alt, { id: "other", name: "Other Mage", clientBuild: "1.60.1.70888" });
  alt.source.id = "other-source";
  alt.readiness.workshop.materials.items = [];
  store.state.profiles.push(alt);
  store.state.activeProfileId = alt.id;
  const { text } = await ask();
  assert.match(text, /Other Mage.*70888/);
  assert.match(text, /4 required, 0 saved carried, 4 short/);
  assert.doesNotMatch(text, /Tinkla|historical gathering reference/i);
  assert.deepEqual(seen, []);
});

test("E1: partial and superseded carried counts do not establish a shortfall", async () => {
  const { store, ask } = workshopService();
  const profile = store.state.profiles[0], materials = profile.readiness.workshop.materials;
  materials.complete = false;
  assert.match((await ask()).text, /at least 3 saved carried, shortfall unknown/);
  materials.items = [];
  const missing = (await ask()).text;
  assert.match(missing, /carried unknown, shortfall unknown/);
  assert.match(missing, /log out and import/);
  materials.complete = true;
  materials.observedAt = "2026-11-10T12:00:00.000Z";
  assert.match((await ask()).text, /carried unknown, shortfall unknown/);
});

test("E1: missing recipe, invalid attempt count and disabled sharing recover locally", async () => {
  const { ask, seen } = workshopService({ model: true });
  assert.match((await ask("Can I craft recipe #2331?")).text, /Recipe #2331: requirements unavailable.*log out and import/);
  assert.match((await ask("Can I craft recipe #2330 for 21 crafts?")).text, /1–20 craft attempts/);
  const off = await ask(supplyQuestion, false);
  assert.match(off.text, /Use my active character/);
  assert.doesNotMatch(off.text, /Silverleaf|Minor Healing Potion|70862/);
  assert.deepEqual(seen, []);
});

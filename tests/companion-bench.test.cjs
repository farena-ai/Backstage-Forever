"use strict";
// The companion benchmark as a gate (0.58): 100 real player questions with answers checked against
// WoW Forever's own data. A change may not make the companion understand less or answer worse.
const test = require("node:test"), assert = require("node:assert/strict");
const { runBench, loadQuestions } = require("../scripts/companion-bench.cjs");

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

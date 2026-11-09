const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateQuestData,
  validateProgress,
} = require("../src/core/quest-data.cjs");
const { buildBrief } = require("../src/core/adventure.cjs");
const { approvedProfile } = require("../src/core/providers.cjs");

test("saved freshness keeps timestamps and classification without routine reload instructions",()=>{
  const profile={source:{updatedAt:"2026-01-01T00:00:00.000Z"}};
  const brief=buildBrief(profile,{now:Date.parse("2026-01-01T00:16:00.000Z")});
  assert.equal(brief.freshness.status,"stale");assert.equal(brief.freshness.ageMinutes,16);assert.equal(brief.freshness.updatedAt,profile.source.updatedAt);
  assert.doesNotMatch(brief.freshness.message,/reload|log out/i);assert.match(brief.freshness.message,/last saved|saved progress/i);
  assert.doesNotMatch(brief.guidance.freshness.message,/reload|log out/i);
});
test("optional observed data preserves unknown vs empty and enforces bounds", () => {
  assert.equal(validateQuestData(undefined), undefined);
  assert.deepEqual(validateQuestData([]), []);
  assert.throws(() => validateQuestData(Array(26).fill({})));
  assert.throws(() => validateProgress({ current: 11, max: 10 }));
  const q = [
    {
      id: 1,
      title: "Observed",
      complete: true,
      objectives: [{ text: "Done", done: true }],
    },
  ];
  assert.deepEqual(validateQuestData(q), q);
  assert.notEqual(validateQuestData(q), q);
  assert.throws(() => validateQuestData([{ ...q[0], notes: "private" }]));
});
test("brief is local, explicit about unknown/stale data and uses actual turnins", () => {
  let b = buildBrief({ name: "A", className: "Mage", level: 12 }, { now: 0 });
  assert.equal(b.quests.known, false);
  assert.equal(b.progress.known, false);
  assert.equal(b.freshness.status, "unknown");
  b = buildBrief(
    {
      name: "A",
      className: "Mage",
      level: 12,
      quests: [{ id: 1, title: "Real quest", complete: true, objectives: [] }],
      progress: { current: 20, max: 100 },
      source: { updatedAt: "2026-01-01T00:00:00.000Z" },
    },
    { now: Date.parse("2026-01-02") },
  );
  assert.equal(b.quests.ready.length, 1);
  assert.equal(b.progress.percent, 20);
  assert.equal(b.freshness.status, "stale");
  assert.match(b.actions[0].prompt, /Real quest/);
});
test("all transports share bounded approved context without private journals", () => {
  const p = {
    name: "A",
    className: "Mage",
    level: 12,
    notes: "SECRET",
    goals: [{ text: "SECRET" }],
    source: { id: "PRIVATE", updatedAt: "2026-01-01T00:00:00.000Z" },
    quests: Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      title: "q",
      complete: false,
      objectives: Array.from({ length: 5 }, () => ({ text: "o", done: false })),
    })),
    progress: { current: 0, max: 100 },
  };
  const c = approvedProfile(p);
  assert.equal(c.quests.length, 10);
  assert.equal(c.quests[0].objectives.length, 3);
  assert.doesNotMatch(JSON.stringify(c), /SECRET|PRIVATE/);
});

"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const at = "2026-11-11T12:00:00.000Z",
  col = (items) => ({ observedAt: at, complete: true, items });
function profile() {
  return {
    id: "p",
    name: "Synthetic",
    realm: "Synthetic",
    className: "Mage",
    level: 12,
    notes: "PRIVATE_NOTES",
    goals: [],
    source: { kind: "wow-addon", id: "PRIVATE_SOURCE_ID", updatedAt: at },
    clientBuild: "1.60.1.70862",
    location: { zone: "Forest", mapId: 1413 },
    quests: [
      {
        id: 42,
        title: "Distant work",
        complete: false,
        objectives: [{ text: "Find things", done: false }],
      },
    ],
    readiness: {
      bags: { free: 1, total: 16 },
      workshop: {
        professions: col([
          {
            skillLineId: 171,
            professionId: 4,
            name: "Alchemy",
            rank: 75,
            maxRank: 75,
          },
        ]),
        recipes: col([
          {
            id: 100,
            skillLineId: 171,
            name: "Potion",
            canSkillUp: true,
            reagentsKnown: true,
            reagents: [{ itemId: 200, required: 2 }],
          },
        ]),
        materials: { ...col([{ itemId: 200, count: 3 }]), scope: "bags-0-4" },
      },
    },
  };
}
function build(p, o) {
  assert.ok(
    fs.existsSync(
      require
        .resolve("../src/core/validation.cjs")
        .replace("validation.cjs", "adventure-coach.cjs"),
    ),
    "Coach policy is not implemented",
  );
  return require("../src/core/adventure-coach.cjs").buildAdventureCoach(p, o);
}
test("coach ranks bag pressure, bounds/detaches public opportunities", () => {
  const p = profile(),
    before = structuredClone(p),
    b = build(p, { mode: "adventure" });
  assert.equal(b.recommendation.kind, "bags");
  assert.ok(b.alternatives.length <= 2);
  assert.doesNotMatch(JSON.stringify(b), /PRIVATE_/);
  b.recommendation.title = "changed";
  assert.deepEqual(p, before);
});
test("modes favor ready/local quests then useful crafts before distant work", () => {
  const p = profile();
  p.readiness.bags.free = 5;
  assert.equal(build(p).recommendation.kind, "craft-ready");
  assert.equal(build(p, { mode: "questing" }).recommendation.kind, "quest");
  p.quests[0].complete = true;
  assert.equal(build(p).recommendation.kind, "quest");
  assert.equal(
    build(p, { mode: "professions" }).recommendation.kind,
    "craft-ready",
  );
  p.quests[0].complete = false;
  p.quests[0].zone = "Forest";
  assert.equal(build(p).recommendation.kind, "quest");
});
test("unknown, partial, stale or ambiguous materials and canSkillUp never become craft ready", () => {
  for (const change of [
    (w) => delete w.materials,
    (w) => (w.materials.complete = false),
    (w) => (w.materials.observedAt = "2026-11-10T12:00:00.000Z"),
    (w) => (w.recipes.items[0].canSkillUp = false),
    (w) => delete w.recipes.items[0].canSkillUp,
    (w) => (w.recipes.items[0].reagentsKnown = false),
    (w) => (w.materials.items = []),
    (w) =>
      (w.recipes.items[0].reagents = Array.from({ length: 11 }, (_, i) => ({
        itemId: i + 1,
        required: 1,
      }))),
  ]) {
    const p = profile();
    p.readiness.bags.free = 5;
    change(p.readiness.workshop);
    const b = build(p, { mode: "professions" });
    assert.ok(
      [b.recommendation, ...b.alternatives].every(
        (x) => x?.kind !== "craft-ready",
      ),
    );
  }
});
test("rank cap is qualified and signatures change only for relevant progress", () => {
  const p = profile();
  p.readiness.bags.free = 5;
  let b = build(p, { mode: "professions" });
  assert.match(b.recommendation.detail, /not guaranteed/);
  const sig = b.recommendation.signature;
  p.source.updatedAt = "2026-11-11T13:00:00.000Z";
  p.progress = { current: 500, max: 1000 };
  assert.equal(build(p, { mode: "professions" }).recommendation.signature, sig);
  p.readiness.workshop.materials.items[0].count++;
  assert.notEqual(
    build(p, { mode: "professions" }).recommendation.signature,
    sig,
  );
  delete p.readiness.workshop.recipes;
  assert.equal(
    build(p, { mode: "professions" }).recommendation.kind,
    "profession-cap",
  );
  assert.match(
    build(p, { mode: "professions" }).recommendation.detail,
    /available/,
  );
});
test("invalid options rejected and absent saved source is unavailable", () => {
  for (const o of [
    { mode: "raid" },
    { mode: "adventure", command: "x" },
    [],
    null,
  ])
    assert.throws(() => build(profile(), o));
  const p = profile();
  delete p.source;
  assert.equal(build(p).status, "unavailable");
});
module.exports = { profile };

test("newer profession rank cannot imply old recipe skill-up capability is current", () => {
  const p = profile();
  p.readiness.bags.free = 5;
  p.source.updatedAt = "2026-11-11T13:00:00.000Z";
  p.readiness.workshop.professions.observedAt = p.source.updatedAt;
  assert.ok(
    [
      build(p, { mode: "professions" }).recommendation,
      ...build(p, { mode: "professions" }).alternatives,
    ].every((x) => x?.kind !== "craft-ready"),
  );
});

test("valid learned recipes in partial catalogs remain eligible only with complete fresh carried materials", () => {
  const p = profile();
  p.readiness.bags.free = 5;
  p.readiness.workshop.recipes.complete = false;
  assert.equal(
    build(p, { mode: "professions" }).recommendation.kind,
    "craft-ready",
  );
  p.readiness.workshop.recipes.items = [];
  assert.ok(
    [
      build(p, { mode: "professions" }).recommendation,
      ...build(p, { mode: "professions" }).alternatives,
    ].every((x) => x?.kind !== "craft-ready"),
  );
});

test("blank local objective prose requires a valid current-game marker; ready turn-ins remain first", () => {
  for (const prose of ["", "   ", " \u00a0 "]) {
    const p = profile();
    p.readiness.bags.free = 5;
    const q = p.quests[0];
    q.zone = "Forest";
    q.objectives = [{ text: prose, done: false }];
    assert.equal(
      build(p).recommendation.kind,
      "craft-ready",
      "Blank prose cannot establish local work",
    );
    q.destination = { mapId: 1413, x: 0.2, y: 0.3 };
    assert.equal(
      build(p).recommendation.kind,
      "quest",
      "Valid current marker remains actionable",
    );
    delete q.destination;
    q.complete = true;
    assert.equal(
      build(p).recommendation.kind,
      "quest",
      "Ready turn-in remains first",
    );
  }
  const p = profile();
  p.readiness.bags.free = 5;
  p.quests[0].zone = "Forest";
  p.quests[0].objectives = [{ text: "Find the scout", done: false }];
  assert.equal(build(p).recommendation.kind, "quest");
});

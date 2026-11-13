const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeData,
  validatePack,
  mergePacks,
  KnowledgeIndex,
  baseQuestXP,
  estimateQuestXP,
  ATTRIBUTION,
} = require("../src/core/knowledge.cjs");
const { fixture, commit, build } = require("./fixtures/forever-facts.cjs");

function richRaw() {
  const raw = fixture();
  const q = raw["quests.enUS.json"].quests;
  Object.assign(q[5730].rewards, {
    items: [{ itemId: 9001, count: 2 }, { itemId: 9002, count: 1 }],
    reputation: [
      { factionId: 76, tier: 5 },
      { factionId: 2586, tier: 0, override: 12500 },
      { factionId: 87, tier: 0 },
    ],
    xpDifficulty: 5,
    xpMultiplier: 1.5,
    spellId: 3246,
    displaySpells: [{ spellId: 3246, type: 0 }, { spellId: 71, type: 1 }],
    currencies: [{ currencyId: 1, amount: 1 }],
  });
  const meta = (dataset, extra = {}) => ({
    ...raw["npcs.json"].meta,
    dataset,
    ...extra,
  });
  raw["vendors.json"] = {
    meta: meta("vendors"),
    vendors: {
      "npc:1": { entries: { "item:9001": { itemId: 9001, name: "Vendor Bread", sources: 1 } } },
    },
  };
  raw["tooltip_scan.enUS.json"] = {
    meta: meta("tooltip_scan", { locale: "enUS" }),
    items: {
      9001: { name: "Tooltip Bread", quality: 1, sources: 1 },
      15443: { name: "Kris of Orgrimmar", quality: 2, sources: 1 },
    },
  };
  return raw;
}

test("rewards keep reputation, XP, spells, vendor/tooltip names and quality", () => {
  const pack = validatePack(normalizeData(richRaw(), { commit, build }));
  const r = pack.quests[5730].rewards;
  assert.deepEqual(r.items, [
    { itemId: 9001, count: 2, name: "Vendor Bread", quality: 1 },
    { itemId: 9002, count: 1, name: "Item #9002" },
  ]);
  assert.equal(r.choices[0].quality, 2);
  assert.equal(r.choices[0].name, "Kris of Orgrimmar");
  assert.deepEqual(r.reputation, [
    { factionId: 76, tier: 5 },
    { factionId: 2586, tier: 0, amount: 125 },
  ]);
  assert.deepEqual(r.xp, { difficulty: 5, multiplier: 1.5 });
  assert.deepEqual(r.spells, [{ spellId: 3246 }, { spellId: 71 }]);
  assert.equal(pack.items[9001], undefined, "reward-only names never add item rows");
  assert.ok(pack.files["vendors.json"] && pack.files["tooltip_scan.enUS.json"]);
  assert.doesNotMatch(JSON.stringify(pack), /currencies|displaySpells|override/);
});

test("validator bounds the new reward fields", () => {
  const pack = normalizeData(richRaw(), { commit, build });
  for (const change of [
    (r) => (r.items[0].quality = 8),
    (r) => (r.items[0].extra = 1),
    (r) => (r.reputation[0].tier = 10),
    (r) => (r.reputation[1].amount = 0),
    (r) => (r.reputation[1].amount = 200000),
    (r) => (r.reputation = []),
    (r) => (r.reputation[0].note = "x"),
    (r) => (r.xp.difficulty = 11),
    (r) => (r.xp.multiplier = -1),
    (r) => (r.xp.extra = 1),
    (r) => (r.spells = [{ spellId: 0 }]),
    (r) => (r.spells = Array.from({ length: 7 }, (_, i) => ({ spellId: i + 1 }))),
    (r) => (r.currencies = []),
  ]) {
    const p = structuredClone(pack);
    change(p.quests[5730].rewards);
    assert.throws(() => validatePack(p));
  }
  const p = structuredClone(pack);
  p.files["quest_prerequisites.json"] = p.files["npcs.json"];
  assert.throws(() => validatePack(p), "only listed optional files are accepted");
});

test("merge fills a newer build's unnamed reward item from an older build", () => {
  const newer = normalizeData(fixture(), { commit, build });
  newer.quests[5730].rewards.items = [{ itemId: 9001, count: 1, name: "Item #9001" }];
  const olderRaw = richRaw();
  for (const v of Object.values(olderRaw)) v.meta.clientBuild = "1.60.1.70000";
  const older = normalizeData(olderRaw, { commit, build: "1.60.1.70000" });
  const merged = mergePacks([validatePack(newer), older]);
  const r = merged.quests[5730].rewards;
  assert.deepEqual(r.items, [{ itemId: 9001, count: 1, name: "Vendor Bread", quality: 1 }]);
  assert.deepEqual(r.xp, { difficulty: 5, multiplier: 1.5 }, "newer build lacking XP data takes the older report");
  assert.equal(r.reputation.length, 2);
});

test("details expose faction names, observed XP with a derived base, and links", () => {
  const pack = normalizeData(richRaw(), { commit, build });
  pack.quests[5730].observedXP = [
    { level: 18, xp: 1450, sources: 1 },
    { level: 22, xp: 1160, sources: 1 },
    { level: 16, xp: 1494, sources: 1 },
  ];
  const index = new KnowledgeIndex(pack);
  const d = index.details({}, 5730);
  assert.deepEqual(d.rewards.reputation[0], { factionId: 76, tier: 5, name: "Orgrimmar" });
  assert.equal(d.rewards.reputation[1].name, undefined, "unknown factions keep only the ID");
  assert.deepEqual(d.rewards.xp, {
    difficulty: 5,
    multiplier: 1.5,
    observed: [
      { level: 16, xp: 1494 },
      { level: 18, xp: 1450 },
      { level: 22, xp: 1160 },
    ],
    base: 1450,
  });
  assert.deepEqual(d.links, { previous: [{ id: 5729, title: "Hidden Enemies" }], next: [] });
  assert.ok(Array.isArray(d.chain) && d.chain.length > 1, "existing chain array is unchanged");
  assert.deepEqual(index.details({}, 1061).links.next, [{ id: 1062, title: "Goblin Invaders" }]);
  assert.deepEqual(index.details({}, 424242).links, { previous: [], next: [] });
});

test("XP base needs agreeing full-XP observations; estimates follow observed reductions", () => {
  const q = (observedXP, level = 10) => ({ level, observedXP: observedXP.map(([l, xp]) => ({ level: l, xp, sources: 1 })) });
  assert.equal(baseQuestXP(q([[8, 500], [15, 500]])), 500);
  assert.equal(baseQuestXP(q([[8, 500], [9, 515]])), 500, "a ~3% character bonus is tolerated");
  assert.equal(baseQuestXP(q([[8, 500], [9, 600]])), undefined);
  assert.equal(baseQuestXP(q([[16, 400]])), undefined, "reduced-only samples do not define a base");
  assert.equal(baseQuestXP(q([[60, 0]])), undefined);
  assert.equal(baseQuestXP({ observedXP: [{ level: 1, xp: 5, sources: 1 }] }), undefined);
  assert.deepEqual(
    [15, 16, 17, 18, 23, 60].map((l) => estimateQuestXP(1000, 10, l)),
    [1000, 800, 600, 500, 500, 0],
  );
  assert.equal(estimateQuestXP(-1, 10, 10), null);
});

test("the shipped pack carries the richer quest rewards", () => {
  const pack = require("../data/forever/pack.json");
  const qs = Object.values(pack.quests);
  const items = qs.flatMap((q) => [...q.rewards.items, ...q.rewards.choices]);
  const named = (r) => r.name !== `Item #${r.itemId}`;
  assert.equal(
    qs.filter((q) => { const a = [...q.rewards.items, ...q.rewards.choices]; return a.length && a.every(named); }).length,
    435,
  );
  assert.equal(new Set(items.filter((r) => r.quality !== undefined).map((r) => r.itemId)).size, 399);
  assert.equal(qs.filter((q) => q.rewards.moneyCopper !== undefined).length, 1547);
  assert.equal(qs.filter((q) => q.rewards.reputation).length, 2937);
  assert.equal(qs.filter((q) => q.rewards.xp).length, 4916);
  assert.equal(qs.filter((q) => q.rewards.spells).length, 411);
  assert.equal(pack.attribution, ATTRIBUTION);
  const d = new KnowledgeIndex(pack).details({}, 792);
  assert.equal(d.rewards.choices[0].name, "Primitive Club");
  assert.equal(d.rewards.reputation[0].name, "Orgrimmar");
  assert.equal(d.rewards.xp.base, 450);
  assert.deepEqual(d.links.next, [{ id: 794, title: "Burning Blade Medallion" }]);
});

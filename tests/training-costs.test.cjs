"use strict";
// 1.3 (J10): training costs from the trainer window the player opened, against the gold they carry.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { LevelingAdvisor } = require("../src/core/leveling.cjs");
const { normalizeLedgerCapture } = require("../src/core/ledger.cjs");
const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const pack = read("data/forever/pack.json"), insights = read("data/forever-insights/pack.json");
const advisor = (profile) => new LevelingAdvisor({ getState: () => ({ activeProfileId: "A", profiles: [{ id: "A", name: "P", ...profile }] }), knowledge: { bundled: { pack } }, insights });
const base = { level: 4, faction: "Horde", className: "Mage", race: "Troll", location: { mapId: 1411, x: 0.5, y: 0.5 }, quests: [] };

test("the ledger keeps what the trainer charged, bounded and validated", () => {
  const l = normalizeLedgerCapture({ schemaVersion: 1, money: 500, training: { seenAt: 1700000000, services: [{ name: "Frostbolt", rank: "Rank 1", level: 4, cost: 100 }, { name: "Fireball", rank: "Rank 2", level: 6, cost: 100 }] } });
  assert.equal(l.training.services.length, 2);
  assert.throws(() => normalizeLedgerCapture({ training: { seenAt: 1, services: [{ name: "X", level: 4, cost: -1 }] } }));
  assert.throws(() => normalizeLedgerCapture({ training: { seenAt: 1, services: Array.from({ length: 201 }, () => ({ name: "X", level: 1, cost: 1 })) } }));
  assert.equal(normalizeLedgerCapture({ training: { seenAt: 1, services: {} } }).training.services.length, 0, "an empty Lua table is an empty list");
});

test("Now's training says what the next visits cost and whether you can afford the next one", () => {
  const t0 = advisor(base).advise().training;
  assert.equal(t0.costs, null, "no trainer window seen yet");
  const next = t0.upcoming[0];
  const services = t0.upcoming.flatMap((u) => u.spells.map((s) => ({ name: s.name, ...(s.rank ? { rank: s.rank } : {}), level: u.level, cost: 300 })));
  const rich = advisor({ ...base, ledger: { schemaVersion: 1, money: 100000, training: { seenAt: 1700000000, services } } }).advise().training;
  assert.equal(rich.costs.levels[0].level, next.level);
  assert.equal(rich.costs.levels[0].total, 300 * next.spells.length);
  assert.equal(rich.costs.canAffordNext, true);
  const poor = advisor({ ...base, ledger: { schemaVersion: 1, money: 10, training: { seenAt: 1700000000, services } } }).advise().training;
  assert.equal(poor.costs.canAffordNext, false);
  assert.equal(poor.costs.shortBy, 300 * next.spells.length - 10);
});

test("the Now card shows costs, a short-by warning, or how to get prices", () => {
  const s = fs.readFileSync(path.join(root, "src/renderer/now.js"), "utf8");
  assert.match(s, /\$\{trainingCost\(t, c\)\}/);
  assert.match(s, /you're short by/);
  assert.match(s, /Open your trainer's window once in game/);
});

test("1.3 (J11): a riding-and-mount goal from prices your characters saw in game", () => {
  const { mountSuggestion, goldGoalView } = require("../src/core/gold-goal.cjs");
  assert.equal(mountSuggestion([{ name: "A" }]), null);
  const a = { name: "A", ledger: { money: 1, riding: { seenAt: 5, services: [{ name: "Apprentice Riding", level: 40, cost: 200000 }] } } };
  const part = mountSuggestion([a]);
  assert.equal(part.complete, false);
  const b = { name: "B", ledger: { money: 1, mounts: { seenAt: 6, items: [{ id: 5665, name: "Horn of the Dire Wolf", cost: 800000 }, { id: 1132, name: "Horn of the Timber Wolf", cost: 700000 }] } } };
  const m = mountSuggestion([a, b]);
  assert.equal(m.complete, true);
  assert.equal(m.mount.name, "Horn of the Timber Wolf", "the cheapest mount");
  assert.equal(m.gold, 90);
  assert.equal(goldGoalView({ profiles: [a, b] }).mountSuggestion.gold, 90);
  const L = require("../src/core/ledger.cjs");
  const n = L.normalizeLedgerCapture({ riding: { seenAt: 1, services: [{ name: "Apprentice Riding", level: 40, cost: 200000 }] }, mounts: { seenAt: 1, items: [{ id: 5665, name: "Horn", cost: 800000 }] } });
  assert.equal(n.mounts.items[0].cost, 800000);
  assert.throws(() => L.normalizeLedgerCapture({ mounts: { seenAt: 1, items: [{ id: 0, name: "Bad", cost: 1 }] } }));
  const page = fs.readFileSync(path.join(root, "src/renderer/ledger.js"), "utf8");
  assert.match(page, /data-ledger-goal-mount/);
  assert.match(page, /label: "Riding and first mount"/);
});

"use strict";
// 1.3 (J12): reputation advice from the bundled quest data.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { repAdvice, unlockOf, TIER_POINTS } = require("../src/core/rep-advice.cjs");
const pack = {
  quests: {
    1: { id: 1, title: "Big One", level: 12, minLevel: 10, sides: ["Horde"], givers: [{ id: 10, kind: "npc" }], rewards: { reputation: [{ factionId: 76, tier: 7 }] } },
    2: { id: 2, title: "Small One", level: 12, minLevel: 10, sides: ["Horde"], givers: [{ id: 10, kind: "npc" }], rewards: { reputation: [{ factionId: 76, tier: 5 }] } },
    3: { id: 3, title: "Done Already", level: 12, minLevel: 10, givers: [{ id: 10, kind: "npc" }], rewards: { reputation: [{ factionId: 76, tier: 8 }] } },
    4: { id: 4, title: "Alliance Only", level: 12, minLevel: 10, sides: ["Alliance"], rewards: { reputation: [{ factionId: 76, tier: 8 }] } },
    5: { id: 5, title: "Too High", level: 30, minLevel: 28, rewards: { reputation: [{ factionId: 76, tier: 8 }] } },
    6: { id: 6, title: "Middle Of Chain", level: 12, minLevel: 10, turnIns: [{ id: 11, kind: "npc" }], rewards: { reputation: [{ factionId: 76, tier: 7 }] } },
    7: { id: 7, title: "Tiny", level: 12, minLevel: 1, rewards: { reputation: [{ factionId: 76, tier: 1 }] } },
  },
  npcs: { "npc:10": { id: 10, name: "Thrall", positions: [{ mapId: 1454, x: 0.3, y: 0.4 }] }, "npc:11": { id: 11, name: "Nazgrel", positions: [{ mapId: 1454, x: 0.5, y: 0.5 }] } },
};
const horde = { level: 12, faction: "Horde", history: { completedIdsKnown: true, completedIds: [3] },
  ledger: { reputations: { seenAt: 1, factions: [{ id: 76, name: "Orgrimmar", standing: 5, min: 3000, max: 9000, value: 4000 }, { id: 81, name: "Thunder Bluff", standing: 8, min: 42000, max: 43000, value: 42999 }] } } };

test("fastest ways up: biggest rewards first, starting quests before chain middles, nothing done, wrong side, too high or tiny", () => {
  const r = repAdvice(horde, pack);
  assert.equal(r.factions.length, 1, "Exalted factions are left out");
  const f = r.factions[0];
  assert.deepEqual(f.quests.map((q) => q.title), ["Big One", "Middle Of Chain", "Small One"]);
  assert.equal(f.quests[0].points, TIER_POINTS[7]);
  assert.deepEqual(f.quests[0].giver, { name: "Thrall", mapId: 1454, zone: f.quests[0].giver.zone, x: 0.3, y: 0.4 });
  assert.equal(f.quests[1].starts, false, "hand-in NPC shown for a chain middle");
  assert.equal(f.quests[1].giver.name, "Nazgrel");
  assert.equal(f.toNext, 5000);
  assert.equal(f.next, "Honored");
  assert.match(f.nextUnlock, /10% off at Orgrimmar vendors/);
  assert.equal(repAdvice({ level: 5 }, pack), null, "no reputations, no advice");
  assert.match(unlockOf(72, 8), /Stormwind's mounts/);
});

test("real data: a level 12 Horde character gets Orgrimmar quests with givers and zones", () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"), "utf8"));
  const r = repAdvice({ ...horde, history: { completedIdsKnown: true, completedIds: [] } }, real);
  const org = r.factions.find((f) => f.id === 76);
  assert.ok(org.quests.length >= 3);
  assert.ok(org.quests.every((q) => q.points >= 25));
  assert.ok(org.quests.some((q) => q.giver?.zone), "at least one quest says where");
});

test("wiring: the ledger handler adds advice and Ledger → Reputation shows Fastest ways up", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  assert.match(main, /c\.repAdvice = repAdvice\(p, pack\)/);
  const r = fs.readFileSync(path.join(__dirname, "../src/renderer/ledger.js"), "utf8");
  assert.match(r, /Fastest ways up/);
  assert.match(r, /\$\{repUp\(pick\)\}/);
});

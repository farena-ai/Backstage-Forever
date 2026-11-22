"use strict";
// 1.3 (J12): reputation advice from the bundled quest data.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { repAdvice } = require("../src/core/rep-advice.cjs");
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

test("reference leads filter completed and known ineligible quests and distinguish givers from turn-ins", () => {
  const r = repAdvice(horde, pack);
  const f = r.factions[0];
  assert.deepEqual(f.quests.map((q) => q.title), ["Big One", "Small One", "Middle Of Chain", "Tiny"]);
  assert.equal(f.quests[0].giver.name, "Thrall");
  assert.equal(f.quests[0].minLevel, 10);
  assert.deepEqual(f.quests[0].sides, ["Horde"]);
  assert.equal(f.quests[2].giver, null);
  assert.equal(f.quests[2].turnIn.name, "Nazgrel");
  assert.equal(f.nextUnlock, undefined);
  assert.equal(repAdvice({ level: 5 }, pack), null, "no reputations, no advice");
});

test("real data: a level 12 Horde character gets Orgrimmar quests with givers and zones", () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"), "utf8"));
  const r = repAdvice({ ...horde, history: { completedIdsKnown: true, completedIds: [] } }, real);
  const org = r.factions.find((f) => f.id === 76);
  assert.ok(org.quests.length >= 3);
  assert.ok(org.quests.every((q) => q.status === "reference" && q.points === undefined));
  assert.ok(org.quests.some((q) => q.giver?.zone), "at least one quest says where");
});

test("wiring: the ledger handler adds advice and Ledger → Reputation shows the faction plan", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  assert.match(main, /knowledge\.index\(p\)/);
  const r = fs.readFileSync(path.join(__dirname, "../src/renderer/ledger.js"), "utf8");
  assert.match(r, /Quests and turn-ins/);
  assert.match(r, /\$\{repPlan\(pick\)\}/);
});

test("saved repeat turn-ins come first, while reference candidates disclose links and unknown rewards", () => {
  const source = structuredClone(pack);
  source.quests[6].nextQuestId = 2;
  source.quests[7].rewards.reputation[0].amount = -25;
  const rows = repAdvice({ ...horde, quests: [{ id: 3, title: "Saved repeat", complete: true }, { id: 6, title: "Saved chain", complete: false }] }, source).factions[0].quests;
  assert.deepEqual(rows.map(q => [q.id, q.status]), [[3, "turn-in"], [6, "in-log"], [1, "reference"], [2, "reference"]]);
  assert.deepEqual(rows.find(q => q.id === 2).linkedFrom, [{ id: 6, title: "Middle Of Chain", completed: false }]);
  assert.equal(rows[0].title, "Saved repeat");
  assert.equal(rows[0].points, undefined, "a reference reward is not an observed server amount");
});

test("browse-only reputation reference does not use saved quest IDs, history, or eligibility", () => {
  const source = structuredClone(pack);
  source.quests[6].nextQuestId = 2;
  const profile = { ...horde, level: 1, quests: [{ id: 3, title: "Unmatched log title", complete: true }] };
  const advice = repAdvice(profile, source, { browseOnly: true, perFaction: 10 });
  const rows = advice.factions[0].quests;
  assert.equal(advice.browseOnly, true);
  assert.deepEqual(rows.map(q => q.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(rows.every(q => q.status === "reference" && q.linkedFrom.length === 0));
  assert.equal(rows.find(q => q.id === 3).title, "Done Already");
});

test("turn-in materials use exact objective IDs and this character’s dated bags only", () => {
  const build = "1.60.1.70888", seenAt = 1794312000;
  const source = structuredClone(pack);
  source.build = build;
  source.items = { 101: { name: "Runecloth" }, 102: { name: "Token" } };
  source.quests[3].objectives = [
    { index: 1, type: "item", objectId: 101, required: 20 },
    { index: 2, type: "item", objectId: 102, required: 2 },
    { index: 3, type: "kill", objectId: 103, required: 1 },
  ];
  source.quests[1].objectives = source.quests[3].objectives;
  const profile = { ...structuredClone(horde), clientBuild: build, source: { kind: "wow-addon", updatedAt: new Date(seenAt * 1000).toISOString() },
    quests: [{ id: 3, title: "Saved repeat", complete: false }] };
  profile.ledger.bags = { seenAt, complete: true, items: [{ id: 101, n: 12, name: "Runecloth" }, { id: 999, n: 100, name: "Token" }] };
  profile.ledger.bank = { seenAt, complete: true, items: [{ id: 102, n: 25, name: "Token" }] };
  const rows = (p = profile, options) => repAdvice(p, source, { now: seenAt + 1, ...options }).factions[0].quests;
  assert.deepEqual(rows()[0].materials, { seenAt, rows: [
    { itemId: 101, name: "Runecloth", required: 20, carried: 12, missing: 8 },
    { itemId: 102, name: "Token", required: 2, carried: 0, missing: 2 },
  ] });
  assert.equal(rows()[0].status, "in-log");
  assert.equal(rows().find(q => q.id === 1).materials, undefined);
  for (const bags of [{ ...profile.ledger.bags, seenAt: seenAt - 1 }, { ...profile.ledger.bags, complete: false }]) {
    const m = rows({ ...profile, ledger: { ...profile.ledger, bags } })[0].materials;
    assert.equal(m.rows[0].carried, 12);
    assert.equal(m.rows[0].missing, null);
    assert.equal(m.rows[1].carried, null);
  }
  const future = { ...profile.ledger.bags, seenAt: seenAt + 1 };
  assert.equal(rows({ ...profile, ledger: { ...profile.ledger, bags: future } })[0].materials.seenAt, null);
  assert.ok(rows(profile, { browseOnly: true }).every(q => !q.materials));
  assert.ok(rows({ ...profile, clientBuild: "1.60.2.99999" }).every(q => !q.materials));
});

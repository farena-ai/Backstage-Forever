"use strict";
// 0.33 live moments, main side: raw strip moments become real sentences from the bundled packs.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const M = require("../src/core/moments.cjs");
const { loadCreaturePack } = require("../src/core/creature-data.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");
const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"), "utf8"));
const REF = M.loadReference({ knowledge, insights: loadBundledInsights(), creatures: loadCreaturePack() });

test("death: killer, level, share, helpers and a tip; unknown killers stay honest", () => {
  const share = 72, c = 1 + 2 * 2 + 1 * 16;
  const d = M.resolveMoment({ type: 1, a: 589, b: 17 * 256 + share, c }, REF, { level: 15 });
  const name = REF.creature.get(589)?.name;
  assert.ok(name, "the creature pack names NPC 589");
  assert.equal(d.kind, "death"); assert.equal(d.title, "You died");
  assert.equal(d.line, `${name} (level 17, elite) did 72% of the damage, with 1 other enemy. Tip: That was an elite: much tougher than normal.`);
  assert.equal(d.death.change, M.TIPS[2].change);
  assert.equal(d.death.aboveYou, 2);
  assert.equal(d.death.corpseRun.length, 3);
  const above = M.resolveMoment({ type: 1, a: 589, b: 19 * 256 + 90, c: 3 * 2 }, REF, { level: 15 });
  assert.match(above.line, /Tip: it was 4 levels above you\.$/);
  const none = M.resolveMoment({ type: 1, a: 0, b: 0, c: 5 * 2 }, REF, {});
  assert.equal(none.death.killer, null);
  assert.match(none.line, /No enemy damage was recorded/);
});

test("kills: elites and rares by name; a known boss NPC is a boss; the last boss clears the dungeon", () => {
  const elite = M.resolveMoment({ type: 2, a: 589, b: 17, c: 1 }, REF, { level: 14 });
  assert.equal(elite.kind, "elite"); assert.equal(elite.title, "Elite defeated");
  assert.match(elite.line, /\(level 17, elite\) is down\. It was 3 levels above you\.$/);
  const rare = M.resolveMoment({ type: 3, a: 462, b: 26, c: 3 }, REF, {});
  assert.equal(rare.kind, "rare"); assert.match(rare.line, /rare elite\) is down\. Rares carry better loot/);
  // Edwin VanCleef (NPC 639) ends The Deadmines.
  const vc = M.resolveMoment({ type: 4, a: 639, b: 0, c: 1 }, REF, {});
  assert.equal(vc.kind, "dungeon"); assert.equal(vc.title, "The Deadmines cleared");
  assert.equal(vc.line, "Killed Edwin VanCleef, the last boss: The Deadmines cleared. Check your quests: several end here.");
  const smite = M.resolveMoment({ type: 4, a: 646, b: 0, c: 1 }, REF, {});
  assert.equal(smite.kind, "boss"); assert.equal(smite.line, "Killed Mr. Smite in The Deadmines. 2 bosses to go.");
  // An "elite" kill of a boss NPC (outside an encounter) is told as the boss.
  assert.equal(M.resolveMoment({ type: 2, a: 644, b: 19, c: 1 }, REF, {}).kind, "boss");
  // Encounter id only (no NPC): the encounters pack names it.
  const herod = M.resolveMoment({ type: 4, a: 0, b: 448, c: 0 }, REF, {});
  assert.equal(herod.subject, "Herod"); assert.match(herod.line, /^Killed Herod in Scarlet Monastery\./);
  const unknown = M.resolveMoment({ type: 4, a: 0, b: 0, c: 0 }, REF, {});
  assert.equal(unknown.line, "Killed the boss.");
});

test("professions: milestones, and the next rank with a real trainer at the limit", () => {
  const ms = M.resolveMoment({ type: 5, a: 186, b: 50, c: 15 }, REF, {});
  assert.equal(ms.title, "Mining 50"); assert.equal(ms.line, "Mining reached 50 of 75. 25 to the limit of this rank.");
  const cap = M.resolveMoment({ type: 5, a: 186, b: 75, c: 15 }, REF, { faction: "Horde", level: 12 });
  assert.equal(cap.nextTier, "Journeyman");
  assert.ok(cap.trainer && cap.trainer.mapName, "a Horde mining trainer in a city");
  assert.ok([1454, 1456, 1458].includes(cap.trainer.mapId), cap.trainer.mapName);
  assert.equal(cap.line, `Mining 75: Journeyman available at the trainer in ${cap.trainer.mapName} (${cap.trainer.name}). It raises the limit to 150.`);
  const low = M.resolveMoment({ type: 5, a: 186, b: 75, c: 15 }, REF, { faction: "Horde", level: 8 });
  assert.match(low.line, /once you reach level 10\./);
  const ali = M.resolveMoment({ type: 5, a: 393, b: 150, c: 30 }, REF, { faction: "Alliance", level: 30 });
  assert.equal(ali.nextTier, "Expert");
  assert.ok(!ali.trainer || [1453, 1455, 1457].includes(ali.trainer.mapId) || ali.trainer.teaches, "Alliance gets an Alliance city or a trainer that teaches it");
  assert.equal(M.resolveMoment({ type: 5, a: 186, b: 300, c: 60 }, REF, {}).line, "Mining mastered: 300 of 300.");
});

test("zones, flight paths and upgrades", () => {
  const z = M.resolveMoment({ type: 6, a: 1436 }, REF, { level: 30 }, { zoneBand: (id) => (id === 1436 ? { min: 10, max: 20 } : null) });
  assert.equal(z.line, "First visit to Westfall (levels 10–20). You have outgrown it, so quests here give little experience.");
  assert.equal(M.resolveMoment({ type: 7, a: 1436 }, REF, {}).line, "Flight path learned in Westfall. You can now fly here from any flight master you know.");
  const itemName = REF.items.get(43);
  const u = M.resolveMoment({ type: 8, a: 43, b: 52, c: 8 }, REF, {});
  assert.equal(u.line, `${itemName} (feet): +5.2 gear score for your class over what it replaced.`);
  assert.equal(M.resolveMoment({ type: 99 }, REF, {}), null);
});

test("quest chains: only the last quest of a chain of two or more", () => {
  const ends = [...REF.quests.values()].filter((q) => !q.next && REF.prev.has(q.id));
  assert.ok(ends.length > 5, "the knowledge pack links quest chains");
  const last = ends[0];
  const card = M.chainEnd(REF, last.id);
  assert.equal(card.kind, "chain"); assert.ok(card.steps >= 2);
  assert.match(card.line, /-quest story that began with “/);
  assert.equal(M.chainEnd(REF, REF.prev.get(last.id)), null, "a middle quest is not an end");
});

test("service: settings persist, every moment is in Recent, only wanted ones pop up", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-moments-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  let clock = 1_000_000;
  const s = new M.MomentsService({ dataDir: dir, reference: REF, send: (m) => sent.push(m), now: () => clock });
  assert.equal(s.status().settings.enabled, true);
  assert.equal(s.status().kinds.length, 10);
  s.observe({ type: 6, a: 1436, at: clock });
  s.setSettings({ kinds: { zone: false } });
  s.observe({ type: 6, a: 1429, at: clock });
  assert.deepEqual(sent.map((m) => m.subject), ["Westfall"]);
  assert.deepEqual(s.status().recent.map((m) => m.subject), ["Elwynn Forest", "Westfall"]);
  assert.throws(() => s.setSettings({ kinds: { hack: true } }));
  assert.throws(() => s.setSettings({ enabled: "yes" }));
  s.setSettings({ enabled: false });
  const again = new M.MomentsService({ dataDir: dir, reference: REF });
  assert.equal(again.settings.enabled, false); assert.equal(again.settings.kinds.zone, false); assert.equal(again.settings.kinds.death, true);
});

test("service: a frame-only death gets a basic screen; the addon's review replaces it, never twice", () => {
  const sent = [], timers = [];
  let clock = 2_000_000;
  const s = new M.MomentsService({ reference: REF, send: (m) => sent.push(m), now: () => clock, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  s.onPlayEvent({ kind: "death", at: clock });
  timers.shift()();
  assert.equal(sent.length, 1); assert.equal(sent[0].death.unknown, true);
  clock += 1500;
  s.observe({ type: 1, a: 589, b: 17 * 256 + 60, c: 4, at: clock - 500 });
  assert.equal(sent.length, 2); assert.equal(sent[1].id, sent[0].id); assert.equal(sent[1].update, true);
  assert.equal(s.status().recent.length, 1, "one death in Recent");
  s.observe({ type: 1, a: 589, b: 17 * 256 + 60, c: 4, at: clock });
  assert.equal(sent.length, 2, "the same death once");
  // Review first: the frame's death event adds nothing.
  clock += 60000;
  s.observe({ type: 1, a: 0, b: 0, c: 10, at: clock });
  s.onPlayEvent({ kind: "death", at: clock + 200 });
  assert.equal(timers.length, 0); assert.equal(sent.length, 3);
});

test("service: turned-in quests that end a chain, after the first list", () => {
  const sent = [];
  const s = new M.MomentsService({ reference: REF, send: (m) => sent.push(m) });
  const end = [...REF.quests.values()].find((q) => !q.next && REF.prev.has(q.id));
  assert.deepEqual(s.observeFrame({ characterHash: 7, turnedIn: [end.id] }), [], "the first list is the baseline");
  s.observeFrame({ characterHash: 7, turnedIn: [] });
  s.observeFrame({ characterHash: 7, turnedIn: [end.id, 1] });
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, "chain"); assert.equal(sent[0].questId, end.id);
});

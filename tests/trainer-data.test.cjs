"use strict";
// Trainer costs pack (roadmap C6, D4): compiler rules, validation, the bundled pack and "At the trainer".
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const T = require("../src/core/trainer-data.cjs");
const ipc = require("../src/core/travel-planner-ipc.cjs");
const inv = require("./pack-invariants.cjs");
const { otherPatch } = inv;
const commit = "b".repeat(40), build = "1.60.1.100", older = "1.60.1.90";
const meta = (dataset, clientBuild) => ({ attribution: T.ATTRIBUTION, clientBuild, collectedOn: { first: "2026-11-10", last: "2026-11-12" }, dataset, license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources: 1 });
const service = (spellId, name, level, costs, extra = {}) => ({ spellId, name, level, costs, icon: 1, skillRank: 0, sources: 1, ...extra });
function trainers(clientBuild = build) {
  return { meta: meta("trainers", clientBuild), trainers: {
    100: { name: "Mage One", trainerType: 0, services: { 1: service(1, "Frostbolt", 0, { 6: 90 }, { rankText: "Rank 2" }), 2: service(2, "Blink", 20, { 5: 2100 }), 3: service(3, "Scorch", 22, { 5: 3300, 6: 2970 }, { rankText: "Rank 1" }), 4: service(4, "Ward", 20, undefined, { bartered: { 2: { 5: 500 } } }) } },
    101: { name: "Portal One", trainerType: 0, services: { 10: service(10, "Teleport: Orgrimmar", 20, { 5: 2000 }), 11: service(11, "Teleport: Stormwind", 20, { 5: 2000 }) } },
    102: { name: "Tailor", trainerType: 2, tradeskill: true, services: { 20: service(20, "Linen Boots", 0, { 5: 200 }, { skill: "Tailoring", skillRank: 40 }), 21: service(21, "Apprentice Tailor", 5, { 5: 10 }, { profession: true }) } },
    103: { name: "Nameless", trainerType: 0, services: { 30: service(30, "Mystery", 10, { 5: 1 }) } },
    104: { name: "Woo", trainerType: 0, services: { 40: service(40, "Polearms", 0, { 6: 9000 }) } },
    105: { name: "Rider", trainerType: 0, services: { 50: service(50, "Apprentice Riding", 40, { 5: 1000000 }) } },
    106: { name: "Junior", trainerType: 2, tradeskill: true, services: { 60: service(60, "Apprentice Tailoring", 5, { 5: 10 }, { profession: true }) } },
  } };
}
const details = (clientBuild = build) => ({ meta: meta("creature_details", clientBuild), creatures: { 100: { name: "Mage One", title: "Mage Trainer" }, 101: { title: "Portal Trainer" }, 102: { title: "Expert Tailor" }, 104: { title: "Weapon Master" }, 105: { title: "Horse Riding Instructor" }, 106: { title: "Junior Tailor" } } });
const files = (t = trainers(), d = details()) => ({ "trainers.json": Buffer.from(JSON.stringify(t)), "creature_details.enUS.json": Buffer.from(JSON.stringify(d)) });
const compile = (builds = [{ build, files: files() }]) => T.compileTrainers(builds, { commit });

test("trainers are sorted by their title; an untitled trainer is counted and left out", () => {
  const p = compile();
  assert.deepEqual(Object.keys(p.classes), ["Mage"]);
  assert.deepEqual(p.classes.Mage.map((r) => [r.id, r.from]), [[2, "class"], [10, "portal"], [11, "portal"], [4, "class"], [3, "class"], [1, "class"]]);
  assert.deepEqual(Object.keys(p.professions), ["Tailoring"]);
  assert.deepEqual(p.professions.Tailoring.map((r) => [r.id, r.skill, r.step]), [[21, 0, true], [60, 0, true], [20, 40, false]]);
  assert.deepEqual(p.weapons.map((r) => r.name), ["Polearms"]); assert.deepEqual(p.riding.map((r) => r.level), [40]);
  assert.equal(p.counts.trainers, 7); assert.equal(p.counts.untitledTrainers, 1);
  assert.equal(JSON.stringify(p).includes("Mystery"), false);
  assert.equal(T.groupOf("Innkeeper", {}), null);
});

test("prices keep full and Honored apart, a bartered-only price is no price, and level 0 means not recorded", () => {
  const p = compile(), row = (id) => p.classes.Mage.find((r) => r.id === id);
  assert.deepEqual(row(3), { id: 3, name: "Scorch", rank: "Rank 1", level: 22, cost: 3300, honored: 2970, from: "class" });
  assert.deepEqual(row(1), { id: 1, name: "Frostbolt", rank: "Rank 2", level: 0, cost: null, honored: 90, from: "class" });
  assert.deepEqual([row(4).cost, row(4).honored], [null, null]); assert.equal(p.counts.barteredOnly, 1);
  assert.deepEqual(T.priceOf(row(3)), { copper: 3300, estimated: false });
  assert.deepEqual(T.priceOf(row(1)), { copper: 100, estimated: true }, "worked out from the 10% Honored discount");
  assert.deepEqual(T.priceOf(row(4)), { copper: null, estimated: false });
  assert.deepEqual(p.coverage.Mage, { trainers: 2, services: 6, withLevel: 5, priced: 5 });
});

test("the level is the highest any player was shown; the newest build wins names and prices", () => {
  const old = trainers(older);
  old.trainers[100].services[1] = service(1, "Frostbolt (old)", 8, { 5: 111 }, { rankText: "Rank 2" });
  old.trainers[100].services[2] = service(2, "Blink", 0, { 5: 9999 });
  const p = compile([{ build, files: files() }, { build: older, files: files(old, details(older)) }]);
  const row = (id) => p.classes.Mage.find((r) => r.id === id);
  assert.deepEqual([row(1).name, row(1).level, row(1).cost, row(1).honored], ["Frostbolt", 8, 111, 90]);
  assert.deepEqual([row(2).level, row(2).cost], [20, 2100]);
  assert.deepEqual(p.builds, [build, older]);
});

test("the validator refuses tampered packs", () => {
  const good = () => structuredClone(compile());
  const bad = [(p) => { p.classes.Bard = []; }, (p) => { p.classes.Mage[0].level = -1; }, (p) => { p.classes.Mage[0].from = "x"; }, (p) => { p.classes.Mage.push({ ...p.classes.Mage[0] }); }, (p) => { p.coverage.Mage.services++; }, (p) => { p.professions.Tailoring[0].step = 1; }, (p) => { p.counts.classServices = 0; }, (p) => { p.license = "MIT"; }];
  for (const change of bad) { const p = good(); change(p); assert.throws(() => T.validateTrainerPack(p), /Invalid trainer data/); }
  assert.throws(() => T.compileTrainers([{ build, files: files(trainers(older)) }], { commit }), /Source metadata/);
});

test("at the trainer: this level and the next two, each with cost, the total, and the gold when it is known", () => {
  const p = compile();
  const plan = T.trainerPlan(p, "Mage", 20, { money: 5000, faction: "Horde" });
  assert.equal(plan.available, true);
  assert.deepEqual(plan.levels.map((l) => [l.level, l.rows.map((r) => r.name), l.total, l.unpriced]), [[20, ["Blink", "Teleport: Orgrimmar", "Ward"], 4100, 1], [21, [], 0, 0], [22, ["Scorch"], 3300, 0]]);
  assert.equal(plan.total, 7400); assert.equal(plan.money, 5000); assert.equal(plan.nextLevel, null);
  assert.equal(plan.levels[0].rows.find((r) => r.name === "Ward").copper, null);
  assert.ok(plan.notes.some((n) => /1 of 6 recorded Mage skills have no recorded level/.test(n)));
  assert.ok(plan.notes.some((n) => /Only 6 Mage skills from 2 trainers/.test(n)));
  assert.equal(JSON.stringify(plan).match(/skip|worth|should/i), null, "facts only, no advice");
  assert.deepEqual(T.trainerPlan(p, "Mage", 20, { faction: "Alliance" }).levels[0].rows.map((r) => r.name), ["Blink", "Teleport: Stormwind", "Ward"]);
  assert.equal(T.trainerPlan(p, "Mage", 20).money, null);
  assert.equal(T.trainerPlan(p, "Mage", 10).nextLevel, 20);
  assert.equal(T.trainerPlan(p, "Rogue", 20).available, false);
  assert.match(T.trainerPlan(p, "Mage", 0).reason, /level is not known/);
  // Characters stop at 60: no "At level 61" for a character at the cap.
  assert.deepEqual(T.trainerPlan(p, "Mage", 60).levels.map((l) => l.level), [60]);
  assert.deepEqual(T.trainerPlan(p, "Mage", 59).levels.map((l) => l.level), [59, 60]);
  assert.equal(T.trainerPlan(p, "Mage", 60).nextLevel, null);
});

test("the desktop view shows gold only for the character's own class and level, and follows the same-patch rule", () => {
  const p = compile();
  const profile = { id: "a", name: "Jaina", className: "Mage", level: 20, faction: "Alliance", clientBuild: "1.60.1.123", ledger: { money: 777 } };
  const state = { profiles: [profile], activeProfileId: "a" };
  const own = ipc.trainerView(state, "Mage", 20, { trainers: p });
  assert.equal(own.money, 777); assert.ok(own.notes.some((n) => /same patch/.test(n)));
  assert.equal(ipc.trainerView(state, "Mage", 60, { trainers: p }).money, null, "a preview at another level is not this character's purse");
  assert.equal(ipc.trainerView(state, "Bard", 20, { trainers: p }).available, false);
  const refused = ipc.trainerView({ profiles: [{ ...profile, clientBuild: otherPatch(build) }], activeProfileId: "a" }, "Mage", 20, { trainers: p });
  assert.equal(refused.available, false); assert.match(refused.reason, /another patch/);
});

test("the bundled pack matches its lock and notice, covers every class and is honest about thin classes", () => {
  const tool = require("../scripts/build-forever-trainers.cjs");
  const pack = tool.checkBundle(), lock = tool.readLock();
  inv.assertNewestFirst(pack.builds, 1);
  assert.match(lock.commit, inv.COMMIT); assert.match(lock.compiled.sha256, inv.SHA256);
  assert.deepEqual(T.loadTrainerPack(), pack);
  assert.ok(fs.statSync(path.join(__dirname, "../data/forever-trainers/pack.json")).size <= T.PACK_LIMIT);
  assert.deepEqual(Object.keys(pack.classes).sort(), [...T.CLASSES].sort());
  const notice = fs.readFileSync(path.join(__dirname, "../data/forever-trainers/NOTICE"), "utf8");
  for (const [name, v] of Object.entries(pack.coverage)) {
    assert.ok(notice.includes(`${name}: ${v.services} skills from ${v.trainers} trainers`), name);
    const plan = T.trainerPlan(pack, name, 20);
    assert.equal(plan.available, true);
    if (v.services < 60) assert.ok(plan.notes.some((n) => /far from complete/.test(n)), `${name} is thin and says so`);
  }
  for (const rows of Object.values(pack.classes)) for (const r of rows) assert.ok(r.cost === null || r.honored === null || Math.abs(r.honored - r.cost * 0.9) <= 1, `${r.name}: Honored is 10% less`);
});

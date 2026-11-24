"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const P = require("../src/core/quest-prerequisites.cjs");
const inv = require("./pack-invariants.cjs");
const COMMIT = "a".repeat(40), SHA = "b".repeat(64);
const raw = (build, quests) => ({ build, files: { "quest_prerequisites.json": Buffer.from(JSON.stringify({ meta: { dataset: "quest_prerequisites", clientBuild: build, collectedOn: { first: "2026-11-20", last: "2026-11-22" } }, quests })) } });
const npc = (id) => [{ kind: "npc", id }];
// 1 -> 2 (needed), 3 -> 4 (lead-in: someone took 4 without 3), 5 is handed in to 6's giver (pattern),
// 7 and 8 both lead to 9 (alternatives), 10 -> 11 with too few records.
const quests = {
  1: { id: 1, nextQuestId: 2, turnIns: npc(50) }, 2: { id: 2, givers: npc(50) },
  3: { id: 3, nextQuestId: 4 }, 4: { id: 4 },
  5: { id: 5, turnIns: npc(60) }, 6: { id: 6, givers: npc(60) },
  7: { id: 7, nextQuestId: 9 }, 8: { id: 8, nextQuestId: 9 }, 9: { id: 9 },
  10: { id: 10, nextQuestId: 11 }, 11: { id: 11 }, 12: { id: 12, turnIns: npc(61) },
};
const builds = [
  raw("1.60.1.200", { 2: { before: [1, 5, 12], characters: 2 }, 4: { before: [1], characters: 3 }, 6: { before: [1, 5, 12], characters: 3 }, 9: { before: [1], characters: 4 }, 11: { before: [10], characters: 2 } }),
  raw("1.60.1.100", { 2: { before: [1, 12], characters: 2 }, 6: { before: [5, 1], characters: 2 } }),
];
const compiled = () => P.compilePrerequisites(builds, { commit: COMMIT, quests, questPackSha256: SHA });

test("only the three careful readings are kept, with records added up over the builds", () => {
  const p = compiled();
  assert.deepEqual(p.needs, [[2, [1], 4]]);
  assert.deepEqual(p.leadIns, [[3, 4, 3]]);
  assert.deepEqual(p.seen, [[6, [5], 5]], "5 is handed in to the giver of 6; 1 and 12 are not");
  assert.deepEqual(p.counts, { quests: 5, needs: 1, leadIns: 1, seen: 1, unclear: 1 });
  assert.deepEqual(p.builds, ["1.60.1.200", "1.60.1.100"]);
  assert.equal(p.needs.some((r) => r[0] === 11), false, "two records are not enough");
});

test("the pack is validated strictly", () => {
  const p = compiled();
  for (const bad of [
    { ...p, kind: "other" }, { ...p, needs: [[2, [2], 4]] }, { ...p, needs: [[2, [1], 2]] }, { ...p, needs: [[2, [1], 4], [2, [1], 4]], counts: { ...p.counts, needs: 2 } },
    { ...p, leadIns: [[3, 2, 3]] }, { ...p, counts: { ...p.counts, seen: 9 } }, { ...p, questPackSha256: "x" }, { ...p, seen: [[6, [1, 2, 3, 4, 5], 5]] },
  ]) assert.throws(() => P.validatePrerequisites(bad), /Invalid quest prerequisite data/);
  assert.throws(() => P.compilePrerequisites([raw("1.60.1.200", {})].map((b) => ({ ...b, build: "1.60.1.201" })), { commit: COMMIT, quests, questPackSha256: SHA }), /Source metadata/);
});

test("helpers: what is missing, what is optional, and plain facts for the quest guide", () => {
  const p = compiled();
  assert.deepEqual(P.missingPrerequisites(p, 2, new Set()), [1]);
  assert.deepEqual(P.missingPrerequisites(p, 2, new Set([1])), []);
  assert.deepEqual(P.missingPrerequisites(p, 6, new Set()), [], "a recorded pattern never holds a quest back");
  assert.equal(P.isLeadIn(p, 3, 4), true); assert.equal(P.isLeadIn(p, 1, 2), false); assert.equal(P.isLeadIn(null, 3, 4), false);
  assert.deepEqual(P.prerequisiteFacts(p, 2, { title: (x) => ({ 1: "First" })[x], done: new Set([1]) }), [{ kind: "needs", quests: [{ id: 1, title: "First", done: true }], records: 4 }]);
  assert.deepEqual(P.prerequisiteFacts(p, 4), [{ kind: "leadIn", quests: [{ id: 3, title: "Quest #3" }], records: 3 }], "no done mark without a known history");
  assert.deepEqual(P.prerequisiteFacts(p, 99), []);
});

test("the bundled pack matches its lock, notice and the bundled quest pack", () => {
  const tool = require("../scripts/build-forever-prerequisites.cjs");
  const pack = tool.checkBundle(), lock = tool.readLock();
  inv.assertNewestFirst(pack.builds, 1);
  assert.match(lock.commit, inv.COMMIT); assert.match(lock.compiled.sha256, inv.SHA256);
  assert.deepEqual(P.loadPrerequisites(), pack);
  const questPack = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json")));
  assert.equal(pack.sourceCommit, questPack.sourceCommit); assert.equal(pack.build, questPack.build);
  assert.ok(pack.counts.needs >= 200 && pack.counts.leadIns >= 5 && pack.counts.seen >= 100, JSON.stringify(pack.counts));
  // Every needed quest is a reported link of the quest pack; every row names quests the pack has.
  for (const [q, ids] of pack.needs) for (const x of ids) assert.equal(questPack.quests[x].nextQuestId, q);
  for (const [x, q] of pack.leadIns) assert.equal(questPack.quests[x].nextQuestId, q);
  for (const [q, ids] of pack.seen) { assert.ok(questPack.quests[q]); for (const x of ids) assert.ok(questPack.quests[x]); }
  const notice = fs.readFileSync(path.join(__dirname, "../data/forever-prerequisites/NOTICE"), "utf8");
  assert.ok(notice.includes(`${pack.counts.needs} quests.`) && notice.includes("not a rule"));
});

test("the guided routes never ask for a quest before the quest it needs is handed in", () => {
  const G = require("../src/core/guided-route.cjs");
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json"))), zones = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever-leveling/pack.json"))).zones;
  const needs = P.prerequisiteIndex(P.loadPrerequisites()).needs;
  const early = (routes) => {
    let n = 0;
    for (const r of routes) {
      const handIn = new Map(); r.steps.forEach((s, i) => { if (s.kind === "turnin") for (const id of s.ids) if (!handIn.has(id)) handIn.set(id, i); });
      r.steps.forEach((s, i) => { if (s.kind === "pickup" || s.kind === "class") for (const id of s.ids) for (const x of needs.get(id)?.ids || []) if (handIn.has(x) && handIn.get(x) > i) n++; });
    }
    return n;
  };
  const withNeeds = G.buildGuidedRoutes({ pack, zones }), without = G.buildGuidedRoutes({ pack, zones, needs: null });
  assert.equal(early(withNeeds.routes), 0);
  assert.ok(early(without.routes) > 50, "the order mattered before");
  assert.equal(withNeeds.coverage.Horde.reachesLevel, without.coverage.Horde.reachesLevel);
  assert.equal(withNeeds.coverage.Alliance.reachesLevel, without.coverage.Alliance.reachesLevel);
  const count = (routes) => new Set(routes.flatMap((r) => r.steps.flatMap((s) => s.ids.map((id) => r.key + ":" + id)))).size;
  assert.equal(count(withNeeds.routes), count(without.routes), "no quest is lost by waiting");
});

test("the addon reference and advisor data carry the prerequisites", () => {
  const { compile } = require("../scripts/build-addon-reference.cjs");
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/forever/pack.json")));
  const lua = compile(pack), plain = compile(pack, null);
  assert.ok(lua.includes('["need"]={') && lua.includes('["after"]={') && lua.includes('["lead"]='));
  assert.ok(!plain.includes('["need"]') && !plain.includes('["lead"]'));
  assert.ok(Buffer.byteLength(lua) - Buffer.byteLength(plain) < 16 * 1024, "the extra rows are small");
  const advisor = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverAdvisorData.lua"), "utf8");
  assert.ok((advisor.match(/,p=\{[0-9,]+\}/g) || []).length >= 100);
});

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: body, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout;
}
test("in game: a quest waits for the quest it needs, and the tooltip says what comes first", () => {
  lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
BackstageForeverAdvisorData={givers={[1420]={
  {q=1,t='First',l=2,s='H',n='Giver A',x=.3,y=.6},
  {q=2,t='Second',l=3,s='H',n='Giver A',x=.3,y=.6,p={1}}}},npcs={},zones={}}
BackstageForeverReference={quests={[1]={title='First',next=2},[2]={title='Second',need={1},after={3},lead=4,next=5},[3]={title='Side | job'},[4]={title='Breadcrumb'},[5]={title='Third',need={2,3}}}}
dofile('addon/BackstageForever/BackstageForeverAdvisorMap.lua')
dofile('addon/BackstageForever/BackstageForeverChain.lua')
local who={level=3,faction='H'}
local layers={handin=false,class=false,profession=false,flight=false,gather=false}
local function ids(rows) local t={} for _,r in ipairs(rows) do t[#t+1]=r.questId end table.sort(t) return table.concat(t,',') end
-- No known history: nothing is held back.
assert(ids(BackstageForeverAdvisorPoints(1420,who,{},{},{},layers))=='1,2')
-- A known, empty history: the second quest waits.
assert(ids(BackstageForeverAdvisorPoints(1420,who,{known=true},{},{},layers))=='1')
assert(ids(BackstageForeverAdvisorPoints(1420,who,{known=true,[1]=true},{},{},layers))=='2')
assert(ids(BackstageForeverAdvisorPoints(1420,who,{[9]=true},{},{},layers))=='1')
assert(BackstageForeverAdvisorReady({p={1,2}},{[1]=true,[2]=true})==true)
assert(BackstageForeverAdvisorReady({},{known=true})==true and BackstageForeverAdvisorReady(nil,nil)==true)
local q=BackstageForeverReference.quests
local lines=BackstageForeverChainNeeds(q,2)
assert(#lines==3,#lines)
assert(lines[1]=='Finish first: First.',lines[1])
assert(lines[2]=='Recorded players had all finished: Side || job.',lines[2])
assert(lines[3]=='Breadcrumb: leads here, but players took this quest without it.',lines[3])
-- Finished quests drop out of the "first" lines; the lead-in note stays.
lines=BackstageForeverChainNeeds(q,2,function(id) return id==1 or id==3 end)
assert(#lines==1 and lines[1]:find('Breadcrumb',1,true))
assert(BackstageForeverChainNeeds(q,1)==nil and BackstageForeverChainNeeds(q,99)==nil and BackstageForeverChainNeeds(nil,1)==nil)
assert(BackstageForeverChainNeeds(q,2,function() error('boom') end)[1]=='Finish first: First.')
-- /bf chain names what else the next step needs.
assert(BackstageForeverChainLine(q,2)=='Second: step 2 of 3. Next: Third. It also needs: Side | job.',BackstageForeverChainLine(q,2))
assert(BackstageForeverChainLine(q,1)=='First: step 1 of 3. Next: Second.',BackstageForeverChainLine(q,1))
-- The tooltip gains the lines even for a quest outside any chain.
local added={}
local tip={AddLine=function(_,text) added[#added+1]=text end,Show=function() end}
BackstageForeverReference.quests[7]={title='Alone',need={1}}
assert(BackstageForeverChainTooltip(tip,7)==1 and added[1]=='Finish first: First.')
C_QuestLog={IsQuestFlaggedCompleted=function(id) return id==1 end}
assert(BackstageForeverChainTooltip(tip,7)==0)
print('ok')`);
});

"use strict";
// Guided route (0.50, roadmap 4.1).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const G = require("../src/core/guided-route.cjs");
const root = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(root, f), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: source, encoding: "utf8", timeout: 60000, maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

// A tiny world: a Horde start zone with quests for everyone, two class letters for one race, and a next zone.
const npc = (id, name, mapId, x, y) => ({ id, name, positions: [{ mapId, x, y }] });
const pack = {
  npcs: { "npc:1": npc(1, "Elder", 1411, 0.5, 0.5), "npc:2": npc(2, "Scout", 1411, 0.6, 0.5), "npc:3": npc(3, "Warden", 1413, 0.5, 0.5), "npc:4": npc(4, "Trainer", 1411, 0.51, 0.5) },
  quests: {
    10: { id: 10, title: "First Steps", level: 1, minLevel: 1, raceMask: "ffffffffffffffff", sides: ["Horde"], givers: [{ kind: "npc", id: 1 }], turnIns: [{ kind: "npc", id: 2 }], objectiveLocations: [{ positions: [{ mapId: 1411, x: 0.7, y: 0.7 }] }] },
    11: { id: 11, title: "Second Steps", level: 3, minLevel: 1, raceMask: "ffffffffffffffff", sides: ["Horde"], givers: [{ kind: "npc", id: 2 }], turnIns: [{ kind: "npc", id: 1 }] },
    12: { id: 12, title: "Simple Letter", level: 1, minLevel: 1, raceMask: "0000000000000002", sides: ["Horde"], givers: [{ kind: "npc", id: 4 }], turnIns: [] },
    13: { id: 13, title: "Etched Note", level: 1, minLevel: 1, raceMask: "0000000000000002", sides: ["Horde"], givers: [{ kind: "npc", id: 4 }], turnIns: [] },
    14: { id: 14, title: "Troll Business", level: 2, minLevel: 1, raceMask: "0000000000000080", sides: ["Horde"], givers: [{ kind: "npc", id: 1 }], turnIns: [{ kind: "npc", id: 1 }] },
    15: { id: 15, title: "Alliance Thing", level: 2, minLevel: 1, raceMask: "ffffffffffffffff", sides: ["Alliance"], givers: [{ kind: "npc", id: 1 }] },
    ...Object.fromEntries([20, 21, 22].map((id, i) => [id, { id, title: `Barrens ${i}`, level: 10 + i, minLevel: 8, raceMask: "ffffffffffffffff", sides: ["Horde"], givers: [{ kind: "npc", id: 3 }], turnIns: [{ kind: "npc", id: 3 }] }])),
  },
};
const zones = [{ mapId: 1411, min: 1, max: 10, faction: "Horde", starter: ["Orc", "Troll"] }, { mapId: 1413, min: 10, max: 25, faction: "Horde" }, { mapId: 1429, min: 1, max: 10, faction: "Alliance", starter: ["Human"] }];

test("routes per race: own race's quests only, class letters as one optional step, pick up → do → hand in, then the next zone", () => {
  const { routes, coverage } = G.buildGuidedRoutes({ pack, zones });
  const orc = routes.find((r) => r.key === "Orc"), troll = routes.find((r) => r.key === "Troll");
  assert.deepEqual(routes.map((r) => r.key).sort(), ["Human", "Orc", "Troll"], "only races whose start zone is known");
  const kinds = orc.steps.map((s) => s.kind);
  assert.equal(kinds[0], "class"); assert.deepEqual(orc.steps[0].ids, [12, 13]);
  assert.ok(kinds.indexOf("pickup") < kinds.indexOf("objective") && kinds.indexOf("objective") < kinds.indexOf("turnin"));
  assert.ok(!orc.steps.some((s) => s.ids.includes(14)), "troll-only quests stay out of the orc route");
  assert.ok(troll.steps.some((s) => s.ids.includes(14)) && !troll.steps.some((s) => s.kind === "class"), "and are in the troll route");
  assert.ok(!routes.some((r) => r.steps.some((s) => s.ids.includes(15))), "the other side's quests never appear");
  const travel = orc.steps.find((s) => s.kind === "travel");
  assert.match(travel.text, /Head to The Barrens/); assert.equal(orc.reachesLevel, 12); assert.equal(orc.startsLevel, 1);
  assert.deepEqual(orc.gaps, [{ from: 4, to: 9 }]);
  assert.equal(routes.find((r) => r.key === "Human").steps.length, 0);
  assert.equal(coverage.Horde.routes, 2);
});

test("hand review: skipped steps drop out, approved ones are marked", () => {
  const base = G.buildGuidedRoutes({ pack, zones }).routes.find((r) => r.key === "Orc");
  const [a, b] = base.steps;
  const { routes } = G.buildGuidedRoutes({ pack, zones, reviews: { routes: { Orc: { skip: [a.id], approved: [b.id] } } } });
  const r = routes.find((x) => x.key === "Orc");
  assert.ok(!r.steps.some((s) => s.id === a.id)); assert.equal(r.steps[0].approved, true); assert.equal(r.reviewed, 1);
});

test("position: the first step not behind you; well ahead skips low steps; travel counts once you've moved on", () => {
  const r = G.buildGuidedRoutes({ pack, zones }).routes.find((x) => x.key === "Orc");
  assert.equal(G.position(r, { level: 1 }).index, 0);
  assert.equal(G.position(r, { level: 3 }).index, 1, "class step is optional once you're two levels past it");
  const late = G.position(r, { level: 11, completed: [] });
  assert.equal(r.steps[late.index].kind, "travel", "five levels past the start zone: on to the Barrens");
  assert.equal(G.position(r, { level: 12, mapId: 1413, completed: [20, 21, 22] }).ended, true);
});

test("the real routes reach the same level for both factions, with every gap reported", () => {
  const { routes, coverage } = G.buildGuidedRoutes({ pack: JSON.parse(read("data/forever/pack.json")), zones: JSON.parse(read("data/forever-leveling/pack.json")).zones });
  assert.equal(routes.length, 8, "all eight races");
  assert.ok(coverage.Horde.reachesLevel >= 40 && coverage.Alliance.reachesLevel >= 40, JSON.stringify(coverage));
  for (const r of routes) {
    assert.ok(r.steps.length > 100, `${r.key} ${r.steps.length}`);
    assert.ok(r.steps.every((s) => s.text && Number.isInteger(s.mapId) && Number.isInteger(s.level)), r.key);
    assert.equal(new Set(r.steps.map((s) => s.id)).size, r.steps.length, `${r.key} step ids are unique`);
  }
  assert.deepEqual(routes.find((r) => r.key === "Dwarf").gaps[0], { from: 1, to: 9 }, "missing Dun Morogh data is reported, not hidden");
});

test("the addon carries the same routes, and its runtime follows the same rules", () => {
  assert.equal(spawnSync(process.execPath, ["scripts/build-guided-route.cjs", "--check"], { cwd: root, encoding: "utf8", timeout: 120000 }).status, 0, "BackstageForeverGuideData.lua is current");
  const out = lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverGuideData.lua')
local r=BackstageForeverGuideRoute('Scourge') assert(r and r.f=='H' and r.z==1420,'Scourge is the Undead route')
assert(BackstageForeverGuideRoute('NightElf').z==1438 and BackstageForeverGuideRoute('Night Elf').z==1438)
assert(BackstageForeverGuideRoute('Goblin')==nil)
local p=BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=1,mapId=1420},{})
assert(p.index==1 and #p.steps>=1 and p.total==#r.s)
local first=r.s[1]
local p2=BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=1,mapId=1420},{[first[8]]=true})
assert(p2.index==2,'a skipped step is passed')
local p3=BackstageForeverGuidePosition(r,{completed={},inLog={},complete={},level=60,mapId=1420},{})
local hand=true for _,s in ipairs(p3.steps or {}) do if s[1]~='t' then hand=false end end
assert(p3.ended or hand,'at 60 only unfinished hand-ins remain')
local behind=BackstageForeverGuidePosition({s={{'p','x',1,.5,.5,20,{1},'p:1'}},top=20},{completed={},inLog={},complete={},level=10},{})
assert(behind.note and behind.note:find('level 20 and you are 10',1,true))
print(#r.s)`);
  assert.ok(Number(out) > 100);
});

test("/bf route guide shows the guided route in the step frame; skip moves on; zone goes back", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local texts={}
local function fs() return {SetPoint=function()end,SetWidth=function()end,SetJustifyH=function()end,SetHeight=function()end,SetShadowOffset=function()end,SetTextColor=function()end,SetText=function(self,t) self.t=t end} end
local function frame() local f={} for _,k in ipairs({'SetSize','SetPoint','SetFrameStrata','SetMovable','EnableMouse','SetClampedToScreen','RegisterForDrag','SetScript','Show','Hide','RegisterEvent','SetText'}) do f[k]=function()end end f.CreateFontString=function() local t=fs() texts[#texts+1]=t return t end f.CreateTexture=function() return nil end return f end
CreateFrame=function() return frame() end UIParent={}
UnitRace=function() return 'Orc','Orc' end UnitLevel=function() return 1 end UnitFactionGroup=function() return 'Horde' end UnitClass=function() return 'Warrior' end
InCombatLockdown=function() return false end
C_Map={GetBestMapForUnit=function() return 1411 end,GetPlayerMapPosition=function() return {GetXY=function() return .5,.5 end} end,CanSetUserWaypointOnMap=function() return true end,SetUserWaypoint=function() end}
UiMapPoint={CreateFromCoordinates=function() return {} end}
C_QuestLog={GetNumQuestLogEntries=function() return 0 end,GetAllCompletedQuestIDs=function() return {} end,GetQuestsOnMap=function() return {} end}
dofile('addon/BackstageForever/BackstageForeverGuideData.lua')
dofile('addon/BackstageForever/BackstageForeverRoute.lua')
BackstageForeverRouteCommand('route guide')
assert(BackstageForeverRouteSettings.mode=='guide')
assert(texts[1].t:find('^BF Guide · step 1 of %d+ · level 1'),texts[1].t)
assert(said[#said]:find('Guided route: step 1 of',1,true),said[#said])
local firstText=texts[2].t
local now=BackstageForeverRouteNow()
assert(now and now.index==1 and now.total>1 and firstText:find(now.text,1,true),'The Compass reads the current guided step')
BackstageForeverRouteCommand('route skip')
assert(texts[1].t:find('^BF Guide · step 2 of'),texts[1].t)
assert(texts[2].t~=firstText)
BackstageForeverRouteCommand('route zone')
assert(BackstageForeverRouteSettings.mode=='zone')
assert(BackstageForeverRouteNow()==nil,'No guided step outside guide mode')
UnitRace=function() return 'Goblin','Goblin' end
BackstageForeverRouteCommand('route guide')
assert(said[#said]:find('no guided route for your race',1,true) and BackstageForeverRouteSettings.mode=='zone')
`));

test("the app page and the build are wired", () => {
  assert.match(read("src/main.cjs"), /handle\("guidedRoute"/);
  assert.match(read("src/preload.cjs"), /guidedRoute: \(\) => invoke\("guidedRoute"\)/);
  assert.match(read("src/renderer/player-navigation.js"), /\["guided-route","Guided route"\]/);
  assert.match(read("src/renderer/index.html"), /<script src="guided-route\.js"><\/script>/);
  assert.match(read(".github/workflows/ci.yml"), /npm run check:guided-route/);
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /BackstageForeverGuideData\.lua/);
  assert.equal(JSON.parse(read("data/forever-route/reviews.json")).version, 1);
});

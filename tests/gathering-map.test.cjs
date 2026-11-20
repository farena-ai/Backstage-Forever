"use strict";
// 1.2 (J4): remembered gathering spots on the in-game World Map, with the skill each node needs.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs"), { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: body, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const prelude = String.raw`
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function()end}end
InCombatLockdown=function()return false end
local rank=1
time=function()return 1794398400 end
UnitGUID=function()return 'PLAYER' end
GetBuildInfo=function()return '1.60.1','70862' end
C_Map={GetBestMapForUnit=function()return 1411 end}
C_SkillInfo={GetNumSkillLines=function()return rank and 1 or 0 end,GetSkillLineInfo=function()return {isHeader=false,skillID=186,rank=rank,maxRank=75}end}
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
dofile('addon/BackstageForever/BackstageForeverAcquisition.lua')
dofile('addon/BackstageForever/BackstageForeverGathering.lua')
local function node(method,id,name,xy,map)
 return {method=method,entityId=id,name=name,mapId=map,x=xy/10000,y=xy/10000,observedAt=1794398400,clientBuild='1.60.1.70862',
   id=('wowf:%s:%d:%d:%d:%d:1.60.1.70862'):format(method,id,map,xy,xy),itemIds={2770},evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
end
local recs={node('mining',1731,'Copper Vein',1000,1411),node('mining',1731,'Copper Vein',2000,1411),node('herbalism',1617,'Silverleaf',3000,1411),node('mining',1731,'Copper Vein',3000,1)}
BackstageForeverGatheringDB={schemaVersion=1,recording=true,records=recs}
BackstageForeverGatheringSession('PLAYER_LOGIN')
`;

test("node skills: classic requirements by name, longest name wins", () => lua(prelude + String.raw`
assert(BackstageForeverNodeSkill('Copper Vein')==1)
assert(BackstageForeverNodeSkill('Rich Thorium Vein')==275,'rich beats small thorium')
assert(BackstageForeverNodeSkill('Ooze Covered Rich Thorium Vein')==275)
assert(BackstageForeverNodeSkill("Khadgar's Whisker")==185)
assert(BackstageForeverNodeSkill('Battered Chest')==nil)
assert(BackstageForeverNodeGatherable({method='mining',name='Iron Deposit'},{mining=100})==false)
assert(BackstageForeverNodeGatherable({method='mining',name='Iron Deposit'},{mining=130})==true)
assert(BackstageForeverNodeGatherable({method='mining',name='Iron Deposit'},{})==nil,'unknown skill is unknown')
assert(BackstageForeverNodeGatherable({method='chest',name='Battered Chest'},{})==true)
`));

test("map points: same zone and current profession, with approximate historical labeling", () => lua(prelude + String.raw`
local rows=BackstageForeverGatheringMapPoints(1411,recs,{mining=true,chest=true},{mining=100})
assert(#rows==2 and rows[1].title=='Copper Vein')
assert(rows[1].icon:find('INV_Ore',1,true) and rows[1].detail:find('not a live spawn',1,true))
assert(#BackstageForeverGatheringMapPoints(1411,recs,nil,{},1)==1,'limit holds')
rank=nil
assert(#BackstageForeverGatheringMapPoints(1411,recs,nil,{mining=100})==0,'cached/caller skill cannot qualify the mark')
assert(#BackstageForeverGatheringMapPoints(nil,recs)==0)
`));

test("the World Map guide gets a Gathering spots layer; /bf next never sends you to a node", () => {
  const src = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverAdvisorMap.lua"), "utf8");
  assert.match(src, /local LAYERS=\{'pickup','handin','class','profession','flight','gather'\}/);
  assert.match(src, /gather='Gathering spots'/);
  assert.match(src, /flight=false,gather=false\}/);
  assert.match(src, /SetDesaturated',row\.dim==true/);
  lua(prelude + String.raw`
BackstageForeverAdvisorData={givers={},npcs={},zones={}}
BackstageForeverGatheringDB={schemaVersion=1,recording=true,records=recs}
dofile('addon/BackstageForever/BackstageForeverAdvisorMap.lua')
local rows=BackstageForeverAdvisorPoints(1411,{level=20,faction='H',className='Mage'},{},{},{},nil)
local n=0 for _,r in ipairs(rows)do if r.layer=='gather' then n=n+1 end end
assert(n==2,'only the same-zone verified profession points: '..n)
rank=nil
assert(#BackstageForeverAdvisorPoints(1411,{level=20,faction='H',className='Mage'},{},{},{},nil)==0)
assert(#BackstageForeverAdvisorPoints(1411,{level=20,faction='H'},{},{},{},{gather=false})==0)`);
});

test("/bf nodes leaves out spots you can't gather yet and says so", () => {
  const src = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverGathering.lua"), "utf8");
  assert.match(src, /BackstageForeverNodeGatherable\(r,ownedRanks\)==false then tooHigh=tooHigh\+1/);
  assert.match(src, /more skill than you have/);
});

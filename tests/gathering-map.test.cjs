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
date=function(f,t)return 'Nov 14' end
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
dofile('addon/BackstageForever/BackstageForeverAcquisition.lua')
dofile('addon/BackstageForever/BackstageForeverGathering.lua')
local function node(method,name,x,y)return {method=method,name=name,mapId=1411,x=x,y=y,observedAt=1794398400,id=name..x}end
local recs={node('mining','Copper Vein',.1,.1),node('mining','Iron Deposit',.2,.2),node('herbalism','Peacebloom',.3,.3),node('chest','Battered Chest',.4,.4),node('mining','Tin Vein',.5,.5),{method='mining',name='Elsewhere',mapId=1,x=.5,y=.5}}
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

test("map points: this map only, your professions, gatherable first, the rest dimmed with the skill they need", () => lua(prelude + String.raw`
local rows=BackstageForeverGatheringMapPoints(1411,recs,{mining=true,chest=true},{mining=100})
assert(#rows==4,'herbs left out, other map left out: '..#rows)
assert(rows[#rows].title=='Iron Deposit' and rows[#rows].dim==true and rows[#rows].detail:find('needs 125, you have 100',1,true),rows[#rows].detail)
for i=1,3 do assert(rows[i].dim==false and rows[i].layer=='gather') end
assert(rows[1].icon:find('Icons',1,true))
local copper for _,r in ipairs(rows)do if r.title=='Copper Vein' then copper=r end end
assert(copper.detail:find('Mining 1 - you can gather this (100)',1,true) and copper.detail:find('Last gathered Nov 14',1,true),copper.detail)
assert(#BackstageForeverGatheringMapPoints(1411,recs,nil,{},2)==2,'limit holds')
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
assert(n==5,'every remembered spot here while professions are unknown: '..n)
assert(#BackstageForeverAdvisorPoints(1411,{level=20,faction='H'},{},{},{},{gather=false})==0)`);
});

test("/bf nodes leaves out spots you can't gather yet and says so", () => {
  const src = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverGathering.lua"), "utf8");
  assert.match(src, /BackstageForeverNodeGatherable\(r,ownedRanks\)==false then tooHigh=tooHigh\+1/);
  assert.match(src, /more skill than you have/);
});

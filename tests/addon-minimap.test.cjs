"use strict";
// 1.19: quest pins on the minimap. The placement math and the choice of pins are pure and tested here.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const LOAD = String.raw`
BackstageForeverPublicFacts={public=function(v) return v end,field=function(t,k) if type(t)=='table' then return t[k] end end,
  number=function(v,lo,hi) if type(v)=='number' and v>=lo and v<=hi then return v end end,text=function(v) return v end}
dofile('addon/BackstageForever/BackstageForeverMinimap.lua')
local function near(a,b) return math.abs(a-b)<1e-6 end
`;

test("a spot lands where it is on a north-up minimap, and on the edge when it is further than the minimap shows", () => lua(LOAD + String.raw`
local f=BackstageForeverMinimapOffset
-- 50 yards east on a 100-yard, 70-pixel minimap: half way right, level.
local x,y,edge,d=f(50,0,nil,false,100,70);assert(near(x,35) and near(y,0) and edge==false and near(d,50))
-- 50 yards south: half way down.
x,y,edge=f(0,50,nil,false,100,70);assert(near(x,0) and near(y,-35) and edge==false)
-- 300 yards north-east: on the rim, towards the top right.
x,y,edge,d=f(300,-300,nil,false,100,70);assert(edge==true and near(math.sqrt(x*x+y*y),70) and x>0 and y>0 and near(d,math.sqrt(180000)))
for _,bad in ipairs({{nil,0},{0/0,0},{1,1e9}}) do assert(f(bad[1],bad[2],nil,false,100,70)==nil) end
assert(f(1,1,nil,false,0,70)==nil and f(1,1,nil,false,100,0)==nil)
`));

test("on a rotating minimap the pin turns with you", () => lua(LOAD + String.raw`
local f=BackstageForeverMinimapOffset
-- Facing west (a quarter turn counter-clockwise): a spot due north is on your right.
local x,y=f(0,-50,math.pi/2,true,100,70);assert(near(x,35) and near(y,0),x..','..y)
-- Facing south: a spot due north is behind you, at the bottom.
x,y=f(0,-50,math.pi,true,100,70);assert(near(x,0) and near(y,-35))
-- Facing north changes nothing, and a fixed minimap ignores facing.
x,y=f(20,-30,0,true,100,70);assert(near(x,14) and near(y,21))
x,y=f(20,-30,math.pi/2,false,100,70);assert(near(x,14) and near(y,21))
`));

test("hand-ins come first, far pick-ups are left out, and the list is capped", () => lua(LOAD + String.raw`
local rows={{layer='pickup',distance=40,edge=false,title='near pickup'},{layer='pickup',distance=400,edge=true,title='far pickup'},
  {layer='handin',distance=900,edge=true,title='far handin'},{layer='flight',distance=10,edge=false,title='flight'},{layer='handin',distance=30,edge=false,title='near handin'}}
local out=BackstageForeverMinimapChoose(rows,24)
assert(#out==4 and out[1].title=='near handin' and out[2].title=='far handin' and out[3].title=='flight' and out[4].title=='near pickup')
assert(#BackstageForeverMinimapChoose(rows,2)==2)
local many={} for i=1,60 do many[i]={layer='pickup',distance=i,edge=false} end
assert(#BackstageForeverMinimapChoose(many,24)==24)
`));

test("the minimap file is display only and wired into the addon", () => {
  const src = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverMinimap.lua"), "utf8");
  for (const forbidden of ["SetUserWaypoint", "SetSuperTracked", "COMBAT_LOG", "AcceptQuest", "TargetUnit", "SendChatMessage"]) assert.ok(!src.includes(forbidden), forbidden);
  assert.match(src, /InCombatLockdown\)~=false then hideAll\(\) return end/, "hidden in combat");
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverHUD.lua"), "utf8"), /word=='minimap'/);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /BackstageForeverAdvisorMap\.lua\r?\nBackstageForeverMinimap\.lua/);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /BackstageForeverMinimapSettings/);
});

test("/bf available names the nearest quests with distance and a compass word", () => lua(LOAD + String.raw`
local w=BackstageForeverCompassWord
assert(w(0,-10)=='north' and w(10,0)=='east' and w(0,10)=='south' and w(-10,0)=='west')
assert(w(10,-10)=='north-east' and w(10,10)=='south-east' and w(-10,10)=='south-west' and w(-10,-10)=='north-west')
assert(w(0,0)==nil and w(nil,1)==nil)
local lines=BackstageForeverAvailableLines({},8)
assert(#lines==1 and lines[1]:find('No quests to pick up',1,true))
lines=BackstageForeverAvailableLines({{title='Gornek',detail='Your Place In The World (level 1)',east=0,south=-120,distance=120}},8)
assert(lines[1]=='1 quest you can pick up on this map:' and lines[2]=='Your Place In The World (level 1), Gornek: 120 yards north',lines[2])
local many={} for i=1,11 do many[i]={title='Giver '..i,detail='Quest '..i,east=i*10,south=0,distance=i*10} end
lines=BackstageForeverAvailableLines(many,8)
assert(lines[1]=='11 quests you can pick up on this map:' and #lines==10 and lines[2]:find('Giver 1: 10 yards east',1,true) and lines[10]=='+3 more on the map (BF Guide).',lines[10])
`));

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const LOAD = "dofile('addon/BackstageForever/BackstageForeverRoute.lua')\n";

test("route steps: nearest-next walk, finishing what you carry before new pick-ups, pick-ups merged per giver", () => lua(LOAD + String.raw`
local s=BackstageForeverRouteSteps(.50,.50,{
  {kind='pickup',x=.52,y=.50,questId=1,title='A',npc='Gornek'},
  {kind='pickup',x=.525,y=.505,questId=2,title='B',npc='Gornek'},
  {kind='objective',x=.60,y=.50,questId=3,title='Raptors',detail='Raptor Head: 3/12'},
  {kind='turnin',x=.515,y=.50,questId=4,title='Done quest',npc='Thrall'},
  {kind='pickup',x=.9,y=.9,questId=5,title='Far',npc='Someone'},
  {kind='bogus',x=.5,y=.5},{kind='pickup',x=2,y=.5},
})
assert(#s==4,'merged and filtered: '..#s)
assert(s[1].kind=='turnin' and s[1].text=='Hand in “Done quest” to Thrall',s[1].text)
assert(s[2].kind=='pickup' and s[2].text=='Pick up 2 quests from Gornek: A, B',s[2].text)
assert(s[3].kind=='objective' and s[3].text:find('Raptor Head',1,true))
assert(s[4].questId==5)
assert(#BackstageForeverRouteSteps(nil,nil,nil)==0)
local many={} for i=1,40 do many[i]={kind='objective',x=i/50,y=.5,questId=i} end
assert(#BackstageForeverRouteSteps(0,.5,many)==15,'bounded')
`));

test("objective tooltip lines: kills by name, drops from what this player looted, finished ones skipped", () => lua(LOAD + String.raw`
local log={
  {id=1,title='Raptor Thieves',complete=false,objectives={{text='Raptor Head: 3/12',done=false}}},
  {id=2,title='Plainstrider Menace',complete=false,objectives={{text='Plainstrider slain: 2/7',done=false},{text='Zhevra slain: 4/4',done=true}}},
  {id=3,title='Finished',complete=true,objectives={{text='Plainstrider slain: 7/7',done=true}}},
}
local db={{itemId=5062,name='Raptor Head',sources={{kind='creature',id=3254,name='Sunscale Lashtail'}}}}
local a=BackstageForeverObjectiveLines('Plainstrider',3244,log,db)
assert(#a==1 and a[1]=='Plainstrider Menace: Plainstrider slain: 2/7',a[1])
local b=BackstageForeverObjectiveLines('Sunscale Lashtail',3254,log,db)
assert(#b==1 and b[1]=='Raptor Thieves: Raptor Head: 3/12',tostring(b[1]))
assert(#BackstageForeverObjectiveLines('Zhevra',1,log,db)==0,'a finished objective adds nothing')
assert(#BackstageForeverObjectiveLines(nil,1,log,db)==0)
`));

test("/bf route shows a frame with the first step and sets the arrow there; next/back browse; nothing in combat", () => lua(String.raw`
local fighting=false
InCombatLockdown=function() return fighting end
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local texts={}
local function obj() local o={} setmetatable(o,{__index=function(t,k) return function(self,...) if k=='SetText' then texts[self]=...; end if k=='CreateTexture' or k=='CreateFontString' then return obj() end end end}) return o end
CreateFrame=function() return obj() end
UIParent=obj()
local waypoint
C_Map={GetBestMapForUnit=function() return 1413 end,GetPlayerMapPosition=function() return {GetXY=function() return .5,.5 end} end,CanSetUserWaypointOnMap=function() return true end,SetUserWaypoint=function(p) waypoint=p end}
UiMapPoint={CreateFromCoordinates=function(m,x,y) return {m=m,x=x,y=y} end}
C_SuperTrack={SetSuperTrackedUserWaypoint=function() end}
C_QuestLog={GetNumQuestLogEntries=function() return 1 end,GetInfo=function() return {questID=9,title='Raptor Thieves',isHeader=false} end,IsComplete=function() return false end,
  GetQuestObjectives=function() return {{text='Raptor Head: 3/12',finished=false}} end,GetAllCompletedQuestIDs=function() return {} end,
  GetQuestsOnMap=function() return {{questID=9,x=.55,y=.52}} end}
UnitLevel=function() return 14 end UnitFactionGroup=function() return 'Horde' end UnitClass=function() return 'Hunter' end
BackstageForeverAdvisorPoints=function() return {{layer='pickup',x=.51,y=.5,questId=7,title='Gazrog',detail='Lost in Battle (level 14)'}} end
dofile('addon/BackstageForever/BackstageForeverRoute.lua')
BackstageForeverRouteCommand('route')
assert(BackstageForeverRouteSettings.shown==true)
assert(waypoint and waypoint.m==1413 and math.abs(waypoint.x-.51)<1e-9,'arrow on the first step (the nearer pick-up)')
local body for _,t in pairs(texts) do if t:find('Pick up',1,true) then body=t end end
assert(body and body:find('Lost in Battle',1,true) and body:find('Gazrog',1,true),tostring(body))
BackstageForeverRouteCommand('route next')
local second for _,t in pairs(texts) do if t:find('step 2 of 2',1,true) then second=t end end
assert(second,'browsed to step 2')
fighting=true;waypoint=nil;BackstageForeverRouteRefresh();assert(waypoint==nil,'no waypoint changes in combat')
fighting=false
BackstageForeverRouteCommand('route arrow');assert(BackstageForeverRouteSettings.arrow==false)
BackstageForeverRouteCommand('route');assert(BackstageForeverRouteSettings.shown==false)
BackstageForeverRouteCommand('route sideways');assert(said[#said]:find('/bf route next',1,true))
`));

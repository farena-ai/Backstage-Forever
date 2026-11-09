const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
test("Lua captures guarded build, complete IDs and objective counters; waypoint parsing checks phase/build/combat/APIs", () => {
  const result = spawnSync(
    process.execPath,
    [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"],
    {
      cwd: require("node:path").join(__dirname, ".."),
      encoding: "utf8",
      timeout: 20000,
      input: String.raw`
local handler, set, messages
messages={}
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end}end
issecretvalue=function(v)return v=='SECRET'end
InCombatLockdown=function()return false end
UnitGUID=function()return 'Synthetic'end
UnitFullName=function()return 'Example','Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 20 end
GetBuildInfo=function()return '1.60.1','70862','date',16001 end
GetLocale=function()return 'enUS'end
time=function()return 1700000000 end
C_QuestLog={GetNumQuestLogEntries=function()return 1 end,GetInfo=function()return {isHeader=false,questID=1061,title='The Spirits of Stonetalon'}end,IsComplete=function()return true end,GetQuestObjectives=function()return {{text='Talk',finished=false,type='event',numRequired=1,numFulfilled=0}}end,GetAllCompletedQuestIDs=function()return {5730,5729}end,GetLogIndexForQuestID=function(id)if id==1061 then return 1 end end}
DEFAULT_CHAT_FRAME={AddMessage=function(_,text)messages[#messages+1]=text end}
C_Map={CanSetUserWaypointOnMap=function()return true end,SetUserWaypoint=function(point)set=point end,GetMapInfo=function()return {name='Localized place'}end}
UiMapPoint={CreateFromCoordinates=function(map,x,y)return {map=map,x=x,y=y}end}
dofile('addon/BackstageForever/BackstageForever.lua');handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('"clientBuild":"1.60.1.70862"',1,true))
assert(BackstageForeverExport:find('"captureVersion":"0.7.0"',1,true))
assert(BackstageForeverExport:find('"completedIds":[5729,5730]',1,true))
assert(BackstageForeverExport:find('"completedIdsKnown":true',1,true))
assert(BackstageForeverExport:find('"required":1',1,true))
BackstageForeverGuide('guide 1061 t 1413 0.3528 0.2786 1.60.1.70862');assert(set and set.map==1413)
assert(messages[#messages]:find('Localized place',1,true))
assert(messages[#messages]:find('Quest waypoint:',1,true));assert(not messages[#messages]:find('reference marker',1,true))
BackstageForeverGuide('guide 1061 r 1413 .3 .2 1.60.1.70862');assert(messages[#messages]:find('Reference marker (check availability):',1,true))
C_QuestLog.IsComplete=function()return false end;BackstageForeverGuide('guide 1061 o 999 .1 .2 1.60.1.70862');assert(set.map==999);assert(messages[#messages]:find('Quest waypoint:',1,true));C_QuestLog.IsComplete=function()return true end
for _,command in ipairs({'guide 1061 t 1413 -1 0.2 1.60.1.70862','guide 1061 o 1413 .3 .2 1.60.1.70862','guide 1061 t 1413 .3 .2 1.60.1.999','guide 999 t 1413 .3 .2 1.60.1.70862','guide 1061 t 1413 .3 .2 1.60.1.70862 extra','guide 1061 t 1413 nan .2 1.60.1.70862'})do
set=nil;BackstageForeverGuide(command);assert(set==nil,command)
end
BackstageForeverGuide('guide 1061 t 1413 .3 .2 1.60.1.999');assert(not messages[#messages]:find('desktop snapshot',1,true))
BackstageForeverGuide('guide 1061 o 1413 .3 .2 1.60.1.70862');assert(not messages[#messages]:find('refresh your snapshot',1,true))
InCombatLockdown=function()return true end;set=nil;BackstageForeverGuide('guide 1061 r 1413 .3 .2 1.60.1.70862');assert(not set)
InCombatLockdown=function()return false end
C_Map.CanSetUserWaypointOnMap=function()return false end;BackstageForeverGuide('guide 1061 r 1413 .3 .2 1.60.1.70862');assert(not set);assert(messages[#messages]:find('coordinates',1,true))
C_Map.CanSetUserWaypointOnMap=function()return true end
C_Map.SetUserWaypoint=function()error('PRIVATE RESTRICTED ERROR')end;BackstageForeverGuide('guide 1061 r 1413 .3 .2 1.60.1.70862');assert(not messages[#messages]:find('PRIVATE',1,true))
GetBuildInfo=function()return 'SECRET','70862'end;C_QuestLog.GetAllCompletedQuestIDs=function()return {1,1}end;handler(nil,'QUEST_LOG_UPDATE')
assert(not BackstageForeverExport:find('"clientBuild"',1,true));assert(not BackstageForeverExport:find('"completedIdsKnown":true',1,true))
local touched=false;local secret=setmetatable({},{__pairs=function()touched=true;error('secret')end})
issecretvalue=function(v)return v==secret or v=='SECRET'end;C_QuestLog.GetAllCompletedQuestIDs=function()return secret end;handler(nil,'QUEST_LOG_UPDATE');assert(not touched)
print('Knowledge capture and waypoint guards passed')
`,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /guards passed/);
});

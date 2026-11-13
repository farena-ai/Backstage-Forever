"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), path = require("node:path");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const fixture = String.raw`
local handler,hud,status
local who,build,complete,fighting='A','70888',false,false
local currentMap,poiMap=1413,1456
local direct,points,rows={},{},{}
local calls={direct=0,point={},pois={},info={},poiMap=0}
local timers={}
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function(_,_,f)handler=f end}end
InCombatLockdown=function()return fighting end
issecretvalue=function(v)return v=='SECRET' end
C_Timer={After=function(delay,f)assert(delay==.25);timers[#timers+1]=f end}
UnitGUID=function()return who end
UnitFullName=function()return who,'Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 20 end
UnitXP=function()return 24 end
UnitXPMax=function()return 100 end
GetBuildInfo=function()return '1.60.1',build end
GetLocale=function()return 'enUS'end
GetZoneText=function()return 'Zone'end
GetSubZoneText=function()return ''end
time=function()return 1700000000 end
BackstageForeverHUDUpdate=function(c)hud=c end
BackstageForeverHUDCaptureStatus=function(s)status=s end
local actions=0
local function forbidden()actions=actions+1;error('FORBIDDEN GAME ACTION')end
C_Map={GetBestMapForUnit=function(unit)assert(unit=='player');return currentMap end,
 GetMapInfo=function(id)calls.info[id]=(calls.info[id] or 0)+1;return {mapID=id,name='Actual map',mapType=3,parentMapID=0,flags=0}end,
 SetUserWaypoint=forbidden,OpenWorldMap=forbidden}
C_SuperTrack={SetSuperTrackedQuestID=forbidden}
QuestMapFrame_OpenToQuestDetails=forbidden
C_QuestLog={GetNumQuestLogEntries=function()return 1,1 end,
 GetInfo=function()return {questID=42,title='Observed quest',isHeader=false}end,
 IsComplete=function()return complete end,
 GetQuestObjectives=function()return {{text='Observed objective',finished=complete,type='monster',numRequired=4,numFulfilled=1}}end,
 GetNextWaypoint=function(id)assert(id==42);calls.direct=calls.direct+1;return table.unpack(direct)end,
 GetNextWaypointText=function(id)assert(id==42);return 'Public game marker'end,
 GetMapForQuestPOIs=function()calls.poiMap=calls.poiMap+1;return poiMap end,
 GetNextWaypointForMap=function(id,map)assert(id==42);calls.point[map]=(calls.point[map] or 0)+1;return table.unpack(points[map] or {})end,
 GetQuestsOnMap=function(map)calls.pois[map]=(calls.pois[map] or 0)+1;return rows[map]end,
 SetMapForQuestPOIs=forbidden,SetSelectedQuest=forbidden,SetAbandonQuest=forbidden}
local function poi(id,map,x,y)return {questID=id,mapID=map,x=x,y=y,inProgress=true,isQuestStart=false,isMapIndicatorQuest=false,numObjectives=1,isDaily=false,isCombatAllyQuest=false,isMeta=false}end
local function event(e)handler(nil,e)end
local function flush()local q=timers;timers={};for _,f in ipairs(q)do f()end end
local function refresh()event('QUEST_LOG_UPDATE');flush()end
local function q()assert(hud and hud.quests and hud.progress.current==24,'Optional destinations must preserve quest and XP facts');return hud.quests[1]end
local function save()print(BackstageForeverExport)end
dofile('addon/BackstageForever/BackstageForever.lua')
`;
function run(scenario) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], {
    cwd: path.join(__dirname, ".."), input: fixture + scenario + "\nassert(actions==0,'Collection must never invoke a game action')", encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || r.error?.message); assert.equal(r.stderr, "");
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map(raw => {
    parseSavedVariables("BackstageForeverExport = " + JSON.stringify(raw));
    return JSON.parse(raw);
  });
}

test("map-specific API uses its exact two-coordinate return on actual current and remote UI maps", () => run(String.raw`
points[1413]={0,.75};event('PLAYER_LOGIN')
assert(q().destination and q().destination.mapId==1413 and q().destination.x==0 and q().destination.y==.75,'Current map-specific point must be captured')
assert(calls.point[1413]==1 and not next(calls.pois));save()
points[1413]=nil;points[1456]={1,.25};refresh()
assert(q().destination.mapId==1456 and q().destination.x==1 and q().destination.y==.25,'Remote actual POI map retains its own coordinate system');save()
`));

test("valid direct point wins and optional failures cannot erase it or core facts", () => run(String.raw`
direct={1456,.2,.3};points[1413]={.9,.9};rows[1413]={poi(42,1413,.8,.8)}
C_QuestLog.GetMapForQuestPOIs=function()error('PRIVATE OPTIONAL ERROR')end
C_QuestLog.GetNextWaypointForMap=function()error('PRIVATE OPTIONAL ERROR')end
C_QuestLog.GetQuestsOnMap=function()error('PRIVATE OPTIONAL ERROR')end
event('PLAYER_LOGIN');assert(q().destination.mapId==1456 and q().destination.x==.2)
assert(not next(calls.point) and not next(calls.pois),'Direct winner must short-circuit complementary calls')
C_Map.GetMapInfo=function()error('PRIVATE OPTIONAL ERROR')end;refresh()
assert(q().destination and q().destination.mapId==1456,'An unavailable optional query cannot remove a valid existing direct marker')
assert(not BackstageForeverExport:find('PRIVATE',1,true));save()
direct={};refresh();assert(not q().destination);save()
`));

test("successful contradictory or secret map metadata cannot validate a direct UI marker", () => run(String.raw`
direct={1456,.2,.3};event('PLAYER_LOGIN');assert(q().destination)
C_Map.GetMapInfo=function(id)return {mapID=id+1}end;refresh();assert(not q().destination,'Explicit map contradiction must fail closed')
C_Map.GetMapInfo=function()return 'SECRET'end;refresh();assert(not q().destination,'Secret metadata cannot prove a direct UI map')
C_Map.GetMapInfo=function()return {}end;refresh();assert(not q().destination,'Malformed present metadata cannot prove a direct UI map')
C_Map.GetMapInfo=nil;refresh();assert(q().destination,'Absent optional API retains existing direct semantics');save()
`));

test("strict in-progress quest area survives existing transport and native generic marker qualification", () => {
  const [snapshot] = run(String.raw`
rows[1413]={poi(77,1413,.1,.2),poi(42,1413,.3,.4),poi(42,1413,.3,.4)}
event('PLAYER_LOGIN');assert(q().destination and q().destination.mapId==1413,'Exact in-progress POI must provide an area marker')
assert(q().destination.text=='Quest area reported by the game; not an exact NPC or spawn location')
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local step=BackstageForeverBuildPlan(hud,{minutes=30,focus='balanced'}).steps[1]
assert(step.source=='game' and step.phase=='o' and step.destination.mapId==1413)
assert(step.detail:find('Quest area reported by the game',1,true) and step.detail:find('not an exact NPC or spawn location',1,true))
assert(step.command and step.command:find('guide 42 o 1413',1,true));save()
`);
  assert.deepEqual(Object.keys(snapshot.characters[0].quests[0].destination).sort(), ["mapId", "text", "x", "y"]);
  const parsed = parseSavedVariables("BackstageForeverExport = " + JSON.stringify(JSON.stringify(snapshot)));
  const profile = { ...parsed.characters[0], notes: "PRIVATE NOTES", goals: [{ text: "PRIVATE GOAL" }],
    source: { kind: "wow-addon", updatedAt: parsed.characters[0].updatedAt, id: "PRIVATE SOURCE" } };
  const approved = require("../src/core/providers.cjs").approvedProfile(profile);
  assert.equal(approved.quests[0].destination.text, snapshot.characters[0].quests[0].destination.text);
  assert.doesNotMatch(JSON.stringify(approved), /PRIVATE/);
  const index = new (require("../src/core/knowledge.cjs").KnowledgeIndex)(require("../data/forever/pack.json"));
  const resolved = index.resolveWaypoint(profile, 42, "o");
  assert.equal(resolved.source, "game");
  assert.equal(resolved.destination.text, approved.quests[0].destination.text);
  assert.equal(resolved.canCopy, true);
  assert.equal(index.resolveWaypoint(profile, 42, "t").canCopy, false);
  assert.equal(index.resolveWaypoint({ ...profile, clientBuild: "1.60.1.99999" }, 42, "o").canCopy, false);
});

test("quest area rejects start-only broad absent-state conflicting and malformed matching rows", () => run(String.raw`
local cases={
 function(r)r.questID=99 end,function(r)r.inProgress=false end,function(r)r.inProgress=nil end,
 function(r)r.isQuestStart=true end,function(r)r.isQuestStart=nil end,
 function(r)r.isMapIndicatorQuest=true end,function(r)r.isMapIndicatorQuest=nil end,
 function(r)r.mapID=1456 end,function(r)r.mapID='SECRET' end,
 function(r)r.x=-.1 end,function(r)r.x=0/0 end,function(r)r.y=math.huge end,
 function(r)r.x='SECRET' end,function(r)r.questID='SECRET' end}
event('PLAYER_LOGIN')
for i,change in ipairs(cases)do
 local row=poi(42,1413,.3,.4);change(row);rows[1413]={row};refresh()
 assert(not q().destination,'Invalid area case '..i..' must not create a point')
end
rows[1413]={poi(42,1413,.3,.4),poi(42,1413,.31,.4)};refresh();assert(not q().destination,'Conflicting exact rows are ambiguous')
rows[1413]={poi(42,1413,.3,.4),poi(42,1413,.3,.4)};rows[1456]={poi(42,1456,.3,.4)}
refresh();assert(not q().destination,'Two maps without documented conversion are ambiguous')
rows[1456]=nil;rows[1413][2].isQuestStart=true;refresh();assert(not q().destination,'An incompatible duplicate cannot be ignored')
rows[1413]={poi(42,1413,.3,.4)};refresh();assert(q().destination,'One coherent point remains supported');save()
`));

test("quest area is never a ready turn-in and a changed completion phase invalidates fallback", () => run(String.raw`
rows[1413]={poi(42,1413,.3,.4)};complete=true;event('PLAYER_LOGIN')
assert(not q().destination and not next(calls.pois),'Unfinished POIs never locate a turn-in')
complete=false;C_QuestLog.GetQuestObjectives=function()return {{text='Finished objective',finished=true}}end
refresh();assert(not q().destination,'Absent unfinished objective must not imply objective area')
C_QuestLog.GetQuestObjectives=function()return {{text='Objective',finished=false}}end
C_QuestLog.GetNextWaypointForMap=function()complete=true;return .2,.3 end
refresh();assert(not q().destination,'Phase changing during optional observation must invalidate that point');save()
`));

test("map validation rejects fabricated or protected IDs and coordinates without losing quest or XP", () => run(String.raw`
event('PLAYER_LOGIN')
for _,bad in ipairs({0,-1,.5,'SECRET',math.huge})do
 currentMap=bad;poiMap=bad;refresh();assert(not q().destination)
end
currentMap=1413;poiMap=1456;points[1413]={.2,.3};points[1456]={.4,.5}
C_Map.GetMapInfo=function(id)return {mapID=id+1,name='Wrong map'}end
refresh();assert(not q().destination,'Lookup must confirm the exact UI map identity')
C_Map.GetMapInfo=function()return nil end;refresh();assert(not q().destination)
C_Map.GetMapInfo=function()return 'SECRET'end;refresh();assert(not q().destination)
local inspected=false;local protected=setmetatable({},{__index=function()inspected=true;error('PRIVATE PROTECTED')end,__pairs=function()inspected=true;error('PRIVATE PROTECTED')end})
issecretvalue=function(v)return v==protected or v=='SECRET'end
C_Map.GetMapInfo=function()return protected end;refresh();assert(not q().destination and not inspected)
C_Map.GetMapInfo=function(id)return {mapID=id,name='Map'}end
C_QuestLog.GetNextWaypointForMap=function()return protected,.3 end;C_QuestLog.GetQuestsOnMap=function()return protected end
refresh();assert(not q().destination and not inspected)
C_QuestLog.GetQuestsOnMap=function()return {protected}end;refresh();assert(not q().destination and not inspected)
C_QuestLog.GetNextWaypointForMap=function()return 1413,.2,.3 end;refresh();assert(not q().destination,'Three-return tuple must not be misread as two normalized coordinates')
assert(not BackstageForeverExport:find('PRIVATE',1,true) and not BackstageForeverExport:find('SECRET',1,true));save()
`));

test("bounded unique map queries cache POIs only within one capture and respect lifecycle coalescing", () => run(String.raw`
direct={1500};currentMap=1413;poiMap=1456
rows[1413]={poi(42,1413,.3,.4)}
event('PLAYER_LOGIN');assert(q().destination)
local count=0;for _,n in pairs(calls.point)do assert(n==1);count=count+1 end;assert(count==3,'Only three observed map IDs may be queried')
for _,n in pairs(calls.pois)do assert(n==1)end
local before=calls.direct;for i=1,50 do event('QUEST_LOG_UPDATE')end;assert(calls.direct==before and #timers==1)
flush();assert(calls.direct==before+1 and calls.pois[1413]==2,'Caches cannot survive fresh captures')
fighting=true;refresh();assert(calls.direct==before+1);fighting=false
local saved=BackstageForeverExport;event('PLAYER_LOGOUT');rows[1413]=nil;flush();assert(BackstageForeverExport==saved)
who='B';build='99999';event('PLAYER_LOGIN');assert(hud.id=='B' and hud.clientBuild=='1.60.1.99999' and not q().destination,'Previous character/build area cannot leak');save()
direct={};poiMap=1413;calls.point={};calls.pois={};refresh()
count=0;for _,n in pairs(calls.point)do assert(n==1);count=count+1 end;assert(count==1,'Duplicate actual map sources are queried once')
`));

test("oversized sparse and throwing POI containers fail closed while optional APIs stay isolated", () => run(String.raw`
event('PLAYER_LOGIN')
local large={};for i=1,1001 do large[i]=poi(42,1413,.3,.4)end
rows[1413]=large;refresh();assert(not q().destination,'Oversized POI lists must be rejected, not truncated into false certainty')
rows[1413]={[1]=poi(42,1413,.3,.4),[3]=poi(42,1413,.3,.4)};refresh();assert(not q().destination,'Sparse list is unavailable')
rows[1413]=setmetatable({},{__pairs=function()error('PRIVATE POI ERROR')end});refresh();assert(not q().destination)
C_QuestLog.GetNextWaypointForMap=function()error('PRIVATE POINT ERROR')end
C_QuestLog.GetQuestsOnMap=function()error('PRIVATE POI ERROR')end
refresh();assert(not q().destination and status=='partial')
C_QuestLog.GetNextWaypointForMap=nil;C_QuestLog.GetQuestsOnMap=nil;C_QuestLog.GetMapForQuestPOIs=nil
refresh();assert(not q().destination);assert(not BackstageForeverExport:find('PRIVATE',1,true));save()
`));

test("a malformed second map cannot hide a conflicting match behind a valid area", () => run(String.raw`
rows[1413]={poi(42,1413,.3,.4)}
rows[1456]={[1]=poi(42,1456,.3,.4),[3]=poi(42,1456,.3,.4)}
event('PLAYER_LOGIN');assert(not q().destination,'Partial malformed maps cannot establish an unambiguous area')
rows[1456]=nil;refresh();assert(q().destination,'Absent optional POIs do not contradict a validated area');save()
`));

test("twenty-five quests share bounded map metadata and POI reads without exporting unrelated rows", () => run(String.raw`
C_QuestLog.GetNumQuestLogEntries=function()return 25,25 end
C_QuestLog.GetInfo=function(i)return {questID=40+i,title='Observed quest '..i,isHeader=false}end
C_QuestLog.GetNextWaypoint=function()calls.direct=calls.direct+1 end
C_QuestLog.GetNextWaypointForMap=function(id,map)calls.point[map]=(calls.point[map] or 0)+1 end
rows[1413]={};for i=1,25 do rows[1413][i]=poi(40+i,1413,.3,.4)end
rows[1413][26]=poi(99999,1413,.8,.9);rows[1413][26].private='PRIVATE ROW'
event('PLAYER_LOGIN');assert(#hud.quests==25 and hud.quests[25].destination)
assert(calls.direct==25 and calls.point[1413]==25 and calls.point[1456]==25)
assert(calls.poiMap==1 and calls.pois[1413]==1 and calls.pois[1456]==1 and calls.info[1413]==1 and calls.info[1456]==1)
assert(not BackstageForeverExport:find('PRIVATE',1,true) and not BackstageForeverExport:find('99999',1,true));save()
`));

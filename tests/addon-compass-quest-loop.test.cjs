'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'), addon='addon/BackstageForever/';
const toc=fs.readFileSync(path.join(root,addon,'BackstageForever.toc'),'utf8').split(/\r?\n/)
 .filter(line=>line.endsWith('.lua')).map(line=>`dofile('${addon}${line}')`).join('\n');
const boot=String.raw`
local frames,events,fonts,timers,chat,marks={},{},{},{},{},{}
local methods=setmetatable({}, {__index=function()return function()end end})
function methods:RegisterEvent(e) self.events[e]=true end
function methods:SetScript(k,v) self.scripts[k]=v end
function methods:SetText(s) self.text=s end
function methods:Show() self.visible=true end
function methods:Hide() self.visible=false end
function methods:Enable() self.enabled=true end
function methods:Disable() self.enabled=false end
function methods:CreateFontString() local f=setmetatable({}, {__index=methods});fonts[#fonts+1]=f;return f end
function methods:CreateTexture() return setmetatable({}, {__index=methods}) end
CreateFrame=function(_,name)
 local f=setmetatable({events={},scripts={}}, {__index=methods});events[#events+1]=f;if name then frames[name]=f end;return f
end
local function event(e,...) for _,f in ipairs(events) do if f.events[e] and f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
local function flush() for i=1,8 do local q=timers;timers={};if #q==0 then return end;for _,fn in ipairs(q) do fn() end end end
local function click(name) local f=frames['BackstageForeverCompass'..name];assert(f and f.visible and f.scripts.OnClick,name);return f.scripts.OnClick end
local map,owner,build,combat,watch,ready,complete,remaining=1429,'Player-Synthetic-1','70888',false,1,true,true,2
local gates,objectiveReads,readyReads,watchReads={},0,0,0
BackstageForeverHelperEnabled=function(k)return gates[k]~=false end
BackstageForeverRouteSettings={arrow=false}
BackstageForeverAssistSettings={toasts=false}
C_Timer={After=function(_,fn)timers[#timers+1]=fn end}
SlashCmdList={};UIParent={};DEFAULT_CHAT_FRAME={AddMessage=function(_,s)chat[#chat+1]=s end}
InCombatLockdown=function()return combat end
UnitGUID=function()return owner end;UnitFullName=function()return 'Synthetic','Realm' end
UnitRace=function()return 'Human','Human' end;UnitClass=function()return 'Warrior','WARRIOR' end
UnitFactionGroup=function()return 'Alliance' end;UnitLevel=function()return 1 end
GetBuildInfo=function()return '1.60.1',build end;GetZoneText=function()return 'Elwynn Forest' end
UnitXP=function()return 10 end;UnitXPMax=function()return 100 end;time=function()return 1700000000 end
C_Map={GetBestMapForUnit=function()return map end,GetMapInfo=function(id)return {mapID=id} end,
 GetPlayerMapPosition=function()return {GetXY=function()return .2,.3 end}end,
 CanSetUserWaypointOnMap=function()return true end,SetUserWaypoint=function(p)marks[#marks+1]=p end}
UiMapPoint={CreateFromCoordinates=function(id,x,y)return {id=id,x=x,y=y}end}
local marker=.35
C_QuestLog={GetNumQuestLogEntries=function()return 3,3 end,
 GetInfo=function(i)return {questID=i,title=({'Gather pelts','Hand in here','Other hand-in'})[i],isHeader=false}end,
 GetLogIndexForQuestID=function(id)if id>=1 and id<=3 then return id end end,
 GetQuestIDForQuestWatchIndex=function()watchReads=watchReads+1;return watch end,
 IsComplete=function(id)return id==1 and remaining==0 or id~=1 and complete end,
 ReadyForTurnIn=function(id)readyReads=readyReads+1;if id==1 then return remaining==0 and ready end;return ready end,
 GetQuestObjectives=function(id)objectiveReads=objectiveReads+1;return id==1 and {{text='Pelts',numRequired=3,numFulfilled=3-remaining,finished=remaining==0}} or {}end,
 GetNextWaypoint=function(id)return 1429,id==1 and .25 or id==2 and marker or .9,.3 end}
`+toc+String.raw`
local slash=SlashCmdList.BACKSTAGEFOREVER
local function has(s)return fonts[2].text and fonts[2].text:find(s,1,true) end
local function last(s)return chat[#chat] and chat[#chat]:find(s,1,true) end
`;
function replay(fragment) {
 const run=spawnSync(process.execPath,[require.resolve('./lua-stdin.cjs')],{cwd:root,input:boot+fragment,encoding:'utf8',timeout:20000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');
}
test('tracker shows one exact watched quest and retires a changed objective or map before a click',()=>replay(String.raw`
event('PLAYER_LOGIN');assert(has('Gather pelts') and has('2 remaining'), 'watched quest next action')
local old=click('TrackedWaypoint');remaining=1;event('QUEST_LOG_UPDATE');old();assert(#marks==0)
flush();assert(has('1 remaining'));click('TrackedWaypoint')();assert(#marks==1 and marks[1].x==.25)
old=click('TrackedWaypoint');map=1428;event('ZONE_CHANGED_NEW_AREA');map=1429;event('ZONE_CHANGED_NEW_AREA');old();assert(#marks==1)
remaining=0;event('QUEST_LOG_UPDATE');flush();assert(has('Ready to hand in') and not has('2 remaining'))
`));
test('blocker explanation and review are independent of tracker and detour gates',()=>replay(String.raw`
gates.questTracker=false;gates.questDetours=false;event('PLAYER_LOGIN')
assert(watchReads==0 and readyReads==0 and not has('2 remaining'))
slash('compass missing');assert(last('2 remaining') and #marks==0)
local reads=readyReads;gates.questBlockers=false;slash('compass missing');assert(readyReads==reads)
slash('compass review');assert(has('Before you leave: Hand in here') and not has('Before you leave: Other hand-in'))
local old=click('LeavingDismiss');old();assert(not has('Before you leave:'))
slash('compass review');assert(has('Before you leave:'));old();assert(has('Before you leave:'))
local dismiss=click('LeavingDismiss');gates.beforeLeaving=false;reads=readyReads;slash('compass review');dismiss()
assert(readyReads==reads and not has('Before you leave:') and #marks==0)
`));
test('explicit route next reviews only one ready stop; combat and invalid evidence stay quiet',()=>replay(String.raw`
gates.questDetours=false;event('PLAYER_LOGIN');BackstageForeverRouteCommand('route guide')
assert(not has('Before you leave:'))
BackstageForeverRouteCommand('route next');assert(has('Before you leave: Hand in here') and #marks==0)
combat=true;event('PLAYER_REGEN_DISABLED');local reads=readyReads;slash('compass review');assert(readyReads==reads)
combat=false;event('PLAYER_REGEN_ENABLED');assert(not has('Before you leave:'))
ready=nil;slash('compass review');assert(not has('Before you leave:'))
`));
test('detour gate retires the accepted action and a wrong turn-in cannot advance or complete it',()=>replay(String.raw`
watch=nil;event('PLAYER_LOGIN');BackstageForeverRouteCommand('route guide');BackstageForeverRouteCommand('route next');local route=BackstageForeverRouteNow();assert(route)
local take=click('TakeDetour');take();assert(#marks==0 and has('Detour:'))
local old=click('Waypoint');gates.questDetours=false;old();assert(#marks==0 and BackstageForeverRouteNow().id==route.id and not has('Detour:'))
gates.questDetours=true;event('QUEST_LOG_UPDATE');flush();click('TakeDetour')();click('Waypoint')();assert(#marks==1)
event('QUEST_TURNED_IN',1);assert(not has('Detour handed in.'))
event('QUEST_TURNED_IN',2);assert(has('Detour handed in.') and BackstageForeverRouteNow().id==route.id)
`));
test('tracker toggle retires its old waypoint across off and on without clearing the explicit pin',()=>replay(String.raw`
event('PLAYER_LOGIN');slash('compass track 2');assert(has('Tracked quest: Hand in here'))
local old=click('TrackedWaypoint');gates.questTracker=false;local reads=watchReads;BackstageForeverHUDHelpersChanged()
assert(not has('Tracked quest:') and watchReads==reads)
slash('compass missing');assert(last('Hand in here (#2): Ready to hand in'))
gates.questTracker=true;BackstageForeverHUDHelpersChanged();old();assert(#marks==0 and has('Tracked quest: Hand in here'))
owner='Player-Synthetic-2';event('PLAYER_ENTERING_WORLD');owner='Player-Synthetic-1';event('PLAYER_ENTERING_WORLD')
assert(has('Tracked quest: Gather pelts') and not has('Tracked quest: Hand in here'))
`));
test('objectives complete without explicit readiness cannot qualify a hand-in',()=>replay(String.raw`
watch=2;ready=nil;event('PLAYER_LOGIN');BackstageForeverRouteCommand('route guide')
assert(has('readiness is not verified') and not frames.BackstageForeverCompassTrackedWaypoint.visible and not frames.BackstageForeverCompassTakeDetour.visible)
slash('compass review');assert(not has('Before you leave:'))
ready=true;event('QUEST_LOG_UPDATE');flush();local take=click('TakeDetour');ready=false;take();assert(not has('Detour:') and #marks==0)
`));

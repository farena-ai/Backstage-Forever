"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
function lua(source) {
  const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:source,encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
}
const capture=String.raw`
local handler,reads,who,xp= nil,0,'A',10
local fighting=false
local timers={}
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end}end
InCombatLockdown=function()return fighting end
C_Timer={After=function(delay,fn)assert(delay==.25);timers[#timers+1]=fn end}
UnitGUID=function()reads=reads+1;return who end
UnitFullName=function()return who,'Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 12 end
UnitXP=function()return xp end
UnitXPMax=function()return 100 end
time=function()return 1700000000 end
GetZoneText=function()return 'Zone'end
GetSubZoneText=function()return ''end
C_QuestLog={GetNumQuestLogEntries=function()return 0,0 end,GetInfo=function()end,IsComplete=function()end,GetQuestObjectives=function()end}
local function event(name,id)handler(nil,name,id)end
local function flush()local queued=timers;timers={};for _,fn in ipairs(queued)do fn()end end
dofile('addon/BackstageForever/BackstageForever.lua')
`;
test('native event bursts coalesce while critical events prepare exports immediately',()=>lua(capture+String.raw`
event('QUEST_LOG_UPDATE');assert(reads==0 and #timers==0)
event('PLAYER_LOGIN');assert(reads==1 and #timers==0)
for i=1,50 do event('QUEST_LOG_UPDATE');event('PLAYER_XP_UPDATE');event('PLAYER_STOPPED_MOVING')end
assert(reads==1 and #timers==1,'Noncritical event burst must use one bounded timer')
xp=30;flush();assert(reads==2 and BackstageForeverExport:find('"current":30',1,true))
for _,name in ipairs({'PLAYER_ENTERING_WORLD','PLAYER_LEVEL_UP','QUEST_TURNED_IN','PLAYER_REGEN_ENABLED'})do
 event('ZONE_CHANGED');local before=reads;event(name,42);assert(reads==before+1);flush();assert(reads==before+1,'Critical refresh must invalidate older timer')
end
local before=reads;fighting=true;event('QUEST_LOG_UPDATE');flush()
assert(reads==before);fighting=false;event('PLAYER_REGEN_ENABLED');assert(reads==before+1)
C_Timer=nil;before=reads;event('PLAYER_XP_UPDATE');assert(reads==before+1,'Missing timer falls back to immediate capture')
`));
test('logout and repeated login in the same Lua session invalidate stale queued captures',()=>lua(capture+String.raw`
event('PLAYER_LOGIN');event('PLAYER_XP_UPDATE');local saved=BackstageForeverExport
event('PLAYER_LOGOUT');xp=0;flush();event('QUEST_LOG_UPDATE');assert(BackstageForeverExport==saved and reads==1)
who='B';xp=20;event('PLAYER_LOGIN');assert(reads==2)
event('QUEST_LOG_UPDATE');local stale=timers[1];who='C';xp=40;event('PLAYER_LOGIN');local latest=BackstageForeverExport
stale();assert(BackstageForeverExport==latest and reads==3,'Earlier character callback cannot mutate new login')
assert(latest:find('"activeId":"C"',1,true) and latest:find('"id":"A"',1,true) and latest:find('"id":"B"',1,true))
`));
const hud=String.raw`
local frames,fonts,handlers={},{},{}
local fighting=false
InCombatLockdown=function()return fighting end
SlashCmdList={};UIParent={}
local methods={}
for _,k in ipairs({'SetSize','SetMovable','EnableMouse','RegisterForDrag','SetClampedToScreen','SetBackdrop','SetBackdropColor','RegisterEvent','SetWidth','SetJustifyH','SetJustifyV','SetAllPoints','ClearAllPoints','SetTextColor','SetWordWrap','SetMaxLines'})do methods[k]=function()end end
methods.SetPoint=function(self,...)self.point={...}end
methods.GetPoint=function()return 'CENTER',UIParent,'CENTER',321,123 end
methods.StartMoving=function(self)self.moving=true end
methods.StopMovingOrSizing=function(self)self.moving=false end
methods.SetHeight=function(self,v)self.height=v end
methods.SetText=function(self,v)self.text=v end
methods.Show=function(self)self.visible=true end
methods.Hide=function(self)self.visible=false end
methods.Enable=function(self)self.enabled=true end
methods.Disable=function(self)self.enabled=false end
methods.SetScript=function(self,key,fn)self[key]=fn end
methods.CreateFontString=function()local f=setmetatable({}, {__index=methods});fonts[#fonts+1]=f;return f end
CreateFrame=function(kind,name,parent)
 local f=setmetatable({}, {__index=methods});if name then frames[name]=f end
 if kind=='Frame' and not name then handlers[#handlers+1]=f end;return f
end
local function event(name)for _,f in ipairs(handlers)do if f.OnEvent then f.OnEvent(f,name)end end end
local function text()local t={};for _,f in ipairs(fonts)do t[#t+1]=f.text or ''end;return table.concat(t,'\n')end
local guideCalls={}
BackstageForeverGuide=function(command)guideCalls[#guideCalls+1]=command end
local character={id='A',name='Hero|cffff0000',level=12,className='Mage',location={zone='Zone'},quests={}}
local options
BackstageForeverBuildPlan=function(c,o)
 options=o
 return {status='ready',headline='Live plan',steps={
 {questId=1,phase='o',title='First quest',detail='Check the quest log',source='none'},
 {questId=2,phase='t',title='Second |Hquest:2|hQuest|h',detail='Approximate reference: observed turn-in NPC.',source='reference',command='/bf guide 2 t 1413 0.4 0.5 1.60.1.70862'},
 {questId=3,phase='o',title=string.rep('Long title ',30),detail=string.rep('detail ',100),source='game'}},counts={quests=3,ready=1}}
end
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
event('PLAYER_LOGIN');BackstageForeverHUDUpdate(character)
`;
test('live compass persists validated focus/card preferences and binds an explicit labelled supported waypoint',()=>lua(hud+String.raw`
assert(text():find('Live in WoW',1,true) and text():find('Desktop saves on logout',1,true))
assert(text():find('Hero||cffff0000',1,true),'Untrusted formatting pipes must be escaped')
assert(text():find('1. First quest',1,true) and text():find('2. Second ||Hquest',1,true),'Native cards retain their identities')
assert(options.focus=='balanced' and options.minutes==30)
local button=frames.BackstageForeverCompassWaypoint
assert(button and button.enabled and #guideCalls==0,'No automatic waypoint')
assert(text():find('Step 2',1,true) and text():find('Approximate reference',1,true),'Action must name the supported step and qualifier')
button.OnClick();assert(guideCalls[1]=='guide 2 t 1413 0.4 0.5 1.60.1.70862')
local oldClick=button.OnClick
frames.BackstageForeverCompassFocus.OnClick();assert(BackstageForeverHUDSettings.focus=='nearby' and options.focus=='nearby')
frames.BackstageForeverCompassSession.OnClick();assert(BackstageForeverHUDSettings.minutes==60 and options.minutes==60)
frames.BackstageForeverCompassFocus.OnClick();assert(options.focus=='turn-ins')
local old=BackstageForeverHUDSettings
event('PLAYER_LOGOUT');button.OnClick();assert(#guideCalls==1,'Old marker cannot apply after logout')
BackstageForeverHUDSettings={visible=true,collapsed=false,focus='invalid',minutes=999,x=0,y=0,point='INVALID',relativePoint='CENTER'}
event('PLAYER_LOGIN');character.id='B';BackstageForeverHUDUpdate(character)
oldClick();assert(#guideCalls==1,'A previous login click closure cannot apply to the new character')
assert(options.focus=='balanced' and options.minutes==30 and old.focus=='turn-ins','Character preferences must not leak')
assert(BackstageForeverHUDSettings.point==nil)
BackstageForeverGuide=nil;BackstageForeverHUDUpdate(character);assert(not button.enabled)
fighting=true;event('PLAYER_REGEN_DISABLED');assert(not frames.BackstageForeverCompass.visible)
fighting=false;event('PLAYER_REGEN_ENABLED');assert(frames.BackstageForeverCompass.visible)
BackstageForeverBuildPlan=nil;BackstageForeverHUDUpdate(character);assert(text():find('Hero',1,true) and not button.enabled)
`));
test('collapsed native body stays above permanent footer instructions',()=>lua(hud+String.raw`
frames.BackstageForeverCompassCollapse.OnClick()
assert(fonts[2].point[3]==-35,'Collapsed body must move above its footer')
assert(frames.BackstageForeverCompass.height==122 and fonts[2].height==30)
BackstageForeverHUDCaptureStatus('unavailable')
assert(frames.BackstageForeverCompass.height==152 and fonts[2].height==60)
`));
test('TOC loads planner dependencies before capture and HUD',()=>{
 const fs=require('node:fs');const toc=fs.readFileSync(path.join(__dirname,'../addon/BackstageForever/BackstageForever.toc'),'utf8');
 assert.deepEqual(toc.split(/\r?\n/).filter(x=>x.endsWith('.lua')),['BackstageForeverReference.lua','BackstageForeverPlan.lua','BackstageForever.lua','BackstageForeverHUD.lua']);
});
test('long localized reference cards retain relationship and English-title qualification',()=>lua(hud+String.raw`
BackstageForeverBuildPlan=function()return {status='ready',steps={{questId=2,phase='o',title='Localized title',source='reference',detail=string.rep('Current objective ',20)..' Approximate reference: Reference NPC mentioned in objective; verify your quest details. English reference: Original quest title.',command='/bf guide 2 o 1413 0.4 0.5 1.60.1.70862'}}}end
BackstageForeverHUDUpdate(character)
assert(text():find('mentioned in objective',1,true),'Bounded rendering must preserve relationship qualification')
assert(text():find('English reference: Original quest title',1,true),'Bounded rendering must preserve localized reference qualification')
`));
test('bounded native text preserves UTF-8 character boundaries',()=>lua(hud+String.raw`
BackstageForeverBuildPlan=function()return {status='ready',steps={{questId=2,phase='o',title=string.rep(string.char(195,169),50),source='game',detail=string.rep(string.char(226,130,172),70)}}}end
BackstageForeverHUDUpdate(character)
for _,font in ipairs(fonts)do if font.text then assert(utf8.len(font.text),'Truncated text must retain UTF-8 boundaries')end end
`));
test('real native capture and planner update quest cards, XP and zones without reloading',()=>lua(hud.slice(0,hud.indexOf('local character='))+String.raw`
local who,xp,zone,complete,objective='A',10,'First zone',false,'Current kills: 1/4'
local timers={}
C_Timer={After=function(_,fn)timers[#timers+1]=fn end}
local function flush()local queued=timers;timers={};for _,fn in ipairs(queued)do fn()end end
UnitGUID=function()return who end
UnitFullName=function()return who,'Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 12 end
UnitXP=function()return xp end
UnitXPMax=function()return 100 end
GetZoneText=function()return zone end
GetSubZoneText=function()return ''end
GetBuildInfo=function()return '1.60.1','70862'end
GetLocale=function()return 'enUS'end
time=function()return 1700000000 end
C_QuestLog={GetNumQuestLogEntries=function()return 1,1 end,
 GetInfo=function()return {questID=1061,title='The Spirits of Stonetalon',isHeader=false}end,
 IsComplete=function()return complete end,
 GetQuestObjectives=function()return {{text=objective,finished=complete}}end}
dofile('addon/BackstageForever/BackstageForeverReference.lua')
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
dofile('addon/BackstageForever/BackstageForever.lua')
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
event('PLAYER_LOGIN')
assert(text():find('Current kills: 1/4',1,true) and text():find('XP 10 / 100',1,true))
objective='Current kills: 3/4';xp=40;zone='Second zone'
event('QUEST_LOG_UPDATE');event('PLAYER_XP_UPDATE');event('ZONE_CHANGED');flush()
assert(text():find('Current kills: 3/4',1,true) and text():find('XP 40 / 100',1,true) and text():find('Second zone',1,true))
complete=true;event('QUEST_LOG_UPDATE');flush()
assert(text():find('Ready to turn in',1,true) and text():find('Approximate reference',1,true))
frames.BackstageForeverCompassFocus.OnClick();frames.BackstageForeverCompassSession.OnClick()
local old=BackstageForeverHUDSettings
old.point='CENTER';old.relativePoint='CENTER';old.x=111;old.y=222
event('PLAYER_LOGOUT');assert(not frames.BackstageForeverCompass.visible)
who='B';BackstageForeverHUDSettings={focus='turn-ins',minutes=15,visible=false,point='TOP',relativePoint='TOP',x=8,y=9}
event('PLAYER_LOGIN');assert(not frames.BackstageForeverCompass.visible)
SlashCmdList.BACKSTAGEFOREVER('show')
assert(BackstageForeverHUDSettings.focus=='turn-ins' and BackstageForeverHUDSettings.minutes==15 and frames.BackstageForeverCompass.point[1]=='TOP')
assert(old.focus=='nearby' and old.minutes==60 and old.x==111)
event('PLAYER_LOGOUT');BackstageForeverHUDSettings=old;who='A';event('PLAYER_LOGIN')
assert(BackstageForeverHUDSettings.focus=='nearby' and BackstageForeverHUDSettings.minutes==60 and frames.BackstageForeverCompass.point[4]==111)
fighting=true;event('PLAYER_REGEN_DISABLED');xp=70;event('PLAYER_XP_UPDATE');flush();assert(not frames.BackstageForeverCompass.visible)
fighting=false;event('PLAYER_REGEN_ENABLED');assert(frames.BackstageForeverCompass.visible and text():find('XP 70 / 100',1,true))
-- A login with denied identity must clear the previous character even without
-- a preceding logout event in this synthetic same-VM lifecycle.
UnitGUID=function()return nil end;BackstageForeverHUDSettings={};event('PLAYER_LOGIN')
assert(text():find('Waiting for a public character snapshot.',1,true) and text():find('Snapshot unavailable',1,true))
assert(not text():find('Spirits of Stonetalon',1,true) and not text():find('XP 70',1,true) and not frames.BackstageForeverCompassWaypoint.enabled,'Failed new-login capture cannot retain a prior character plan or action')
`));

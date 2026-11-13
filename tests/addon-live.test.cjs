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
for _,k in ipairs({'SetMovable','EnableMouse','RegisterForDrag','SetClampedToScreen','SetBackdrop','SetBackdropColor','RegisterEvent','SetJustifyH','SetJustifyV','SetAllPoints','ClearAllPoints','SetTextColor'})do methods[k]=function()end end
methods.SetSize=function(self,w,h)self.width=w;self.height=h end
methods.SetWidth=function(self,w)self.width=w end
methods.SetWordWrap=function(self,v)self.wordWrap=v end
methods.SetMaxLines=function(self,v)self.maxLines=v end
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
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local character={id='A',name='Hero|cffff0000',level=12,className='Mage',location={zone='Zone'},quests={}}
local options
BackstageForeverBuildPlan=function(c,o)
 options=o
 return {status='ready',headline='Live plan',steps={
 {questId=1,phase='o',title='First quest',detail='Check the quest log',source='none'},
 {questId=2,phase='t',title='Second |Hquest:2|hQuest|h',detail='Approximate reference: observed turn-in NPC.',source='reference',command='/bf guide 2 t 1413 0.4 0.5 1.60.1.70888'},
 {questId=3,phase='o',title=string.rep('Long title ',30),detail=string.rep('detail ',100),source='game'}},counts={quests=3,ready=1}}
end
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
event('PLAYER_LOGIN');BackstageForeverHUDUpdate(character)
`;
test('live compass persists validated focus/card preferences and binds an explicit labelled supported waypoint',()=>lua(hud+String.raw`
assert(text():find('Updates as you play',1,true) and text():find('/bf help lists commands',1,true))
assert(text():find('Hero||cffff0000',1,true),'Untrusted formatting pipes must be escaped')
assert(text():find('1. First quest',1,true) and text():find('2. Second ||Hquest',1,true),'Native cards retain their identities')
assert(options.focus=='balanced' and options.minutes==30)
local button=frames.BackstageForeverCompassWaypoint
assert(button and button.enabled and #guideCalls==0,'No automatic waypoint')
assert(text():find('Step 2',1,true) and text():find('Approximate reference',1,true),'Action must name the supported step and qualifier')
button.OnClick();assert(guideCalls[1]=='guide 2 t 1413 0.4 0.5 1.60.1.70888')
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
test('wide waypoint titles cannot consume the separately reserved source and phase row',()=>lua(hud+String.raw`
BackstageForeverBuildPlan=function()return {status='ready',steps={
 {questId=1,phase='o',title='Unsupported first step',source='none',detail='Check quest log'},
 {questId=2,phase='o',title=string.rep('W',100),source='reference',detail='Approximate reference: observed objective progress location.',command='/bf guide 2 o 1413 0.4 0.5 1.60.1.70888'}}}end
BackstageForeverHUDUpdate(character)
local title,qualifier
for _,font in ipairs(fonts)do
 if font.text and font.text:find('Step 2:',1,true) then title=font end
 if font.text and font.text:find('Approximate reference — objective',1,true) then qualifier=font end
end
assert(title and qualifier and title~=qualifier,'Action title and source/phase need independent reserved regions')
for _,font in ipairs({title,qualifier})do
 assert(font.width==312 and font.height==16 and font.maxLines==1 and font.wordWrap==false,'Each action row must explicitly reserve one unwrapped line')
end
assert(title.point[1]=='BOTTOMLEFT' and title.point[3]==qualifier.point[3]+16,'Action rows must not overlap')
assert(qualifier.point[3]==81 and title.point[3]==97,'Action rows must preserve the existing body/control/footer geometry')
-- A synthetic wide-glyph layout exposes clipping rather than only checking
-- the strings passed to SetText. This is not a claim about actual WoW fonts.
local function rendered(font)
 local out,width={},0
 for glyph in font.text:gmatch('[%z\1-\127\194-\244][\128-\191]*')do
  local advance=glyph=='W' and 12 or 6
  if glyph=='\n' or width+advance>font.width then break end
  out[#out+1]=glyph;width=width+advance
 end
 return table.concat(out)
end
assert(rendered(title)~=title.text and rendered(title):find('Step 2: WWW',1,true),'Wide title fixture must actually clip its independent title row')
assert(rendered(qualifier)=='Approximate reference — objective','Source and phase must remain wholly visible after title clipping')
assert(frames.BackstageForeverCompassWaypoint.enabled and #guideCalls==0)
frames.BackstageForeverCompassWaypoint.OnClick();assert(guideCalls[1]=='guide 2 o 1413 0.4 0.5 1.60.1.70888')
frames.BackstageForeverCompassCollapse.OnClick();assert(not title.visible and not qualifier.visible,'Both reserved rows hide while collapsed')
`));
test('quiet bag fact reserves its own line above the action rows even with maximum quest text',()=>lua(hud+String.raw`
character.readiness={bags={free=2,total=1000}}
BackstageForeverHUDSettings.minutes=60
BackstageForeverHUDUpdate(character)
local cue,action,source
for _,font in ipairs(fonts)do
 if font.text=='Current game bags: 2 / 1000 free slots.' then cue=font end
 if font.text and font.text:find('Step 2:',1,true) then action=font end
 if font.text=='Approximate reference — turn-in' then source=font end
end
assert(cue,'Low-space fact must have an independent quiet line')
assert(cue~=fonts[2] and cue~=action and cue~=source)
assert(cue.width==312 and cue.height==16 and cue.maxLines==1 and cue.wordWrap==false)
assert(cue.point[1]=='BOTTOMLEFT' and cue.point[3]==113)
assert(action.point[3]+action.height<=cue.point[3] and source.point[3]+source.height<=action.point[3])
local bodyBottom=frames.BackstageForeverCompass.height+fonts[2].point[3]-fonts[2].height
assert(bodyBottom>=cue.point[3]+cue.height,'Long quest details must stop above the reserved preparation line')
assert(action.text:find('Step 2:',1,true) and source.text=='Approximate reference — turn-in')
assert(frames.BackstageForeverCompassWaypoint.enabled and #guideCalls==0)
local function cueText()return cue.text or ''end
character.readiness.bags.free=3;BackstageForeverHUDUpdate(character);assert(cueText()=='')
character.readiness.bags.free=0;BackstageForeverHUDUpdate(character);assert(cueText():find('0 / 1000',1,true))
character.readiness=nil;BackstageForeverHUDUpdate(character);assert(cueText()=='')
character.readiness={bags={free=0,total=0}};BackstageForeverHUDUpdate(character);assert(cueText()=='')
`));
test('bag cue follows current capture, combat, visibility, collapse and session identity',()=>lua(hud+String.raw`
character.readiness={bags={free=1,total=16}};BackstageForeverHUDUpdate(character)
local cue
for _,font in ipairs(fonts)do if font.text=='Current game bags: 1 / 16 free slots.' then cue=font end end
assert(cue and cue.visible,'Current low-space capture must appear quietly')
frames.BackstageForeverCompassCollapse.OnClick();assert(not cue.visible)
frames.BackstageForeverCompassCollapse.OnClick();assert(cue.visible)
SlashCmdList.BACKSTAGEFOREVER('hide');assert(not frames.BackstageForeverCompass.visible)
SlashCmdList.BACKSTAGEFOREVER('show');assert(frames.BackstageForeverCompass.visible)
fighting=true;event('PLAYER_REGEN_DISABLED');assert(not frames.BackstageForeverCompass.visible)
fighting=false;event('PLAYER_REGEN_ENABLED');assert(frames.BackstageForeverCompass.visible)
BackstageForeverHUDCaptureStatus('unavailable');assert(cue.text=='','A failed fresh capture must clear the previous cue')
frames.BackstageForeverCompassFocus.OnClick();BackstageForeverHUDCaptureStatus('ready');assert(cue.text=='','Status alone cannot revive stale readiness')
BackstageForeverHUDUpdate(character);assert(cue.text:find('1 / 16',1,true))
local nextCharacter={id='B',name='Other',level=12,className='Mage',quests={}}
BackstageForeverHUDUpdate(nextCharacter);assert(cue.text=='','Missing readiness on another identity must clear the previous cue')
nextCharacter.readiness={bags={free=2,total=20}};BackstageForeverHUDUpdate(nextCharacter);assert(cue.text:find('2 / 20',1,true))
BackstageForeverHUDSession('PLAYER_LOGIN');BackstageForeverHUDCaptureStatus('unavailable')
assert(cue.text=='' and not text():find('2 / 20',1,true),'Failed new session cannot retain a previous identity cue')
BackstageForeverHUDUpdate(nextCharacter);event('PLAYER_LOGOUT');assert(not frames.BackstageForeverCompass.visible)
event('PLAYER_LOGIN');assert(cue.text=='','Previous session cue cannot revive on login')
`));
test('TOC loads planner dependencies before capture and HUD',()=>{
 const fs=require('node:fs');const toc=fs.readFileSync(path.join(__dirname,'../addon/BackstageForever/BackstageForever.toc'),'utf8');
 assert.deepEqual(toc.split(/\r?\n/).filter(x=>x.endsWith('.lua')),['BackstageForeverReference.lua','BackstageForeverAdvisorData.lua','BackstageForeverPlan.lua','BackstageForeverCoach.lua','BackstageForeverAcquisition.lua','BackstageForeverProfession.lua','BackstageForeverGathering.lua','BackstageForeverMapPlan.lua','BackstageForeverMap.lua','BackstageForeverAdvisorMap.lua','BackstageForever.lua','BackstageForeverHUD.lua','BackstageForeverLive.lua','BackstageForeverFind.lua','BackstageForeverAssist.lua','BackstageForeverGear.lua','BackstageForeverQuestIntel.lua','BackstageForeverRoute.lua','BackstageForeverSupplies.lua','BackstageForeverJournal.lua']);
});
test('long localized reference cards retain relationship and English-title qualification',()=>lua(hud+String.raw`
BackstageForeverBuildPlan=function()return {status='ready',steps={{questId=2,phase='o',title='Localized title',source='reference',detail=string.rep('Current objective ',20)..' Approximate reference: Reference NPC mentioned in objective; verify your quest details. English reference: Original quest title.',command='/bf guide 2 o 1413 0.4 0.5 1.60.1.70888'}}}end
BackstageForeverHUDUpdate(character)
assert(text():find('mentioned in objective',1,true),'Bounded rendering must preserve relationship qualification')
assert(text():find('English reference: Original quest title',1,true),'Bounded rendering must preserve localized reference qualification')
`));
test('long current objectives cannot hide the actual game marker area qualification',()=>lua(hud+String.raw`
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
character.clientBuild='1.60.1.70888'
character.quests={{id=42,title='Observed quest',complete=false,
 objectives={{text=string.rep('Long objective ',13),done=false}},
 destination={mapId=1413,x=.3,y=.4,text='Quest area reported by the game; not an exact NPC or spawn location'}}}
BackstageForeverHUDUpdate(character)
assert(text():find('Quest area reported by the game; not an exact NPC or spawn location',1,true),'Existing 150-character preview must preserve the entire area qualification')
assert(text():find('Current game',1,true) and text():find('objective',1,true))
assert(frames.BackstageForeverCompassWaypoint.enabled and #guideCalls==0,'Qualification must not change explicit action behavior')
character.quests[1].destination.text='Actual direct game marker';BackstageForeverHUDUpdate(character)
assert(text():find('Actual direct game marker',1,true),'Ordinary direct marker descriptions remain game-labelled')
assert(text():find('Current game',1,true))
character.quests[1].destination.text='Direct |Hquest:42|hmarker|h';BackstageForeverHUDUpdate(character)
assert(text():find('Game marker: Direct ||Hquest:42||hmarker||h',1,true),'Literal marker formatting must be escaped exactly once')
`));
test('bounded native text preserves UTF-8 character boundaries',()=>lua(hud+String.raw`
BackstageForeverBuildPlan=function()return {status='ready',steps={{questId=2,phase='o',title=string.rep(string.char(195,169),50),source='game',detail=string.rep(string.char(226,130,172),70)}}}end
BackstageForeverHUDUpdate(character)
for _,font in ipairs(fonts)do if font.text then assert(utf8.len(font.text),'Truncated text must retain UTF-8 boundaries')end end
`));
test('real native capture and planner update quest cards, XP and zones without reloading',()=>lua(hud.slice(0,hud.indexOf('local character='))+String.raw`
local who,xp,zone,complete,objective='A',10,'First zone',false,'Current kills: 1/4'
local free,bagReads=1,0
Enum={BagIndex={Backpack=0,Bag_1=1,Bag_2=2,Bag_3=3,Bag_4=4}}
C_Container={GetContainerNumSlots=function(index)bagReads=bagReads+1;return index==0 and 16 or 0 end,
 GetContainerNumFreeSlots=function(index)return index==0 and free or 0 end}
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
GetBuildInfo=function()return '1.60.1','70888'end
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
assert(text():find('Current game bags: 1 / 16 free slots.',1,true))
local beforeBags=bagReads
free=3;for i=1,30 do event('BAG_UPDATE_DELAYED')end
assert(#timers==1 and bagReads==beforeBags and text():find('Current game bags: 1 / 16',1,true),'Bag events must coalesce without extra immediate reads')
flush();assert(bagReads==beforeBags+5 and not text():find('Current game bags:',1,true),'Improved space clears on the normal coalesced capture')
free=2;event('BAG_UPDATE_DELAYED');flush();assert(text():find('Current game bags: 2 / 16',1,true))
local containers=C_Container;C_Container=nil;event('BAG_UPDATE_DELAYED');flush()
assert(not text():find('Current game bags:',1,true),'Missing supported bag APIs must stay silent')
C_Container=containers;event('BAG_UPDATE_DELAYED');flush();assert(text():find('Current game bags: 2 / 16',1,true))
objective='Current kills: 3/4';xp=40;zone='Second zone'
event('QUEST_LOG_UPDATE');event('PLAYER_XP_UPDATE');event('ZONE_CHANGED');flush()
assert(text():find('Current kills: 3/4',1,true) and text():find('XP 40 / 100',1,true) and text():find('Second zone',1,true))
complete=true;event('QUEST_LOG_UPDATE');flush()
assert(text():find('Ready to turn in',1,true) and text():find('Approximate reference',1,true))
frames.BackstageForeverCompassFocus.OnClick();frames.BackstageForeverCompassSession.OnClick()
local old=BackstageForeverHUDSettings
old.point='CENTER';old.relativePoint='CENTER';old.x=111;old.y=222
event('PLAYER_LOGOUT');assert(not frames.BackstageForeverCompass.visible)
who='B';free=3;BackstageForeverHUDSettings={focus='turn-ins',minutes=15,visible=false,point='TOP',relativePoint='TOP',x=8,y=9}
event('PLAYER_LOGIN');assert(not frames.BackstageForeverCompass.visible)
SlashCmdList.BACKSTAGEFOREVER('show')
assert(not text():find('Current game bags:',1,true),'Previous character bags cannot carry into a new identity')
assert(BackstageForeverHUDSettings.focus=='turn-ins' and BackstageForeverHUDSettings.minutes==15 and frames.BackstageForeverCompass.point[1]=='TOP')
assert(old.focus=='nearby' and old.minutes==60 and old.x==111)
event('PLAYER_LOGOUT');BackstageForeverHUDSettings=old;who='A';free=0;event('PLAYER_LOGIN')
assert(text():find('Current game bags: 0 / 16',1,true),'Returning character requires a fresh observed cue')
assert(BackstageForeverHUDSettings.focus=='nearby' and BackstageForeverHUDSettings.minutes==60 and frames.BackstageForeverCompass.point[4]==111)
fighting=true;event('PLAYER_REGEN_DISABLED');xp=70;free=3;event('BAG_UPDATE_DELAYED');event('PLAYER_XP_UPDATE');flush();assert(not frames.BackstageForeverCompass.visible)
fighting=false;event('PLAYER_REGEN_ENABLED');assert(frames.BackstageForeverCompass.visible and text():find('XP 70 / 100',1,true) and not text():find('Current game bags:',1,true))
free=1;event('BAG_UPDATE_DELAYED');flush();assert(text():find('Current game bags: 1 / 16',1,true))
local validIdentity=UnitGUID
UnitGUID=function()return nil end;event('PLAYER_ENTERING_WORLD')
assert(not text():find('Current game bags:',1,true),'Failed fresh capture cannot retain the earlier successful bag cue')
UnitGUID=validIdentity;event('PLAYER_ENTERING_WORLD');assert(text():find('Current game bags: 1 / 16',1,true))
event('BAG_UPDATE_DELAYED');local staleBagCapture=timers[1]
-- A login with denied identity must clear the previous character even without
-- a preceding logout event in this synthetic same-VM lifecycle.
UnitGUID=function()return nil end;BackstageForeverHUDSettings={};event('PLAYER_LOGIN')
staleBagCapture();assert(not text():find('Current game bags:',1,true),'Queued previous-session bag captures cannot resurrect the cue')
assert(text():find('Getting ready. If this stays, type /reload once.',1,true) and text():find('Snapshot unavailable',1,true))
assert(not text():find('Spirits of Stonetalon',1,true) and not text():find('XP 70',1,true) and not frames.BackstageForeverCompassWaypoint.enabled,'Failed new-login capture cannot retain a prior character plan or action')
`));

test('real planner reasons stay inside existing body while source phase and waypoint rows remain reserved',()=>lua(hud.slice(0,hud.indexOf('local character='))+String.raw`
dofile('addon/BackstageForever/BackstageForeverReference.lua')
local character={id='Reason-A',name='Synthetic Hero',level=12,className='Mage',locale='deDE',clientBuild='1.60.1.70888',
 location={mapId=1413,x=0.35,y=0.28,zone='Synthetic zone'},readiness={bags={free=2,total=16}},quests={
 {id=1061,title=string.rep('W',100),complete=true,objectives={}},
 {id=900001,title='Current marker',complete=false,destination={mapId=1413,x=0.5,y=0.5},objectives={{text='Actual unfinished objective',done=false}}}}}
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
event('PLAYER_LOGIN');BackstageForeverHUDSettings.minutes=60;BackstageForeverHUDUpdate(character)
assert(text():find('Reported ready to turn in.',1,true) and text():find('Current game marker is on your current map.',1,true))
assert(text():find('observed turn-in NPC',1,true) and text():find('English reference: The Spirits of Stonetalon',1,true))
local source,action,cue
for _,font in ipairs(fonts)do
 if font.text=='Approximate reference — turn-in' then source=font end
 if font.text and font.text:find('Step 1: WWW',1,true) then action=font end
 if font.text=='Current game bags: 2 / 16 free slots.' then cue=font end
end
assert(source and action and cue and source~=fonts[2] and action~=fonts[2] and cue~=fonts[2])
assert(source.point[3]==81 and action.point[3]==97 and cue.point[3]==113)
assert(source.height==16 and source.maxLines==1 and source.wordWrap==false)
local bodyBottom=frames.BackstageForeverCompass.height+fonts[2].point[3]-fonts[2].height
assert(bodyBottom>=cue.point[3]+cue.height,'Reasons cannot expand into the reserved rows')
local button=frames.BackstageForeverCompassWaypoint
assert(button.enabled and #guideCalls==0)
button.OnClick();assert(guideCalls[1]=='guide 1061 t 1413 0.3528 0.2786 1.60.1.70888')
frames.BackstageForeverCompassCollapse.OnClick();assert(not source.visible and not action.visible and not cue.visible)
frames.BackstageForeverCompassCollapse.OnClick();assert(source.visible and action.visible and cue.visible)
local previous=button.OnClick
event('PLAYER_LOGOUT');event('PLAYER_LOGIN');previous();assert(#guideCalls==1 and not button.enabled)
character.id='Reason-B';character.quests={};character.readiness=nil;BackstageForeverHUDUpdate(character)
assert(not button.enabled and not text():find('Reported ready to turn in.',1,true) and cue.text=='')
`));
test('a brand-new character is told once to /reload so the desktop app can link it',()=>lua(capture+String.raw`
local said={};DEFAULT_CHAT_FRAME={AddMessage=function(_,m)said[#said+1]=m end}
event('PLAYER_LOGIN');assert(#said==1 and said[1]:find('/reload once',1,true))
event('PLAYER_XP_UPDATE');flush();assert(#said==1,'hint is shown once per session')
-- After /reload the addon loads again with the saved roster: a known character is not told.
event('PLAYER_LOGOUT');said={};dofile('addon/BackstageForever/BackstageForever.lua');event('PLAYER_LOGIN');assert(#said==0,'known character is not told again')
`));

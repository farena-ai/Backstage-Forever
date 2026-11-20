"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = require('node:path').resolve(__dirname, '..');
const addon = 'addon/BackstageForever/';
const toc = readFileSync(`${root}/${addon}BackstageForever.toc`, 'utf8');
const load = toc.split(/\r?\n/).filter(line => line.endsWith('.lua')).map(line => `dofile('${addon}${line}')`).join('\n');
const frames = String.raw`
local frames, named, hooks = {}, {}, {}
local function frame(_,name)
    local f={events={},scripts={}}
    function f:RegisterEvent(e) self.events[e]=true end
    function f:SetScript(k,fn) self.scripts[k]=fn end
    function f:HookScript(k,fn)
        local previous=self.scripts[k]
        self.scripts[k]=function(...) if previous then previous(...) end; fn(...) end
    end
    function f:IsShown() return self.shown==true end
    function f:Show() self.shown=true end
    function f:Hide() self.shown=false end
    function f:SetText(t) self.text=t end
    function f:CreateFontString() return frame() end
    function f:CreateTexture() return frame() end
    frames[#frames+1]=f; if name then named[name]=f end
    return setmetatable(f,{__index=function() return function() end end})
end
CreateFrame=frame
UIParent={} MerchantFrame=frame() GameTooltip=frame()
function GameTooltip:AddLine(text) self.lines[#self.lines+1]=text end
function GameTooltip:GetUnit() return 'same display name','mouseover' end
Enum={TooltipDataType={Unit=2}}
TooltipDataProcessor={AddTooltipPostCall=function(k,fn) hooks[k]=fn end}
function GameTooltip:SetBagItem() self.lines={} end
hooksecurefunc=function(object,method,fn)
    local old=object[method]; object[method]=function(...) old(...); fn(...) end
end
local function unitTip(displayedGuid)
    GameTooltip.lines={}
    if hooks[2] then hooks[2](GameTooltip,{guid=displayedGuid or UnitGUID('mouseover')}) end
    return table.concat(GameTooltip.lines,'\n')
end
SlashCmdList={}
local function fire(e,...)
    for _,f in ipairs(frames) do if f.events[e] and f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end
end
local combat=false
InCombatLockdown=function() return combat end
local function mute(key,off) SlashCmdList.BACKSTAGEFOREVER('helpers '..key..(off and ' off' or ' on')) end
`;
function replay(setup, body) {
  const result = spawnSync(process.execPath, [require.resolve('./lua-stdin.cjs')], {
    cwd: root, input: `${frames}\n${setup}\n${load}\n${body}\nprint('ok')`, encoding: 'utf8', timeout: 20000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'ok');
}

test('merchant preview and each actual manual sale protect quest items, even after a slot changes', () => replay(String.raw`
local slots={{itemID=11,quality=0,stackCount=1},{itemID=22,quality=0,stackCount=1},{itemID=33,quality=0,stackCount=1}}
local sold={}
local questInfo={{isQuestItem=false,isActive=false},{isQuestItem=true,questID=200,isActive=true},{isQuestItem=false,isActive=false}}
C_QuestLog={GetNumQuestLogEntries=function() return 1 end,GetInfo=function() return {questID=200,title='Active quest',isHeader=false} end}
C_Container={GetContainerNumSlots=function(b) return b==0 and #slots or 0 end,
    GetContainerItemInfo=function(_,s) return slots[s] end,GetContainerItemQuestInfo=function(_,s) return questInfo[s] end,
    UseContainerItem=function(_,s) sold[#sold+1]=s; slots[s]=false; questInfo[3]={isQuestItem=true,questID=200,isActive=true} end}
GetItemInfo=function() return 'name',nil,nil,nil,nil,nil,nil,nil,nil,nil,12 end
`, String.raw`
fire('PLAYER_LOGIN'); MerchantFrame:Show(); fire('MERCHANT_SHOW')
GameTooltip:SetBagItem(0,2); assert(GameTooltip.lines[1]=='Keep this item for Active quest','explain exact active quest')
local button=named.BackstageForeverSellJunkButton
assert(button:IsShown() and button.text:find(': 2 ',1,true),'preview must omit the positively identified quest item')
assert(#sold==0,'preview must not sell')
button.scripts.OnClick(button)
assert(#sold==1 and sold[1]==1,'a later slot must be rechecked immediately before sale')
assert(not button:IsShown(),'no protected item in the next preview')
mute('keepQuestItems',true)
GameTooltip:SetBagItem(0,2); assert(#GameTooltip.lines==0,'only explanation is optional')
button.scripts.OnClick(button)
assert(#sold==1,'disabling quest helper must not disable baseline protection')
fire('MERCHANT_CLOSED'); button.scripts.OnClick(button)
assert(#sold==1,'closed merchant cannot sell')
`));

test('vendor never offers or sells when the slot quest status is unavailable', () => replay(String.raw`
local sales=0
local secret={}
issecretvalue=function(v) return rawequal(v,secret) end
local function unknown() return {isQuestItem=false,isActive=false,questID=secret} end
C_Container={ GetContainerNumSlots=function(b) return b==0 and 1 or 0 end,
    GetContainerItemInfo=function() return {itemID=19,quality=0,stackCount=1} end,
    GetContainerItemQuestInfo=unknown,UseContainerItem=function() sales=sales+1 end }
GetItemInfo=function() return 'name',nil,nil,nil,nil,nil,nil,nil,nil,nil,12 end
`, String.raw`
MerchantFrame:Show(); fire('MERCHANT_SHOW')
local button=named.BackstageForeverSellJunkButton
assert(not button:IsShown(),'protected ID is not an absent ID')
button.scripts.OnClick(button); assert(sales==0)
C_Container.GetContainerItemQuestInfo=nil
fire('BAG_UPDATE_DELAYED'); assert(not button:IsShown())
button.scripts.OnClick(button); assert(sales==0,'missing API is not a negative check')
`));

const active = String.raw`
local version,build,map,zone='1.60.1','70888',1411,'Valley of Trials'
local guid='Creature-0-1-2-3-4670-0001'
local complete,watched,quests,rows={}, {1434,97265}, {1434,97265}, {}
local function row(need,have,kind) return {type=kind or 'monster',finished=have==need,numRequired=need,numFulfilled=have} end
rows[1434]={row(7,3),row(7,0),row(7,0),row(7,0)}
rows[97265]={row(2,0),row(2,0),row(2,0),row(2,0),row(2,1)}
rows[5441]={row(5,2),row(1,1,'item')}
local titles={[1434]='Befouled by Satyr',[97265]='Hate the Hatefury',[5441]='Lazy Peons'}
GetBuildInfo=function() return version,build end
UnitGUID=function(u) return u=='mouseover' and guid or nil end
UnitIsDead=function() return false end
UnitIsPlayer=function() return false end
C_QuestLog={GetNumQuestLogEntries=function() return #quests end,
    GetInfo=function(i) return {questID=quests[i],title=titles[quests[i]],isHeader=false} end,
    GetQuestObjectives=function(q) return rows[q] end,IsComplete=function(q) return complete[q]==true end,
    GetNumQuestWatches=function() return #watched end,GetQuestIDForQuestWatchIndex=function(i) return watched[i] end}
C_Map={GetBestMapForUnit=function() return map end,GetAreaInfo=function(area) return area==363 and 'Valley of Trials' end}
GetSubZoneText=function() return zone end
`;

test('unit tooltip shows independently toggled exact active and shared counters', () => replay(active, String.raw`
fire('PLAYER_LOGIN')
local text=unitTip()
assert(text:find('Two quests, one stop',1,true) and text:find('Befouled by Satyr: 4 remaining',1,true)
    and text:find('Hate the Hatefury: 1 remaining',1,true),text)
assert(unitTip('Creature-0-1-2-3-4670-0002')=='','stale unit token must match the displayed spawn GUID')
mute('sharedObjectives',true)
text=unitTip(); assert(not text:find('Two quests, one stop',1,true) and text:find('4 remaining',1,true),text)
mute('sharedObjectives',false); mute('objectiveHints',true)
assert(unitTip():find('Two quests, one stop',1,true),'shared hint must work independently')
watched={1434}; assert(unitTip()=='','not two watched quests')
mute('objectiveHints',false)
guid='Creature-0-1-2-3-7777-0001'; assert(unitTip()=='','same tooltip name is not identity')
guid='GameObject-0-1-2-3-4670-0001'; assert(unitTip()=='','object is not the creature')
guid='Creature-0-1-2-3-4670-0001'; complete[1434]=true; rows[97265][5].numFulfilled=nil
assert(unitTip()=='','complete and unknown counts excluded')
complete[1434]=false; rows[1434][1].numFulfilled=0; assert(unitTip():find('7 remaining',1,true),'known zero is not unknown')
rows[1434][1].type='item'; assert(unitTip()=='','objective stage mismatch'); rows[1434][1].type='monster'
combat=true; assert(unitTip()=='','quiet in combat'); combat=false
build='00000'; assert(unitTip()=='','unsupported build')
`));

test('quest-item cue requires current place, exact carried item and unfinished use stage', () => replay(active + String.raw`
local items,bagsRead,used={16114},0,0
C_Container={GetContainerNumSlots=function(b) bagsRead=bagsRead+1; return b==0 and #items or 0 end,
    GetContainerItemInfo=function(_,s) return {itemID=items[s],stackCount=1} end,
    UseContainerItem=function() used=used+1 end}
GetItemInfo=function(id) if id==16114 then return "Foreman's Blackjack" end end
`, String.raw`
quests={5441}; guid='Creature-0-1-2-3-10556-00F1'; fire('PLAYER_LOGIN')
assert(unitTip():find("Use Foreman's Blackjack here",1,true),'exact carried item and live target')
zone='Sen’jin Village'; assert(unitTip()=='','same map is not the same area')
zone='Valley of Trials'; map=12; assert(unitTip()=='','wrong map')
map=1411; items={}; assert(unitTip()=='','known empty bags')
items={16115}; assert(unitTip()=='','wrong exact item')
items={16114}; rows[5441][1].finished=true; assert(unitTip()=='','wrong stage')
rows[5441][1].finished=false; quests={}; assert(unitTip()=='','not in log')
quests={5441}; bagsRead=0; combat=true; assert(unitTip()=='' and bagsRead==0,'quiet in combat')
combat=false; mute('questItemCue',true); assert(unitTip()=='' and bagsRead==0,'disabled cue skips bags')
assert(used==0,'no item use')
`));

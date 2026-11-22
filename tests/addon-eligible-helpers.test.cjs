"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), dir='addon/BackstageForever/';
const toc=fs.readFileSync(path.join(root,dir,'BackstageForever.toc'),'utf8').split(/\r?\n/).filter(s=>/\.lua$/.test(s));
function replay(body, files=toc) {
 const r=spawnSync(process.execPath,[require.resolve('./lua-stdin.cjs')],{cwd:root,encoding:'utf8',timeout:20000,input:body.replace('--LOAD--',files.map(f=>`dofile('${dir}${f}')`).join('\n'))});
 assert.equal(r.status,0,r.stderr||r.error?.message);assert.equal(r.stderr,'');
}
const events=String.raw`
local frames,msgs={},{}
local owner,build,fighting='A','70959',false
local GetFrame=function()local f={events={}};function f:RegisterEvent(e)self.events[e]=true end;function f:SetScript(k,v)self[k]=v end;frames[#frames+1]=f;return f end
CreateFrame=GetFrame
local function fire(e,...)for _,f in ipairs(frames)do if f.events[e] and f.OnEvent then f:OnEvent(e,...)end end end
InCombatLockdown=function()return fighting end
UnitGUID=function()return owner end
GetBuildInfo=function()return patch or '1.60.1',build end
DEFAULT_CHAT_FRAME={AddMessage=function(_,v)msgs[#msgs+1]=v end}
`;
test('known lower Frostbolt rank on an exact action slot reminds only after verified learning',()=>replay(events+String.raw`
local higher=false
local reads=0
Enum={SpellBookSpellBank={Player=0},SpellBookItemType={Spell=1}}
SPELL_RANK='Rank %d'
C_SpellBook={IsSpellKnown=function(id,bank)return bank==0 and (id==837 or id==7322 and higher)end,
 FindSpellBookSlotForSpell=function(id)return id==837 and 1 or higher and 2 or nil,0 end,
 GetSpellBookItemInfo=function(slot)return {name='Frostbolt',subName=slot==1 and 'Rank 3' or 'Rank 4',itemType=1,isPassive=false,isOffSpec=false,actionID=slot==1 and 837 or 7322,spellID=slot==1 and 837 or 7322}end}
UnitClass=function()return 'Mage','MAGE' end
GetActionInfo=function(slot)reads=reads+1;if slot==7 then return 'spell',837 end;if slot==8 then return 'macro',837 end end
--LOAD--
fire('PLAYER_LOGIN');assert(#msgs==0);higher=true;fire('SPELLS_CHANGED')
assert(#msgs==1 and msgs[1]:find('Frostbolt',1,true) and msgs[1]:find('7',1,true),'verified player rank and slot should be described')
fire('SPELLS_CHANGED');fire('ACTIONBAR_SLOT_CHANGED',7);assert(#msgs==1,'unchanged reminder must not spam')
BackstageForeverHelpersCommand('helpers spellRankReminder off')
local before=reads;fire('SPELLS_CHANGED');assert(reads==before)
patch='1.60.2';BackstageForeverHelpersCommand('helpers spellRankReminder on');fire('SPELLS_CHANGED');assert(reads==before,'another patch is not supported')
patch=nil;build='70959';C_SpellBook.FindSpellBookSlotForSpell=nil;fire('SPELLS_CHANGED');assert(reads==before,'absent spellbook API is not learned-rank evidence')
owner='B';fire('SPELLS_CHANGED');assert(#msgs==3) -- one reminder and two explicit settings acknowledgements
`,['BackstageForeverHelpers.lua','BackstageForeverCoach.lua']));
test('native gathering overlay marks only qualified historical points and drops them outside current scope',()=>replay(events+String.raw`
local map,rank=1411,1
build='70862'
time=function()return 1800000000 end;GetTime=function()return 10 end;GetLocale=function()return 'enUS' end
C_Map={GetBestMapForUnit=function()return map end}
C_SkillInfo={GetNumSkillLines=function()return rank and 1 or 0 end,GetSkillLineInfo=function()return {isHeader=false,skillID=186,rank=rank,maxRank=75}end}
--LOAD--
local function spot(id,name,b,at,x)
 return {id='wowf:mining:'..id..':1411:'..math.floor(x*10000+.5)..':4000:1.60.1.'..b,method='mining',entityId=id,mapId=1411,x=x,y=.4,clientBuild='1.60.1.'..b,observedAt=at,name=name,itemIds={2770},evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
end
BackstageForeverGatheringDB={schemaVersion=1,recording=false,records={spot(1731,'Copper Vein','70862',1800000000,.3),spot(1731,'Copper Vein','70862',1700000000,.4),spot(1731,'Copper Vein','70888',1800000000,.5),spot(999,'Copper Vein','70862',1800000000,.6)}}
BackstageForeverGatheringSession('PLAYER_LOGIN')
local function points()return BackstageForeverGatheringMapPoints(1411) end
local rows=points();assert(#rows==1 and rows[1].x==.3 and rows[1].detail:find('not a live spawn',1,true),'only exact recent historical identity')
rank=0;assert(#points()==0);rank=nil;assert(#points()==0);rank=1;fighting=true;assert(#points()==0);fighting=false
map=1412;assert(#points()==0); map=1411;owner='B';assert(#points()==0);owner='A'
BackstageForeverHelpersCommand('helpers gatheringMarks off');assert(#points()==0)
BackstageForeverHelpersCommand('helpers gatheringMarks on')
local pin={}
MapCanvasPinMixin={}
Mixin=function(target,...)for _,source in ipairs({...}) do for k,v in pairs(source)do target[k]=v end end;return target end
BackstageForeverAdvisorPin_OnLoad(pin)
pin:OnAcquired(points()[1],0,1411)
local moved=0;BackstageForeverWay=function()moved=moved+1 end
local click=pin.OnMouseClickAction
click(pin,'LeftButton');assert(moved==1)
rank=0;click(pin,'LeftButton');assert(moved==1,'stale rank retires waypoint')
rank=1;time=function()return 1800000000+604800 end
click(pin,'LeftButton');assert(moved==1 and #points()==0,'expired point cannot be used')
`,['BackstageForeverHelpers.lua','BackstageForeverCoach.lua','BackstageForeverAcquisition.lua','BackstageForeverGathering.lua','BackstageForeverAdvisorMap.lua']));

test('shipped TOC loads the helper implementations in dependency order',()=>replay(String.raw`
--LOAD--
assert(type(BackstageForeverGatheringMapPoints)=='function')
assert(type(BackstageForeverGear.pickRewards)=='function')
assert(type(BackstageForeverSpellRankRefresh)=='function')
`));

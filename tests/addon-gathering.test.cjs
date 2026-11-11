"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const prelude=String.raw`
local handlers,frames={},{}
local now,epoch,owner,build,map,x,y,fighting=10,1794398400,'PRIVATE_GUID','70888',1411,.5,.4,false
local source,items,sources='GameObject-0-1-2-3-1731-PRIVATE_OBJECT',{2770,2835},nil
local signals=0
issecretvalue=function(v)return type(v)=='table' and rawget(v,'secret')==true end
CreateFrame=function()local f={RegisterEvent=function()end,SetScript=function(self,key,fn)self[key]=fn end};frames[#frames+1]=f;return f end
InCombatLockdown=function()return fighting end
UnitGUID=function()return owner end
GetBuildInfo=function()return '1.60.1',build end
GetLocale=function()return 'enUS' end
GetTime=function()return now end;time=function()return epoch end
C_Map={GetBestMapForUnit=function()return map end,GetPlayerMapPosition=function()return {x=x,y=y}end}
GetNumLootItems=function()return #items end
GetLootSlotLink=function(i)return '|Hitem:'..items[i]..':0|h[Observed]|h' end
GetLootSourceInfo=function(i)if sources then return table.unpack(sources)end;return source,1 end
BackstageForeverRequestCapture=function()signals=signals+1 end
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
dofile('addon/BackstageForever/BackstageForeverAcquisition.lua')
dofile('addon/BackstageForever/BackstageForeverGathering.lua')
local function event(e,...)for _,f in ipairs(frames)do if f.OnEvent then f.OnEvent(f,e,...)end end end
BackstageForeverGatheringSession('PLAYER_LOGIN')
local function snap()return BackstageForeverGatheringSnapshot({id=owner,clientBuild='1.60.1.'..build,updatedAt=epoch})end
local function sent(target,spell)event('UNIT_SPELLCAST_SENT','player',target or 'Copper Vein','PRIVATE_CAST',spell or 2576)end
local function success(spell)now=now+.1;event('UNIT_SPELLCAST_SUCCEEDED','player','PRIVATE_CAST',spell or 2576)end
local function loot()now=now+.1;event('LOOT_READY',true)end
local function count()return #snap().records end
`;
function lua(body){assert.ok(fs.existsSync(path.resolve('addon/BackstageForever/BackstageForeverGathering.lua')),'Native gathering missing');const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:prelude+body,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');return r.stdout;}
test('actual player cast and single GameObject loot record both plausible orders once without OPENED or private identifiers',()=>lua(`for order=1,2 do BackstageForeverGatheringDB=nil;BackstageForeverGatheringSession('PLAYER_LOGIN');sent();if order==1 then success();loot()else loot();success()end;assert(count()==1);loot();assert(count()==1);local r=snap().records[1];assert(r.clientBuild=='1.60.1.70888' and r.entityId==1731 and #r.itemIds==2 and r.itemIds[1]==2770);assert(r.precision=='recorded-standing-point' and r.approximate and r.evidence=='observed-gathering-loot');assert(not r.id:find('PRIVATE',1,true));for k,v in pairs(r)do assert(k~='castGUID' and k~='sourceGUID' and k~='ownerGUID' and k~='quantity');if type(v)=='string' then assert(not v:find('PRIVATE',1,true))end end end;assert(signals==2)`));
test('collector rejects timing-only, corpse, multi-source, locale, method, material and target mismatches',()=>lua(`local cases={function()source='Creature-0-1-2-3-1731-PRIVATE'end,function()sources={source,1,'GameObject-0-1-2-3-1731-OTHER',1}end,function()source='GameObject-0-1-2-3-999-PRIVATE'end,function()GetLocale=function()return 'deDE'end end,function()items={2320}end,function()source={secret=true}end,function()GetLootSlotLink=function()return {secret=true}end end};for _,bad in ipairs(cases)do local oldSource,oldSources,oldItems,oldLocale,oldLink=source,sources,items,GetLocale,GetLootSlotLink;bad();sent();success();loot();assert(count()==0);source,sources,items,GetLocale,GetLootSlotLink=oldSource,oldSources,oldItems,oldLocale,oldLink end;sent('Copper');success();loot();assert(count()==0);sent('Copper Vein',2368);success(2368);loot();assert(count()==0);sent('',2368);success(2368);loot();assert(count()==0);event('LOOT_OPENED');assert(count()==0)`));
test('collector retires interruption, competing cast, timeout, combat, map/build/owner, displacement, secret and missing clocks',()=>lua(`local cases={function()event('UNIT_SPELLCAST_INTERRUPTED','player','PRIVATE_CAST',2576)end,function()event('UNIT_SPELLCAST_SENT','player','Other','OTHER_CAST',1)end,function()now=now+11 end,function()fighting=true;event('PLAYER_REGEN_DISABLED');fighting=false end,function()map=1412 end,function()build='70889'end,function()owner='OTHER'end,function()x=.6 end,function()GetTime=nil end,function()time=nil end,function()C_Map.GetPlayerMapPosition=function()return {x={secret=true},y=.4}end end};for _,bad in ipairs(cases)do local a,b,c,d,e,f,g=map,build,owner,x,GetTime,time,C_Map.GetPlayerMapPosition;sent();bad();success();loot();assert(count()==0);map,build,owner,x,GetTime,time,C_Map.GetPlayerMapPosition=a,b,c,d,e,f,g;BackstageForeverGatheringSession('PLAYER_LOGIN')end;sent();success();now=now+3;loot();assert(count()==0)`));
test('public vector properties and GetXY are guarded; unavailable snapshot preserves owned history and pause/clear retire pending',()=>lua(`C_Map.GetPlayerMapPosition=function()return setmetatable({},{__index=function(_,k)if k=='x' then return .5 elseif k=='y' then return .4 end end})end;sent();success();loot();assert(count()==1);C_Map.GetPlayerMapPosition=function()return {GetXY=function()return .5,.4 end}end;sent();success();loot();assert(count()==1);BackstageForeverGatheringSetRecording(false);sent();success();loot();assert(count()==1 and snap().recording==false);BackstageForeverGatheringSession('PLAYER_LOGIN');assert(snap().recording==false);GetNumLootItems=nil;assert(snap().status=='unavailable' and count()==1);local clear=BackstageForeverGatheringClearAction();assert(type(clear)=='function');BackstageForeverGatheringSession('PLAYER_LOGOUT');clear();assert(#BackstageForeverGatheringDB.records==1);BackstageForeverGatheringSession('PLAYER_LOGIN');BackstageForeverGatheringClearAction()();assert(count()==0)`));

test('actual capture emits empty typed schema, coalesces no-argument record signals and retires map on failed capture',()=>{
 const fixture=fs.readFileSync(path.join(__dirname,'addon-live.test.cjs'),'utf8').match(/const capture=String.raw`([\s\S]*?)`;/)[1];
 const source=fixture.replace("dofile('addon/BackstageForever/BackstageForever.lua')",String.raw`
 local sessions,maps=0,0
 BackstageForeverGatheringSession=function(event)sessions=sessions+1 end
 BackstageForeverGatheringSnapshot=function(c)return {schemaVersion=1,status='unavailable',recording=false,observedAt=c.updatedAt,limited=false,totalRecords=0,records={}}end
 BackstageForeverMapUpdate=function(c)maps=maps+1 end
 dofile('addon/BackstageForever/BackstageForever.lua')
 `)+String.raw`
 event('PLAYER_LOGIN');assert(sessions==1);assert(BackstageForeverExport:find('"gathering":',1,true));assert(BackstageForeverExport:find('"records":[]',1,true));assert(type(BackstageForeverRequestCapture)=='function')
 for i=1,50 do BackstageForeverRequestCapture()end;assert(#timers==1);local before=reads;flush();assert(reads==before+1)
 BackstageForeverRequestCapture();event('PLAYER_LOGOUT');flush();assert(reads==before+1 and sessions==2)
 event('PLAYER_LOGIN');local old=maps;fighting=true;event('QUEST_LOG_UPDATE');flush();assert(maps>old)
 `;
 const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:source,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
});

test('new competing loot before success rejects ambiguous attribution; repeated identical READY remains one record',()=>lua(`sent();loot();source='GameObject-0-1-2-3-1731-OTHER';loot();success();assert(count()==0);sent();loot();loot();success();assert(count()==1)`));
test('private store retains128, exports64, deduplicates and preserves paused history across unavailable login APIs',()=>lua(`for i=1,140 do now=now+1;epoch=epoch+1;x=i/1000;sent();success();loot()end;assert(#BackstageForeverGatheringDB.records==128);assert(count()==64 and snap().totalRecords==128 and snap().limited);local last=snap().records[1].id;sent();success();loot();assert(#BackstageForeverGatheringDB.records==128 and snap().records[1].id==last);BackstageForeverGatheringSetRecording(false);local previous=owner;UnitGUID=function()return nil end;BackstageForeverGatheringSession('PLAYER_LOGIN');assert(#BackstageForeverGatheringDB.records==128);UnitGUID=function()return previous end;assert(count()==64 and not snap().recording)`));

test('actual capture budget trims optional gathering before workshop/quests and preserves native retained history',()=>{
 const at=1600000000;
 const records=Array.from({length:64},(_,i)=>({id:`wowf:mining:1731:1411:${i+1}:4000:1.60.1.70862`,method:'mining',entityId:1731,itemIds:[2770,2835],mapId:1411,x:(i+1)/10000,y:.4,observedAt:at,clientBuild:'1.60.1.70862',name:'C'.repeat(120),evidence:'observed-gathering-loot',precision:'recorded-standing-point',approximate:true}));
 const characters=Array.from({length:25},(_,i)=>({id:'old-'+i,name:'Old',realm:'Realm',className:'Mage',level:20,updatedAt:at,quests:[{id:42,title:'Retain quest',complete:false,objectives:[]}],progress:{current:3,max:100},readiness:{bags:{free:2,total:20}},gathering:{schemaVersion:1,status:'available',recording:true,observedAt:at,limited:false,totalRecords:64,records}}));
 const seed=JSON.stringify({schema:1,characters,activeId:'old-0',observedAt:at});assert.ok(Buffer.byteLength(seed)<1048576);
 const fixture=fs.readFileSync(path.join(__dirname,'addon-preparation.test.cjs'),'utf8').match(/const fixture = String.raw`([\s\S]*?)`;/)[1];
 const source=fixture+`BackstageForeverExport=[=[${seed}]=]\n`+String.raw`
 spells={};for i=1,100 do spells[i]=i end
 C_TradeSkillUI.GetRecipeInfo=function(id)return {recipeID=id,name=string.rep('R',200),learned=true}end
 C_Item.GetItemNameByID=function()return string.rep('N',200)end
 C_TradeSkillUI.GetRecipeSchematic=function(id)local slots={};for i=1,20 do slots[i]=basic(i,1)end;return {recipeID=id,isRecraft=false,reagentSlotSchematics=slots}end
 local retained={};for i=1,64 do retained[i]={id='wowf:mining:1731:1411:'..i..':4000:1.60.1.70862',method='mining',entityId=1731,itemIds={2770},mapId=1411,x=i/10000,y=.4,observedAt=now,clientBuild='1.60.1.70862',name=string.rep('N',120),evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}end
 BackstageForeverGatheringSnapshot=function(c)local rows={};for i,r in ipairs(retained)do rows[i]={};for k,v in pairs(r)do rows[i][k]=v end;rows[i].itemIds={2770}end;return {schemaVersion=1,status='unavailable',recording=false,observedAt=c.updatedAt,limited=false,totalRecords=64,records=rows}end
 event('PLAYER_LOGIN');assert(#retained==64);save()
 `;
 const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:source,encoding:'utf8',timeout:60000,maxBuffer:4*1048576});assert.equal(r.status,0,r.stderr||r.error?.message);assert.equal(r.stderr,'');const out=JSON.parse(r.stdout);const parsed=require('../src/core/game-sync.cjs').parseSavedVariables('BackstageForeverExport = '+JSON.stringify(r.stdout.trim()));assert.ok(parsed.characters.every(c=>c.gathering));assert.ok(Buffer.byteLength(r.stdout)<1048576);assert.equal(out.characters.length,26);assert.ok(out.characters.some(c=>c.gathering?.limited));assert.equal(out.characters.find(c=>c.id==='A').readiness.workshop.recipes.items.length,100);for(const c of out.characters.filter(c=>c.id.startsWith('old-'))){assert.equal(c.quests[0].title,'Retain quest');assert.equal(c.progress.current,3);assert.equal(c.readiness.bags.total,20);}const count=v=>v&&typeof v==='object'?1+Object.values(v).reduce((n,x)=>n+count(x),0):1;assert.ok(count(out)<=200000);
});

test('actual character capture accepts public vector properties and rejects protected property reads',()=>{
 const fixture=fs.readFileSync(path.join(__dirname,'addon-live.test.cjs'),'utf8').match(/const capture=String.raw`([\s\S]*?)`;/)[1];
 const body=String.raw`
 C_Map={GetBestMapForUnit=function()return 1411 end,GetPlayerMapPosition=function()return setmetatable({},{__index=function(_,k)if k=='x' then return .412345 elseif k=='y' then return .523456 end end})end}
 event('PLAYER_LOGIN');assert(BackstageForeverExport:find('"x":0.412345',1,true) and BackstageForeverExport:find('"y":0.523456',1,true))
 C_Map.GetPlayerMapPosition=function()return setmetatable({},{__index=function()error('protected')end})end;event('PLAYER_ENTERING_WORLD');assert(not BackstageForeverExport:find('"x":',1,true))
 `;
 const r=spawnSync(process.execPath,[require.resolve('fengari-node-cli/src/lua-cli.js'),'-'],{cwd:path.join(__dirname,'..'),input:fixture+body,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
});

test('known English herbalism needs actual target/object/material identity and ordinary vectors, never herb-name guessing',()=>lua(`source='GameObject-0-1-2-3-1617-PRIVATE_OBJECT';items={765};sent('Silverleaf',2368);loot();success(2368);assert(count()==1 and snap().records[1].method=='herbalism' and snap().records[1].entityId==1617);BackstageForeverGatheringClearAction()();sent('Silverleaf plant',2368);success(2368);loot();assert(count()==0);C_Map.GetPlayerMapPosition=function()return {GetXY=function()return {secret=true},.4 end}end;sent('Silverleaf',2368);success(2368);loot();assert(count()==0)`));

test('review P1 single event context consumes each required observation once and cannot append a second-read nil epoch',()=>lua(`
sent();success();loot();assert(count()==1);local first=BackstageForeverGatheringDB.records[1].id;x=.51;sent();success()
local reads=0;time=function()reads=reads+1;if reads==1 then return epoch end;return nil end
loot();assert(reads==1,'Event epoch must be observed once, not checked then reread');time=function()return epoch end
assert(#BackstageForeverGatheringDB.records==2 and count()==2);local found=false;for _,r in ipairs(BackstageForeverGatheringDB.records)do assert(r.observedAt==epoch);if r.id==first then found=true end end;assert(found,'Prior valid record must survive')
`));
test('review P1 transient required context failures preserve valid history and allow later valid recovery',()=>lua(`
sent();success();loot();assert(count()==1);local first=BackstageForeverGatheringDB.records[1].id
local failures={nil,{secret=true},'malformed'}
local cases={
 {get=function()return time end,set=function(f)time=f end,good=function()return epoch end},
 {get=function()return GetTime end,set=function(f)GetTime=f end,good=function()return now end},
 {get=function()return GetBuildInfo end,set=function(f)GetBuildInfo=f end,good=function()return '1.60.1',build end},
 {get=function()return UnitGUID end,set=function(f)UnitGUID=f end,good=function()return owner end},
 {get=function()return C_Map.GetBestMapForUnit end,set=function(f)C_Map.GetBestMapForUnit=f end,good=function()return map end},
 {get=function()return C_Map.GetPlayerMapPosition end,set=function(f)C_Map.GetPlayerMapPosition=f end,good=function()return {x=x,y=y}end},
}
for index,case in ipairs(cases)do for kind=1,3 do
 x=.51;sent();success();local old=case.get();local bad=failures[kind];case.set(function()return bad end)
 loot();case.set(old);assert(#BackstageForeverGatheringDB.records==1,'Invalid context must not append/reset retained history '..index..'/'..kind);assert(count()==1 and snap().records[1].id==first)
end end
-- An unexpected nonempty owner also retires correlation; it cannot adopt/erase this session's store.
x=.51;sent();success();local prior=UnitGUID;UnitGUID=function()return 'DIFFERENT_OWNER'end;loot();UnitGUID=prior;assert(count()==1 and snap().records[1].id==first)
x=.52;sent();success();loot();assert(count()==2,'A later complete observation must recover recording')
`));
test('review P1 context values that become secret on a hypothetical second read never enter correlation math or poison retained records',()=>lua(`
sent();success();loot();assert(count()==1)
local cases={
 {set=function(f)GetTime=f end,good=function()return now end},
 {set=function(f)GetBuildInfo=f end,good=function()return '1.60.1',build end},
 {set=function(f)UnitGUID=f end,good=function()return owner end},
 {set=function(f)C_Map.GetBestMapForUnit=f end,good=function()return map end},
 {set=function(f)C_Map.GetPlayerMapPosition=f end,good=function()return {x=x,y=y}end},
}
for i,case in ipairs(cases)do x=.51+i/1000;sent();success();local reads=0;case.set(function()reads=reads+1;if reads==1 then return case.good()end;return {secret=true}end);loot();assert(reads==1,'Event field read once '..i);case.set(case.good);assert(count()==i+1);for _,r in ipairs(snap().records)do assert(r.observedAt==epoch and r.clientBuild=='1.60.1.70888')end end
`));

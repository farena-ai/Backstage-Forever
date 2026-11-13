"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const LOAD = "dofile('addon/BackstageForever/BackstageForeverAssist.lua')";

test("danger warnings speak plainly and stay quiet for fair fights", () => {
  const out = lua(`${LOAD}
local function d(t) local r=BackstageForeverDanger(t) return r and (r.tone..':'..r.text) or 'none' end
print(d({attackable=true,level=-1,playerLevel=10}))
print(d({attackable=true,level=12,playerLevel=10,classification='elite'}))
print(d({attackable=true,level=16,playerLevel=10}))
print(d({attackable=true,level=13,playerLevel=10}))
print(d({attackable=true,level=11,playerLevel=10}))
print(d({attackable=true,level=3,playerLevel=20}))
print(d({attackable=true,level=10,playerLevel=10,classification='rare'}))
print(d({attackable=false,level=-1,playerLevel=10}))
print(d({attackable=true,isPlayer=true,level=-1,playerLevel=10}))
print(d({attackable=true,dead=true,level=-1,playerLevel=10}))
print(BackstageForeverGreyLevel(5),BackstageForeverGreyLevel(20),BackstageForeverGreyLevel(50))`).split("\n");
  assert.match(out[0], /^red:Skull/);
  assert.match(out[1], /^red:Elite \(level 12\)/);
  assert.match(out[2], /^red:Level 16, 6 above you/);
  assert.match(out[3], /^orange:Level 13/);
  assert.equal(out[4], "none");
  assert.match(out[5], /^grey:/);
  assert.match(out[6], /^yellow:Rare/);
  assert.deepEqual(out.slice(7, 10), ["none", "none", "none"]);
  assert.equal(out[10], "0\t13\t39");
});

test("money, duration, pace and junk helpers", () => {
  const out = lua(`${LOAD}
print(BackstageForeverMoney(0),BackstageForeverMoney(57),BackstageForeverMoney(3420),BackstageForeverMoney(1234567))
print(BackstageForeverDuration(30),BackstageForeverDuration(720),BackstageForeverDuration(3900))
print(BackstageForeverPace({start=0,gained=100},60,0,1000)==nil)
local p=BackstageForeverPace({start=0,gained=3000},1800,400,1000) print(p.perHour,math.floor(p.toLevel))
local list,total=BackstageForeverJunk({{quality=0,price=25,count=3},{quality=1,price=99},{quality=0,price=0},{quality=0,price=10,noValue=true},{quality=0,price=5}})
print(#list,total)`).split("\n");
  assert.equal(out[0], "0c\t57c\t34s 20c\t123g 45s");
  assert.equal(out[1], "under a minute\t12 min\t1 h 05 min");
  assert.equal(out[2], "true");
  assert.equal(out[3], "6000\t360");
  assert.equal(out[4], "2\t80");
});

const MOCKS = String.raw`
local frames,msgs,way,sold,clock={},{},nil,{},100
GetTime=function()return clock end
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)msgs[#msgs+1]=m end}
local function frame(name)
  local f={scripts={},shown=false,events={}}
  function f:RegisterEvent(e)self.events[e]=true end
  function f:SetScript(k,fn)self.scripts[k]=fn end
  function f:Show()self.shown=true end function f:Hide()self.shown=false end
  function f:SetText(t)self.text=t end
  function f:CreateTexture()return setmetatable({},{__index=function()return function()end end})end
  function f:CreateFontString()local s={shown=true} function s:SetText(t)self.text=t end function s:Show()self.shown=true end function s:Hide()self.shown=false end return setmetatable(s,{__index=function()return function()end end})end
  frames[name or ('f'..#frames)]=f
  return setmetatable(f,{__index=function()return function()end end})
end
CreateFrame=function(_,name)return frame(name)end
UIParent={} MerchantFrame={} TargetFrame={}
UnitClass=function()return 'Mage' end
UnitFactionGroup=function()return 'Horde' end
C_Map={GetBestMapForUnit=function()return 1411 end,GetPlayerMapPosition=function()return {GetXY=function()return 0.5,0.5 end}end,GetMapInfo=function(id)return {name=id==1411 and 'Durotar' or 'Orgrimmar'}end,ClearUserWaypoint=function()way='cleared' end}
BackstageForeverWay=function(m)way=m end
BackstageForeverAdvisorData={npcs={[1411]={{k='c',n='Mai\'ah',r='Mage Trainer',s='H',x=0.42,y=0.69},{k='c',n='Far',r='Mage Trainer',s='H',x=0.9,y=0.9},{k='c',n='Other',r='Warrior Trainer',s='H',x=0.5,y=0.5}}}}
local xp,xpMax=0,1000
UnitXP=function()return xp end UnitXPMax=function()return xpMax end
C_DeathInfo={GetCorpseMapPosition=function()return {GetXY=function()return 0.31,0.62 end}end}
local ghost=false UnitIsGhost=function()return ghost end
local bag={[1]={itemID=1,quality=0,stackCount=2},[2]={itemID=2,quality=3,stackCount=1},[3]={itemID=3,quality=0,stackCount=1}}
C_Container={GetContainerNumSlots=function(b)return b==0 and 3 or 0 end,GetContainerItemInfo=function(b,s)return b==0 and bag[s] or nil end,UseContainerItem=function(b,s)sold[#sold+1]=s bag[s]=nil end}
GetItemInfo=function(id)return 'n',nil,nil,nil,nil,nil,nil,nil,nil,nil,({[1]=12,[2]=5000,[3]=40})[id] end
InCombatLockdown=function()return false end
UnitExists=function()return true end UnitLevel=function(u)return u=='player' and 10 or 16 end
UnitClassification=function()return 'normal' end UnitCanAttack=function()return true end UnitIsPlayer=function()return false end UnitIsDead=function()return false end
`;
test("events: welcome once, level-up with trainer, quest math, death arrow, junk button and danger line", () => {
  const out = lua(`${MOCKS}
${LOAD}
local ev=nil for _,f in pairs(frames) do if f.events and f.events.PLAYER_LOGIN then ev=f end end
local fire=function(...) ev.scripts.OnEvent(ev,...) end
fire('PLAYER_LOGIN')
assert(msgs[1]:find('is ready',1,true),'welcome')
assert(BackstageForeverAssistSettings.welcomed==true)
fire('PLAYER_LEVEL_UP',11)
assert(msgs[#msgs]:find('Level 11!',1,true) and msgs[#msgs]:find("Mai'ah in Durotar",1,true),'nearest trainer named: '..msgs[#msgs])
xp=400 fire('PLAYER_XP_UPDATE')
fire('QUEST_TURNED_IN',123,150,0)
assert(msgs[#msgs]:find('+150 XP',1,true) and msgs[#msgs]:find('about 4 more quests',1,true),msgs[#msgs])
fire('PLAYER_DEAD') assert(msgs[#msgs]:find('Release Spirit',1,true))
ghost=true fire('PLAYER_ALIVE')
assert(way and way:find('^way 1411 0.3100 0.6200 your body'),tostring(way))
ghost=false fire('PLAYER_UNGHOST') assert(way=='cleared')
assert(BackstageForeverAssistSession.deaths==1 and BackstageForeverAssistSession.quests==1)
fire('MERCHANT_SHOW')
local b=frames.BackstageForeverSellJunkButton
assert(b.shown and b.text=='Sell junk: 2 items · 64c',tostring(b.text))
b.scripts.OnClick(b)
assert(#sold==2 and sold[1]==1 and sold[2]==3,'only greys sold')
assert(not b.shown,'hidden when nothing is left')
fire('MERCHANT_CLOSED')
fire('PLAYER_TARGET_CHANGED')
assert(BackstageForeverUpdateDanger().tone=='red')
BackstageForeverAssistCommand('danger off') assert(BackstageForeverUpdateDanger()==nil)
way=nil BackstageForeverAssistCommand('train') assert(way:find("Mai'ah",1,true))
local help=BackstageForeverAssistCommand('help') assert(#help>=6)
clock=100+1800 xp=600 fire('PLAYER_XP_UPDATE')
assert(BackstageForeverPaceLine():find('XP/hour',1,true))
print('ok')`);
  assert.equal(out, "ok");
});

test("the junk button refuses to sell in combat", () => {
  const out = lua(`${MOCKS}
${LOAD}
InCombatLockdown=function()return true end
print(BackstageForeverSellJunk(), #sold)`);
  assert.equal(out, "0\t0");
});

test("repair: warns once when gear wears out and again when it breaks, learns repairers, /bf repair finds the nearest", () => {
  const out = lua(`${MOCKS}
local dur={{90,100},{60,100}}
GetInventoryItemDurability=function(slot) local d=dur[slot] if d then return d[1],d[2] end end
BackstageForeverAdvisorData.npcs[1411][#BackstageForeverAdvisorData.npcs[1411]+1]={k='r',n='Far Smith',r='Blacksmith',s='H',x=0.95,y=0.95,i=901}
UnitGUID=function(u) return u=='npc' and 'Creature-0-1-2-3-3165-0000' or 'Player-1-2' end
UnitName=function() return 'Wuark' end
CanMerchantRepair=function() return true end
${LOAD}
local ev=nil for _,f in pairs(frames) do if f.events and f.events.UPDATE_INVENTORY_DURABILITY then ev=f end end
local fire=function(...) ev.scripts.OnEvent(ev,...) end
fire('PLAYER_LOGIN') local n=#msgs
fire('UPDATE_INVENTORY_DURABILITY') assert(#msgs==n,'no warning while healthy')
dur[2]={20,100} fire('UPDATE_INVENTORY_DURABILITY') assert(msgs[#msgs]:find('wearing out (20%)',1,true),msgs[#msgs])
n=#msgs fire('UPDATE_INVENTORY_DURABILITY') assert(#msgs==n,'warned once')
dur[2]={0,100} fire('UPDATE_INVENTORY_DURABILITY') assert(msgs[#msgs]:find('Gear broken',1,true))
dur[2]={100,100} fire('UPDATE_INVENTORY_DURABILITY') dur[2]={10,100} fire('UPDATE_INVENTORY_DURABILITY') assert(msgs[#msgs]:find('wearing out (10%)',1,true),'re-arms after repair')
fire('MERCHANT_SHOW')
assert(BackstageForeverAssistSettings.repairers[3165].n=='Wuark','learned the repair vendor you opened')
way=nil local r=BackstageForeverAssistCommand('repair') assert(r.name=='Wuark' and way:find('Wuark',1,true),'nearest: the learned one at your spot, not the far smith')
print('ok')`);
  assert.equal(out, "ok");
});

test("flight paths: met masters and known nodes count as learned; nearby unknown masters get one reminder", () => {
  const out = lua(`${MOCKS}
BackstageForeverAdvisorData.npcs[1411][#BackstageForeverAdvisorData.npcs[1411]+1]={k='f',n='Devrak',r='Wind Rider Master',s='H',x=0.51,y=0.50,i=3615,t=25}
BackstageForeverAdvisorData.npcs[1411][#BackstageForeverAdvisorData.npcs[1411]+1]={k='f',n='Known Node',r='Flight Master',s='H',x=0.2,y=0.2,i=7777,t=23}
GetTaxiMapID=function() return 1414 end
C_TaxiMap={GetAllTaxiNodes=function() return {{nodeID=23,state=1},{nodeID=25,state=2}} end}
UnitGUID=function(u) return 'Player-1-2' end
${LOAD}
local ev=nil for _,f in pairs(frames) do if f.events and f.events.TAXIMAP_OPENED then ev=f end end
local fire=function(...) ev.scripts.OnEvent(ev,...) end
fire('PLAYER_LOGIN')
fire('TAXIMAP_OPENED')
assert(BackstageForeverAssistSettings.flightNodes[23] and not BackstageForeverAssistSettings.flightNodes[25])
local list=BackstageForeverAssistCommand('flights')
assert(#list==2)
local devrak,known for _,m in ipairs(msgs) do if m:find('Devrak',1,true) then devrak=m end if m:find('Known Node: learned',1,true) then known=m end end
assert(devrak and devrak:find('not learned yet',1,true) and known,'status per master')
local n=#msgs
fire('ZONE_CHANGED') assert(msgs[#msgs]:find('Flight master nearby: Devrak',1,true),msgs[#msgs])
local m=#msgs fire('ZONE_CHANGED') assert(#msgs==m,'one reminder per session')
UnitGUID=function(u) return u=='npc' and 'Creature-0-1-2-3-3615-0000' or 'Player-1-2' end
fire('TAXIMAP_OPENED') assert(BackstageForeverAssistSettings.flightNpcs[3615],'talking to the master marks it learned')
print('ok')`);
  assert.equal(out, "ok");
});

test("hearthstone advice: suggests this zone's inn when your hearth is elsewhere and you're questing here", () => {
  const out = lua(`${LOAD}
local zones={{m=1411,lo=1,hi=10,th={"Razor Hill","Sen'jin Village"}},{m=1413,lo=10,hi=25,th={"The Crossroads","Camp Taurajo"},ta={"Ratchet"}}}
local a=BackstageForeverHearthAdvice("Razor Hill",1413,14,"H",zones) print(a.home,a.town)
print(BackstageForeverHearthAdvice("The Crossroads",1413,14,"H",zones)==nil)
print(BackstageForeverHearthAdvice("Razor Hill",1413,4,"H",zones)==nil)
local b=BackstageForeverHearthAdvice("Stormwind",1413,15,"A",zones) print(b.town)`).split(/\r?\n/);
  assert.equal(out[0], "1411	The Crossroads");
  assert.equal(out[1], "true", "already home here");
  assert.equal(out[2], "true", "too low to quest here");
  assert.equal(out[3], "Ratchet");
});

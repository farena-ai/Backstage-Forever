"use strict";
// 1.22: five comfort helpers that speak in chat only: rested XP, weapon skills, flight times,
// gear wear and discovered areas. Pure functions first, then the thin game-facing parts with stubs.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverComfort.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler,updater
local registered={}
CreateFrame=function()
  local f={RegisterEvent=function(_,e) if e=='NOT_AN_EVENT' then error('unknown event') end registered[e]=true end}
  f.SetScript=function(self,k,fn) if k=='OnEvent' then handler=fn elseif k=='OnUpdate' then updater=function(e) fn(self,e) end end end
  return f
end
local combat=false InCombatLockdown=function() return combat end
local clock=1000 GetTime=function() return clock end
local function last() return said[#said] end
`;

test("rested: bars, share of a level, time to full at the reference rate, and the level cap", () => lua(FILE + String.raw`
local s=BackstageForeverRestedState(3000,20000,true)
assert(s.capped==false and s.bars==3 and s.percent==15 and s.resting==true and s.full==false)
assert(s.hoursInn==27*8 and s.hoursElsewhere==27*8*4,'one bar per 8 hours in an inn, a quarter of that elsewhere')
s=BackstageForeverRestedState(nil,20000,false)
assert(s.bars==0 and s.hoursInn==240,'empty to full is ten days at an inn')
s=BackstageForeverRestedState(999999,20000,false)
assert(s.bars==30 and s.full==true and s.hoursInn==0,'never more than a level and a half')
assert(BackstageForeverRestedState(100,0).capped==true and BackstageForeverRestedState(100,nil).capped==true and BackstageForeverRestedState(100,5000,false,true).capped==true)
assert(BackstageForeverRestTime(0.2)=='under an hour' and BackstageForeverRestTime(5)=='5 h' and BackstageForeverRestTime(48)=='2 days' and BackstageForeverRestTime(77)=='3 days 5 h')
assert(BackstageForeverRestTime(-1)==nil and BackstageForeverRestTime(0/0)==nil and BackstageForeverRestTime('x')==nil)
local lines=BackstageForeverRestedLines(BackstageForeverRestedState(3000,20000,false))
assert(lines[1]=='Rested XP: 3.0 of 30 bars (15% of a level).',lines[1])
assert(lines[2]=='Full in about 9 days at an inn or city, about 36 days elsewhere. Reference rate: one bar per 8 hours in an inn or city.',lines[2])
assert(lines[3]=='You are not in a rest area now.' and #lines==3)
lines=BackstageForeverRestedLines(BackstageForeverRestedState(999999,20000,true))
assert(#lines==2 and lines[1]:find('full',1,true) and lines[2]=='You are resting now.')
lines=BackstageForeverRestedLines({capped=true})
assert(#lines==1 and lines[1]=='You are at the level cap. Rested XP has nothing to add.')
assert(BackstageForeverRestedLines(nil)[1]:find('not readable',1,true))
assert(BackstageForeverRestedNudge(BackstageForeverRestedState(3000,20000,false)):find('outside a rest area',1,true))
assert(BackstageForeverRestedNudge(BackstageForeverRestedState(3000,20000,true))==nil,'no nudge inside a rest area')
assert(BackstageForeverRestedNudge(BackstageForeverRestedState(999999,20000,false))==nil,'no nudge when rested is full')
assert(BackstageForeverRestedNudge({capped=true})==nil and BackstageForeverRestedNudge(nil)==nil)
`));

test("rested in game: the command, the logout nudge and its switch", () => lua(STUBS + String.raw`
local resting,xpMax,level=false,20000,20
UnitXPMax=function() return xpMax end GetXPExhaustion=function() return 3000 end IsResting=function() return resting end
UnitLevel=function() return level end GetMaxPlayerLevel=function() return 60 end
`+ FILE + String.raw`
assert(registered.PLAYER_CAMPING,'the logout countdown event is asked for, guarded')
BackstageForeverRestedCommand()
assert(#said==3 and said[1]=='Backstage Forever: Rested XP: 3.0 of 30 bars (15% of a level).',said[1])
handler(nil,'PLAYER_CAMPING') assert(#said==4 and last():find('logging out outside a rest area',1,true))
resting=true handler(nil,'PLAYER_CAMPING') assert(#said==4,'quiet inside a rest area')
resting=false BackstageForeverComfortCommand('comfort rested off') assert(BackstageForeverComfortSettings.rested==false and last():find('Log-off rested nudge',1,true))
local n=#said handler(nil,'PLAYER_CAMPING') assert(#said==n,'switched off')
BackstageForeverComfortCommand('comfort rested on') handler(nil,'PLAYER_CAMPING') assert(#said==n+2)
level=60 n=#said handler(nil,'PLAYER_CAMPING') assert(#said==n,'nothing to gain at the cap')
BackstageForeverRestedCommand() assert(last()=='Backstage Forever: You are at the level cap. Rested XP has nothing to add.')
UnitXPMax=function() error('secret') end BackstageForeverRestedCommand() assert(last():find('not readable',1,true))
n=#said BackstageForeverComfortCommand('comfort') assert(#said==n+5 and said[n+1]:find('Comfort helpers',1,true) and said[n+2]:find('/bf comfort rested off',1,true))
BackstageForeverComfortCommand('comfort nonsense on') assert(BackstageForeverComfortSettings.nonsense==nil)
`));

test("weapon skills: the game's own names map a weapon type to its skill in any language", () => lua(FILE + String.raw`
local en={{name='Maces',rank=12,max=150},{name='Two-Handed Maces',rank=140,max=150},{name='Swords',rank=150,max=150},{name='Bows',rank=30,max=150},{name='Fishing',rank=1,max=75},{name='Defense',rank=150,max=150}}
local function skill(sub,list) local s=BackstageForeverWeaponSkillFor(sub,list) return s and s.name end
assert(skill('One-Handed Maces',en)=='Maces' and skill('Two-Handed Maces',en)=='Two-Handed Maces' and skill('One-Handed Swords',en)=='Swords')
assert(skill('Bows',en)=='Bows' and skill('Daggers',en)==nil and skill('',en)==nil and skill(nil,en)==nil and skill('Bows',nil)==nil)
local de={{name='Streitkolben',rank=12,max=150},{name='Zweihandstreitkolben',rank=1,max=150},{name='\195\132xte',rank=40,max=150},{name='Zweihand\195\164xte',rank=1,max=150},{name='St\195\164be',rank=5,max=150}}
assert(skill('Einhandstreitkolben',de)=='Streitkolben' and skill('Zweihandstreitkolben',de)=='Zweihandstreitkolben')
assert(skill('Einhand\195\164xte',de)=='\195\132xte','an accented first letter still matches')
assert(skill('Zweihand\195\164xte',de)=='Zweihand\195\164xte' and skill('St\195\164be',de)=='St\195\164be' and skill('Dolche',de)==nil)
local fr={{name='Masses',rank=1,max=150},{name='Masses \195\160 deux mains',rank=1,max=150}}
assert(skill('Masses \195\160 une main',fr)=='Masses' and skill('Masses \195\160 deux mains',fr)=='Masses \195\160 deux mains')
assert(BackstageForeverWeaponSkillCap(30)==150 and BackstageForeverWeaponSkillCap(0)==nil and BackstageForeverWeaponSkillCap('x')==nil)
assert(BackstageForeverWeaponSkillLine(en[1],30)=='Maces 12/150: expect misses until it rises.')
assert(BackstageForeverWeaponSkillLine(en[2],30)==nil and BackstageForeverWeaponSkillLine(en[3],30)==nil,'close to the cap is quiet')
assert(BackstageForeverWeaponSkillLine({name='Maces',rank=1,max=5},1)==nil,'a new character is not nagged')
assert(BackstageForeverWeaponSkillLine({name='Maces',rank=250,max=300},60)=='Maces 250/300: expect misses until it rises.')
assert(BackstageForeverWeaponSkillLine(nil,30)==nil and BackstageForeverWeaponSkillLine(en[1],nil)==nil)
local lines=BackstageForeverWeaponLines({en[3],en[1],en[4],en[2],en[6]},30)
assert(lines[1]=='Weapon skills, lowest first. The cap at level 30 is 150.')
assert(lines[2]=='  Maces 12/150, Bows 30/150, Two-Handed Maces 140/150, Defense 150/150' and lines[3]=='  Swords 150/150',lines[2])
assert(BackstageForeverWeaponLines({},30)[1]:find('not readable',1,true) and BackstageForeverWeaponLines(en,nil)[1]:find('not readable',1,true))
`));

test("weapon skills in game: one line per weapon type per session, never in combat, off with its switch", () => lua(STUBS + String.raw`
UnitLevel=function() return 30 end
local lines={{name='Class Skills',header=true},{name='Frost',rank=1,max=1},{name='Professions',header=true},{name='Fishing',rank=1,max=150},
  {name='Weapon Skills',header=true},{name='Maces',rank=12,max=150},{name='Swords',rank=150,max=150},{name='Defense',rank=150,max=150},{name='Unarmed',rank=20,max=150},
  {name='Languages',header=true},{name='Orcish',rank=300,max=300}}
C_SkillInfo={GetNumSkillLines=function() return #lines end,GetSkillLineInfo=function(i) local l=lines[i] return {name=l.name,isHeader=l.header==true,rank=l.rank,maxRank=l.max} end}
local worn={[16]='mace'}
GetInventoryItemLink=function(_,slot) return worn[slot] end
local items={mace={'One-Handed Maces',2,4},sword={'One-Handed Swords',2,7},pole={'Fishing Poles',2,20},shield={'Shields',4,6},odd={'One-Handed Maces',nil,nil}}
GetItemInfo=function(link) local i=items[link] if not i then return nil end return link,link,1,10,1,'Weapon',i[1],1,'INVTYPE_WEAPON',1,1,i[2],i[3] end
local subs={[4]='One-Handed Maces',[7]='One-Handed Swords',[15]='Daggers',[20]='Fishing Poles'}
GetItemSubClassInfo=function(class,sub) assert(class==2) return subs[sub] end
`+ FILE + String.raw`
combat=true handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) assert(#said==0,'never in combat')
combat=false handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==1 and said[1]=='Backstage Forever: Maces 12/150: expect misses until it rises.',said[1])
handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==1,'once per weapon type per session')
worn[16]='sword' handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) assert(#said==1,'a trained skill is quiet')
worn[16]='pole' handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) worn[17]='shield' handler(nil,'PLAYER_EQUIPMENT_CHANGED',17) assert(#said==1,'fishing poles and shields are not weapon skills')
worn[16]='mace' handler(nil,'PLAYER_EQUIPMENT_CHANGED',1) assert(#said==1,'only weapon slots are looked at')
BackstageForeverWeaponsCommand()
assert(said[2]=='Backstage Forever: Weapon skills, lowest first. The cap at level 30 is 150.',said[2])
assert(said[3]=='Backstage Forever:   Maces 12/150, Unarmed 20/150, Defense 150/150, Swords 150/150',said[3])
`+ FILE + String.raw`
said={} BackstageForeverComfortSettings={weapons=false} handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) assert(#said==0,'switched off')
BackstageForeverComfortSettings=nil worn[16]='odd' handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) assert(#said==0,'an item the game does not class as a weapon stays quiet')
C_SkillInfo=nil
GetNumSkillLines=function() return 3 end
GetSkillLineInfo=function(i) if i==1 then return 'Weapon Skills',true end if i==2 then return 'Maces',false,true,12,0,0,150 end return 'Swords',false,true,150,0,0,150 end
worn[16]='mace' handler(nil,'PLAYER_EQUIPMENT_CHANGED',16) assert(#said==1 and said[1]:find('Maces 12/150',1,true),'the older skill list works too')
GetNumSkillLines=function() error('gone') end GetItemSubClassInfo=nil
BackstageForeverWeaponsCommand() assert(said[#said]:find('not readable',1,true))
`));

test("flight times: only whole timed trips are kept, the list is bounded and reads plainly", () => lua(FILE + String.raw`
assert(BackstageForeverFlightDuration(45)=='45s' and BackstageForeverFlightDuration(130)=='2m 10s' and BackstageForeverFlightDuration(600.4)=='10m 00s')
assert(BackstageForeverFlightDuration(-1)==nil and BackstageForeverFlightDuration('x')==nil)
local db={v=1,trips={}}
local row=BackstageForeverFlightRecord(db,'Crossroads, The Barrens','Orgrimmar, Durotar',129.6,100)
assert(row.seconds==130 and row.count==1 and #db.trips==1)
assert(BackstageForeverFlightKnownTime(db,'Crossroads, The Barrens','Orgrimmar, Durotar')==130)
assert(BackstageForeverFlightKnownTime(db,'Orgrimmar, Durotar','Crossroads, The Barrens')==nil,'the way back is its own trip')
BackstageForeverFlightRecord(db,'Crossroads, The Barrens','Orgrimmar, Durotar',131,200)
BackstageForeverFlightRecord(db,'Crossroads, The Barrens','Orgrimmar, Durotar',132,300)
assert(#db.trips==1 and db.trips[1].count==3 and db.trips[1].seconds==132 and db.trips[1].at==300,'the latest time wins')
for _,bad in ipairs({{'A','A',60},{'A','',60},{'A','B',2},{'A','B',4000},{'A','B',0/0},{nil,'B',60},{string.rep('x',81),'B',60}}) do
  assert(BackstageForeverFlightRecord(db,bad[1],bad[2],bad[3],1)==nil)
end
assert(BackstageForeverFlightRecord(nil,'A','B',60,1)==nil and BackstageForeverFlightRecord({},'A','B',60,1)==nil and #db.trips==1)
BackstageForeverFlightRecord(db,'Stormwind, Elwynn','Ironforge, Dun Morogh',215,400)
local lines=BackstageForeverFlightLines(db)
assert(lines[1]=='Flight times you learned: 2.')
assert(lines[2]=='Stormwind, Elwynn to Ironforge, Dun Morogh: 3m 35s, flown once.',lines[2])
assert(lines[3]=='Crossroads, The Barrens to Orgrimmar, Durotar: 2m 12s, flown 3 times.',lines[3])
assert(BackstageForeverFlightLines({trips={}})[1]:find('No flight times learned yet',1,true) and BackstageForeverFlightLines(nil)[1]:find('No flight times',1,true))
local big={trips={}}
for i=1,205 do BackstageForeverFlightRecord(big,'From '..i,'To '..i,60,i) end
assert(#big.trips==200 and big.trips[1].from=='From 6' and big.trips[200].from=='From 205','200 trips at most; the oldest go first')
assert(#BackstageForeverFlightLines(big)==13,'twelve rows and a heading')
-- The watcher: a flight starts only after the flight map was opened, and ends when you land.
local st={}
assert(BackstageForeverFlightStep(st,true,10)==nil,'a flight that did not start at a flight map is not timed')
st.from='A' assert(BackstageForeverFlightStep(st,false,10)==nil)
assert(BackstageForeverFlightStep(st,true,12)=='takeoff' and st.flying==true and BackstageForeverFlightStep(st,true,50)==nil)
local what,seconds=BackstageForeverFlightStep(st,false,142) assert(what=='landed' and seconds==130 and st.flying==false)
st={from='A',closedAt=100}
assert(BackstageForeverFlightStep(st,false,110)==nil and BackstageForeverFlightStep(st,false,121)=='expired' and st.from==nil,'walking away forgets the start')
`));

test("flight times in game: timed from take-off to landing, announced on the next same trip", () => lua(STUBS + String.raw`
local onTaxi=false UnitOnTaxi=function() return onTaxi end
GetServerTime=function() return 1700000000 end
local zone,sub='Durotar','Orgrimmar' GetZoneText=function() return zone end GetSubZoneText=function() return sub end
GetTaxiMapID=function() return 1414 end
local here=1
C_TaxiMap={GetAllTaxiNodes=function(map) assert(map==1414) return {
  {nodeID=25,name='Crossroads, The Barrens',state=here==1 and 0 or 1,slotIndex=1},
  {nodeID=23,name='Orgrimmar, Durotar',state=here==2 and 0 or 1,slotIndex=2},
  {nodeID=77,name='Camp Taurajo, The Barrens',state=2,slotIndex=3}} end}
local hooked TakeTaxiNode=function() end
hooksecurefunc=function(name,fn) assert(name=='TakeTaxiNode') hooked=fn end
`+ FILE + String.raw`
handler(nil,'PLAYER_LOGIN') assert(type(hooked)=='function' and type(BackstageForeverFlightTimesDB.trips)=='table')
local function fly(slot,seconds)
  handler(nil,'TAXIMAP_OPENED') hooked(slot) handler(nil,'TAXIMAP_CLOSED')
  onTaxi=true clock=clock+1 handler(nil,'PLAYER_CONTROL_LOST')
  clock=clock+seconds updater(1) onTaxi=false handler(nil,'PLAYER_CONTROL_GAINED')
end
fly(2,130)
assert(#said==0,'the first flight is only timed')
local trip=BackstageForeverFlightTimesDB.trips[1]
assert(trip.from=='Crossroads, The Barrens' and trip.to=='Orgrimmar, Durotar' and trip.seconds==130 and trip.count==1 and trip.at==1700000000)
assert(BackstageForeverFlightState.from==nil and BackstageForeverFlightState.flying==false)
fly(2,131)
assert(#said==1 and said[1]=='Backstage Forever: About 2m 10s to Orgrimmar, Durotar.',said[1])
assert(trip.count==2 and trip.seconds==131)
BackstageForeverComfortSettings={flights=false} fly(2,131) assert(#said==1 and trip.count==3,'switched off: still timed, not announced')
BackstageForeverComfortSettings=nil
-- Opening the flight map and walking away times nothing.
handler(nil,'TAXIMAP_OPENED') handler(nil,'TAXIMAP_CLOSED') clock=clock+30 updater(1)
assert(BackstageForeverFlightState.from==nil and #BackstageForeverFlightTimesDB.trips==1)
onTaxi=true handler(nil,'PLAYER_CONTROL_LOST') clock=clock+60 onTaxi=false handler(nil,'PLAYER_CONTROL_GAINED')
assert(#BackstageForeverFlightTimesDB.trips==1,'a ride that did not start at a flight map is ignored')
-- Without the click hook the landing place names the trip.
hooksecurefunc=nil here=2
`+ FILE + String.raw`
handler(nil,'PLAYER_LOGIN') handler(nil,'TAXIMAP_OPENED') handler(nil,'TAXIMAP_CLOSED') onTaxi=true clock=clock+1 handler(nil,'PLAYER_CONTROL_LOST')
zone,sub='The Barrens','The Crossroads' clock=clock+125 onTaxi=false handler(nil,'PLAYER_CONTROL_GAINED')
local back=BackstageForeverFlightTimesDB.trips[2]
assert(back and back.from=='Orgrimmar, Durotar' and back.to=='The Crossroads, The Barrens' and back.seconds==125,back and back.to)
local n=#said BackstageForeverFlightTimesCommand()
assert(said[n+1]=='Backstage Forever: Flight times you learned: 2.' and said[n+2]:find('flown 3 times',1,true) and said[n+3]:find('flown once',1,true))
BackstageForeverFlightTimesDB='broken' BackstageForeverFlightTimesCommand() assert(said[#said]:find('No flight times learned yet',1,true),'a damaged saved table starts over')
`));

test("gear wear: damaged slots lowest first, the total, and a warning only under 20%", () => lua(FILE + String.raw`
local wear=BackstageForeverGearWear({{name='Head',cur=60,max=60},{name='Legs',cur=30,max=75},{name='Chest',cur=10,max=100},{name='Feet',cur=0,max=50},{name='Odd',cur=9,max=0},{name='Bad',cur='x',max=5}})
assert(wear.counted==4 and #wear.worn==3 and wear.worn[1].name=='Feet' and wear.worn[1].percent==0 and wear.worn[2].name=='Chest' and wear.worn[3].name=='Legs' and wear.worn[3].percent==40)
assert(wear.lost==65,'185 of 285 points are gone: '..wear.lost)
local lines=BackstageForeverGearWearLines(wear)
assert(lines[1]=='Your gear has lost 65% of its durability. Most worn first:' and lines[2]=='  Feet 0%, Chest 10%, Legs 40%',lines[2])
assert(BackstageForeverGearWearWarning(wear)=='Feet is at 0% durability and 1 more are under 20%. Repair before you head out: /bf repair.')
wear=BackstageForeverGearWear({{name='Head',cur=11,max=60},{name='Legs',cur=74,max=75}})
assert(BackstageForeverGearWearWarning(wear)=='Head is at 18% durability. Repair before you head out: /bf repair.')
wear=BackstageForeverGearWear({{name='Head',cur=12,max=60},{name='Legs',cur=74,max=75}})
assert(wear.worn[1].percent==20 and BackstageForeverGearWearWarning(wear)==nil,'20% is not under 20%')
wear=BackstageForeverGearWear({{name='Head',cur=599,max=600},{name='Legs',cur=600,max=600}})
assert(wear.lost==1 and #wear.worn==1,'a scratch still counts as wear')
assert(BackstageForeverGearWearLines(BackstageForeverGearWear({{name='Head',cur=60,max=60}}))[1]=='All your gear is at full durability.')
assert(BackstageForeverGearWearLines(BackstageForeverGearWear({}))[1]=='Nothing you wear has durability to read.' and BackstageForeverGearWearLines(nil)[1]:find('Nothing you wear',1,true))
assert(BackstageForeverGearWearWarning(nil)==nil and BackstageForeverGearWearWarning(BackstageForeverGearWear({}))==nil)
`));

test("gear wear in game: /bf durability, and one line on walking into a rest area", () => lua(STUBS + String.raw`
local dur={[1]={10,60},[5]={100,100},[7]={30,75},[16]={90,90}}
GetInventoryItemDurability=function(slot) local d=dur[slot] if d then return d[1],d[2] end end
HEADSLOT='Head' LEGSSLOT='Legs'
local resting=false IsResting=function() return resting end
`+ FILE + String.raw`
BackstageForeverDurabilityCommand()
assert(said[1]=='Backstage Forever: Your gear has lost 29% of its durability. Most worn first:' and said[2]=='Backstage Forever:   Head 16%, Legs 40%',said[1]..said[2])
handler(nil,'PLAYER_ENTERING_WORLD')
resting=true handler(nil,'PLAYER_UPDATE_RESTING')
assert(#said==3 and said[3]=='Backstage Forever: Head is at 16% durability. Repair before you head out: /bf repair.',said[3])
handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==3,'staying in the rest area says nothing more')
resting=false handler(nil,'PLAYER_UPDATE_RESTING') resting=true clock=clock+60 handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==3,'not again within five minutes')
resting=false handler(nil,'PLAYER_UPDATE_RESTING') resting=true clock=clock+400 handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==4)
resting=false handler(nil,'PLAYER_UPDATE_RESTING') resting=true clock=clock+400 combat=true handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==4,'quiet in combat')
combat=false resting=false handler(nil,'PLAYER_UPDATE_RESTING') BackstageForeverComfortSettings={durability=false}
resting=true clock=clock+400 handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==4,'switched off')
BackstageForeverComfortSettings=nil dur[1]={50,60} resting=false handler(nil,'PLAYER_UPDATE_RESTING') resting=true clock=clock+400 handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==4,'nothing under 20%')
`+ FILE + String.raw`
said={} resting=true handler(nil,'PLAYER_ENTERING_WORLD') handler(nil,'PLAYER_UPDATE_RESTING') assert(#said==0,'logging in inside a rest area is not entering one')
GetInventoryItemDurability=function() error('gone') end BackstageForeverDurabilityCommand() assert(said[1]:find('Nothing you wear',1,true))
`));

test("exploration: discovered areas are listed and the missing half is said plainly", () => lua(STUBS + FILE + String.raw`
local NOT='This game version does not tell addons which areas are undiscovered.'
local lines=BackstageForeverExploreLines(nil) assert(#lines==1 and lines[1]==NOT)
lines=BackstageForeverExploreLines({}) assert(lines[1]=='No discovered area was found on this map.' and lines[2]==NOT)
lines=BackstageForeverExploreLines({'Razor Hill','Sen\'jin Village','Razor Hill','',5})
assert(lines[1]=='Discovered on this map: 2 named areas.' and lines[2]=='  Razor Hill, Sen\'jin Village' and lines[3]==NOT)
local many={} for i=1,15 do many[i]=('Area %02d'):format(i) end
lines=BackstageForeverExploreLines(many) assert(lines[2]:find('Area 12, +3',1,true) and not lines[2]:find('Area 13',1,true),lines[2])
-- No exploration calls in this client: only the plain sentence.
BackstageForeverExploreCommand() assert(#said==1 and said[1]=='Backstage Forever: '..NOT)
C_Map={GetBestMapForUnit=function() return 1411 end,GetAreaInfo=function(id) return ({[362]='Razor Hill',[367]='Sen\'jin Village'})[id] end}
CreateVector2D=function(x,y) return {x=x,y=y} end
local calls=0
C_MapExplorationInfo={GetExploredAreaIDsAtPosition=function(map,pos) calls=calls+1 assert(map==1411) if pos.x<.3 then return {362} end if pos.y>.8 then return {367,362} end end}
said={} BackstageForeverExploreCommand()
assert(calls==400 and said[1]=='Backstage Forever: Discovered on this map: 2 named areas.' and said[2]=='Backstage Forever:   Razor Hill, Sen\'jin Village' and said[3]:find(NOT,1,true),said[1])
C_MapExplorationInfo.GetExploredAreaIDsAtPosition=function() error('blocked') end
said={} BackstageForeverExploreCommand() assert(said[1]:find('No discovered area',1,true) and said[2]:find(NOT,1,true))
combat=true said={} BackstageForeverExploreCommand() assert(#said==1 and said[1]:find('outside combat',1,true))
`));

test("the helpers are wired in, saved per character, switchable, and never act for the player", () => {
  const src = read("addon/BackstageForever/BackstageForeverComfort.lua");
  for (const banned of ["TakeTaxiNode(", "RepairAllItems", "Logout(", "Quit(", "CancelLogout", "EquipItemByName", "UseContainerItem", "SendChatMessage", "CreateFontString", "CreateTexture"]) assert.ok(!src.includes(banned), banned);
  assert.equal((src.match(/hooksecurefunc,'TakeTaxiNode'/g) || []).length, 1, "the flight click is only read, after the game handled it");
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  // The desktop reads the account-wide saved file and accepts exactly one variable in it, so new
  // saved tables must be per character: those go to another file the desktop never parses.
  assert.match(toc, /^## SavedVariables: BackstageForeverExport\r?$/m);
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverComfortSettings\b.*\bBackstageForeverFlightTimesDB\b/m);
  assert.match(toc, /^BackstageForeverComfort\.lua\r?$/m);
  const { parseSavedVariables } = require("../src/core/game-sync.cjs");
  assert.throws(() => parseSavedVariables('BackstageForeverFlightTimesDB = {\n}\nBackstageForeverExport = "{}"\n'), "a second account-wide variable would stop the desktop reading the capture");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const word of ["rested", "weapons", "durability", "explore", "comfort"]) assert.ok(hud.includes(`word=='${word}'`), word);
  assert.match(hud, /word=='flights' and message:lower\(\):match\('\^flights%s\+times'\)/);
  assert.ok(hud.indexOf("match('^flights%s+times')") < hud.indexOf("word=='train' or word=='repair' or word=='flights'"), "/bf flights times is taken before /bf flights");
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  for (const key of ["rested", "weapons", "flights", "durability"]) assert.ok(options.includes(`on('BackstageForeverComfortSettings','${key}'),'comfort ${key}'`), key);
  const { CATALOG } = require("../src/renderer/commands.js");
  for (const command of ["/bf rested", "/bf weapons", "/bf durability", "/bf flights times", "/bf explore"]) assert.ok(CATALOG.some((c) => c.command === command), command);
});

test("German clients get the comfort lines in German", () => {
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
` + FILE + String.raw`
for _,l in ipairs(BackstageForeverRestedLines(BackstageForeverRestedState(3000,20000,false))) do print(BackstageForeverTr(l)) end
print(BackstageForeverTr(BackstageForeverWeaponSkillLine({name='Streitkolben',rank=12},30)))
print(BackstageForeverTr(BackstageForeverFlightLines({trips={{from='A',to='B',seconds=130,count=3,at=1}}})[2]))
print(BackstageForeverTr(BackstageForeverGearWearWarning(BackstageForeverGearWear({{name='Kopf',cur=1,max=10}}))))
print(BackstageForeverTr(BackstageForeverGearWearLines(BackstageForeverGearWear({{name='Kopf',cur=1,max=10}}))[1]))
print(BackstageForeverTr('Gear wearing out (25%)'))
print(BackstageForeverTr(BackstageForeverExploreLines(nil)[1]))
`).split("\n");
  assert.equal(out[0], "Erholte EP: 3.0 von 30 Balken (15% einer Stufe).");
  assert.equal(out[1], "Voll in etwa 9 Tage in einem Gasthaus oder einer Stadt, etwa 36 Tage anderswo. Richtwert: ein Balken pro 8 Stunden in einem Gasthaus oder einer Stadt.");
  assert.equal(out[2], "Du bist gerade nicht in einem Ruhebereich.");
  assert.equal(out[3], "Streitkolben 12/150: rechne mit Fehlschlägen, bis der Wert steigt.");
  assert.equal(out[4], "A nach B: 2m 10s, 3-mal geflogen.");
  assert.equal(out[5], "Kopf hat 10% Haltbarkeit. Repariere, bevor du losziehst: /bf repair.");
  assert.equal(out[6], "Deine Ausrüstung hat 90% ihrer Haltbarkeit verloren. Am stärksten abgenutzt zuerst:");
  assert.equal(out[7], "Ausrüstung verschleißt (25%)", "the percent sign in an older template works now");
  assert.equal(out[8], "Diese Spielversion verrät Addons nicht, welche Gebiete unentdeckt sind.");
});

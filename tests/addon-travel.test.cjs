"use strict";
// In game: /bf fly PLACE and the /bf train list. The Lua is run for real against small data.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), addon = path.join(root, "addon", "BackstageForever");
const { compile, MAX_BYTES } = require("../scripts/build-addon-travel.cjs");
const T = require("../src/core/transport-data.cjs");
const fx = require("./fixtures/transport.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const transport = T.compileTransport([{ build: fx.build, files: fx.buffers() }], { commit: fx.commit });
const row = (id, name, rank, level, cost, honored, from = "class") => ({ id, name, rank, level, cost, honored, from });
const trainers = { build: fx.build, classes: { Mage: [row(2, "Blink", null, 20, 2100, 1890), row(10, "Teleport: Orgrimmar", null, 20, 2000, null, "portal"), row(11, "Teleport: Stormwind", null, 20, 2000, null, "portal"), row(4, "Ward", "Rank 1", 20, null, null), row(3, "Scorch", "Rank 1", 22, null, 2970), row(5, "Arcane Missiles", "Rank 3", 24, 4000, null), row(1, "Frostbolt", "Rank 2", 0, null, 90)] } };
const DATA = compile(transport, trainers);
const HELPERS = fs.readFileSync(path.join(addon, "BackstageForeverHelpers.lua"), "utf8");
const TRAVEL = fs.readFileSync(path.join(addon, "BackstageForeverTravel.lua"), "utf8");
const STUBS = String.raw`
said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
function BackstageForeverMoney(c) local g,s,k=math.floor(c/10000),math.floor(c/100)%100,c%100 local o={} if g>0 then o[#o+1]=g..'g' end if s>0 then o[#o+1]=s..'s' end if k>0 and g==0 then o[#o+1]=k..'c' end return #o>0 and table.concat(o,' ') or '0c' end
frames={} CreateFrame=function() local f={events={}} f.RegisterEvent=function(self,e) self.events[e]=true end f.SetScript=function(self,k,fn) self[k]=fn end frames[#frames+1]=f return f end
build={'1.60.1','123'} GetBuildInfo=function() return build[1],build[2] end
here={map=1413,x=0.1,y=0.12}
C_Map={GetBestMapForUnit=function() return here.map end,GetPlayerMapPosition=function() if not here.x then return nil end return {GetXY=function() return here.x,here.y end} end,GetMapInfo=function(id) return id==1413 and {name='The Barrens'} or nil end}
UnitFactionGroup=function() return 'Horde' end
`;
const run = (body) => lua(`${STUBS}\n${HELPERS}\n${DATA}\n${TRAVEL}\nlocal D=BackstageForeverTravelData\n${body}\nprint('ok')`);

test("the committed data file is what the bundled packs compile to, small, and attributed", () => {
  const file = fs.readFileSync(path.join(addon, "BackstageForeverTravelData.lua"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(file, compile());
  assert.ok(Buffer.byteLength(file) <= MAX_BYTES, `${Buffer.byteLength(file)} bytes`);
  assert.match(file, /Efficient Games[\s\S]*CC BY 4\.0/);
  assert.match(file, /train=\{Druid=\{/);
  assert.doesNotMatch(DATA, /Frostbolt/, "a skill with no recorded level is not shipped to the game");
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  for (const f of ["BackstageForeverTravelData.lua", "BackstageForeverTravel.lua"]) assert.ok(ADDON_FILES.includes(f), f);
  const toc = fs.readFileSync(path.join(addon, "BackstageForever.toc"), "utf8");
  assert.ok(toc.indexOf("BackstageForeverTravelData.lua") < toc.indexOf("BackstageForeverTravel.lua") && toc.indexOf("BackstageForeverAssist.lua") < toc.indexOf("BackstageForeverTravel.lua"));
});

test("routes: recorded direct flights, the game's own longer route, Dijkstra, and only learned points", () => {
  assert.equal(run(String.raw`
local r=BackstageForeverFlyRoute(D,1,2,nil)
assert(#r.hops==2 and r.seconds==100 and r.cost==100 and r.estimated==0 and not r.worked)
local back=BackstageForeverFlyRoute(D,2,1,nil)
assert(back.estimated==1 and back.cost==100 and back.worked==true and back.seconds==math.max(20,math.floor(((400^2+400^2)^.5)/D.speed+.5)),'missing time estimated from distance: '..back.seconds)
local seen=BackstageForeverFlyRoute(D,1,3,nil)
assert(table.concat(seen.hops,'>')=='1>2>3' and seen.seconds==280 and seen.cost==400 and seen.whole==true,'the whole observed flight wins')
local far=BackstageForeverFlyRoute(D,1,4,nil)
assert(table.concat(far.hops,'>')=='1>2>3>4' and far.unknown==1 and far.cost==450,'dijkstra over single connections')
assert(BackstageForeverFlyRoute(D,3,5,nil).cost==nil,'an unpriced leg leaves the total unknown')
assert(BackstageForeverFlyRoute(D,1,3,{[1]=true,[3]=true})==nil,'cannot fly through a point you have not learned')
assert(BackstageForeverFlyRoute(D,1,1,nil)==nil and BackstageForeverFlyRoute(D,1,99,nil)==nil)
local allowed,assumed=BackstageForeverFlyAllowed(D,{[1]=true,[2]=true,[777]=true},'H')
assert(assumed==false and allowed[1] and allowed[2] and not allowed[3] and not allowed[777])
local guess,isGuess=BackstageForeverFlyAllowed(D,{},'A')
assert(isGuess==true and not guess[1] and guess[4],'the other faction flight masters are left out, linked-only points stay')
`), "ok");
});

test("positions, nearest flight point, names and search", () => {
  assert.equal(run(String.raw`
local wx,wy,i=BackstageForeverFlyWorld(D,1413,0.25,0.75)
assert(wx==250 and wy==750 and i==1) assert(BackstageForeverFlyWorld(D,9999,0.5,0.5)==nil)
local id,yards=BackstageForeverFlyNearest(D,880,900,1,nil) assert(id==1 and math.floor(yards+.5)==20)
assert(BackstageForeverFlyNearest(D,880,900,1,{[3]=true})==3) assert(BackstageForeverFlyNearest(D,880,900,0,nil)==nil)
local zone=function(m) return m==1413 and 'The Barrens' or nil end
assert(BackstageForeverFlyLabel(D,1,{},zone)=='The Barrens (Ann)')
assert(BackstageForeverFlyLabel(D,1,{[1]='Orgrimmar, Durotar'},zone)=='Orgrimmar, Durotar')
assert(BackstageForeverFlyLabel(D,4,{},zone)=='Flight point 4')
local names={[2]='Crossroads, The Barrens',[3]='Camp Taurajo, The Barrens'}
assert(table.concat(BackstageForeverFlyFind(D,'cross',names,zone),',')=='2')
assert(table.concat(BackstageForeverFlyFind(D,'Camp Taurajo',names,zone),',')=='3')
assert(table.concat(BackstageForeverFlyFind(D,'the barrens',names,zone),',')=='1,2,3','a zone name finds every point in it')
assert(table.concat(BackstageForeverFlyFind(D,'ANN',{},zone),',')=='1','flight master names work before any flight map was opened')
assert(#BackstageForeverFlyFind(D,'stormwind',names,zone)==0 and #BackstageForeverFlyFind(D,'  ',names,zone)==0)
assert(BackstageForeverTravelTime(40)=='40 s' and BackstageForeverTravelTime(300)=='5 min' and BackstageForeverTravelTime(305)=='5 min 05 s' and BackstageForeverTravelTime(3725)=='1 h 02 min')
`), "ok");
});

test("/bf fly prints the route from the nearest known flight point: legs, total time and price", () => {
  assert.equal(run(String.raw`
BackstageForeverAssistSettings={flightNodes={[1]=true,[2]=true,[3]=true},flightNames={[3]='Camp Taurajo, The Barrens'}}
local r=BackstageForeverFlyCommand('fly Camp Taurajo')
assert(r and r.seconds==280)
assert(said[1]=='Backstage Forever: Fly from The Barrens (Ann) to Camp Taurajo, The Barrens: 4 min 40 s, 4s.',said[1])
assert(said[2]:find('1. The Barrens (Ann) - The Barrens (Bob): 1 min 40 s, 1s',1,true),said[2])
assert(said[3]:find('2. The Barrens (Bob) - Camp Taurajo, The Barrens: 3 min 20 s, 3s',1,true),said[3])
assert(said[4]:find('one flight',1,true) and #said==4,'no "assumed" line when the learned points are saved')
-- Without a saved list every usable point counts, and the answer says so.
said={} BackstageForeverAssistSettings={}
BackstageForeverFlyCommand('fly cid')
assert(said[#said]:find('This assumes you know these flight points',1,true),said[#said])
-- A short walk to the flight master is mentioned once it is worth mentioning.
said={} here.x=0.2 here.y=0.2 BackstageForeverFlyCommand('fly bob')
assert(said[2]:find('First go to the flight master at The Barrens (Ann): about 141 yards',1,true),said[2])
-- Honest answers when it cannot help.
said={} here.x=0.1 here.y=0.12 BackstageForeverFlyCommand('fly') assert(said[1]:find('Type /bf fly and a place',1,true))
said={} BackstageForeverFlyCommand('fly Stormwind') assert(said[1]:find('No flight point matches "Stormwind"',1,true) and said[1]:find('learns the real flight point names',1,true),said[1])
said={} BackstageForeverFlyCommand('fly ann') assert(said[1]:find('You are already at the flight point The Barrens (Ann)',1,true),said[1])
said={} BackstageForeverAssistSettings={flightNodes={[1]=true,[2]=true}} BackstageForeverFlyCommand('fly cid') assert(said[1]:find('You have not learned the flight point The Barrens (Cid)',1,true),said[1])
said={} here.x=nil BackstageForeverFlyCommand('fly cid') assert(said[1]:find('Your position is not known here',1,true),said[1])
-- Same-patch rule: another build of the patch is fine, another patch is refused.
said={} here.x=0.1 build={'1.60.2','123'} assert(BackstageForeverFlyCommand('fly cid')==nil and said[1]:find('another game patch',1,true),said[1])
assert(BackstageForeverTrainList()==nil,'trainer costs are refused on another patch too')
`), "ok");
});

test("/bf train lists what is new at your level with prices and the total", () => {
  assert.equal(run(String.raw`
local known={}
local r=BackstageForeverTrainNew(D,'Mage',20,function(id) return known[id] end,'H')
assert(#r.rows==3 and r.total==4100 and r.unpriced==1,'Blink, the Horde teleport and the unpriced Ward: '..#r.rows..' '..r.total)
assert(r.rows[2].name=='Teleport: Orgrimmar' and r.rows[2].kind=='p')
assert(r.nextLevel==22 and r.nextCount==1 and r.nextTotal==3300,'the Honored-only price is worked out to the full price')
assert(#BackstageForeverTrainNew(D,'Mage',20,nil,'A').rows==3 and BackstageForeverTrainNew(D,'Mage',20,nil,'A').rows[2].name=='Teleport: Stormwind')
known[2]=true
assert(#BackstageForeverTrainNew(D,'Mage',20,function(id) return known[id] end,'H').rows==2,'a skill you already know is not new')
local odd=BackstageForeverTrainNew(D,'Mage',21,nil,'H') assert(#odd.rows==0 and odd.nextLevel==22)
assert(BackstageForeverTrainNew(D,'Mage',60,nil,'H').nextLevel==nil and BackstageForeverTrainNew(D,'Bard',20)==nil)
local lines=BackstageForeverTrainLines(r,'Mage',20,5000)
assert(lines[1]=='New at your trainer at level 20 (3):',lines[1])
assert(lines[2]=='  Blink: 21s' and lines[3]=='  Teleport: Orgrimmar [portal trainer]: 20s' and lines[4]=='  Ward (Rank 1): price not recorded',lines[4])
assert(lines[5]=='Total: 41s + 1 without a recorded price. You have 50s.',lines[5])
assert(lines[6]=='Next new skills at level 22: 1 skills, 33s.',lines[6])
assert(BackstageForeverTrainLines(odd,'Mage',21)[1]=='Nothing new is recorded at your trainer for level 21.')
assert(BackstageForeverTrainLines(nil,'Bard',20)[1]:find('No trainer costs are recorded',1,true))
for _,l in ipairs(lines) do assert(not l:lower():find('skip',1,true),'facts only') end
UnitClass=function() return 'Magier','MAGE' end UnitLevel=function() return 20 end IsSpellKnown=function(id) return id==2 end GetMoney=function() return 12345 end
said={} local shown=BackstageForeverTrainList()
assert(#shown.rows==2 and said[1]=='Backstage Forever: New at your trainer at level 20 (2):' and said[4]:find('You have 1g 23s',1,true),said[4])
`), "ok");
});

test("the saved travel block carries flight points with names, the Hearthstone's place and when it is ready", () => {
  const P = require("../src/core/travel-planner.cjs");
  const out = run(String.raw`
BackstageForeverAssistSettings={flightNodes={[2]=true},flightNames={[2]='Crossroads, The Barrens',[1]='Orgrimmar, Durotar'}}
time=function() return 1700000000 end GetTime=function() return 500 end
GetBindLocation=function() return 'The Crossroads' end
GetItemCooldown=function(id) assert(id==6948) return 400,3600,1 end
local s=BackstageForeverTravelSnapshot()
assert(s.seenAt==1700000000 and #s.nodes==2 and s.nodes[1].id==1 and s.nodes[1].known==false and s.nodes[2].known==true and s.nodes[2].name=='Crossroads, The Barrens')
assert(s.bind.name=='The Crossroads' and s.bind.mapId==nil,'the inn spot is unknown until the stone is set with the addon running')
assert(s.hearthReadyAt==1700000000+3500)
-- Setting the Hearthstone remembers where the player stood.
here.x=0.51234 here.y=0.3 for _,f in ipairs(frames) do if f.events.HEARTHSTONE_BOUND then f.OnEvent(f,'HEARTHSTONE_BOUND') end end
s=BackstageForeverTravelSnapshot()
assert(s.bind.mapId==1413 and s.bind.x==0.5123 and s.bind.y==0.3)
GetBindLocation=function() return 'Orgrimmar' end
assert(BackstageForeverTravelSnapshot().bind.mapId==nil,'a remembered spot belongs to the inn it was recorded at')
GetItemCooldown=function() return 0,0,1 end assert(BackstageForeverTravelSnapshot().hearthReadyAt==1700000000)
GetItemCooldown=nil assert(BackstageForeverTravelSnapshot().hearthReadyAt==nil)
io.write(('%d %s %d %.4f|'):format(#s.nodes,s.bind.name,s.bind.mapId,s.bind.x))
`);
  assert.equal(out, "2 The Crossroads 1413 0.5123|ok");
  // The shape the Lua writes is the shape the desktop accepts.
  assert.doesNotThrow(() => P.normalizeTravelCapture({ seenAt: 1700000000, nodes: [{ id: 1, name: "Orgrimmar, Durotar", known: false }, { id: 2, name: "Crossroads, The Barrens", known: true }], bind: { name: "The Crossroads", mapId: 1413, x: 0.5123, y: 0.3 }, hearthReadyAt: 1700003500 }));
  const main = fs.readFileSync(path.join(addon, "BackstageForever.lua"), "utf8");
  assert.match(main, /BackstageForeverTravelSnapshot\)\s*\n\s*if ok and type\(travel\)=='table' and type\(travel\.nodes\)=='table' then array\(travel\.nodes\);character\.travel=travel end/);
});

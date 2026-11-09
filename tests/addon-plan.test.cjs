"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const prelude = String.raw`
dofile('addon/BackstageForever/BackstageForeverReference.lua')
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local function q(id,complete,title)
 return {id=id,title=title or (BackstageForeverReference.quests[id] or {}).title or ('Synthetic '..id),complete=complete==true,objectives={}}
end
local function player(quests)
 return {id='Synthetic-Character',clientBuild='1.60.1.70862',locale='enUS',location={mapId=1413,x=0.35,y=0.28},quests=quests}
end
local function plan(c,o) return BackstageForeverBuildPlan(c,o or {minutes=60}) end
`;
function runLua(scenario) {
  assert.ok(fs.existsSync(path.join(root, "addon/BackstageForever/BackstageForeverPlan.lua")), "Pure native quest planner must exist");
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: prelude + scenario + "\nprint('ok')", encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.trim(), "ok");
}

test("balanced plan prioritizes ready quests then actual unfinished objectives with stable IDs and a three-card cap", () => runLua(String.raw`
local a,b,c,d=q(900003),q(1061,true),q(900001),q(900002)
a.objectives={{text='Done text',done=true},{text='Current observed target: 1/4',done=false}}
c.objectives={{text='Collect current items',done=false}}
local p=plan(player({a,d,c,b}))
assert(p.status=='ready' and #p.steps==3)
assert(p.steps[1].questId==1061 and p.steps[1].phase=='t')
assert(p.steps[2].questId==900001 and p.steps[3].questId==900003)
assert(p.steps[3].detail:find('Current observed target: 1/4',1,true))
assert(p.steps[3].source=='game' and p.counts.quests==4 and p.counts.ready==1 and p.counts.unfinished==3)
local shuffled=plan(player({c,b,d,a}))
for i=1,3 do assert(p.steps[i].questId==shuffled.steps[i].questId) end
`));

test("game marker and title remain authoritative for unknown, English-conflicting and different-build references", () => runLua(String.raw`
for _,mode in ipairs({'missing','conflict','build'}) do
 local a=q(mode=='missing' and 900001 or 1061,true,'Current game title')
 a.destination={mapId=1500,x=0.2,y=0.3,text='Game-reported marker'}
 local c=player({a});if mode=='build' then c.clientBuild='1.60.2.99999' end
 local s=plan(c).steps[1]
 assert(s.title=='Current game title' and s.source=='game')
 assert(s.destination.mapId==1500 and s.destination.x==0.2 and s.destination.text=='Game-reported marker')
 assert(s.command=='/bf guide '..a.id..' t 1500 0.2000 0.3000 '..c.clientBuild)
end
`));

test("exact reference turn-ins retain approximate relationship details and never claim mentioned NPCs are finishers", () => runLua(String.raw`
local s=plan(player({q(1061,true)})).steps[1]
assert(s.source=='reference' and s.destination.mapId==1413 and s.destination.x==0.3528 and s.destination.y==0.2786)
assert(s.detail:find('Approximate',1,true) and s.detail:find('observed turn-in NPC',1,true) and s.detail:find('Seereth Stonebreak',1,true))
assert(s.command=='/bf guide 1061 t 1413 0.3528 0.2786 1.60.1.70862')
local m=plan(player({q(98024,true)})).steps[1]
assert(m.destination==nil and m.command==nil and not m.detail:find('Thork',1,true))
local o=plan(player({q(98024)})).steps[1]
assert(o.source=='reference' and o.detail:find('mentioned in objective',1,true) and o.detail:find('Approximate',1,true))
assert(not o.detail:find('turn-in NPC',1,true) and not o.detail:find('quest giver',1,true))
`));

test("reference objective points require matching current unfinished objective index, type and required count", () => runLua(String.raw`
BackstageForeverReference.quests[900001]={title='Synthetic 900001',objectives={{index=2,type='monster',required=4,destination={mapId=1413,x=0.1,y=0.2,approximate=true,evidence='observed-objective-gain'}}}}
local a=q(900001);a.objectives={{text='Finished',done=true},{text='Current kills',done=false,type='monster',required=4}}
local s=plan(player({a})).steps[1]
assert(s.source=='reference' and s.destination.x==0.1 and s.detail:find('Current kills',1,true))
for _,change in ipairs({'done','type','required','index'}) do
 local o=a.objectives[2]
 o.done=false;o.type='monster';o.required=4
 if change=='done' then o.done=true elseif change=='type' then o.type='item' elseif change=='required' then o.required=5 else a.objectives[2]=nil end
 assert(plan(player({a})).steps[1].destination==nil,'Mismatched '..change..' must not use reference location')
end
`));

test("English title conflicts, unknown build, ID and locale cannot authorize reference directions", () => runLua(String.raw`
for _,mode in ipairs({'title','build','unknown-build','id','locale','english-locale'}) do
 local a=q(1061,true);local c=player({a})
 if mode=='title' then a.title='Hotfixed game title' elseif mode=='build' then c.clientBuild='1.60.2.99999' elseif mode=='unknown-build' then c.clientBuild=nil
 elseif mode=='id' then a.id=900001 elseif mode=='locale' then c.locale=nil;a.title='Different title' elseif mode=='english-locale' then c.locale='enGB';a.title='Different title' end
 local s=plan(c).steps[1];assert(s.destination==nil and s.command==nil,mode)
end
`));

test("localized current titles remain primary and qualify English reference aliases", () => runLua(String.raw`
local a=q(1061,true,'Die Geister von Steinkrallengebirge');local c=player({a});c.locale='deDE'
local s=plan(c).steps[1]
assert(s.title==a.title and s.source=='reference' and s.destination.x==0.3528)
assert(s.detail:find('English reference: The Spirits of Stonetalon',1,true))
`));

test("nearby compares only same-map coordinates and turn-ins focus excludes unfinished quests", () => runLua(String.raw`
local a,b,c=q(900003),q(900002),q(900001,true)
a.destination={mapId=9999,x=0.35,y=0.28};b.destination={mapId=1413,x=0.9,y=0.9};c.destination={mapId=1413,x=0.36,y=0.28}
local p=plan(player({a,b,c}),{focus='nearby',minutes=60})
assert(p.steps[1].questId==900001 and p.steps[2].questId==900002 and p.steps[3].questId==900003)
local t=plan(player({a,b,c}),{focus='turn-ins',minutes=60})
assert(#t.steps==1 and t.steps[1].phase=='t' and t.counts.quests==3)
local noPosition=player({a,b,c});noPosition.location.x=nil
local np=plan(noPosition,{focus='nearby',minutes=60})
assert(np.steps[1].questId==900001,'Missing player position must not invent a distance')
`));

test("session minutes set bounded card preference without invented completion or travel durations", () => runLua(String.raw`
local c=player({q(900003),q(900002),q(900001),q(900004)})
for minutes,cap in pairs({[15]=1,[30]=2,[60]=3}) do
 local p=plan(c,{minutes=minutes});assert(#p.steps==cap)
 for _,s in ipairs(p.steps) do assert(not s.detail:find('minutes',1,true)) end
end
assert(#plan(c,{minutes=999,focus='injected'}).steps==2)
`));

test("unknown objectives yield an honest bounded check-quest step and empty/unavailable states", () => runLua(String.raw`
local p=plan(player({q(900001)}));local s=p.steps[1]
assert(s.source=='none' and s.detail:find('Check your quest log',1,true) and s.destination==nil and s.command==nil)
assert(plan(player({})).status=='empty')
assert(plan(nil).status=='unavailable' and plan({}).status=='unavailable')
assert(plan(player({q(900001,true)})).steps[1].detail:find('turn-in location',1,true),'Unknown finisher type must not imply an NPC')
local c=player({q(900001)});c.quests[1].objectives='unavailable'
assert(plan(c).steps[1].detail:find('Check your quest log',1,true))
`));

test("malformed coordinates, metatables, huge arrays and invalid quest/reference fields fail closed without actions", () => runLua(String.raw`
local a=q(1061,true)
for _,d in ipairs({false,{mapId=0,x=0,y=0},{mapId=1413,x=0/0,y=0},{mapId=1413,x=math.huge,y=0},{mapId=1413,x=-0.1,y=0},{mapId=1413,x=0,y=1.1},{mapId='1413',x=0,y=0},{mapId=1413,x=0,y=0,text='bad\ntext'}}) do
 a.destination=d;local s=plan(player({a})).steps[1];assert(s.destination==nil and s.command==nil)
end
local touched=false
local evil=setmetatable({},{__index=function() touched=true;error('No metatable execution') end,__len=function() touched=true;error('No lengths') end})
assert(plan(evil).status=='unavailable' and not touched)
local c=player({evil,q(900001),q(900001),{id=2,title=3,complete=true}})
local p=plan(c,evil);assert(#p.steps==1 and p.counts.invalid==3 and not touched)
local qs={};for i=1,10000 do qs[i]=q(900000+i) end
p=plan(player(qs));assert(p.counts.quests==25 and p.counts.limited==true and #p.steps<=3)
BackstageForeverReference.quests[1061].turnIn={mapId=1413,x=0.2,y=0.3,approximate=true,evidence='mentioned-in-objective',name='Thork'}
assert(plan(player({q(1061,true)})).steps[1].destination==nil)
BackstageForeverReference={build='1.60.1.70862',locale='enUS',quests=evil}
assert(plan(player({q(1061,true,'Actual title')})).steps[1].destination==nil and not touched)
`));

test("planner has no API dependencies, never acts, and does not mutate player or reference inputs", () => runLua(String.raw`
local function forbidden() error('Planner attempted an API or game action') end
CreateFrame=forbidden;C_Map=setmetatable({},{__index=forbidden});GetBuildInfo=forbidden;InCombatLockdown=forbidden;BackstageForeverGuide=forbidden
local a=q(1061,true);local c=player({a});local r=BackstageForeverReference.quests[1061].turnIn
local p=plan(c)
assert(c.quests[1]==a and a.destination==nil and a.title=='The Spirits of Stonetalon')
p.steps[1].destination.x=0
assert(r.x==0.3528,'Plan must not return mutable reference tables')
BackstageForeverReference=nil
assert(plan(c).steps[1].destination==nil)
`));

test("current monster/item objectives cannot be redirected to a delivery-style NPC mention", () => runLua(String.raw`
for _,kind in ipairs({'monster','item','gameObject'}) do
 local a=q(98024);a.objectives={{text='Current objective from the game',done=false,type=kind,required=4}}
 local s=plan(player({a})).steps[1]
 assert(s.destination==nil and s.command==nil and s.source=='game','Current '..kind..' objective cannot inherit a delivery mention')
end
`));

test("rounded destination preview equals the numeric command and malformed builds never emit command text", () => runLua(String.raw`
local a=q(900001);a.destination={mapId=2147483647,x=0.1234567,y=0.9999999}
local c=player({a});local s=plan(c).steps[1]
assert(s.destination.x==0.1235 and s.destination.y==1,'Preview must describe the command precision')
assert(s.command=='/bf guide 900001 o 2147483647 0.1235 1.0000 1.60.1.70862')
for _,b in ipairs({'bad','1.2.3.4; injected','1.2.3.4\n','1234.2.3.4','1.2.3.123456789'}) do
 c.clientBuild=b;s=plan(c).steps[1];assert(s.command==nil and s.source=='game' and s.destination)
end
`));

test("nearby headline does not invent proximity when no same-map position is known", () => runLua(String.raw`
local a=q(900001);a.destination={mapId=9999,x=0.2,y=0.2}
local c=player({a});local p=plan(c,{focus='nearby',minutes=60})
assert(p.headline=='Your next quest steps')
c.location={mapId=9999,x=0.4,y=0.5};p=plan(c,{focus='nearby',minutes=60})
assert(p.headline=='Quest steps near your current map position')
`));

test("observed object finishers are labelled as objects rather than invented NPCs", () => runLua(String.raw`
local s=plan(player({q(438,true)})).steps[1]
assert(s.source=='reference' and s.detail:find('observed turn-in object',1,true))
assert(not s.detail:find('turn-in NPC',1,true))
`));

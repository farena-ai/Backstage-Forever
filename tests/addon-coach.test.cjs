"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const prelude = String.raw`
issecretvalue=function(v)return type(v)=='table' and rawget(v,'secret')==true end
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
dofile('addon/BackstageForever/BackstageForeverCoach.lua')
local function col(items)return {observedAt=100,complete=true,items=items}end
local c={id='PRIVATE_SOURCE_ID',name='Synthetic',updatedAt=100,clientBuild='1.60.1.70862',location={zone='Forest'},quests={{id=42,title='Distant',complete=false,objectives={{text='Find things',done=false}}}},readiness={bags={free=1,total=16},workshop={professions=col({{skillLineId=171,professionId=4,name='Alchemy',rank=75,maxRank=75}}),recipes=col({{id=100,skillLineId=171,name='Potion',canSkillUp=true,reagentsKnown=true,reagents={{itemId=200,required=2}}}}),materials=col({{itemId=200,count=3}})}}}
c.readiness.workshop.materials.scope='bags-0-4'
local function coach(mode)return BackstageForeverBuildCoach(c,{mode=mode or 'adventure'})end
`;
function lua(s) {
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        "../addon/BackstageForever/BackstageForeverCoach.lua",
      ),
    ),
    "Native coach is not implemented",
  );
  const r = spawnSync(
    process.execPath,
    [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"],
    {
      cwd: path.join(__dirname, ".."),
      input: prelude + s,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
}
test("native policies rank bags, ready/local quests, crafts and modes", () =>
  lua(
    `assert(coach().recommendation.kind=='bags');c.readiness.bags.free=5;assert(coach().recommendation.kind=='craft-ready');assert(coach('questing').recommendation.kind=='quest');c.quests[1].complete=true;assert(coach().recommendation.kind=='quest');assert(coach('professions').recommendation.kind=='craft-ready');c.quests[1].complete=false;c.quests[1].zone='Forest';assert(coach().recommendation.kind=='quest')`,
  ));
test("native unknown partial stale and non-skill-up observations never claim ready", () =>
  lua(
    `c.readiness.bags.free=5;local w=c.readiness.workshop;for _,change in ipairs({'unknown','partial','old','noskill','missingskill','secret','ambiguous'})do local m=w.materials;local r=w.recipes.items[1];w.materials=m;m.complete=true;m.observedAt=100;r.canSkillUp=true;w.recipes.complete=true;r.reagentsKnown=true;r.reagents={{itemId=200,required=2}};if change=='unknown' then w.materials=nil elseif change=='partial' then m.complete=false elseif change=='old' then m.observedAt=99 elseif change=='noskill' then r.canSkillUp=false elseif change=='missingskill' then r.canSkillUp=nil elseif change=='secret' then r.reagents[1].required={secret=true} else r.reagentsKnown=false end;local b=coach('professions');assert(b.recommendation.kind~='craft-ready',change);for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready',change)end;w.materials=m end`,
  ));
test("native detached bounded signatures ignore time/XP and preserve cap qualifications", () =>
  lua(
    `c.readiness.bags.free=5;local b=coach('professions');assert(#b.alternatives<=2 and b.recommendation.detail:find('not guaranteed',1,true));local sig=b.recommendation.signature;b.recommendation.title='changed';assert(c.readiness.workshop.recipes.items[1].name=='Potion');c.updatedAt=101;c.progress={current=999,max=1000};assert(coach('professions').recommendation.signature==sig);c.readiness.workshop.materials.items[1].count=4;assert(coach('professions').recommendation.signature~=sig);c.readiness.workshop.recipes=nil;assert(coach('professions').recommendation.kind=='profession-cap')`,
  ));

function hud(s) {
  const raw = fs
    .readFileSync(path.join(__dirname, "addon-live.test.cjs"), "utf8")
    .match(/const hud=String.raw`([\s\S]*?)`;/)[1];
  const source = raw.replace(
    /local options[\s\S]*?(?=dofile\('addon\/BackstageForever\/BackstageForeverHUD.lua'\))/,
    "dofile('addon/BackstageForever/BackstageForeverCoach.lua')\ncharacter.updatedAt=100;character.clientBuild='1.60.1.70862';character.quests={{id=42,title='Observe',complete=false,objectives={{text='Trees',done=false,fulfilled=1,required=4}},destination={mapId=1413,x=.1,y=.2}}}\n",
  );
  const r = spawnSync(
    process.execPath,
    [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"],
    {
      cwd: path.join(__dirname, ".."),
      input: source + s,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
}
test("native quiet dismissal is signature scoped, ignores timestamps/XP and resurfaces changed objectives", () =>
  hud(
    `local b=frames.BackstageForeverCompassNotNow;assert(b and b.enabled,'Not now control missing');local old=b.OnClick;b.OnClick();assert(not character.quests[1].complete);assert(text():find('Quiet for now',1,true));character.updatedAt=101;character.progress={current=22,max=100};BackstageForeverHUDUpdate(character);assert(text():find('Quiet for now',1,true));character.quests[1].objectives[1].fulfilled=2;BackstageForeverHUDUpdate(character);assert(b.enabled);old();assert(b.enabled,'Retired dismissal suppressed changed work');b.OnClick();assert(not b.enabled)`,
  ));
test("native mode persists and bag/recipe advice cannot arm a quest waypoint; capture and combat retire callbacks", () =>
  hud(
    `local waypoint=frames.BackstageForeverCompassWaypoint;assert(waypoint.enabled);local click=waypoint.OnClick;BackstageForeverHUDCaptureStatus('unavailable');click();assert(#guideCalls==0 and not waypoint.enabled);BackstageForeverHUDUpdate(character);click=waypoint.OnClick;fighting=true;event('PLAYER_REGEN_DISABLED');fighting=false;click();assert(#guideCalls==0);event('PLAYER_REGEN_ENABLED');local goal=frames.BackstageForeverCompassGoal;assert(goal);goal.OnClick();assert(BackstageForeverHUDSettings.mode=='questing');goal.OnClick();assert(BackstageForeverHUDSettings.mode=='professions');character.readiness={bags={free=1,total=16}};BackstageForeverHUDUpdate(character);assert(not waypoint.enabled);local dismiss=frames.BackstageForeverCompassNotNow.OnClick;event('PLAYER_LOGOUT');dismiss();event('PLAYER_LOGIN');BackstageForeverHUDUpdate(character);assert(frames.BackstageForeverCompassNotNow.enabled)`,
  ));

test("native newer profession observation retires dated skill-up eligibility", () =>
  lua(
    `c.readiness.bags.free=5;c.updatedAt=101;c.readiness.workshop.professions.observedAt=101;local b=coach('professions');assert(b.recommendation.kind~='craft-ready');for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready')end`,
  ));

test("native optional quest details preserve working focus/card controls and explicit waypoint ownership", () =>
  hud(
    `local details=frames.BackstageForeverCompassDetails;assert(details,'Quest details toggle missing');assert(not frames.BackstageForeverCompassFocus.visible);details.OnClick();assert(frames.BackstageForeverCompassFocus.visible and frames.BackstageForeverCompassSession.visible);assert(text():find('Quest details',1,true));frames.BackstageForeverCompassFocus.OnClick();assert(BackstageForeverHUDSettings.focus=='nearby');frames.BackstageForeverCompassSession.OnClick();assert(BackstageForeverHUDSettings.minutes==60);local old=frames.BackstageForeverCompassWaypoint.OnClick;details.OnClick();assert(not frames.BackstageForeverCompassFocus.visible);if old then old()end;assert(#guideCalls==0);frames.BackstageForeverCompassCollapse.OnClick();assert(not details.visible)`,
  ));

test("native local unknown-objective checks do not displace an established craft attempt", () =>
  lua(
    `c.readiness.bags.free=5;c.quests[1].zone='Forest';c.quests[1].objectives={};assert(coach().recommendation.kind=='craft-ready')`,
  ));
test("native quiet dismissal retains only twenty identities and resets for a new character", () =>
  hud(
    `local dismiss=frames.BackstageForeverCompassNotNow;for i=1,21 do character.quests[1].id=i;BackstageForeverHUDUpdate(character);assert(dismiss.enabled);dismiss.OnClick();assert(not dismiss.enabled)end;character.quests[1].id=1;BackstageForeverHUDUpdate(character);assert(dismiss.enabled,'Oldest dismissal must retire at twenty entries');dismiss.OnClick();local old=dismiss.OnClick;local next={id='B',name='New',level=12,className='Mage',clientBuild=character.clientBuild,quests=character.quests};BackstageForeverHUDUpdate(next);assert(dismiss.enabled,'Character switch must forget dismissal');if old then old()end;assert(dismiss.enabled)`,
  ));

test("capture failure cannot carry one character's dismissal into the next character", () =>
  hud(
    `frames.BackstageForeverCompassNotNow.OnClick();BackstageForeverHUDCaptureStatus('unavailable');local next={id='B',name='New',level=12,className='Mage',clientBuild=character.clientBuild,quests=character.quests};BackstageForeverHUDUpdate(next);assert(frames.BackstageForeverCompassNotNow.enabled,'Retain owner identity across failed captures so a new character clears old dismissals')`,
  ));

test("native partial known recipe catalog permits a valid observed skill-up recipe but never a missing entry", () =>
  lua(
    `c.readiness.bags.free=5;c.readiness.workshop.recipes.complete=false;assert(coach('professions').recommendation.kind=='craft-ready');c.readiness.workshop.recipes.items={};local b=coach('professions');assert(b.recommendation.kind~='craft-ready');for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready')end`,
  ));

test("native protected reagent rows cannot terminate a readable prefix or hide outside the cap", () =>
  lua(`
c.readiness.bags.free=5
local r=c.readiness.workshop.recipes.items[1]
local function noCraft(label)
 local b=coach('professions');assert(not b.recommendation or b.recommendation.kind~='craft-ready',label)
 for _,v in ipairs(b.alternatives)do assert(v.kind~='craft-ready',label)end
end
for _,slot in ipairs({1,2,11})do
 r.reagents={{itemId=200,required=2}};r.reagents[slot]={secret=true}
 noCraft('Protected reagent slot '..slot)
end
r.reagents={secret=true};noCraft('Protected entire reagent sequence')
r.reagents={{itemId=200,required=2},{unreadable=true}}
issecretvalue=function(v)if type(v)=='table' and rawget(v,'unreadable') then error('Unreadable public value')end;return type(v)=='table' and rawget(v,'secret')==true end
noCraft('Guard failure for entire reagent row')
`));

test("native dense bounded sequences reject holes, unknown rows and non-array keys", () =>
  lua(`
c.readiness.bags.free=5
local r=c.readiness.workshop.recipes.items[1]
local shapes={
 {[1]={itemId=200,required=2},[3]={itemId=201,required=1}},
 {{itemId=200,required=2},false},
 {{itemId=200,required=2},{}},
 {[1]={itemId=200,required=2},extra={itemId=201,required=1}},
 {[1]={itemId=200,required=2},[1000]={itemId=201,required=1}}
}
shapes[#shapes+1]=setmetatable({{itemId=200,required=2}},{__index=function()error('Do not resolve virtual reagent rows')end,__len=function()error('Do not trust virtual sequence length')end})
local protectedKey=setmetatable({secret=true},{__tostring=function()error('Do not coerce protected key')end,__eq=function()error('Do not compare protected key')end})
shapes[#shapes+1]={[1]={itemId=200,required=2},[protectedKey]={itemId=201,required=1}}
for i,v in ipairs(shapes)do r.reagents=v;local b=coach('professions');assert(not b.recommendation or b.recommendation.kind~='craft-ready','Malformed reagent sequence '..i);for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready','Malformed reagent sequence '..i)end end
`));

test("native unreadable or sparse workshop sequences cannot assert readiness from a prefix", () =>
  lua(`
c.readiness.bags.free=5
local w=c.readiness.workshop
for _,key in ipairs({'materials','professions','recipes'})do
 local original=w[key].items
 for _,slot in ipairs({2,1000})do
  w[key].items={[1]=original[1],[slot]={secret=true}}
  local b=coach('professions');assert(not b.recommendation or b.recommendation.kind~='craft-ready',key..' protected row');for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready',key)end
 end
 w[key].items={[1]=original[1],[3]=original[1]}
 local b=coach('professions');assert(not b.recommendation or b.recommendation.kind~='craft-ready',key..' hole');for _,a in ipairs(b.alternatives)do assert(a.kind~='craft-ready',key)end
 w[key].items=original
end
w.recipes.complete=false;assert(coach('professions').recommendation.kind=='craft-ready','Valid partial catalog remains useful')
`));

test("native blank objective prose requires a valid game marker for local priority", () =>
  lua(`
c.readiness.bags.free=5;c.location.mapId=1413;local q=c.quests[1];q.zone='Forest'
for _,prose in ipairs({'','   ','  '..string.char(194,160)..'  '})do
 q.complete=false;q.objectives={{text=prose,done=false}};q.destination=nil
 assert(coach().recommendation.kind=='craft-ready','Blank prose cannot establish local work')
 q.destination={mapId=1413,x=.2,y=.3};assert(coach().recommendation.kind=='quest','Valid current marker remains actionable')
 q.destination=nil;q.complete=true;assert(coach().recommendation.kind=='quest','Ready turn-in remains first')
end
q.complete=false;q.objectives={{text='Find the scout',done=false}};assert(coach().recommendation.kind=='quest')
`));

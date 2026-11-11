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
dofile('addon/BackstageForever/BackstageForeverAcquisition.lua')
dofile('addon/BackstageForever/BackstageForeverProfession.lua')
local function col(items)return {observedAt=100,complete=true,items=items}end
local c={id='PRIVATE_SOURCE_ID',name='Synthetic',updatedAt=100,clientBuild='1.60.1.70862',faction='Horde',quests={},readiness={workshop={professions=col({{skillLineId=171,professionId=4,name='Alchemy',rank=20,maxRank=75}}),recipes=col({{id=100,skillLineId=171,name='Tonic',canSkillUp=true,reagentsKnown=true,reagents={{itemId=765,name='Silverleaf',required=2}}},{id=101,skillLineId=171,name='Other',canSkillUp=true,reagentsKnown=true,reagents={{itemId=2447,required=20}}}}),materials=col({{itemId=765,count=3}})}}}
c.readiness.workshop.materials.scope='bags-0-4';c.readiness.workshop.recipes.complete=false
local w=c.readiness.workshop
local function build(o)return BackstageForeverBuildProfessionCoach(c,o or {})end
`;
function lua(s) {
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        "../addon/BackstageForever/BackstageForeverProfession.lua",
      ),
    ),
    "Native profession model missing",
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
test("native automatic partial-catalog supply ranking and exact attempts feed materials-needed Compass without quest command", () =>
  lua(
    `local m=build();assert(m.selection.automatic and m.selection.recipeId==100);assert(m.recommendation.kind=='craft-ready');m=build({crafts=5});assert(m.shoppingRows[1].missing==7 and m.recommendation.kind=='materials-needed');local b=BackstageForeverBuildCoach(c,{mode='professions',crafts=5});assert(b.recommendation.kind=='materials-needed');assert(not b.recommendation.questStep and not b.recommendation.command)`,
  ));
test("native exact/partial/unknown, manual, stale and cap semantics", () =>
  lua(
    `w.materials.complete=false;local m=build({recipeId=101});assert(m.shoppingRows[1].have==nil and m.shoppingRows[1].missing==nil);w.materials.complete=true;w.materials.observedAt=99;assert(build().recommendation.kind~='craft-ready');w.materials.observedAt=100;w.recipes.items[1].canSkillUp=false;assert(build({recipeId=100}).recommendation.kind=='craft-plan');assert(build({recipeId=999}).selectedRecipe==nil);w.recipes.observedAt=99;assert(build().selectedRecipe==nil);w.professions.items[1].rank=75;assert(build().recommendation.kind=='profession-cap')`,
  ));
test("native dense/protected/ambiguous sequences never create ready or material facts", () =>
  lua(
    `local original=w.recipes.items[1].reagents;for _,bad in ipairs({{original[1],[3]={itemId=2447,required=1}},{original[1],{secret=true}},setmetatable({original[1]},{__index=function()error('virtual list evaluated')end}),{original[1],extra={itemId=2447,required=1}}})do w.recipes.items[1].reagents=bad;local m=build({recipeId=100});assert(not m.planning.checklistAvailable)end;w.recipes.items[1].reagents=original;for _,key in ipairs({'professions','recipes','materials'})do local old=w[key].items;w[key].items={old[1],{secret=true}};assert(build().recommendation.kind~='craft-ready');w[key].items=old end`,
  ));
test("native acquisition uses actual epoch/public build/faction, detached unknowns and context", () =>
  lua(
    `local m=build();local a=m.shoppingRows[1].acquisition;assert(a.status=='qualified-historical');assert(a.sources[1].requiredRank==nil and a.sources[1].availableNow==nil);a.sources[1].positions[1].x=1;assert(build().shoppingRows[1].acquisition.sources[1].positions[1].x~=1);c.clientBuild='1.60.1.70888';assert(build().shoppingRows[1].acquisition.status=='browse-only');BackstageForeverAcquisition=nil;assert(build().planning.checklistAvailable)`,
  ));

function hud(s) {
  const raw = fs
    .readFileSync(path.join(__dirname, "addon-live.test.cjs"), "utf8")
    .match(/const hud=String.raw`([\s\S]*?)`;/)[1];
  const source = raw.replace(
    /local options[\s\S]*?(?=dofile\('addon\/BackstageForever\/BackstageForeverHUD.lua'\))/,
    "dofile('addon/BackstageForever/BackstageForeverCoach.lua')\ndofile('addon/BackstageForever/BackstageForeverProfession.lua')\ncharacter.updatedAt=100;character.clientBuild='1.60.1.70862';character.quests={{id=42,title='Observe',complete=false,objectives={{text='Trees',done=false,fulfilled=1,required=4}},destination={mapId=1413,x=.1,y=.2}}}\n",
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

test("native optional profession goals persist bounded attempts and retire stale closures on source, goal, combat and session changes", () =>
  hud(
    `local details=frames.BackstageForeverCompassProfessionDetails;assert(details,'Profession details missing');details.OnClick();local attempts=frames.BackstageForeverCompassAttempts;assert(attempts.visible);attempts.OnClick();assert(BackstageForeverHUDSettings.profession.crafts==5);local old=attempts.OnClick;BackstageForeverHUDCaptureStatus('unavailable');old();assert(BackstageForeverHUDSettings.profession.crafts==5);BackstageForeverHUDUpdate(character);details.OnClick();details.OnClick();old=attempts.OnClick;fighting=true;event('PLAYER_REGEN_DISABLED');fighting=false;old();assert(BackstageForeverHUDSettings.profession.crafts==5);event('PLAYER_REGEN_ENABLED');old=attempts.OnClick;event('PLAYER_LOGOUT');old();assert(BackstageForeverHUDSettings.profession.crafts==5);event('PLAYER_LOGIN');assert(BackstageForeverHUDSettings.profession.crafts==5)`,
  ));

test("native same-kind source qualifiers preserve limited stock, corpse context and build/faction uncertainty", () =>
  lua(
    `w.recipes.items[1].reagents={{itemId=2320,required=1},{itemId=2589,required=1},{itemId=10938,required=1}};for _,r in ipairs(BackstageForeverAcquisition.rows)do if r.itemId==2320 then r.limitedStock=true end end;local m=build({recipeId=100});assert(m.shoppingRows[1].acquisition.sources[1].limitedStock==true);assert(m.shoppingRows[1].acquisition.status=='qualified-historical');assert(m.shoppingRows[2].acquisition.sources[1].kind=='creature-corpse-loot');assert(m.shoppingRows[2].acquisition.sources[1].context[1]=='quest');assert(m.shoppingRows[3].acquisition.status=='unknown');c.faction='Alliance';assert(build({recipeId=100}).shoppingRows[1].acquisition.status=='browse-only');c.updatedAt=nil;assert(not build().planning.checklistAvailable)`,
  ));
test("native safe batch arithmetic and invalid options stay bounded", () =>
  lua(
    `w.recipes.items[1].reagents={};for i=1,10 do w.recipes.items[1].reagents[i]={itemId=i,required=100000}end;assert(build({recipeId=100,crafts=20}).shoppingRows[1].required==2000000);w.recipes.items[1].reagents[11]={itemId=11,required=1};assert(not build({recipeId=100}).planning.checklistAvailable);assert(build({crafts=math.huge}).selection.crafts==1);assert(build({crafts={secret=true}}).selection.crafts==1)`,
  ));

test("native material follow-through names the bounded shortfall and missing build cannot qualify a rank cap", () =>
  lua(
    `local m=build({crafts=5});assert(m.recommendation.detail:find('Silverleaf',1,true),'Material name missing');assert(m.recommendation.detail:find('7',1,true),'Shortfall missing');w.professions.items[1].rank=75;c.clientBuild=nil;assert(build().recommendation.kind~='profession-cap')`,
  ));

test('native explicit non-skillup goal stays visible as a manual plan, never a quest action',()=>lua(`w.recipes.items[1].canSkillUp=false;local b=BackstageForeverBuildCoach(c,{mode='professions',recipeId=100});assert(b.recommendation and b.recommendation.kind=='craft-plan');assert(not b.recommendation.questStep and not b.recommendation.command)`));

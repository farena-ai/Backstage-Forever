"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), path = require("node:path");
const { normalizeWorkshopCapture } = require("../src/core/preparation-data.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
// Pinned Forever table APIs; deliberately no legacy tuples, GetAllRecipeIDs,
// crafting actions, filter setters, or profession UI opening helpers.
const fixture = String.raw`
local handler,registered,timers=nil,{},{}
local who,build,now='A','70862',1700000000
local spellReads,recipeReads,schematicReads,slotReads,skillReads=0,0,0,0,0
local status,hud
CreateFrame=function()return {RegisterEvent=function(_,e)registered[e]=true end,SetScript=function(_,_,f)handler=f end}end
InCombatLockdown=function()return false end
issecretvalue=function(v)return v=='SECRET' end
C_Timer={After=function(delay,f)assert(delay==.25);timers[#timers+1]=f end}
UnitGUID=function()return who end
UnitFullName=function()return who,'Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 20 end
UnitXP=function()return 24 end
UnitXPMax=function()return 100 end
GetXPExhaustion=function()return 3 end
GetBuildInfo=function()return '1.60.1',build end
GetLocale=function()return 'enUS'end
GetZoneText=function()return 'Forest'end
GetSubZoneText=function()return ''end
time=function()return now end
BackstageForeverHUDUpdate=function(c)hud=c end
BackstageForeverHUDCaptureStatus=function(s)status=s end
C_QuestLog={GetNumQuestLogEntries=function()return 1,1 end,GetInfo=function()return {questID=42,title='Observe trees',isHeader=false}end,IsComplete=function()return false end,GetQuestObjectives=function()return {{text='Trees',finished=false,numRequired=4,numFulfilled=1}}end,GetAllCompletedQuestIDs=function()return {7,8}end}
Enum={BagIndex={Backpack=0,Bag_1=1,Bag_2=2,Bag_3=3,Bag_4=4},CraftingReagentType={Basic=7,Optional=8,Finishing=9},TradeskillSlotDataType={Reagent=4,Currency=5,ModifiedReagent=6}}
local lines={{skillID=171,name='Alchemy',isHeader=false,isCollapsed=false,rank=50,maxRank=150},{skillID=43,name='Swords',isHeader=false,isCollapsed=false,rank=20,maxRank=100}}
C_SkillInfo={GetNumSkillLines=function()return #lines end,GetSkillLineInfo=function(i)skillReads=skillReads+1;return lines[i]end}
local spells={1001,1002,1003}
local infos={ [1001]={recipeID=1001,name='Potion',learned=true,canSkillUp=true},[1002]={recipeID=1002,name='Unlearned',learned=false},[1003]=false }
local function basic(id,n)return {required=true,reagentType=7,dataSlotType=4,variableQuantities={},quantityRequired=n,reagents={{itemID=id}}}end
local schematic={recipeID=1001,name='Potion',isRecraft=false,outputItemID=2000,quantityMin=1,quantityMax=2,reagentSlotSchematics={basic(765,2),basic(2447,1),{required=false,reagentType=8}}}
C_TradeSkillUI={GetProfessionInfoBySkillLineID=function(id)return {professionID=id==171 and 4 or 0}end,
 GetProfessionSpells=function(p,s)assert(p==4 and s==171,'Resolve profession ID; do not reuse skillLineID');spellReads=spellReads+1;return spells end,
 GetRecipeInfo=function(id)recipeReads=recipeReads+1;return infos[id] or nil end,
 GetRecipeSchematic=function(id,recraft)assert(id==1001 and recraft==false);schematicReads=schematicReads+1;return schematic end}
local contents={ [0]={{itemID=765,stackCount=3,itemName='Silverleaf'},{itemID=2447,stackCount=2,itemName='Peacebloom'}},[1]={{itemID=765,stackCount=4,itemName='Silverleaf'}} }
local capacity={4,2,0,0,0}
C_Container={GetContainerNumSlots=function(b)assert(b>=0 and b<=4);return capacity[b+1]end,
 GetContainerNumFreeSlots=function(b)return capacity[b+1]end,
 GetContainerItemInfo=function(b,s)assert(b>=0 and b<=4);slotReads=slotReads+1;return contents[b] and contents[b][s]end}
C_Item={GetItemNameByID=function(id)return id==765 and 'Silverleaf' or id==2447 and 'Peacebloom' or nil end}
local function event(e,id)handler(nil,e,id)end
local function flush()local q=timers;timers={};for _,f in ipairs(q)do f()end end
local function load()dofile('addon/BackstageForever/BackstageForever.lua')end
local function save()print(BackstageForeverExport)end
load()
`;
function run(scenario, { validate = true, timeout = 30000 } = {}) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], {
    cwd: path.join(__dirname, ".."), input: fixture + scenario, encoding: "utf8", timeout, maxBuffer: 5 * 1048576,
  });
  assert.equal(r.status, 0, r.stderr || r.error?.message); assert.equal(r.stderr, "");
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map(raw => {
    const p = JSON.parse(raw);
    if (validate) {
      parseSavedVariables("BackstageForeverExport = " + JSON.stringify(raw));
      for (const c of p.characters) if (c.readiness?.workshop) normalizeWorkshopCapture(c.readiness.workshop, c.updatedAt);
    }
    return p;
  });
}
const active = p => p.characters.find(c => c.id === p.activeId);
// Decoder counts JSON values (containers included), never object property keys.
const jsonValueNodes = value => 1 + (value && typeof value === "object"
  ? Object.values(value).reduce((sum, child) => sum + jsonValueNodes(child), 0) : 0);
function nodeBudgetSeed() {
  return { schema: 1, activeId: "old-0", observedAt: 1600000000,
    characters: Array.from({ length: 19 }, (_, i) => ({
      id: "old-" + i, name: "Old", realm: "Realm", className: "Mage", level: 20, updatedAt: 1600000000,
      quests: [{ id: 42, title: "Retain quest", complete: false, objectives: [] }], progress: { current: 3, max: 100 },
      history: { recent: [], completedIdsKnown: true, completedCount: 10000,
        completedIds: Array.from({ length: 10000 }, (_, j) => j + 1) },
    })),
  };
}
const nodeBudgetCapture = String.raw`
C_QuestLog.GetAllCompletedQuestIDs=function()local r={};for i=1,4000 do r[i]=i end;return r end
C_Item=nil
spells={};for i=1,100 do spells[i]=i end
C_TradeSkillUI.GetRecipeInfo=function(id)return {recipeID=id,name='R',learned=true}end
C_TradeSkillUI.GetRecipeSchematic=function(id)local slots={};for i=1,20 do slots[i]=basic(i,1)end;return {recipeID=id,isRecraft=false,reagentSlotSchematics=slots}end
`;

test("exact table APIs collect owned learned recipes and aggregate only carried bags", () => {
  const [p] = run(String.raw`event('PLAYER_LOGIN');assert(spellReads==1 and recipeReads==3 and schematicReads==1,'Missing learned-recipe collection');assert(slotReads==6);save()`);
  const w = active(p).readiness.workshop;
  assert.deepEqual(w.professions, { observedAt: 1700000000, complete: true, items: [{ skillLineId: 171, professionId: 4, name: "Alchemy", rank: 50, maxRank: 150 }] });
  assert.equal(w.recipes.complete, true);
  assert.deepEqual(w.recipes.items, [{ id: 1001, skillLineId: 171, name: "Potion", canSkillUp: true, outputItemId: 2000, outputMin: 1, outputMax: 2, reagentsKnown: true, reagents: [{ itemId: 765, required: 2, name: "Silverleaf" }, { itemId: 2447, required: 1, name: "Peacebloom" }] }]);
  assert.deepEqual(w.materials, { observedAt: 1700000000, complete: true, scope: "bags-0-4", items: [{ itemId: 765, count: 7, name: "Silverleaf" }, { itemId: 2447, count: 2, name: "Peacebloom" }] });
});

test("required alternates, variables, currencies, missing enums and ambiguous slots stay unknown", () => {
  const rows = run(String.raw`
local variants={
 function()schematic.reagentSlotSchematics[1].reagents={{itemID=765},{itemID=1}}end,
 function()schematic.reagentSlotSchematics[1].variableQuantities={{reagent={itemID=765},quantity=2}}end,
 function()schematic.reagentSlotSchematics[1].dataSlotType=5 end,
 function()schematic.reagentSlotSchematics[1].reagents={{currencyID=1}}end,
 function()Enum.CraftingReagentType=nil end,
 function()schematic.reagentSlotSchematics[1].required=nil end,
 function()schematic.reagentSlotSchematics[1].quantityRequired='SECRET' end,
 function()schematic.reagentSlotSchematics[1].variableQuantities=nil end,
 function()schematic.recipeID=555 end,
 function()schematic.reagentSlotSchematics={};schematic.isRecraft=true end
}
for _,change in ipairs(variants)do
 schematic={recipeID=1001,isRecraft=false,reagentSlotSchematics={basic(765,2)}}
 Enum.CraftingReagentType={Basic=7,Optional=8};change();event('PLAYER_LOGIN');save()
end
schematic={recipeID=1001,isRecraft=false,reagentSlotSchematics={}}
event('PLAYER_LOGIN');save()
`);
  for (const p of rows.slice(0, -1)) {
    assert.ok(active(p).readiness?.workshop?.recipes, "Learned recipe facts must survive ambiguous requirements");
    assert.equal(active(p).readiness.workshop.recipes.items[0].reagentsKnown, false);
    assert.deepEqual(active(p).readiness.workshop.recipes.items[0].reagents, []);
    assert.equal(active(p).progress.current, 24);
  }
  assert.equal(active(rows.at(-1)).readiness.workshop.recipes.items[0].reagentsKnown, true);
});

test("collapsed, linked, filtered, duplicate and protected ownership never poison core facts", () => {
  const rows = run(String.raw`
table.insert(lines,1,{isHeader=true,isCollapsed=true,name='Professions'});event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsTradeSkillLinked=function()return true end;event('TRADE_SKILL_DATA_SOURCE_CHANGED');flush();save()
C_TradeSkillUI.IsTradeSkillLinked=function()return false end
C_TradeSkillUI.IsTradeSkillGuild=function()return true end;event('TRADE_SKILL_SHOW');flush();save()
C_TradeSkillUI.IsTradeSkillGuild=nil;C_TradeSkillUI.GetSourceTypeFilter=function()return 2 end;event('TRADE_SKILL_LIST_UPDATE');flush();save()
C_TradeSkillUI.GetSourceTypeFilter=nil
lines={{skillID=171,name='Alchemy',isHeader=false,isCollapsed=false,rank=5,maxRank=150},{skillID=172,name='Ambiguous duplicate',isHeader=false,isCollapsed=false,rank=5,maxRank=150}}
C_TradeSkillUI.GetProfessionInfoBySkillLineID=function()return {professionID=4}end
event('SKILL_LINES_CHANGED');flush();save()
C_SkillInfo.GetSkillLineInfo=function()error('PRIVATE OPTIONAL ERROR')end;event('SKILL_LINES_CHANGED');flush();save()
C_SkillInfo=nil;C_TradeSkillUI=nil;C_Container=nil;event('PLAYER_LOGIN');save()
`);
  assert.ok(active(rows[0]).readiness?.workshop?.professions, "Collapsed skills still retain observed professions");
  assert.equal(active(rows[0]).readiness.workshop.professions.complete, false);
  assert.equal(active(rows[0]).readiness.workshop.recipes.complete, false);
  for (const p of rows.slice(1, 4)) assert.equal(active(p).readiness.workshop.recipes.complete, false);
  for (const p of rows.slice(1, 3)) assert.deepEqual(active(p).readiness.workshop.recipes.items, []);
  assert.equal(active(rows[3]).readiness.workshop.recipes.items[0].id, 1001, "Filter ambiguity permits positive owned facts, not completeness");
  assert.equal(active(rows[4]).readiness.workshop.professions.items.length, 1);
  assert.equal(active(rows[4]).readiness.workshop.professions.complete, false);
  for (const p of rows) { assert.equal(active(p).quests[0].id, 42); assert.equal(active(p).progress.current, 24); assert.doesNotMatch(JSON.stringify(p), /SECRET|PRIVATE/); }
});

test("bag bursts reuse dated recipe cache while dirty, identity, build and session changes invalidate it", () => {
  const rows = run(String.raw`
event('PLAYER_LOGIN');save();local first=spellReads
now=now+5;for i=1,40 do event('BAG_UPDATE_DELAYED')end
assert(#timers==1 and spellReads==first);flush();assert(spellReads==first,'Bag-only capture queried recipes');save()
for _,e in ipairs({'SKILL_LINES_CHANGED','NEW_RECIPE_LEARNED','TRADE_SKILL_LIST_UPDATE','TRADE_SKILL_DETAILS_UPDATE','TRADE_SKILL_DATA_SOURCE_CHANGED','TRADE_SKILL_SHOW','TRADE_SKILL_CLOSE'})do
 assert(registered[e],'Missing dirty event '..e);for i=1,20 do event(e)end;assert(#timers==1);flush();first=first+1;assert(spellReads==first,'Dirty burst should query recipes once')
end
who='B';event('BAG_UPDATE_DELAYED');flush();first=first+1;assert(spellReads==first);save()
build='70863';event('BAG_UPDATE_DELAYED');flush();first=first+1;assert(spellReads==first)
event('BAG_UPDATE_DELAYED');event('PLAYER_LOGOUT');flush();assert(spellReads==first)
event('PLAYER_LOGIN');first=first+1;assert(spellReads==first);save()
`);
  const first = active(rows[0]).readiness.workshop, bags = active(rows[1]).readiness.workshop;
  assert.equal(bags.recipes.observedAt, first.recipes.observedAt);
  assert.equal(bags.materials.observedAt, first.materials.observedAt + 5);
  assert.equal(rows[2].characters.length, 2); assert.equal(active(rows[3]).clientBuild, "1.60.1.70863");
});

test("collection clocks crossing a second remain below enclosing save and rich alts survive reload", () => {
  const rows = run(String.raw`
time=function()now=now+1;return now end
event('PLAYER_LOGIN');save()
who='B';load();event('PLAYER_LOGIN');save()
who='C';load();event('BAG_UPDATE_DELAYED');event('PLAYER_LOGIN');save()
`);
  assert.equal(rows[2].characters.length, 3);
  assert.deepEqual(rows[2].characters.find(c => c.id === "A"), active(rows[0]));
  assert.deepEqual(rows[2].characters.find(c => c.id === "B"), active(rows[1]));
  for (const p of rows) for (const c of p.characters) {
    assert.ok(c.readiness?.workshop?.recipes, "Rich workshop must survive capture and reload");
    for (const x of Object.values(c.readiness.workshop)) assert.ok(x.observedAt <= c.updatedAt && x.observedAt <= p.observedAt);
  }
});

test("slot, skill, recipe and reagent limits produce bounded partial observations", () => {
  const rows = run(String.raw`
capacity={200,100,0,0,0};slotReads=0;event('PLAYER_LOGIN');assert(slotReads==256,'Bound total bag slots at 256');save()
capacity={0,0,0,0,0};event('BAG_UPDATE_DELAYED');flush();save()
capacity={1,0,0,0,0};C_Container.GetContainerItemInfo=function()error('PRIVATE SLOT')end;event('BAG_UPDATE_DELAYED');flush();save()
C_SkillInfo.GetNumSkillLines=function()return 101 end;skillReads=0;event('SKILL_LINES_CHANGED');flush();assert(skillReads==100);save()
C_SkillInfo.GetNumSkillLines=function()return 1 end
spells={};for i=1,101 do spells[i]=i end
C_TradeSkillUI.GetRecipeInfo=function(id)recipeReads=recipeReads+1;return {recipeID=id,name='Recipe '..id,learned=true}end
C_TradeSkillUI.GetRecipeSchematic=function(id)local slots={};for i=1,21 do slots[i]=basic(i,1)end;return {recipeID=id,isRecraft=false,reagentSlotSchematics=slots}end
recipeReads=0;event('NEW_RECIPE_LEARNED');flush();assert(recipeReads==100);save()
`);
  for (const p of rows.slice(0, 3)) assert.equal(active(p).readiness.workshop.materials.complete, false);
  assert.equal(active(rows[3]).readiness.workshop.professions.complete, false);
  const recipes = active(rows[4]).readiness.workshop.recipes;
  assert.equal(recipes.complete, false); assert.equal(recipes.items.length, 100);
  for (const r of recipes.items) { assert.equal(r.reagentsKnown, false); assert.deepEqual(r.reagents, []); }
});

test("export budget sheds workshop before older quests, XP and history", () => {
  const characters = Array.from({ length: 15 }, (_, i) => ({
    id: "old-" + i, name: "Old", realm: "Realm", className: "Mage", level: 20, updatedAt: 1600000000,
    quests: [{ id: 42, title: "Retain quest", complete: false, objectives: [] }], progress: { current: 3, max: 100 },
    history: { recent: [], completedIdsKnown: true, completedIds: [7], completedCount: 1 },
    readiness: { workshop: { recipes: { observedAt: 1600000000, complete: false, items: Array.from({ length: 100 }, (_, j) => ({ id: j + 1, skillLineId: 171, name: "R".repeat(200), reagentsKnown: true, reagents: Array.from({ length: 20 }, (_, k) => ({ itemId: k + 1, required: 1, name: "N".repeat(200) })) })) } } },
  }));
  while (Buffer.byteLength(JSON.stringify({ schema: 1, characters, activeId: "old-0", observedAt: 1600000000 })) >= 1000000) characters.pop();
  const saved = JSON.stringify({ schema: 1, characters, activeId: "old-0", observedAt: 1600000000 });
  const [p] = run(`BackstageForeverExport=[=[${saved}]=]\n` + String.raw`
spells={};for i=1,100 do spells[i]=i end
C_TradeSkillUI.GetRecipeInfo=function(id)return {recipeID=id,name=string.rep('R',200),learned=true}end
C_Item.GetItemNameByID=function()return string.rep('N',200)end
C_TradeSkillUI.GetRecipeSchematic=function(id)local slots={};for i=1,20 do slots[i]=basic(i,1)end;return {recipeID=id,isRecraft=false,reagentSlotSchematics=slots}end
capacity={256,0,0,0,0}
C_Container.GetContainerItemInfo=function(b,s)return {itemID=s,stackCount=1,itemName=string.rep('M',200)}end
event('PLAYER_LOGIN');save()
`);
  assert.equal(p.characters.length, characters.length + 1); assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1048576);
  assert.ok(p.characters.some(c => !c.readiness?.workshop), "Optional workshop must be shed");
  for (const c of p.characters.filter(c => c.id.startsWith("old-"))) {
    assert.ok(c.quests && c.progress && c.history, "Workshop must be shed before older quest, XP or history facts");
    assert.equal(c.quests[0].title, "Retain quest"); assert.equal(c.progress.current, 3); assert.equal(c.history.completedIds[0], 7);
  }
});

test("optional exact ownership predicates use their documented arity and reject mismatches", () => {
  const rows = run(String.raw`
C_TradeSkillUI.IsRecipeInSkillLine=function(...)assert(select('#',...)==2);local id,skill=...;return id==1001 and skill==171 end
C_TradeSkillUI.IsRecipeProfessionLearned=function(...)assert(select('#',...)==1,'Profession-learned takes recipeID only');return (...)==1001 end
event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsRecipeInSkillLine=function()return false end;event('NEW_RECIPE_LEARNED');flush();save()
C_TradeSkillUI.IsRecipeInSkillLine=function()return true end
C_TradeSkillUI.IsRecipeProfessionLearned=function()return 'SECRET' end;event('NEW_RECIPE_LEARNED');flush();save()
`);
  assert.equal(active(rows[0]).readiness.workshop.recipes.items.length, 1);
  for (const p of rows.slice(1)) { assert.equal(active(p).readiness.workshop.recipes.complete, false); assert.deepEqual(active(p).readiness.workshop.recipes.items, []); }
});

test("nil, secret and failing view indicators cannot become a complete owned recipe claim", () => {
  const rows = run(String.raw`
local variants={function()return nil end,function()return 'SECRET' end,function()error('PRIVATE VIEW')end}
for _,f in ipairs(variants)do C_TradeSkillUI.IsTradeSkillLinked=f;event('PLAYER_LOGIN');save()end
C_TradeSkillUI.IsTradeSkillLinked=nil
IsTradeSkillLinked=function()return true end;event('PLAYER_LOGIN');save()
IsTradeSkillLinked=nil;C_TradeSkillUI.IsNPCCrafting=function()return true end;event('PLAYER_LOGIN');save()
`);
  for (const p of rows) { const c = active(p); assert.deepEqual(c.readiness.workshop.recipes.items, []); assert.equal(c.readiness.workshop.recipes.complete, false); assert.equal(c.quests[0].id, 42); }
});

test("reagent duplicates aggregate safely, unknown schematics retain useful native quests and XP", () => {
  const rows = run(String.raw`
schematic.reagentSlotSchematics={basic(765,2),basic(765,3)};event('PLAYER_LOGIN');save()
schematic.reagentSlotSchematics={basic(765,99999),basic(765,2)};event('NEW_RECIPE_LEARNED');flush();save()
C_TradeSkillUI.GetRecipeSchematic=function()error('PRIVATE SCHEMATIC')end;event('NEW_RECIPE_LEARNED');flush()
dofile('addon/BackstageForever/BackstageForeverPlan.lua')
local plan=BackstageForeverBuildPlan(hud,{focus='balanced',minutes=30})
assert(plan.status=='ready' and #plan.steps>0,'Optional crafting failure cannot strand native guidance')
assert(hud.progress.current==24 and status=='partial');save()
`);
  assert.deepEqual(active(rows[0]).readiness.workshop.recipes.items[0].reagents, [{ itemId: 765, required: 5, name: "Silverleaf" }]);
  for (const p of rows.slice(1)) assert.equal(active(p).readiness.workshop.recipes.items[0].reagentsKnown, false);
});

test("complete empty bags differ from zero-capacity, invalid and capped stack observations", () => {
  const rows = run(String.raw`
contents={};event('PLAYER_LOGIN');save()
capacity={0,0,0,0,0};event('BAG_UPDATE_DELAYED');flush();save()
capacity={4,0,0,0,0};contents={[0]={{itemID=765,stackCount=999999},{itemID=765,stackCount=2},{itemID=2447,stackCount='SECRET'},{itemID=0,stackCount=2}}}
event('BAG_UPDATE_DELAYED');flush();save()
`);
  assert.deepEqual(active(rows[0]).readiness.workshop.materials.items, []);
  assert.equal(active(rows[0]).readiness.workshop.materials.complete, true);
  assert.equal(active(rows[1]).readiness.workshop.materials.complete, false);
  assert.equal(active(rows[2]).readiness.workshop.materials.complete, false);
  assert.deepEqual(active(rows[2]).readiness.workshop.materials.items, [{ itemId: 765, count: 999999 }]);
});

test("protected or malformed view functions block ownership rather than looking absent", () => {
  const rows = run(String.raw`
C_TradeSkillUI.IsTradeSkillLinked='SECRET';event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsTradeSkillLinked=42;event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsTradeSkillLinked=nil;IsTradeSkillLinked='SECRET';event('PLAYER_LOGIN');save()
`);
  for (const p of rows) {
    assert.equal(active(p).readiness.workshop.recipes.complete, false);
    assert.deepEqual(active(p).readiness.workshop.recipes.items, []);
  }
});

test("protected optional ownership predicates and source filters remain ambiguous", () => {
  const rows = run(String.raw`
C_TradeSkillUI.IsRecipeInSkillLine='SECRET';event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsRecipeInSkillLine=nil;C_TradeSkillUI.IsRecipeProfessionLearned=42;event('PLAYER_LOGIN');save()
C_TradeSkillUI.IsRecipeProfessionLearned=nil;C_TradeSkillUI.GetSourceTypeFilter='SECRET';event('PLAYER_LOGIN');save()
`);
  for (const p of rows) assert.equal(active(p).readiness.workshop.recipes.complete, false);
  for (const p of rows.slice(0, 2)) assert.deepEqual(active(p).readiness.workshop.recipes.items, []);
  assert.equal(active(rows[2]).readiness.workshop.recipes.items[0].id, 1001);
});

test("low-byte high-node export sheds workshop and retains every alt across a fresh Lua load", t => {
  const seed = nodeBudgetSeed(), characters = seed.characters;
  const saved = JSON.stringify(seed);
  assert.ok(Buffer.byteLength(saved) < 1048576 && jsonValueNodes(seed) < 200000);
  const rows = run(`BackstageForeverExport=[=[${saved}]=]\n` + nodeBudgetCapture + String.raw`
event('PLAYER_LOGIN');save()
load();event('PLAYER_LOGIN');save()
`, { timeout: 60000 });
  for (const p of rows) {
    assert.equal(p.characters.length, 20, "Addon export must remain decodable without silently losing all alts");
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1048576, "Keep the existing byte budget");
    assert.ok(jsonValueNodes(p) <= 200000, "Export must fit the unchanged decoder node budget");
    assert.equal(active(p).readiness?.workshop, undefined, "Shed optional workshop before older quest, XP and history facts");
    assert.equal(active(p).history.completedIds.length, 4000);
    for (const old of characters) assert.deepEqual(p.characters.find(c => c.id === old.id), old);
  }
  t.diagnostic(JSON.stringify({ seedBytes: Buffer.byteLength(saved), seedNodes: jsonValueNodes(seed),
    captures: rows.map(p => ({ bytes: Buffer.byteLength(JSON.stringify(p)), nodes: jsonValueNodes(p), characters: p.characters.length })) }));
});

test("exactly 200000 JSON values retain workshop and all identities through reload", t => {
  const [baseline] = run(nodeBudgetCapture + "event('PLAYER_LOGIN');save()");
  const seed = nodeBudgetSeed();
  const remove = jsonValueNodes(seed) + jsonValueNodes(active(baseline)) - 200000;
  assert.ok(remove > 0 && remove < 10000);
  const history = seed.characters[0].history;
  history.completedIds.length -= remove; history.completedCount = history.completedIds.length;
  const rows = run(`BackstageForeverExport=[=[${JSON.stringify(seed)}]=]\n` + nodeBudgetCapture + String.raw`
event('PLAYER_LOGIN');save()
load();event('PLAYER_LOGIN');save()
`, { timeout: 60000 });
  for (const p of rows) {
    assert.equal(p.characters.length, 20); assert.equal(jsonValueNodes(p), 200000);
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1048576);
    assert.equal(active(p).readiness.workshop.recipes.items.length, 100, "An inclusive node boundary must not shed valid facts");
    for (const old of seed.characters) assert.deepEqual(p.characters.find(c => c.id === old.id), old);
  }
  t.diagnostic(JSON.stringify({ captures: rows.map(p => ({ bytes: Buffer.byteLength(JSON.stringify(p)), nodes: jsonValueNodes(p) })) }));
});

test("node overflow without workshop uses existing optional-detail shedding and preserves identities", () => {
  const capture = String.raw`
C_SkillInfo=nil;C_TradeSkillUI=nil;C_Container=nil
C_QuestLog.GetAllCompletedQuestIDs=function()local r={};for i=1,20000 do r[i]=i end;return r end
`;
  const [baseline] = run(capture + "event('PLAYER_LOGIN');save()");
  const seed = nodeBudgetSeed();
  const oversized = { ...seed, characters: [...seed.characters, active(baseline)], activeId: "A", observedAt: 1700000000 };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 1048576, "This must exercise nodes alone");
  assert.ok(jsonValueNodes(oversized) > 200000);
  const rows = run(`BackstageForeverExport=[=[${JSON.stringify(seed)}]=]\n` + capture + String.raw`
event('PLAYER_LOGIN');save()
load();event('PLAYER_LOGIN');save()
`, { timeout: 60000 });
  for (const p of rows) {
    assert.equal(p.characters.length, 20); assert.ok(jsonValueNodes(p) <= 200000);
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1048576);
    assert.equal(active(p).history.completedIds.length, 20000);
    for (const old of seed.characters) assert.ok(p.characters.find(c => c.id === old.id));
    const retained = p.characters.filter(c => c.id.startsWith("old-") && c.history);
    assert.ok(retained.length > 0 && retained.length < 19, "Only necessary oldest optional detail should be discarded");
    for (const old of retained) assert.deepEqual(old, seed.characters.find(c => c.id === old.id));
  }
});

test("skill-up colour comes from the client's own enum or string and never contradicts canSkillUp", () => {
  const rows = run(String.raw`
local cases={
 {relativeDifficulty=0,canSkillUp=true},
 {relativeDifficulty=2,canSkillUp=true},
 {relativeDifficulty=3,canSkillUp=false},
 {relativeDifficulty=3,canSkillUp=true},
 {relativeDifficulty='SECRET',canSkillUp=true},
 {relativeDifficulty=9,canSkillUp=true},
 {skillType='medium',canSkillUp=true},
 {difficulty='header',canSkillUp=true},
}
for _,c in ipairs(cases)do
 local info={recipeID=1001,name='Potion',learned=true};for k,v in pairs(c)do info[k]=v end
 infos[1001]=info;event('PLAYER_LOGIN');save()
end
Enum.TradeskillRelativeDifficulty={Optimal=3,Medium=2,Easy=1,Trivial=0}
infos[1001]={recipeID=1001,name='Potion',learned=true,relativeDifficulty=0,canSkillUp=false};event('PLAYER_LOGIN');save()
Enum.TradeskillRelativeDifficulty={Unrelated=0}
infos[1001]={recipeID=1001,name='Potion',learned=true,relativeDifficulty=0,canSkillUp=true};event('PLAYER_LOGIN');save()
`);
  const got = rows.map(p => active(p).readiness.workshop.recipes.items[0].difficulty);
  assert.deepEqual(got, ["optimal", "easy", "trivial", undefined, undefined, undefined, "medium", undefined, "trivial", undefined]);
});

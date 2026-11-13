"use strict";
// Quest intel: quest log text in the capture, item sources learned from looting,
// /bf how, and the app-side validators and lookups that carry them.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1048576 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "", r.stderr);
  return r.stdout.trim();
}
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { validateQuestData } = require("../src/core/quest-data.cjs");
const intel = require("../src/core/quest-intel.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");

// A synthetic character: one quest (8 bottles, Shadowvale) in the log.
const WORLD = String.raw`
local handler,intelHandler
local frames=0
CreateFrame=function()frames=frames+1;local id=frames;return {RegisterEvent=function()end,SetScript=function(_,_,fn)if id==1 then handler=fn else intelHandler=fn end end} end
InCombatLockdown=function() return false end
UnitGUID=function(u)if u=='player' then return 'Player-synthetic-one' end;if u=='target' then return TARGET end end
UnitName=function(u)if u=='target' then return TARGET_NAME end end
UnitFullName=function()return 'Example','Example Realm' end
UnitClass=function()return 'Mage','MAGE',8 end
UnitLevel=function()return 30 end
UnitRace=function()return 'Human','Human',1 end
UnitFactionGroup=function()return 'Alliance','Alliance' end
GetZoneText=function()return 'Duskwood' end
GetSubZoneText=function()return '' end
GetBuildInfo=function()return '1.60.1','70938' end
GetLocale=function()return 'enUS' end
local now=1700000000
time=function()return now end
GetTime=function()return now end
UnitXP=function()return 20 end
UnitXPMax=function()return 100 end
local bottles=3
C_QuestLog={GetNumQuestLogEntries=function()return 2 end,
  GetInfo=function(i)if i==1 then return {title='Duskwood',isHeader=true} end;return {questID=95314,title='That Shadowvale Green Elixir',isHeader=false,level=30} end,
  IsComplete=function()return false end,
  GetQuestObjectives=function()return {{text='Bottle of Whispering Elixir: '..bottles..'/8',finished=false,type='item',numRequired=8,numFulfilled=bottles}} end}
C_Map={GetBestMapForUnit=function()return 1431 end,GetPlayerMapPosition=function()return {GetXY=function()return .094,.678 end}end,GetMapInfo=function(id)return {name=id==1431 and 'Duskwood' or 'Elsewhere'} end}
local selected,selections=5,{}
GetQuestLogSelection=function()return selected end
SelectQuestLogEntry=function(i)selected=i;selections[#selections+1]=i end
GetQuestLogQuestText=function()
  if selected~=2 then return '','' end
  return 'Travel to the ruins of |cffffd200Shadowvale|r, $N, and recover some bottles of the elixir.$B$BThe old alchemists left them lying about the ruins. Do not linger: the dead walk there.\n'..string.rep('x',2000),
    'Bring 8 Bottles of Whispering Elixir to Alchemist Rhea.'
end
`;
const LOAD = "dofile('addon/BackstageForever/BackstageForever.lua')\ndofile('addon/BackstageForever/BackstageForeverQuestIntel.lua')\n";

test("capture adds bounded quest log text and restores the player's selection", () => {
  const out = lua(`${WORLD}${LOAD}
handler(nil,'PLAYER_LOGIN')
assert(selected==5,'selection restored')
local n=#selections
handler(nil,'QUEST_LOG_UPDATE')
assert(#selections==n,'text is read once per quest per session')
print(BackstageForeverExport)`);
  const exported = JSON.parse(out);
  const q = exported.characters[0].quests[0];
  assert.equal(q.id, 95314);
  assert.ok(q.text.description.startsWith("Travel to the ruins of Shadowvale, adventurer, and recover some bottles of the elixir. The old alchemists left them lying about the ruins."), q.text.description);
  assert.ok(q.text.description.length <= 1200 && q.text.description.endsWith("..."));
  assert.doesNotMatch(q.text.description, /\|c|\|r|\$|[\x00-\x1f]/);
  assert.equal(q.text.objectives, "Bring 8 Bottles of Whispering Elixir to Alchemist Rhea.");
  const parsed = parseSavedVariables("BackstageForeverExport = " + JSON.stringify(out));
  assert.deepEqual(parsed.characters[0].quests[0].text, q.text);
});

test("quest text clean-up strips escape codes, tokens and control characters", () => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForever.lua')
print(BackstageForeverPlainQuestText('Hello $n, take |cff00ff00this|r |Hitem:1:0|h[Thing]|h.$B$BOk $Ghe:she; |TInterface\\\\Icons\\\\x:0|tdone',400))
print(tostring(BackstageForeverPlainQuestText('   ',400)), tostring(BackstageForeverPlainQuestText(42,400)))
print(BackstageForeverPlainQuestText(string.rep('word ',100),40))`).split("\n");
  assert.equal(out[0], "Hello adventurer, take this [Thing]. Ok he done");
  assert.equal(out[1], "nil\tnil");
  assert.equal(out[2], "word word word word word word word...");
});

const LOOT = String.raw`
TARGET='Creature-0-1-0-1-1200-00000ABC' TARGET_NAME='Rot Hide Gnoll'
local slots={}
GetNumLootItems=function()return #slots end
GetLootSlotInfo=function(i)local s=slots[i];return 'icon',s.name,s.count,nil,1,false,s.quest~=nil,s.quest end
GetLootSlotLink=function(i)return '|cffffffff|Hitem:'..slots[i].id..'::::::::30:::::|h['..slots[i].name..']|h|r' end
GetLootSourceInfo=function(i)return unpack(slots[i].sources) end
unpack=unpack or table.unpack
GameTooltip={IsShown=function()return true end,GetUnit=function()return nil end}
GameTooltipTextLeft1={GetText=function()return 'Bottle Crate' end}
`;

test("looting quest items learns creature and object sources, once per window, bounded", () => {
  const out = lua(`${WORLD}${LOAD}${LOOT}
handler(nil,'PLAYER_LOGIN');intelHandler(nil,'PLAYER_LOGIN')
-- A corpse: one bottle and some vendor junk (not a quest item: ignored).
slots={{id=268801,name='Bottle of Whispering Elixir',count=1,sources={TARGET,1}},{id=4865,name='Ruined Pelt',count=2,sources={TARGET,2}}}
intelHandler(nil,'LOOT_READY');intelHandler(nil,'LOOT_OPENED')
-- A crate in the ruins: two bottles.
slots={{id=268801,name='Bottle of Whispering Elixir',count=2,sources={'GameObject-0-1-0-1-178084-00000DEF',2}}}
now=now+30;intelHandler(nil,'LOOT_OPENED')
-- A quest-flagged item for a quest not in the log, and a bad GUID: ignored.
slots={{id=5,name='Other',count=1,quest=1,sources={TARGET,1}},{id=268801,name='Bottle of Whispering Elixir',count=1,sources={'Pet-0-1-2-3-4-5',1}}}
now=now+30;intelHandler(nil,'LOOT_OPENED')
local items=BackstageForeverLootSourcesItems()
print(#items, #items[1].sources, items[1].sources[1].kind, items[1].sources[1].id, items[1].sources[1].name, items[1].sources[1].count, items[1].sources[2].kind, items[1].sources[2].name, items[1].sources[2].count)
local k1,i1=BackstageForeverLootSourceKind('Creature-0-5250-0-12-1200-0000F1A2B3');local k2,i2=BackstageForeverLootSourceKind('GameObject-0-1-0-1-178084-00000DEF');print(k1,i1,k2,i2,tostring(BackstageForeverLootSourceKind('Player-1-0001')))
-- Caps: 200 items x 12 sources x 8 positions.
for i=1,260 do BackstageForeverLootSourceRecord({itemId=1000+i,questIds={1},kind='creature',sourceId=1,count=1,at=now}) end
for i=1,20 do BackstageForeverLootSourceRecord({itemId=7,questIds={1},kind='object',sourceId=i,count=1,at=now}) end
for i=1,20 do BackstageForeverLootSourceRecord({itemId=7,questIds={1},kind='object',sourceId=20,count=1,at=now,position={mapId=1,x=i/25,y=.5}}) end
items=BackstageForeverLootSourcesItems()
print(#items, #items[1].sources, #items[1].sources[1].positions)
-- The saved journal is re-read and sanitized at the next login.
BackstageForeverQuestItemSourcesDB={schemaVersion=1,items={{itemId=9,questIds={1},lastSeen=1,sources={{kind='object',id=2,count=1,lastSeen=1,positions={}}}},{itemId='bad'},'junk'}}
intelHandler(nil,'PLAYER_LOGIN')
print(#BackstageForeverLootSourcesItems())
print(tostring(BackstageForeverLootSourcesSnapshot('Player-someone-else')))`).split("\n");
  assert.equal(out[0], "1\t2\tobject\t178084\tBottle Crate\t2\tcreature\tRot Hide Gnoll\t1");
  assert.equal(out[1], "creature\t1200\tobject\t178084\tnil");
  assert.equal(out[2], "200\t12\t8");
  assert.equal(out[3], "1");
  assert.equal(out[4], "nil");
});

test("the capture exports learned sources and the app keeps them on the profile", () => {
  const out = lua(`${WORLD}${LOAD}${LOOT}
handler(nil,'PLAYER_LOGIN');intelHandler(nil,'PLAYER_LOGIN')
slots={{id=268801,name='Bottle of Whispering Elixir',count=2,sources={'GameObject-0-1-0-1-178084-00000DEF',2}}}
intelHandler(nil,'LOOT_OPENED')
handler(nil,'PLAYER_LEVEL_UP')
print(BackstageForeverExport)`);
  const raw = JSON.parse(out).characters[0].lootSources;
  assert.deepEqual(raw, { schemaVersion: 1, items: [{ itemId: 268801, name: "Bottle of Whispering Elixir", lastSeen: 1700000000, questIds: [95314], sources: [{ kind: "object", id: 178084, name: "Bottle Crate", count: 2, lastSeen: 1700000000, positions: [{ mapId: 1431, x: 0.094, y: 0.678 }] }] }] });
  const parsed = parseSavedVariables("BackstageForeverExport = " + JSON.stringify(out));
  const c = parsed.characters[0];
  assert.equal(c.lootSources.items[0].lastSeen, "2023-11-14T22:13:20.000Z");
  assert.equal(c.lootSources.items[0].sources[0].positions[0].x, 0.094);
  // Merged into the private profile state and accepted by the strict state validator.
  const state = mergeSnapshot(defaultState(), parsed);
  const profile = state.profiles[0];
  assert.deepEqual(profile.lootSources, c.lootSources);
  assert.equal(profile.quests[0].text.objectives, "Bring 8 Bottles of Whispering Elixir to Alchemist Rhea.");
  validateState(state);
  // An invalid optional block is dropped without losing the character.
  const broken = JSON.parse(out);
  broken.characters[0].lootSources.items[0].sources[0].kind = "player";
  const again = parseSavedVariables("BackstageForeverExport = " + JSON.stringify(JSON.stringify(broken)));
  assert.equal(again.characters.length, 1);
  assert.equal(again.characters[0].lootSources, undefined);
});

test("/bf how explains the tracked quest from objectives, learned sources and quest text", () => {
  const out = lua(`${WORLD}${LOAD}${LOOT}
local msgs={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m)msgs[#msgs+1]=m end}
handler(nil,'PLAYER_LOGIN');intelHandler(nil,'PLAYER_LOGIN')
msgs={}
BackstageForeverHowCommand('how')
local before=#msgs
slots={{id=268801,name='Bottle of Whispering Elixir',count=2,sources={'GameObject-0-1-0-1-178084-00000DEF',2}}}
intelHandler(nil,'LOOT_OPENED')
BackstageForeverHowCommand('how')
for i=1,before do print('A '..msgs[i]) end
for i=before+1,#msgs do print('B '..msgs[i]) end
msgs={}
BackstageForeverHowCommand('how nothing like this')
print('C '..msgs[1])
print('D '..table.concat(BackstageForeverHowHints('Greetings. Kill 10 gnolls in the hills! The weather is nice. Then return to me.',2),' | '))`).split("\n");
  const a = out.filter((l) => l.startsWith("A ")).map((l) => l.slice(2));
  const b = out.filter((l) => l.startsWith("B ")).map((l) => l.slice(2));
  assert.deepEqual(a, [
    "Backstage Forever: How to do: That Shadowvale Green Elixir",
    "Backstage Forever: - Bottle of Whispering Elixir: 3/8",
    "Backstage Forever:   Not learned yet: loot one and /bf how will remember where it came from.",
    "Backstage Forever: Quest says: Travel to the ruins of Shadowvale, adventurer, and recover some bottles of the elixir.",
  ]);
  assert.deepEqual(b, [
    "Backstage Forever: How to do: That Shadowvale Green Elixir",
    "Backstage Forever: - Bottle of Whispering Elixir: 3/8",
    "Backstage Forever:   Learned: you looted these from Bottle Crate near 9.4, 67.8 (Duskwood)",
    "Backstage Forever: Quest says: Travel to the ruins of Shadowvale, adventurer, and recover some bottles of the elixir.",
  ]);
  assert.equal(out.find((l) => l.startsWith("C ")), 'C Backstage Forever: No quest in your log matches "nothing like this".');
  assert.equal(out.find((l) => l.startsWith("D ")), "D Kill 10 gnolls in the hills! | Then return to me.");
});

test("/bf how names creature drops", () => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverQuestIntel.lua')
local lines=BackstageForeverHowLines({id=5,title='Gnoll Pelts',objectives={{text='Gnoll Pelt: 1/5',done=false,type='item'},{text='Kill Gnolls: 5/5',done=true,type='monster'}}},
  {{itemId=1,name='Gnoll Pelt',questIds={5},sources={{kind='creature',id=1200,name='Rot Hide Gnoll',count=1,positions={{mapId=1421,x=.521,y=.304}}},{kind='creature',id=1201,count=1,positions={}}}}},
  function(id)return id==1421 and 'Silverpine Forest' or nil end)
for _,l in ipairs(lines) do print(l) end`).split("\n");
  assert.deepEqual(out, [
    "How to do: Gnoll Pelts",
    "- Gnoll Pelt: 1/5",
    "  Learned: dropped by Rot Hide Gnoll, creature #1201 near 52.1, 30.4 (Silverpine Forest)",
    "- Kill Gnolls: 5/5 (done)",
  ]);
});

test("quest text validation is optional, bounded and backward compatible", () => {
  const base = { id: 1, title: "Q", complete: false, objectives: [] };
  assert.deepEqual(validateQuestData([base]), [base]);
  assert.deepEqual(validateQuestData([{ ...base, text: { description: "Go." } }])[0].text, { description: "Go." });
  for (const text of [{}, { description: "" }, { description: "x".repeat(1201) }, { objectives: "y".repeat(401) }, { description: "a\nb" }, { other: "x" }, "text"])
    assert.throws(() => validateQuestData([{ ...base, text }]), /Invalid/, JSON.stringify(text));
});

test("loot source validation is strict and bounded", () => {
  const good = { schemaVersion: 1, items: [{ itemId: 1, questIds: [2], lastSeen: "2023-11-14T22:13:20.000Z", sources: [{ kind: "creature", id: 3, count: 1, lastSeen: "2023-11-14T22:13:20.000Z" }] }] };
  assert.deepEqual(intel.validateLootSources(good), good);
  assert.equal(intel.validateLootSources(undefined), undefined);
  const bad = [
    { ...good, schemaVersion: 2 },
    { ...good, extra: 1 },
    { ...good, items: [{ ...good.items[0], questIds: [] }] },
    { ...good, items: [{ ...good.items[0], sources: [] }] },
    { ...good, items: [good.items[0], good.items[0]] },
    { ...good, items: [{ ...good.items[0], sources: [{ ...good.items[0].sources[0], kind: "item" }] }] },
    { ...good, items: [{ ...good.items[0], sources: [{ ...good.items[0].sources[0], positions: [{ mapId: 1, x: 2, y: 0 }] }] }] },
    { ...good, items: [{ ...good.items[0], sources: Array.from({ length: 13 }, (_, i) => ({ ...good.items[0].sources[0], id: i + 1 })) }] },
    { ...good, items: [{ ...good.items[0], sources: [{ ...good.items[0].sources[0], positions: Array.from({ length: 9 }, () => ({ mapId: 1, x: 0, y: 0 })) }] }] },
    { ...good, items: Array.from({ length: 201 }, (_, i) => ({ ...good.items[0], itemId: i + 1 })) },
    { ...good, items: [{ ...good.items[0], lastSeen: 1700000000 }] },
  ];
  for (const value of bad) assert.throws(() => intel.validateLootSources(value), /Invalid/);
  assert.throws(() => validateState({ ...defaultState(), profiles: [{ id: "p", name: "A", realm: "", className: "", level: 1, notes: "", goals: [], lootSources: bad[0] }] }));
});

test("quest details and companion tools return quest text and learned item sources only when present", async () => {
  const { registerKnowledgeHandlers } = require("../src/core/knowledge-ipc.cjs");
  const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const { createCompanionTools } = require("../src/core/companion-tools.cjs");
  const index = new KnowledgeIndex(structuredClone(require("../data/forever/pack.json")));
  const stamp = "2023-11-14T22:13:20.000Z";
  const learned = { schemaVersion: 1, items: [{ itemId: 268801, name: "Bottle of Whispering Elixir", questIds: [95314], lastSeen: stamp, sources: [{ kind: "object", id: 178084, name: "Bottle Crate", count: 2, lastSeen: stamp, positions: [{ mapId: 1431, x: 0.094, y: 0.678 }] }] }] };
  const plain = { id: "p", name: "A", className: "Mage", level: 30, quests: [{ id: 95314, title: "That Shadowvale Green Elixir", complete: false, objectives: [{ text: "Bottle of Whispering Elixir: 3/8", done: false }] }] };
  const rich = { ...plain, quests: [{ ...plain.quests[0], text: { description: "Travel to the ruins of Shadowvale and recover some bottles." } }], lootSources: learned };
  const details = (profile) => {
    const handlers = {};
    registerKnowledgeHandlers({ handle: (n, fn) => (handlers[n] = fn), knowledge: { setContext() {}, index: () => index }, getState: () => ({ profiles: [profile], activeProfileId: profile.id }), connected: () => false, clipboard: { writeText() {} } });
    return handlers.questDetails(profile.id, 95314);
  };
  const before = details(plain), after = details(rich);
  assert.equal("questText" in before, false);
  assert.equal("itemSources" in before, false);
  assert.deepEqual(after.questText, rich.quests[0].text);
  assert.deepEqual(after.itemSources, [{ itemId: 268801, name: "Bottle of Whispering Elixir", lastSeen: stamp, sources: learned.items[0].sources }]);
  const { questText, itemSources, ...rest } = after;
  { const strip = (o) => { const c = { ...o }; delete c.howTo; return c; }; assert.deepEqual(strip(rest), strip(before), "nothing else changes (the how-to reflects the new data)"); }

  const tools = (profile) => createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index });
  const q0 = JSON.parse(await tools(plain).call("get_quest", { quest_id: 95314 }));
  assert.equal("questText" in q0, false);
  const q = JSON.parse(await tools(rich).call("get_quest", { quest_id: 95314 }));
  assert.equal(q.questText.description, "Travel to the ruins of Shadowvale and recover some bottles.");
  assert.equal(q.itemSources[0].sources[0].how, "picked up from an object");
  assert.equal(q.itemSources[0].sources[0].locations[0].zone, "Duskwood");
  assert.equal(q.itemSources[0].sources[0].locations[0].x, 9.4);
  const item = JSON.parse(await tools(rich).call("find_item", { id: 268801 }));
  assert.equal(item.items[0].itemSources[0].name, "Bottle Crate");
  const hidden = JSON.parse(await createCompanionTools({ profile: rich, shareProfile: false, knowledgeIndex: index }).call("get_quest", { quest_id: 95314 }));
  assert.equal("questText" in hidden, false, "unshared characters reveal nothing");
  // The shared character context leaves the long quest text to the per-quest lookup.
  assert.equal("text" in require("../src/core/providers.cjs").approvedProfile(rich).quests[0], false);
});

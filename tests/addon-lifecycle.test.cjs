"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const fixture = String.raw`
local handler
local registered={}
CreateFrame=function()return {RegisterEvent=function(_,event)registered[event]=true end,SetScript=function(_,_,fn)handler=fn end}end
InCombatLockdown=function()return false end
local who='Synthetic-Hunter'
local xp,max,rested=189,14400,1730
local completed={11,22,33}
local objectiveCount=2
local reads=0
UnitGUID=function()reads=reads+1;return who end
UnitFullName=function()return who,'Synthetic Realm'end
UnitClass=function()return who=='Synthetic-Hunter' and 'Hunter' or 'Warrior'end
UnitLevel=function()return 18 end
GetZoneText=function()return 'Synthetic Forest'end
GetSubZoneText=function()return 'Camp'end
UnitXP=function()return xp end
UnitXPMax=function()return max end
GetXPExhaustion=function()return rested end
local now=1700000000
time=function()now=now+1;return now end
C_QuestLog={
 GetNumQuestLogEntries=function()return 1,1 end,
 GetInfo=function()return {isHeader=false,questID=42,title='Synthetic quest'}end,
 IsComplete=function()return false end,
 GetQuestObjectives=function()return objectiveCount==0 and {} or {{text='Observed objective',finished=false,type='monster',numRequired=4,numFulfilled=objectiveCount}}end,
 GetAllCompletedQuestIDs=function()return completed end
}
local function load()dofile('addon/BackstageForever/BackstageForever.lua')end
local function event(name)handler(nil,name)end
local function teardown()xp=0;max=0;rested=0;completed={};objectiveCount=0 end
load();event('PLAYER_LOGIN')
local first=BackstageForeverExport
assert(first:find('"current":189',1,true))
`;

function runLua(scenario) {
  const result = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], {
    cwd: path.join(__dirname, ".."), input: fixture + scenario, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.trim().split(/\r?\n/).map(JSON.parse);
}

test("pre-login events preserve the saved roster until login restores it and adds the second character", () => {
  const [saved, second, third] = runLua(String.raw`
who='Synthetic-Warrior';load()
reads=0
for _,name in ipairs({'QUEST_LOG_UPDATE','PLAYER_XP_UPDATE','BAG_UPDATE_DELAYED','GET_ITEM_INFO_RECEIVED','PLAYER_REGEN_ENABLED','PLAYER_ENTERING_WORLD'})do
 event(name)
 assert(BackstageForeverExport==first,'Pre-login '..name..' overwrote the saved roster')
end
assert(reads==0,'Pre-login events must not query player capture APIs')
event('PLAYER_LOGIN')
print(first);print(BackstageForeverExport)
local both=BackstageForeverExport
who='Synthetic-Third';load();reads=0
event('QUEST_LOG_UPDATE');assert(BackstageForeverExport==both,'Pre-login event replaced a two-character roster')
assert(reads==0)
event('PLAYER_LOGIN');print(BackstageForeverExport)
`);
  assert.equal(saved.characters.length, 1);
  assert.equal(second.characters.length, 2);
  assert.equal(second.activeId, "Synthetic-Warrior");
  assert.deepEqual(second.characters.find(c => c.id === "Synthetic-Hunter"), saved.characters[0]);
  assert.equal(third.characters.length, 3);
});

test("logout and post-logout zero APIs preserve prepared progress and both characters across a fresh login", () => {
  const [prepared, next] = runLua(String.raw`
who='Synthetic-Warrior';load();event('PLAYER_LOGIN')
handler(nil,'QUEST_TURNED_IN',42)
local before=BackstageForeverExport
teardown();reads=0
event('PLAYER_LOGOUT');assert(BackstageForeverExport==before,'Logout overwrote prepared XP/objectives/completed IDs')
for _,name in ipairs({'QUEST_LOG_UPDATE','PLAYER_XP_UPDATE','ZONE_CHANGED_NEW_AREA','PLAYER_ENTERING_WORLD','PLAYER_REGEN_ENABLED'})do
 event(name);assert(BackstageForeverExport==before,'Post-logout '..name..' overwrote prepared data')
end
assert(reads==0,'Logout and post-logout events must not query player capture APIs')
print(before)
who='Synthetic-Hunter';xp=2362;max=11400;rested=88;completed={11,22,33,44};objectiveCount=3
load();event('QUEST_LOG_UPDATE');assert(BackstageForeverExport==before)
event('PLAYER_LOGIN');print(BackstageForeverExport)
`);
  assert.equal(prepared.characters.length, 2);
  assert.equal(prepared.characters.find(c => c.id === "Synthetic-Warrior").history.recent[0].id, 42);
  for (const c of prepared.characters) {
    assert.deepEqual(c.progress, { current: 189, max: 14400, rested: 1730 });
    assert.deepEqual(c.history.completedIds, [11, 22, 33]);
    assert.equal(c.quests[0].objectives[0].fulfilled, 2);
  }
  assert.equal(next.characters.length, 2);
  assert.equal(next.activeId, "Synthetic-Hunter");
  assert.deepEqual(next.characters.find(c => c.id === "Synthetic-Warrior"), prepared.characters.find(c => c.id === "Synthetic-Warrior"));
  assert.equal(next.characters.find(c => c.id === "Synthetic-Hunter").progress.current, 2362);
});

test("entering world refreshes valid data and keeps genuine zero XP observations while logged in", () => {
  const [refreshed, zero] = runLua(String.raw`
assert(registered.PLAYER_ENTERING_WORLD,'World-entry refresh event must be registered')
xp=250;event('PLAYER_ENTERING_WORLD');print(BackstageForeverExport)
teardown();event('PLAYER_XP_UPDATE');print(BackstageForeverExport)
`);
  assert.equal(refreshed.characters[0].progress.current, 250);
  assert.deepEqual(zero.characters[0].progress, { current: 0, max: 0, rested: 0 });
  assert.deepEqual(zero.characters[0].quests[0].objectives, []);
  assert.deepEqual(zero.characters[0].history.completedIds, []);
});

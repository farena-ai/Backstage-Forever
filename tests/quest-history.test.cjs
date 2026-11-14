const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateHistory,
  validateQuestData,
} = require("../src/core/quest-data.cjs");
const { approvedProfile } = require("../src/core/providers.cjs");
const { buildBrief } = require("../src/core/adventure.cjs");
test("history is bounded observed turnins and destinations are validated", () => {
  assert.equal(validateHistory(undefined), undefined);
  assert.deepEqual(validateHistory({ recent: [] }), { recent: [] });
  assert.throws(() => validateHistory({ recent: [], completedCount: 20001 }));
  assert.throws(() => validateHistory({ recent: Array(26).fill({}) }));
  const history = {
    completedCount: 50,
    recent: Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      title: "Observed",
      completedAt: 1700000000,
    })),
  };
  const quests = [
    {
      id: 1,
      title: "Actual",
      complete: false,
      objectives: [],
      destination: { mapId: 1, x: 0.2, y: 0.5, text: "Actual waypoint" },
    },
  ];
  assert.deepEqual(validateQuestData(quests), quests);
  assert.throws(() =>
    validateQuestData([
      { ...quests[0], destination: { mapId: 1, x: 2, y: 0 } },
    ]),
  );
  const p = { history, quests, notes: "PRIVATE", source: { id: "PRIVATE" } };
  assert.equal(approvedProfile(p).history.recent.length, 10);
  assert.doesNotMatch(JSON.stringify(approvedProfile(p)), /PRIVATE/);
  assert.equal(buildBrief(p).history.completedCount, 50);
  assert.equal(buildBrief({}).history.known, false);
  assert.equal(buildBrief({ history: { recent: [] } }).history.known, true);
});
test("Lua records actual turnin, persists history, guards secrets and count bounds", () => {
  const { spawnSync } = require("node:child_process");
  const cli = require.resolve("fengari-node-cli/src/lua-cli.js");
  const r = spawnSync(process.execPath, [cli, "-"], {
    cwd: require("node:path").join(__dirname, ".."),
    encoding: "utf8",
    timeout: 20000,
    input: String.raw`
local handler
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end}end
issecretvalue=function(v)return v=='SECRET'end
InCombatLockdown=function()return false end
UnitGUID=function()return 'Player-test'end
UnitFullName=function()return 'Test','Realm'end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 10 end
time=function()return 1700000000 end
C_QuestLog={GetNumQuestLogEntries=function()return 1 end,GetInfo=function()return {isHeader=false,questID=42,title='Real title'}end,IsComplete=function()return true end,GetQuestObjectives=function()return {}end,GetNextWaypoint=function()return 1,.2,.3 end,GetNextWaypointText=function()return 'Actual destination'end,GetAllCompletedQuestIDs=function()return {10,20}end}
dofile('addon/BackstageForever/BackstageForever.lua');handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('"completedCount":2',1,true));assert(BackstageForeverExport:find('Actual destination',1,true))
assert(not BackstageForeverExport:find('"completedAt"',1,true))
handler(nil,'QUEST_TURNED_IN',42)
assert(BackstageForeverExport:find('"completedAt":1700000000',1,true))
C_QuestLog.GetNumQuestLogEntries=function()return 0 end
C_QuestLog.GetAllCompletedQuestIDs=function()local t={}for i=1,20001 do t[i]=i end return t end
handler(nil,'QUEST_LOG_UPDATE');assert(not BackstageForeverExport:find('completedCount',1,true))
dofile('addon/BackstageForever/BackstageForever.lua');handler(nil,'PLAYER_LOGIN');assert(BackstageForeverExport:find('Real title',1,true))
local touched=false;local secret=setmetatable({},{__pairs=function()touched=true;error('secret')end})
issecretvalue=function(v)return v==secret or v=='SECRET'end
C_QuestLog.GetAllCompletedQuestIDs=function()return secret end
handler(nil,'QUEST_LOG_UPDATE');assert(not touched)
local old=BackstageForeverExport
InCombatLockdown=function()return true end
handler(nil,'QUEST_TURNED_IN',42);assert(old==BackstageForeverExport)
`,
  });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
});
test("newer missing history clears unknown while stale imports preserve observation", () => {
  const { defaultState } = require("../src/core/validation.cjs");
  const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
  const mk = (updatedAt, history) => ({
    id: "player",
    name: "A",
    realm: "R",
    className: "Mage",
    level: 1,
    updatedAt,
    ...(history === undefined ? {} : { history }),
  });
  const snap = (c) => ({
    characters: [c],
    activeId: "player",
    observedAt: c.updatedAt,
  });
  let s = mergeSnapshot(
    defaultState(),
    snap(mk("2026-01-02T00:00:00.000Z", { recent: [] })),
  );
  s = mergeSnapshot(s, snap(mk("2026-01-01T00:00:00.000Z")));
  assert.deepEqual(s.profiles[0].history, { recent: [] });
  s = mergeSnapshot(s, snap(mk("2026-01-03T00:00:00.000Z")));
  assert.equal(s.profiles[0].history, undefined);
});

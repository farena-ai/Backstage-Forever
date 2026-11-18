"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");

const root = path.join(__dirname, "..");
const addon = "addon/BackstageForever/";
const modules = fs.readFileSync(path.join(root, addon, "BackstageForever.toc"), "utf8")
  .split(/\r?\n/).filter((line) => /^\w+\.lua$/.test(line));
const world = String.raw`
local frames,timers={},{}
CreateFrame=function()
    local f={events={}}
    function f:RegisterEvent(e) self.events[e]=true end
    function f:SetScript(script,fn) if script=='OnEvent' then self.handler=fn end end
    frames[#frames+1]=f
    return f
end
local function fire(e,...) for _,f in ipairs(frames) do if f.events[e] and f.handler then f.handler(f,e,...) end end end
C_Timer={After=function(delay,fn) if delay==.25 then timers[#timers+1]=fn end end}
local t,who,name=1700000000,'Player-one','Example'
local standing,hide,build,money=5,false,'12345',123
local reads=0
local function unavailable() reads=reads+1;error('API unavailable at logout') end
time=function() return t end
GetTime=function() return t-1699999000 end
UnitGUID=function() return who end
UnitFullName=function() return name,'Test Realm' end
UnitClass=function() return 'Mage','MAGE',8 end
UnitLevel=function() return 20 end
UnitFactionGroup=function() return 'Alliance','Alliance' end
GetZoneText=function() return 'Test Zone' end
GetMoney=function() return money end
GetBuildInfo=function() return '1.15.2',build end
InCombatLockdown=function() return false end
IsInInstance=function() return true,'party' end
GetInstanceInfo=function() return 'Instance','party',1,'Normal',5,false,false,36 end
GetNumFactions=function() return hide and 1 or 2 end
GetFactionInfo=function(i)
    if i==1 then return 'Stormwind',nil,standing,0,21000,10000,false,false,false,false,false,false,false,72 end
    return 'Ironforge',nil,6,9000,21000,10000,false,false,false,false,false,false,false,47
end
BackstageForeverMomentsSettings={toasts=false}
`;
function replay(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], {
    cwd: root, input: [world, ...modules.map((file) => `dofile(${JSON.stringify(addon + file)})`),
      "BackstageForeverToast=function() end", source].join("\n"),
    encoding: "utf8", timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return r.stdout.trim().split(/\r?\n/);
}
const parseExport = (json) => parseSavedVariables(`BackstageForeverExport = [=[${json}]=]`);

test("immediate logout patches only recorded reputation and encounter evidence into the prepared export", () => {
  const [beforeJson, afterJson] = replay(String.raw`
    who,name='Player-alt','Alt'
    fire('PLAYER_LOGIN')
    who,name='Player-one','Example'
    BackstageForeverLedgerDB={}
    fire('PLAYER_LOGIN')
    fire('PLAYER_ENTERING_WORLD')
    local before,queued=BackstageForeverExport,#timers
    print(before)
    t=t+1;standing=6;hide=true;build='55555';money=999
    fire('UPDATE_FACTION')
    assert(#timers==queued+1,'faction update did not queue a capture')
    assert(BackstageForeverLedgerDB.reputations[72].standing==6,'standing was not recorded')
    t=t+1
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    assert(#timers==queued+1 and BackstageForeverExport==before,'coalesced capture ran early')
    time,GetTime,UnitGUID,UnitFullName,GetBuildInfo,GetMoney,GetNumFactions,GetFactionInfo,InCombatLockdown=
        unavailable,unavailable,unavailable,unavailable,unavailable,unavailable,unavailable,unavailable,unavailable
    fire('PLAYER_LOGOUT')
    local saved=BackstageForeverExport
    for _,fn in ipairs(timers) do fn() end
    assert(reads==0,'logout or retired callbacks queried live APIs')
    assert(BackstageForeverExport==saved,'retired capture rewrote logout export')
    print(saved)
  `);
  const before = parseExport(beforeJson), after = parseExport(afterJson);
  const old = before.characters.find((c) => c.id === before.activeId);
  const current = after.characters.find((c) => c.id === after.activeId);
  const { ledger: { reputations, ...ledger }, journal: { encounters, ...journal }, ...character } = current;
  const { reputations: oldReps, ...oldLedger } = old.ledger;
  const updatedAt = new Date(1700000002 * 1000).toISOString();
  assert.equal(after.activeId, before.activeId);
  assert.equal(after.observedAt, updatedAt);
  assert.deepEqual({ ...character, ledger, journal }, { ...old, ledger: oldLedger, updatedAt });
  assert.deepEqual(after.characters.find((c) => c.name === "Alt"), before.characters.find((c) => c.name === "Alt"));
  assert.equal(reputations.seenAt, 1700000001);
  assert.deepEqual(reputations.factions[0], oldReps.factions[0], "hidden faction was not observed again");
  assert.deepEqual(reputations.factions[1], { ...oldReps.factions[1], standing: 6, observedAt: 1700000001, observedBuild: "1.15.2.55555" });
  assert.equal(encounters[0].encounterId, 1144);
});

test("reputation alone advances the export time to the latest faction observation, not logout", () => {
  const [json] = replay(String.raw`
    fire('PLAYER_LOGIN')
    t=t+1;standing=6
    fire('UPDATE_FACTION')
    t=t+1;standing=7
    fire('UPDATE_FACTION')
    t=t+100
    fire('PLAYER_LOGOUT')
    print(BackstageForeverExport)
  `);
  const after = parseExport(json);
  const at = 1700000002;
  assert.equal(after.observedAt, new Date(at * 1000).toISOString());
  assert.equal(after.characters[0].updatedAt, after.observedAt);
  assert.equal(after.characters[0].ledger.reputations.factions.find((f) => f.id === 72).standing, 7);
});

test("a faction update without a prepared capture for this session leaves the prior export intact", () => replay(String.raw`
    fire('PLAYER_LOGIN')
    fire('PLAYER_LOGOUT')
    local before=BackstageForeverExport
    BackstageForeverLedgerDB={}
    who,name='Player-alt','Alt'
    InCombatLockdown=function() return true end
    fire('PLAYER_LOGIN')
    t=t+1;standing=6
    fire('UPDATE_FACTION')
    fire('PLAYER_LOGOUT')
    assert(BackstageForeverExport==before,'reputation was written into a previous session export')
    assert(BackstageForeverLedgerDB.reputations[72].standing==6,'native evidence was lost')
`));

test("an oversized reputation patch leaves the prior export and native evidence intact", () => replay(String.raw`
    hide=true
    local function seed(bytes)
        BackstageForeverExport='{"schema":1,"characters":[{"id":"alt","updatedAt":1699999999,"padding":"'
            ..string.rep('x',bytes)..'"}]}'
    end
    seed(0)
    fire('PLAYER_LOGIN')
    fire('PLAYER_LOGIN')
    seed(1048576-#BackstageForeverExport-16)
    fire('PLAYER_LOGIN')
    local before=BackstageForeverExport
    assert(#before==1048576-16,'prepared export did not reach the intended budget: '..#before)
    t=t+1;standing=6;hide=false
    fire('UPDATE_FACTION')
    fire('PLAYER_LOGOUT')
    assert(BackstageForeverExport==before,'oversized reputation patch replaced the last valid export')
    assert(BackstageForeverLedgerDB.reputations[47].observedAt==t,'native evidence was lost')
`));

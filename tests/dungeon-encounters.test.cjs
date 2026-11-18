"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { Store } = require("../src/core/store.cjs");

const addonPath = "addon/BackstageForever/";
const toc = fs.readFileSync(path.join(__dirname, "..", addonPath, "BackstageForever.toc"), "utf8");
const addonLua = toc.split(/\r?\n/).filter((line) => /^[\w]+\.lua$/.test(line));

const LUA = String.raw`
local frames={}
CreateFrame=function()
    local f={events={}}
    function f:RegisterEvent(e) self.events[e]=true end
    function f:SetScript(script,fn) if script=='OnEvent' then self.handler=fn end end
    frames[#frames+1]=f
    return f
end
local function fire(e,...) for _,f in ipairs(frames) do if f.events[e] and f.handler then f.handler(f,e,...) end end end
local t=1700000000
local who, name='Player-example-one','Example'
local map,kind=36,'party'
time=function() return t end
GetTime=function() return t-1699999000 end
UnitGUID=function(unit) if unit=='player' then return who end end
UnitFullName=function() return name,'Example Realm' end
UnitClass=function() return 'Mage','MAGE',8 end
UnitLevel=function() return 20 end
UnitRace=function() return 'Human','Human',1 end
UnitFactionGroup=function() return 'Alliance','Alliance' end
GetZoneText=function() return 'Test Zone' end
GetSubZoneText=function() return '' end
IsInInstance=function() return kind=='party' or kind=='raid',kind end
GetInstanceInfo=function() return 'Instance',kind,1,'Normal',5,false,false,map end
InCombatLockdown=function() return false end
issecretvalue=function(v) return v=='SECRET' end
local function loadAddon()
    frames={}
    dofile('addon/BackstageForever/BackstageForever.lua')
    dofile('addon/BackstageForever/BackstageForeverJournal.lua')
    dofile('addon/BackstageForever/BackstageForeverMoments.lua')
    fire('PLAYER_LOGIN')
end
local function emit() print(BackstageForeverExport) end
`;

function runLuaOutput(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], {
    cwd: path.join(__dirname, ".."), input: LUA + source, encoding: "utf8", timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return r.stdout.trim().split(/\r?\n/);
}

const parseExport = (json) => parseSavedVariables(`BackstageForeverExport = [=[${json}]=]`);
const runLua = (source) => runLuaOutput(source).map(parseExport);
const fixtureDir = (t) => {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf-encounters-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const encounter = { encounterId: 1144, name: "Edwin VanCleef", instanceMap: 36, instanceType: "party", difficultyId: 1, at: 1700000001 };

test("logout exports a recorded encounter before the queued capture can run", (t) => {
  const loadToc = addonLua.map((file) => `dofile(${JSON.stringify(addonPath + file)})`).join("\n");
  const [beforeJson, logoutJson] = runLuaOutput(String.raw`
    local timers={}
    C_Timer={After=function(delay,fn) if delay==.25 then timers[#timers+1]=fn end end}
    BackstageForeverMomentsSettings={toasts=false}
    BackstageForeverJournalDB={levels={{level=20,at=t}}}
  ` + loadToc + String.raw`

    BackstageForeverToast=function() end -- No UI widgets in the Lua replay.
    fire('PLAYER_LOGIN')
    who,name='Player-example-two','Alt'
    fire('PLAYER_LOGIN')
    who,name='Player-example-one','Example'
    fire('PLAYER_LOGIN')
    local before=BackstageForeverExport
    emit()
    local queued=#timers
    t=t+1
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    assert(#timers==queued+1,'encounter did not schedule a capture')
    assert(BackstageForeverJournalDB.encounters[1].encounterId==1144,'win was not recorded')
    assert(BackstageForeverExport==before,'queued capture ran early')
    fire('TIME_PLAYED_MSG',120,60) -- Unrelated journal changes are not part of the fallback.
    assert(BackstageForeverJournalDB.levels[1].played==120,'played time did not update the live journal')
    local reads=0
    local function unavailable() reads=reads+1;error('API unavailable at logout') end
    time,GetTime,UnitGUID,UnitFullName,UnitLevel,GetInstanceInfo,InCombatLockdown=
        unavailable,unavailable,unavailable,unavailable,unavailable,unavailable,unavailable
    fire('PLAYER_LOGOUT')
    local saved=BackstageForeverExport
    for _,fn in ipairs(timers) do fn() end
    assert(reads==0,'logout or retired capture queried live APIs')
    assert(BackstageForeverExport==saved,'retired timer overwrote logout export')
    emit()
  `);
  const before = parseExport(beforeJson), after = parseExport(logoutJson);
  const player = after.characters.find((c) => c.id === after.activeId);
  const previous = before.characters.find((c) => c.id === before.activeId);
  assert.equal(after.activeId, before.activeId);
  assert.equal(player.name, "Example");
  assert.deepEqual(player.journal?.encounters, [encounter]);
  const { encounters, ...journal } = player.journal;
  const observedAt = new Date(encounter.at * 1000).toISOString();
  assert.deepEqual({ ...player, journal }, { ...previous, updatedAt: observedAt });
  assert.equal(after.observedAt, observedAt);
  assert.deepEqual(after.characters.find((c) => c.name === "Alt"), before.characters.find((c) => c.name === "Alt"));

  const directory = fixtureDir(t);
  const store = new Store(directory);
  store.saveState(mergeSnapshot(mergeSnapshot(store.state, before), after));
  const reopened = new Store(directory).state;
  const profile = reopened.profiles.find((p) => p.id === reopened.activeProfileId);
  assert.deepEqual(buildAtlas({ profile }).recap.encounters, [
    { ...encounter, atlasId: "dm", atlasName: "The Deadmines" },
  ]);
});

test("a pending win cannot update a previous character's export when the new login capture fails", () => {
  const [before, after] = runLuaOutput(String.raw`
    C_Timer={After=function() end}
    loadAddon()
    emit()
    fire('PLAYER_LOGOUT')
    BackstageForeverJournalDB={}
    who,name='Player-example-two','Alt'
    InCombatLockdown=function() return true end
    fire('PLAYER_LOGIN')
    t=t+1
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    assert(#BackstageForeverJournalDB.encounters==1,'alt win was not recorded')
    fire('PLAYER_LOGOUT')
    emit()
  `);
  assert.equal(after, before);
});

test("logout keeps the last valid export when adding the pending win would exceed the byte budget", () => {
  runLuaOutput(String.raw`
    C_Timer={After=function() end}
    -- One opaque field on a restored alt fills the budget but leaves room to capture the player.
    local function seed(bytes)
        BackstageForeverExport='{"schema":1,"characters":[{"id":"alt","updatedAt":1699999999,"padding":"'
            ..string.rep('x',bytes)..'"}]}'
    end
    seed(0)
    loadAddon()
    local base=#BackstageForeverExport
    seed(1048576-base-16)
    fire('PLAYER_LOGIN')
    local before=BackstageForeverExport
    assert(#before==1048576-16,'prepared export did not reach the intended budget')
    t=t+1
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    fire('PLAYER_LOGOUT')
    assert(BackstageForeverExport==before,'oversized logout export replaced the last valid export')
    assert(#BackstageForeverJournalDB.encounters==1,'budget guard discarded native encounter history')
  `);
});

test("a public encounter win is exported with boss toasts off and survives a fresh Lua session", (t) => {
  const [beforeJson, afterJson, savedJournal] = runLuaOutput(String.raw`
    BackstageForeverMomentsSettings={toasts=false}
    loadAddon()
    fire('PLAYER_ENTERING_WORLD')
    emit()
    t=t+1
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    emit()
    fire('PLAYER_LOGOUT')
    local function serialize(v)
        if type(v)=='table' then
            local items={}
            for k,x in pairs(v) do items[#items+1]='['..serialize(k)..']='..serialize(x) end
            return '{'..table.concat(items,',')..'}'
        end
        if type(v)=='string' then return string.format('%q',v) end
        return tostring(v)
    end
    print('BackstageForeverJournalDB='..serialize(BackstageForeverJournalDB))
  `);
  const before = parseExport(beforeJson), after = parseExport(afterJson);
  const directory = fixtureDir(t), accountFile = path.join(directory, "account.lua"), toonFile = path.join(directory, "character.lua");
  fs.writeFileSync(accountFile, `BackstageForeverExport = [=[${afterJson}]=]`);
  fs.writeFileSync(toonFile, savedJournal);
  const loadAccount = `\ndofile(${JSON.stringify(accountFile)})\n`;
  const [reloaded] = runLua(loadAccount + `dofile(${JSON.stringify(toonFile)})\n` + String.raw`
    t=t+2
    loadAddon()
    fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
    emit()
  `);
  const [other] = runLua(loadAccount + String.raw`
    t=t+3
    who,name='Player-example-two','Alt'
    loadAddon()
    emit()
  `);
  assert.equal(before.characters[0].journal?.encounters, undefined, "entering is not an encounter win");
  assert.deepEqual(after.characters[0].journal?.encounters, [encounter]);
  assert.deepEqual(reloaded.characters[0].journal?.encounters, [encounter], "duplicate after reload does not add a win");
  assert.equal(other.characters.find((c) => c.name === "Alt").journal?.encounters, undefined);
  assert.deepEqual(other.characters.find((c) => c.name === "Example").journal?.encounters, [encounter]);
});

test("a successful raid encounter in combat reaches the next guarded export", () => {
  const [during, after] = runLua(String.raw`
    map,kind=409,'raid'
    loadAddon()
    t=t+1
    InCombatLockdown=function() return true end
    fire('ENCOUNTER_END',672,'Ragnaros',9,40,1)
    emit()
    t=t+1
    InCombatLockdown=function() return false end
    fire('PLAYER_REGEN_ENABLED')
    emit()
  `);
  assert.equal(during.characters[0].journal?.encounters, undefined);
  assert.deepEqual(after.characters[0].journal.encounters, [
    { encounterId: 672, name: "Ragnaros", instanceMap: 409, instanceType: "raid", difficultyId: 9, at: 1700000001 },
  ]);
});

test("wipes, overworld events and unavailable or secret encounter data produce no history", () => {
  const [capture] = runLua(String.raw`
    loadAddon()
    local valid=GetInstanceInfo
    t=t+1
    fire('ENCOUNTER_END',1144,'Wipe',1,5,0)
    fire('ENCOUNTER_END',1144,'Unknown result',1,5,'SECRET')
    fire('ENCOUNTER_END',1144,'SECRET',1,5,1)
    fire('ENCOUNTER_END',1144.5,'Invalid ID',1,5,1)
    fire('ENCOUNTER_END',1144,'Invalid difficulty',-1,5,1)
    kind='none'
    fire('ENCOUNTER_END',1144,'Outdoor boss',1,5,1)
    kind='party'; map='SECRET'
    fire('ENCOUNTER_END',1144,'Restricted instance',1,5,1)
    GetInstanceInfo=function() error('unavailable') end
    fire('ENCOUNTER_END',1144,'Missing instance',1,5,1)
    GetInstanceInfo=valid
    fire('PLAYER_ENTERING_WORLD')
    emit()
  `);
  assert.equal(capture.characters[0].journal?.encounters, undefined);
});

test("distinct wins within the toast cooldown and repeat kills are retained in a bounded history", () => {
  const [capture] = runLua(String.raw`
    loadAddon()
    t=t+1
    for i=1,101 do fire('ENCOUNTER_END',i,'Boss '..i,1,5,1) end
    t=t+10
    fire('ENCOUNTER_END',101,'Boss 101',1,5,1)
    emit()
  `);
  const history = capture.characters[0].journal.encounters;
  assert.equal(history.length, 100);
  assert.equal(history[0].encounterId, 3);
  assert.deepEqual(history.slice(-2).map((e) => [e.encounterId, e.at]), [[101, 1700000001], [101, 1700000011]]);
});

const saved = (journal) => `BackstageForeverExport = [=[${JSON.stringify({
  schema: 1, activeId: "Player-example-one", observedAt: 1700000020,
  characters: [{ id: "Player-example-one", name: "Example", realm: "Example Realm", className: "Mage", level: 20, updatedAt: 1700000020, journal }],
})}]=]`;

test("the parser ignores invalid optional encounter history without discarding the rest of the journal", () => {
  const levels = [{ level: 20, at: 1700000000 }];
  for (const encounters of [null, {}, [{ ...encounter, instanceType: "none" }],
    [{ ...encounter, at: 0 }], [{ ...encounter, name: "a\n" }], [{ ...encounter, instanceMap: "36" }],
    [{ ...encounter, encounterId: 0 }], [{ ...encounter, difficultyId: 0.5 }], Array(101).fill(encounter)]) {
    const journal = parseSavedVariables(saved({ levels, encounters })).characters[0].journal;
    assert.deepEqual(journal?.levels, levels);
    assert.equal(journal?.encounters, undefined);
  }
});

test("the Atlas recap is saved character evidence, newest first, separate from reference observations", (t) => {
  const directory = fixtureDir(t);
  const store = new Store(directory);
  const unknown = { ...encounter, encounterId: 99, name: "Unknown boss", instanceMap: 98765, at: 1700000002 };
  const shared = { ...encounter, encounterId: 100, name: "Unknown wing", instanceMap: 229, at: 1700000003 };
  const snapshot = parseSavedVariables(saved({ encounters: [encounter, shared, { ...unknown, privateField: "ignored" }, encounter] }));
  store.saveState(mergeSnapshot(store.state, snapshot));
  const reopened = new Store(directory).state;
  const profile = reopened.profiles.find((p) => p.id === reopened.activeProfileId);
  const community = { attribution: "Reference", encounters: [{ instanceMap: 36, name: encounter.name, kills: 50, runs: 20 }] };
  const atlas = buildAtlas({ profile, encounters: community });
  assert.equal(atlas.recap.profileId, reopened.activeProfileId);
  assert.deepEqual(atlas.recap.encounters, [
    { ...shared, atlasId: null, atlasName: null },
    { ...unknown, atlasId: null, atlasName: null },
    { ...encounter, atlasId: "dm", atlasName: "The Deadmines" },
  ]);
  assert.equal(atlas.entries.find((e) => e.id === "dm").observedRuns, 20, "reference counts stay separate");
  assert.deepEqual(buildAtlas({ profile: { location: { mapId: 36 }, journal: { firsts: [{ key: "dungeon", at: 2 }] } }, encounters: community }).recap.encounters, []);
});

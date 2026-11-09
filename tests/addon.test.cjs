const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
test("addon declares real loader/export and only guarded event snapshots", () => {
  const dir = path.join(__dirname, "../addon/BackstageForever");
  const toc = fs.readFileSync(path.join(dir, "BackstageForever.toc"), "utf8"),
    lua = fs.readFileSync(path.join(dir, "BackstageForever.lua"), "utf8");
  assert.match(toc, /## Interface: 16001/);
  assert.match(toc, /## SavedVariables: BackstageForeverExport/);
  for (const token of [
    "issecretvalue",
    "pcall",
    "InCombatLockdown",
    "PLAYER_LOGIN",
    "PLAYER_LEVEL_UP",
    "ZONE_CHANGED_NEW_AREA",
    "PLAYER_REGEN_ENABLED",
    "PLAYER_LOGOUT",
    "UnitGUID",
    "100",
  ])
    assert.ok(lua.includes(token), token);
  assert.doesNotMatch(
    lua,
    /C_Timer|ReloadUI|SendChatMessage|RunMacro|http:\/\//,
  );
});

test("addon executes persistence, combat, secret-value and unavailable API guards in Lua", (t) => {
  let cli;
  try {
    cli = require.resolve("fengari-node-cli/src/lua-cli.js");
  } catch {
    t.skip("Install fengari-node-cli to run Lua VM verification");
    return;
  }
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, [cli, "-"], {
    cwd: path.join(__dirname, ".."),
    input: LUA_HARNESS,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Addon runtime persistence/);
});
const LUA_HARNESS = String.raw`local handler
CreateFrame=function() return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end} end
issecretvalue=function(v) return v=='SECRET' end
InCombatLockdown=function() return false end
local who='Player-synthetic-one'
UnitGUID=function()return who end
UnitFullName=function()return 'Example','Example Realm' end
UnitClass=function()return 'Mage' end
UnitLevel=function()return 12 end
UnitRace=function()return 'Human' end
UnitFactionGroup=function()return 'Alliance' end
GetZoneText=function()return 'Test Zone' end
GetSubZoneText=function()return '' end
time=function()return 1700000000 end
C_Map={GetBestMapForUnit=function()return 1 end,GetPlayerMapPosition=function()return {GetXY=function()return .4,.5 end}end}
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('Player%-synthetic%-one'))
local first=BackstageForeverExport
who='Player-synthetic-two'
-- Simulate the next login with persisted JSON and a fresh addon roster.
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('Player%-synthetic%-one'))
assert(BackstageForeverExport:find('Player%-synthetic%-two'))
InCombatLockdown=function()return true end
local before=BackstageForeverExport
handler(nil,'PLAYER_LEVEL_UP');assert(before==BackstageForeverExport)
InCombatLockdown=function()return false end
UnitGUID=function()return 'SECRET' end
handler(nil,'PLAYER_REGEN_ENABLED');assert(before==BackstageForeverExport)
UnitGUID=function()error('unavailable')end
handler(nil,'PLAYER_LOGOUT');assert(before==BackstageForeverExport)
print('Addon runtime persistence/combat/secret/API guards passed')
`;

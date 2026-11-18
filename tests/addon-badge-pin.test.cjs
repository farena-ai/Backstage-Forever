"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function lua(input) {
    const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], {
      cwd: path.join(__dirname, ".."),
      input,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
}

for (const flow of ["pin and clear", "live evidence", "invalid choices", "refresh events", "durable completion", "completion without HUD"]) {
  test(`native Compass badge: ${flow}`, () =>
    lua(`dofile('tests/fixtures/addon-badge-pin.lua')(${JSON.stringify(flow)})`));
}

test("expanded Compass uses the level-up payload before UnitLevel catches up", () => {
  const hud = fs.readFileSync(path.join(__dirname, "addon-live.test.cjs"), "utf8")
    .match(/const hud=String.raw`([\s\S]*?)`;/)[1];
  lua(hud + String.raw`
UnitLevel=function()return 18 end
GetMoney=function()return 0 end
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
BackstageForeverBuildPreparation=function()return {text='Check your supplies'}end
BackstageForeverHUDUpdate(character)
SlashCmdList.BACKSTAGEFOREVER('show')
assert(text():find('Check your supplies',1,true),text())
SlashCmdList.BACKSTAGEFOREVER('badges pin level-30')
assert(text():find('Pinned: Level 30 18/30',1,true),text())
local journal=handlers[#handlers]
journal:OnEvent('PLAYER_LEVEL_UP',19)
assert(text():find('Pinned: Level 30 19/30',1,true),text())
BackstageForeverHUDUpdate(character)
assert(text():find('Pinned: Level 30 19/30',1,true),text())
SlashCmdList.BACKSTAGEFOREVER('badges clear')
assert(not text():find('Pinned:',1,true) and text():find('Check your supplies',1,true),text())
BackstageForeverBuildPreparation=nil
BackstageForeverHUDUpdate(character)
assert(text():find('Next badge: Level 20 19/20',1,true),text())
journal:OnEvent('PLAYER_LEVEL_UP',20)
assert(text():find('Next badge: Level 30 20/30',1,true),text())
`);
});

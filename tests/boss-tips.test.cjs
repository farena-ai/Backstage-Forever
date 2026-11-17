"use strict";
// 1.3 (J13): short boss tips on the Instance Atlas and in game.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const { TIPS, tipFor } = require("../src/core/boss-tips.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("tips are short, plain, have no timers, and every one names a boss the atlas knows", () => {
  const atlas = fs.readFileSync(path.join(root, "src/core/dungeon-atlas.cjs"), "utf8");
  for (const [boss, tip] of Object.entries(TIPS)) {
    assert.ok(tip.length <= 160, `${boss}: short`);
    assert.doesNotMatch(tip, /\b\d+\s*(s|sec|seconds|min)\b/i, `${boss}: no timers`);
    assert.ok(atlas.includes(`"${boss}"`), `${boss} is a boss in the atlas`);
  }
  assert.equal(tipFor("edwin vancleef"), TIPS["Edwin VanCleef"]);
  assert.equal(tipFor("Nobody"), null);
});

test("the atlas carries each boss's tip and the page shows it", () => {
  const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");
  const a = buildAtlas({});
  const dm = (a.entries || a.dungeons || a.instances || []).find((e) => e.id === "dm");
  assert.ok(dm, "Deadmines in the atlas");
  assert.match(dm.bosses.find((b) => b.name === "Mr. Smite").tip, /stuns everyone/);
  assert.match(fs.readFileSync(path.join(root, "src/renderer/dungeon-atlas.js"), "utf8"), /atlas-tip/);
});

test("the addon copy is generated from the same tips and loads in the TOC", () => {
  const lua = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverBossTips.lua"), "utf8");
  assert.equal((lua.match(/^\s+\['/gm) || []).length, Object.keys(TIPS).length, "regenerate with node scripts/build-boss-tips.cjs");
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /BackstageForeverBossTips\.lua/);
});

test("in game: the first time you target a boss a tip toasts once; /bf boss repeats it; off stops the toasts", () => lua(String.raw`
local handlers={}
CreateFrame=function() local f={RegisterEvent=function() end,SetScript=function(self,k,fn) self[k]=fn handlers[#handlers+1]=self end} return f end
local said,toasts={},{}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local target='Mr. Smite'
UnitName=function(u) return u=='target' and target or 'Me' end
UnitIsPlayer=function() return false end
dofile('addon/BackstageForever/BackstageForeverBossTips.lua')
dofile('addon/BackstageForever/BackstageForeverAssist.lua')
BackstageForeverToast=function(title,body) toasts[#toasts+1]=title..'|'..body end
BackstageForeverBossTarget() BackstageForeverBossTarget()
assert(#toasts==1 and toasts[1]:find('Boss: Mr. Smite|He stuns everyone',1,true),toasts[1])
BackstageForeverBossCommand('boss') assert(said[#said]:find('Mr. Smite: He stuns',1,true))
target='Hogger' BackstageForeverBossCommand('boss') assert(said[#said]:find('Target a dungeon boss first',1,true))
BackstageForeverBossCommand('boss off') target='Captain Greenskin' BackstageForeverBossTarget() assert(#toasts==1,'off: no toast')
BackstageForeverBossCommand('boss on') BackstageForeverBossTarget() assert(#toasts==2)
print('ok')
`));

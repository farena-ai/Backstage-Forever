"use strict";
// 1.3 (J13): short boss tips on the Instance Atlas and in game.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const { TIPS, tipFor } = require("../src/core/boss-tips.cjs");
const reviewedMoltenCore = [
  ["Lucifron", 12118, /Impending Doom/],
  ["Magmadar", 11982, /Tranquilizing Shot/],
  ["Gehennas", 12259, /Rain of Fire/],
  ["Garr", 12057, /Firesworn/],
  ["Shazzrah", 12264, /Shazzrah's Curse/],
  ["Baron Geddon", 12056, /Living Bomb/],
  ["Golemagg the Incinerator", 11988, /Magma Splash/],
  ["Sulfuron Harbinger", 12098, /Flamewaker Priests/],
  ["Majordomo Executus", 12018, /surrenders/],
];
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

test("reviewed Molten Core tips are labeled Classic reference, not Forever observations", () => {
  const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");
  const { answerSpecial } = require("../src/core/companion-unlocks.cjs");
  const mc = buildAtlas({}).entries.find((e) => e.id === "mc");
  for (const [name, , cue] of reviewedMoltenCore) {
    const boss = mc.bosses.find((b) => b.name === name);
    assert.match(boss.tip || "", /^Classic reference: /, name);
    assert.match(boss.tip, cue);
    assert.equal(boss.tip, tipFor(name));
    assert.equal(boss.observedInForever, false);
    assert.ok(answerSpecial(`Tips for ${name}?`).text.includes(boss.tip));
  }
  assert.equal(tipFor("The Molten Core"), null, "an encounter label alone does not establish an NPC tip");
  assert.match(mc.bosses.find((b) => b.name === "Ragnaros").tip, /^Wrath of Ragnaros/);
});

test("the addon copy is generated from the same tips and loads in the TOC", () => {
  const lua = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverBossTips.lua"), "utf8");
  assert.equal((lua.match(/^\s+\['/gm) || []).length, Object.keys(TIPS).length, "regenerate with node scripts/build-boss-tips.cjs");
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /BackstageForeverBossTips\.lua/);
});

test("raid tips require a matching creature target in the correct raid for events and /bf boss", () => lua(String.raw`
local targetChanged
CreateFrame=function()
    local f={CreateFontString=function() return {} end}
    function f:RegisterEvent(e) if e=='PLAYER_TARGET_CHANGED' then self.listens=true end end
    function f:SetScript(k,fn)
        if k=='OnEvent' and self.listens then targetChanged=function() fn(self,'PLAYER_TARGET_CHANGED') end end
    end
    return f
end
local toasts,said={},{}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local target,id,kind,map,guidKind,isPlayer='Lucifron',12118,'raid',409,'Creature',false
UnitName=function(unit) if unit=='target' then return target end end
UnitIsPlayer=function() return isPlayer end
UnitGUID=function(unit) if unit=='target' and id then return guidKind..'-0-0-0-0-'..id..'-ABC' end end
GetInstanceInfo=function() return 'Molten Core',kind,nil,nil,nil,nil,nil,map end
local addon='addon/BackstageForever/'
dofile(addon..'BackstageForeverAssist.lua')
dofile(addon..'BackstageForeverBossTips.lua')
BackstageForeverToast=function(title,body) toasts[#toasts+1]=title..'|'..body end
local function reject(expectedCount)
    targetChanged()
    assert(#toasts==(expectedCount or 0),'unexpected toast: '..tostring(toasts[#toasts]))
    assert(not BackstageForeverBossCommand('boss'),'unexpected manual tip')
end
map=469 reject() map=nil reject() map=409
kind='party' reject() kind='raid'
id=11982 reject() id=nil reject() id=12118
isPlayer=true reject() isPlayer=false
guidKind='Pet' reject() guidKind='Creature'
target='Unknown' reject() target='Lucifron' id=99999 reject() id=12118
target='The Molten Core' id=3018 reject()
local rows={
${reviewedMoltenCore.map(([name, id]) => `{'${name}',${id},${JSON.stringify(tipFor(name) || 'MISSING CLASSIC REFERENCE')}},`).join(' ')}
}
for i,row in ipairs(rows) do
    target,id=row[1],99999 reject(i-1)
    id=row[2] map=469 reject(i-1) map=409
    kind='party' reject(i-1) kind='raid'
    target,id=row[1],row[2]
    targetChanged() targetChanged()
    assert(#toasts==i and toasts[i]=='Boss: '..target..'|'..row[3],tostring(toasts[i]))
    assert(BackstageForeverBossCommand('boss')==row[3])
    assert(said[#said]:find(target..': '..row[3],1,true))
end
`));

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
target='Hogger' BackstageForeverBossCommand('boss') assert(said[#said]:find('Target a covered dungeon or raid boss first',1,true))
BackstageForeverBossCommand('boss off') target='Captain Greenskin' BackstageForeverBossTarget() assert(#toasts==1,'off: no toast')
BackstageForeverBossCommand('boss on') BackstageForeverBossTarget() assert(#toasts==2)
print('ok')
`));

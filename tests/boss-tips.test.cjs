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
const reviewedBlackwingLair = [
  ["Razorgore the Untamed", 12435, /orb.+eggs/i],
  ["Vaelastrasz the Corrupt", 13020, /Burning Adrenaline/],
  ["Broodlord Lashlayer", 12017, /Mortal Strike/],
  ["Firemaw", 11983, /line of sight.+Flame Buffet/],
  ["Ebonroc", 14601, /Swap tanks.+Shadow of Ebonroc/],
  ["Flamegor", 11981, /Tranquilizing Shot.+Frenzy/],
  ["Chromaggus", 14020, /line of sight.+breaths.+afflictions/i],
  ["Nefarian", 11583, /class calls.+skeletons/],
];
const reviewedZulGurub = [
  ["High Priestess Jeklik", 14517, /bat adds.+interrupt.+heal.+fire/i],
  ["High Priest Venoxis", 14507, /snake adds.+poison clouds/i],
  ["High Priestess Mar'li", 14510, /spider adds.+off-tank.+Enveloping Webs/i],
  ["High Priest Thekal", 14509, /Thekal and both zealots.+die together.+tiger adds/i],
  ["High Priestess Arlokk", 14515, /panthers.+marked player.+tank.+reappears/i],
  ["Bloodlord Mandokir", 11382, /Threatening Gaze.+stop moving, casting, and attacking.+Ohgan.+enrage/i],
  ["Jin'do the Hexxer", 11380, /healing wards.+Brain Wash Totems.+Delusions.+shades/i],
  ["Gri'lek", 15082, /roots.+grows/i],
  ["Hazza'rah", 15083, /sleep.+illusions/i],
  ["Renataki", 15084, /vanish.+tank.+reappears/i],
  ["Wushoolay", 15085, /spread out.+lightning/i],
  ["Gahz'ranka", 15114, /Massive Geyser.+knock.+tank.+regain control/i],
  ["Hakkar", 14834, /Son of Hakkar.+poison cloud.+Blood Siphon/i],
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

test("Blackwing Lair exposes all eight reviewed Classic reference tips in the Atlas and Companion", () => {
  const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");
  const { answerSpecial } = require("../src/core/companion-unlocks.cjs");
  const bwl = buildAtlas({}).entries.find((e) => e.id === "bwl");
  assert.equal(tipFor("Lord Victor Nefarius"), null, "the encounter starter is not the dragon target");
  assert.deepEqual(bwl.bosses.filter((boss) => boss.tip).map((boss) => boss.name), reviewedBlackwingLair.map(([name]) => name));
  for (const [name, , cue] of reviewedBlackwingLair) {
    const boss = bwl.bosses.find((b) => b.name === name);
    assert.match(boss.tip, /^Classic reference: /);
    assert.match(boss.tip, cue);
    assert.equal(boss.tip, tipFor(name));
    assert.equal(boss.observedInForever, false);
    assert.ok(answerSpecial(`Tips for ${name}?`).text.includes(boss.tip));
  }
});

test("Zul'Gurub exposes only the reviewed Classic reference tips in the Atlas and Companion", () => {
  const { buildAtlas } = require("../src/core/dungeon-atlas.cjs");
  const { answerSpecial } = require("../src/core/companion-unlocks.cjs");
  const zg = buildAtlas({}).entries.find((e) => e.id === "zg");
  assert.deepEqual(zg.bosses.map((boss) => boss.name), reviewedZulGurub.map(([name]) => name));
  for (const [name, , cue] of reviewedZulGurub) {
    const boss = zg.bosses.find((b) => b.name === name);
    assert.match(boss.tip, /^Classic reference: /);
    assert.match(boss.tip, cue);
    assert.equal(boss.tip, tipFor(name));
    assert.equal(boss.observedInForever, false);
    assert.equal(boss.kills, 0);
    assert.ok(answerSpecial(`Tips for ${name}?`).text.includes(boss.tip));
  }
  assert.equal(tipFor("High Priestess Mar’li"), tipFor("High Priestess Mar'li"));
  assert.equal(tipFor("Jin’do the Hexxer"), tipFor("Jin'do the Hexxer"));
  assert.equal(tipFor("Gahz’ranka"), tipFor("Gahz'ranka"));
  assert.equal(tipFor("Gri’lek"), tipFor("Gri'lek"));
  assert.equal(tipFor("Hazza’rah"), tipFor("Hazza'rah"));
  for (const name of ["Son of Hakkar", "Mudskunk Lure", "Edge of Madness", "Brazier of Madness", "Gong of Bethekk", "Ohgan"]) {
    assert.equal(tipFor(name), null, name);
  }
});

test("the addon copy is generated from the same tips and loads in the TOC", () => {
  const check = spawnSync(process.execPath, ["scripts/build-boss-tips.cjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.error);
  assert.match(check.stdout, /Boss tips are up to date/);
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
GetInstanceInfo=function() return nil,kind,nil,nil,nil,nil,nil,map end
local addon='addon/BackstageForever/'
SlashCmdList={}
dofile(addon..'BackstageForeverHUD.lua')
dofile(addon..'BackstageForeverAssist.lua')
dofile(addon..'BackstageForeverBossTips.lua')
assert(SLASH_BACKSTAGEFOREVER1=='/bf')
BackstageForeverToast=function(title,body) toasts[#toasts+1]=title..'|'..body end
local function bossCommand()
    local previous=#said
    SlashCmdList.BACKSTAGEFOREVER('boss')
    assert(#said==previous+1,'missing /bf boss response')
    return said[#said]
end
local function reject(expectedCount)
    targetChanged()
    assert(#toasts==(expectedCount or 0),'unexpected toast: '..tostring(toasts[#toasts]))
    assert(bossCommand():find('Target a covered dungeon or raid boss first',1,true),'unexpected manual tip')
end
map=469 reject() map=nil reject() map=409
kind='party' reject() kind='raid'
id=11982 reject() id=nil reject() id=12118
isPlayer=true reject() isPlayer=false
guidKind='Pet' reject() guidKind='Creature'
target='Unknown' reject() target='Lucifron' id=99999 reject() id=12118
target='The Molten Core' id=3018 reject()
map=469 target='Nefarian' id=10162 reject()
target='Lord Victor Nefarius' id=11583 reject()
map=309 target='Hakkar' id=11357 reject() -- Son of Hakkar, not the boss
target="Gahz'ranka" id=9104 reject() -- spell event, not the boss
id=19974 reject() -- summoning item, not the boss
target="Gri'lek" id=180327 reject() -- brazier, not the boss
id=15083 reject() -- a different boss in the same rotation
target='Edge of Madness' id=15082 reject() -- event label, not the boss name
target="High Priestess Mar'li" id=14517 reject()
target='High Priestess Arlokk' id=180526 reject() -- gong, not the summoned creature
id=791 reject() -- encounter ID, not the creature
target='Bloodlord Mandokir' id=14988 reject() -- Ohgan, not the boss
target='High Priest Thekal' id=11347 reject() -- Lor'Khan, not the boss
local rows={
${[[409, reviewedMoltenCore], [469, reviewedBlackwingLair], [309, reviewedZulGurub]].flatMap(([instanceMap, bosses]) =>
  bosses.map(([name, id]) => `{${JSON.stringify(name)},${id},${instanceMap},${JSON.stringify(tipFor(name) || 'MISSING CLASSIC REFERENCE')}},`)).join(' ')}
}
for i,row in ipairs(rows) do
    map=row[3]
    target,id=row[1],99999 reject(i-1)
    id=row[2] map=(row[3]==409 and 469 or 409) reject(i-1)
    map=nil reject(i-1) map=row[3]
    id=nil reject(i-1) id=row[2]
    target='Unknown' reject(i-1) target=row[1]
    guidKind='Pet' reject(i-1) guidKind='Creature'
    kind='party' reject(i-1) kind='raid'
    targetChanged() targetChanged()
    assert(#toasts==i and toasts[i]=='Boss: '..target..'|'..row[4],'missing or incorrect toast for '..target)
    assert(bossCommand():find(target..': '..row[4],1,true),'missing or incorrect manual tip for '..target)
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

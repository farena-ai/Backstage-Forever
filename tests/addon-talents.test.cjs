"use strict";
// Roadmap C1: the planned talent build rides the desktop -> game hand-off, and /bf talents names
// the next planned point. The addon only reads and prints; it never spends a point.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const handoff = require("../src/core/desktop-handoff.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const saved = (id, name, realm, className = "Rogue") => ({ id, name, realm, className, source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });
const pick = (name, tab, maxRank) => ({ name, tab, maxRank });
// Fifteen points: Precision 5, Lightning Reflexes 5, Improved Gouge 3, Riposte, then Improved Gouge is full
// so the fifteenth is Deflection. Improved Gouge rank 2 lands on point 12 (level 21).
const picks = [...Array(5).fill(pick("Precision", "Combat", 5)), ...Array(5).fill(pick("Lightning Reflexes", "Combat", 5)), ...Array(3).fill(pick("Improved Gouge", "Combat", 3)), pick("Riposte", "Combat", 1), pick("Deflection", "Combat", 5), pick("Malice", "Assassination", 5)];
const plan = { name: "Combat swords", picks };

test("the hand-off carries the marked build: talents once, then the order, same bytes every time", () => {
  const profiles = [saved("b", "Zed", "Thunder Hold"), saved("a", "Abel", "Thunder Hold"), saved("c", "Cara", "Thunder Hold"), { id: "m", name: "Manual", realm: "R", source: { kind: "manual" } }];
  const talents = (id) => (id === "a" ? plan : id === "b" ? { name: 'Quo"te \\ build', picks: [pick("Ärger", "Wut", 2)] } : id === "m" ? plan : null);
  const text = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5202] : []), upgrades: (id) => (id === "a" ? [9, 3] : []), talents });
  assert.equal(text, handoff.compile({ profiles: [...profiles].reverse(), wishlist: (id) => (id === "a" ? [5202] : []), upgrades: (id) => (id === "a" ? [3, 9] : []), talents }));
  const lines = text.split("\n");
  assert.equal(lines[3], "BackstageForeverDesktopData={schema=1,characters={", "the schema stays 1");
  assert.equal(lines[4], '["Abel-Thunder Hold"]={wish={5202},up={3,9},tal={n="Combat swords",t={{"Precision","Combat",5},{"Lightning Reflexes","Combat",5},{"Improved Gouge","Combat",3},{"Riposte","Combat",1},{"Deflection","Combat",5},{"Malice","Assassination",5}},o={1,1,1,1,1,2,2,2,2,2,3,3,3,4,5,6}}},');
  assert.equal(lines[5], '["Zed-Thunder Hold"]={wish={},tal={n="Quo\\034te \\092 build",t={{"\\195\\132rger","Wut",2}},o={1}}},', "a character with only a plan is named; names are escaped, never executable");
  assert.equal(lines[6], "}}"); assert.doesNotMatch(text, /Cara|Manual/);
  for (const line of lines) assert.ok(/^[\x20-\x7e]*$/.test(line), "plain ASCII only");
  // Wishes and upgrades are written exactly as before when no build is marked.
  const before = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5202] : []), upgrades: (id) => (id === "a" ? [9, 3] : []) });
  assert.match(before, /\["Abel-Thunder Hold"\]=\{wish=\{5202\},up=\{3,9\}\},\n\}\}\n$/); assert.doesNotMatch(before, /tal=/);
  assert.equal(handoff.compile({ profiles, talents: () => null }), handoff.EMPTY);
});

test("a plan that is not clean is left out; the rest of the file is untouched", () => {
  const profiles = [saved("a", "Abel", "Thunder Hold")];
  const only = (talents) => handoff.compile({ profiles, wishlist: () => [7], talents: () => talents });
  const plain = '["Abel-Thunder Hold"]={wish={7}},';
  for (const bad of [null, "text", {}, { name: "X", picks: [] }, { name: "", picks }, { name: "X".repeat(61), picks }, { name: "Line\nbreak", picks }, { name: "X", picks: "none" },
    { name: "X", picks: [pick("A", "T", 0)] }, { name: "X", picks: [pick("A", "T", 10)] }, { name: "X", picks: [pick("A", "T", 1.5)] }, { name: "X", picks: [pick("", "T", 1)] }, { name: "X", picks: [pick("A", "T\u0000", 1)] },
    { name: "X", picks: [pick("A", "T", 1), pick("A", "T", 1)] }, { name: "X", picks: [null] }, { name: "X", picks: Array(52).fill(pick("A", "T", 5)) }]) {
    assert.equal(only(bad).split("\n")[4], plain, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.equal(handoff.compile({ profiles, wishlist: () => [7], talents: () => { throw Error("no trees"); } }).split("\n")[4], plain, "a failing supplier never breaks the file");
  assert.equal(handoff.MAX_PICKS, 51);
});

test("the size cap holds: plans give way first, wishes and upgrades stay", () => {
  const big = { name: "N".repeat(60), picks: Array.from({ length: 51 }, (_, i) => pick("Talent " + "x".repeat(50) + i, "T".repeat(60), 5)) };
  const profiles = Array.from({ length: 150 }, (_, i) => saved("p" + i, "N".repeat(50) + String(i).padStart(3, "0"), "R".repeat(50)));
  const ids = Array.from({ length: 300 }, (_, i) => 2000000000 + i);
  const text = handoff.compile({ profiles, wishlist: () => ids, talents: () => big });
  assert.ok(Buffer.byteLength(text) <= handoff.MAX_BYTES);
  const rows = text.split("\n").filter((l) => l.startsWith("["));
  assert.equal(rows.length, handoff.MAX_CHARACTERS);
  for (const row of rows) assert.equal(row.match(/wish=\{([\d,]+)\}/)[1].split(",").length, handoff.MAX_ITEMS, "every wish list is whole");
  const withPlan = rows.filter((l) => l.includes(",tal={")).length;
  assert.ok(withPlan > 0 && withPlan < rows.length, `plans kept: ${withPlan}`);
  assert.ok(rows[0].includes(",tal={") && !rows[rows.length - 1].includes(",tal={"), "plans are dropped from the end of the sorted list");
  // Plans alone, at their largest, for every character: still inside the cap, and still valid Lua.
  const plansOnly = handoff.compile({ profiles, talents: () => big });
  assert.ok(Buffer.byteLength(plansOnly) <= handoff.MAX_BYTES);
  assert.equal(lua(plansOnly + "\nlocal n=0 for _,row in pairs(BackstageForeverDesktopData.characters) do if row.tal then assert(#row.tal.o==51 and #row.tal.t==51) n=n+1 end end io.write(n>0 and 'ok' or 'none')"), "ok");
});

const STUBS = String.raw`
local said={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,text) said[#said+1]=text end}
local function lines() local out=table.concat(said,'\n') said={} return out end
`;
const data = handoff.compile({ profiles: [saved("a", "Abel", "Thunder Hold")], wishlist: () => [5202], talents: () => plan }).replace(/^--.*$/gm, "");

test("the game reads only its own character's plan and ignores a damaged one", () => lua(STUBS + data + String.raw`
dofile('addon/BackstageForever/BackstageForeverTalents.lua')
local plan=BackstageForeverTalentPlan('Abel','Thunder Hold')
assert(plan.name=='Combat swords' and #plan.picks==16)
local p=plan.picks[12]
assert(p.name=='Improved Gouge' and p.tab=='Combat' and p.rank==2 and p.max==3 and p.level==21)
assert(plan.picks[1].level==10 and plan.picks[1].rank==1 and plan.picks[5].rank==5 and plan.picks[16].tab=='Assassination')
assert(BackstageForeverTalentLine(p)=='Level 21: Improved Gouge (Combat), rank 2 of 3')
assert(BackstageForeverTalentPlan('Zed','Thunder Hold')==nil and BackstageForeverTalentPlan(nil,'x')==nil and BackstageForeverTalentPlan('Abel',nil)==nil)
local good=BackstageForeverDesktopData
local function with(tal) BackstageForeverDesktopData={schema=1,characters={['Abel-Thunder Hold']={wish={},tal=tal}}} return BackstageForeverTalentPlan('Abel','Thunder Hold') end
assert(with({n='X',t={{'A','T',2}},o={1,1}}).picks[2].rank==2)
for _,bad in ipairs({
  'text',{},{n='X',t={},o={}},{n=1,t={{'A','T',1}},o={1}},{n='X',t='x',o={1}},{n='X',t={{'A','T',1}},o='x'},
  {n='X',t={{'A','T',1}},o={2}},{n='X',t={{'A','T',1}},o={'1'}},{n='X',t={{'A','T',1}},o={1,1}},{n='X',t={{'A',2,1}},o={1}},
  {n='X',t={{1,'T',1}},o={1}},{n='X',t={{'A','T','1'}},o={1}},{n='X',t={'A'},o={1}},
}) do assert(with(bad)==nil) end
local long={} for i=1,52 do long[i]=1 end
assert(with({n='X',t={{'A','T',60}},o=long})==nil,'more points than a character can have')
for _,bad in ipairs({{schema=2,characters=good.characters},{schema=1},{schema=1,characters='x'},'text',false}) do
  BackstageForeverDesktopData=bad
  assert(BackstageForeverTalentPlan('Abel','Thunder Hold')==nil)
end
BackstageForeverDesktopData=nil
assert(BackstageForeverTalentPlan('Abel','Thunder Hold')==nil)
`));

test("the next planned point: by level alone, or by the talents the game says you own", () => lua(STUBS + data + String.raw`
dofile('addon/BackstageForever/BackstageForeverTalents.lua')
local plan=BackstageForeverTalentPlan('Abel','Thunder Hold')
local function names(list) local out={} for i,p in ipairs(list) do out[i]=p.level..':'..p.name..' '..p.rank end return table.concat(out,',') end
-- By level alone: the point of this level, and the one after.
local n=BackstageForeverTalentNext(plan,21)
assert(names(n.due)=='21:Improved Gouge 2' and n.later.level==22 and n.later.name=='Improved Gouge' and n.later.rank==3 and not n.done)
n=BackstageForeverTalentNext(plan,5)
assert(#n.due==0 and n.later.level==10 and n.later.name=='Precision' and not n.done)
n=BackstageForeverTalentNext(plan,25)
assert(names(n.due)=='25:Malice 1' and n.later==nil and n.done)
n=BackstageForeverTalentNext(plan,40)
assert(#n.due==0 and n.later==nil and n.done)
-- With the talents you own: everything owned counts as taken, wherever the level stands.
local have={['Combat\nPrecision']=5,['Combat\nLightning Reflexes']=5,['Combat\nImproved Gouge']=1,['Combat\nRiposte']=0}
n=BackstageForeverTalentNext(plan,24,have,2)
assert(names(n.due)=='21:Improved Gouge 2,22:Improved Gouge 3',names(n.due))
assert(n.later.name=='Riposte' and n.later.level==25 and n.more==0)
n=BackstageForeverTalentNext(plan,24,have,0)
assert(#n.due==0 and n.later.name=='Improved Gouge' and n.later.rank==2 and n.later.level==25)
n=BackstageForeverTalentNext(plan,24,have,nil)
assert(#n.due==4 and n.due[4].name=='Deflection' and n.due[4].level==24 and n.later.name=='Malice','unspent unknown: every open point planned up to this level')
-- You spent ahead of the plan: the taken ranks are skipped.
have['Combat\nRiposte']=1 have['Combat\nImproved Gouge']=3
n=BackstageForeverTalentNext(plan,24,have,1)
assert(names(n.due)=='24:Deflection 1' and n.later.name=='Malice')
-- Many points waiting: five lines at most, the rest counted.
n=BackstageForeverTalentNext(plan,40,{['Combat\nPrecision']=0},30)
assert(#n.due==5 and n.more==11 and n.later==nil and not n.done)
n=BackstageForeverTalentNext(plan,40,{['Combat\nPrecision']=0},3,1)
assert(#n.due==1 and n.more==2 and n.later.rank==4)
-- Below level 10 nothing is due even if the game reports a point.
n=BackstageForeverTalentNext(plan,8,{['Combat\nPrecision']=0},1)
assert(#n.due==0 and n.later.level==10)
-- The game's names do not match the plan at all (another language): fall back to the level.
n=BackstageForeverTalentNext(plan,21,{['Kampf\nPraezision']=5},1)
assert(names(n.due)=='21:Improved Gouge 2')
-- Everything owned.
local all={['Combat\nPrecision']=5,['Combat\nLightning Reflexes']=5,['Combat\nImproved Gouge']=3,['Combat\nRiposte']=1,['Combat\nDeflection']=1,['Assassination\nMalice']=1}
n=BackstageForeverTalentNext(plan,30,all,4)
assert(n.done and #n.due==0 and n.later==nil)
n=BackstageForeverTalentNext(nil,30)
assert(#n.due==0 and not n.done)
`));

test("/bf talents prints the plan's next point and never spends one", () => {
  const out = lua(STUBS + data + String.raw`
UnitName=function() return 'Abel' end
GetRealmName=function() return 'Thunder Hold' end
local level,points,combat=24,2,false
UnitLevel=function() return level end
UnitCharacterPoints=function() return points end
InCombatLockdown=function() return combat end
local owned={Combat={{'Precision',5},{'Lightning Reflexes',5},{'Improved Gouge',1},{'Riposte',0},{'Deflection',0}},Assassination={{'Malice',0}},Subtlety={}}
local tabs={'Assassination','Combat','Subtlety'}
GetNumTalentTabs=function() return 3 end
GetTalentTabInfo=function(tab) return tabs[tab],'Interface\\Icons\\x',0 end
GetNumTalents=function(tab) return #owned[tabs[tab]] end
GetTalentInfo=function(tab,i) local t=owned[tabs[tab]][i] return t[1],'icon',1,1,t[2],5 end
for _,name in ipairs({'LearnTalent','ToggleTalentFrame','ShowUIPanel','TalentFrame_LoadUI'}) do _G[name]=function() error(name..' must never be called') end end
dofile('addon/BackstageForever/BackstageForeverTalents.lua')
local have=BackstageForeverTalentRead()
assert(have['Combat\nImproved Gouge']==1 and have['Assassination\nMalice']==0)
assert(BackstageForeverTalentsCommand('talents')==true)
io.write(lines(),'\n--\n')
points=0
BackstageForeverTalentsCommand('talents')
io.write(lines(),'\n--\n')
-- In combat the game's values are left alone and the plan is read by level.
combat=true points=2
BackstageForeverTalentsCommand('talents')
io.write(lines(),'\n--\n')
combat=false level=7
GetTalentInfo=function() error('blocked') end
assert(BackstageForeverTalentRead()==nil)
BackstageForeverTalentsCommand('talents')
io.write(lines(),'\n--\n')
UnitName=function() return 'Nobody' end
BackstageForeverTalentsCommand('talents')
io.write(lines(),'\n--\n')
-- Secret values are never compared or shown.
UnitName=function() return 'Abel' end
level=24
local secret={}
issecretvalue=function(v) return v==secret end
GetTalentInfo=function(tab,i) local t=owned[tabs[tab]][i] return t[1],'icon',1,1,secret,5 end
UnitCharacterPoints=function() return secret end
assert(BackstageForeverTalentRead()==nil)
BackstageForeverTalentsCommand('talents')
io.write(lines())
`);
  assert.deepEqual(out.split("\n--\n"), [
    'Backstage Forever: Talent plan "Combat swords".\nBackstage Forever: Level 21: Improved Gouge (Combat), rank 2 of 3\nBackstage Forever: Level 22: Improved Gouge (Combat), rank 3 of 3\nBackstage Forever: Next, at level 25: Riposte (Combat), rank 1 of 1\nBackstage Forever: Press N to open Talents. You spend the points yourself.',
    'Backstage Forever: Talent plan "Combat swords".\nBackstage Forever: No planned point to spend right now.\nBackstage Forever: Next, at level 25: Improved Gouge (Combat), rank 2 of 3',
    'Backstage Forever: Talent plan "Combat swords".\nBackstage Forever: Level 24: Deflection (Combat), rank 1 of 5\nBackstage Forever: Next, at level 25: Malice (Assassination), rank 1 of 5\nBackstage Forever: Press N to open Talents. You spend the points yourself.',
    'Backstage Forever: Talent plan "Combat swords".\nBackstage Forever: Talent points start at level 10.\nBackstage Forever: Next, at level 10: Precision (Combat), rank 1 of 5',
    'Backstage Forever: No talent plan for this character yet. Make one in the desktop app under Characters, Talents, choose "Use in game", then type /reload.',
    'Backstage Forever: Talent plan "Combat swords".\nBackstage Forever: Level 24: Deflection (Combat), rank 1 of 5\nBackstage Forever: Next, at level 25: Malice (Assassination), rank 1 of 5\nBackstage Forever: Press N to open Talents. You spend the points yourself.',
  ]);
});

test("one chat line on level-up: out of combat, when a plan exists, and only while switched on", () => {
  const out = lua(STUBS + data + String.raw`
UnitName=function() return 'Abel' end
GetRealmName=function() return 'Thunder Hold' end
local combat=false
UnitLevel=function() return 30 end
InCombatLockdown=function() return combat end
local events,handler={},nil
CreateFrame=function() return {RegisterEvent=function(_,e) events[#events+1]=e end,SetScript=function(_,kind,fn) assert(kind=='OnEvent') handler=fn end} end
dofile('addon/BackstageForever/BackstageForeverTalents.lua')
assert(table.concat(events,',')=='PLAYER_LEVEL_UP,PLAYER_REGEN_ENABLED')
assert(BackstageForeverTalentLineEnabled()==true)
handler(nil,'PLAYER_LEVEL_UP',21)
io.write(lines(),'\n--\n')
handler(nil,'PLAYER_REGEN_ENABLED')
assert(lines()=='','nothing waits when the line was already shown')
-- In combat: nothing until combat ends, then once.
combat=true
handler(nil,'PLAYER_LEVEL_UP',22)
assert(lines()=='')
combat=false
handler(nil,'PLAYER_REGEN_ENABLED')
io.write(lines(),'\n--\n')
handler(nil,'PLAYER_REGEN_ENABLED')
assert(lines()=='')
-- Below 10, past the plan, or without a plan: silence.
handler(nil,'PLAYER_LEVEL_UP',9) handler(nil,'PLAYER_LEVEL_UP',26)
assert(lines()=='')
-- The game's own talents win over the level, and the new point counts even if not reported yet.
GetNumTalentTabs=function() return 1 end
GetTalentTabInfo=function() return 'Combat' end
GetNumTalents=function() return 2 end
GetTalentInfo=function(_,i) return i==1 and 'Precision' or 'Lightning Reflexes','icon',1,1,i==1 and 5 or 2,5 end
UnitCharacterPoints=function() return 0 end
handler(nil,'PLAYER_LEVEL_UP',40)
io.write(lines(),'\n--\n')
-- Switched off, and back on.
assert(BackstageForeverTalentsCommand('talents levelup off')==false and BackstageForeverAssistSettings.talentPlan==false)
assert(BackstageForeverTalentLineEnabled()==false)
lines()
handler(nil,'PLAYER_LEVEL_UP',21)
assert(lines()=='')
BackstageForeverTalentsCommand('talents levelup')
assert(BackstageForeverTalentsCommand('talents LevelUp ON')==true and BackstageForeverAssistSettings.talentPlan==true)
io.write(lines(),'\n--\n')
UnitName=function() return 'Nobody' end
handler(nil,'PLAYER_LEVEL_UP',21)
assert(lines()=='')
-- Pure form.
local plan=BackstageForeverTalentPlan('Abel','Thunder Hold')
assert(BackstageForeverTalentLevelUp(nil,21)==nil and BackstageForeverTalentLevelUp(plan,9)==nil and BackstageForeverTalentLevelUp(plan,26)==nil)
io.write(BackstageForeverTalentLevelUp(plan,24))
`);
  assert.deepEqual(out.split("\n--\n"), [
    "Backstage Forever: Level 21 talent point: Improved Gouge (Combat), rank 2 of 3. Type /bf talents for more.",
    "Backstage Forever: Level 22 talent point: Improved Gouge (Combat), rank 3 of 3. Type /bf talents for more.",
    "Backstage Forever: Level 40 talent point: Lightning Reflexes (Combat), rank 3 of 5. Type /bf talents for more.",
    "Backstage Forever: Type /bf talents levelup on or /bf talents levelup off.\nBackstage Forever: Talent plan line on level-up is on.",
    "Level 24 talent point: Deflection (Combat), rank 1 of 5. Type /bf talents for more.",
  ]);
});

test("the addon file is wired in and holds no call that spends or opens anything", () => {
  const source = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverTalents.lua"), "utf8");
  for (const word of ["LearnTalent", "ToggleTalentFrame", "RunMacro", "SendChatMessage", "CastSpell", "SetScript('OnUpdate'"]) assert.ok(!source.includes(word), word);
  const toc = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8").split(/\r?\n/);
  assert.equal(toc.indexOf("BackstageForeverTalents.lua"), toc.indexOf("BackstageForeverDesktop.lua") + 1, "loaded right after the hand-off data");
  assert.ok(toc.indexOf("BackstageForeverTalents.lua") > toc.indexOf("BackstageForeverLocale.lua"));
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverTalents.lua"));
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverHUD.lua"), "utf8"), /if word=='talents' then\s+if type\(BackstageForeverTalentsCommand\)=='function' then pcall\(BackstageForeverTalentsCommand,message\)end/);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverOptions.lua"), "utf8"), /switch\('Talent plan line',[^\n]*on\('BackstageForeverAssistSettings','talentPlan'\),'talents levelup'\)/);
});

test("German players read the same lines in German", () => {
  const out = lua(STUBS + String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
` + data + String.raw`
dofile('addon/BackstageForever/BackstageForeverTalents.lua')
local plan=BackstageForeverTalentPlan('Abel','Thunder Hold')
io.write(BackstageForeverTalentLine(plan.picks[12]),'\n',table.concat(BackstageForeverTalentReport(plan,21),'\n'),'\n',BackstageForeverTalentLevelUp(plan,21),'\n',BackstageForeverTalentReport(nil,21)[1])
`);
  assert.doesNotMatch(out, /Level \d+:|rank \d|Talent plan|Press N|Type \/bf|No talent plan/);
  assert.match(out, /^Stufe 21: Improved Gouge \(Combat\), Rang 2 von 3\n/);
});

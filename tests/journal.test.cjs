"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { normalizeJournalCapture, splits } = require("../src/core/journal-data.cjs");
const { badgesFor, rested } = require("../src/core/badges.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
test("the addon journal records levels with /played, firsts once, and zones, within bounds", () => lua(String.raw`
local t=1000 time=function() return t end
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
BackstageForeverJournalLevel(10,1000) BackstageForeverJournalPlayed(36000)
t=5000 BackstageForeverJournalLevel(11,5000) BackstageForeverJournalPlayed(39600)
BackstageForeverJournalLevel(11,6000)
local d=BackstageForeverJournalDB
assert(#d.levels==2 and d.levels[1].played==36000 and d.levels[2].played==39600,'played attaches to the level just reached')
t=99999 BackstageForeverJournalPlayed(50000) assert(d.levels[2].played==39600,'a later /played does not overwrite')
assert(BackstageForeverJournalFirst('dungeon',10)==true and BackstageForeverJournalFirst('dungeon',20)==false)
assert(BackstageForeverJournalFirst('nonsense',10)==false)
assert(BackstageForeverJournalZone(1413)==true and BackstageForeverJournalZone(1413)==false)
local s=BackstageForeverJournalSnapshot()
assert(#s.levels==2 and #s.firsts==1 and #s.zones==1 and s.played==50000)
`));
test("G11: the addon times dungeon runs, counts deaths inside and keeps only your own good loot", () => lua(String.raw`
local t=10000 time=function() return t end
local handler
CreateFrame=function() return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end} end
local inside={'The Deadmines','party',1,'Normal',5,0,false,36}
GetInstanceInfo=function() return (table.unpack or unpack)(inside,1,8) end
IsInInstance=function() return inside[2]~='none',inside[2] end
LOOT_ITEM_SELF='You receive loot: %s.' LOOT_ITEM_SELF_MULTIPLE='You receive loot: %sx%d.'
LOOT_ITEM_PUSHED_SELF='You receive item: %s.' LOOT_ITEM_PUSHED_SELF_MULTIPLE='You receive item: %sx%d.'
local link=function(color,id,name) return '|cff'..color..'|Hitem:'..id..'::::::::20:::::|h['..name..']|h|r' end
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
-- Pure pieces first.
local id,n,q=BackstageForeverJournalLootFromChat('You receive loot: '..link('0070dd',5191,'Cruel Barb')..'.')
assert(id==5191 and n==1 and q==3,'own rare loot')
id,n,q=BackstageForeverJournalLootFromChat('You receive loot: '..link('ffffff',2589,'Linen Cloth')..'x3.')
assert(id==2589 and n==3 and q==1,'stack count and common quality')
assert(BackstageForeverJournalLootFromChat('Thrall receives loot: '..link('a335ee',1,'Epic')..'.')==nil,'never another player')
assert(BackstageForeverJournalLootFromChat('Sie erhalten Beute: '..link('0070dd',5191,'x')..'.',{'Sie erhalten Beute: %sx%d.','','Sie erhalten Beute: %s.'})==5191,'the client language decides the wording')
assert(BackstageForeverJournalLootFromChat(nil)==nil and BackstageForeverJournalLootFromChat('You receive loot: nothing.')==nil)
assert(BackstageForeverJournalRunDeath(t)==false and BackstageForeverJournalRunLoot(5,1,t)==false and BackstageForeverJournalRunLeave(t)==false,'nothing counts outside a run')
assert(BackstageForeverJournalRunEnter(36,'pvp','x',t)==nil and BackstageForeverJournalRunEnter(nil,'party','x',t)==nil)
-- A run through the event handler.
handler(nil,'PLAYER_ENTERING_WORLD')
local d=BackstageForeverJournalDB
assert(#d.runs==1 and d.runs[1].startedAt==10000 and d.runs[1].name=='The Deadmines' and d.runs[1].open==true)
t=10300 handler(nil,'PLAYER_REGEN_ENABLED') assert(d.runs[1].endedAt==10300)
t=10400 handler(nil,'PLAYER_DEAD') assert(d.runs[1].deaths==1)
t=10500 handler(nil,'CHAT_MSG_LOOT','You receive loot: '..link('0070dd',5191,'Cruel Barb')..'.')
handler(nil,'CHAT_MSG_LOOT','You receive loot: '..link('ffffff',2589,'Linen Cloth')..'x3.')
handler(nil,'CHAT_MSG_LOOT','Thrall receives loot: '..link('a335ee',9,'Epic')..'.')
handler(nil,'CHAT_MSG_LOOT','You receive loot: '..link('1eff00',1000,'Green Thing')..'x2.')
handler(nil,'CHAT_MSG_LOOT','You receive loot: '..link('1eff00',1000,'Green Thing')..'.')
assert(#d.runs[1].loot==2 and d.runs[1].loot[1].id==5191 and d.runs[1].loot[2].n==3,'uncommon or better, own loot, counts added')
-- Released and ran back: outside for a moment, then the same run again.
inside={'Westfall','none',0,'',0,0,false,0}
t=10560 handler(nil,'ZONE_CHANGED_NEW_AREA') assert(d.runs[1].open==nil and d.runs[1].endedAt==10560)
t=10900 handler(nil,'PLAYER_DEAD') assert(d.runs[1].deaths==1,'a death outside is not counted')
inside={'The Deadmines','party',1,'Normal',5,0,false,36}
t=11000 handler(nil,'PLAYER_ENTERING_WORLD') assert(#d.runs==1 and d.runs[1].open==true,'back within half an hour is the same run')
t=11200 BackstageForeverJournalEncounter(644,'Edwin VanCleef',1) assert(d.runs[1].endedAt==11200 and #d.encounters==1,'a boss kill is a sign of life')
inside={'Westfall','none',0,'',0,0,false,0}
t=30000 handler(nil,'PLAYER_ENTERING_WORLD') assert(d.runs[1].endedAt==11200,'coming back online outside hours later does not stretch the run')
inside={'The Deadmines','party',1,'Normal',5,0,false,36}
t=40000 handler(nil,'PLAYER_ENTERING_WORLD') assert(#d.runs==2 and d.runs[2].startedAt==40000,'hours later is a new run')
local s=BackstageForeverJournalSnapshot()
assert(#s.runs==2 and s.runs[1].deaths==1 and #s.runs[1].loot==2 and s.runs[1].open==nil and s.runs[1].endedAt==11200 and s.runs[2].instanceMap==36)
for i=1,70 do BackstageForeverJournalRunEnter(1000+i,'raid','Raid',50000+i*20000) end
assert(#BackstageForeverJournalDB.runs==60 and #BackstageForeverJournalSnapshot().runs==60,'bounded')
for i=1,40 do BackstageForeverJournalRunLoot(i,1,1450001) end
assert(#d.runs[60].loot==30,'loot per run is bounded')
`));
test("journal capture is validated; splits compare with other characters' bests", () => {
  const j = normalizeJournalCapture({ levels: [{ level: 11, at: 2, played: 4000 }, { level: 10, at: 1, played: 1000 }, { level: 12, at: 3, played: 9000 }], firsts: [{ key: "flight", at: 5 }], zones: [1413, 1413, 1411], played: 9500 });
  assert.deepEqual(j.levels.map((l) => l.level), [10, 11, 12]);
  assert.deepEqual(j.zones, [1413, 1411]);
  assert.throws(() => normalizeJournalCapture({ firsts: [{ key: "hack", at: 1 }] }));
  assert.throws(() => normalizeJournalCapture({ levels: Array.from({ length: 81 }, (_, i) => ({ level: i + 1, at: 1 })) }));
  const me = { name: "Vael", journal: j }, alt = { name: "Rolica", journal: { levels: [{ level: 10, at: 1, played: 0 }, { level: 11, at: 2, played: 1800 }] } };
  const s = splits(me, [alt]);
  assert.deepEqual(s.map((x) => [x.level, x.seconds]), [[10, 3000], [11, 5000]]);
  assert.equal(s[0].best.name, "Rolica"); assert.equal(s[0].personalBest, false); assert.equal(s[1].personalBest, true);
});
test("badges: earned from level, quests, zones and firsts, with progress for locked ones", () => {
  const p = { name: "V", level: 21, history: { completedIdsKnown: true, completedIds: Array.from({ length: 120 }, (_, i) => i + 1) }, journal: { levels: [{ level: 20, at: 1, played: 1000 }, { level: 21, at: 2, played: 3000 }], firsts: [{ key: "dungeon", at: 1700000000 }], zones: [1, 2, 3, 4, 5, 6] } };
  const b = badgesFor(p), get = (id) => b.badges.find((x) => x.id === id);
  assert.equal(get("level-20").earned, true); assert.equal(get("level-30").earned, false); assert.deepEqual(get("level-30").progress, { have: 21, need: 30 });
  assert.equal(get("quests-100").earned, true); assert.equal(get("explorer-5").earned, true);
  assert.equal(get("first-dungeon").earned, true); assert.equal(get("first-dungeon").at, 1700000000);
  assert.equal(get("speed").earned, true, "a level in 2000 seconds");
  assert.equal(b.total, 30, "20 badges, plus 10 for professions, gold and reputation in 1.1");
  assert.deepEqual(rested({ progress: { current: 10, max: 1000, rested: 300 } }), { xp: 300, percentOfLevel: 30, capPercent: 150, hoursToCap: 192, perNight: 5 });
});
test("a stored profile with a journal passes state validation; a bad one is refused", () => {
  const base = { ...defaultState(), profiles: [{ id: "A", name: "A", className: "Hunter", realm: "", level: 5, race: "", faction: "Horde", goals: [], notes: "", journal: { levels: [], firsts: [], zones: [] } }], activeProfileId: "A" };
  assert.doesNotThrow(() => validateState(base));
  assert.throws(() => validateState({ ...base, profiles: [{ ...base.profiles[0], journal: { firsts: [{ key: "x", at: 1 }] } }] }));
});
test("quiet /played mutes chat windows for one answer and never replaces Blizzard functions", () => lua(String.raw`
local handler, timers = nil, {}
local function chat() local f={events={TIME_PLAYED_MSG=true}} function f:IsEventRegistered(e) return self.events[e]==true end function f:UnregisterEvent(e) self.events[e]=nil end function f:RegisterEvent(e) self.events[e]=true end return f end
ChatFrame1, ChatFrame2 = chat(), chat() NUM_CHAT_WINDOWS=2
local original=function() end ChatFrame_DisplayTimePlayed=original
C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
local requested=0 RequestTimePlayed=function() requested=requested+1 end
UnitLevel=function() return 12 end
CreateFrame=function() return {RegisterEvent=function() end, SetScript=function(_,_,fn) handler=fn end} end
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
handler(nil,'PLAYER_LOGIN')
assert(requested==1,'asks for play time once')
assert(not ChatFrame1:IsEventRegistered('TIME_PLAYED_MSG') and not ChatFrame2:IsEventRegistered('TIME_PLAYED_MSG'),'chat is muted for our own request')
assert(ChatFrame_DisplayTimePlayed==original,'the Blizzard chat function is untouched')
handler(nil,'TIME_PLAYED_MSG',43200,600)
for _,fn in ipairs(timers) do fn() end
assert(ChatFrame1:IsEventRegistered('TIME_PLAYED_MSG') and ChatFrame2:IsEventRegistered('TIME_PLAYED_MSG'),'chat listens again')
`));
test("no addon file replaces a Blizzard global function (that taints the default UI)", () => {
  const fs = require("node:fs"), dir = path.join(__dirname, "..", "addon", "BackstageForever");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".lua"))) {
    const bad = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter((l) => /^\s*(?!BackstageForever)[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]*\s*=\s*function/.test(l) && !/^\s*local\b/.test(l));
    assert.deepEqual(bad, [], f);
  }
});

test("world map pins neutralise the protected SetPassThroughButtons that Blizzard's AcquirePin calls", () => {
  const fs = require("node:fs");
  for (const f of ["BackstageForeverMap.lua", "BackstageForeverAdvisorMap.lua"]) {
    const src = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever", f), "utf8");
    const pin = src.indexOf("local Pin={}"), noop = src.indexOf("function Pin:SetPassThroughButtons()end"), mix = src.indexOf("call(Mixin,frame,base,Pin)");
    assert.ok(pin >= 0 && noop > pin && mix > noop, f + ": our pins override SetPassThroughButtons before mixing in");
  }
});

test("no addon file registers the combat log (the game forbids it: 'blocked from an action only available to the Blizzard UI')", () => {
  const fs = require("node:fs"), dir = path.join(__dirname, "../addon/BackstageForever");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".lua"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /COMBAT_LOG_EVENT|CombatLogGetCurrentEventInfo/, f);
  }
});

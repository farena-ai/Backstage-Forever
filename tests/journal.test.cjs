"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { normalizeJournalCapture, splits } = require("../src/core/journal-data.cjs");
const { badgesFor, rested } = require("../src/core/badges.cjs");
const { validateState, defaultState } = require("../src/core/validation.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
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
  assert.equal(b.total, 20);
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

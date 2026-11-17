"use strict";
// 1.4 (J14): quest givers learned from play extend the guided route past the bundled data.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const G = require("../src/core/guided-route.cjs");
const { normalizeJournalCapture } = require("../src/core/journal-data.cjs");
const pack = require("../data/forever/pack.json"), zones = require("../data/forever-leveling/pack.json").zones;

test("the journal keeps each quest's giver and spot, bounded, one per quest", () => {
  const j = normalizeJournalCapture({ givers: [{ q: 5, n: 77, m: 1446, x: 0.512345, y: 0.4, at: 1 }, { q: 5, n: 78, m: 1446, x: 0.6, y: 0.4, at: 2 }] });
  assert.deepEqual(j.givers, [{ q: 5, n: 77, m: 1446, x: 0.5123, y: 0.4, at: 1 }]);
  assert.throws(() => normalizeJournalCapture({ givers: [{ q: 5, n: 77, m: 1446, x: 2, y: 0.4, at: 1 }] }));
  assert.throws(() => normalizeJournalCapture({ givers: Array.from({ length: 401 }, (_, i) => ({ q: i + 1, n: 1, m: 1, x: 0, y: 0, at: 0 })) }));
  assert.equal(normalizeJournalCapture({}).givers, undefined);
});

test("learned givers fill quests with no giver in the bundled data, and the route reaches further", () => {
  const before = G.buildGuidedRoutes({ pack, zones }).coverage.Horde.best;
  const qs = Object.values(pack.quests).filter((q) => q.level >= before && q.level <= before + 5 && (!q.sides?.length || q.sides.includes("Horde")) && !q.givers?.length).slice(0, 30);
  const givers = qs.map((q, i) => ({ q: q.id, n: 900000 + (i % 5), m: 1446, x: 0.5 + (i % 10) * 0.01, y: 0.4 + Math.floor(i / 10) * 0.01, at: 1 }));
  const learned = G.learnedGivers([{ journal: { givers } }], null);
  assert.equal(learned.quests.size, qs.length);
  const after = G.buildGuidedRoutes({ pack, zones, learned }).coverage.Horde.best;
  assert.ok(after > before, `route grows past ${before}: ${after}`);
});

test("the addon records the quest giver on accept and exports it", () => {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, encoding: "utf8", timeout: 20000, input: String.raw`
local frames={}
CreateFrame=function() local f={RegisterEvent=function() end,SetScript=function(self,k,fn) self[k]=fn end} frames[#frames+1]=f return f end
time=function() return 1700000000 end
UnitGUID=function(u) if u=='questnpc' then return 'Creature-0-1-2-3-4567-ABCDEF' end end
C_Map={GetBestMapForUnit=function() return 1446 end,GetMapInfo=function() return {mapType=3} end,GetPlayerMapPosition=function() return {x=0.51,y=0.29} end}
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
local ev for _,f in ipairs(frames) do if f.OnEvent then ev=f.OnEvent end end
ev(nil,'QUEST_DETAIL') ev(nil,'QUEST_ACCEPTED',3,2990)
local s=BackstageForeverJournalSnapshot()
assert(s.givers and #s.givers==1 and s.givers[1].q==2990 and s.givers[1].n==4567 and s.givers[1].m==1446 and s.givers[1].x==0.51,'recorded')
ev(nil,'QUEST_ACCEPTED',4,2991) assert(#BackstageForeverJournalSnapshot().givers==1,'no NPC seen, nothing recorded')
print('ok')` });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), "ok");
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.lua"), "utf8"), /array\(journal\.givers or \{\}\)/);
  assert.match(fs.readFileSync(path.join(root, "src/main.cjs"), "utf8"), /learned: G\.learnedGivers\(store\.state\.profiles, npcLocationsPack\)/);
});

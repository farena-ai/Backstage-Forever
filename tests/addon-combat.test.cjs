"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
test("death review: the main killer, its share, and a tip that fits what happened", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverCombat.lua')
local r=BackstageForeverDeathReview({{t=95,source='Razormane Hunter',amount=80,level=14},{t=97,source='Razormane Hunter',amount=120,level=14},{t=98,source='Kolkar Wrangler',amount=50,level=13}},100,12)
assert(r.killer=='Razormane Hunter' and r.share==80 and r.others==1,r.share)
assert(r.tip:find('2 levels above you',1,true),r.tip)
local e=BackstageForeverDeathReview({{t=99,source='Bael\'dun Guard',amount=300,elite=true}},100,20)
assert(e.tip:find('elite',1,true))
local g=BackstageForeverDeathReview({{t=99,source='A',amount=10},{t=99,source='B',amount=10},{t=99,source='C',amount=10}},100,20)
assert(g.tip:find('one at a time',1,true))
assert(BackstageForeverDeathReview({{t=50,source='Old',amount=500}},100,20)==nil,'hits outside the window do not count')
local s=BackstageForeverFightSummary(1200,300,20) assert(s.dps==60 and s.hps==15)
`));
test("/bf stats summarises this session's fights from the combat log", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,_,fn) handler=fn end} end
local t=0 GetTime=function() return t end
UnitGUID=function(u) return u=='player' and 'Player-1' or 'Creature-0-1-2-3-4-99' end
local ev
CombatLogGetCurrentEventInfo=function() return table.unpack(ev) end
dofile('addon/BackstageForever/BackstageForeverCombat.lua')
BackstageForeverStatsCommand() assert(said[1]:find('No fights yet',1,true))
handler(nil,'PLAYER_REGEN_DISABLED')
ev={0,'SWING_DAMAGE',false,'Player-1','Me',0,0,'Creature-0-1-2-3-4-99','Boar',0,0,400} handler(nil,'COMBAT_LOG_EVENT_UNFILTERED')
ev={0,'SPELL_DAMAGE',false,'Player-1','Me',0,0,'Creature-0-1-2-3-4-99','Boar',0,0,133,'Arcane Shot',1,600} handler(nil,'COMBAT_LOG_EVENT_UNFILTERED')
t=10 handler(nil,'PLAYER_REGEN_ENABLED')
BackstageForeverStatsCommand()
assert(said[2]:find('1 fights, 1000 damage',1,true),said[2])
assert(said[3]:find('Best fight: 100 damage per second over 10 seconds',1,true),said[3])
`));

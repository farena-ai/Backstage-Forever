"use strict";
// W7, addon side: an optional screenshot at a level-up and at a boss kill. Off by default, only
// through the game's own Screenshot(), never in combat, once per event.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const HARNESS = String.raw`
local handlers,timers,messages={}, {}, {}
local clock=100
GetTime=function() return clock end
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) messages[#messages+1]=m end}
COMBAT=false
InCombatLockdown=function() return COMBAT end
C_Timer={After=function(delay,fn) timers[#timers+1]={at=clock+delay,fn=fn} end}
SNAPS=0
Screenshot=function() SNAPS=SNAPS+1 end
UnitGUID=function() return nil end
CreateFrame=function()
  local f={scripts={}}
  function f:SetScript(k,fn) self.scripts[k]=fn end
  function f:RegisterEvent(e) handlers[e]=handlers[e] or {} table.insert(handlers[e],self) end
  return f
end
local function fire(e,...) for _,f in ipairs(handlers[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
local function wait(dt)
  clock=clock+dt
  local due={} for i=#timers,1,-1 do if timers[i].at<=clock then table.insert(due,1,table.remove(timers,i)) end end
  for _,t in ipairs(due) do t.fn() end
end
dofile('addon/BackstageForever/BackstageForeverMoments.lua')
fire('PLAYER_LOGIN')
`;

test("the pure rules: one request per event, nothing in combat, waiting events share one picture", () => {
  lua(String.raw`
CreateFrame=nil
dofile('addon/BackstageForever/BackstageForeverMoments.lua')
local Q,D=BackstageForeverMomentsShotQueue,BackstageForeverMomentsShotDue
local s={queue={},taken={}}
assert(Q(s,'level',24,100)==true and #s.queue==1)
assert(Q(s,'level',24,101)==false,'the same event asks once')
assert(Q(s,'boss',1144,101)==true and #s.queue==2)
for _,bad in ipairs({{'death',1},{'level',nil},{'level','x'},{'boss',-1},{nil,5},{'level',0/0}}) do assert(Q(s,bad[1],bad[2],101)==false) end
assert(Q(nil,'level',5,1)==false and D(nil,true,false,1)==false)
assert(D(s,true,true,102)==false and #s.queue==2,'never in combat; the events wait')
assert(D(s,true,false,103)==true and #s.queue==0,'two waiting events, one picture')
assert(D(s,true,false,104)==false,'nothing left to take')
assert(Q(s,'boss',1144,110)==false,'the same kill reported again a moment later is ignored')
assert(Q(s,'boss',1144,200)==true,'a later kill of the same boss is a new event')
assert(D(s,false,false,201)==false and #s.queue==0,'switched off: what waited is dropped, no picture')
assert(Q(s,'level',25.9,300)==true and s.queue[1]=='level:25')
`);
});

test("off by default; switched on it takes one screenshot per level-up and boss kill, after combat", () => {
  const out = lua(HARNESS + String.raw`
assert(BackstageForeverMomentsSettings.shots==false,'off until the player switches it on')
fire('PLAYER_LEVEL_UP',24) wait(5)
fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1) wait(5)
assert(SNAPS==0 and #timers==0,'switched off: no screenshot and nothing scheduled')
assert(BackstageForeverMomentsCommand('moments shots on')==true and BackstageForeverMomentsSettings.shots==true)
assert(BackstageForeverMomentsSettings.toasts==true,'the banner switch is untouched')
fire('PLAYER_LEVEL_UP',25)
assert(SNAPS==0,'not at once: a short wait first')
wait(2) assert(SNAPS==1,'one screenshot for the level-up')
wait(60) assert(SNAPS==1)
COMBAT=true
fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
fire('PLAYER_LEVEL_UP',26)
wait(10) assert(SNAPS==1,'nothing while in combat')
COMBAT=false fire('PLAYER_REGEN_ENABLED')
wait(2) assert(SNAPS==2,'one screenshot for the boss and the level together, once out of combat')
fire('PLAYER_REGEN_ENABLED') wait(5) assert(SNAPS==2,'leaving combat again takes nothing new')
fire('ENCOUNTER_END',1145,'Wiped',1,5,0) wait(5) assert(SNAPS==2,'a failed attempt is not a kill')
COMBAT=nil fire('PLAYER_LEVEL_UP',27) wait(5) assert(SNAPS==2,'combat state unknown counts as combat')
COMBAT=false fire('PLAYER_REGEN_ENABLED') wait(2) assert(SNAPS==3)
assert(BackstageForeverMomentsCommand('moments shots off')==false)
fire('PLAYER_LEVEL_UP',28) wait(5) assert(SNAPS==3)
assert(BackstageForeverMomentsCommand('moments shots')==true and BackstageForeverMomentsCommand('moments shots')==false,'no word toggles')
BackstageForeverMomentsCommand('moments shots maybe')
BackstageForeverMomentsCommand('moments off') assert(BackstageForeverMomentsSettings.toasts==false and BackstageForeverMomentsSettings.shots==false)
for _,m in ipairs(messages) do print(m) end
`);
  assert.match(out, /Screenshots on: one picture when you gain a level and one when a dungeon boss falls, taken after combat/);
  assert.match(out, /Screenshots at level-ups and boss kills are off\./); assert.match(out, /Use \/bf moments shots on or \/bf moments shots off\./);
});

test("a client that refuses or lacks Screenshot() switches the helper off and says so once", () => {
  const out = lua(HARNESS + String.raw`
BackstageForeverMomentsCommand('moments shots on')
fire('ADDON_ACTION_FORBIDDEN','SomeOtherAddon','Screenshot()') assert(BackstageForeverMomentsSettings.shots==true,'another addon is not our business')
fire('ADDON_ACTION_BLOCKED','BackstageForever','CastSpellByName()') assert(BackstageForeverMomentsSettings.shots==true)
fire('ADDON_ACTION_FORBIDDEN','BackstageForever','Screenshot()') assert(BackstageForeverMomentsSettings.shots==false)
fire('ADDON_ACTION_FORBIDDEN','BackstageForever','Screenshot()')
fire('PLAYER_LEVEL_UP',30) wait(5) assert(SNAPS==0)
BackstageForeverMomentsCommand('moments shots on')
Screenshot=function() error('blocked') end
fire('PLAYER_LEVEL_UP',31) wait(2) assert(SNAPS==0,'an error inside the call is swallowed')
Screenshot=nil
fire('PLAYER_LEVEL_UP',32) wait(2) assert(BackstageForeverMomentsSettings.shots==false,'no Screenshot function: switched off')
for _,m in ipairs(messages) do print(m) end
`);
  assert.equal((out.match(/does not let addons take screenshots/g) || []).length, 1);
  assert.match(out, /Screenshots are not available in this game client, so the switch was turned off\./);
});

test("the helper only calls Screenshot(), has its switch and its command, and its words are translated", () => {
  const src = read("addon/BackstageForever/BackstageForeverMoments.lua");
  assert.equal((src.match(/plain\(Screenshot\)/g) || []).length, 1, "the game's own function, read in one place");
  assert.doesNotMatch(src, /TakeScreenshot|RunMacroText|SendChatMessage|SetBinding|RunBinding|C_ChatInfo/, "no input, macro, key binding or message is involved");
  assert.match(src, /if type\(s\.shots\)~='boolean' then s\.shots=false end/);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.ok(options.includes("off('BackstageForeverMomentsSettings','shots'),'moments shots')"));
  const catalog = read("src/renderer/commands.js");
  assert.match(catalog, /command: "\/bf moments \[on\|off\|status\|shots on\|shots off\]", word: "moments"/);
  const de = JSON.parse(read("data/i18n/de.json")).addon.plain;
  for (const text of ["Screenshots at big moments", "One screenshot when you gain a level or defeat a dungeon boss, taken after combat.", "Use /bf moments shots on or /bf moments shots off.", "Screenshots at level-ups and boss kills are off.",
    "Screenshots on: one picture when you gain a level and one when a dungeon boss falls, taken after combat. They go to the Screenshots folder of your game.",
    "Screenshots are not available in this game client, so the switch was turned off.", "This game client does not let addons take screenshots, so the switch was turned off. Use the Print Screen key instead."]) {
    assert.ok(src.includes(`'${text}'`) || options.includes(`'${text}'`), text);
    assert.equal(typeof de[text], "string", `German for: ${text}`);
  }
});

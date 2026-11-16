"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler,updater,coordText
local function frame()
  local f={RegisterEvent=function() end,SetSize=function() end,SetPoint=function() end,Show=function(self) self.shown=true end,Hide=function(self) self.shown=false end}
  f.SetScript=function(self,k,fn) if k=='OnEvent' then handler=fn elseif k=='OnUpdate' then updater=function(e) fn(self,e) end end end
  f.CreateFontString=function() return {SetPoint=function() end,SetText=function(_,t) coordText=t end} end
  return f
end
CreateFrame=frame UIParent={} Minimap={}
`;

test("QoL pure helpers: coordinates text and when the game is auto-looting", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverQoL.lua')
assert(BackstageForeverQoLCoords(.4234,.6781)=='42.3, 67.8')
assert(BackstageForeverQoLCoords(0,0)==nil and BackstageForeverQoLCoords(nil,1)==nil and BackstageForeverQoLCoords(2,.5)==nil)
assert(BackstageForeverQoLAutoLoot(true)==true and BackstageForeverQoLAutoLoot(false,true,false)==false)
assert(BackstageForeverQoLAutoLoot(nil,true,false)==true and BackstageForeverQoLAutoLoot(nil,true,true)==false and BackstageForeverQoLAutoLoot(nil,false,true)==true and BackstageForeverQoLAutoLoot(nil,false,false)==false)
`));

test("every helper is off until switched on; each does only its own job", () => lua(STUBS + String.raw`
local cvars={autoLootDefault='1',questFadingDisable='0'}
GetCVar=function(k) return cvars[k] end SetCVar=function(k,v) cvars[k]=v end
IsModifiedClick=function() return false end
local looted={} GetNumLootItems=function() return 3 end LootSlot=function(i) looted[#looted+1]=i end
local mounted=true IsMounted=function() return mounted end
local dismounts=0 Dismount=function() dismounts=dismounts+1 mounted=false end
local combat=false InCombatLockdown=function() return combat end
C_Map={GetBestMapForUnit=function() return 1411 end,GetPlayerMapPosition=function() return {GetXY=function() return .5,.25 end} end}
ERR_TAXIPLAYERALREADYMOUNTED='You are mounted.'
dofile('addon/BackstageForever/BackstageForeverQoL.lua')
handler(nil,'PLAYER_LOGIN')
handler(nil,'LOOT_READY',true) handler(nil,'TAXIMAP_OPENED')
assert(#looted==0 and dismounts==0 and updater==nil and cvars.questFadingDisable=='0','nothing happens while off')
BackstageForeverQoLCommand('qol')
assert(said[1]:find('each off until you switch it on',1,true) and said[2]:find('/bf qol coords on',1,true))
BackstageForeverQoLCommand('qol loot on') handler(nil,'LOOT_READY',true)
assert(table.concat(looted,',')=='3,2,1')
looted={} handler(nil,'LOOT_READY',false) assert(#looted==0,'never loots when the game is not auto-looting')
BackstageForeverQoLCommand('qol dismount on') combat=true handler(nil,'TAXIMAP_OPENED') assert(dismounts==0,'never in combat')
combat=false handler(nil,'TAXIMAP_OPENED') assert(dismounts==1)
mounted=true handler(nil,'UI_ERROR_MESSAGE',50,'You are mounted.') assert(dismounts==2)
handler(nil,'UI_ERROR_MESSAGE',51,'Not enough mana') assert(dismounts==2)
BackstageForeverQoLCommand('qol coords on') updater(1) assert(coordText=='50.0, 25.0',tostring(coordText))
BackstageForeverQoLCommand('qol questtext on') assert(cvars.questFadingDisable=='1')
BackstageForeverQoLCommand('qol questtext off') assert(cvars.questFadingDisable=='0','the earlier game setting comes back')
BackstageForeverQoLCommand('qol coords') assert(BackstageForeverQoLSettings.coords==false,'no on/off toggles')
`));

test("a client without the quest text setting says so; the module stays within its rules", () => {
  lua(STUBS + String.raw`
GetCVar=function() return nil end SetCVar=function() error('no') end
dofile('addon/BackstageForever/BackstageForeverQoL.lua')
BackstageForeverQoLCommand('qol questtext on')
assert(said[1]:find('not available',1,true) and BackstageForeverQoLSettings.questtext==false)
`);
  const src = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverQoL.lua"), "utf8");
  for (const banned of ["AcceptQuest", "CompleteQuest", "GetQuestReward", "SelectGossip", "TakeTaxiNode", "hooksecurefunc", "ConfirmLootSlot"]) assert.ok(!src.includes(banned + "("), banned);
  const toc = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForever.toc"), "utf8");
  assert.match(toc, /BackstageForeverQoLSettings/); assert.match(toc, /BackstageForeverQoL\.lua/);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("enemy alerts: plain description, once per player per 5 minutes, at most one every 4s, bounded history", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverEnemy.lua')
assert(BackstageForeverEnemyDescribe({faction='Alliance',level=32,class='Rogue'})=='Alliance level 32 Rogue')
assert(BackstageForeverEnemyDescribe({faction='Horde',level=-1,class='Warrior'})=='Horde level ?? Warrior')
assert(BackstageForeverEnemyDescribe({})=='Enemy player')
assert(BackstageForeverEnemyAgo(10)=='just now' and BackstageForeverEnemyAgo(125)=='2 min ago' and BackstageForeverEnemyAgo(7300)=='2 h ago' and BackstageForeverEnemyAgo(200000)=='2 days ago')
local s={}
assert(BackstageForeverEnemyNote(s,{name='Ann',faction='Alliance',level=30},100)==true)
assert(BackstageForeverEnemyNote(s,{name='Ann',level=31},150)==false,'same player soon after: no second alert')
assert(s.history[1].level==31 and s.history[1].count==1 and s.history[1].faction=='Alliance')
assert(BackstageForeverEnemyNote(s,{name='Bob'},102)==false,'a second player 2s later is remembered without a second alert')
assert(s.history[1].name=='Bob' and #s.history==2)
assert(BackstageForeverEnemyNote(s,{name='Cy'},160)==true)
assert(BackstageForeverEnemyNote(s,{name='Ann'},150+299)==false,'still around: last sighting keeps it quiet')
assert(BackstageForeverEnemyNote(s,{name='Ann'},449+300)==true,'back after 5 minutes away')
assert(s.history[1].name=='Ann' and s.history[1].count==2)
assert(BackstageForeverEnemyNote(s,{},1)==false and BackstageForeverEnemyNote(nil,{name='x'},1)==false)
for i=1,30 do BackstageForeverEnemyNote(s,{name='P'..i},1000+i*10) end
assert(#s.history==20 and s.history[1].name=='P30')
`));

test("only enemy players who can attack you alert, never in battlegrounds; /bf enemy lists, switches and clears", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler
local shown={}
local function frame()
  local f={RegisterEvent=function() end,SetScript=function(self,k,fn) if k=='OnEvent' then handler=fn end end,SetSize=function() end,SetPoint=function() end,SetFrameStrata=function() end,SetAlpha=function() end,Show=function() shown[#shown+1]=true end,Hide=function() end}
  f.CreateFontString=function() return {SetPoint=function() end,SetTextColor=function() end,SetShadowOffset=function() end,SetText=function(_,t) shown.text=t end} end
  return f
end
CreateFrame=frame UIParent={}
local units={
  target={name='Ann',player=true,attack=true,faction='Alliance',level=32,class='Rogue'},
  mouseover={name='Friend',player=true,attack=false,faction='Alliance',level=20,class='Mage'},
  nameplate1={name='Mob',player=false,attack=true,level=30},
  nameplate2={name='Duel',player=true,attack=true,faction='Horde',level=30,class='Hunter'},
}
UnitExists=function(u) return units[u]~=nil or u=='player' end
UnitIsPlayer=function(u) return units[u] and units[u].player end
UnitIsUnit=function(a,b) return a==b end
UnitCanAttack=function(u) return units[u] and units[u].attack end
UnitFactionGroup=function(u) if u=='player' then return 'Horde' end return units[u] and units[u].faction end
UnitName=function(u) return units[u] and units[u].name end
UnitLevel=function(u) return units[u] and units[u].level end
UnitClass=function(u) return units[u] and units[u].class end
GetRealZoneText=function() return 'Hillsbrad Foothills' end
local kind='none' IsInInstance=function() return kind~='none',kind end
local now=1000 time=function() return now end
local sounds=0 PlaySound=function() sounds=sounds+1 end SOUNDKIT={RAID_WARNING=8959}
dofile('addon/BackstageForever/BackstageForeverEnemy.lua')
handler(nil,'PLAYER_LOGIN')
handler(nil,'PLAYER_TARGET_CHANGED')
assert(shown.text=='Alliance level 32 Rogue nearby',tostring(shown.text))
assert(said[1]:find('Ann in Hillsbrad Foothills',1,true),said[1])
assert(sounds==0,'sound is off by default')
now=1010 handler(nil,'UPDATE_MOUSEOVER_UNIT') handler(nil,'NAME_PLATE_UNIT_ADDED','nameplate1') handler(nil,'NAME_PLATE_UNIT_ADDED','nameplate2')
assert(#said==1,'friendly, NPC and same-faction players never alert')
assert(#BackstageForeverEnemySettings.history==1)
BackstageForeverEnemyCommand('enemy sound on')
units.target.name='Bo' now=1020 handler(nil,'PLAYER_TARGET_CHANGED')
assert(sounds==1)
kind='pvp' units.target.name='Cy' now=1030 handler(nil,'PLAYER_TARGET_CHANGED') kind='none'
assert(#BackstageForeverEnemySettings.history==2,'battlegrounds are left alone')
said={}
now=1200 BackstageForeverEnemyCommand('enemy')
assert(said[1]=='Backstage Forever: Enemy player alerts on, with sound. Recently seen:',said[1])
assert(said[2]=='Backstage Forever:   Bo, Alliance level 32 Rogue in Hillsbrad Foothills, 3 min ago',said[2])
BackstageForeverEnemyCommand('enemy off') assert(BackstageForeverEnemySettings.enabled==false)
units.target.name='Dee' now=2000 handler(nil,'PLAYER_TARGET_CHANGED')
assert(#BackstageForeverEnemySettings.history==2,'off means not even recorded')
BackstageForeverEnemyCommand('enemy clear') assert(#BackstageForeverEnemySettings.history==0)
said={} BackstageForeverEnemyCommand('enemy') assert(said[1]:find('No enemy players seen yet',1,true))
`));

test("secret values are treated as missing, and the module stays read-only", () => {
  lua(String.raw`
issecretvalue=function(v) return v=='SECRET' end
UnitExists=function() return true end UnitIsPlayer=function() return true end UnitIsUnit=function() return false end
UnitCanAttack=function() return true end UnitFactionGroup=function(u) return u=='player' and 'Alliance' or 'Horde' end
UnitName=function() return 'SECRET' end
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
dofile('addon/BackstageForever/BackstageForeverEnemy.lua')
BackstageForeverEnemySeen('target')
assert(#said==0 and #BackstageForeverEnemySettings.history==0)
`);
  const src = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverEnemy.lua"), "utf8");
  for (const banned of ["TargetUnit", "SetRaidTarget", "SendChatMessage", "hooksecurefunc", "ReportPlayer", "SendAddonMessage"]) assert.ok(!src.includes(banned), banned);
  const toc = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForever.toc"), "utf8");
  assert.match(toc, /BackstageForeverEnemySettings/);
  assert.match(toc, /BackstageForeverEnemy\.lua/);
});

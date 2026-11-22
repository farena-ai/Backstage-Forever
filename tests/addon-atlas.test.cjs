"use strict";
// 1.20: the Instance Atlas in game.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const addon = path.join(root, "addon", "BackstageForever");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local combat=false InCombatLockdown=function() return combat end
local playerLevel=19 UnitLevel=function() return playerLevel end
local function widget()
  local w={scripts={},shown=true}
  local methods={SetScript=function(self,k,fn) self.scripts[k]=fn end,SetText=function(self,t) self.text=t end,
    SetTexture=function(self,t) self.texture=t end,Show=function(self) self.shown=true end,Hide=function(self) self.shown=false end,
    IsShown=function(self) return self.shown end,CreateFontString=function() return widget() end,CreateTexture=function() return widget() end}
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
CreateFrame=function(kind,name) local w=widget();if name then _G[name]=w end;return w end
UIParent={} UISpecialFrames={}
`;

test("the committed atlas data is what its sources compile to, and every instance has its painting", () => {
  const { compile } = require("../scripts/build-addon-atlas.cjs");
  const file = fs.readFileSync(path.join(addon, "BackstageForeverAtlasData.lua"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(file, compile());
  const ids = [...file.matchAll(/^\{"(\w+)","[^"]+","([dr])",(\d+),(\d+),"([AHB])",/gm)];
  assert.ok(ids.length >= 27);
  for (const [, id, , min, max] of ids) {
    assert.ok(Number(min) <= Number(max), id);
    const tga = fs.readFileSync(path.join(addon, "Art", "Dungeons", id + ".tga"));
    assert.equal(tga.readUInt16LE(12), 512, id); assert.equal(tga.readUInt16LE(14), 128, id);
  }
  assert.match(file, /Efficient Games.*CC BY 4\.0/);
  const { ART_DIRS, ADDON_FILES } = require("../src/core/game-sync.cjs");
  assert.ok(ART_DIRS.some((d) => d.join("/") === "Art/Dungeons"), "the installer copies the dungeon paintings");
  for (const f of ["BackstageForeverAtlasData.lua", "BackstageForeverAtlas.lua"]) assert.ok(ADDON_FILES.includes(f), f);
});

test("fit, loot rows, tips and the instance opened first", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverBossTips.lua')
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
local fit=BackstageForeverAtlasFit
assert(fit(17,26,19)=='now' and fit(17,26,17)=='now' and fit(17,26,26)=='now' and fit(17,26,27)=='done')
assert(fit(22,30,19)=='soon' and fit(29,38,19)=='later' and fit(nil,1,1)=='later')
local loot=BackstageForeverAtlasLoot('5202~100|2991~50|1822~33')
assert(#loot==3 and loot[1].id==5202 and loot[1].chance==100 and loot[3].id==1822)
assert(#BackstageForeverAtlasLoot('')==0 and #BackstageForeverAtlasLoot(nil)==0)
assert(#BackstageForeverAtlasLoot('1~1|2~1|3~1|4~1|5~1|6~1|7~1|8~1|9~1|10~1')==8,'eight rows fit the window')
assert(type(BackstageForeverAtlasTip('Edwin VanCleef'))=='string' and BackstageForeverAtlasTip('Nobody At All')==nil)
assert(type(BackstageForeverAtlasTip('Baron Geddon'))=='string','a reviewed raid tip row is read too')
local rows=BackstageForeverAtlasData
assert(#rows>=27)
for _,row in ipairs(rows) do
  assert(#row[10]>=1 and #row[10]<=16,row[1]..' fits the boss grid')
  for _,boss in ipairs(row[10]) do assert(#boss[1]<=30,boss[1]) end
end
local function id(level) return rows[BackstageForeverAtlasPick(rows,level)][1] end
assert(id(15)=='rfc',id(15)) assert(id(19)=='wc' or id(19)=='dm',id(19)) assert(id(1)=='rfc')
assert(rows[BackstageForeverAtlasPick(rows,60)][3]=='d','at 60 the first dungeon that still fits opens')
`));

test("/bf atlas opens, closes, opens on a named instance, and stays shut in combat", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverBossTips.lua')
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
combat=true;assert(BackstageForeverAtlasCommand('atlas')==false and said[#said]:find('outside combat',1,true))
combat=false;assert(BackstageForeverAtlasCommand('atlas')==true and BackstageForeverAtlas.shown==true)
assert(BackstageForeverAtlasCommand('atlas')==false and BackstageForeverAtlas.shown==false,'the same command closes it')
assert(BackstageForeverAtlasCommand('atlas sm')==true and BackstageForeverAtlas.shown==true)
local way BackstageForeverWay=function(m) way=m end
assert(BackstageForeverAtlasCommand('atlas dm')==true)
BackstageForeverAtlasData=nil
BackstageForeverAtlas.shown=false
assert(BackstageForeverAtlasCommand('atlas')==false and said[#said]:find('data is missing',1,true))
`));

test("the atlas file only reads, and its one action is a clicked waypoint", () => {
  const src = fs.readFileSync(path.join(addon, "BackstageForeverAtlas.lua"), "utf8");
  for (const forbidden of ["SetUserWaypoint", "SetSuperTracked", "COMBAT_LOG", "SendChatMessage", "EquipItem", "UseContainerItem", "AcceptQuest"]) assert.ok(!src.includes(forbidden), forbidden);
  assert.match(src, /frame\.entrance:SetScript\('OnClick'/);
  assert.match(fs.readFileSync(path.join(addon, "BackstageForeverHUD.lua"), "utf8"), /word=='atlas'/);
});

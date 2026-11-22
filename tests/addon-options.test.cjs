"use strict";
// 1.18: the painted settings window. Each switch runs a /bf command; nothing is changed any other way.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
// A frame whose every method exists; the few the window relies on keep state.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local ran={} SlashCmdList={BACKSTAGEFOREVER=function(m) ran[#ran+1]=m end}
local combat=false InCombatLockdown=function() return combat end
local made={}
local function widget(kind)
  local w={kind=kind,scripts={},shown=true}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn end,
    SetChecked=function(self,v) self.checked=v and true or false end,
    GetChecked=function(self) return self.checked end,
    SetText=function(self,t) self.text=t end,
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end,
    IsShown=function(self) return self.shown end,
    CreateFontString=function() return widget('FontString') end,
    CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
CreateFrame=function(kind,name) local w=widget(kind);made[#made+1]=w;if name then _G[name]=w end;return w end
UIParent={} UISpecialFrames={}
`;

test("every switch reads a yes or no and runs exactly one /bf command each way", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local seen,count={},0
for _,page in ipairs(BackstageForeverOptionsPages) do
  assert(#page.rows<=16,page.title..' fits two columns of eight')
  for _,row in ipairs(page.rows) do
    count=count+1
    assert(type(row.label)=='string' and #row.label<=28,'label fits its column: '..tostring(row.label))
    assert(type(row.about)=='string' and #row.about<=110 and not seen[row.label],row.label)
    seen[row.label]=true
    assert(type(row.get())=='boolean',row.label)
    for _,value in ipairs({true,false}) do
      local before=#ran;row.set(value)
      assert(#ran==before+1,row.label..' runs one command')
      assert(ran[#ran]:match(value and ' on$' or ' off$') or ran[#ran]:match('^ask '),row.label..': '..ran[#ran])
    end
  end
end
assert(count==29,'29 switches, got '..count)
for _,key in ipairs({'questTracker','objectiveHints','questDetours','beforeLeaving','rewardReasons','questBlockers','gatheringMarks','sharedObjectives','keepQuestItems','questItemCue','spellRankReminder'}) do
  local found=false
  for _,m in ipairs(ran) do if m=='helpers '..key..' off' then found=true end end
  assert(found,'all eleven helpers have a switch: '..key)
end
`));

test("saved choices show as they are, with each helper's own default", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local function row(label) for _,p in ipairs(BackstageForeverOptionsPages) do for _,r in ipairs(p.rows) do if r.label==label then return r end end end end
assert(row('Pop-up tips').get()==true and row('Coordinates').get()==false and row('Enemy alert sound').get()==false)
assert(row('Owl button on the minimap').get()==true and row('Price memory').get()==true)
BackstageForeverAssistSettings={toasts=false,bossTips=false} BackstageForeverQoLSettings={coords=true}
BackstageForeverEnemySettings={sound=true} BackstageForeverAskSettings={hidden=true} BackstageForeverLedgerDB={pricesOn=false}
assert(row('Pop-up tips').get()==false and row('Boss tips').get()==false and row('Danger warnings').get()==true)
assert(row('Coordinates').get()==true and row('Enemy alert sound').get()==true)
assert(row('Owl button on the minimap').get()==false and row('Price memory').get()==false)
`));

test("a starting point flips only what differs and the window refuses to open or change in combat", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local quiet=BackstageForeverOptionsPresets[1]
assert(quiet.title=='Quiet')
-- Fresh character: seven are on by default except the enemy sound (already off); danger is already on.
assert(BackstageForeverOptionsApplyPreset(quiet)==6,'six switches differ from the defaults')
local expected={['toasts off']=true,['moments off']=true,['enemy off']=true,['helpers questDetours off']=true,['helpers beforeLeaving off']=true,['supplies off']=true}
assert(#ran==6) for _,m in ipairs(ran) do assert(expected[m],m) end
for _,preset in ipairs(BackstageForeverOptionsPresets) do
  for _,list in ipairs({preset.on or {},preset.off or {}}) do
    for _,label in ipairs(list) do
      local known=false
      for _,p in ipairs(BackstageForeverOptionsPages) do for _,r in ipairs(p.rows) do if r.label==label then known=true end end end
      assert(known,preset.title..' names a real switch: '..label)
    end
  end
end
combat=true
assert(BackstageForeverOptionsOpen()==false and said[#said]:find('outside combat',1,true))
combat=false
assert(BackstageForeverOptionsOpen()==true and BackstageForeverOptions.shown==true)
assert(BackstageForeverOptionsToggle()==false and BackstageForeverOptions.shown==false,'the same command closes it')
GetBuildInfo=function() return '1.60.1','71037' end
BackstageForeverReference={build='1.60.1.70888'}
assert(BackstageForeverBuildBadge()=='Game build 71037 · quest data from build 70888, same patch',BackstageForeverBuildBadge())
BackstageForeverOptionsOpen();assert(BackstageForeverOptions.badge.text=='Game build 71037 · quest data from build 70888, same patch')
`));

test("/bf options, the owl's right-click and four key bindings reach the window", () => {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /word=='options' or word=='settings'/);
  const ask = read("addon/BackstageForever/BackstageForeverAsk.lua");
  assert.match(ask, /'RegisterForClicks','LeftButtonUp','RightButtonUp'/);
  assert.match(ask, /mouse=='RightButton' and type\(BackstageForeverOptionsToggle\)=='function'/);
  const bindings = [...read("addon/BackstageForever/Bindings.xml").matchAll(/<Binding name="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(bindings, ["BACKSTAGEFOREVER_COMPASS", "BACKSTAGEFOREVER_NEXT", "BACKSTAGEFOREVER_ASK", "BACKSTAGEFOREVER_OPTIONS"]);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  for (const name of bindings) assert.ok(options.includes(`BINDING_NAME_${name}=`), name);
  assert.ok(options.includes("BINDING_HEADER_BACKSTAGEFOREVER="));
});

test("the desktop installs every file the addon's list of files names", () => {
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  const listed = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).filter((l) => /\.(lua|xml)$/.test(l));
  assert.deepEqual(listed.filter((f) => !ADDON_FILES.includes(f)), [], "listed in the .toc but never installed");
  assert.ok(ADDON_FILES.includes("Bindings.xml"), "key bindings load from Bindings.xml beside the .toc");
  for (const file of ADDON_FILES) assert.ok(fs.existsSync(path.join(root, "addon/BackstageForever", file)), file);
});

test("the first-login welcome card has three rows with their own painted medallions and never opens in combat", () => {
  lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
assert(#BackstageForeverWelcomeRows==3)
for _,row in ipairs(BackstageForeverWelcomeRows) do assert(#row.title<=24 and #row.text<=96 and row.art:match('^Buttons\\%a+$'),row.title) end
combat=true;assert(BackstageForeverWelcomeOpen()==false)
BackstageForeverWelcomeCommand();assert(said[#said]:find('outside combat',1,true))
combat=false;assert(BackstageForeverWelcomeOpen()==true and BackstageForeverWelcome.shown==true)
`);
  for (const name of ["ask", "compass", "journal"]) {
    const tga = fs.readFileSync(path.join(root, "addon/BackstageForever/Art/Buttons", name + ".tga"));
    assert.equal(tga.readUInt16LE(12), 64, name); assert.equal(tga.readUInt16LE(14), 64, name); assert.equal(tga[16], 32, name + " has alpha");
  }
  const assist = read("addon/BackstageForever/BackstageForeverAssist.lua");
  assert.match(assist, /pcall\(BackstageForeverWelcomeOpen\);shown=ok and value==true/, "first login tries the card, then falls back to the banner");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='welcome'/);
});

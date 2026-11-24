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
assert(count==60,'60 switches, got '..count)
for _,key in ipairs({'questTracker','objectiveHints','questDetours','beforeLeaving','rewardReasons','questBlockers','gatheringMarks','sharedObjectives','keepQuestItems','questItemCue','spellRankReminder'}) do
  local found=false
  for _,m in ipairs(ran) do if m=='helpers '..key..' off' then found=true end end
  assert(found,'all eleven helpers have a switch: '..key)
end
`));

test("the page buttons share the row under the painting without touching, however many pages there are", () => {
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  const [, width, step] = /local PAGE_WIDTH,PAGE_STEP=(\d+),(\d+)/.exec(options).map(Number);
  const [, windowWidth] = /local WIDTH,HEIGHT=(\d+),\d+/.exec(options).map(Number);
  const pages = (options.slice(0, options.indexOf("BackstageForeverOptionsPages=PAGES")).match(/\{title='/g) || []).length;
  assert.equal(pages, 5);
  assert.ok(step - width >= 6, "a gap between two page buttons");
  assert.ok(34 + (pages - 1) * step + width <= windowWidth - 34, "the last page button ends inside the window's margin");
  assert.match(options, /button:SetSize\(PAGE_WIDTH,22\);button:SetPoint\('TOPLEFT',34\+\(i-1\)\*PAGE_STEP,-114\)/);
  let titlesChecked = 0;
  for (const lang of fs.readdirSync(path.join(root, "data/i18n")).filter((n) => n.endsWith(".json"))) {
    const words = JSON.parse(read("data/i18n/" + lang)).addon.plain;
    for (const title of [...options.matchAll(/\{title='(\w+)',rows=/g)].map((m) => m[1])) assert.ok(titlesChecked++ >= 0 &&title.length <= 9 && (words[title] || title).length <= 10, `${lang}: ${title} fits a ${width}
  assert.ok(titlesChecked >= 15, "five page titles in each language");px button`);
  }
});

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
-- Fresh character: Quiet turns off the fourteen interruptions that start on; everything else it names
-- already stands as it wants (the safety warnings on, the extras and the unchecked panels off).
assert(BackstageForeverOptionsApplyPreset(quiet)==14,'fourteen switches differ from the defaults')
local expected={['toasts off']=true,['moments off']=true,['wish off']=true,['boss off']=true,['rares off']=true,['enemy off']=true,['supplies off']=true,['talents levelup off']=true,['comfort weapons off']=true,['notes off']=true,['helpers questDetours off']=true,['helpers beforeLeaving off']=true,['comfort flights off']=true,['comfort rested off']=true}
assert(#ran==14) for _,m in ipairs(ran) do assert(expected[m],m) end
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

test("every starting point names every switch once, and keeps the unchecked and wider-sharing ones off", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local keep={} for _,label in ipairs(BackstageForeverOptionsPresetKeep) do keep[label]=true end
-- Accessibility, the live link, the owl and the other-addon switch are personal: no starting point touches them.
for _,label in ipairs({'Marks without colour','Larger window text','Large buttons','Owl button on the minimap','Live link to the desktop app','Step aside for other addons'}) do assert(keep[label],label) end
local labels,defaults={},{}
for _,page in ipairs(BackstageForeverOptionsPages) do for _,row in ipairs(page.rows) do labels[#labels+1]=row.label;defaults[row.label]=row.get() end end
assert(#BackstageForeverOptionsPresets==3)
for _,preset in ipairs(BackstageForeverOptionsPresets) do
  local state={}
  for _,label in ipairs(preset.on) do assert(state[label]==nil,preset.title..' names '..label..' twice') state[label]=true end
  for _,label in ipairs(preset.off) do assert(state[label]==nil,preset.title..' names '..label..' twice') state[label]=false end
  for _,label in ipairs(labels) do
    if keep[label] then assert(state[label]==nil,preset.title..' leaves '..label..' alone')
    else assert(state[label]~=nil,preset.title..' does not say what '..label..' should be') end
  end
  -- Not checked in the real game yet, or shared beyond the party: a player turns these on one by one.
  for _,label in ipairs({'Bag marks','Dungeon run panel','Run panel stays in combat','Quest list by distance','Raid comms','Guild sharing','Scout mode','Guild events','Guild-run loot notes','Screenshots at big moments','Enemy alert sound'}) do
    assert(state[label]==false,preset.title..' keeps '..label..' off')
  end
  -- Safety and courtesy stay on everywhere.
  for _,label in ipairs({'Low durability warning','Ready check at dungeons','Mail expiry warning','Sell junk button','Party sync','Answer readiness checks','Quest tracker','Minimap pins'}) do
    assert(state[label]==true,preset.title..' keeps '..label..' on')
  end
  assert(#preset.about<=110,preset.title)
  if preset.title=='Leveling' then
    for _,label in ipairs(labels) do if not keep[label] then assert(state[label]==defaults[label],'Leveling is how the addon starts: '..label) end end
    assert(BackstageForeverOptionsApplyPreset(preset)==0,'nothing to change on a fresh character')
  end
end
local quiet,veteran=BackstageForeverOptionsPresets[1],BackstageForeverOptionsPresets[3]
local function has(list,label) for _,l in ipairs(list) do if l==label then return true end end return false end
assert(has(quiet.on,'Danger warnings') and has(quiet.off,'Pop-up tips') and has(quiet.off,'Rare enemy alerts') and has(quiet.off,'Wish list banner'))
assert(has(veteran.on,'Coordinates') and has(veteran.on,'Faster looting') and has(veteran.on,'Instant quest text') and has(veteran.off,'Danger warnings') and has(veteran.off,'Pop-up tips'))
`));

test("the five pages read as one product: what each holds, in order", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local titles,where={},{}
for i,page in ipairs(BackstageForeverOptionsPages) do titles[i]=page.title for _,row in ipairs(page.rows) do where[row.label]=page.title end end
assert(table.concat(titles,',')=='Quests,Alerts,Comfort,Panels,Sharing',table.concat(titles,','))
-- Everything that passes something to other players or to the desktop app sits on one page.
for _,label in ipairs({'Party sync','Answer readiness checks','Group finder board','Guild sharing','Raid comms','Live link to the desktop app','Scout mode'}) do assert(where[label]=='Sharing',label) end
-- Windows the addon draws are Panels; banners and chat lines that speak up by themselves are Alerts.
for _,label in ipairs({'Quest list by distance','Dungeon run panel','Run panel stays in combat','Bag marks'}) do assert(where[label]=='Panels',label) end
for _,label in ipairs({'Wish list banner','Pop-up tips','Rare enemy alerts','Mail expiry warning'}) do assert(where[label]=='Alerts',label) end
for _,label in ipairs({'Gathering marks','Auction shopping list','Marks without colour','Larger window text','Large buttons'}) do assert(where[label]=='Comfort',label) end
-- Every sentence ends as a sentence and no label shouts or ends in a full stop.
for _,page in ipairs(BackstageForeverOptionsPages) do for _,row in ipairs(page.rows) do
  assert(row.about:sub(-1)=='.',row.label..' explains itself in a full sentence')
  assert(row.label:sub(-1)~='.' and row.label:sub(1,1):upper()==row.label:sub(1,1),row.label)
end end
`));

test("/bf options, the owl's right-click and the key bindings reach their windows", () => {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /word=='options' or word=='settings'/);
  const ask = read("addon/BackstageForever/BackstageForeverAsk.lua");
  assert.match(ask, /'RegisterForClicks','LeftButtonUp','RightButtonUp'/);
  assert.match(ask, /mouse=='RightButton' and type\(BackstageForeverOptionsToggle\)=='function'/);
  const bindings = [...read("addon/BackstageForever/Bindings.xml").matchAll(/<Binding name="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(bindings, ["BACKSTAGEFOREVER_COMPASS", "BACKSTAGEFOREVER_NEXT", "BACKSTAGEFOREVER_ASK", "BACKSTAGEFOREVER_OPTIONS", "BACKSTAGEFOREVER_ATLAS", "BACKSTAGEFOREVER_EXPLAIN"]);
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

test("/way X Y [name] places a waypoint on the map you are on, unless another addon owns /way", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local x,y,label=BackstageForeverWayText('51.5 30.9 Thork')
assert(x==51.5 and y==30.9 and label=='Thork')
x,y,label=BackstageForeverWayText(' 45.2, 61.8 ')
assert(x==45.2 and y==61.8 and label=='')
for _,bad in ipairs({'','north','120 50','50','50 -3',string.rep('1',130)}) do assert(BackstageForeverWayText(bad)==nil,bad) end
local sent
BackstageForeverWay=function(m) sent=m end
C_Map={GetBestMapForUnit=function() return 1413 end}
assert(BackstageForeverWayRegister()==true and SLASH_BACKSTAGEFOREVERWAY1=='/way')
SlashCmdList.BACKSTAGEFOREVERWAY('0.5 30 Camp')
assert(sent=='way 1413 0.0050 0.3000 Camp',sent)
sent=nil;SlashCmdList.BACKSTAGEFOREVERWAY('nowhere');assert(sent==nil and said[#said]:find('Use /way X Y',1,true))
SlashCmdList.BACKSTAGEFOREVERWAY=nil;SlashCmdList.TOMTOM_WAY=function() end
assert(BackstageForeverWayRegister()==false,'another waypoint addon keeps /way')
`));

test("/bf perf reports memory and its change in plain words", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
assert(BackstageForeverPerfLine(nil)=='Memory use is not readable in this game client.')
assert(BackstageForeverPerfLine(2560)=='Memory in use: 2.5 MB.')
assert(BackstageForeverPerfLine(3072,2560,300)=='Memory in use: 3.0 MB. +0.5 MB since you last asked, 5 min ago.')
assert(BackstageForeverPerfLine(2048,2560,90)=='Memory in use: 2.0 MB. -0.5 MB since you last asked, 2 min ago.')
assert(BackstageForeverPerfLine(8192,2048,120):find('growing fast',1,true))
local kb,t=2048,100
UpdateAddOnMemoryUsage=function() end GetAddOnMemoryUsage=function(name) assert(name=='BackstageForever') return kb end GetTime=function() return t end
BackstageForeverPerfCommand();assert(said[#said]=='Backstage Forever: Memory in use: 2.0 MB.',said[#said])
kb,t=2560,400;BackstageForeverPerfCommand();assert(said[#said]:find('+0.5 MB since you last asked, 5 min ago.',1,true),said[#said])
GetAddOnMemoryUsage=nil;BackstageForeverPerfCommand();assert(said[#said]:find('not readable',1,true))
`));

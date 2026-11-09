const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
test("addon declares real loader/export and only guarded event snapshots", () => {
  const dir = path.join(__dirname, "../addon/BackstageForever");
  const toc = fs.readFileSync(path.join(dir, "BackstageForever.toc"), "utf8"),
    lua = fs.readFileSync(path.join(dir, "BackstageForever.lua"), "utf8");
  assert.match(toc, /## Interface: 16001/);
  assert.match(toc, /## SavedVariables: BackstageForeverExport/);
  for (const token of [
    "issecretvalue",
    "pcall",
    "InCombatLockdown",
    "PLAYER_LOGIN",
    "PLAYER_LEVEL_UP",
    "ZONE_CHANGED_NEW_AREA",
    "PLAYER_REGEN_ENABLED",
    "PLAYER_LOGOUT",
    "UnitGUID",
    "100",
  ])
    assert.ok(lua.includes(token), token);
  assert.doesNotMatch(
    lua,
    /OnUpdate|ReloadUI|SendChatMessage|RunMacro|http:\/\//,
  );
});

test("addon executes persistence, combat, secret-value and unavailable API guards in Lua", (t) => {
  let cli;
  try {
    cli = require.resolve("fengari-node-cli/src/lua-cli.js");
  } catch {
    t.skip("Install fengari-node-cli to run Lua VM verification");
    return;
  }
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, [cli, "-"], {
    cwd: path.join(__dirname, ".."),
    input: LUA_HARNESS,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", result.stderr);
  assert.match(result.stdout, /Addon runtime persistence/);
});
const LUA_HARNESS = String.raw`local handler
CreateFrame=function() return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end} end
issecretvalue=function(v) return v=='SECRET' end
InCombatLockdown=function() return false end
local who='Player-synthetic-one'
UnitGUID=function()return who end
UnitFullName=function()return 'Example','Example Realm' end
UnitClass=function()return 'Mage','MAGE',8 end
UnitLevel=function()return 12 end
UnitRace=function()return 'Human','Human',1 end
UnitFactionGroup=function()return 'Alliance','Alliance' end
GetZoneText=function()return 'Test Zone' end
GetSubZoneText=function()return '' end
time=function()return 1700000000 end
UnitXP=function()return 20 end
UnitXPMax=function()return 100 end
GetXPExhaustion=function()return 40 end
C_QuestLog={GetNumQuestLogEntries=function()return 1 end,GetInfo=function()return {questID=42,title='Observed quest',isHeader=false,level=12} end,IsComplete=function()return true end,GetQuestObjectives=function()return {{text='Real objective',finished=true}} end}
C_Map={GetBestMapForUnit=function()return 1 end,GetPlayerMapPosition=function()return {GetXY=function()return .4,.5 end}end}
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(type(BackstageForeverExport)=='string','Multi-return player APIs must produce a snapshot')
assert(BackstageForeverExport:find('Player%-synthetic%-one'))
assert(BackstageForeverExport:find('"complete":true',1,true))
assert(BackstageForeverExport:find('"current":20',1,true))
local inspected=false
local protected=setmetatable({}, {__index=function() inspected=true;error('secret inspection') end})
issecretvalue=function(v)return v==protected or v=='SECRET' end
C_QuestLog.GetInfo=function()return protected end
handler(nil,'QUEST_LOG_UPDATE');assert(not inspected)
assert(not BackstageForeverExport:find('"quests":',1,true))
C_QuestLog.GetNumQuestLogEntries=function()return 0 end
handler(nil,'QUEST_LOG_UPDATE');assert(BackstageForeverExport:find('"quests":[]',1,true))
local first=BackstageForeverExport
who='Player-synthetic-two'
-- Simulate the next login with persisted JSON and a fresh addon roster.
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('Player%-synthetic%-one'))
assert(BackstageForeverExport:find('Player%-synthetic%-two'))
InCombatLockdown=function()return true end
local before=BackstageForeverExport
handler(nil,'PLAYER_LEVEL_UP');assert(before==BackstageForeverExport)
InCombatLockdown=function()return false end
UnitGUID=function()return 'SECRET' end
handler(nil,'PLAYER_REGEN_ENABLED');assert(before==BackstageForeverExport)
UnitGUID=function()error('unavailable')end
handler(nil,'PLAYER_LOGOUT');assert(before==BackstageForeverExport)
print('Addon runtime persistence/combat/secret/API guards passed')
`;
test("native readiness handles multi-return metadata and failures without losing identity or leaking errors", () => {
  const script =
    LUA_HARNESS.slice(0, LUA_HARNESS.indexOf("dofile('addon")) +
    String.raw`
local diagnostic
BackstageForeverHUDCaptureStatus=function(state) diagnostic=state end
GetInventoryItemID=function(unit,slot)assert(unit=='player' and slot>=1 and slot<=19);if slot==1 then return 123 end end
C_Item={GetItemInfo=function(id)assert(id==123);return 'Observed helm','PRIVATE ITEM LINK',3,42,1,'Armor' end}
Enum={BagIndex={Backpack=0,Bag_1=1,Bag_2=2,Bag_3=3,Bag_4=4}}
C_Container={GetContainerNumSlots=function(bag)return 4 end,GetContainerNumFreeSlots=function(bag)return 2,99 end}
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('"readiness":',1,true),'Readiness must be captured')
assert(BackstageForeverExport:find('"itemLevel":42',1,true),'Fourth API return must survive')
assert(BackstageForeverExport:find('"quality":3',1,true))
assert(BackstageForeverExport:find('"free":10',1,true))
assert(not BackstageForeverExport:find('PRIVATE',1,true))
GetInventoryItemID=nil
handler(nil,'BAG_UPDATE_DELAYED')
assert(BackstageForeverExport:find('"bags":',1,true) and not BackstageForeverExport:find('"equipment":',1,true),'Missing gear API must not imply empty gear')
GetInventoryItemID=function()return 'SECRET' end
C_Map.GetBestMapForUnit=function()return .5 end
handler(nil,'PLAYER_EQUIPMENT_CHANGED')
assert(not BackstageForeverExport:find('"mapId":',1,true),'Invalid optional map must not poison snapshot identity')
assert(not BackstageForeverExport:find('SECRET',1,true))
GetInventoryItemID=function()error('PRIVATE ERROR TOKEN') end
C_Container.GetContainerNumSlots=function()error('PRIVATE ERROR TOKEN') end
handler(nil,'BAG_UPDATE_DELAYED')
assert(BackstageForeverExport:find('Player%-synthetic%-one'))
assert(not BackstageForeverExport:find('"readiness":',1,true),'Unavailable APIs must not look like empty equipment')
assert(diagnostic=='partial','Fixed diagnostic required on optional API failure')
assert(not BackstageForeverExport:find('PRIVATE',1,true))
UnitGUID=function()error('PRIVATE CORE ERROR')end
local before=BackstageForeverExport
handler(nil,'PLAYER_LEVEL_UP');assert(before==BackstageForeverExport and diagnostic=='unavailable')
print('Readiness and fixed diagnostics passed')`;
  const result = require("node:child_process").spawnSync(
    process.execPath,
    [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"],
    {
      cwd: path.join(__dirname, ".."),
      input: script,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Readiness and fixed diagnostics passed/);
});
test("native compass executes visibility, collapse and combat hiding in Lua", () => {
  const { spawnSync } = require("node:child_process");
  const cli = require.resolve("fengari-node-cli/src/lua-cli.js");
  const result = spawnSync(process.execPath, [cli, "-"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 10000,
    input: String.raw`
local events,panel,title,closeButton,collapseButton
local fontStrings={}
local measuredHeight
local messages={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,text)messages[#messages+1]=text end}
local fighting=false
InCombatLockdown=function()return fighting end
SlashCmdList={}
local methods={}
methods.SetPoint=function(self,point,relative,relativePoint,x,y)self.anchor={point=point,x=x,y=y} end
methods.SetHeight=function(self,height)self.height=height end
methods.GetStringHeight=function()return measuredHeight end
methods.GetPoint=function()return 'CENTER',UIParent,'CENTER',321,123 end
methods.StartMoving=function(self)self.moving=true end
methods.StopMovingOrSizing=function(self)self.moving=false end
for _,k in ipairs({'SetSize','SetMovable','EnableMouse','RegisterForDrag','SetClampedToScreen','SetBackdrop','SetBackdropColor','RegisterEvent','SetWidth','SetJustifyH','SetAllPoints','ClearAllPoints'}) do methods[k]=function()end end
methods.SetText=function(self,text)self.text=text end
methods.Show=function(self)self.visible=true end
methods.Hide=function(self)self.visible=false end
methods.SetScript=function(self,event,fn)self[event]=fn end
methods.CreateFontString=function()local f=setmetatable({}, {__index=methods});fontStrings[#fontStrings+1]=f;return f end
CreateFrame=function(kind,name,parent)
 local f=setmetatable({}, {__index=methods})
 if name=='BackstageForeverCompass' then panel=f elseif name=='BackstageForeverCompassClose' then closeButton=f elseif name=='BackstageForeverCompassCollapse' then collapseButton=f elseif kind=='Button' and not name then title=f elseif kind=='Frame' then events=f end
 return f
end
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
events.OnEvent(nil,'PLAYER_LOGIN');assert(panel.visible)
local hint=false;for _,font in ipairs(fontStrings)do if font.text and font.text:find('/bf show',1,true) then hint=true end end
assert(hint,'Reopen instructions must be visible even before a snapshot')
BackstageForeverHUDUpdate({name='Example',level=12,className='Mage',location={zone='Actual zone'},quests={},progress={current=1,max=100}})
assert(closeButton and collapseButton,'Visible close and collapse controls are required')
title.OnDragStart(title);assert(panel.moving,'Title must drag the parent compass')
title.OnDragStop(title);assert(not panel.moving)
assert(BackstageForeverHUDSettings.x==321 and BackstageForeverHUDSettings.y==123)
measuredHeight=500;BackstageForeverHUDUpdate({name='Example',level=12,className='Mage',location={zone='Actual zone'}})
assert(type(fontStrings[2].height)=='number' and fontStrings[2].height<=260 and panel.height<=440,'Long text must leave room for controls and footer')
collapseButton.OnClick();assert(BackstageForeverHUDSettings.collapsed)
closeButton.OnClick();assert(not panel.visible and BackstageForeverHUDSettings.visible==false)
assert(messages[#messages]:find('/bf show',1,true),'Closing must explain how to reopen')
SlashCmdList.BACKSTAGEFOREVER('show')
BackstageForeverHUDCaptureStatus('unavailable')
assert(fontStrings[2].text:find('Snapshot unavailable',1,true),'Capture failures must be visible as friendly fixed text')
BackstageForeverHUDCaptureStatus('PRIVATE ERROR TOKEN')
assert(not fontStrings[2].text:find('PRIVATE',1,true),'Arbitrary diagnostic input must never be displayed')
SlashCmdList.BACKSTAGEFOREVER('show');assert(panel.visible)
-- A fresh Lua load retains hidden state without affecting export content.
closeButton.OnClick()
dofile('addon/BackstageForever/BackstageForeverHUD.lua')
events.OnEvent(nil,'PLAYER_LOGIN');assert(not panel.visible)
assert(panel.anchor.x==321 and panel.anchor.y==123,'Position must restore after reload')
SlashCmdList.BACKSTAGEFOREVER('hide');assert(not panel.visible)
SlashCmdList.BACKSTAGEFOREVER('show');assert(panel.visible)
fighting=true;events.OnEvent(nil,'PLAYER_REGEN_DISABLED');assert(not panel.visible)
SlashCmdList.BACKSTAGEFOREVER('show');assert(not panel.visible)
fighting=false;events.OnEvent(nil,'PLAYER_REGEN_ENABLED');assert(panel.visible)
print('HUD guards passed')`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", result.stderr);
  assert.match(result.stdout, /HUD guards passed/);
});
test("export sheds older optional detail under one MiB while retaining 100 identities", () => {
  const quest = {
    id: 1,
    title: "Q".repeat(200),
    complete: false,
    objectives: Array.from({ length: 5 }, () => ({
      text: "O".repeat(200),
      done: false,
    })),
  };
  const characters = Array.from({ length: 99 }, (_, i) => ({
    id: "old-" + i,
    name: "Example",
    realm: "Realm",
    className: "Mage",
    level: 12,
    updatedAt: 1600000000,
    quests: [],
  }));
  let index = 0;
  while (true) {
    const c = characters[index % 99];
    c.quests.push({ ...quest, id: c.quests.length + 1 });
    const bytes = Buffer.byteLength(
      JSON.stringify({
        schema: 1,
        characters,
        activeId: "old-0",
        observedAt: 1600000000,
      }),
    );
    if (bytes > 1040000) {
      c.quests.pop();
      break;
    }
    index++;
  }
  const saved = JSON.stringify({
    schema: 1,
    characters,
    activeId: "old-0",
    observedAt: 1600000000,
  });
  const script =
    LUA_HARNESS.slice(0, LUA_HARNESS.indexOf("dofile('addon")) +
    `\nBackstageForeverExport=[=[${saved}]=]\nC_QuestLog.GetNumQuestLogEntries=function()return 25 end\nC_QuestLog.GetInfo=function(i)return {questID=i,title=string.rep('Q',200),isHeader=false,level=12}end\nC_QuestLog.GetQuestObjectives=function()local t={};for i=1,5 do t[i]={text=string.rep('O',200),finished=false} end;return t end\ndofile('addon/BackstageForever/BackstageForever.lua')\nhandler(nil,'PLAYER_LOGIN')\nassert(#BackstageForeverExport<1048576)\nprint(BackstageForeverExport)`;
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(
    process.execPath,
    [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"],
    {
      cwd: path.join(__dirname, ".."),
      input: script,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1048576,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", result.stderr);
  const exported = JSON.parse(result.stdout.trim());
  const transport =
    "BackstageForeverExport = " + JSON.stringify(result.stdout.trim());
  const parsed = require("../src/core/game-sync.cjs").parseSavedVariables(
    transport,
  );
  assert.equal(parsed.characters.length, 100);
  assert.equal(exported.characters.length, 100);
  assert.ok(exported.characters.some((c) => c.quests === undefined));
  assert.equal(exported.characters[0].quests.length, 25);
});

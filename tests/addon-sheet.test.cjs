"use strict";
// Character sheet and gear sets addon (0.36): stats from public Unit* reads, /bf set save, wear,
// list and delete. Wear equips only from bags, only when typed, and never in combat. Runs the
// real Lua in fengari.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
// A synthetic client: what is worn, what sits in the bags, and an EquipItemByName that moves an
// item from the bags to the slot it is given. Automation entry points error.
const WORLD = String.raw`
local said={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local captures=0
BackstageForeverRequestCapture=function() captures=captures+1 end
local t=1700000000
time=function() return t end
local combat=false
InCombatLockdown=function() return combat end
local cursor=false
CursorHasItem=function() return cursor end
local names={[1001]='Leveling Helm',[1002]='Dungeon Helm',[2001]='Band A',[2002]='Band B',[3001]='Long Sword',[3002]='Kite Shield',[4001]='Fishing Pole',[5001]='Bank Boots'}
GetItemInfo=function(id) return names[id] end
local wornBy={[1]=1001,[11]=2001,[12]=2002,[16]=3001,[17]=3002}
GetInventoryItemID=function(unit,slot) assert(unit=='player') return wornBy[slot] end
local bag={}
C_Container={GetContainerNumSlots=function(b) return b==0 and 16 or 0 end,GetContainerItemInfo=function(b,s) if b==0 and bag[s] then return {itemID=bag[s]} end end}
local equips={}
EquipItemByName=function(id,slot)
  equips[#equips+1]={id,slot}
  for s,x in pairs(bag) do if x==id then bag[s]=wornBy[slot] wornBy[slot]=id return end end
  error('not in bags')
end
for _,name in ipairs({'PickupContainerItem','PickupInventoryItem','UseContainerItem','AutoEquipCursorItem','DeleteCursorItem','EquipCursorItem','PutItemInBackpack'}) do
  _G[name]=function() error('automation call: '..name) end
end
UnitStat=function(_,i) local v={52,31,47,120,98} return v[i]-5,v[i],5,0 end
UnitArmor=function() return 400,612,612,0,0 end
UnitAttackPower=function() return 60,12,-2 end
UnitRangedAttackPower=function() return 20,0,0 end
UnitResistance=function(_,i) return 0,i==2 and 15 or 0,0,0 end
UnitHealthMax=function() return 980 end
UnitPowerType=function() return 0,'MANA' end
UnitPowerMax=function() return 1450 end
dofile('addon/BackstageForever/BackstageForeverSheet.lua')
`;
test("stats come from public Unit reads: effective primary stats, armor, attack power, resistances, health and mana", () => lua(WORLD + String.raw`
local s=BackstageForeverSheetStats()
assert(s.schemaVersion==1 and s.seenAt==t)
assert(s.strength==52 and s.agility==31 and s.stamina==47 and s.intellect==120 and s.spirit==98,'effective values, not base')
assert(s.armor==612 and s.attackPower==70 and s.rangedAttackPower==20)
assert(s.resist.fire==15 and s.resist.holy==0 and s.resist.arcane==0)
assert(s.health==980 and s.power==1450 and s.powerKind=='mana')
UnitStat=nil UnitArmor=nil UnitAttackPower=nil UnitRangedAttackPower=nil UnitResistance=nil UnitHealthMax=nil
assert(BackstageForeverSheetStats()==nil,'nothing readable, nothing exported')
print('ok')
`));
test("/bf set save, list and delete keep item ids per slot for this character", () => lua(WORLD + String.raw`
assert(BackstageForeverSetCommand('set save Leveling')==5)
assert(said[#said]=='Backstage Forever: Saved set "Leveling": 5 items.',said[#said])
assert(captures==1,'the app hears about a new set on the next save')
local db=BackstageForeverSheetDB.sets.leveling
assert(db.name=='Leveling' and db.slots[1]==1001 and db.slots[17]==3002 and db.names[11]=='Band A' and db.savedAt==t)
assert(BackstageForeverSetCommand('set save leveling')==5 and said[#said]:find('Updated set "leveling"',1,true),'same name in any case updates, as last typed')
assert(BackstageForeverSetCommand('SET save Dungeon run')==5)
local e=BackstageForeverSheetSets()
assert(#e.sets==2 and e.sets[1].name=='Dungeon run' and e.sets[2].name=='leveling')
assert(#e.sets[2].items==5 and e.sets[2].items[1].slot==1 and e.sets[2].items[1].itemId==1001 and e.sets[2].items[1].name=='Leveling Helm')
assert(BackstageForeverSetCommand('set list')==2)
assert(said[#said]:find('leveling: 5 items, 5 worn now, 0 in your bags, 0 elsewhere',1,true),said[#said])
assert(BackstageForeverSetCommand('set delete dungeon run')==true and #BackstageForeverSheetSets().sets==1)
assert(BackstageForeverSetCommand('set delete nothing')==false)
assert(BackstageForeverSetCommand('set save '..string.rep('x',25))==nil and said[#said]:find('1 to 24',1,true),'long names are refused')
assert(BackstageForeverSetCommand('set save bad|name')==nil,'escape characters are refused')
assert(BackstageForeverSetCommand('set')==nil and said[#said]:find('/bf set save NAME',1,true))
for i=1,19 do BackstageForeverSetCommand('set save s'..i) end
assert(BackstageForeverSetCommand('set save one too many')==nil and said[#said]:find('20 sets',1,true))
wornBy={} assert(BackstageForeverSetCommand('set save s1')==nil and said[#said]:find('nothing to save',1,true),'an empty save keeps the old set')
assert(BackstageForeverSheetDB.sets.s1.slots[1]==1001)
print('ok')
`));
test("/bf set wear equips saved pieces from the bags only, names what is missing and leaves worn pieces alone", () => lua(WORLD + String.raw`
BackstageForeverSetCommand('set save Dungeon')
-- Swap to leveling gear by hand: the dungeon helm and shield go to the bags, a fishing pole is in the main hand.
wornBy={[1]=1002,[11]=2002,[12]=2001,[16]=4001} bag={[1]=1001,[2]=3001,[3]=3002}
local r=BackstageForeverSetCommand('set wear dungeon')
assert(r.equipped==3 and r.already==0,'helm, sword and shield come out of the bags')
assert(equips[1][1]==1001 and equips[1][2]==1 and equips[2][1]==3001 and equips[2][2]==16 and equips[3][1]==3002 and equips[3][2]==17,'slot order: main hand before off hand')
assert(#r.elsewhere==2 and r.elsewhere[1]:find('Band A (in Ring 2)',1,true),'rings worn in the other slot are not pulled off')
assert(#r.missing==0)
assert(said[#said-1]:find('Wearing "Dungeon": 3 put on, 0 already on.',1,true),said[#said-1])
equips={}
r=BackstageForeverSetCommand('set wear Dungeon')
assert(r.equipped==0 and r.already==3 and #equips==0,'nothing to do when the set is on')
-- A saved piece that is neither worn nor in the bags (bank, mail, sold) is named, never fetched.
BackstageForeverSheetDB.sets.dungeon.slots[8]=5001 BackstageForeverSheetDB.sets.dungeon.names[8]='Bank Boots'
r=BackstageForeverSetCommand('set wear Dungeon')
assert(#r.missing==1 and r.missing[1]=='Bank Boots' and said[#said]:find('Not in your bags: Bank Boots',1,true))
assert(BackstageForeverSetCommand('set wear nothing')==nil and said[#said]:find('No set called',1,true))
print('ok')
`));
test("/bf set wear refuses in combat and with an item on the cursor, before touching anything", () => lua(WORLD + String.raw`
BackstageForeverSetCommand('set save Dungeon')
wornBy={[1]=1002} bag={[1]=1001}
combat=true
assert(BackstageForeverSetCommand('set wear Dungeon')=='combat')
assert(#equips==0 and said[#said]=='Backstage Forever: You are in combat. Gear sets can only be worn out of combat.',said[#said])
InCombatLockdown=nil
assert(BackstageForeverSetCommand('set wear Dungeon')=='combat','an unknown combat state counts as combat')
InCombatLockdown=function() return false end
cursor=true
assert(BackstageForeverSetCommand('set wear Dungeon')=='cursor' and #equips==0)
cursor=false
assert(BackstageForeverSetCommand('set wear Dungeon').equipped==1 and #equips==1)
-- Saving, listing and deleting work in combat: they only read what you wear.
combat=true InCombatLockdown=function() return combat end
assert(BackstageForeverSetCommand('set list')==1)
print('ok')
`));
test("capture exports stats and gear sets as JSON arrays, and a daily gold log in the ledger", () => {
  const harness = fs.readFileSync(path.join(__dirname, "addon.test.cjs"), "utf8");
  const start = harness.indexOf("const LUA_HARNESS = String.raw`") + "const LUA_HARNESS = String.raw`".length;
  const base = harness.slice(start, harness.indexOf("dofile('addon", start));
  lua(base + String.raw`
GetInventoryItemID=function(_,slot) if slot==1 then return 1001 end end
GetItemInfo=function() return 'Leveling Helm' end
UnitStat=function(_,i) return 10,10+i,0,0 end
GetMoney=function() return 5000 end
GetNumFactions=function() return 0 end
dofile('addon/BackstageForever/BackstageForeverLedger.lua')
dofile('addon/BackstageForever/BackstageForeverSheet.lua')
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('"gearSets":{"schemaVersion":1,"sets":[]}',1,true) or BackstageForeverExport:find('"sets":[],"schemaVersion":1',1,true),'no sets is an empty list')
assert(BackstageForeverExport:find('"stats":{',1,true) and BackstageForeverExport:find('"strength":11',1,true))
assert(BackstageForeverExport:find('"moneyLog":[[5000,1700000000]]',1,true),'today\'s gold')
BackstageForeverSetCommand('set save Leveling')
handler(nil,'PLAYER_LEVEL_UP')
assert(BackstageForeverExport:find('"items":[{',1,true) and BackstageForeverExport:find('"name":"Leveling"',1,true))
print('ok')
`);
});
test("the daily gold log keeps one sample per day, newest last, thirty days at most", () => lua(String.raw`
local t=1700000000
time=function() return t end
local money=100
GetMoney=function() return money end
dofile('addon/BackstageForever/BackstageForeverLedger.lua')
BackstageForeverLedgerSnapshot()
money=150 t=t+600
local s=BackstageForeverLedgerSnapshot()
assert(#s.moneyLog==1 and s.moneyLog[1][1]==150 and s.moneyLog[1][2]==t,'the same day keeps the latest')
for i=1,40 do t=t+86400 money=money+10 BackstageForeverLedgerSnapshot() end
s=BackstageForeverLedgerSnapshot()
assert(#s.moneyLog==30 and s.moneyLog[30][1]==money and s.moneyLog[1][2]<s.moneyLog[30][2])
t=t-86400*5 assert(#BackstageForeverLedgerSnapshot().moneyLog==30,'a clock going back adds nothing')
print('ok')
`));
test("the sheet module is installed, saved per character and never replaces a Blizzard function", () => {
  const dir = path.join(__dirname, "../addon/BackstageForever");
  const toc = fs.readFileSync(path.join(dir, "BackstageForever.toc"), "utf8"), src = fs.readFileSync(path.join(dir, "BackstageForeverSheet.lua"), "utf8");
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverSheetDB/);
  assert.match(toc, /^BackstageForeverSheet\.lua\r?$/m);
  for (const call of ["PickupContainerItem", "PickupInventoryItem", "UseContainerItem", "EquipCursorItem", "AutoEquipCursorItem", "DeleteCursorItem", "hooksecurefunc", "SendChatMessage", "RegisterEvent"])
    assert.ok(!src.includes(call + "("), `sheet must not call ${call}`);
  assert.doesNotMatch(src, /^\s*(?!BackstageForever)[A-Za-z][A-Za-z0-9_]*\s*=\s*function/m, "no global function replaced");
  assert.match(fs.readFileSync(path.join(dir, "BackstageForeverHUD.lua"), "utf8"), /word=='set'[\s\S]{0,120}BackstageForeverSetCommand/);
});

test("1.2: the Gear sets button lists your sets and wears one with a click, never in combat", () => lua(String.raw`
local made={}
local function widget(kind,name)
  local w={kind=kind,name=name,shown=false,enabled=true,scripts={}}
  for _,m in ipairs({'SetSize','SetPoint','ClearAllPoints','SetBackdrop','SetFrameStrata','SetWidth','SetJustifyH','RegisterEvent'}) do w[m]=function() end end
  function w:SetText(t) self.text=t end
  function w:SetScript(k,fn) self.scripts[k]=fn end
  function w:Show() self.shown=true end
  function w:Hide() self.shown=false end
  function w:IsShown() return self.shown end
  function w:Disable() self.enabled=false end
  function w:Enable() self.enabled=true end
  function w:CreateFontString() return widget('FontString') end
  made[#made+1]=w
  return w
end
CreateFrame=function(kind,name) return widget(kind,name) end
PaperDollFrame=widget('Frame','PaperDollFrame') CharacterFrame=widget('Frame','CharacterFrame')
` + WORLD.replace("dofile('addon/BackstageForever/BackstageForeverSheet.lua')", "") + String.raw`
dofile('addon/BackstageForever/BackstageForeverSheet.lua')
local events for _,w in ipairs(made) do if w.scripts.OnEvent then events=w.scripts.OnEvent end end
events(nil,'PLAYER_LOGIN')
local button for _,w in ipairs(made) do if w.name=='BackstageForeverSetButton' then button=w end end
assert(button and button.text=='Gear sets','the button sits on the character window')
BackstageForeverSetCommand('set save Leveling')
wornBy[1]=nil bag[1]=1001
local rows=BackstageForeverSetMenuRows()
assert(#rows==1 and rows[1].name=='Leveling' and rows[1].ready==1 and rows[1].missing==0,'one piece back in the bags')
button.scripts.OnClick()
local menu for _,w in ipairs(made) do if w.name=='BackstageForeverSetMenu' then menu=w end end
assert(menu and menu.shown and menu.rows[1].text=='Leveling','the list opens')
menu.rows[1].scripts.OnClick()
assert(wornBy[1]==1001 and #equips==1 and not menu.shown,'one click wears the set and closes the list')
combat=true events(nil,'PLAYER_REGEN_DISABLED')
assert(button.enabled==false,'disabled in combat')
button.scripts.OnClick() assert(not menu.shown,'no list in combat')
combat=false events(nil,'PLAYER_REGEN_ENABLED') assert(button.enabled==true)
print('ok')
`));

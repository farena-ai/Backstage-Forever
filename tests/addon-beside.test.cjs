"use strict";
// 1.25: working beside other addons (F7) and the shopping list at the auction house (E8).
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const BESIDE = "dofile('addon/BackstageForever/BackstageForeverBeside.lua')\n";
const SHOP = "dofile('addon/BackstageForever/BackstageForeverShop.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local combat=false InCombatLockdown=function() return combat end
local handlers={}
local function widget(kind)
  local w={kind=kind,scripts={},shown=true}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn if k=='OnEvent' then handlers[#handlers+1]=fn end end,
    SetText=function(self,t) self.text=t end, SetHeight=function(self,h) self.height=h end,
    SetWidth=function(self,v) self.width=v end, SetSize=function(self,a,b) self.width=a self.height=b end,
    SetWordWrap=function(self,v) self.wrap=v end,
    SetPoint=function(self,...) self.point={...} end,
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end,
    IsShown=function(self) return self.shown end,
    CreateFontString=function() return widget('FontString') end,
    CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
CreateFrame=function(kind,name) local w=widget(kind);if name then _G[name]=w end;return w end
UIParent={}
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local function last() return said[#said] end
`;

test("detection: only addons that are really running, from a fixed list", () => lua(BESIDE + String.raw`
local running={Questie=true,TomTom=true,Bagnon=true,ElvUI=true,SomethingElse=true}
local found=BackstageForeverBesideDetect(function(name) return running[name]==true end)
local names={} for i,a in ipairs(found) do names[i]=a.name..':'..a.kind end
assert(table.concat(names,' ')=='Questie:quest TomTom:way Bagnon:bags ElvUI:ui',table.concat(names,' '))
assert(#BackstageForeverBesideDetect(function() return false end)==0 and #BackstageForeverBesideDetect(nil)==0)
assert(#BackstageForeverBesideDetect(function() error('boom') end)==0,'a failing game call finds nothing')
assert(#BackstageForeverBesideDetect(function() return 1 end)==0,'only a plain true counts')
assert(BackstageForeverBesideBecause(found,'minimap')=='Questie' and BackstageForeverBesideBecause(found,'plates')=='Questie' and BackstageForeverBesideBecause(found,'way')=='TomTom')
assert(BackstageForeverBesideBecause(found,'shop')==nil and BackstageForeverBesideBecause(nil,'minimap')==nil)
local seen={}
for _,row in ipairs(BackstageForeverBesideAddons) do
  assert(type(row[1])=='string' and not seen[row[1]],row[1]) seen[row[1]]=true
  for _,key in ipairs(row[3] or {}) do
    local known=key=='way'
    for _,f in ipairs(BackstageForeverBesideFeatures) do if f.key==key then known=true end end
    assert(known,row[1]..' names a feature that does not exist: '..key)
  end
end
for _,name in ipairs({'Questie','pfQuest','TomTom','Bagnon','ElvUI','Leatrix_Maps','AtlasLootClassic'}) do assert(seen[name],name) end
for _,f in ipairs(BackstageForeverBesideFeatures) do assert(f.off:find(f.command,1,true),'the line names the command that turns it back on: '..f.key) end
`));

test("the decision table: step aside once, respect the player's choice, come back when the other addon is gone", () => lua(BESIDE + String.raw`
local questie={{name='Questie',kind='quest',yields={'minimap','plates'}}}
local pf={{name='pfQuest',kind='quest',yields={'minimap'}}}
local function decide(detected,current,memory,enabled)
  local actions,keep=BackstageForeverBesideDecide(detected,current,memory,enabled)
  local words={} for i,a in ipairs(actions) do words[i]=a.feature..'='..a.action..(a.because and ('/'..a.because) or '') end
  local kept={} for _,k in ipairs({'minimap','plates','shop'}) do if keep[k] then kept[#kept+1]=k..':'..keep[k] end end
  return table.concat(words,' '),table.concat(kept,' ')
end
local on={minimap=true,plates=true,shop=true}
local a,k=decide({},on,nil,true) assert(a=='' and k=='','nothing found, nothing done')
a,k=decide(questie,on,nil,true) assert(a=='minimap=off/Questie plates=off/Questie' and k=='minimap:yielded plates:yielded',a..' | '..k)
a,k=decide(pf,on,nil,true) assert(a=='minimap=off/pfQuest' and k=='minimap:yielded','only what that addon also draws')
-- Next login, still off: nothing more is said or done.
a,k=decide(questie,{minimap=false,plates=false,shop=true},{minimap='yielded',plates='yielded'},true) assert(a=='' and k=='minimap:yielded plates:yielded')
-- The player switched the pins back on: left alone from now on.
a,k=decide(questie,{minimap=true,plates=false,shop=true},{minimap='yielded',plates='yielded'},true) assert(a=='' and k=='minimap:kept plates:yielded',k)
a,k=decide(questie,{minimap=true,plates=false,shop=true},{minimap='kept',plates='yielded'},true) assert(a=='' and k=='minimap:kept plates:yielded')
a,k=decide(questie,{minimap=false,plates=false,shop=true},{minimap='kept',plates='yielded'},true) assert(a=='' and k=='minimap:kept plates:yielded','kept means hands off, whichever way it stands')
-- The player had it off before we ever looked: their choice, never "restored" later.
a,k=decide(questie,{minimap=false,plates=true,shop=true},nil,true) assert(a=='plates=off/Questie' and k=='minimap:kept plates:yielded',a..' | '..k)
a,k=decide({},{minimap=false,plates=false,shop=true},{minimap='kept',plates='yielded'},true) assert(a=='plates=on' and k=='','only what we switched off comes back: '..a..' | '..k)
-- The other addon is gone and the player had turned it on in between: nothing to do.
a,k=decide({},{minimap=true,plates=true,shop=true},{minimap='yielded'},true) assert(a=='' and k=='')
-- Stepping aside switched off: what we switched off comes back, the player's own choices stay.
a,k=decide(questie,{minimap=false,plates=false,shop=true},{minimap='kept',plates='yielded'},false) assert(a=='plates=on' and k=='minimap:kept',a..' | '..k)
a,k=decide(questie,on,nil,false) assert(a=='' and k=='')
-- Auction addons and the shopping list.
a,k=decide({{name='Auctionator',kind='auction',yields={'shop'}}},on,nil,true) assert(a=='shop=off/Auctionator' and k=='shop:yielded')
a,k=decide(questie,nil,nil,true) assert(a=='minimap=off/Questie plates=off/Questie','an unknown state counts as on, the default')
-- The lines.
assert(BackstageForeverBesideLine({feature='minimap',action='off',because='Questie'})=='Questie also draws quest pins on the minimap, so ours are off. /bf minimap on turns them back on.')
assert(BackstageForeverBesideLine({feature='plates',action='on'})=='Quest icons over enemies: back on. The addon it stepped aside for is no longer running.')
assert(BackstageForeverBesideLine({feature='nope',action='off'})==nil and BackstageForeverBesideLine(nil)==nil)
local lines=BackstageForeverBesideLines({},nil,true)
assert(#lines==1 and lines[1]:find('None of the addons',1,true))
local found={questie[1],{name='TomTom',kind='way',yields={'way'}},{name='Bagnon',kind='bags',yields={}},{name='ElvUI',kind='ui',yields={}}}
lines=BackstageForeverBesideLines(found,{minimap='yielded',plates='kept'},true,'TomTom')
assert(lines[1]=='Other addons found: Questie (quest helper), TomTom (waypoints), Bagnon (bags), ElvUI (interface).',lines[1])
assert(lines[2]=='  Minimap pins: off because of Questie. /bf minimap on turns it back on.' and lines[3]=='  Quest icons over enemies: left as you set it, beside Questie.')
assert(lines[4]=='  /way is left to TomTom. /bf way still works.' and lines[5]:find('Bag marks are drawn on the game\'s own bags only',1,true) and #lines==5)
lines=BackstageForeverBesideLines({found[4]},{},true) assert(#lines==2 and lines[2]=='  Nothing needed changing.')
lines=BackstageForeverBesideLines(found,{minimap='yielded'},false) assert(#lines==2 and lines[2]:find('Stepping aside is off',1,true))
`));

test("in game: pins and nameplate icons step aside for Questie once, with one line each; /way is left to TomTom", () => lua(STUBS + String.raw`
local running={Questie=true,TomTom=true}
C_AddOns={IsAddOnLoaded=function(name) return running[name]==true end}
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
local function login() handlers[#handlers](nil,'PLAYER_LOGIN') local t=timers timers={} for _,fn in ipairs(t) do fn() end end
SlashCmdList={}
BackstageForeverMinimapSettings={enabled=true} BackstageForeverRouteSettings={plates=true}
local refreshed=0 BackstageForeverPlatesRefresh=function() refreshed=refreshed+1 end
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
`+ BESIDE + String.raw`
login()
assert(BackstageForeverMinimapSettings.enabled==false and BackstageForeverRouteSettings.plates==false and refreshed==1)
assert(#said==2 and said[1]=='Backstage Forever: Questie also draws quest pins on the minimap, so ours are off. /bf minimap on turns them back on.',said[1])
assert(said[2]:find('/bf plates on turns them back on',1,true))
assert(BackstageForeverBesideSettings.memory.minimap=='yielded')
login() assert(#said==2,'said once, not at every login')
-- /way stays with TomTom even before TomTom has registered its command.
assert(BackstageForeverBesideYields('way')=='TomTom' and BackstageForeverWayRegister()==false and SlashCmdList.BACKSTAGEFOREVERWAY==nil)
-- The player turns the pins back on: never touched again.
BackstageForeverMinimapSettings.enabled=true login()
assert(#said==2 and BackstageForeverMinimapSettings.enabled==true and BackstageForeverBesideSettings.memory.minimap=='kept')
BackstageForeverBesideCommand('addons')
assert(said[3]=='Backstage Forever: Other addons found: Questie (quest helper), TomTom (waypoints).' and said[4]:find('Minimap pins: left as you set it',1,true)
  and said[5]:find('Quest icons over enemies: off because of Questie',1,true) and said[6]:find('/way is left to TomTom',1,true) and #said==6)
-- Questie is removed: the icons come back, with one line.
running.Questie=nil login()
assert(BackstageForeverRouteSettings.plates==true and last()=='Backstage Forever: Quest icons over enemies: back on. The addon it stepped aside for is no longer running.' and BackstageForeverBesideSettings.memory.plates==nil)
-- Stepping aside off: /way is ours again.
running.Questie=true login() assert(BackstageForeverRouteSettings.plates==false)
BackstageForeverBesideCommand('addons off')
assert(BackstageForeverRouteSettings.plates==true and BackstageForeverBesideEnabled()==false and BackstageForeverBesideYields('way')==nil)
assert(BackstageForeverWayRegister()==true and SlashCmdList.BACKSTAGEFOREVERWAY~=nil)
-- In combat nothing is switched.
BackstageForeverBesideCommand('addons on') assert(BackstageForeverRouteSettings.plates==false)
combat=true BackstageForeverBesideCommand('addons off') assert(BackstageForeverBesideEnabled()==true and last():find('outside combat',1,true))
`));

test("an older game client without C_AddOns still answers, and without either call nothing is found", () => lua(STUBS + String.raw`
IsAddOnLoaded=function(name) return name=='pfQuest' end
`+ BESIDE + String.raw`
assert(BackstageForeverBesideYields('minimap')=='pfQuest' and BackstageForeverBesideYields('plates')==nil)
IsAddOnLoaded=nil
assert(BackstageForeverBesideYields('minimap')==nil)
BackstageForeverBesideCommand('addons') assert(last():find('None of the addons',1,true))
`));

test("shopping list: what the profession plan still needs, safe names for the search box", () => lua(SHOP + String.raw`
local R=BackstageForeverShopRows
local rows=R({shoppingRows={
  {itemId=2840,name='Copper Bar',required=8,have=2,missing=6},
  {itemId=2880,name='Weak Flux',required=2,have=2,missing=0},
  {itemId=2589,name='Linen Cloth',required=4,missing=nil},
  {itemId=1,name='',required=4,missing=2},{itemId=2,required=4,missing=2},'junk',
  {itemId=3,name='|cff1eff00|Hitem:3::::|h[Green Thing]|h|r',required=1,missing=1},
  {itemId=4,name='Bad Amount',required=1,missing=-3},{itemId=5,name='Huge',required=1,missing=1/0}}})
local names={} for i,r in ipairs(rows) do names[i]=r.name..'='..tostring(r.missing) end
assert(table.concat(names,' ')=='Copper Bar=6 Linen Cloth=nil [Green Thing]=1 Bad Amount=nil Huge=nil',table.concat(names,' '))
assert(R(nil)==nil and R({})==nil and #R({shoppingRows={}})==0)
local many={} for i=1,30 do many[i]={name='Item '..i,missing=1} end
assert(#R({shoppingRows=many})==12,'twelve lines at most')
local S=BackstageForeverShopSearch
assert(S('Copper Bar')=='Copper Bar' and S('  Copper   Bar ')=='Copper Bar' and S('|cffffffffCopper|r Bar')=='Copper Bar' and S('a|b')=='ab' and S('line\nbreak')=='line break')
assert(S('')==nil and S('|')==nil and S(nil)==nil and S(5)==nil and #S(string.rep('x',100))==63 and S(string.rep('\195\164',40))==string.rep('\195\164',31))
assert(BackstageForeverShopAmount({missing=6})=='6 missing' and BackstageForeverShopAmount({})=='amount not known' and BackstageForeverShopAmount(nil)=='')
local lines=BackstageForeverShopLines(rows)
assert(#lines==6 and lines[1]=='Shopping list from your profession plan: 5 items.' and lines[2]=='  Copper Bar: 6 missing' and lines[3]=='  Linen Cloth: amount not known')
assert(BackstageForeverShopLines({})[1]:find('needs nothing more right now',1,true) and BackstageForeverShopLines(nil)[1]:find('not readable yet',1,true))
`));

test("at the auction house: the panel sits beside the window, a click only writes the search text, Search is never pressed", () => lua(STUBS + String.raw`
local searched,typed=0,nil
BrowseName={SetText=function(self,text) typed=text end}
AuctionFrame={name='AuctionFrame'}
AuctionFrameBrowse_Search=function() searched=searched+1 end QueryAuctionItems=function() searched=searched+1 end
BrowseSearchButton={Click=function() searched=searched+1 end}
local coach={shoppingRows={{name='Copper Bar',required=8,missing=6},{name='Linen Cloth',required=4}}}
BackstageForeverBuildProfessionCoach=function(character,choice) assert(character.id=='c1' and choice.recipeId==77) return coach end
BackstageForeverHUDSettings={profession={recipeId=77}}
`+ SHOP + String.raw`
fire('AUCTION_HOUSE_SHOW') assert(BackstageForeverShopFrame==nil,'no capture yet: no panel')
BackstageForeverShopUpdate({id='c1'})
fire('AUCTION_HOUSE_SHOW')
local f=BackstageForeverShopFrame
assert(f and f.shown and f.point[1]=='TOPLEFT' and f.point[2]==AuctionFrame and f.point[3]=='TOPRIGHT','beside the auction window')
assert(f.lines[1].left.text=='Copper Bar' and f.lines[1].right.text=='6 missing' and f.lines[2].right.text=='amount not known' and not f.lines[3].shown)
assert(f.lines[1].left.wrap==false and f.lines[1].left.width+f.lines[1].right.width+6<=f.width-28,'the two columns fit side by side')
f.lines[1].scripts.OnClick(f.lines[1])
assert(typed=='Copper Bar' and searched==0,'the name is written; the search is yours to press')
-- A search box that refuses, or is missing: the name is said instead.
BrowseName.SetText=function() error('blocked') end
f.lines[2].scripts.OnClick(f.lines[2]) assert(last()=='Backstage Forever: The search box is not reachable here. Search for: Linen Cloth')
BrowseName=nil AuctionHouseFrame={SearchBar={SearchBox={SetText=function(self,text) typed='new:'..text end}}}
f.lines[2].scripts.OnClick(f.lines[2]) assert(typed=='new:Linen Cloth')
combat=true typed=nil f.lines[1].scripts.OnClick(f.lines[1]) assert(typed==nil and last():find('leave combat',1,true)) combat=false
fire('AUCTION_HOUSE_CLOSED') assert(not f.shown)
fire('AUCTION_HOUSE_SHOW') assert(f.shown) fire('PLAYER_REGEN_DISABLED') assert(not f.shown)
combat=true fire('AUCTION_HOUSE_SHOW') assert(not f.shown,'never opened in combat') combat=false
-- Nothing to buy: no panel. Off: no panel, but /bf shop still answers.
coach={shoppingRows={{name='Copper Bar',required=8,missing=0}}}
fire('AUCTION_HOUSE_SHOW') assert(not f.shown)
coach={shoppingRows={{name='Copper Bar',required=8,missing=6}}}
BackstageForeverShopCommand('shop off') assert(BackstageForeverShopSettings.enabled==false and last():find('Auction shopping list: off',1,true))
fire('AUCTION_HOUSE_SHOW') assert(not f.shown)
BackstageForeverShopCommand('shop') assert(said[#said-1]=='Backstage Forever: Shopping list from your profession plan: 1 item.' and last()=='Backstage Forever:   Copper Bar: 6 missing')
BackstageForeverShopCommand('shop on') fire('AUCTION_HOUSE_SHOW') assert(f.shown)
assert(searched==0)
`));

test("wiring: files listed, words routed and catalogued, switches in the options, nothing that searches or buys", () => {
  const shop = read("addon/BackstageForever/BackstageForeverShop.lua");
  for (const never of ["QueryAuctionItems", "AuctionFrameBrowse_Search", ":Click(", "PlaceAuctionBid", "StartAuction", "SendSearchQuery", "SendBrowseQuery", "loadstring"]) assert.ok(!shop.includes(never), never);
  const beside = read("addon/BackstageForever/BackstageForeverBeside.lua");
  for (const never of ["DisableAddOn", "EnableAddOn", "hooksecurefunc", "loadstring", "SlashCmdList"]) assert.ok(!beside.includes(never), never);
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  const { CATALOG } = require("../src/renderer/commands.js");
  for (const [file, saved, word, fn] of [["BackstageForeverShop.lua", "BackstageForeverShopSettings", "shop", "BackstageForeverShopCommand"], ["BackstageForeverBeside.lua", "BackstageForeverBesideSettings", "addons", "BackstageForeverBesideCommand"]]) {
    assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes(file), file);
    assert.ok(toc.includes(file) && toc.includes(saved), file);
    assert.ok(hud.includes(`if word=='${word}' then\n                if type(${fn})=='function' then pcall(${fn},message)end`), word);
    assert.ok(CATALOG.some((c) => c.word === word), word);
    assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), new RegExp(`'/bf ${word} - `));
  }
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.ok(options.includes("on('BackstageForeverShopSettings','enabled'),'shop'") && options.includes("on('BackstageForeverBesideSettings','enabled'),'addons'"));
  assert.match(options, /BackstageForeverBesideYields,'way'/);
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /pcall\(BackstageForeverShopUpdate,character\)/);
});

"use strict";
// 1.24: the wish list in game: the loot banner, /bf wish, /bf bags and the optional bag marks.
// Pure functions first, then the game-facing parts with stubs.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverPanels.lua')\ndofile('addon/BackstageForever/BackstageForeverWish.lua')\n";

test("a loot line: the item by the id in its link, and who looted by the game's own sentences in any language", () => lua(FILE + String.raw`
local link='|cff1eff00|Hitem:5193::::::::20:::::|h[Cape of the Brotherhood]|h|r'
local id,name=BackstageForeverLootItemId('You receive loot: '..link..'.')
assert(id==5193 and name=='Cape of the Brotherhood')
id,name=BackstageForeverLootItemId('Ihr erhaltet Beute: |cffffffff|Hitem:2589:0:0:0|h[Leinenstoff]|h|rx3.') assert(id==2589 and name=='Leinenstoff')
id,name=BackstageForeverLootItemId('|Hitem:77|h') assert(id==77 and name==nil)
assert(BackstageForeverLootItemId('You receive loot: a thing.')==nil and BackstageForeverLootItemId(nil)==nil and BackstageForeverLootItemId(('x'):rep(1001))==nil)
assert(BackstageForeverLootItemId('|Hitem:0|h[x]|h')==nil and BackstageForeverLootItemId('|Hitem:99999999999999|h[x]|h')==nil)
assert(BackstageForeverLootItemId('|Hspell:5193|h[Not an item]|h')==nil)
assert(BackstageForeverLootPattern('%s receives loot: %s.')=='^(.+) receives loot: (.+)%.$')
assert(BackstageForeverLootPattern('%s receives loot: %sx%d.')=='^(.+) receives loot: (.+)x(%d+)%.$')
assert(BackstageForeverLootPattern('%2$s (%1$s)')=='^(.+) %((.+)%)$' and BackstageForeverLootPattern('')==nil and BackstageForeverLootPattern(5)==nil)
local en={self={'You receive loot: %sx%d.','You receive loot: %s.','You receive item: %s.'},other={'%s receives loot: %sx%d.','%s receives loot: %s.','%s receives item: %s.'}}
local K=BackstageForeverLootKind
assert(K('You receive loot: '..link..'.',en)=='self' and K('You receive item: '..link..'.',en)=='self' and K('You receive loot: '..link..'x3.',en)=='self')
local kind,who=K('Thrallina receives loot: '..link..'.',en) assert(kind=='other' and who=='Thrallina')
kind,who=K('Thrallina receives loot: '..link..'x2.',en) assert(kind=='other' and who=='Thrallina')
-- Rolls, passes and "won" lines carry a link too, but they are not loot.
assert(K('Thrallina has selected Need for: '..link,en)==nil and K('You won: '..link,en)==nil and K('Thrallina passed on: '..link,en)==nil and K(nil,en)==nil)
-- German sentences, and a language that names the looter second.
local de={self={'Ihr erhaltet Beute: %s.'},other={'%s bekommt Beute: %s.'}}
assert(K('Ihr erhaltet Beute: '..link..'.',de)=='self')
kind,who=K('Jaina bekommt Beute: '..link..'.',de) assert(kind=='other' and who=='Jaina')
kind,who=K(link..' fuer Jaina.',{self={},other={'%2$s fuer %1$s.'}}) assert(kind=='other' and who=='Jaina','the capture without a link is the name')
assert(K('You receive loot: '..link..'.',de)==nil,'another language simply does not match')
-- No sentences at all to compare with: say so instead of guessing.
assert(K('anything '..link,{self={},other={}})=='unknown' and K('anything',nil)=='unknown')
`));

test("the banner: once per item a minute, everything waiting in one banner, and who looted only when known", () => lua(FILE + String.raw`
local queue,recent={},{}
local Q=BackstageForeverWishQueue
assert(Q(queue,recent,5193,'Cape','self',100)==true and #queue==1)
assert(Q(queue,recent,5193,'Cape','self',130)==false and #queue==1,'the roll line and the loot line name it twice')
assert(Q(queue,recent,5193,'Cape','Ann',161)==true and #queue==2)
assert(Q(queue,recent,5193,'Cape','Ann',50)==true,'a clock that went backwards does not silence it for good')
for i=1,5 do Q(queue,recent,100+i,'x',nil,200) end
assert(#queue==5,'at most five wait: '..#queue)
assert(Q(nil,recent,1,'x',nil,1)==false and Q(queue,recent,'a','x',nil,1)==false)
local B=BackstageForeverWishBanner
local title,sub=B({{id=5193,name='Cape of the Brotherhood',who='self'}})
assert(title=='On your wish list: Cape of the Brotherhood' and sub=='You looted it.')
title,sub=B({{id=5193,name='Cape',who='Thrallina'}}) assert(sub=='Thrallina looted it.')
title,sub=B({{id=5193,name='Cape'}}) assert(title=='On your wish list: Cape' and sub==nil,'nobody is named when the game did not say')
title,sub=B({{id=5193},{id=7,name='Seven'},{id=8}},function(id) return id==5193 and 'Looked up' or nil end)
assert(title=='On your wish list: Looked up' and sub=='And also: Seven, Item #8')
assert(B({})==nil and B(nil)==nil)
`));

test("/bf wish: each wish with the bosses seen to drop it, best chance first, and plain words when nothing is known", () => lua(FILE + String.raw`
local rows={
  {'dm','The Deadmines','d',17,26,'A',1436,.42,.72,{{'Sneed','5194~60|5195~30'},{'Edwin VanCleef','5193~33|5194~10'}},{}},
  {'wc','Wailing Caverns','d',17,24,'B',1413,.46,.36,{{'Kresh','5194~75'},{'Skum','5194~5'}},{}},
}
local s=BackstageForeverWishSources(rows,5194)
assert(#s==4 and s[1].boss=='Kresh' and s[1].place=='Wailing Caverns' and s[1].chance==75 and s[2].boss=='Sneed' and s[4].boss=='Skum')
assert(#BackstageForeverWishSources(rows,1)==0 and #BackstageForeverWishSources(nil,5194)==0)
local names={[5194]='Taskmaster Axe',[5193]='Cape of the Brotherhood'}
local lines=BackstageForeverWishLines({[5194]=true,[5193]=true,[42]=true},rows,function(id) return names[id] end)
assert(#lines==5 and lines[1]=='Your wish list: 3 items.')
assert(lines[2]=='  Cape of the Brotherhood: Edwin VanCleef, The Deadmines (33%)',lines[2])
assert(lines[3]=='  Item #42: no boss in the Instance Atlas was seen to drop it',lines[3])
assert(lines[4]=='  Taskmaster Axe: Kresh, Wailing Caverns (75%); Sneed, The Deadmines (60%); +2',lines[4])
assert(lines[5]=='Seen drops, not promises. The Instance Atlas (/bf atlas) marks them too.')
assert(BackstageForeverWishLines({[5193]=true},rows)[1]=='Your wish list: 1 item.')
local empty=BackstageForeverWishLines({},rows) assert(#empty==1 and empty[1]:find('Your wish list is empty',1,true) and empty[1]:find('/reload',1,true))
local many={} for i=1,20 do many[i]=true end
lines=BackstageForeverWishLines(many,rows,nil,12) assert(#lines==15 and lines[14]=='  +8 more')
`));

test("bags: upgrade, wish and quest item, each with bag and slot, and a sign that never rests on colour", () => lua(FILE + String.raw`
local items={{bag=1,slot=3,id=30},{bag=0,slot=9,id=10},{bag=0,slot=2,id=20,quest=true},{bag=2,slot=1,id=40},{bag=2,slot=2,id=10,quest=true},'junk',{bag=0,slot=1}}
local marked=BackstageForeverBagMarks(items,{[10]=true,[30]=true},{[30]=true})
assert(#marked==4,'the unmarked item and the junk rows are left out: '..#marked)
assert(marked[1].bag==0 and marked[1].slot==2 and marked[1].quest and not marked[1].wish and not marked[1].upgrade)
assert(marked[2].slot==9 and marked[2].wish and marked[3].bag==1 and marked[3].upgrade and marked[3].wish and marked[4].wish and marked[4].quest)
assert(#BackstageForeverBagMarks(items,nil,nil)==2 and #BackstageForeverBagMarks(nil,{},{})==0)
local S=BackstageForeverBagSign
assert(S({upgrade=true})=='|cff40ff40+|r' and S({wish=true})=='|cffffd100*|r' and S({quest=true})=='|cffffff00!|r')
assert(S({upgrade=true,wish=true,quest=true})=='|cff40ff40+|r|cffffd100*|r|cffffff00!|r' and S({})=='' and S(nil)=='')
local lines=BackstageForeverBagLines(marked,function(id) return 'Thing '..id end)
assert(#lines==5 and lines[1]=='Marked in your bags: 4 items.')
assert(lines[2]=='  Backpack, slot 2: Thing 20 - quest item' and lines[3]=='  Backpack, slot 9: Thing 10 - on your wish list')
assert(lines[4]=='  Bag 1, slot 3: Thing 30 - upgrade, on your wish list' and lines[5]=='  Bag 2, slot 2: Thing 10 - on your wish list, quest item')
assert(BackstageForeverBagLines({marked[1]})[1]=='Marked in your bags: 1 item.' and BackstageForeverBagLines({marked[1]})[2]=='  Backpack, slot 2: Item #20 - quest item')
assert(BackstageForeverBagLines({})[1]=='Nothing in your bags is an upgrade, a wish or a quest item.')
assert(BackstageForeverBagLines(nil)[1]=='Your bags are not readable in this game client.')
local many={} for i=1,20 do many[i]={bag=0,slot=i,id=i,quest=true} end
lines=BackstageForeverBagLines(many) assert(#lines==16 and lines[16]=='  +6 more')
`));

// A small game: chat, combat, a wish list from the desktop app, bags, and bag windows.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local combat=false InCombatLockdown=function() return combat end
local handlers={}
CreateFrame=function()
  local f={RegisterEvent=function() end}
  f.SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end
  return f
end
local function fire(event,...) for _,h in ipairs(handlers) do h(nil,event,...) end end
UnitName=function() return 'Tester' end GetRealmName=function() return 'Realm' end
local clock=1000 GetTime=function() return clock end
LOOT_ITEM_SELF='You receive loot: %s.' LOOT_ITEM_SELF_MULTIPLE='You receive loot: %sx%d.' LOOT_ITEM='%s receives loot: %s.' LOOT_ITEM_MULTIPLE='%s receives loot: %sx%d.'
BackstageForeverDesktopData={schema=1,characters={['Tester-Realm']={wish={5193,5194},up={5194,6000}},['Other-Realm']={wish={1}}}}
local toasts={} BackstageForeverToast=function(title,sub,big,kind) toasts[#toasts+1]={title=title,sub=sub,kind=kind} end
local names={[5193]='Cape of the Brotherhood',[5194]='Taskmaster Axe',[6000]='Better Boots',[7000]='Quest Thing',[8000]='Plain Thing'}
GetItemInfo=function(id) return names[id] end
local function link(id) return '|cff1eff00|Hitem:'..id..'::::::::20:::::|h['..(names[id] or 'x')..']|h|r' end
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
`;

test("a wished item in loot chat: a banner outside combat, queued during combat, silent when switched off", () => lua(STUBS + FILE + String.raw`
fire('PLAYER_LOGIN')
fire('CHAT_MSG_LOOT','You receive loot: '..link(8000)..'.') assert(#toasts==0,'not wished: nothing')
fire('CHAT_MSG_LOOT','Thrallina has selected Need for: '..link(5193)) assert(#toasts==0,'a roll is not loot')
fire('CHAT_MSG_LOOT','You receive loot: '..link(5193)..'.')
assert(#toasts==1 and toasts[1].title=='On your wish list: Cape of the Brotherhood' and toasts[1].sub=='You looted it.' and toasts[1].kind=='gear')
fire('CHAT_MSG_LOOT','You receive loot: '..link(5193)..'.') assert(#toasts==1,'once a minute per item')
-- Someone in your group, during a fight: it waits.
combat=true
fire('CHAT_MSG_LOOT','Thrallina receives loot: '..link(5194)..'.') assert(#toasts==1,'never in combat')
clock=1100 fire('CHAT_MSG_LOOT','Jaina receives loot: '..link(5193)..'.') assert(#toasts==1)
combat=false fire('PLAYER_REGEN_ENABLED')
assert(#toasts==2 and toasts[2].title=='On your wish list: Taskmaster Axe' and toasts[2].sub=='And also: Cape of the Brotherhood','both waiting items in one banner')
fire('PLAYER_REGEN_ENABLED') assert(#toasts==2,'the queue is empty again')
-- A wish of another character is not yours.
fire('CHAT_MSG_LOOT','You receive loot: |Hitem:1|h[Other wish]|h.') assert(#toasts==2)
-- Secret text in combat is skipped, not read.
issecretvalue=function(v) return v=='SECRET' end
clock=1300 fire('CHAT_MSG_LOOT','SECRET') assert(#toasts==2)
issecretvalue=nil
-- Off: nothing, not even queued for later.
BackstageForeverWishCommand('wish off') assert(BackstageForeverPanelSettings.wish==false and last():find('Wish list banner: off',1,true))
clock=1400 fire('CHAT_MSG_LOOT','Thrallina receives loot: '..link(5193)..'.') assert(#toasts==2)
BackstageForeverWishCommand('wish on') assert(BackstageForeverPanelSettings.wish==true)
fire('PLAYER_REGEN_ENABLED') assert(#toasts==2)
fire('CHAT_MSG_LOOT','Thrallina receives loot: '..link(5193)..'.') assert(#toasts==3 and toasts[3].sub=='Thrallina looted it.')
-- Without the banner frame it is still said in chat.
BackstageForeverToast=nil
clock=1600 fire('CHAT_MSG_LOOT','You receive loot: '..link(5194)..'x2.')
assert(last()=='Backstage Forever: On your wish list: Taskmaster Axe You looted it.',last())
-- /bf wish lists them with the real Atlas data: unknown ids are said to be unknown.
local before=#said
local lines=BackstageForeverWishCommand('wish')
assert(lines[1]=='Your wish list: 2 items.' and said[before+1]=='Backstage Forever: Your wish list: 2 items.' and #said==before+#lines)
assert(lines[2]:find('  Cape of the Brotherhood: ',1,true)==1 and lines[3]:find('  Taskmaster Axe: ',1,true)==1)
`));

test("without the game's loot sentences the banner still names the item, and the looter only from the event", () => lua(STUBS.replace(/LOOT_ITEM\w*='[^']*' ?/g, "") + FILE + String.raw`
assert(LOOT_ITEM==nil and LOOT_ITEM_SELF==nil)
fire('CHAT_MSG_LOOT','whatever words '..link(5193),'','','','Tester-Realm')
assert(#toasts==1 and toasts[1].sub=='You looted it.')
clock=2000 fire('CHAT_MSG_LOOT','whatever words '..link(5193),'','','','Jaina-Realm') assert(toasts[2].sub=='Jaina looted it.')
clock=3000 fire('CHAT_MSG_LOOT','whatever words '..link(5193),'') assert(#toasts==3 and toasts[3].sub==nil)
`));

test("/bf bags lists marked items; bag marks draw only after the game's own bag code and never replace it", () => lua(STUBS + String.raw`
local bags={[0]={[1]=8000,[2]=5194,[3]=7000,[4]=6000},[1]={[2]=5193}}
C_Container={GetContainerNumSlots=function(bag) return bags[bag] and 4 or 0 end,
  GetContainerItemID=function(bag,slot) return bags[bag] and bags[bag][slot] end,
  GetContainerItemQuestInfo=function(bag,slot) return {isQuestItem=bags[bag][slot]==7000} end}
` + FILE + String.raw`
fire('PLAYER_LOGIN')
local lines=BackstageForeverBagsCommand('bags')
assert(#lines==5 and lines[1]=='Marked in your bags: 4 items.',lines[1])
assert(lines[2]=='  Backpack, slot 2: Taskmaster Axe - upgrade, on your wish list' and lines[3]=='  Backpack, slot 3: Quest Thing - quest item')
assert(lines[4]=='  Backpack, slot 4: Better Boots - upgrade' and lines[5]=='  Bag 1, slot 2: Cape of the Brotherhood - on your wish list')
combat=true BackstageForeverBagsCommand('bags') assert(last():find('outside combat',1,true)) combat=false
-- No bag code to draw after: the switch refuses and says where the list is.
assert(BackstageForeverPanelEnabled('bags')==false,'off by default')
BackstageForeverBagsCommand('bags marks on')
assert(BackstageForeverPanelSettings.bags==false and last():find('no safe place to draw on bag buttons',1,true))
-- The game's bag window (the classic shape): a frame with numbered item buttons.
local function button(id)
  local b={id=id,made=0}
  b.GetID=function(self) return self.id end
  b.CreateFontString=function(self) self.made=self.made+1
    local l={shown=true} l.SetPoint=function() end l.SetText=function(s,t) s.text=t end l.Show=function(s) s.shown=true end l.Hide=function(s) s.shown=false end
    self.label=l return l end
  return b
end
ContainerFrame1={size=4,GetName=function() return 'ContainerFrame1' end,GetID=function() return 0 end,IsShown=function() return true end}
for i=1,4 do _G['ContainerFrame1Item'..i]=button(i) end
local drawn=0
local original=function() drawn=drawn+1 end
ContainerFrame_Update=original
local posts={}
hooksecurefunc=function(name,fn) assert(name=='ContainerFrame_Update') posts[#posts+1]=fn end
BackstageForeverBagsCommand('bags marks on')
assert(BackstageForeverPanelSettings.bags==true and #posts==1 and ContainerFrame_Update==original,'hooked after, never replaced')
assert(last():find('+ upgrade, * on your wish list, ! quest item',1,true))
-- Open bags are marked straight away; the plain item gets no text at all.
assert(ContainerFrame1Item2.label.text=='|cff40ff40+|r|cffffd100*|r' and ContainerFrame1Item3.label.text=='|cffffff00!|r' and ContainerFrame1Item4.label.text=='|cff40ff40+|r')
assert(ContainerFrame1Item1.label==nil and ContainerFrame1Item1.made==0)
for i=1,4 do local b=_G['ContainerFrame1Item'..i] for k in pairs(b) do assert(k=='id' or k=='made' or k=='GetID' or k=='CreateFontString' or k=='label','nothing is written into the game button: '..k) end end
-- The item moves: the game redraws, our hook follows.
bags[0][2]=nil bags[0][1]=5194
posts[1](ContainerFrame1)
assert(ContainerFrame1Item1.label.text=='|cff40ff40+|r|cffffd100*|r' and ContainerFrame1Item2.label.shown==false and ContainerFrame1Item2.made==1,'one text per button, reused')
-- Combat: the signs go away rather than risk being wrong, and come back after.
combat=true fire('PLAYER_REGEN_DISABLED') assert(ContainerFrame1Item1.label.shown==false)
posts[1](ContainerFrame1) assert(ContainerFrame1Item1.label.shown==false)
BackstageForeverBagsCommand('bags marks off') assert(BackstageForeverPanelSettings.bags==true and last():find('outside combat',1,true))
combat=false fire('PLAYER_REGEN_ENABLED') assert(ContainerFrame1Item1.label.shown==true)
-- A broken button never breaks the bag.
ContainerFrame1Item3.CreateFontString=function() error('boom') end ContainerFrame1Item3.label=nil
posts[1]('not a frame') posts[1](nil) posts[1](ContainerFrame1)
-- Off: every sign is hidden and the hook stays quiet.
BackstageForeverBagsCommand('bags marks off')
assert(BackstageForeverPanelSettings.bags==false and ContainerFrame1Item1.label.shown==false and ContainerFrame1Item4.label.shown==false)
posts[1](ContainerFrame1) assert(ContainerFrame1Item1.label.shown==false)
`));

test("bag marks also follow the newer bag windows, which hand out their own buttons", () => lua(STUBS + String.raw`
local items={{bag=0,slot=1,id=5193},{bag=0,slot=2,id=8000}}
C_Container={GetContainerNumSlots=function() return 2 end,GetContainerItemID=function(bag,slot) for _,i in ipairs(items) do if i.bag==bag and i.slot==slot then return i.id end end end}
GetItemInfoInstant=function(id) return id,'t','s','',1,id==8000 and 12 or 2,0 end
local buttons={}
for i=1,2 do
  local b={} b.GetID=function() return i end b.GetBagID=function() return 0 end
  b.CreateFontString=function(self) local l={} l.SetPoint=function() end l.SetText=function(s,t) s.text=t end l.Show=function() end l.Hide=function() end self.label=l return l end
  buttons[i]=b
end
ContainerFrameCombinedBags={IsShown=function() return true end,UpdateItems=function() end,EnumerateValidItems=function() return ipairs(buttons) end}
local hookedOn,post
hooksecurefunc=function(frame,name,fn) hookedOn,post=frame,fn assert(name=='UpdateItems') end
` + FILE + String.raw`
BackstageForeverBagsCommand('bags marks on')
assert(hookedOn==ContainerFrameCombinedBags and BackstageForeverPanelSettings.bags==true)
assert(buttons[1].label.text=='|cffffd100*|r' and buttons[2].label.text=='|cffffff00!|r','the item class says quest item when the bag does not')
`));

test("the wish list is wired in: commands, switches off or on as promised, and nothing but our own text on bag buttons", () => {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const [word, fn] of [["wish", "BackstageForeverWishCommand"], ["bags", "BackstageForeverBagsCommand"]]) {
    assert.ok(hud.includes(`if word=='${word}' then\n                if type(${fn})=='function' then pcall(${fn},message)end`), word);
  }
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.ok(options.includes("on('BackstageForeverPanelSettings','wish'),'wish'"));
  assert.ok(options.includes("off('BackstageForeverPanelSettings','bags'),'bags marks'"), "bag marks are off by default");
  lua(String.raw`
SlashCmdList={BACKSTAGEFOREVER=function() end}
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
assert(#BackstageForeverOptionsPresets==3)
for _,preset in ipairs(BackstageForeverOptionsPresets) do
  for _,label in ipairs(preset.on or {}) do
    assert(label~='Bag marks' and label~='Quest list by distance' and label~='Run panel stays in combat',preset.title..' switches on '..label)
  end
end
local off={} for _,label in ipairs(BackstageForeverOptionsPresets[2].off) do off[label]=true end
assert(BackstageForeverOptionsPresets[2].title=='Leveling' and off['Bag marks'] and off['Quest list by distance'],'the starting state names them as off')
`);
  const source = read("addon/BackstageForever/BackstageForeverWish.lua");
  // Post-hooks only; no handler, script or attribute of a game frame is set, nothing is clicked, used or moved.
  for (const name of ["SetScript(", "HookScript", "SetAttribute", "UseContainerItem", "PickupContainerItem", "RollOnLoot", "LootSlot", "ConfirmLootRoll", "SendChatMessage"]) {
    assert.equal(source.split(name).length - 1, 0, `the wish file never calls ${name}`);
  }
  assert.equal((source.match(/pcall\(events\.SetScript,events/g) || []).length, 1, "the only script is on the addon's own event frame");
  assert.equal((source.match(/hooksecurefunc,/g) || []).length, 2, "two post-hooks: the classic bag update and the newer per-window one");
  assert.match(source, /local labels=setmetatable\(\{\},\{__mode='k'\}\)/, "our texts live in our own table");
  const de = JSON.parse(read("data/i18n/de.json")).addon.plain;
  for (const text of ["On your wish list:", "You looted it.", "%s looted it.", "Wish list banner", "Bag marks", "Your wish list: %d items.", "Marked in your bags: %d items.", "upgrade", "quest item", "Backpack"]) assert.ok(de[text], `German for: ${text}`);
});

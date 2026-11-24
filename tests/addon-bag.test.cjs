"use strict";
// One-window bags: search, categories, new-item glow, free slots, marks, view-only sorting, the junk
// list and the bank from the saved Ledger. The logic is pure and run here; the window is checked
// against stub frames and by reading its source for anything that would use, move or sell an item.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const LOAD = String.raw`
dofile('addon/BackstageForever/BackstageForeverWish.lua')
dofile('addon/BackstageForever/BackstageForeverBag.lua')
local function item(t) return t end
local sword={bag=0,slot=1,id=100,name='Fine Longsword',count=1,quality=2,classId=2,subId=7,type='Weapon',subType='One-Handed Swords',equip='INVTYPE_WEAPON',price=1500}
local robe={bag=0,slot=2,id=101,name='Robe of the Magi',count=1,quality=4,classId=4,subId=1,type='Armor',subType='Cloth',equip='INVTYPE_ROBE'}
local potion={bag=0,slot=3,id=102,name='Minor Healing Potion',count=5,quality=1,classId=0,subId=1,type='Consumable',subType='Potion',price=5}
local linen={bag=1,slot=1,id=103,name='Linen Cloth',count=20,quality=1,classId=7,subId=5,type='Tradeskill',subType='Cloth',price=13}
local copper={bag=1,slot=2,id=104,name='Copper Ore',count=10,quality=1,classId=7,subId=7,type='Tradeskill',subType='Metal & Stone',price=5}
local odd={bag=1,slot=3,id=105,name='Strange Dust',count=4,quality=1,classId=7,subId=0,type='Trade Goods',subType='Trade Goods'}
local misc={bag=1,slot=4,id=106,name='Deviate Scale',count=2,quality=1,classId=7,subId=0,type='Trade Goods',subType='Scales'}
local recipe={bag=1,slot=5,id=107,name='Recipe: Elixir of Fortitude',count=1,quality=2,classId=9,subId=6,type='Recipe',subType='Alchemy'}
local head={bag=2,slot=1,id=108,name="Hogger's Head",count=1,quality=1,classId=12,subId=0,type='Quest',subType='Quest',quest=true}
local claw={bag=2,slot=2,id=109,name='Broken Fang',count=7,quality=0,classId=15,subId=0,type='Miscellaneous',subType='Junk',price=21}
local tooth={bag=2,slot=3,id=110,name='Cracked Tooth',count=1,quality=0,classId=15,subId=0,type='Miscellaneous',subType='Junk'}
local greyQuest={bag=2,slot=4,id=111,name='Tattered Note',count=1,quality=0,classId=12,subId=0,type='Quest',subType='Quest'}
local stone={bag=2,slot=5,id=112,name='Hearthstone',count=1,quality=1,classId=15,subId=0,type='Miscellaneous',subType='Junk'}
local arrows={bag=3,slot=1,id=113,name='Rough Arrow',count=200,quality=1,classId=6,subId=2,type='Projectile',subType='Arrow',equip='INVTYPE_AMMO'}
local all={sword,robe,potion,linen,copper,odd,misc,recipe,head,claw,tooth,greyQuest,stone,arrows}
`;

test("categories: equipment, consumables, trade goods by craft, quest, junk, other", () => lua(LOAD + String.raw`
local C=BackstageForeverBagCategory
local function is(i,want,craft) local c,k=C(i) assert(c==want and k==craft,i.name..': '..tostring(c)..' '..tostring(k)) end
is(sword,'equipment') is(robe,'equipment') is(potion,'consumable')
is(linen,'trade','Tailoring') is(copper,'trade','Mining and smithing')
-- No craft known for it: no craft is claimed. The game's own word for the kind is used when it says more.
is(odd,'trade',nil) is(misc,'trade','Scales')
is(recipe,'trade','Alchemy')
is(head,'quest') is(greyQuest,'quest')  -- a grey quest item is a quest item, never junk
is(claw,'junk') is(tooth,'junk')
is(stone,'other') is(arrows,'other')
assert(C(nil)=='other' and C({})=='other')
-- Your own recipes say which craft uses an item, before anything else.
local mine=BackstageForeverBagReagents({professions={items={{skillLineId=171,name='Alchemy'},{skillLineId=185,name='Cooking'}}},
  recipes={items={{skillLineId=171,reagents={{itemId=105},{itemId=103}}},{skillLineId=185,reagents={{itemId=105}}},{skillLineId=999,reagents={{itemId=104}}}}}})
assert(mine[105]=='Alchemy' and mine[103]=='Alchemy' and mine[104]==nil)
local c,k=C(odd,mine) assert(c=='trade' and k=='Alchemy')
c,k=C(linen,mine) assert(k=='Alchemy')
-- Junk and quest items stay what they are even when a recipe names them.
assert(C(claw,{[109]='Alchemy'})=='junk' and C(head,{[108]='Alchemy'})=='quest')
assert(next(BackstageForeverBagReagents(nil))==nil and next(BackstageForeverBagReagents({recipes='x'}))==nil)
assert(BackstageForeverBagIsJunk(claw) and not BackstageForeverBagIsJunk(greyQuest) and not BackstageForeverBagIsJunk(stone))
`));

test("search as you type: name, kind, quality, marks and categories; every word must match; never a pattern", () => lua(LOAD + String.raw`
local wished,better={[101]=true},{[100]=true}
local function hits(query,seen)
  local view=BackstageForeverBagView(all,{query=query,wished=wished,better=better,sort='bag',seen=seen})
  local names={} for _,c in ipairs(view.cells) do names[#names+1]=c.item.name end
  return table.concat(names,'|'),view
end
local table_={
  {'longsword','Fine Longsword'},{'LONG','Fine Longsword'},{'  fine   sword ','Fine Longsword'},
  {'cloth','Robe of the Magi|Linen Cloth'},            -- the name and the game's kind
  {'potion','Minor Healing Potion'},{'weapon','Fine Longsword'},
  {'epic','Robe of the Magi'},{'purple','Robe of the Magi'},{'uncommon','Fine Longsword|Recipe: Elixir of Fortitude'},{'green','Fine Longsword|Recipe: Elixir of Fortitude'},
  {'poor',"Broken Fang|Cracked Tooth|Tattered Note"},{'grey',"Broken Fang|Cracked Tooth|Tattered Note"},
  {'upgrade','Fine Longsword'},{'wish','Robe of the Magi'},{'quest',"Hogger's Head|Tattered Note"},{'junk','Broken Fang|Cracked Tooth'},
  {'equipment','Fine Longsword|Robe of the Magi'},{'gear','Fine Longsword|Robe of the Magi'},{'consumable','Minor Healing Potion'},
  {'trade','Linen Cloth|Copper Ore|Strange Dust|Deviate Scale|Recipe: Elixir of Fortitude'},
  {'tailoring','Linen Cloth'},{'alchemy','Recipe: Elixir of Fortitude'},
  {'trade cloth','Linen Cloth'},{'junk fang','Broken Fang'},{'epic junk',''},{'zzz',''},
  -- Characters that mean something in a Lua pattern are plain text here.
  {'%a+',''},{'.',''},{'[',''},{"hogger's","Hogger's Head"},{'(','' },{'recipe:','Recipe: Elixir of Fortitude'},
}
for _,row in ipairs(table_) do local got=hits(row[1]) assert(got==row[2],row[1]..' -> '..got) end
local _,view=hits('') assert(view.shown==14 and view.total==14)
_,view=hits('cloth') assert(view.shown==2 and view.total==14)
-- "new" finds what the glow marks.
local seen=BackstageForeverBagSeen(all) seen[102]=nil seen[103]=5
assert(hits('new',seen)=='Minor Healing Potion|Linen Cloth')
assert(hits('new',nil)=='','nothing is new before the window was ever closed')
-- At most six words of at most thirty letters; a very long query cannot slow the search down.
local tokens=BackstageForeverBagTokens(string.rep('abcdefghij ',40)) assert(#tokens<=6)
assert(#BackstageForeverBagTokens(string.rep('x',500))==1 and #BackstageForeverBagTokens(string.rep('x',500))[1]<=30)
assert(#BackstageForeverBagTokens(nil)==0 and #BackstageForeverBagTokens('  ')==0 and BackstageForeverBagTokens('A|b')[1]=='ab')
assert(BackstageForeverBagMatch(nil,{'x'})==false and BackstageForeverBagMatch(sword,nil)==true)
`));

test("new since the window was last closed: a new item or a bigger pile glows; nothing glows the first time", () => lua(LOAD + String.raw`
local before=BackstageForeverBagSeen({potion,linen,{id=103,count=5}})
assert(before[102]==5 and before[103]==25)
local fresh=BackstageForeverBagNew({potion,linen,sword},before)
assert(fresh[100]==true and fresh[102]==nil and fresh[103]==nil,'the sword is new; a smaller pile of cloth is not')
potion.count=6 assert(BackstageForeverBagNew({potion},before)[102]==true,'one more potion') potion.count=5
assert(next(BackstageForeverBagNew(all,nil))==nil and next(BackstageForeverBagNew(nil,before))==nil)
-- Bounded: four hundred different items at most are remembered.
local many={} for i=1,600 do many[i]={id=i,count=1} end
local n=0 for _ in pairs(BackstageForeverBagSeen(many)) do n=n+1 end assert(n==400)
assert(next(BackstageForeverBagSeen({{id='x'},{id=-1},'junk'}))==nil)
`));

test("the view: categories in a set order, marks, and four sorts that never change the list they were given", () => lua(LOAD + String.raw`
local order={} for i,it in ipairs(all) do order[i]=it end
local view=BackstageForeverBagView(all,{wished={[101]=true},better={[100]=true},seen=BackstageForeverBagSeen({sword})})
for i,it in ipairs(all) do assert(order[i]==it,'the list itself is never reordered') end
local heads={} for _,c in ipairs(view.cells) do if c.kind=='head' then heads[#heads+1]=c.text..'='..c.count end end
assert(table.concat(heads,';')=='Equipment=2;Consumables=1;Trade goods: Alchemy=1;Trade goods: Mining and smithing=1;Trade goods: Scales=1;Trade goods: Tailoring=1;Trade goods=1;Quest items=2;Junk=2;Other=2',table.concat(heads,';'))
-- Inside a category: better quality first, then the name.
assert(view.cells[2].item==robe and view.cells[3].item==sword)
local by={} for _,c in ipairs(view.cells) do if c.kind=='item' then by[c.item.id]=c end end
assert(by[100].sign=='|cff40ff40+|r' and by[101].sign=='|cffffd100*|r' and by[108].sign=='|cffffff00!|r' and by[109].sign=='|cff9d9d9d~|r' and by[102].sign=='')
assert(by[111].sign=='|cffffff00!|r','a grey quest item carries the quest sign only')
assert(by[100].new==false and by[101].new==true)
local function names(sort) local v=BackstageForeverBagView(all,{sort=sort}) local o={} for _,c in ipairs(v.cells) do assert(c.kind=='item') o[#o+1]=c.item.id end return table.concat(o,',') end
assert(names('bag')=='100,101,102,103,104,105,106,107,108,109,110,111,112,113')
assert(names('name')=='109,104,110,106,100,112,108,103,102,107,101,113,105,111',names('name'))
assert(names('quality'):sub(1,11)=='101,100,107',names('quality'))
assert(BackstageForeverBagView(all,{sort='nonsense'}).sort=='category' and BackstageForeverBagView(nil).total==0)
-- Marks are signs, never colour alone, and reuse the bag-mark signs.
assert(BackstageForeverBagCellSign({upgrade=true,wish=true,quest=true,junk=true})=='|cff40ff40+|r|cffffd100*|r|cffffff00!|r|cff9d9d9d~|r' and BackstageForeverBagCellSign(nil)=='')
`));

test("layout: ten fixed cells to a row, a heading on a row of its own, and a known height", () => lua(LOAD + String.raw`
local cells={{kind='head'}} for i=1,12 do cells[#cells+1]={kind='item'} end cells[#cells+1]={kind='head'} cells[#cells+1]={kind='item'}
local places,height=BackstageForeverBagLayout(cells,10)
assert(places[1].x==0 and places[1].y==0)
assert(places[2].x==0 and places[2].y==-18 and places[11].x==9*37 and places[12].x==0 and places[12].y==-55 and places[13].x==37)
assert(places[14].x==0 and places[14].y==-92 and places[15].y==-110 and height==147,height)
for i=2,13 do assert(places[i].x+34<=10*37-3,'no cell passes the right edge') end
local _,none=BackstageForeverBagLayout({},10) assert(none==0)
local _,one=BackstageForeverBagLayout({{kind='item'}},10) assert(one==37)
`));

test("free slots, money, the junk list and the bank as the Ledger saw it", () => lua(LOAD + String.raw`
local free,total=BackstageForeverBagFree({{slots=16,used=10},{slots=12,used=12},{slots=8,used=0},{slots=5,used=9},'x'})
assert(free==14 and total==36)
assert(BackstageForeverBagMoney(12345)=='1g 23s 45c' and BackstageForeverBagMoney(20000)=='2g' and BackstageForeverBagMoney(0)=='0c' and BackstageForeverBagMoney(105)=='1s 5c' and BackstageForeverBagMoney(-1)==nil and BackstageForeverBagMoney('x')==nil)
local lines=BackstageForeverBagJunkLines(all,true)
assert(lines[1]=='Junk in your bags: 8, worth 1s 47c at a vendor.',lines[1])
assert(lines[2]=='  Broken Fang x7: 1s 47c' and lines[3]=='  Cracked Tooth x1: no vendor price')
assert(lines[4]=='Sell them yourself: right-click each in your bags. Nothing is sold for you.' and #lines==4)
assert(BackstageForeverBagJunkLines(all,false)[4]=='A list only. Nothing is sold for you.')
assert(BackstageForeverBagJunkLines({sword,head,greyQuest})[1]=='No junk in your bags.')
assert(BackstageForeverBagJunkLines(nil)[1]=='Your bags are not readable in this game client.')
local many={} for i=1,20 do many[i]={id=i,name='Scrap '..i,count=1,quality=0,price=i} end
lines=BackstageForeverBagJunkLines(many) assert(#lines==15 and lines[14]=='  +8 more' and lines[2]=='  Scrap 20 x1: 20c')
-- The bank: what was saved, said plainly with its age; nothing is invented when it was never seen.
local items,head=BackstageForeverBagBank(nil,1000) assert(items==nil and head:find('has not been seen yet',1,true))
items,head=BackstageForeverBagBank({seenAt=1000,complete=true,items={{id=103,n=40,q=1,name='Linen Cloth'},{id=5,n=2},{id='bad'},'x'}},1000+3*3600,function(id) if id==103 then return {classId=7,subId=5,type='Tradeskill'} end end)
assert(#items==2 and head=='Bank as last seen 3 h ago',head)
assert(items[1].count==40 and items[1].bank and items[1].classId==7 and items[2].name=='Item #5')
assert(BackstageForeverBagCategory(items[1])=='trade')
local _,partial=BackstageForeverBagBank({seenAt=1000,complete=false,items={}},1060) assert(partial=='Bank as last seen just now (not all of it)')
assert(BackstageForeverBagAgo(30*60)=='30 min ago' and BackstageForeverBagAgo(3*86400)=='3 days ago' and BackstageForeverBagAgo(nil)=='at an unknown time')
`));

const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local combat=false InCombatLockdown=function() return combat end
local made={}
local function widget(kind)
  local w={kind=kind,scripts={},shown=true,points={}}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn end,
    SetText=function(self,t) self.text=t;if self.scripts.OnTextChanged then self.scripts.OnTextChanged(self,false) end end,
    GetText=function(self) return self.text or '' end,
    Show=function(self) self.shown=true end,
    Hide=function(self) local was=self.shown;self.shown=false;if was and self.scripts.OnHide then self.scripts.OnHide(self) end end,
    IsShown=function(self) return self.shown end,
    SetPoint=function(self,...) self.points[#self.points+1]={...} end,
    ClearAllPoints=function(self) self.points={} end,
    SetSize=function(self,w_,h) self.w,self.h=w_,h end, SetWidth=function(self,v) self.w=v end, SetHeight=function(self,v) self.h=v end,
    SetTexture=function(self,v) self.texture=v end,
    CreateFontString=function() return widget('FontString') end,
    CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
local events={}
CreateFrame=function(kind,name) local w=widget(kind);made[#made+1]=w;if name then _G[name]=w end
  w.RegisterEvent=function(self,e) events[e]=events[e] or {};table.insert(events[e],self) end
  return w end
local function fire(e,...) for _,f in ipairs(events[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
UIParent={} UISpecialFrames={}
time=function() return 5000 end
UnitName=function() return 'Tester' end GetRealmName=function() return 'Realm' end
local bags={[0]={{id=100,n=1,q=2},{id=109,n=7,q=0},nil,{id=108,n=1,q=1,quest=true}},[1]={{id=103,n=20,q=1}}}
local sizes={[0]=16,[1]=6}
C_Container={
  GetContainerNumSlots=function(bag) return sizes[bag] or 0 end,
  GetContainerItemInfo=function(bag,slot) local e=bags[bag] and bags[bag][slot] if e then return {itemID=e.id,stackCount=e.n,quality=e.q,iconFileID=1000+e.id} end end,
  GetContainerItemQuestInfo=function(bag,slot) local e=bags[bag] and bags[bag][slot] return {isQuestItem=e and e.quest or false} end,
}
local INFO={[100]={'Fine Longsword',nil,2,10,5,'Weapon','One-Handed Swords',1,'INVTYPE_WEAPON',135,1500,2,7},[109]={'Broken Fang',nil,0,1,0,'Miscellaneous','Junk',20,'',136,3,15,0},
  [108]={"Hogger's Head",nil,1,1,0,'Quest','Quest',1,'',137,0,12,0},[103]={'Linen Cloth',nil,1,5,0,'Tradeskill','Cloth',20,'',138,13,7,5}}
GetItemInfo=function(id) local r=INFO[id] if r then return r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13] end end
BackstageForeverDesktopData={schema=1,characters={['Tester-Realm']={wish={103},up={100}}}}
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
dofile('addon/BackstageForever/BackstageForeverPanels.lua')
dofile('addon/BackstageForever/BackstageForeverWish.lua')
dofile('addon/BackstageForever/BackstageForeverBag.lua')
local function shownCells() local f=BackstageForeverBagFrame local out={} for _,b in ipairs(f.cells) do if b.shown and b.item then out[#out+1]=b end end return out end
local function shownHeads() local f=BackstageForeverBagFrame local out={} for _,h in ipairs(f.heads) do if h.shown then out[#out+1]=h.text end end return out end
`;

test("the window: off until asked, quiet in combat, paints the live bags, never glows the first time, and a click only says where", () => lua(STUBS + String.raw`
assert(BackstageForeverBagEnabled()==false,'off by default')
combat=true BackstageForeverBagCommand('bag') assert(BackstageForeverBagFrame==nil and last():find('waits until you leave combat',1,true) )
combat=false said={}
assert(BackstageForeverBagCommand('bag')==true and BackstageForeverBagEnabled()==true)
local f=BackstageForeverBagFrame
assert(f and f.shown and f.w==399 and f.h==430,'fixed size')
assert(said[1]:find('One-window bags: on. A window to find and look',1,true))
assert(f.title.text=='Bags' and f.free.text=='Free: 18 of 22',f.free.text)
local cells=shownCells() assert(#cells==4)
local heads=shownHeads()
assert(#heads==4 and heads[1]=='|cffffd100Equipment|r |cff9d9d9d(1)|r' and heads[2]:find('Trade goods: Tailoring',1,true) and heads[3]:find('Quest items',1,true) and heads[4]:find('Junk',1,true))
-- Icons are the game's own, read at run time; signs come from the wish list and upgrades the desktop sent.
assert(cells[1].item.id==100 and cells[1].icon.texture==1100 and cells[1].sign.text=='|cff40ff40+|r' and cells[1].count.text=='')
assert(cells[2].item.id==103 and cells[2].sign.text=='|cffffd100*|r' and cells[2].count.text=='20')
assert(cells[3].sign.text=='|cffffff00!|r' and cells[4].sign.text=='|cff9d9d9d~|r' and cells[4].count.text=='7')
for _,c in ipairs(cells) do assert(c.glow.shown==false,'nothing is new the first time the window opens') end
-- Search as you type narrows the view and says how much is shown.
f.search:SetText('junk') cells=shownCells() assert(#cells==1 and cells[1].item.id==109 and f.note.text=='1 of 4 shown')
f.search:SetText('') assert(#shownCells()==4 and f.note.text=='')
-- Closing the window is when "new" starts over: what arrives after that glows next time.
BackstageForeverBagCommand('bag') assert(f.shown==false and BackstageForeverBagSettings.seen[103]==20)
bags[1][2]={id=100,n=1,q=2} bags[1][1].n=25
BackstageForeverBagCommand('bag') cells=shownCells() assert(#cells==5)
local glow={} for _,c in ipairs(cells) do glow[#glow+1]=c.item.id..(c.glow.shown and '*' or '') end
assert(table.concat(glow,',')=='100*,100*,103*,108,109',table.concat(glow,','))
-- A bag change while it is open repaints; in combat the window hides and nothing is read.
bags[0][3]={id=109,n=1,q=0} fire('BAG_UPDATE_DELAYED') assert(#shownCells()==6 and f.free.text=='Free: 16 of 22')
fire('PLAYER_REGEN_DISABLED') assert(f.shown==false)
combat=true bags[0][5]={id=103,n=1,q=1} fire('BAG_UPDATE_DELAYED') assert(f.shown==false) combat=false
-- A click names the bag and slot. The bag is not opened for you and nothing is used.
BackstageForeverBagCommand('bag') said={}
shownCells()[1].scripts.OnClick(shownCells()[1])
assert(last()=='Backstage Forever: Fine Longsword is in Backpack, slot 1. Open that bag to use it.',last())
-- With the game's own bag window open, the real slot is lit by a frame of ours laid over it.
local real={GetID=function() return 1 end}
ContainerFrame1={IsShown=function() return true end,GetID=function() return 0 end,GetName=function() return 'ContainerFrame1' end,size=16}
ContainerFrame1Item16=real
shownCells()[1].scripts.OnClick(shownCells()[1])
assert(last()=='Backstage Forever: Fine Longsword is in Backpack, slot 1. It is lit up in your bag.',last())
-- Sorting changes the view only.
local before=bags[0][1]
BackstageForeverBagCommand('bag sort name') assert(BackstageForeverBagSettings.sort=='name' and last():find('Nothing in your bags was moved',1,true) and bags[0][1]==before)
assert(#shownHeads()==0 and shownCells()[1].item.name=='Broken Fang')
BackstageForeverBagCommand('bag sort sideways') assert(BackstageForeverBagSettings.sort=='name' and last():find('Use /bf bag sort',1,true))
f.sortButton.scripts.OnClick() assert(BackstageForeverBagSettings.sort=='quality' and f.sortButton.text=='Sort: Quality')
-- Off closes it; the switch stays off until asked again.
BackstageForeverBagCommand('bag off') assert(f.shown==false and BackstageForeverBagEnabled()==false and last()=='Backstage Forever: One-window bags: off.')
BackstageForeverBagCommand('bag on') assert(BackstageForeverBagEnabled()==true and f.shown==false)
BackstageForeverBagCommand('bag nonsense') assert(last():find('Use /bf bag, /bf bag bank',1,true))
`));

test("the junk list and the bank view in the window; a vendor gets one line only when the switch is on", () => lua(STUBS + String.raw`
-- Off: a vendor says nothing.
fire('MERCHANT_SHOW') assert(#said==0)
said={} local lines=BackstageForeverBagCommand('bag junk')
assert(said[1]=='Backstage Forever: Junk in your bags: 7, worth 21c at a vendor.' and said[2]=='  Broken Fang x7: 21c' and said[3]=='Sell them yourself: right-click each in your bags. Nothing is sold for you.',said[3])
fire('MERCHANT_CLOSED') said={} BackstageForeverBagCommand('bag junk') assert(said[3]=='A list only. Nothing is sold for you.')
BackstageForeverBagCommand('bag on') said={}
fire('MERCHANT_SHOW') assert(#said==1 and said[1]=='Backstage Forever: Junk in your bags: 7, worth 21c at a vendor. /bf bag junk lists them.',said[1])
combat=true said={} BackstageForeverBagCommand('bag junk') assert(last():find('outside combat',1,true)) combat=false
-- The bank, never seen: it says so and shows nothing.
BackstageForeverBagCommand('bag bank')
local f=BackstageForeverBagFrame
assert(f.shown and f.title.text=='Bank' and f.free.text:find('has not been seen yet',1,true) and #shownCells()==0)
-- Seen two hours ago by the Ledger: the saved items, with the game's own icon when it knows the item.
BackstageForeverLedgerDB={bank={seenAt=5000-7200,complete=true,items={{id=103,n=60,q=1,name='Linen Cloth'},{id=777,n=1,q=3,name='Unknown Blade'}}}}
f.bankButton.scripts.OnClick() assert(f.title.text=='Bags')
f.bankButton.scripts.OnClick() assert(f.title.text=='Bank' and f.free.text=='Bank as last seen 2 h ago',f.free.text)
local cells=shownCells() assert(#cells==2)
local by={} for _,c in ipairs(cells) do by[c.item.id]=c end
assert(by[103].icon.texture==138 and by[103].count.text=='60' and by[777].icon.texture=='Interface\\Icons\\INV_Misc_QuestionMark')
said={} by[103].scripts.OnClick(by[103]) assert(last()=='Backstage Forever: In your bank: Linen Cloth.')
-- Looking at the bank never restarts "new" for the bags.
local seen=BackstageForeverBagSettings.seen f:Hide() assert(BackstageForeverBagSettings.seen~=nil)
`));

test("a window to look, not to use: no protected call, no hook, nothing of the game's replaced", () => {
  const source = read("addon/BackstageForever/BackstageForeverBag.lua");
  for (const name of ["UseContainerItem", "PickupContainerItem", "SplitContainerItem", "DeleteCursorItem", "SellCursorItem", "PickupMerchantItem", "UseItemByName", "EquipItemByName",
    "OpenBag(", "ToggleBag(", "OpenAllBags", "ToggleAllBags", "CloseAllBags", "SetAttribute", "SecureActionButton", "hooksecurefunc", "HookScript", "SendChatMessage", "RunScript", "loadstring", "SetBinding"])
    assert.equal(source.split(name).length - 1, 0, `the bag file never calls ${name}`);
  // Scripts are set on the addon's own frames only: the window, its edit box, scroll frame, cells and footer buttons.
  assert.ok(!/_G\[[^\]]+\]:SetScript|ContainerFrame\d*:Set/.test(source), "no script or setter on a game frame");
  assert.match(source, /local function combat\(\) return call\(InCombatLockdown\)~=false end/, "unknown counts as combat");
  assert.match(source, /if event=='PLAYER_REGEN_DISABLED' then if frame then frame:Hide\(\) end return end/);
  // Fixed sizes and no wrapping on every text.
  const strings = (source.match(/CreateFontString\(/g) || []).length, noWrap = (source.match(/SetWordWrap\(false\)/g) || []).length;
  assert.ok(strings >= 7 && noWrap >= strings, `${strings} texts, ${noWrap} set not to wrap`);
  assert.match(source, /local COLS,CELL,STEP,HEAD=10,34,37,18/);
  assert.match(source, /if type\(BackstageForeverPaintNineSlice\)=='function' then pcall\(BackstageForeverPaintNineSlice,f,'compass',32,11\)/, "the same painted frame as the lists");
});

test("wiring: the toc, the dispatcher, help, the settings switch and the three languages", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverBagSettings\b/m, "per character");
  assert.ok(!/^## SavedVariables:.*Bag/m.test(toc));
  const files = toc.split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  assert.ok(files.indexOf("BackstageForeverBag.lua") > files.indexOf("BackstageForeverWish.lua") && files.indexOf("BackstageForeverBag.lua") > files.indexOf("BackstageForeverPanels.lua"));
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='bag' then\s+if type\(BackstageForeverBagCommand\)=='function' then pcall\(BackstageForeverBagCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /BackstageForeverBagUpdate/);
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf bag - every bag in one window/);
  assert.match(read("addon/BackstageForever/BackstageForeverOptions.lua"), /switch\('One-window bags','[^']+',off\('BackstageForeverBagSettings','enabled'\),'bag'\)/);
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverBag.lua"));
  for (const lang of ["de", "es", "fr"]) {
    const d = JSON.parse(read(`data/i18n/${lang}.json`)).addon;
    for (const text of ["One-window bags", "Bags", "Bank", "Find", "Junk list", "Free: %d of %d", "%d of %d shown", "Equipment", "Consumables", "Trade goods", "Quest items", "Junk", "Other", "No junk in your bags.", "Bank as last seen %s", "Scroll for more"])
      assert.ok(d.plain[text], `${lang}: ${text}`);
    for (const text of ["%s is in %s, slot %d. Open that bag to use it.", "Bag window sorted by %s. Nothing in your bags was moved."]) assert.ok(d.templates[text], `${lang}: ${text}`);
  }
});

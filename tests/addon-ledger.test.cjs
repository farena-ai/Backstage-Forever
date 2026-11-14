"use strict";
// Ledger addon (0.35): bags, bank, mail, reputations, cooldowns and auction price memory, read
// only from public APIs on pages the player opened. Runs the real Lua in fengari.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
// A synthetic client: bags, bank, mailbox, auction pages and factions. Every automation entry
// point errors so a call to one fails the test.
const WORLD = String.raw`
local handler
local said={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
CreateFrame=function() return {RegisterEvent=function()end,SetScript=function(_,_,fn)handler=fn end} end
local captures=0
BackstageForeverRequestCapture=function() captures=captures+1 end
local t=1700000000
time=function() return t end
GetTime=function() return 5000 end
GetMoney=function() return 1234567 end
UnitName=function() return 'Aeralyn' end
NUM_BAG_SLOTS=4 NUM_BANKBAGSLOTS=6 BANK_CONTAINER=-1
local link=function(id,name) return '|cffffffff|Hitem:'..id..'::::::::20:::::|h['..name..']|h|r' end
local slots={[0]={[1]={itemID=2589,stackCount=20,quality=1,hyperlink=link(2589,'Linen Cloth')},[2]={itemID=2589,stackCount=5,quality=1,hyperlink=link(2589,'Linen Cloth')},[3]={itemID=118,stackCount=3,quality=1,hyperlink=link(118,'Minor Healing Potion')}},
  [-1]={[1]={itemID=2592,stackCount=40,quality=1,hyperlink=link(2592,'Wool Cloth')}},[5]={[2]={itemID=2589,stackCount=10,quality=1,hyperlink=link(2589,'Linen Cloth')}}}
C_Container={GetContainerNumSlots=function(bag) if bag==0 or bag==-1 then return 16 elseif bag>=1 and bag<=10 then return 4 end return 0 end,
  GetContainerItemInfo=function(bag,slot) return slots[bag] and slots[bag][slot] end}
for _,name in ipairs({'QueryAuctionItems','PlaceAuctionBid','PostAuction','StartAuction','CancelAuction','ClickAuctionSellItemButton','GetInboxText','TakeInboxItem','TakeInboxMoney','AutoLootMailItem','ExpandFactionHeader','CollapseFactionHeader','SetSelectedFaction'}) do
  _G[name]=function() error('automation call: '..name) end
end
GetInboxNumItems=function() return 2,2 end
GetInboxHeaderInfo=function(i)
  if i==1 then return nil,nil,'PRIVATE SENDER','PRIVATE SUBJECT',5000,0,12.5,2,false end
  return nil,nil,'PRIVATE SENDER','PRIVATE SUBJECT',0,2500,3.2,1,false
end
GetInboxItem=function(i,j)
  if i==1 and j==1 then return 'Copper Ore',2770,'tex',8,1,true end
  if i==1 and j==2 then return 'Linen Cloth',2589,'tex',2,1,true end
  if i==2 and j==1 then return 'Cash on delivery',4306,'tex',20,1,true end
end
GetInboxItemLink=function(i,j)
  if i==1 and j==1 then return link(2770,'Copper Ore') end
  if i==1 and j==2 then return link(2589,'Linen Cloth') end
  if i==2 and j==1 then return link(4306,'Silk Cloth') end
end
local auctions={}
GetNumAuctionItems=function(kind) assert(kind=='list') return #auctions,#auctions end
GetAuctionItemInfo=function(kind,i) local a=auctions[i] return a.name,'tex',a.count,1,true,1,'',1,1,a.buyout,0,false,nil,'PRIVATE OWNER','PRIVATE OWNER-Realm',0,a.id,true end
local factions={
  {'Alliance',nil,4,0,3000,0,false,false,true,false,false,false,false,469},
  {'Stormwind',nil,6,9000,21000,12500,false,false,false,false,false,false,true,72},
  {'Horde',nil,4,0,3000,0,false,false,true,false,false,false,false,67},
  {'Orgrimmar',nil,4,0,3000,1500,false,false,false,false,false,false,true,76},
  {'Timbermaw Hold',nil,2,-6000,-3000,-4000,false,false,false,false,false,false,false,576},
}
GetNumFactions=function() return #factions end
GetFactionInfo=function(i) return (table.unpack or unpack)(factions[i],1,14) end
local known={[17187]=true,[18560]=true}
IsPlayerSpell=function(id) return known[id]==true end
GetSpellCooldown=function(id) if id==17187 then return 4000,172800,1 end if id==18560 then return 0,0,1 end return 0,0,1 end
GetItemCount=function(id) return id==15846 and 1 or 0 end
GetItemCooldown=function(id) if id==15846 then return 4900,259200,1 end return 0,0,1 end
dofile('addon/BackstageForever/BackstageForeverLedger.lua')
`;
test("ledger reads bags, bank and mail on the player's own windows, without senders, subjects or automation", () => lua(WORLD + String.raw`
handler(nil,'PLAYER_LOGIN')
local s=BackstageForeverLedgerSnapshot()
assert(s.money==1234567 and s.moneyAt==t)
assert(#s.bags.items==2 and s.bags.items[1].id==118 and s.bags.items[2].id==2589 and s.bags.items[2].n==25,'bag stacks of one item add up')
assert(s.bags.items[2].name=='Linen Cloth' and s.bags.items[2].q==1,'name from the item link, quality from the slot')
assert(s.bank==nil and s.mail==nil,'bank and mail stay unknown until opened')
handler(nil,'BANKFRAME_OPENED')
assert(captures==1)
s=BackstageForeverLedgerSnapshot()
assert(#s.bank.items==2 and s.bank.seenAt==t,'bank container -1 and bank bag 5')
slots[-1][1]=nil t=t+60 handler(nil,'PLAYERBANKSLOTS_CHANGED')
assert(#BackstageForeverLedgerSnapshot().bank.items==1)
handler(nil,'BANKFRAME_CLOSED')
slots[-1][1]={itemID=2592,stackCount=40,quality=1} t=t+600 handler(nil,'BAG_UPDATE',-1)
s=BackstageForeverLedgerSnapshot()
assert(#s.bank.items==1 and s.bank.seenAt==1700000060,'a closed bank keeps its last-seen contents and time')
handler(nil,'MAIL_INBOX_UPDATE') assert(BackstageForeverLedgerSnapshot().mail==nil,'no mailbox, no reading')
handler(nil,'MAIL_SHOW') handler(nil,'MAIL_INBOX_UPDATE')
s=BackstageForeverLedgerSnapshot()
assert(s.mail.letters==2 and s.mail.money==5000 and #s.mail.items==2,'cash on delivery items are not counted as yours')
assert(s.mail.expiresAt==t+math.floor(3.2*86400))
local function walk(v,seen) if type(v)=='string' then assert(not v:find('PRIVATE'),'private text reached the ledger: '..v) elseif type(v)=='table' then for k,x in pairs(v) do walk(k) walk(x) end end end
walk(s) walk(BackstageForeverLedgerDB)
print('ok')
`));
test("reputations keep both factions' rows with ids and bars; cooldowns only for known recipes", () => lua(WORLD + String.raw`
handler(nil,'PLAYER_LOGIN')
local s=BackstageForeverLedgerSnapshot()
local ids={} for _,f in ipairs(s.reputations.factions) do ids[f.id]=f end
assert(ids[72] and ids[76] and ids[576] and not ids[469] and not ids[67],'headers without a bar are skipped, Alliance and Horde rows kept')
assert(ids[72].standing==6 and ids[72].min==9000 and ids[72].max==21000 and ids[72].value==12500 and ids[72].name=='Stormwind')
assert(ids[576].value==-4000)
-- A collapsed header hides rows: they keep their last-seen values.
table.remove(factions,4) factions[2][6]=13000 handler(nil,'UPDATE_FACTION')
ids={} for _,f in ipairs(BackstageForeverLedgerSnapshot().reputations.factions) do ids[f.id]=f end
assert(ids[76] and ids[72].value==13000)
local cd={} for _,c in ipairs(s.cooldowns) do cd[c.key]=c end
assert(cd.transmute.spellId==17187 and cd.transmute.readyAt==t+(4000+172800-5000))
assert(cd.mooncloth.readyAt==t,'a known recipe off cooldown is ready now')
assert(cd['salt-shaker'].itemId==15846 and cd['salt-shaker'].readyAt==t+(4900+259200-5000))
known={} GetItemCount=function() return 0 end GetSpellCooldown=function() return 0,0,1 end
assert(#BackstageForeverLedgerSnapshot().cooldowns==0,'unknown recipes and a missing salt shaker are not listed')
print('ok')
`));
test("price memory keeps the lowest buyout per unit on opened pages, a short history, a cap, and an off switch", () => lua(WORLD + String.raw`
handler(nil,'PLAYER_LOGIN')
auctions={{name='Linen Cloth',id=2589,count=20,buyout=2000},{name='Linen Cloth',id=2589,count=5,buyout=400},{name='Bid only',id=118,count=1,buyout=0}}
handler(nil,'AUCTION_ITEM_LIST_UPDATE')
local e=BackstageForeverLedgerDB.prices[2589]
assert(e.hist[1][1]==80 and e.hist[1][2]==t and e.name=='Linen Cloth','lowest unit buyout of the page')
assert(BackstageForeverLedgerDB.prices[118]==nil,'bid-only auctions have no buyout price')
t=t+300 auctions={{name='Linen Cloth',id=2589,count=1,buyout=70}} handler(nil,'AUCTION_ITEM_LIST_UPDATE')
assert(#e.hist==1 and e.hist[1][1]==70,'the next page of the same search is the same observation')
for i=1,7 do t=t+86400 auctions={{name='Linen Cloth',id=2589,count=1,buyout=100+i}} handler(nil,'AUCTION_ITEM_LIST_UPDATE') end
assert(#e.hist==5 and e.hist[1][1]==107 and e.hist[5][1]==103,'five newest observations')
local s=BackstageForeverLedgerSnapshot()
assert(#s.prices==1 and s.prices[1].id==2589 and #s.prices[1].hist==5 and s.pricesOn==true)
for i=1,1600 do BackstageForeverLedgerRemember(100000+i,50,1600000000+i,'Synthetic') end
auctions={{name='Wool Cloth',id=2592,count=1,buyout=300}} handler(nil,'AUCTION_ITEM_LIST_UPDATE')
local n=0 for _ in pairs(BackstageForeverLedgerDB.prices) do n=n+1 end
assert(n==1500 and BackstageForeverLedgerDB.prices[2589] and BackstageForeverLedgerDB.prices[2592] and not BackstageForeverLedgerDB.prices[100001],'oldest entries drop first')
assert(BackstageForeverLedgerCommand('prices off')==false)
t=t+86400 auctions={{name='Wool Cloth',id=2592,count=1,buyout=1}} handler(nil,'AUCTION_ITEM_LIST_UPDATE')
assert(BackstageForeverLedgerDB.prices[2592].hist[1][1]==300,'off means nothing is remembered')
assert(BackstageForeverLedgerCommand('prices status')==false and said[#said]:find('off',1,true))
assert(BackstageForeverLedgerCommand('prices on')==true)
assert(BackstageForeverLedgerCommand('prices maybe')==nil and said[#said]:find('/bf prices on',1,true))
print('ok')
`));
test("/bf ledger totals gold across the roster and says what the ledger has seen", () => lua(WORLD + String.raw`
handler(nil,'PLAYER_LOGIN')
BackstageForeverLedgerRoster=function() return {{name='Aeralyn',money=10},{name='Vaelric',money=2000000},{name='Nomoney'}} end
local total=BackstageForeverLedgerCommand('ledger')
assert(total==1234567+2000000,'the live character counts its current gold once')
assert(said[1]=='Backstage Forever: Gold across 2 characters: 323g 45s 67c.',said[1])
local all=table.concat(said,'\n')
assert(all:find('Vaelric: 200g 0s 0c',1,true) and all:find('open your bank once',1,true) and all:find('Price memory on, 0 items',1,true))
print('ok')
`));
test("capture exports the ledger as JSON arrays and sheds it before quests when the export is too large", () => {
  const harness = fs.readFileSync(path.join(__dirname, "addon.test.cjs"), "utf8");
  const start = harness.indexOf("const LUA_HARNESS = String.raw`") + "const LUA_HARNESS = String.raw`".length;
  const base = harness.slice(start, harness.indexOf("dofile('addon", start));
  lua(base + String.raw`
C_Container={GetContainerNumSlots=function(bag) return bag==0 and 2 or 0 end,GetContainerItemInfo=function(bag,slot) if bag==0 and slot==1 then return {itemID=2589,stackCount=4,quality=1,hyperlink='|Hitem:2589|h[Linen Cloth]|h'} end end}
GetMoney=function() return 4321 end
GetNumFactions=function() return 0 end
dofile('addon/BackstageForever/BackstageForeverLedger.lua')
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
assert(BackstageForeverExport:find('"ledger":{',1,true),'ledger exported')
assert(BackstageForeverExport:find('"money":4321',1,true))
assert(BackstageForeverExport:find('"cooldowns":[]',1,true) and BackstageForeverExport:find('"prices":[]',1,true),'empty lists stay arrays')
local roster=BackstageForeverLedgerRoster()
assert(#roster==1 and roster[1].money==4321 and roster[1].name=='Example')
-- A huge price memory is shed first, oldest characters first; quests survive.
for i=1,1500 do BackstageForeverLedgerRemember(200000+i,123456,1700000000-i,string.rep('N',95)) end
for id,e in pairs(BackstageForeverLedgerDB.prices) do for k=2,5 do e.hist[k]={99999,1600000000+k} end end
for i=1,4 do local who='Player-synthetic-'..i UnitGUID=function() return who end handler(nil,'PLAYER_LEVEL_UP') end
assert(#BackstageForeverExport<1048576)
local _,quests=BackstageForeverExport:gsub('"quests":','')
local _,prices=BackstageForeverExport:gsub('"prices":','')
local _,ledgers=BackstageForeverExport:gsub('"ledger":','')
assert(quests==5,'every character keeps its quests')
assert(ledgers==5 and prices>=1 and prices<5,'price memory is shed before the rest of the ledger: '..prices)
assert(BackstageForeverExport:find('"id":"Player-synthetic-4"',1,true))
print('ok')
`);
});
test("the ledger is installed, saved per character and never replaces a Blizzard function", () => {
  const dir = path.join(__dirname, "../addon/BackstageForever");
  const toc = fs.readFileSync(path.join(dir, "BackstageForever.toc"), "utf8"), src = fs.readFileSync(path.join(dir, "BackstageForeverLedger.lua"), "utf8");
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverLedgerDB/);
  assert.match(toc, /^BackstageForeverLedger\.lua\r?$/m);
  assert.doesNotMatch(toc, /## SavedVariables: .*Ledger/, "account-wide saved data stays the single export the app parses");
  for (const call of ["QueryAuctionItems", "PlaceAuctionBid", "PostAuction", "StartAuction", "GetInboxText", "TakeInbox", "ExpandFactionHeader", "hooksecurefunc", "SendChatMessage"])
    assert.ok(!src.includes(call + "("), `ledger must not call ${call}`);
  assert.doesNotMatch(src, /^\s*(?!BackstageForever)[A-Z][A-Za-z0-9_]*\s*=\s*function/m, "no global function replaced");
});

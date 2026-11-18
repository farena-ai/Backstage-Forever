"use strict";
// Ledger addon (0.35): bags, bank, mail, reputations, cooldowns and auction price memory, read
// only from public APIs on pages the player opened. Runs the real Lua in fengari.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
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
test("a collapsed faction keeps its observation time and build while other rows refresh", () => lua(WORLD + String.raw`
GetBuildInfo=function() return '1.15.2','12345' end
handler(nil,'PLAYER_LOGIN')
local function byId(id)
  for _,f in ipairs(BackstageForeverLedgerSnapshot().reputations.factions) do if f.id==id then return f end end
end
assert(byId(76).observedAt==t and byId(76).observedBuild=='1.15.2.12345')
table.remove(factions,4)
t=t+10
GetBuildInfo=function() return '1.15.2','55555' end
handler(nil,'UPDATE_FACTION')
assert(byId(76).observedAt==t-10 and byId(76).observedBuild=='1.15.2.12345')
assert(byId(72).observedAt==t and byId(72).observedBuild=='1.15.2.55555')
assert(captures==1,'faction changes request a saved capture')
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

test("1.2: price advice on tooltips and /bf sell weigh auction prices you saw against the vendor", () => lua(WORLD + String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local info={[2589]={'Linen Cloth',nil,1,nil,nil,nil,nil,nil,nil,nil,13},[118]={'Minor Healing Potion',nil,1,nil,nil,nil,nil,nil,nil,nil,5},[4865]={'Ruined Pelt',nil,0,nil,nil,nil,nil,nil,nil,nil,5}}
GetItemInfo=function(id) local r=info[tonumber(id) or tonumber(tostring(id):match('item:(%d+)'))] if r then return (table.unpack or unpack)(r,1,11) end end
BackstageForeverLedgerRemember(2589,90,t,'Linen Cloth',1)
BackstageForeverLedgerRemember(118,4,t,'Minor Healing Potion',1)
local a=BackstageForeverPriceAdvice(2589,13,1,20)
assert(a.verdict=='auction' and a.each==85 and a.auction==90,'auction after the 5% cut beats the vendor')
local line,r,g,b,verdict=BackstageForeverPriceLine(a)
assert(line:find('BF: auction ~',1,true) and line:find('vendor 13c',1,true) and line:find('stack 17s',1,true) and verdict=='Worth more at the Auction House',line)
assert(BackstageForeverPriceAdvice(118,5,1,1).verdict=='vendor','vendor pays more than the auction seen')
assert(BackstageForeverPriceAdvice(4865,5,0,1).verdict=='vendor','greys go to the vendor')
assert(BackstageForeverPriceAdvice(999,0,1,1)==nil,'nothing known, no line')
local auction,vendor,total=BackstageForeverSellAdvice({{id=2589,name='Linen Cloth',count=20,quality=1,vendor=13},{id=4865,name='Ruined Pelt',count=2,quality=0,vendor=5},{id=118,name='Minor Healing Potion',count=1,quality=1,vendor=5}})
assert(#auction==1 and auction[1].total==1700 and #vendor==2 and total==15)
local tip={lines={},AddLine=function(self,l) self.lines[#self.lines+1]=l end,GetItem=function() return 'Linen Cloth','|Hitem:2589|h[Linen Cloth]|h' end,Show=function()end}
GameTooltip=tip
BackstageForeverLedgerCommand('prices tips') assert(BackstageForeverLedgerDB.priceTips==false)
BackstageForeverLedgerCommand('prices tips') assert(BackstageForeverLedgerDB.priceTips==true)
print('ok')
`));

test("1.2: item tooltips say which quest in your log needs the item", () => lua(WORLD + String.raw`
C_QuestLog={GetNumQuestLogEntries=function() return 2 end,
  GetInfo=function(i) if i==1 then return {isHeader=true,title='Mulgore'} end return {questID=776,title='Rites of the Earthmother',isHeader=false} end,
  GetQuestObjectives=function(id) return {{type='item',text='Plainstrider Beak: 3/8',finished=false},{type='monster',text='Bristleback Quilboar slain: 2/10'}} end}
local line,r,g,b=BackstageForeverQuestUseLine('Plainstrider Beak')
assert(line=='Needed for Rites of the Earthmother: 3/8' and r==1,line)
assert(BackstageForeverQuestUseLine('Linen Cloth')==nil)
assert(BackstageForeverQuestUseLine('Bristleback Quilboar slain')==nil,'only item objectives')
print('ok')
`));

test("1.3: the trainer window you open is remembered with its costs; profession trainers are not", () => lua(WORLD + String.raw`
local svc={{'Frostbolt','Rank 2','available',190,8},{'Arcane Missiles','Rank 1','unavailable',400,8},{'Polymorph','Rank 1','used',300,8}}
GetNumTrainerServices=function() return #svc end
GetTrainerServiceInfo=function(i) return svc[i][1],svc[i][2],svc[i][3] end
GetTrainerServiceCost=function(i) return svc[i][4] end
GetTrainerServiceLevelReq=function(i) return svc[i][5] end
local tradeskill=true IsTradeskillTrainer=function() return tradeskill end
BackstageForeverLedgerReadTrainer()
assert(BackstageForeverLedgerDB.training==nil,'profession trainers are skipped')
tradeskill=false
BackstageForeverLedgerReadTrainer()
local s=BackstageForeverLedgerSnapshot()
assert(s.training and #s.training.services==3 and s.training.services[1].cost==190 and s.training.services[2].level==8 and s.training.seenAt==t)
print('ok')
`));

test("1.3 (J11): the riding trainer is kept apart from the class trainer, and vendor mounts are remembered", () => lua(WORLD + String.raw`
IsTradeskillTrainer=function() return false end
local svc={{'Apprentice Riding','','available',200000,40}}
GetNumTrainerServices=function() return #svc end
GetTrainerServiceInfo=function(i) return svc[i][1],svc[i][2],svc[i][3] end
GetTrainerServiceCost=function(i) return svc[i][4] end
GetTrainerServiceLevelReq=function(i) return svc[i][5] end
BackstageForeverLedgerReadTrainer()
assert(BackstageForeverLedgerDB.riding and BackstageForeverLedgerDB.training==nil,'riding does not replace class training')
local wares={{'Horn of the Timber Wolf',700000,1132,15,5},{'Wolf Meat',50,12,0,5}}
GetMerchantNumItems=function() return #wares end
GetMerchantItemInfo=function(i) return wares[i][1],nil,wares[i][2] end
GetMerchantItemID=function(i) return wares[i][3] end
GetItemInfoInstant=function(id) for _,w in ipairs(wares) do if w[3]==id then return id,nil,nil,nil,nil,w[4],w[5] end end end
BackstageForeverLedgerReadMounts()
local s0=BackstageForeverLedgerSnapshot()
assert(s0.riding and s0.riding.services[1].cost==200000)
assert(s0.mounts and #s0.mounts.items==1 and s0.mounts.items[1].name=='Horn of the Timber Wolf','only mounts are kept')
print('ok')
`));

test("J29 (1.5): at login, reminders about your other characters from their saves", () => {
  const harness = fs.readFileSync(path.join(__dirname, "addon.test.cjs"), "utf8");
  const start = harness.indexOf("const LUA_HARNESS = String.raw`") + "const LUA_HARNESS = String.raw`".length;
  const base = harness.slice(start, harness.indexOf("dofile('addon", start));
  lua(base + String.raw`
GetMoney=function() return 1 end GetNumFactions=function() return 0 end
local now=1800000000 time=function() return now end
local other={id='Player-other',name='Beta',realm='R',className='Mage',level=30,updatedAt=now-300*3600,progress={current=0,max=1000,rested=0},ledger={cooldowns={{key='transmute',readyAt=now-5}},mail={expiresAt=now+86400}}}
BackstageForeverExport='{"schema":1,"characters":[{"id":"Player-other","name":"Beta","realm":"R","className":"Mage","level":30,"updatedAt":'..(now-300*3600)..',"progress":{"current":0,"max":1000,"rested":0},"ledger":{"cooldowns":[{"key":"transmute","readyAt":'..(now-5)..'}],"mail":{"expiresAt":'..(now+86400)..'}}}]}'
dofile('addon/BackstageForever/BackstageForever.lua')
handler(nil,'PLAYER_LOGIN')
local lines=BackstageForeverReminderLines(now,'someone-else-entirely')
local all=table.concat(lines,'|')
assert(all:find("Beta's rested XP is full.",1,true),all)
assert(all:find('Beta: Transmute is ready.',1,true),all)
assert(all:find('Beta: mail expires in 1 day.',1,true),all)
print('ok')
`);
});

-- Ledger (0.35): money, bags, bank, mail, reputations, profession cooldowns and the auction
-- prices the player saw on Auction House pages they opened themselves. Events and read-only
-- public API calls only: nothing here searches, bids, buys or posts on the Auction House, reads
-- mail text, or replaces a Blizzard function. Kept per character in BackstageForeverLedgerDB and
-- exported (through BackstageForever.lua) to the desktop app on this computer only.
local floor,min,max=math.floor,math.min,math.max
local unpacked=unpack or table.unpack
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
-- Every return value of a public API, each checked for secret values.
local function results(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    local out={}
    for i=2,24 do out[i-1]=plain(r[i]) end
    return out
end
local function call(fn,...)
    local r=results(fn,...)
    if r then return unpacked(r,1,12) end
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return floor(v) end end
local function str(v,limit)
    v=plain(v)
    if type(v)~='string' or #v==0 or #v>(limit or 100) or v:find('[%z\1-\31\127]') then return nil end
    return v
end
local function now() return int(call(time),0,253402300799) end
local MONEY_MAX=1e13
local LIMITS={items=400,slots=600,letters=100,prices=1500,history=5,factions=120,page=200,moneyLog=30}
-- The same observation while the player pages through one search (15 minutes).
local SAME_SEARCH=900

local db
local function store()
    if type(BackstageForeverLedgerDB)~='table' then BackstageForeverLedgerDB={} end
    db=BackstageForeverLedgerDB
    if type(db.prices)~='table' then db.prices={} end
    if type(db.reputations)~='table' then db.reputations={} end
    if db.pricesOn==nil then db.pricesOn=true end
    return db
end
local function say(message)
    local chat=plain(DEFAULT_CHAT_FRAME);local add=field(chat,'AddMessage')
    if type(add)=='function' then pcall(add,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(message)) end
end
local function request()
    if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
end
local function linkName(link)
    link=str(link,600);if not link then return nil end
    return str(link:match('|h%[(.-)%]|h'),100)
end
local function linkId(link)
    link=str(link,600);if not link then return nil end
    return int(tonumber(link:match('item:(%d+)')),1,2147483647)
end

-- One list of {id, n (count), q (quality), name} per place, at most LIMITS.items distinct items.
local function adder()
    local byId,list,complete={}, {},true
    local function add(id,n,q,name)
        local e=byId[id]
        if e then
            if e.n+n<=1000000 then e.n=e.n+n else complete=false end
            if not e.name and name then e.name=name end
            if not e.q and q then e.q=q end
        elseif #list>=LIMITS.items then complete=false
        else
            e={id=id,n=n,q=q,name=name};byId[id]=e;list[#list+1]=e
        end
    end
    local function finish()
        table.sort(list,function(a,b)return a.id<b.id end)
        return list,complete
    end
    return add,finish,function()complete=false end
end
local function readContainers(bags)
    local api=plain(C_Container)
    local slotsOf,infoOf=field(api,'GetContainerNumSlots'),field(api,'GetContainerItemInfo')
    if type(slotsOf)~='function' or type(infoOf)~='function' then return nil end
    local add,finish,partial=adder()
    local slots=0
    for _,bag in ipairs(bags) do
        local n=int(call(slotsOf,bag),0,1000)
        if not n then partial()
        else
            for slot=1,n do
                slots=slots+1
                if slots>LIMITS.slots then partial();break end
                local ok,raw=pcall(infoOf,bag,slot)
                raw=plain(raw)
                if not ok then partial()
                elseif raw~=nil then
                    local id=int(field(raw,'itemID'),1,2147483647);local count=int(field(raw,'stackCount'),1,1000000)
                    if id and count then add(id,count,int(field(raw,'quality'),0,7),linkName(field(raw,'hyperlink'))) else partial() end
                end
            end
        end
    end
    return finish()
end
local function bagList()
    local last=int(plain(NUM_BAG_SLOTS),1,10) or 4
    local list={};for bag=0,last do list[#list+1]=bag end
    return list
end
-- Classic era: the bank's own slots (container -1) and bank bag slots 5-10.
local function bankList()
    local bags=int(plain(NUM_BAG_SLOTS),1,10) or 4;local bank=int(plain(NUM_BANKBAGSLOTS),0,12) or 6
    local list={int(plain(BANK_CONTAINER),-10,-1) or -1}
    for bag=bags+1,bags+bank do list[#list+1]=bag end
    return list
end

local bankOpen,mailOpen=false,false
local function readBank()
    local t=now();if not t then return end
    local items,complete=readContainers(bankList())
    if items then store().bank={seenAt=t,complete=complete,items=items} end
end

-- Mail: item ids, counts, money and days left only. Senders, subjects and letter text are
-- never read (GetInboxText would also mark a letter read).
local function readMail()
    local t=now();if not t then return end
    local count=int(call(GetInboxNumItems),0,10000)
    if not count then return end
    local add,finish,partial=adder()
    local money,soonest=0,nil
    local attachments=int(plain(ATTACHMENTS_MAX_RECEIVE),1,16) or 12
    if count>LIMITS.letters then partial() end
    for i=1,min(count,LIMITS.letters) do
        local h=results(GetInboxHeaderInfo,i)
        if not h then partial()
        else
            local cash,cod,days,hasItem=int(h[5],0,MONEY_MAX),int(h[6],0,MONEY_MAX),plain(h[7]),plain(h[8])
            if cash then money=money+cash end
            if type(days)=='number' and days==days and days>=0 and days<=31 then soonest=soonest and min(soonest,days) or days end
            -- Cash on delivery is not the player's until paid for.
            if hasItem and not (cod and cod>0) then
                for j=1,attachments do
                    local r=results(GetInboxItem,i,j)
                    local id=linkId(call(GetInboxItemLink,i,j))
                    if r and (id or r[1]) then
                        -- Current clients return name, itemID, texture, count, quality, canUse; older
                        -- ones name, texture, count, quality, canUse. The link (or where canUse
                        -- sits) decides which one this is.
                        local modern
                        if id then modern=r[2]==id else modern=type(r[5])=='number' and type(r[6])=='boolean';id=modern and int(r[2],1,2147483647) or nil end
                        local n,q
                        if modern then n=int(r[4],1,1000000);q=int(r[5],0,7) else n=int(r[3],1,1000000);q=int(r[4],0,7) end
                        if id and n then add(id,n,q,str(r[1],100)) else partial() end
                    end
                end
            end
        end
    end
    local items,complete=finish()
    store().mail={seenAt=t,complete=complete,letters=count,money=money,expiresAt=soonest and t+floor(soonest*86400) or nil,items=items}
end

-- Reputation: every faction row with a bar. Collapsed headers hide their factions; those keep
-- their last-seen values (the addon never expands or collapses the player's list).
local MAX_REPUTATION_SCAN=2147483646
local function reputationScan(value,limit)
    local id=int(value,1,limit)
    if id==value then return id end
end
local function readFactions()
    local n=int(call(GetNumFactions),0,1000)
    if not n then return end
    local d=store();local seen=false;local t=now()
    -- Persist the sequence with this character's rows; clocks and UI sessions can repeat.
    local lastScan=reputationScan(d.reputationsScan,MAX_REPUTATION_SCAN+1) or 0
    local nextScan=min(lastScan,MAX_REPUTATION_SCAN)+1
    local scan=t and t>0 and nextScan<=MAX_REPUTATION_SCAN and nextScan or nil
    local version,build=call(GetBuildInfo)
    version=str(version,11);build=str(build,8)
    local observedBuild=version and build and version:match('^%d%d?%d?%.%d%d?%d?%.%d%d?%d?$') and build:match('^%d+$') and (version..'.'..build) or nil
    for i=1,min(n,300) do
        local r=results(GetFactionInfo,i)
        if r then
            -- name, description, standingID, barMin, barMax, barValue, atWarWith, canToggleAtWar,
            -- isHeader, isCollapsed, hasRep, isWatched, isChild, factionID
            local name,standing,lo,hi,value=str(r[1],100),int(r[3],1,8),int(r[4],-100000,100000),int(r[5],-100000,100000),int(r[6],-100000,100000)
            local header,hasRep,id=r[9],r[11],int(r[14],1,100000)
            if id and name and standing and lo and hi and value and hi>lo and (not header or hasRep) then
                local known=d.reputations[id]~=nil
                local count=0;if not known then for _ in pairs(d.reputations) do count=count+1 end end
                if known or count<LIMITS.factions then
                    d.reputations[id]={id=id,name=name,standing=standing,min=lo,max=hi,value=value,observedAt=t and t>0 and t or nil,observedBuild=t and t>0 and observedBuild or nil,scanId=scan}
                    seen=true
                end
            end
        end
    end
    if seen then d.reputationsAt=t;d.reputationsScan=nextScan end
    return seen
end

local function reputationSnapshot(d,t)
    local factions={}
    local seenAt=int(d.reputationsAt,0,253402300799)
    local scan=seenAt and seenAt>0 and reputationScan(d.reputationsScan,MAX_REPUTATION_SCAN) or nil
    for _,f in pairs(d.reputations) do if type(f)=='table' then factions[#factions+1]={id=f.id,name=f.name,standing=f.standing,min=f.min,max=f.max,value=f.value,observedAt=f.observedAt,observedBuild=f.observedBuild,scanId=scan and reputationScan(f.scanId,scan) or nil} end end
    table.sort(factions,function(a,b)return a.id<b.id end)
    if #factions>0 then return {seenAt=seenAt or t,scanId=scan,factions=factions} end
end

-- Profession cooldowns this addon is sure about. Transmutes are one shared group.
local COOLDOWNS={
    {key='transmute',spells={17187,11479,11480,17559,17560,17561,17562,17563,17564,17565,17566}},
    {key='mooncloth',spells={18560}},
    {key='salt-shaker',item=15846},
}
local function remaining(start,duration)
    start=plain(start);duration=plain(duration)
    if type(start)~='number' or type(duration)~='number' or start<=0 or duration<=2 then return 0 end
    local clock=plain(call(GetTime))
    if type(clock)~='number' then return nil end
    return max(0,start+duration-clock)
end
local function spellCooldown(id)
    if type(plain(GetSpellCooldown))=='function' then
        local start,duration=call(GetSpellCooldown,id)
        return remaining(start,duration)
    end
    local info=call(field(plain(C_Spell),'GetSpellCooldown'),id)
    return remaining(field(info,'startTime'),field(info,'duration'))
end
local function knows(id)
    return call(IsPlayerSpell,id)==true or call(IsSpellKnown,id)==true
end
local function cooldowns()
    local t=now();local list={}
    if not t then return list end
    for _,c in ipairs(COOLDOWNS) do
        if c.spells then
            local best,spell
            for _,id in ipairs(c.spells) do
                local left=spellCooldown(id)
                -- An active cooldown also proves the recipe is known.
                if left and (knows(id) or left>0) and (not best or left>best) then best,spell=left,id end
            end
            if best then list[#list+1]={key=c.key,spellId=spell,readyAt=t+floor(best+.5)} end
        elseif c.item then
            local count=int(call(GetItemCount,c.item),0,1000000)
            if count and count>0 then
                local fn=field(plain(C_Container),'GetItemCooldown');if type(fn)~='function' then fn=plain(GetItemCooldown) end
                local start,duration=call(fn,c.item)
                local left=remaining(start,duration)
                if left then list[#list+1]={key=c.key,itemId=c.item,readyAt=t+floor(left+.5)} end
            end
        end
    end
    return list
end

-- Auction price memory: only the result pages the player opened. The lowest buyout per unit of
-- each item on those pages, with a short history. Owners and bidders are never read.
local function trimPrices(d)
    local list={}
    for id,e in pairs(d.prices) do
        local at=type(e)=='table' and type(e.hist)=='table' and type(e.hist[1])=='table' and e.hist[1][2]
        if type(at)~='number' then d.prices[id]=nil else list[#list+1]={id=id,at=at} end
    end
    if #list<=LIMITS.prices then return end
    table.sort(list,function(a,b)return a.at<b.at end)
    for i=1,#list-LIMITS.prices do d.prices[list[i].id]=nil end
end
function BackstageForeverLedgerRemember(id,unit,at,name,quality)
    local d=store();id=int(id,1,2147483647);unit=int(unit,1,MONEY_MAX);at=int(at,0,253402300799)
    if not id or not unit or not at then return nil end
    local e=d.prices[id]
    if type(e)~='table' or type(e.hist)~='table' then e={hist={}};d.prices[id]=e end
    e.name=str(name,100) or e.name;e.q=int(quality,0,7) or e.q
    local top=e.hist[1]
    if type(top)=='table' and type(top[2])=='number' and at-top[2]>=0 and at-top[2]<=SAME_SEARCH then
        if unit<top[1] then top[1]=unit end
        top[2]=at
    else
        table.insert(e.hist,1,{unit,at})
        while #e.hist>LIMITS.history do table.remove(e.hist) end
    end
    return e
end
local function readAuctions()
    local d=store();if not d.pricesOn then return end
    local t=now();if not t then return end
    local n=int(call(GetNumAuctionItems,'list'),0,100000)
    if not n or n==0 then return end
    local low,names,qualities={}, {}, {}
    for i=1,min(n,LIMITS.page) do
        -- name, texture, count, quality, canUse, level, levelColHeader, minBid, minIncrement,
        -- buyoutPrice, bidAmount, highBidder, bidderFullName, owner, ownerFullName, saleStatus, itemId
        local r=results(GetAuctionItemInfo,'list',i)
        if r then
            local count,buyout=int(r[3],1,10000),int(r[10],1,MONEY_MAX)
            local id=int(r[17],1,2147483647) or linkId(call(GetAuctionItemLink,'list',i))
            if id and count and buyout then
                local unit=max(1,floor(buyout/count+.5))
                if not low[id] or unit<low[id] then low[id]=unit end
                names[id]=names[id] or str(r[1],100);qualities[id]=qualities[id] or int(r[4],0,7)
            end
        end
    end
    for id,unit in pairs(low) do BackstageForeverLedgerRemember(id,unit,t,names[id],qualities[id]) end
    trimPrices(d)
end

-- Trainer costs (1.3, J10): what your class trainer charges, read from the trainer window you
-- opened yourself. Kept per character; the app works out what the next visits cost.
local TRAIN_MAX=200
local function readTrainer()
    local d=store();local t=now();if not t then return end
    if call(IsTradeskillTrainer)==true then return end
    local n=int(call(GetNumTrainerServices),0,1000);if not n or n==0 then return end
    local services,seen={},{}
    for i=1,min(n,TRAIN_MAX) do
        local name,rank,category=call(GetTrainerServiceInfo,i)
        name=str(name,100);rank=str(rank,40)
        local cost=int(call(GetTrainerServiceCost,i),0,MONEY_MAX)
        local level=int(call(GetTrainerServiceLevelReq,i),0,1000)
        if name and cost and level and category~='header' then
            local key=name..'|'..(rank or '')
            if not seen[key] then seen[key]=true;services[#services+1]={name=name,rank=rank,level=level,cost=cost} end
        end
    end
    if #services==0 then return end
    local riding=false
    for _,s in ipairs(services) do if s.name:find('Riding',1,true) then riding=true end end
    if riding then d.riding={seenAt=t,services=services} else d.training={seenAt=t,services=services} end
end
-- 1.3 (J11): mount prices from a vendor window you open (items the game files as mounts).
local function readMerchantMounts()
    local d=store();local t=now();if not t then return end
    local n=int(call(GetMerchantNumItems),0,500);if not n or n==0 then return end
    local items={}
    for i=1,min(n,200) do
        local name,_,price=call(GetMerchantItemInfo,i)
        local id=int(call(GetMerchantItemID,i),1,2147483647)
        local classId,subclassId
        if id then local r={call(GetItemInfoInstant,id)};classId,subclassId=r[6],r[7] end
        name=str(name,100);price=int(price,0,MONEY_MAX)
        if id and name and price and price>0 and classId==15 and subclassId==5 and #items<20 then items[#items+1]={id=id,name=name,cost=price} end
    end
    if #items>0 then d.mounts={seenAt=t,items=items} end
end
-- Craft profit (E7): what a vendor charges for trade goods and reagents, read from a merchant
-- window you opened yourself. Kept per character with the time; the newest sightings win.
local VENDOR_MAX=200
function BackstageForeverLedgerVendorPrice(id,cost,n,at)
    local d=store();id=int(id,1,2147483647);cost=int(cost,1,MONEY_MAX);n=int(n,1,10000) or 1;at=int(at,0,253402300799)
    if not id or not cost or not at then return nil end
    if type(d.vendor)~='table' then d.vendor={} end
    d.vendor[id]={cost=cost,n=n,at=at}
    return d.vendor[id]
end
local function vendorList(d)
    local list={}
    for id,e in pairs(type(d.vendor)=='table' and d.vendor or {}) do
        if int(id,1,2147483647) and type(e)=='table' and int(e.cost,1,MONEY_MAX) and int(e.at,0,253402300799) then
            list[#list+1]={id=id,cost=e.cost,n=int(e.n,1,10000) or 1,at=e.at}
        else d.vendor[id]=nil end
    end
    table.sort(list,function(a,b) if a.at~=b.at then return a.at>b.at end;return a.id<b.id end)
    for i=#list,VENDOR_MAX+1,-1 do d.vendor[list[i].id]=nil;list[i]=nil end
    return list
end
local function readMerchantGoods()
    local d=store();local t=now();if not t then return end
    local n=int(call(GetMerchantNumItems),0,500);if not n or n==0 then return end
    for i=1,min(n,200) do
        local _,_,price,quantity,_,_,_,extended=call(GetMerchantItemInfo,i)
        local id=int(call(GetMerchantItemID,i),1,2147483647)
        local classId
        if id then local r={call(GetItemInfoInstant,id)};classId=r[6] end
        -- Trade goods (7) and reagents (5), bought for coin only.
        if id and (classId==7 or classId==5) and extended~=true then BackstageForeverLedgerVendorPrice(id,price,quantity,t) end
    end
    vendorList(d)
end
BackstageForeverLedgerReadGoods=readMerchantGoods
BackstageForeverLedgerReadMounts=readMerchantMounts
BackstageForeverLedgerReadTrainer=readTrainer
local function copyItems(items)
    local out={}
    for _,e in ipairs(type(items)=='table' and items or {}) do
        if type(e)=='table' and int(e.id,1,2147483647) and int(e.n,1,1000000) then out[#out+1]={id=e.id,n=e.n,q=int(e.q,0,7),name=str(e.name,100)} end
        if #out>=LIMITS.items then break end
    end
    return out
end
-- One gold sample per calendar day (UTC), oldest first, at most LIMITS.moneyLog days.
local function rememberMoney(d,money,t)
    if type(d.moneyLog)~='table' then d.moneyLog={} end
    local log=d.moneyLog
    local last=log[#log]
    if type(last)=='table' and int(last[2],0,253402300799) and floor(last[2]/86400)==floor(t/86400) then last[1]=money;last[2]=t
    elseif type(last)~='table' or (int(last[2],0,253402300799) or 0)<t then log[#log+1]={money,t} end
    while #log>LIMITS.moneyLog do table.remove(log,1) end
end
-- Export block. BackstageForever.lua marks the lists as JSON arrays.
function BackstageForeverLedgerSnapshot()
    local d=store();local t=now()
    if not t then return nil end
    local out={schemaVersion=1}
    local money=int(call(GetMoney),0,MONEY_MAX)
    if money then out.money=money;out.moneyAt=t;d.money=money;d.moneyAt=t;rememberMoney(d,money,t)
    elseif int(d.money,0,MONEY_MAX) then out.money=d.money;out.moneyAt=d.moneyAt end
    -- Gold over the last days (one sample per day, the last one seen) for the app's gold goal.
    local log={}
    for _,e in ipairs(type(d.moneyLog)=='table' and d.moneyLog or {}) do
        if type(e)=='table' and int(e[1],0,MONEY_MAX) and int(e[2],0,253402300799) and #log<LIMITS.moneyLog then log[#log+1]={e[1],e[2]} end
    end
    out.moneyLog=log
    local items,complete=readContainers(bagList())
    if items then out.bags={seenAt=t,complete=complete,items=items} end
    if bankOpen then readBank() end
    for _,key in ipairs({'bank','mail'}) do
        local place=d[key]
        if type(place)=='table' and int(place.seenAt,0,253402300799) then
            local copy={seenAt=place.seenAt,complete=place.complete==true,items=copyItems(place.items)}
            if key=='mail' then copy.letters=int(place.letters,0,10000) or 0;copy.money=int(place.money,0,MONEY_MAX) or 0;copy.expiresAt=int(place.expiresAt,0,253402300799) end
            out[key]=copy
        end
    end
    out.reputations=reputationSnapshot(d,t)
    out.cooldowns=cooldowns()
    if type(d.training)=='table' and int(d.training.seenAt,0,253402300799) and type(d.training.services)=='table' then
        local list={}
        for _,s in ipairs(d.training.services) do if type(s)=='table' and str(s.name,100) and int(s.level,0,1000) and int(s.cost,0,MONEY_MAX) and #list<TRAIN_MAX then list[#list+1]={name=s.name,rank=str(s.rank,40),level=s.level,cost=s.cost} end end
        out.training={seenAt=d.training.seenAt,services=list}
    end
    if type(d.riding)=='table' and int(d.riding.seenAt,0,253402300799) and type(d.riding.services)=='table' then
        local list={}
        for _,s in ipairs(d.riding.services) do if type(s)=='table' and str(s.name,100) and int(s.level,0,1000) and int(s.cost,0,MONEY_MAX) and #list<20 then list[#list+1]={name=s.name,rank=str(s.rank,40),level=s.level,cost=s.cost} end end
        out.riding={seenAt=d.riding.seenAt,services=list}
    end
    if type(d.mounts)=='table' and int(d.mounts.seenAt,0,253402300799) and type(d.mounts.items)=='table' then
        local list={}
        for _,m in ipairs(d.mounts.items) do if type(m)=='table' and int(m.id,1,2147483647) and str(m.name,100) and int(m.cost,0,MONEY_MAX) and #list<20 then list[#list+1]={id=m.id,name=m.name,cost=m.cost} end end
        out.mounts={seenAt=d.mounts.seenAt,items=list}
    end
    local goods=vendorList(d)
    if #goods>0 then out.vendor=goods end
    local prices={}
    for id,e in pairs(d.prices) do
        if type(e)=='table' and type(e.hist)=='table' and #e.hist>0 then
            local hist={}
            for i=1,min(#e.hist,LIMITS.history) do local h=e.hist[i];if type(h)=='table' and int(h[1],1,MONEY_MAX) and int(h[2],0,253402300799) then hist[#hist+1]={h[1],h[2]} end end
            if #hist>0 then prices[#prices+1]={id=id,name=e.name,q=e.q,hist=hist} end
        end
    end
    table.sort(prices,function(a,b)return a.hist[1][2]>b.hist[1][2] end)
    while #prices>LIMITS.prices do table.remove(prices) end
    out.prices=prices
    out.pricesOn=d.pricesOn==true
    return out
end

local function coins(copper)
    copper=int(copper,0,MONEY_MAX) or 0
    local g,s,c=floor(copper/10000),floor(copper%10000/100),copper%100
    if g>0 then return ('%dg %ds %dc'):format(g,s,c) end
    if s>0 then return ('%ds %dc'):format(s,c) end
    return ('%dc'):format(c)
end
local function ago(at)
    local t=now();at=int(at,0,253402300799)
    if not t or not at then return 'at an unknown time' end
    local s=max(0,t-at)
    if s<120 then return 'just now' end
    if s<7200 then return floor(s/60)..' minutes ago' end
    if s<172800 then return floor(s/3600)..' hours ago' end
    return floor(s/86400)..' days ago'
end
local function priceCount(d)
    local n=0;for _ in pairs(d.prices) do n=n+1 end;return n
end
-- Price advice (1.2, J5): what you saw at auction against what a vendor pays. Pure; the auction
-- house keeps 5% of a sale, so "worth auctioning" means clearly more than the vendor after that cut.
local AH_CUT=0.95
function BackstageForeverPriceAdvice(id,vendor,quality,count,at)
    local d=store();id=int(id,1,2147483647);if not id then return nil end
    vendor=int(vendor,0,MONEY_MAX);count=int(count,1,100000) or 1;quality=int(quality,0,7)
    local e=d.prices[id];local top=type(e)=='table' and type(e.hist)=='table' and e.hist[1] or nil
    local auction=type(top)=='table' and int(top[1],1,MONEY_MAX) or nil
    local seenAt=type(top)=='table' and int(top[2],0,253402300799) or nil
    if not auction and not (vendor and vendor>0) then return nil end
    local verdict=nil
    if auction and auction*AH_CUT>(vendor or 0)*1.5 and auction*AH_CUT-(vendor or 0)>=20 then verdict='auction'
    elseif quality==0 or (auction and vendor and vendor>0 and auction*AH_CUT<=vendor) then verdict='vendor' end
    return {id=id,auction=auction,seenAt=seenAt,vendor=vendor,count=count,verdict=verdict,
        each=verdict=='auction' and floor(auction*AH_CUT) or vendor or 0}
end
function BackstageForeverPriceLine(advice,at)
    if type(advice)~='table' then return nil end
    local parts={}
    if advice.auction then parts[#parts+1]='auction ~'..coins(advice.auction)..(advice.seenAt and (' ('..ago(advice.seenAt)..')') or '') end
    if advice.vendor and advice.vendor>0 then parts[#parts+1]='vendor '..coins(advice.vendor) end
    if #parts==0 then return nil end
    local line='BF: '..table.concat(parts,' · ')
    if advice.count>1 and advice.each>0 then line=line..' · stack '..coins(advice.each*advice.count) end
    if advice.verdict=='auction' then return line,0.25,1,0.25,'Worth more at the Auction House' end
    if advice.verdict=='vendor' then return line,0.8,0.8,0.8,'Sell to a vendor' end
    return line,0.8,0.8,0.8
end
-- Quest use (1.2, J7): "Needed for The Sacred Flame: 3/8" on items your quest log asks for.
-- Read from your own quest log on demand and kept until the log changes.
local questUse=nil
function BackstageForeverQuestUseIndex()
    if questUse then return questUse end
    questUse={}
    local api=plain(C_QuestLog);if type(api)~='table' then return questUse end
    local n=int(call(api.GetNumQuestLogEntries),0,100) or 0
    for i=1,n do
        local info=call(api.GetInfo,i)
        if type(info)=='table' and field(info,'isHeader')~=true then
            local id=int(field(info,'questID'),1,2147483647);local title=str(field(info,'title'),100)
            local objectives=id and call(api.GetQuestObjectives,id)
            if title and type(objectives)=='table' then
                for _,o in ipairs(objectives) do
                    local text=str(field(o,'text'),200)
                    if field(o,'type')=='item' and text then
                        local name,have,need=text:match('^(.-):%s*(%d+)%s*/%s*(%d+)$')
                        if not name then have,need,name=text:match('^(%d+)%s*/%s*(%d+)%s+(.+)$') end
                        if name then questUse[name:lower()]={quest=title,have=tonumber(have),need=tonumber(need),done=field(o,'finished')==true} end
                    end
                end
            end
        end
    end
    return questUse
end
function BackstageForeverQuestUseLine(name)
    name=str(name,100);if not name then return nil end
    local u=BackstageForeverQuestUseIndex()[name:lower()];if not u then return nil end
    if u.done then return ('Quest item: %s (done, %d/%d)'):format(u.quest,u.have or 0,u.need or 0),.6,.6,.6 end
    return ('Needed for %s: %d/%d'):format(u.quest,u.have or 0,u.need or 0),1,.82,0
end
if type(CreateFrame)=='function' then
    local qf=CreateFrame('Frame')
    if qf then pcall(qf.RegisterEvent,qf,'QUEST_LOG_UPDATE');pcall(qf.SetScript,qf,'OnEvent',function() questUse=nil end) end
end
local function tooltipItem(tooltip,data)
    local link
    if type(tooltip)=='table' and type(tooltip.GetItem)=='function' then local ok,_,l=pcall(tooltip.GetItem,tooltip);if ok then link=plain(l) end end
    if type(link)~='string' and type(data)=='table' then link=plain(data.hyperlink) end
    local id=linkId(link) or (type(data)=='table' and int(plain(data.id),1,2147483647)) or nil
    return id,link
end
local tipShown=setmetatable({},{__mode='k'})
-- 1.19: where an item comes from, out of BackstageForeverSources.lua (bundled community observations).
-- Pure. faction: 'Alliance' or 'Horde' (sellers for the other side are left out); mapName: mapId -> name or nil.
-- Returns up to two lines: "Dropped by: A (40%), B (31%)" / "Found in: Crate" and "Sold by: X (Zone), Y (Zone)".
function BackstageForeverSourceLines(id,faction,mapName)
    local data=type(BackstageForeverSourceData)=='table' and BackstageForeverSourceData or nil
    if not data or type(id)~='number' then return {} end
    local T=BackstageForeverTr or tostring
    local lines={}
    local drops=type(data.drops)=='table' and rawget(data.drops,id)
    if type(drops)=='string' then
        local creatures,objects={},{}
        for kind,name,chance in drops:gmatch('([no])~([^~|]+)~(%d+)') do
            if kind=='o' then objects[#objects+1]=name else creatures[#creatures+1]=('%s (%s%%)'):format(name,chance) end
        end
        if #creatures>0 then lines[#lines+1]=T('Dropped by:')..' '..table.concat(creatures,', ') end
        if #objects>0 then lines[#lines+1]=T('Found in:')..' '..table.concat(objects,', ') end
    end
    local sold=type(data.sold)=='table' and rawget(data.sold,id)
    if type(sold)=='string' then
        local mine=faction=='Alliance' and 'A' or faction=='Horde' and 'H' or nil
        local sellers={}
        for name,map,side in sold:gmatch('([^~|]+)~(%d+)~([AHB])') do
            if #sellers<3 and (not mine or side==mine or side=='B') then
                local place=type(mapName)=='function' and mapName(tonumber(map)) or nil
                sellers[#sellers+1]=type(place)=='string' and place~='' and ('%s (%s)'):format(name,place) or name
            end
        end
        if #sellers>0 then lines[#lines+1]=T('Sold by:')..' '..table.concat(sellers,', ') end
    end
    return lines
end
local function sourceMapName(mapId)
    local info=type(C_Map)=='table' and call(C_Map.GetMapInfo,mapId)
    local name=type(info)=='table' and plain(info.name)
    if type(name)=='string' then return name end
end
local function onTooltip(tooltip,data,resize)
    local d=store();if d.priceTips==false or (tooltip~=GameTooltip and tooltip~=ItemRefTooltip) then return end
    local id,link=tooltipItem(tooltip,data);if not id then return end
    if tipShown[tooltip]==id then return end
    local r={call(GetItemInfo,link or id)}
    local quest,qr,qg,qb=BackstageForeverQuestUseLine(r[1])
    local advice=BackstageForeverPriceAdvice(id,r[11],r[3],1)
    local line,cr,cg,cb,verdict=BackstageForeverPriceLine(advice)
    local ok,sources=pcall(BackstageForeverSourceLines,id,plain(call(UnitFactionGroup,'player')),sourceMapName)
    if not ok or type(sources)~='table' then sources={} end
    if not line and not quest and #sources==0 then return end
    tipShown[tooltip]=id
    if quest then pcall(tooltip.AddLine,tooltip,quest,qr,qg,qb) end
    if line then
        pcall(tooltip.AddLine,tooltip,line,cr,cg,cb)
        if verdict=='Worth more at the Auction House' then pcall(tooltip.AddLine,tooltip,verdict,0.25,1,0.25) end
    end
    for _,source in ipairs(sources) do pcall(tooltip.AddLine,tooltip,source,.75,.85,1,true) end
    if resize then pcall(tooltip.Show,tooltip) end
end
local function clearShown(tooltip) tipShown[tooltip]=nil end
local function hookPriceTips()
    if type(TooltipDataProcessor)=='table' and type(TooltipDataProcessor.AddTooltipPostCall)=='function' and type(Enum)=='table' and type(Enum.TooltipDataType)=='table' and Enum.TooltipDataType.Item~=nil then
        pcall(TooltipDataProcessor.AddTooltipPostCall,Enum.TooltipDataType.Item,function(tooltip,data) clearShown(tooltip);pcall(onTooltip,tooltip,data,false) end)
        return 'postcall'
    end
    local hooked
    for _,tip in ipairs({GameTooltip,ItemRefTooltip}) do
        if type(tip)=='table' and type(tip.HookScript)=='function' then
            if pcall(tip.HookScript,tip,'OnTooltipSetItem',function(self) pcall(onTooltip,self,nil,true) end) then hooked='script' end
            pcall(tip.HookScript,tip,'OnTooltipCleared',clearShown)
        end
    end
    return hooked
end
BackstageForeverPriceTipMode=hookPriceTips()
-- /bf sell: what in your bags is worth more at auction, and what a vendor should get.
function BackstageForeverSellAdvice(items)
    local auction,vendor,vendorTotal={},{},0
    for _,it in ipairs(type(items)=='table' and items or {}) do
        local a=BackstageForeverPriceAdvice(it.id,it.vendor,it.quality,it.count)
        if a and a.verdict=='auction' then auction[#auction+1]={name=it.name or ('item '..it.id),count=a.count,total=a.each*a.count}
        elseif a and a.verdict=='vendor' and (a.vendor or 0)>0 then vendor[#vendor+1]=it;vendorTotal=vendorTotal+a.vendor*a.count end
    end
    table.sort(auction,function(x,y)return x.total>y.total end)
    return auction,vendor,vendorTotal
end
local function bagContents()
    local api=plain(C_Container);local out={}
    if type(api)~='table' then return out end
    for bag=0,4 do
        local slots=int(call(api.GetContainerNumSlots,bag),0,64) or 0
        for slot=1,slots do
            local info=call(api.GetContainerItemInfo,bag,slot)
            local id=int(field(info,'itemID'),1,2147483647)
            if id then
                local r={call(GetItemInfo,id)}
                out[#out+1]={id=id,name=str(r[1],100),quality=int(field(info,'quality'),0,7) or int(r[3],0,7),count=int(field(info,'stackCount'),1,100000) or 1,vendor=int(r[11],0,MONEY_MAX)}
            end
        end
    end
    return out
end
function BackstageForeverSellCommand()
    local auction,vendor,vendorTotal=BackstageForeverSellAdvice(bagContents())
    if #auction==0 then say('Nothing in your bags is clearly worth more at auction than at a vendor, from the prices you have seen. Browse the Auction House and the addon remembers what it shows you.')
    else
        say('Worth more at the Auction House (after its 5% cut):')
        for i=1,min(#auction,6) do local a=auction[i];say(('  %s%s: about %s'):format(a.name,a.count>1 and (' x'..a.count) or '',coins(a.total))) end
        if #auction>6 then say(('  and %d more.'):format(#auction-6)) end
    end
    if #vendor>0 then say(('Sell to a vendor: %d item%s for %s (the Sell junk button on a vendor does the greys).'):format(#vendor,#vendor==1 and '' or 's',coins(vendorTotal))) end
end
function BackstageForeverLedgerCommand(message)
    local d=store()
    local word,arg=(type(message)=='string' and message:lower() or ''):match('^(%a+)%s*(%a*)')
    if word=='prices' then
        if arg=='tips' then d.priceTips=d.priceTips==false;say(d.priceTips and 'Price lines on item tooltips are on.' or 'Price lines on item tooltips are off.');return d.priceTips end
        if arg=='on' then d.pricesOn=true elseif arg=='off' then d.pricesOn=false
        elseif arg=='' or arg=='status' then
            say(('Price memory is %s: %d item prices remembered from Auction House pages you opened.'):format(d.pricesOn and 'on' or 'off',priceCount(d)))
            return d.pricesOn
        else say('Use /bf prices on, off, status or tips.');return end
        say(d.pricesOn and 'Price memory on: the addon remembers the lowest buyout on Auction House pages you open yourself. It never searches or buys.' or 'Price memory off. Prices you saw before stay in the desktop app.')
        return d.pricesOn
    end
    -- /bf ledger: gold across the characters this addon knows, and what the ledger has seen here.
    local roster=type(BackstageForeverLedgerRoster)=='function' and select(2,pcall(BackstageForeverLedgerRoster)) or {}
    if type(roster)~='table' then roster={} end
    local me=str(call(UnitName,'player'),100)
    local total,lines,known=0,{},0
    local live=int(call(GetMoney),0,MONEY_MAX)
    local counted=false
    for _,c in ipairs(roster) do
        local money=int(c.money,0,MONEY_MAX)
        if c.name==me and live then money=live;counted=true end
        if money then total=total+money;known=known+1;lines[#lines+1]={name=str(c.name,100) or '?',money=money} end
    end
    if live and not counted then total=total+live;known=known+1;lines[#lines+1]={name=me or 'You',money=live} end
    table.sort(lines,function(a,b)return a.money>b.money end)
    say(('Gold across %d character%s: %s.'):format(known,known==1 and '' or 's',coins(total)))
    for i=1,min(#lines,8) do say(('  %s: %s'):format(lines[i].name,coins(lines[i].money))) end
    say(type(d.bank)=='table' and ('Bank last seen %s.'):format(ago(d.bank.seenAt)) or 'Bank: open your bank once so the app can list it.')
    say(type(d.mail)=='table' and ('Mailbox last seen %s.'):format(ago(d.mail.seenAt)) or 'Mail: open a mailbox once so the app can list it.')
    say(('Price memory %s, %d items. The desktop app shows it all under Ledger after /reload or logout.'):format(d.pricesOn and 'on' or 'off',priceCount(d)))
    return total
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_MONEY','UPDATE_FACTION','BANKFRAME_OPENED','BANKFRAME_CLOSED','PLAYERBANKSLOTS_CHANGED','BAG_UPDATE','MAIL_SHOW','MAIL_INBOX_UPDATE','MAIL_CLOSED','AUCTION_ITEM_LIST_UPDATE','AUCTION_HOUSE_CLOSED','TRAINER_SHOW','TRAINER_UPDATE','TRAINER_CLOSED','MERCHANT_SHOW'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            store()
            if event=='TRAINER_SHOW' or event=='TRAINER_UPDATE' then pcall(readTrainer) elseif event=='TRAINER_CLOSED' then request() end
            if event=='MERCHANT_SHOW' then pcall(readMerchantMounts);pcall(readMerchantGoods) end
            if event=='PLAYER_LOGIN' then bankOpen=false;mailOpen=false end
            if event=='PLAYER_MONEY' then request()
            elseif event=='PLAYER_LOGIN' or event=='UPDATE_FACTION' then
                local ok,seen=pcall(readFactions)
                if ok and seen then
                    if type(BackstageForeverRequestReputationCapture)=='function' then
                        local copied,snapshot=pcall(reputationSnapshot,db)
                        if copied then pcall(BackstageForeverRequestReputationCapture,snapshot) end
                    elseif event=='UPDATE_FACTION' then request() end
                end
            elseif event=='BANKFRAME_OPENED' then bankOpen=true;pcall(readBank);request()
            elseif event=='BANKFRAME_CLOSED' then bankOpen=false;request()
            elseif event=='PLAYERBANKSLOTS_CHANGED' or event=='BAG_UPDATE' then if bankOpen then pcall(readBank) end
            elseif event=='MAIL_SHOW' then mailOpen=true
            elseif event=='MAIL_INBOX_UPDATE' then if mailOpen then pcall(readMail);request() end
            elseif event=='MAIL_CLOSED' then mailOpen=false;request()
            elseif event=='AUCTION_ITEM_LIST_UPDATE' then pcall(readAuctions)
            elseif event=='AUCTION_HOUSE_CLOSED' then request() end
        end)
    end
end

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
local LIMITS={items=400,slots=600,letters=100,prices=1500,history=5,factions=120,page=200}
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
    if type(add)=='function' then pcall(add,chat,'Backstage Forever: '..message) end
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
local function readFactions()
    local n=int(call(GetNumFactions),0,1000)
    if not n then return end
    local d=store();local seen=false
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
                if known or count<LIMITS.factions then d.reputations[id]={id=id,name=name,standing=standing,min=lo,max=hi,value=value};seen=true end
            end
        end
    end
    if seen then d.reputationsAt=now() end
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

local function copyItems(items)
    local out={}
    for _,e in ipairs(type(items)=='table' and items or {}) do
        if type(e)=='table' and int(e.id,1,2147483647) and int(e.n,1,1000000) then out[#out+1]={id=e.id,n=e.n,q=int(e.q,0,7),name=str(e.name,100)} end
        if #out>=LIMITS.items then break end
    end
    return out
end
-- Export block. BackstageForever.lua marks the lists as JSON arrays.
function BackstageForeverLedgerSnapshot()
    local d=store();local t=now()
    if not t then return nil end
    local out={schemaVersion=1}
    local money=int(call(GetMoney),0,MONEY_MAX)
    if money then out.money=money;out.moneyAt=t;d.money=money;d.moneyAt=t
    elseif int(d.money,0,MONEY_MAX) then out.money=d.money;out.moneyAt=d.moneyAt end
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
    local factions={}
    for _,f in pairs(d.reputations) do if type(f)=='table' then factions[#factions+1]={id=f.id,name=f.name,standing=f.standing,min=f.min,max=f.max,value=f.value} end end
    table.sort(factions,function(a,b)return a.id<b.id end)
    if #factions>0 then out.reputations={seenAt=int(d.reputationsAt,0,253402300799) or t,factions=factions} end
    out.cooldowns=cooldowns()
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
function BackstageForeverLedgerCommand(message)
    local d=store()
    local word,arg=(type(message)=='string' and message:lower() or ''):match('^(%a+)%s*(%a*)')
    if word=='prices' then
        if arg=='on' then d.pricesOn=true elseif arg=='off' then d.pricesOn=false
        elseif arg=='' or arg=='status' then
            say(('Price memory is %s: %d item prices remembered from Auction House pages you opened.'):format(d.pricesOn and 'on' or 'off',priceCount(d)))
            return d.pricesOn
        else say('Use /bf prices on, /bf prices off or /bf prices status.');return end
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
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_MONEY','UPDATE_FACTION','BANKFRAME_OPENED','BANKFRAME_CLOSED','PLAYERBANKSLOTS_CHANGED','BAG_UPDATE','MAIL_SHOW','MAIL_INBOX_UPDATE','MAIL_CLOSED','AUCTION_ITEM_LIST_UPDATE','AUCTION_HOUSE_CLOSED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            store()
            if event=='PLAYER_LOGIN' then bankOpen=false;mailOpen=false;pcall(readFactions)
            elseif event=='PLAYER_MONEY' then request()
            elseif event=='UPDATE_FACTION' then pcall(readFactions)
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

-- One-window bags (roadmap "One addon instead of ten"). Off until you switch it on.
--   /bf bag            every bag in one painted window: search as you type, categories, a glow on
--                      items that are new since you last closed it, free slots, and the same marks
--                      /bf bags uses (+ upgrade, * wish, ! quest item) plus ~ for junk
--   /bf bag bank       the bank as the Ledger last saw it, when you are not standing at it
--   /bf bag junk       a list of the grey items in your bags and what a vendor pays; you sell them
--   /bf bag sort WORD  category, bag, name or quality. Sorting changes the VIEW only.
-- A window to find and look, not to use: it is the addon's own frame with plain buttons. Nothing is
-- used, moved, sold, split or deleted, and the game's bag windows are neither replaced nor opened by
-- the addon. A click names the bag and slot and, when that bag is open, flashes the real slot.
local floor,min,max=math.floor,math.min,math.max
local unpackAll=unpack or table.unpack
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,10 do r[i]=plain(r[i]) end
    return unpackAll(r,2,10)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function T(s)
    local tr=BackstageForeverTr
    if type(tr)~='function' then return s end
    local ok,r=pcall(tr,s)
    return ok and type(r)=='string' and r or s
end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local function line(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,m) end
end
local function combat() return call(InCombatLockdown)~=false end
local function whole(v,lo,hi) return type(v)=='number' and v==v and v>=lo and v<=hi and floor(v)==v end

-- ---------------------------------------------------------------- pure: what an item is
-- An item here is {bag=,slot=,id=,name=,count=,quality=,classId=,subId=,type=,subType=,equip=,quest=,price=,icon=}.
-- Item classes as the game numbers them.
local CLASS_CONSUMABLE,CLASS_WEAPON,CLASS_ARMOR,CLASS_TRADE,CLASS_RECIPE,CLASS_QUEST=0,2,4,7,9,12
-- Trade goods the game files under a craft, and recipes by the craft that learns them.
local TRADE_CRAFT={[1]='Engineering',[2]='Engineering',[3]='Engineering',[4]='Jewelcrafting',[5]='Tailoring',[6]='Leatherworking',
    [7]='Mining and smithing',[8]='Cooking',[9]='Herbs and alchemy',[12]='Enchanting',[16]='Inscription'}
local RECIPE_CRAFT={[1]='Leatherworking',[2]='Tailoring',[3]='Engineering',[4]='Blacksmithing',[5]='Cooking',[6]='Alchemy',
    [7]='First Aid',[8]='Enchanting',[9]='Fishing',[10]='Jewelcrafting',[11]='Inscription'}
local ORDER={equipment=1,consumable=2,trade=3,quest=4,junk=5,other=6}
local TITLE={equipment='Equipment',consumable='Consumables',trade='Trade goods',quest='Quest items',junk='Junk',other='Other'}
BackstageForeverBagCategories=ORDER
-- Pure: which of your own recipes use an item. workshop: the capture's readiness.workshop.
-- -> {[itemId]=profession name}. An item two professions use keeps the first by name.
function BackstageForeverBagReagents(workshop)
    local out,names={},{}
    if type(workshop)~='table' then return out end
    local professions=type(workshop.professions)=='table' and (workshop.professions.items or workshop.professions) or {}
    for _,p in ipairs(type(professions)=='table' and professions or {}) do
        if type(p)=='table' and type(p.skillLineId)=='number' and type(p.name)=='string' and p.name~='' and #p.name<=40 then names[p.skillLineId]=(p.name:gsub('|','')) end
    end
    local recipes=type(workshop.recipes)=='table' and (workshop.recipes.items or workshop.recipes) or {}
    for _,recipe in ipairs(type(recipes)=='table' and recipes or {}) do
        local craft=type(recipe)=='table' and names[recipe.skillLineId]
        if craft then
            for _,r in ipairs(type(recipe.reagents)=='table' and recipe.reagents or {}) do
                local id=type(r)=='table' and r.itemId
                if whole(id,1,2147483647) and (not out[id] or craft<out[id]) then out[id]=craft end
            end
        end
    end
    return out
end
-- Pure: junk is a grey item that is not a quest item.
function BackstageForeverBagIsJunk(item)
    return type(item)=='table' and item.quality==0 and item.quest~=true and item.classId~=CLASS_QUEST
end
-- Pure: the category of an item, and for trade goods the craft it belongs to (or nil).
-- reagentOf: {[itemId]=profession name} from your own recipes, checked first.
function BackstageForeverBagCategory(item,reagentOf)
    if type(item)~='table' then return 'other' end
    if item.quest==true or item.classId==CLASS_QUEST then return 'quest' end
    if BackstageForeverBagIsJunk(item) then return 'junk' end
    if (item.classId==CLASS_WEAPON or item.classId==CLASS_ARMOR) and type(item.equip)=='string' and item.equip~='' then return 'equipment' end
    if type(item.equip)=='string' and item.equip~='' and item.equip~='INVTYPE_BAG' and item.equip~='INVTYPE_QUIVER' and item.equip~='INVTYPE_AMMO' and item.classId==nil then return 'equipment' end
    local mine=type(reagentOf)=='table' and reagentOf[item.id]
    if type(mine)=='string' then return 'trade',mine end
    if item.classId==CLASS_TRADE then
        local craft=TRADE_CRAFT[item.subId]
        if craft then return 'trade',T(craft) end
        -- No craft known for it: the game's own name for the kind of material, when it says more than "Trade Goods".
        if type(item.subType)=='string' and item.subType~='' and item.subType~=item.type and #item.subType<=40 then return 'trade',item.subType end
        return 'trade'
    end
    if item.classId==CLASS_RECIPE then
        local craft=RECIPE_CRAFT[item.subId]
        return 'trade',craft and T(craft) or nil
    end
    if item.classId==CLASS_CONSUMABLE then return 'consumable' end
    return 'other'
end
-- Pure: the marks an item carries. wished/better: sets of item ids from the desktop app.
function BackstageForeverBagMarkOf(item,wished,better)
    if type(item)~='table' then return {} end
    return {upgrade=type(better)=='table' and better[item.id]==true or nil,wish=type(wished)=='table' and wished[item.id]==true or nil,
        quest=(item.quest==true or item.classId==CLASS_QUEST) or nil,junk=BackstageForeverBagIsJunk(item) or nil}
end
-- Pure: the sign on a cell: the same characters as the marks on the game's bag buttons, and ~ for junk.
function BackstageForeverBagCellSign(mark)
    if type(mark)~='table' then return '' end
    local sign=type(BackstageForeverBagSign)=='function' and BackstageForeverBagSign(mark)
        or ((mark.upgrade and '|cff40ff40+|r' or '')..(mark.wish and '|cffffd100*|r' or '')..(mark.quest and '|cffffff00!|r' or ''))
    return sign..(mark.junk and '|cff9d9d9d~|r' or '')
end

-- ---------------------------------------------------------------- pure: search
local QUALITY={[0]={'poor','grey','gray'},[1]={'common','white'},[2]={'uncommon','green'},[3]={'rare','blue'},[4]={'epic','purple'},[5]={'legendary','orange'}}
local MARK_WORDS={upgrade='upgrade',upgrades='upgrade',wish='wish',wishes='wish',quest='quest',junk='junk',new='new'}
local CATEGORY_WORDS={equipment='equipment',gear='equipment',consumable='consumable',consumables='consumable',trade='trade',other='other'}
local QUERY_MAX,TOKEN_MAX,TOKENS_MAX=60,30,6
-- Pure: the words of what you typed, lower case, at most six. Never a pattern: they are compared as plain text.
function BackstageForeverBagTokens(query)
    local out={}
    if type(query)~='string' then return out end
    query=query:sub(1,QUERY_MAX):gsub('|',''):gsub('%c',' '):lower()
    for word in query:gmatch('%S+') do
        if #out<TOKENS_MAX then out[#out+1]=word:sub(1,TOKEN_MAX) end
    end
    return out
end
local function has(text,token) return type(text)=='string' and text:lower():find(token,1,true)~=nil end
local function wordIs(token,english) return token==english or token==T(english):lower() end
-- Pure: does an item match every word? ctx = {mark=,category=,craft=,new=}. A word matches the
-- name, the game's type or kind, the quality by name or colour, a mark (upgrade, wish, quest,
-- junk, new) or a category. Mark, quality and category words also work in the game's language.
function BackstageForeverBagMatch(item,tokens,ctx)
    if type(item)~='table' then return false end
    ctx=type(ctx)=='table' and ctx or {}
    local mark=type(ctx.mark)=='table' and ctx.mark or {}
    for _,token in ipairs(type(tokens)=='table' and tokens or {}) do
        -- A mark word means the mark and nothing else: "junk" is not every item the game files under "Junk".
        local hit,markWord=false,false
        for word,key in pairs(MARK_WORDS) do
            if wordIs(token,word) then markWord=true;if (key=='new' and ctx.new==true) or mark[key]==true then hit=true end end
        end
        if not markWord then hit=has(item.name,token) or has(item.type,token) or has(item.subType,token) or has(ctx.craft,token) end
        if not hit and type(item.quality)=='number' then
            for _,word in ipairs(QUALITY[item.quality] or {}) do if wordIs(token,word) then hit=true end end
        end
        if not hit then
            for word,key in pairs(CATEGORY_WORDS) do if wordIs(token,word) and ctx.category==key then hit=true end end
        end
        if not hit then return false end
    end
    return true
end

-- ---------------------------------------------------------------- pure: new items
local SEEN_MAX=400
-- Pure: what the bags held, to compare with next time: {[itemId]=count}. Bounded.
function BackstageForeverBagSeen(items)
    local out,n={},0
    for _,item in ipairs(type(items)=='table' and items or {}) do
        if type(item)=='table' and whole(item.id,1,2147483647) then
            if out[item.id]==nil then
                if n<SEEN_MAX then n=n+1;out[item.id]=whole(item.count,1,1000000) and item.count or 1 end
            else out[item.id]=min(1000000,out[item.id]+(whole(item.count,1,1000000) and item.count or 1)) end
        end
    end
    return out
end
-- Pure: the item ids that are new, or grew, since the window was last closed. No saved list: nothing is new.
function BackstageForeverBagNew(items,seen)
    local out={}
    if type(seen)~='table' then return out end
    for id,count in pairs(BackstageForeverBagSeen(items)) do
        local before=seen[id]
        if type(before)~='number' or count>before then out[id]=true end
    end
    return out
end

-- ---------------------------------------------------------------- pure: the view
local SORTS={category=true,bag=true,name=true,quality=true}
BackstageForeverBagSorts=SORTS
local function byName(a,b)
    local x,y=(a.name or ''):lower(),(b.name or ''):lower()
    if x~=y then return x<y end
    if (a.bag or 0)~=(b.bag or 0) then return (a.bag or 0)<(b.bag or 0) end
    return (a.slot or 0)<(b.slot or 0)
end
local function byQuality(a,b)
    local x,y=a.quality or -1,b.quality or -1
    if x~=y then return x>y end
    return byName(a,b)
end
local function byBag(a,b)
    if (a.bag or 0)~=(b.bag or 0) then return (a.bag or 0)<(b.bag or 0) end
    if (a.slot or 0)~=(b.slot or 0) then return (a.slot or 0)<(b.slot or 0) end
    return (a.id or 0)<(b.id or 0)
end
-- Pure: the cells the window paints. opts = {query=,sort=,wished=,better=,seen=,reagentOf=}.
-- -> {cells={{kind='head',text=,count=} | {kind='item',item=,mark=,sign=,new=,category=}},shown=,total=}
-- The list is a copy: sorting it never touches the bags.
function BackstageForeverBagView(items,opts)
    opts=type(opts)=='table' and opts or {}
    local sort=SORTS[opts.sort] and opts.sort or 'category'
    local tokens=BackstageForeverBagTokens(opts.query)
    local fresh=BackstageForeverBagNew(items,opts.seen)
    local rows,total={},0
    for _,item in ipairs(type(items)=='table' and items or {}) do
        if type(item)=='table' and type(item.id)=='number' then
            total=total+1
            local category,craft=BackstageForeverBagCategory(item,opts.reagentOf)
            local mark=BackstageForeverBagMarkOf(item,opts.wished,opts.better)
            local isNew=fresh[item.id]==true
            if BackstageForeverBagMatch(item,tokens,{mark=mark,category=category,craft=craft,new=isNew}) then
                rows[#rows+1]={kind='item',item=item,mark=mark,sign=BackstageForeverBagCellSign(mark),new=isNew,category=category,craft=craft,
                    name=item.name,quality=item.quality,bag=item.bag,slot=item.slot,id=item.id}
            end
        end
    end
    local cells={}
    if sort~='category' then
        table.sort(rows,sort=='name' and byName or sort=='quality' and byQuality or byBag)
        for _,row in ipairs(rows) do cells[#cells+1]=row end
        return {cells=cells,shown=#rows,total=total,sort=sort}
    end
    local groups,at={},{}
    for _,row in ipairs(rows) do
        local key=row.category..'\n'..(row.craft or '')
        local group=at[key]
        if not group then
            group={category=row.category,craft=row.craft,rows={}};at[key]=group;groups[#groups+1]=group
        end
        group.rows[#group.rows+1]=row
    end
    table.sort(groups,function(a,b)
        if ORDER[a.category]~=ORDER[b.category] then return ORDER[a.category]<ORDER[b.category] end
        -- Trade goods with no craft known come after the named ones.
        if (a.craft==nil)~=(b.craft==nil) then return a.craft~=nil end
        return (a.craft or '')<(b.craft or '')
    end)
    for _,group in ipairs(groups) do
        table.sort(group.rows,byQuality)
        local text=T(TITLE[group.category])
        if group.craft then text=text..': '..group.craft end
        cells[#cells+1]={kind='head',text=text,count=#group.rows}
        for _,row in ipairs(group.rows) do cells[#cells+1]=row end
    end
    return {cells=cells,shown=#rows,total=total,sort=sort}
end
-- Fixed sizes: ten cells to a row, a heading takes a row of its own.
local COLS,CELL,STEP,HEAD=10,34,37,18
-- Pure: where each cell sits inside the list, from its top-left corner, and how tall the list is.
-- -> places {{x=,y=} per cell}, height
function BackstageForeverBagLayout(cells,cols)
    cols=whole(cols,1,40) and cols or COLS
    local places,y,col={},0,0
    for i,cell in ipairs(type(cells)=='table' and cells or {}) do
        if cell.kind=='head' then
            if col>0 then y=y+STEP;col=0 end
            places[i]={x=0,y=-y};y=y+HEAD
        else
            if col>=cols then y=y+STEP;col=0 end
            places[i]={x=col*STEP,y=-y};col=col+1
        end
    end
    if col>0 then y=y+STEP end
    return places,y
end

-- ---------------------------------------------------------------- pure: free slots, money, junk, bank
-- Pure: counts = {{slots=,used=},...} -> free, total.
function BackstageForeverBagFree(counts)
    local free,total=0,0
    for _,c in ipairs(type(counts)=='table' and counts or {}) do
        if type(c)=='table' and whole(c.slots,0,1000) and whole(c.used,0,1000) and c.used<=c.slots then free=free+c.slots-c.used;total=total+c.slots end
    end
    return free,total
end
-- Pure: "1g 20s 5c".
function BackstageForeverBagMoney(copper)
    if not whole(copper,0,1e13) then return nil end
    local g,s,c=floor(copper/10000),floor(copper/100)%100,copper%100
    local parts={}
    if g>0 then parts[#parts+1]=g..'g' end
    if s>0 then parts[#parts+1]=s..'s' end
    if c>0 or #parts==0 then parts[#parts+1]=c..'c' end
    return table.concat(parts,' ')
end
local JUNK_LINES=12
-- Pure: the chat lines of the junk list. Text only: the player sells. atMerchant picks the closing line.
function BackstageForeverBagJunkLines(items,atMerchant)
    if type(items)~='table' then return {T('Your bags are not readable in this game client.')} end
    local rows,byId,total,count={},{},0,0
    for _,item in ipairs(items) do
        if BackstageForeverBagIsJunk(item) and type(item.id)=='number' then
            local n=whole(item.count,1,1000000) and item.count or 1
            local row=byId[item.id]
            if not row then row={id=item.id,name=type(item.name)=='string' and item.name or (T('Item')..' #'..item.id),n=0,price=whole(item.price,1,1e9) and item.price or nil};byId[item.id]=row;rows[#rows+1]=row end
            row.n=row.n+n;count=count+n
            if row.price then total=total+row.price*n end
        end
    end
    if #rows==0 then return {T('No junk in your bags.')} end
    table.sort(rows,function(a,b)
        local x,y=(a.price or 0)*a.n,(b.price or 0)*b.n
        if x~=y then return x>y end
        return a.name<b.name
    end)
    local lines={T('Junk in your bags: %d, worth %s at a vendor.'):format(count,BackstageForeverBagMoney(total) or '0c')}
    for i=1,min(#rows,JUNK_LINES) do
        local row=rows[i]
        lines[#lines+1]=('  %s x%d: %s'):format(row.name,row.n,row.price and BackstageForeverBagMoney(row.price*row.n) or T('no vendor price'))
    end
    if #rows>JUNK_LINES then lines[#lines+1]=('  +%d %s'):format(#rows-JUNK_LINES,T('more')) end
    lines[#lines+1]=T(atMerchant and 'Sell them yourself: right-click each in your bags. Nothing is sold for you.' or 'A list only. Nothing is sold for you.')
    return lines
end
-- Pure: "just now", "25 min ago", "3 h ago", "2 days ago".
function BackstageForeverBagAgo(seconds)
    if type(seconds)~='number' or seconds~=seconds or seconds<0 then return T('at an unknown time') end
    if seconds<120 then return T('just now') end
    if seconds<7200 then return T('%d min ago'):format(floor(seconds/60)) end
    if seconds<172800 then return T('%d h ago'):format(floor(seconds/3600)) end
    return T('%d days ago'):format(floor(seconds/86400))
end
local BANK_MAX=240 -- as many cells as the window has
-- Pure: the bank as the Ledger saved it. bank = {seenAt=,complete=,items={{id=,n=,q=,name=}}}.
-- info(id) may add what the game knows about an item. -> items, headline; or nil, why.
function BackstageForeverBagBank(bank,now,info)
    if type(bank)~='table' or type(bank.items)~='table' then return nil,T('The bank has not been seen yet. Open your bank once, then try again.') end
    local items={}
    for _,e in ipairs(bank.items) do
        if #items<BANK_MAX and type(e)=='table' and whole(e.id,1,2147483647) then
            local item={id=e.id,count=whole(e.n,1,1000000) and e.n or 1,quality=whole(e.q,0,7) and e.q or nil,
                name=type(e.name)=='string' and e.name~='' and #e.name<=100 and (e.name:gsub('|','')) or nil,bank=true}
            local more=type(info)=='function' and info(e.id)
            if type(more)=='table' then
                for _,k in ipairs({'name','quality','classId','subId','type','subType','equip','price','icon'}) do if item[k]==nil then item[k]=more[k] end end
            end
            item.name=item.name or (T('Item')..' #'..e.id)
            items[#items+1]=item
        end
    end
    local age=type(now)=='number' and type(bank.seenAt)=='number' and now>=bank.seenAt and now-bank.seenAt or nil
    local head=T('Bank as last seen %s'):format(BackstageForeverBagAgo(age))
    if bank.complete==false or #bank.items>BANK_MAX then head=head..' '..T('(not all of it)') end
    return items,head
end

-- ---------------------------------------------------------------- switches
function BackstageForeverBagEnabled()
    local s=BackstageForeverBagSettings
    return type(s)=='table' and rawget(s,'enabled')==true
end
local function settings()
    if type(BackstageForeverBagSettings)~='table' then BackstageForeverBagSettings={} end
    return BackstageForeverBagSettings
end
function BackstageForeverBagSort()
    local s=BackstageForeverBagSettings
    local v=type(s)=='table' and rawget(s,'sort')
    return SORTS[v] and v or 'category'
end

-- ---------------------------------------------------------------- reading the game (never in combat)
local latest=nil
function BackstageForeverBagUpdate(character) latest=type(character)=='table' and character or nil end
-- What the game knows about an item, or nil while it is still loading it.
local function itemInfo(id)
    local fn=plain(GetItemInfo) or field(plain(C_Item),'GetItemInfo')
    if type(fn)~='function' then return nil end
    local r={pcall(fn,id)}
    if not r[1] then return nil end
    for i=2,14 do r[i]=plain(r[i]) end
    local name=r[2]
    if type(name)~='string' or name=='' then
        call(field(plain(C_Item),'RequestLoadItemDataByID'),id)
        return nil
    end
    return {name=#name<=100 and (name:gsub('|','')) or nil,quality=whole(r[4],0,7) and r[4] or nil,type=type(r[7])=='string' and r[7] or nil,
        subType=type(r[8])=='string' and r[8] or nil,equip=type(r[10])=='string' and r[10] or nil,icon=r[11],
        price=whole(r[12],1,1e9) and r[12] or nil,classId=whole(r[13],0,100) and r[13] or nil,subId=whole(r[14],0,100) and r[14] or nil}
end
local function slotCount(bag)
    local n=call(field(plain(C_Container),'GetContainerNumSlots'),bag)
    if type(n)~='number' then n=call(GetContainerNumSlots,bag) end
    return whole(n,0,200) and n or nil
end
local function questSlot(bag,slot)
    local info=call(field(plain(C_Container),'GetContainerItemQuestInfo'),bag,slot)
    if type(info)=='table' then return field(info,'isQuestItem')==true or type(field(info,'questID'))=='number' end
    local isQuest,questId=call(GetContainerItemQuestInfo,bag,slot)
    return isQuest==true or type(questId)=='number'
end
-- One slot: id, count, quality, icon. Both shapes of the game's bag reading are understood.
local function slotItem(bag,slot)
    local info=call(field(plain(C_Container),'GetContainerItemInfo'),bag,slot)
    if type(info)=='table' then
        return field(info,'itemID'),field(info,'stackCount'),field(info,'quality'),field(info,'iconFileID')
    end
    local fn=plain(GetContainerItemInfo)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,bag,slot)}
    if not r[1] then return nil end
    for i=2,11 do r[i]=plain(r[i]) end
    return r[11],r[3],r[5],r[2]
end
-- Every item in your bags and the size of each bag, or nil when the game gives no bag sizes.
local function readBags()
    local items,counts={},{}
    for bag=0,4 do
        local slots=slotCount(bag)
        if slots then
            local used=0
            for slot=1,slots do
                local id,count,quality,icon=slotItem(bag,slot)
                if whole(id,1,2147483647) then
                    used=used+1
                    local item=itemInfo(id) or {}
                    item.bag,item.slot,item.id=bag,slot,id
                    item.count=whole(count,1,1000000) and count or 1
                    if whole(quality,0,7) then item.quality=quality end
                    item.icon=icon or item.icon
                    item.name=item.name or (T('Item')..' #'..id)
                    item.quest=questSlot(bag,slot) or nil
                    items[#items+1]=item
                end
            end
            counts[#counts+1]={slots=slots,used=used}
        end
    end
    if #counts==0 then return nil end
    return items,counts
end
local function handed()
    local name,realm=call(UnitName,'player'),call(GetRealmName)
    if type(name)~='string' or type(realm)~='string' then return {},{} end
    return type(BackstageForeverWishSet)=='function' and BackstageForeverWishSet(name,realm) or {},
        type(BackstageForeverUpgradeSet)=='function' and BackstageForeverUpgradeSet(name,realm) or {}
end
local function reagents()
    local workshop=latest and type(latest.readiness)=='table' and latest.readiness.workshop
    local ok,map=pcall(BackstageForeverBagReagents,workshop)
    return ok and map or {}
end
local function clock()
    local t=call(time)
    return type(t)=='number' and t or nil
end

-- ---------------------------------------------------------------- the window
local WIDTH,HEIGHT,INSET=COLS*STEP-(STEP-CELL)+32,430,16
local VIEW_TOP,VIEW_BOTTOM=-64,46
local MAX_CELLS,MAX_HEADS=240,24
local QUALITY_RGB={[0]={.62,.62,.62},[1]={1,1,1},[2]={.12,1,0},[3]={0,.44,.87},[4]={.64,.21,.93},[5]={1,.5,0}}
local frame,flash=nil,nil
local mode,merchant='bags',false -- mode: 'bags' or 'bank'
local shownItems=nil
local function bagWord(bag) return bag==0 and T('Backpack') or (T('Bag')..' '..bag) end
-- The game's own button for a slot, when that bag window is open. Read only.
local function realButton(bag,slot)
    local frames={}
    for i=1,13 do local f=plain(_G['ContainerFrame'..i]);if f then frames[#frames+1]=f end end
    local combined=plain(_G.ContainerFrameCombinedBags);if combined then frames[#frames+1]=combined end
    for _,f in ipairs(frames) do
        if call(field(f,'IsShown'),f)==true then
            local each=field(f,'EnumerateValidItems')
            if type(each)=='function' then
                local ok,iter,state,first=pcall(each,f)
                if ok and type(iter)=='function' then
                    for _,button in iter,state,first do
                        if call(field(button,'GetBagID'),button)==bag and call(field(button,'GetID'),button)==slot then return button end
                    end
                end
            elseif call(field(f,'GetID'),f)==bag then
                local name,size=call(field(f,'GetName'),f),field(f,'size')
                for i=1,min(type(size)=='number' and size or 0,40) do
                    local button=type(name)=='string' and plain(_G[name..'Item'..i])
                    if button and call(field(button,'GetID'),button)==slot then return button end
                end
            end
        end
    end
end
-- A click: say where the item is, and flash the real slot with our own frame when its bag is open.
local function reveal(item)
    if combat() then return say('The bag window waits until you leave combat.') end
    if item.bank then return say(('In your bank: %s.'):format(item.name)) end
    local button=realButton(item.bag,item.slot)
    if not button then return say(('%s is in %s, slot %d. Open that bag to use it.'):format(item.name,bagWord(item.bag),item.slot)) end
    if not flash and type(CreateFrame)=='function' then
        flash=CreateFrame('Frame',nil,UIParent)
        flash:SetFrameStrata('HIGH')
        local glow=flash:CreateTexture(nil,'OVERLAY');glow:SetAllPoints();glow:SetColorTexture(1,.82,.2,.55)
        pcall(glow.SetBlendMode,glow,'ADD')
    end
    if flash and pcall(flash.SetAllPoints,flash,button) then
        flash:Show()
        local after=field(plain(C_Timer),'After')
        if type(after)=='function' then pcall(after,2.5,function() pcall(flash.Hide,flash) end) end
    end
    say(('%s is in %s, slot %d. It is lit up in your bag.'):format(item.name,bagWord(item.bag),item.slot))
end
local function cellEnter(self)
    local item=self.item
    if not item or type(GameTooltip)~='table' then return end
    pcall(GameTooltip.SetOwner,GameTooltip,self,'ANCHOR_RIGHT')
    if item.bank or not pcall(GameTooltip.SetBagItem,GameTooltip,item.bag,item.slot) then pcall(GameTooltip.SetHyperlink,GameTooltip,'item:'..item.id) end
    if not item.bank then pcall(GameTooltip.AddLine,GameTooltip,T('Click: where it is in your bags.'),1,.82,.3,true) end
    pcall(GameTooltip.Show,GameTooltip)
end
local function paint()
    if not frame then return end
    local now=clock()
    local items,counts,head
    if mode=='bank' then
        local db=BackstageForeverLedgerDB
        items,head=BackstageForeverBagBank(type(db)=='table' and rawget(db,'bank') or nil,now,itemInfo)
    else items,counts=readBags() end
    shownItems=mode=='bags' and items or shownItems
    local wished,better=handed()
    local s=settings()
    local view=BackstageForeverBagView(items or {},{query=frame.search:GetText(),sort=BackstageForeverBagSort(),wished=wished,better=better,
        seen=mode=='bags' and rawget(s,'seen') or nil,reagentOf=reagents()})
    local places,height=BackstageForeverBagLayout(view.cells,COLS)
    local cellAt,headAt=0,0
    for i,cell in ipairs(view.cells) do
        local place=places[i]
        if cell.kind=='head' then
            headAt=headAt+1
            local h=frame.heads[headAt]
            if h then
                h:ClearAllPoints();h:SetPoint('TOPLEFT',frame.content,'TOPLEFT',place.x,place.y)
                h:SetText(('|cffffd100%s|r |cff9d9d9d(%d)|r'):format(cell.text,cell.count));h:Show()
            end
        else
            cellAt=cellAt+1
            local b=frame.cells[cellAt]
            if b then
                local item=cell.item
                b:ClearAllPoints();b:SetPoint('TOPLEFT',frame.content,'TOPLEFT',place.x,place.y)
                b.item=item
                b.icon:SetTexture(item.icon or 'Interface\\Icons\\INV_Misc_QuestionMark')
                local rgb=QUALITY_RGB[item.quality] or QUALITY_RGB[1]
                b.edge:SetColorTexture(rgb[1],rgb[2],rgb[3],item.quality and item.quality>=2 and .9 or .35)
                b.count:SetText(item.count and item.count>1 and tostring(item.count) or '')
                b.sign:SetText(cell.sign or '')
                if cell.new then b.glow:Show() else b.glow:Hide() end
                b:Show()
            end
        end
    end
    for i=cellAt+1,#frame.cells do frame.cells[i].item=nil;frame.cells[i]:Hide() end
    for i=headAt+1,#frame.heads do frame.heads[i]:Hide() end
    frame.content:SetHeight(max(1,height))
    local viewHeight=HEIGHT+VIEW_TOP-VIEW_BOTTOM
    frame.maxScroll=max(0,height-viewHeight)
    if (frame.scrollAt or 0)>frame.maxScroll then frame.scrollAt=frame.maxScroll end
    pcall(frame.scroll.SetVerticalScroll,frame.scroll,frame.scrollAt or 0)
    if mode=='bank' then
        frame.title:SetText(T('Bank'))
        frame.free:SetText(head or '')
    else
        frame.title:SetText(T('Bags'))
        local free,total=BackstageForeverBagFree(counts)
        frame.free:SetText(counts and T('Free: %d of %d'):format(free,total) or T('Your bags are not readable in this game client.'))
    end
    local note=''
    if view.shown<view.total then note=T('%d of %d shown'):format(view.shown,view.total)
    elseif frame.maxScroll>0 then note=T('Scroll for more') end
    frame.note:SetText(note)
    frame.sortButton:SetText(T('Sort')..': '..T(({category='Category',bag='Bag',name='Name',quality='Quality'})[BackstageForeverBagSort()]))
    frame.bankButton:SetText(T(mode=='bank' and 'Bags' or 'Bank'))
end
local function fitButton(button,width)
    local text=call(field(button,'GetFontString'),button)
    if text then pcall(text.SetWidth,text,width-12);pcall(text.SetWordWrap,text,false) end
end
local function build()
    if frame or type(CreateFrame)~='function' or not UIParent then return frame end
    local f=CreateFrame('Frame','BackstageForeverBagFrame',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    local x,y=type(BackstageForeverPanelPlace)=='function' and BackstageForeverPanelPlace(BackstageForeverBagSettings,'bag')
    if x then f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',x,y) else f:SetPoint('RIGHT',UIParent,'RIGHT',-120,0) end
    f:SetFrameStrata('MEDIUM');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton')
    f:SetScript('OnDragStart',function() if not combat() then f:StartMoving() end end)
    f:SetScript('OnDragStop',function()
        f:StopMovingOrSizing()
        local left,top=call(f.GetLeft,f),call(f.GetTop,f)
        if type(left)=='number' and type(top)=='number' and left>=0 and top>=0 and left<1e7 and top<1e7 then
            f:ClearAllPoints();f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',left,top)
            local s=settings()
            if type(s.pos)~='table' then s.pos={} end
            s.pos.bag={x=left,y=top}
        end
    end)
    -- The same painted leather-and-brass frame as the Instance Atlas and the lists.
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    f.title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    f.title:SetPoint('TOPLEFT',INSET,-12);f.title:SetWidth(90);f.title:SetJustifyH('LEFT');f.title:SetWordWrap(false)
    f.free=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    f.free:SetPoint('TOPRIGHT',-32,-14);f.free:SetWidth(WIDTH-INSET-32-96);f.free:SetJustifyH('RIGHT');f.free:SetWordWrap(false)
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide() end)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,-30)
    -- Search as you type. A plain edit box of our own; Escape leaves it.
    local label=f:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    label:SetPoint('TOPLEFT',INSET,-41);label:SetWidth(52);label:SetJustifyH('LEFT');label:SetWordWrap(false);label:SetText(T('Find'))
    local box=CreateFrame('EditBox',nil,f)
    box:SetSize(150,18);box:SetPoint('TOPLEFT',INSET+56,-38)
    pcall(box.SetFontObject,box,'GameFontHighlightSmall');pcall(box.SetAutoFocus,box,false);pcall(box.SetMaxLetters,box,QUERY_MAX)
    local boxBack=box:CreateTexture(nil,'BACKGROUND');boxBack:SetPoint('TOPLEFT',-4,2);boxBack:SetPoint('BOTTOMRIGHT',4,-2);boxBack:SetColorTexture(0,0,0,.5)
    box:SetScript('OnEscapePressed',function(self) pcall(self.ClearFocus,self) end)
    box:SetScript('OnEnterPressed',function(self) pcall(self.ClearFocus,self) end)
    box:SetScript('OnTextChanged',function() f.scrollAt=0;pcall(paint) end)
    f.search=box
    f.note=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    f.note:SetPoint('TOPRIGHT',-INSET,-41);f.note:SetWidth(WIDTH-INSET*2-56-150-14);f.note:SetJustifyH('RIGHT');f.note:SetWordWrap(false)
    -- The list scrolls inside a fixed viewport; the mouse wheel moves it.
    local scroll=CreateFrame('ScrollFrame',nil,f)
    scroll:SetPoint('TOPLEFT',INSET,VIEW_TOP);scroll:SetPoint('BOTTOMRIGHT',-INSET,VIEW_BOTTOM)
    local content=CreateFrame('Frame',nil,scroll)
    content:SetSize(WIDTH-INSET*2,1)
    pcall(scroll.SetScrollChild,scroll,content)
    pcall(scroll.EnableMouseWheel,scroll,true)
    scroll:SetScript('OnMouseWheel',function(_,delta)
        f.scrollAt=max(0,min(f.maxScroll or 0,(f.scrollAt or 0)-(delta or 0)*STEP*2))
        pcall(scroll.SetVerticalScroll,scroll,f.scrollAt)
    end)
    f.scroll,f.content,f.cells,f.heads=scroll,content,{},{}
    for i=1,MAX_CELLS do
        local b=CreateFrame('Button',nil,content)
        b:SetSize(CELL,CELL);b:Hide()
        b.edge=b:CreateTexture(nil,'BACKGROUND');b.edge:SetAllPoints()
        b.icon=b:CreateTexture(nil,'ARTWORK');b.icon:SetPoint('TOPLEFT',2,-2);b.icon:SetPoint('BOTTOMRIGHT',-2,2)
        pcall(b.icon.SetTexCoord,b.icon,.07,.93,.07,.93)
        b.glow=b:CreateTexture(nil,'OVERLAY');b.glow:SetAllPoints();b.glow:SetColorTexture(1,.82,.2,.38);pcall(b.glow.SetBlendMode,b.glow,'ADD');b.glow:Hide()
        local hover=b:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.18)
        b.count=b:CreateFontString(nil,'OVERLAY','NumberFontNormalSmall');b.count:SetPoint('BOTTOMRIGHT',-2,2);b.count:SetWidth(CELL-4);b.count:SetJustifyH('RIGHT');b.count:SetWordWrap(false)
        b.sign=b:CreateFontString(nil,'OVERLAY','NumberFontNormalSmall');b.sign:SetPoint('TOPLEFT',2,-2);b.sign:SetWidth(CELL-4);b.sign:SetJustifyH('LEFT');b.sign:SetWordWrap(false)
        b:SetScript('OnClick',function(self) if self.item then pcall(reveal,self.item) end end)
        b:SetScript('OnEnter',function(self) pcall(cellEnter,self) end)
        b:SetScript('OnLeave',function() if type(GameTooltip)=='table' then pcall(GameTooltip.Hide,GameTooltip) end end)
        f.cells[i]=b
    end
    for i=1,MAX_HEADS do
        local h=content:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
        h:SetWidth(WIDTH-INSET*2);h:SetHeight(HEAD);h:SetJustifyH('LEFT');h:SetWordWrap(false);h:Hide()
        f.heads[i]=h
    end
    local rule2=f:CreateTexture(nil,'OVERLAY');rule2:SetColorTexture(.79,.62,.27,.5)
    rule2:SetSize(WIDTH-INSET*2,1);rule2:SetPoint('BOTTOMLEFT',INSET,VIEW_BOTTOM-4)
    local function footer(x,width,onClick)
        local button=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        button:SetSize(width,22);button:SetPoint('BOTTOMLEFT',x,14);fitButton(button,width)
        button:SetScript('OnClick',function() if combat() then return end pcall(onClick) end)
        return button
    end
    f.sortButton=footer(INSET,136,function()
        local next={category='bag',bag='name',name='quality',quality='category'}
        settings().sort=next[BackstageForeverBagSort()];f.scrollAt=0;paint()
    end)
    f.bankButton=footer(INSET+142,100,function() mode=mode=='bank' and 'bags' or 'bank';f.scrollAt=0;paint() end)
    f.junkButton=footer(INSET+248,WIDTH-INSET*2-248,function() BackstageForeverBagCommand('bag junk') end)
    f.junkButton:SetText(T('Junk list'))
    -- Closing the window is when "new" starts over.
    f:SetScript('OnHide',function()
        if shownItems then settings().seen=BackstageForeverBagSeen(shownItems) end
        if flash then pcall(flash.Hide,flash) end
    end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverBagFrame') end
    frame=f
    return f
end
local function open(which)
    if combat() then say('The bag window waits until you leave combat.') return false end
    local ok,f=pcall(build)
    if not ok or not f then say('The bag window is not available in this game client. /bf bags lists marked items instead.') return false end
    mode=which or 'bags'
    f.scrollAt=0
    -- The first time ever there is nothing to compare with: nothing glows.
    if rawget(settings(),'seen')==nil then local items=readBags();if items then settings().seen=BackstageForeverBagSeen(items) end end
    paint();f:Show()
    return true
end
function BackstageForeverBagCommand(message)
    local arg,value=(type(message)=='string' and #message<=60 and message:lower() or ''):match('^bag%s*(%a*)%s*(%a*)')
    arg=arg or ''
    if arg=='off' then
        settings().enabled=false
        if frame then frame:Hide() end
        return say('One-window bags: off.')
    end
    if arg=='junk' then
        if combat() then return say('Try /bf bag junk outside combat.') end
        local lines=BackstageForeverBagJunkLines((readBags()),merchant)
        for i,l in ipairs(lines) do if i==1 then say(l) else line(l) end end
        return lines
    end
    if arg=='sort' then
        if not SORTS[value] then return say('Use /bf bag sort category, bag, name or quality. Sorting changes the view only; nothing is moved.') end
        settings().sort=value
        if frame and frame:IsShown() and not combat() then pcall(paint) end
        return say(('Bag window sorted by %s. Nothing in your bags was moved.'):format(value))
    end
    local was=BackstageForeverBagEnabled()
    if arg=='on' then
        settings().enabled=true
        return say('One-window bags: on. Type /bf bag to open the window. Your game bags work as before.')
    end
    if arg~='' and arg~='bank' then return say('Use /bf bag, /bf bag bank, /bf bag junk, /bf bag sort WORD, or /bf bag on or off.') end
    if arg=='' and frame and frame:IsShown() and mode=='bags' then frame:Hide() return false end
    if combat() then say('The bag window waits until you leave combat.') return false end
    settings().enabled=true
    if open(arg=='bank' and 'bank' or 'bags') and not was then
        say('One-window bags: on. A window to find and look: click an item to see where it is. Use items from your game bags.')
    end
    return true
end
BackstageForeverBagPaint=paint -- for tests

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'BAG_UPDATE_DELAYED','GET_ITEM_INFO_RECEIVED','PLAYER_REGEN_DISABLED','MERCHANT_SHOW','MERCHANT_CLOSED'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Bag',events) end
        local waiting=false
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_REGEN_DISABLED' then if frame then frame:Hide() end return end
            if event=='MERCHANT_CLOSED' then merchant=false return end
            if event=='MERCHANT_SHOW' then
                merchant=true
                -- One line at a vendor, only with the window switched on and only when there is junk.
                if BackstageForeverBagEnabled() and not combat() then
                    local items=readBags()
                    local lines=items and BackstageForeverBagJunkLines(items,true) or {}
                    if #lines>2 then say(lines[1]..' '..T('/bf bag junk lists them.')) end
                end
                return
            end
            if not frame or not frame:IsShown() or combat() then return end
            -- Item names arrive one by one: repaint once, a moment later.
            if event=='GET_ITEM_INFO_RECEIVED' then
                if waiting then return end
                local after=field(plain(C_Timer),'After')
                if type(after)~='function' then return end
                waiting=true
                pcall(after,.4,function() waiting=false;if frame and frame:IsShown() and not combat() then pcall(paint) end end)
                return
            end
            pcall(paint)
        end)
    end
end

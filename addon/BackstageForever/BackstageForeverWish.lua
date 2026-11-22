-- The wish list in game (1.24). The list itself is made in the desktop app (star an item in its
-- Instance Atlas) and arrives through BackstageForeverDesktop.lua at login or /reload.
--   a banner     "On your wish list: [item]" when you or someone in your group loots a wished item;
--                read from the loot line in chat, shown outside combat (it waits until combat ends)
--   /bf wish     your wishes and which boss was seen to drop each (Instance Atlas data)
--   /bf bags     items in your bags that are an upgrade, a wish or a quest item, with bag and slot
--   bag marks    the same as small signs on the bag buttons: + upgrade, * wish, ! quest item.
--                Off until you switch it on. Only our own text is added to a button, from a hook that
--                runs after the game has drawn the bag; no handler of the game is replaced.
-- Reading only: nothing is looted, rolled on, moved, used or sold.
local floor=math.floor
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
local function combat() return call(InCombatLockdown)~=false end
local function enabled(key) return type(BackstageForeverPanelEnabled)=='function' and BackstageForeverPanelEnabled(key)==true end
local function switch(key,arg) if type(BackstageForeverPanelSet)=='function' then return BackstageForeverPanelSet(key,arg) end end
-- A name from the game, safe to print: bounded, no colour or link codes.
local function clean(v,max)
    v=plain(v);if type(v)~='string' then return nil end
    v=v:gsub('|',''):gsub('%c',' ')
    if v=='' or #v>(max or 80) then return nil end
    return v
end

-- ---------------------------------------------------------------- G2 the loot line
-- Pure: the item in a chat line, by the id inside its link, so it works in every language.
-- -> id, name (the name as the link shows it, or nil).
function BackstageForeverLootItemId(text)
    if type(text)~='string' or #text>1000 then return nil end
    local id=text:match('|Hitem:(%d+)')
    id=id and #id<=10 and tonumber(id) or nil
    if not id or id<1 then return nil end
    local name=text:match('|Hitem:%d+.-|h%[(.-)%]|h')
    if name and (name=='' or #name>100 or name:find('|',1,true)) then name=nil end
    return id,name
end
-- Pure: one of the game's own loot sentences ("%s receives loot: %s.") as a pattern.
function BackstageForeverLootPattern(format)
    if type(format)~='string' or format=='' or #format>200 then return nil end
    local p=format:gsub('%%%d+%$','%%')
    p=p:gsub('[%^%$%(%)%.%[%]%*%+%-%?]','%%%0')
    p=p:gsub('%%s','(.+)'):gsub('%%d','(%%d+)')
    return '^'..p..'$'
end
-- Pure: who a loot line is about. formats = {self={sentences},other={sentences}} in the game's
-- language. -> 'self' | 'other',name | 'unknown' (no sentences to compare with) | nil (not a loot
-- line: a roll, a pass, a "won" line).
function BackstageForeverLootKind(text,formats)
    if type(text)~='string' then return nil end
    local known=false
    for _,kind in ipairs({'self','other'}) do
        for _,format in ipairs(type(formats)=='table' and type(formats[kind])=='table' and formats[kind] or {}) do
            local pattern=BackstageForeverLootPattern(format)
            if pattern then
                known=true
                local ok,a,b=pcall(string.match,text,pattern)
                if ok and a then
                    if kind=='self' then return 'self' end
                    -- The capture without a link is the name; some languages put it second.
                    local name=(type(a)=='string' and not a:find('|H',1,true)) and a or (type(b)=='string' and not b:find('|H',1,true)) and b or nil
                    return 'other',name
                end
            end
        end
    end
    if not known then return 'unknown' end
    return nil
end
local QUEUE_MAX,REPEAT_SECONDS=5,60
-- Pure: puts a seen wish in the waiting list. One banner per item a minute (a roll and the loot
-- line name the same item twice), at most five waiting. Returns true when it was added.
function BackstageForeverWishQueue(queue,recent,id,name,who,now)
    if type(queue)~='table' or type(recent)~='table' or type(id)~='number' or type(now)~='number' then return false end
    local last=recent[id]
    if type(last)=='number' and now>=last and now-last<REPEAT_SECONDS then return false end
    if #queue>=QUEUE_MAX then return false end
    recent[id]=now
    queue[#queue+1]={id=id,name=name,who=who}
    return true
end
-- Pure: the banner for everything waiting: a title and a line under it (or nil).
function BackstageForeverWishBanner(queue,nameOf)
    if type(queue)~='table' or #queue==0 then return nil end
    local function label(entry) return entry.name or (type(nameOf)=='function' and nameOf(entry.id)) or (T('Item')..' #'..entry.id) end
    local first=queue[1]
    local title=T('On your wish list:')..' '..label(first)
    if #queue==1 then
        if first.who=='self' then return title,T('You looted it.') end
        if type(first.who)=='string' and first.who~='' then return title,T('%s looted it.'):format(first.who) end
        return title,nil
    end
    local rest={}
    for i=2,#queue do rest[#rest+1]=label(queue[i]) end
    return title,T('And also:')..' '..table.concat(rest,', ')
end

-- ---------------------------------------------------------------- /bf wish
-- Pure: where the Instance Atlas saw an item drop, best chance first. -> {{boss=,place=,chance=}}
function BackstageForeverWishSources(rows,id)
    local out={}
    for _,row in ipairs(type(rows)=='table' and rows or {}) do
        for _,boss in ipairs(type(row)=='table' and type(row[10])=='table' and row[10] or {}) do
            for item,chance in (type(boss[2])=='string' and boss[2] or ''):gmatch('(%d+)~(%d+)') do
                if tonumber(item)==id then out[#out+1]={boss=boss[1],place=row[2],chance=tonumber(chance)} end
            end
        end
    end
    table.sort(out,function(a,b)
        if a.chance~=b.chance then return a.chance>b.chance end
        if a.place~=b.place then return a.place<b.place end
        return a.boss<b.boss
    end)
    return out
end
-- Pure: the chat lines for /bf wish. set: wished item ids; nameOf(id) names an item or returns nil.
function BackstageForeverWishLines(set,rows,nameOf,limit)
    local list={}
    for id in pairs(type(set)=='table' and set or {}) do
        if type(id)=='number' then list[#list+1]={id=id,name=(type(nameOf)=='function' and nameOf(id)) or (T('Item')..' #'..id)} end
    end
    if #list==0 then return {T('Your wish list is empty. Star items in the desktop app\'s Instance Atlas, then type /reload here.')} end
    table.sort(list,function(a,b) if a.name~=b.name then return a.name<b.name end return a.id<b.id end)
    limit=type(limit)=='number' and limit or 12
    local lines={(#list==1 and T('Your wish list: 1 item.') or T('Your wish list: %d items.'):format(#list))}
    for i=1,math.min(#list,limit) do
        local sources=BackstageForeverWishSources(rows,list[i].id)
        if #sources==0 then lines[#lines+1]=('  %s: %s'):format(list[i].name,T('no boss in the Instance Atlas was seen to drop it'))
        else
            local parts={}
            for j=1,math.min(#sources,2) do parts[j]=('%s, %s (%d%%)'):format(sources[j].boss,sources[j].place,sources[j].chance) end
            lines[#lines+1]=('  %s: %s%s'):format(list[i].name,table.concat(parts,'; '),#sources>2 and ('; +'..(#sources-2)) or '')
        end
    end
    if #list>limit then lines[#lines+1]=('  +%d %s'):format(#list-limit,T('more')) end
    lines[#lines+1]=T('Seen drops, not promises. The Instance Atlas (/bf atlas) marks them too.')
    return lines
end

-- ---------------------------------------------------------------- C4 bags
-- Pure: which bag items carry a mark. items = {{bag=,slot=,id=,quest=true or nil}}.
-- -> {{bag=,slot=,id=,upgrade=,wish=,quest=}} in bag and slot order.
function BackstageForeverBagMarks(items,wished,better)
    local out={}
    wished=type(wished)=='table' and wished or {};better=type(better)=='table' and better or {}
    for _,item in ipairs(type(items)=='table' and items or {}) do
        if type(item)=='table' and type(item.id)=='number' and type(item.bag)=='number' and type(item.slot)=='number' then
            local upgrade,wish,quest=better[item.id]==true,wished[item.id]==true,item.quest==true
            if upgrade or wish or quest then out[#out+1]={bag=item.bag,slot=item.slot,id=item.id,upgrade=upgrade,wish=wish,quest=quest} end
        end
    end
    table.sort(out,function(a,b) if a.bag~=b.bag then return a.bag<b.bag end return a.slot<b.slot end)
    return out
end
-- Pure: the sign on a bag button. A different character for each meaning, so it never rests on colour.
function BackstageForeverBagSign(mark)
    if type(mark)~='table' then return '' end
    return (mark.upgrade and '|cff40ff40+|r' or '')..(mark.wish and '|cffffd100*|r' or '')..(mark.quest and '|cffffff00!|r' or '')
end
-- Pure: the chat lines for /bf bags.
function BackstageForeverBagLines(marked,nameOf,limit)
    if type(marked)~='table' then return {T('Your bags are not readable in this game client.')} end
    if #marked==0 then return {T('Nothing in your bags is an upgrade, a wish or a quest item.')} end
    limit=type(limit)=='number' and limit or 14
    local lines={(#marked==1 and T('Marked in your bags: 1 item.') or T('Marked in your bags: %d items.'):format(#marked))}
    for i=1,math.min(#marked,limit) do
        local m=marked[i]
        local words={}
        if m.upgrade then words[#words+1]=T('upgrade') end
        if m.wish then words[#words+1]=T('on your wish list') end
        if m.quest then words[#words+1]=T('quest item') end
        local where=m.bag==0 and T('Backpack') or (T('Bag')..' '..m.bag)
        lines[#lines+1]=('  %s, %s %d: %s - %s'):format(where,T('slot'),m.slot,(type(nameOf)=='function' and nameOf(m.id)) or (T('Item')..' #'..m.id),table.concat(words,', '))
    end
    if #marked>limit then lines[#lines+1]=('  +%d %s'):format(#marked-limit,T('more')) end
    return lines
end

-- ---------------------------------------------------------------- reading the game
local function itemName(id)
    local name=clean((call(GetItemInfo,id)),100)
    if name then return name end
    call(field(plain(C_Item),'RequestLoadItemDataByID'),id)
end
-- The hand-off is read once at login, so the two sets are worked out once.
local sets=nil
local function handed()
    if sets then return sets.wish,sets.up end
    local name,realm=call(UnitName,'player'),call(GetRealmName)
    if type(name)~='string' or type(realm)~='string' then return {},{} end
    sets={wish=type(BackstageForeverWishSet)=='function' and BackstageForeverWishSet(name,realm) or {},
        up=type(BackstageForeverUpgradeSet)=='function' and BackstageForeverUpgradeSet(name,realm) or {}}
    return sets.wish,sets.up
end
local QUEST_CLASS=12
local function questItem(bag,slot,id)
    local api=plain(C_Container)
    local info=call(field(api,'GetContainerItemQuestInfo'),bag,slot)
    if type(info)=='table' then
        if field(info,'isQuestItem')==true or type(field(info,'questID'))=='number' then return true end
    elseif info==nil then
        local isQuest,questId=call(GetContainerItemQuestInfo,bag,slot)
        if isQuest==true or type(questId)=='number' then return true end
    end
    local _,_,_,_,_,classId=call(field(plain(C_Item),'GetItemInfoInstant') or plain(GetItemInfoInstant),id)
    return classId==QUEST_CLASS
end
local function slotCount(bag)
    local n=call(field(plain(C_Container),'GetContainerNumSlots'),bag)
    if type(n)~='number' then n=call(GetContainerNumSlots,bag) end
    return type(n)=='number' and n>=0 and n<=200 and floor(n) or nil
end
local function slotItem(bag,slot)
    local id=call(field(plain(C_Container),'GetContainerItemID'),bag,slot)
    if type(id)~='number' then id=call(GetContainerItemID,bag,slot) end
    return type(id)=='number' and id>=1 and id or nil
end
-- Every item in your bags, or nil when the game gives no bag sizes.
local function bagItems()
    local items,read={},false
    for bag=0,4 do
        local count=slotCount(bag)
        if count then
            read=true
            for slot=1,count do
                local id=slotItem(bag,slot)
                if id then items[#items+1]={bag=bag,slot=slot,id=id,quest=questItem(bag,slot,id) or nil} end
            end
        end
    end
    return read and items or nil
end

-- ---------------------------------------------------------------- the banner
local queue,recent={},{}
local formats=nil
local function lootFormats()
    if formats then return formats end
    formats={self={},other={}}
    for _,name in ipairs({'LOOT_ITEM_SELF_MULTIPLE','LOOT_ITEM_SELF','LOOT_ITEM_PUSHED_SELF_MULTIPLE','LOOT_ITEM_PUSHED_SELF'}) do
        local text=plain(_G[name]);if type(text)=='string' then formats.self[#formats.self+1]=text end
    end
    for _,name in ipairs({'LOOT_ITEM_MULTIPLE','LOOT_ITEM','LOOT_ITEM_PUSHED_MULTIPLE','LOOT_ITEM_PUSHED'}) do
        local text=plain(_G[name]);if type(text)=='string' then formats.other[#formats.other+1]=text end
    end
    return formats
end
local function flush()
    if #queue==0 or combat() then return end
    local title,sub=BackstageForeverWishBanner(queue,itemName)
    queue={}
    if not title or not enabled('wish') then return end
    -- The banner also writes its line to chat, so it is never missed.
    if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,title,sub,nil,'gear')
    else say(sub and (title..' '..sub) or title) end
end
local function onLoot(text,author,_,_,author2)
    if not enabled('wish') then return end
    text=plain(text)
    local id,name=BackstageForeverLootItemId(text)
    if not id then return end
    local wished=handed()
    if not wished[id] then return end
    local kind,who=BackstageForeverLootKind(text,lootFormats())
    if not kind then return end
    if kind=='self' then who='self'
    elseif kind=='unknown' then
        -- No sentences to compare with: take the name the event carries, when it carries one.
        who=clean(author2,60) or clean(author,60)
        local mine=call(UnitName,'player')
        if who then who=who:gsub('%-.*$','');if who==mine then who='self' end end
    else who=clean(who,60) end
    local at=call(GetTime)
    if BackstageForeverWishQueue(queue,recent,id,clean(name,100),who,type(at)=='number' and at or 0) then flush() end
end
function BackstageForeverWishCommand(message)
    local arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^wish%s*(%a*)') or ''
    if arg=='on' or arg=='off' then
        return say(switch('wish',arg) and 'Wish list banner: on. A banner when you or your group loots a wished item.' or 'Wish list banner: off. /bf wish still lists your wishes.')
    end
    local wished=handed()
    local lines=BackstageForeverWishLines(wished,BackstageForeverAtlasData,itemName)
    for i,line in ipairs(lines) do
        if i==1 then say(line) else
            local chat=plain(DEFAULT_CHAT_FRAME)
            if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,line) end
        end
    end
    return lines
end

-- ---------------------------------------------------------------- marks on the bag buttons
-- Our own text, kept in our own table: nothing is written into the game's buttons.
local labels=setmetatable({},{__mode='k'})
local hooked=false
local function setSign(button,text)
    local label=labels[button]
    if not label then
        if text=='' or type(field(button,'CreateFontString'))~='function' then return end
        local ok,made=pcall(button.CreateFontString,button,nil,'OVERLAY','NumberFontNormalSmall')
        if not ok or not made then return end
        label=made
        pcall(label.SetPoint,label,'TOPLEFT',button,'TOPLEFT',2,-2)
        labels[button]=label
    end
    pcall(label.SetText,label,text)
    pcall(text=='' and label.Hide or label.Show,label)
end
local function clearSigns() for button in pairs(labels) do setSign(button,'') end end
local function signFor(bag,slot)
    if type(bag)~='number' or type(slot)~='number' then return '' end
    local id=slotItem(bag,slot)
    if not id then return '' end
    local wished,better=handed()
    local quest=questItem(bag,slot,id)
    if not (wished[id] or better[id] or quest) then return '' end
    return BackstageForeverBagSign({upgrade=better[id]==true,wish=wished[id]==true,quest=quest})
end
-- One bag window, after the game has drawn it. Both shapes of the game's bag code are understood.
local function markFrame(frame)
    frame=plain(frame)
    if type(frame)~='table' and type(frame)~='userdata' then return end
    local quiet=not enabled('bags') or combat()
    local each=field(frame,'EnumerateValidItems')
    if type(each)=='function' then
        for _,button in each(frame) do
            setSign(button,quiet and '' or signFor(call(field(button,'GetBagID'),button),call(field(button,'GetID'),button)))
        end
        return
    end
    local name,bag,size=call(field(frame,'GetName'),frame),call(field(frame,'GetID'),frame),field(frame,'size')
    if type(name)~='string' or type(bag)~='number' or type(size)~='number' then return end
    for i=1,math.min(size,40) do
        local button=plain(_G[name..'Item'..i])
        if type(button)=='table' or type(button)=='userdata' then
            setSign(button,quiet and '' or signFor(bag,call(field(button,'GetID'),button)))
        end
    end
end
local function bagFrames()
    local out={}
    for i=1,13 do local f=plain(_G['ContainerFrame'..i]);if f then out[#out+1]=f end end
    local combined=plain(ContainerFrameCombinedBags);if combined then out[#out+1]=combined end
    return out
end
local function markOpen()
    for _,frame in ipairs(bagFrames()) do
        if call(field(frame,'IsShown'),frame)==true then pcall(markFrame,frame) end
    end
end
-- Returns true when a place to draw after the game was found. hooksecurefunc runs our code after
-- the game's own; it replaces nothing.
local function hookBags()
    if hooked then return true end
    if type(hooksecurefunc)~='function' then return false end
    local post=function(frame) pcall(markFrame,frame) end
    if type(ContainerFrame_Update)=='function' then
        hooked=pcall(hooksecurefunc,'ContainerFrame_Update',post)
    else
        for _,frame in ipairs(bagFrames()) do
            if type(field(frame,'UpdateItems'))=='function' and pcall(hooksecurefunc,frame,'UpdateItems',post) then hooked=true end
        end
    end
    return hooked
end
BackstageForeverBagHook=hookBags -- for tests
function BackstageForeverBagsCommand(message)
    local arg,value=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^bags%s*(%a*)%s*(%a*)')
    if arg=='marks' then
        if combat() then return say('Change bag marks outside combat.') end
        local want=value=='on' or (value~='off' and not enabled('bags'))
        if not want then
            switch('bags','off');clearSigns()
            return say('Bag marks: off. /bf bags still lists the items.')
        end
        if not hookBags() then
            switch('bags','off')
            return say('This game client offers no safe place to draw on bag buttons. /bf bags lists the items instead.')
        end
        switch('bags','on');markOpen()
        return say('Bag marks: on. + upgrade, * on your wish list, ! quest item. Open your bags to see them.')
    end
    if combat() then return say('Try /bf bags outside combat.') end
    local items=bagItems()
    local wished,better=handed()
    local lines=BackstageForeverBagLines(items and BackstageForeverBagMarks(items,wished,better) or nil,itemName)
    for i,line in ipairs(lines) do
        if i==1 then say(line) else
            local chat=plain(DEFAULT_CHAT_FRAME)
            if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,line) end
        end
    end
    return lines
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','CHAT_MSG_LOOT','PLAYER_REGEN_ENABLED','PLAYER_REGEN_DISABLED'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Wish',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,...)
            if event=='CHAT_MSG_LOOT' then pcall(onLoot,...)
            elseif event=='PLAYER_LOGIN' then if enabled('bags') then pcall(hookBags) end
            elseif event=='PLAYER_REGEN_DISABLED' then if hooked then pcall(clearSigns) end
            else
                pcall(flush)
                if hooked and enabled('bags') then pcall(markOpen) end
            end
        end)
    end
end

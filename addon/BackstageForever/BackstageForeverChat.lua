-- Chat tools (roadmap "One addon instead of ten"). Four switches, each off until you switch it on.
--   /bf chat stamps    the game's own chat timestamps (the game setting is switched, nothing is drawn)
--   /bf chat names     the game's own "colour names by class" for the usual chat kinds
--   /bf chat links     a small [+] after each chat line to copy it, web addresses you can copy, and
--                      "45.2, 61.8" turned into a waypoint link. A waypoint is only placed by your click.
--   /bf chat filter    hides lines that sell gold for real money. Counted, and /bf chat filtered
--                      shows what was hidden. Friends, guild and group members are never filtered.
-- How it is done: the game's documented chat filter (ChatFrame_AddMessageEventFilter) and the game's
-- own settings. No chat window is replaced, no AddMessage is hooked, nothing is sent. Chat lines are
-- left alone in combat. Hidden and remembered lines stay in memory until you log out; none is saved.
local floor,min=math.floor,math.min
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

-- ---------------------------------------------------------------- pure: the text of a chat line
local TEXT_MAX=1000
-- Pure: a chat line cut into pieces: {text=,code=true} for colour codes, links and pictures, and
-- {text=,tinted=} for plain text (tinted: inside somebody's colour). nil when a code is not understood.
function BackstageForeverChatPieces(text)
    if type(text)~='string' or #text>TEXT_MAX then return nil end
    local out,at,tinted={},1,false
    local function add(s,code) if s~='' then out[#out+1]={text=s,code=code or nil,tinted=(not code and tinted) or nil} end end
    while at<=#text do
        local bar=text:find('|',at,true)
        if not bar then add(text:sub(at));break end
        add(text:sub(at,bar-1))
        local kind=text:sub(bar+1,bar+1)
        if kind=='c' then
            local code=text:match('^|c%x%x%x%x%x%x%x%x',bar)
            if not code then return nil end
            add(code,true);tinted=true;at=bar+#code
        elseif kind=='r' then add('|r',true);tinted=false;at=bar+2
        elseif kind=='|' then add('||',true);at=bar+2
        elseif kind=='H' then
            local stop=select(2,text:find('|h.-|h',bar,false))
            if not stop then return nil end
            add(text:sub(bar,stop),true);at=stop+1
        elseif kind=='T' or kind=='A' or kind=='K' then
            local close='|'..kind:lower()
            local stop=select(2,text:find(close,bar+2,true))
            if not stop then return nil end
            add(text:sub(bar,stop),true);at=stop+1
        elseif kind=='n' then add('|n',true);at=bar+2
        else return nil end
    end
    return out
end
-- Pure: a chat line as plain text for copying: no colours, a link as its words, no pictures.
function BackstageForeverChatPlain(text)
    if type(text)~='string' then return nil end
    text=text:sub(1,TEXT_MAX)
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|r',''):gsub('|H.-|h(.-)|h','%1'):gsub('|T.-|t',''):gsub('|A.-|a',''):gsub('|K.-|k','?'):gsub('|n',' ')
    text=text:gsub('||','\1'):gsub('|',''):gsub('\1','|'):gsub('%c',' ')
    return text
end

-- ---------------------------------------------------------------- pure: web addresses and coordinates
local URL_MAX,TARGETS_MAX=200,3
local BARE_TLD={com=true,net=true,org=true,gg=true,io=true,tv=true,eu=true,info=true,app=true,dev=true}
-- Pure: is this run of characters a web address? Returns it without closing punctuation, or nil.
function BackstageForeverChatUrl(run)
    if type(run)~='string' or #run<4 or #run>URL_MAX then return nil end
    run=run:gsub("[%.,;:!%?'%)%]]+$",'')
    local low=run:lower()
    if low:match('^https?://[%w%-]+%.[%w%-]') or low:match('^www%.[%w%-]+%.%a%a') then return run end
    local host,rest=low:match('^([%w][%w%-%.]*%.%a+)(.*)$')
    if not host or host:find('..',1,true) or (rest~='' and rest:sub(1,1)~='/') then return nil end
    if host:match('^[%d%.]+') and not host:match('%a') then return nil end
    local name,tld=host:match('^(.+)%.(%a+)$')
    if not BARE_TLD[tld] or #name<2 or not name:match('%a') then return nil end
    return run
end
-- Pure: the web addresses in plain text -> {{from=,to=,url=}} in order.
function BackstageForeverChatUrls(text)
    local out={}
    if type(text)~='string' then return out end
    for from,run in text:gmatch("()([%w%-%._~:/%?#@!%$&'%*%+,;=%%]+)") do
        local url=BackstageForeverChatUrl(run)
        if url then out[#out+1]={from=from,to=from+#url-1,url=url} end
    end
    return out
end
local function coordinate(s)
    if not s:match('^%d%d?%d?$') and not s:match('^%d%d?%d?%.%d%d?$') then return nil end
    local v=tonumber(s)
    return v and v>=0 and v<=100 and v or nil
end
-- Pure: map coordinates written in chat -> {{from=,to=,x=,y=}}. Conservative: "45.2, 61.8",
-- "45.2 61.8" and "45.2/61.8" (both with a decimal), or whole numbers only in brackets: "(45, 61)".
-- A number glued to a letter, a list of three, a price or a version number is left alone.
function BackstageForeverChatCoords(text)
    local out={}
    if type(text)~='string' then return out end
    -- Two decimals with a comma or slash, two decimals with a space, or two whole numbers in brackets.
    for _,pattern in ipairs({'()(%d+%.%d+)%s*[,/]%s*(%d+%.%d+)()','()(%d+%.%d+)%s+(%d+%.%d+)()','[%(%[]()(%d+)%s*,%s*(%d+)()[%)%]]'}) do
        local at=1
        while at<=#text do
            local first,_,from,a,b,stop=text:find(pattern,at)
            if not first then break end
            local to=stop-1
            local x,y=coordinate(a),coordinate(b)
            local before,after=text:sub(from-1,from-1),text:sub(to+1,to+1)
            local ok=x~=nil and y~=nil
            -- Nothing glued on either side, and not part of a longer list of numbers.
            if ok and (before:match('[%w%.:%$%-,/]') or after:match('[%w%%%$]')) then ok=false end
            if ok and (after=='.' or after==',' or after=='/') and text:sub(to+2,to+2):match('%d') then ok=false end
            if ok and text:sub(1,from-1):match('%d%s*[,/]%s*$') then ok=false end
            if ok and text:sub(to+1):match('^%s*[,/]%s*%d') then ok=false end
            for _,taken in ipairs(out) do if ok and from<=taken.to and to>=taken.from then ok=false end end
            if ok then out[#out+1]={from=from,to=to,x=x,y=y} end
            at=ok and stop or first+1
        end
    end
    table.sort(out,function(p,q) return p.from<q.from end)
    return out
end

-- ---------------------------------------------------------------- pure: links in a chat line
local LINK='|cff71d5ff|Haddon:BackstageForever:chat:%d:%d|h[%s]|h|r'
local COPY=' |cff808080|Haddon:BackstageForever:chat:%d:0|h[+]|h|r'
-- Pure: a chat line with its web addresses and coordinates turned into links and a copy mark at
-- the end. id: the number this line is remembered under. -> new text, targets; or nil (leave the
-- line alone) when a code in it is not understood. Text inside a link or a colour is never touched.
function BackstageForeverChatDecorate(text,id)
    if type(id)~='number' or id<1 or id>999999 then return nil end
    local pieces=BackstageForeverChatPieces(text)
    if not pieces then return nil end
    local targets,out={},{}
    for _,piece in ipairs(pieces) do
        if piece.code or piece.tinted then out[#out+1]=piece.text
        else
            local s=piece.text
            local marks={}
            for _,u in ipairs(BackstageForeverChatUrls(s)) do marks[#marks+1]={from=u.from,to=u.to,kind='url',value=u.url} end
            for _,c in ipairs(BackstageForeverChatCoords(s)) do
                local clash=false
                for _,m in ipairs(marks) do if c.from<=m.to and c.to>=m.from then clash=true end end
                if not clash then marks[#marks+1]={from=c.from,to=c.to,kind='way',x=c.x,y=c.y} end
            end
            table.sort(marks,function(a,b) return a.from<b.from end)
            local at=1
            for _,m in ipairs(marks) do
                if #targets<TARGETS_MAX and m.from>=at then
                    targets[#targets+1]=m.kind=='url' and {kind='url',value=m.value} or {kind='way',x=m.x,y=m.y}
                    out[#out+1]=s:sub(at,m.from-1)
                    out[#out+1]=LINK:format(id,#targets,s:sub(m.from,m.to))
                    at=m.to+1
                end
            end
            out[#out+1]=s:sub(at)
        end
    end
    return table.concat(out)..COPY:format(id),targets
end
-- Pure: which remembered line and which target a clicked link asks for, or nil when it is not ours.
function BackstageForeverChatLinkTarget(link)
    if type(link)~='string' or #link>60 then return nil end
    local id,n=link:match('^addon:BackstageForever:chat:(%d+):(%d)$')
    id,n=tonumber(id),tonumber(n)
    if not id or id<1 or id>999999 or n>TARGETS_MAX then return nil end
    return id,n
end
local RING_MAX=60
-- Pure: remembers a line under the next number. ring = {next=,rows={[id]=row},order={ids}}.
function BackstageForeverChatRemember(ring,row,limit)
    if type(ring)~='table' or type(row)~='table' then return nil end
    limit=type(limit)=='number' and limit>=1 and limit or RING_MAX
    ring.rows=ring.rows or {};ring.order=ring.order or {}
    local id=(ring.next or 0)%999999+1
    ring.next=id;ring.rows[id]=row;ring.order[#ring.order+1]=id
    while #ring.order>limit do ring.rows[table.remove(ring.order,1)]=nil end
    return id
end
-- Pure: "[12:03] Name: text" for the copy box.
function BackstageForeverChatLine(clock,author,text)
    local body=BackstageForeverChatPlain(text) or ''
    local who=type(author)=='string' and author~='' and #author<=80 and author:gsub('|','') or nil
    return (type(clock)=='string' and clock~='' and ('['..clock..'] ') or '')..(who and (who..': ') or '')..body
end

-- ---------------------------------------------------------------- pure: gold sellers
-- Items with "gold" in the name that players really trade: "WTS gold bars" is not a gold seller.
local GOLD_ITEMS={bar=true,bars=true,ore=true,ores=true,power=true,dust=true,ring=true,rings=true,vein=true,veins=true,thorn=true,
    coin=true,coins=true,leaf=true,pearl=true,pearls=true,medal=true,ingot=true,ingots=true,nugget=true,nuggets=true,plate=true,plated=true}
local TRIGGERS={cheap=true,cheapest=true,cheaper=true,buy=true,buying=true,sell=true,selling=true,sells=true,wts=true}
local AFTER_GOLD={'^ for sale','^ in stock','^ sale%f[%A]','^ cheap','^ delivery','^ seller','^ shop%f[%A]','^ store%f[%A]','^ %d+%% off','^ on sale','^ stock%f[%A]'}
local SERVICE={'power%s*le?ve?l','fast delivery','instant delivery','safe delivery','quick delivery','24/7','24h','discount','coupon','promo code',
    'cheapest','best price','in stock','customer','live chat','face to face','hand ?made','lowest price'}
local SPAM_MIN,SPAM_MAX=12,600
-- Pure: is this a line that sells gold (or levelling) for real money? Conservative: it needs a
-- price of gold in real money, or an offer of gold together with a web address or real money.
-- -> true/false, reasons {site=,money=,gold=,price=,service=}
function BackstageForeverChatSpam(text)
    local why={}
    if type(text)~='string' or #text<SPAM_MIN then return false,why end
    local low=(BackstageForeverChatPlain(text:sub(1,SPAM_MAX)) or ''):lower()
    low=low:gsub('%s+',' ')
    -- The usual disguises of the word itself.
    low=low:gsub('g[%s%p]?[o0][%s%p]?[l1][%s%p]?d','gold')
    -- A web address: written out, or pulled apart ("www . shop . c0m", "shop dot com").
    if low:find('https?://') or low:find('www%s*[%.,]') or low:find('%f[%a]dot%s*c[o0]m') or low:find('[%w%-]%s*[%.,]%s*c%s*[o0]%s*m%f[%A]')
        or low:find('[%w%-]%s*%.%s*net%f[%A]') or low:find('[%w%-]%s*%.%s*cn%f[%A]') or low:find('[%w%-]%s*%.%s*cc%f[%A]') or low:find('[%w%-]%s*%.%s*vip%f[%A]')
        or low:find('[%w%-]%s*%.%s*shop%f[%A]') then why.site=true end
    -- Real money.
    if low:find('%$%s*%d') or low:find('%d%s*%$') or low:find('%f[%a]usd%f[%A]') or low:find('%f[%a]eur%f[%A]') or low:find('\226\130\172') or low:find('\194\163')
        or low:find('paypal') or low:find('skrill') or low:find('real money') or low:find('%f[%a]rmb%f[%A]') or low:find('%f[%a]dollars?%f[%A]')
        or low:find('western union') or low:find('credit card') then why.money=true end
    -- An offer of gold: a selling word right before "gold", or a shop word right after it; never an item with gold in its name.
    local at=1
    while true do
        local from,to=low:find('%f[%a]gold%f[%A]',at)
        if not from then break end
        local nextWord=low:match('^[%s%p]*(%a+)',to+1)
        if not (nextWord and GOLD_ITEMS[nextWord]) then
            local before=low:sub(1,from-1):match('(%a+)[%s%p]*$')
            if before and TRIGGERS[before] then why.gold=true end
            local rest=low:sub(to+1)
            for _,pattern in ipairs(AFTER_GOLD) do if rest:find(pattern) then why.gold=true end end
        end
        at=to+1
    end
    -- A price of gold in real money: "$5 = 1000g", "1000g=$5", "1k gold / 3.99 usd".
    local amount='%d[%d%.,]*%s*k?%s*g%a*'
    if low:find('%$%s*%d[%d%.,]*%s*[=/:%-]+%s*'..amount) or low:find(amount..'%s*[=/:%-]+%s*%$%s*%d') or low:find(amount..'%s*[=/:%-]+%s*%d[%d%.,]*%s*%$')
        or low:find(amount..'%s*[=/:%-]+%s*%d[%d%.,]*%s*usd') or low:find(amount..'%s*[=/:%-]+%s*%d[%d%.,]*%s*eur%f[%A]')
        or low:find('%d[%d%.,]*%s*usd%s*[=/:%-]+%s*'..amount) or low:find('%$%s*%d[%d%.,]*%s+per%s+'..amount) or low:find('%$%s*%d[%d%.,]*%s+for%s+'..amount)
        or low:find(amount..'%s+for%s+%$%s*%d') or low:find(amount..'%s+for%s+%d[%d%.,]*%s*%$') then why.price=true end
    local services=0
    for _,pattern in ipairs(SERVICE) do if low:find(pattern) then services=services+1 end end
    if services>0 then why.service=services end
    local levelling=low:find('power%s*le?ve?l')~=nil
    local spam=why.price==true or (why.gold==true and (why.site==true or why.money==true)) or (levelling and why.site==true and why.money==true)
    return spam,why
end
-- Pure: lines from these people are never hidden, whatever they say. who = {self=,friend=,guild=,
-- group=,spoken=,known=} where known says the game could answer who is a friend. A whisper is only
-- ever judged when the game could answer; otherwise it is let through.
function BackstageForeverChatTrusted(event,who)
    who=type(who)=='table' and who or {}
    if who.self or who.friend or who.guild or who.group or who.spoken then return true end
    if event=='CHAT_MSG_WHISPER' and who.known~=true then return true end
    return false
end
local FILTERED_MAX,FILTERED_SHOWN,FILTERED_TEXT=30,10,140
-- Pure: the chat lines for /bf chat filtered. list: newest last, {clock=,author=,text=}.
function BackstageForeverChatFilteredLines(list,total)
    list=type(list)=='table' and list or {}
    total=type(total)=='number' and total or 0
    if #list==0 then
        if total>0 then return {T('Hidden gold-seller lines so far: %d. None since you logged in.'):format(total)} end
        return {T('No line has been hidden. The gold-seller filter only hides lines that sell gold for real money.')}
    end
    local lines={T('Hidden gold-seller lines since you logged in: %d (%d in all). Newest first:'):format(#list,total)}
    for i=#list,math.max(1,#list-FILTERED_SHOWN+1),-1 do
        local row=list[i]
        local text=BackstageForeverChatPlain(row.text) or ''
        if #text>FILTERED_TEXT then text=text:sub(1,FILTERED_TEXT):gsub('[\192-\255][\128-\191]*$','')..'...' end
        lines[#lines+1]=('  %s %s: %s'):format(row.clock or '',row.author or '?',text)
    end
    lines[#lines+1]=T('Hidden by mistake? /bf chat filter off stops it, and Report a problem in the desktop app tells us.')
    return lines
end

-- ---------------------------------------------------------------- switches
local KEYS={stamps=true,names=true,links=true,filter=true}
local ALIAS={stamps='stamps',timestamps='stamps',time='stamps',names='names',colours='names',colors='names',class='names',
    links='links',copy='links',link='links',filter='filter',spam='filter'}
local LABEL={stamps='Chat timestamps',names='Class colours in chat',links='Copy and links in chat',filter='Gold seller filter'}
function BackstageForeverChatEnabled(key)
    local s=BackstageForeverChatSettings
    return KEYS[key]==true and type(s)=='table' and rawget(s,key)==true
end
local enabled=BackstageForeverChatEnabled
local function settings()
    if type(BackstageForeverChatSettings)~='table' then BackstageForeverChatSettings={} end
    return BackstageForeverChatSettings
end

-- ---------------------------------------------------------------- the game's own settings
local function cvar(name)
    local get=field(plain(C_CVar),'GetCVar') or plain(GetCVar)
    local v=call(get,name)
    return type(v)=='string' and v or nil
end
local function setCvar(name,value)
    local set=field(plain(C_CVar),'SetCVar') or plain(SetCVar)
    if type(set)~='function' then return false end
    return pcall(set,name,value) and cvar(name)==value
end
-- Timestamps are the game's own. Switching ours off only undoes what ours switched on.
local function applyStamps(on)
    local now=cvar('showTimestamps')
    if not now then return false end
    local s=settings()
    if on then
        if now=='none' then
            if not setCvar('showTimestamps','%H:%M ') then return false end
            s.stampsBefore='none'
        end
    elseif rawget(s,'stampsBefore')=='none' then
        setCvar('showTimestamps','none');s.stampsBefore=nil
    end
    return true
end
local NAME_TYPES={'SAY','YELL','EMOTE','WHISPER','PARTY','PARTY_LEADER','RAID','RAID_LEADER','RAID_WARNING','GUILD','OFFICER','INSTANCE_CHAT','INSTANCE_CHAT_LEADER',
    'CHANNEL1','CHANNEL2','CHANNEL3','CHANNEL4','CHANNEL5','CHANNEL6','CHANNEL7','CHANNEL8','CHANNEL9','CHANNEL10'}
-- Class colours are the game's own too. The chat kinds ours switched on are written down, and only those are undone.
local function applyNames(on)
    local set=plain(SetChatColorNameByClass)
    local info=plain(ChatTypeInfo)
    if type(set)~='function' or type(info)~='table' then return false end
    local s=settings()
    if on then
        local changed=type(rawget(s,'namesBefore'))=='table' and s.namesBefore or {}
        for _,kind in ipairs(NAME_TYPES) do
            local row=field(info,kind)
            if row and field(row,'colorNameByClass')~=true and pcall(set,kind,true) then changed[kind]=true end
        end
        s.namesBefore=changed
    else
        for kind in pairs(type(rawget(s,'namesBefore'))=='table' and s.namesBefore or {}) do
            if type(kind)=='string' and #kind<=24 and kind:match('^[%u%d_]+$') then pcall(set,kind,false) end
        end
        s.namesBefore=nil
    end
    return true
end

-- ---------------------------------------------------------------- reading chat (the game's filter)
local ring,hidden,recentLines,spoken={},{},{},{}
local linksHeard=false
local function stamp()
    local d=call(date,'%H:%M')
    return type(d)=='string' and d or ''
end
local function short(name) return type(name)=='string' and (name:gsub('%-.*$','')) or nil end
local function who(author,guid)
    local name=short(author)
    local out={known=false}
    if name and name==call(UnitName,'player') then out.self=true end
    if name and spoken[name] then out.spoken=true end
    local raid=name and call(UnitInRaid,name)
    if name and (call(UnitInParty,name)==true or (raid~=nil and raid~=false)) then out.group=true end
    if type(guid)=='string' then
        local isFriend=field(plain(C_FriendList),'IsFriend')
        if type(isFriend)=='function' then
            local ok,friend=pcall(isFriend,guid)
            if ok and plain(friend)~=nil then out.known=true;if friend==true then out.friend=true end end
        end
        if call(IsGuildMember,guid)==true then out.guild=true end
        if call(field(plain(C_BattleNet),'GetAccountInfoByGUID'),guid)~=nil then out.friend=true end
    end
    return out
end
local SPAM_EVENTS={CHAT_MSG_CHANNEL=true,CHAT_MSG_SAY=true,CHAT_MSG_YELL=true,CHAT_MSG_WHISPER=true}
local EVENTS={'CHAT_MSG_SAY','CHAT_MSG_YELL','CHAT_MSG_WHISPER','CHAT_MSG_WHISPER_INFORM','CHAT_MSG_PARTY','CHAT_MSG_PARTY_LEADER','CHAT_MSG_RAID',
    'CHAT_MSG_RAID_LEADER','CHAT_MSG_RAID_WARNING','CHAT_MSG_GUILD','CHAT_MSG_OFFICER','CHAT_MSG_CHANNEL','CHAT_MSG_INSTANCE_CHAT','CHAT_MSG_INSTANCE_CHAT_LEADER'}
-- The game calls a filter once for each chat window that shows the line: the first answer is kept
-- and given again, so a line is counted once and carries one number.
local function judged(lineId)
    for _,row in ipairs(recentLines) do if row.id==lineId then return row end end
end
local function keep(lineId,row)
    row.id=lineId
    recentLines[#recentLines+1]=row
    if #recentLines>40 then table.remove(recentLines,1) end
    return row
end
local function onChat(_,event,text,author,...)
    if combat() then return false end
    local wantLinks,wantFilter=enabled('links'),enabled('filter')
    if not wantLinks and not wantFilter then return false end
    text,author=plain(text),plain(author)
    if type(text)~='string' or type(author)~='string' then return false end
    local lineId,guid=plain((select(9,...))),plain((select(10,...)))
    if event=='CHAT_MSG_WHISPER_INFORM' then local name=short(author);if name then spoken[name]=true end end
    local row=type(lineId)=='number' and judged(lineId) or nil
    if not row then
        row={}
        if wantFilter and SPAM_EVENTS[event] and BackstageForeverChatSpam(text) and not BackstageForeverChatTrusted(event,who(author,guid)) then
            row.drop=true
            hidden[#hidden+1]={clock=stamp(),author=short(author) or '?',text=text}
            if #hidden>FILTERED_MAX then table.remove(hidden,1) end
            local s=settings()
            s.filtered=min(1e9,(type(rawget(s,'filtered'))=='number' and s.filtered or 0)+1)
        elseif wantLinks then
            local id=BackstageForeverChatRemember(ring,{plain=BackstageForeverChatLine(stamp(),short(author),text)},RING_MAX)
            if id and linksHeard then
                local ok,new,targets=pcall(BackstageForeverChatDecorate,text,id)
                if ok and type(new)=='string' then row.text=new;ring.rows[id].targets=targets end
            end
        end
        if type(lineId)=='number' then keep(lineId,row) end
    end
    if row.drop then return true end
    if row.text then return false,row.text,author,... end
    return false
end
local registered=false
local function syncFilters()
    local want=enabled('links') or enabled('filter')
    if want==registered then return true end
    local add,remove=plain(ChatFrame_AddMessageEventFilter),plain(ChatFrame_RemoveMessageEventFilter)
    if want then
        if type(add)~='function' then return false end
        for _,event in ipairs(EVENTS) do pcall(add,event,onChat) end
        registered=true
    else
        if type(remove)=='function' then for _,event in ipairs(EVENTS) do pcall(remove,event,onChat) end end
        registered=false
    end
    return true
end
BackstageForeverChatFilter=onChat -- for tests

-- ---------------------------------------------------------------- the copy box
local WIDTH,HEIGHT,INSET=480,96,16
local box
local function buildBox()
    if box or type(CreateFrame)~='function' or not UIParent then return box end
    local f=CreateFrame('Frame','BackstageForeverChatCopy',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT);f:SetPoint('CENTER',0,120)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',f.StartMoving);f:SetScript('OnDragStop',f.StopMovingOrSizing)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    title:SetPoint('TOPLEFT',INSET,-12);title:SetWidth(WIDTH-INSET*2-22);title:SetJustifyH('LEFT');title:SetWordWrap(false)
    title:SetText(T('Copy from chat'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide() end)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,-30)
    local edit=CreateFrame('EditBox',nil,f)
    edit:SetSize(WIDTH-INSET*2-8,18);edit:SetPoint('TOPLEFT',INSET+4,-40)
    pcall(edit.SetFontObject,edit,'GameFontHighlightSmall');pcall(edit.SetAutoFocus,edit,false);pcall(edit.SetMaxLetters,edit,TEXT_MAX)
    local back=edit:CreateTexture(nil,'BACKGROUND');back:SetPoint('TOPLEFT',-4,2);back:SetPoint('BOTTOMRIGHT',4,-2);back:SetColorTexture(0,0,0,.5)
    edit:SetScript('OnEscapePressed',function() f:Hide() end)
    edit:SetScript('OnEnterPressed',function() f:Hide() end)
    -- The text is for copying: whatever is typed over it is put back.
    edit:SetScript('OnTextChanged',function(self,user) if user and f.text and self:GetText()~=f.text then self:SetText(f.text);pcall(self.HighlightText,self) end end)
    f.edit=edit
    local hint=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    hint:SetPoint('BOTTOMLEFT',INSET,14);hint:SetWidth(WIDTH-INSET*2);hint:SetJustifyH('LEFT');hint:SetWordWrap(false)
    hint:SetText(T('Press Ctrl+C to copy, then Escape to close.'))
    f:RegisterEvent('PLAYER_REGEN_DISABLED');f:SetScript('OnEvent',function() f:Hide() end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverChatCopy') end
    box=f
    return f
end
local function copy(text)
    if combat() then return say('The copy box waits until you leave combat.') end
    if type(text)~='string' or text=='' then return say('That chat line is no longer remembered.') end
    local ok,f=pcall(buildBox)
    if not ok or not f then return say('The copy box is not available in this game client.') end
    f.text=text
    f.edit:SetText(text);f:Show()
    pcall(f.edit.SetFocus,f.edit);pcall(f.edit.HighlightText,f.edit)
    return true
end
-- A click on one of our chat links. Nothing happens without the click.
function BackstageForeverChatLinkClick(link)
    local id,n=BackstageForeverChatLinkTarget(link)
    if not id then return false end
    local row=ring.rows and ring.rows[id]
    if not row then say('That chat line is no longer remembered.') return true end
    if n==0 then copy(row.plain) return true end
    local target=type(row.targets)=='table' and row.targets[n]
    if not target then return true end
    if target.kind=='url' then copy(target.value) return true end
    if combat() then say('Waypoints wait until you leave combat.') return true end
    local map=call(field(plain(C_Map),'GetBestMapForUnit'),'player')
    if type(map)~='number' then say('Your map is not known yet; try again in a moment.') return true end
    -- The line names no zone, so the spot is placed on the map you are on, like /way.
    if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.4f %.4f %s'):format(map,target.x/100,target.y/100,T('from chat'))) end
    return true
end

-- ---------------------------------------------------------------- /bf chat
local function turn(key,on)
    local s=settings()
    if key=='stamps' then
        if not applyStamps(on) then
            s.stamps=false
            return say('This game client has no chat timestamp setting the addon can switch.')
        end
        s.stamps=on
        return say(on and 'Chat timestamps: on. This is the game\'s own setting; if no time shows, type /reload once.' or 'Chat timestamps: off.')
    end
    if key=='names' then
        if not applyNames(on) then
            s.names=false
            return say('This game client has no class colour setting the addon can switch.')
        end
        s.names=on
        return say(on and 'Class colours in chat: on. This is the game\'s own setting; names are coloured where the game knows the class.' or 'Class colours in chat: off.')
    end
    s[key]=on
    if not syncFilters() then
        s[key]=false
        return say('This game client has no chat filter the addon can use.')
    end
    if key=='links' then
        if on and not linksHeard then return say('Copy and links in chat: on. This game client does not tell addons about clicks on chat links, so use /bf chat copy for the last line.') end
        return say(on and 'Copy and links in chat: on. Click [+] after a line to copy it; click a web address to copy it, or coordinates for a waypoint.' or 'Copy and links in chat: off.')
    end
    return say(on and 'Gold seller filter: on. Lines that sell gold for real money are hidden and counted; /bf chat filtered shows them. Friends, guild and group are never filtered.'
        or 'Gold seller filter: off.')
end
function BackstageForeverChatCommand(message)
    local arg,value=(type(message)=='string' and #message<=60 and message:lower() or ''):match('^chat%s*(%a*)%s*(%w*)')
    arg=arg or ''
    if arg=='filtered' then
        local lines=BackstageForeverChatFilteredLines(hidden,type(BackstageForeverChatSettings)=='table' and rawget(BackstageForeverChatSettings,'filtered') or 0)
        for i,l in ipairs(lines) do if i==1 then say(l) else line(l) end end
        return lines
    end
    if arg=='copy' and (value=='' or tonumber(value)) then
        local order=ring.order or {}
        local back=tonumber(value) or 1
        local id=order[#order-back+1]
        if not enabled('links') then return say('Copy and links in chat is off. /bf chat links on switches it on.') end
        if not id then return say('No chat line is remembered yet.') end
        return copy(ring.rows[id].plain)
    end
    if combat() and arg~='' then return say('Change chat tools outside combat.') end
    if arg=='on' or arg=='off' then
        local keys=arg=='on' and {'stamps','names','links'} or {'stamps','names','links','filter'}
        for _,key in ipairs(keys) do if enabled(key)~=(arg=='on') then turn(key,arg=='on') end end
        if arg=='on' then say('The gold seller filter has its own switch: /bf chat filter on.') end
        return
    end
    local key=ALIAS[arg]
    if key then
        local on=value=='on' or (value~='off' and not enabled(key))
        return turn(key,on)
    end
    say('Chat tools, each off until you switch it on:')
    for _,k in ipairs({'stamps','names','links','filter'}) do
        line(('  %s - %s (/bf chat %s %s)'):format(T(LABEL[k]),T(enabled(k) and 'On' or 'Off'),k,enabled(k) and 'off' or 'on'))
    end
    local total=type(BackstageForeverChatSettings)=='table' and rawget(BackstageForeverChatSettings,'filtered')
    if type(total)=='number' and total>0 then line('  '..T('Hidden gold-seller lines so far: %d. /bf chat filtered shows them.'):format(total)) end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Chat',events) end
        pcall(events.SetScript,events,'OnEvent',function()
            -- The game tells addons about a click on their own chat links; the click is only read.
            local registry=plain(EventRegistry)
            if type(registry)=='table' and type(registry.RegisterCallback)=='function' then
                linksHeard=pcall(registry.RegisterCallback,registry,'SetItemRef',function(_,link) pcall(BackstageForeverChatLinkClick,link) end,events)
            end
            pcall(syncFilters)
        end)
    end
end

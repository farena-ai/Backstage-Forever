-- Guild tools (1.25, roadmap S2): guild members who run the addon and switch this on share four
-- things over the game's guild addon channel: level, zone, professions with skill, and a
-- "looking for dungeon" flag. /bf guild lists who shares and what they are doing.
--   /bf guild on|off          sharing for this character. Off until you switch it on; off means
--                             nothing is sent and nothing is read.
--   /bf guild lfd DUNGEON|off your flag            /bf guild   the list
-- It uses the party sync channel code (BackstageForeverParty.lua): one prefix, at most 255 bytes.
-- Sends are rare: after login, when something changed, and never more often than every 3 minutes.
-- What arrives is checked field by field and kept in memory only, at most 100 members, for 30 minutes.
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
local function now() local t=call(GetTime);return type(t)=='number' and t or 0 end

-- ---------------------------------------------------------------- pure
local ZONE_MAX,PROF_MAX,PROFS,MEMBERS,KEEP=40,24,4,100,30*60
local MIN_GAP,HEARTBEAT=180,600
-- One line of plain text: no colour or link codes, none of the characters the message is built with.
local function tidy(text,max)
    if type(text)~='string' then return nil end
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|T[^|]*|t',''):gsub('|[hr]',''):gsub('[|,:%c]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text>max then text=text:sub(1,max):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    return text~='' and text or nil
end
local function dungeonId(text) return type(text)=='string' and #text<=8 and text:match('^%l[%l%d]*$') and text or nil end
-- Pure: what you share, as one message: "G|42|Stranglethorn Vale|Mining:210,Herbalism:180|brd".
-- me = {level=,zone=,profs={{name=,rank=}},lfd=dungeon id or nil}. "-" stands for "nothing".
function BackstageForeverGuildEncode(me)
    me=type(me)=='table' and me or {}
    local level=type(me.level)=='number' and me.level>=1 and me.level<=100 and floor(me.level) or nil
    if not level then return nil end
    local profs={}
    for _,p in ipairs(type(me.profs)=='table' and me.profs or {}) do
        local name=type(p)=='table' and tidy(p.name,PROF_MAX)
        local rank=type(p)=='table' and type(p.rank)=='number' and p.rank>=0 and p.rank<=999 and floor(p.rank)
        if name and rank and #profs<PROFS then profs[#profs+1]=name..':'..rank end
    end
    return ('G|%d|%s|%s|%s'):format(level,tidy(me.zone,ZONE_MAX) or '-',#profs>0 and table.concat(profs,',') or '-',dungeonId(me.lfd) or '-')
end
-- Pure: a message back into {level=,zone=,profs={{name=,rank=}},lfd=}; {off=true} for "G|off";
-- nil when anything about it is off.
function BackstageForeverGuildDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    if message=='G|off' then return {off=true} end
    local level,zone,profs,lfd=message:match('^G|(%d%d?%d?)|([^|]+)|([^|]+)|([^|]+)$')
    level=tonumber(level)
    if not level or level<1 or level>100 or (lfd~='-' and not dungeonId(lfd)) then return nil end
    local out={level=level,profs={}}
    if zone~='-' then
        if tidy(zone,ZONE_MAX)~=zone then return nil end
        out.zone=zone
    end
    if lfd~='-' then out.lfd=lfd end
    if profs~='-' then
        for entry in profs:gmatch('[^,]+') do
            local name,rank=entry:match('^([^:]+):(%d%d?%d?)$')
            if not name or tidy(name,PROF_MAX)~=name or #out.profs>=PROFS then return nil end
            out.profs[#out.profs+1]={name=name,rank=tonumber(rank)}
        end
        if #out.profs==0 then return nil end
    end
    return out
end
-- Pure: a guild member's name: letters and an optional -Realm.
local function memberName(name)
    if type(name)~='string' or #name<2 or #name>48 or name:find('[%d%c%s|]') then return nil end
    if name:find('%p') and not name:match('^[^%p]+%-[^%p]+$') then return nil end
    return name
end
-- Pure: drops members not heard from for 30 minutes. -> how many went.
function BackstageForeverGuildPrune(roster,at)
    local gone=0
    if type(roster)~='table' or type(at)~='number' then return gone end
    for name,row in pairs(roster) do
        if type(row)~='table' or type(row.at)~='number' or at-row.at>=KEEP or row.at>at+60 then roster[name]=nil;gone=gone+1 end
    end
    return gone
end
-- Pure: keeps what one member shared (or forgets them on "off"). At most 100 members; the one
-- heard from longest ago makes room. -> true when the roster changed.
function BackstageForeverGuildStore(roster,name,message,at)
    name=memberName(name)
    local entry=name and BackstageForeverGuildDecode(message)
    if type(roster)~='table' or not entry or type(at)~='number' then return false end
    if entry.off then
        local had=roster[name]~=nil
        roster[name]=nil
        return had
    end
    BackstageForeverGuildPrune(roster,at)
    if not roster[name] then
        local size,oldest=0,nil
        for other,row in pairs(roster) do
            size=size+1
            if not oldest or row.at<roster[oldest].at then oldest=other end
        end
        if size>=MEMBERS and oldest then roster[oldest]=nil end
    end
    entry.at=at
    roster[name]=entry
    return true
end
-- Pure: is it time to send? last = {at=,body=} of the last send or nil; asked: a member asked who shares.
-- Never within 3 minutes of the last send; then when something changed, when asked, or every 10 minutes.
function BackstageForeverGuildDue(last,body,at,asked)
    if type(body)~='string' or type(at)~='number' then return false end
    if type(last)~='table' or type(last.at)~='number' or at<last.at then return true end
    if at-last.at<MIN_GAP then return false end
    return body~=last.body or asked==true or at-last.at>=HEARTBEAT
end
local function nameOf(id)
    local fn=BackstageForeverLfgName
    if type(fn)=='function' then local ok,name=pcall(fn,id) if ok and type(name)=='string' then return name end end
    return id
end
-- Pure: the chat lines for /bf guild: members looking for a dungeon first, then by name.
function BackstageForeverGuildLines(roster,limit)
    local rows={}
    for name,row in pairs(type(roster)=='table' and roster or {}) do if type(row)=='table' then rows[#rows+1]={name=name,row=row} end end
    if #rows==0 then return {T('No guild member is sharing right now. Members need Backstage Forever and /bf guild on.')} end
    table.sort(rows,function(a,b)
        local x,y=a.row.lfd~=nil,b.row.lfd~=nil
        if x~=y then return x end
        return a.name<b.name
    end)
    limit=type(limit)=='number' and limit or 20
    local lines={T(('Guild members sharing: %d.'):format(#rows))}
    for i=1,min(#rows,limit) do
        local name,row=rows[i].name,rows[i].row
        local line=row.zone and T(('%s, level %d, %s.'):format(name,row.level,row.zone)) or T(('%s, level %d.'):format(name,row.level))
        local profs={}
        for _,p in ipairs(row.profs or {}) do profs[#profs+1]=p.name..' '..p.rank end
        if #profs>0 then line=line..' '..table.concat(profs,', ')..'.' end
        if row.lfd then line=line..' '..T(('Looking for %s.'):format(nameOf(row.lfd))) end
        lines[#lines+1]='  '..line
    end
    if #rows>limit then lines[#lines+1]='  '..T(('and %d more.'):format(#rows-limit)) end
    return lines
end

-- ---------------------------------------------------------------- E3 who can craft it (1.26)
-- /bf guild craft NAME asks sharing guild members; their addons answer from the recipes they know.
-- "X|name" is the question, "Y|name|Recipe Name" one answer. Both are checked field by field.
local CRAFT_MIN,CRAFT_MAX,RECIPE_MAX,CRAFT_RESULTS,CRAFT_ANSWERS=3,40,48,20,2
-- Pure: what the player typed (or shift-clicked) made into a search text of 3 to 40 bytes, or nil.
function BackstageForeverCraftQuery(text)
    if type(text)~='string' or #text>400 then return nil end
    local linked=text:match('|h%[(.-)%]|h')
    text=tidy(linked or text,CRAFT_MAX)
    if not text or #text<CRAFT_MIN then return nil end
    return text
end
function BackstageForeverCraftAsk(query)
    query=BackstageForeverCraftQuery(query)
    return query and ('X|'..query) or nil
end
-- Pure: the search text of a question, or nil when the message is not a clean question.
function BackstageForeverCraftAsked(message)
    if type(message)~='string' or #message>CRAFT_MAX+2 then return nil end
    local query=message:match('^X|([^|]+)$')
    if not query or #query<CRAFT_MIN or tidy(query,CRAFT_MAX)~=query then return nil end
    return query
end
-- Pure: the recipes of yours whose name holds the search text, at most limit names.
-- recipes: {{name=}} as the capture keeps them.
function BackstageForeverCraftFind(recipes,query,limit)
    local out,seen={},{}
    query=BackstageForeverCraftQuery(query)
    if not query then return out end
    local want=query:lower()
    limit=type(limit)=='number' and limit or CRAFT_ANSWERS
    for _,recipe in ipairs(type(recipes)=='table' and recipes or {}) do
        local name=type(recipe)=='table' and tidy(recipe.name,RECIPE_MAX)
        if name and not seen[name] and name:lower():find(want,1,true) and #out<limit then seen[name]=true;out[#out+1]=name end
    end
    return out
end
function BackstageForeverCraftAnswer(query,name)
    query=BackstageForeverCraftQuery(query)
    name=tidy(name,RECIPE_MAX)
    if not query or not name or not name:lower():find(query:lower(),1,true) then return nil end
    return 'Y|'..query..'|'..name
end
-- Pure: the recipe name inside an answer to your question, or nil: the question must be the one
-- you asked, and the recipe name must hold it.
function BackstageForeverCraftAnswered(message,asked)
    if type(message)~='string' or #message>CRAFT_MAX+RECIPE_MAX+3 or type(asked)~='string' then return nil end
    local query,name=message:match('^Y|([^|]+)|([^|]+)$')
    if not query or query:lower()~=asked:lower() or tidy(name,RECIPE_MAX)~=name then return nil end
    if not name:lower():find(asked:lower(),1,true) then return nil end
    return name
end
-- Pure: keeps one answer: at most twenty, each member and recipe once. -> true when it was added.
function BackstageForeverCraftStore(results,who,name)
    who=memberName(who)
    if type(results)~='table' or not who or type(name)~='string' or #results>=CRAFT_RESULTS then return false end
    for _,row in ipairs(results) do if row.who==who and row.name==name then return false end end
    results[#results+1]={who=who,name=name}
    return true
end
-- Pure: the chat lines for the answers. clickable: add a [whisper] link the addon made itself.
function BackstageForeverCraftLines(query,results,clickable)
    results=type(results)=='table' and results or {}
    if #results==0 then return {T(('No sharing guild member answered for "%s". They need Backstage Forever, /bf guild on and the recipe.'):format(tostring(query)))} end
    local lines={T(('Guild members who can make "%s": %d.'):format(tostring(query),#results))}
    for i,row in ipairs(results) do
        local line=('  %s: %s'):format(row.who,row.name)
        if clickable then line=line..(' |cff71d5ff|Haddon:BackstageForever:gcraft:%d|h[%s]|h|r'):format(i,T('whisper')) end
        lines[#lines+1]=line
    end
    return lines
end

-- ---------------------------------------------------------------- live
function BackstageForeverGuildSharing()
    local s=BackstageForeverGuildSettings
    return type(s)=='table' and rawget(s,'share')==true
end
local function settings()
    if type(BackstageForeverGuildSettings)~='table' then BackstageForeverGuildSettings={} end
    return BackstageForeverGuildSettings
end
local roster,last,asked,latest={},nil,false,nil
BackstageForeverGuildRoster=roster
function BackstageForeverGuildUpdate(character) latest=type(character)=='table' and character or nil end
local function send(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' then return false end
    local ok,sent=pcall(fn,text,'GUILD')
    return ok and sent==true
end
local function mine()
    local profs={}
    local items=field(field(field(field(latest,'readiness'),'workshop'),'professions'),'items')
    for _,p in ipairs(type(items)=='table' and items or {}) do
        if type(p)=='table' and #profs<PROFS then profs[#profs+1]={name=p.name,rank=p.rank} end
    end
    local zone=call(GetRealZoneText)
    if type(zone)~='string' or zone=='' then zone=call(GetZoneText) end
    return {level=call(UnitLevel,'player'),zone=zone,profs=profs,lfd=dungeonId(rawget(settings(),'lfd'))}
end
-- Called now and then and after a change; sends only when the rule above allows it.
local function tick()
    if not BackstageForeverGuildSharing() or call(IsInGuild)~=true then return false end
    local body=BackstageForeverGuildEncode(mine())
    local at=now()
    if not body or not BackstageForeverGuildDue(last,body,at,asked) then return false end
    if not send(body) then return false end
    last,asked={at=at,body=body},false
    return true
end
BackstageForeverGuildTick=tick -- for tests
local function onGuild(sender,message)
    if not BackstageForeverGuildSharing() then return end
    if message=='G?' then asked=true return end
    BackstageForeverGuildStore(roster,sender,message,now())
end
-- E3: who can craft it. Asked and answered only while guild sharing is on.
local craft,craftRate,linksHeard=nil,{},false
local CRAFT_PREFIX='Backstage Forever: '
local function due(key,at,gap)
    local last=craftRate[key]
    if type(last)=='number' and at>=last and at-last<gap then return false end
    craftRate[key]=at
    return true
end
local function myRecipes()
    local items=field(field(field(field(latest,'readiness'),'workshop'),'recipes'),'items')
    return type(items)=='table' and items or {}
end
local function onCraftAsked(sender,message)
    if not BackstageForeverGuildSharing() then return end
    local query=BackstageForeverCraftAsked(message)
    if not query then return end
    local found=BackstageForeverCraftFind(myRecipes(),query)
    -- Answer only when you know a match, and at most once every five seconds.
    if #found==0 or not due('answer',now(),5) then return end
    for _,name in ipairs(found) do
        local text=BackstageForeverCraftAnswer(query,name)
        if text then send(text) end
    end
end
local function onCraftAnswer(sender,message)
    if not BackstageForeverGuildSharing() or not craft or now()-craft.at>60 then return end
    local name=BackstageForeverCraftAnswered(message,craft.query)
    if name then BackstageForeverCraftStore(craft.results,sender,name) end
end
local function craftReport()
    if not craft then return say('Ask first: /bf guild craft NAME, for example /bf guild craft Ghost Dye.') end
    local chat=plain(DEFAULT_CHAT_FRAME)
    for i,line in ipairs(BackstageForeverCraftLines(craft.query,craft.results,linksHeard)) do
        -- Lines with the addon's own link are printed as they are; names inside were checked on arrival.
        if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,i==1 and (CRAFT_PREFIX..line) or line) end
    end
    craft.shown=true
end
-- A click on [whisper] puts "/w Name " in your chat box. It never sends anything.
function BackstageForeverCraftLinkClick(link)
    link=plain(link)
    local index=type(link)=='string' and #link<=60 and tonumber(link:match('^addon:BackstageForever:gcraft:(%d%d?)$'))
    local row=index and craft and craft.results[index]
    if not row then return false end
    local open=field(plain(ChatFrameUtil),'OpenChat') or plain(ChatFrame_OpenChat)
    if type(open)~='function' then return false end
    return (pcall(open,'/w '..row.who..' '))
end
local function craftCommand(text)
    if not BackstageForeverGuildSharing() then return say('Guild sharing is off. /bf guild on turns it on; then members who share can answer.') end
    if call(IsInGuild)~=true then return say('You are not in a guild.') end
    if text=='' then return craftReport() end
    local query=BackstageForeverCraftQuery(text)
    if not query then return say('Name what you want made, at least three letters: /bf guild craft Ghost Dye.') end
    local at=now()
    if not due('ask',at,30) then return say('You asked a moment ago. /bf guild craft shows the answers again.') end
    craft={query=query,at=at,results={}}
    if not send(BackstageForeverCraftAsk(query)) then return say('Guild sharing is not available in this game client.') end
    local asked=craft
    local timer=plain(C_Timer)
    if type(timer)=='table' and type(timer.After)=='function' and pcall(timer.After,5,function() if craft==asked and not asked.shown then pcall(craftReport) end end) then
        return say(('Asked sharing guild members who can make "%s". The answers follow in a few seconds.'):format(query))
    end
    say(('Asked sharing guild members who can make "%s". Type /bf guild craft in a few seconds to read the answers.'):format(query))
end
local askedAt,offAt=nil,nil
function BackstageForeverGuildCommand(message)
    -- The thing to craft keeps its capitals and may be a shift-clicked link, so it is read first.
    local wanted=type(message)=='string' and #message<=400 and message:match('^%a+%s+[Cc][Rr][Aa][Ff][Tt]%f[%A]%s*(.-)%s*$')
    if wanted then return craftCommand(wanted) end
    local rest=type(message)=='string' and #message<=80 and message:lower():match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:match('^(%a*)%s*(.*)$')
    if word=='on' or word=='off' then
        settings().share=word=='on'
        if word=='on' then
            if call(IsInGuild)~=true then return say('Guild sharing: on. You are not in a guild, so nothing is sent.') end
            asked=true;tick()
            return say('Guild sharing: on. Your level, zone, professions and dungeon flag go to guild members who run Backstage Forever. /bf guild off stops it.')
        end
        -- One goodbye so members drop you at once; flipping the switch again and again sends no more.
        if not offAt or now()-offAt>=MIN_GAP then offAt=now();send('G|off') end
        for name in pairs(roster) do roster[name]=nil end
        return say('Guild sharing: off. Nothing is sent and nothing is read.')
    end
    if word=='lfd' then
        if tail=='off' or tail=='' then
            settings().lfd=nil
            say('Your looking-for-dungeon flag is cleared.')
        else
            local id=type(BackstageForeverLfgDungeon)=='function' and BackstageForeverLfgDungeon(tail) or nil
            if not id then return say('That dungeon is not known. Try a short name, for example /bf guild lfd brd.') end
            settings().lfd=id
            say(('Your flag: looking for %s.'):format(nameOf(id)))
        end
        if not BackstageForeverGuildSharing() then return say('Guild sharing is off, so nobody sees the flag. /bf guild on turns it on.') end
        tick()
        return
    end
    if not BackstageForeverGuildSharing() then return say('Guild sharing is off. /bf guild on shares your level, zone, professions and dungeon flag with guild members who run Backstage Forever, and shows theirs.') end
    if call(IsInGuild)~=true then return say('You are not in a guild.') end
    local at=now()
    BackstageForeverGuildPrune(roster,at)
    for _,line in ipairs(BackstageForeverGuildLines(roster)) do say(line) end
    if next(roster)==nil and (not askedAt or at-askedAt>=60) then
        askedAt=at
        if send('G?') then say('Asked who is sharing. Answers arrive within a few minutes; try /bf guild again later.') end
    end
end

if type(BackstageForeverPartyHandle)=='function' then
    BackstageForeverPartyHandle('G',onGuild,'GUILD')
    BackstageForeverPartyHandle('X',onCraftAsked,'GUILD')
    BackstageForeverPartyHandle('Y',onCraftAnswer,'GUILD')
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_LEVEL_UP','ZONE_CHANGED_NEW_AREA'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Guild',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then
                settings()
                -- The game tells addons about a click on their own chat links; the click is only read.
                local registry=plain(EventRegistry)
                if type(registry)=='table' and type(registry.RegisterCallback)=='function' then
                    linksHeard=pcall(registry.RegisterCallback,registry,'SetItemRef',function(_,link) pcall(BackstageForeverCraftLinkClick,link) end,events)
                end
                -- The first send waits for the game to settle; later ones follow the 3-minute rule.
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.NewTicker)=='function' then pcall(timer.NewTicker,30,function() pcall(tick) end) end
                return
            end
            pcall(tick)
        end)
    end
end

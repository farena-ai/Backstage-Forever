-- Backstage Live, the game's half (guild link, signals to the desktop app, what the app hands back).
--   /bf guild link CODE    (guild leader or the rank below) ties the guild to its page in the desktop
--                          app: the code from the app goes to guild members' addons, never to chat
--   /bf guild link         says where the link stands; a leader sends the code again
--   /bf guild unlink       (guild leader) takes the link away again
--   /bf guild desk on|off  whether events, sign-ups, your party and your board listing are told to
--                          the desktop app over the live link (on; nothing leaves this computer here)
--   /bf lfg list DUNGEON [tank|healer|damage] [need T H D] [: note]   your own line on the realm
--                          board; /bf lfg list off takes it down. The desktop app sends it.
-- Three directions, three speeds:
--   game <-> game   the guild channel's addon messages, at once:  K|CODE  K|-  K?  (and E, V of
--                   BackstageForeverEvents.lua for what a reload brought in)
--   game -> app     the live link (BackstageForeverLive.lua), within seconds: one short line of
--                   text per signal, at most one every second and a half, never in combat. The
--                   same facts are in the saved file, so nothing is lost while the link is off.
--   app -> game     only at login or /reload, through BackstageForeverDesktopData: guild={...},
--                   lfg={...} and plan={...}. Everything in it is checked like a message from a
--                   stranger. Events and answers are merged by version and what is new is passed on
--                   in the guild channel after a short random wait, unless somebody else just did.
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

-- ---------------------------------------------------------------- pure: small checks
local T_MIN,T_MAX=1000000000,9999999999
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
-- One line of plain text of at most limit bytes without "|" or control characters, or nil.
local function clean(text,limit)
    if type(text)~='string' or #text>1000 then return nil end
    text=text:gsub('[|%c]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text>limit then text=text:sub(1,limit):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    return text~='' and text or nil
end
-- Already clean, or nil: what arrives is refused, never repaired.
local function strict(text,limit) local c=clean(text,limit) return c==text and c or nil end
-- A character name: letters only, 2 to 48 bytes.
local function person(name)
    if type(name)~='string' or #name<2 or #name>48 or name:find('[%d%c%s%p]') then return nil end
    return name
end
-- A name as a channel gives it: letters, and "-Realm" for a player of another realm.
local function member(name)
    if type(name)~='string' or #name<2 or #name>110 then return nil end
    local short,realm=name:match('^([^%-]+)%-(.+)$')
    if not short then return person(name) end
    return person(short) and strict(realm,60) and name or nil
end
local function eventId(id) return type(id)=='string' and #id>=6 and #id<=10 and id:match('^[%l%d]+$') and id or nil end
local function placeId(id) return type(id)=='string' and #id<=8 and id:match('^%l[%l%d]*$') and id or nil end
local function listingId(id) return type(id)=='string' and #id==16 and id:match('^[%l%d]+$') and id or nil end
local STATUS={t=true,h=true,d=true,m=true,n=true}
local VIA={g=true,k=true,d=true}
local DIGITS='0123456789abcdefghijklmnopqrstuvwxyz'
local function base36(n)
    n=floor(n)
    local out=''
    repeat local d=n%36;out=DIGITS:sub(d+1,d+1)..out;n=(n-d)/36 until n<=0
    return out
end
-- The classes in the order the desktop app knows them; 0 stands for "not known".
local CLASS={WARRIOR=1,PALADIN=2,HUNTER=3,ROGUE=4,PRIEST=5,SHAMAN=6,MAGE=7,WARLOCK=8,DRUID=9}
BackstageForeverLiveClasses=CLASS

-- ---------------------------------------------------------------- pure: the guild link
-- "BFG-7K2M-Q9XD" as the desktop app shows it. Typed small or without the dashes is put right.
function BackstageForeverLinkCode(text)
    if type(text)~='string' or #text>40 then return nil end
    local code=text:gsub('%s',''):upper()
    local a,b=code:match('^BFG([%u%d][%u%d][%u%d][%u%d])([%u%d][%u%d][%u%d][%u%d])$')
    if a then code='BFG-'..a..'-'..b end
    return code:match('^BFG%-[%u%d][%u%d][%u%d][%u%d]%-[%u%d][%u%d][%u%d][%u%d]$') and code or nil
end
function BackstageForeverLinkEncode(code)
    code=BackstageForeverLinkCode(code)
    return code and ('K|'..code) or nil
end
-- -> 'ask' ("who holds the link?"), 'off' (the link is taken away), or 'code' and the code; nil when off.
function BackstageForeverLinkDecode(message)
    if type(message)~='string' or #message>15 then return nil end
    if message=='K?' then return 'ask' end
    if message=='K|-' then return 'off' end
    local code=message:match('^K|(.+)$')
    if code and BackstageForeverLinkCode(code)==code then return 'code',code end
end
-- What a link message changes. state = {code=,from=,at=,prompted=}; rank: the sender's guild rank
-- index (0 is the guild leader). A code counts only from the leader or the rank below; only the
-- leader takes the link away. -> 'new' (show the prompt), 'same', 'gone' or nil.
function BackstageForeverLinkTake(state,what,code,sender,rank,now)
    if type(state)~='table' or not member(sender) or type(now)~='number' then return nil end
    if what=='code' then
        if not whole(rank,0,1) or BackstageForeverLinkCode(code)~=code then return nil end
        if state.code==code then return 'same' end
        state.code,state.from,state.at,state.prompted=code,sender,now,nil
        return 'new'
    end
    if what=='off' then
        if rank~=0 or not state.code then return nil end
        state.code,state.from,state.at,state.prompted=nil,nil,nil,nil
        return 'gone'
    end
end
-- Pure: true at most once per gap seconds for one key.
function BackstageForeverLiveRate(state,key,now,gap)
    if type(state)~='table' or type(now)~='number' or type(gap)~='number' then return false end
    local last=state[key]
    if type(last)=='number' and now-last<gap and now>=last then return false end
    state[key]=now
    return true
end

-- ---------------------------------------------------------------- pure: signals for the desktop app
-- Every signal is one line: kind and format ("L1"), "Name-Realm" of the character, then its fields
-- with "|" between them. src/core/game-guild-feed.cjs reads them; anything off is dropped whole.
local SIGNAL_MAX=560
BackstageForeverSignalMax=SIGNAL_MAX
function BackstageForeverSignalMe(name,realm)
    realm=strict(realm,60)
    if not person(name) or not realm then return nil end
    return name..'-'..realm
end
local function meOk(me) return type(me)=='string' and #me<=110 and me:match('^[^%-|]+%-[^|]+$') and me or nil end
-- guild.link: your rank, your side (H or A), the code and the guild's name.
function BackstageForeverSignalLink(me,rank,faction,code,guild)
    code=BackstageForeverLinkCode(code);guild=clean(guild,24)
    if not meOk(me) or not code or not guild or #guild<2 or (faction~='H' and faction~='A') or not whole(rank,0,9) then return nil end
    return ('L1|%s|%d|%s|%s|%s'):format(me,rank,faction,code,guild)
end
function BackstageForeverSignalUnlink(me,faction,guild)
    guild=clean(guild,24)
    if not meOk(me) or not guild or #guild<2 or (faction~='H' and faction~='A') then return nil end
    return ('X1|%s|%s|%s'):format(me,faction,guild)
end
-- guild.event: the event exactly as it travels in the guild channel.
function BackstageForeverSignalEvent(me,e)
    local text=type(BackstageForeverEventEncode)=='function' and BackstageForeverEventEncode(e) or nil
    if not meOk(me) or not text then return nil end
    return 'E1|'..me..text:sub(2)
end
-- guild.signup: up to twelve answers to one event. rows: {{n=,s=,v=}}.
function BackstageForeverSignalSignups(me,id,rows)
    if not meOk(me) or not eventId(id) or type(rows)~='table' then return nil end
    local parts,seen={},{}
    for _,row in ipairs(rows) do
        if type(row)=='table' and member(row.n) and STATUS[row.s] and whole(row.v,1,9999) and not seen[row.n:lower()] and #parts<12 then
            seen[row.n:lower()]=true
            parts[#parts+1]=('%s:%s:%d'):format(row.n,row.s,row.v)
        end
    end
    if #parts==0 then return nil end
    return ('U1|%s|%s|%s'):format(me,id,table.concat(parts,','))
end
-- party.state: state = {leader=,place=,planAt=,members={{name=,class=0..9,role='t'|'h'|'d' or nil,
-- level=,online=,ready=}}}. An empty member list says "not in a group". Members that do not fit in
-- the signal are left out; the count at the end is how many there are.
function BackstageForeverSignalParty(me,state)
    if not meOk(me) or type(state)~='table' then return nil end
    local leader=state.leader~=nil and member(state.leader) or nil
    local place=state.place~=nil and placeId(state.place) or nil
    local head=('P1|%s|%s|%s|%d|'):format(me,leader or '-',place or '-',whole(state.planAt,T_MIN,T_MAX) and state.planAt or 0)
    local rows,seen,total,size={},{},0,#head+3
    for _,m in ipairs(type(state.members)=='table' and state.members or {}) do
        if type(m)=='table' and member(m.name) and not seen[m.name:lower()] and total<40 then
            seen[m.name:lower()]=true;total=total+1
            local row=('%s:%d:%s:%d:%d:%d'):format(m.name,whole(m.class,1,9) and m.class or 0,(m.role=='t' or m.role=='h' or m.role=='d') and m.role or '-',
                whole(m.level,1,100) and m.level or 0,m.online==false and 0 or 1,m.ready==true and 1 or 0)
            if size+#row+1<=SIGNAL_MAX then rows[#rows+1]=row;size=size+#row+1 end
        end
    end
    return head..(#rows>0 and table.concat(rows,';') or '-')..'|'..total
end
-- lfg.listing: listing = {id=,kind='g' (you look for a group) or 'm' (your group looks for more),
-- level=,class=0..9,roles='thd' letters,place=,need={t=,h=,d=} or nil,note=} or {id=,gone=true}.
function BackstageForeverSignalListing(me,l)
    if not meOk(me) or type(l)~='table' or not listingId(l.id) then return nil end
    if l.gone==true then return ('F1|%s|%s|x'):format(me,l.id) end
    local roles=type(l.roles)=='string' and l.roles or ''
    if (l.kind~='g' and l.kind~='m') or not whole(l.level,1,100) or not placeId(l.place) or not roles:match('^t?h?d?$') then return nil end
    local need=type(l.need)=='table' and whole(l.need.t,0,9) and whole(l.need.h,0,9) and whole(l.need.d,0,40) and ('%d.%d.%d'):format(l.need.t,l.need.h,l.need.d) or '-'
    local note=l.note~=nil and clean(l.note,60) or nil
    return ('F1|%s|%s|%s|%d|%d|%s|%s|%s|%s'):format(me,l.id,l.kind,l.level,whole(l.class,1,9) and l.class or 0,roles~='' and roles or '-',l.place,need,note or '-')
end

-- ---------------------------------------------------------------- pure: the way out to the live link
-- A short waiting list in front of the live link: one entry per key (a newer party state replaces
-- the one still waiting), at most 24 entries; when it is full the oldest answer somebody else gave
-- goes first. At most one signal every second and a half, and 40 in five minutes.
local BOX_MAX,BOX_GAP,BOX_WINDOW,BOX_LIMIT=24,1.5,300,40
function BackstageForeverOutboxPut(box,key,text)
    if type(box)~='table' or type(key)~='string' or type(text)~='string' or #text==0 or #text>SIGNAL_MAX+40 then return false end
    if type(box.list)~='table' then box.list={} end
    for _,e in ipairs(box.list) do if e.key==key then e.text=text return true end end
    if #box.list>=BOX_MAX then
        local drop=1
        for i,e in ipairs(box.list) do if e.key:sub(1,2)=='u:' then drop=i break end end
        table.remove(box.list,drop)
    end
    box.list[#box.list+1]={key=key,text=text}
    return true
end
-- The entry to send now, or nil (nothing waits, or the pace says wait).
function BackstageForeverOutboxNext(box,now)
    if type(box)~='table' or type(box.list)~='table' or #box.list==0 or type(now)~='number' then return nil end
    if type(box.last)=='number' and now>=box.last and now-box.last<BOX_GAP then return nil end
    if type(box.since)~='number' or now-box.since>=BOX_WINDOW or now<box.since then box.since,box.count=now,0 end
    if (box.count or 0)>=BOX_LIMIT then return nil end
    return box.list[1]
end
-- The first entry is done: sent, or given up.
function BackstageForeverOutboxDone(box,now,sent)
    if type(box)~='table' or type(box.list)~='table' then return end
    table.remove(box.list,1)
    if sent then box.last=now;box.count=(box.count or 0)+1 end
end

-- ---------------------------------------------------------------- pure: what the desktop app handed over
-- data is BackstageForeverDesktopData. Every row is checked; a bad row is left out, never repaired.
-- -> {id=,name=,realm=,discord=,events={event tables},signups={{id=,n=,s=,v=,via=}}} or nil.
function BackstageForeverDeskGuild(data)
    local g=type(data)=='table' and data.schema==1 and data.guild or nil
    if type(g)~='table' or type(g.id)~='string' or #g.id>42 or not g.id:match('^g_[%w_%-]+$') then return nil end
    local out={id=g.id,events={},signups={}}
    if g.n~=nil then out.name=strict(g.n,24) end
    if g.r~=nil then out.realm=strict(g.r,60) end
    out.discord=(g.discord=='pending' or g.discord=='connected' or g.discord=='problem') and g.discord or 'none'
    local seen={}
    for i=1,min(type(g.events)=='table' and #g.events or 0,60) do
        local r=g.events[i]
        if type(r)=='table' and eventId(r[1]) and not seen[r[1]] and whole(r[2],1,9999) and member(r[3]) and (r[4]=='' or member(r[4])) and whole(r[5],T_MIN,T_MAX) and placeId(r[6])
            and whole(r[7],0,9) and whole(r[8],0,9) and whole(r[9],0,40) and (r[10]==0 or r[10]==1) and type(r[11])=='string' and type(r[12])=='string' then
            seen[r[1]]=true
            out.events[#out.events+1]={id=r[1],ver=r[2],creator=r[3],editor=r[4]~='' and r[4] or nil,at=r[5],dungeon=r[6],roles={t=r[7],h=r[8],d=r[9]},
                cancelled=r[10]==1,title=r[11],note=r[12]~='' and r[12] or nil}
        end
    end
    local pair={}
    for i=1,min(type(g.signups)=='table' and #g.signups or 0,600) do
        local r=g.signups[i]
        if type(r)=='table' and eventId(r[1]) and seen[r[1]] and person(r[2]) and STATUS[r[3]] and whole(r[4],1,9999) and VIA[r[5]] and not pair[r[1]..':'..r[2]:lower()] then
            pair[r[1]..':'..r[2]:lower()]=true
            out.signups[#out.signups+1]={id=r[1],n=r[2],s=r[3],v=r[4],via=r[5]}
        end
    end
    return out
end
-- The realm board as of the last reload: rows for your realm and side, newest first, at most 40.
-- -> {{id=,kind=,who=,realm=,level=,class=,roles=,place=,note=,need=,at=}}, and whether a board was handed over at all.
function BackstageForeverDeskBoard(data,realm,faction)
    local l=type(data)=='table' and data.schema==1 and data.lfg or nil
    if type(l)~='table' or type(l.rows)~='table' then return {},false end
    if (l.r~=nil and type(realm)=='string' and l.r~=realm) or (l.f~=nil and type(faction)=='string' and l.f~=faction) then return {},false end
    local out,seen={},{}
    for i=1,min(#l.rows,40) do
        local r=l.rows[i]
        if type(r)=='table' and listingId(r[1]) and not seen[r[1]] and (r[2]=='g' or r[2]=='m') and person(r[3]) and strict(r[4],60) and whole(r[5],1,100) and whole(r[6],0,9)
            and type(r[7])=='string' and r[7]:match('^t?h?d?$') and placeId(r[8]) and type(r[9])=='string' and (r[9]=='' or strict(r[9],60))
            and whole(r[10],-1,9) and whole(r[11],-1,9) and whole(r[12],-1,40) and whole(r[13],T_MIN,T_MAX) and (type(realm)~='string' or r[4]==realm) then
            seen[r[1]]=true
            out[#out+1]={id=r[1],kind=r[2],who=r[3],realm=r[4],level=r[5],class=r[6],roles=r[7],place=r[8],note=r[9]~='' and r[9] or nil,
                need=r[10]>=0 and r[11]>=0 and r[12]>=0 and {t=r[10],h=r[11],d=r[12]} or nil,at=r[13]}
        end
    end
    table.sort(out,function(a,b) if a.at~=b.at then return a.at>b.at end return a.id<b.id end)
    return out,true
end
-- The group plan made in the desktop app. me: "Name-Realm"; a plan made for another character is not yours.
-- -> {place=,note=,at=,members={{name=,role='t'|'h'|'d' or nil,bring=}}} or nil.
function BackstageForeverDeskPlan(data,me)
    local p=type(data)=='table' and data.schema==1 and data.plan or nil
    if type(p)~='table' or type(p.m)~='table' or (p.f~=nil and p.f~=me) then return nil end
    local out={members={}}
    if p.p~=nil and p.p~='' then out.place=placeId(p.p);if not out.place then return nil end end
    if p.n~=nil and p.n~='' then out.note=strict(p.n,80);if not out.note then return nil end end
    out.at=whole(p.t,T_MIN,T_MAX) and p.t or 0
    local seen={}
    for i=1,min(#p.m,40) do
        local r=p.m[i]
        if type(r)~='table' or not person(r[1]) or seen[r[1]:lower()] or not (r[2]=='t' or r[2]=='h' or r[2]=='d' or r[2]=='-') or type(r[3])~='string' or (r[3]~='' and not strict(r[3],60)) then return nil end
        seen[r[1]:lower()]=true
        out.members[#out.members+1]={name=r[1],role=r[2]~='-' and r[2] or nil,bring=r[3]~='' and r[3] or nil}
    end
    if #out.members==0 then return nil end
    return out
end
-- Merges what the app handed over into the events store. ctx = {now=,rank=function(name),
-- member=function(name) -> is that name in your guild list (nil: the list is not known),
-- guild=your guild's name}. A hand-off for another guild is left alone, and so is an event whose
-- creator is not in your guild. -> news = {events={event...},signups={[id]={{n=,s=,v=,via=}}},count=}, why.
function BackstageForeverDeskMerge(db,guild,me,ctx)
    local news={events={},signups={},count=0}
    if type(db)~='table' or type(guild)~='table' or not person(me) or type(ctx)~='table' or type(ctx.now)~='number' then return news,'bad' end
    if guild.name and type(ctx.guild)=='string' and guild.name:lower()~=ctx.guild:lower() then return news,'other' end
    if type(ctx.member)~='function' then return news,'list' end
    for _,e in ipairs(guild.events) do
        if ctx.member(e.creator)==true then
            local result=BackstageForeverEventMergeDesk(db,e,me,ctx)
            if result and result~='quiet' then news.events[#news.events+1]=db.events[e.id];news.count=news.count+1 end
        end
    end
    for _,row in ipairs(guild.signups) do
        if ctx.member(row.n)==true and BackstageForeverEventSignRelay(db,row.id,row.n,row.s,row.v,row.via,me,ctx.now) then
            local list=news.signups[row.id] or {}
            news.signups[row.id]=list
            list[#list+1]={n=row.n,s=row.s,v=row.v,via=row.via}
            news.count=news.count+1
        end
    end
    return news
end
-- What to pass on in the guild channel now. known(key) is the highest version heard there this
-- session ('e'..id, 's'..id..':'..name): what the guild already has is left out, so of twenty
-- members who reloaded together only the first one talks. Your own answer goes as your own.
-- At most 15 events and 30 messages.
function BackstageForeverRelayMessages(news,me,known)
    local out={}
    if type(news)~='table' or type(known)~='function' then return out end
    local events=0
    for _,e in ipairs(type(news.events)=='table' and news.events or {}) do
        if events<15 and (known('e'..e.id) or 0)<e.ver then
            local text=BackstageForeverEventEncode(e)
            if text then out[#out+1]=text;events=events+1 end
        end
    end
    local ids={}
    for id in pairs(type(news.signups)=='table' and news.signups or {}) do ids[#ids+1]=id end
    table.sort(ids)
    for _,id in ipairs(ids) do
        local rest={}
        for _,row in ipairs(news.signups[id]) do
            if (known('s'..id..':'..row.n:lower()) or 0)<row.v then
                if type(me)=='string' and row.n:lower()==me:lower() then out[#out+1]=BackstageForeverEventSignEncode(id,row.v,row.s)
                else rest[#rest+1]=row end
            end
        end
        for _,text in ipairs(BackstageForeverEventRelayEncode(id,rest,4)) do out[#out+1]=text end
    end
    while #out>30 do table.remove(out) end
    return out
end
-- How long to wait before passing news on: 2 seconds plus a random part that grows with the number
-- of guild members online (6 to 30 seconds), so the first one to talk is heard by the others.
function BackstageForeverRelayDelay(rand,online)
    rand=type(rand)=='number' and rand>=0 and rand<1 and rand or 0
    online=type(online)=='number' and online>0 and online or 0
    return 2+rand*max(6,min(30,online*1.5))
end

-- ---------------------------------------------------------------- pure: your own board listing
local ROLE_WORD={tank='t',tanks='t',healer='h',heal='h',heals='h',healers='h',damage='d',dps='d',dd='d'}
-- "sm healer", "brd tank damage : have key", "sm need 1 0 2 : fast run" -> {place=,roles='thd'
-- letters,need={t=,h=,d=} or nil,note=} or nil and why ('place', 'need', 'note').
function BackstageForeverListingParse(text)
    if type(text)~='string' or #text>200 then return nil,'place' end
    local body,note=text:match('^(.-)%s*:%s*(.*)$')
    if not body then body,note=text,nil end
    if note and note:gsub('%s','')~='' then
        -- Plain words only: codes are taken out, a web address refuses the note.
        local tidy
        if type(BackstageForeverEventText)=='function' then tidy=BackstageForeverEventText(note,60) else tidy=clean(note,60) end
        if not tidy then return nil,'note' end
        note=tidy
    else note=nil end
    body=body:lower()
    local need
    local t,h,d=body:match('%f[%a]need%s+(%d+)%s+(%d+)%s+(%d+)')
    if t then
        need={t=tonumber(t),h=tonumber(h),d=tonumber(d)}
        if not whole(need.t,0,9) or not whole(need.h,0,9) or not whole(need.d,0,40) or need.t+need.h+need.d==0 then return nil,'need' end
        body=body:gsub('%f[%a]need%s+%d+%s+%d+%s+%d+',' ')
    elseif body:find('%f[%a]need%f[%A]') then return nil,'need' end
    local has,words={},{}
    for word in body:gmatch('%S+') do
        if ROLE_WORD[word] then has[ROLE_WORD[word]]=true else words[#words+1]=word end
    end
    local place=type(BackstageForeverLfgDungeon)=='function' and BackstageForeverLfgDungeon(table.concat(words,' ')) or nil
    if not placeId(place) then return nil,'place' end
    return {place=place,roles=(has.t and 't' or '')..(has.h and 'h' or '')..(has.d and 'd' or ''),need=need,note=note}
end
-- Your listing from what you typed. rand(): 0..1. A group that asks for players is 'm', a player
-- who looks for a group is 'g'. The id stays the same while the listing stands.
function BackstageForeverListingMake(parsed,level,class,now,rand,old)
    if type(parsed)~='table' or not placeId(parsed.place) or not whole(level,1,100) or not whole(now,T_MIN,T_MAX) then return nil end
    local id=type(old)=='table' and listingId(old.id) or nil
    if not id then
        id=base36(now)
        while #id<16 do
            local r=type(rand)=='function' and rand() or 0
            id=id..DIGITS:sub(floor((type(r)=='number' and r>=0 and r<1 and r or 0)*36)+1,floor((type(r)=='number' and r>=0 and r<1 and r or 0)*36)+1)
        end
        id=id:sub(1,16)
    end
    return {id=id,kind=parsed.need and 'm' or 'g',level=level,class=whole(class,1,9) and class or 0,roles=parsed.roles or '',place=parsed.place,need=parsed.need,note=parsed.note,at=now}
end
local ROLE_NAME={t='tank',h='healer',d='damage'}
-- What a board row is after, in plain words: "plays healer, damage" or "needs 1 tank, 2 damage".
function BackstageForeverListingWanted(l)
    if type(l)~='table' then return '' end
    local words={}
    if l.kind=='m' and type(l.need)=='table' then
        for _,k in ipairs({'t','h','d'}) do if (l.need[k] or 0)>0 then words[#words+1]=l.need[k]..' '..T(ROLE_NAME[k]) end end
        if #words==0 then return T('players') end
        return T('needs')..' '..table.concat(words,', ')
    end
    for letter in (type(l.roles)=='string' and l.roles or ''):gmatch('.') do if ROLE_NAME[letter] then words[#words+1]=T(ROLE_NAME[letter]) end end
    if l.kind=='m' then return #words>0 and (T('needs')..' '..table.concat(words,', ')) or T('players') end
    if #words==0 then return T('wants a group') end
    return T('plays')..' '..table.concat(words,', ')
end
-- A listing leaves the board two hours after you posted it.
local LISTING_KEEP=2*3600
function BackstageForeverListingExpired(l,now)
    return type(l)~='table' or not whole(l.at,T_MIN,T_MAX) or type(now)~='number' or now-l.at>=LISTING_KEEP or l.at>now+300
end

-- ---------------------------------------------------------------- pure: the saved block
-- What goes into the saved file for the desktop app, so nothing is lost while the live link is
-- off: your character, the link, your own answers, and the newest party state and listing as the
-- very text of their signals. -> block and the lists inside it, or nil.
function BackstageForeverLiveBlock(state,me,faction,now,mine,rank,guild)
    if type(state)~='table' or not meOk(me) or not whole(now,T_MIN,T_MAX) then return nil end
    local block={v=1,at=now,me=me}
    local any=false
    if faction=='H' or faction=='A' then block.faction=faction end
    if BackstageForeverLinkCode(state.code)==state.code and state.code and clean(guild,24) and whole(rank,0,9) then block.link={code=state.code,guild=clean(guild,24),rank=rank};any=true
    elseif state.unlinked==true then block.unlinked=true;any=true end
    local lists={}
    if type(mine)=='table' and #mine>0 then
        block.mine={}
        for _,row in ipairs(mine) do if type(row)=='table' and eventId(row.id) and STATUS[row.s] and whole(row.v,1,9999) and #block.mine<60 then block.mine[#block.mine+1]={id=row.id,s=row.s,v=row.v} end end
        lists[1]=block.mine;any=any or #block.mine>0
    end
    if type(state.partySignal)=='string' and #state.partySignal<=SIGNAL_MAX+40 then block.party=state.partySignal;any=true end
    if type(state.listingSignal)=='string' and #state.listingSignal<=SIGNAL_MAX+40 then block.listing=state.listingSignal;any=true end
    if not any then return nil end
    return block,lists
end

-- ---------------------------------------------------------------- live
local clock=time or (os and os.time)
local function epoch() local t=call(clock);return type(t)=='number' and floor(t) or 0 end
local function tick() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function combat() return call(InCombatLockdown)==true end
local function db()
    if type(BackstageForeverLiveGuildDB)~='table' then BackstageForeverLiveGuildDB={} end
    local d=BackstageForeverLiveGuildDB
    if d.code~=nil and BackstageForeverLinkCode(d.code)~=d.code then d.code,d.from,d.at,d.prompted=nil,nil,nil,nil end
    return d
end
BackstageForeverLiveGuildState=db
-- The switch for everything told to the desktop app from here (on unless you switched it off).
function BackstageForeverLiveGuildDesk()
    local d=BackstageForeverLiveGuildDB
    return type(d)~='table' or rawget(d,'desk')~=false
end
local deskOn=BackstageForeverLiveGuildDesk
local function myName() local n=call(UnitName,'player');return type(n)=='string' and n or nil end
local function myRealm() local r=call(GetRealmName);return type(r)=='string' and r or nil end
local function myself() return BackstageForeverSignalMe(myName(),myRealm()) end
BackstageForeverLiveMe=myself
local function side()
    local f=call(UnitFactionGroup,'player')
    return f=='Horde' and 'H' or f=='Alliance' and 'A' or nil
end
BackstageForeverLiveSide=side
local function guildInfo()
    local name,_,rank=call(GetGuildInfo,'player')
    return type(name)=='string' and name or nil,type(rank)=='number' and rank or nil
end
local function internals() return type(BackstageForeverEventsInternals)=='table' and BackstageForeverEventsInternals or nil end
local function capture() if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end end
local function later(seconds,fn)
    local after=field(plain(C_Timer),'After')
    if type(after)=='function' and pcall(after,seconds,function() pcall(fn) end) then return true end
    return false
end
local function random() local r=call(math.random);return type(r)=='number' and r>=0 and r<1 and r or 0 end
local function guildSend(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' or type(text)~='string' then return false end
    local ok,sent=pcall(fn,text,'GUILD')
    return ok and sent==true
end

-- The way out: a waiting list, emptied once a second into the live link.
local box,rate={list={}},{}
-- key: one entry per key waits; text: the signal. Nothing is queued while the switch is off.
function BackstageForeverLiveSend(key,text)
    if not deskOn() or type(text)~='string' then return false end
    return BackstageForeverOutboxPut(box,key,text)
end
local function flushBox()
    if not deskOn() then box.list={} return end
    if combat() then return end
    local at=tick()
    local entry=BackstageForeverOutboxNext(box,at)
    if not entry then return end
    local send=BackstageForeverLiveSignal
    if type(send)~='function' then box.list={} return end
    local ok,id,why=pcall(send,entry.text,entry.key)
    if ok and id then return BackstageForeverOutboxDone(box,at,true) end
    -- The live link is off, or the text does not fit: the saved file still carries it.
    if not ok or why=='off' or why=='invalid' then BackstageForeverOutboxDone(box,at,false) end
end
BackstageForeverLiveFlush=flushBox -- for tests

-- Answers heard a moment ago, by event, to go out together.
local signs={}
local function flushSigns()
    local me=myself()
    for id,rows in pairs(signs) do
        local batch={}
        for i=1,#rows do
            batch[#batch+1]=rows[i]
            if #batch==12 or i==#rows then
                rate.signSeq=(rate.signSeq or 0)+1
                local text=me and BackstageForeverSignalSignups(me,id,batch)
                if text then BackstageForeverLiveSend('u:'..id..':'..rate.signSeq,text) end
                batch={}
            end
        end
    end
    signs={}
end
-- BackstageForeverEvents.lua calls this for every event and answer that is new here.
function BackstageForeverLiveGuildHeard(what,a,b,c,d)
    if not deskOn() then return end
    local me=myself()
    if not me then return end
    if what=='event' and type(a)=='table' then
        local text=BackstageForeverSignalEvent(me,a)
        if text then BackstageForeverLiveSend('e:'..a.id,text) end
    elseif what=='signup' and eventId(a) and member(b) and STATUS[c] and whole(d,1,9999) then
        local mine=myName() and b:lower()==myName():lower()
        if mine then
            -- Your own answer goes at once.
            local text=BackstageForeverSignalSignups(me,a,{{n=b,s=c,v=d}})
            if text then BackstageForeverLiveSend('u:'..a..':me',text) end
            return
        end
        local rows=signs[a] or {}
        signs[a]=rows
        for i=#rows,1,-1 do if rows[i].n:lower()==b:lower() then table.remove(rows,i) end end
        if #rows<40 then rows[#rows+1]={n=b,s=c,v=d} end
        if not rate.signTimer then
            rate.signTimer=later(5,function() rate.signTimer=nil;flushSigns() end)
            if not rate.signTimer then flushSigns() end
        end
    end
end

-- The link.
local function signalLink()
    local d=db()
    local guild,rank=guildInfo()
    local me,faction=myself(),side()
    if not d.code or not guild or not rank or not me or not faction then return false end
    local text=BackstageForeverSignalLink(me,min(rank,9),faction,d.code,guild)
    return text~=nil and BackstageForeverLiveSend('l',text)
end
local PROMPT='Your guild uses Backstage Forever events. Open the desktop app to join.'
local promptFrame
local function showPrompt()
    local d=db()
    if not d.code or d.prompted==d.code or d.joined==d.code then return false end
    if combat() then rate.promptDue=true return false end
    rate.promptDue=nil
    d.prompted=d.code
    say(PROMPT)
    if type(CreateFrame)~='function' or not UIParent then return true end
    pcall(function()
        if not promptFrame then
            local f=CreateFrame('Frame','BackstageForeverGuildPrompt',UIParent)
            f:Hide();f:SetSize(420,118);f:SetPoint('TOP',UIParent,'TOP',0,-160)
            f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true)
            if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
            if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
            else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
            local title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
            title:SetPoint('TOP',0,-14);title:SetWidth(380);title:SetWordWrap(false);title:SetText(T('Guild events'))
            f.body=f:CreateFontString(nil,'OVERLAY','GameFontHighlight')
            f.body:SetPoint('TOP',0,-36);f.body:SetSize(380,34);f.body:SetJustifyH('CENTER');f.body:SetJustifyV('TOP');f.body:SetWordWrap(true)
            local ok=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
            ok:SetSize(110,22);ok:SetPoint('BOTTOM',0,14);ok:SetText(T('OK'));ok:SetScript('OnClick',function() f:Hide() end)
            f:RegisterEvent('PLAYER_REGEN_DISABLED');f:SetScript('OnEvent',function() f:Hide() end)
            if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverGuildPrompt') end
            promptFrame=f
        end
        promptFrame.body:SetText(T(PROMPT))
        promptFrame:Show()
    end)
    return true
end
local function senderRank(sender)
    local I=internals()
    if not I then return nil end
    pcall(I.readRanks)
    local ok,rank=pcall(I.rank,sender)
    return ok and type(rank)=='number' and rank or nil
end
local function announceCode(force)
    local d=db()
    local _,rank=guildInfo()
    if not d.code or not rank or rank>1 then return false end
    if not BackstageForeverLiveRate(rate,'announce',tick(),force and 10 or 180) then return false end
    return guildSend(BackstageForeverLinkEncode(d.code))
end
local function onLink(sender,message)
    if not deskOn() then return end
    local what,code=BackstageForeverLinkDecode(message)
    if not what then return end
    if not BackstageForeverLiveRate(rate,'in:'..sender:lower(),tick(),2) then return end
    local d=db()
    if what=='ask' then
        -- A member who came online asks. A leader or officer who holds the code answers after a
        -- short random wait, unless somebody else did in the meantime, at most every three minutes.
        local _,rank=guildInfo()
        if not d.code or not rank or rank>1 then return end
        rate.answered=nil
        if not later(1+random()*5,function() if not rate.answered then announceCode(false) end end) then announceCode(false) end
        return
    end
    if what=='code' and d.code==code then rate.answered=true end
    local result=BackstageForeverLinkTake(d,what,code,sender,senderRank(sender),epoch())
    if result=='new' then
        d.unlinked=nil
        signalLink();showPrompt();capture()
    elseif result=='gone' then
        d.unlinked=true;d.joined=nil
        local guild=guildInfo()
        local me,faction=myself(),side()
        local text=me and faction and guild and BackstageForeverSignalUnlink(me,faction,guild)
        if text then BackstageForeverLiveSend('l',text) end
        if not combat() then say(('%s took away the guild\'s link to the desktop app. Guild events in game work as before.'):format(sender)) end
        capture()
    end
end
local function linkCommand(arg)
    local d=db()
    local guild,rank=guildInfo()
    if call(IsInGuild)~=true or not guild then return say('You are not in a guild.') end
    if arg=='' then
        if d.code then
            if rank and rank<=1 then
                if announceCode(true) then say('The guild link went to guild members who run Backstage Forever again. They join in the desktop app.')
                else say('The guild link was sent a moment ago. Members who come online ask for it by themselves.') end
            else
                d.prompted=nil
                if not showPrompt() and d.joined==d.code then say('Your guild is linked and you joined it in the desktop app.') end
            end
            signalLink()
            return
        end
        if rank and rank<=1 then return say('No guild link yet. In the desktop app, open Plans, Guild and choose Link my guild. Then type /bf guild link and the code shown there.') end
        if BackstageForeverLiveRate(rate,'ask',tick(),600) then guildSend('K?') end
        return say('No guild link heard yet. The guild leader or an officer sets it with a code from the desktop app. Asked again.')
    end
    local code=BackstageForeverLinkCode(arg)
    if not code then return say('That is not a guild link code. It looks like BFG-7K2M-Q9XD: copy it from the desktop app.') end
    if not rank or rank>1 then return say('Only the guild leader or the rank below sets the guild link.') end
    d.code,d.from,d.at,d.prompted,d.unlinked=code,myName(),epoch(),code,nil
    rate.announce=nil
    local sent=announceCode(true)
    signalLink();capture()
    say(sent and 'Guild link set. It went to guild members who run Backstage Forever, not to chat. They are asked to join in the desktop app.'
        or 'Guild link set. It could not be sent to the guild right now; members who come online ask for it by themselves.')
    if type(BackstageForeverEventsOn)=='function' and not BackstageForeverEventsOn() then say('Guild events are off on this character. /bf event on shows the guild\'s events and sign-ups in game.') end
end
local function unlinkCommand()
    local d=db()
    local guild,rank=guildInfo()
    if call(IsInGuild)~=true or not guild then return say('You are not in a guild.') end
    if rank~=0 then return say('Only the guild leader takes the guild link away.') end
    if not d.code then return say('No guild link is set.') end
    d.code,d.from,d.at,d.prompted,d.joined,d.unlinked=nil,nil,nil,nil,nil,true
    guildSend('K|-')
    local me,faction=myself(),side()
    local text=me and faction and BackstageForeverSignalUnlink(me,faction,guild)
    if text then BackstageForeverLiveSend('l',text) end
    capture()
    say('Guild link taken away here and for guild members in game. To remove the guild\'s page and its data, use Delete guild in the desktop app.')
end
-- /bf guild link [CODE], /bf guild unlink, /bf guild desk on|off. -> true when it was one of these.
function BackstageForeverLiveGuildCommand(message)
    if type(message)~='string' or #message>120 then return false end
    local word,arg=message:match('^%a+%s+(%a+)%s*(.-)%s*$')
    word=word and word:lower() or ''
    if word=='link' then linkCommand(arg) return true end
    if word=='unlink' then unlinkCommand() return true end
    if word=='desk' then
        arg=arg:lower()
        local d=db()
        if arg=='on' or arg=='off' then d.desk=arg=='on' end
        if d.desk==false then box.list={} end
        say(d.desk~=false and 'To the desktop app: on. Guild events, sign-ups, your party and your board listing are told to the app on this computer over the live link, within seconds.'
            or 'To the desktop app: off. The app learns of events and sign-ups only from your saved file, after /reload or logout.')
        if d.desk~=false then
            local s=BackstageForeverLiveSettings
            if type(s)=='table' and rawget(s,'enabled')==false then say('The live link is off, so it waits for your next /reload all the same. /bf live on turns it on.') end
        end
        return true
    end
    return false
end

-- What the desktop app handed over at this login or /reload.
local board,boardGiven={},false
function BackstageForeverLfgDeskRows() return board,boardGiven end
local function online()
    local n,on=call(GetNumGuildMembers)
    return type(on)=='number' and on or (type(n)=='number' and n or 0)
end
local function relay(news)
    local I=internals()
    if not I or type(BackstageForeverEventsOn)~='function' or not BackstageForeverEventsOn() then return end
    local list=BackstageForeverRelayMessages(news,myName(),I.known)
    for _,text in ipairs(list) do pcall(I.push,text) end
end
local readDesk
readDesk=function(attempt)
    local data=plain(BackstageForeverDesktopData)
    local d=db()
    board,boardGiven=BackstageForeverDeskBoard(data,myRealm(),side())
    local guild=BackstageForeverDeskGuild(data)
    if not guild then return end
    -- The app holds your membership: no prompt for a guild you already joined.
    if d.code then d.joined=d.code end
    local I=internals()
    if not I or type(BackstageForeverEventsOn)~='function' then return end
    if #guild.events==0 and #guild.signups==0 then return end
    if not BackstageForeverEventsOn() then
        if not combat() then say('The desktop app has guild events for you. /bf event on shows them in game and shares your answers with the guild.') end
        return
    end
    if call(IsInGuild)~=true then return end
    local mine=guildInfo()
    pcall(I.readRanks)
    local listed=I.listed()
    -- Without the guild list nobody can be checked: wait for it, three more times at most.
    if not listed then
        attempt=type(attempt)=='number' and attempt or 0
        if attempt<3 then later(15,function() readDesk(attempt+1) end) end
        return
    end
    local news=BackstageForeverDeskMerge(I.db(),guild,myName(),{now=I.epoch(),rank=I.rank,guild=mine,member=I.inGuild})
    if news.count==0 then return end
    I.capture();I.refresh()
    if not combat() then say(('From the desktop app: %d new or changed guild events and answers. /bf events lists them.'):format(news.count)) end
    -- Pass the news on after a random wait; what the guild said in the meantime is left out then.
    local wait=BackstageForeverRelayDelay(random(),online())
    if not later(wait,function() relay(news) end) then relay(news) end
end
BackstageForeverLiveReadDesk=readDesk -- for tests

-- Your own listing on the realm board.
local function listingSignal(l)
    local me=myself()
    local text=me and BackstageForeverSignalListing(me,l)
    if not text then return false end
    db().listingSignal=text
    BackstageForeverLiveSend('f',text)
    capture()
    return true
end
local function removeListing(quiet)
    local d=db()
    if type(d.listing)~='table' then return false end
    local id=d.listing.id
    d.listing=nil
    listingSignal({id=id,gone=true})
    if not quiet then say('Your board listing is taken down. The desktop app removes it from the realm board; it must be running.') end
    return true
end
-- /bf lfg list ...: -> true when it handled the call (the bare "list" stays with the chat board).
function BackstageForeverListingCommand(tail)
    if type(tail)~='string' then return false end
    tail=tail:match('^%s*(.-)%s*$')
    local d=db()
    if tail=='' then
        if type(d.listing)=='table' and not BackstageForeverListingExpired(d.listing,epoch()) then
            local name=type(BackstageForeverLfgName)=='function' and BackstageForeverLfgName(d.listing.place) or d.listing.place
            say(('Your board listing: %s, %s. /bf lfg list off takes it down.'):format(name,BackstageForeverListingWanted(d.listing)))
        end
        return false
    end
    if tail:lower()=='off' or tail:lower()=='remove' then
        if not removeListing(false) then say('You have no listing on the realm board.') end
        return true
    end
    if combat() then say('Post your listing outside combat.') return true end
    if not deskOn() then say('To the desktop app is off, so a listing cannot reach the realm board. /bf guild desk on turns it on.') return true end
    local parsed,why=BackstageForeverListingParse(tail)
    if not parsed then
        say(why=='need' and 'Say how many you need as three numbers: tanks, healers, damage. Example: /bf lfg list sm need 1 0 2.'
            or why=='note' and 'The note must be plain words without links.'
            or 'Name a dungeon the board knows. Examples: /bf lfg list sm healer, /bf lfg list brd need 1 1 2 : have the key.')
        return true
    end
    if not BackstageForeverLiveRate(rate,'listing',tick(),20) then say('You changed your listing a moment ago. Wait a little.') return true end
    local level=call(UnitLevel,'player')
    local _,classFile=call(UnitClass,'player')
    local l=BackstageForeverListingMake(parsed,type(level)=='number' and floor(level) or nil,CLASS[classFile or ''],epoch(),random,d.listing)
    if not l or not listingSignal(l) then say('Your listing could not be made. Try again in a moment.') return true end
    d.listing=l
    local name=type(BackstageForeverLfgName)=='function' and BackstageForeverLfgName(l.place) or l.place
    say(('Board listing: %s, %s. The desktop app posts it to the realm board for your realm and side: it must be running, with the realm board switched on there. /bf lfg list off takes it down.'):format(name,BackstageForeverListingWanted(l)))
    local s=BackstageForeverLiveSettings
    if type(s)=='table' and rawget(s,'enabled')==false then say('The live link is off, so the app sees the listing only after your next /reload. /bf live on turns it on.') end
    return true
end

-- The optional capture block (BackstageForever.lua puts it in the saved file).
function BackstageForeverLiveGuildSnapshot()
    if type(BackstageForeverLiveGuildDB)~='table' or not deskOn() then return nil end
    local now=epoch()
    if now<T_MIN then return nil end
    local d=db()
    local mine={}
    local I=internals()
    local name=myName()
    if I and name and type(BackstageForeverEventsOn)=='function' and BackstageForeverEventsOn() then
        local ok,store=pcall(I.db)
        for id,e in pairs(ok and type(store)=='table' and type(store.events)=='table' and store.events or {}) do
            if type(e)=='table' and not e.cancelled and type(e.signups)=='table' then
                for who,row in pairs(e.signups) do
                    if type(who)=='string' and who:lower()==name:lower() and type(row)=='table' then mine[#mine+1]={id=id,s=row.s,v=row.v} end
                end
            end
        end
        table.sort(mine,function(a,b) return a.id<b.id end)
    end
    local guild,rank=guildInfo()
    return BackstageForeverLiveBlock(d,myself(),side(),now,mine,rank and min(rank,9) or nil,guild)
end

if type(BackstageForeverPartyHandle)=='function' then BackstageForeverPartyHandle('K',onLink,'GUILD') end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_REGEN_ENABLED'}) do pcall(frame.RegisterEvent,frame,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'LiveGuild',frame) end
        pcall(frame.SetScript,frame,'OnEvent',function(_,event)
            if event=='PLAYER_REGEN_ENABLED' then if rate.promptDue then pcall(showPrompt) end return end
            pcall(db)
            local timer=plain(C_Timer)
            if type(timer)=='table' and type(timer.NewTicker)=='function' then pcall(timer.NewTicker,1,function() pcall(flushBox) end) end
            -- The guild list has to be there before anything is merged: ask for it, then wait.
            later(8,function()
                if call(IsInGuild)~=true then return end
                local request=field(plain(C_GuildInfo),'GuildRoster') or plain(GuildRoster)
                if type(request)=='function' then pcall(request) end
            end)
            later(24+random()*4,function()
                readDesk()
                local d=db()
                if type(d.listing)=='table' and BackstageForeverListingExpired(d.listing,epoch()) then removeListing(true) end
                if not deskOn() or call(IsInGuild)~=true then return end
                if d.code then signalLink();showPrompt()
                elseif BackstageForeverLiveRate(rate,'ask',tick(),600) then guildSend('K?') end
            end)
        end)
    end
end

-- Guild events and sign-ups (roadmap "Social and guild"). Off until you switch it on; off means
-- nothing is sent and nothing is read.
--   /bf event on|off        this character's switch         /bf event          the window
--   /bf event add           propose an event (a small window: title, place, day, time, roles, note)
--   /bf events              the list in chat
--   /bf event yes tank|healer|damage [N]   /bf event maybe [N]   /bf event no [N]   your answer
--   /bf event cancel N      (creator, or a rank the guild leader allowed) calls event N off
--   /bf event policy propose N|anyone, /bf event policy edit N|creator   (guild leader only)
--   /bf event loot on|off   note who won rare or better items in a guild-event run (off; local only)
-- Everything travels over the game's own guild addon messages, between guild members who run the
-- addon and switched this on, through the party sync channel code (BackstageForeverParty.lua):
--   E?                      "what events do you know?" (after login, at most every 5 minutes)
--   E|id|version|creator|editor|time|place|tanks.healers.damage|flag|title|note    one event
--   U|id|version|answer     your own sign-up        L|id|Name:answer:version,...  the creator's list
--   P|version|propose|edit  who may propose and edit, from the guild leader only
--   V|id|Name:answer:version:via,...   answers the desktop app handed over (given in Discord or in
--                           the app), passed on by a member who reloaded; taken only when newer
-- An event is changed only by a message from its creator (or from a rank the guild leader allowed);
-- a copy passed on by somebody else is taken only for an event you did not know yet, and the
-- creator's own message replaces it. The higher version wins; at the same version the later name
-- in the alphabet wins, so everybody ends with the same event. Text is plain: colour codes, links
-- and web addresses are refused. At most 20 events, 40 sign-ups each; an event leaves the list
-- four hours after it began and is kept as history (30 events, 90 days) on this computer.
-- Names here are character names as the guild channel gives them. They stay in that channel and
-- in your saved file for the desktop app; nothing is sent to any server.
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
    for i=2,15 do r[i]=plain(r[i]) end
    return unpackAll(r,2,15)
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

-- ---------------------------------------------------------------- pure
local TITLE_MAX,NOTE_MAX,EVENTS_MAX,PER_CREATOR,SIGNUPS_MAX,PAST_MAX=40,80,20,5,40,30
local AFTER,AHEAD,PAST_KEEP,REMIND=4*3600,180*86400,90*86400,15*60
local PRESENT_MAX,LOOT_MAX,BOOK_MAX,BOOK_KEEP,CRAFTS_MAX=40,60,100,60*86400,12
local T_MIN,T_MAX=1000000000,9999999999
local STATUS={t=true,h=true,d=true,m=true,n=true}
BackstageForeverEventLimits={title=TITLE_MAX,note=NOTE_MAX,events=EVENTS_MAX,perCreator=PER_CREATOR,signups=SIGNUPS_MAX,past=PAST_MAX,after=AFTER,ahead=AHEAD,remind=REMIND}
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
-- Pure: does a text hold a web address? Events carry plain words only.
function BackstageForeverEventLinky(text)
    if type(text)~='string' then return false end
    local t=text:lower()
    if t:find('://',1,true) or t:find('www.',1,true) or t:find('.gg/',1,true) then return true end
    for _,ending in ipairs({'com','net','org','gg','io','ru','tv'}) do
        if t:find('%w%.'..ending..'%f[%A]') then return true end
    end
    return false
end
-- Pure: one line of plain text of at most max bytes, or nil: colour and link codes are taken
-- out, a web address refuses the whole text.
function BackstageForeverEventText(text,limit)
    if type(text)~='string' or #text>1000 or type(limit)~='number' then return nil end
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|T[^|]*|t',''):gsub('|[hrn]',''):gsub('[|%c]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text>limit then text=text:sub(1,limit):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    if text=='' or BackstageForeverEventLinky(text) then return nil end
    return text
end
local tidy=BackstageForeverEventText
-- Pure: a guild member's name as the channel gives it: letters and an optional -Realm.
local function memberName(name)
    if type(name)~='string' or #name<2 or #name>48 or name:find('[%d%c%s|:,]') then return nil end
    if name:find('%p') and not name:match('^[^%p]+%-[^%p]+$') then return nil end
    return name
end
BackstageForeverEventName=memberName
local function same(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
local function eventId(id) return type(id)=='string' and #id>=6 and #id<=10 and id:match('^[%l%d]+$') and id or nil end
local function place(id) return type(id)=='string' and #id<=8 and id:match('^%l[%l%d]*$') and id or nil end
local DIGITS='0123456789abcdefghijklmnopqrstuvwxyz'
local function base36(n)
    n=floor(n)
    local out=''
    repeat local d=n%36;out=DIGITS:sub(d+1,d+1)..out;n=(n-d)/36 until n<=0
    return out
end
-- Pure: an event's fields made clean, or nil. strict: text must already be clean (what arrives
-- is refused, never repaired).
local function wire(e,strict)
    if type(e)~='table' then return nil end
    local roles=type(e.roles)=='table' and e.roles or {}
    local creator=memberName(e.creator)
    local editor=e.editor~=nil and memberName(e.editor) or nil
    if not eventId(e.id) or not whole(e.ver,1,9999) or not creator or (e.editor~=nil and not editor) or not whole(e.at,T_MIN,T_MAX)
        or not place(e.dungeon) or not whole(roles.t,0,9) or not whole(roles.h,0,9) or not whole(roles.d,0,40) then return nil end
    local title=tidy(e.title,TITLE_MAX)
    local note=e.note~=nil and tidy(e.note,NOTE_MAX) or nil
    if not title or #title<2 or (e.note~=nil and not note) or (strict and (title~=e.title or note~=e.note)) then return nil end
    if note=='-' then note=nil end
    if editor and same(editor,creator) then editor=nil end
    return {id=e.id,ver=e.ver,creator=creator,editor=editor,at=e.at,dungeon=e.dungeon,roles={t=roles.t,h=roles.h,d=roles.d},
        cancelled=e.cancelled==true or nil,title=title,note=note}
end
-- Pure: one event as one message of at most 255 bytes; a long note is cut to make it fit.
function BackstageForeverEventEncode(e)
    local c=wire(e,false)
    if not c then return nil end
    local function build(note)
        return ('E|%s|%d|%s|%s|%d|%s|%d.%d.%d|%s|%s|%s'):format(c.id,c.ver,c.creator,c.editor or '-',c.at,c.dungeon,c.roles.t,c.roles.h,c.roles.d,c.cancelled and 'x' or '-',c.title,note or '-')
    end
    local text=build(c.note)
    if #text>255 and c.note then text=build(tidy(c.note,max(1,#c.note-(#text-255)))) end
    if #text>255 then return nil end
    return text
end
local function number(text,digits)
    if type(text)~='string' or #text<1 or #text>digits or not text:match('^%d+$') then return nil end
    local n=tonumber(text)
    if tostring(n)~=text then return nil end
    return n
end
-- Pure: a message back into an event, or nil when anything about it is off. now (seconds): also
-- refuse an event that is over or more than half a year ahead.
function BackstageForeverEventDecode(message,now)
    if type(message)~='string' or #message>255 then return nil end
    local id,ver,creator,editor,at,dungeon,t,h,d,flag,title,note=message:match('^E|([%l%d]+)|(%d+)|([^|]+)|([^|]+)|(%d+)|(%l[%l%d]*)|(%d)%.(%d)%.(%d%d?)|([x%-])|([^|]+)|([^|]+)$')
    if not id then return nil end
    ver,at,d=number(ver,4),number(at,10),number(d,2)
    if not ver or not at or not d then return nil end
    local e=wire({id=id,ver=ver,creator=creator,editor=editor~='-' and editor or nil,at=at,dungeon=dungeon,roles={t=tonumber(t),h=tonumber(h),d=d},
        cancelled=flag=='x',title=title,note=note~='-' and note or nil},true)
    if not e then return nil end
    if editor~='-' and not e.editor then return nil end
    if type(now)=='number' and (e.at<now-AFTER or e.at>now+AHEAD) then return nil end
    return e
end
function BackstageForeverEventSignEncode(id,ver,status)
    if not eventId(id) or not whole(ver,1,9999) or not STATUS[status] then return nil end
    return ('U|%s|%d|%s'):format(id,ver,status)
end
function BackstageForeverEventSignDecode(message)
    if type(message)~='string' or #message>24 then return nil end
    local id,ver,status=message:match('^U|([%l%d]+)|(%d+)|([thdmn])$')
    ver=number(ver,4)
    if not eventId(id) or not ver or ver<1 then return nil end
    return id,ver,status
end
local function signRows(e)
    local rows={}
    for name,row in pairs(type(e)=='table' and type(e.signups)=='table' and e.signups or {}) do
        if memberName(name) and type(row)=='table' and STATUS[row.s] and whole(row.v,1,9999) then rows[#rows+1]={n=name,s=row.s,v=row.v} end
    end
    table.sort(rows,function(a,b) return a.n:lower()<b.n:lower() end)
    return rows
end
-- Pure: the sign-ups of one event as messages "L|id|Name:t:1,Name:m:2" of at most 255 bytes each.
-- (R belongs to party sync itself.)
function BackstageForeverEventRosterEncode(e,limit)
    local out={}
    if type(e)~='table' or not eventId(e.id) then return out end
    local head='L|'..e.id..'|'
    local current,count=head,0
    for _,row in ipairs(signRows(e)) do
        local part=('%s:%s:%d'):format(row.n,row.s,row.v)
        if count>0 and (#current+1+#part>255 or count>=12) then out[#out+1]=current;current,count=head,0 end
        current=current..(count>0 and ',' or '')..part;count=count+1
    end
    if count>0 then out[#out+1]=current end
    limit=type(limit)=='number' and limit or 4
    while #out>limit do table.remove(out) end
    return out
end
-- Pure: -> id, {{n=,s=,v=}} or nil when any entry is off.
function BackstageForeverEventRosterDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local id,body=message:match('^L|([%l%d]+)|([^|]+)$')
    if not eventId(id) or body:sub(1,1)==',' or body:sub(-1)==',' or body:find(',,',1,true) then return nil end
    local rows,seen={},{}
    for entry in body:gmatch('[^,]+') do
        local name,status,ver=entry:match('^([^:]+):([thdmn]):(%d+)$')
        ver=number(ver,4)
        if not memberName(name) or not ver or ver<1 or seen[name:lower()] or #rows>=12 then return nil end
        seen[name:lower()]=true
        rows[#rows+1]={n=name,s=status,v=ver}
    end
    if #rows==0 then return nil end
    return id,rows
end
-- Pure: who may propose and edit. propose: the lowest guild rank that may propose (rank index, 0
-- is the guild leader; nil: anyone). edit: the lowest rank that may change other members' events
-- (nil: only the creator).
function BackstageForeverEventPolicyEncode(policy)
    if type(policy)~='table' or not whole(policy.ver,1,9999) or (policy.propose~=nil and not whole(policy.propose,0,9)) or (policy.edit~=nil and not whole(policy.edit,0,9)) then return nil end
    return ('P|%d|%s|%s'):format(policy.ver,policy.propose and tostring(policy.propose) or '-',policy.edit and tostring(policy.edit) or '-')
end
function BackstageForeverEventPolicyDecode(message)
    if type(message)~='string' or #message>12 then return nil end
    local ver,propose,edit=message:match('^P|(%d+)|([%d%-])|([%d%-])$')
    ver=number(ver,4)
    if not ver or ver<1 then return nil end
    return {ver=ver,propose=tonumber(propose),edit=tonumber(edit)}
end
-- Pure: may a member of this guild rank do it? kind: 'propose' or 'edit' (somebody else's event).
function BackstageForeverEventAllowed(policy,kind,rank)
    policy=type(policy)=='table' and policy or {}
    if kind=='propose' then
        if policy.propose==nil then return true end
        return type(rank)=='number' and rank<=policy.propose
    end
    if kind=='edit' then
        if policy.edit==nil then return false end
        return type(rank)=='number' and rank<=policy.edit
    end
    return false
end
local allowed=BackstageForeverEventAllowed
local function rankOf(ctx,name)
    if type(ctx)=='table' and type(ctx.rank)=='function' then
        local ok,rank=pcall(ctx.rank,name)
        if ok and type(rank)=='number' then return rank end
    end
end
local function events(db)
    if type(db.events)~='table' then db.events={} end
    return db.events
end
local function archive(e)
    local out={id=e.id,title=e.title,dungeon=e.dungeon,at=e.at,creator=e.creator,roles={t=e.roles.t,h=e.roles.h,d=e.roles.d},note=e.note,signups={},present={},loot={}}
    for _,row in ipairs(signRows(e)) do out.signups[#out.signups+1]={n=row.n,s=row.s} end
    for _,name in ipairs(type(e.present)=='table' and e.present or {}) do if memberName(name) and #out.present<PRESENT_MAX then out.present[#out.present+1]=name end end
    for _,row in ipairs(type(e.loot)=='table' and e.loot or {}) do
        if type(row)=='table' and whole(row.i,1,2147483647) and memberName(row.w) and whole(row.at,T_MIN,T_MAX) and #out.loot<LOOT_MAX then out.loot[#out.loot+1]={i=row.i,w=row.w,at=row.at} end
    end
    return out
end
-- Pure: events that began more than four hours ago leave the list and become history; history
-- keeps 30 events for 90 days. -> how many left the list.
function BackstageForeverEventPrune(db,now)
    local gone=0
    if type(db)~='table' or type(now)~='number' then return gone end
    if type(db.past)~='table' then db.past={} end
    for id,e in pairs(events(db)) do
        local clean=type(e)=='table' and wire(e,false)
        if not clean or clean.id~=id then db.events[id]=nil;gone=gone+1
        elseif e.at+AFTER<now then
            db.events[id]=nil;gone=gone+1
            if not e.cancelled then db.past[#db.past+1]=archive(e) end
        end
    end
    for i=#db.past,1,-1 do
        local row=db.past[i]
        if type(row)~='table' or not whole(row.at,T_MIN,T_MAX) or row.at<now-PAST_KEEP then table.remove(db.past,i) end
    end
    table.sort(db.past,function(a,b) if a.at~=b.at then return a.at<b.at end return tostring(a.id)<tostring(b.id) end)
    while #db.past>PAST_MAX do table.remove(db.past,1) end
    return gone
end
local function size(t) local n=0 for _ in pairs(t) do n=n+1 end return n end
local function ownedBy(db,creator)
    local n=0
    for _,e in pairs(events(db)) do if type(e)=='table' and same(e.creator,creator) and not e.cancelled then n=n+1 end end
    return n
end
-- Pure: takes one event that arrived from sender. ctx = {now=seconds, rank=function(name) -> guild
-- rank index or nil}. -> 'new', 'changed', 'cancelled', 'quiet' (kept, nothing to announce) or nil.
function BackstageForeverEventMerge(db,e,sender,ctx)
    sender=memberName(sender)
    local c=wire(e,true)
    if type(db)~='table' or not c or not sender or type(ctx)~='table' or type(ctx.now)~='number' then return nil end
    local now=ctx.now
    if c.at<now-AFTER or c.at>now+AHEAD then return nil end
    local list=events(db)
    local author=c.editor or c.creator
    local direct=same(sender,author)
    local old=list[c.id]
    if type(old)~='table' then old=nil end
    if old then
        if not same(old.creator,c.creator) then return nil end
        if direct then
            if c.editor and not allowed(db.policy,'edit',rankOf(ctx,sender)) then return nil end
            local oldAuthor=old.editor or old.creator
            -- What its author says replaces hearsay; otherwise the higher version, then the later name.
            if not (old.relayed~=nil or c.ver>old.ver or (c.ver==old.ver and author:lower()>oldAuthor:lower())) then return nil end
        elseif old.relayed==nil or c.ver<=old.ver then return nil end
    else
        if direct then
            if not allowed(db.policy,c.editor and 'edit' or 'propose',rankOf(ctx,sender)) then return nil end
        elseif not allowed(db.policy,'propose',rankOf(ctx,c.creator)) then return nil end
        if size(list)>=EVENTS_MAX then BackstageForeverEventPrune(db,now) end
        if size(list)>=EVENTS_MAX or (not c.cancelled and ownedBy(db,c.creator)>=PER_CREATOR) then return nil end
    end
    c.signups=old and type(old.signups)=='table' and old.signups or {}
    c.present,c.loot=old and old.present or nil,old and old.loot or nil
    c.reminded=old and old.at==c.at and old.reminded or nil
    c.relayed=(not direct) and sender or nil
    c.heard=now
    local was=old and old.cancelled==true
    local unchanged=old and old.ver==c.ver and old.at==c.at and old.title==c.title and old.note==c.note and old.dungeon==c.dungeon and was==(c.cancelled==true)
        and old.roles.t==c.roles.t and old.roles.h==c.roles.h and old.roles.d==c.roles.d
    list[c.id]=c
    if unchanged then return 'quiet' end
    if c.cancelled then return (old and not was) and 'cancelled' or 'quiet' end
    return (old and not was) and 'changed' or 'new'
end
local function signKey(e,name)
    for key in pairs(e.signups) do if same(key,name) then return key end end
    return name
end
-- Pure: takes one sign-up. A member speaks for themselves; the event's creator may pass on the
-- answers they collected. -> true when it changed something.
function BackstageForeverEventSign(db,id,name,status,ver,sender,now)
    name,sender=memberName(name),memberName(sender)
    local e=type(db)=='table' and eventId(id) and events(db)[id] or nil
    if type(e)~='table' or not name or not sender or not STATUS[status] or not whole(ver,1,9999) or type(now)~='number' then return false end
    if e.cancelled or now>e.at+AFTER then return false end
    local direct=same(sender,name)
    if not direct and not same(sender,e.creator) then return false end
    if type(e.signups)~='table' then e.signups={} end
    local key=signKey(e,name)
    local old=e.signups[key]
    if type(old)=='table' and whole(old.v,1,9999) then
        if direct then
            if not (old.r or ver>old.v) then return false end
        elseif ver<=old.v then return false end
    elseif size(e.signups)>=SIGNUPS_MAX then return false end
    e.signups[key]={s=status,v=ver,r=(not direct) or nil}
    return true
end
local VIA={g=true,k=true,d=true}
-- Pure: takes one answer that came through the desktop app (its hand-off file, or a guild member
-- passing theirs on): given in game by somebody ('g'), in the desktop app ('k') or in Discord ('d').
-- Only a newer version is taken. me: your own name; an answer of your own counts as yours.
-- -> true when it changed something.
function BackstageForeverEventSignRelay(db,id,name,status,ver,via,me,now)
    name=memberName(name)
    local e=type(db)=='table' and eventId(id) and events(db)[id] or nil
    if type(e)~='table' or not name or not STATUS[status] or not whole(ver,1,9999) or not VIA[via] or type(now)~='number' then return false end
    if e.cancelled or now>e.at+AFTER then return false end
    if type(e.signups)~='table' then e.signups={} end
    local key=signKey(e,name)
    local old=e.signups[key]
    if type(old)=='table' and whole(old.v,1,9999) then
        if ver<=old.v then return false end
    elseif size(e.signups)>=SIGNUPS_MAX then return false end
    e.signups[key]={s=status,v=ver,r=(not same(name,me)) or nil,d=via=='d' or nil}
    return true
end
-- Pure: answers to pass on as messages "V|id|Name:t:3:d,Name:m:1:k" of at most 255 bytes, 12 a message.
-- rows: {{n=,s=,v=,via=}}.
function BackstageForeverEventRelayEncode(id,rows,limit)
    local out={}
    if not eventId(id) or type(rows)~='table' then return out end
    local head='V|'..id..'|'
    local current,count=head,0
    for _,row in ipairs(rows) do
        if type(row)=='table' and memberName(row.n) and STATUS[row.s] and whole(row.v,1,9999) and VIA[row.via] then
            local part=('%s:%s:%d:%s'):format(row.n,row.s,row.v,row.via)
            if count>0 and (#current+1+#part>255 or count>=12) then out[#out+1]=current;current,count=head,0 end
            current=current..(count>0 and ',' or '')..part;count=count+1
        end
    end
    if count>0 then out[#out+1]=current end
    limit=type(limit)=='number' and limit or 4
    while #out>limit do table.remove(out) end
    return out
end
-- Pure: -> id, {{n=,s=,v=,via=}} or nil when any entry is off.
function BackstageForeverEventRelayDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local id,body=message:match('^V|([%l%d]+)|([^|]+)$')
    if not eventId(id) or body:sub(1,1)==',' or body:sub(-1)==',' or body:find(',,',1,true) then return nil end
    local rows,seen={},{}
    for entry in body:gmatch('[^,]+') do
        local name,status,ver,via=entry:match('^([^:]+):([thdmn]):(%d+):([gkd])$')
        ver=number(ver,4)
        if not memberName(name) or not ver or ver<1 or seen[name:lower()] or #rows>=12 then return nil end
        seen[name:lower()]=true
        rows[#rows+1]={n=name,s=status,v=ver,via=via}
    end
    if #rows==0 then return nil end
    return id,rows
end
-- Pure: takes one event the desktop app handed over (from the guild's page on the service). Your own
-- change made in the app counts as yours. Anything else is hearsay, with one difference to a copy
-- passed on in the guild channel: a higher version (or the same version from the later name) also
-- replaces a copy you heard from its author, because the service already checked who may edit.
-- -> as BackstageForeverEventMerge.
function BackstageForeverEventMergeDesk(db,e,me,ctx)
    me=memberName(me)
    local c=wire(e,true)
    if type(db)~='table' or not c or not me or type(ctx)~='table' or type(ctx.now)~='number' then return nil end
    local author=c.editor or c.creator
    if same(author,me) then return BackstageForeverEventMerge(db,e,me,ctx) end
    local old=events(db)[c.id]
    if type(old)~='table' or old.relayed~=nil then return BackstageForeverEventMerge(db,e,me,ctx) end
    local oldAuthor=old.editor or old.creator
    if not same(old.creator,c.creator) or not (c.ver>old.ver or (c.ver==old.ver and author:lower()>oldAuthor:lower())) then return nil end
    if c.editor and not allowed(db.policy,'edit',rankOf(ctx,c.editor)) then return nil end
    local ver=old.ver
    old.relayed=me
    if c.ver==ver then old.ver=ver-1 end
    local result=BackstageForeverEventMerge(db,e,me,ctx)
    if not result then old.relayed=nil;old.ver=ver end
    return result
end
local REASONS={title=true,time=true,place=true,roles=true,rank=true,full=true,many=true,gone=true}
local function fieldsOf(db,fields,now,dungeons)
    if type(fields)~='table' then return nil,'title' end
    local title=tidy(fields.title,TITLE_MAX)
    if not title or #title<2 then return nil,'title' end
    if not whole(fields.at,T_MIN,T_MAX) or fields.at<=now or fields.at>now+AHEAD then return nil,'time' end
    local dungeon=place(fields.dungeon)
    if not dungeon or (type(dungeons)=='table' and dungeon~='other' and not dungeons[dungeon]) then return nil,'place' end
    local r=type(fields.roles)=='table' and fields.roles or {}
    if not whole(r.t,0,9) or not whole(r.h,0,9) or not whole(r.d,0,40) then return nil,'roles' end
    local note=nil
    if type(fields.note)=='string' and fields.note:gsub('%s','')~='' then
        note=tidy(fields.note,NOTE_MAX)
        if not note then return nil,'title' end
    end
    return {title=title,at=fields.at,dungeon=dungeon,roles={t=r.t,h=r.h,d=r.d},note=note}
end
-- Pure: your own new event. fields = {title=,at=,dungeon=,roles={t=,h=,d=},note=}; ctx as in Merge
-- plus dungeons (a set of known place ids) and rand (0..1295). -> event, or nil and why:
-- 'title' (missing, or not plain words), 'time', 'place', 'roles', 'rank', 'full', 'many'.
function BackstageForeverEventCreate(db,fields,me,ctx)
    me=memberName(me)
    if type(db)~='table' or not me or type(ctx)~='table' or type(ctx.now)~='number' then return nil,'rank' end
    local now=ctx.now
    local f,why=fieldsOf(db,fields,now,ctx.dungeons)
    if not f then return nil,why end
    if not allowed(db.policy,'propose',rankOf(ctx,me)) then return nil,'rank' end
    BackstageForeverEventPrune(db,now)
    local list=events(db)
    if size(list)>=EVENTS_MAX then return nil,'full' end
    if ownedBy(db,me)>=PER_CREATOR then return nil,'many' end
    local rand=whole(ctx.rand,0,1295) and ctx.rand or 0
    local id
    for i=0,1295 do
        local tail=base36((rand+i)%1296)
        id=base36(now)..(#tail<2 and '0'..tail or tail)
        if not list[id] then break end
    end
    local e={id=id,ver=1,creator=me,at=f.at,dungeon=f.dungeon,roles=f.roles,title=f.title,note=f.note,signups={},heard=now}
    list[id]=e
    return e
end
-- Pure: your change to an event: new fields, or fields.cancelled=true to call it off. Only the
-- creator, or a rank the guild leader allowed. -> event, or nil and why (also 'gone').
function BackstageForeverEventChange(db,id,fields,me,ctx)
    me=memberName(me)
    local e=type(db)=='table' and eventId(id) and events(db)[id] or nil
    if type(e)~='table' or not me or type(ctx)~='table' or type(ctx.now)~='number' or e.cancelled or e.at+AFTER<ctx.now then return nil,'gone' end
    local mine=same(me,e.creator)
    if not mine and not allowed(db.policy,'edit',rankOf(ctx,me)) then return nil,'rank' end
    if e.ver>=9999 then return nil,'full' end
    if type(fields)=='table' and fields.cancelled==true then
        e.cancelled=true
    else
        local f,why=fieldsOf(db,fields,ctx.now,ctx.dungeons)
        if not f then return nil,why end
        if f.at~=e.at then e.reminded=nil end
        e.title,e.at,e.dungeon,e.roles,e.note=f.title,f.at,f.dungeon,f.roles,f.note
    end
    e.ver=e.ver+1
    e.editor=(not mine) and me or nil
    e.relayed=nil
    e.heard=ctx.now
    return e
end
-- Pure: your own answer to an event: 't' tank, 'h' healer, 'd' damage, 'm' maybe, 'n' no.
-- -> the version to send, or nil.
function BackstageForeverEventAnswer(db,id,me,status,now)
    me=memberName(me)
    local e=type(db)=='table' and eventId(id) and events(db)[id] or nil
    if type(e)~='table' or not me or not STATUS[status] or type(now)~='number' or e.cancelled or now>e.at+AFTER then return nil end
    if type(e.signups)~='table' then e.signups={} end
    local key=signKey(e,me)
    local old=e.signups[key]
    local ver=type(old)=='table' and whole(old.v,1,9998) and old.v+1 or 1
    if not old and size(e.signups)>=SIGNUPS_MAX then return nil end
    e.signups[key]={s=status,v=ver}
    return ver
end
function BackstageForeverEventMine(e,me)
    if type(e)~='table' or type(e.signups)~='table' then return nil end
    for name,row in pairs(e.signups) do if same(name,me) and type(row)=='table' then return row.s end end
end
-- Pure: the events still on the list (not called off), soonest first.
function BackstageForeverEventList(db,now)
    local out={}
    if type(db)~='table' or type(now)~='number' then return out end
    for _,e in pairs(events(db)) do
        if type(e)=='table' and not e.cancelled and whole(e.at,T_MIN,T_MAX) and e.at+AFTER>=now then out[#out+1]=e end
    end
    table.sort(out,function(a,b) if a.at~=b.at then return a.at<b.at end return a.id<b.id end)
    return out
end
-- Pure: how many said what: {t=,h=,d=,m=,n=}.
function BackstageForeverEventCounts(e)
    local c={t=0,h=0,d=0,m=0,n=0}
    for _,row in ipairs(signRows(e)) do c[row.s]=c[row.s]+1 end
    return c
end
-- Pure: the names that gave one answer, in order, as one text. An answer given in Discord carries
-- a small "(D)". -> text, how many, and whether any of them came from Discord.
function BackstageForeverEventNames(e,status)
    local names,discord={},false
    for _,row in ipairs(signRows(e)) do
        if row.s==status then
            local mark=e.signups[row.n].d==true
            if mark then discord=true end
            names[#names+1]=row.n..(mark and ' (D)' or '')
        end
    end
    return table.concat(names,', '),#names,discord
end
local ANSWER={t='tank',h='healer',d='damage',m='maybe',n='no'}
-- Pure: the chat lines for /bf events. when(at) gives the time as text; place(id) a place name.
function BackstageForeverEventLines(db,now,me,when,placeName)
    local list=BackstageForeverEventList(db,now)
    if #list==0 then return {T('No guild events ahead. /bf event add proposes one.')} end
    local lines={T(('Guild events ahead: %d.'):format(#list))}
    for i,e in ipairs(list) do
        local c=BackstageForeverEventCounts(e)
        local where=type(placeName)=='function' and placeName(e.dungeon) or e.dungeon
        local line=('  %d. %s: %s, %s.'):format(i,type(when)=='function' and when(e.at) or tostring(e.at),e.title,where)
        line=line..' '..T(('Tanks %d of %d, healers %d of %d, damage %d of %d.'):format(c.t,e.roles.t,c.h,e.roles.h,c.d,e.roles.d))
        local mine=BackstageForeverEventMine(e,me)
        line=line..' '..(mine and T('Your answer: '..ANSWER[mine]..'.') or T('You have not answered.'))
        lines[#lines+1]=line
    end
    return lines
end
-- Pure: the events to remind you of now: they begin within 15 minutes, you created them or said
-- yes or maybe, and you were not reminded yet. Each is marked as reminded.
function BackstageForeverEventDue(db,now,me)
    local out={}
    for _,e in ipairs(BackstageForeverEventList(db,now)) do
        local mine=BackstageForeverEventMine(e,me)
        if not e.reminded and e.at>now and e.at-now<=REMIND and (same(e.creator,me) or (mine and mine~='n')) then
            e.reminded=true
            out[#out+1]=e
        end
    end
    return out
end
-- Pure: a day and a time on your computer's clock as seconds since 1970. toEpoch and toParts are
-- the game's time() and date('*t'). -> seconds, or nil and why: 'bad' (no such day) or 'gap' (the
-- clocks skip that time). When the clocks go back and the time happens twice, the first one is
-- taken and 'twice' comes back as well.
function BackstageForeverEventEpoch(y,mo,d,h,mi,toEpoch,toParts)
    if not whole(y,2000,2200) or not whole(mo,1,12) or not whole(d,1,31) or not whole(h,0,23) or not whole(mi,0,59) or type(toEpoch)~='function' or type(toParts)~='function' then return nil,'bad' end
    local ok,at=pcall(toEpoch,{year=y,month=mo,day=d,hour=h,min=mi,sec=0})
    if not ok or type(at)~='number' then return nil,'bad' end
    at=floor(at)
    local function parts(t) local good,p=pcall(toParts,t) if good and type(p)=='table' then return p end end
    local function matches(p) return p and p.year==y and p.month==mo and p.day==d and p.hour==h and p.min==mi end
    local p=parts(at)
    if not p then return nil,'bad' end
    if not matches(p) then
        -- A day that does not exist rolls into another day; a skipped hour stays close to it.
        local okNoon,noonAt=pcall(toEpoch,{year=y,month=mo,day=d,hour=12,min=0,sec=0})
        local noon=okNoon and type(noonAt)=='number' and parts(floor(noonAt)) or nil
        if not noon or noon.year~=y or noon.month~=mo or noon.day~=d then return nil,'bad' end
        return nil,'gap'
    end
    if matches(parts(at-3600)) then return at-3600,'twice' end
    if matches(parts(at+3600)) then return at,'twice' end
    return at
end
-- Pure: how far clock two is ahead of clock one, in minutes, to the quarter hour, from -11:45 to
-- +12:00. Used for the realm clock against your computer's.
function BackstageForeverEventClockOffset(h1,m1,h2,m2)
    if not whole(h1,0,23) or not whole(m1,0,59) or not whole(h2,0,23) or not whole(m2,0,59) then return nil end
    local diff=floor(((h2*60+m2)-(h1*60+m1))/15+.5)*15
    while diff>720 do diff=diff-1440 end
    while diff<=-720 do diff=diff+1440 end
    return diff
end
-- Pure: the day delta days after {year=,month=,day=}, worked out at noon so a clock change never
-- skips or repeats a day.
function BackstageForeverEventDayStep(day,delta,toEpoch,toParts)
    if type(day)~='table' or not whole(delta,-400,400) or type(toEpoch)~='function' or type(toParts)~='function' then return nil end
    local ok,at=pcall(toEpoch,{year=day.year,month=day.month,day=day.day,hour=12,min=0,sec=0})
    if not ok or type(at)~='number' then return nil end
    local good,p=pcall(toParts,at+delta*86400)
    if not good or type(p)~='table' then return nil end
    return {year=p.year,month=p.month,day=p.day}
end
-- Pure: the event a dungeon or raid visit belongs to: the same place, from half an hour before
-- the event to four hours after it began; the nearest one. ids: the place ids of the instance.
function BackstageForeverEventForRun(db,ids,now)
    local best
    if type(db)~='table' or type(ids)~='table' or type(now)~='number' then return nil end
    for _,e in pairs(events(db)) do
        if type(e)=='table' and not e.cancelled and whole(e.at,T_MIN,T_MAX) and now>=e.at-1800 and now<=e.at+AFTER then
            for _,id in ipairs(ids) do
                if e.dungeon==id and (not best or math.abs(e.at-now)<math.abs(best.at-now) or (math.abs(e.at-now)==math.abs(best.at-now) and e.id<best.id)) then best=e end
            end
        end
    end
    return best
end
-- Pure: notes who was in your group at the event. -> how many names were new.
function BackstageForeverEventPresent(e,names)
    local added=0
    if type(e)~='table' then return added end
    if type(e.present)~='table' then e.present={} end
    for _,name in ipairs(type(names)=='table' and names or {}) do
        name=memberName(name)
        local known=false
        for _,have in ipairs(e.present) do if same(have,name) then known=true end end
        if name and not known and #e.present<PRESENT_MAX then e.present[#e.present+1]=name;added=added+1 end
    end
    return added
end
local QUALITY={ff0070dd=3,ffa335ee=4,ffff8000=5}
-- Pure: 3 rare, 4 epic, 5 legendary from the colour of the item link in a loot line, or nil.
function BackstageForeverEventLootQuality(text)
    if type(text)~='string' or #text>1000 then return nil end
    local colour=text:match('|c(%x%x%x%x%x%x%x%x)|Hitem:')
    if colour then return QUALITY[colour:lower()] end
    local q=tonumber(text:match('|cnIQ(%d):|Hitem:'))
    if q and q>=3 and q<=5 then return q end
end
-- Pure: notes one won item of a guild-event run: the item id and the winner's name, nothing else.
function BackstageForeverEventLoot(e,item,who,now)
    who=memberName(who)
    if type(e)~='table' or not whole(item,1,2147483647) or not who or not whole(now,T_MIN,T_MAX) then return false end
    if type(e.loot)~='table' then e.loot={} end
    for _,row in ipairs(e.loot) do if row.i==item and same(row.w,who) and now-row.at<5 and now>=row.at then return false end end
    if #e.loot>=LOOT_MAX then return false end
    e.loot[#e.loot+1]={i=item,w=who,at=now}
    return true
end
-- Pure: true for the first `limit` calls with one key inside `window` seconds.
function BackstageForeverEventRate(state,key,now,limit,window)
    if type(state)~='table' or type(now)~='number' or type(limit)~='number' or type(window)~='number' then return false end
    local r=state[key]
    if type(r)~='table' or now-r.at>=window or now<r.at then r={at=now,n=0};state[key]=r end
    r.n=r.n+1
    return r.n<=limit
end

-- The book: what sharing guild members told you (BackstageForeverGuild.lua), kept for the desktop
-- guild page: level, zone, professions, class when the guild list names it, when they were last
-- heard, and recipes they answered /bf guild craft with. At most 100 members, 60 days.
local function bookRow(row)
    if type(row)~='table' or not whole(row.at,T_MIN,T_MAX) then return nil end
    local out={at=row.at,p={},crafts={}}
    if whole(row.l,1,100) then out.l=row.l end
    if type(row.z)=='string' then out.z=tidy(row.z,40) end
    if type(row.c)=='string' and #row.c<=20 and row.c:match('^%u+$') then out.c=row.c end
    if place(row.lfd) then out.lfd=row.lfd end
    for _,p in ipairs(type(row.p)=='table' and row.p or {}) do
        local name=type(p)=='table' and tidy(p.n,24)
        if name and whole(p.r,0,999) and #out.p<4 then out.p[#out.p+1]={n=name,r=p.r} end
    end
    for _,recipe in ipairs(type(row.crafts)=='table' and row.crafts or {}) do
        recipe=tidy(recipe,48)
        if recipe and #out.crafts<CRAFTS_MAX then out.crafts[#out.crafts+1]=recipe end
    end
    return out
end
local function bookRoom(book,name)
    if book[name] then return end
    local n,oldest=0,nil
    for other,row in pairs(book) do
        n=n+1
        if not oldest or row.at<book[oldest].at then oldest=other end
    end
    if n>=BOOK_MAX and oldest then book[oldest]=nil end
end
function BackstageForeverGuildBookPrune(book,now)
    local gone=0
    if type(book)~='table' or type(now)~='number' then return gone end
    for name,row in pairs(book) do
        local clean=memberName(name) and bookRow(row)
        if not clean or clean.at<now-BOOK_KEEP or clean.at>now+86400 then book[name]=nil;gone=gone+1 else book[name]=clean end
    end
    return gone
end
-- entry: what BackstageForeverGuildDecode returned ({level=,zone=,profs={{name=,rank=}},lfd=}).
function BackstageForeverGuildBookSeen(book,name,entry,class,now)
    name=memberName(name)
    if type(book)~='table' or not name or type(entry)~='table' or not whole(now,T_MIN,T_MAX) then return false end
    local old=book[name]
    local profs={}
    for _,p in ipairs(type(entry.profs)=='table' and entry.profs or {}) do if type(p)=='table' then profs[#profs+1]={n=p.name,r=p.rank} end end
    local row=bookRow({at=now,l=entry.level,z=entry.zone,c=class or (type(old)=='table' and old.c or nil),lfd=entry.lfd,p=profs,crafts=type(old)=='table' and old.crafts or nil})
    if not row then return false end
    bookRoom(book,name)
    book[name]=row
    return true
end
function BackstageForeverGuildBookForget(book,name)
    if type(book)~='table' or type(name)~='string' or book[name]==nil then return false end
    book[name]=nil
    return true
end
function BackstageForeverGuildBookCraft(book,name,recipe,now)
    name=memberName(name);recipe=tidy(recipe,48)
    if type(book)~='table' or not name or not recipe or not whole(now,T_MIN,T_MAX) then return false end
    local row=bookRow(book[name]) or {at=now,p={},crafts={}}
    for _,have in ipairs(row.crafts) do if have:lower()==recipe:lower() then return false end end
    while #row.crafts>=CRAFTS_MAX do table.remove(row.crafts,1) end
    row.crafts[#row.crafts+1]=recipe
    bookRoom(book,name)
    book[name]=row
    return true
end
-- Pure: saved data read back: every event, sign-up, history row and book row is checked again.
function BackstageForeverEventClean(db,now)
    if type(db)~='table' then db={} end
    db.on=db.on==true;db.loot=db.loot==true
    local kept={}
    for id,e in pairs(type(db.events)=='table' and db.events or {}) do
        local c=type(e)=='table' and wire(e,true)
        if c and c.id==id and size(kept)<EVENTS_MAX then
            c.signups={}
            for _,row in ipairs(signRows(e)) do if size(c.signups)<SIGNUPS_MAX then c.signups[row.n]={s=row.s,v=row.v,r=e.signups[row.n].r==true or nil,d=e.signups[row.n].d==true or nil} end end
            local a=archive(e)
            c.present,c.loot=a.present,a.loot
            c.relayed=memberName(e.relayed);c.reminded=e.reminded==true or nil
            c.heard=whole(e.heard,T_MIN,T_MAX) and e.heard or nil
            kept[id]=c
        end
    end
    db.events=kept
    local past={}
    for _,row in ipairs(type(db.past)=='table' and db.past or {}) do
        local c=type(row)=='table' and wire({id=row.id,ver=1,creator=row.creator,at=row.at,dungeon=row.dungeon,roles=row.roles,title=row.title,note=row.note},true)
        if c then
            local signups={}
            for _,s in ipairs(type(row.signups)=='table' and row.signups or {}) do
                if type(s)=='table' and memberName(s.n) and STATUS[s.s] and #signups<SIGNUPS_MAX then signups[#signups+1]={n=s.n,s=s.s} end
            end
            local a=archive({id=c.id,title=c.title,dungeon=c.dungeon,at=c.at,creator=c.creator,roles=c.roles,note=c.note,present=row.present,loot=row.loot})
            a.signups=signups
            past[#past+1]=a
        end
    end
    db.past=past
    if type(db.book)~='table' then db.book={} end
    if type(now)=='number' then BackstageForeverGuildBookPrune(db.book,now);BackstageForeverEventPrune(db,now) end
    local p=type(db.policy)=='table' and db.policy or nil
    if p and whole(p.ver,1,9999) and (p.propose==nil or whole(p.propose,0,9)) and (p.edit==nil or whole(p.edit,0,9)) then db.policy={ver=p.ver,propose=p.propose,edit=p.edit}
    else db.policy=nil end
    return db
end
-- Pure: the optional capture block for the desktop app, and every list inside it (the capture
-- marks those as lists). info = {me=,guild=,realmOffset=minutes the realm clock is ahead of UTC}.
-- nil when there is nothing to tell.
function BackstageForeverEventsExport(db,now,info)
    if type(db)~='table' or not whole(now,T_MIN,T_MAX) then return nil end
    info=type(info)=='table' and info or {}
    local lists={}
    local function list(t) lists[#lists+1]=t return t end
    local block={v=1,at=now,on=db.on==true,loot=db.loot==true,events=list({}),past=list({}),members=list({})}
    if memberName(info.me) then block.me=info.me end
    if type(info.guild)=='string' then block.guild=tidy(info.guild,40) end
    if whole(info.realmOffset,-720,840) then block.realmOffset=info.realmOffset end
    local rows={}
    for _,e in pairs(events(db)) do if type(e)=='table' and wire(e,false) then rows[#rows+1]=e end end
    table.sort(rows,function(a,b) if a.at~=b.at then return a.at<b.at end return a.id<b.id end)
    for _,e in ipairs(rows) do
        local a=archive(e)
        -- An event still on the list carries the version of each answer; history does not need it.
        local row={id=e.id,ver=e.ver,title=a.title,dungeon=a.dungeon,at=a.at,creator=a.creator,t=a.roles.t,h=a.roles.h,d=a.roles.d,note=a.note,
            signups=list(signRows(e)),present=list(a.present),loot=list(a.loot)}
        if e.editor then row.editor=e.editor end
        if e.cancelled then row.cancelled=true end
        if e.relayed then row.relayed=true end
        block.events[#block.events+1]=row
    end
    for _,a in ipairs(type(db.past)=='table' and db.past or {}) do
        if type(a)=='table' and type(a.roles)=='table' then
            block.past[#block.past+1]={id=a.id,title=a.title,dungeon=a.dungeon,at=a.at,creator=a.creator,t=a.roles.t,h=a.roles.h,d=a.roles.d,note=a.note,
                signups=list(a.signups or {}),present=list(a.present or {}),loot=list(a.loot or {})}
        end
    end
    local names={}
    for name in pairs(type(db.book)=='table' and db.book or {}) do names[#names+1]=name end
    table.sort(names)
    for _,name in ipairs(names) do
        local row=bookRow(db.book[name])
        if row and memberName(name) then
            block.members[#block.members+1]={n=name,at=row.at,l=row.l,z=row.z,c=row.c,lfd=row.lfd,p=list(row.p),crafts=list(row.crafts)}
        end
    end
    if #block.events==0 and #block.past==0 and #block.members==0 and not block.on then return nil end
    return block,lists
end

-- ---------------------------------------------------------------- live
local clock=time or (os and os.time)
local parts=date or (os and os.date)
local function epoch() local t=call(clock);return type(t)=='number' and floor(t) or 0 end
local function tick() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function combat() return call(InCombatLockdown)==true end
local function toParts(at) return call(parts,'*t',at) end
local function shortName(n)
    if type(n)~='string' or n=='' or #n>60 then return nil end
    local short=call(Ambiguate,n,'short')
    return type(short)=='string' and short~='' and short or n
end
local function myName() return shortName(call(UnitName,'player')) end
local loaded
local function db()
    if type(BackstageForeverEventsDB)~='table' then BackstageForeverEventsDB={} end
    if loaded~=BackstageForeverEventsDB then
        loaded=BackstageForeverEventsDB
        BackstageForeverEventClean(loaded,epoch()>0 and epoch() or nil)
    end
    return loaded
end
function BackstageForeverEventsOn()
    local s=BackstageForeverEventsDB
    return type(s)=='table' and rawget(s,'on')==true
end
local on=BackstageForeverEventsOn
local function capture() if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end end
-- The guild list as the game has it: rank and class by name. Read at most once a minute.
local ranks,ranksAt={},nil
local function readRanks(force)
    local at=tick()
    if not force and ranksAt and at-ranksAt<60 and at>=ranksAt then return end
    local n=call(GetNumGuildMembers)
    if type(n)~='number' or n<1 then return end
    ranksAt=at
    local fresh={}
    for i=1,min(floor(n),1000) do
        local name,_,rank,_,_,_,_,_,_,_,class=call(GetGuildRosterInfo,i)
        local short=shortName(name)
        if short and type(rank)=='number' then fresh[short:lower()]={rank=rank,class=type(class)=='string' and class or nil} end
    end
    ranks=fresh
end
local function rank(name)
    local row=type(name)=='string' and ranks[name:lower()]
    return row and row.rank or nil
end
local function context() return {now=epoch(),rank=rank,dungeons=nil,rand=floor((call(math.random) or 0)*1295)} end
local function dungeonSet()
    local set={}
    for _,row in ipairs(type(BackstageForeverAtlasData)=='table' and BackstageForeverAtlasData or {}) do if type(row)=='table' and type(row[1])=='string' then set[row[1]]=true end end
    return set
end
local function placeName(id)
    if id=='other' then return T('Other') end
    for _,row in ipairs(type(BackstageForeverAtlasData)=='table' and BackstageForeverAtlasData or {}) do
        if type(row)=='table' and row[1]==id and type(row[2])=='string' then return row[2] end
    end
    return id
end
-- The realm clock against UTC, to the quarter hour, or nil when the game does not tell.
local function realmOffset()
    local h,m=call(GetGameTime)
    local utc=call(parts,'!*t')
    if type(h)~='number' or type(m)~='number' or type(utc)~='table' then return nil end
    return BackstageForeverEventClockOffset(utc.hour,utc.min,floor(h),floor(m))
end
-- "Sat 28 Nov 20:00 your time (realm 21:00)". The realm part uses the realm clock as it is now.
local function when(at)
    local text=call(parts,'%a %d %b %H:%M',at)
    if type(text)~='string' then return tostring(at) end
    local offset=realmOffset()
    local realm=offset and call(parts,'!*t',at+offset*60)
    if type(realm)=='table' and type(realm.hour)=='number' and type(realm.min)=='number' then return T(('%s your time (realm %02d:%02d)'):format(text,realm.hour,realm.min)) end
    return T(('%s your time'):format(text))
end
local function send(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' or type(text)~='string' then return false end
    local ok,sent=pcall(fn,text,'GUILD')
    return ok and sent==true
end
-- Everything goes out through one short queue, one message every second and a half. The first
-- message after a quiet moment leaves at once, so an answer or a new event reaches the guild the
-- second it is made; only a burst (a full answer to "what events do you know?") is spread out.
local queue,QUEUE_MAX,QUEUE_GAP={},60,1.5
local lastSend=nil
local function pump()
    if #queue==0 then return end
    if not on() then queue={} return end
    lastSend=tick()
    send(table.remove(queue,1))
end
local function push(text)
    if type(text)~='string' then return end
    for _,have in ipairs(queue) do if have==text then return end end
    if #queue<QUEUE_MAX then queue[#queue+1]=text end
    local at=tick()
    if #queue==1 and (not lastSend or at-lastSend>=QUEUE_GAP or at<lastSend) then pump() end
end
-- Backstage Live (BackstageForeverLiveGuild.lua) is told about every event and answer, so it can
-- signal the desktop app over the live link. It does nothing when that file is not there.
local function live(what,...)
    local fn=BackstageForeverLiveGuildHeard
    if type(fn)=='function' then pcall(fn,what,...) end
end
-- The highest version heard in the guild channel this session, by event and by answer: what a
-- member who reloaded need not pass on again.
local known={}
local function hear(key,ver) if (known[key] or 0)<ver then known[key]=ver end end
BackstageForeverEventsPump=pump -- for tests
local notes,rate={},{}
local function flush()
    if #notes==0 or combat() then return end
    local list=notes
    notes={}
    if #list>2 then return say(('Guild events: %d new or changed. /bf events lists them.'):format(#list)) end
    for _,line in ipairs(list) do say(line) end
end
local function note(line) if #notes<20 then notes[#notes+1]=line end flush() end
local function announce(result,e,sender)
    if result=='new' then note(('New guild event from %s: %s, %s. /bf event to answer.'):format(e.creator,e.title,when(e.at)))
    elseif result=='changed' then note(('Guild event changed by %s: %s, %s.'):format(e.editor or e.creator,e.title,when(e.at)))
    elseif result=='cancelled' then note(('Guild event called off by %s: %s.'):format(e.editor or e.creator,e.title)) end
end
local function refreshWindow() if type(BackstageForeverEventsWindowRefresh)=='function' then pcall(BackstageForeverEventsWindowRefresh) end end
-- What you answer a "what events do you know?" with: every event on your list (your own as its
-- author, the others as copies), your own sign-ups, the lists of your own events, and the rules
-- when you are the guild leader. An event somebody else sent while you waited is left out.
local answering,heard=false,{}
local function answer(ownOnly)
    if not ownOnly then answering=false end
    if not on() then return end
    local d,me,now=db(),myName(),epoch()
    BackstageForeverEventPrune(d,now)
    local copies=0
    for _,e in pairs(d.events) do
        local mine=same(e.creator,me)
        if (mine or not ownOnly) and (ownOnly or (heard[e.id] or 0)<e.ver) and (mine or copies<10) then
            if not mine then copies=copies+1 end
            push(BackstageForeverEventEncode(e))
        end
        if not e.cancelled then
            local status=BackstageForeverEventMine(e,me)
            if status then push(BackstageForeverEventSignEncode(e.id,e.signups[signKey(e,me)].v,status)) end
            if mine then for _,text in ipairs(BackstageForeverEventRosterEncode(e)) do push(text) end end
        end
    end
    if rank(me)==0 and d.policy then push(BackstageForeverEventPolicyEncode(d.policy)) end
end
local function allow(sender)
    -- At most forty event messages a minute from one member: a full answer fits, a flood does not.
    return BackstageForeverEventRate(rate,'in:'..sender:lower(),tick(),40,60)
end
local function onEvent(sender,message)
    if not on() or not allow(sender) then return end
    if message=='E?' then
        -- One answer per two minutes, after a short random wait so not everybody talks at once.
        if answering or not BackstageForeverEventRate(rate,'answer',tick(),1,120) then return end
        answering,heard=true,{}
        local after=field(plain(C_Timer),'After')
        if type(after)~='function' or not pcall(after,2+(call(math.random) or 0)*8,function() pcall(answer) end) then answer() end
        return
    end
    local now=epoch()
    local e=BackstageForeverEventDecode(message,now)
    if not e then return end
    if answering and (heard[e.id] or 0)<e.ver then heard[e.id]=e.ver end
    hear('e'..e.id,e.ver)
    readRanks()
    local result=BackstageForeverEventMerge(db(),e,sender,{now=now,rank=rank})
    if not result then return end
    if result~='quiet' then announce(result,e,sender);live('event',db().events[e.id]) end
    capture();refreshWindow()
end
local function onSign(sender,message)
    if not on() or not allow(sender) then return end
    local id,ver,status=BackstageForeverEventSignDecode(message)
    if id then hear('s'..id..':'..sender:lower(),ver) end
    if id and BackstageForeverEventSign(db(),id,sender,status,ver,sender,epoch()) then live('signup',id,sender,status,ver);capture();refreshWindow() end
end
-- Answers the desktop app handed to another member (given in Discord or in the app). Only a newer
-- version is taken. When it is about you, you are told who passed it on.
local function onRelay(sender,message)
    if not on() or not allow(sender) then return end
    local id,rows=BackstageForeverEventRelayDecode(message)
    if not id then return end
    local d,me,now,changed=db(),myName(),epoch(),false
    for _,row in ipairs(rows) do
        hear('s'..id..':'..row.n:lower(),row.v)
        if BackstageForeverEventSignRelay(d,id,row.n,row.s,row.v,row.via,me,now) then
            changed=true
            if same(row.n,me) and not combat() then
                local e=d.events[id]
                say((row.via=='d' and 'Your answer to %s is now: %s. It came from Discord, passed on by %s. /bf event changes it.'
                    or 'Your answer to %s is now: %s. It came from the desktop app, passed on by %s. /bf event changes it.'):format(e and e.title or id,
                    T(({t='tank',h='healer',d='damage',m='maybe',n='no'})[row.s]),sender))
            end
        end
    end
    if changed then capture();refreshWindow() end
end
local function onRoster(sender,message)
    if not on() or not allow(sender) then return end
    local id,rows=BackstageForeverEventRosterDecode(message)
    if not id then return end
    local changed=false
    local me=myName()
    for _,row in ipairs(rows) do
        hear('s'..id..':'..row.n:lower(),row.v)
        -- Nobody else speaks for you.
        if not same(row.n,me) and BackstageForeverEventSign(db(),id,row.n,row.s,row.v,sender,epoch()) then changed=true;live('signup',id,row.n,row.s,row.v) end
    end
    if changed then capture();refreshWindow() end
end
local function onPolicy(sender,message)
    if not on() or not allow(sender) then return end
    local policy=BackstageForeverEventPolicyDecode(message)
    readRanks()
    -- Only the guild leader sets the rules.
    if not policy or rank(sender)~=0 then return end
    local d=db()
    if d.policy and d.policy.ver>=policy.ver then return end
    d.policy=policy
end
local function ask()
    if not on() or call(IsInGuild)~=true then return false end
    if not BackstageForeverEventRate(rate,'ask',tick(),1,300) then return false end
    push('E?')
    return true
end
local function broadcast(e)
    push(BackstageForeverEventEncode(e))
    live('event',e)
    capture();refreshWindow()
end
local REASON={title='Give the event a title in plain words (2 to 40 characters, no links).',time='Pick a time that is still ahead, within half a year.',
    place='Pick a dungeon or raid from the list, or Other.',roles='Tanks and healers 0 to 9, damage 0 to 40.',
    rank='Your guild rank may not do that. The guild leader sets who may propose and edit events.',
    full='The guild event list is full (20). An event leaves it four hours after it began.',many='You already have 5 events on the list. Call one off first.',
    gone='That event is over or was called off.'}
local function reasonText(why) return REASON[why] or REASON.gone end
-- What the window (BackstageForeverEventsWindow.lua) works with.
BackstageForeverEventsApi={
    on=on,me=myName,when=when,place=placeName,reason=reasonText,
    list=function() return BackstageForeverEventList(db(),epoch()) end,
    mine=function(e) return BackstageForeverEventMine(e,myName()) end,
    counts=BackstageForeverEventCounts,names=BackstageForeverEventNames,
    mayEdit=function(e) readRanks();return type(e)=='table' and (same(e.creator,myName()) or allowed(db().policy,'edit',rank(myName()))) end,
    places=function()
        local out={}
        for _,row in ipairs(type(BackstageForeverAtlasData)=='table' and BackstageForeverAtlasData or {}) do if type(row)=='table' and type(row[1])=='string' then out[#out+1]={id=row[1],name=row[2]} end end
        out[#out+1]={id='other',name=T('Other')}
        return out
    end,
    today=function() local p=toParts(epoch());return type(p)=='table' and {year=p.year,month=p.month,day=p.day,hour=p.hour,min=p.min} or nil end,
    partsOf=function(at) local p=toParts(at);return type(p)=='table' and {year=p.year,month=p.month,day=p.day,hour=p.hour,min=p.min} or nil end,
    dayStep=function(day,delta) return BackstageForeverEventDayStep(day,delta,clock,function(at) return toParts(at) end) end,
    dayText=function(day)
        local ok,at=pcall(clock,{year=day.year,month=day.month,day=day.day,hour=12,min=0,sec=0})
        local text=ok and call(parts,'%a %d %b %Y',at)
        return type(text)=='string' and text or ('%04d-%02d-%02d'):format(day.year,day.month,day.day)
    end,
    epoch=function(day,hour,minute) return BackstageForeverEventEpoch(day.year,day.month,day.day,hour,minute,clock,function(at) return toParts(at) end) end,
    create=function(fields)
        readRanks()
        local ctx=context();ctx.dungeons=dungeonSet()
        local e,why=BackstageForeverEventCreate(db(),fields,myName(),ctx)
        if not e then return nil,reasonText(why) end
        broadcast(e)
        return e
    end,
    change=function(id,fields)
        readRanks()
        local ctx=context();ctx.dungeons=dungeonSet()
        local e,why=BackstageForeverEventChange(db(),id,fields,myName(),ctx)
        if not e then return nil,reasonText(why) end
        broadcast(e)
        return e
    end,
    answer=function(id,status)
        local ver=BackstageForeverEventAnswer(db(),id,myName(),status,epoch())
        if not ver then return false end
        push(BackstageForeverEventSignEncode(id,ver,status))
        live('signup',id,myName(),status,ver)
        capture();refreshWindow()
        return true
    end,
}
-- What Backstage Live works with (BackstageForeverLiveGuild.lua): the store, the queue and the guild list.
BackstageForeverEventsInternals={
    db=db,push=push,rank=rank,readRanks=readRanks,capture=capture,refresh=refreshWindow,epoch=epoch,me=myName,note=note,when=when,
    known=function(key) return known[key] or 0 end,
    inGuild=function(name) readRanks();return type(name)=='string' and ranks[name:lower()]~=nil end,
    listed=function() return next(ranks)~=nil end,
}
local api=BackstageForeverEventsApi
-- Guild sharing (BackstageForeverGuild.lua) hands over what members shared, for the desktop guild page.
function BackstageForeverGuildHeard(sender,entry)
    if type(entry)~='table' then return end
    local d=db()
    if entry.off then if BackstageForeverGuildBookForget(d.book,sender) then capture() end return end
    readRanks()
    local row=type(sender)=='string' and ranks[sender:lower()]
    BackstageForeverGuildBookSeen(d.book,sender,entry,row and row.class or nil,epoch())
end
function BackstageForeverGuildCraftHeard(sender,recipe)
    if BackstageForeverGuildBookCraft(db().book,sender,recipe,epoch()) then capture() end
end
-- The optional capture block (BackstageForever.lua puts it in the saved file).
function BackstageForeverEventsSnapshot()
    if type(BackstageForeverEventsDB)~='table' then return nil end
    local d,now=db(),epoch()
    if now<T_MIN then return nil end
    BackstageForeverEventPrune(d,now)
    local guild=call(GetGuildInfo,'player')
    return BackstageForeverEventsExport(d,now,{me=myName(),guild=type(guild)=='string' and guild or nil,realmOffset=realmOffset()})
end
-- Inside the dungeon or raid of an event, around its time: who is in your group, and (with its own
-- switch) who won rare or better items. Kept on this computer only.
local current=nil
local function groupNames()
    local names={}
    local me=myName()
    if me then names[1]=me end
    if call(IsInRaid)==true then
        for i=1,40 do
            local name=shortName(call(GetRaidRosterInfo,i))
            if name then names[#names+1]=name end
        end
    else
        for i=1,4 do
            local name=shortName(call(UnitName,'party'..i))
            if name then names[#names+1]=name end
        end
    end
    return names
end
local function lookAround()
    current=nil
    if not on() then return end
    local _,kind,_,_,_,_,_,map=call(GetInstanceInfo)
    if (kind~='party' and kind~='raid') or type(map)~='number' then return end
    local ids=type(BackstageForeverRunInstances)=='table' and BackstageForeverRunInstances[map] or nil
    local e=ids and BackstageForeverEventForRun(db(),ids,epoch())
    if not e then return end
    current=e.id
    if BackstageForeverEventPresent(e,groupNames())>0 then capture() end
end
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
local function onLoot(text)
    if not current or not on() or rawget(db(),'loot')~=true then return end
    text=plain(text)
    if type(BackstageForeverLootItemId)~='function' or type(BackstageForeverLootKind)~='function' then return end
    local e=db().events[current]
    local item=BackstageForeverLootItemId(text)
    if not e or not item or not BackstageForeverEventLootQuality(text) then return end
    -- The game's own loot sentences say who; a line that fits none of them is not noted.
    local kind,who=BackstageForeverLootKind(text,lootFormats())
    if kind=='self' then who=myName() elseif kind=='other' then who=shortName(who) else return end
    if BackstageForeverEventLoot(e,item,who,epoch()) then capture() end
end
local function remind()
    if not on() or combat() then return end
    local d,now=db(),epoch()
    if now<T_MIN then return end
    if BackstageForeverEventPrune(d,now)>0 then capture();refreshWindow() end
    for _,e in ipairs(BackstageForeverEventDue(d,now,myName())) do
        say(('Guild event in %d minutes: %s, %s.'):format(max(1,floor((e.at-now)/60+.5)),e.title,placeName(e.dungeon)))
    end
    flush()
end
BackstageForeverEventsRemind=remind -- for tests
local function listLines()
    local d,now=db(),epoch()
    BackstageForeverEventPrune(d,now)
    for _,line in ipairs(BackstageForeverEventLines(d,now,myName(),when,placeName)) do say(line) end
end
local function pick(text)
    local list=BackstageForeverEventList(db(),epoch())
    local index=tonumber(type(text)=='string' and text:match('(%d+)%s*$') or nil) or 1
    return list[index],#list
end
local ROLE={tank='t',healer='h',heal='h',damage='d',dps='d',dd='d'}
local WORD={t='Signed up as tank: %s.',h='Signed up as healer: %s.',d='Signed up as damage: %s.',m='Answered maybe: %s.',n='Answered no: %s.'}
local HELP='Guild events: /bf event opens the window, /bf event add proposes one, /bf events lists them, /bf event yes tank|healer|damage N, /bf event maybe N, /bf event no N.'
function BackstageForeverEventCommand(message)
    local text=type(message)=='string' and #message<=120 and message:lower() or ''
    local word,rest=text:match('^(%a+)%s*(.-)%s*$')
    local sub,tail=(rest or ''):match('^(%a*)%s*(.-)$')
    local d=db()
    if word=='event' and (sub=='on' or sub=='off') then
        d.on=sub=='on'
        if not d.on then queue={};refreshWindow();return say('Guild events: off. Nothing is sent and nothing is read. What you have stays on this computer.') end
        say('Guild events: on. Events and sign-ups are shared with guild members who run Backstage Forever and switched this on. /bf event off stops it.')
        if call(IsInGuild)~=true then return say('You are not in a guild, so nothing is sent.') end
        ask();answer(true);capture()
        return
    end
    if word=='event' and sub=='loot' then
        if tail=='on' or tail=='off' then d.loot=tail=='on' end
        return say(d.loot and 'Guild-run loot notes: on. In a guild-event run, who won a rare or better item is noted on this computer only.'
            or 'Guild-run loot notes: off. Only your own loot is in your run history.')
    end
    if not on() then return say('Guild events are off. /bf event on shares events and sign-ups with guild members who run Backstage Forever.') end
    if call(IsInGuild)~=true then return say('You are not in a guild.') end
    if word=='events' or sub=='list' then return listLines() end
    if sub=='' or sub=='add' or sub=='new' then
        if combat() then return say('Open the guild events window outside combat.') end
        local open=BackstageForeverEventsWindowOpen
        if type(open)=='function' and open(sub~='' and 'add' or nil) then return end
        say('The guild events window is not available in this game client.')
        return listLines()
    end
    if sub=='sync' then
        return say(ask() and 'Asked guild members for their events. Answers arrive within a few seconds.' or 'You asked a moment ago. Wait a few minutes.')
    end
    if sub=='yes' or sub=='maybe' or sub=='no' then
        local status=sub=='maybe' and 'm' or sub=='no' and 'n' or ROLE[tail:match('^(%a+)') or '']
        if not status then return say('Say the role: /bf event yes tank, /bf event yes healer or /bf event yes damage.') end
        local e,count=pick(tail)
        if not e then return say(count==0 and 'No guild events ahead. /bf event add proposes one.' or 'No event has that number. /bf events lists them.') end
        if not api.answer(e.id,status) then return say(reasonText('gone')) end
        return say(WORD[status]:format(e.title))
    end
    if sub=='cancel' then
        local e=pick(tail)
        if not e or not tail:match('%d') then return say('Name the event by its number: /bf event cancel 1. /bf events lists them.') end
        local done,why=api.change(e.id,{cancelled=true})
        return say(done and ('Guild event called off: %s.'):format(e.title) or why)
    end
    if sub=='policy' then
        readRanks(true)
        local kind,value=tail:match('^(%a+)%s+(%w+)$')
        if kind~='propose' and kind~='edit' then
            local p=d.policy or {}
            say(p.propose and ('Who may propose events: guild rank %d and above.'):format(p.propose) or 'Who may propose events: any member.')
            return say(p.edit and ('Who may change other members\' events: guild rank %d and above.'):format(p.edit) or 'Who may change an event: only its creator.')
        end
        if rank(myName())~=0 then return say('Only the guild leader sets who may propose and edit events.') end
        local n=tonumber(value)
        if not ((n and whole(n,0,9)) or (kind=='propose' and value=='anyone') or (kind=='edit' and value=='creator')) then
            return say('Use /bf event policy propose N or anyone, and /bf event policy edit N or creator. N is a guild rank number: 0 is the guild leader, 1 the next rank.')
        end
        local p=d.policy or {ver=0}
        d.policy={ver=min(9999,p.ver+1),propose=p.propose,edit=p.edit}
        d.policy[kind]=n
        push(BackstageForeverEventPolicyEncode(d.policy))
        return say('The rule is set and goes to guild members who run Backstage Forever.')
    end
    say(HELP)
end

if type(BackstageForeverPartyHandle)=='function' then
    BackstageForeverPartyHandle('E',onEvent,'GUILD')
    BackstageForeverPartyHandle('U',onSign,'GUILD')
    BackstageForeverPartyHandle('L',onRoster,'GUILD')
    BackstageForeverPartyHandle('P',onPolicy,'GUILD')
    BackstageForeverPartyHandle('V',onRelay,'GUILD')
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','ZONE_CHANGED_NEW_AREA','GROUP_ROSTER_UPDATE','GUILD_ROSTER_UPDATE','CHAT_MSG_LOOT','PLAYER_REGEN_ENABLED'}) do pcall(frame.RegisterEvent,frame,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Events',frame) end
        pcall(frame.SetScript,frame,'OnEvent',function(_,event,a)
            if event=='PLAYER_LOGIN' then
                pcall(db)
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.NewTicker)=='function' then
                    pcall(timer.NewTicker,1.5,function() pcall(pump) end)
                    pcall(timer.NewTicker,30,function() pcall(remind) end)
                end
                -- The guild list and the first "what events do you know?" wait for the game to settle.
                if type(timer)=='table' and type(timer.After)=='function' then
                    pcall(timer.After,20,function()
                        if not on() then return end
                        local request=field(plain(C_GuildInfo),'GuildRoster') or plain(GuildRoster)
                        if type(request)=='function' then pcall(request) end
                        -- Your own events and answers go out once, so copies others hold are confirmed.
                        pcall(ask);pcall(answer,true)
                    end)
                end
                return
            end
            if event=='GUILD_ROSTER_UPDATE' then if on() or (type(BackstageForeverGuildSharing)=='function' and BackstageForeverGuildSharing()) then pcall(readRanks) end return end
            if event=='CHAT_MSG_LOOT' then pcall(onLoot,a) return end
            if event=='PLAYER_REGEN_ENABLED' then pcall(flush) return end
            pcall(lookAround)
        end)
    end
end

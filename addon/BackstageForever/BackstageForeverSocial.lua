-- Social helpers (1.23): four small things said in chat, never a frame.
--   /bf group        elite, group, dungeon and raid quests in your log, each with a "looking for group" line
--                    you can click into your chat box. Nothing is ever sent for you.
--   /bf note, notes  your own notes on players, kept on this computer; one line when you meet one again
--   /bf mail         letters that expire within 3 days, said once when you open a mailbox
--   /bf access       marks that do not rely on colour, and larger text in the addon's two main windows
-- Public API only, every game call guarded. Mail is never opened, taken or returned.
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
    for i=2,14 do r[i]=plain(r[i]) end
    return unpackAll(r,2,14)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function num(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return v end end
-- Text from the game or the player, safe to print and to keep: bounded, no colour or link codes.
local function clean(v,max)
    v=plain(v);if type(v)~='string' then return nil end
    v=v:gsub('|',''):gsub('%c',' '):gsub('^%s+',''):gsub('%s+$','')
    if v=='' or #v>(max or 80) then return nil end
    return v
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
local function combat() return call(InCombatLockdown)==true end

-- ---------------------------------------------------------------- switches
-- notes and mail speak until switched off; marks and text are off until switched on.
local DEFAULTS={notes=true,mail=true,marks=false,text=false}
function BackstageForeverSocialEnabled(key)
    local s=BackstageForeverSocialSettings
    local v
    if type(s)=='table' then v=rawget(s,key) end
    if v==true or v==false then return v end
    return DEFAULTS[key]==true
end
local enabled=BackstageForeverSocialEnabled
local function set(key,arg)
    if type(BackstageForeverSocialSettings)~='table' then BackstageForeverSocialSettings={} end
    local on
    if arg=='on' then on=true elseif arg=='off' then on=false else on=not enabled(key) end
    BackstageForeverSocialSettings[key]=on
    return on
end

-- ---------------------------------------------------------------- Q11 group quests
-- The game's quest tag ids: 1 is the elite or group tag, 62/88/89 raid, 81/85 dungeon.
local TAG_KIND={[1]='group',[62]='raid',[88]='raid',[89]='raid',[81]='dungeon',[85]='dungeon'}
local KIND_WORD={group='Group',raid='Raid',dungeon='Dungeon'}
-- Pure. entries = {{title, level, group (suggested players), tagId, tagName}} -> the quests that
-- want more than one player, lowest level first. The game's own tag name is used when it gives one.
function BackstageForeverGroupQuests(entries)
    local out={}
    for _,e in ipairs(type(entries)=='table' and entries or {}) do
        if type(e)=='table' and type(e.title)=='string' and e.title~='' then
            local kind=TAG_KIND[e.tagId]
            if not kind and e.tagId==nil and type(e.tagName)=='string' and e.tagName~='' then kind='tagged' end
            if not kind and type(e.group)=='number' and e.group>1 then kind='group' end
            if kind then
                local level=type(e.level)=='number' and e.level>0 and floor(e.level) or nil
                out[#out+1]={title=e.title,level=level,kind=kind,group=type(e.group)=='number' and e.group>1 and floor(e.group) or nil,
                    word=(type(e.tagName)=='string' and e.tagName~='' and e.tagName) or T(KIND_WORD[kind])}
            end
        end
    end
    table.sort(out,function(a,b)
        local x,y=a.level or 999,b.level or 999
        if x~=y then return x<y end
        return a.title<b.title
    end)
    return out
end
-- Pure: the line a player can send. Their own words would do; this only saves typing.
function BackstageForeverLfgText(quest)
    if type(quest)~='table' or type(quest.title)~='string' then return nil end
    if quest.level then return T(('LFG for [%s] (%s, level %d)'):format(quest.title,quest.word or '',quest.level)) end
    return T(('LFG for [%s] (%s)'):format(quest.title,quest.word or ''))
end
-- Pure: the chat lines for /bf group. clickable: the game can tell the addon about a click on a line.
function BackstageForeverGroupLines(quests,clickable)
    if type(quests)~='table' then return {T('The quest log is not readable in this game client.')} end
    if #quests==0 then return {T('No elite, group, dungeon or raid quest is in your log.')} end
    local lines={T((clickable and 'Group quests in your log: %d. Click a line, or type /bf group 1, to put it in your chat box. Nothing is sent until you press Enter.'
        or 'Group quests in your log: %d. Type /bf group 1 to put the first line in your chat box. Nothing is sent until you press Enter.'):format(#quests))}
    for i=1,min(#quests,10) do
        local q=quests[i]
        local text=BackstageForeverLfgText(q)
        local shown=clickable and ('|cff71d5ff|Haddon:BackstageForever:lfg:%d|h[%s]|h|r'):format(i,text) or text
        lines[#lines+1]=('  %d. %s'):format(i,shown)..(q.group and ('  '..T(('suggested group of %d'):format(q.group))) or '')
    end
    return lines
end
-- Pure: which line a clicked link asks for, or nil when the link is not ours.
function BackstageForeverGroupLinkIndex(link)
    local index=type(link)=='string' and #link<=60 and link:match('^addon:BackstageForever:lfg:(%d+)$')
    index=index and tonumber(index)
    return index and index>=1 and index<=10 and index or nil
end
local function tagOf(api,id)
    if not id then return nil end
    local tag=call(field(api,'GetQuestTagInfo'),id)
    if type(tag)=='table' then return num(field(tag,'tagID'),0,100000),clean(field(tag,'tagName'),30) end
    local tagId,tagName=call(GetQuestTagInfo,id)
    return num(tagId,0,100000),clean(tagName,30)
end
local function questEntries()
    local api=plain(C_QuestLog);local out={}
    local count=num(call(field(api,'GetNumQuestLogEntries')),0,400)
    local getInfo=field(api,'GetInfo')
    if count and type(getInfo)=='function' then
        for i=1,min(count,120) do
            local info=call(getInfo,i)
            if type(info)=='table' and field(info,'isHeader')~=true and field(info,'isHidden')~=true then
                local id=num(field(info,'questID'),1,2147483647)
                local tagId,tagName=tagOf(api,id)
                out[#out+1]={title=clean(field(info,'title'),80),level=num(field(info,'level'),-1,1000),group=num(field(info,'suggestedGroup'),0,40),tagId=tagId,tagName=tagName}
            end
        end
        return out
    end
    -- Older clients: title, level, tag text or suggested group, isHeader, ..., questID in eighth place.
    count=num(call(GetNumQuestLogEntries),0,400)
    if not count or type(plain(GetQuestLogTitle))~='function' then return nil end
    local pvp=plain(PVP)
    for i=1,min(count,120) do
        local title,level,third,header,_,_,_,id=call(GetQuestLogTitle,i)
        if title and not header then
            local tagId,tagName=tagOf(nil,num(id,1,2147483647))
            if not tagName and type(third)=='string' and third~=pvp then tagName=clean(third,30) end
            out[#out+1]={title=clean(title,80),level=num(level,-1,1000),group=type(third)=='number' and num(third,0,40) or nil,tagId=tagId,tagName=tagName}
        end
    end
    return out
end
local groupList,linksHeard=nil,false
-- Puts text in the chat box for the player to read, change and send. It never sends.
local function toChatBox(text)
    local open=field(plain(ChatFrameUtil),'OpenChat') or plain(ChatFrame_OpenChat)
    if type(open)~='function' then return false end
    return (pcall(open,text))
end
local function offer(index)
    local quest=type(groupList)=='table' and groupList[index]
    local text=quest and BackstageForeverLfgText(quest)
    if not text then return say('That line is gone. Type /bf group for a fresh list.') end
    if not toChatBox(text) then say('The chat box cannot be opened from here. The line was:');say('  '..text) end
end
function BackstageForeverGroupLinkClick(link)
    local index=BackstageForeverGroupLinkIndex(plain(link))
    if index then offer(index);return true end
    return false
end
function BackstageForeverGroupCommand(message)
    if combat() then return say('Try /bf group outside combat.') end
    local ok,entries=pcall(questEntries)
    groupList=ok and entries and BackstageForeverGroupQuests(entries) or nil
    local index=type(message)=='string' and #message<=40 and tonumber(message:match('^%a+%s+(%d+)%s*$'))
    if index and groupList then
        if not groupList[index] then return say('There is no line with that number. Type /bf group for the list.') end
        return offer(index)
    end
    for _,line in ipairs(BackstageForeverGroupLines(groupList,linksHeard)) do say(line) end
end

-- ---------------------------------------------------------------- S5 notes on players
local MAX_NOTES,MAX_NOTE=200,120
local MONTHS={'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'}
local function notesOf(db)
    local list=type(db)=='table' and rawget(db,'notes')
    return type(list)=='table' and list or nil
end
local function sameName(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
local function findNote(db,name)
    for i,row in ipairs(notesOf(db) or {}) do
        if type(row)=='table' and sameName(row.name,name) then return row,i end
    end
end
-- Pure: a player name as typed or as the game gives it: letters, an optional -Realm, no digits.
function BackstageForeverNoteName(name)
    if type(name)~='string' or #name<2 or #name>48 then return nil end
    if name:find('[%d%c%p]') and not name:match("^[^%d%c%p]+%-[^%d%c]+$") then return nil end
    return name
end
function BackstageForeverNoteGet(db,name) return (findNote(db,name)) end
-- Pure: keep one note per player; a new note replaces the old one. At most 200, the oldest goes first.
function BackstageForeverNoteSet(db,name,text,at,zone)
    local list=notesOf(db)
    if not list or not BackstageForeverNoteName(name) or type(text)~='string' or text=='' or #text>MAX_NOTE then return nil end
    at=type(at)=='number' and at==at and at or 0
    zone=type(zone)=='string' and zone~='' and #zone<=60 and zone or nil
    local row=findNote(db,name)
    if row then row.name=name;row.text=text;row.at=at;row.zone=zone;return row end
    while #list>=MAX_NOTES do
        local oldest=1
        for i,other in ipairs(list) do if (tonumber(other.at) or 0)<(tonumber(list[oldest].at) or 0) then oldest=i end end
        table.remove(list,oldest)
    end
    row={name=name,text=text,at=at,zone=zone}
    list[#list+1]=row
    return row
end
function BackstageForeverNoteDelete(db,name)
    local row,index=findNote(db,name)
    if row then table.remove(notesOf(db),index) end
    return row
end
local function stamp(at)
    local read=date or (os and os.date)
    local ok,t=pcall(read,'*t',at)
    if ok and type(t)=='table' and type(t.day)=='number' and MONTHS[t.month] then return t.day,T(MONTHS[t.month]) end
end
-- Pure: "Thrall: you noted on 12 Nov in Westfall: good tank".
function BackstageForeverNoteLine(row)
    if type(row)~='table' or type(row.name)~='string' or type(row.text)~='string' then return nil end
    local day,month
    if type(row.at)=='number' and row.at>0 then day,month=stamp(row.at) end
    if day and row.zone then return T(('%s: you noted on %d %s in %s: %s'):format(row.name,day,month,row.zone,row.text)) end
    if day then return T(('%s: you noted on %d %s: %s'):format(row.name,day,month,row.text)) end
    return T(('%s: you noted: %s'):format(row.name,row.text))
end
-- Pure: what "/bf note ..." asks for. rest = the words after "note"; target = the player you have
-- targeted, or nil. -> 'set', name, text | 'show', name | 'delete', name | 'missing', name | 'usage'
function BackstageForeverNoteParse(rest,target,db)
    rest=type(rest)=='string' and rest:gsub('^%s+',''):gsub('%s+$','') or ''
    if rest=='' then
        if target then return 'show',target end
        return 'usage'
    end
    local first,tail=rest:match('^(%S+)%s*(.*)$')
    local named=findNote(db,first)
    if tail=='' then
        if named then return 'delete',named.name end
        if target then return 'set',target,rest end
        return 'missing',first
    end
    if named and not sameName(first,target) then return 'set',named.name,tail end
    if target then return 'set',target,rest end
    if not BackstageForeverNoteName(first) then return 'usage' end
    return 'set',first,tail
end
-- Pure: the chat lines for /bf notes, newest first.
function BackstageForeverNotesLines(db,limit)
    local sorted={}
    for _,row in ipairs(notesOf(db) or {}) do
        if type(row)=='table' and type(row.name)=='string' and type(row.text)=='string' then sorted[#sorted+1]=row end
    end
    if #sorted==0 then return {T('No notes yet. Target a player and type /bf note good tank, or /bf note Name good tank.')} end
    table.sort(sorted,function(a,b)
        local x,y=tonumber(a.at) or 0,tonumber(b.at) or 0
        if x~=y then return x>y end
        return a.name<b.name
    end)
    limit=limit or 15
    local lines={T(('Your notes on players: %d. /bf note Name shows one and deletes it.'):format(#sorted))}
    for i=1,min(#sorted,limit) do lines[#lines+1]='  '..BackstageForeverNoteLine(sorted[i]) end
    if #sorted>limit then lines[#lines+1]='  '..T(('and %d more.'):format(#sorted-limit)) end
    return lines
end
local function notesDB()
    local db=BackstageForeverNotesDB
    if type(db)~='table' or type(rawget(db,'notes'))~='table' then db={v=1,notes={}};BackstageForeverNotesDB=db end
    return db
end
-- "Name" or "Name-Realm" for a unit that is another player, or nil.
local function playerName(unit)
    if call(UnitExists,unit)~=true or call(UnitIsPlayer,unit)~=true or call(UnitIsUnit,unit,'player')==true then return nil end
    local name,realm=call(UnitName,unit)
    name=clean(name,48)
    if not name then return nil end
    realm=clean(realm,40)
    if realm then name=name..'-'..realm end
    return BackstageForeverNoteName(name)
end
function BackstageForeverNoteCommand(message)
    if combat() then return say('Try /bf note outside combat.') end
    local rest=type(message)=='string' and #message<=260 and message:match('^%a+%s*(.*)$') or ''
    local db=notesDB()
    local what,name,text=BackstageForeverNoteParse(rest,playerName('target'),db)
    if what=='usage' then return say('Target a player and type /bf note good tank, or type /bf note Name good tank. /bf notes lists them.') end
    if what=='missing' then return say(('You have no note on %s. To write one: /bf note %s your words.'):format(clean(name,48) or '?',clean(name,48) or 'Name')) end
    if what=='show' then
        local row=BackstageForeverNoteGet(db,name)
        return say(row and BackstageForeverNoteLine(row) or ('You have no note on %s. To write one: /bf note your words.'):format(name))
    end
    if what=='delete' then
        local row=BackstageForeverNoteDelete(db,name)
        if row then say(BackstageForeverNoteLine(row));say(('Note on %s deleted.'):format(row.name)) end
        return
    end
    text=clean(text,MAX_NOTE)
    if not text then return say('Keep the note under 120 characters.') end
    local zone=clean((call(GetRealZoneText)),60) or clean((call(GetZoneText)),60)
    local row=BackstageForeverNoteSet(db,name,text,num(call(GetServerTime),0,1e11) or 0,zone)
    if not row then return say('That is not a player name the addon can keep a note on.') end
    say(('Note on %s saved. It stays on this computer.'):format(row.name))
end
function BackstageForeverNotesCommand(message)
    local arg=type(message)=='string' and #message<=40 and message:lower():match('^notes%s+(%a+)') or nil
    if arg=='on' or arg=='off' then
        return say(set('notes',arg) and 'Player note reminders: on.' or 'Player note reminders: off. /bf notes still lists them.')
    end
    for _,line in ipairs(BackstageForeverNotesLines(notesDB())) do say(line) end
end
-- One line per noted player per session, never in combat.
local reminded={}
local function remind(unit)
    local name=playerName(unit)
    if not name or reminded[name:lower()] then return end
    local row=BackstageForeverNoteGet(notesDB(),name)
    if not row then return end
    reminded[name:lower()]=true
    say(BackstageForeverNoteLine(row))
end
local function meet(group)
    if not enabled('notes') or combat() then return end
    if #(notesOf(BackstageForeverNotesDB) or {})==0 then return end
    if not group then return remind('target') end
    for i=1,4 do remind('party'..i) end
    if call(IsInRaid)==true then for i=1,40 do remind('raid'..i) end end
end

-- ---------------------------------------------------------------- E10 mail expiry
local EXPIRY_DAYS=3
-- Pure. days = the days left on each letter -> {count = letters with under 3 days, soonest, total}.
function BackstageForeverMailExpiry(days)
    local count,soonest,total=0,nil,0
    for _,left in ipairs(type(days)=='table' and days or {}) do
        if type(left)=='number' and left==left and left>=0 and left<=366 then
            total=total+1
            if left<EXPIRY_DAYS then
                count=count+1
                if not soonest or left<soonest then soonest=left end
            end
        end
    end
    return {count=count,soonest=soonest,total=total}
end
local function timeLeft(days)
    if days<1 then return T('less than a day') end
    if days<2 then return T('about a day') end
    return T(('about %d days'):format(floor(days)))
end
-- Pure: the one line said at the mailbox, or nil when nothing expires soon.
function BackstageForeverMailExpiryLine(summary)
    if type(summary)~='table' or type(summary.count)~='number' or summary.count<1 or type(summary.soonest)~='number' then return nil end
    if summary.count==1 then return T(('One letter expires within 3 days: it has %s left.'):format(timeLeft(summary.soonest))) end
    return T(('%d letters expire within 3 days. The soonest has %s left.'):format(summary.count,timeLeft(summary.soonest)))
end
local function readMail()
    local count=num(call(GetInboxNumItems),0,10000)
    if not count then return nil end
    local days={}
    for i=1,min(count,100) do
        -- Seventh value: days left. The sender, subject and text are not kept.
        local _,_,_,_,_,_,left=call(GetInboxHeaderInfo,i)
        days[#days+1]=num(left,0,366)
    end
    return BackstageForeverMailExpiry(days)
end
local mailSaid,mailSeen=nil,nil
local function onMail()
    local summary=readMail()
    if not summary then return end
    mailSeen=summary
    if not enabled('mail') or combat() then return end
    -- Once per visit, and again only when a different letter becomes the soonest.
    local key=summary.count..':'..floor((summary.soonest or 0)*10)
    if summary.count<1 or mailSaid==key then return end
    mailSaid=key
    say(BackstageForeverMailExpiryLine(summary))
end
function BackstageForeverMailCommand(message)
    local arg=type(message)=='string' and #message<=40 and message:lower():match('^mail%s+(%a+)') or nil
    if arg=='on' or arg=='off' then
        return say(set('mail',arg) and 'Mail expiry warning: on.' or 'Mail expiry warning: off. /bf mail still answers.')
    end
    if not mailSeen then return say('Open a mailbox first. The addon reads the days left on each letter there; it never opens mail.') end
    say(BackstageForeverMailExpiryLine(mailSeen) or (mailSeen.total==0 and 'Your mailbox was empty when you last opened it.' or 'No letter in your mailbox expires within 3 days.'))
end

-- ---------------------------------------------------------------- P8 accessibility
-- A short mark in front of a line whose meaning would otherwise sit in its colour alone.
local MARKS={good='[+] ',bad='[x] ',same='[=] ',warn='[!] ',danger='[!!] '}
function BackstageForeverMark(kind)
    if not enabled('marks') then return '' end
    return MARKS[kind] or ''
end
-- P7 (1.26): "large buttons" for handhelds and controllers scales the same windows a further 30%
-- on top of the text setting, and the owl button on the minimap with them.
local TEXT_SCALE,LARGE_SCALE=1.15,1.3
function BackstageForeverButtonScale() return enabled('large') and LARGE_SCALE or 1 end
function BackstageForeverTextScale() return (enabled('text') and TEXT_SCALE or 1)*BackstageForeverButtonScale() end
function BackstageForeverApplyButtonSize(frame)
    frame=plain(frame)
    if type(frame)~='table' or type(frame.SetScale)~='function' then return false end
    return (pcall(frame.SetScale,frame,BackstageForeverButtonScale()))
end
-- The addon's windows each pick their own game fonts, so "larger text" scales the whole window:
-- the Adventure Compass, the settings window and the welcome card.
function BackstageForeverApplyTextSize(frame)
    frame=plain(frame)
    if type(frame)~='table' or type(frame.SetScale)~='function' then return false end
    return (pcall(frame.SetScale,frame,BackstageForeverTextScale()))
end
local SCALED={'BackstageForeverCompass','BackstageForeverOptions','BackstageForeverWelcome','BackstageForeverRouteFrame'}
local BUTTONS={'BackstageForeverAskButton'}
local ACCESS={marks='Marks without colour',text='Larger window text',large='Large buttons'}
function BackstageForeverAccessCommand(message)
    local which,arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^access%s*(%a*)%s*(%a*)')
    if which and ACCESS[which] then
        if which=='text' and combat() then return say('Change the text size outside combat.') end
        if which=='large' and combat() then return say('Change the button size outside combat.') end
        local on=set(which,arg)
        if which=='text' or which=='large' then for _,name in ipairs(SCALED) do BackstageForeverApplyTextSize(_G[name]) end end
        if which=='large' then for _,name in ipairs(BUTTONS) do BackstageForeverApplyButtonSize(_G[name]) end end
        say(T(ACCESS[which])..' — '..T(on and 'On' or 'Off'))
        return on
    end
    say('Accessibility (each is off until you switch it on):')
    say('  '..T(ACCESS.marks)..' — '..T(enabled('marks') and 'On' or 'Off')..' (/bf access marks '..(enabled('marks') and 'off' or 'on')..')')
    say('  '..T(ACCESS.text)..' — '..T(enabled('text') and 'On' or 'Off')..' (/bf access text '..(enabled('text') and 'off' or 'on')..')')
    say('  '..T(ACCESS.large)..' — '..T(enabled('large') and 'On' or 'Off')..' (/bf access large '..(enabled('large') and 'off' or 'on')..')')
end

-- ---------------------------------------------------------------- events
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_TARGET_CHANGED','GROUP_ROSTER_UPDATE','PLAYER_REGEN_ENABLED','MAIL_SHOW','MAIL_INBOX_UPDATE','MAIL_CLOSED'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Social',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then
                notesDB()
                -- The game tells addons about a click on their own chat links; the click is only read.
                local registry=plain(EventRegistry)
                if type(registry)=='table' and type(registry.RegisterCallback)=='function' then
                    linksHeard=pcall(registry.RegisterCallback,registry,'SetItemRef',function(_,link) pcall(BackstageForeverGroupLinkClick,link) end,events)
                end
            elseif event=='PLAYER_TARGET_CHANGED' then pcall(meet,false)
            elseif event=='GROUP_ROSTER_UPDATE' then pcall(meet,true)
            elseif event=='PLAYER_REGEN_ENABLED' then pcall(meet,false);pcall(meet,true)
            elseif event=='MAIL_CLOSED' then mailSaid=nil
            else pcall(onMail) end
        end)
    end
end

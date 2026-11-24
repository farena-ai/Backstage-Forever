-- Raid comms (1.26, roadmap G9): text notes for a raid, over the game's own addon messages to
-- your RAID only. Its own switch, off until you turn it on; off means nothing is sent and nothing
-- is read. No timers, no countdowns, nothing automatic in a fight.
--   /bf raid on|off                    this character's switch
--   /bf raid note Boss: text           (leader or assistant) a note for one boss, shared with the raid;
--                                      everybody sees it as one chat line when they target that boss
--   /bf raid notes                     the notes you have; /bf raid notes share sends yours again
--   /bf raid assign Player text        (leader or assistant) that player sees "Your job: text"
--   /bf raid check                     (leader or assistant) a readiness roll-up of the raid
--   /bf raid clear                     forgets your own notes
-- Notes and assignments are accepted only from the raid leader or an assistant, checked against
-- the raid roster. Everything that arrives is checked field by field, cut to a fixed length and
-- shown as plain text. It uses the party sync channel code (BackstageForeverParty.lua).
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
local function combat() return call(InCombatLockdown)==true end
local function now() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function safe(text,max)
    local fn=BackstageForeverChatSafe
    if type(fn)~='function' then return nil end
    local ok,out=pcall(fn,text,max)
    return ok and type(out)=='string' and out or nil
end
local function playerName(name)
    local fn=BackstageForeverCrewName
    if type(fn)~='function' then return nil end
    local ok,out=pcall(fn,name)
    return ok and type(out)=='string' and out or nil
end
local function allow(state,key,at,gap)
    local fn=BackstageForeverCrewRate
    if type(fn)~='function' then return false end
    local ok,yes=pcall(fn,state,key,at,gap)
    return ok and yes==true
end

-- ---------------------------------------------------------------- pure
local BOSS_MAX,NOTE_MAX,JOB_MAX,NOTES=32,120,100,10
BackstageForeverRaidNoteLimit=NOTES
-- Pure: a boss name as typed or received: one line of plain text, 2 to 32 bytes, no ":" (the
-- command uses it to end the name).
function BackstageForeverRaidBoss(text)
    text=safe(text,BOSS_MAX)
    if not text then return nil end
    text=text:gsub(':',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text<2 then return nil end
    return text
end
-- Pure: "N|Lucifron|Decurse the tanks first".
function BackstageForeverRaidNoteEncode(boss,text)
    boss=BackstageForeverRaidBoss(boss)
    text=safe(text,NOTE_MAX)
    if not boss or not text then return nil end
    return 'N|'..boss..'|'..text
end
-- Pure: a note message back into boss and text, or nil when anything about it is off.
function BackstageForeverRaidNoteDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local boss,text=message:match('^N|([^|]+)|([^|]+)$')
    if not boss or BackstageForeverRaidBoss(boss)~=boss or safe(text,NOTE_MAX)~=text then return nil end
    return boss,text
end
-- Pure: "J|Thrall|dispel the left side".
function BackstageForeverRaidJobEncode(player,text)
    player=playerName(player)
    text=safe(text,JOB_MAX)
    if not player or not text then return nil end
    return 'J|'..player..'|'..text
end
function BackstageForeverRaidJobDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local player,text=message:match('^J|([^|]+)|([^|]+)$')
    if not player or playerName(player)~=player or safe(text,JOB_MAX)~=text then return nil end
    return player,text
end
-- Pure: what follows "/bf raid note": "Boss Name: text" or "Boss text". -> boss, text (text nil: remove).
function BackstageForeverRaidNoteArgs(rest)
    if type(rest)~='string' or #rest>260 then return nil end
    local boss,text=rest:match('^%s*([^:]-)%s*:%s*(.-)%s*$')
    if not boss then boss,text=rest:match('^%s*(%S+)%s*(.-)%s*$') end
    boss=BackstageForeverRaidBoss(boss)
    if not boss then return nil end
    return boss,safe(text,NOTE_MAX)
end
local function short(name) return type(name)=='string' and (name:gsub('%-.*$','')):lower() or nil end
-- Pure: the raid rank of a player: 2 leader, 1 assistant, 0 member, nil when not in the roster.
-- roster = {{name=,rank=}} as GetRaidRosterInfo gives it.
function BackstageForeverRaidRank(roster,name)
    local want=short(name)
    if not want or want=='' then return nil end
    for _,row in ipairs(type(roster)=='table' and roster or {}) do
        if type(row)=='table' and short(row.name)==want then
            local rank=row.rank
            if rank==2 or rank==1 or rank==0 then return rank end
            return nil
        end
    end
end
-- Pure: keeps one note per boss, at most ten; the oldest makes room. text nil removes the note.
-- -> 'set', 'gone' or nil.
function BackstageForeverRaidStore(notes,boss,text,from,at)
    boss=BackstageForeverRaidBoss(boss)
    if type(notes)~='table' or not boss then return nil end
    local key=boss:lower()
    local remove=text==nil
    if not remove then
        text=safe(text,NOTE_MAX)
        if not text then return nil end
    end
    for i,row in ipairs(notes) do
        if type(row)=='table' and type(row.boss)=='string' and row.boss:lower()==key then
            if remove then table.remove(notes,i) return 'gone' end
            notes[i]={boss=boss,text=text,from=from,at=at}
            return 'set'
        end
    end
    if remove then return nil end
    while #notes>=NOTES do
        local oldest=1
        for i,row in ipairs(notes) do if (row.at or 0)<(notes[oldest].at or 0) then oldest=i end end
        table.remove(notes,oldest)
    end
    notes[#notes+1]={boss=boss,text=text,from=from,at=at}
    return 'set'
end
-- Pure: the note for what you target: the same name, or a note name of four letters or more that
-- is part of the target's name ("Majordomo" for "Majordomo Executus").
function BackstageForeverRaidMatch(notes,target)
    if type(target)~='string' or target=='' or #target>100 then return nil end
    local name=target:lower()
    local part
    for _,row in ipairs(type(notes)=='table' and notes or {}) do
        if type(row)=='table' and type(row.boss)=='string' then
            local key=row.boss:lower()
            if key==name then return row end
            if not part and #key>=4 and name:find(key,1,true) then part=row end
        end
    end
    return part
end
-- Pure: the chat lines for /bf raid notes.
function BackstageForeverRaidNoteLines(mine,theirs)
    local lines={}
    for _,pair in ipairs({{mine,true},{theirs,false}}) do
        for _,row in ipairs(type(pair[1])=='table' and pair[1] or {}) do
            if type(row)=='table' and row.boss and row.text then
                lines[#lines+1]=('  %s: %s'):format(row.boss,row.text)..((not pair[2] and row.from) and (' ('..row.from..')') or '')
            end
        end
    end
    if #lines==0 then return {T('No raid notes yet. A leader or assistant adds one: /bf raid note Boss: text.')} end
    table.insert(lines,1,T(('Raid notes: %d.'):format(#lines)))
    return lines
end
-- Pure: the readiness roll-up. members: raid names in order; answers: {[name]=status} with the
-- fields of the party readiness check (durability, free, low).
function BackstageForeverRaidRollup(members,answers,limit)
    members=type(members)=='table' and members or {}
    answers=type(answers)=='table' and answers or {}
    limit=type(limit)=='number' and limit or 8
    local answered,low,worn,full=0,{},{},{}
    for _,name in ipairs(members) do
        local s=answers[name]
        if type(s)=='table' then
            answered=answered+1
            if type(s.low)=='number' and s.low>0 then low[#low+1]=name..' '..s.low end
            if type(s.durability)=='number' and s.durability<30 then worn[#worn+1]=name..' '..s.durability..'%' end
            if type(s.free)=='number' and s.free<5 then full[#full+1]=name..' '..s.free end
        end
    end
    local function list(names)
        local shown={}
        for i=1,min(#names,limit) do shown[i]=names[i] end
        return table.concat(shown,', ')..(#names>limit and (' +'..(#names-limit)) or '')
    end
    local lines={T(('Raid readiness: %d of %d answered.'):format(answered,#members))}
    if #low>0 then lines[#lines+1]='  '..T('Class kit items low:')..' '..list(low)..'.' end
    if #worn>0 then lines[#lines+1]='  '..T('Most worn gear under 30%:')..' '..list(worn)..'.' end
    if #full>0 then lines[#lines+1]='  '..T('Fewer than 5 bag slots free:')..' '..list(full)..'.' end
    if answered>0 and #low==0 and #worn==0 and #full==0 then lines[#lines+1]='  '..T('Everyone who answered is stocked, repaired and has bag space.') end
    if answered<#members then lines[#lines+1]='  '..T(('No answer from %d (no addon, raid comms off, or answers off).'):format(#members-answered)) end
    return lines
end

-- ---------------------------------------------------------------- live
local function settings()
    if type(BackstageForeverRaidSettings)~='table' then BackstageForeverRaidSettings={} end
    return BackstageForeverRaidSettings
end
function BackstageForeverRaidOn()
    local s=BackstageForeverRaidSettings
    return type(s)=='table' and rawget(s,'enabled')==true
end
local checked=false
local function ownNotes()
    local s=settings()
    if type(s.notes)~='table' then s.notes={} end
    if not checked then
        checked=true
        local clean={}
        for _,row in ipairs(s.notes) do if type(row)=='table' then BackstageForeverRaidStore(clean,row.boss,safe(row.text,NOTE_MAX),nil,type(row.at)=='number' and row.at or 0) end end
        s.notes=clean
    end
    return s.notes
end
local theirs,rate,said={},{},{}
BackstageForeverRaidNotes=theirs
local job=nil -- the last assignment given to you: {text=,from=}
local rollup=nil -- the roll-up you asked for: {at=,members=,answers=}
local function inRaid() return call(IsInRaid)==true end
local function roster()
    local rows={}
    if type(plain(GetRaidRosterInfo))~='function' then return nil end
    for i=1,40 do
        local name,rank=call(GetRaidRosterInfo,i)
        if type(name)=='string' and name~='' and #name<=60 then rows[#rows+1]={name=name,rank=rank} end
    end
    return rows
end
local function myName() local n=call(UnitName,'player');return type(n)=='string' and n or nil end
-- May this player give notes and assignments? Only a leader or assistant the roster names.
local function leads(name)
    local rank=BackstageForeverRaidRank(roster(),name)
    return rank==1 or rank==2
end
local function send(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' then return false end
    local ok,sent=pcall(fn,text,'RAID')
    return ok and sent==true
end
local function onNote(sender,message)
    local boss,text=BackstageForeverRaidNoteDecode(message)
    if not boss or not leads(sender) then return end
    -- At most twenty notes a minute from one player: a full resend fits, a flood does not.
    local at=now()
    local seen=rate['n:'..sender]
    if not seen or at-seen.at>=60 or at<seen.at then seen={at=at,n=0};rate['n:'..sender]=seen end
    seen.n=seen.n+1
    if seen.n>NOTES*2 then return end
    BackstageForeverRaidStore(theirs,boss,text,sender,at)
end
local function onJob(sender,message)
    local player,text=BackstageForeverRaidJobDecode(message)
    local me=myName()
    if not player or not me or short(player)~=short(me) or not leads(sender) then return end
    if not allow(rate,'job:'..sender,now(),3) then return end
    job={text=text,from=sender}
    -- An assignment may arrive mid-fight; it waits for the end of combat like every other line.
    if combat() then job.waiting=true return end
    say(('Your job: %s (from %s)'):format(text,sender))
end
local function onAsked(sender,message)
    if message~='K?' or not leads(sender) then return end
    if type(BackstageForeverCheckAnswers)=='function' and BackstageForeverCheckAnswers()==false then return end
    if not allow(rate,'answer',now(),30) then return end
    local mine=BackstageForeverCheckMine
    local encode=BackstageForeverCheckEncode
    if type(mine)~='function' or type(encode)~='function' then return end
    local ok,status=pcall(mine,'-')
    if ok and type(status)=='table' then send(encode(status)) end
end
local function onAnswer(sender,message)
    if not rollup or now()-rollup.at>30 or type(BackstageForeverCheckDecode)~='function' then return end
    local status=BackstageForeverCheckDecode(message)
    if not status or status.dungeon then return end
    for _,name in ipairs(rollup.members) do if short(name)==short(sender) then rollup.answers[name]=status end end
end
local function showRollup()
    if not rollup then return say('No raid check yet. A leader or assistant types /bf raid check.') end
    for _,line in ipairs(BackstageForeverRaidRollup(rollup.members,rollup.answers)) do say(line) end
    rollup.shown=true
end
local function onTarget()
    if not BackstageForeverRaidOn() or not inRaid() or combat() then return end
    local name=call(UnitName,'target')
    if type(name)~='string' or call(UnitIsPlayer,'target')==true then return end
    local note=BackstageForeverRaidMatch(theirs,name) or BackstageForeverRaidMatch(ownNotes(),name)
    if not note then return end
    -- One line per boss, not again for two minutes.
    if not allow(said,note.boss:lower(),now(),120) then return end
    say(('Raid note for %s: %s'):format(note.boss,note.text))
end
local HELP='Raid comms: /bf raid note Boss: text, /bf raid notes, /bf raid assign Player text, /bf raid check. Notes and jobs come from the leader or an assistant.'
function BackstageForeverRaidCommand(message)
    local rest=type(message)=='string' and #message<=300 and message:match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:match('^(%S*)%s*(.*)$')
    word=word:lower()
    local s=settings()
    if word=='on' or word=='off' then
        s.enabled=word=='on'
        if not s.enabled then for i=#theirs,1,-1 do theirs[i]=nil end job,rollup=nil,nil end
        return say(s.enabled and 'Raid comms: on. Boss notes, assignments and readiness answers are shared inside your raid with players who run Backstage Forever. /bf raid off stops it.'
            or 'Raid comms: off. Nothing is sent to a raid and nothing is read.')
    end
    if word=='clear' then
        s.notes={};checked=true
        return say('Your own raid notes are cleared.')
    end
    if word=='' then
        say(s.enabled and 'Raid comms are on.' or 'Raid comms are off. /bf raid on turns them on for this character.')
        if job then say(('Your job: %s (from %s)'):format(job.text,job.from)) end
        return say(HELP)
    end
    if word=='notes' and tail:lower()~='share' then
        for _,line in ipairs(BackstageForeverRaidNoteLines(ownNotes(),theirs)) do say(line) end
        return
    end
    if word=='note' then
        local boss,text=BackstageForeverRaidNoteArgs(tail)
        if not boss then return say('Use /bf raid note Boss: text, for example /bf raid note Lucifron: decurse the tanks first.') end
        -- Outside a raid you may prepare notes; inside one only a leader or assistant writes them.
        if inRaid() and not leads(myName()) then return say('Only the raid leader or an assistant writes raid notes. /bf raid notes shows them.') end
        local result=BackstageForeverRaidStore(ownNotes(),boss,text,nil,now())
        if result=='gone' then return say(('Raid note for %s removed.'):format(boss)) end
        if not result then return say('Write a short note after the boss name (up to 120 characters).') end
        say(('Raid note for %s saved: %s'):format(boss,text))
        if not inRaid() then return say('You are not in a raid, so it is kept for later. /bf raid notes share sends your notes to a raid.') end
        if not s.enabled then return say('Raid comms are off, so the note is not shared. /bf raid on turns them on.') end
        if allow(rate,'note',now(),1) then send(BackstageForeverRaidNoteEncode(boss,text)) else say('Notes go out one a second; /bf raid notes share sends this one again.') end
        return
    end
    if word=='show' then return showRollup() end
    if not s.enabled then return say('Raid comms are off. /bf raid on turns them on for this character.') end
    if not inRaid() then return say('Join a raid first. Raid comms work inside your raid only.') end
    if not leads(myName()) then return say('Only the raid leader or an assistant can do that. /bf raid notes shows the notes.') end
    if word=='notes' then
        if not allow(rate,'share',now(),30) then return say('You shared your notes a moment ago. Wait half a minute.') end
        local n=0
        for _,row in ipairs(ownNotes()) do
            local text=BackstageForeverRaidNoteEncode(row.boss,row.text)
            if text and send(text) then n=n+1 end
        end
        return say(('Shared %d raid notes with your raid.'):format(n))
    end
    if word=='assign' then
        local player,text=tail:match('^(%S+)%s+(.+)$')
        local body=BackstageForeverRaidJobEncode(player,text)
        if not body then return say('Use /bf raid assign Player text, for example /bf raid assign Thrall dispel the left side.') end
        if BackstageForeverRaidRank(roster(),player)==nil then return say('That player is not in your raid.') end
        if not allow(rate,'assign',now(),2) then return say('Wait a few seconds before the next one.') end
        if not send(body) then return say('Raid comms are not available in this game client.') end
        local to,what=BackstageForeverRaidJobDecode(body)
        if short(to)==short(myName()) then job={text=what,from=myName()} end
        return say(('Assignment sent to %s: %s. They see it only with Backstage Forever and raid comms on.'):format(to,what))
    end
    if word=='check' then
        local at=now()
        if not allow(rate,'ask',at,30) then return say('You asked a moment ago. /bf raid show prints the roll-up again.') end
        local members={}
        local me=short(myName())
        for _,row in ipairs(roster() or {}) do if short(row.name)~=me then members[#members+1]=row.name end end
        rollup={at=at,members=members,answers={}}
        if not send('K?') then return say('Raid comms are not available in this game client.') end
        local asked=rollup
        local after=field(plain(C_Timer),'After')
        if type(after)=='function' and pcall(after,6,function() if rollup==asked and not asked.shown then pcall(showRollup) end end) then
            return say('Asked your raid. The roll-up follows in a few seconds.')
        end
        return say('Asked your raid. Type /bf raid show in a few seconds to read the roll-up.')
    end
    say(HELP)
end

if type(BackstageForeverPartyHandle)=='function' then
    BackstageForeverPartyHandle('N',onNote,'RAID')
    BackstageForeverPartyHandle('J',onJob,'RAID')
    BackstageForeverPartyHandle('K',onAsked,'RAID')
    BackstageForeverPartyHandle('A',onAnswer,'RAID')
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Raid',events) end
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_TARGET_CHANGED','GROUP_ROSTER_UPDATE','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then settings() return end
            if event=='PLAYER_TARGET_CHANGED' then pcall(onTarget) return end
            if event=='PLAYER_REGEN_ENABLED' then
                if job and job.waiting then job.waiting=nil;say(('Your job: %s (from %s)'):format(job.text,job.from)) end
                return
            end
            -- Notes from a raid you left are forgotten.
            if not inRaid() then for i=#theirs,1,-1 do theirs[i]=nil end job,rollup=nil,nil end
        end)
    end
end

-- Party helpers on top of party sync (1.25): three things said in chat, never a frame.
--   /bf check [dungeon]   readiness check (G8): asks party members who run the addon for a short status
--   /bf mentor Name       mentor link (S3): a party member shares their next step with you, if they accept
--   /bf sr add Player Item   soft-reserve list (G12) kept by the party leader and shown to the party
-- All three use the party sync channel (BackstageForeverParty.lua): your party only, never a raid,
-- a whisper or the desktop app, and nothing at all while party sync is off.
-- Everything that arrives from another player is checked field by field, cut to a fixed length and
-- shown as plain text: no colour codes, no links, nothing is ever run.
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
local function raw(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local say=raw
local function combat() return call(InCombatLockdown)==true end
local function now() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function send(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' then return false end
    local ok,sent=pcall(fn,text,'PARTY')
    return ok and sent==true
end
local function partyOn()
    local fn=BackstageForeverPartyOn
    if type(fn)~='function' then return false end
    local ok,on=pcall(fn)
    return ok and on==true
end
local function inParty() return call(IsInGroup)==true and call(IsInRaid)~=true end
local function shortName(n)
    local short=call(Ambiguate,n,'short')
    return type(short)=='string' and short~='' and short or n
end
local function myName() local n=call(UnitName,'player');return type(n)=='string' and n or nil end
local function partyNames()
    local names={}
    for i=1,4 do
        local n=call(UnitName,'party'..i)
        if type(n)=='string' and n~='' and #n<=48 then names[#names+1]=n end
    end
    return names
end

-- ---------------------------------------------------------------- shared pure helpers
-- Pure: text from another player made safe to print: one line, no colour or link codes, cut to max bytes.
function BackstageForeverChatSafe(text,max)
    if type(text)~='string' then return nil end
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|T[^|]*|t',''):gsub('|[hr]',''):gsub('|',''):gsub('%c',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    max=type(max)=='number' and max or 120
    if #text>max then text=text:sub(1,max):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    if text=='' then return nil end
    return text
end
-- Pure: a player name inside a message: letters only (an optional -Realm), 2 to 48 bytes.
function BackstageForeverCrewName(name)
    if type(name)~='string' or #name<2 or #name>48 or name:find('[%d%c%s|=;]') then return nil end
    if name:find('%p') and not name:match('^[^%p]+%-[^%p]+$') then return nil end
    return name
end
local function sameName(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
-- Pure: true at most once per gap seconds for one key. state remembers when each key last passed.
function BackstageForeverCrewRate(state,key,at,gap)
    if type(state)~='table' or type(at)~='number' or type(gap)~='number' then return false end
    local last=state[key]
    if type(last)=='number' and at>=last and at-last<gap then return false end
    state[key]=at
    return true
end
local rate={}
local GAP=10
-- A whole number written in at most three digits and inside lo..hi, '-' for "not known", or false.
local function count(text,lo,hi)
    if text=='-' then return nil,true end
    if not text:match('^%d%d?%d?$') then return nil,false end
    local n=tonumber(text)
    if n<lo or n>hi then return nil,false end
    return n,true
end
local function dungeonId(text) return type(text)=='string' and #text<=8 and text:match('^%l[%l%d]*$') and text or nil end
local function dungeonName(id)
    if not id then return nil end
    local fn=BackstageForeverLfgName
    if type(fn)=='function' then local ok,name=pcall(fn,id) if ok and type(name)=='string' then return name end end
    return id
end

-- ---------------------------------------------------------------- G8 readiness check
-- The key each place asks for, checked by name against the game's own data on build 1.60.1.71037:
-- The Scarlet Key, Workshop Key, Shadowforge Key, Seal of Ascension, Skeleton Key, Key to the City,
-- Crescent Key, Drakefire Amulet.
local KEYS={sm=7146,gnomer=6893,brd=11000,ubrs=12344,scholo=13704,strat=12382,dme=18249,ony=16309}
BackstageForeverCheckKeys=KEYS
-- Pure: the question. "C|sm" for a dungeon, "C|-" for none.
function BackstageForeverCheckRequest(dungeon) return 'C|'..(dungeonId(dungeon) or '-') end
-- Pure: the dungeon a question names, '-' for none, nil when the message is not a clean question.
function BackstageForeverCheckAsked(message)
    if type(message)~='string' or #message>12 then return nil end
    local d=message:match('^C|(.+)$')
    if d=='-' then return '-' end
    return dungeonId(d)
end
-- Pure: the answer. Six fields and nothing else: the dungeon asked about, how many of its quests
-- are in your log, whether you carry its key, your most worn gear slot in percent, free bag slots,
-- and how many things of your class kit are low. "-" stands for "not known".
function BackstageForeverCheckEncode(status)
    status=type(status)=='table' and status or {}
    local function n(v,lo,hi) return type(v)=='number' and v==v and v>=lo and v<=hi and tostring(floor(v)) or '-' end
    local key='-'
    if status.key==true then key='1' elseif status.key==false then key='0' end
    return ('A|%s|%s|%s|%s|%s|%s'):format(dungeonId(status.dungeon) or '-',n(status.quests,0,40),key,n(status.durability,0,100),n(status.free,0,999),n(status.low,0,20))
end
-- Pure: an answer back into its fields, or nil when anything about it is off.
function BackstageForeverCheckDecode(message)
    if type(message)~='string' or #message>40 then return nil end
    local d,q,k,dur,free,low=message:match('^A|([^|]+)|([^|]+)|([^|]+)|([^|]+)|([^|]+)|([^|]+)$')
    if not d or (d~='-' and not dungeonId(d)) or (k~='1' and k~='0' and k~='-') then return nil end
    local status={dungeon=d~='-' and d or nil}
    local ok
    status.quests,ok=count(q,0,40);if not ok then return nil end
    status.durability,ok=count(dur,0,100);if not ok then return nil end
    status.free,ok=count(free,0,999);if not ok then return nil end
    status.low,ok=count(low,0,20);if not ok then return nil end
    if k=='1' then status.key=true elseif k=='0' then status.key=false end
    return status
end
-- Pure: how many quests the Instance Atlas lists for a dungeon are in a quest log.
-- data: BackstageForeverAtlasData; logQuests: the captured log. nil when either is not known.
function BackstageForeverCheckQuests(data,dungeon,logQuests)
    if type(data)~='table' or type(logQuests)~='table' or not dungeonId(dungeon) then return nil end
    local listed
    for _,row in ipairs(data) do
        if type(row)=='table' and row[1]==dungeon then
            listed={}
            for _,q in ipairs(type(row[11])=='table' and row[11] or {}) do if type(q)=='table' and type(q[1])=='number' then listed[q[1]]=true end end
        end
    end
    if not listed then return nil end
    local n=0
    for _,quest in ipairs(logQuests) do if type(quest)=='table' and listed[quest.id] then n=n+1;listed[quest.id]=nil end end
    return min(n,40)
end
-- Pure: one line for one player. status nil: they did not answer.
function BackstageForeverCheckLine(name,status,place)
    name=tostring(name or '?')
    if type(status)~='table' then return T(('%s: no answer (no addon, or answers are off).'):format(name)) end
    local parts={}
    if place and status.quests then
        parts[#parts+1]=status.quests==0 and T(('no quest for %s'):format(place)) or status.quests==1 and T(('1 quest for %s'):format(place)) or T(('%d quests for %s'):format(status.quests,place))
    end
    if status.key==true then parts[#parts+1]=T('has the key') elseif status.key==false then parts[#parts+1]=T('no key') end
    if status.durability then parts[#parts+1]=T(('most worn gear at %d%%'):format(status.durability)) end
    if status.free then parts[#parts+1]=T(('%d bag slots free'):format(status.free)) end
    if status.low then parts[#parts+1]=status.low==0 and T('class kit fine') or status.low==1 and T('1 kit item low') or T(('%d kit items low'):format(status.low)) end
    if #parts==0 then return T(('%s: answered, but nothing was readable.'):format(name)) end
    return name..': '..table.concat(parts,', ')..'.'
end
-- Pure: the lines of a finished check: you first, then each party member, in party order.
function BackstageForeverCheckReport(dungeon,mine,members,answers)
    local place=dungeon and dungeon~='-' and dungeonName(dungeon) or nil
    local lines={place and T(('Readiness check for %s:'):format(place)) or T('Readiness check:')}
    lines[#lines+1]='  '..BackstageForeverCheckLine(T('You'),mine,place)
    for _,name in ipairs(type(members)=='table' and members or {}) do
        lines[#lines+1]='  '..BackstageForeverCheckLine(name,type(answers)=='table' and answers[name] or nil,place)
    end
    return lines
end

-- G6 (1.26) who still needs each dungeon quest. A member who answers a check for a named dungeon
-- also sends where each of that dungeon's quests stands for them: l in the log, r ready to hand
-- in, d done. A quest they do not list is one they have not picked up.
local DQ_MAX,DQ_STATE=30,{l=true,r=true,d=true}
-- Pure: "D|sm|2040l;2041r;2046d". states: {{id=,state=}}; at most 30 quests and 255 bytes.
function BackstageForeverCheckQuestEncode(dungeon,states)
    dungeon=dungeonId(dungeon)
    if not dungeon then return nil end
    local text,n,seen='D|'..dungeon..'|',0,{}
    for _,row in ipairs(type(states)=='table' and states or {}) do
        local id=type(row)=='table' and row.id
        if type(id)=='number' and id==floor(id) and id>=1 and id<=9999999 and DQ_STATE[row.state] and not seen[id] and n<DQ_MAX then
            local piece=(n>0 and ';' or '')..id..row.state
            if #text+#piece>255 then break end
            text=text..piece;n=n+1;seen[id]=true
        end
    end
    return text
end
-- Pure: a message back into the dungeon and {[questId]=state}, or nil when anything about it is off.
function BackstageForeverCheckQuestDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local d,body=message:match('^D|([^|]+)|([%d;lrd]*)$')
    if not d or not dungeonId(d) then return nil end
    local states,n={},0
    if body~='' then
        if body:sub(1,1)==';' or body:sub(-1)==';' or body:find(';;',1,true) then return nil end
        for entry in body:gmatch('[^;]+') do
            local id,state=entry:match('^([1-9]%d?%d?%d?%d?%d?%d?)([lrd])$')
            id=tonumber(id)
            if not id or states[id] or n>=DQ_MAX then return nil end
            states[id]=state;n=n+1
        end
    end
    return d,states
end
-- Pure: where each quest the Instance Atlas lists for a dungeon stands for you. state(id) returns
-- 'done', 'ready', 'log' or nil. -> {{id=,state=}} for the encoder, or nil when the dungeon is not listed.
function BackstageForeverCheckQuestStates(data,dungeon,state)
    if type(data)~='table' or not dungeonId(dungeon) or type(state)~='function' then return nil end
    local LETTER={done='d',ready='r',log='l'}
    for _,row in ipairs(data) do
        if type(row)=='table' and row[1]==dungeon then
            local out={}
            for _,q in ipairs(type(row[11])=='table' and row[11] or {}) do
                local id=type(q)=='table' and q[1]
                if type(id)=='number' then
                    local ok,s=pcall(state,id)
                    if ok and LETTER[s] then out[#out+1]={id=id,state=LETTER[s]} end
                end
            end
            return out
        end
    end
end
-- Pure: who still needs each quest. quests: {{id=,title=}} (the atlas list for your side);
-- mine: your own {[id]=state}; members: party names in order; answers: {[name]={[id]=state}}.
-- -> {[questId]={names...}} where "You" stands for yourself. Done and ready-to-hand-in do not count.
function BackstageForeverCheckQuestNeeders(quests,mine,members,answers)
    local out={}
    local function needs(states,id) return type(states)=='table' and states[id]~='d' and states[id]~='r' end
    for _,q in ipairs(type(quests)=='table' and quests or {}) do
        if type(q)=='table' and type(q.id)=='number' then
            local names={}
            if needs(mine,q.id) then names[#names+1]=T('You') end
            for _,name in ipairs(type(members)=='table' and members or {}) do
                if needs(type(answers)=='table' and answers[name] or nil,q.id) then names[#names+1]=name end
            end
            if #names>0 then out[q.id]=names end
        end
    end
    return out
end
-- Pure: the chat lines under a readiness check: one line per quest somebody still needs.
function BackstageForeverCheckQuestLines(quests,mine,members,answers,limit)
    local lines={}
    quests=type(quests)=='table' and quests or {}
    if #quests==0 then return lines end
    local silent={}
    for _,name in ipairs(type(members)=='table' and members or {}) do
        if type(answers)~='table' or type(answers[name])~='table' then silent[#silent+1]=name end
    end
    local needers=BackstageForeverCheckQuestNeeders(quests,mine,members,answers)
    limit=type(limit)=='number' and limit or 8
    local shown,open=0,0
    for _,q in ipairs(quests) do
        local names=needers[q.id]
        if names then
            open=open+1
            if shown<limit then
                shown=shown+1
                lines[#lines+1]='  '..T(('%s: still needed by %s.'):format(BackstageForeverChatSafe(tostring(q.title or ('#'..q.id)),60) or ('#'..q.id),table.concat(names,', ')))
            end
        end
    end
    if open==0 then table.insert(lines,1,T('Dungeon quests: everyone who answered has them done or ready to hand in.'))
    else table.insert(lines,1,T(('Dungeon quests somebody still needs: %d of %d.'):format(open,#quests))) end
    if open>shown then lines[#lines+1]='  '..T(('and %d more.'):format(open-shown)) end
    if #silent>0 then lines[#lines+1]='  '..T(('No quest answer from: %s.'):format(table.concat(silent,', '))) end
    return lines
end

local latest=nil -- the newest capture of this character; read, never changed
function BackstageForeverCrewUpdate(character) latest=type(character)=='table' and character or nil end
function BackstageForeverCheckAnswers()
    local s=BackstageForeverPartySettings
    return type(s)~='table' or rawget(s,'answerChecks')~=false
end
local function itemCount(id)
    local n=call(field(plain(C_Item),'GetItemCount'),id)
    if type(n)~='number' then n=call(GetItemCount,id) end
    return type(n)=='number' and n or nil
end
local function myStatus(dungeon)
    local status={dungeon=dungeon~='-' and dungeon or nil}
    status.quests=status.dungeon and BackstageForeverCheckQuests(BackstageForeverAtlasData,status.dungeon,latest and latest.quests or nil) or nil
    local key=status.dungeon and KEYS[status.dungeon]
    if key then local n=itemCount(key) if n then status.key=n>0 end end
    local lowest
    for slot=1,18 do
        local cur,max=call(GetInventoryItemDurability,slot)
        if type(cur)=='number' and type(max)=='number' and max>0 and cur>=0 and cur<=max then
            local percent=floor(cur/max*100)
            if not lowest or percent<lowest then lowest=percent end
        end
    end
    status.durability=lowest
    local freeSlots=field(plain(C_Container),'GetContainerNumFreeSlots') or plain(GetContainerNumFreeSlots)
    local free
    for bag=0,4 do
        local n=call(freeSlots,bag)
        if type(n)=='number' and n>=0 then free=(free or 0)+n end
    end
    status.free=free and min(free,999) or nil
    if type(BackstageForeverKitLowCount)=='function' then
        local ok,low=pcall(BackstageForeverKitLowCount)
        if ok and type(low)=='number' then status.low=min(low,20) end
    end
    return status
end
BackstageForeverCheckMine=myStatus -- raid comms (BackstageForeverRaid.lua) sends the same short status
local function questStand(id)
    local api=plain(C_QuestLog)
    if call(field(api,'IsQuestFlaggedCompleted'),id)==true then return 'done' end
    if call(field(api,'IsOnQuest'),id)==true then return call(field(api,'IsComplete'),id)==true and 'ready' or 'log' end
end
local function myQuestStates(dungeon)
    return dungeon~='-' and BackstageForeverCheckQuestStates(BackstageForeverAtlasData,dungeon,questStand) or nil
end
-- The quests the Instance Atlas lists for a dungeon and your side: {{id=,title=}}.
local function dungeonQuests(dungeon)
    if type(BackstageForeverAtlasQuests)~='function' or type(BackstageForeverAtlasData)~='table' then return {} end
    for _,row in ipairs(BackstageForeverAtlasData) do
        if type(row)=='table' and row[1]==dungeon then
            local ok,list=pcall(BackstageForeverAtlasQuests,row,call(UnitFactionGroup,'player'))
            return ok and type(list)=='table' and list or {}
        end
    end
    return {}
end
local check=nil -- the last check you asked for: {dungeon=,at=,mine=,members=,answers=,myQuests=,quests=}
local function stateMap(states)
    if type(states)~='table' then return nil end
    local map={}
    for _,row in ipairs(states) do map[row.id]=row.state end
    return map
end
local function report()
    if not check then return say('No readiness check yet. Type /bf check in a party.') end
    for i,line in ipairs(BackstageForeverCheckReport(check.dungeon,check.mine,check.members,check.answers)) do say(line) end
    if check.dungeon~='-' and check.myQuests then
        for _,line in ipairs(BackstageForeverCheckQuestLines(dungeonQuests(check.dungeon),check.myQuests,check.members,check.quests)) do say(line) end
    end
    check.shown=true
end
-- For the Instance Atlas: after a check for this dungeon, who still needs each quest, as
-- {[questId]="You, Ann"}. nil when the last check was for another place.
function BackstageForeverCheckNeeders(dungeon)
    if not check or check.dungeon~=dungeon or not check.myQuests then return nil end
    local out={}
    for id,names in pairs(BackstageForeverCheckQuestNeeders(dungeonQuests(dungeon),check.myQuests,check.members,check.quests)) do
        out[id]=BackstageForeverChatSafe(table.concat(names,', '),40)
    end
    return out
end
local function here()
    local _,kind,_,_,_,_,_,instanceMap=call(GetInstanceInfo)
    local rows=(kind=='party' or kind=='raid') and type(BackstageForeverRunInstances)=='table' and BackstageForeverRunInstances[instanceMap]
    return type(rows)=='table' and rows[1] or nil
end
function BackstageForeverCheckCommand(message)
    local rest=type(message)=='string' and #message<=80 and message:lower():match('^%a+%s*(.-)%s*$') or ''
    local which,arg=rest:match('^(%a+)%s+(%a+)$')
    if which=='answers' and (arg=='on' or arg=='off') then
        if type(BackstageForeverPartySettings)~='table' then BackstageForeverPartySettings={} end
        BackstageForeverPartySettings.answerChecks=arg=='on'
        return say(arg=='on' and 'Readiness answers: on. When a party member asks, your quests for the dungeon, key, gear wear, free bag slots and kit count are sent to your party.'
            or 'Readiness answers: off. Party members who ask see "no answer".')
    end
    if rest=='show' then return report() end
    if not partyOn() then return say('Party sync is off. /bf party on turns it on.') end
    if not inParty() then return say('Join a party first. The readiness check asks your party, never a raid.') end
    local dungeon
    if rest~='' then
        dungeon=type(BackstageForeverLfgDungeon)=='function' and BackstageForeverLfgDungeon(rest) or nil
        if not dungeon then return say('That dungeon is not known. Try a short name, for example /bf check sm.') end
    else dungeon=here() or '-' end
    local at=now()
    if not BackstageForeverCrewRate(rate,'ask',at,GAP) then return say('You asked a moment ago. /bf check show prints the answers again.') end
    check={dungeon=dungeon,at=at,mine=myStatus(dungeon),members=partyNames(),answers={},quests={},myQuests=stateMap(myQuestStates(dungeon))}
    if not send(BackstageForeverCheckRequest(dungeon)) then return say('Party sync is not available in this game client.') end
    local asked=check
    local after=field(plain(C_Timer),'After')
    if type(after)=='function' and pcall(after,4,function() if check==asked and not asked.shown then pcall(report) end end) then
        return say('Asked your party. The answers follow in a few seconds.')
    end
    say('Asked your party. Type /bf check show in a few seconds to read the answers.')
end
-- Backstage Live: with live party updates on (BackstageForeverLiveParty.lua, /bf party live), a
-- check stays open for half an hour. Whoever answered sends the answer again when it changes (a
-- quest handed in, a full bag, worn gear), at most every eight seconds and never in combat, and the
-- asker's list, the quest needs in the Instance Atlas and /bf check show follow without asking again.
local LIVE_KEEP=1800
local liveAsk=nil -- the last check you answered: {dungeon=,at=,a=answer sent,d=quest message sent}
local function liveOn()
    local fn=BackstageForeverPartyLive
    if type(fn)~='function' then return false end
    local ok,on=pcall(fn)
    return ok and on==true
end
local function checkOpen() return check and now()-check.at<=(liveOn() and LIVE_KEEP or 30) end
local function onCheckAsked(sender,message)
    local dungeon=BackstageForeverCheckAsked(message)
    if not dungeon or not BackstageForeverCheckAnswers() then return end
    if not BackstageForeverCrewRate(rate,'answer',now(),GAP) then return end
    local answer=BackstageForeverCheckEncode(myStatus(dungeon))
    local sent=send(answer)
    -- 1.26: for a named dungeon, where each of its quests stands for you goes with the answer.
    local states=sent and myQuestStates(dungeon) or nil
    local quests=states and BackstageForeverCheckQuestEncode(dungeon,states)
    if quests then send(quests) end
    if sent then liveAsk={dungeon=dungeon,at=now(),a=answer,d=quests or nil} end
    if sent and not combat() then
        say(('%s asked for a readiness check. Your short status went to your party. /bf check answers off stops that.'):format(sender))
    end
end
-- An answer that changed after the list was printed: one quiet line, at most every twenty seconds.
local function changedLater(name)
    if not check or not check.shown or combat() then return end
    if BackstageForeverCrewRate(rate,'later',now(),20) then say(('Readiness changed: %s. /bf check show prints the list again.'):format(name)) end
end
local function onCheckAnswer(sender,message)
    if not checkOpen() then return end
    local status=BackstageForeverCheckDecode(message)
    if not status or (status.dungeon or '-')~=check.dungeon then return end
    check.heard=check.heard or {}
    for _,name in ipairs(check.members) do
        if name==sender then
            local was=check.heard['a'..name]
            check.answers[name]=status;check.heard['a'..name]=message
            if was and was~=message then changedLater(name) end
        end
    end
end
local function onCheckQuests(sender,message)
    if not checkOpen() then return end
    local dungeon,states=BackstageForeverCheckQuestDecode(message)
    if not dungeon or dungeon~=check.dungeon then return end
    check.heard=check.heard or {}
    for _,name in ipairs(check.members) do
        if name==sender then
            local was=check.heard['d'..name]
            check.quests[name]=states;check.heard['d'..name]=message
            if was and was~=message then changedLater(name) end
        end
    end
end
-- Called (never in combat) when your quest log, bags or gear wear changed. Your own side of an open
-- check is read again, and an answer you gave goes out again when it is different now.
-- -> false when the pace said "not yet" (call again), true otherwise.
function BackstageForeverCheckLiveChanged()
    local at=now()
    if check and at-check.at<=LIVE_KEEP then
        check.mine=myStatus(check.dungeon)
        check.myQuests=stateMap(myQuestStates(check.dungeon))
    end
    if not liveAsk then return true end
    if at-liveAsk.at>LIVE_KEEP or not liveOn() or not partyOn() or not inParty() or not BackstageForeverCheckAnswers() then liveAsk=nil return true end
    local answer=BackstageForeverCheckEncode(myStatus(liveAsk.dungeon))
    local states=myQuestStates(liveAsk.dungeon)
    local quests=states and BackstageForeverCheckQuestEncode(liveAsk.dungeon,states) or nil
    if answer==liveAsk.a and quests==liveAsk.d then return true end
    if not BackstageForeverCrewRate(rate,'live',at,8) then return false end
    if answer~=liveAsk.a and send(answer) then liveAsk.a=answer end
    if quests and quests~=liveAsk.d and send(quests) then liveAsk.d=quests end
    return true
end

-- ---------------------------------------------------------------- S3 mentor link
local ASK_SECONDS,NOTE_MAX,LABEL_MAX=120,120,40
local MENTOR_KINDS={ask=true,yes=true,['end']=true,req=true,step=true,way=true,say=true}
-- Pure: one mentor message. kind: ask (be my mentee), yes (accepted), end, req (send me your step),
-- step (text), way (map, x, y in percent, label), say (text). to: the one player it is meant for.
function BackstageForeverMentorEncode(kind,to,a,b,c,d)
    to=BackstageForeverCrewName(to)
    if not MENTOR_KINDS[kind] or not to then return nil end
    local head='M|'..kind..'|'..to
    if kind=='step' or kind=='say' then
        local text=BackstageForeverChatSafe(a,NOTE_MAX)
        return text and (head..'|'..text) or nil
    end
    if kind=='way' then
        if type(a)~='number' or a<1 or a>2147483647 or type(b)~='number' or b<0 or b>100 or type(c)~='number' or c<0 or c>100 then return nil end
        return ('%s|%d|%.1f|%.1f|%s'):format(head,floor(a),b,c,BackstageForeverChatSafe(d,LABEL_MAX) or '')
    end
    return head
end
-- Pure: a mentor message back into {kind=,to=,text=,map=,x=,y=,label=}, or nil when anything is off.
function BackstageForeverMentorDecode(message)
    if type(message)~='string' or #message>255 then return nil end
    local kind,to,rest=message:match('^M|(%l+)|([^|]+)(.*)$')
    to=BackstageForeverCrewName(to)
    if not kind or not MENTOR_KINDS[kind] or not to then return nil end
    local out={kind=kind,to=to}
    if kind=='step' or kind=='say' then
        local text=rest:match('^|([^|]+)$')
        out.text=BackstageForeverChatSafe(text,NOTE_MAX)
        return out.text and out or nil
    end
    if kind=='way' then
        local map,x,y,label=rest:match('^|(%d+)|(%d+%.?%d*)|(%d+%.?%d*)|([^|]*)$')
        map,x,y=tonumber(map),tonumber(x),tonumber(y)
        if not map or map<1 or map>2147483647 or not x or x>100 or not y or y>100 then return nil end
        out.map,out.x,out.y,out.label=map,x,y,BackstageForeverChatSafe(label,LABEL_MAX) or T('a spot')
        return out
    end
    return rest=='' and out or nil
end
-- Pure: what a message from another party member changes. state = {asked={name=,at=}, offer={from=,at=},
-- mentee=, mentor=, way=}. -> what to do: nil (ignore) or {say=line, reply='step'}.
-- Only the player you asked can become your mentee, only the player you accepted can send you
-- waypoints and notes, and nothing is accepted for you.
function BackstageForeverMentorReceive(state,me,sender,message,at)
    local m=BackstageForeverMentorDecode(message)
    if not m or type(state)~='table' or type(me)~='string' or type(sender)~='string' or not sameName(m.to,me) then return nil end
    at=type(at)=='number' and at or 0
    if m.kind=='ask' then
        if state.mentor then return nil end
        state.offer={from=sender,at=at}
        return {say=T(('%s offers to be your mentor and asks to see your next step. Type /bf mentor accept to share it. Nothing is shared unless you do.'):format(sender))}
    end
    if m.kind=='yes' then
        local asked=state.asked
        if type(asked)~='table' or not sameName(asked.name,sender) or at-asked.at>ASK_SECONDS then return nil end
        state.asked=nil;state.mentee=sender
        return {say=T(('%s accepted. /bf mentor step asks for their next step, /bf mentor way sends your waypoint, /bf mentor say sends a note, /bf mentor end stops.'):format(sender))}
    end
    if m.kind=='end' then
        if state.mentee and sameName(state.mentee,sender) then state.mentee=nil return {say=T(('%s ended the mentor link.'):format(sender))} end
        if state.mentor and sameName(state.mentor,sender) then state.mentor=nil;state.way=nil return {say=T(('%s ended the mentor link.'):format(sender))} end
        return nil
    end
    if m.kind=='req' then
        if not state.mentor or not sameName(state.mentor,sender) then return nil end
        return {reply='step'}
    end
    if m.kind=='step' then
        if not state.mentee or not sameName(state.mentee,sender) then return nil end
        return {say=T(('%s, next step: %s'):format(sender,m.text))}
    end
    if not state.mentor or not sameName(state.mentor,sender) then return nil end
    if m.kind=='way' then
        state.way={map=m.map,x=m.x,y=m.y,label=m.label,from=sender}
        return {say=T(('Your mentor %s suggests a waypoint: %s at %.1f, %.1f. Type /bf mentor go to follow it.'):format(sender,m.label,m.x,m.y)),way=true}
    end
    return {say=T(('Your mentor %s: %s'):format(sender,m.text))}
end
-- Pure: the mentee's next step in one line. route: the guided route's current step or nil;
-- quests: the captured quest log or nil.
function BackstageForeverMentorStep(route,quests)
    if type(route)=='table' and type(route.text)=='string' and route.text~='' then
        local head=type(route.index)=='number' and type(route.total)=='number' and ('Route %d/%d: '):format(route.index,route.total) or 'Route: '
        return BackstageForeverChatSafe(head..route.text,NOTE_MAX)
    end
    if type(quests)=='table' then
        local total,ready=0,0
        for _,q in ipairs(quests) do if type(q)=='table' then total=total+1;if q.complete==true then ready=ready+1 end end end
        return ('No guided route step. Quests in the log: %d, ready to hand in: %d.'):format(total,ready)
    end
    return 'No next step is known right now.'
end
local mentor={}
BackstageForeverMentorState=mentor
local linksHeard=false
local GO_LINK='|cff71d5ff|Haddon:BackstageForever:mentorgo|h[%s]|h|r'
local function inMyParty(name)
    for _,n in ipairs(partyNames()) do if sameName(n,name) then return n end end
end
local function follow()
    local w=mentor.way
    if not w then return say('Your mentor has not suggested a waypoint yet.') end
    if combat() then return say('Waypoints wait until you leave combat.') end
    if type(BackstageForeverWay)=='function' then return BackstageForeverWay(('way %d %.1f %.1f %s'):format(w.map,w.x,w.y,w.from..': '..w.label)) end
    say(('Head to %.1f, %.1f.'):format(w.x,w.y))
end
local function onMentor(sender,message)
    local me=myName()
    if not me then return end
    local result=BackstageForeverMentorReceive(mentor,me,sender,message,now())
    if not result then return end
    if result.reply=='step' then
        if not BackstageForeverCrewRate(rate,'step',now(),GAP) then return end
        local route
        if type(BackstageForeverRouteNow)=='function' then local ok,r=pcall(BackstageForeverRouteNow) if ok then route=r end end
        local text=BackstageForeverMentorEncode('step',sender,BackstageForeverMentorStep(route,latest and latest.quests or nil))
        if text then send(text) end
        return
    end
    if result.say then
        local chat=plain(DEFAULT_CHAT_FRAME)
        local line='Backstage Forever: '..result.say
        -- A link of the addon's own making; nothing from the other player is inside it.
        if result.way and linksHeard then line=line..' '..GO_LINK:format(T('follow it')) end
        if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,line) end
    end
end
function BackstageForeverMentorLinkClick(link)
    link=plain(link)
    if link~='addon:BackstageForever:mentorgo' then return false end
    follow()
    return true
end
function BackstageForeverMentorCommand(message)
    local rest=type(message)=='string' and #message<=200 and message:match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:match('^(%S*)%s*(.*)$')
    local lower=word:lower()
    if lower=='' then
        if mentor.mentee then return say(('You are the mentor of %s. /bf mentor step, /bf mentor way, /bf mentor say words, /bf mentor end.'):format(mentor.mentee)) end
        if mentor.mentor then return say(('%s is your mentor and may ask for your next step. /bf mentor end stops it.'):format(mentor.mentor)) end
        return say('No mentor link. /bf mentor Name asks a party member to share their next step with you; they must accept.')
    end
    if lower=='go' then return follow() end
    if not partyOn() then return say('Party sync is off. /bf party on turns it on.') end
    if lower=='end' or lower=='stop' then
        local other=mentor.mentee or mentor.mentor
        if not other then mentor.asked,mentor.offer=nil,nil return say('There is no mentor link to end.') end
        local text=BackstageForeverMentorEncode('end',other)
        if text then send(text) end
        mentor.mentee,mentor.mentor,mentor.way,mentor.asked,mentor.offer=nil,nil,nil,nil,nil
        return say(('Mentor link with %s ended.'):format(other))
    end
    if not inParty() then return say('Join a party first. The mentor link works inside your party.') end
    if lower=='accept' then
        local offer=mentor.offer
        if type(offer)~='table' or now()-offer.at>ASK_SECONDS or not inMyParty(offer.from) then mentor.offer=nil return say('Nobody has asked to be your mentor in the last two minutes.') end
        local text=BackstageForeverMentorEncode('yes',offer.from)
        if not text or not send(text) then return say('Party sync is not available in this game client.') end
        mentor.mentor,mentor.offer=offer.from,nil
        return say(('%s is now your mentor: they can ask for your next step and suggest waypoints. /bf mentor end stops it.'):format(offer.from))
    end
    if lower=='step' or lower=='way' or lower=='say' then
        local mentee=mentor.mentee
        if not mentee then return say('You have no mentee yet. /bf mentor Name asks a party member.') end
        if not inMyParty(mentee) then return say(('%s is not in your party any more.'):format(mentee)) end
        if not BackstageForeverCrewRate(rate,'mentor-'..lower,now(),lower=='step' and GAP or 3) then return say('Wait a few seconds before the next one.') end
        local text
        if lower=='step' then text=BackstageForeverMentorEncode('req',mentee)
        elseif lower=='say' then
            text=BackstageForeverMentorEncode('say',mentee,tail)
            if not text then return say('Write a short note: /bf mentor say words (up to 120 characters).') end
        else
            local read=BackstageForeverPartyMyWaypoint
            local map,x,y,label
            if type(read)=='function' then local ok,a,b,c,d=pcall(read) if ok then map,x,y,label=a,b,c,d end end
            if not map then return say('No waypoint or position to share here.') end
            text=BackstageForeverMentorEncode('way',mentee,map,x*100,y*100,tail~='' and tail or label)
        end
        if not text or not send(text) then return say('Party sync is not available in this game client.') end
        return say(lower=='step' and ('Asked %s for their next step.'):format(mentee) or lower=='say' and ('Note sent to %s.'):format(mentee) or ('Waypoint suggested to %s. They decide whether to follow it.'):format(mentee))
    end
    local name=inMyParty(word)
    if not name then return say('That player is not in your party. /bf mentor Name asks a party member.') end
    if mentor.mentee and not sameName(mentor.mentee,name) then return say(('You already mentor %s. /bf mentor end stops that first.'):format(mentor.mentee)) end
    if not BackstageForeverCrewRate(rate,'mentor-ask',now(),GAP) then return say('Wait a few seconds before the next one.') end
    local text=BackstageForeverMentorEncode('ask',name)
    if not text or not send(text) then return say('Party sync is not available in this game client.') end
    mentor.asked={name=name,at=now()}
    say(('Asked %s. They see one chat line and must type /bf mentor accept. Without the addon they see nothing.'):format(name))
end

-- ---------------------------------------------------------------- G12 soft-reserve list
local SR_MAX,SR_NAME,SR_ITEM,SR_CHUNK,SR_CHUNKS=10,24,40,230,4
-- Pure: an item as typed or shift-clicked: the name out of a link, plain text otherwise.
function BackstageForeverSoftItem(text)
    if type(text)~='string' then return nil end
    local linked=text:match('|h%[(.-)%]|h')
    text=BackstageForeverChatSafe(linked or text,SR_ITEM)
    if not text then return nil end
    text=text:gsub('[;=]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    return text~='' and text or nil
end
-- Pure: adds one reserve. -> the row, or nil and why ('full', 'name', 'item', 'twice').
function BackstageForeverSoftAdd(list,player,item)
    if type(list)~='table' then return nil,'name' end
    player=BackstageForeverCrewName(player)
    -- 24 bytes holds any character name; ten rows of that size fit the four messages party sync may send.
    if not player or #player>SR_NAME then return nil,'name' end
    item=BackstageForeverSoftItem(item)
    if not item then return nil,'item' end
    for _,row in ipairs(list) do if sameName(row[1],player) and row[2]:lower()==item:lower() then return nil,'twice' end end
    if #list>=SR_MAX then return nil,'full' end
    local row={player,item}
    list[#list+1]=row
    return row
end
-- Pure: removes every reserve of one player. -> how many went.
function BackstageForeverSoftRemove(list,player)
    local gone=0
    for i=#(type(list)=='table' and list or {}),1,-1 do
        if sameName(list[i][1],player) then table.remove(list,i);gone=gone+1 end
    end
    return gone
end
-- Pure: the list as party messages, each at most 230 bytes of body: "S|seq|1/2|Ann=Hand of Justice;Bob=Ironfoe".
function BackstageForeverSoftEncode(list,seq)
    local bodies,cur={},''
    for i=1,min(#(type(list)=='table' and list or {}),SR_MAX) do
        local p=list[i][1]..'='..list[i][2]
        if #cur>0 and #cur+1+#p>SR_CHUNK then bodies[#bodies+1]=cur;cur=p else cur=#cur>0 and (cur..';'..p) or p end
    end
    bodies[#bodies+1]=cur
    while #bodies>SR_CHUNKS do table.remove(bodies) end
    seq=type(seq)=='number' and seq>=0 and seq<=999 and floor(seq) or 0
    local out={}
    for i,b in ipairs(bodies) do out[i]=('S|%d|%d/%d|%s'):format(seq,i,#bodies,b) end
    return out
end
-- Pure: collects the chunks of one sender; returns the whole list once every chunk has arrived.
-- Every entry is checked again on the way in; a bad one is dropped, the rest kept.
function BackstageForeverSoftReceive(state,sender,message)
    if type(state)~='table' or type(sender)~='string' or type(message)~='string' or #message>255 then return nil end
    local seq,i,n,body=message:match('^S|(%d%d?%d?)|(%d)/(%d)|(.*)$')
    seq,i,n=tonumber(seq),tonumber(i),tonumber(n)
    if not seq or not i or not n or n<1 or n>SR_CHUNKS or i<1 or i>n or body:find('|',1,true) then return nil end
    state.pending=state.pending or {}
    local p=state.pending[sender]
    if not p or p.seq~=seq or p.n~=n then p={seq=seq,n=n,got=0,bodies={}};state.pending={[sender]=p} end
    if not p.bodies[i] then p.bodies[i]=body;p.got=p.got+1 end
    if p.got<n then return nil end
    state.pending[sender]=nil
    local list={}
    for k=1,n do
        for entry in p.bodies[k]:gmatch('[^;]+') do
            local player,item=entry:match('^([^=]+)=(.+)$')
            if player then BackstageForeverSoftAdd(list,player,item) end
        end
    end
    return list
end
-- Pure: the chat lines for /bf sr list. from: whose list it is, nil for your own.
function BackstageForeverSoftLines(list,from)
    if type(list)~='table' or #list==0 then
        return {from and T(('%s keeps no soft reserves right now.'):format(from)) or T('The soft-reserve list is empty. The party leader adds to it: /bf sr add Player Item.')}
    end
    local lines={from and T(('Soft reserves kept by %s: %d. A reserve is a wish, not a promise; nothing is rolled or handed out for you.'):format(from,#list))
        or T(('Your soft-reserve list: %d. A reserve is a wish, not a promise; nothing is rolled or handed out for you.'):format(#list))}
    for _,row in ipairs(list) do lines[#lines+1]=('  %s: %s'):format(row[1],row[2]) end
    return lines
end
local function crewSettings()
    if type(BackstageForeverCrewSettings)~='table' then BackstageForeverCrewSettings={} end
    return BackstageForeverCrewSettings
end
-- Your own list survives a /reload; every row is checked again when it is read back.
local srChecked=false
local function ownList()
    local s=crewSettings()
    if type(s.sr)~='table' then s.sr={} end
    if not srChecked then
        srChecked=true
        local clean={}
        for _,row in ipairs(s.sr) do if type(row)=='table' then BackstageForeverSoftAdd(clean,row[1],row[2]) end end
        s.sr=clean
    end
    return s.sr
end
local soft={pending={},seq=0}
BackstageForeverSoftState=soft
local function leads() return call(UnitIsGroupLeader,'player')==true end
local function share(force)
    if not partyOn() or not inParty() or not leads() then return false end
    if not BackstageForeverCrewRate(rate,'sr',now(),force and 0 or 3) then soft.due=true return false end
    soft.seq=(soft.seq+1)%1000
    for _,text in ipairs(BackstageForeverSoftEncode(ownList(),soft.seq)) do send(text) end
    soft.due=false
    return true
end
local function shareSoon()
    if share(false) or not soft.due then return end
    local after=field(plain(C_Timer),'After')
    if type(after)=='function' then pcall(after,4,function() if soft.due then pcall(share,false) end end) end
end
-- Is the sender the party leader? nil when the game does not say.
local function senderLeads(sender)
    if type(plain(UnitIsGroupLeader))~='function' then return nil end
    for i=1,4 do
        local n=call(UnitName,'party'..i)
        if type(n)=='string' and n==sender then return call(UnitIsGroupLeader,'party'..i)==true end
    end
    return false
end
local function onSoft(sender,message)
    if message=='S?' then
        if leads() and #ownList()>0 and BackstageForeverCrewRate(rate,'sr-answer',now(),GAP) then share(true) end
        return
    end
    if senderLeads(sender)==false then return end
    local list=BackstageForeverSoftReceive(soft,sender,message)
    if not list then return end
    local first=not soft.theirs or soft.theirs.from~=sender
    soft.theirs={from=sender,list=list}
    if first and #list>0 and not combat() then say(('%s shared a soft-reserve list. /bf sr list shows it.'):format(sender)) end
end
function BackstageForeverSoftCommand(message)
    local rest=type(message)=='string' and #message<=260 and message:match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:match('^(%S*)%s*(.*)$')
    word=word:lower()
    local grouped=call(IsInGroup)==true
    if word=='' or word=='list' then
        if not grouped or leads() then
            for _,line in ipairs(BackstageForeverSoftLines(ownList(),nil)) do say(line) end
            return
        end
        if soft.theirs then for _,line in ipairs(BackstageForeverSoftLines(soft.theirs.list,soft.theirs.from)) do say(line) end return end
        if BackstageForeverCrewRate(rate,'sr-ask',now(),GAP) then send('S?') end
        return say('No soft-reserve list from your party leader yet. Asked again; try /bf sr list in a few seconds.')
    end
    if word~='add' and word~='remove' and word~='clear' then
        return say('Soft reserves: /bf sr add Player Item, /bf sr remove Player, /bf sr clear, /bf sr list. Only the party leader changes the list.')
    end
    if grouped and not leads() then return say('Only the party leader changes the soft-reserve list. /bf sr list shows it.') end
    local list=ownList()
    if word=='clear' then
        for i=#list,1,-1 do list[i]=nil end
        say('Soft-reserve list cleared.')
    elseif word=='remove' then
        local gone=BackstageForeverSoftRemove(list,(tail:match('^(%S+)')))
        if gone==0 then return say('That player has no reserve on the list.') end
        say(('Removed %d from the soft-reserve list.'):format(gone))
    else
        local player,item=tail:match('^(%S+)%s+(.+)$')
        local row,why=BackstageForeverSoftAdd(list,player,item)
        if not row then
            return say(why=='full' and 'The list is full: 10 reserves fit in what party sync may send.' or why=='twice' and 'That reserve is already on the list.'
                or 'Use /bf sr add Player Item, for example /bf sr add Thrall Hand of Justice.')
        end
        say(('Soft reserve added: %s, %s.'):format(row[1],row[2]))
    end
    if grouped and call(IsInRaid)==true then return say('In a raid the list stays with you: party sync never sends to a raid.') end
    if grouped and not partyOn() then return say('Party sync is off, so the list is not shared. /bf party on turns it on.') end
    shareSoon()
end

-- ---------------------------------------------------------------- wiring
if type(BackstageForeverPartyHandle)=='function' then
    BackstageForeverPartyHandle('C',onCheckAsked)
    BackstageForeverPartyHandle('A',onCheckAnswer)
    BackstageForeverPartyHandle('D',onCheckQuests)
    BackstageForeverPartyHandle('M',onMentor)
    BackstageForeverPartyHandle('S',onSoft)
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','GROUP_ROSTER_UPDATE'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Crew',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then
                crewSettings()
                local registry=plain(EventRegistry)
                if type(registry)=='table' and type(registry.RegisterCallback)=='function' then
                    linksHeard=pcall(registry.RegisterCallback,registry,'SetItemRef',function(_,link) pcall(BackstageForeverMentorLinkClick,link) end,events)
                end
                return
            end
            -- A link ends when the other player leaves the party; a list from a former leader is forgotten.
            if not inParty() then
                liveAsk=nil
                local other=mentor.mentee or mentor.mentor
                mentor.mentee,mentor.mentor,mentor.way,mentor.asked,mentor.offer=nil,nil,nil,nil,nil
                soft.theirs,soft.pending=nil,{}
                if other and not combat() then say(('Mentor link with %s ended: you are no longer in a party together.'):format(other)) end
                return
            end
            for _,key in ipairs({'mentee','mentor'}) do
                local other=mentor[key]
                if other and not inMyParty(other) then
                    mentor[key]=nil;if key=='mentor' then mentor.way=nil end
                    if not combat() then say(('Mentor link with %s ended: you are no longer in a party together.'):format(other)) end
                end
            end
            if soft.theirs and senderLeads(soft.theirs.from)==false then soft.theirs=nil end
            -- A new member sees the list without asking.
            if leads() and #ownList()>0 then soft.due=true;shareSoon() end
        end)
    end
end

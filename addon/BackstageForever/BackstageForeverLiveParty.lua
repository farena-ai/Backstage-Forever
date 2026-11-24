-- Backstage Live in your party: who plays what, the group plan, and what changes while you play.
--   /bf plan                     the group plan: where to, your role, what to bring, who is ready
--   /bf plan role NAME tank|healer|damage|none   (party leader) sets a member's role
--   /bf plan me tank|healer|damage|none          your own role, when the leader set none
--   /bf plan ready | notready    tells your party you are ready (or not yet)
--   /bf plan share               (leader, or whoever brought the plan) sends the plan again
--   /bf plan clear               (party leader) drops the plan
--   /bf party live on|off        readiness answers, quest needs and your role follow what changes by
--                                themselves (on). Off: only when somebody asks.
--   /bf announce                 short chat lines YOU switch on, each off at first:
--   /bf announce quest|objective|ready party|guild|off
-- Everything between addons uses the party sync channel (BackstageForeverParty.lua): your party
-- only, never a raid, nothing while party sync is off, at most 255 bytes a message:
--   B|class|level|role|ready     your own state, sent when it changes and when the party changes
--   T|time|place|rows|note  and  t|time|row|Name|role|bring     the group plan, from the leader
--                                (or, while the leader has sent none, from the member who made it)
-- Announcements are ordinary chat lines sent with the game's own chat function, to PARTY or GUILD
-- only (those two may be sent by an addon; SAY, YELL and public channels need a key press, so they
-- are never used). Off until you switch one on, at most six in five minutes, never in combat.
-- The party state also goes to the desktop app over the live link (BackstageForeverLiveGuild.lua).
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

-- ---------------------------------------------------------------- pure
local T_MIN,T_MAX=1000000000,9999999999
local PLAN_ROWS,BRING_MAX,NOTE_MAX=10,60,80
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
local function person(name)
    if type(name)~='string' or #name<2 or #name>48 or name:find('[%d%c%s%p]') then return nil end
    return name
end
local function clean(text,limit)
    if type(text)~='string' or #text>1000 then return nil end
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|[hrn]',''):gsub('[|%c]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text>limit then text=text:sub(1,limit):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    return text~='' and text or nil
end
local function strict(text,limit) local c=clean(text,limit) return c==text and c or nil end
local function placeId(id) return type(id)=='string' and #id<=8 and id:match('^%l[%l%d]*$') and id or nil end
local function same(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
local function number(text,digits)
    if type(text)~='string' or #text<1 or #text>digits or not text:match('^%d+$') then return nil end
    local n=tonumber(text)
    if tostring(n)~=text and ('%d'):format(n)~=text then return nil end
    return n
end
local ROLE={t=true,h=true,d=true}
local ROLE_WORD={tank='t',healer='h',heal='h',damage='d',dps='d',dd='d',none='-',off='-'}
local ROLE_NAME={t='Tank',h='Healer',d='Damage'}
BackstageForeverPlanRoleWords=ROLE_WORD

-- Your own state for the party: "B|5|34|h|1" (class 0..9, level, role t/h/d or -, ready 1 or 0).
function BackstageForeverCrewStateEncode(state)
    if type(state)~='table' then return nil end
    return ('B|%d|%d|%s|%d'):format(whole(state.class,1,9) and state.class or 0,whole(state.level,1,100) and state.level or 0,ROLE[state.role] and state.role or '-',state.ready==true and 1 or 0)
end
-- -> {class=,level=,role=,ready=} or nil when anything about it is off. "B?" asks for everybody's.
function BackstageForeverCrewStateDecode(message)
    if type(message)~='string' or #message>12 then return nil end
    local class,level,role,ready=message:match('^B|(%d)|(%d%d?%d?)|([thd%-])|([01])$')
    if not class then return nil end
    level=number(level,3)
    if not level or level>100 then return nil end
    return {class=tonumber(class)>0 and tonumber(class) or nil,level=level>0 and level or nil,role=role~='-' and role or nil,ready=ready=='1'}
end
-- A plan made clean, or nil: {place=,note=,at=,members={{name=,role=,bring=}}}, at most ten members.
local function tidyPlan(plan,exact)
    if type(plan)~='table' or type(plan.members)~='table' or not whole(plan.at,T_MIN,T_MAX) then return nil end
    local out={at=plan.at,members={}}
    if plan.place~=nil then out.place=placeId(plan.place);if not out.place then return nil end end
    if plan.note~=nil then
        out.note=(exact and strict or clean)(plan.note,NOTE_MAX)
        if not out.note then if exact then return nil end end
    end
    local seen={}
    for i=1,min(#plan.members,PLAN_ROWS) do
        local m=plan.members[i]
        if type(m)~='table' or not person(m.name) or seen[m.name:lower()] or (m.role~=nil and not ROLE[m.role]) then return nil end
        seen[m.name:lower()]=true
        local bring=nil
        if m.bring~=nil then
            bring=(exact and strict or clean)(m.bring,BRING_MAX)
            if not bring and exact then return nil end
        end
        if bring=='-' then bring=nil end
        out.members[#out.members+1]={name=m.name,role=m.role,bring=bring}
    end
    if #out.members==0 and not out.place then return nil end
    return out
end
BackstageForeverPlanTidy=tidyPlan
-- The plan as party messages: one head and one row per member, each at most 255 bytes.
function BackstageForeverPlanEncode(plan)
    local p=tidyPlan(plan,false)
    if not p then return {} end
    local out={('T|%d|%s|%d|%s'):format(p.at,p.place or '-',#p.members,p.note or '-')}
    for i,m in ipairs(p.members) do out[#out+1]=('t|%d|%d|%s|%s|%s'):format(p.at,i,m.name,m.role or '-',m.bring or '-') end
    return out
end
-- Collects one sender's plan messages in state[sender]; returns the whole plan once every row of
-- the newest head has arrived. Anything off drops that sender's unfinished plan.
function BackstageForeverPlanReceive(state,sender,message)
    if type(state)~='table' or type(sender)~='string' or type(message)~='string' or #message>255 then return nil end
    local at,place,count,note=message:match('^T|(%d+)|([%l%d%-]+)|(%d%d?)|([^|]+)$')
    if at then
        at,count=number(at,10),number(count,2)
        if not at or not whole(at,T_MIN,T_MAX) or not count or count>PLAN_ROWS or (place~='-' and not placeId(place)) or (note~='-' and not strict(note,NOTE_MAX)) then state[sender]=nil return nil end
        local p={at=at,n=count,place=place~='-' and place or nil,note=note~='-' and note or nil,rows={},got=0}
        state[sender]=p
        if count>0 then return nil end
        state[sender]=nil
        return tidyPlan({at=p.at,place=p.place,note=p.note,members={}},true)
    end
    local rowAt,index,name,role,bring=message:match('^t|(%d+)|(%d%d?)|([^|]+)|([thd%-])|([^|]+)$')
    local p=state[sender]
    if not rowAt or not p then
        -- A row that is not a clean row ends that sender's unfinished plan.
        if message:sub(1,2)=='t|' or message:sub(1,2)=='T|' then state[sender]=nil end
        return nil
    end
    rowAt,index=number(rowAt,10),number(index,2)
    if rowAt~=p.at or not index or index<1 or index>p.n or p.rows[index] or not person(name) or (bring~='-' and not strict(bring,BRING_MAX)) then state[sender]=nil return nil end
    p.rows[index]={name=name,role=role~='-' and role or nil,bring=bring~='-' and bring or nil}
    p.got=p.got+1
    if p.got<p.n then return nil end
    state[sender]=nil
    return tidyPlan({at=p.at,place=p.place,note=p.note,members=p.rows},true)
end
-- Does a plan that arrived replace the one you hold? current: your plan (with by= and leader=true
-- when it came from the party leader) or nil. The leader's plan wins over anybody's; a member's
-- plan counts only while the leader has sent none. Among plans of the same standing the newer
-- one wins. A plan stamped more than ten minutes ahead of your clock is refused.
function BackstageForeverPlanTake(current,plan,sender,senderLeads,now)
    if type(plan)~='table' or not person(sender) or type(now)~='number' or not whole(plan.at,T_MIN,T_MAX) or plan.at>now+600 then return false end
    if type(current)~='table' then return true end
    if senderLeads then
        if not current.leader then return true end
        return plan.at>current.at or (plan.at==current.at and not same(current.by,sender))
    end
    if current.leader then return false end
    return plan.at>current.at
end
-- Sets one member's role in a plan (a new plan when there is none). role: 't', 'h', 'd' or nil.
-- -> the plan, or nil and why ('name', 'full').
function BackstageForeverPlanSetRole(plan,name,role,now)
    if not person(name) or (role~=nil and not ROLE[role]) or not whole(now,T_MIN,T_MAX) then return nil,'name' end
    plan=type(plan)=='table' and plan or {members={}}
    if type(plan.members)~='table' then plan.members={} end
    local row
    for _,m in ipairs(plan.members) do if same(m.name,name) then row=m end end
    if not row then
        if #plan.members>=PLAN_ROWS then return nil,'full' end
        row={name=name}
        plan.members[#plan.members+1]=row
    end
    row.role=role
    plan.at=max(now,(whole(plan.at,T_MIN,T_MAX) and plan.at or 0)+1)
    return plan
end
-- Your own line in a plan: role letter and what to bring.
function BackstageForeverPlanMine(plan,me)
    for _,m in ipairs(type(plan)=='table' and type(plan.members)=='table' and plan.members or {}) do
        if same(m.name,me) then return m.role,m.bring end
    end
end
-- "Your role: Healer. Bring: Skeleton Key." or nil when the plan says nothing about you.
function BackstageForeverPlanMyLine(plan,me)
    local role,bring=BackstageForeverPlanMine(plan,me)
    if not role and not bring then return nil end
    local text=role and T(('Your role: %s.'):format(T(ROLE_NAME[role]))) or T('You have no role in the plan yet.')
    if bring then text=text..' '..T(('Bring: %s.'):format(bring)) end
    return text
end
-- The chat lines of /bf plan. peers: {[lower name]={role=,ready=}} as party members told it;
-- placeName(id) gives a place name.
function BackstageForeverPlanLines(plan,me,peers,placeName)
    local lines={}
    if type(plan)~='table' then return {T('No group plan yet. Make one in the desktop app, or the party leader sets roles with /bf plan role NAME tank.')} end
    local where=plan.place and (type(placeName)=='function' and placeName(plan.place) or plan.place) or nil
    local from=type(plan.by)=='string' and plan.by or nil
    if where and from then lines[1]=T(('Group plan: %s (from %s).'):format(where,from))
    elseif where then lines[1]=T(('Group plan: %s.'):format(where))
    elseif from then lines[1]=T(('Group plan (from %s).'):format(from))
    else lines[1]=T('Group plan.') end
    if plan.note then lines[#lines+1]='  '..plan.note end
    lines[#lines+1]=BackstageForeverPlanMyLine(plan,me) or T('You have no role in the plan yet.')
    for _,m in ipairs(type(plan.members)=='table' and plan.members or {}) do
        if not same(m.name,me) then
            local peer=type(peers)=='table' and peers[m.name:lower()] or nil
            local text=('  %s: %s'):format(m.name,m.role and T(ROLE_NAME[m.role]) or T('no role yet'))
            if peer and peer.ready then text=text..', '..T('ready') end
            if m.bring then text=text..'. '..T(('Bring: %s.'):format(m.bring)) end
            lines[#lines+1]=text
        end
    end
    return lines
end

-- Announcements. setting: 'party', 'guild' or nil. -> the chat channel to use now, or nil.
-- A party line goes to a party of five only, never to a raid.
function BackstageForeverSayChannel(setting,inParty,inRaid,inGuild)
    if setting=='guild' then return inGuild and 'GUILD' or nil end
    if setting=='party' then return (inParty and not inRaid) and 'PARTY' or nil end
    return nil
end
local SAY_GAP={quest=8,objective=15,ready=8}
local SAY_LIMIT,SAY_WINDOW=6,300
-- True when a line of this kind may go out now: a gap per kind, and six lines in five minutes in all.
function BackstageForeverSayPass(state,kind,now)
    if type(state)~='table' or not SAY_GAP[kind] or type(now)~='number' then return false end
    local last=state[kind]
    if type(last)=='number' and now>=last and now-last<SAY_GAP[kind] then return false end
    if type(state.since)~='number' or now-state.since>=SAY_WINDOW or now<state.since then state.since,state.count=now,0 end
    if state.count>=SAY_LIMIT then return false end
    state[kind]=now;state.count=state.count+1
    return true
end
-- The line itself: plain words, no codes, at most 120 bytes.
function BackstageForeverSayText(kind,what)
    what=what~=nil and clean(what,80) or nil
    if kind=='quest' then return what and T(('Quest done: %s.'):format(what)) or nil end
    if kind=='objective' then return what and T(('Objective done: %s.'):format(what)) or nil end
    if kind=='ready' then return what and T(('Ready for %s.'):format(what)) or T('Ready.') end
    return nil
end
-- Which objectives are newly finished. before/after: {[key]={done=,text=}}. A quest that was not in
-- "before" at all is new in your log and announces nothing.
function BackstageForeverObjectivesDone(before,after)
    local out={}
    if type(before)~='table' or type(after)~='table' then return out end
    for key,row in pairs(after) do
        local old=before[key]
        if type(old)=='table' and type(row)=='table' and row.done==true and old.done==false and type(row.text)=='string' then out[#out+1]=row.text end
    end
    table.sort(out)
    return out
end

-- ---------------------------------------------------------------- live
local clock=time or (os and os.time)
local function epoch() local t=call(clock);return type(t)=='number' and floor(t) or 0 end
local function tick() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function combat() return call(InCombatLockdown)==true end
local function random() local r=call(math.random);return type(r)=='number' and r>=0 and r<1 and r or 0 end
local function later(seconds,fn)
    local after=field(plain(C_Timer),'After')
    if type(after)=='function' and pcall(after,seconds,function() pcall(fn) end) then return true end
    return false
end
local function settings()
    if type(BackstageForeverPartySettings)~='table' then BackstageForeverPartySettings={} end
    return BackstageForeverPartySettings
end
-- The switch for everything that follows changes by itself (on unless you switched it off).
function BackstageForeverPartyLive()
    local s=BackstageForeverPartySettings
    return type(s)~='table' or rawget(s,'live')~=false
end
local liveOn=BackstageForeverPartyLive
local function store()
    local fn=BackstageForeverLiveGuildState
    if type(fn)=='function' then local ok,d=pcall(fn) if ok and type(d)=='table' then return d end end
    if type(BackstageForeverLiveGuildDB)~='table' then BackstageForeverLiveGuildDB={} end
    return BackstageForeverLiveGuildDB
end
local function partyOn() local fn=BackstageForeverPartyOn if type(fn)~='function' then return false end local ok,on=pcall(fn) return ok and on==true end
local function inParty() return call(IsInGroup)==true and call(IsInRaid)~=true end
local function myName() local n=call(UnitName,'player');return type(n)=='string' and n or nil end
local function send(text)
    local fn=BackstageForeverPartySend
    if type(fn)~='function' or type(text)~='string' then return false end
    local ok,sent=pcall(fn,text)
    return ok and sent==true
end
local function leads() return call(UnitIsGroupLeader,'player')==true end
local function placeName(id)
    local name=type(BackstageForeverLfgName)=='function' and BackstageForeverLfgName(id) or nil
    if name then return name end
    for _,row in ipairs(type(BackstageForeverAtlasData)=='table' and BackstageForeverAtlasData or {}) do
        if type(row)=='table' and row[1]==id and type(row[2])=='string' then return row[2] end
    end
    return id
end
local function here()
    local _,kind,_,_,_,_,_,instanceMap=call(GetInstanceInfo)
    local rows=(kind=='party' or kind=='raid') and type(BackstageForeverRunInstances)=='table' and BackstageForeverRunInstances[instanceMap]
    return type(rows)=='table' and placeId(rows[1]) or nil
end

local peers={}                  -- what party members told about themselves, by lower-case name
local ready=false               -- your own "ready" for this party
local rate,planParts={},{}
local dirty={}                  -- state, signal, crew, quests: what the next tick has to look at
BackstageForeverLivePartyPeers=peers
local function plan() local p=store().plan return type(p)=='table' and p or nil end
local function myRole()
    local p=plan()
    local role=p and BackstageForeverPlanMine(p,myName()) or nil
    if role then return role end
    local own=rawget(store(),'role')
    return ROLE[own] and own or nil
end
local function classIndex(file) return type(BackstageForeverLiveClasses)=='table' and BackstageForeverLiveClasses[file or ''] or nil end
-- Everybody in your group as the game shows them: you first.
local function roster()
    local list,leader={},nil
    local me=myName()
    if not me then return list end
    local _,myClass=call(UnitClass,'player')
    local level=call(UnitLevel,'player')
    if call(IsInGroup)~=true then return list end
    list[1]={name=me,class=classIndex(myClass),level=type(level)=='number' and floor(level) or nil,online=true,role=myRole(),ready=ready}
    if leads() then leader=me end
    if call(IsInRaid)==true then
        for i=1,40 do
            local name,rank,_,lvl,_,file,_,isOnline=call(GetRaidRosterInfo,i)
            if type(name)=='string' and name~='' and not same(name,me) then
                list[#list+1]={name=name,class=classIndex(file),level=type(lvl)=='number' and lvl>0 and floor(lvl) or nil,online=isOnline~=false}
                if rank==2 then leader=name end
            elseif type(name)=='string' and same(name,me) and rank==2 then leader=me end
        end
    else
        for i=1,4 do
            local unit='party'..i
            local name,realm=call(UnitName,unit)
            if type(name)=='string' and name~='' then
                local full=(type(realm)=='string' and realm~='') and (name..'-'..realm) or name
                local _,file=call(UnitClass,unit)
                local lvl=call(UnitLevel,unit)
                local peer=peers[name:lower()]
                local p=plan()
                list[#list+1]={name=full,class=classIndex(file) or (peer and peer.class),level=type(lvl)=='number' and lvl>0 and floor(lvl) or (peer and peer.level) or nil,
                    online=call(UnitIsConnected,unit)~=false,role=(p and BackstageForeverPlanMine(p,name)) or (peer and peer.role) or nil,ready=peer and peer.ready or false}
                if call(UnitIsGroupLeader,unit)==true then leader=full end
            end
        end
    end
    return list,leader
end
-- The party state for the desktop app: built again whenever something changed, told only when it differs.
local function signal()
    dirty.signal=nil
    if type(BackstageForeverLiveMe)~='function' or type(BackstageForeverSignalParty)~='function' then return end
    local me=BackstageForeverLiveMe()
    if not me then return end
    local list,leader=roster()
    local p=plan()
    local text=BackstageForeverSignalParty(me,{leader=leader,place=(#list>0 and ((p and p.place) or here())) or nil,planAt=#list>0 and p and p.at or nil,members=list})
    local d=store()
    if not text or text==d.partySignal then return end
    -- Not in a group and nothing told before: there is nothing to say.
    if #list==0 and d.partySignal==nil then return end
    d.partySignal=text
    if type(BackstageForeverLiveSend)=='function' then pcall(BackstageForeverLiveSend,'p',text) end
    if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
end
BackstageForeverLivePartySignal=signal -- for tests
local function myState()
    local _,file=call(UnitClass,'player')
    local level=call(UnitLevel,'player')
    return {class=classIndex(file),level=type(level)=='number' and floor(level) or nil,role=myRole(),ready=ready}
end
-- Your own state goes to the party when it changed (or when asked), at most every two seconds.
local lastState
local function tell(force)
    if not partyOn() or not inParty() then dirty.state=nil return end
    local text=BackstageForeverCrewStateEncode(myState())
    if not force and text==lastState then dirty.state=nil return end
    if not BackstageForeverLiveRate(rate,'state',tick(),2) then dirty.state=force and 'force' or true return end
    dirty.state=nil
    if send(text) then lastState=text end
end
local function sharePlan(force)
    local p=plan()
    if not p or not partyOn() or not inParty() then return false end
    -- The leader's plan is the party's plan; a member shares theirs only while it is their own.
    if not leads() and not same(p.by,myName()) then return false end
    if not BackstageForeverLiveRate(rate,'plan',tick(),force and 1 or 4) then dirty.plan=true return false end
    dirty.plan=nil
    for _,text in ipairs(BackstageForeverPlanEncode(p)) do send(text) end
    return true
end
local function planChanged(tellMe)
    dirty.signal=true;dirty.state=true
    if tellMe and not combat() then
        local p=plan()
        local line=p and BackstageForeverPlanMyLine(p,myName())
        if line then say(line) end
    end
    if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
end
local function senderLeads(sender)
    for i=1,4 do
        local n=call(UnitName,'party'..i)
        if type(n)=='string' and n==sender then return call(UnitIsGroupLeader,'party'..i)==true end
    end
    return false
end
local function onState(sender,message)
    if message=='B?' then dirty.state='force' return end
    local state=BackstageForeverCrewStateDecode(message)
    if not state then return end
    state.at=tick()
    local old=peers[sender:lower()]
    peers[sender:lower()]=state
    dirty.signal=true
    if state.ready and not (old and old.ready) and not combat() and BackstageForeverLiveRate(rate,'ready:'..sender:lower(),tick(),20) then say(('%s says: ready.'):format(sender)) end
end
local function onPlan(sender,message)
    local got=BackstageForeverPlanReceive(planParts,sender,message)
    if not got then return end
    local lead=senderLeads(sender)
    local d=store()
    if not BackstageForeverPlanTake(plan(),got,sender,lead,epoch()) then return end
    got.by,got.leader=sender,lead or nil
    d.plan=got
    if not combat() then
        local where=got.place and placeName(got.place) or nil
        say(where and ('Group plan from %s: %s. /bf plan shows it.'):format(sender,where) or ('Group plan from %s. /bf plan shows it.'):format(sender))
    end
    planChanged(true)
end
-- The plan the desktop app handed over at login or /reload.
local function readDeskPlan()
    if type(BackstageForeverDeskPlan)~='function' or type(BackstageForeverLiveMe)~='function' then return end
    local got=BackstageForeverDeskPlan(plain(BackstageForeverDesktopData),BackstageForeverLiveMe())
    if not got then return end
    local d=store()
    local old=plan()
    local function body(p)
        local parts={p.place or '-',p.note or '-'}
        for _,m in ipairs(p.members) do parts[#parts+1]=m.name..':'..(m.role or '-')..':'..(m.bring or '-') end
        return table.concat(parts,'|')
    end
    -- The same plan as last time is not new again.
    if old and old.desk==body(got) then return end
    local at=got.at>0 and got.at or epoch()
    if old and not old.desk and old.at>=at then return end
    while #got.members>PLAN_ROWS do table.remove(got.members) end
    got.at=max(at,old and old.at+1 or 0)
    got.by,got.desk,got.leader=myName(),body(got),leads() or nil
    d.plan=got
    planChanged(true)
    sharePlan(true)
end
BackstageForeverLiveReadPlan=readDeskPlan -- for tests

-- Announcements the player switched on.
local sayState={}
local function sayKind(kind)
    local s=rawget(settings(),'say')
    local v=type(s)=='table' and s[kind] or nil
    return (v=='party' or v=='guild') and v or nil
end
local function announce(kind,what)
    local setting=sayKind(kind)
    if not setting or combat() then return false end
    local channel=BackstageForeverSayChannel(setting,call(IsInGroup)==true,call(IsInRaid)==true,call(IsInGuild)==true)
    local text=channel and BackstageForeverSayText(kind,what)
    if not text or #text>160 then return false end
    local fn=field(plain(C_ChatInfo),'SendChatMessage') or plain(SendChatMessage)
    if type(fn)~='function' or not BackstageForeverSayPass(sayState,kind,tick()) then return false end
    return (pcall(fn,text,channel))
end
BackstageForeverAnnounce=announce -- for tests
local titles,objectives={},nil
local function scanObjectives()
    local api=plain(C_QuestLog)
    local out={}
    local n=call(field(api,'GetNumQuestLogEntries')) or 0
    for i=1,min(type(n)=='number' and n or 0,60) do
        local info=call(field(api,'GetInfo'),i)
        local id=type(info)=='table' and not field(info,'isHeader') and field(info,'questID')
        if whole(id,1,2147483647) then
            local title=field(info,'title')
            if type(title)=='string' then titles[id]=title end
            local rows=call(field(api,'GetQuestObjectives'),id)
            for j=1,min(type(rows)=='table' and #rows or 0,8) do
                local o=rows[j]
                local text=type(o)=='table' and field(o,'text')
                if type(text)=='string' then out[id..':'..j]={done=field(o,'finished')==true,text=text} end
            end
        end
    end
    return out
end
local function questsChanged()
    dirty.quests=nil
    local now=scanObjectives()
    if objectives and sayKind('objective') then
        local done=BackstageForeverObjectivesDone(objectives,now)
        if done[1] then announce('objective',done[1]) end
    end
    objectives=now
end

-- /bf plan ...
function BackstageForeverPlanCommand(message)
    local rest=type(message)=='string' and #message<=120 and message:match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:match('^(%a*)%s*(.-)$')
    word=word:lower()
    local d=store()
    local me=myName()
    if word=='' or word=='show' then
        for _,line in ipairs(BackstageForeverPlanLines(plan(),me,peers,placeName)) do say(line) end
        if ready then say('You told your party you are ready. /bf plan notready takes it back.') end
        return
    end
    if word=='ready' or word=='notready' then
        if not inParty() then return say('Join a party first.') end
        if not partyOn() then return say('Party sync is off. /bf party on turns it on.') end
        ready=word=='ready'
        tell(true);dirty.signal=true
        if ready then
            local p=plan()
            local place=(p and p.place) or here()
            announce('ready',place and placeName(place) or nil)
            return say('Your party sees that you are ready. /bf plan notready takes it back.')
        end
        return say('Your party sees that you are not ready yet.')
    end
    if word=='me' then
        local role=ROLE_WORD[tail:lower()]
        if not role then return say('Say your role: /bf plan me tank, /bf plan me healer, /bf plan me damage or /bf plan me none.') end
        local p=plan()
        if p and BackstageForeverPlanMine(p,me) and not leads() and call(IsInGroup)==true then return say('The plan already gives you a role. The party leader changes it with /bf plan role.') end
        d.role=role~='-' and role or nil
        if p and (leads() or call(IsInGroup)~=true) then BackstageForeverPlanSetRole(p,me,d.role,epoch());sharePlan(true) end
        tell(true);dirty.signal=true
        return say(d.role and ('Your role: %s.'):format(T(ROLE_NAME[d.role])) or 'You have no role set.')
    end
    if word=='role' then
        local name,roleWord=tail:match('^(%S+)%s+(%a+)$')
        local role=roleWord and ROLE_WORD[roleWord:lower()]
        if not name or not role or not person(name) then return say('Use /bf plan role NAME tank, healer, damage or none. Example: /bf plan role Thrall tank.') end
        if call(IsInGroup)==true and not leads() then return say('Only the party leader sets roles. /bf plan me tank sets your own while the leader set none.') end
        -- The name as your party spells it.
        local list=roster()
        local found
        for _,m in ipairs(list) do local short=m.name:match('^([^%-]+)') or m.name if same(short,name) then found=short end end
        if call(IsInGroup)==true and not found then return say(('%s is not in your group.'):format(name)) end
        local p,why=BackstageForeverPlanSetRole(plan(),found or name,role~='-' and role or nil,epoch())
        if not p then return say(why=='full' and 'The plan is full: ten members fit.' or 'That name does not work.') end
        p.by,p.leader,p.desk=me,call(IsInGroup)==true or nil,nil
        d.plan=p
        say(role~='-' and ('%s plays %s. Your party sees it at once.'):format(found or name,T(ROLE_NAME[role])) or ('%s has no role now.'):format(found or name))
        sharePlan(true);planChanged(false)
        return
    end
    if word=='share' then
        if not plan() then return say('No group plan yet.') end
        if not inParty() then return say('Join a party first.') end
        return say(sharePlan(true) and 'The plan went to your party.' or 'Only the party leader, or the member who made the plan, sends it. Try again in a few seconds if you just did.')
    end
    if word=='clear' then
        if call(IsInGroup)==true and not leads() and not (plan() and same(plan().by,me)) then return say('Only the party leader drops the plan.') end
        d.plan=nil;d.role=nil
        planChanged(false)
        return say('The group plan is dropped on this character.')
    end
    say('Group plan: /bf plan shows it, /bf plan role NAME tank (or healer, damage; party leader), /bf plan me ROLE, /bf plan ready, /bf plan share, /bf plan clear.')
end
local KIND_WORD={quest='Finished quests',objective='Finished objectives',ready='"Ready"'}
-- /bf announce [quest|objective|ready] [party|guild|on|off]
function BackstageForeverAnnounceCommand(message)
    local rest=type(message)=='string' and #message<=80 and message:lower():match('^%a+%s*(.-)%s*$') or ''
    local kind,value=rest:match('^(%a*)%s*(%a*)$')
    local s=settings()
    if type(s.say)~='table' then s.say={} end
    if not kind or not SAY_GAP[kind] then
        for _,k in ipairs({'quest','objective','ready'}) do
            local v=sayKind(k)
            say(('%s: %s.'):format(T(KIND_WORD[k]),v=='party' and T('said in party chat') or v=='guild' and T('said in guild chat') or T('not said')))
        end
        return say('Use /bf announce quest party, /bf announce objective party, /bf announce ready guild, or off instead of party. Never in combat, never in public channels.')
    end
    if value=='on' then value='party' end
    if value~='party' and value~='guild' and value~='off' then return say(('Say where: /bf announce %s party, guild or off.'):format(kind)) end
    s.say[kind]=value~='off' and value or nil
    if kind=='objective' then objectives=nil;dirty.quests=true end
    if value=='off' then return say(('%s: not said in chat any more.'):format(T(KIND_WORD[kind]))) end
    say((value=='guild' and '%s: one short line in guild chat, in your name, when it happens. At most six lines in five minutes, never in combat. /bf announce %s off stops it.'
        or '%s: one short line in party chat, in your name, when it happens. At most six lines in five minutes, never in combat. /bf announce %s off stops it.'):format(T(KIND_WORD[kind]),kind))
end
-- /bf party live on|off. -> true when it handled the call.
function BackstageForeverPartyLiveCommand(rest)
    local arg=type(rest)=='string' and rest:lower():match('^live%s*(%a*)$')
    if not arg then return false end
    local s=settings()
    if arg=='on' or arg=='off' then s.live=arg=='on' end
    say(s.live~=false and 'Live party updates: on. Your role, your readiness answer and your quest needs reach your party when they change, without anybody asking.'
        or 'Live party updates: off. Your party hears from you only when somebody asks.')
    return true
end

if type(BackstageForeverPartyHandle)=='function' then
    BackstageForeverPartyHandle('B',onState)
    BackstageForeverPartyHandle('T',onPlan)
    BackstageForeverPartyHandle('t',onPlan)
end
local function onTick()
    if dirty.plan then sharePlan(false) end
    if dirty.state then tell(dirty.state=='force') end
    if combat() then return end
    if dirty.quests then questsChanged() end
    if dirty.crew then
        dirty.crew=nil
        local fn=BackstageForeverCheckLiveChanged
        if liveOn() and type(fn)=='function' then
            local ok,done=pcall(fn)
            if ok and done==false then dirty.crew=true end
        end
    end
    if dirty.signal then signal() end
end
BackstageForeverLivePartyTick=onTick -- for tests
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        for _,e in ipairs({'PLAYER_LOGIN','GROUP_ROSTER_UPDATE','PARTY_LEADER_CHANGED','UNIT_CONNECTION','QUEST_LOG_UPDATE','QUEST_TURNED_IN','BAG_UPDATE_DELAYED','UPDATE_INVENTORY_DURABILITY','PLAYER_LEVEL_UP','PLAYER_ENTERING_WORLD','PLAYER_REGEN_ENABLED'}) do pcall(frame.RegisterEvent,frame,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'LiveParty',frame) end
        local wasGrouped,wasMembers=false,0
        pcall(frame.SetScript,frame,'OnEvent',function(_,event,a)
            if event=='PLAYER_LOGIN' then
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.NewTicker)=='function' then pcall(timer.NewTicker,1,function() pcall(onTick) end) end
                later(6,function() readDeskPlan();dirty.signal=true;dirty.state=true end)
                return
            end
            if event=='GROUP_ROSTER_UPDATE' or event=='PARTY_LEADER_CHANGED' or event=='UNIT_CONNECTION' then
                local grouped=call(IsInGroup)==true
                local n=call(GetNumGroupMembers)
                n=type(n)=='number' and n or 0
                if not grouped then
                    for k in pairs(peers) do peers[k]=nil end
                    ready=false;lastState=nil;planParts={}
                    -- A plan somebody else made belongs to that party.
                    local p=plan()
                    if p and not same(p.by,myName()) then store().plan=nil end
                elseif inParty() and (not wasGrouped or n>wasMembers) and partyOn() then
                    -- Somebody joined: everybody says who they are after a short random wait, the
                    -- holder of the plan sends it, and a new member asks for the soft-reserve list.
                    later(.3+random(),function() tell(true) end)
                    later(1.5,function() sharePlan(true) end)
                    if not wasGrouped and not leads() and liveOn() then
                        later(3,function()
                            local soft=BackstageForeverSoftState
                            if inParty() and type(soft)=='table' and not soft.theirs and BackstageForeverLiveRate(rate,'sr',tick(),30) then send('S?') end
                        end)
                    end
                end
                local here={}
                for i=1,4 do local name=call(UnitName,'party'..i) if type(name)=='string' then here[name:lower()]=true end end
                for k in pairs(peers) do if not here[k] then peers[k]=nil end end
                wasGrouped,wasMembers=grouped,n
                dirty.signal=true
                return
            end
            if event=='QUEST_TURNED_IN' then
                local id=plain(a)
                local title=whole(id,1,2147483647) and (titles[id] or call(field(plain(C_QuestLog),'GetTitleForQuestID'),id)) or nil
                if type(title)=='string' and sayKind('quest') then pcall(announce,'quest',title) end
                dirty.crew=true
                return
            end
            if event=='QUEST_LOG_UPDATE' then
                if sayKind('objective') or sayKind('quest') then dirty.quests=true end
                dirty.crew=true
                return
            end
            if event=='BAG_UPDATE_DELAYED' or event=='UPDATE_INVENTORY_DURABILITY' then dirty.crew=true return end
            dirty.state=dirty.state or true;dirty.signal=true
        end)
    end
end

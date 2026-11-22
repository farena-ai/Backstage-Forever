-- Scout mode (1.26, roadmap S1, the part that stays on your computer). Off until you switch it on.
-- While it is on, the addon notes the quest givers, hand-ins, trainers, vendors and flight masters
-- you talk to: the NPC's id and name, the map and where you stood. At most 400 per character.
--   /bf scout on|off    this character's switch        /bf scout        counts per zone
--   /bf scout clear     forgets every record of this character
-- The records ride to the desktop app in the saved file, in a block of their own. Nothing is sent
-- to other players or to a server. Only windows you open yourself are read; nothing is clicked.
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
    for i=2,8 do r[i]=plain(r[i]) end
    return unpackAll(r,2,8)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function method(o,k,...) return call(field(o,k),o,...) end
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
local MAX,NAME_MAX=400,60
local KINDS={g=true,h=true,t=true,v=true,f=true}
local ORDER={'g','h','t','v','f'}
local ONE={g='quest giver',h='hand-in',t='trainer',v='vendor',f='flight master'}
local MANY={g='quest givers',h='hand-ins',t='trainers',v='vendors',f='flight masters'}
BackstageForeverScoutMax=MAX
-- Pure: the NPC id inside a unit GUID ("Creature-0-4444-0-12-3296-0000ABCDEF" -> 3296), or nil
-- for players, pets, objects and anything else.
function BackstageForeverScoutNpcId(guid)
    if type(guid)~='string' or #guid>100 then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-%x+$')
    if kind~='Creature' and kind~='Vehicle' then return nil end
    id=tonumber(id)
    if id and id>=1 and id<=2147483647 then return id end
end
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
local function unit(v) return type(v)=='number' and v==v and v>=0 and v<=1 end
-- Pure: one record made clean, or nil. A giver or hand-in needs its quest; the others carry none.
-- record = {k=,n=npc id,name=,m=map id,x=,y=,q=quest id,at=seconds}
function BackstageForeverScoutRecord(record)
    if type(record)~='table' or not KINDS[record.k] or not whole(record.n,1,2147483647) or not whole(record.m,1,1000000)
        or not unit(record.x) or not unit(record.y) or not whole(record.at,1,253402300799) then return nil end
    local quest=record.k=='g' or record.k=='h'
    if quest and not whole(record.q,1,2147483647) then return nil end
    local out={k=record.k,n=record.n,m=record.m,x=floor(record.x*10000+.5)/10000,y=floor(record.y*10000+.5)/10000,at=record.at}
    if quest then out.q=record.q end
    local name=record.name
    if type(name)=='string' then
        name=name:gsub('[%c|]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
        if #name>NAME_MAX then name=name:sub(1,NAME_MAX):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
        if name~='' then out.name=name end
    end
    return out
end
local function keyOf(r) return r.k..':'..r.n..':'..(r.q or 0) end
-- Pure: keeps one record. The same NPC in the same role (and for the same quest) is kept once and
-- only its time and spot are refreshed. When the list is full the record seen longest ago goes.
-- -> 'new', 'seen', or nil when the record is not clean.
function BackstageForeverScoutAdd(records,record,max)
    record=BackstageForeverScoutRecord(record)
    if type(records)~='table' or not record then return nil end
    max=type(max)=='number' and max>=1 and floor(max) or MAX
    local key=keyOf(record)
    local oldest
    for i,row in ipairs(records) do
        if keyOf(row)==key then records[i]=record return 'seen' end
        if not oldest or row.at<records[oldest].at then oldest=i end
    end
    while #records>=max and oldest do
        table.remove(records,oldest)
        oldest=nil
        for i,row in ipairs(records) do if not oldest or row.at<records[oldest].at then oldest=i end end
    end
    records[#records+1]=record
    return 'new'
end
-- Pure: a saved list read back: every row checked again, doubles dropped, at most max kept.
function BackstageForeverScoutClean(records,max)
    local out={}
    for _,row in ipairs(type(records)=='table' and records or {}) do BackstageForeverScoutAdd(out,row,max) end
    return out
end
-- Pure: counts per map: {{map=,total=,g=,h=,t=,v=,f=}}, the map with the most records first.
function BackstageForeverScoutCounts(records)
    local byMap,list={},{}
    for _,r in ipairs(type(records)=='table' and records or {}) do
        if type(r)=='table' and KINDS[r.k] and type(r.m)=='number' then
            local row=byMap[r.m]
            if not row then row={map=r.m,total=0,g=0,h=0,t=0,v=0,f=0};byMap[r.m]=row;list[#list+1]=row end
            row.total=row.total+1;row[r.k]=row[r.k]+1
        end
    end
    table.sort(list,function(a,b) if a.total~=b.total then return a.total>b.total end return a.map<b.map end)
    return list
end
-- Pure: the chat lines for /bf scout. nameOf(mapId) gives a zone name or nil.
function BackstageForeverScoutLines(records,on,nameOf,limit)
    local counts=BackstageForeverScoutCounts(records)
    local total=0
    for _,row in ipairs(counts) do total=total+row.total end
    local lines={}
    if on then lines[1]=T(('Scout mode is on. Records on this character: %d of %d.'):format(total,MAX))
    else lines[1]=T(('Scout mode is off. Records on this character: %d. /bf scout on starts recording.'):format(total)) end
    if total==0 then
        if on then lines[2]='  '..T('Talk to a quest giver, trainer, vendor or flight master and it is noted.') end
        return lines
    end
    limit=type(limit)=='number' and limit or 12
    for i=1,min(#counts,limit) do
        local row=counts[i]
        local parts={}
        for _,k in ipairs(ORDER) do if row[k]>0 then parts[#parts+1]=row[k]..' '..T(row[k]==1 and ONE[k] or MANY[k]) end end
        local name
        if type(nameOf)=='function' then local ok,n=pcall(nameOf,row.map) if ok and type(n)=='string' and n~='' then name=n end end
        lines[#lines+1]=('  %s: %d (%s)'):format(name or (T('Map')..' #'..row.map),row.total,table.concat(parts,', '))
    end
    if #counts>limit then lines[#lines+1]='  '..T(('and %d more.'):format(#counts-limit)) end
    return lines
end

-- ---------------------------------------------------------------- live
local db
local function load()
    if type(BackstageForeverScoutDB)~='table' then BackstageForeverScoutDB={} end
    if db~=BackstageForeverScoutDB then
        db=BackstageForeverScoutDB
        db.records=BackstageForeverScoutClean(db.records,MAX)
    end
    return db
end
function BackstageForeverScoutOn()
    local s=BackstageForeverScoutDB
    return type(s)=='table' and rawget(s,'on')==true
end
-- The optional capture block: {version=1,records={...}}, or nil when there is nothing recorded.
function BackstageForeverScoutSnapshot()
    local s=BackstageForeverScoutDB
    if type(s)~='table' or type(s.records)~='table' or #s.records==0 then return nil end
    local records=BackstageForeverScoutClean(s.records,MAX)
    if #records==0 then return nil end
    return {version=1,records=records}
end
local function where()
    local api=plain(C_Map)
    local map=call(field(api,'GetBestMapForUnit'),'player')
    if not whole(map,1,1000000) then return nil end
    local pos=call(field(api,'GetPlayerMapPosition'),map,'player')
    local x,y
    if pos then x,y=method(pos,'GetXY') end
    if not unit(x) or not unit(y) or (x==0 and y==0) then return nil end
    return map,x,y
end
-- The NPC whose window is open. The talk window may close the "npc" unit before a trainer or
-- flight window opens, so the last one seen is remembered for a short while.
local lastNpc=nil
local function npc()
    local id=BackstageForeverScoutNpcId(call(UnitGUID,'npc'))
    if id then
        local name=call(UnitName,'npc')
        lastNpc={id=id,name=type(name)=='string' and name or nil,at=call(GetTime) or 0}
        return lastNpc
    end
    local at=call(GetTime)
    if lastNpc and type(at)=='number' and at>=lastNpc.at and at-lastNpc.at<=10 then return lastNpc end
end
local function note(kind,quest)
    if not BackstageForeverScoutOn() then return false end
    local who=npc()
    local map,x,y=where()
    local at=call(time)
    if not who or not map or type(at)~='number' then return false end
    local result=BackstageForeverScoutAdd(load().records,{k=kind,n=who.id,name=who.name,m=map,x=x,y=y,q=quest,at=floor(at)},MAX)
    if result=='new' and type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
    return result~=nil
end
local EVENTS={QUEST_DETAIL='g',QUEST_COMPLETE='h',MERCHANT_SHOW='v',TRAINER_SHOW='t',TAXIMAP_OPENED='f'}
function BackstageForeverScoutEvent(event)
    if event=='GOSSIP_SHOW' then if BackstageForeverScoutOn() then npc() end return false end
    local kind=EVENTS[event]
    if not kind then return false end
    local quest=nil
    if kind=='g' or kind=='h' then
        quest=call(GetQuestID)
        if not whole(quest,1,2147483647) then return false end
    end
    return note(kind,quest)
end
local function zoneName(map)
    local info=call(field(plain(C_Map),'GetMapInfo'),map)
    local name=field(info,'name')
    if type(name)=='string' and name~='' and #name<=60 then return (name:gsub('|','')) end
    local known=BackstageForeverFindMaps
    if type(known)=='table' and type(known[map])=='string' then return known[map] end
end
function BackstageForeverScoutCommand(message)
    local arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^scout%s*(%a*)%s*$')
    local s=load()
    if arg=='on' or arg=='off' then
        s.on=arg=='on'
        return say(s.on and 'Scout mode: on. Quest givers, hand-ins, trainers, vendors and flight masters you talk to are noted on this computer. Nothing is sent to anyone. /bf scout off stops it.'
            or 'Scout mode: off. Nothing new is noted. What you recorded stays until /bf scout clear.')
    end
    if arg=='clear' then
        local n=#s.records
        s.records={}
        if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
        return say(('Scout records of this character cleared: %d.'):format(n))
    end
    for _,line in ipairs(BackstageForeverScoutLines(s.records,s.on==true,zoneName)) do say(line) end
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Scout',events) end
        for _,e in ipairs({'PLAYER_LOGIN','GOSSIP_SHOW','QUEST_DETAIL','QUEST_COMPLETE','MERCHANT_SHOW','TRAINER_SHOW','TAXIMAP_OPENED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then pcall(load) return end
            pcall(BackstageForeverScoutEvent,event)
        end)
    end
end

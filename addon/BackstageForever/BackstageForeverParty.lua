-- Party sync (A13 / 3.6): party members who run Backstage Forever see each other's quests.
-- Over the game's own addon messages to your PARTY only (never raid, guild, whisper or the app):
-- quest IDs and objective counts, nothing else. /bf party shows who needs what;
-- /bf party way shares your waypoint, /bf party go follows the last one shared with you.
-- /bf party off stops sending and listening.
local floor,min=math.floor,math.min
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
    for i=2,6 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,6)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return floor(v) end end
local function str(v,max) v=plain(v);if type(v)~='string' or v=='' then return nil end return v:sub(1,max or 60) end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end

local PREFIX='BFParty'
local CHUNK,MAX_CHUNKS,MAX_QUESTS,MAX_OBJ=230,4,40,6
local SEND_GAP=10
BackstageForeverPartyPrefix=PREFIX

local settings
local function loadSettings()
    if type(BackstageForeverPartySettings)~='table' then BackstageForeverPartySettings={} end
    settings=BackstageForeverPartySettings
    if settings.enabled==nil then settings.enabled=true end
    return settings
end

-- Pure: quests {{id,complete,obj={{have,need}}}} -> message bodies (each <= 230 bytes).
-- One quest is "id" then "!" when complete, else ":have/need,have/need". Quests are ";"-separated.
function BackstageForeverPartyEncode(quests,seq)
    local parts={}
    for i=1,min(#(quests or {}),MAX_QUESTS) do
        local q=quests[i]
        local id=int(q.id,1,2147483647)
        if id then
            local s=tostring(id)
            if q.complete then s=s..'!'
            elseif type(q.obj)=='table' and #q.obj>0 then
                local o={}
                for j=1,min(#q.obj,MAX_OBJ) do o[#o+1]=(int(q.obj[j][1],0,9999) or 0)..'/'..(int(q.obj[j][2],0,9999) or 0) end
                s=s..':'..table.concat(o,',')
            end
            parts[#parts+1]=s
        end
    end
    local bodies,cur={},''
    for _,p in ipairs(parts) do
        if #cur>0 and #cur+1+#p>CHUNK then bodies[#bodies+1]=cur;cur=p else cur=#cur>0 and (cur..';'..p) or p end
    end
    bodies[#bodies+1]=cur
    while #bodies>MAX_CHUNKS do table.remove(bodies) end
    local out={}
    seq=int(seq,0,999) or 0
    for i,b in ipairs(bodies) do out[i]=('Q|%d|%d/%d|%s'):format(seq,i,#bodies,b) end
    return out
end

-- Pure: one body -> quests (same shape as Encode's input). Anything malformed is skipped.
function BackstageForeverPartyDecodeBody(body)
    local quests={}
    if type(body)~='string' then return quests end
    for entry in body:gmatch('[^;]+') do
        local id,rest=entry:match('^(%d+)(.*)$')
        id=tonumber(id)
        if id and #quests<MAX_QUESTS then
            local q={id=id,obj={}}
            if rest=='!' then q.complete=true
            elseif rest:sub(1,1)==':' then
                for have,need in rest:sub(2):gmatch('(%d+)/(%d+)') do if #q.obj<MAX_OBJ then q.obj[#q.obj+1]={tonumber(have),tonumber(need)} end end
            end
            quests[#quests+1]=q
        end
    end
    return quests
end

-- Pure: collects chunks in state.pending[sender]; returns the full quest list once every
-- chunk of one sequence has arrived (a newer sequence replaces an unfinished older one).
function BackstageForeverPartyReceive(state,sender,message)
    if type(state)~='table' or type(sender)~='string' or type(message)~='string' then return nil end
    local seq,i,n,body=message:match('^Q|(%d+)|(%d+)/(%d+)|(.*)$')
    seq,i,n=tonumber(seq),tonumber(i),tonumber(n)
    if not seq or not i or not n or n<1 or n>MAX_CHUNKS or i<1 or i>n then return nil end
    state.pending=state.pending or {}
    local p=state.pending[sender]
    if not p or p.seq~=seq or p.n~=n then p={seq=seq,n=n,got=0,bodies={}};state.pending[sender]=p end
    if not p.bodies[i] then p.bodies[i]=body;p.got=p.got+1 end
    if p.got<n then return nil end
    state.pending[sender]=nil
    local all={}
    for k=1,n do for _,q in ipairs(BackstageForeverPartyDecodeBody(p.bodies[k])) do all[#all+1]=q end end
    return all
end

-- Pure: mine and theirs -> {shared={{id,me,them}},theyOnly={id...},behind=count}.
-- "behind" counts shared quests where they still need objectives you have finished.
function BackstageForeverPartyCompare(mine,theirs)
    local byId={}
    for _,q in ipairs(mine or {}) do byId[q.id]=q end
    local out={shared={},theyOnly={}}
    for _,q in ipairs(theirs or {}) do
        if byId[q.id] then out.shared[#out.shared+1]={id=q.id,me=byId[q.id],them=q} else out.theyOnly[#out.theyOnly+1]=q.id end
    end
    return out
end

-- Pure: one side's progress in words: "done", "3/8", "3/8, 0/1" or "in progress".
function BackstageForeverPartyProgress(q)
    if type(q)~='table' then return '?' end
    if q.complete then return 'done' end
    if type(q.obj)~='table' or #q.obj==0 then return 'in progress' end
    local parts={}
    for _,o in ipairs(q.obj) do parts[#parts+1]=(o[1] or 0)..'/'..(o[2] or 0) end
    return table.concat(parts,', ')
end

-- Live reads.
local function myQuests()
    local api=plain(C_QuestLog);local list={}
    local n=int(call(field(api,'GetNumQuestLogEntries')),0,200) or 0
    for i=1,min(n,80) do
        local info=call(field(api,'GetInfo'),i)
        local id=type(info)=='table' and not field(info,'isHeader') and int(field(info,'questID'),1,2147483647)
        if id and #list<MAX_QUESTS then
            local q={id=id,complete=call(field(api,'IsComplete'),id)==true,obj={}}
            local rows=call(field(api,'GetQuestObjectives'),id)
            if type(rows)=='table' then for j=1,min(#rows,MAX_OBJ) do
                local o=rows[j]
                local need=type(o)=='table' and int(field(o,'numRequired'),0,9999)
                if need then q.obj[#q.obj+1]={int(field(o,'numFulfilled'),0,9999) or 0,need} end
            end end
            list[#list+1]=q
        end
    end
    return list
end
local function titleOf(id)
    return str(call(field(plain(C_QuestLog),'GetTitleForQuestID'),id),80) or ('quest '..id)
end
local function inParty() return call(IsInGroup)==true and call(IsInRaid)~=true end
local function shortName(n) return str(call(Ambiguate,n,'short'),40) or str(n,40) end
local function me() return str(call(UnitName,'player'),40) end

local state={pending={},members={},seq=0}
BackstageForeverPartyState=state
local lastSent,lastBody,due=-SEND_GAP,nil,false
local function send(kind,text)
    local api=plain(C_ChatInfo)
    local fn=field(api,'SendAddonMessage')
    if type(fn)~='function' then return false end
    return pcall(fn,PREFIX,text,'PARTY')
end
local function now() return call(GetTime) or 0 end
local function broadcast(force)
    if not settings.enabled or not inParty() then return end
    local t=now()
    if not force and t-lastSent<SEND_GAP then due=true return end
    local bodies=BackstageForeverPartyEncode(myQuests(),state.seq)
    local key=(table.concat(bodies,'\n'):gsub('Q|%d+|',''))
    if not force and key==lastBody then due=false return end
    state.seq=(state.seq+1)%1000
    bodies=BackstageForeverPartyEncode(myQuests(),state.seq)
    for _,b in ipairs(bodies) do send('Q',b) end
    lastSent,lastBody,due=t,key,false
end

local function onMessage(prefix,message,channel,sender)
    if prefix~=PREFIX or channel~='PARTY' or not settings.enabled then return end
    sender=shortName(sender)
    if not sender or sender==me() or type(message)~='string' or #message>255 then return end
    if message=='R' then lastBody=nil;broadcast(false);return end
    local x,y,map,label=message:match('^W|([%d%.]+)|([%d%.]+)|(%d+)|(.*)$')
    if x then
        state.way={map=tonumber(map),x=tonumber(x),y=tonumber(y),label=(label or ''):sub(1,40),from=sender}
        return say(('%s shares a waypoint: %s at %.1f, %.1f. Type /bf party go to follow it.'):format(sender,state.way.label~='' and state.way.label or 'a spot',state.way.x,state.way.y))
    end
    local quests=BackstageForeverPartyReceive(state,sender,message)
    if quests then state.members[sender]={quests=quests,at=now()} end
end

local function forgetLeavers()
    local here={}
    for i=1,4 do local n=str(call(UnitName,'party'..i),40) if n then here[n]=true end end
    for name in pairs(state.members) do if not here[name] then state.members[name]=nil end end
end

local function myWaypoint()
    local api=plain(C_Map)
    local point=call(field(api,'GetUserWaypoint'))
    local map=point and int(field(point,'uiMapID'),1,2147483647)
    local pos=point and field(point,'position')
    local x,y
    if pos then local getXY=field(pos,'GetXY') if getXY then x,y=call(getXY,pos) end end
    if map and x and y then return map,x,y,'my waypoint' end
    map=int(call(field(api,'GetBestMapForUnit'),'player'),1,2147483647)
    pos=map and call(field(api,'GetPlayerMapPosition'),map,'player')
    if pos then local getXY=field(pos,'GetXY') if getXY then x,y=call(getXY,pos) end end
    if map and x and y and (x>0 or y>0) then return map,x,y,'where I am' end
end

function BackstageForeverPartyCommand(message)
    if not settings then loadSettings() end
    local rest=(type(message)=='string' and message:lower() or ''):match('^party%s*(.-)%s*$') or ''
    if rest=='on' or rest=='off' then
        settings.enabled=rest=='on'
        if settings.enabled and inParty() then send('R','R');broadcast(true) end
        return say('Party sync '..(settings.enabled and 'on.' or 'off: nothing is sent or read.'))
    end
    if not settings.enabled then return say('Party sync is off. /bf party on turns it on.') end
    if type(field(plain(C_ChatInfo),'SendAddonMessage'))~='function' then return say('Party sync is not available in this game client.') end
    if rest=='way' then
        if not inParty() then return say('Join a party first.') end
        local map,x,y,label=myWaypoint()
        if not map then return say('No waypoint or position to share here.') end
        send('W',('W|%.1f|%.1f|%d|%s'):format(x*100,y*100,map,label))
        return say(('Shared %s (%.1f, %.1f) with your party.'):format(label,x*100,y*100))
    end
    if rest=='go' then
        local w=state.way
        if not w then return say('Nobody has shared a waypoint yet.') end
        if type(BackstageForeverWay)=='function' then return BackstageForeverWay(('way %d %.1f %.1f %s'):format(w.map,w.x,w.y,w.from..': '..w.label)) end
        return say(('Head to %.1f, %.1f.'):format(w.x,w.y))
    end
    if not inParty() then return say('Party sync is on. Join a party with other Backstage Forever players to see each other\'s quests.') end
    forgetLeavers()
    local mine=myQuests()
    local any=false
    for name,m in pairs(state.members) do
        any=true
        local c=BackstageForeverPartyCompare(mine,m.quests)
        say(('%s: %d quests, %d shared with you.'):format(name,#m.quests,#c.shared))
        for i=1,min(#c.shared,6) do local s=c.shared[i] say(('  %s: them %s, you %s'):format(titleOf(s.id),BackstageForeverPartyProgress(s.them),BackstageForeverPartyProgress(s.me))) end
        if #c.theyOnly>0 then
            local names={}
            for i=1,min(#c.theyOnly,4) do names[#names+1]=titleOf(c.theyOnly[i]) end
            say('  Only they have: '..table.concat(names,', ')..(#c.theyOnly>4 and (' and '..(#c.theyOnly-4)..' more') or '')..'. Ask them to share.')
        end
    end
    if not any then send('R','R');say('No party members with Backstage Forever yet. Asked again; try /bf party in a few seconds.') end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','CHAT_MSG_ADDON','GROUP_ROSTER_UPDATE','QUEST_LOG_UPDATE'}) do pcall(events.RegisterEvent,events,e) end
        local wait=0
        pcall(events.SetScript,events,'OnUpdate',function(_,elapsed)
            if not due then return end
            wait=wait-(elapsed or 0);if wait>0 then return end;wait=1
            if settings and now()-lastSent>=SEND_GAP then pcall(broadcast,false) end
        end)
        local wasInParty=false
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b,c,d)
            if not settings then loadSettings() end
            if event=='PLAYER_LOGIN' then
                call(field(plain(C_ChatInfo),'RegisterAddonMessagePrefix'),PREFIX)
            elseif event=='CHAT_MSG_ADDON' then pcall(onMessage,plain(a),plain(b),plain(c),plain(d))
            elseif event=='GROUP_ROSTER_UPDATE' then
                local p=inParty()
                if p and not wasInParty and settings.enabled then send('R','R');lastBody=nil;pcall(broadcast,true) end
                if not p then state.members={} state.pending={} end
                wasInParty=p
                pcall(forgetLeavers)
            elseif event=='QUEST_LOG_UPDATE' then pcall(broadcast,false) end
        end)
    end
end

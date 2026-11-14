-- Journey journal: when each level was reached (with /played time), first-time moments and
-- zones visited. Kept per character and exported to the desktop app for speed splits and
-- badges. Public API only; the /played request is made quietly (its chat line is hidden once).
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
    for i=2,12 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,12)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return floor(v) end end
local MAX_LEVELS,MAX_FIRSTS,MAX_ZONES=80,40,120
local FIRSTS={dungeon=true,flight=true,mount=true,death=true,rested=true,group=true,hearth=true}

local db
local function store()
    if type(BackstageForeverJournalDB)~='table' then BackstageForeverJournalDB={} end
    db=BackstageForeverJournalDB
    if type(db.levels)~='table' then db.levels={} end
    if type(db.firsts)~='table' then db.firsts={} end
    if type(db.zones)~='table' then db.zones={} end
    return db
end
local function now() return int(call(time),0,253402300799) end

-- Pure-ish helpers (exposed for tests).
function BackstageForeverJournalLevel(level,at)
    local d=store();level=int(level,1,1000);at=int(at,0,253402300799)
    if not level or not at then return end
    for _,e in ipairs(d.levels) do if e.level==level then return e end end
    local e={level=level,at=at};d.levels[#d.levels+1]=e
    while #d.levels>MAX_LEVELS do table.remove(d.levels,1) end
    return e
end
function BackstageForeverJournalPlayed(total)
    local d=store();total=int(total,0,10^10)
    if not total then return end
    d.played=total;d.playedAt=now()
    -- The newest level without a /played reading gets this one (it was just reached).
    local last=d.levels[#d.levels]
    if last and not last.played and d.playedAt and d.playedAt-last.at<=600 then last.played=total end
end
function BackstageForeverJournalFirst(key,at)
    local d=store();at=int(at,0,253402300799)
    if not FIRSTS[key] or not at then return false end
    for _,f in ipairs(d.firsts) do if f.key==key then return false end end
    if #d.firsts>=MAX_FIRSTS then return false end
    d.firsts[#d.firsts+1]={key=key,at=at}
    return true
end
function BackstageForeverJournalZone(mapId)
    local d=store();mapId=int(mapId,1,2147483647)
    if not mapId then return false end
    for _,z in ipairs(d.zones) do if z==mapId then return false end end
    if #d.zones>=MAX_ZONES then return false end
    d.zones[#d.zones+1]=mapId
    return true
end
-- Export block (arrays only; BackstageForever.lua marks them as JSON arrays).
function BackstageForeverJournalSnapshot()
    local d=store()
    local levels,firsts,zones={},{},{}
    for i=1,min(#d.levels,MAX_LEVELS) do local e=d.levels[i];levels[#levels+1]={level=e.level,at=e.at,played=e.played} end
    for i=1,min(#d.firsts,MAX_FIRSTS) do firsts[#firsts+1]={key=d.firsts[i].key,at=d.firsts[i].at} end
    for i=1,min(#d.zones,MAX_ZONES) do zones[#zones+1]=d.zones[i] end
    if #levels==0 and #firsts==0 and #zones==0 and not d.played then return nil end
    return {levels=levels,firsts=firsts,zones=zones,played=d.played}
end

-- Quiet /played: chat windows briefly stop listening for the play-time message while our own
-- request is answered, then listen again. Blizzard's chat functions are never replaced (replacing
-- them taints the default UI and triggers "blocked from an action only available to the Blizzard UI").
local muted=nil
local function chatFrames()
    local list,n={},tonumber(plain(NUM_CHAT_WINDOWS)) or 10
    for i=1,n do local f=plain(_G and _G['ChatFrame'..i]) if type(f)=='table' then list[#list+1]=f end end
    return list
end
local function unmute()
    if not muted then return end
    for _,f in ipairs(muted) do if type(f.RegisterEvent)=='function' then pcall(f.RegisterEvent,f,'TIME_PLAYED_MSG') end end
    muted=nil
end
local function requestPlayed()
    if type(RequestTimePlayed)~='function' or muted then return end
    muted={}
    for _,f in ipairs(chatFrames()) do
        local listening=type(f.IsEventRegistered)=='function' and select(2,pcall(f.IsEventRegistered,f,'TIME_PLAYED_MSG'))
        if listening==true and type(f.UnregisterEvent)=='function' and pcall(f.UnregisterEvent,f,'TIME_PLAYED_MSG') then muted[#muted+1]=f end
    end
    -- Never leave chat deaf: listen again after a few seconds even if no answer comes.
    local timer=plain(C_Timer)
    if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,5,unmute) end
    if not pcall(RequestTimePlayed) then unmute() end
end

local function zoneNow()
    local mapApi=plain(C_Map)
    local mapId=int(call(field(mapApi,'GetBestMapForUnit'),'player'),1,2147483647)
    if not mapId then return nil end
    -- Count zones, not sub-maps: walk up to the zone level (type 3) when the API offers it.
    for _=1,4 do
        local info=call(field(mapApi,'GetMapInfo'),mapId)
        local kind=int(field(info,'mapType'),0,10)
        if not kind or kind<=3 then break end
        local parent=int(field(info,'parentMapID'),1,2147483647);if not parent then break end
        mapId=parent
    end
    return mapId
end
local function first(key)
    if BackstageForeverJournalFirst(key,now()) and type(BackstageForeverToast)=='function' then
        local words={dungeon='First dungeon!',flight='First flight!',mount='First ride on your own mount!',death='First death: it happens to everyone',rested='First rested bonus',group='First group adventure',hearth='First trip home by Hearthstone'}
        pcall(BackstageForeverToast,words[key] or 'A first!','A new badge waits in the Backstage Forever app.')
    end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_LEVEL_UP','TIME_PLAYED_MSG','PLAYER_ENTERING_WORLD','ZONE_CHANGED_NEW_AREA','PLAYER_DEAD','PLAYER_CONTROL_LOST','PLAYER_MOUNT_DISPLAY_CHANGED','UPDATE_EXHAUSTION','GROUP_ROSTER_UPDATE','UNIT_SPELLCAST_SUCCEEDED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b,c)
            store()
            if event=='PLAYER_LOGIN' then
                local level=int(call(UnitLevel,'player'),1,1000)
                if level and #db.levels==0 then BackstageForeverJournalLevel(level,now()) end
                requestPlayed()
            elseif event=='PLAYER_LEVEL_UP' then BackstageForeverJournalLevel(a,now());requestPlayed()
            elseif event=='TIME_PLAYED_MSG' then BackstageForeverJournalPlayed(a)
                local timer=plain(C_Timer);if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,0,unmute) else unmute() end
            elseif event=='PLAYER_ENTERING_WORLD' or event=='ZONE_CHANGED_NEW_AREA' then
                local inside,kind=call(IsInInstance)
                if inside and (kind=='party' or kind=='raid') then first('dungeon') end
                local z=zoneNow()
                -- A zone visited for the first time is also a moment for the desktop app.
                if z and BackstageForeverJournalZone(z) and type(BackstageForeverMomentsZone)=='function' then pcall(BackstageForeverMomentsZone,z) end
            elseif event=='PLAYER_DEAD' then first('death')
            elseif event=='PLAYER_CONTROL_LOST' then if call(UnitOnTaxi,'player') then first('flight') end
            elseif event=='PLAYER_MOUNT_DISPLAY_CHANGED' then if call(IsMounted) then first('mount') end
            elseif event=='UPDATE_EXHAUSTION' then if call(GetXPExhaustion) then first('rested') end
            elseif event=='GROUP_ROSTER_UPDATE' then if call(IsInGroup) then first('group') end
            elseif event=='UNIT_SPELLCAST_SUCCEEDED' then if a=='player' and (c==8690) then first('hearth') end end
        end)
    end
end

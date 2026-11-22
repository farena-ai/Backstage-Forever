-- Gathering loop walker (roadmap E4). The desktop app builds a loop through past herb or ore
-- spots and hands it over in BackstageForeverDesktop.lua. /bf loop starts it: the game's own
-- waypoint arrow points at the next stop and moves on when you arrive. /bf loop next skips a
-- stop, /bf loop stop ends it. Only your typed command starts it; it never moves, targets or
-- gathers for you, and it waits while you are in combat.
-- It also gives the minimap the gathering spots you remembered on this map.
local ARRIVE_YARDS,ARRIVE_MAP,TICK=30,.012,2
local MAX_STOPS=40
local KIND_WORD={h='herbs',o='ore'}
local NODE_ICON={mining='Interface\\Icons\\INV_Ore_Copper_01',herbalism='Interface\\Icons\\INV_Misc_Flower_02',chest='Interface\\Icons\\INV_Box_01'}
local LOOP_ICON='Interface\\Icons\\INV_Misc_Map_01'

local function plain(v)
    if v==nil then return nil end
    if type(issecretvalue)=='function' then local ok,secret=pcall(issecretvalue,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,5 do r[i]=plain(r[i]) end
    return r[2],r[3],r[4],r[5]
end
local function finite(v) return type(v)=='number' and v==v and v>-1e7 and v<1e7 end
local function unit(v) return type(v)=='number' and v==v and v>=0 and v<=1 end
local function T(m) return (BackstageForeverTr or tostring)(m) end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end

-- Pure: the loop the desktop sent for this character, or nil. data is BackstageForeverDesktopData.
-- Returns {mapId=,kind='h'|'o',stops={{x=,y=},...}} with x and y as map fractions.
function BackstageForeverLoopRead(data,name,realm)
    if type(data)~='table' or data.schema~=1 or type(data.characters)~='table' or type(name)~='string' or type(realm)~='string' then return nil end
    local row=data.characters[name..'-'..realm]
    local loop=type(row)=='table' and row.loop or nil
    if type(loop)~='table' or type(loop.m)~='number' or loop.m<1 or loop.m>2147483647 or loop.m%1~=0 or not KIND_WORD[loop.k] or type(loop.s)~='table' then return nil end
    local n=#loop.s
    if n<6 or n>MAX_STOPS*2 or n%2~=0 then return nil end
    local stops={}
    for i=1,n,2 do
        local x,y=loop.s[i],loop.s[i+1]
        if type(x)~='number' or type(y)~='number' or x~=x or y~=y or x<0 or x>10000 or y<0 or y>10000 then return nil end
        stops[#stops+1]={x=x/10000,y=y/10000}
    end
    return {mapId=loop.m,kind=loop.k,stops=stops}
end
-- Pure: how far a stop is. size is {width=,height=} of the map in yards, or nil.
-- Returns the distance and 'yards', or the distance in map fractions and 'map'.
function BackstageForeverLoopDistance(stop,x,y,size)
    if type(stop)~='table' or not unit(stop.x) or not unit(stop.y) or not unit(x) or not unit(y) then return nil end
    local dx,dy=stop.x-x,stop.y-y
    if type(size)=='table' and finite(size.width) and finite(size.height) and size.width>0 and size.height>0 then
        dx,dy=dx*size.width,dy*size.height
        return math.sqrt(dx*dx+dy*dy),'yards'
    end
    return math.sqrt(dx*dx+dy*dy),'map'
end
-- Pure: the stop nearest to you, where a loop starts.
function BackstageForeverLoopNearest(stops,x,y,size)
    local best,far=nil,nil
    for i,stop in ipairs(type(stops)=='table' and stops or {}) do
        local d=BackstageForeverLoopDistance(stop,x,y,size)
        if d and (not far or d<far) then best,far=i,d end
    end
    return best,far
end
-- Pure: are you at this stop? Within 30 yards, or 1.2% of the map when its size is not known.
function BackstageForeverLoopArrived(stop,x,y,size)
    local d,kind=BackstageForeverLoopDistance(stop,x,y,size)
    if not d then return false end
    return d<=(kind=='yards' and ARRIVE_YARDS or ARRIVE_MAP)
end
-- Pure: moves state {index=,count=,visited=} on when you stand at its stop. Returns the new
-- index, and true when that finished a whole lap; nil when you have not arrived.
function BackstageForeverLoopAdvance(state,stops,x,y,size,force)
    if type(state)~='table' or type(stops)~='table' or #stops==0 or type(state.index)~='number' or not stops[state.index] then return nil end
    if not force and not BackstageForeverLoopArrived(stops[state.index],x,y,size) then return nil end
    state.visited=(state.visited or 0)+(force and 0 or 1)
    state.count=(state.count or 0)+1
    state.index=state.index%#stops+1
    return state.index,state.count%#stops==0
end
-- Pure: "Loop stop 3 of 12 (herbs): 41.2, 63.0".
function BackstageForeverLoopLine(loop,index)
    local stop=type(loop)=='table' and type(loop.stops)=='table' and loop.stops[index]
    if not stop then return nil end
    return T('Loop stop %d of %d (%s): %.1f, %.1f'):format(index,#loop.stops,T(KIND_WORD[loop.kind] or 'spots'),stop.x*100,stop.y*100)
end

local sizes={}
local function mapSize(mapId)
    if sizes[mapId]~=nil then return sizes[mapId] or nil end
    local api=plain(C_Map)
    local make=type(CreateVector2D)=='function' and CreateVector2D
    local size=false
    if type(api)=='table' and make then
        local _,a=call(api.GetWorldPosFromMapPos,mapId,make(0,0))
        local _,b=call(api.GetWorldPosFromMapPos,mapId,make(1,1))
        local ax,ay,bx,by
        if type(a)=='table' and type(a.GetXY)=='function' then ax,ay=call(a.GetXY,a) end
        if type(b)=='table' and type(b.GetXY)=='function' then bx,by=call(b.GetXY,b) end
        -- World x runs north-south and world y runs east-west.
        if finite(ax) and finite(ay) and finite(bx) and finite(by) and ax~=bx and ay~=by then size={width=math.abs(ay-by),height=math.abs(ax-bx)} end
    end
    sizes[mapId]=size
    return size or nil
end
local function here()
    local api=plain(C_Map)
    if type(api)~='table' then return nil end
    local mapId=call(api.GetBestMapForUnit,'player')
    if type(mapId)~='number' then return nil end
    local pos=call(api.GetPlayerMapPosition,mapId,'player')
    local x,y
    if type(pos)=='table' and type(pos.GetXY)=='function' then x,y=call(pos.GetXY,pos) end
    return mapId,unit(x) and x or nil,unit(y) and y or nil
end
local function zoneName(mapId)
    local names=type(BackstageForeverFindMaps)=='table' and BackstageForeverFindMaps or {}
    return type(names[mapId])=='string' and names[mapId] or ('map '..mapId)
end
-- The game's own waypoint and arrow, quietly. Never in combat.
local function point(loop,index)
    local stop=loop.stops[index]
    local api=plain(C_Map)
    if type(api)~='table' or call(InCombatLockdown)~=false then return false end
    if call(api.CanSetUserWaypointOnMap,loop.mapId)~=true then return false end
    local maker=plain(UiMapPoint)
    local p=type(maker)=='table' and call(maker.CreateFromCoordinates,loop.mapId,stop.x,stop.y)
    if not p or type(api.SetUserWaypoint)~='function' then return false end
    if not pcall(api.SetUserWaypoint,p) then return false end
    local track=plain(C_SuperTrack)
    if type(track)=='table' and type(track.SetSuperTrackedUserWaypoint)=='function' then pcall(track.SetSuperTrackedUserWaypoint,true) end
    return true
end

local active,ticker=nil,nil -- active: {loop=,state=}
local function stop(silent)
    if ticker and type(ticker.Cancel)=='function' then pcall(ticker.Cancel,ticker) end
    ticker=nil
    local was=active
    active=nil
    if was and not silent then say(T('Gathering loop stopped. Your last waypoint stays until you clear it.')) end
end
local function announce(lap)
    local line=BackstageForeverLoopLine(active.loop,active.state.index)
    if lap then say(T('That was the whole loop. It starts again; /bf loop stop ends it.')) end
    if point(active.loop,active.state.index) then say(line..'. '..T('Follow the arrow.'))
    else say(line..'. '..T('The game would not place a waypoint here; walk to those coordinates.')) end
end
local function tick()
    if not active then return stop(true) end
    if call(InCombatLockdown)~=false then return end
    local mapId,x,y=here()
    if mapId~=active.loop.mapId or not x or not y then return end
    local index,lap=BackstageForeverLoopAdvance(active.state,active.loop.stops,x,y,mapSize(mapId))
    if index then announce(lap) end
end

local function myLoop()
    local name=call(UnitName,'player')
    local realm=call(GetRealmName)
    return BackstageForeverLoopRead(BackstageForeverDesktopData,name,realm)
end
function BackstageForeverLoopCommand(message)
    local arg=(type(message)=='string' and message:lower() or ''):match('^loop%s*(%a*)') or ''
    if arg=='stop' or arg=='off' or arg=='end' then
        if not active then return say(T('No gathering loop is running.')) end
        return stop(false)
    end
    if call(InCombatLockdown)~=false then return say(T('The gathering loop waits until you leave combat.')) end
    if arg=='next' or arg=='skip' then
        if not active then return say(T('No gathering loop is running. Type /bf loop to start it.')) end
        local _,lap=BackstageForeverLoopAdvance(active.state,active.loop.stops,nil,nil,nil,true)
        return announce(lap)
    end
    if arg~='' and arg~='start' and arg~='on' then return say(T('Use /bf loop, /bf loop next or /bf loop stop.')) end
    local loop=myLoop()
    if not loop then return say(T('No gathering loop from the desktop app yet. In the app open World Map, pick a zone and Herbalism or Mining, press Send loop to game, then type /reload here.')) end
    local mapId,x,y=here()
    if mapId~=loop.mapId then
        return say(T('Your gathering loop is for %s (%d stops). Go there and type /bf loop again.'):format(zoneName(loop.mapId),#loop.stops))
    end
    if not x or not y then return say(T('Your position is not available here.')) end
    stop(true)
    local index=BackstageForeverLoopNearest(loop.stops,x,y,mapSize(mapId)) or 1
    active={loop=loop,state={index=index,count=0,visited=0}}
    say(T('Gathering loop in %s: %d stops. These are past spots, not live nodes. /bf loop next skips a stop, /bf loop stop ends it.'):format(zoneName(loop.mapId),#loop.stops))
    announce(false)
    local timer=plain(C_Timer)
    if type(timer)=='table' and type(timer.NewTicker)=='function' then
        local ok,handle=pcall(timer.NewTicker,TICK,function() pcall(tick) end)
        if ok then ticker=handle end
    end
    if not ticker then say(T('This game build has no timer for the loop; type /bf loop next at each stop.')) end
end
BackstageForeverLoopTick=tick -- for tests
function BackstageForeverLoopActive() return active and {index=active.state.index,stops=#active.loop.stops,mapId=active.loop.mapId} or nil end

-- Minimap: the spots you remembered on this map that your skill can gather (and chests), plus
-- the stop the loop points at. The list is rebuilt at most every 20 seconds.
local cache,cacheMap,cacheAt={},nil,-100
function BackstageForeverLoopMinimapPoints(mapId,now)
    local out={}
    if type(mapId)~='number' then return out end
    local on=type(BackstageForeverHelperEnabled)~='function' or call(BackstageForeverHelperEnabled,'gatheringMarks')==true
    if on and type(BackstageForeverGatheringSpots)=='function' then
        now=type(now)=='number' and now or 0
        if cacheMap~=mapId or now-cacheAt>20 or now<cacheAt then
            local ok,rows=pcall(BackstageForeverGatheringSpots,mapId)
            cache,cacheMap,cacheAt=ok and type(rows)=='table' and rows or {},mapId,now
        end
        for _,r in ipairs(cache) do
            out[#out+1]={x=r.x,y=r.y,layer='node',title=r.name,detail=T('A spot you gathered before. Not a live node.'),icon=NODE_ICON[r.method]}
        end
    end
    if active and active.loop.mapId==mapId then
        local s=active.loop.stops[active.state.index]
        if s then out[#out+1]={x=s.x,y=s.y,layer='loop',title=T('Next loop stop'),detail=BackstageForeverLoopLine(active.loop,active.state.index),icon=LOOP_ICON} end
    end
    return out
end

if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        pcall(frame.RegisterEvent,frame,'PLAYER_LOGOUT')
        pcall(frame.SetScript,frame,'OnEvent',function() stop(true) end)
    end
end

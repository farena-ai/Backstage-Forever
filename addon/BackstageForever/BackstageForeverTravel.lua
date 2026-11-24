-- Travel and trainer facts in chat: /bf fly PLACE prints the best flight route from the nearest
-- flight point you know (legs, time, price); /bf train lists what your class trainer newly
-- teaches at your level, with prices. Text only: nothing here moves, flies or buys for you.
-- Data: BackstageForeverTravelData (Efficient Games, CC BY 4.0), what players saw.
local floor=math.floor
local unpackAll=unpack or table.unpack
local function T(s) return (BackstageForeverTr or tostring)(s) end
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,8 do r[i]=plain(r[i]) end
    return unpackAll(r,2,8)
end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(tostring(m))) end end
local function money(copper) return (BackstageForeverMoney or tostring)(copper) end
local function fold(s) return (tostring(s or ''):lower():gsub("[%p]",' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')) end
local RUN_SPEED,TYPICAL_FLIGHT=7,180

-- Pure: minutes and seconds, short. 75 -> "1 min 15 s", 40 -> "40 s".
function BackstageForeverTravelTime(seconds)
    seconds=floor((tonumber(seconds) or 0)+.5)
    if seconds<60 then return seconds..' '..T('s') end
    local m,s=floor(seconds/60),seconds%60
    if m>=60 then return ('%d %s %02d %s'):format(floor(m/60),T('h'),m%60,T('min')) end
    if s==0 then return m..' '..T('min') end
    return ('%d %s %02d %s'):format(m,T('min'),s,T('s'))
end
-- Pure: a zone map position (0..1) in world yards -> wx, wy, continent; nil when the map is not covered.
function BackstageForeverFlyWorld(data,mapId,x,y)
    local m=type(data)=='table' and type(data.flights)=='table' and data.flights.maps[mapId]
    if not m or type(x)~='number' or type(y)~='number' then return nil end
    return m.y0+(m.y1-m.y0)*y, m.x0+(m.x1-m.x0)*x, m.i
end
-- Pure: flight points this character may use. known = {[nodeId]=true} from the flight maps the
-- player opened; without it every point not owned by the other faction, marked as assumed.
function BackstageForeverFlyAllowed(data,known,side)
    local allowed,count={},0
    for id in pairs(type(known)=='table' and known or {}) do if data.flights.nodes[id] then allowed[id]=true;count=count+1 end end
    if count>0 then return allowed,false end
    local other=side=='A' and 'H' or side=='H' and 'A' or nil
    for id,n in pairs(data.flights.nodes) do if not (other and n.f and n.s==other) then allowed[id]=true end end
    return allowed,true
end
local function edgeOf(data,from,to)
    local e=data.flights.edges[from] and data.flights.edges[from][to]
    if not e then return nil end
    local seconds,timing=e[1],'seen'
    if seconds==0 then
        local a,b=data.flights.nodes[from],data.flights.nodes[to]
        if data.speed and a and b and a.wx and b.wx and a.i==b.i then
            seconds=math.max(20,floor(((a.wx-b.wx)^2+(a.wy-b.wy)^2)^.5/data.speed+.5));timing='estimated'
        else seconds=TYPICAL_FLIGHT;timing='unknown' end
    end
    return {from=from,to=to,seconds=seconds,timing=timing,cost=e[2]>=0 and e[2] or nil,worked=e[3]==1}
end
local function summarize(data,hops,seen)
    local r={hops=hops,legs={},seconds=0,estimated=0,unknown=0,cost=0,worked=false}
    for i=1,#hops-1 do
        local leg=edgeOf(data,hops[i],hops[i+1])
        if not leg then return nil end
        r.legs[#r.legs+1]=leg
        r.seconds=r.seconds+leg.seconds
        if leg.timing=='estimated' then r.estimated=r.estimated+1 elseif leg.timing=='unknown' then r.unknown=r.unknown+1 end
        if leg.cost and r.cost then r.cost=r.cost+leg.cost else r.cost=nil end
        if leg.worked then r.worked=true end
    end
    -- A whole flight a player timed beats the sum of its hops: the bird does not land in between.
    if seen and seen.s>0 then r.seconds=seen.s;r.estimated=0;r.unknown=0;r.whole=true end
    if seen and seen.c>=0 then r.cost=seen.c end
    return r
end
-- Pure: the best flight from one flight point to another through allowed points only.
-- The game's own route as players saw it wins; otherwise the shortest by seconds (Dijkstra).
function BackstageForeverFlyRoute(data,from,to,allowed)
    local f=type(data)=='table' and data.flights
    if type(f)~='table' or from==to or not f.nodes[from] or not f.nodes[to] then return nil end
    local function ok(id) return not allowed or allowed[id]==true end
    if not ok(from) or not ok(to) then return nil end
    if f.edges[from] and f.edges[from][to] then return summarize(data,{from,to}) end
    local seen=f.routes[from..'>'..to]
    if seen then
        local all=true
        for _,h in ipairs(seen.h) do if not ok(h) then all=false end end
        if all then return summarize(data,seen.h,seen) end
    end
    local best,prev,done={[from]=0},{},{}
    while true do
        local at,d
        for id,v in pairs(best) do if not done[id] and (not d or v<d or (v==d and id<at)) then at,d=id,v end end
        if not at then return nil end
        if at==to then break end
        done[at]=true
        for nextId in pairs(f.edges[at] or {}) do
            if ok(nextId) and not done[nextId] then
                local leg=edgeOf(data,at,nextId)
                local v=d+leg.seconds
                if not best[nextId] or v<best[nextId] then best[nextId]=v;prev[nextId]=at end
            end
        end
    end
    local hops={to}
    while hops[1]~=from do table.insert(hops,1,prev[hops[1]]) end
    return summarize(data,hops)
end
-- Pure: the allowed flight point nearest to a world position on the same continent -> id, yards.
function BackstageForeverFlyNearest(data,wx,wy,instance,allowed)
    local best,bestD
    for id,n in pairs(data.flights.nodes) do
        if (not allowed or allowed[id]) and n.wx and n.i==instance then
            local d=((n.wx-wx)^2+(n.wy-wy)^2)^.5
            if not bestD or d<bestD or (d==bestD and id<best) then best,bestD=id,d end
        end
    end
    return best,bestD
end
-- Pure: what to call a flight point. names = {[nodeId]=the game's own name}, zoneName(mapId) -> text.
function BackstageForeverFlyLabel(data,id,names,zoneName)
    local own=type(names)=='table' and names[id]
    if type(own)=='string' and own~='' then return own end
    local n=data.flights.nodes[id] or {}
    local zone=n.m and type(zoneName)=='function' and zoneName(n.m) or nil
    if zone and n.n then return zone..' ('..n.n..')' end
    if zone then return zone end
    if n.n then return T('Flight master')..' '..n.n end
    return T('Flight point')..' '..tostring(id)
end
-- Pure: flight points whose name, zone or flight master contains every word of the query.
-- Exact name matches first, then names that start with it, then the rest; ids ascending.
function BackstageForeverFlyFind(data,query,names,zoneName)
    local q=fold(query)
    if q=='' then return {} end
    local out={}
    for id,n in pairs(data.flights.nodes) do
        local own=fold(type(names)=='table' and names[id] or '')
        local hay=own..' '..fold(n.m and type(zoneName)=='function' and zoneName(n.m) or '')..' '..fold(n.n or '')
        local all=true
        for word in q:gmatch('%S+') do if not hay:find(word,1,true) then all=false end end
        if all then out[#out+1]={id=id,rank=(own==q and 0) or (own:sub(1,#q)==q and 1) or 2} end
    end
    table.sort(out,function(a,b) if a.rank~=b.rank then return a.rank<b.rank end return a.id<b.id end)
    local ids={}
    for i,r in ipairs(out) do ids[i]=r.id end
    return ids
end
-- Pure: the chat lines for a route. label(id) names a flight point.
function BackstageForeverFlyLines(route,label,assumed,walkYards)
    local lines={}
    local first=route.legs[1].from
    local last=route.legs[#route.legs].to
    lines[1]=('%s %s %s %s: %s%s, %s.'):format(T('Fly from'),label(first),T('to'),label(last),
        (route.estimated+route.unknown>0) and (T('about')..' ') or '',BackstageForeverTravelTime(route.seconds),
        route.cost and ((route.worked and (T('about')..' ') or '')..money(route.cost)) or T('price not recorded'))
    if walkYards and walkYards>40 then lines[#lines+1]=('%s %s: %s %d %s (%s %s).'):format(T('First go to the flight master at'),label(first),T('about'),floor(walkYards+.5),T('yards in a straight line'),T('about'),BackstageForeverTravelTime(walkYards/RUN_SPEED)) end
    if #route.legs>1 then
        for i,leg in ipairs(route.legs) do
            local time=leg.timing=='seen' and BackstageForeverTravelTime(leg.seconds) or leg.timing=='estimated' and (T('about')..' '..BackstageForeverTravelTime(leg.seconds)..' ('..T('estimated from the distance')..')') or T('time not recorded')
            lines[#lines+1]=('%d. %s - %s: %s%s'):format(i,label(leg.from),label(leg.to),time,leg.cost and (', '..money(leg.cost)) or '')
        end
        if route.whole then lines[#lines+1]=T('It is one flight: the bird does not land in between.') end
    end
    if route.unknown>0 then lines[#lines+1]=T('Some legs have no recorded time; a typical flight time stands in for them.') end
    if assumed then lines[#lines+1]=T('This assumes you know these flight points. Open a flight map once and the addon remembers which ones you have.') end
    return lines
end

-- Boats, zeppelins and airships (B2). Upstream names them but not where they stop; the desktop
-- works the stops out from the player's own game files and hands them over in
-- BackstageForeverDesktopData.ships[side]: {k=kind,n=name,s={{label,continent,wx,wy},...},r={{from,to,seconds},...}}.
-- Pure: the clean ships for a side ('H' or 'A'). Anything damaged is skipped.
function BackstageForeverFlyShips(desktop,side)
    local out={}
    local all=type(desktop)=='table' and rawget(desktop,'ships')
    local list=type(all)=='table' and (side=='H' or side=='A') and rawget(all,side)
    if type(list)~='table' then return out end
    for i=1,math.min(#list,24) do
        local t=list[i]
        if type(t)=='table' and (t.k=='z' or t.k=='b' or t.k=='a') and type(t.s)=='table' and type(t.r)=='table' and #t.s>=2 and #t.s<=6 then
            local stops,ok={},true
            for j=1,#t.s do
                local s=t.s[j]
                if type(s)=='table' and type(s[1])=='string' and s[1]~='' and #s[1]<=60 and type(s[2])=='number' and type(s[3])=='number' and type(s[4])=='number' then
                    stops[j]={l=(s[1]:gsub('|','||')),i=s[2],wx=s[3],wy=s[4]}
                else ok=false end
            end
            local rides={}
            for j=1,ok and math.min(#t.r,30) or 0 do
                local r=t.r[j]
                if type(r)=='table' and stops[r[1]] and stops[r[2]] and r[1]~=r[2] and type(r[3])=='number' and r[3]>0 and r[3]<=36000 then rides[#rides+1]={from=r[1],to=r[2],seconds=r[3]} end
            end
            if ok and #rides>0 then out[#out+1]={kind=t.k,name=type(t.n)=='string' and t.n~='' and #t.n<=60 and (t.n:gsub('|','||')) or nil,stops=stops,rides=rides} end
        end
    end
    return out
end
-- Pure: the fastest way from one flight point to one on another continent with exactly one ride:
-- fly to the flight point beside a stop, ride, fly on. nil when no ride joins the two continents.
function BackstageForeverFlyCrossing(data,ships,start,dest,allowed)
    local nodes=type(data)=='table' and type(data.flights)=='table' and data.flights.nodes
    local a,b=nodes and nodes[start],nodes and nodes[dest]
    if not a or not b or not a.i or not b.i or a.i==b.i then return nil end
    local best
    for _,ship in ipairs(type(ships)=='table' and ships or {}) do
        for _,r in ipairs(ship.rides) do
            local from,to=ship.stops[r.from],ship.stops[r.to]
            if from.i==a.i and to.i==b.i then
                local near,nearYards=BackstageForeverFlyNearest(data,from.wx,from.wy,from.i,allowed)
                local far,farYards=BackstageForeverFlyNearest(data,to.wx,to.wy,to.i,allowed)
                if near and far then
                    local before=near~=start and BackstageForeverFlyRoute(data,start,near,allowed) or nil
                    local after=far~=dest and BackstageForeverFlyRoute(data,far,dest,allowed) or nil
                    if (near==start or before) and (far==dest or after) then
                        local seconds=(before and before.seconds or 0)+nearYards/RUN_SPEED+r.seconds+farYards/RUN_SPEED+(after and after.seconds or 0)
                        if not best or seconds<best.seconds then
                            best={seconds=seconds,start=start,dest=dest,ship=ship,ride=r,from=from,to=to,near=near,nearYards=nearYards,far=far,farYards=farYards,before=before,after=after}
                        end
                    end
                end
            end
        end
    end
    return best
end
-- Whole phrases, so each language can use its own article.
local SHIP_RIDE={z='Ride the zeppelin',b='Ride the boat',a='Ride the airship'}
-- Pure: the chat lines for a crossing. label(id) names a flight point.
function BackstageForeverFlyCrossingLines(c,label,assumed,walkYards)
    local lines={}
    lines[1]=('%s %s: %s %s, %s.'):format(T('To'),label(c.dest),T('about'),BackstageForeverTravelTime(c.seconds),T('plus the wait'))
    if c.before then for _,line in ipairs(BackstageForeverFlyLines(c.before,label,false,walkYards)) do lines[#lines+1]=line end end
    lines[#lines+1]=('%s %s: %s %d %s %s.'):format(T('Go to the'),c.from.l,T('about'),floor(c.nearYards+.5),T('yards from the flight master at'),label(c.near))
    lines[#lines+1]=('%s %s %s %s %s: %s %s, %s.'):format(T(SHIP_RIDE[c.ship.kind] or SHIP_RIDE.b),T('from'),c.from.l,T('to'),c.to.l,T('about'),BackstageForeverTravelTime(c.ride.seconds),T('plus the wait'))
    if c.after then
        lines[#lines+1]=('%s %s: %s %d %s %s.'):format(T('Then go to the flight master at'),label(c.far),T('about'),floor(c.farYards+.5),T('yards from the'),c.to.l)
        for _,line in ipairs(BackstageForeverFlyLines(c.after,label,false,nil)) do lines[#lines+1]=line end
    else
        lines[#lines+1]=('%s %s %s %d %s %s.'):format(label(c.dest),T('is'),T('about'),floor(c.farYards+.5),T('yards from the'),c.to.l)
    end
    lines[#lines+1]=T('The stops and the ride time were worked out from your game files by the desktop app. Nobody can know the wait.')
    if assumed then lines[#lines+1]=T('This assumes you know these flight points. Open a flight map once and the addon remembers which ones you have.') end
    return lines
end

-- Pure: what a class trainer newly teaches at exactly this level, with the total.
-- isKnown(spellId) -> true drops a skill the player already has. side 'A'/'H' hides the other
-- faction's teleports and portals. Also reports the next level that has something new.
local CITY_SIDE={Orgrimmar='H',Undercity='H',['Thunder Bluff']='H',Stormwind='A',Ironforge='A',Darnassus='A'}
function BackstageForeverTrainNew(data,className,level,isKnown,side)
    local rows=type(data)=='table' and type(data.train)=='table' and data.train[className]
    if type(rows)~='table' or type(level)~='number' then return nil end
    local out={rows={},total=0,unpriced=0,nextLevel=nil,nextCount=0,nextTotal=0}
    local function mine(r)
        if r[6]=='p' then
            local city=tostring(r[4]):match(': (.+)$')
            if side and city and CITY_SIDE[city] and CITY_SIDE[city]~=side then return false end
        end
        return true
    end
    for _,r in ipairs(rows) do
        if mine(r) then
            if r[2]==level then
                if not (type(isKnown)=='function' and isKnown(r[1])==true) then
                    out.rows[#out.rows+1]={id=r[1],name=r[4],rank=r[5]~='' and r[5] or nil,cost=r[3]>=0 and r[3] or nil,kind=r[6]}
                    if r[3]>=0 then out.total=out.total+r[3] else out.unpriced=out.unpriced+1 end
                end
            elseif r[2]>level and (not out.nextLevel or r[2]<=out.nextLevel) then
                if r[2]~=out.nextLevel then out.nextLevel=r[2];out.nextCount=0;out.nextTotal=0 end
                out.nextCount=out.nextCount+1
                if r[3]>=0 then out.nextTotal=out.nextTotal+r[3] end
            end
        end
    end
    return out
end
-- Pure: the chat lines for /bf train. have = copper in the bags, or nil.
function BackstageForeverTrainLines(result,className,level,have)
    if not result then return {T('No trainer costs are recorded for your class yet.')} end
    local lines={}
    if #result.rows==0 then
        lines[1]=('%s %d.'):format(T('Nothing new is recorded at your trainer for level'),level)
    else
        lines[1]=('%s %d (%d):'):format(T('New at your trainer at level'),level,#result.rows)
        for _,r in ipairs(result.rows) do
            lines[#lines+1]=('  %s%s%s: %s'):format(r.name,r.rank and (' ('..r.rank..')') or '',r.kind=='p' and (' ['..T('portal trainer')..']') or r.kind=='t' and (' ['..T('pet trainer')..']') or '',r.cost and money(r.cost) or T('price not recorded'))
        end
        lines[#lines+1]=('%s: %s%s%s'):format(T('Total'),money(result.total),result.unpriced>0 and (' + '..result.unpriced..' '..T('without a recorded price')) or '',have and ('. '..T('You have')..' '..money(have)..'.') or '.')
    end
    if result.nextLevel then lines[#lines+1]=('%s %d: %d %s, %s.'):format(T('Next new skills at level'),result.nextLevel,result.nextCount,T('skills'),money(result.nextTotal)) end
    lines[#lines+1]=T('Full price, as players saw it. Talent ranks only count if you have the talent.')
    return lines
end

local function dataReady()
    local data=BackstageForeverTravelData
    if type(data)~='table' or type(data.flights)~='table' then return nil end
    -- Same-patch rule: data from another patch is refused.
    local usable=BackstageForeverBuildUsable
    if type(usable)=='function' and type(GetBuildInfo)=='function' then
        local version,number=call(GetBuildInfo)
        if type(version)=='string' and number and usable(data.build,version..'.'..tostring(number))==false then return nil,'patch' end
    end
    return data
end
local function saved() return type(BackstageForeverAssistSettings)=='table' and BackstageForeverAssistSettings or {} end
local function zoneName(mapId)
    local info=type(C_Map)=='table' and call(C_Map.GetMapInfo,mapId)
    local name=type(info)=='table' and plain(info.name)
    return type(name)=='string' and name or nil
end
local function playerSide()
    local faction=call(UnitFactionGroup,'player')
    return faction=='Horde' and 'H' or faction=='Alliance' and 'A' or nil
end
local function playerWorld(data)
    local mapApi=type(C_Map)=='table' and C_Map or nil
    local map=mapApi and tonumber(call(mapApi.GetBestMapForUnit,'player') or nil)
    if not map then return nil end
    local pos=call(mapApi.GetPlayerMapPosition,map,'player')
    local x,y
    if type(pos)=='table' and type(pos.GetXY)=='function' then x,y=call(pos.GetXY,pos) end
    if type(x)~='number' or type(y)~='number' then return nil end
    return BackstageForeverFlyWorld(data,map,x,y)
end
function BackstageForeverFlyCommand(message)
    local place=type(message)=='string' and message:match('^%s*%a+%s+(.-)%s*$') or ''
    local data,why=dataReady()
    if not data then return say(why=='patch' and T('The flight data is for another game patch. Update Backstage Forever.') or T('The flight data is not loaded.')) end
    if place=='' then return say(T('Type /bf fly and a place, for example /bf fly Orgrimmar. It prints the best flight route from the flight point nearest to you.')) end
    local s=saved()
    local names=type(s.flightNames)=='table' and s.flightNames or {}
    local allowed,assumed=BackstageForeverFlyAllowed(data,s.flightNodes,playerSide())
    local label=function(id) return BackstageForeverFlyLabel(data,id,names,zoneName) end
    local matches=BackstageForeverFlyFind(data,place,names,zoneName)
    if #matches==0 then
        return say(('%s "%s". %s'):format(T('No flight point matches'),place,next(names)==nil and T('The addon learns the real flight point names when you open a flight map; until then use a zone or a flight master name.') or T('Try a zone, a town or a flight master name.')))
    end
    local wx,wy,instance=playerWorld(data)
    if not wx then return say(T('Your position is not known here (inside a building or an instance). Step outside and try again.')) end
    local start,yards=BackstageForeverFlyNearest(data,wx,wy,instance,allowed)
    if not start then return say(T('No flight point you can use is recorded on this continent.')) end
    local best,blocked,here
    for _,id in ipairs(matches) do
        if id~=start then
            local route=allowed[id] and BackstageForeverFlyRoute(data,start,id,allowed)
            if route and (not best or route.seconds<best.seconds) then best=route end
            if not route then blocked=blocked or id end
        else here=id end
    end
    if not best then
        -- B2: a place across the sea, with one boat or zeppelin ride the desktop handed over.
        local overseas=false
        for _,id in ipairs(matches) do local n=data.flights.nodes[id] if n and n.i and n.i~=instance then overseas=true end end
        if overseas and not here then
            local ships=BackstageForeverFlyShips(BackstageForeverDesktopData,playerSide())
            local crossing
            for _,id in ipairs(matches) do
                if allowed[id] then
                    local c=BackstageForeverFlyCrossing(data,ships,start,id,allowed)
                    if c and (not crossing or c.seconds<crossing.seconds) then crossing=c end
                end
            end
            if crossing then
                for _,line in ipairs(BackstageForeverFlyCrossingLines(crossing,label,assumed,yards)) do say(line) end
                return crossing
            end
            if #ships==0 then return say(T('That place is on another continent. The desktop app works out where boats and zeppelins stop from your game files: open it with your game folder connected, then type /reload.')) end
        end
        if here then return say(('%s %s.'):format(T('You are already at the flight point'),label(here))) end
        if blocked and not allowed[blocked] then return say(('%s %s. %s'):format(T('You have not learned the flight point'),label(blocked),T('Go there once and talk to the flight master.'))) end
        return say(('%s %s %s %s.'):format(T('No recorded flight connects'),label(start),T('to'),label(matches[1])))
    end
    for _,line in ipairs(BackstageForeverFlyLines(best,label,assumed,yards)) do say(line) end
    return best
end
function BackstageForeverTrainList()
    local data=dataReady()
    if not data then return nil end
    local _,token=call(UnitClass,'player')
    local level=tonumber(call(UnitLevel,'player') or nil)
    if type(token)~='string' or not level then return nil end
    local className=token:sub(1,1):upper()..token:sub(2):lower()
    local known=type(IsSpellKnown)=='function' and function(id) return call(IsSpellKnown,id)==true end or nil
    local result=BackstageForeverTrainNew(data,className,level,known,playerSide())
    local have=tonumber(call(GetMoney) or nil)
    for _,line in ipairs(BackstageForeverTrainLines(result,className,level,have)) do say(line) end
    return result
end

-- Saved for the desktop planner: flight points (with the game's names), where the Hearthstone
-- goes and when it is ready. Read from the flight maps the player opened; nothing is scanned.
function BackstageForeverTravelSnapshot()
    local s=saved()
    local now=tonumber(call(time) or nil)
    if not now then return nil end
    local out={seenAt=floor(now),nodes={}}
    local names=type(s.flightNames)=='table' and s.flightNames or {}
    local known=type(s.flightNodes)=='table' and s.flightNodes or {}
    local ids,seen={},{}
    for id in pairs(names) do if type(id)=='number' and not seen[id] then seen[id]=true;ids[#ids+1]=id end end
    for id in pairs(known) do if type(id)=='number' and not seen[id] then seen[id]=true;ids[#ids+1]=id end end
    table.sort(ids)
    for i,id in ipairs(ids) do
        if i>400 then break end
        local name=type(names[id])=='string' and names[id]:sub(1,80) or nil
        out.nodes[#out.nodes+1]={id=id,name=name~='' and name or nil,known=known[id]==true}
    end
    local bind=call(GetBindLocation)
    if type(bind)=='string' and bind~='' then
        out.bind={name=bind:sub(1,80)}
        local b=type(s.bind)=='table' and s.bind or nil
        if b and b.name==bind and type(b.m)=='number' and type(b.x)=='number' and type(b.y)=='number' then out.bind.mapId=b.m;out.bind.x=b.x;out.bind.y=b.y end
    end
    local getCooldown=type(C_Container)=='table' and C_Container.GetItemCooldown or GetItemCooldown
    local start,duration=call(getCooldown,6948)
    local clock=tonumber(call(GetTime) or nil)
    if type(start)=='number' and type(duration)=='number' and clock then
        out.hearthReadyAt=floor(now+math.max(0,start+duration-clock))
    end
    return out
end
-- The inn's spot is remembered at the moment the Hearthstone is set there.
local function rememberBind()
    local s=saved()
    local bind=call(GetBindLocation)
    local mapApi=type(C_Map)=='table' and C_Map or nil
    local map=mapApi and tonumber(call(mapApi.GetBestMapForUnit,'player') or nil)
    local pos=map and call(mapApi.GetPlayerMapPosition,map,'player')
    local x,y
    if type(pos)=='table' and type(pos.GetXY)=='function' then x,y=call(pos.GetXY,pos) end
    if type(bind)~='string' or not map or type(x)~='number' or type(y)~='number' or s~=BackstageForeverAssistSettings then return end
    s.bind={name=bind:sub(1,80),m=map,x=floor(x*1e4)/1e4,y=floor(y*1e4)/1e4}
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        pcall(events.RegisterEvent,events,'HEARTHSTONE_BOUND')
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Travel',events) end
        pcall(events.SetScript,events,'OnEvent',function() pcall(rememberBind) end)
    end
end

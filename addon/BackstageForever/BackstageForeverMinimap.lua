-- Quest pins on the minimap (1.19): the BF Guide pins that are near you. Quests you can pick up,
-- hand-ins, your class trainer, profession trainers and flight masters, with the same icons as
-- the world map. A hand-in outside the minimap sits on its edge, in the direction to walk.
-- Display only: nothing is clicked, tracked or set for you. Hidden in combat.
local H=BackstageForeverPublicFacts
local public,field,number=H.public,H.field,H.number
local MAX_PINS=24
local REFRESH,MOVE=20,.2
-- Minimap diameter in yards at each zoom step, outdoors and indoors.
local OUTDOOR={[0]=466.67,[1]=400,[2]=333.33,[3]=266.67,[4]=200,[5]=133.33}
local INDOOR={[0]=300,[1]=240,[2]=180,[3]=120,[4]=80,[5]=50}

local function call(fn,...)
    if type(fn)~='function' then return nil end
    local result=table.pack(pcall(fn,...))
    if not result[1] then return nil end
    for i=2,result.n do
        if type(issecretvalue)=='function' then
            local readable,secret=pcall(issecretvalue,result[i])
            if not readable or secret then return nil end
        end
    end
    return table.unpack(result,2,result.n)
end
local function method(o,k,...) if o and type(o[k])=='function' then return call(o[k],o,...) end end
local function finite(v) return type(v)=='number' and v==v and v>-1e7 and v<1e7 end

-- Pure: where a spot belongs on a round minimap.
-- east/south: yards from you (map x grows east, map y grows south). facing: radians, 0 = north,
-- counter-clockwise; used only when the minimap rotates. yards: minimap radius in yards.
-- pixels: minimap radius on screen. Returns x, y in pixels from the centre and whether it is on the edge.
function BackstageForeverMinimapOffset(east,south,facing,rotates,yards,pixels)
    if not (finite(east) and finite(south) and finite(yards) and finite(pixels)) or yards<=0 or pixels<=0 then return nil end
    local x,y=east,-south
    if rotates and finite(facing) then
        local sin,cos=math.sin(facing),math.cos(facing)
        x,y=x*cos+y*sin,-x*sin+y*cos
    end
    local distance=math.sqrt(x*x+y*y)
    local edge=distance>yards
    if edge then x,y=x/distance*yards,y/distance*yards end
    local scale=pixels/yards
    return x*scale,y*scale,edge,distance
end
-- Pure: at most `limit` pins, nearest first; far ones are kept only when they are hand-ins.
function BackstageForeverMinimapChoose(rows,limit)
    local near,out={},{}
    for _,row in ipairs(rows) do
        if row.edge~=true or row.layer=='handin' then near[#near+1]=row end
    end
    table.sort(near,function(a,b)
        if (a.layer=='handin')~=(b.layer=='handin') then return a.layer=='handin' end
        return a.distance<b.distance
    end)
    for i=1,math.min(limit,#near) do out[i]=near[i] end
    return out
end

local settings,holder,pins,points,pointsMap,pointsAt,stale=nil,nil,{},{},nil,0,false
local function loadSettings()
    local saved=public(BackstageForeverMinimapSettings)
    settings={enabled=field(saved,'enabled')~=false}
    BackstageForeverMinimapSettings=settings
end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
local function hideAll() for _,pin in ipairs(pins) do method(pin,'Hide') end end
-- Size of one map in yards, from the game's own conversion of its corners.
local sizes={}
local function mapSize(mapId)
    if sizes[mapId]~=nil then return sizes[mapId] or nil end
    local api=public(C_Map)
    local make=type(CreateVector2D)=='function' and CreateVector2D
    local size=false
    if api and make then
        local _,a=call(field(api,'GetWorldPosFromMapPos'),mapId,make(0,0))
        local _,b=call(field(api,'GetWorldPosFromMapPos'),mapId,make(1,1))
        local ax,ay=method(a,'GetXY') local bx,by=method(b,'GetXY')
        -- World x runs north-south and world y runs east-west.
        if finite(ax) and finite(ay) and finite(bx) and finite(by) and ax~=bx and ay~=by then
            size={width=math.abs(ay-by),height=math.abs(ax-bx)}
        end
    end
    sizes[mapId]=size
    return size or nil
end
local function pin(index)
    if pins[index] then return pins[index] end
    local frame=CreateFrame('Frame',nil,holder)
    frame:SetSize(14,14);frame:SetFrameLevel(6)
    frame.icon=frame:CreateTexture(nil,'OVERLAY');frame.icon:SetAllPoints(frame)
    frame:EnableMouse(true)
    frame:SetScript('OnEnter',function(self)
        local row=self.row if not row then return end
        method(GameTooltip,'SetOwner',self,'ANCHOR_LEFT')
        method(GameTooltip,'SetText',row.title or '',1,.82,.3)
        if row.detail then method(GameTooltip,'AddLine',row.detail,1,1,1,true) end
        if finite(row.distance) then method(GameTooltip,'AddLine',('%d '):format(math.floor(row.distance+.5))..(BackstageForeverTr or tostring)('yards away'),.8,.8,.8) end
        method(GameTooltip,'Show')
    end)
    frame:SetScript('OnLeave',function(self) if method(GameTooltip,'GetOwner')==self then method(GameTooltip,'Hide') end end)
    pins[index]=frame
    return frame
end
local function update(force)
    if not settings then loadSettings() end
    local minimap=public(Minimap)
    if not settings.enabled or not minimap or call(InCombatLockdown)~=false then hideAll() return end
    local api=public(C_Map)
    local mapId=number(call(field(api,'GetBestMapForUnit'),'player'),1,2147483647)
    local size=mapId and mapSize(mapId)
    local where=mapId and call(field(api,'GetPlayerMapPosition'),mapId,'player')
    local px,py=method(where,'GetXY')
    if not size or not finite(px) or not finite(py) then hideAll() return end
    local now=call(GetTime) or 0
    -- Quest events mark the list stale; it is rebuilt at most every two seconds.
    if force or mapId~=pointsMap or now-pointsAt>REFRESH or (stale and now-pointsAt>2) then
        stale=false
        local ok,rows=pcall(BackstageForeverAdvisorLive,mapId)
        points=ok and type(rows)=='table' and rows or {}
        pointsMap,pointsAt=mapId,now
    end
    local zoom=number(method(minimap,'GetZoom'),0,5) or 0
    local indoors=call(IsIndoors)==true
    local yards=((indoors and INDOOR or OUTDOOR)[zoom] or OUTDOOR[0])/2
    local pixels=(number(method(minimap,'GetWidth'),1,4000) or 140)/2
    local rotates=call(GetCVar,'rotateMinimap')=='1'
    local facing=rotates and call(GetPlayerFacing) or nil
    local rows={}
    for _,point in ipairs(points) do
        if finite(point.x) and finite(point.y) and point.layer~='gather' then
            local x,y,edge,distance=BackstageForeverMinimapOffset((point.x-px)*size.width,(point.y-py)*size.height,facing,rotates,yards,pixels)
            if x then rows[#rows+1]={x=x,y=y,edge=edge,distance=distance,layer=point.layer,title=point.title,detail=point.detail} end
        end
    end
    local chosen=BackstageForeverMinimapChoose(rows,MAX_PINS)
    local icons=public(BackstageForeverAdvisorIcons) or {}
    for i,row in ipairs(chosen) do
        local frame=pin(i)
        frame.row=row
        frame.icon:SetTexture(icons[row.layer])
        local shown=row.edge and 11 or (row.layer=='handin' and 16 or 13)
        frame:SetSize(shown,shown);frame.icon:SetAlpha(row.edge and .75 or 1)
        frame:ClearAllPoints();frame:SetPoint('CENTER',minimap,'CENTER',row.x,row.y)
        frame:Show()
    end
    for i=#chosen+1,#pins do pins[i].row=nil;pins[i]:Hide() end
end

function BackstageForeverMinimapCommand(message)
    if not settings then loadSettings() end
    local arg=(type(message)=='string' and message:lower() or ''):match('^%a+%s*(%a*)') or ''
    if arg=='on' then settings.enabled=true elseif arg=='off' then settings.enabled=false else settings.enabled=not settings.enabled end
    pcall(update,true)
    say(settings.enabled and 'Minimap pins on: nearby quests to pick up, hand-ins, trainers and flight masters. A hand-in further away sits on the edge.' or 'Minimap pins off.')
    return settings.enabled
end

if type(CreateFrame)=='function' and public(Minimap) then
    holder=CreateFrame('Frame',nil,Minimap)
    holder:SetAllPoints(Minimap)
    local elapsed=0
    holder:SetScript('OnUpdate',function(_,dt)
        elapsed=elapsed+(tonumber(dt) or 0)
        if elapsed<MOVE then return end
        elapsed=0
        pcall(update,false)
    end)
    for _,event in ipairs({'PLAYER_LOGIN','QUEST_ACCEPTED','QUEST_TURNED_IN','QUEST_LOG_UPDATE','PLAYER_LEVEL_UP','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'}) do holder:RegisterEvent(event) end
    holder:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_LOGIN' then loadSettings() end
        if event=='PLAYER_REGEN_DISABLED' then hideAll() return end
        stale=true
    end)
end

-- /bf available (1.19): the quests you can pick up on the map you are on, nearest first.
-- Pure: a compass word for a direction (east and south in yards).
function BackstageForeverCompassWord(east,south)
    if not (finite(east) and finite(south)) or (east==0 and south==0) then return nil end
    local angle=math.atan(east,-south)
    local index=math.floor((angle/(math.pi/4))+.5)%8
    return ({[0]='north','north-east','east','south-east','south','south-west','west','north-west'})[index]
end
-- Pure: chat lines for a list of {title,detail,east,south}; at most `limit` quests are named.
function BackstageForeverAvailableLines(rows,limit)
    local T=BackstageForeverTr or tostring
    if #rows==0 then return {T('No quests to pick up on this map for your level. Try /bf next, or open the map for BF Guide.')} end
    table.sort(rows,function(a,b) return a.distance<b.distance end)
    local lines={(#rows==1 and T('1 quest you can pick up on this map:') or (#rows..' '..T('quests you can pick up on this map:')))}
    for i=1,math.min(limit or 8,#rows) do
        local row=rows[i]
        local way=BackstageForeverCompassWord(row.east,row.south)
        lines[#lines+1]=('%s, %s: %d %s%s'):format(row.detail or '',row.title or '',math.floor(row.distance+.5),T('yards'),way and (' '..T(way)) or '')
    end
    if #rows>(limit or 8) then lines[#lines+1]=('+%d '):format(#rows-(limit or 8))..T('more on the map (BF Guide).') end
    return lines
end
function BackstageForeverAvailableCommand()
    local api=public(C_Map)
    local mapId=number(call(field(api,'GetBestMapForUnit'),'player'),1,2147483647)
    local size=mapId and mapSize(mapId)
    local where=mapId and call(field(api,'GetPlayerMapPosition'),mapId,'player')
    local px,py=method(where,'GetXY')
    if not size or not finite(px) or not finite(py) then say('Your place on the map is not known here; try again outside.') return end
    local ok,points=pcall(BackstageForeverAdvisorLive,mapId)
    local rows={}
    for _,point in ipairs(ok and type(points)=='table' and points or {}) do
        if point.layer=='pickup' and finite(point.x) and finite(point.y) then
            local east,south=(point.x-px)*size.width,(point.y-py)*size.height
            rows[#rows+1]={title=point.title,detail=point.detail,east=east,south=south,distance=math.sqrt(east*east+south*south)}
        end
    end
    for _,line in ipairs(BackstageForeverAvailableLines(rows,8)) do
        if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(line)) end
    end
end

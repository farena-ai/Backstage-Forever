-- Backstage Forever live link: an opt-in, display-only status strip.
-- The addon draws a tiny calibrated colour strip in the top-left corner of the game
-- window. The desktop app may read those pixels to know where you are right now.
-- Nothing is sent anywhere by the addon; no input, automation or protected values.
-- The strip freezes (combat flag only) while in combat. Toggle with /bf live.
local CELL = 4                      -- physical pixels per cell edge
local LEVELS = {0, 85, 170, 255}    -- four robust levels per colour channel
local MARKERS = {{255, 0, 255}, {0, 255, 0}, {85, 85, 85}, {170, 170, 170}}
local PAYLOAD_BYTES = 27
local PAYLOAD_CELLS = 36            -- 27 bytes * 8 bits / 6 bits per cell
local VERSION = 2

local function public(value) if type(value)=='function' or type(value)=='table' then return value end end
local unpackAll=unpack or table.unpack
-- Newer clients return protected "secret" values for some unit data; treat them as unknown.
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn, ...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,10 do r[i]=plain(r[i]) end
    return unpackAll(r,2,10)
end
local function field(t,k) if type(t)=='table' then return t[k] end end
local floor = math.floor
local function clampByte(v) v=tonumber(v) or 0 if v~=v then v=0 end v=floor(v) if v<0 then return 0 elseif v>255 then return 255 end return v end

local function xor8(a,b)
    local r,bit=0,1
    for _=1,8 do
        local x,y=a%2,b%2
        if x~=y then r=r+bit end
        a,b,bit=floor(a/2),floor(b/2),bit*2
    end
    return r
end
local function crc8(bytes,n)
    local crc=0
    for i=1,n do
        crc=xor8(crc,bytes[i])
        for _=1,8 do
            if crc>=128 then crc=xor8((crc*2)%256,7) else crc=(crc*2)%256 end
        end
    end
    return crc
end
local function put16(bytes,i,v) v=floor(math.max(0,math.min(65535,tonumber(v) or 0))) bytes[i]=floor(v/256) bytes[i+1]=v%256 end
local function put24(bytes,i,v) v=floor(math.max(0,math.min(16777215,tonumber(v) or 0))) bytes[i]=floor(v/65536) bytes[i+1]=floor(v/256)%256 bytes[i+2]=v%256 end

-- Pure: character identity -> 16-bit hash (desktop mirrors this to bind frames to a profile).
function BackstageForeverLiveIdentity(guid)
    if type(guid)~='string' then return 0 end
    local h=0
    for i=1,math.min(#guid,200) do h=(h*31+guid:byte(i))%65521 end
    return h
end
-- Pure: state table -> 27 payload bytes (1-based array). See src/core/live-bridge.cjs.
function BackstageForeverLivePayload(s)
    s=type(s)=='table' and s or {}
    local b={}
    for i=1,PAYLOAD_BYTES do b[i]=0 end
    b[1]=VERSION
    b[2]=clampByte(s.seq or 0)
    local flags=0
    if s.combat then flags=flags+1 end
    if s.dead then flags=flags+2 end
    if s.resting then flags=flags+4 end
    if s.mounted then flags=flags+8 end
    if s.instance then flags=flags+16 end
    if s.afk then flags=flags+32 end
    local hasPos=type(s.mapId)=='number' and type(s.x)=='number' and type(s.y)=='number' and s.x>=0 and s.x<=1 and s.y>=0 and s.y<=1
    if hasPos then flags=flags+64 end
    local hasTarget=type(s.targetNpcId)=='number' and s.targetNpcId>0
    if hasTarget then flags=flags+128 end
    b[11]=flags
    if not s.combat then
        if hasPos then put16(b,3,s.mapId) put16(b,5,floor(s.x*65535+.5)) put16(b,7,floor(s.y*65535+.5)) end
        b[9]=clampByte(s.level or 0)
        b[10]=type(s.health)=='number' and clampByte(s.health) or 255
        if hasTarget then put24(b,12,s.targetNpcId) b[15]=type(s.targetHealth)=='number' and clampByte(s.targetHealth) or 255 end
        b[16]=type(s.xp)=='number' and clampByte(s.xp) or 255
        b[17]=type(s.freeSlots)=='number' and clampByte(s.freeSlots) or 255
        put24(b,18,s.questId or 0)
        b[21]=clampByte(s.objectives or 0)
        b[22]=clampByte(s.questHash or 0)
        b[23]=type(s.facing)=='number' and clampByte(floor((s.facing%(2*math.pi))/(2*math.pi)*256)%256) or 0
    else
        b[10],b[15],b[16],b[17]=255,255,255,255
    end
    put16(b,24,s.identity or 0)
    b[27]=crc8(b,26)
    return b
end
-- Pure: payload bytes -> list of {r,g,b} cells (markers first).
function BackstageForeverLiveCells(bytes)
    local cells={}
    for i,m in ipairs(MARKERS) do cells[i]={m[1],m[2],m[3]} end
    local bits={}
    for i=1,PAYLOAD_BYTES do
        local v=bytes[i]
        for k=7,0,-1 do local p=2^k bits[#bits+1]=floor(v/p)%2 end
    end
    for c=0,PAYLOAD_CELLS-1 do
        local rgb={}
        for ch=1,3 do
            local i=c*6+(ch-1)*2+1
            local level=(bits[i] or 0)*2+(bits[i+1] or 0)
            rgb[ch]=LEVELS[level+1]
        end
        cells[#cells+1]=rgb
    end
    return cells
end

-- Live game reads (public APIs only; anything unavailable stays unknown).
local seq=0
local lastQuest,lastHash=0,0
local function npcIdFromGuid(guid)
    if type(guid)~='string' then return nil end
    local parts={}
    for p in guid:gmatch('[^-]+') do parts[#parts+1]=p if #parts>8 then break end end
    local kind,id=parts[1],parts[6]
    if kind=='Creature' or kind=='Vehicle' then return tonumber(id) end
end
local function percent(cur,max) local ok,v=pcall(function() cur,max=tonumber(plain(cur)),tonumber(plain(max)) if cur and max and max>0 then return floor(cur/max*100+.5) end end) if ok then return v end end
local function quest()
    local api=public(C_QuestLog)
    local id
    local getWatch=field(api,'GetQuestIDForQuestWatchIndex')
    if type(getWatch)=='function' then id=call(getWatch,1) end
    local n=call(field(api,'GetNumQuestLogEntries')) or call(GetNumQuestLogEntries) or 0
    local hash,first=0,nil
    for i=1,math.min(tonumber(n) or 0,40) do
        local info=call(field(api,'GetInfo'),i)
        local qid=type(info)=='table' and not info.isHeader and tonumber(info.questID)
        if not qid and type(GetQuestLogTitle)=='function' then
            local _,_,_,header,_,_,_,legacyId=call(GetQuestLogTitle,i)
            if not header then qid=tonumber(legacyId) end
        end
        if qid then
            first=first or qid
            local done=call(field(api,'IsComplete'),qid) and 1 or 0
            hash=(hash*31+qid%251+done)%256
        end
    end
    id=tonumber(id) or first or 0
    local mask=0
    local objectives=id>0 and call(field(api,'GetQuestObjectives'),id)
    if type(objectives)=='table' then for i=1,math.min(#objectives,8) do if type(objectives[i])=='table' and objectives[i].finished then mask=mask+2^(i-1) end end end
    return id,mask,hash
end
local function freeSlots()
    local api=public(C_Container)
    local free=0
    for bag=0,4 do
        local n=call(field(api,'GetContainerNumFreeSlots'),bag)
        if type(n)~='number' then return nil end
        free=free+n
    end
    return free
end
function BackstageForeverLiveState()
    local s={combat=call(InCombatLockdown) and true or false}
    s.dead=call(UnitIsDeadOrGhost,'player') and true or false
    s.identity=BackstageForeverLiveIdentity(call(UnitGUID,'player'))
    if s.combat then return s end
    local mapApi=public(C_Map)
    local map=call(field(mapApi,'GetBestMapForUnit'),'player')
    if type(map)=='number' then
        local pos=call(field(mapApi,'GetPlayerMapPosition'),map,'player')
        local x,y
        if type(pos)=='table' and type(pos.GetXY)=='function' then x,y=call(pos.GetXY,pos) end
        if type(x)=='number' and type(y)=='number' and (x>0 or y>0) then s.mapId,s.x,s.y=map,x,y end
    end
    s.level=call(UnitLevel,'player')
    s.health=percent(call(UnitHealth,'player'),call(UnitHealthMax,'player'))
    s.resting=call(IsResting) and true or false
    s.mounted=call(IsMounted) and true or false
    local inInstance=call(IsInInstance)
    s.instance=inInstance and true or false
    s.afk=call(UnitIsAFK,'player') and true or false
    s.xp=percent(call(UnitXP,'player'),call(UnitXPMax,'player'))
    s.freeSlots=freeSlots()
    s.facing=call(GetPlayerFacing)
    if call(UnitExists,'target') and not call(UnitIsPlayer,'target') then
        s.targetNpcId=npcIdFromGuid(call(UnitGUID,'target'))
        s.targetHealth=percent(call(UnitHealth,'target'),call(UnitHealthMax,'target'))
    end
    s.questId,s.objectives,s.questHash=quest()
    return s
end

-- Drawing (only when enabled).
local strip,textures,enabled,elapsed,lastKey
local paints,lastError=0,nil
local function settings()
    if type(BackstageForeverLiveSettings)~='table' then BackstageForeverLiveSettings={enabled=false} end
    return BackstageForeverLiveSettings
end
-- One UI unit = one physical pixel, independent of UI scale and resolution.
local function rescale()
    if not strip then return end
    local _,height=call(GetPhysicalScreenSize)
    local scale=(type(height)=='number' and height>0) and 768/height or 1
    if type(strip.SetIgnoreParentScale)=='function' then pcall(strip.SetIgnoreParentScale,strip,true) pcall(strip.SetScale,strip,scale)
    else local parent=call(field(UIParent,'GetEffectiveScale'),UIParent) or 1 pcall(strip.SetScale,strip,scale/parent) end
end
local function build()
    if strip or type(CreateFrame)~='function' then return strip end
    strip=CreateFrame('Frame','BackstageForeverLiveStrip',UIParent)
    if not strip then return nil end
    pcall(strip.SetFrameStrata,strip,'TOOLTIP')
    pcall(strip.SetFrameLevel,strip,10000)
    local total=#MARKERS+PAYLOAD_CELLS
    pcall(strip.SetSize,strip,total*CELL,CELL)
    pcall(strip.ClearAllPoints,strip)
    pcall(strip.SetPoint,strip,'TOPLEFT',UIParent,'TOPLEFT',0,0)
    textures={}
    for i=1,total do
        local t=strip:CreateTexture(nil,'OVERLAY')
        pcall(t.SetSize,t,CELL,CELL)
        pcall(t.SetPoint,t,'TOPLEFT',strip,'TOPLEFT',(i-1)*CELL,0)
        if type(t.SetSnapToPixelGrid)=='function' then pcall(t.SetSnapToPixelGrid,t,false) pcall(t.SetTexelSnappingBias,t,0) end
        textures[i]=t
    end
    return strip
end
local function paint()
    local s=BackstageForeverLiveState()
    local key=table.concat({tostring(s.combat),tostring(s.mapId),s.x and floor(s.x*2000) or '',s.y and floor(s.y*2000) or '',tostring(s.level),tostring(s.health),tostring(s.targetNpcId),tostring(s.targetHealth),tostring(s.questId),tostring(s.objectives),tostring(s.questHash),tostring(s.freeSlots),s.facing and floor(s.facing*20) or '',tostring(s.xp),tostring(s.dead),tostring(s.mounted),tostring(s.resting),tostring(s.instance),tostring(s.afk),tostring(s.identity)},'|')
    if key==lastKey then return end
    lastKey=key
    seq=(seq+1)%256
    s.seq=seq
    local cells=BackstageForeverLiveCells(BackstageForeverLivePayload(s))
    for i,c in ipairs(cells) do pcall(textures[i].SetColorTexture,textures[i],c[1]/255,c[2]/255,c[3]/255,1) end
end
local function apply()
    if not settings().enabled then if strip then pcall(strip.Hide,strip) pcall(strip.SetScript,strip,'OnUpdate',nil) end return end
    if not build() then return end
    rescale()
    lastKey=nil elapsed=1
    pcall(strip.Show,strip)
    pcall(strip.SetScript,strip,'OnUpdate',function(_,dt)
        elapsed=elapsed+(tonumber(dt) or 0)
        if elapsed<.25 then return end
        elapsed=0
        local ok,err=pcall(paint)
        if ok then paints=paints+1 lastError=nil else lastError=tostring(err) end
    end)
end
function BackstageForeverLiveCommand(message)
    local arg=type(message)=='string' and message:lower():match('^live%s*(%a*)') or ''
    local s=settings()
    if arg=='status' then
        local w=strip and call(strip.GetWidth,strip) local es=strip and call(strip.GetEffectiveScale,strip)
        local _,ph=call(GetPhysicalScreenSize)
        local msg=('Backstage Forever live: %s · strip %s · %sx units · scale %.3f · screen %s · paints %d%s'):format(s.enabled and 'on' or 'off',strip and (call(strip.IsVisible,strip) and 'visible' or 'hidden') or 'none',tostring(w),tonumber(es) or -1,tostring(ph),paints,lastError and (' · error: '..lastError:sub(1,160)) or '')
        if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,msg) end
        return
    end
    if arg=='on' then s.enabled=true elseif arg=='off' then s.enabled=false elseif arg=='' then s.enabled=not s.enabled end
    apply()
    if type(DEFAULT_CHAT_FRAME)=='table' and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever live link '..(s.enabled and 'on: the desktop app can read your position from the small strip at the top-left. /bf live off to stop.' or 'off.'))
    end
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','DISPLAY_SIZE_CHANGED','UI_SCALE_CHANGED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event) if event=='PLAYER_LOGIN' then pcall(apply) else pcall(rescale) lastKey=nil end end)
    end
end

-- Backstage Forever live link: an opt-in, display-only status strip.
-- The addon draws a tiny calibrated colour strip in one corner of the game window
-- (top-left unless /bf live pos says otherwise). The desktop app may read those pixels to
-- know where you are right now. Nothing is sent anywhere by the addon; no input,
-- automation or protected values. The strip freezes (combat flag only) while in combat.
-- Toggle with /bf live.
-- A second row (since 0.25) cycles through pages, one per second: your quest log (ids and
-- whether each is complete) and the quests you turned in this session, so the app stays
-- current without a /reload. Older apps read only the first row.
-- Since 0.32 the strip is "compact" by default (version 4): 2px cells, four calibrated levels
-- per channel, 84 x 4 physical pixels for both rows. /bf live safe goes back to the larger
-- one-bit version 3 strip (456 x 12) for displays or remote sessions that mangle colours.
local CELL = 6                      -- safe mode: physical pixels per cell edge
-- Version 3 (safe): every colour channel is fully off or fully on (one bit per channel), so
-- colour-profile, gamma, HDR or remote-session shifts cannot blur neighbouring levels.
-- Markers: magenta (finder), green, white and black (per-channel calibration).
local MARKERS = {{255, 0, 255}, {0, 255, 0}, {255, 255, 255}, {0, 0, 0}}
local PAYLOAD_BYTES = 27
local PAYLOAD_CELLS = 72            -- 27 bytes * 8 bits / 3 bits per cell
local VERSION = 3
-- Version 4 (compact): two magenta finder cells, then grey reference cells at each level the
-- payload uses (0/85/170/255) so the app can measure what each level looks like on this
-- screen; then 36 cells of two bits per channel. The pages row reuses the same references.
local COMPACT_CELL = 2
local COMPACT_VERSION = 4
local COMPACT_HEADER = {{255, 0, 255}, {255, 0, 255}, {0, 0, 0}, {85, 85, 85}, {170, 170, 170}, {255, 255, 255}}
local COMPACT_CELLS = 36            -- 27 bytes * 8 bits / 6 bits per cell
local LEVELS = {0, 85, 170, 255}
local PAGE_VERSION = 80             -- second-row page frames
local PAGE_IDS = 6                  -- quest ids per page
local PAGE_SECONDS = 1              -- each page stays up this long (the app samples twice a second)
local PAGE_SECONDS_IDLE = 2         -- while nothing changes
local MAX_TURNED_IN = 18
-- Update rate: 5 checks a second; after IDLE_AFTER seconds without any change, once a second.
-- A heartbeat byte still counts up every HEARTBEAT seconds so the app knows the game is live.
local TICK, IDLE_TICK, IDLE_AFTER, HEARTBEAT = .2, 1, 5, 2
local POINTS = {topleft='TOPLEFT', topright='TOPRIGHT', bottomleft='BOTTOMLEFT', bottomright='BOTTOMRIGHT'}
local POSITION_ALIASES = {tl='topleft', tr='topright', bl='bottomleft', br='bottomright'}
local PLACE_NAMES = {topleft='top-left', topright='top-right', bottomleft='bottom-left', bottomright='bottom-right'}

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
-- version: 4 (compact, default) or 3 (safe); the byte layout is the same.
function BackstageForeverLivePayload(s,version)
    s=type(s)=='table' and s or {}
    local b={}
    for i=1,PAYLOAD_BYTES do b[i]=0 end
    b[1]=(version==VERSION) and VERSION or COMPACT_VERSION
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
    b[26]=clampByte(s.heartbeat or 0)
    b[27]=crc8(b,26)
    return b
end
-- Pure: one kind of list -> page byte arrays. kind 1 = quest log ({id,complete}), 2 = turned in (ids).
-- b1 version, b2 kind, b3 index*16+count, b4 generation (content hash), b5..b22 six 24-bit ids,
-- b23 complete bits, b24-25 identity, b26 total entries, b27 crc.
function BackstageForeverLivePages(kind,entries,identity)
    entries=type(entries)=='table' and entries or {}
    local n=math.min(#entries,PAGE_IDS*15)
    local gen=kind
    for i=1,n do local e=entries[i] local id=type(e)=='table' and e.id or e gen=(gen*31+(tonumber(id) or 0)%65521+(type(e)=='table' and e.complete and 7 or 0))%256 end
    local count=math.max(1,math.ceil(n/PAGE_IDS))
    local pages={}
    for p=1,count do
        local b={}
        for i=1,PAYLOAD_BYTES do b[i]=0 end
        b[1]=PAGE_VERSION b[2]=kind b[3]=(p-1)*16+count b[4]=gen
        local bits=0
        for k=1,PAGE_IDS do
            local at=(p-1)*PAGE_IDS+k
            local e=entries[at]
            if e and at<=n then
                local id=type(e)=='table' and e.id or e
                put24(b,5+(k-1)*3,id)
                if type(e)=='table' and e.complete then bits=bits+2^(k-1) end
            end
        end
        b[23]=bits
        put16(b,24,identity or 0)
        b[26]=clampByte(n)
        b[27]=crc8(b,26)
        pages[p]=b
    end
    return pages
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
        for ch=1,3 do rgb[ch]=(bits[c*3+ch] or 0)*255 end
        cells[#cells+1]=rgb
    end
    return cells
end

-- Pure: payload bytes -> compact cells: two bits per channel at LEVELS. header=true puts the
-- finder and reference cells first (main row); the pages row has no header.
function BackstageForeverLiveCompactCells(bytes,header)
    local cells={}
    if header then for i,m in ipairs(COMPACT_HEADER) do cells[i]={m[1],m[2],m[3]} end end
    local bits={}
    for i=1,PAYLOAD_BYTES do
        local v=tonumber(bytes and bytes[i]) or 0
        for k=7,0,-1 do local p=2^k bits[#bits+1]=floor(v/p)%2 end
    end
    for c=0,COMPACT_CELLS-1 do
        local rgb={}
        for ch=1,3 do local i=c*6+(ch-1)*2 rgb[ch]=LEVELS[(bits[i+1] or 0)*2+(bits[i+2] or 0)+1] end
        cells[#cells+1]=rgb
    end
    return cells
end
-- Pure: settings -> strip geometry in physical pixels. Row 1 is the frame, row 2 the pages.
function BackstageForeverLiveLayout(safe,pos)
    pos=POINTS[pos] and pos or 'topleft'
    local cell,row1,row2
    if safe then cell,row1,row2=CELL,#MARKERS+PAYLOAD_CELLS,#MARKERS+PAYLOAD_CELLS
    else cell,row1,row2=COMPACT_CELL,#COMPACT_HEADER+COMPACT_CELLS,COMPACT_CELLS end
    return {mode=safe and 'safe' or 'compact',pos=pos,point=POINTS[pos],cell=cell,row1=row1,row2=row2,width=math.max(row1,row2)*cell,height=2*cell}
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
-- Quest log entries {id, complete} in log order (public APIs only).
local function questLog()
    local api=public(C_QuestLog)
    local n=call(field(api,'GetNumQuestLogEntries')) or call(GetNumQuestLogEntries) or 0
    local out={}
    for i=1,math.min(tonumber(n) or 0,60) do
        local info=call(field(api,'GetInfo'),i)
        local qid=type(info)=='table' and not info.isHeader and tonumber(info.questID)
        if not qid and type(GetQuestLogTitle)=='function' then
            local _,_,_,header,_,_,_,legacyId=call(GetQuestLogTitle,i)
            if not header then qid=tonumber(legacyId) end
        end
        if qid and qid>0 then out[#out+1]={id=qid,complete=call(field(api,'IsComplete'),qid) and true or false} end
    end
    return out
end
local function quest()
    local api=public(C_QuestLog)
    local id
    local getWatch=field(api,'GetQuestIDForQuestWatchIndex')
    if type(getWatch)=='function' then id=call(getWatch,1) end
    local hash,first=0,nil
    for _,e in ipairs(questLog()) do
        first=first or e.id
        hash=(hash*31+e.id%251+(e.complete and 1 or 0))%256
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
local strip,textures,enabled,elapsed,lastKey,shape
local paints,lastError=0,nil
local beat,quiet,sinceBeat=0,0,0
local function settings()
    if type(BackstageForeverLiveSettings)~='table' then BackstageForeverLiveSettings={enabled=true,announce=true} end
    local s=BackstageForeverLiveSettings
    if s.pos~=nil and not POINTS[s.pos] then s.pos=nil end
    return s
end
-- One UI unit = one physical pixel, independent of UI scale and resolution, so a cell is
-- exactly COMPACT_CELL (or CELL) physical pixels.
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
    textures={}
    return strip
end
-- Sizes, anchors and cell textures for the current mode and corner.
local function layout()
    local s=settings()
    shape=BackstageForeverLiveLayout(s.safe,s.pos)
    pcall(strip.SetSize,strip,shape.width,shape.height)
    pcall(strip.ClearAllPoints,strip)
    pcall(strip.SetPoint,strip,shape.point,UIParent,shape.point,0,0)
    local need=shape.row1+shape.row2
    for i=1,need do
        local t=textures[i]
        if not t then
            t=strip:CreateTexture(nil,'OVERLAY')
            if type(t.SetSnapToPixelGrid)=='function' then pcall(t.SetSnapToPixelGrid,t,false) pcall(t.SetTexelSnappingBias,t,0) end
            textures[i]=t
        end
        local row=i>shape.row1 and 1 or 0
        local col=row==0 and i-1 or i-1-shape.row1
        pcall(t.SetSize,t,shape.cell,shape.cell)
        if type(t.ClearAllPoints)=='function' then pcall(t.ClearAllPoints,t) end
        pcall(t.SetPoint,t,'TOPLEFT',strip,'TOPLEFT',col*shape.cell,-row*shape.cell)
        if type(t.Show)=='function' then pcall(t.Show,t) end
    end
    for i=need+1,#textures do if type(textures[i].Hide)=='function' then pcall(textures[i].Hide,textures[i]) end end
end
local function fill(first,cells)
    for i,c in ipairs(cells) do local t=textures[first+i-1] if t then pcall(t.SetColorTexture,t,c[1]/255,c[2]/255,c[3]/255,1) end end
end
-- Repaints when anything changed, or every HEARTBEAT seconds with only the heartbeat moved.
local function paint(step)
    local s=BackstageForeverLiveState()
    local key=table.concat({tostring(s.combat),tostring(s.mapId),s.x and floor(s.x*2000) or '',s.y and floor(s.y*2000) or '',tostring(s.level),tostring(s.health),tostring(s.targetNpcId),tostring(s.targetHealth),tostring(s.questId),tostring(s.objectives),tostring(s.questHash),tostring(s.freeSlots),s.facing and floor(s.facing*20) or '',tostring(s.xp),tostring(s.dead),tostring(s.mounted),tostring(s.resting),tostring(s.instance),tostring(s.afk),tostring(s.identity)},'|')
    if key==lastKey then
        quiet=quiet+step sinceBeat=sinceBeat+step
        if sinceBeat<HEARTBEAT then return end
    else
        lastKey=key quiet=0
        seq=(seq+1)%256
    end
    sinceBeat=0 beat=(beat+1)%256
    s.seq=seq s.heartbeat=beat
    if shape.mode=='safe' then fill(1,BackstageForeverLiveCells(BackstageForeverLivePayload(s,VERSION)))
    else fill(1,BackstageForeverLiveCompactCells(BackstageForeverLivePayload(s,COMPACT_VERSION),true)) end
end
-- Second row: cycle through quest log and turned-in pages, one per PAGE_SECONDS.
local turnedIn={}
local pages,pageIndex,pageClock={},0,99
function BackstageForeverLiveTurnedIn(id)
    id=tonumber(plain(id))
    if not id or id<=0 then return end
    for i=#turnedIn,1,-1 do if turnedIn[i]==id then table.remove(turnedIn,i) end end
    table.insert(turnedIn,1,id)
    while #turnedIn>MAX_TURNED_IN do table.remove(turnedIn) end
    pageClock=99 pageIndex=#pages quiet=0
end
local function paintPage(dt,idle)
    pageClock=pageClock+dt
    if pageClock<(idle and PAGE_SECONDS_IDLE or PAGE_SECONDS) then return end
    pageClock=0
    if call(InCombatLockdown) then return end
    pageIndex=pageIndex+1
    if pageIndex>#pages then
        local identity=BackstageForeverLiveIdentity(call(UnitGUID,'player'))
        pages={}
        for _,p in ipairs(BackstageForeverLivePages(1,questLog(),identity)) do pages[#pages+1]=p end
        for _,p in ipairs(BackstageForeverLivePages(2,turnedIn,identity)) do pages[#pages+1]=p end
        pageIndex=1
    end
    if shape.mode=='safe' then fill(shape.row1+1,BackstageForeverLiveCells(pages[pageIndex]))
    else fill(shape.row1+1,BackstageForeverLiveCompactCells(pages[pageIndex],false)) end
end
local function apply()
    if not settings().enabled then if strip then pcall(strip.Hide,strip) pcall(strip.SetScript,strip,'OnUpdate',nil) end return end
    if not build() then return end
    layout()
    rescale()
    lastKey=nil elapsed=1 pageClock=99 pageIndex=#pages quiet=0 sinceBeat=0
    pcall(strip.Show,strip)
    pcall(strip.SetScript,strip,'OnUpdate',function(_,dt)
        elapsed=elapsed+(tonumber(dt) or 0)
        local idle=quiet>=IDLE_AFTER
        if elapsed<(idle and IDLE_TICK or TICK) then return end
        local step=elapsed
        elapsed=0
        local ok,err=pcall(paint,step)
        if ok then paints=paints+1 lastError=nil else lastError=tostring(err) end
        local okPage,errPage=pcall(paintPage,step,idle)
        if not okPage then lastError=tostring(errPage) end
    end)
end
-- /bf way MapID X Y [label]: a native user waypoint plus the game's own navigation arrow.
-- X and Y accept map percentages (51.5) or fractions (0.515). Never in combat.
function BackstageForeverWay(message)
    local say=function(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..m) end end
    if type(message)~='string' or #message>160 then return say('Use /bf way MapID X Y [name].') end
    local map,x,y,label=message:match('^way%s+(%d+)%s+([%d%.]+)%s+([%d%.]+)%s*(.-)%s*$')
    map,x,y=tonumber(map),tonumber(x),tonumber(y)
    if not map or not x or not y then return say('Use /bf way MapID X Y [name], for example /bf way 1413 51.5 30.9 Thork.') end
    if x>1 or y>1 then x,y=x/100,y/100 end
    if x<0 or x>1 or y<0 or y>1 then return say('Coordinates must be between 0 and 100.') end
    if call(InCombatLockdown) then return say('Waypoints wait until you leave combat.') end
    local mapApi=public(C_Map)
    if call(field(mapApi,'CanSetUserWaypointOnMap'),map)~=true then return say(('Cannot place a waypoint on map %d here; head to %.1f, %.1f.'):format(map,x*100,y*100)) end
    local point=call(field(public(UiMapPoint),'CreateFromCoordinates'),map,x,y)
    if not point then return say('Waypoint unavailable.') end
    local ok=pcall(field(mapApi,'SetUserWaypoint'),point)
    if not ok then return say('Waypoint unavailable.') end
    local st=public(C_SuperTrack)
    if type(field(st,'SetSuperTrackedUserWaypoint'))=='function' then pcall(st.SetSuperTrackedUserWaypoint,true) end
    label=(label and label~='' and label:sub(1,60)) or 'waypoint'
    say(('Waypoint set: %s at %.1f, %.1f. Follow the arrow on your minimap and screen.'):format(label,x*100,y*100))
end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,m) end end
-- Pure: "/bf live ..." text -> action, value. Actions: toggle, on, off, status, pos, safe,
-- compact, usage. pos carries a corner name, or nil when the corner is not recognised.
function BackstageForeverLiveParse(message)
    local arg,value=(type(message)=='string' and message:lower() or ''):match('^live%s*(%a*)%s*(%a*)')
    arg=arg or ''
    if arg=='' then return 'toggle' end
    if arg=='on' or arg=='off' or arg=='status' or arg=='safe' or arg=='compact' then return arg end
    if arg=='pos' or arg=='position' then value=POSITION_ALIASES[value] or value return 'pos',POINTS[value] and value or nil end
    return 'usage'
end
function BackstageForeverLiveCommand(message)
    local action,value=BackstageForeverLiveParse(message)
    local s=settings()
    local where=PLACE_NAMES[s.pos or 'topleft']
    if action=='status' then
        local w=strip and call(strip.GetWidth,strip) local es=strip and call(strip.GetEffectiveScale,strip)
        local _,ph=call(GetPhysicalScreenSize)
        local L=BackstageForeverLiveLayout(s.safe,s.pos)
        local msg=('Backstage Forever live: %s · %s %dx%d px at %s · strip %s · %sx units · scale %.3f · screen %s · paints %d%s%s'):format(s.enabled and 'on' or 'off',L.mode,L.width,L.height,PLACE_NAMES[L.pos],strip and (call(strip.IsVisible,strip) and 'visible' or 'hidden') or 'none',tostring(w),tonumber(es) or -1,tostring(ph),paints,quiet>=IDLE_AFTER and ' · idle' or '',lastError and (' · error: '..lastError:sub(1,160)) or '')
        return say(msg)
    end
    if action=='usage' then return say('Backstage Forever: use /bf live [on|off|status], /bf live pos topleft|topright|bottomleft|bottomright, or /bf live safe|compact.') end
    if action=='pos' then
        if not value then return say('Backstage Forever: use /bf live pos topleft, topright, bottomleft or bottomright.') end
        s.pos=value~='topleft' and value or nil
        apply()
        return say('Backstage Forever live strip moved to the '..PLACE_NAMES[value]..' corner.')
    end
    if action=='safe' then
        s.safe=true apply()
        return say('Backstage Forever live strip: safe mode (larger, one bit per colour). Use it if the link drops over remote desktop or with colour filters; /bf live compact makes it small again.')
    end
    if action=='compact' then
        s.safe=nil apply()
        return say('Backstage Forever live strip: compact mode (tiny, calibrated colours). /bf live safe if the desktop app stops reading it.')
    end
    if action=='on' then s.enabled=true elseif action=='off' then s.enabled=false else s.enabled=not s.enabled end
    apply()
    say('Backstage Forever live link '..(s.enabled and ('on: the desktop app can read your position from the small strip at the '..where..'. /bf live off to stop.') or 'off.'))
end
-- First login with the live link: say once what the strip is and how to hide it.
local function announce()
    local s=settings()
    if not s.announce then return end
    s.announce=nil
    if type(DEFAULT_CHAT_FRAME)=='table' and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever live link is on: the tiny strip at the '..PLACE_NAMES[s.pos or 'topleft']..' lets the desktop app show where you are. Type /bf live off to hide it, or /bf live pos to move it.')
    end
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','DISPLAY_SIZE_CHANGED','UI_SCALE_CHANGED','QUEST_TURNED_IN'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a) if event=='PLAYER_LOGIN' then pcall(apply) pcall(announce) elseif event=='QUEST_TURNED_IN' then pcall(BackstageForeverLiveTurnedIn,a) else pcall(rescale) lastKey=nil end end)
    end
end

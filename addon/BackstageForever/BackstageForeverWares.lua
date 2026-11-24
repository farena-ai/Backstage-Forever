-- Vendor wares (1.27): when you open a vendor window yourself, the addon remembers which NPC it
-- was (id and the name the game shows), the ids of the items on sale, and the map and spot where
-- you stood. No prices, no character data. At most 60 vendors per character, 200 items each; the vendor seen longest ago
-- makes room. The list rides to the desktop app in the saved file, in a block of its own that
-- older desktop apps ignore. The desktop app shares it with the community service only while
-- community sharing is on there. Only the window you opened is read; nothing is clicked or bought.
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

-- ---------------------------------------------------------------- pure
local MAX,ITEMS,NAME_MAX=60,200,60
BackstageForeverWaresMax=MAX
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
local function unit(v) return type(v)=='number' and v==v and v>=0 and v<=1 end
-- Pure: the NPC id inside a unit GUID, or nil for players, pets, objects and anything else.
local function npcId(guid)
    if type(guid)~='string' or #guid>100 then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-%x+$')
    if kind~='Creature' and kind~='Vehicle' then return nil end
    id=tonumber(id)
    if id and id>=1 and id<=2147483647 then return id end
end
BackstageForeverWaresNpcId=npcId
-- Pure: one vendor made clean, or nil. vendor = {n=npc id,name=,items={item ids},at=seconds,m=map id,x=,y=}
-- Item ids come out unique and sorted; a vendor with no readable item is nothing. The place is
-- kept only when map and both coordinates are sound.
function BackstageForeverWaresVendor(vendor)
    if type(vendor)~='table' or not whole(vendor.n,1,2147483647) or not whole(vendor.at,1,253402300799) or type(vendor.items)~='table' then return nil end
    local seen,items={},{}
    for i=1,min(#vendor.items,1000) do
        local id=vendor.items[i]
        if whole(id,1,2147483647) and not seen[id] then seen[id]=true;items[#items+1]=id end
    end
    if #items==0 then return nil end
    table.sort(items)
    while #items>ITEMS do table.remove(items) end
    local out={n=vendor.n,items=items,at=vendor.at}
    if whole(vendor.m,1,1000000) and unit(vendor.x) and unit(vendor.y) and not (vendor.x==0 and vendor.y==0) then
        out.m=vendor.m;out.x=floor(vendor.x*10000+.5)/10000;out.y=floor(vendor.y*10000+.5)/10000
    end
    local name=vendor.name
    if type(name)=='string' then
        name=name:gsub('[%c|]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
        if #name>NAME_MAX then name=name:sub(1,NAME_MAX):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
        if name~='' then out.name=name end
    end
    return out
end
local function same(a,b)
    if #a~=#b then return false end
    for i=1,#a do if a[i]~=b[i] then return false end end
    return true
end
-- Pure: keeps one vendor. The same NPC is kept once with its newest list. When the list is full
-- the vendor seen longest ago goes. -> 'new', 'changed', 'seen', or nil when it is not clean.
function BackstageForeverWaresAdd(vendors,vendor,max)
    vendor=BackstageForeverWaresVendor(vendor)
    if type(vendors)~='table' or not vendor then return nil end
    max=type(max)=='number' and max>=1 and floor(max) or MAX
    local oldest
    for i,row in ipairs(vendors) do
        if row.n==vendor.n then
            local changed=not same(row.items,vendor.items)
            -- A window opened where the place could not be read keeps the place seen before.
            if not vendor.m and row.m then vendor.m,vendor.x,vendor.y=row.m,row.x,row.y end
            vendors[i]=vendor
            return changed and 'changed' or 'seen'
        end
        if not oldest or row.at<vendors[oldest].at then oldest=i end
    end
    while #vendors>=max and oldest do
        table.remove(vendors,oldest)
        oldest=nil
        for i,row in ipairs(vendors) do if not oldest or row.at<vendors[oldest].at then oldest=i end end
    end
    vendors[#vendors+1]=vendor
    return 'new'
end
-- Pure: a saved list read back: every row checked again, doubles dropped, at most max kept.
function BackstageForeverWaresClean(vendors,max)
    local out={}
    for _,row in ipairs(type(vendors)=='table' and vendors or {}) do BackstageForeverWaresAdd(out,row,max) end
    return out
end

-- ---------------------------------------------------------------- game
local function load()
    local s=BackstageForeverWaresDB
    if type(s)~='table' then s={} end
    local clean={version=1,vendors=BackstageForeverWaresClean(rawget(s,'vendors'),MAX)}
    BackstageForeverWaresDB=clean
    return clean
end
-- The optional capture block: {version=1,vendors={...}}, or nil when nothing is recorded.
function BackstageForeverWaresSnapshot()
    local s=BackstageForeverWaresDB
    if type(s)~='table' or type(s.vendors)~='table' or #s.vendors==0 then return nil end
    local vendors=BackstageForeverWaresClean(s.vendors,MAX)
    if #vendors==0 then return nil end
    return {version=1,vendors=vendors}
end
-- Reads the open vendor window once. -> 'new', 'changed', 'seen', or nil when nothing was readable.
function BackstageForeverWaresRead()
    local id=npcId(call(UnitGUID,'npc'))
    local at=call(time)
    local count=call(GetMerchantNumItems)
    if not id or type(at)~='number' or not whole(count,1,500) then return nil end
    local items={}
    for i=1,min(count,ITEMS) do
        local item=call(GetMerchantItemID,i)
        if whole(item,1,2147483647) then items[#items+1]=item end
    end
    local name=call(UnitName,'npc')
    local api=plain(C_Map)
    local map=call(field(api,'GetBestMapForUnit'),'player')
    local pos=whole(map,1,1000000) and call(field(api,'GetPlayerMapPosition'),map,'player') or nil
    local x,y
    if pos then x,y=call(field(pos,'GetXY'),pos) end
    local result=BackstageForeverWaresAdd(load().vendors,{n=id,name=type(name)=='string' and name or nil,items=items,at=floor(at),m=map,x=x,y=y},MAX)
    if (result=='new' or result=='changed') and type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
    return result
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Wares',events) end
        for _,e in ipairs({'PLAYER_LOGIN','MERCHANT_SHOW'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then pcall(load) return end
            pcall(BackstageForeverWaresRead)
        end)
    end
end

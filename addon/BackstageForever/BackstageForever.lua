-- Public player snapshots only. No networking, input automation, or protected-value access.
local function public(value)
    if type(issecretvalue) == "function" then
        local ok, secret = pcall(issecretvalue, value)
        if not ok or secret then return nil end
    end
    return value
end
local function call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b = pcall(fn, ...)
    if not ok then return nil end
    return public(a), public(b)
end
local function clean(value, limit)
    value = public(value)
    if type(value) ~= "string" or #value > (limit or 100) or value:find("[%z\1-\31\127]") then return nil end
    return value
end
local function quote(s)
    return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
        local names = {['"']='\\"', ['\\']='\\\\'}
        return names[c] or string.format('\\u%04x', string.byte(c))
    end) .. '"'
end
local function encode(v)
    if type(v) == "string" then return quote(v) end
    if type(v) == "number" then return tostring(v) end
    if type(v) ~= "table" then return "null" end
    local parts = {}
    if v[1] then for i=1,#v do parts[#parts+1]=encode(v[i]) end return '['..table.concat(parts,',')..']' end
    for k,x in pairs(v) do parts[#parts+1]=quote(k)..':'..encode(x) end
    return '{'..table.concat(parts,',')..'}'
end
-- Decode only our bounded JSON data; never compile or evaluate saved text as Lua.
local function decode(s)
    if type(s) ~= "string" or #s > 1048576 then return nil end
    local i, count = 1, 0
    local parse
    local function space() local _,j=s:find('^%s*',i); i=(j or i-1)+1 end
    local function stringValue()
        if s:sub(i,i) ~= '"' then error('string') end
        i=i+1; local out={}
        while i<=#s do
            local c=s:sub(i,i); i=i+1
            if c=='"' then return table.concat(out) end
            if c=='\\' then
                c=s:sub(i,i);i=i+1
                local map={['"']='"',['\\']='\\',['/']='/',n='\n',r='\r',t='\t',b='\b',f='\f'}
                if not map[c] then error('escape') end
                c=map[c]
            end
            out[#out+1]=c
        end
        error('unfinished')
    end
    parse=function(depth)
        count=count+1;if count>10000 or depth>8 then error('limit') end
        space(); local c=s:sub(i,i)
        if c=='"' then return stringValue() end
        if c=='{' or c=='[' then
            local object=c=='{';local close=object and '}' or ']';local t={};i=i+1;space()
            if s:sub(i,i)==close then i=i+1;return t end
            while true do
                local key
                if object then space();key=stringValue();space();if s:sub(i,i)~=':' then error('colon') end;i=i+1 end
                local v=parse(depth+1);if object then t[key]=v else t[#t+1]=v end
                space();c=s:sub(i,i);i=i+1;if c==close then return t end;if c~=',' then error('separator') end
            end
        end
        local n=s:match('^-?%d+%.?%d*',i)
        if n then i=i+#n;return tonumber(n) end
        if s:sub(i,i+3)=='null' then i=i+4;return nil end
        error('value')
    end
    local ok,result=pcall(parse,0);space();if ok and i>#s then return result end
end
local roster={}
local function capture()
    if type(InCombatLockdown) ~= "function" or call(InCombatLockdown) ~= false then return end
    local guid=clean(call(UnitGUID,'player'),200)
    local name,realm=call(UnitFullName,'player')
    name=clean(name);realm=clean(realm) or clean(call(GetRealmName))
    local class=clean(call(UnitClass,'player'))
    local level=call(UnitLevel,'player');local now=call(time)
    if not guid or not name or not realm or not class or type(level)~='number' or level<1 or level>1000 or type(now)~='number' then return end
    local location={zone=clean(call(GetZoneText)) or '',subZone=clean(call(GetSubZoneText)) or ''}
    if type(C_Map)=='table' then
        local map=call(C_Map.GetBestMapForUnit,'player')
        if type(map)=='number' and map>=0 then
            location.mapId=map
            local pos=call(C_Map.GetPlayerMapPosition,map,'player')
            if pos then
                local x,y=call(pos.GetXY,pos)
                if type(x)=='number' and type(y)=='number' and x>=0 and x<=1 and y>=0 and y<=1 then location.x=x;location.y=y end
            end
        end
    end
    local character={id=guid,name=name,realm=realm,className=class,level=level,location=location,updatedAt=now}
    character.race=clean(call(UnitRace,'player'));character.faction=clean(call(UnitFactionGroup,'player'))
    roster[guid]=character
    local chars={};for _,c in pairs(roster) do chars[#chars+1]=c end
    table.sort(chars,function(a,b) return a.updatedAt>b.updatedAt end)
    while #chars>100 do roster[chars[#chars].id]=nil;table.remove(chars) end
    BackstageForeverExport=encode({schema=1,characters=chars,activeId=guid,observedAt=now})
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_LEVEL_UP','ZONE_CHANGED','ZONE_CHANGED_INDOORS','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_ENABLED','PLAYER_LOGOUT'}) do pcall(frame.RegisterEvent,frame,event) end
    frame:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_LOGIN' then
            local saved=decode(BackstageForeverExport)
            if type(saved)=='table' and saved.schema==1 and type(saved.characters)=='table' then
                for i,c in ipairs(saved.characters) do
                    if i<=100 and type(c)=='table' and clean(c.id,200) and type(c.updatedAt)=='number' then roster[c.id]=c end
                end
            end
        end
        pcall(capture)
    end)
end

-- Public player snapshots only. No networking, input automation, or protected-value access.
local captureIssue=false
local function public(value)
    if type(issecretvalue) == "function" then
        local ok, secret = pcall(issecretvalue, value)
        if not ok or secret then captureIssue=true;return nil end
    end
    return value
end
local function call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d = pcall(fn, ...)
    if not ok then captureIssue=true;return nil end
    return public(a), public(b), public(c), public(d)
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
local arrays=setmetatable({}, {__mode="k"})
local function array(t) arrays[t]=true;return t end
local function encode(v)
    if type(v) == "string" then return quote(v) end
    if type(v) == "number" then return tostring(v) end
    if type(v) == "boolean" then return v and "true" or "false" end
    if type(v) ~= "table" then return "null" end
    local parts = {}
    if arrays[v] or v[1] then for i=1,#v do parts[#parts+1]=encode(v[i]) end return '['..table.concat(parts,',')..']' end
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
        count=count+1;if count>200000 or depth>8 then error('limit') end
        space(); local c=s:sub(i,i)
        if c=='"' then return stringValue() end
        if c=='{' or c=='[' then
            local object=c=='{';local close=object and '}' or ']';local t={};if not object then array(t) end;i=i+1;space()
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
        if s:sub(i,i+3)=='true' then i=i+4;return true end
        if s:sub(i,i+4)=='false' then i=i+5;return false end
        if s:sub(i,i+3)=='null' then i=i+4;return nil end
        error('value')
    end
    local ok,result=pcall(parse,0);space();if ok and i>#s then return result end
end
-- Guard containers before indexing and each field before comparing or formatting.
local function field(value,key)
    value=public(value);if type(value)~='table' then return nil end
    local ok,result=pcall(function() return value[key] end)
    if ok then return public(result) end
    captureIssue=true
end
local function integer(value,low,high)
    value=public(value)
    if type(value)=='number' and value==value and value>=low and value<=high and value%1==0 then return value end
end
local function destination(api,id)
    local map,x,y=call(field(api,'GetNextWaypoint'),id)
    map=integer(map,1,2147483647)
    if not map or type(x)~='number' or type(y)~='number' or x~=x or y~=y or x<0 or x>1 or y<0 or y>1 then return nil end
    return {mapId=map,x=x,y=y,text=clean(call(field(api,'GetNextWaypointText'),id),200)}
end
local function completedIds()
    local ids=call(field(public(C_QuestLog),'GetAllCompletedQuestIDs'))
    if type(ids)~='table' then return nil end
    local count=0;local result=array({});local seen={};local highest=0
    local ok=pcall(function()
        for k,v in pairs(ids) do
            k=public(k);v=public(v)
            if not integer(k,1,20000) or not integer(v,1,2147483647) then error('unavailable') end
            if seen[v] then error('duplicate') end;seen[v]=true
            count=count+1;if count>20000 then error('bound') end
            highest=math.max(highest,k);result[#result+1]=v
        end
    end)
    if ok and highest==count then table.sort(result);return result end
end
local function clientBuild()
    local version,build=call(GetBuildInfo)
    version=clean(version,30);build=clean(build,12)
    if version and build and version:match('^%d+%.%d+%.%d+$') and build:match('^%d+$') then return version..'.'..build end
end
local function quests()
    local api=public(C_QuestLog)
    local rawCount,rawTotal=call(field(api,'GetNumQuestLogEntries'))
    local count=integer(rawCount,0,1000)
    local total=integer(rawTotal,0,1000)
    if not count or type(field(api,'GetInfo'))~='function' or type(field(api,'IsComplete'))~='function' or type(field(api,'GetQuestObjectives'))~='function' then return nil end
    local result=array({});local zone;local seen={}
    for i=1,count do
        local info=call(field(api,'GetInfo'),i)
        if type(info)~='table' then return nil end
        local header=field(info,'isHeader')
        if header==true then zone=clean(field(info,'title'),200)
        elseif header==false then
            local id=integer(field(info,'questID'),1,2147483647)
            local title=clean(field(info,'title'),200)
            local complete=id and call(field(api,'IsComplete'),id)
            local raw=id and call(field(api,'GetQuestObjectives'),id)
            if not id or not title or title=='' or type(complete)~='boolean' or type(raw)~='table' then return nil end
            local objectives=array({})
            for j=1,5 do
                local objective=field(raw,j);if objective==nil then break end
                local text=clean(field(objective,'text'),200);local done=field(objective,'finished')
                if not text or type(done)~='boolean' then return nil end
                local captured={text=text,done=done}
                captured.type=clean(field(objective,'type'),40)
                captured.required=integer(field(objective,'numRequired'),0,100000)
                captured.fulfilled=integer(field(objective,'numFulfilled'),0,100000)
                if captured.required and captured.fulfilled and captured.fulfilled>captured.required then captured.fulfilled=nil end
                objectives[#objectives+1]=captured
            end
            if not seen[id] then
                seen[id]=true
                local q={id=id,title=title,complete=complete,objectives=objectives,zone=zone}
                q.level=integer(field(info,'level'),0,1000)
                q.destination=destination(api,id)
                result[#result+1]=q
                if #result>=25 then break end
            end
        else return nil end
    end
    if total and #result<math.min(total,25) then return nil end
    return result
end
local function progress()
    local current=integer(call(UnitXP,'player'),0,2147483647)
    local max=integer(call(UnitXPMax,'player'),0,2147483647)
    if not current or not max or current>max then return nil end
    return {current=current,max=max,rested=integer(call(GetXPExhaustion),0,2147483647)}
end
-- Equipment IDs only; never read bag contents, links, money or account storage.
local function equipment()
    if type(public(GetInventoryItemID))~='function' then return nil end
    local result=array({})
    for slot=1,19 do
        local raw=call(GetInventoryItemID,'player',slot)
        if captureIssue then return nil end
        if raw~=nil and raw~=0 then
            local id=integer(raw,1,9007199254740991)
            if not id then return nil end
            local item={slot=slot,itemId=id}
            local name,_,quality,level=call(field(public(C_Item),'GetItemInfo'),id)
            item.name=clean(name,200);item.quality=integer(quality,0,8);item.itemLevel=integer(level,0,10000)
            result[#result+1]=item
        end
    end
    return result
end
local function bags()
    local api=public(C_Container)
    if type(field(api,'GetContainerNumFreeSlots'))~='function' or type(field(api,'GetContainerNumSlots'))~='function' then return nil end
    local indices=field(public(Enum),'BagIndex')
    local free,total=0,0;local seen={}
    for _,key in ipairs({'Backpack','Bag_1','Bag_2','Bag_3','Bag_4'}) do
        local index=integer(field(indices,key),0,100)
        if not index or seen[index] then return nil end
        seen[index]=true
        local count=integer(call(field(api,'GetContainerNumSlots'),index),0,1000)
        local available=integer(call(field(api,'GetContainerNumFreeSlots'),index),0,1000)
        if not count or not available or available>count then return nil end
        free=free+available;total=total+count
    end
    if free<=1000 and total<=1000 then return {free=free,total=total} end
end
local function optional(fn)
    local prior=captureIssue;captureIssue=false
    local ok,value=pcall(fn)
    local failed=captureIssue or not ok
    captureIssue=prior or failed
    if ok then return value end
end
local function readiness()
    local gear=optional(equipment)
    local space=optional(bags)
    if gear~=nil or space~=nil then return {equipment=gear,bags=space} end
end
local roster={}
local function capture(event,eventId)
    if type(InCombatLockdown) ~= "function" or call(InCombatLockdown) ~= false then return end
    local guid=clean(call(UnitGUID,'player'),200)
    local name,realm=call(UnitFullName,'player')
    name=clean(name);realm=clean(realm) or clean((call(GetRealmName)))
    local class=clean((call(UnitClass,'player')))
    local level=call(UnitLevel,'player');local now=call(time)
    if not guid or not name or not realm or not class or type(level)~='number' or level<1 or level>1000 or type(now)~='number' then return end
    local location={zone=clean((call(GetZoneText))) or '',subZone=clean((call(GetSubZoneText))) or ''}
    if type(public(C_Map))=='table' then
        local map=integer(call(field(C_Map,'GetBestMapForUnit'),'player'),0,1000000)
        if map then
            location.mapId=map
            local pos=call(field(C_Map,'GetPlayerMapPosition'),map,'player')
            if pos then
                local x,y=call(field(pos,'GetXY'),pos)
                if type(x)=='number' and type(y)=='number' and x>=0 and x<=1 and y>=0 and y<=1 then location.x=x;location.y=y end
            end
        end
    end
    local character={id=guid,name=name,realm=realm,className=class,level=level,location=location,updatedAt=now}
    character.clientBuild=clientBuild();character.locale=clean(call(GetLocale),4);character.captureVersion='0.8.0'
    character.race=clean((call(UnitRace,'player')));character.faction=clean((call(UnitFactionGroup,'player')))
    local previous=roster[guid]
    local history={recent=array({})}
    if previous and type(previous.history)=='table' and type(previous.history.recent)=='table' then
        for i,h in ipairs(previous.history.recent) do
            if i>25 then break end
            if type(h)=='table' and integer(h.id,1,2147483647) and clean(h.title,200) and integer(h.completedAt,0,253402300799) then history.recent[#history.recent+1]={id=h.id,title=h.title,completedAt=h.completedAt} end
        end
    end
    if event=='QUEST_TURNED_IN' then
        local id=integer(eventId,1,2147483647)
        local title
        if id and previous and type(previous.quests)=='table' then
            for _,q in ipairs(previous.quests) do if q.id==id then title=clean(q.title,200);break end end
        end
        if id and not title then title=clean(call(field(public(C_QuestLog),'GetTitleForQuestID'),id),200) end
        if id and title and title~='' and integer(now,0,253402300799) then
            table.insert(history.recent,1,{id=id,title=title,completedAt=now})
            while #history.recent>25 do table.remove(history.recent) end
        end
    end
    local completed=completedIds()
    history.completedIdsKnown=completed~=nil
    if completed then history.completedCount=#completed;history.completedIds=completed end
    character.history=history
    character.quests=optional(quests);character.progress=optional(progress);character.readiness=optional(readiness)
    if type(BackstageForeverHUDUpdate)=="function" then pcall(BackstageForeverHUDUpdate,character) end
    roster[guid]=character
    local chars=array({});for _,c in pairs(roster) do chars[#chars+1]=c end
    table.sort(chars,function(a,b) return a.updatedAt>b.updatedAt end)
    while #chars>100 do roster[chars[#chars].id]=nil;table.remove(chars) end
    local payload={schema=1,characters=chars,activeId=guid,observedAt=now}
    local encoded=encode(payload)
    local encodedLength=#encoded
    -- Retain identities while shedding the oldest optional detail first.
    for i=#chars,1,-1 do
        if encodedLength<1048576 then break end
        local before=#encode(chars[i])
        chars[i].quests=nil;chars[i].progress=nil;chars[i].history=nil;chars[i].readiness=nil
        encodedLength=encodedLength-before+#encode(chars[i])
    end
    if encodedLength~=#encoded then encoded=encode(payload) end
    if #encoded<1048576 then BackstageForeverExport=encoded;return true end
end
-- Explicit player command only. No map panels, movement, targeting or game input.
local function guideMessage(message)
    local chat=public(DEFAULT_CHAT_FRAME)
    call(field(chat,'AddMessage'),chat,'Backstage Forever: '..message)
end
function BackstageForeverGuide(message)
    local help='Use /bf guide QuestID t/o/r MapID X Y Build (coordinates 0 to 1).'
    if type(message)~='string' or #message>150 then guideMessage(help);return end
    local parts={};for part in message:gmatch('%S+') do parts[#parts+1]=part end
    if #parts~=7 or parts[1]~='guide' or not parts[2]:match('^%d+$') or not parts[4]:match('^%d+$') or not parts[5]:match('^%d*%.?%d+$') or not parts[6]:match('^%d*%.?%d+$') or not parts[7]:match('^%d+%.%d+%.%d+%.%d+$') then guideMessage(help);return end
    local quest=integer(tonumber(parts[2]),1,2147483647);local map=integer(tonumber(parts[4]),1,2147483647)
    local phase=parts[3];local x,y=tonumber(parts[5]),tonumber(parts[6])
    if not quest or not map or (phase~='t' and phase~='o' and phase~='r') or not x or not y or x<0 or x>1 or y<0 or y>1 then guideMessage(help);return end
    if call(InCombatLockdown)~=false then guideMessage('Waypoint unavailable in combat or restricted state.');return end
    if clientBuild()~=parts[7] then guideMessage('Waypoint build mismatch; use a current Compass step or a command from a matching saved build.');return end
    if phase~='r' then
        local api=public(C_QuestLog)
        local logIndex=integer(call(field(api,'GetLogIndexForQuestID'),quest),1,1000)
        local complete=call(field(api,'IsComplete'),quest)
        if not logIndex or type(complete)~='boolean' or (phase=='t')~=complete then guideMessage('Quest state changed; use a current Compass step or a newly saved desktop command.');return end
    end
    local mapApi=public(C_Map);local info=call(field(mapApi,'GetMapInfo'),map)
    local name=clean(field(info,'name'),100) or ('Map #'..map)
    local coordinates=name..string.format(' %.2f, %.2f',x*100,y*100)
    local allowed=call(field(mapApi,'CanSetUserWaypointOnMap'),map)
    if allowed~=true or type(field(mapApi,'SetUserWaypoint'))~='function' then guideMessage('Waypoint API unavailable; coordinates: '..coordinates);return end
    local point=call(field(public(UiMapPoint),'CreateFromCoordinates'),map,x,y)
    if not point then guideMessage('Waypoint API unavailable; coordinates: '..coordinates);return end
    local setter=field(mapApi,'SetUserWaypoint')
    local ok=pcall(setter,point)
    if ok then guideMessage((phase=='r' and 'Reference marker (check availability): ' or 'Quest waypoint: ')..coordinates)
    else guideMessage('Waypoint restricted; coordinates: '..coordinates) end
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    local loggedIn,generation,pending=false,0,nil
    local immediate={PLAYER_LOGIN=true,PLAYER_ENTERING_WORLD=true,PLAYER_LEVEL_UP=true,QUEST_TURNED_IN=true,PLAYER_REGEN_ENABLED=true}
    local function refresh(event,eventId)
        if not loggedIn then return end
        captureIssue=false
        local ok,captured=pcall(capture,event,eventId)
        if type(BackstageForeverHUDCaptureStatus)=='function' then
            pcall(BackstageForeverHUDCaptureStatus,(not ok or not captured) and 'unavailable' or captureIssue and 'partial' or 'ready')
        end
    end
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','PLAYER_LEVEL_UP','ZONE_CHANGED','ZONE_CHANGED_INDOORS','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_ENABLED','PLAYER_LOGOUT','QUEST_LOG_UPDATE','QUEST_ACCEPTED','QUEST_TURNED_IN','UNIT_QUEST_LOG_CHANGED','PLAYER_XP_UPDATE','UPDATE_EXHAUSTION','PLAYER_EQUIPMENT_CHANGED','BAG_UPDATE_DELAYED','GET_ITEM_INFO_RECEIVED','PLAYER_STOPPED_MOVING'}) do pcall(frame.RegisterEvent,frame,event) end
    frame:SetScript('OnEvent',function(_,event,eventId)
        -- Logout APIs may already be torn down; persist the last prepared export.
        if event=='PLAYER_LOGOUT' or event=='PLAYER_LOGIN' then
            generation=generation+1;pending=nil;loggedIn=false
            if type(BackstageForeverHUDSession)=='function' then pcall(BackstageForeverHUDSession,event) end
        end
        if event=='PLAYER_LOGOUT' then return end
        if event=='PLAYER_LOGIN' then
            local saved=decode(BackstageForeverExport)
            if type(saved)=='table' and saved.schema==1 and type(saved.characters)=='table' then
                for i,c in ipairs(saved.characters) do
                    if i<=100 and type(c)=='table' and clean(c.id,200) and type(c.updatedAt)=='number' then roster[c.id]=c end
                end
            end
            loggedIn=true
        end
        -- Startup events must not replace the saved roster before it is restored.
        if not loggedIn then return end
        if immediate[event] then pending=nil;refresh(event,public(eventId));return end
        local after=field(public(C_Timer),'After')
        if type(after)~='function' then refresh(event,public(eventId));return end
        if pending then return end
        local token={generation=generation};pending=token
        local ok=pcall(after,.25,function()
            if not loggedIn or token.generation~=generation or pending~=token then return end
            pending=nil;refresh('COALESCED')
        end)
        if not ok then
            pending=nil;refresh(event,public(eventId))
        end
    end)
end

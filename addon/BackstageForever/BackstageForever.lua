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
-- Public map vectors may be native userdata or property-backed tables.
local function vectorField(value,key)
    value=public(value)
    if type(value)~='table' and type(value)~='userdata' then return nil end
    local ok,result=pcall(function()return value[key]end)
    if not ok then return nil end
    return public(result)
end
local function coordinate(value)
    return type(value)=='number' and value==value and value>=0 and value<=1
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
    if type(v) == "string" then return quote(v),1 end
    if type(v) == "number" then return tostring(v),1 end
    if type(v) == "boolean" then return v and "true" or "false",1 end
    if type(v) ~= "table" then return "null",1 end
    -- Match decode's parsed-value accounting: one node per value/container,
    -- including empty containers, without counting object property keys.
    local parts,nodes = {},1
    if arrays[v] or v[1] then
        for i=1,#v do
            local text,count=encode(v[i]);parts[#parts+1]=text;nodes=nodes+count
        end
        return '['..table.concat(parts,',')..']',nodes
    end
    for k,x in pairs(v) do
        local text,count=encode(x);parts[#parts+1]=quote(k)..':'..text;nodes=nodes+count
    end
    return '{'..table.concat(parts,',')..'}',nodes
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
        count=count+1;if count>200000 or depth>12 then error('limit') end
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
local function gamePoint(map,x,y)
    map=integer(map,1,2147483647);x=public(x);y=public(y)
    if map and type(x)=='number' and type(y)=='number' and x==x and y==y and x>=0 and x<=1 and y>=0 and y<=1 then
        return {mapId=map,x=x,y=y}
    end
end
local function mapStatus(context,map)
    if context.maps[map] then return context.maps[map] end
    local status='unavailable'
    local fn=field(public(C_Map),'GetMapInfo')
    if type(fn)=='function' then
        -- Distinguish unsupported/thrown optional metadata from a successful
        -- contradictory or restricted response. Only the former preserves an
        -- otherwise valid direct waypoint from the original API.
        local ok,raw=pcall(fn,map)
        if ok then
            local prior=captureIssue;captureIssue=false
            local info=public(raw)
            if captureIssue or info~=nil then
                status=integer(field(info,'mapID'),1,2147483647)==map and 'valid' or 'invalid'
            end
            captureIssue=prior or captureIssue
        else captureIssue=true end
    end
    context.maps[map]=status
    return status
end
local function questAreas(api,context,map)
    if context.areas[map]~=nil then return context.areas[map] end
    local prior=captureIssue;captureIssue=false
    local rows=call(field(api,'GetQuestsOnMap'),map)
    local failed=captureIssue;captureIssue=prior or failed
    local found={};local count,highest=0,0
    local ok=type(rows)=='table' and pcall(function()
        for key,row in pairs(rows) do
            count=count+1
            key=integer(public(key),1,1000)
            if count>1000 or not key then error('bound') end
            highest=math.max(highest,key)
            local id=integer(field(row,'questID'),1,2147483647)
            if not id then error('unavailable') end
            local p=gamePoint(field(row,'mapID'),field(row,'x'),field(row,'y'))
            if not p or p.mapId~=map or field(row,'inProgress')~=true
                or field(row,'isQuestStart')~=false or field(row,'isMapIndicatorQuest')~=false then
                found[id]=false
            elseif found[id]==nil then found[id]=p
            elseif found[id] and (found[id].x~=p.x or found[id].y~=p.y) then found[id]=false end
        end
        if count~=highest then error('sparse') end
    end)
    -- A malformed list must not be truncated into a seemingly unique result.
    if ok then context.areas[map]=found
    elseif rows==nil and not failed then context.areas[map]=false
    else context.areas[map]='invalid';captureIssue=true end
    return context.areas[map]
end
local function destination(api,quest,context)
    local id=quest.id
    local map,x,y=call(field(api,'GetNextWaypoint'),id)
    map=integer(map,1,2147483647)
    local direct=gamePoint(map,x,y)
    if direct then
        if mapStatus(context,map)=='invalid' then return nil end
        direct.text=clean(call(field(api,'GetNextWaypointText'),id),200)
        return direct
    end
    local maps,seen={},{}
    local function add(candidate)
        candidate=integer(candidate,1,2147483647)
        if candidate and not seen[candidate] and #maps<3 then
            seen[candidate]=true
            if mapStatus(context,candidate)=='valid' then maps[#maps+1]=candidate end
        end
    end
    add(context.currentMap);add(map)
    if not context.poiRead then
        context.poiRead=true;context.poiMap=call(field(api,'GetMapForQuestPOIs'))
    end
    add(context.poiMap)
    local function currentPhase(point)
        if point and call(field(api,'IsComplete'),id)==quest.complete then return point end
    end
    for _,candidate in ipairs(maps) do
        -- This API returns x,y, not the mapID,x,y tuple of GetNextWaypoint.
        local px,py=call(field(api,'GetNextWaypointForMap'),id,candidate)
        local point=gamePoint(candidate,px,py)
        if point then
            point.text=clean(call(field(api,'GetNextWaypointText'),id),200)
            return currentPhase(point)
        end
    end
    if quest.complete then return nil end
    local unfinished=false
    for _,objective in ipairs(quest.objectives) do if objective.done==false then unfinished=true;break end end
    if not unfinished then return nil end
    local area
    for _,candidate in ipairs(maps) do
        local entries=questAreas(api,context,candidate)
        if entries=='invalid' then return nil end
        local point
        if entries then point=entries[id] end
        if point==false then return nil end
        if point then
            if area and (area.mapId~=point.mapId or area.x~=point.x or area.y~=point.y) then return nil end
            area={mapId=point.mapId,x=point.x,y=point.y,text='Quest area reported by the game; not an exact NPC or spawn location'}
        end
    end
    return currentPhase(area)
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
local function quests(currentMap)
    local api=public(C_QuestLog)
    local rawCount,rawTotal=call(field(api,'GetNumQuestLogEntries'))
    local count=integer(rawCount,0,1000)
    local total=integer(rawTotal,0,1000)
    if not count or type(field(api,'GetInfo'))~='function' or type(field(api,'IsComplete'))~='function' or type(field(api,'GetQuestObjectives'))~='function' then return nil end
    -- At most 25 quest maps plus the current/POI maps; no cache survives this
    -- capture, character, build, phase, or session. POI lists are read once/map.
    local context={currentMap=currentMap,maps={},areas={}}
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
                q.destination=destination(api,q,context)
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
-- Equipment IDs only. Carried materials below read bags 0-4; no links, money or account storage.
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
-- A nil item slot is empty only after a successful public API read.
local function observed(fn,...)
    local prior=captureIssue;captureIssue=false
    local value=call(fn,...)
    local valid=type(fn)=='function' and not captureIssue
    captureIssue=prior or captureIssue
    return value,valid
end
local function feature(api,key)
    local prior=captureIssue;captureIssue=false
    local fn=field(api,key)
    local valid=not captureIssue and (fn==nil or type(fn)=='function')
    captureIssue=prior or not valid
    return fn,valid
end
local function label(value)
    local text=clean(value,200)
    if text and text:find('%S') then return text end
end
local function clock()
    return integer(call(time),0,253402300799)
end
-- Bound both table traversal and indexed reads; sparse/oversized lists stay partial.
local function sequence(raw,limit)
    if type(public(raw))~='table' then return nil,false end
    local count,highest=0,0;local complete=true
    for k in pairs(raw) do
        count=count+1
        if count>limit then complete=false;break end
        k=integer(k,1,limit)
        if not k then complete=false else highest=math.max(highest,k) end
    end
    if count~=highest then complete=false end
    local result=array({})
    for i=1,math.min(highest,limit) do
        local value=field(raw,i)
        if value==nil then complete=false else result[#result+1]=value end
    end
    return result,complete
end
local function professions()
    local skills=public(C_SkillInfo);local trade=public(C_TradeSkillUI)
    local count=integer(call(field(skills,'GetNumSkillLines')),0,2147483647)
    if not count or type(field(skills,'GetSkillLineInfo'))~='function' or type(field(trade,'GetProfessionInfoBySkillLineID'))~='function' then return nil end
    local result={items=array({}),complete=count<=100};local seenSkill,seenProfession={},{}
    for index=1,math.min(count,100) do
        local info=call(field(skills,'GetSkillLineInfo'),index)
        local header=field(info,'isHeader')
        if header==true then
            if field(info,'isCollapsed')~=false then result.complete=false end
        elseif header==false then
            local id=integer(field(info,'skillID'),1,2147483647)
            local meta,ok
            if id then meta,ok=observed(field(trade,'GetProfessionInfoBySkillLineID'),id) end
            local profession=integer(field(meta,'professionID'),1,2147483647)
            if profession then
                local name=label(field(info,'name'));local rank=integer(field(info,'rank'),0,10000);local max=integer(field(info,'maxRank'),0,10000)
                if not name or not rank or not max or rank>max or seenSkill[id] or seenProfession[profession] or #result.items>=20 then result.complete=false
                else
                    seenSkill[id]=true;seenProfession[profession]=true
                    result.items[#result.items+1]={skillLineId=id,professionId=profession,name=name,rank=rank,maxRank=max}
                end
            elseif not ok or integer(field(meta,'professionID'),0,2147483647)~=0 then result.complete=false end
        else result.complete=false end
    end
    result.observedAt=clock()
    if result.observedAt then return result end
end
local function recipeRequirements(trade,id,recipe)
    local schematic=call(field(trade,'GetRecipeSchematic'),id,false)
    if integer(field(schematic,'recipeID'),1,2147483647)~=id or field(schematic,'isRecraft')~=false then return end
    recipe.outputItemId=integer(field(schematic,'outputItemID'),1,2147483647)
    local min=integer(field(schematic,'quantityMin'),1,10000);local max=integer(field(schematic,'quantityMax'),1,10000)
    if not min or not max or min<=max then recipe.outputMin=min;recipe.outputMax=max end
    local slots,complete=sequence(field(schematic,'reagentSlotSchematics'),20)
    if not slots or not complete then return end
    local basic=integer(field(field(public(Enum),'CraftingReagentType'),'Basic'),0,2147483647)
    local itemType=integer(field(field(public(Enum),'TradeskillSlotDataType'),'Reagent'),0,2147483647)
    local reagents=array({});local byId={}
    for _,slot in ipairs(slots) do
        local required=field(slot,'required')
        if required~=false then
            if required~=true or not basic or not itemType or field(slot,'reagentType')~=basic or field(slot,'dataSlotType')~=itemType then return end
            local variables,variablesComplete=sequence(field(slot,'variableQuantities'),1)
            local alternatives,alternativesComplete=sequence(field(slot,'reagents'),1)
            local quantity=integer(field(slot,'quantityRequired'),1,100000)
            if not variables or not variablesComplete or #variables~=0 or not alternatives or not alternativesComplete or #alternatives~=1 or not quantity then return end
            local item=alternatives[1];local itemId=integer(field(item,'itemID'),1,2147483647)
            if not itemId or field(item,'currencyID')~=nil then return end
            if byId[itemId] then
                local total=byId[itemId].required+quantity
                if total>100000 then return end
                byId[itemId].required=total
            else
                local reagent={itemId=itemId,required=quantity,name=label(call(field(public(C_Item),'GetItemNameByID'),itemId))}
                reagents[#reagents+1]=reagent;byId[itemId]=reagent
            end
        end
    end
    recipe.reagentsKnown=true;recipe.reagents=reagents
end
local function recipes(owned)
    if not owned then return nil end
    local trade=public(C_TradeSkillUI)
    if type(field(trade,'GetProfessionSpells'))~='function' or type(field(trade,'GetRecipeInfo'))~='function' then return nil end
    local result={items=array({}),complete=owned.complete};local blocked=false
    -- These view indicators vary between clients. Never confuse guild-system
    -- availability with viewing another player's or guild's recipe source.
    for _,key in ipairs({'IsTradeSkillLinked','IsTradeSkillGuild','IsNPCCrafting'}) do
        local prior=captureIssue;captureIssue=false
        local fn=field(trade,key)
        if fn==nil then
            if key=='IsTradeSkillLinked' then fn=public(IsTradeSkillLinked)
            elseif key=='IsTradeSkillGuild' then fn=public(IsTradeSkillGuild) end
        end
        if captureIssue or (fn~=nil and type(fn)~='function') then blocked=true;result.complete=false end
        captureIssue=prior or captureIssue
        if type(fn)=='function' then
            local value,ok=observed(fn)
            if not ok or value~=false then blocked=true;result.complete=false end
        end
    end
    -- No assumption about the numeric meaning of a source-filter enum. Without
    -- a verified unfiltered state, positive owned facts may be retained, not full coverage.
    local filter,filterKnown=feature(trade,'GetSourceTypeFilter')
    if not filterKnown or filter~=nil then result.complete=false end
    local seen,queried={},0
    if not blocked then for _,profession in ipairs(owned.items) do
        local spells,ok=observed(field(trade,'GetProfessionSpells'),profession.professionId,profession.skillLineId)
        local ids,complete=sequence(spells,100-queried)
        if not ok or not ids or not complete then result.complete=false end
        if ids then for _,raw in ipairs(ids) do
            queried=queried+1
            local id=integer(raw,1,2147483647)
            if not id or seen[id] then result.complete=false
            else
                seen[id]=true
                local info,read=observed(field(trade,'GetRecipeInfo'),id)
                if not read then result.complete=false
                elseif info~=nil then
                    local learned=field(info,'learned')
                    if learned==true then
                        local name=label(field(info,'name'))
                        local matches=integer(field(info,'recipeID'),1,2147483647)==id
                        local inLine,lineKnown=feature(trade,'IsRecipeInSkillLine')
                        if not lineKnown or (inLine~=nil and call(inLine,id,profession.skillLineId)~=true) then matches=false end
                        local professionLearned,professionKnown=feature(trade,'IsRecipeProfessionLearned')
                        if not professionKnown or (professionLearned~=nil and call(professionLearned,id)~=true) then matches=false end
                        if matches and name then
                            local recipe={id=id,skillLineId=profession.skillLineId,name=name,reagentsKnown=false,reagents=array({})}
                            local skillUp=field(info,'canSkillUp');if type(skillUp)=='boolean' then recipe.canSkillUp=skillUp end
                            optional(function()recipeRequirements(trade,id,recipe)end)
                            result.items[#result.items+1]=recipe
                        else result.complete=false end
                    elseif learned~=false then result.complete=false end
                end
            end
        end end
    end end
    result.observedAt=clock()
    if result.observedAt then return result end
end
local function materials()
    local api=public(C_Container)
    if type(field(api,'GetContainerNumSlots'))~='function' or type(field(api,'GetContainerItemInfo'))~='function' then return nil end
    local result={complete=true,scope='bags-0-4',items=array({})};local slots,total=0,0;local byId={}
    for bag=0,4 do
        local count=integer(call(field(api,'GetContainerNumSlots'),bag),0,2147483647)
        if not count then result.complete=false
        else
            total=total+count
            if count>256-slots then result.complete=false end
            for slot=1,math.min(count,256-slots) do
                slots=slots+1
                local info,ok=observed(field(api,'GetContainerItemInfo'),bag,slot)
                if not ok then result.complete=false
                elseif info~=nil then
                    local id=integer(field(info,'itemID'),1,2147483647);local n=integer(field(info,'stackCount'),1,1000000)
                    if not id or not n then result.complete=false
                    elseif byId[id] then
                        if byId[id].count+n>1000000 then result.complete=false else byId[id].count=byId[id].count+n end
                    elseif #result.items>=256 then result.complete=false
                    else
                        local item={itemId=id,count=n,name=label(field(info,'itemName'))}
                        byId[id]=item;result.items[#result.items+1]=item
                    end
                end
            end
        end
    end
    if total==0 then result.complete=false end
    table.sort(result.items,function(a,b)return a.itemId<b.itemId end)
    result.observedAt=clock()
    if result.observedAt then return result end
end
local workshopCache
local function readiness(guid,build)
    local gear=optional(equipment)
    local space=optional(bags)
    if not workshopCache or workshopCache.guid~=guid or workshopCache.build~=build then
        local owned=optional(professions)
        workshopCache={guid=guid,build=build,professions=owned,recipes=optional(function()return recipes(owned)end)}
    end
    local carried=optional(materials)
    local workshop
    if workshopCache.professions or workshopCache.recipes or carried then workshop={professions=workshopCache.professions,recipes=workshopCache.recipes,materials=carried} end
    if gear~=nil or space~=nil or workshop then return {equipment=gear,bags=space,workshop=workshop} end
end
local roster={}
local newCharacterHinted=false
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
                local x,y=vectorField(pos,'x'),vectorField(pos,'y')
                if not coordinate(x) or not coordinate(y) then x,y=call(vectorField(pos,'GetXY'),pos)end
                if coordinate(x) and coordinate(y) then location.x=x;location.y=y end
            end
        end
    end
    local character={id=guid,name=name,realm=realm,className=class,level=level,location=location,updatedAt=now}
    character.clientBuild=clientBuild();character.locale=clean(call(GetLocale),4);character.captureVersion='0.22.0'
    character.race=clean((call(UnitRace,'player')));character.faction=clean((call(UnitFactionGroup,'player')))
    local previous=roster[guid]
    -- WoW writes saved data only on /reload or logout, so a brand-new character is unknown to the app until then.
    if not previous and not newCharacterHinted and type(DEFAULT_CHAT_FRAME)=='table' and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        newCharacterHinted=true
        pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: new character. Type /reload once (or log out) so the desktop app can link it; WoW only saves addon data then.')
    end
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
    character.quests=optional(function()return quests(location.mapId)end);character.progress=optional(progress)
    character.readiness=optional(function()return readiness(guid,character.clientBuild)end)
    -- Collection may cross a clock second. Cached recipes keep their own date.
    now=math.max(now,clock() or now)
    if character.readiness and character.readiness.workshop then
        for _,collection in pairs(character.readiness.workshop) do now=math.max(now,collection.observedAt) end
    end
    character.updatedAt=now
    if type(BackstageForeverGatheringSnapshot)=='function' then
        character.gathering=optional(function()return BackstageForeverGatheringSnapshot(character)end)
        if character.gathering then
            array(character.gathering.records)
            for _,record in ipairs(character.gathering.records)do array(record.itemIds)end
        end
    end
    if type(BackstageForeverMapUpdate)=='function' then pcall(BackstageForeverMapUpdate,character)end
    if type(BackstageForeverHUDUpdate)=="function" then pcall(BackstageForeverHUDUpdate,character) end
    roster[guid]=character
    local chars=array({});for _,c in pairs(roster) do chars[#chars+1]=c end
    table.sort(chars,function(a,b) return a.updatedAt>b.updatedAt end)
    while #chars>100 do roster[chars[#chars].id]=nil;table.remove(chars) end
    local payload={schema=1,characters=chars,activeId=guid,observedAt=now}
    local encoded,encodedNodes=encode(payload)
    local encodedLength=#encoded
    local changed=false
    local function fits()return encodedLength<1048576 and encodedNodes<=200000 end
    local function discard(parent,key)
        if type(parent)~='table' or parent[key]==nil then return end
        -- Measure only the removed subtree, not the entire character twice.
        local detail,nodes=encode(parent[key]);parent[key]=nil;changed=true
        encodedLength=encodedLength-#quote(key)-1-#detail-(next(parent) and 1 or 0)
        encodedNodes=encodedNodes-nodes
    end
    -- Personal history is the first optional export detail to shed. The private
    -- native store is detached; trimming never deletes retained observations.
    for i=#chars,1,-1 do
        if fits() then break end
        local gathering=chars[i].gathering
        if gathering and type(gathering.records)=='table' and #gathering.records>0 then
            local old,nodes=encode(gathering)
            gathering.records=array({});gathering.limited=gathering.totalRecords>0
            local small,smallNodes=encode(gathering)
            encodedLength=encodedLength-#old+#small;encodedNodes=encodedNodes-nodes+smallNodes;changed=true
        end
    end
    -- Workshop is optional: shed it across the roster before older quest/XP/history.
    for i=#chars,1,-1 do
        if fits() then break end
        discard(chars[i].readiness,'workshop')
    end
    -- Retain identities while shedding the oldest remaining optional detail first.
    for i=#chars,1,-1 do
        if fits() then break end
        for _,key in ipairs({'quests','progress','history','readiness'}) do discard(chars[i],key) end
    end
    if changed then encoded,encodedNodes=encode(payload) end
    if #encoded<1048576 and encodedNodes<=200000 then BackstageForeverExport=encoded;return true end
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
    local workshopDirty={SKILL_LINES_CHANGED=true,NEW_RECIPE_LEARNED=true,TRADE_SKILL_LIST_UPDATE=true,TRADE_SKILL_DETAILS_UPDATE=true,TRADE_SKILL_DATA_SOURCE_CHANGED=true,TRADE_SKILL_DATA_SOURCE_CHANGING=true,TRADE_SKILL_SHOW=true,TRADE_SKILL_CLOSE=true}
    local function refresh(event,eventId)
        if not loggedIn then return end
        captureIssue=false
        local ok,captured=pcall(capture,event,eventId)
        if (not ok or not captured) and type(BackstageForeverMapUpdate)=='function' then pcall(BackstageForeverMapUpdate,nil)end
        if type(BackstageForeverHUDCaptureStatus)=='function' then
            pcall(BackstageForeverHUDCaptureStatus,(not ok or not captured) and 'unavailable' or captureIssue and 'partial' or 'ready')
        end
    end
    local function queue(event,eventId)
        if not loggedIn then return end
        local after=field(public(C_Timer),'After')
        if type(after)~='function' then refresh(event,eventId);return end
        if pending then return end
        local token={generation=generation};pending=token
        local ok=pcall(after,.25,function()
            if not loggedIn or token.generation~=generation or pending~=token then return end
            pending=nil;refresh('COALESCED')
        end)
        if not ok then
            pending=nil;refresh(event,eventId)
        end
    end
    -- Focused signal: no character injection, disk write or recursive capture.
    BackstageForeverRequestCapture=function()queue('GATHERING')end
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','PLAYER_LEVEL_UP','ZONE_CHANGED','ZONE_CHANGED_INDOORS','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_ENABLED','PLAYER_LOGOUT','QUEST_LOG_UPDATE','QUEST_ACCEPTED','QUEST_TURNED_IN','UNIT_QUEST_LOG_CHANGED','PLAYER_XP_UPDATE','UPDATE_EXHAUSTION','PLAYER_EQUIPMENT_CHANGED','BAG_UPDATE_DELAYED','GET_ITEM_INFO_RECEIVED','PLAYER_STOPPED_MOVING'}) do pcall(frame.RegisterEvent,frame,event) end
    for event in pairs(workshopDirty) do pcall(frame.RegisterEvent,frame,event) end
    frame:SetScript('OnEvent',function(_,event,eventId)
        -- Logout APIs may already be torn down; persist the last prepared export.
        if event=='PLAYER_LOGOUT' or event=='PLAYER_LOGIN' then
            generation=generation+1;pending=nil;loggedIn=false
            workshopCache=nil
            if type(BackstageForeverHUDSession)=='function' then pcall(BackstageForeverHUDSession,event) end
            if type(BackstageForeverGatheringSession)=='function' then pcall(BackstageForeverGatheringSession,event)end
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
        if workshopDirty[event] then workshopCache=nil end
        if immediate[event] then pending=nil;refresh(event,public(eventId));return end
        queue(event,public(eventId))
    end)
end

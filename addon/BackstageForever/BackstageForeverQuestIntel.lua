-- Quest intel: learns where quest items come from by watching this player's own
-- loot windows, and answers /bf how for the quest you are on. Public API only:
-- it reads loot windows and the quest log, never loots, clicks or moves.
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
local function int(v,lo,hi)
    v=plain(v);if type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi then return v end
end
local function str(v,limit)
    v=plain(v);if type(v)=='string' and v~='' and #v<=(limit or 120) and not v:find('[%z\1-\31\127]') then return v end
end
local function unit(v) v=plain(v);if type(v)=='number' and v==v and v>=0 and v<=1 then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end

-- Retained per character: 200 items x 12 sources x 8 positions at most.
local ITEMS,SOURCES,POSITIONS=200,12,8
-- Exported to the desktop app: the most recent part only, to keep the export small.
local EXPORT_ITEMS,EXPORT_SOURCES,EXPORT_POSITIONS=80,8,4

-- Pure: a loot source GUID -> 'creature'|'object', id.
function BackstageForeverLootSourceKind(guid)
    guid=str(guid,200);if not guid then return nil end
    local kind,raw=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-[%w_]+$')
    local id=raw and #raw<=10 and int(tonumber(raw),1,2147483647)
    if not id then return nil end
    if kind=='Creature' or kind=='Vehicle' then return 'creature',id end
    if kind=='GameObject' then return 'object',id end
end

local function position(p)
    if type(p)~='table' then return nil end
    local map,x,y=int(p.mapId,1,2147483647),unit(p.x),unit(p.y)
    if map and x and y then return {mapId=map,x=x,y=y} end
end
local function source(s)
    if type(s)~='table' then return nil end
    local kind,id=plain(s.kind),int(s.id,1,2147483647)
    local count,seen=int(s.count,1,1000000),int(s.lastSeen,0,253402300799)
    if (kind~='creature' and kind~='object') or not id or not count or not seen then return nil end
    local out={kind=kind,id=id,name=str(s.name,120),count=count,lastSeen=seen,positions={}}
    if type(s.positions)=='table' then
        for i=1,min(#s.positions,POSITIONS) do local p=position(s.positions[i]);if p then out.positions[#out.positions+1]=p end end
    end
    return out
end
local function item(v)
    if type(v)~='table' then return nil end
    local id,seen=int(v.itemId,1,2147483647),int(v.lastSeen,0,253402300799)
    if not id or not seen or type(v.questIds)~='table' or type(v.sources)~='table' then return nil end
    local out={itemId=id,name=str(v.name,120),lastSeen=seen,questIds={},sources={}}
    local quests={}
    for i=1,min(#v.questIds,5) do local q=int(v.questIds[i],1,2147483647);if q and not quests[q] then quests[q]=true;out.questIds[#out.questIds+1]=q end end
    local keys={}
    for i=1,min(#v.sources,SOURCES) do
        local s=source(v.sources[i]);local key=s and s.kind..s.id
        if s and not keys[key] then keys[key]=true;out.sources[#out.sources+1]=s end
    end
    if #out.questIds==0 or #out.sources==0 then return nil end
    return out
end
local db
local function store()
    if db then return db end
    local raw=plain(BackstageForeverQuestItemSourcesDB);local items,seen={},{}
    if type(raw)=='table' and raw.schemaVersion==1 and type(raw.items)=='table' then
        for i=1,min(#raw.items,ITEMS) do
            local it=item(raw.items[i]);if it and not seen[it.itemId] then seen[it.itemId]=true;items[#items+1]=it end
        end
    end
    db={schemaVersion=1,items=items};BackstageForeverQuestItemSourcesDB=db
    return db
end
local function front(list,index,cap)
    local v=table.remove(list,index);table.insert(list,1,v)
    while #list>cap do table.remove(list) end
    return v
end
-- Pure enough to test: fold one looted stack into the retained journal.
function BackstageForeverLootSourceRecord(entry)
    local d=store()
    local id,count,at=int(entry.itemId,1,2147483647),int(entry.count,1,1000000) or 1,int(entry.at,0,253402300799)
    local kind,sid=entry.kind,int(entry.sourceId,1,2147483647)
    if not id or not at or not sid or (kind~='creature' and kind~='object') or type(entry.questIds)~='table' then return nil end
    local it
    for i,v in ipairs(d.items) do if v.itemId==id then it=front(d.items,i,ITEMS);break end end
    if not it then it={itemId=id,questIds={},sources={},lastSeen=at};table.insert(d.items,1,it);while #d.items>ITEMS do table.remove(d.items) end end
    it.name=str(entry.name,120) or it.name;it.lastSeen=at
    for _,q in ipairs(entry.questIds) do
        q=int(q,1,2147483647);local known=false
        for _,k in ipairs(it.questIds) do if k==q then known=true end end
        if q and not known then table.insert(it.questIds,1,q);while #it.questIds>5 do table.remove(it.questIds) end end
    end
    local s
    for i,v in ipairs(it.sources) do if v.kind==kind and v.id==sid then s=front(it.sources,i,SOURCES);break end end
    if not s then s={kind=kind,id=sid,count=0,positions={}};table.insert(it.sources,1,s);while #it.sources>SOURCES do table.remove(it.sources) end end
    s.count=min(s.count+count,1000000);s.lastSeen=at;s.name=str(entry.sourceName,120) or s.name
    local p=position(entry.position)
    if p then
        p.x=floor(p.x*10000+.5)/10000;p.y=floor(p.y*10000+.5)/10000
        local near
        for i,q in ipairs(s.positions) do if q.mapId==p.mapId and (q.x-p.x)^2+(q.y-p.y)^2<=.02^2 then near=i;break end end
        if near then front(s.positions,near,POSITIONS) else table.insert(s.positions,1,p);while #s.positions>POSITIONS do table.remove(s.positions) end end
    end
    return it
end
function BackstageForeverLootSourcesItems() return store().items end
-- Export copy for the character capture (most recent first, bounded, no empty lists).
function BackstageForeverLootSourcesSnapshot(owner)
    local me=str(call(UnitGUID,'player'),200)
    if not me or str(owner,200)~=me then return nil end
    local d=store();if #d.items==0 then return nil end
    local items={}
    for i=1,min(#d.items,EXPORT_ITEMS) do
        local v=d.items[i];local out={itemId=v.itemId,name=v.name,lastSeen=v.lastSeen,questIds={},sources={}}
        for j=1,#v.questIds do out.questIds[j]=v.questIds[j] end
        for j=1,min(#v.sources,EXPORT_SOURCES) do
            local s=v.sources[j];local c={kind=s.kind,id=s.id,name=s.name,count=s.count,lastSeen=s.lastSeen}
            if #s.positions>0 then
                c.positions={}
                for k=1,min(#s.positions,EXPORT_POSITIONS) do local p=s.positions[k];c.positions[k]={mapId=p.mapId,x=p.x,y=p.y} end
            end
            out.sources[j]=c
        end
        items[#items+1]=out
    end
    return {schemaVersion=1,items=items}
end

-- The item part of an objective line: "Bottle of Whispering Elixir: 3/8" -> the name.
local function objectiveName(text)
    text=str(text,200);if not text then return nil end
    local name=text:match('^(.-)%s*:%s*%d+%s*/%s*%d+%s*$') or text:match('^%d+%s*/%s*%d+%s+(.+)$') or text
    name=name:gsub('^%s+',''):gsub('%s+$','')
    if name~='' then return name end
end
BackstageForeverObjectiveName=objectiveName
-- One pass over the log: quests with their objectives (bounded), headers skipped.
local function questLog()
    local api=plain(C_QuestLog);local list={}
    local n=int((call(field(api,'GetNumQuestLogEntries'))),0,1000)
    if not n then return list end
    for i=1,min(n,60) do
        local info=call(field(api,'GetInfo'),i)
        local id=int(field(info,'questID'),1,2147483647)
        if type(info)=='table' and field(info,'isHeader')~=true and id then
            local q={index=i,id=id,title=str(field(info,'title'),200) or ('Quest #'..id),complete=call(field(api,'IsComplete'),id)==true,objectives={}}
            local raw=call(field(api,'GetQuestObjectives'),id)
            for j=1,5 do
                local o=field(raw,j);if o==nil then break end
                local text=str(field(o,'text'),200)
                if text then q.objectives[#q.objectives+1]={text=text,done=field(o,'finished')==true,type=str(field(o,'type'),40)} end
            end
            list[#list+1]=q
            if #list>=25 then break end
        end
    end
    return list
end
local function wantedItems(log)
    local wanted,ids={},{}
    for _,q in ipairs(log) do
        ids[q.id]=true
        for _,o in ipairs(q.objectives) do
            local name=o.type=='item' and objectiveName(o.text)
            if name then
                local key=name:lower();wanted[key]=wanted[key] or {}
                table.insert(wanted[key],q.id)
            end
        end
    end
    return wanted,ids
end
local function here()
    local api=plain(C_Map)
    local map=int((call(field(api,'GetBestMapForUnit'),'player')),1,2147483647)
    if not map then return nil end
    local p=call(field(api,'GetPlayerMapPosition'),map,'player')
    local x,y=unit(field(p,'x')),unit(field(p,'y'))
    if not x or not y then local gx=field(p,'GetXY');if type(gx)=='function' then local a,b=call(gx,p);x,y=unit(a),unit(b) end end
    if x and y then return {mapId=map,x=x,y=y} end
end
-- Names of creatures you targeted or pointed at recently, by GUID (bounded, session only).
local names,nameCount={},0
local function remember(u)
    local guid=str(call(UnitGUID,u),200);local name=str((call(UnitName,u)),120)
    if not guid or not name or not BackstageForeverLootSourceKind(guid) then return end
    if not names[guid] then nameCount=nameCount+1 end
    if nameCount>60 then names,nameCount={},1 end
    names[guid]=name
end
local function tooltipObjectName()
    local tip=plain(GameTooltip)
    if type(tip)~='table' or call(field(tip,'IsShown'),tip)~=true then return nil end
    if call(field(tip,'GetUnit'),tip) then return nil end
    local line=plain(_G and _G.GameTooltipTextLeft1)
    return str(call(field(line,'GetText'),line),120)
end
local lastKey,lastAt
local function onLoot()
    for _,fn in ipairs({'GetNumLootItems','GetLootSlotInfo','GetLootSlotLink','GetLootSourceInfo'}) do if type(plain(_G[fn]))~='function' then return end end
    local n=int((call(GetNumLootItems)),1,64);if not n then return end
    local log=questLog();if #log==0 then return end
    local wanted,inLog=wantedItems(log)
    local at=int((call(time)),0,253402300799);if not at then return end
    local found,keyParts,objects={},{},{}
    for slot=1,n do
        local _,name,quantity,_,_,_,isQuestItem,questId=call(GetLootSlotInfo,slot)
        name=str(name,120)
        local link=str((call(GetLootSlotLink,slot)),1000)
        local raw=link and link:match('|Hitem:(%d+)')
        local id=raw and #raw<=10 and int(tonumber(raw),1,2147483647)
        local quests=name and wanted[name:lower()]
        if not quests and isQuestItem==true then local q=int(questId,1,2147483647);if q and inLog[q] then quests={q} end end
        if id and quests then
            local r={pcall(GetLootSourceInfo,slot)}
            if r[1] then
                for j=2,min(#r,33),2 do
                    local guid=str(plain(r[j]),200);local kind,sid=BackstageForeverLootSourceKind(guid)
                    if kind then
                        local amount=int(plain(r[j+1]),1,1000000) or int(quantity,1,1000000) or 1
                        found[#found+1]={itemId=id,name=name,questIds=quests,kind=kind,sourceId=sid,guid=guid,count=amount}
                        keyParts[#keyParts+1]=guid..':'..id..':'..amount
                        if kind=='object' then objects[guid]=true end
                    end
                end
            end
        end
    end
    if #found==0 then return end
    -- LOOT_READY and LOOT_OPENED both describe the same window: record it once.
    local key=table.concat(keyParts,'|');local clock=tonumber((call(GetTime))) or 0
    if key==lastKey and lastAt and clock-lastAt<5 then return end
    lastKey,lastAt=key,clock
    local objectCount=0;for _ in pairs(objects) do objectCount=objectCount+1 end
    local objectName=objectCount==1 and tooltipObjectName() or nil
    local target,mouse=str(call(UnitGUID,'target'),200),str(call(UnitGUID,'mouseover'),200)
    local p=here()
    for _,f in ipairs(found) do
        local name
        if f.kind=='creature' then
            name=names[f.guid] or (f.guid==target and str((call(UnitName,'target')),120)) or (f.guid==mouse and str((call(UnitName,'mouseover')),120)) or nil
        else name=objectName end
        BackstageForeverLootSourceRecord({itemId=f.itemId,name=f.name,questIds=f.questIds,kind=f.kind,sourceId=f.sourceId,sourceName=name,count=f.count,position=p,at=at})
    end
end

-- /bf how ---------------------------------------------------------------
local VERBS={'travel','find','collect','kill','slay','recover','retrieve','bring','gather','search','seek','go ','head','return','obtain','destroy','defeat','speak','deliver','hunt','explore','venture','look','take'}
-- Pure: the sentences of a quest description that say where to go or what to do.
function BackstageForeverHowHints(description,limit)
    description=type(description)=='string' and description or '';limit=limit or 2
    local out={}
    for sentence in description:gmatch('[^%.!%?]+[%.!%?]*') do
        sentence=sentence:gsub('^%s+',''):gsub('%s+$','')
        local lower=' '..sentence:lower()..' '
        for _,v in ipairs(VERBS) do
            if lower:find('[^%a]'..v) then
                if #sentence>220 then sentence=(sentence:sub(1,217):match('^(.*%S) ') or sentence:sub(1,217))..'...' end
                out[#out+1]=sentence;break
            end
        end
        if #out>=limit then break end
    end
    return out
end
local function pct(v) return ('%.1f'):format(v*100) end
-- Pure: how you came by an item so far, in one plain line.
function BackstageForeverHowSource(learned,mapName)
    if type(learned)~='table' or type(learned.sources)~='table' or #learned.sources==0 then return nil end
    local creatures,objects,named,where={},0,{},nil
    for _,s in ipairs(learned.sources) do
        if s.kind=='creature' then
            if #creatures<3 then creatures[#creatures+1]=s.name or ('creature #'..s.id) end
        else
            objects=objects+1
            if s.name and #named<2 then named[#named+1]=s.name end
        end
        if not where and s.positions and s.positions[1] then where=s.positions[1] end
    end
    local parts={}
    if #creatures>0 then parts[#parts+1]='dropped by '..table.concat(creatures,', ') end
    if objects>0 then parts[#parts+1]='you looted these from '..(#named>0 and table.concat(named,', ') or 'objects lying around') end
    local line=table.concat(parts,'; ')
    if where then
        local zone=type(mapName)=='function' and mapName(where.mapId) or nil
        line=line..' near '..pct(where.x)..', '..pct(where.y)..(zone and (' ('..zone..')') or '')
    end
    return line
end
-- Pure: the whole answer for one quest, as chat lines.
function BackstageForeverHowLines(quest,learnedItems,mapName)
    local lines={'How to do: '..tostring(quest.title)}
    if quest.complete then lines[#lines+1]='All objectives done: go back and turn it in.' end
    local byName,byQuest={},{}
    for _,it in ipairs(learnedItems or {}) do
        if it.name then byName[it.name:lower()]=it end
        for _,q in ipairs(it.questIds or {}) do if q==quest.id then byQuest[#byQuest+1]=it end end
    end
    local items=0
    for _,o in ipairs(quest.objectives or {}) do
        lines[#lines+1]='- '..o.text..(o.done and ' (done)' or '')
        if o.type=='item' then
            items=items+1
            local name=objectiveName(o.text);local learned=name and byName[name:lower()]
            if not learned and #byQuest==1 then learned=byQuest[1] end
            local how=BackstageForeverHowSource(learned,mapName)
            if how then lines[#lines+1]='  Learned: '..how
            elseif not o.done then lines[#lines+1]='  Not learned yet: loot one and /bf how will remember where it came from.' end
        end
    end
    local text=type(quest.text)=='table' and quest.text or {}
    local hints=BackstageForeverHowHints(text.description,2)
    if #hints>0 then lines[#lines+1]='Quest says: '..table.concat(hints,' ')
    elseif text.objectives then lines[#lines+1]='Goal: '..text.objectives end
    return lines
end
local function mapName(id)
    local info=call(field(plain(C_Map),'GetMapInfo'),id)
    return str(field(info,'name'),100)
end
local function tracked(log)
    local api=plain(C_QuestLog)
    local id=int((call(field(api,'GetQuestIDForQuestWatchIndex'),1)),1,2147483647)
    if not id then
        local index=int((call(plain(GetQuestIndexForWatch),1)),1,1000)
        for _,q in ipairs(log) do if q.index==index then return q end end
    end
    for _,q in ipairs(log) do if q.id==id then return q end end
end
function BackstageForeverHowCommand(message)
    local wanted=type(message)=='string' and message:match('^%s*%a+%s+(.-)%s*$') or ''
    local log=questLog()
    if #log==0 then say('Your quest log is empty. Pick up a quest first (/bf next shows the nearest).');return nil end
    local quest
    if wanted~='' then
        local q=wanted:lower()
        for _,v in ipairs(log) do if v.title:lower():find(q,1,true) then quest=v;break end end
        if not quest then say('No quest in your log matches "'..wanted:sub(1,60)..'".');return nil end
    end
    quest=quest or tracked(log)
    if not quest then for _,v in ipairs(log) do if not v.complete then quest=v;break end end end
    quest=quest or log[1]
    if type(BackstageForeverQuestLogText)=='function' then
        local ok,text=pcall(BackstageForeverQuestLogText,quest.index,quest.id)
        if ok and type(text)=='table' then quest.text=text end
    end
    local lines=BackstageForeverHowLines(quest,store().items,mapName)
    for i=1,min(#lines,12) do say(lines[i]) end
    return lines
end

if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        for _,e in ipairs({'PLAYER_LOGIN','LOOT_READY','LOOT_OPENED','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT'}) do pcall(frame.RegisterEvent,frame,e) end
        pcall(frame.SetScript,frame,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then db=nil;names,nameCount={},0;pcall(store)
            elseif event=='PLAYER_TARGET_CHANGED' then pcall(remember,'target')
            elseif event=='UPDATE_MOUSEOVER_UNIT' then pcall(remember,'mouseover')
            elseif event=='LOOT_READY' or event=='LOOT_OPENED' then pcall(onLoot) end
        end)
    end
end

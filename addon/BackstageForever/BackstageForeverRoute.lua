-- Route guide, objective tooltips and zone arrivals. Public API only: it reads the quest log,
-- the map and tooltips, and places the game's own waypoint arrow. It never accepts, turns in,
-- moves, targets or clicks anything for the player.
--   /bf route          show or hide the step frame
--   /bf route next|back browse steps;  /bf route arrow   arrow follows the current step on/off
local floor,min,max,sqrt=math.floor,math.min,math.max,math.sqrt
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
local function method(o,k,...)return call(field(o,k),o,...)end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi then return v end end
local function unit(v) v=plain(v);if type(v)=='number' and v==v and v>=0 and v<=1 then return v end end
local function str(v,limit) v=plain(v);if type(v)=='string' and v~='' and #v<=(limit or 160) and not v:find('[%z\1-\31\127]') then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end
local function combat() return call(InCombatLockdown)==true end
local MAX_STEPS,MERGE=15,0.012

local settings
local function loadSettings()
    if type(BackstageForeverRouteSettings)~='table' then BackstageForeverRouteSettings={} end
    settings=BackstageForeverRouteSettings
    if settings.shown==nil then settings.shown=false end
    if settings.arrow==nil then settings.arrow=true end
    if settings.tooltips==nil then settings.tooltips=true end
    if settings.arrivals==nil then settings.arrivals=true end
    return settings
end

-- Pure: candidate stops -> an ordered route from the player's spot.
-- stops: {kind='turnin'|'objective'|'pickup', x, y, title, detail, questId}
-- Pick-ups at the same spot merge into one step; the order is a nearest-next walk where
-- finishing what you carry (turn-ins, objectives) breaks ties before new pick-ups.
function BackstageForeverRouteSteps(px,py,stops)
    local pool={}
    for _,s in ipairs(type(stops)=='table' and stops or {}) do
        if type(s)=='table' and unit(s.x) and unit(s.y) and (s.kind=='turnin' or s.kind=='objective' or s.kind=='pickup') then
            local merged=false
            if s.kind=='pickup' then
                for _,p in ipairs(pool) do
                    if p.kind=='pickup' and (p.x-s.x)^2+(p.y-s.y)^2<=MERGE^2 then
                        p.quests[#p.quests+1]={id=s.questId,title=s.title};merged=true;break
                    end
                end
            end
            if not merged then pool[#pool+1]={kind=s.kind,x=s.x,y=s.y,title=s.title,detail=s.detail,questId=s.questId,npc=s.npc,quests=s.kind=='pickup' and {{id=s.questId,title=s.title}} or nil} end
        end
    end
    local out={}
    local cx,cy=unit(px) or .5,unit(py) or .5
    while #pool>0 and #out<MAX_STEPS do
        local best,bestCost
        for i,p in ipairs(pool) do
            local cost=sqrt((p.x-cx)^2+(p.y-cy)^2)+(p.kind=='pickup' and .015 or 0)
            if not bestCost or cost<bestCost then best,bestCost=i,cost end
        end
        local p=table.remove(pool,best)
        if p.kind=='pickup' then
            local names={}
            for i,q in ipairs(p.quests) do if i<=3 then names[#names+1]=q.title or ('quest '..tostring(q.id)) end end
            p.text=#p.quests>1 and ('Pick up '..#p.quests..' quests from '..(p.npc or 'the quest giver')..': '..table.concat(names,', ')..(#p.quests>3 and '…' or ''))
                or ('Pick up “'..(names[1] or 'a quest')..'” from '..(p.npc or 'the quest giver'))
        elseif p.kind=='turnin' then p.text='Hand in “'..(p.title or 'your quest')..'”'..(p.npc and (' to '..p.npc) or '')
        else p.text=(p.title and ('“'..p.title..'”: ') or '')..(p.detail or 'Work on the objective here') end
        out[#out+1]=p;cx,cy=p.x,p.y
    end
    return out
end

-- Live reads (public API).
local function questLog()
    local api=plain(C_QuestLog);local list={}
    local n=int(call(field(api,'GetNumQuestLogEntries')),0,200) or 0
    for i=1,min(n,60) do
        local info=call(field(api,'GetInfo'),i)
        local id=type(info)=='table' and not field(info,'isHeader') and int(field(info,'questID'),1,2147483647)
        if id then list[#list+1]={id=id,title=str(field(info,'title'),120) or str(call(field(api,'GetTitleForQuestID'),id),120),complete=call(field(api,'IsComplete'),id)==true} end
    end
    return list
end
local function objectives(id)
    local rows=call(field(plain(C_QuestLog),'GetQuestObjectives'),id);local out={}
    if type(rows)=='table' then for i=1,min(#rows,8) do local o=rows[i]
        if type(o)=='table' then out[#out+1]={text=str(field(o,'text'),160),done=field(o,'finished')==true,kind=str(field(o,'type'),20)} end
    end end
    return out
end
local function where()
    local mapApi=plain(C_Map)
    local mapId=int(call(field(mapApi,'GetBestMapForUnit'),'player'),1,2147483647)
    local pos=mapId and call(field(mapApi,'GetPlayerMapPosition'),mapId,'player')
    local x,y;if pos then x,y=method(pos,'GetXY') end
    return mapId,unit(x),unit(y)
end
local function me()
    local f=str(call(UnitFactionGroup,'player'),20)
    return {level=int(call(UnitLevel,'player'),1,1000),faction=f=='Horde' and 'H' or f=='Alliance' and 'A' or nil,className=str(call(UnitClass,'player'),40)}
end
local function stopsFor(mapId)
    local log=questLog();local inLog,complete,byId={},{},{}
    for _,q in ipairs(log) do inLog[q.id]=true;byId[q.id]=q;if q.complete then complete[q.id]=true end end
    local completed={}
    local ids=call(field(plain(C_QuestLog),'GetAllCompletedQuestIDs'))
    if type(ids)=='table' then for _,v in pairs(ids) do v=int(v,1,2147483647);if v then completed[v]=true end end end
    -- Where WoW itself marks quests on this map: objectives for open quests, hand-ins for finished ones.
    local spots={}
    local list=call(field(plain(C_QuestLog),'GetQuestsOnMap'),mapId)
    if type(list)=='table' then for _,info in ipairs(list) do
        local id,x,y=int(field(info,'questID'),1,2147483647),unit(field(info,'x')),unit(field(info,'y'))
        if id and x and y then spots[id]={x=x,y=y} end
    end end
    local stops={}
    if type(BackstageForeverAdvisorPoints)=='function' then
        local ok,rows=pcall(BackstageForeverAdvisorPoints,mapId,me(),completed,inLog,complete,{class=false,profession=false,flight=false},spots)
        for _,r in ipairs(ok and type(rows)=='table' and rows or {}) do
            if r.layer=='handin' then
                local q=byId[r.questId]
                stops[#stops+1]={kind='turnin',x=r.x,y=r.y,questId=r.questId,title=q and q.title or r.title,npc=(r.detail and not r.detail:find('^Hand in') and not r.detail:find('^Where WoW') and r.detail) or (r.title and not r.title:find('^Hand in') and r.title) or nil}
            elseif r.layer=='pickup' then
                stops[#stops+1]={kind='pickup',x=r.x,y=r.y,questId=r.questId,title=(r.detail or ''):gsub(' %(level %d+%)$',''),npc=r.title}
            end
        end
    end
    for _,q in ipairs(log) do
        local s=spots[q.id]
        if s and not q.complete then
            local next
            for _,o in ipairs(objectives(q.id)) do if not o.done and o.text then next=o.text;break end end
            stops[#stops+1]={kind='objective',x=s.x,y=s.y,questId=q.id,title=q.title,detail=next}
        end
    end
    return stops
end

-- The step frame.
local frame,lines,steps,index,mapNow,lastArrow,pending=nil,{},{},1,nil,nil,false
local function setArrow(step)
    if not step or not mapNow or combat() or not settings.arrow then return end
    local key=mapNow..':'..floor(step.x*1000)..':'..floor(step.y*1000)
    if key==lastArrow then return end
    local mapApi=plain(C_Map)
    if call(field(mapApi,'CanSetUserWaypointOnMap'),mapNow)~=true then return end
    local point=call(field(plain(UiMapPoint),'CreateFromCoordinates'),mapNow,step.x,step.y)
    if not point or not pcall(field(mapApi,'SetUserWaypoint'),point) then return end
    local st=plain(C_SuperTrack)
    if type(field(st,'SetSuperTrackedUserWaypoint'))=='function' then pcall(st.SetSuperTrackedUserWaypoint,true) end
    lastArrow=key
end
local function paint()
    if not frame then return end
    local s=steps[index]
    if not s then
        method(lines.title,'SetText','BF Route')
        method(lines.body,'SetText','Nothing recorded for your level here. The desktop app\'s Now page suggests where to go next.')
        method(lines.next,'SetText','')
        return
    end
    method(lines.title,'SetText',('BF Route · step %d of %d'):format(index,#steps))
    method(lines.body,'SetText',s.text..(' |cff9d9d9d(%.1f, %.1f)|r'):format(s.x*100,s.y*100))
    local n=steps[index+1]
    method(lines.next,'SetText',n and ('|cff9d9d9dThen:|r '..n.text) or '|cff9d9d9dLast step here.|r')
    if index==1 then setArrow(s) end
end
local function build()
    if frame or type(CreateFrame)~='function' then return frame end
    frame=CreateFrame('Frame','BackstageForeverRouteFrame',UIParent)
    if not frame then return nil end
    method(frame,'SetSize',300,96);method(frame,'SetPoint','TOP',UIParent,'TOP',0,-120)
    method(frame,'SetFrameStrata','MEDIUM');method(frame,'SetMovable',true);method(frame,'EnableMouse',true)
    method(frame,'SetClampedToScreen',true);method(frame,'RegisterForDrag','LeftButton')
    method(frame,'SetScript','OnDragStart',function(f) if not combat() then method(f,'StartMoving') end end)
    method(frame,'SetScript','OnDragStop',function(f) method(f,'StopMovingOrSizing') end)
    local bg=method(frame,'CreateTexture',nil,'BACKGROUND')
    if bg then method(bg,'SetAllPoints',frame);method(bg,'SetColorTexture',.09,.05,.03,.88) end
    local edge=method(frame,'CreateTexture',nil,'BORDER')
    if edge then method(edge,'SetPoint','TOPLEFT',frame,'TOPLEFT',0,0);method(edge,'SetPoint','TOPRIGHT',frame,'TOPRIGHT',0,0);method(edge,'SetHeight',2);method(edge,'SetColorTexture',.78,.6,.29,1) end
    local function text(font,y,h)
        local t=method(frame,'CreateFontString',nil,'OVERLAY',font)
        if t then method(t,'SetPoint','TOPLEFT',frame,'TOPLEFT',10,y);method(t,'SetWidth',280);method(t,'SetJustifyH','LEFT');if h then method(t,'SetHeight',h) end end
        return t
    end
    lines.title=text('GameFontNormal',-8);lines.body=text('GameFontHighlight',-26,32);lines.next=text('GameFontHighlightSmall',-62,26)
    local function button(label,x,fn)
        local b=CreateFrame('Button',nil,frame,'UIPanelButtonTemplate')
        if b then method(b,'SetSize',22,18);method(b,'SetPoint','TOPRIGHT',frame,'TOPRIGHT',x,-5);method(b,'SetText',label);method(b,'SetScript','OnClick',fn) end
    end
    button('x',-4,function() BackstageForeverRouteCommand('route') end)
    button('>',-28,function() BackstageForeverRouteCommand('route next') end)
    button('<',-52,function() BackstageForeverRouteCommand('route back') end)
    return frame
end
function BackstageForeverRouteRefresh()
    pending=false
    if not settings then loadSettings() end
    local mapId,x,y=where()
    if not mapId then return end
    mapNow=mapId
    steps=BackstageForeverRouteSteps(x,y,stopsFor(mapId));index=1
    if settings.shown and build() then method(frame,'Show');paint() end
    return steps
end
local function soon()
    if pending then return end
    pending=true
    local t=plain(C_Timer)
    if type(field(t,'After'))=='function' then pcall(t.After,.5,function() pcall(BackstageForeverRouteRefresh) end) else pcall(BackstageForeverRouteRefresh) end
end
function BackstageForeverRouteCommand(message)
    if not settings then loadSettings() end
    local arg=type(message)=='string' and message:lower():match('^route%s*(%a*)') or ''
    if arg=='next' then index=min(#steps,index+1)
    elseif arg=='back' then index=max(1,index-1)
    elseif arg=='arrow' then settings.arrow=not settings.arrow;lastArrow=nil;say('Route arrow '..(settings.arrow and 'on: it follows your current step.' or 'off.'))
    elseif arg=='' then settings.shown=not settings.shown
    else return say('Use /bf route, /bf route next, /bf route back or /bf route arrow.') end
    if settings.shown then
        if arg=='' then BackstageForeverRouteRefresh();say('Route on: one step at a time, with the arrow on the current step. /bf route hides it.') end
        if build() then method(frame,'Show');paint() end
    elseif frame then method(frame,'Hide');if arg=='' then say('Route hidden. /bf route shows it again.') end end
end

-- A1: quest progress in enemy tooltips (kills by name; drops from what this player has looted).
function BackstageForeverObjectiveLines(name,npcId,log,itemSources)
    local out={}
    if type(name)~='string' or name=='' then return out end
    local lower=name:lower()
    local drops={}
    for _,it in ipairs(type(itemSources)=='table' and itemSources or {}) do
        for _,s in ipairs(type(it.sources)=='table' and it.sources or {}) do
            if s.kind=='creature' and npcId and s.id==npcId and it.name then drops[#drops+1]=it.name:lower() end
        end
    end
    for _,q in ipairs(log or {}) do
        if not q.complete then for _,o in ipairs(q.objectives or {}) do
            local t=o.text and o.text:lower()
            if t and not o.done then
                local hit=t:find(lower,1,true)
                for _,d in ipairs(drops) do if t:find(d,1,true) then hit=true end end
                if hit and #out<3 then out[#out+1]=(q.title or 'Quest')..': '..o.text end
            end
        end end
    end
    return out
end
local function onUnitTooltip(tip)
    if not settings or not settings.tooltips or combat() then return end
    local name,u=method(tip,'GetUnit')
    if not u or call(UnitIsPlayer,u) then return end
    local guid=str(call(UnitGUID,u),80);local npcId
    if guid then local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)');if kind=='Creature' then npcId=tonumber(id) end end
    local log=questLog()
    for _,q in ipairs(log) do q.objectives=objectives(q.id) end
    local db=plain(BackstageForeverQuestItemSourcesDB)
    for _,line in ipairs(BackstageForeverObjectiveLines(str(name,80),npcId,log,type(db)=='table' and db.items or nil)) do
        method(tip,'AddLine','|cffffd100◆|r '..line,1,1,1,true)
    end
    method(tip,'Show')
end

-- G2: zone arrival banner with the zone's level band and quests on offer.
local lastZone
local function arrival()
    if not settings.arrivals or combat() then return end
    local mapId=where()
    if not mapId or mapId==lastZone then return end
    local first=lastZone==nil;lastZone=mapId
    if first then return end
    local info=call(field(plain(C_Map),'GetMapInfo'),mapId)
    local name=str(field(info,'name'),60);if not name then return end
    local band
    for _,z in ipairs(field(plain(BackstageForeverAdvisorData),'zones') or {}) do if type(z)=='table' and z.m==mapId then band=z;break end end
    local sub=band and int(band.lo,1,100) and ('Levels '..band.lo..'–'..(int(band.hi,1,100) or band.lo)) or nil
    local n=0
    if type(BackstageForeverAdvisorPoints)=='function' then
        local ok,rows=pcall(BackstageForeverAdvisorPoints,mapId,me(),{},{},{},{class=false,profession=false,flight=false,handin=false})
        if ok and type(rows)=='table' then n=#rows end
    end
    if n>0 then sub=(sub and sub..' · ' or '')..n..' quests for your level' end
    if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,name,sub,true) end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','QUEST_ACCEPTED','QUEST_TURNED_IN','QUEST_LOG_UPDATE','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_ENABLED','PLAYER_LEVEL_UP'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if not settings then loadSettings() end
            if event=='PLAYER_LOGIN' then
                local tip=plain(GameTooltip)
                if tip and type(field(tip,'HookScript'))=='function' then pcall(tip.HookScript,tip,'OnTooltipSetUnit',onUnitTooltip) end
                lastZone=(where())
            end
            if event=='ZONE_CHANGED_NEW_AREA' then pcall(arrival) end
            if settings.shown and not combat() then soon() end
        end)
    end
end

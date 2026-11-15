-- Route guide, objective tooltips and zone arrivals. Public API only: it reads the quest log,
-- the map and tooltips, and places the game's own waypoint arrow. It never accepts, turns in,
-- moves, targets or clicks anything for the player.
--   /bf route          show or hide the step frame
--   /bf route next|back browse steps;  /bf route arrow   arrow follows the current step on/off
--   /bf route guide     the full guided route for your race (0.50, roadmap 4.1); /bf route zone back to this zone
--   /bf route skip      skip the current guided step
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
    if settings.mode~='guide' then settings.mode='zone' end
    if type(settings.skipped)~='table' then settings.skipped={} end
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
local guide=nil -- {index,total,note,top} while the guided route is shown
local function setArrow(step)
    local stepMap=step and step.mapId or mapNow
    if not step or not stepMap or not step.x or combat() or not settings.arrow then return end
    local key=stepMap..':'..floor(step.x*1000)..':'..floor(step.y*1000)
    if key==lastArrow then return end
    local mapApi=plain(C_Map)
    if call(field(mapApi,'CanSetUserWaypointOnMap'),stepMap)~=true then return end
    local point=call(field(plain(UiMapPoint),'CreateFromCoordinates'),stepMap,step.x,step.y)
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
    if guide then
        method(lines.title,'SetText',('BF Guide · step %d of %d · level %d'):format(guide.index+index-1,guide.total,s.level or 1))
    else
        method(lines.title,'SetText',('BF Route · step %d of %d'):format(index,#steps))
    end
    local where=s.x and (' |cff7a5a30(%.1f, %.1f%s)|r'):format(s.x*100,s.y*100,(s.mapId and s.mapId~=mapNow and BackstageForeverFindMaps and BackstageForeverFindMaps[s.mapId]) and (' in '..BackstageForeverFindMaps[s.mapId]) or '') or ''
    method(lines.body,'SetText',s.text..where)
    local n=steps[index+1]
    local nextLine=n and ('|cff7a5a30Then:|r '..n.text) or (guide and '|cff7a5a30Last guided step for now.|r' or '|cff7a5a30Last step here.|r')
    method(lines.next,'SetText',(guide and index==1 and guide.note) and ('|cff8a2a10'..guide.note..'|r') or nextLine)
    -- No waypoint here: paint also runs on its own (login, zone and quest changes), and the game
    -- forbids addons from setting waypoints outside a player's click or command.
end
local function build()
    if frame or type(CreateFrame)~='function' then return frame end
    frame=CreateFrame('Frame','BackstageForeverRouteFrame',UIParent)
    if not frame then return nil end
    method(frame,'SetSize',340,104);method(frame,'SetPoint','TOP',UIParent,'TOP',0,-120)
    method(frame,'SetFrameStrata','MEDIUM');method(frame,'SetMovable',true);method(frame,'EnableMouse',true)
    method(frame,'SetClampedToScreen',true);method(frame,'RegisterForDrag','LeftButton')
    method(frame,'SetScript','OnDragStart',function(f) if not combat() then method(f,'StartMoving') end end)
    method(frame,'SetScript','OnDragStop',function(f) method(f,'StopMovingOrSizing') end)
    -- G9 (0.49): a painted scroll (Art/Frames/step.tga, our own art). Text sits on the parchment in dark ink.
    local painted=type(BackstageForeverPaintScroll)=='function' and BackstageForeverPaintScroll(frame,'step',40)
    if not painted then
        local bg=method(frame,'CreateTexture',nil,'BACKGROUND')
        if bg then method(bg,'SetAllPoints',frame);method(bg,'SetColorTexture',.09,.05,.03,.88) end
    end
    local function text(font,y,h)
        local t=method(frame,'CreateFontString',nil,'OVERLAY',font)
        if t then method(t,'SetPoint','TOPLEFT',frame,'TOPLEFT',44,y);method(t,'SetWidth',252);method(t,'SetJustifyH','LEFT');if h then method(t,'SetHeight',h) end;if painted then method(t,'SetShadowOffset',0,0) end end
        return t
    end
    lines.title=text('GameFontNormal',-10);lines.body=text('GameFontHighlight',-28,34);lines.next=text('GameFontHighlightSmall',-66,26)
    if painted then method(lines.title,'SetTextColor',.42,.18,.03);method(lines.body,'SetTextColor',.16,.09,.03);method(lines.next,'SetTextColor',.3,.2,.1) end
    local function button(label,x,fn)
        local b=CreateFrame('Button',nil,frame,'UIPanelButtonTemplate')
        if b then method(b,'SetSize',22,18);method(b,'SetPoint','TOPRIGHT',frame,'TOPRIGHT',x-40,-7);method(b,'SetText',label);method(b,'SetScript','OnClick',fn) end
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
    guide=nil
    if settings.mode=='guide' and type(BackstageForeverGuideRoute)=='function' then
        local _,race=call(UnitRace,'player')
        local route=BackstageForeverGuideRoute(str(race,40))
        if route then
            local log=questLog();local inLog,complete={},{}
            for _,q in ipairs(log) do inLog[q.id]=true;if q.complete then complete[q.id]=true end end
            local completed={}
            local ids=call(field(plain(C_QuestLog),'GetAllCompletedQuestIDs'))
            if type(ids)=='table' then for _,v in pairs(ids) do v=int(v,1,2147483647);if v then completed[v]=true end end end
            local pos=BackstageForeverGuidePosition(route,{completed=completed,inLog=inLog,complete=complete,level=int(call(UnitLevel,'player'),1,1000),mapId=mapId},settings.skipped)
            if pos.ended then
                settings.mode='zone'
                say(('The guided route ends at level %d for now. The zone guide takes over; the desktop app\'s Now page shows where to level next.'):format(pos.top or 1))
            else
                steps={}
                for i,r in ipairs(pos.steps) do steps[i]={kind=r[1],text=r[2],mapId=r[3],x=r[4],y=r[5],level=r[6],id=r[8]} end
                guide={index=pos.index,total=pos.total,note=pos.note,top=pos.top};index=1
                if settings.shown and build() then method(frame,'Show');paint() end
                return steps
            end
        else
            settings.mode='zone'
            say('There is no guided route for your race yet. The zone guide takes over.')
        end
    end
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
    elseif arg=='guide' then settings.mode='guide';settings.shown=true;BackstageForeverRouteRefresh();if guide then say(('Guided route: step %d of %d. It moves on as you pick up and hand in quests; /bf route skip skips a step, /bf route zone goes back to this zone\'s steps.'):format(guide.index,guide.total)) end
    elseif arg=='zone' then settings.mode='zone';settings.shown=true;BackstageForeverRouteRefresh();say('Zone guide: the quests around you, in the order that walks least.')
    elseif arg=='skip' then
        local s=steps[index]
        if not guide or not s or not s.id then return say('Skip works on the guided route: /bf route guide.') end
        settings.skipped[s.id]=true;lastArrow=nil;BackstageForeverRouteRefresh();say('Skipped. /bf route guide picks up from the next step.')
    elseif arg=='' then settings.shown=not settings.shown
    else return say('Use /bf route, /bf route guide, /bf route zone, /bf route next, /bf route back, /bf route skip or /bf route arrow.') end
    if settings.shown then
        if arg=='' then BackstageForeverRouteRefresh();say('Route on: one step at a time. The arrow points at the step you show; < and > move it. /bf route guide follows the full guided route for your race; /bf route hides it.') end
        if build() then method(frame,'Show');paint() end
        -- The player typed or clicked this, so the game allows the waypoint arrow now.
        if arg~='arrow' or settings.arrow then setArrow(steps[index]) end
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

-- G2/G13: painted zone arrival banner with the zone's level band and quests on offer.
-- Textures and font strings only. Each painting is Art\Zones\<mapId>.tga (1024x128; the dark centre and
-- the gold frame are part of the painting); maps without their own painting use Art\Zones\default.tga.
local ZONE_PAINTINGS={1411,1412,1420,1429,1426,1438,1413,1421,1436,1432,1439,1433,1442,1440,1431,1424,1437,1441,1416,1417,1443,1434,1445,1418,1435,1444,1425,1446,1427,1447,1419,1449,1448,1428,1422,1423,1452,1430,1451,1450,1453,1454,1455,1456,1457,1458}
local PAINTED={}
for _,id in ipairs(ZONE_PAINTINGS) do PAINTED[id]=true end
local CAPITALS={[1453]=true,[1454]=true,[1455]=true,[1456]=true,[1457]=true,[1458]=true}
local ART='Interface\\AddOns\\BackstageForever\\Art\\Zones\\'
-- Pure: the banner painting for a map.
function BackstageForeverZoneArt(mapId)
    return ART..(PAINTED[mapId] and tostring(mapId) or 'default')
end
function BackstageForeverZonePaintings() local out={} for i,id in ipairs(ZONE_PAINTINGS) do out[i]=id end return out end
-- Pure: the line under the zone name. Capitals and Moonglade have no level band.
function BackstageForeverZoneLine(mapId,band,quests)
    local sub
    if type(band)=='table' and int(band.lo,1,100) then sub='Levels '..band.lo..'–'..(int(band.hi,1,100) or band.lo)
    elseif CAPITALS[mapId] then sub='Capital city' end
    quests=int(quests,0,10000)
    if quests and quests>0 then sub=(sub and sub..' · ' or '')..quests..(quests==1 and ' quest' or ' quests')..' for your level' end
    return sub
end

local banner,bannerArt,bannerName,bannerSub,ribbon,bannerShown,BANNER_LEN=nil,nil,nil,nil,nil,0,6
local ribbonParts={}
local function clock() return tonumber(call(GetTime)) or 0 end
local function texture(parent,layer,r,g,b,a)
    local t=method(parent,'CreateTexture',nil,layer)
    if t and r then pcall(t.SetColorTexture,t,r,g,b,a) end
    return t
end
local function bannerFrame()
    if banner or type(CreateFrame)~='function' then return banner end
    local f=call(CreateFrame,'Frame','BackstageForeverZoneBanner',UIParent)
    if not f then return nil end
    banner=f
    pcall(f.SetSize,f,560,74)
    pcall(f.SetPoint,f,'TOP',UIParent,'TOP',0,-150)
    pcall(f.SetFrameStrata,f,'HIGH')
    bannerArt=texture(f,'BACKGROUND')
    if bannerArt then
        pcall(bannerArt.SetAllPoints,bannerArt,f)
        -- The 8:1 painting at 560x74: crop a sliver off each side instead of stretching it.
        pcall(bannerArt.SetTexCoord,bannerArt,.027,.973,0,1)
    end
    ribbon=texture(f,'BORDER',.16,.09,.03,.92)
    if ribbon then
        ribbonParts[1]=ribbon
        pcall(ribbon.SetPoint,ribbon,'BOTTOM',f,'BOTTOM',0,9)
        pcall(ribbon.SetSize,ribbon,200,20)
        -- 1px gold-ish edges, kept off the corners so the ribbon reads as rounded.
        local function edge(p1,x1,y1,p2,x2,y2,w,h)
            local e=texture(f,'ARTWORK',.78,.6,.29,1)
            if not e then return end
            pcall(e.SetPoint,e,p1,ribbon,p1,x1,y1) pcall(e.SetPoint,e,p2,ribbon,p2,x2,y2)
            if w then pcall(e.SetWidth,e,w) end
            if h then pcall(e.SetHeight,e,h) end
            ribbonParts[#ribbonParts+1]=e
        end
        edge('TOPLEFT',2,0,'TOPRIGHT',-2,0,nil,1)
        edge('BOTTOMLEFT',2,0,'BOTTOMRIGHT',-2,0,nil,1)
        edge('TOPLEFT',0,-2,'BOTTOMLEFT',0,2,1,nil)
        edge('TOPRIGHT',0,-2,'BOTTOMRIGHT',0,2,1,nil)
    end
    bannerName=method(f,'CreateFontString',nil,'OVERLAY','GameFontNormalHuge')
    if bannerName then
        pcall(bannerName.SetPoint,bannerName,'TOP',f,'TOP',0,-9)
        pcall(bannerName.SetWidth,bannerName,540)
        local font=method(bannerName,'GetFont')
        if font then pcall(bannerName.SetFont,bannerName,font,28,'') end
        pcall(bannerName.SetTextColor,bannerName,1,.82,0)
        pcall(bannerName.SetShadowColor,bannerName,0,0,0,1)
        pcall(bannerName.SetShadowOffset,bannerName,2,-2)
    end
    bannerSub=method(f,'CreateFontString',nil,'OVERLAY','GameFontHighlight')
    if bannerSub and ribbon then pcall(bannerSub.SetPoint,bannerSub,'CENTER',ribbon,'CENTER',0,0) end
    pcall(f.Hide,f)
    pcall(f.SetScript,f,'OnUpdate',function(self)
        local t=clock()-bannerShown
        if t<.25 then pcall(self.SetScale,self,1+(.25-t)*1.6) pcall(self.SetAlpha,self,t/.25)
        elseif t<BANNER_LEN-1 then pcall(self.SetScale,self,1) pcall(self.SetAlpha,self,1)
        elseif t<BANNER_LEN then pcall(self.SetAlpha,self,BANNER_LEN-t)
        else pcall(self.Hide,self) end
    end)
    return banner
end
-- Shows the painted banner, echoed to chat in one line. Returns the painting path (for tests),
-- or nil when only the chat line was written (pop-ups switched off with /bf toasts).
function BackstageForeverZoneBanner(mapId,name,sub)
    name=str(name,60);if not name then return nil end
    sub=str(sub,160)
    say(sub and name..' '..sub or name)
    if field(plain(BackstageForeverAssistSettings),'toasts')==false or not bannerFrame() then return nil end
    local art=BackstageForeverZoneArt(mapId)
    if bannerArt then pcall(bannerArt.SetTexture,bannerArt,art) end
    if bannerName then pcall(bannerName.SetText,bannerName,name) end
    if bannerSub then pcall(bannerSub.SetText,bannerSub,sub or '') end
    if ribbon then
        local w=sub and bannerSub and tonumber(method(bannerSub,'GetStringWidth')) or 0
        pcall(ribbon.SetWidth,ribbon,min(540,floor(w+.5)+52))
        for _,part in ipairs(ribbonParts) do pcall(sub and part.Show or part.Hide,part) end
    end
    bannerShown=clock()
    pcall(banner.SetAlpha,banner,0)
    pcall(banner.Show,banner)
    return art
end

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
    local n=0
    if type(BackstageForeverAdvisorPoints)=='function' then
        local ok,rows=pcall(BackstageForeverAdvisorPoints,mapId,me(),{},{},{},{class=false,profession=false,flight=false,handin=false})
        if ok and type(rows)=='table' then n=#rows end
    end
    pcall(BackstageForeverZoneBanner,mapId,name,BackstageForeverZoneLine(mapId,band,n))
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

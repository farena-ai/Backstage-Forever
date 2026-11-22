-- In-game panels (1.24): two small painted lists you can drag anywhere.
--   /bf tracker   your quest log, nearest first, grouped by zone; click a quest for the waypoint.
--                 It is the addon's own list and never touches the game's quest tracker.
--   /bf run       inside a dungeon or raid the Instance Atlas knows: bosses left, your quests here,
--                 wishes and upgrades still possible, time in the run.
-- Reading only. The one action is a waypoint, and only from your click. Both stay quiet in combat.
local floor,sqrt=math.floor,math.sqrt
local unpackAll=unpack or table.unpack
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
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
    for i=2,10 do r[i]=plain(r[i]) end
    return unpackAll(r,2,10)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function finite(v) return type(v)=='number' and v==v and v>-1e7 and v<1e7 end
local function unit(v) return type(v)=='number' and v==v and v>=0 and v<=1 end
local function T(s)
    local tr=BackstageForeverTr
    if type(tr)~='function' then return s end
    local ok,r=pcall(tr,s)
    return ok and type(r)=='string' and r or s
end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local function combat() return call(InCombatLockdown)~=false end
local function markOf(kind)
    local f=BackstageForeverMark
    if type(f)~='function' then return '' end
    local ok,m=pcall(f,kind)
    return ok and type(m)=='string' and m or ''
end

-- ---------------------------------------------------------------- switches
-- The quest list is off until you switch it on. The run panel shows itself in dungeons and
-- hides in combat unless you ask it to stay. wish and bags belong to BackstageForeverWish.lua.
local DEFAULTS={tracker=false,run=false,runCombat=false,wish=true,bags=false}
function BackstageForeverPanelEnabled(key)
    local s=BackstageForeverPanelSettings
    local v
    if type(s)=='table' then v=rawget(s,key) end
    if v==true or v==false then return v end
    return DEFAULTS[key]==true
end
local enabled=BackstageForeverPanelEnabled
local function settings()
    if type(BackstageForeverPanelSettings)~='table' then BackstageForeverPanelSettings={} end
    return BackstageForeverPanelSettings
end
-- arg: 'on', 'off' or anything else to flip. Returns the new state.
function BackstageForeverPanelSet(key,arg)
    if DEFAULTS[key]==nil then return nil end
    local on
    if arg=='on' then on=true elseif arg=='off' then on=false else on=not enabled(key) end
    settings()[key]=on
    return on
end

-- ---------------------------------------------------------------- Q4 quest list by distance
local COLOR={red='ffff3333',orange='ffff8040',yellow='ffffd100',green='ff40c040',grey='ff9d9d9d'}
local COLOR_MARK={red='danger',orange='warn',yellow='same',green='good'}
-- Pure: the level at or below which a quest gives almost nothing (Classic rule, the same as enemies).
local function greyLevel(level)
    if level<=5 then return 0 elseif level<=39 then return level-5-floor(level/10) end
    return level-1-floor(level/5)
end
-- Pure: how hard a quest is for you, the way the quest log colours it. nil when a level is unknown.
function BackstageForeverQuestColor(questLevel,playerLevel)
    if type(questLevel)~='number' or type(playerLevel)~='number' or questLevel<1 or playerLevel<1 then return nil end
    local gap=questLevel-playerLevel
    if gap>=5 then return 'red' elseif gap>=3 then return 'orange' elseif gap>=-2 then return 'yellow' end
    if questLevel<=greyLevel(playerLevel) then return 'grey' end
    return 'green'
end
local function worldPoint(w) return type(w)=='table' and w.instance~=nil and finite(w.x) and finite(w.y) end
-- Pure: how far a stop is from where you stand.
-- here = {mapId=,x=,y=,size={width=,height=} or nil,world={instance=,x=,y=} or nil}; stop = {mapId=,x=,y=,world=}.
-- -> yards,'yards' | map fraction,'map' (same map, its size unknown) | nil,'far' (another map) | nil,'none'.
function BackstageForeverTrackerDistance(here,stop)
    if type(stop)~='table' or type(stop.mapId)~='number' or not unit(stop.x) or not unit(stop.y) then return nil,'none' end
    if type(here)~='table' then return nil,'far' end
    if worldPoint(here.world) and worldPoint(stop.world) and here.world.instance==stop.world.instance then
        local dx,dy=here.world.x-stop.world.x,here.world.y-stop.world.y
        return sqrt(dx*dx+dy*dy),'yards'
    end
    if here.mapId~=stop.mapId or not unit(here.x) or not unit(here.y) then return nil,'far' end
    local dx,dy=stop.x-here.x,stop.y-here.y
    local size=here.size
    if type(size)=='table' and finite(size.width) and finite(size.height) and size.width>0 and size.height>0 then
        dx,dy=dx*size.width,dy*size.height
        return sqrt(dx*dx+dy*dy),'yards'
    end
    return sqrt(dx*dx+dy*dy),'map'
end
local RANK={yards=1,map=2,far=3,none=4}
local function nearer(a,b)
    if a.rank~=b.rank then return a.rank<b.rank end
    if a.rank<=2 and a.distance~=b.distance then return a.distance<b.distance end
    if a.ready~=b.ready then return a.ready end
    local x,y=a.level or 1000,b.level or 1000
    if x~=y then return x<y end
    return a.questId<b.questId
end
-- Pure. stops: the list from BackstageForeverQuestStops. Returns the zones of your quest log, the one
-- holding your nearest quest first; inside a zone the nearest quest first. A quest with a known spot
-- on another map comes after every measured one; a quest with no known spot comes last.
function BackstageForeverTrackerGroups(stops,here,playerLevel)
    local groups,byZone={},{}
    for _,stop in ipairs(type(stops)=='table' and stops or {}) do
        if type(stop)=='table' and type(stop.questId)=='number' and type(stop.title)=='string' then
            local distance,kind=BackstageForeverTrackerDistance(here,stop.destination)
            local quest={questId=stop.questId,title=stop.title,level=stop.level,ready=stop.ready==true,destination=stop.destination,
                distance=distance,unit=kind,rank=RANK[kind],color=BackstageForeverQuestColor(stop.level,playerLevel)}
            local zone=type(stop.zone)=='string' and stop.zone~='' and stop.zone or ''
            local group=byZone[zone]
            if not group then group={zone=zone,quests={}};byZone[zone]=group;groups[#groups+1]=group end
            group.quests[#group.quests+1]=quest
        end
    end
    for _,group in ipairs(groups) do table.sort(group.quests,nearer) end
    table.sort(groups,function(a,b)
        local x,y=a.quests[1],b.quests[1]
        if x.rank~=y.rank or (x.rank<=2 and x.distance~=y.distance) then return nearer(x,y) end
        return a.zone<b.zone
    end)
    return groups
end
-- Pure: "85 yd", "1240 yd", "on this map", "elsewhere", "not known".
function BackstageForeverTrackerDistanceText(distance,kind)
    if kind=='yards' and type(distance)=='number' then return ('%d %s'):format(floor(distance+.5),T('yd')) end
    if kind=='map' then return T('on this map') end
    if kind=='far' then return T('elsewhere') end
    return T('not known')
end
-- Pure: the lines the panel paints, at most limit of them. mark(kind) gives the text mark for a
-- colour when "Marks without colour" is on, or ''.
-- {kind='head',left=} | {kind='row',left=,right=,quest=} | {kind='note',left=}
function BackstageForeverTrackerLines(groups,limit,mark)
    limit=type(limit)=='number' and limit>=3 and limit or 18
    mark=type(mark)=='function' and mark or function() return '' end
    local lines,total,shown={},0,0
    for _,group in ipairs(type(groups)=='table' and groups or {}) do total=total+#group.quests end
    if total==0 then return {{kind='note',left=T('No quests in your log.')}} end
    for _,group in ipairs(groups) do
        -- A zone name is only started when one of its quests still fits under it, with room for the "more" line.
        if #lines+2+(shown+1<total and 1 or 0)>limit then break end
        lines[#lines+1]={kind='head',left=group.zone~='' and group.zone or T('Other quests')}
        for _,quest in ipairs(group.quests) do
            if #lines+1+(shown+1<total and 1 or 0)>limit then break end
            local level=quest.level and ('['..quest.level..'] ') or ''
            local color=COLOR[quest.color]
            local left=(mark(COLOR_MARK[quest.color]) or '')..level..quest.title
            if color then left='|c'..color..left..'|r' end
            local right=BackstageForeverTrackerDistanceText(quest.distance,quest.unit)
            if quest.ready then right='|cff40ff40'..T('Ready')..'|r  '..right end
            lines[#lines+1]={kind='row',left=left,right=right,quest=quest}
            shown=shown+1
        end
    end
    if shown<total then lines[#lines+1]={kind='note',left=('+%d %s'):format(total-shown,T('more in your quest log'))} end
    return lines
end

-- ---------------------------------------------------------------- G4 dungeon run
-- The game's instance id of each Instance Atlas row (src/core/dungeon-atlas.cjs; a test keeps the
-- two in step). Lower and Upper Blackrock Spire are one instance.
local INSTANCES={[389]={'rfc'},[43]={'wc'},[36]={'dm'},[33]={'sfk'},[48]={'bfd'},[34]={'stocks'},[90]={'gnomer'},[47]={'rfk'},
    [189]={'sm'},[129]={'rfd'},[70]={'ulda'},[209]={'zf'},[349]={'mara'},[109]={'st'},[230]={'brd'},[229]={'lbrs','ubrs'},
    [429]={'dme'},[289]={'scholo'},[329]={'strat'},[309]={'zg'},[409]={'mc'},[249]={'ony'},[469]={'bwl'},[509]={'aq20'},
    [531]={'aq40'},[533]={'naxx'}}
BackstageForeverRunInstances=INSTANCES
-- Pure: the Instance Atlas rows for the instance you stand in; empty when the Atlas does not know it.
function BackstageForeverRunRows(data,instanceMap)
    local out={}
    local ids=type(instanceMap)=='number' and INSTANCES[instanceMap] or nil
    if not ids or type(data)~='table' then return out end
    for _,id in ipairs(ids) do
        for _,row in ipairs(data) do if type(row)=='table' and row[1]==id then out[#out+1]=row end end
    end
    return out
end
local RUN_MAX,RUN_AWAY=8*3600,30*60
-- Pure: the run you are on. The same run goes on after a /reload, and after a death run back in
-- within 30 minutes; anything else starts a new one. Returns the visit, and true when it is new.
function BackstageForeverRunVisit(saved,instanceMap,now)
    if type(instanceMap)~='number' or type(now)~='number' then return nil,false end
    if type(saved)=='table' and saved.map==instanceMap and type(saved.startedAt)=='number'
        and now>=saved.startedAt and now-saved.startedAt<RUN_MAX
        and (type(saved.leftAt)~='number' or (now>=saved.leftAt and now-saved.leftAt<RUN_AWAY)) then
        saved.leftAt=nil
        return saved,false
    end
    return {map=instanceMap,startedAt=now},true
end
local function norm(name) return type(name)=='string' and name:lower():gsub('%s+',' '):gsub('^ ',''):gsub(' $','') or nil end
-- Pure: which listed bosses are still up. encounters: the Journal's recorded wins. A win whose
-- name matches no listed boss (another language, a boss the list lacks) is counted in other, so the
-- panel can say so instead of pretending.
-- -> {total=,left={{name=,loot=}},killed={name,...},other={name,...}}
function BackstageForeverRunBosses(rows,encounters,instanceMap,since)
    local won,seen={},{}
    for _,e in ipairs(type(encounters)=='table' and encounters or {}) do
        if type(e)=='table' and e.instanceMap==instanceMap and type(e.at)=='number' and type(since)=='number' and e.at>=since and norm(e.name) then
            won[norm(e.name)]=e.name
        end
    end
    local out={total=0,left={},killed={},other={}}
    for _,row in ipairs(type(rows)=='table' and rows or {}) do
        for _,boss in ipairs(type(row)=='table' and type(row[10])=='table' and row[10] or {}) do
            local key=norm(boss[1])
            if key and not seen[key] then
                seen[key]=true;out.total=out.total+1
                if won[key] then out.killed[#out.killed+1]=boss[1] else out.left[#out.left+1]={name=boss[1],loot=boss[2]} end
            end
        end
    end
    local others={}
    for key,name in pairs(won) do if not seen[key] then others[#others+1]=name end end
    table.sort(others)
    out.other=others
    return out
end
-- Pure: your quests for this place. A quest counts when the Instance Atlas lists it for one of the
-- rows, or when your quest log files it under the instance's own name. logQuests: the captured log.
-- -> {{questId=,title=,ready=,progress="3/8" or nil}}
function BackstageForeverRunQuests(rows,logQuests,instanceName)
    local listed={}
    for _,row in ipairs(type(rows)=='table' and rows or {}) do
        for _,q in ipairs(type(row)=='table' and type(row[11])=='table' and row[11] or {}) do if type(q[1])=='number' then listed[q[1]]=true end end
    end
    local out={}
    for _,quest in ipairs(type(logQuests)=='table' and logQuests or {}) do
        if type(quest)=='table' and type(quest.id)=='number' and type(quest.title)=='string'
            and (listed[quest.id] or (type(instanceName)=='string' and instanceName~='' and quest.zone==instanceName)) then
            local progress
            for _,o in ipairs(type(quest.objectives)=='table' and quest.objectives or {}) do
                if type(o)=='table' and o.done==false then
                    if type(o.fulfilled)=='number' and type(o.required)=='number' and o.required>0 then progress=o.fulfilled..'/'..o.required end
                    break
                end
            end
            out[#out+1]={questId=quest.id,title=quest.title,ready=quest.complete==true,progress=progress}
        end
    end
    table.sort(out,function(a,b) if a.ready~=b.ready then return a.ready end return a.title<b.title end)
    return out
end
-- Pure: wished items and upgrades the bosses still standing were seen to drop. Wishes first, then
-- the better chance. An item two bosses drop is listed once, with its best chance.
function BackstageForeverRunItems(left,wished,better)
    local out,at={},{}
    wished=type(wished)=='table' and wished or {};better=type(better)=='table' and better or {}
    for _,boss in ipairs(type(left)=='table' and left or {}) do
        for id,chance in (type(boss.loot)=='string' and boss.loot or ''):gmatch('(%d+)~(%d+)') do
            id,chance=tonumber(id),tonumber(chance)
            if wished[id] or better[id] then
                local item=at[id]
                if not item then item={id=id,boss=boss.name,chance=chance,wish=wished[id]==true,up=better[id]==true};at[id]=item;out[#out+1]=item
                elseif chance>item.chance then item.chance=chance;item.boss=boss.name end
            end
        end
    end
    table.sort(out,function(a,b)
        if a.wish~=b.wish then return a.wish end
        if a.chance~=b.chance then return a.chance>b.chance end
        return a.id<b.id
    end)
    return out
end
-- Pure: "under a minute", "23 min", "1 h 05 min".
function BackstageForeverRunTime(seconds)
    if type(seconds)~='number' or seconds~=seconds or seconds<0 then return nil end
    local minutes=floor(seconds/60)
    if minutes<1 then return T('under a minute') end
    if minutes<60 then return ('%d %s'):format(minutes,T('min')) end
    return ('%d %s %02d %s'):format(floor(minutes/60),T('h'),minutes%60,T('min'))
end
local RUN_BOSSES,RUN_QUESTS,RUN_ITEMS=8,4,5
-- Pure: the lines of the run panel. state = {seconds=,bosses=,quests=,items=,handed=} where handed
-- says whether the desktop app sent any wish or upgrade at all. itemName(id) names an item.
function BackstageForeverRunLines(state,itemName)
    local lines={}
    if type(state)~='table' then return lines end
    local function add(kind,left,right,extra) local l=extra or {};l.kind=kind;l.left=left;l.right=right;lines[#lines+1]=l end
    add('row',T('Time in the run'),BackstageForeverRunTime(state.seconds) or '')
    local bosses=type(state.bosses)=='table' and state.bosses or {total=0,left={},killed={},other={}}
    add('head',T('Bosses left'),#bosses.left..' / '..bosses.total)
    for i=1,math.min(#bosses.left,RUN_BOSSES) do add('row','  '..bosses.left[i].name) end
    if #bosses.left>RUN_BOSSES then add('note',('  +%d %s'):format(#bosses.left-RUN_BOSSES,T('more'))) end
    if bosses.total>0 and #bosses.left==0 then add('note','  '..T('Every listed boss is down.')) end
    if #bosses.other>0 then add('note',('  %d %s'):format(#bosses.other,T(#bosses.other==1 and 'win not matched to this list' or 'wins not matched to this list'))) end
    local quests=type(state.quests)=='table' and state.quests or {}
    add('head',T('Your quests here'),tostring(#quests))
    for i=1,math.min(#quests,RUN_QUESTS) do
        local q=quests[i]
        add('row','  '..q.title,q.ready and ('|cff40ff40'..T('Ready')..'|r') or q.progress or T('open'))
    end
    if #quests>RUN_QUESTS then add('note',('  +%d %s'):format(#quests-RUN_QUESTS,T('more'))) end
    if #quests==0 then add('note','  '..T('None in your log.')) end
    local items=type(state.items)=='table' and state.items or {}
    add('head',T('Still possible'),tostring(#items))
    for i=1,math.min(#items,RUN_ITEMS) do
        local item=items[i]
        local word=item.wish and ('|cffffd100'..T('Wish')..'|r ') or ('|cff40ff40'..T('Upgrade')..'|r ')
        add('row','  '..word..(type(itemName)=='function' and itemName(item.id) or (T('Item')..' #'..item.id)),item.chance..'%',{item=item})
    end
    if #items>RUN_ITEMS then add('note',('  +%d %s'):format(#items-RUN_ITEMS,T('more'))) end
    if #items==0 then
        add('note','  '..T(state.handed and 'No wish or upgrade left here.' or 'No wishes or upgrades from the desktop app.'))
    end
    return lines
end

-- ---------------------------------------------------------------- the painted list both panels use
-- Fixed widths and no wrapping: a long name is cut short, it never runs into the column beside it.
local WIDTH,INSET,LINE,TOP,RIGHT_WIDTH=320,16,14,-32,110
-- Pure: where a panel was left, as its top-left corner measured from the screen's bottom-left, or nil.
function BackstageForeverPanelPlace(saved,key)
    local all=type(saved)=='table' and rawget(saved,'pos')
    local p=type(all)=='table' and rawget(all,key)
    if type(p)=='table' and finite(p.x) and finite(p.y) and p.x>=0 and p.y>=0 then return p.x,p.y end
end
-- A panel hangs from its top-left corner: its list grows and shrinks downwards and the title stays put.
local function buildList(key,globalName,title,maxLines,defaultX,defaultY,onClose)
    if type(CreateFrame)~='function' or not UIParent then return nil end
    local f=CreateFrame('Frame',globalName,UIParent)
    f:Hide();f:SetSize(WIDTH,96)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    local x,y=BackstageForeverPanelPlace(BackstageForeverPanelSettings,key)
    if x then f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',x,y) else f:SetPoint('TOPLEFT',UIParent,'TOPLEFT',defaultX,defaultY) end
    f:SetFrameStrata('MEDIUM');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    local function startDrag() if not combat() then f:StartMoving() end end
    local function stopDrag()
        f:StopMovingOrSizing()
        -- The game may leave the frame hanging from any corner after a drag; hang it from the top-left again.
        local left,top=call(f.GetLeft,f),call(f.GetTop,f)
        if finite(left) and finite(top) and left>=0 and top>=0 then
            f:ClearAllPoints();f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',left,top)
            local s=settings()
            if type(s.pos)~='table' then s.pos={} end
            s.pos[key]={x=left,y=top}
        end
    end
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',startDrag);f:SetScript('OnDragStop',stopDrag)
    -- The same painted leather-and-brass frame as the Adventure Compass, smaller.
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    f.title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    f.title:SetPoint('TOPLEFT',INSET,-12);f.title:SetWidth(WIDTH-INSET*2-22);f.title:SetJustifyH('LEFT');f.title:SetWordWrap(false)
    f.title:SetText(T(title))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide();if onClose then pcall(onClose) end end)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,TOP+3)
    f.lines={}
    for i=1,maxLines do
        local line=CreateFrame('Button',nil,f)
        line:SetSize(WIDTH-INSET*2,LINE);line:SetPoint('TOPLEFT',INSET,TOP-(i-1)*LINE)
        line.hover=line:CreateTexture(nil,'HIGHLIGHT');line.hover:SetAllPoints();line.hover:SetColorTexture(1,1,1,.08)
        line.left=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.left:SetPoint('LEFT',0,0);line.left:SetJustifyH('LEFT');line.left:SetWordWrap(false)
        line.right=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.right:SetPoint('RIGHT',0,0);line.right:SetWidth(RIGHT_WIDTH);line.right:SetJustifyH('RIGHT');line.right:SetWordWrap(false)
        -- The panel drags from anywhere, lines included.
        line:RegisterForDrag('LeftButton');line:SetScript('OnDragStart',startDrag);line:SetScript('OnDragStop',stopDrag)
        line:SetScript('OnClick',function(self) if self.data and self.onClick then pcall(self.onClick,self.data) end end)
        line:SetScript('OnEnter',function(self) if self.data and self.onEnter then pcall(self.onEnter,self,self.data) end end)
        line:SetScript('OnLeave',function() if type(GameTooltip)=='table' then pcall(GameTooltip.Hide,GameTooltip) end end)
        line:Hide()
        f.lines[i]=line
    end
    return f
end
-- Pure: the on-screen width of a line's left text, so it never reaches the right column.
function BackstageForeverPanelLeftWidth(hasRight) return WIDTH-INSET*2-(hasRight and RIGHT_WIDTH+6 or 0) end
-- Never shorter than the painted corners need.
function BackstageForeverPanelHeight(count) return -TOP+math.max(1,count)*LINE+20 end
local HEAD,NOTE='|cffffd100','|cff9d9d9d'
local function paintList(f,lines,onClick,onEnter)
    for i,line in ipairs(f.lines) do
        local data=lines[i]
        if data then
            local right=data.right
            line.left:SetWidth(BackstageForeverPanelLeftWidth(right~=nil and right~=''))
            local prefix=data.kind=='head' and HEAD or data.kind=='note' and NOTE or nil
            line.left:SetText(prefix and (prefix..(data.left or '')..'|r') or (data.left or ''))
            line.right:SetText(right and (prefix and (prefix..right..'|r') or right) or '')
            line.data,line.onClick,line.onEnter=data,onClick,onEnter
            -- Only a line that answers the mouse lights up under it.
            line.hover:SetAlpha((data.quest or data.item) and 1 or 0)
            line:Show()
        else line.data=nil;line:Hide() end
    end
    f:SetHeight(BackstageForeverPanelHeight(math.min(#lines,#f.lines)))
end

-- ---------------------------------------------------------------- reading the game (never in combat)
local latest=nil -- the newest capture of this character (BackstageForever.lua); read, never changed
local sizes,worlds={},{}
local function vector(x,y) return call(CreateVector2D,x,y) end
local function worldOf(mapId,x,y)
    local key=mapId..':'..floor(x*10000+.5)..':'..floor(y*10000+.5)
    if worlds[key]~=nil then return worlds[key] or nil end
    local found=false
    local v=vector(x,y)
    if v then
        local instance,position=call(field(plain(C_Map),'GetWorldPosFromMapPos'),mapId,v)
        local wx,wy
        if type(position)=='table' or type(position)=='userdata' then wx,wy=call(field(position,'GetXY'),position) end
        if type(instance)=='number' and finite(wx) and finite(wy) then found={instance=instance,x=wx,y=wy} end
    end
    worlds[key]=found
    return found or nil
end
local function mapSize(mapId)
    if sizes[mapId]~=nil then return sizes[mapId] or nil end
    local a,b=worldOf(mapId,0,0),worldOf(mapId,1,1)
    local size=false
    -- World x runs north-south and world y runs east-west.
    if a and b and a.x~=b.x and a.y~=b.y then size={width=math.abs(a.y-b.y),height=math.abs(a.x-b.x)} end
    sizes[mapId]=size
    return size or nil
end
local function here()
    local api=plain(C_Map)
    local mapId=call(field(api,'GetBestMapForUnit'),'player')
    if type(mapId)~='number' then return nil end
    local pos=call(field(api,'GetPlayerMapPosition'),mapId,'player')
    local x,y
    if type(pos)=='table' or type(pos)=='userdata' then x,y=call(field(pos,'GetXY'),pos) end
    if not unit(x) or not unit(y) then return {mapId=mapId} end
    -- The player's own world point is not kept: it changes with every step.
    local key=mapId..':'..floor(x*10000+.5)..':'..floor(y*10000+.5)
    local world=worldOf(mapId,x,y);worlds[key]=nil
    return {mapId=mapId,x=x,y=y,size=mapSize(mapId),world=world}
end
local function playerLevel()
    local level=call(UnitLevel,'player')
    return type(level)=='number' and level>=1 and level or nil
end
local function me()
    return call(UnitName,'player'),call(GetRealmName)
end
local function itemName(id)
    local name=call(GetItemInfo,id)
    if type(name)=='string' and name~='' then return name end
    call(field(plain(C_Item),'RequestLoadItemDataByID'),id)
    return T('Item')..' #'..id
end

-- ---------------------------------------------------------------- the quest list on screen
local TRACKER_LINES=18
local tracker
local function trackerClick(data)
    local quest=data.quest
    if not quest then return end
    if combat() then return say('Waypoints wait until you leave combat.') end
    local d=quest.destination
    if not d then return say('No spot is known for this quest. Check your quest log.') end
    -- Fractions of the map, so a spot near the top-left edge is never read as a percentage.
    local label=quest.title
    if #label>60 then label=label:sub(1,60):gsub('[\192-\255][\128-\191]*$','') end
    if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.4f %.4f %s'):format(d.mapId,d.x,d.y,label)) end
end
local function trackerEnter(line,data)
    local quest=data.quest
    if not quest or type(GameTooltip)~='table' then return end
    pcall(GameTooltip.SetOwner,GameTooltip,line,'ANCHOR_RIGHT')
    pcall(GameTooltip.SetText,GameTooltip,quest.title,1,.82,.3)
    pcall(GameTooltip.AddLine,GameTooltip,T(quest.destination and 'Click: waypoint with the game\'s own arrow.' or 'No spot is known for this quest.'),1,1,1,true)
    -- 1.26: which step of its chain this quest is, when the reference knows the chain.
    if type(BackstageForeverChainTooltip)=='function' and type(quest.questId)=='number' then pcall(BackstageForeverChainTooltip,GameTooltip,quest.questId) end
    pcall(GameTooltip.Show,GameTooltip)
end
local function paintTracker()
    if not tracker then return end
    local stops=nil
    if latest and type(BackstageForeverQuestStops)=='function' then
        local ok,rows=pcall(BackstageForeverQuestStops,latest)
        if ok then stops=rows end
    end
    local lines
    if not stops then lines={{kind='note',left=T('Your quest log is not readable right now.')}}
    else
        local spot=here()
        for _,stop in ipairs(stops) do
            local d=stop.destination
            if d and not d.world then d.world=worldOf(d.mapId,d.x,d.y) end
        end
        lines=BackstageForeverTrackerLines(BackstageForeverTrackerGroups(stops,spot,playerLevel()),TRACKER_LINES,markOf)
    end
    paintList(tracker,lines,trackerClick,trackerEnter)
end
local function showTracker()
    if not enabled('tracker') then if tracker then tracker:Hide() end return false end
    if combat() then return false end
    if not tracker then
        local ok,f=pcall(buildList,'tracker','BackstageForeverTracker','Quests by distance',TRACKER_LINES,24,-150,function()
            BackstageForeverPanelSet('tracker','off');say('Quest list hidden. Type /bf tracker to bring it back.')
        end)
        tracker=ok and f or nil
        if not tracker then return false end
    end
    paintTracker();tracker:Show()
    return true
end
function BackstageForeverTrackerCommand(message)
    local arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^tracker%s*(%a*)') or ''
    local on=BackstageForeverPanelSet('tracker',arg)
    if not on then
        if tracker then tracker:Hide() end
        say('Quest list by distance: off.')
        return false
    end
    if combat() then say('Quest list by distance: on. It appears when you leave combat.') return true end
    if showTracker() then say('Quest list by distance: on. Click a quest for a waypoint; drag the panel to move it. The game\'s own tracker is left alone.')
    else say('The quest list is not available in this game client.') end
    return true
end

-- ---------------------------------------------------------------- the run panel on screen
local RUN_LINES=25
local runPanel,runNow=nil,nil -- runNow: {instanceMap=,name=,rows=,visit=}
local function clock()
    local t=call(time)
    return type(t)=='number' and t or nil
end
local function instanceNow()
    local name,kind,_,_,_,_,_,instanceMap=call(GetInstanceInfo)
    if (kind~='party' and kind~='raid') or type(instanceMap)~='number' then return nil end
    return instanceMap,type(name)=='string' and name~='' and name or nil
end
-- Works out whether you stand in a known instance, and keeps the run's start across reloads.
local function readRun()
    local at=clock()
    local s=settings()
    local instanceMap,name=instanceNow()
    local rows=instanceMap and BackstageForeverRunRows(BackstageForeverAtlasData,instanceMap) or {}
    if not at or #rows==0 then
        -- Outside: remember when you left, so a run back in after a death is the same run.
        if at and type(s.visit)=='table' and s.visit.leftAt==nil then s.visit.leftAt=at end
        runNow=nil
        return nil
    end
    local visit=BackstageForeverRunVisit(s.visit,instanceMap,at)
    s.visit=visit
    runNow={instanceMap=instanceMap,name=name or rows[1][2],rows=rows,visit=visit}
    return runNow
end
local function runEnter(line,data)
    local item=data.item
    if not item or type(GameTooltip)~='table' then return end
    pcall(GameTooltip.SetOwner,GameTooltip,line,'ANCHOR_RIGHT')
    pcall(GameTooltip.SetHyperlink,GameTooltip,'item:'..item.id)
    pcall(GameTooltip.AddLine,GameTooltip,('%s: %s (%d%%)'):format(T('Seen from'),item.boss,item.chance),1,.82,.3,true)
    pcall(GameTooltip.Show,GameTooltip)
end
local function paintRun()
    if not runPanel or not runNow then return end
    local at=clock() or runNow.visit.startedAt
    local journal=BackstageForeverJournalDB
    local bosses=BackstageForeverRunBosses(runNow.rows,type(journal)=='table' and rawget(journal,'encounters') or nil,runNow.instanceMap,runNow.visit.startedAt)
    local name,realm=me()
    local wished=type(BackstageForeverWishSet)=='function' and BackstageForeverWishSet(name,realm) or {}
    local better=type(BackstageForeverUpgradeSet)=='function' and BackstageForeverUpgradeSet(name,realm) or {}
    local state={seconds=at-runNow.visit.startedAt,bosses=bosses,
        quests=BackstageForeverRunQuests(runNow.rows,latest and latest.quests or nil,runNow.name),
        items=BackstageForeverRunItems(bosses.left,wished,better),handed=next(wished)~=nil or next(better)~=nil}
    runPanel.title:SetText(runNow.name)
    paintList(runPanel,BackstageForeverRunLines(state,itemName),nil,runEnter)
end
local function showRun()
    if not enabled('run') or not runNow then if runPanel then runPanel:Hide() end return false end
    if combat() then return false end
    if not runPanel then
        local ok,f=pcall(buildList,'run','BackstageForeverRunPanel','Dungeon run',RUN_LINES,enabled('tracker') and 24+WIDTH+12 or 24,-150,function()
            BackstageForeverPanelSet('run','off');say('Dungeon run panel hidden. Type /bf run to bring it back.')
        end)
        runPanel=ok and f or nil
        if not runPanel then return false end
    end
    paintRun();runPanel:Show()
    return true
end
function BackstageForeverRunCommand(message)
    local arg,value=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^run%s*(%a*)%s*(%a*)')
    arg=arg or ''
    if arg=='combat' then
        local stay=BackstageForeverPanelSet('runCombat',value)
        say(stay and 'The dungeon run panel now stays on screen in combat. It still only updates outside combat.' or 'The dungeon run panel now hides in combat.')
        return stay
    end
    if arg=='reset' then
        if combat() then return say('Restart the run clock outside combat.') end
        local instanceMap=instanceNow()
        local at=clock()
        if not instanceMap or not at or #BackstageForeverRunRows(BackstageForeverAtlasData,instanceMap)==0 then return say('You are not in a dungeon or raid the Instance Atlas knows.') end
        settings().visit={map=instanceMap,startedAt=at}
        readRun();showRun()
        return say('A new run starts now: the clock and the bosses left start over.')
    end
    local on=BackstageForeverPanelSet('run',arg)
    if not on then
        if runPanel then runPanel:Hide() end
        say('Dungeon run panel: off.')
        return false
    end
    if combat() then say('Dungeon run panel: on. It appears when you leave combat.') return true end
    readRun()
    if not runNow then say('Dungeon run panel: on. It appears inside a dungeon or raid the Instance Atlas knows.') return true end
    if showRun() then say('Dungeon run panel: on. Drag it to move it; /bf run reset starts the clock again.')
    else say('The dungeon run panel is not available in this game client.') end
    return true
end

-- The slow ticker: distances and the run clock move on. Never in combat.
local function tick()
    if combat() then return end
    if enabled('tracker') then pcall(showTracker) end
    if enabled('run') then pcall(readRun);pcall(showRun) end
end
-- Called by BackstageForever.lua after each capture (quest log events, never in combat).
function BackstageForeverPanelsUpdate(character)
    latest=type(character)=='table' and character or nil
    tick()
end
BackstageForeverPanelsTick=tick -- for tests

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','ZONE_CHANGED_NEW_AREA','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED','ENCOUNTER_END'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Panels',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then
                settings()
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.NewTicker)=='function' then pcall(timer.NewTicker,5,function() pcall(tick) end) end
            elseif event=='PLAYER_REGEN_DISABLED' then
                if tracker then tracker:Hide() end
                if runPanel and not enabled('runCombat') then runPanel:Hide() end
            elseif event=='ENCOUNTER_END' then
                -- The Journal writes the win down in its own handler; repaint a moment later.
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,2,function() pcall(tick) end) end
            elseif event=='PLAYER_REGEN_ENABLED' then pcall(tick)
            else pcall(tick) end -- entering or leaving an instance
        end)
    end
end

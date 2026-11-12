-- Advisor layer on WoW's own world map: quests you can pick up now (level, faction and
-- completion checked live in game), hand-ins for finished quests, your class trainer,
-- profession trainers and flight masters. Click a pin for WoW's own waypoint arrow.
-- Passive: never opens the map or polls; hidden in combat.
local H=BackstageForeverPublicFacts
local public,field,number,text=H.public,H.field,H.number,H.text
local template='BackstageForeverAdvisorPinTemplate'
local provider,attached,panel,settings=nil,nil,nil,nil
local generation=0
local hooks=setmetatable({},{__mode='k'})
local refresh
local LAYERS={'pickup','handin','class','profession','flight'}
local LABELS={pickup='Quests to pick up',handin='Quest hand-ins',class='My class trainer',profession='Profession trainers',flight='Flight masters'}
local ICONS={pickup='Interface\\GossipFrame\\AvailableQuestIcon',handin='Interface\\GossipFrame\\ActiveQuestIcon',class='Interface\\Minimap\\Tracking\\Class',profession='Interface\\Minimap\\Tracking\\Profession',flight='Interface\\Minimap\\Tracking\\FlightMaster'}
local MAX_PINS=150
local function property(value,key)
    value=public(value);if type(value)~='table' and type(value)~='userdata' then return nil end
    local ok,v=pcall(function()return value[key]end);if ok then return public(v)end
end
local function call(fn,...)
    fn=public(fn);if type(fn)~='function' then return nil end
    local ok,a,b,c=pcall(fn,...);if ok then return public(a),public(b),public(c)end
end
local function method(value,key,...)return call(property(value,key),value,...)end
local function combat()return call(InCombatLockdown)~=false end
local function say(m)if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..m)end end
local function clean(v,n)v=text(v,n or 200);if v then return (v:gsub('|','||'))end end
local function loadSettings()
    local saved=public(BackstageForeverAdvisorSettings)
    settings={enabled=field(saved,'enabled')~=false,open=field(saved,'open')==true,layers={}}
    for _,k in ipairs(LAYERS)do settings.layers[k]=field(field(saved,'layers'),k)~=false end
    BackstageForeverAdvisorSettings=settings
end

-- Who you are right now, read live from the game.
local function me()
    local level=number(call(UnitLevel,'player'),1,1000)
    local faction=text(call(UnitFactionGroup,'player'),20)
    local className=text(call(UnitClass,'player'),40)
    return {level=level,faction=faction=='Horde' and 'H' or faction=='Alliance' and 'A' or nil,className=className}
end
local function friendly(s,f)return s==nil or s=='B' or f==nil or s==f end
local function completedSet()
    local ids=call(field(public(C_QuestLog),'GetAllCompletedQuestIDs'));local out={}
    if type(ids)=='table' then for _,v in pairs(ids)do v=number(public(v),1,2147483647);if v then out[v]=true end end end
    return out
end
local function questLog()
    local api=public(C_QuestLog);local inLog,complete={},{}
    local count=number(call(field(api,'GetNumQuestLogEntries')),0,1000) or 0
    for i=1,count do
        local info=call(field(api,'GetInfo'),i)
        if type(info)=='table' and field(info,'isHeader')==false then
            local id=number(field(info,'questID'),1,2147483647)
            if id then inLog[id]=true;if call(field(api,'IsComplete'),id)==true then complete[id]=true end end
        end
    end
    return inLog,complete
end

-- Where WoW itself places each quest on this map (for finished quests: the hand-in).
local function gameQuestSpots(mapId)
    local out={}
    local list=call(field(public(C_QuestLog),'GetQuestsOnMap'),mapId)
    if type(list)=='table' then for _,info in ipairs(list)do
        local id=number(field(info,'questID'),1,2147483647);local x,y=number(field(info,'x'),0,1),number(field(info,'y'),0,1)
        if id and x and y then out[id]={x=x,y=y}end
    end end
    return out
end
local giverIndex=nil
local function giverOf(id)
    if not giverIndex then
        giverIndex={}
        for mapId,rows in pairs(field(public(BackstageForeverAdvisorData),'givers') or {})do for _,g in ipairs(rows)do giverIndex[g.q]={mapId=mapId,x=g.x,y=g.y,n=g.n,t=g.t}end end
    end
    return giverIndex[id]
end
-- Pure: the advisor pins for one map. Exposed for tests and /bf next.
-- spots: optional {questID={x,y}} from the game; hand-ins prefer it, then our reference, then the quest giver.
function BackstageForeverAdvisorPoints(mapId,who,completed,inLog,complete,layers,spots)
    local data=public(BackstageForeverAdvisorData);local out={}
    mapId=number(mapId,1,2147483647);if not mapId or type(data)~='table' or not who or not who.level then return out end
    local function on(k)return not layers or layers[k]~=false end
    local function add(p)if #out<MAX_PINS then out[#out+1]=p end end
    if on('handin')then
        local ref=field(public(BackstageForeverReference),'quests')
        for id in pairs(complete or {})do
            local q=field(ref,id);local title=clean(field(q,'title'),80) or clean(call(field(public(C_QuestLog),'GetTitleForQuestID'),id),80) or ('quest '..id)
            local t=field(q,'turnIn');local g=giverOf(id);local game=spots and spots[id]
            if game then
                add({layer='handin',x=game.x,y=game.y,title='Hand in: '..title,detail=(number(field(t,'mapId'),1,2147483647)==mapId and clean(field(t,'name'),60) or g and g.mapId==mapId and g.n) or 'Where WoW marks the hand-in',questId=id})
            elseif number(field(t,'mapId'),1,2147483647)==mapId then
                add({layer='handin',x=field(t,'x'),y=field(t,'y'),title=clean(field(t,'name'),60) or 'Hand in',detail='Hand in: '..title,questId=id})
            elseif g and g.mapId==mapId then
                add({layer='handin',x=g.x,y=g.y,title=g.n,detail='Hand in: '..title..' (usually to the quest giver)',questId=id})
            end
        end
    end
    if on('pickup')then
        for _,g in ipairs(field(field(data,'givers'),mapId) or {})do
            local l,m=g.l,g.m or 0
            if not completed[g.q] and not inLog[g.q] and friendly(g.s,who.faction) and m<=who.level and l>=who.level-3 and l<=who.level+2 then
                add({layer='pickup',x=g.x,y=g.y,title=g.n,detail=g.t..' (level '..l..')',questId=g.q,level=l})
            end
        end
    end
    local classTitle=who.className and (who.className:lower()..' trainer')
    for _,n in ipairs(field(field(data,'npcs'),mapId) or {})do
        if friendly(n.s,who.faction)then
            local role=(n.r or ''):lower()
            if n.k=='c' and on('class') and (role==classTitle or role:find('weapon master',1,true))then add({layer='class',x=n.x,y=n.y,title=n.n,detail=n.r})
            elseif n.k=='p' and on('profession')then add({layer='profession',x=n.x,y=n.y,title=n.n,detail=n.r})
            elseif n.k=='f' and on('flight')then add({layer='flight',x=n.x,y=n.y,title=n.n,detail=n.r})end
        end
    end
    return out
end

local function waypoint(mapId,x,y,label)
    if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.2f %.2f %s'):format(mapId,x*100,y*100,label or ''))end
end
local Pin={}
function Pin:OnLoad()
    method(self,'SetSize',18,18)
    self.bfIcon=method(self,'CreateTexture',nil,'ARTWORK')
    method(self.bfIcon,'SetAllPoints',self)
end
function Pin:OnAcquired(row,token,mapId)
    self.bfRow=row
    method(self.bfIcon,'SetTexture',ICONS[row.layer])
    -- Above WoW's own quest markers, below the super-tracked quest.
    method(self,'UseFrameLevelType','PIN_FRAME_LEVEL_SUPER_TRACKED_CONTENT')
    local size=row.layer=='pickup' and 16 or row.layer=='handin' and 20 or 18
    method(self,'SetSize',size,size)
    local function current()return self.bfRow==row and token==generation and not combat()end
    self.OnMouseClickAction=function(_,button)
        if public(button)~='LeftButton' or not current()then return end
        waypoint(mapId,row.x,row.y,row.title)
    end
    self.bfEnter=function()
        if not current()then return end
        method(GameTooltip,'SetOwner',self,'ANCHOR_RIGHT')
        method(GameTooltip,'SetText',row.title or '',1,.82,.3)
        if row.detail then method(GameTooltip,'AddLine',row.detail,1,1,1,true)end
        method(GameTooltip,'AddLine',('%.1f, %.1f'):format(row.x*100,row.y*100),.8,.8,.8)
        method(GameTooltip,'AddLine','Left-click: waypoint with WoW\'s own arrow.',1,.82,.3,true)
        method(GameTooltip,'Show')
    end
end
function Pin:OnMouseEnter()if self.bfEnter then self.bfEnter()end end
function Pin:OnMouseLeave()if method(GameTooltip,'GetOwner')==self then method(GameTooltip,'Hide')end end
function Pin:OnReleased()
    call(property(MapCanvasPinMixin,'OnReleased'),self)
    if method(GameTooltip,'GetOwner')==self then method(GameTooltip,'Hide')end
    self.bfRow=nil;self.bfEnter=nil;self.OnMouseClickAction=nil
end
function BackstageForeverAdvisorPin_OnLoad(frame)
    local base=public(MapCanvasPinMixin)
    if type(base)~='table' or type(public(Mixin))~='function' then return end
    call(Mixin,frame,base,Pin)
end

local function remove()generation=generation+1;if attached then method(attached,'RemoveAllPinsByTemplate',template)end end
local function controls()
    if panel or not attached or combat()then return end
    panel=call(CreateFrame,'Frame',nil,attached,'BackdropTemplate');if not panel then return end
    method(panel,'SetBackdrop',{bgFile='Interface/DialogFrame/UI-DialogBox-Background',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=true,tileSize=16,edgeSize=12,insets={left=3,right=3,top=3,bottom=3}})
    method(panel,'SetBackdropColor',.08,.06,.025,.94)
    local function button(name,y)local b=call(CreateFrame,'Button',name,panel,'UIPanelButtonTemplate');if b then method(b,'SetSize',180,22);method(b,'SetPoint','TOPLEFT',10,-y)end;return b end
    panel.toggle=button('BackstageForeverAdvisorToggle',8)
    panel.more=button('BackstageForeverAdvisorMore',32)
    panel.layers={}
    for i,k in ipairs(LAYERS)do panel.layers[k]=button('BackstageForeverAdvisorLayer'..k,34+i*24)end
end
local function place()
    if not panel then return end
    method(panel,'ClearAllPoints')
    local above=public(BackstageForeverMapPanelFrame)
    if above and method(above,'IsShown')==true then method(panel,'SetPoint','TOPLEFT',above,'BOTTOMLEFT',0,-4)
    else method(panel,'SetPoint','TOPLEFT',attached,'TOPLEFT',14,-40)end
end
local function paint()
    if not panel then return end
    local token=generation
    local function bind(control,label,fn,visible)
        method(control,'SetText',label);method(control,visible and 'Show' or 'Hide')
        method(control,'SetScript','OnClick',function()if not combat()then fn()end end)
    end
    bind(panel.toggle,settings.enabled and 'BF Guide: shown' or 'BF Guide: hidden',function()settings.enabled=not settings.enabled;refresh()end,true)
    bind(panel.more,settings.open and 'Hide guide layers' or 'Guide layers',function()settings.open=not settings.open;refresh()end,true)
    for k,control in pairs(panel.layers)do bind(control,(settings.layers[k] and '[x] ' or '[ ] ')..LABELS[k],function()settings.layers[k]=not settings.layers[k];refresh()end,settings.open)end
    method(panel,'SetSize',200,settings.open and 38+#LAYERS*24+30 or 62)
    place();method(panel,'Show')
end
refresh=function()
    remove()
    if not provider or not attached or not settings or combat() or method(attached,'IsShown')~=true then if panel then method(panel,'Hide')end;return end
    controls();paint();if not settings.enabled then return end
    local mapId=number(method(attached,'GetMapID'),1,2147483647);if not mapId then return end
    local inLog,complete=questLog()
    local rows=BackstageForeverAdvisorPoints(mapId,me(),completedSet(),inLog,complete,settings.layers,gameQuestSpots(mapId))
    local token=generation
    for _,row in ipairs(rows)do
        local pin=method(attached,'AcquirePin',template,row,token,mapId)
        if not pin or type(property(pin,'SetPosition'))~='function' then remove();return end
        if not pcall(property(pin,'SetPosition'),pin,row.x,row.y)then remove();return end
    end
end
local Provider={}
function Provider:OnAdded(map)call(property(MapCanvasDataProviderMixin,'OnAdded'),self,map)end
function Provider:RefreshAllData()if self==provider then refresh()end end
function Provider:OnMapChanged()self:RefreshAllData()end
function Provider:OnShow()self:RefreshAllData()end
function Provider:OnHide()if self==provider then remove();if panel then method(panel,'Hide')end end end
function Provider:RemoveAllData()if self==provider then remove()end end
function Provider:OnRemoved(map)
    if self==provider then remove();if panel then method(panel,'Hide')end;panel=nil;provider=nil;attached=nil end
    call(property(MapCanvasDataProviderMixin,'OnRemoved'),self,map)
end
local function attach()
    local map=public(WorldMapFrame);if not map then return end
    if not hooks[map] and type(property(map,'HookScript'))=='function' then
        hooks[map]=true;method(map,'HookScript','OnShow',function()attach();if attached==map then refresh()end end)
        method(map,'HookScript','OnHide',function()if attached==map then remove();if panel then method(panel,'Hide')end end end)
    end
    if combat() or attached==map then return end
    local base=public(MapCanvasDataProviderMixin)
    if type(base)~='table' or type(public(Mixin))~='function' then return end
    for _,key in ipairs({'AddDataProvider','AcquirePin','RemoveAllPinsByTemplate','GetMapID','IsShown'})do if type(property(map,key))~='function' then return end end
    local kind=text(property(call(property(C_XMLUtil,'GetTemplateInfo'),template),'type'),20);if kind~='Frame' and kind~='FRAME' then return end
    attached=map;provider=call(Mixin,{},base,Provider);if not provider then attached=nil;return end
    if not pcall(property(map,'AddDataProvider'),map,provider)then remove();provider=nil;attached=nil;return end
    if method(map,'IsShown')==true then refresh()end
end

-- /bf next: WoW's own waypoint on the nearest hand-in, else the nearest quest to pick up.
function BackstageForeverNext()
    if combat()then return say('Waypoints wait until you leave combat.')end
    local mapApi=public(C_Map)
    local mapId=number(call(field(mapApi,'GetBestMapForUnit'),'player'),1,2147483647)
    local pos=mapId and call(field(mapApi,'GetPlayerMapPosition'),mapId,'player')
    local px,py=nil,nil;if pos then px,py=method(pos,'GetXY')end
    if not mapId or type(px)~='number' or type(py)~='number' then return say('Your position is unavailable here.')end
    local inLog,complete=questLog()
    local rows=BackstageForeverAdvisorPoints(mapId,me(),completedSet(),inLog,complete,{class=false,profession=false,flight=false},gameQuestSpots(mapId))
    local best,bestD=nil,nil
    for _,r in ipairs(rows)do local d=((r.x-px)^2+(r.y-py)^2)^.5+(r.layer=='handin' and 0 or 1);if not bestD or d<bestD then best,bestD=r,d end end
    if not best then return say('Nothing recorded for your level in this zone. The desktop app\'s Now page suggests where to go next.')end
    waypoint(mapId,best.x,best.y,best.title)
    say((best.layer=='handin' and '' or 'Next quest: ')..(best.title or '')..' - '..(best.detail or ''))
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    for _,e in ipairs({'ADDON_LOADED','PLAYER_LOGIN','PLAYER_ENTERING_WORLD','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED','QUEST_LOG_UPDATE','QUEST_TURNED_IN','PLAYER_LEVEL_UP'})do pcall(frame.RegisterEvent,frame,e)end
    frame:SetScript('OnEvent',function(_,event)
        event=text(event,50)
        if event=='PLAYER_LOGIN' or not settings then loadSettings()end
        if event=='PLAYER_REGEN_DISABLED' then remove();if panel then method(panel,'Hide')end;return end
        attach();if provider and attached and method(attached,'IsShown')==true then refresh()end
    end)
    attach()
end

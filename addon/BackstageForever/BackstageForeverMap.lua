-- Passive owned world-map provider. It never opens/loads a map or polls the client.
local H=BackstageForeverPublicFacts
local public,field,number,text=H.public,H.field,H.number,H.text
local template='BackstageForeverMapPinTemplate'
local latest,owner,provider,attached,settings,panel=nil,nil,nil,nil,nil,nil
local generation,shownPoints=0,{}
local hooks=setmetatable({},{__mode='k'})
local refresh,attach,paint
local function property(value,key)
    value=public(value);if type(value)~='table' and type(value)~='userdata' then return nil end
    local ok,v=pcall(function()return value[key]end);if ok then return public(v)end
end
local function call(fn,...)
    fn=public(fn);if type(fn)~='function' then return nil end
    local ok,a,b=pcall(fn,...);if ok then return public(a),public(b)end
end
local function method(value,key,...)return call(property(value,key),value,...)end
local function safeText(value,limit)
    value=text(value,1000) or ''
    if #value>(limit or 240)then
        local n=(limit or 240);while n>0 and value:byte(n+1) and value:byte(n+1)>=128 and value:byte(n+1)<192 do n=n-1 end
        value=value:sub(1,n)..'...'
    end
    return value:gsub('|','||')
end
local function combat()return call(InCombatLockdown)~=false end
local function actualBuild()
    local v,b=call(GetBuildInfo);v=text(v,12);b=text(b,8);if v and b and b:match('^%d+$')then return v..'.'..b end
end
local function loadSettings()
    local saved=public(BackstageForeverMapSettings)
    settings={enabled=field(saved,'enabled')~=false,details=field(saved,'details')==true,layers={}}
    for _,key in ipairs({'quest','herbs','ore','supplies','finds','olderReferences'})do local value=field(field(saved,'layers'),key);settings.layers[key]=key=='olderReferences' and value==true or key~='olderReferences' and value~=false end
    BackstageForeverMapSettings=settings
end
local function tooltipOff(pin)
    if method(GameTooltip,'GetOwner')==pin then method(GameTooltip,'Hide')end
end
local function remove()
    generation=generation+1;shownPoints={}
    if attached then method(attached,'RemoveAllPinsByTemplate',template)end
end
local function valid(token,map,id,row)
    return token==generation and latest~=nil and owner~=nil and not combat() and attached==map and provider~=nil
        and method(map,'IsShown')==true and settings and settings.enabled and text(call(UnitGUID,'player'),200)==owner
        and text(field(latest,'clientBuild'),30)==actualBuild() and number(method(map,'GetMapID'),1,2147483647)==row.mapId and shownPoints[id]==row
end
local Pin={}
function Pin:OnLoad()
    method(self,'SetSize',20,20)
    self.bfIcon=method(self,'CreateTexture',nil,'ARTWORK')
    method(self.bfIcon,'SetAllPoints',self)
    method(self.bfIcon,'SetTexture','Interface/Buttons/WHITE8X8')
    self.bfLabel=method(self,'CreateFontString',nil,'OVERLAY','GameFontNormalSmall')
    method(self.bfLabel,'SetPoint','CENTER',self,'CENTER',0,0)
    method(self.bfLabel,'SetTextColor',.06,.04,.02,1)
end
function Pin:OnAcquired(row,token,map)
    self.bfRow=row
    local color=row.kind=='quest' and {1,.78,.18} or row.kind=='find' and {.25,.85,.85} or row.layer=='herbs' and {.35,.8,.3} or {.65,.6,.4}
    method(self.bfIcon,'SetVertexColor',color[1],color[2],color[3],.95)
    method(self.bfLabel,'SetText',row.kind=='quest' and 'Q' or row.kind=='find' and 'F' or row.layer=='herbs' and 'H' or row.layer=='ore' and 'O' or 'S')
    local function current()return self.bfRow==row and valid(token,map,row.id,row)end
    self.OnMouseClickAction=function(_,button)
        if public(button)~='LeftButton' or not current()then return end
        if row.questStep then
            local command=text(field(row.questStep,'command'),150)
            if command then call(BackstageForeverGuide,command)end
            return
        end
        local api=public(C_Map)
        if call(property(api,'CanSetUserWaypointOnMap'),row.mapId)~=true then return end
        local p=call(property(UiMapPoint,'CreateFromCoordinates'),row.mapId,row.x,row.y)
        if p and current()then call(property(api,'SetUserWaypoint'),p)end
    end
    self.bfEnter=function()
        if not current()then return end
        method(GameTooltip,'SetOwner',self,'ANCHOR_RIGHT')
        method(GameTooltip,'SetText',safeText(row.title,120),1,.82,.3)
        method(GameTooltip,'AddLine',safeText(row.detail,400),1,1,1,true)
        method(GameTooltip,'AddLine',safeText(row.qualification..' | '..row.precision,120),.8,.8,.8,true)
        method(GameTooltip,'AddLine',string.format('%.2f, %.2f',row.x*100,row.y*100),1,.82,.3)
        if row.clientBuild then method(GameTooltip,'AddLine','Build '..safeText(row.clientBuild,30),.8,.8,.8)end
        if row.observedOn then method(GameTooltip,'AddLine','Reference date '..safeText(row.observedOn,10),.8,.8,.8)end
        if row.observedAt then local date=call(date,'%Y-%m-%d %H:%M',row.observedAt);if text(date,30)then method(GameTooltip,'AddLine','Observed '..date,.8,.8,.8)end end
        method(GameTooltip,'AddLine',row.questStep and 'Left-click: chosen quest marker.' or 'Left-click: choose this past/reference marker, if supported. Coordinates are always shown above.',1,.82,.3,true)
        method(GameTooltip,'Show')
    end
end
function Pin:OnMouseEnter()if self.bfEnter then self.bfEnter()end end
function Pin:OnMouseLeave()tooltipOff(self)end
function Pin:OnReleased()
    call(property(MapCanvasPinMixin,'OnReleased'),self)
    tooltipOff(self);self.bfRow=nil;self.bfEnter=nil;self.OnMouseClickAction=nil
end
-- XML's engine callback runs during frame-pool creation, before SetOwningMap.
-- Native AcquirePin calls our visual OnLoad later. Never defer the base mixin to it.
function BackstageForeverMapPin_OnLoad(frame)
    local base=public(MapCanvasPinMixin)
    if type(base)~='table' or type(public(Mixin))~='function' or type(property(base,'SetOwningMap'))~='function' then return end
    call(Mixin,frame,base,Pin)
end
local function controls()
    if panel or not attached or combat()then return end
    panel=call(CreateFrame,'Frame',nil,attached,'BackdropTemplate');if not panel then return end
    method(panel,'SetPoint','TOPLEFT',attached,'TOPLEFT',14,-40)
    method(panel,'SetSize',200,54);method(panel,'SetBackdrop',{bgFile='Interface/DialogFrame/UI-DialogBox-Background',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=true,tileSize=16,edgeSize=12,insets={left=3,right=3,top=3,bottom=3}})
    method(panel,'SetBackdropColor',.08,.06,.025,.94)
    panel.controls={}
    local function button(name,y)
        local b=call(CreateFrame,'Button',name,panel,'UIPanelButtonTemplate');if not b then return nil end
        method(b,'SetSize',180,22);method(b,'SetPoint','TOPLEFT',10,-y);panel.controls[#panel.controls+1]=b;return b
    end
    panel.toggle=button('BackstageForeverMapLayers',8)
    panel.details=button('BackstageForeverMapDetails',32)
    panel.layers={}
    for i,key in ipairs({'quest','herbs','ore','supplies','finds','olderReferences'})do panel.layers[key]=button('BackstageForeverMapLayer'..key,34+i*24)end
    panel.recording=button('BackstageForeverMapRecording',202)
    panel.clear=button('BackstageForeverMapClear',226)
    panel.info=method(panel,'CreateFontString',nil,'OVERLAY','GameFontHighlightSmall')
    method(panel.info,'SetPoint','TOPLEFT',10,-254);method(panel.info,'SetSize',180,54);method(panel.info,'SetJustifyH','LEFT')
end
paint=function()
    if not panel then return end
    local token,map,id=generation,attached,owner
    local faction=text(field(latest,'faction'),20)
    local red,green,blue=faction=='Horde' and .72 or .25,faction=='Horde' and .2 or .45,faction=='Horde' and .15 or .85
    local _,class=call(UnitClass,'player');class=text(class,24)
    local color=class and property(RAID_CLASS_COLORS,class)
    local r,g,b=property(color,'r'),property(color,'g'),property(color,'b')
    local function channel(v)return type(v)=='number' and v==v and v>=0 and v<=1 end
    if channel(r) and channel(g) and channel(b)then red,green,blue=r,g,b end
    method(panel,'SetBackdropBorderColor',red,green,blue,1)
    local function current()return token==generation and map==attached and id==owner and latest~=nil and not combat() and method(map,'IsShown')==true and text(call(UnitGUID,'player'),200)==id end
    local function bind(control,label,fn,visible)
        method(control,'SetText',label);method(control,visible and 'Show' or 'Hide')
        method(control,'SetScript','OnClick',function()if current()then fn()end end)
    end
    bind(panel.toggle,settings.enabled and 'BF Layers: shown' or 'BF Layers: hidden',function()settings.enabled=not settings.enabled;refresh()end,true)
    bind(panel.details,settings.details and 'Less layer detail' or 'Layers & recording',function()settings.details=not settings.details;refresh()end,true)
    local labels={quest='Quest help',herbs='Herbs',ore='Ore',supplies='Supplies',finds='My finds',olderReferences='Older references'}
    for key,control in pairs(panel.layers)do bind(control,(settings.layers[key] and '[x] ' or '[ ] ')..labels[key],function()settings.layers[key]=not settings.layers[key];refresh()end,settings.details)end
    local gathering=field(latest,'gathering');local recording=field(gathering,'recording')~=false
    bind(panel.recording,recording and 'Recording: on (pause)' or 'Recording: paused (resume)',function()call(BackstageForeverGatheringSetRecording,not recording);remove();paint()end,settings.details)
    bind(panel.clear,'Clear my recorded history...',function()
        local clear=call(BackstageForeverGatheringClearAction);local confirmToken=generation
        if type(clear)~='function' then return end
        method(panel.clear,'SetText','Confirm clear own history')
        method(panel.clear,'SetScript','OnClick',function()
            if current() and confirmToken==generation then clear();refresh()end
        end)
    end,settings.details)
    method(panel.info,'SetText','Auto: owned professions / chosen recipe.\nPast places, not active resources.\nRecording covers supported interactions only.')
    method(panel.info,settings.details and 'Show' or 'Hide');method(panel,'SetSize',200,settings.details and 316 or 62)
    method(panel,'Show')
end
refresh=function()
    remove()
    if not provider or not attached or not latest or not settings or combat() or method(attached,'IsShown')~=true then if panel then method(panel,'Hide')end;return end
    if text(call(UnitGUID,'player'),200)~=owner or text(field(latest,'clientBuild'),30)~=actualBuild()then if panel then method(panel,'Hide')end;return end
    controls();paint();if not settings.enabled then return end
    local map=number(method(attached,'GetMapID'),1,2147483647);if not map then return end
    local goal=field(BackstageForeverHUDSettings,'profession')
    local model=call(BackstageForeverBuildMap,latest,{mapId=map,layers=settings.layers,goal=goal})
    if type(model)~='table' then return end
    local token=generation
    for _,row in ipairs(model.points or {})do
        shownPoints[row.id]=row
        local pin=method(attached,'AcquirePin',template,row,token,attached)
        if not pin or type(property(pin,'SetPosition'))~='function' then remove();return end
        local ok=pcall(property(pin,'SetPosition'),pin,row.x,row.y)
        if not ok then remove();return end
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
attach=function()
    local map=public(WorldMapFrame);if not map then return end
    if not hooks[map] and type(property(map,'HookScript'))=='function' then
        hooks[map]=true;method(map,'HookScript','OnShow',function()attach();if attached==map then refresh()end end)
        method(map,'HookScript','OnHide',function()if attached==map then remove();if panel then method(panel,'Hide')end end end)
    end
    if combat() or attached==map then return end
    local base,pins=public(MapCanvasDataProviderMixin),public(MapCanvasPinMixin)
    if type(base)~='table' or type(pins)~='table' or type(public(Mixin))~='function' then return end
    for _,key in ipairs({'AddDataProvider','AcquirePin','RemoveAllPinsByTemplate','GetMapID','IsShown'})do if type(property(map,key))~='function' then return end end
    for _,key in ipairs({'SetOwningMap','SetPosition','OnReleased'})do if type(property(pins,key))~='function' then return end end
    local info=call(property(C_XMLUtil,'GetTemplateInfo'),template)
    local kind=text(property(info,'type'),20);if kind~='Frame' and kind~='FRAME' then return end
    if attached then remove();if provider then method(attached,'RemoveDataProvider',provider)end end
    attached=map;provider=call(Mixin,{},base,Provider);if not provider then attached=nil;return end
    local ok=pcall(property(map,'AddDataProvider'),map,provider)
    if not ok then remove();provider=nil;attached=nil;return end
    -- AddDataProvider invokes OnAdded only, even on an already visible map.
    if method(map,'IsShown')==true then refresh()end
end
function BackstageForeverMapUpdate(character)
    remove()
    local id=text(field(character,'id'),200)
    if not id or not H.stamp(field(character,'updatedAt')) then latest=nil;owner=nil;if panel then method(panel,'Hide')end;return end
    if owner and owner~=id then if panel then method(panel,'Hide')end;loadSettings()end
    latest=character;owner=id;if not settings then loadSettings()end
    attach();if provider then refresh()end
end
function BackstageForeverMapGoalChanged()if latest then refresh()end end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    for _,event in ipairs({'ADDON_LOADED','PLAYER_LOGIN','PLAYER_LOGOUT','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED','PLAYER_ENTERING_WORLD'})do pcall(frame.RegisterEvent,frame,event)end
    frame:SetScript('OnEvent',function(_,event)
        event=text(event,50)
        if event=='PLAYER_LOGOUT' then BackstageForeverMapUpdate(nil);return end
        if event=='PLAYER_REGEN_DISABLED' then remove();if panel then method(panel,'Hide')end;return end
        if event=='PLAYER_LOGIN' then loadSettings()end
        attach();if provider then refresh()end
    end)
    attach()
end

-- Map search (roadmap W4): a small box at the bottom left of the world map. Type a name (an NPC,
-- a quest, something a vendor sells, "herb", "rare", "mailbox"...) and press Enter: up to six
-- matches from the bundled reference appear above the box. Nothing is set until you click one;
-- a click places the game's own waypoint there. Hidden in combat. /bf mapsearch on|off.
local MAX_ROWS,WIDTH,ROW=6,250,18
local function plain(v)
    if v==nil then return nil end
    if type(issecretvalue)=='function' then local ok,secret=pcall(issecretvalue,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local ok,a,b=pcall(fn,...)
    if ok then return plain(a),plain(b) end
end
local function method(o,k,...) if o and type(o[k])=='function' then return call(o[k],o,...) end end
local function T(m) return (BackstageForeverTr or tostring)(m) end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local function settings()
    if type(BackstageForeverWorldSettings)~='table' then BackstageForeverWorldSettings={} end
    return BackstageForeverWorldSettings
end

-- Pure: the rows to show for a query: {text=,way=} with the /bf way arguments for a click.
function BackstageForeverMapSearchRows(query,map,px,py)
    local out={}
    if type(BackstageForeverFindSearch)~='function' then return out end
    local names=type(BackstageForeverFindMaps)=='table' and BackstageForeverFindMaps or {}
    for _,f in ipairs(BackstageForeverFindSearch(query,map,px,py,MAX_ROWS)) do
        local r=f.r
        local label=r[1]..(f.item and (' ('..f.item..')') or r[2]~='' and (' ('..r[2]..')') or '')
        local where=(r[3]==map and '' or ((names[r[3]] or ('map '..r[3]))..' '))..('%.1f, %.1f'):format(r[4]/10,r[5]/10)
        out[#out+1]={text=label,where=where,way=('way %d %.1f %.1f %s'):format(r[3],r[4]/10,r[5]/10,r[1])}
    end
    return out
end

local holder,box,rows,note=nil,nil,{},nil
local function clear()
    for _,row in ipairs(rows) do row.way=nil;method(row,'Hide') end
    if note then method(note,'Hide') end
end
local function show(query)
    clear()
    if type(query)~='string' or query:gsub('%s','')=='' then return end
    if call(InCombatLockdown)~=false then return end
    local map,px,py
    if type(BackstageForeverFindHere)=='function' then map,px,py=BackstageForeverFindHere() end
    local found=BackstageForeverMapSearchRows(query:sub(1,60),map,px,py)
    if #found==0 then
        method(note,'SetText',T('No match in the bundled reference.'))
        method(note,'Show')
        return
    end
    for i,item in ipairs(found) do
        local row=rows[i]
        if row then
            row.way=item.way
            method(row.label,'SetText',item.text)
            method(row.where,'SetText',item.where)
            method(row,'Show')
        end
    end
end
local function build()
    if holder or type(CreateFrame)~='function' then return holder end
    local map=plain(WorldMapFrame)
    if not map or call(InCombatLockdown)~=false then return nil end
    local canvas=plain(map.ScrollContainer) or map
    holder=CreateFrame('Frame',nil,map,'BackdropTemplate')
    if not holder then return nil end
    method(holder,'SetSize',WIDTH,30)
    method(holder,'SetPoint','BOTTOMLEFT',canvas,'BOTTOMLEFT',8,8)
    method(holder,'SetFrameStrata','HIGH')
    method(holder,'SetBackdrop',{bgFile='Interface/DialogFrame/UI-DialogBox-Background',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=true,tileSize=16,edgeSize=12,insets={left=3,right=3,top=3,bottom=3}})
    method(holder,'SetBackdropColor',.08,.06,.025,.94)
    local title=holder:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    title:SetPoint('LEFT',holder,'LEFT',8,0);title:SetWidth(48);title:SetJustifyH('LEFT')
    method(title,'SetWordWrap',false)
    title:SetText(T('BF find'))
    box=CreateFrame('EditBox',nil,holder,'InputBoxTemplate')
    method(box,'SetSize',WIDTH-76,18)
    method(box,'SetPoint','LEFT',holder,'LEFT',64,0)
    method(box,'SetAutoFocus',false)
    method(box,'SetMaxLetters',60)
    method(box,'SetScript','OnEnterPressed',function(self) show(method(self,'GetText')) method(self,'ClearFocus') end)
    method(box,'SetScript','OnEscapePressed',function(self) method(self,'SetText','') method(self,'ClearFocus') clear() end)
    method(box,'SetScript','OnEnter',function(self)
        method(GameTooltip,'SetOwner',self,'ANCHOR_TOPLEFT')
        method(GameTooltip,'SetText',T('Backstage Forever map search'),1,.82,.3)
        method(GameTooltip,'AddLine',T('Type a name, a quest, an item a vendor sells, or herb, ore, rare, chest, mailbox. Press Enter. Click a match for a waypoint.'),1,1,1,true)
        method(GameTooltip,'Show')
    end)
    method(box,'SetScript','OnLeave',function(self) if method(GameTooltip,'GetOwner')==self then method(GameTooltip,'Hide') end end)
    note=holder:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    note:SetPoint('BOTTOMLEFT',holder,'TOPLEFT',8,4);note:SetWidth(WIDTH-16);note:SetJustifyH('LEFT')
    method(note,'SetWordWrap',false)
    note:Hide()
    for i=1,MAX_ROWS do
        local row=CreateFrame('Button',nil,holder,'BackdropTemplate')
        method(row,'SetSize',WIDTH,ROW)
        -- The best match sits right above the box; the others stack upwards.
        method(row,'SetPoint','BOTTOMLEFT',holder,'TOPLEFT',0,2+(i-1)*ROW)
        method(row,'SetBackdrop',{bgFile='Interface/Buttons/WHITE8X8'})
        method(row,'SetBackdropColor',.08,.06,.025,.9)
        row.label=row:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        row.label:SetPoint('LEFT',row,'LEFT',8,0);row.label:SetWidth(WIDTH-110);row.label:SetJustifyH('LEFT')
        method(row.label,'SetWordWrap',false)
        row.where=row:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
        row.where:SetPoint('RIGHT',row,'RIGHT',-8,0);row.where:SetWidth(94);row.where:SetJustifyH('RIGHT')
        method(row.where,'SetWordWrap',false)
        method(row,'SetScript','OnClick',function(self)
            -- A click is the player's own choice of this match; BackstageForeverWay refuses in combat.
            if self.way and type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,self.way) end
        end)
        method(row,'SetScript','OnEnter',function(self) method(self,'SetBackdropColor',.3,.22,.08,.95) end)
        method(row,'SetScript','OnLeave',function(self) method(self,'SetBackdropColor',.08,.06,.025,.9) end)
        row:Hide()
        rows[i]=row
    end
    return holder
end
local function refresh()
    local on=settings().searchBox~=false
    if not on or call(InCombatLockdown)~=false then if holder then method(box,'ClearFocus') method(holder,'Hide') end return end
    if build() then method(holder,'Show') end
end

function BackstageForeverMapSearchCommand(message)
    local arg=(type(message)=='string' and message:lower() or ''):match('^mapsearch%s*(%a*)') or ''
    local s=settings()
    if arg=='on' then s.searchBox=true elseif arg=='off' then s.searchBox=false
    elseif arg~='' then say(T('Use /bf mapsearch on or /bf mapsearch off.')) return s.searchBox~=false end
    pcall(refresh)
    say(T(s.searchBox~=false and 'Map search box on: it sits at the bottom left of the world map. Type a name and press Enter; click a match for a waypoint.' or 'Map search box off. /bf find NAME still works.'))
    return s.searchBox~=false
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        local hooked=false
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            local map=plain(WorldMapFrame)
            if event=='PLAYER_LOGIN' and map and not hooked and type(map.HookScript)=='function' then
                hooked=pcall(map.HookScript,map,'OnShow',function() pcall(refresh) end)
            end
            if event=='PLAYER_REGEN_DISABLED' then
                if holder then clear() method(box,'ClearFocus') method(holder,'Hide') end
            elseif map and method(map,'IsShown')==true then pcall(refresh) end
        end)
    end
end

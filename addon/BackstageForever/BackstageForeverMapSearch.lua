-- Map search (roadmap W4): a small box at the bottom left of the world map. Type a name (an NPC,
-- a quest, a dungeon or boss, something a vendor sells, "herb", "rare", "mailbox"...) and press
-- Enter: a small results panel opens above the box with up to eight matches from the bundled
-- reference, each with its kind and where it is. Nothing is set until you click one; a click
-- places the game's own waypoint there (click only). Hidden in combat. /bf mapsearch on|off.
local MAX_ROWS,WIDTH,ROW=8,300,18
local HEAD,PAD=20,6
local KIND_NAMES={f='Flight',t='Trainer',v='Vendor',q='Quest',n='NPC',x='Object',h='Herb',o='Ore',r='Rare',c='Chest',m='Mail',d='Dungeon',b='Boss'}
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

-- Pure: the rows to show for a query: {text=,where=,kind=,way=} with the /bf way arguments for a
-- click. The list also carries .total: how many different matches there are in all.
function BackstageForeverMapSearchRows(query,map,px,py)
    local out={total=0}
    if type(BackstageForeverFindSearch)~='function' then return out end
    local names=type(BackstageForeverFindMaps)=='table' and BackstageForeverFindMaps or {}
    local found=BackstageForeverFindSearch(query,map,px,py,MAX_ROWS)
    for _,f in ipairs(found) do
        local r=f.r
        -- A quest match shows the quest and who gives it; the waypoint goes to the giver.
        local label=f.quest and (f.quest..' ('..r[1]..')') or (r[1]..(f.item and (' ('..f.item..')') or r[2]~='' and (' ('..r[2]..')') or ''))
        local where=(r[3]==map and '' or ((names[r[3]] or ('map '..r[3]))..' '))..('%.1f, %.1f'):format(r[4]/10,r[5]/10)
        out[#out+1]={text=label,where=where,kind=f.quest and 'q' or r[6],way=('way %d %.1f %.1f %s'):format(r[3],r[4]/10,r[5]/10,r[1])}
    end
    out.total=type(found.total)=='number' and found.total or #out
    return out
end

local holder,box,rows,panel,head,more=nil,nil,{},nil,nil,nil
local function clear()
    for _,row in ipairs(rows) do row.way=nil;method(row,'Hide') end
    if more then method(more,'Hide') end
    if panel then method(panel,'Hide') end
end
local function show(query)
    clear()
    if type(query)~='string' or query:gsub('%s','')=='' then return end
    if call(InCombatLockdown)~=false then return end
    local map,px,py
    if type(BackstageForeverFindHere)=='function' then map,px,py=BackstageForeverFindHere() end
    local found=BackstageForeverMapSearchRows(query:sub(1,60),map,px,py)
    if #found==0 then
        method(head,'SetText',T('No match in the bundled reference.'))
        method(panel,'SetHeight',HEAD+PAD)
        method(panel,'Show')
        return
    end
    method(head,'SetText',T('Click a match for a waypoint.'))
    local shown=0
    for i,item in ipairs(found) do
        local row=rows[i]
        if row then
            shown=shown+1
            row.way=item.way
            method(row.tag,'SetText',T(KIND_NAMES[item.kind] or 'NPC'))
            method(row.label,'SetText',item.text)
            method(row.where,'SetText',item.where)
            method(row,'Show')
        end
    end
    local rest=(found.total or shown)-shown
    if rest>0 then
        method(more,'SetText',T('%d more. Type more letters.'):format(rest))
        method(more,'Show')
    end
    method(panel,'SetHeight',HEAD+shown*ROW+PAD+(rest>0 and 14 or 0))
    method(panel,'Show')
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
        method(GameTooltip,'AddLine',T('Type a name, a quest, a dungeon or boss, an item a vendor sells, or herb, ore, rare, chest, mailbox. Press Enter. Click a match for a waypoint.'),1,1,1,true)
        method(GameTooltip,'Show')
    end)
    method(box,'SetScript','OnLeave',function(self) if method(GameTooltip,'GetOwner')==self then method(GameTooltip,'Hide') end end)
    -- The results panel: one framed list above the box, best match on top. It grows with the
    -- number of matches; columns have fixed widths so long names cut off instead of overlapping.
    panel=CreateFrame('Frame',nil,holder,'BackdropTemplate')
    method(panel,'SetSize',WIDTH,HEAD+PAD)
    method(panel,'SetPoint','BOTTOMLEFT',holder,'TOPLEFT',0,2)
    method(panel,'SetBackdrop',{bgFile='Interface/DialogFrame/UI-DialogBox-Background',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=true,tileSize=16,edgeSize=12,insets={left=3,right=3,top=3,bottom=3}})
    method(panel,'SetBackdropColor',.08,.06,.025,.96)
    head=panel:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    head:SetPoint('TOPLEFT',panel,'TOPLEFT',8,-6);head:SetWidth(WIDTH-16);head:SetJustifyH('LEFT')
    method(head,'SetWordWrap',false)
    more=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    more:SetPoint('BOTTOMLEFT',panel,'BOTTOMLEFT',8,6);more:SetWidth(WIDTH-16);more:SetJustifyH('LEFT')
    method(more,'SetWordWrap',false)
    more:Hide()
    panel:Hide()
    for i=1,MAX_ROWS do
        local row=CreateFrame('Button',nil,panel,'BackdropTemplate')
        method(row,'SetSize',WIDTH-8,ROW)
        method(row,'SetPoint','TOPLEFT',panel,'TOPLEFT',4,-(HEAD+(i-1)*ROW))
        method(row,'SetBackdrop',{bgFile='Interface/Buttons/WHITE8X8'})
        method(row,'SetBackdropColor',.08,.06,.025,.9)
        -- Kind 48 | name 148 | place 84, with gaps: 6+48+4+148+4+84+6 = 300-8+8.
        row.tag=row:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
        row.tag:SetPoint('LEFT',row,'LEFT',6,0);row.tag:SetWidth(48);row.tag:SetJustifyH('LEFT')
        method(row.tag,'SetWordWrap',false)
        row.label=row:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        row.label:SetPoint('LEFT',row,'LEFT',58,0);row.label:SetWidth(WIDTH-8-58-94);row.label:SetJustifyH('LEFT')
        method(row.label,'SetWordWrap',false)
        row.where=row:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
        row.where:SetPoint('RIGHT',row,'RIGHT',-6,0);row.where:SetWidth(84);row.where:SetJustifyH('RIGHT')
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
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'MapSearch',events) end
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

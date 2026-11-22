-- The Instance Atlas in game (1.20): every dungeon and raid with its level band, entrance, bosses
-- in order, observed boss loot and a short tip per boss. /bf atlas opens it. The game has no
-- dungeon journal of its own. Reading only: the one action is a waypoint to the entrance, on click.
local T=BackstageForeverTr or function(text) return text end
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
local WIDTH,HEIGHT=680,500
local LIST_X,LIST_TOP,LIST_ROW=28,-46,15.5
local PANE_X,PANE_WIDTH=244,408
local MAX_BOSSES,MAX_LOOT=16,8

-- Pure: how an instance fits a character level.
function BackstageForeverAtlasFit(min,max,level)
    if type(min)~='number' or type(max)~='number' or type(level)~='number' then return 'later' end
    if level>max then return 'done' end
    if level>=min then return 'now' end
    if min-level<=3 then return 'soon' end
    return 'later'
end
-- Pure: "itemId~percent|..." -> {{id=,chance=}}.
function BackstageForeverAtlasLoot(text)
    local out={}
    if type(text)~='string' then return out end
    for id,chance in text:gmatch('(%d+)~(%d+)') do
        if #out<MAX_LOOT then out[#out+1]={id=tonumber(id),chance=tonumber(chance)} end
    end
    return out
end
-- Pure: the bundled tip for a boss name, or nil.
function BackstageForeverAtlasTip(name)
    local tips=type(BackstageForeverBossTips)=='table' and BackstageForeverBossTips or nil
    local tip=tips and type(name)=='string' and rawget(tips,name:lower())
    if type(tip)=='table' then tip=rawget(tip,'tip') end
    if type(tip)=='string' and tip~='' then return tip end
end
-- Pure: the row to open first: the lowest dungeon that fits now, else the next one coming up.
function BackstageForeverAtlasPick(rows,level)
    local soon
    for index,row in ipairs(rows) do
        local fit=BackstageForeverAtlasFit(row[4],row[5],level)
        if fit=='now' and row[3]=='d' then return index end
        if not soon and (fit=='soon' or fit=='later') then soon=index end
    end
    return soon or 1
end

local FIT_COLOR={now={.25,1,.25},soon={1,.82,.2},later={.85,.85,.85},done={.5,.5,.5}}
local FIT_WORD={now='Right for your level',soon='Coming up soon',later='For later',done='Below your level'}
local frame,listButtons,bossButtons,lootRows={},{},{},{}
local selected,selectedBoss=1,1
local function busy() return type(InCombatLockdown)=='function' and InCombatLockdown()~=false end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
local function rows() return type(BackstageForeverAtlasData)=='table' and BackstageForeverAtlasData or {} end
local function level()
    local value=type(UnitLevel)=='function' and UnitLevel('player')
    return type(value)=='number' and value or 1
end
local function mapName(mapId)
    if type(C_Map)~='table' or type(C_Map.GetMapInfo)~='function' or mapId==0 then return nil end
    local ok,info=pcall(C_Map.GetMapInfo,mapId)
    if ok and type(info)=='table' and type(info.name)=='string' then return info.name end
end
local function itemLabel(id)
    if type(GetItemInfo)=='function' then
        local ok,name,link=pcall(GetItemInfo,id)
        if ok and type(link)=='string' then return link end
        if ok and type(name)=='string' then return name end
    end
    if type(C_Item)=='table' and type(C_Item.RequestLoadItemDataByID)=='function' then pcall(C_Item.RequestLoadItemDataByID,id) end
    return T('Item')..' #'..id
end
local function showBoss()
    local row=rows()[selected]
    local boss=row and row[10][selectedBoss]
    if not boss then frame.bossName:SetText('');frame.tip:SetText('');for _,l in ipairs(lootRows) do l:Hide() end return end
    frame.bossName:SetText(boss[1])
    frame.tip:SetText(T(BackstageForeverAtlasTip(boss[1]) or 'No tip for this boss yet.'))
    local loot=BackstageForeverAtlasLoot(boss[2])
    for i,line in ipairs(lootRows) do
        local item=loot[i]
        if item then
            line.item=item.id
            line.text:SetText(itemLabel(item.id)..'  |cffaaaaaa'..item.chance..'%|r')
            line:Show()
        else line.item=nil;line:Hide() end
    end
    frame.noLoot:SetText(#loot==0 and T('No drops recorded for this boss yet.') or '')
    for i,button in ipairs(bossButtons) do
        if i==selectedBoss then button:LockHighlight() else button:UnlockHighlight() end
    end
end
local function showInstance()
    local row=rows()[selected]
    if not row then return end
    local fit=BackstageForeverAtlasFit(row[4],row[5],level())
    frame.banner:SetTexture(ART..'Dungeons\\'..row[1])
    frame.name:SetText(row[2])
    local place=mapName(row[7])
    local side=row[6]=='A' and T('Alliance side') or row[6]=='H' and T('Horde side') or nil
    frame.facts:SetText(('%s %d-%d  ·  %s%s%s'):format(T('Levels'),row[4],row[5],T(row[3]=='r' and 'Raid' or 'Dungeon'),
        place and ('  ·  '..place) or '',side and ('  ·  '..side) or ''))
    local color=FIT_COLOR[fit]
    frame.fit:SetText(T(FIT_WORD[fit]));frame.fit:SetTextColor(color[1],color[2],color[3])
    if row[7]~=0 then frame.entrance:Show() else frame.entrance:Hide() end
    for i,button in ipairs(bossButtons) do
        local boss=row[10][i]
        if boss then button:SetText(i..'. '..boss[1]);button:Show() else button:Hide() end
    end
    for i,button in ipairs(listButtons) do
        local r=rows()[i]
        if r then
            local c=FIT_COLOR[BackstageForeverAtlasFit(r[4],r[5],level())]
            button.label:SetText(r[2]);button.label:SetTextColor(c[1],c[2],c[3])
            button.band:SetText(r[4]..'-'..r[5]);button.band:SetTextColor(c[1],c[2],c[3])
            if i==selected then button.mark:Show() else button.mark:Hide() end
            button:Show()
        else button:Hide() end
    end
    showBoss()
end
local function build()
    if frame.window or type(CreateFrame)~='function' or not UIParent then return frame.window end
    local f=CreateFrame('Frame','BackstageForeverAtlas',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT);f:SetPoint('CENTER',0,10)
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',f.StartMoving);f:SetScript('OnDragStop',f.StopMovingOrSizing)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',40,14)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.98) end
    local crest=f:CreateTexture(nil,'ARTWORK');crest:SetTexture(ART..'Frames\\compass-crest')
    crest:SetSize(96,48);crest:SetPoint('BOTTOM',f,'TOP',0,-16)
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    title:SetPoint('TOP',0,-16);title:SetText(T('Instance Atlas'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(24,24);close:SetPoint('TOPRIGHT',-4,-4);close:SetScript('OnClick',function() f:Hide() end)
    -- Left: every instance, coloured by how it fits your level.
    for i=1,28 do
        local button=CreateFrame('Button',nil,f)
        button:SetSize(204,15);button:SetPoint('TOPLEFT',LIST_X,LIST_TOP-(i-1)*LIST_ROW)
        button.mark=button:CreateTexture(nil,'BACKGROUND');button.mark:SetAllPoints();button.mark:SetColorTexture(.79,.62,.27,.28)
        local hover=button:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        button.label=button:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        button.label:SetPoint('LEFT',4,0);button.label:SetWidth(154);button.label:SetJustifyH('LEFT');button.label:SetWordWrap(false)
        button.band=button:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        button.band:SetPoint('RIGHT',-4,0);button.band:SetJustifyH('RIGHT')
        button:SetScript('OnClick',function() selected=i;selectedBoss=1;showInstance() end)
        listButtons[i]=button
    end
    local divider=f:CreateTexture(nil,'OVERLAY');divider:SetColorTexture(.79,.62,.27,.5)
    divider:SetSize(1,HEIGHT-74);divider:SetPoint('TOPLEFT',236,-44)
    -- Right: the painting, the facts, the bosses and the chosen boss.
    frame.banner=f:CreateTexture(nil,'ARTWORK');frame.banner:SetSize(PANE_WIDTH,102);frame.banner:SetPoint('TOPLEFT',PANE_X,-44)
    local shade=f:CreateTexture(nil,'ARTWORK',nil,1);shade:SetColorTexture(0,0,0,.6)
    shade:SetPoint('BOTTOMLEFT',frame.banner,'BOTTOMLEFT');shade:SetPoint('BOTTOMRIGHT',frame.banner,'BOTTOMRIGHT');shade:SetHeight(26)
    frame.name=f:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    frame.name:SetPoint('BOTTOMLEFT',frame.banner,'BOTTOMLEFT',8,6)
    frame.fit=f:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    frame.fit:SetPoint('BOTTOMRIGHT',frame.banner,'BOTTOMRIGHT',-8,8)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.9)
    rule:SetSize(PANE_WIDTH,1);rule:SetPoint('TOPLEFT',frame.banner,'BOTTOMLEFT',0,0)
    frame.facts=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    frame.facts:SetPoint('TOPLEFT',PANE_X,-154);frame.facts:SetWidth(280);frame.facts:SetJustifyH('LEFT');frame.facts:SetWordWrap(false)
    frame.entrance=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    frame.entrance:SetSize(118,20);frame.entrance:SetPoint('TOPRIGHT',f,'TOPLEFT',PANE_X+PANE_WIDTH,-150)
    frame.entrance:SetText(T('Show entrance'))
    frame.entrance:SetScript('OnClick',function()
        local row=rows()[selected]
        if not row or row[7]==0 then return end
        if busy() then say('Waypoints wait until you leave combat.') return end
        if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.2f %.2f %s'):format(row[7],row[8]*100,row[9]*100,row[2])) end
    end)
    for i=1,MAX_BOSSES do
        local button=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        local column,line=(i-1)%2,math.floor((i-1)/2)
        button:SetSize(200,18);button:SetPoint('TOPLEFT',PANE_X+column*208,-180-line*19)
        button:SetScript('OnClick',function() selectedBoss=i;showBoss() end)
        bossButtons[i]=button
    end
    local rule2=f:CreateTexture(nil,'OVERLAY');rule2:SetColorTexture(.79,.62,.27,.5)
    rule2:SetSize(PANE_WIDTH,1);rule2:SetPoint('TOPLEFT',PANE_X,-338)
    frame.bossName=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    frame.bossName:SetPoint('TOPLEFT',PANE_X,-346)
    frame.tip=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    frame.tip:SetPoint('TOPLEFT',PANE_X,-364);frame.tip:SetSize(PANE_WIDTH,36);frame.tip:SetJustifyH('LEFT');frame.tip:SetJustifyV('TOP');frame.tip:SetWordWrap(true)
    frame.noLoot=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    frame.noLoot:SetPoint('TOPLEFT',PANE_X,-406)
    for i=1,MAX_LOOT do
        local line=CreateFrame('Button',nil,f)
        local column,rowIndex=(i-1)%2,math.floor((i-1)/2)
        line:SetSize(200,16);line:SetPoint('TOPLEFT',PANE_X+column*208,-404-rowIndex*17)
        line.text=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.text:SetAllPoints();line.text:SetJustifyH('LEFT');line.text:SetWordWrap(false)
        line:SetScript('OnEnter',function(self)
            if not self.item or type(GameTooltip)~='table' then return end
            pcall(GameTooltip.SetOwner,GameTooltip,self,'ANCHOR_RIGHT')
            pcall(GameTooltip.SetHyperlink,GameTooltip,'item:'..self.item)
            pcall(GameTooltip.Show,GameTooltip)
        end)
        line:SetScript('OnLeave',function() if type(GameTooltip)=='table' then pcall(GameTooltip.Hide,GameTooltip) end end)
        lootRows[i]=line
    end
    f:RegisterEvent('PLAYER_REGEN_DISABLED');f:RegisterEvent('GET_ITEM_INFO_RECEIVED')
    f:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_REGEN_DISABLED' then f:Hide() elseif f:IsShown() then showBoss() end
    end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverAtlas') end
    frame.window=f
    return f
end

-- /bf atlas, or /bf atlas dm to open on one instance.
function BackstageForeverAtlasCommand(message)
    local want=type(message)=='string' and message:lower():match('^atlas%s+(%w+)') or nil
    if frame.window and frame.window:IsShown() and not want then frame.window:Hide() return false end
    if busy() then say('Open the Instance Atlas outside combat.') return false end
    if #rows()==0 then say('The Instance Atlas data is missing; update Backstage Forever.') return false end
    local ok,f=pcall(build)
    if not ok or not f then say('The Instance Atlas is not available in this game client.') return false end
    selected=BackstageForeverAtlasPick(rows(),level())
    for index,row in ipairs(rows()) do if want and row[1]==want then selected=index end end
    selectedBoss=1
    showInstance();f:Show()
    return true
end

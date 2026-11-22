-- The Instance Atlas in game (1.20): every dungeon and raid with its level band, entrance, bosses
-- in order, observed boss loot and a short tip per boss. /bf atlas opens it. The game has no
-- dungeon journal of its own. Reading only: the one action is a waypoint to the entrance, on click.
local T=BackstageForeverTr or function(text) return text end
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
local WIDTH,HEIGHT=680,500
local LIST_X,LIST_TOP,LIST_ROW=28,-46,15.5
local PANE_X,PANE_WIDTH=244,408
local MAX_BOSSES,MAX_LOOT,MAX_QUESTS=16,8,6

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

-- Pure: the wish list the desktop app handed over for this character ("Name-Realm"), as a set of item ids.
-- BackstageForeverDesktop.lua is written by the desktop app and read at login or /reload.
local function handed(name,realm,key)
    local set={}
    local data=type(BackstageForeverDesktopData)=='table' and BackstageForeverDesktopData or nil
    if not data or rawget(data,'schema')~=1 or type(name)~='string' or type(realm)~='string' then return set end
    local characters=rawget(data,'characters')
    local row=type(characters)=='table' and rawget(characters,name..'-'..realm)
    local wish=type(row)=='table' and rawget(row,key)
    for _,id in ipairs(type(wish)=='table' and wish or {}) do if type(id)=='number' then set[id]=true end end
    return set
end
function BackstageForeverWishSet(name,realm) return handed(name,realm,'wish') end
-- Pure: the dungeon drops the desktop app rated as an upgrade over what this character wore when
-- the desktop last read its saved file.
function BackstageForeverUpgradeSet(name,realm) return handed(name,realm,'up') end
-- Pure: how many of an instance row's recorded drops are in the set.
function BackstageForeverWishCount(row,set)
    local count,seen=0,{}
    for _,boss in ipairs(type(row)=='table' and type(row[10])=='table' and row[10] or {}) do
        for _,item in ipairs(BackstageForeverAtlasLoot(boss[2])) do
            if set[item.id] and not seen[item.id] then seen[item.id]=true;count=count+1 end
        end
    end
    return count
end
local FIT_COLOR={now={.25,1,.25},soon={1,.82,.2},later={.85,.85,.85},done={.5,.5,.5}}
local FIT_WORD={now='Right for your level',soon='Coming up soon',later='For later',done='Below your level'}
local frame,listButtons,bossButtons,lootRows={},{},{},{}
local selected,selectedBoss,showQuests=1,1,false
local questRows={}
local function busy() return type(InCombatLockdown)=='function' and InCombatLockdown()~=false end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
local function wishes()
    local okName,name=pcall(UnitName,'player') local okRealm,realm=pcall(GetRealmName)
    return BackstageForeverWishSet(okName and name or nil,okRealm and realm or nil)
end
local function upgrades()
    local okName,name=pcall(UnitName,'player') local okRealm,realm=pcall(GetRealmName)
    return BackstageForeverUpgradeSet(okName and name or nil,okRealm and realm or nil)
end
-- Pure: the coloured words in front of a drop: gold for a wish, green for an upgrade.
function BackstageForeverAtlasMarks(id,wished,better)
    return ((type(wished)=='table' and wished[id]) and ('|cffffd100'..T('Wish')..'|r ') or '')
        ..((type(better)=='table' and better[id]) and ('|cff40ff40'..T('Upgrade')..'|r ') or '')
end
-- Pure: the line under an instance's name: wishes and upgrades it holds, then the level fit.
function BackstageForeverAtlasFitLine(row,fit,wished,better)
    local wishCount,upCount=BackstageForeverWishCount(row,wished),BackstageForeverWishCount(row,better)
    return (wishCount>0 and ('|cffffd100'..wishCount..' '..T('on your wish list')..'|r  ·  ') or '')
        ..(upCount>0 and ('|cff40ff40'..upCount..' '..T(upCount==1 and 'upgrade for you' or 'upgrades for you')..'|r  ·  ') or '')
        ..T(FIT_WORD[fit])
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
-- Pure: quests of one instance row that this side can take, each with where it stands for the player.
-- state(id) returns 'done', 'log' or nil.
function BackstageForeverAtlasQuests(row,faction,state)
    local out={}
    local mine=faction=='Alliance' and 'A' or faction=='Horde' and 'H' or nil
    for _,q in ipairs(type(row)=='table' and type(row[11])=='table' and row[11] or {}) do
        if not mine or q[4]=='B' or q[4]==mine then
            out[#out+1]={id=q[1],title=q[2],level=q[3],giver=q[5]~='' and q[5] or nil,map=q[6],x=q[7],y=q[8],state=type(state)=='function' and state(q[1]) or nil}
        end
    end
    return out
end
local function questState(id)
    local api=C_QuestLog
    if type(api)~='table' then return nil end
    if type(api.IsQuestFlaggedCompleted)=='function' then local ok,done=pcall(api.IsQuestFlaggedCompleted,id);if ok and done==true then return 'done' end end
    if type(api.IsOnQuest)=='function' then local ok,on=pcall(api.IsOnQuest,id);if ok and on==true then return 'log' end end
end
local function faction()
    local ok,side=pcall(UnitFactionGroup,'player')
    return ok and type(side)=='string' and side or nil
end
local function showQuestList()
    local list=BackstageForeverAtlasQuests(rows()[selected],faction(),questState)
    frame.bossName:SetText(T('Quests to bring'))
    frame.tip:SetText(#list==0 and T('No quests known for this place yet.') or T('Green: done. Yellow: in your log. Click one for an arrow to its giver.'))
    frame.noLoot:SetText('')
    for _,l in ipairs(lootRows) do l:Hide() end
    for i,line in ipairs(questRows) do
        local q=list[i]
        if q then
            line.quest=q
            local color=q.state=='done' and '|cff40ff40' or q.state=='log' and '|cffffd133' or '|cffffffff'
            line.text:SetText(color..q.title..'|r'..(q.level>0 and ('  |cffaaaaaa'..q.level..'|r') or '')..(q.giver and ('  |cffaaaaaa'..q.giver..'|r') or ''))
            line:Show()
        else line.quest=nil;line:Hide() end
    end
end
local function showBoss()
    for _,l in ipairs(questRows) do l:Hide() end
    if showQuests then showQuestList() return end
    local row=rows()[selected]
    local boss=row and row[10][selectedBoss]
    if not boss then frame.bossName:SetText('');frame.tip:SetText('');for _,l in ipairs(lootRows) do l:Hide() end return end
    frame.bossName:SetText(boss[1])
    frame.tip:SetText(T(BackstageForeverAtlasTip(boss[1]) or 'No tip for this boss yet.'))
    local loot=BackstageForeverAtlasLoot(boss[2])
    local wished,better=wishes(),upgrades()
    for i,line in ipairs(lootRows) do
        local item=loot[i]
        if item then
            line.item=item.id
            -- A gold mark on items starred on the desktop, a green one on upgrades it found.
            line.text:SetText(BackstageForeverAtlasMarks(item.id,wished,better)..itemLabel(item.id)..'  |cffaaaaaa'..item.chance..'%|r')
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
    frame.fit:SetText(BackstageForeverAtlasFitLine(row,fit,wishes(),upgrades()));frame.fit:SetTextColor(color[1],color[2],color[3])
    if row[7]~=0 then frame.entrance:Show() else frame.entrance:Hide() end
    local count=#BackstageForeverAtlasQuests(row,faction())
    frame.questsButton:SetText(showQuests and T('Bosses') or (T('Quests')..' ('..count..')'))
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
        button:SetScript('OnClick',function() selected=i;selectedBoss=1;showQuests=false;showInstance() end)
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
    frame.facts:SetPoint('TOPLEFT',PANE_X,-154);frame.facts:SetWidth(180);frame.facts:SetJustifyH('LEFT');frame.facts:SetWordWrap(false)
    frame.entrance=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    frame.entrance:SetSize(118,20);frame.entrance:SetPoint('TOPRIGHT',f,'TOPLEFT',PANE_X+PANE_WIDTH,-150)
    frame.entrance:SetText(T('Show entrance'))
    frame.entrance:SetScript('OnClick',function()
        local row=rows()[selected]
        if not row or row[7]==0 then return end
        if busy() then say('Waypoints wait until you leave combat.') return end
        if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.2f %.2f %s'):format(row[7],row[8]*100,row[9]*100,row[2])) end
    end)
    frame.questsButton=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    frame.questsButton:SetSize(96,20);frame.questsButton:SetPoint('RIGHT',frame.entrance,'LEFT',-6,0)
    frame.questsButton:SetScript('OnClick',function() showQuests=not showQuests;showInstance() end)
    for i=1,MAX_QUESTS do
        local line=CreateFrame('Button',nil,f)
        line:SetSize(PANE_WIDTH,15);line:SetPoint('TOPLEFT',PANE_X,-384-(i-1)*16)
        line.text=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.text:SetAllPoints();line.text:SetJustifyH('LEFT');line.text:SetWordWrap(false)
        local hover=line:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        line:SetScript('OnClick',function(self)
            local q=self.quest
            if not q or q.map==0 then say('The giver of this quest is not known yet.') return end
            if busy() then say('Waypoints wait until you leave combat.') return end
            if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,('way %d %.2f %.2f %s'):format(q.map,q.x*100,q.y*100,q.giver or q.title)) end
        end)
        line:Hide()
        questRows[i]=line
    end
    for i=1,MAX_BOSSES do
        local button=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        local column,line=(i-1)%2,math.floor((i-1)/2)
        button:SetSize(200,18);button:SetPoint('TOPLEFT',PANE_X+column*208,-180-line*19)
        button:SetScript('OnClick',function() selectedBoss=i;showQuests=false;showInstance() end)
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

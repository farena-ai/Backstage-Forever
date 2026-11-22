-- One painted settings window for every in-game helper (1.18). It changes nothing itself:
-- each switch runs the same /bf command a player would type, so behaviour and messages match.
-- Opened by /bf options, a right-click on the owl, a keybinding, or the game's own options list.
local T=BackstageForeverTr or function(text) return text end
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
local WIDTH,HEIGHT=560,470
local COLUMN_X={34,292}
local ROW_TOP,ROW_HEIGHT,ROWS_PER_COLUMN=-150,25,8

local function saved(name,key)
    local t=_G[name]
    if type(t)=='table' then return rawget(t,key) end
end
local function run(command)
    local handler=type(SlashCmdList)=='table' and SlashCmdList.BACKSTAGEFOREVER
    if type(handler)=='function' then pcall(handler,command) end
end
-- on: nil counts as on. off: nil counts as off.
local function on(name,key) return function() return saved(name,key)~=false end end
local function off(name,key) return function() return saved(name,key)==true end end
local function helper(key,label,about)
    return {label=label,about=about,
        get=function() return type(BackstageForeverHelperEnabled)=='function' and BackstageForeverHelperEnabled(key)==true end,
        set=function(value) run('helpers '..key..(value and ' on' or ' off')) end}
end
local function switch(label,about,get,command)
    return {label=label,about=about,get=get,set=function(value) run(command..(value and ' on' or ' off')) end}
end

local PAGES={
    {title='Quests',rows={
        helper('questTracker','Quest tracker','The Compass follows the quest you are watching and shows what it still needs.'),
        helper('objectiveHints','Objective hints','Enemy tooltips say when a quest in your log needs that enemy.'),
        helper('questDetours','Quest detours','The Compass offers a nearby quest stop that fits your route. You choose.'),
        helper('beforeLeaving','Before leaving reminders','A reminder to hand in finished quests before you leave the area.'),
        helper('rewardReasons','Quest reward reasons','Marks a quest reward that is a clear upgrade and says why. You still pick.'),
        helper('questBlockers','Quest blockers','/bf compass missing explains what the tracked quest is waiting for.'),
        helper('sharedObjectives','Shared objectives','Points out when one enemy counts for two of your quests.'),
        helper('keepQuestItems','Keep quest items','Bag tooltips mark items a quest in your log still needs.'),
        helper('questItemCue','Quest item cue','A cue when you carry a quest item and stand where it is used.'),
        switch('Quest icons over enemies','A ! over the nameplate of enemies a quest still needs.',on('BackstageForeverRouteSettings','plates'),'plates'),
        switch('Gear hints','Upgrade lines on item tooltips and on quest rewards.',on('BackstageForeverGearSettings','enabled'),'gear'),
        helper('spellRankReminder','Spell rank reminder','Tells you when your action bar still holds a lower rank of a spell you have trained.'),
    }},
    {title='Alerts',rows={
        switch('Pop-up tips','Painted banners for level-ups, finished quests, deaths and repairs.',on('BackstageForeverAssistSettings','toasts'),'toasts'),
        switch('Moment banners','A short banner after combat for elite, rare and boss kills and profession milestones.',on('BackstageForeverMomentsSettings','toasts'),'moments'),
        switch('Danger warnings','A line above your target when it is far above your level or elite.',on('BackstageForeverAssistSettings','danger'),'danger'),
        switch('Boss tips','A short plain tip the first time you target a covered boss.',on('BackstageForeverAssistSettings','bossTips'),'boss'),
        switch('Enemy player alerts','Says when an enemy player is nearby. Never in battlegrounds.',on('BackstageForeverEnemySettings','enabled'),'enemy'),
        switch('Enemy alert sound','Plays a sound with the enemy player alert.',off('BackstageForeverEnemySettings','sound'),'enemy sound'),
        switch('Supply reminders','Ammo, food and drink, pet food, shards and poisons before you run out.',on('BackstageForeverSuppliesSettings','enabled'),'supplies'),
        helper('gatheringMarks','Gathering marks','Recent herb and ore spots you found, on the world map.'),
    }},
    {title='Comfort',rows={
        switch('Sell junk button','A button at vendors that sells grey items when you click it. Quest items are never sold.',on('BackstageForeverAssistSettings','junk'),'junk'),
        switch('Coordinates','Your map coordinates under the minimap.',off('BackstageForeverQoLSettings','coords'),'qol coords'),
        switch('Faster looting','Loot windows empty at once when auto-loot is on.',off('BackstageForeverQoLSettings','loot'),'qol loot'),
        switch('Dismount at flight masters','Gets you off your mount when you open the flight map.',off('BackstageForeverQoLSettings','dismount'),'qol dismount'),
        switch('Instant quest text','Quest text appears at once instead of scrolling in.',off('BackstageForeverQoLSettings','questtext'),'qol questtext'),
        switch('Price memory','Remembers prices on Auction House pages you open yourself. It never searches or buys.',on('BackstageForeverLedgerDB','pricesOn'),'prices'),
        switch('Party sync','Shares quest needs with party members who also run Backstage Forever.',on('BackstageForeverPartySettings','enabled'),'party'),
        switch('Live link to the desktop app','A thin dark line at the top edge that the desktop app reads. Nothing is sent over the internet.',on('BackstageForeverLiveSettings','enabled'),'live'),
        {label='Owl button on the minimap',about='Left-click asks the companion; right-click opens these settings. /bf ask show brings it back.',
            get=function() return saved('BackstageForeverAskSettings','hidden')~=true end,
            set=function(value) run(value and 'ask show' or 'ask hide') end},
    }},
}
BackstageForeverOptionsPages=PAGES

-- Presets only flip switches listed here, and say what they changed.
local PRESETS={
    {title='Quiet',about='Fewer interruptions: banners, enemy alerts and detour offers off. Safety warnings stay on.',
        off={'Pop-up tips','Moment banners','Enemy player alerts','Enemy alert sound','Quest detours','Before leaving reminders','Supply reminders'},on={'Danger warnings'}},
    {title='Leveling',about='The way Backstage Forever starts: every guide and reminder on, comfort extras off.',
        on={'Quest tracker','Objective hints','Quest detours','Before leaving reminders','Quest reward reasons','Quest blockers','Shared objectives','Keep quest items','Quest item cue','Quest icons over enemies','Gear hints','Pop-up tips','Moment banners','Danger warnings','Boss tips','Enemy player alerts','Supply reminders','Sell junk button'},
        off={'Enemy alert sound','Coordinates','Faster looting','Dismount at flight masters','Instant quest text'}},
    {title='Veteran',about='For players who know the way: beginner banners off, coordinates and fast looting on.',
        off={'Pop-up tips','Danger warnings','Before leaving reminders','Quest reward reasons'},on={'Coordinates','Faster looting','Instant quest text','Quest icons over enemies','Boss tips'}},
}
BackstageForeverOptionsPresets=PRESETS

local function find(label)
    for _,page in ipairs(PAGES) do for _,row in ipairs(page.rows) do if row.label==label then return row end end end
end
-- Returns how many switches changed.
function BackstageForeverOptionsApplyPreset(preset)
    local changed=0
    for _,pair in ipairs({{preset.on,true},{preset.off,false}}) do
        for _,label in ipairs(pair[1] or {}) do
            local row=find(label)
            if row and row.get()~=pair[2] then row.set(pair[2]);changed=changed+1 end
        end
    end
    return changed
end

local frame,checks,pageButtons,about,current=nil,{},{},nil,1
local function busy() return type(InCombatLockdown)=='function' and InCombatLockdown()~=false end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
local DEFAULT_ABOUT='Point at a switch to read what it does. Settings belong to this character.'
local function refresh()
    if not frame then return end
    local rows=PAGES[current].rows
    -- Two even columns: a page of nine shows five and four, not eight and one.
    local half=math.ceil(#rows/2)
    for i,check in ipairs(checks) do
        local row=rows[i]
        if row then
            check:ClearAllPoints()
            check:SetPoint('TOPLEFT',frame,'TOPLEFT',COLUMN_X[i>half and 2 or 1],ROW_TOP-((i-1)%half)*ROW_HEIGHT)
            check.row=row;check:SetChecked(row.get());check.caption:SetText(T(row.label));check:Show()
        else check.row=nil;check:Hide() end
    end
    for i,button in ipairs(pageButtons) do
        if i==current then button:LockHighlight() else button:UnlockHighlight() end
    end
    about:SetText(T(DEFAULT_ABOUT))
    local ok,line=pcall(BackstageForeverBuildBadge)
    frame.badge:SetText(ok and type(line)=='string' and line or '')
end
local function build()
    if frame or type(CreateFrame)~='function' or not UIParent then return frame end
    local f=CreateFrame('Frame','BackstageForeverOptions',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT);f:SetPoint('CENTER',0,20)
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',f.StartMoving);f:SetScript('OnDragStop',f.StopMovingOrSizing)
    -- The same painted leather-and-brass frame and crest as the Adventure Compass.
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',40,14)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.98) end
    local crest=f:CreateTexture(nil,'ARTWORK');crest:SetTexture(ART..'Frames\\compass-crest')
    crest:SetSize(96,48);crest:SetPoint('BOTTOM',f,'TOP',0,-16)
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    title:SetPoint('TOP',0,-16);title:SetText('Backstage Forever')
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(24,24);close:SetPoint('TOPRIGHT',-4,-4);close:SetScript('OnClick',function() f:Hide() end)
    -- Header painting (the first-login overlook), a gold rule under it.
    local scene=f:CreateTexture(nil,'ARTWORK');scene:SetTexture(ART..'Messages\\ready')
    scene:SetSize(496,62);scene:SetPoint('TOP',0,-42)
    -- Which game build this is and where the quest data stands, on the painting's lower edge.
    local shade=f:CreateTexture(nil,'ARTWORK',nil,1);shade:SetColorTexture(0,0,0,.55)
    shade:SetPoint('BOTTOMLEFT',scene,'BOTTOMLEFT',0,0);shade:SetPoint('BOTTOMRIGHT',scene,'BOTTOMRIGHT',0,0);shade:SetHeight(16)
    local badge=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    badge:SetPoint('BOTTOMRIGHT',scene,'BOTTOMRIGHT',-6,3);badge:SetJustifyH('RIGHT')
    f.badge=badge
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.9)
    rule:SetSize(496,1);rule:SetPoint('TOP',scene,'BOTTOM',0,0)
    for i,page in ipairs(PAGES) do
        local button=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        button:SetSize(156,22);button:SetPoint('TOPLEFT',34+(i-1)*168,-114);button:SetText(T(page.title))
        button:SetScript('OnClick',function() current=i;refresh() end)
        pageButtons[i]=button
    end
    for i=1,ROWS_PER_COLUMN*2 do
        local check=CreateFrame('CheckButton',nil,f,'UICheckButtonTemplate')
        check:SetSize(24,24)
        local caption=check:CreateFontString(nil,'OVERLAY','GameFontHighlight')
        caption:SetPoint('LEFT',check,'RIGHT',4,0);caption:SetWidth(212);caption:SetJustifyH('LEFT');caption:SetWordWrap(false)
        check.caption=caption
        check:SetScript('OnClick',function(self)
            if busy() then self:SetChecked(not self:GetChecked());say('Change settings outside combat.');return end
            if self.row then self.row.set(self:GetChecked()==true);self:SetChecked(self.row.get()) end
        end)
        check:SetScript('OnEnter',function(self) if self.row then about:SetText(T(self.row.about)) end end)
        check:SetScript('OnLeave',function() about:SetText(T(DEFAULT_ABOUT)) end)
        checks[i]=check
    end
    local rule2=f:CreateTexture(nil,'OVERLAY');rule2:SetColorTexture(.79,.62,.27,.5)
    rule2:SetSize(496,1);rule2:SetPoint('BOTTOM',0,96)
    about=f:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    about:SetPoint('BOTTOMLEFT',34,58);about:SetSize(492,32);about:SetJustifyH('LEFT');about:SetJustifyV('TOP');about:SetWordWrap(true)
    local label=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    label:SetPoint('BOTTOMLEFT',34,32);label:SetText(T('Start from:'))
    for i,preset in ipairs(PRESETS) do
        local button=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        button:SetSize(104,22);button:SetPoint('BOTTOMLEFT',112+(i-1)*112,26);button:SetText(T(preset.title))
        button:SetScript('OnEnter',function() about:SetText(T(preset.about)) end)
        button:SetScript('OnLeave',function() about:SetText(T(DEFAULT_ABOUT)) end)
        button:SetScript('OnClick',function()
            if busy() then say('Change settings outside combat.');return end
            local changed=BackstageForeverOptionsApplyPreset(preset)
            refresh()
            say(T(preset.title)..': '..changed..' '..T('settings changed for this character.'))
        end)
    end
    f:RegisterEvent('PLAYER_REGEN_DISABLED');f:SetScript('OnEvent',function() f:Hide() end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverOptions') end
    frame=f
    return f
end

function BackstageForeverOptionsOpen(page)
    if busy() then say('Open settings outside combat.');return false end
    local ok,f=pcall(build)
    if not ok or not f then say('Settings are not available in this game client. Use /bf help for the commands.');return false end
    if type(page)=='number' and PAGES[page] then current=page end
    refresh();f:Show()
    return true
end
function BackstageForeverOptionsToggle()
    if frame and frame:IsShown() then frame:Hide();return false end
    return BackstageForeverOptionsOpen()
end
function BackstageForeverOptionsCommand() return BackstageForeverOptionsToggle() end

-- Key bindings (Bindings.xml): names shown in the game's Key Bindings list.
BINDING_HEADER_BACKSTAGEFOREVER='Backstage Forever'
BINDING_NAME_BACKSTAGEFOREVER_COMPASS='Show or hide the Adventure Compass'
BINDING_NAME_BACKSTAGEFOREVER_NEXT='Point me to my next quest stop'
BINDING_NAME_BACKSTAGEFOREVER_ASK='Ask the companion'
BINDING_NAME_BACKSTAGEFOREVER_OPTIONS='Open Backstage Forever settings'
function BackstageForeverBinding(command) run(command) end

-- An entry in the game's own options list that opens the painted window.
local function register()
    if type(Settings)~='table' or type(Settings.RegisterCanvasLayoutCategory)~='function'
        or type(Settings.RegisterAddOnCategory)~='function' or type(CreateFrame)~='function' then return end
    local canvas=CreateFrame('Frame')
    local note=canvas:CreateFontString(nil,'OVERLAY','GameFontHighlight')
    note:SetPoint('TOPLEFT',16,-16);note:SetWidth(520);note:SetJustifyH('LEFT')
    note:SetText(T('Every Backstage Forever helper has a switch in one window. You can also type /bf options or right-click the owl on the minimap.'))
    local button=CreateFrame('Button',nil,canvas,'UIPanelButtonTemplate')
    button:SetSize(240,26);button:SetPoint('TOPLEFT',16,-64);button:SetText(T('Open Backstage Forever settings'))
    button:SetScript('OnClick',function() BackstageForeverOptionsOpen() end)
    local category=Settings.RegisterCanvasLayoutCategory(canvas,'Backstage Forever')
    Settings.RegisterAddOnCategory(category)
end
if type(CreateFrame)=='function' then
    local loader=CreateFrame('Frame')
    loader:RegisterEvent('PLAYER_LOGIN')
    loader:SetScript('OnEvent',function() pcall(register) end)
end

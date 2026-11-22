-- One painted settings window for every in-game helper (1.18). It changes nothing itself:
-- each switch runs the same /bf command a player would type, so behaviour and messages match.
-- Opened by /bf options, a right-click on the owl, a keybinding, or the game's own options list.
local T=BackstageForeverTr or function(text) return text end
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
local WIDTH,HEIGHT=560,446
local COLUMN_X={34,292}
local ROW_TOP,ROW_HEIGHT,ROWS_PER_COLUMN=-150,25,8
local PAGE_WIDTH,PAGE_STEP=117,125

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
        switch('Minimap pins','Nearby quests, hand-ins, trainers and flight masters on the minimap.',on('BackstageForeverMinimapSettings','enabled'),'minimap'),
        switch('Gear hints','Upgrade lines on item tooltips and on quest rewards.',on('BackstageForeverGearSettings','enabled'),'gear'),
        helper('spellRankReminder','Spell rank reminder','Tells you when your action bar still holds a lower rank of a spell you have trained.'),
    }},
    {title='Alerts',rows={
        switch('Pop-up tips','Painted banners for level-ups, finished quests, deaths and repairs.',on('BackstageForeverAssistSettings','toasts'),'toasts'),
        switch('Moment banners','A short banner after combat for elite, rare and boss kills and profession milestones.',on('BackstageForeverMomentsSettings','toasts'),'moments'),
        switch('Screenshots at big moments','One screenshot when you gain a level or defeat a dungeon boss, taken after combat.',off('BackstageForeverMomentsSettings','shots'),'moments shots'),
        switch('Danger warnings','A line above your target when it is far above your level or elite.',on('BackstageForeverAssistSettings','danger'),'danger'),
        switch('Boss tips','A short plain tip the first time you target a covered boss.',on('BackstageForeverAssistSettings','bossTips'),'boss'),
        switch('Enemy player alerts','Says when an enemy player is nearby. Never in battlegrounds.',on('BackstageForeverEnemySettings','enabled'),'enemy'),
        switch('Enemy alert sound','Plays a sound with the enemy player alert.',off('BackstageForeverEnemySettings','sound'),'enemy sound'),
        switch('Rare enemy alerts','One chat line when you target or point at a rare enemy.',on('BackstageForeverWorldSettings','rares'),'rares'),
        switch('Supply reminders','Ammo, food and drink, pet food, shards and poisons before you run out.',on('BackstageForeverSuppliesSettings','enabled'),'supplies'),
        switch('Talent plan line','One chat line when you gain a level, naming the next point of your talent plan.',on('BackstageForeverAssistSettings','talentPlan'),'talents levelup'),
        helper('gatheringMarks','Gathering marks','Recent herb and ore spots you found, on the world map.'),
        switch('Weapon skill warning','One chat line when you equip a weapon type you have little skill with.',on('BackstageForeverComfortSettings','weapons'),'comfort weapons'),
        switch('Low durability warning','One chat line when you enter a rest area with a gear slot under 20% durability.',on('BackstageForeverComfortSettings','durability'),'comfort durability'),
        switch('Ready check at dungeons','One chat line when you walk into a dungeon: a class buff, food buff or reagent you are missing.',on('BackstageForeverKitSettings','ready'),'ready'),
        switch('Mail expiry warning','One chat line at the mailbox when a letter expires within 3 days. Mail is never opened.',on('BackstageForeverSocialSettings','mail'),'mail'),
        switch('Player note reminders','One chat line when you meet a player you wrote a note about. Notes stay on this computer.',on('BackstageForeverSocialSettings','notes'),'notes'),
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
        switch('Flight time at take-off','Says how long a flight takes when you timed the same trip before.',on('BackstageForeverComfortSettings','flights'),'comfort flights'),
        switch('Log-off rested nudge','One chat line when you start logging out outside an inn or city.',on('BackstageForeverComfortSettings','rested'),'comfort rested'),
        switch('Map search box','A small find box at the bottom left of the world map.',on('BackstageForeverWorldSettings','searchBox'),'mapsearch'),
        switch('Marks without colour','Adds [+], [x] or [!] to lines that otherwise tell good from bad by colour alone.',off('BackstageForeverSocialSettings','marks'),'access marks'),
        switch('Larger window text','Makes the Adventure Compass, this window and the welcome card 15% larger.',off('BackstageForeverSocialSettings','text'),'access text'),
        {label='Owl button on the minimap',about='Left-click asks the companion; right-click opens these settings. /bf ask show brings it back.',
            get=function() return saved('BackstageForeverAskSettings','hidden')~=true end,
            set=function(value) run(value and 'ask show' or 'ask hide') end},
    }},
    {title='Panels',rows={
        switch('Quest list by distance','A small list of your quests, nearest first. Click one for a waypoint. The game tracker is left alone.',off('BackstageForeverPanelSettings','tracker'),'tracker'),
        switch('Dungeon run panel','Inside a dungeon: bosses left, your quests there, wishes still possible and time in the run.',off('BackstageForeverPanelSettings','run'),'run'),
        switch('Run panel stays in combat','Keeps the dungeon run panel on screen in combat. It only updates outside combat.',off('BackstageForeverPanelSettings','runCombat'),'run combat'),
        switch('Wish list banner','A banner when you or your group loots an item from your wish list. Shown after combat.',on('BackstageForeverPanelSettings','wish'),'wish'),
        switch('Bag marks','Small signs on bag items: + upgrade, * wish, ! quest item. Off until you switch it on.',off('BackstageForeverPanelSettings','bags'),'bags marks'),
    }},
}
BackstageForeverOptionsPages=PAGES

-- Presets only flip switches listed here, and say what they changed.
local PRESETS={
    {title='Quiet',about='Fewer interruptions: banners, enemy alerts and detour offers off. Safety warnings stay on.',
        off={'Pop-up tips','Moment banners','Enemy player alerts','Enemy alert sound','Quest detours','Before leaving reminders','Supply reminders','Flight time at take-off','Log-off rested nudge','Player note reminders','Wish list banner'},on={'Danger warnings','Low durability warning','Ready check at dungeons','Mail expiry warning'}},
    {title='Leveling',about='The way Backstage Forever starts: every guide and reminder on, comfort extras off.',
        on={'Quest tracker','Objective hints','Quest detours','Before leaving reminders','Quest reward reasons','Quest blockers','Shared objectives','Keep quest items','Quest item cue','Quest icons over enemies','Gear hints','Pop-up tips','Moment banners','Danger warnings','Boss tips','Enemy player alerts','Supply reminders','Sell junk button','Weapon skill warning','Low durability warning','Flight time at take-off','Log-off rested nudge','Ready check at dungeons','Mail expiry warning','Player note reminders','Dungeon run panel','Wish list banner'},
        off={'Enemy alert sound','Coordinates','Faster looting','Dismount at flight masters','Instant quest text','Quest list by distance','Run panel stays in combat','Bag marks'}},
    {title='Veteran',about='For players who know the way: beginner banners off, coordinates and fast looting on.',
        off={'Pop-up tips','Danger warnings','Before leaving reminders','Quest reward reasons','Weapon skill warning','Log-off rested nudge'},on={'Flight time at take-off','Low durability warning','Ready check at dungeons','Mail expiry warning','Player note reminders','Coordinates','Faster looting','Instant quest text','Quest icons over enemies','Boss tips'}},
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
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
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
        -- Four pages share the 492-wide row under the painting.
        button:SetSize(PAGE_WIDTH,22);button:SetPoint('TOPLEFT',34+(i-1)*PAGE_STEP,-114);button:SetText(T(page.title))
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
BINDING_NAME_BACKSTAGEFOREVER_ATLAS='Open the Instance Atlas'
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

-- First login (1.18): one painted card instead of a line of chat. Three things the addon does,
-- where the settings are, and that the free desktop app exists. /bf welcome shows it again.
local WELCOME={
    {art='Buttons\\compass',title='Follow the Compass',
        text='The panel on your screen shows your next step. Type /bf next for an arrow to it.'},
    {art='Buttons\\ask',title='Ask the owl',
        text='Left-click the owl on the minimap to ask a question. Right-click it for settings.'},
    {art='Buttons\\journal',title='Get the desktop app',
        text='Free at backstagecoding.com: maps, plans and a companion. It keeps this addon up to date.'},
}
BackstageForeverWelcomeRows=WELCOME
local welcome
local function buildWelcome()
    if welcome or type(CreateFrame)~='function' or not UIParent then return welcome end
    local f=CreateFrame('Frame','BackstageForeverWelcome',UIParent)
    f:Hide();f:SetSize(520,372);f:SetPoint('CENTER',0,40)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',40,14)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.98) end
    local crest=f:CreateTexture(nil,'ARTWORK');crest:SetTexture(ART..'Frames\\compass-crest')
    crest:SetSize(96,48);crest:SetPoint('BOTTOM',f,'TOP',0,-16)
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    title:SetPoint('TOP',0,-16);title:SetText(T('Welcome to Backstage Forever'))
    local scene=f:CreateTexture(nil,'ARTWORK');scene:SetTexture(ART..'Messages\\ready')
    scene:SetSize(456,57);scene:SetPoint('TOP',0,-42)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.9)
    rule:SetSize(456,1);rule:SetPoint('TOP',scene,'BOTTOM',0,0)
    for i,row in ipairs(WELCOME) do
        local y=-114-(i-1)*64
        local picture=f:CreateTexture(nil,'ARTWORK');picture:SetTexture(ART..row.art)
        picture:SetSize(48,48);picture:SetPoint('TOPLEFT',34,y)
        local head=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
        head:SetPoint('TOPLEFT',96,y-2);head:SetText(T(row.title))
        local body=f:CreateFontString(nil,'OVERLAY','GameFontHighlight')
        body:SetPoint('TOPLEFT',96,y-20);body:SetSize(390,30);body:SetJustifyH('LEFT');body:SetJustifyV('TOP');body:SetWordWrap(true)
        body:SetText(T(row.text))
    end
    local settingsButton=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    settingsButton:SetSize(150,24);settingsButton:SetPoint('BOTTOMLEFT',96,26);settingsButton:SetText(T('Open settings'))
    settingsButton:SetScript('OnClick',function() f:Hide();BackstageForeverOptionsOpen() end)
    local start=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    start:SetSize(150,24);start:SetPoint('BOTTOMRIGHT',-96,26);start:SetText(T('Start playing'))
    start:SetScript('OnClick',function() f:Hide() end)
    f:RegisterEvent('PLAYER_REGEN_DISABLED');f:SetScript('OnEvent',function() f:Hide() end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverWelcome') end
    welcome=f
    return f
end
-- Returns true when the card is on screen. In combat or without frames it returns false and the caller keeps its banner.
function BackstageForeverWelcomeOpen()
    if busy() then return false end
    local ok,f=pcall(buildWelcome)
    if not ok or not f then return false end
    f:Show()
    return true
end
function BackstageForeverWelcomeCommand()
    if not BackstageForeverWelcomeOpen() then say('Open the welcome card outside combat.') end
end

-- /way X Y [name] (1.18): the waypoint line players paste from guides and chat, placed on the map
-- you are on. A typed command, so the game allows the waypoint. Left alone when another addon
-- already answers /way.
function BackstageForeverWayText(message)
    if type(message)~='string' or #message>120 then return nil end
    local x,y,label=message:match('^%s*([%d%.]+)[,%s]+([%d%.]+)%s*(.-)%s*$')
    x,y=tonumber(x),tonumber(y)
    if not x or not y or x<0 or x>100 or y<0 or y>100 then return nil end
    return x,y,label
end
local function way(message)
    local x,y,label=BackstageForeverWayText(message)
    if not x then say('Use /way X Y [name], for example /way 51.5 30.9 Thork.') return end
    local map=type(C_Map)=='table' and type(C_Map.GetBestMapForUnit)=='function' and C_Map.GetBestMapForUnit('player')
    if type(map)~='number' then say('Your map is not known yet; try again in a moment.') return end
    if type(BackstageForeverWay)=='function' then BackstageForeverWay(('way %d %.4f %.4f %s'):format(map,x/100,y/100,label or '')) end
end
function BackstageForeverWayRegister()
    if type(SlashCmdList)~='table' or SlashCmdList.BACKSTAGEFOREVERWAY then return false end
    if SlashCmdList.TOMTOM_WAY or SLASH_TOMTOM_WAY1 then return false end
    if type(hash_SlashCmdList)=='table' and hash_SlashCmdList['/WAY'] then return false end
    SLASH_BACKSTAGEFOREVERWAY1='/way'
    SlashCmdList.BACKSTAGEFOREVERWAY=way
    return true
end
if type(CreateFrame)=='function' then
    local wayLoader=CreateFrame('Frame')
    wayLoader:RegisterEvent('PLAYER_LOGIN')
    wayLoader:SetScript('OnEvent',function() pcall(BackstageForeverWayRegister) end)
end

-- /bf perf (1.18): how much memory the addon holds, and how that changed since you last asked.
-- Pure part first: turns two readings into the line that is printed.
function BackstageForeverPerfLine(kilobytes,before,seconds)
    if type(kilobytes)~='number' or kilobytes<0 then return 'Memory use is not readable in this game client.' end
    local line=('Memory in use: %.1f MB.'):format(kilobytes/1024)
    if type(before)=='number' and type(seconds)=='number' and seconds>=1 then
        local change=(kilobytes-before)/1024
        local minutes=math.max(1,math.floor(seconds/60+.5))
        line=line..(' %s%.1f MB since you last asked, %d min ago.'):format(change>=0 and '+' or '-',math.abs(change),minutes)
        if change>0 and change/minutes>1 then line=line..' That is growing fast; /reload clears it, and Report a problem in the desktop app tells us.' end
    end
    return line
end
local perfBefore,perfAt
function BackstageForeverPerfCommand()
    local usage
    local update=UpdateAddOnMemoryUsage
    local read=GetAddOnMemoryUsage
    if type(update)=='function' and type(read)=='function' then
        pcall(update)
        local ok,value=pcall(read,'BackstageForever')
        if ok and type(value)=='number' then usage=value end
    end
    local now=type(GetTime)=='function' and GetTime() or nil
    say(BackstageForeverPerfLine(usage,perfBefore,perfAt and now and now-perfAt or nil))
    if usage then perfBefore,perfAt=usage,now end
end

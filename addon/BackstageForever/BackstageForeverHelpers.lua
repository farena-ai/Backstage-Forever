-- Settings belong to the character whose addon is running. Nothing is received from desktop.
local rows={{'questTracker','Quest tracker'},{'objectiveHints','Objective hints'},
    {'questDetours','Quest detours'},{'beforeLeaving','Before leaving reminders'},
    {'rewardReasons','Quest reward reasons'},{'questBlockers','Quest blockers'},
    {'gatheringMarks','Gathering marks'},{'sharedObjectives','Shared objectives'},
    {'keepQuestItems','Keep quest items'},{'questItemCue','Quest item cue'},
    {'spellRankReminder','Spell rank reminder'}}
local known,checks={},{}

-- Game builds change every few days inside one patch (1.60.1.70888, 1.60.1.71037 ...).
-- Data checked on one build is used on the other builds of the same patch and says so
-- ("carried"); a different patch number is a mismatch until the data is checked again.
local function buildParts(value)
    if type(value)~='string' or #value>30 then return end
    return value:match('^(%d+%.%d+%.%d+)%.(%d+)$')
end
function BackstageForeverBuildRelation(dataBuild,clientBuild)
    local dataPatch,dataNumber=buildParts(dataBuild)
    local clientPatch,clientNumber=buildParts(clientBuild)
    if not dataPatch or not clientPatch then return 'unknown' end
    if dataPatch~=clientPatch then return 'mismatch' end
    return dataNumber==clientNumber and 'match' or 'carried'
end
function BackstageForeverBuildUsable(dataBuild,clientBuild)
    local relation=BackstageForeverBuildRelation(dataBuild,clientBuild)
    return relation=='match' or relation=='carried'
end
-- One short line for the settings window: the game build and where the quest data stands.
function BackstageForeverBuildBadge()
    if type(GetBuildInfo)~='function' then return nil end
    local ok,version,number=pcall(GetBuildInfo)
    if not ok or type(version)~='string' or type(number)~='string' then return nil end
    if type(issecretvalue)=='function' then
        local readable,secret=pcall(issecretvalue,number)
        if not readable or secret then return nil end
    end
    local client=version..'.'..number
    if not buildParts(client) then return nil end
    local T=BackstageForeverTr or tostring
    local reference=type(BackstageForeverReference)=='table' and rawget(BackstageForeverReference,'build')
    local relation=BackstageForeverBuildRelation(reference,client)
    local tail=relation=='match' and T('quest data checked on this build')
        or relation=='carried' and (T('quest data from build')..' '..select(2,buildParts(reference))..', '..T('same patch'))
        or relation=='mismatch' and T('quest data is for an older patch') or nil
    return T('Game build')..' '..number..(tail and (' · '..tail) or '')
end
-- Plain-words lines for /bf status: which build the game is on and what that means for the bundled data.
function BackstageForeverBuildStatus()
    local lines={}
    if type(GetBuildInfo)~='function' then return lines end
    local ok,version,number=pcall(GetBuildInfo)
    if not ok or type(version)~='string' or type(number)~='string' then return lines end
    if type(issecretvalue)=='function' then
        local readable,secret=pcall(issecretvalue,number)
        if not readable or secret then return lines end
    end
    local client=version..'.'..number
    if not buildParts(client) then return lines end
    local T=BackstageForeverTr or tostring
    lines[1]=T('Game build')..' '..client..'.'
    local reference=type(BackstageForeverReference)=='table' and rawget(BackstageForeverReference,'build')
    local relation=BackstageForeverBuildRelation(reference,client)
    if relation=='match' then lines[2]=T('Quest reference: checked on this exact build.')
    elseif relation=='carried' then
        lines[2]=T('Quest reference: checked on build')..' '..select(2,buildParts(reference))..' '..T('of this patch, in use. Places rarely move between builds.')
    elseif relation=='mismatch' then
        lines[2]=T('Quest reference: made for patch')..' '..buildParts(reference)..'. '..T('Quest places and hints are off until an update checks this patch.')
    end
    return lines
end
for _,row in ipairs(rows) do known[row[1]]=true end
local panel,generation=nil,0
local T=BackstageForeverTr or function(text)return text end

function BackstageForeverHelperEnabled(key)
    return type(key)=='string' and known[key]==true and
        (type(BackstageForeverHelperSettings)~='table' or BackstageForeverHelperSettings[key]~=false)
end

local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end

local function updater(key,value)
    if key=='questTracker' or key=='questDetours' or key=='beforeLeaving' then return BackstageForeverHUDHelpersChanged
    elseif key=='gatheringMarks' then return BackstageForeverGatheringMarksChanged
    elseif key=='rewardReasons' then return BackstageForeverRewardReasonsChanged
    elseif key=='spellRankReminder' and value then return BackstageForeverSpellRankRefresh end
end

local function setChoices(choices)
    if type(BackstageForeverHelperSettings)~='table' then BackstageForeverHelperSettings={} end
    local updates={}
    for key,value in pairs(choices) do
        local update=BackstageForeverHelperEnabled(key)~=value and updater(key,value)
        if type(update)=='function' then updates[update]=true end
        BackstageForeverHelperSettings[key]=value
    end
    for key,value in pairs(choices) do
        if checks[key] then checks[key]:SetChecked(value) end
    end
    for update in pairs(updates) do pcall(update) end
end

local function read(fn,...)
    if type(fn)~='function' then return end
    local ok,value=pcall(fn,...)
    if not ok then return end
    if type(issecretvalue)=='function' then
        local readable,secret=pcall(issecretvalue,value)
        if not readable or secret then return end
    end
    return value
end

local function owner()
    if read(InCombatLockdown)~=false then return end
    local guid=read(UnitGUID,'player')
    if type(guid)=='string' and guid~='' then return guid end
end

local function openPanel()
    local current=owner()
    if not current or type(CreateFrame)~='function' or not UIParent then
        say('Open helper settings in game, outside combat.');return
    end
    if not panel then
        local frame=CreateFrame('Frame','BackstageForeverHelperPanel',UIParent)
        frame:Hide();frame:SetPoint('CENTER');frame:SetSize(350,376)
        frame:SetClampedToScreen(true);frame:SetFrameStrata('DIALOG');frame:EnableMouse(true)
        local bg=frame:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.98)
        local title=frame:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
        title:SetPoint('TOPLEFT',16,-15);title:SetText(T('In-Game Helpers'))
        local close=CreateFrame('Button',nil,frame,'UIPanelCloseButton')
        close:SetPoint('TOPRIGHT',-2,-2);close:SetScript('OnClick',function()frame:Hide()end)
        local note=frame:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        note:SetPoint('TOPLEFT',16,-42);note:SetText(T('Settings for this character only.'))
        for i,row in ipairs(rows) do
            local key,label=row[1],row[2]
            local check=CreateFrame('CheckButton','BackstageForeverHelper_'..key,frame,'UICheckButtonTemplate')
            check:SetSize(24,24);check:SetPoint('TOPLEFT',14,-60-(i-1)*24)
            local caption=check:CreateFontString(nil,'OVERLAY','GameFontHighlight')
            caption:SetPoint('LEFT',check,'RIGHT',4,0);caption:SetText(T(label))
            checks[key]=check
        end
        local foot=frame:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        foot:SetPoint('BOTTOMLEFT',16,16);foot:SetWidth(312);foot:SetJustifyH('LEFT');foot:SetWordWrap(true)
        foot:SetText(T('Turning off item tips does not turn off quest-item sale protection.'))
        for _,event in ipairs({'PLAYER_LOGIN','PLAYER_LOGOUT','PLAYER_ENTERING_WORLD','PLAYER_REGEN_DISABLED'}) do frame:RegisterEvent(event) end
        frame:SetScript('OnEvent',function() generation=generation+1;frame:Hide() end)
        if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverHelperPanel') end
        panel=frame
    end
    generation=generation+1
    local token=generation
    for _,row in ipairs(rows) do
        local key=row[1];local check=checks[key]
        check:SetChecked(BackstageForeverHelperEnabled(key))
        check:SetScript('OnClick',function(widget)
            if token~=generation or not panel:IsShown() then return end
            if owner()~=current then panel:Hide();return end
            setChoices({[key]=widget:GetChecked()==true})
        end)
    end
    panel:Show()
end

local function applyBatch(message)
    -- A required final literal prevents a truncated chat paste from applying a valid prefix.
    local payload=#message<=251 and not message:find('[^A-Za-z= ]') and
        message:match('^helpers +apply +(.+) +commit *$')
    local function invalid() say('No helper settings changed. Paste the full helper command, including commit.') end
    if not payload then invalid();return end
    local choices={}
    for token in payload:gmatch('[^ ]+') do
        local key,value=token:match('^(%a+)=(%a+)$')
        if not key or not known[key] or choices[key]~=nil or (value~='on' and value~='off') then invalid();return end
        choices[key]=value=='on'
    end
    if not next(choices) then invalid();return end
    if not owner() then say('No helper settings changed. Log in to the intended character and leave combat first.');return end
    setChoices(choices)
    local confirmed={}
    for _,row in ipairs(rows) do
        local key=row[1]
        if choices[key]~=nil then confirmed[#confirmed+1]=key..' — '..(choices[key] and T('On') or T('Off')) end
    end
    say(T('Helpers updated for this character:')..' '..table.concat(confirmed,', '))
end

function BackstageForeverHelpersCommand(message)
    if type(message)~='string' then return end
    if message:match('^helpers%s+apply%f[%A]') then applyBatch(message);return end
    if #message>80 then return end
    if message:match('^helpers%s+panel%s*$') then openPanel();return end
    local key,value=message:match('^helpers%s+(%a+)%s+(%a+)%s*$')
    key=key or message:match('^helpers%s+(%a+)%s*$')
    -- Never interpret malformed input as a toggle.
    if not key or not known[key] or (value and value~='on' and value~='off') then
        say(T('Use /bf helpers <key> to check, or /bf helpers <key> on|off to change.'))
        if message:match('^helpers%s*$') then
            local keys={}
            for k in pairs(known) do keys[#keys+1]=k end
            table.sort(keys)
            for _,k in ipairs(keys) do say(k..' — '..(BackstageForeverHelperEnabled(k) and T('On') or T('Off'))) end
        end
        return
    end
    if value then
        setChoices({[key]=value=='on'})
    end
    say(key..' — '..(BackstageForeverHelperEnabled(key) and T('On') or T('Off')))
end

-- Settings belong to the character whose addon is running. Nothing is received from desktop.
local rows={{'questTracker','Quest tracker'},{'objectiveHints','Objective hints'},
    {'questDetours','Quest detours'},{'beforeLeaving','Before leaving reminders'},
    {'rewardReasons','Quest reward reasons'},{'questBlockers','Quest blockers'},
    {'gatheringMarks','Gathering marks'},{'sharedObjectives','Shared objectives'},
    {'keepQuestItems','Keep quest items'},{'questItemCue','Quest item cue'},
    {'spellRankReminder','Spell rank reminder'}}
local known,checks={},{}
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

local function set(key,value)
    local changed=BackstageForeverHelperEnabled(key)~=value
    if type(BackstageForeverHelperSettings)~='table' then BackstageForeverHelperSettings={} end
    BackstageForeverHelperSettings[key]=value
    if checks[key] then checks[key]:SetChecked(value) end
    if not changed then return end
    local update
    if key=='questTracker' or key=='questDetours' or key=='beforeLeaving' then update=BackstageForeverHUDHelpersChanged
    elseif key=='gatheringMarks' then update=BackstageForeverGatheringMarksChanged
    elseif key=='rewardReasons' then update=BackstageForeverRewardReasonsChanged
    elseif key=='spellRankReminder' and value then update=BackstageForeverSpellRankRefresh end
    if type(update)=='function' then pcall(update) end
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
            set(key,widget:GetChecked()==true)
        end)
    end
    panel:Show()
end

function BackstageForeverHelpersCommand(message)
    if type(message)~='string' or #message>80 then return end
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
        set(key,value=='on')
    end
    say(key..' — '..(BackstageForeverHelperEnabled(key) and T('On') or T('Off')))
end

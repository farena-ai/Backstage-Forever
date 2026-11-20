-- Settings belong to the character whose addon is running. Nothing is received from desktop.
local known={questTracker=true,objectiveHints=true,questDetours=true,beforeLeaving=true,
    rewardReasons=true,questBlockers=true,gatheringMarks=true,sharedObjectives=true,
    keepQuestItems=true,questItemCue=true,spellRankReminder=true}
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

function BackstageForeverHelpersCommand(message)
    if type(message)~='string' or #message>80 then return end
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
        if type(BackstageForeverHelperSettings)~='table' then BackstageForeverHelperSettings={} end
        BackstageForeverHelperSettings[key]=(value=='on')
    end
    say(key..' — '..(BackstageForeverHelperEnabled(key) and T('On') or T('Off')))
end

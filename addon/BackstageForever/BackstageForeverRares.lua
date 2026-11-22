-- Rare enemy alerts (roadmap W1): one chat line when a rare enemy from the bundled list becomes
-- your target or passes under your mouse. Once per rare per session, never in combat.
-- It reads public unit info only; it never targets, marks or announces to other players.
-- /bf rares shows the status; /bf rares on|off switches the alerts.
local function plain(v)
    if v==nil then return nil end
    if type(issecretvalue)=='function' then local ok,secret=pcall(issecretvalue,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    return plain(r[2]),plain(r[3])
end
local function T(m) return (BackstageForeverTr or tostring)(m) end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end

-- Pure: the creature id inside a unit GUID ("Creature-0-4444-1-12-5832-0000A1B2C3"), or nil.
function BackstageForeverRareCreatureId(guid)
    if type(guid)~='string' or #guid>200 then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-%x+$')
    if (kind~='Creature' and kind~='Vehicle') or #id>10 then return nil end
    return tonumber(id)
end
-- Pure: the listed rare for a creature id: {id=,name=,elite=,drops=} or nil.
function BackstageForeverRareLookup(data,id)
    if type(data)~='table' or type(data.n)~='table' or type(id)~='number' then return nil end
    local name=data.n[id]
    if type(name)~='string' then return nil end
    return {id=id,name=name,elite=type(data.e)=='table' and data.e[id]==1 or false,drops=type(data.d)=='table' and type(data.d[id])=='string' and data.d[id] or nil}
end
-- Pure: remembers the sighting in seen[id] and says whether to alert (once per rare per session).
function BackstageForeverRareNote(seen,id)
    if type(seen)~='table' or type(id)~='number' or seen[id] then return false end
    seen[id]=true
    return true
end
-- Pure: "Rare enemy: Thunderstomp (rare, level 24). Players saw it drop: Superior Belt."
-- shown is the name the game shows (already in the player's language); level -1 reads "??".
function BackstageForeverRareLine(rare,shown,level)
    if type(rare)~='table' then return nil end
    local name=type(shown)=='string' and shown~='' and shown or rare.name
    local kind=T(rare.elite and 'rare elite' or 'rare')
    local lv=type(level)=='number' and (level<0 and (', '..T('level')..' ??') or level>0 and (', '..T('level')..' '..level)) or ''
    local line=T('Rare enemy')..': '..name..' ('..kind..lv..').'
    if rare.drops then line=line..' '..T('Players saw it drop')..': '..rare.drops..'.' end
    return line
end

local settings,seen,met=nil,{},{}
local function loadSettings()
    if type(BackstageForeverWorldSettings)~='table' then BackstageForeverWorldSettings={} end
    settings=BackstageForeverWorldSettings
    if settings.rares==nil then settings.rares=true end
    return settings
end
local function look(unit)
    if not settings then loadSettings() end
    if not settings.rares or call(InCombatLockdown)~=false then return end
    if call(UnitExists,unit)~=true or call(UnitIsPlayer,unit)==true or call(UnitIsDead,unit)==true then return end
    local id=BackstageForeverRareCreatureId(call(UnitGUID,unit))
    local rare=id and BackstageForeverRareLookup(BackstageForeverRareData,id)
    if not rare or not BackstageForeverRareNote(seen,id) then return end
    local shown=call(UnitName,unit)
    met[#met+1]=type(shown)=='string' and shown or rare.name
    say('|cffb0c4ff'..BackstageForeverRareLine(rare,shown,call(UnitLevel,unit))..'|r')
end
BackstageForeverRareLook=look -- for tests

function BackstageForeverRaresCommand(message)
    if not settings then loadSettings() end
    local arg=(type(message)=='string' and message:lower() or ''):match('^rares?%s*(%a*)') or ''
    if arg=='on' or arg=='off' then
        settings.rares=arg=='on'
        say(T(settings.rares and 'Rare enemy alerts on: one line when you target or point at a rare enemy.' or 'Rare enemy alerts off.'))
        return settings.rares
    end
    local count=0
    for _ in pairs(type(BackstageForeverRareData)=='table' and type(BackstageForeverRareData.n)=='table' and BackstageForeverRareData.n or {}) do count=count+1 end
    say(T(settings.rares and 'Rare enemy alerts are on.' or 'Rare enemy alerts are off.')..' '..T('%d rare enemies are known by name. The World Map in the desktop app shows the few with a known place.'):format(count))
    if #met>0 then say(T('Met this session')..': '..table.concat(met,', ',math.max(1,#met-7),#met)..'.') end
    return settings.rares
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Rares',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then loadSettings() return end
            pcall(look,event=='PLAYER_TARGET_CHANGED' and 'target' or 'mouseover')
        end)
    end
end

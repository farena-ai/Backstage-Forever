-- Talent plan in game (roadmap C1). The desktop app hands over the build you marked "Use in game"
-- (BackstageForeverDesktop.lua, read at login or /reload). /bf talents names the next planned
-- point, and one chat line does the same when you gain a level. This file only reads and prints:
-- it never spends a point, never opens or touches the talent window, and stays quiet in combat.
local T=BackstageForeverTr or function(text) return text end
local MAX_PICKS=51

-- Pure: the plan handed over for this character ("Name-Realm"), or nil. Each pick carries the
-- talent's name, its tree, the rank this point gives, the highest rank and the level it was
-- planned for (the first point comes at level 10).
function BackstageForeverTalentPlan(name,realm)
    local data=type(BackstageForeverDesktopData)=='table' and BackstageForeverDesktopData or nil
    if not data or rawget(data,'schema')~=1 or type(name)~='string' or type(realm)~='string' then return nil end
    local characters=rawget(data,'characters')
    local row=type(characters)=='table' and rawget(characters,name..'-'..realm)
    local tal=type(row)=='table' and rawget(row,'tal')
    if type(tal)~='table' then return nil end
    local title,list,order=rawget(tal,'n'),rawget(tal,'t'),rawget(tal,'o')
    if type(title)~='string' or type(list)~='table' or type(order)~='table' then return nil end
    local picks,taken={},{}
    for i,at in ipairs(order) do
        local t=type(at)=='number' and rawget(list,at)
        if i>MAX_PICKS or type(t)~='table' or type(t[1])~='string' or type(t[2])~='string' or type(t[3])~='number' then return nil end
        taken[at]=(taken[at] or 0)+1
        if taken[at]>t[3] then return nil end
        picks[i]={name=t[1],tab=t[2],rank=taken[at],max=t[3],level=9+i}
    end
    if #picks==0 then return nil end
    return {name=title,picks=picks}
end

local function key(pick) return pick.tab..'\n'..pick.name end
local function at(pick,level) return {name=pick.name,tab=pick.tab,rank=pick.rank,max=pick.max,level=level} end

-- Pure: which planned points to spend now and which comes after.
-- have: tree..'\n'..talent -> rank you own, as the game reports it, or nil when it did not say.
-- unspent: talent points waiting to be spent, or nil when unknown.
-- With have, a point counts as taken once you own that rank, so the answer stays right when you
-- spent points early, late or somewhere else. Without it the plan is read by level alone.
function BackstageForeverTalentNext(plan,level,have,unspent,limit)
    local out={due={},later=nil,done=false,more=0}
    if type(plan)~='table' or type(plan.picks)~='table' then return out end
    level=tonumber(level) or 0
    limit=tonumber(limit) or 5
    local known=false
    if type(have)=='table' then
        for _,pick in ipairs(plan.picks) do if have[key(pick)]~=nil then known=true break end end
    end
    if not known then
        for _,pick in ipairs(plan.picks) do
            if pick.level==level then out.due[1]=at(pick,level) end
            if not out.later and pick.level>level then out.later=at(pick,pick.level) end
        end
        out.done=level-9>=#plan.picks
        return out
    end
    local open={}
    for _,pick in ipairs(plan.picks) do
        if (tonumber(have[key(pick)]) or 0)<pick.rank then open[#open+1]=pick end
    end
    local free=0
    if type(unspent)=='number' then free=unspent
    else for _,pick in ipairs(open) do if pick.level<=level then free=free+1 end end end
    if level<10 then free=0 end
    if free>#open then free=#open end
    for i=1,math.min(free,limit) do out.due[i]=at(open[i],math.min(open[i].level,level)) end
    out.more=free-#out.due
    if open[free+1] then out.later=at(open[free+1],math.max(level+1,10)) end
    out.done=#open==0
    return out
end

-- Pure: one planned point as a line of text.
function BackstageForeverTalentLine(pick)
    return T(('Level %d: %s (%s), rank %d of %d'):format(pick.level,pick.name,pick.tab,pick.rank,pick.max))
end

-- Pure: the chat lines for /bf talents.
function BackstageForeverTalentReport(plan,level,have,unspent)
    if type(plan)~='table' then
        return {T('No talent plan for this character yet. Make one in the desktop app under Characters, Talents, choose "Use in game", then type /reload.')}
    end
    local lines={T(('Talent plan "%s".'):format(plan.name))}
    local step=BackstageForeverTalentNext(plan,level,have,unspent)
    if step.done then
        lines[#lines+1]=T('Every point of this plan is spent.')
        return lines
    end
    for _,pick in ipairs(step.due) do lines[#lines+1]=BackstageForeverTalentLine(pick) end
    if step.more>0 then lines[#lines+1]=T(('And %d more points to spend.'):format(step.more)) end
    if #step.due==0 then
        lines[#lines+1]=T((tonumber(level) or 0)<10 and 'Talent points start at level 10.' or 'No planned point to spend right now.')
    end
    if step.later then
        local p=step.later
        lines[#lines+1]=T(('Next, at level %d: %s (%s), rank %d of %d'):format(p.level,p.name,p.tab,p.rank,p.max))
    end
    if #step.due>0 then lines[#lines+1]=T('Press N to open Talents. You spend the points yourself.') end
    return lines
end

-- Pure: the one line shown on level-up, or nil when there is no plan or nothing planned for now.
function BackstageForeverTalentLevelUp(plan,level,have,unspent)
    level=tonumber(level) or 0
    if type(plan)~='table' or level<10 then return nil end
    -- The new point may not be counted yet when the level-up event arrives.
    if type(unspent)=='number' and unspent<1 then unspent=1 end
    local pick=BackstageForeverTalentNext(plan,level,have,unspent,1).due[1]
    if not pick then return nil end
    return T(('Level %d talent point: %s (%s), rank %d of %d. Type /bf talents for more.'):format(level,pick.name,pick.tab,pick.rank,pick.max))
end

local function secret(value) return type(issecretvalue)=='function' and issecretvalue(value)==true end
local function busy() return type(InCombatLockdown)=='function' and InCombatLockdown()~=false end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end

-- The ranks you own, read from the game's own talent list. nil when the game does not answer
-- cleanly; the plan is then read by level alone. Read-only.
function BackstageForeverTalentRead()
    if type(GetNumTalentTabs)~='function' or type(GetTalentTabInfo)~='function' or type(GetNumTalents)~='function' or type(GetTalentInfo)~='function' then return nil end
    local ok,tabs=pcall(GetNumTalentTabs)
    if not ok or secret(tabs) or type(tabs)~='number' or tabs<1 or tabs>6 then return nil end
    local have={}
    for tab=1,tabs do
        local info={pcall(GetTalentTabInfo,tab)}
        if not info[1] then return nil end
        local tabName
        for i=2,4 do
            if not tabName and not secret(info[i]) and type(info[i])=='string' then tabName=info[i] end
        end
        local okCount,count=pcall(GetNumTalents,tab)
        if not tabName or not okCount or secret(count) or type(count)~='number' then return nil end
        for index=1,math.min(count,60) do
            local okInfo,name,_,_,_,rank=pcall(GetTalentInfo,tab,index)
            if not okInfo or secret(name) or secret(rank) or type(name)~='string' or type(rank)~='number' then return nil end
            have[tabName..'\n'..name]=rank
        end
    end
    return have
end
local function unspentPoints()
    if type(UnitCharacterPoints)~='function' then return nil end
    local ok,points=pcall(UnitCharacterPoints,'player')
    if ok and not secret(points) and type(points)=='number' and points>=0 then return points end
end
local function playerLevel()
    if type(UnitLevel)~='function' then return 0 end
    local ok,level=pcall(UnitLevel,'player')
    return (ok and not secret(level) and type(level)=='number') and level or 0
end
local function myPlan()
    local okName,name=pcall(UnitName,'player') local okRealm,realm=pcall(GetRealmName)
    return BackstageForeverTalentPlan(okName and name or nil,okRealm and realm or nil)
end
local function settings()
    if type(BackstageForeverAssistSettings)~='table' then BackstageForeverAssistSettings={} end
    return BackstageForeverAssistSettings
end
function BackstageForeverTalentLineEnabled()
    return not (type(BackstageForeverAssistSettings)=='table' and rawget(BackstageForeverAssistSettings,'talentPlan')==false)
end

-- /bf talents, or /bf talents levelup on|off for the level-up line.
function BackstageForeverTalentsCommand(message)
    local word,arg=(type(message)=='string' and message or ''):lower():match('^talents%s+(%S+)%s*(%S*)')
    if word=='levelup' then
        if arg=='off' then settings().talentPlan=false;say(T('Talent plan line on level-up is off.'));return false end
        if arg=='on' then settings().talentPlan=true;say(T('Talent plan line on level-up is on.'));return true end
        say(T('Type /bf talents levelup on or /bf talents levelup off.'))
        return BackstageForeverTalentLineEnabled()
    end
    -- In combat the game hides many values, so the plan is read by level alone there.
    local quiet=busy()
    local lines=BackstageForeverTalentReport(myPlan(),playerLevel(),(not quiet) and BackstageForeverTalentRead() or nil,(not quiet) and unspentPoints() or nil)
    for _,line in ipairs(lines) do say(line) end
    return true
end

if type(CreateFrame)=='function' then
    local ok,frame=pcall(CreateFrame,'Frame')
    if ok and frame then
        local waiting=nil
        local function tell(level)
            if not BackstageForeverTalentLineEnabled() then return end
            local line=BackstageForeverTalentLevelUp(myPlan(),level,BackstageForeverTalentRead(),unspentPoints())
            if line then say(line) end
        end
        frame:RegisterEvent('PLAYER_LEVEL_UP')
        frame:RegisterEvent('PLAYER_REGEN_ENABLED')
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Talents',frame) end
        frame:SetScript('OnEvent',function(_,event,level)
            if event=='PLAYER_LEVEL_UP' then
                local reached=(not secret(level) and type(level)=='number') and level or playerLevel()
                if busy() then waiting=reached else pcall(tell,reached) end
            elseif waiting then
                local reached=waiting
                waiting=nil
                pcall(tell,reached)
            end
        end)
    end
end

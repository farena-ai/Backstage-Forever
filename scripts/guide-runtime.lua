
-- Guided route runtime (0.50, roadmap 4.1). Pure functions over BackstageForeverGuideData; the step
-- frame in BackstageForeverRoute.lua shows them. Step: {kind,text,mapId,x,y,level,{questIds},id}
-- kinds: p pick up, c class quest (optional), o objectives, t hand in, g travel.
local RACE_KEYS={Scourge='Undead',Undead='Undead',NightElf='Night Elf',['Night Elf']='Night Elf',Human='Human',Orc='Orc',Dwarf='Dwarf',Tauren='Tauren',Gnome='Gnome',Troll='Troll'}
function BackstageForeverGuideRoute(race)
    if type(race)~='string' then return nil end
    local key=RACE_KEYS[race] or RACE_KEYS[(race:gsub('%s',''))]
    return key and BackstageForeverGuideData[key] or nil
end
local function each(ids,fn) for _,id in ipairs(ids or {}) do if not fn(id) then return false end end return true end
-- Pure: is this step behind you? state: {completed={id=true},inLog={},complete={},level=n,mapId=n}
function BackstageForeverGuideDone(s,state)
    local k,ids,lvl=s[1],s[7],s[6] or 1
    local done=state.completed or {}
    local inLog=state.inLog or {}
    local complete=state.complete or {}
    local level=state.level or 1
    -- You can only hand in or work on a quest you hold: a quest not in your log is behind you here
    -- (its pick-up step comes first, so the guide stops there until you have it).
    if k=='t' then return each(ids,function(id) return done[id] or not inLog[id] end) end
    -- Quests well below you give little experience: the guide moves on past them (you're ahead).
    if level>=lvl+5 then return true end
    if k=='p' then return each(ids,function(id) return done[id] or inLog[id] end) end
    if k=='c' then
        if level>=lvl+2 then return true end
        for _,id in ipairs(ids or {}) do if done[id] or inLog[id] then return true end end
        return false
    end
    if k=='o' then return each(ids,function(id) return done[id] or complete[id] or not inLog[id] end) end
    if k=='g' then return state.mapId==s[3] end
    return false
end
-- Pure: where you are on the route. skipped: {stepId=true}. Returns the current step number,
-- up to 15 steps from there, and a note when you're behind the step's level.
function BackstageForeverGuidePosition(route,state,skipped)
    local steps=type(route)=='table' and route.s or {}
    skipped=skipped or {}
    local n=#steps
    local doneAt={}
    for i=n,1,-1 do
        local s=steps[i]
        local d=skipped[s[8]] or BackstageForeverGuideDone(s,state)
        -- A travel step is behind you once anything after it is.
        if s[1]=='g' and not d then for j=i+1,math.min(n,i+6) do if doneAt[j] and steps[j][1]=='p' then d=true break end end end
        doneAt[i]=d and true or false
    end
    local at
    for i=1,n do if not doneAt[i] then at=i break end end
    if not at then return {ended=true,total=n,top=route and route.top} end
    local out={}
    for i=at,math.min(n,at+14) do if not doneAt[i] then out[#out+1]=steps[i] end end
    local note
    local lvl=steps[at][6] or 1
    if (state.level or 1)+2<lvl then note=('This step is level %d and you are %d: kill things or do zone quests nearby first.'):format(lvl,state.level or 1) end
    return {index=at,total=n,steps=out,note=note,top=route.top}
end

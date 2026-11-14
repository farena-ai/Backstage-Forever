-- Death review and session stats, from health changes on you and your target (public API only;
-- the game no longer lets addons read the combat log).
-- After a death: what hit you hardest in the last seconds, its level and whether it was elite,
-- and one plain tip. /bf stats: damage per fight this session (solo fights) and your best fight.
local floor,min,max=math.floor,math.min,math.max
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,20 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,20)
end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end
local WINDOW=8 -- seconds of damage taken that explain a death

-- Pure: recent hits -> a short review. hits: {{t,source,amount,spell,level,elite,npc}}, now: time of death.
-- tipCode (for the desktop app's death screen): 1 several enemies, 2 elite, 3 higher level, 4 a spell, 5 basics.
function BackstageForeverDeathReview(hits,now,myLevel)
    local by={}
    for _,h in ipairs(type(hits)=='table' and hits or {}) do
        if type(h)=='table' and h.t and now-h.t<=WINDOW and (h.amount or 0)>0 then
            local k=h.source or 'Something'
            local e=by[k] or {source=k,amount=0,hits=0,level=h.level,elite=h.elite,spell=nil,npc=h.npc}
            e.amount=e.amount+h.amount;e.hits=e.hits+1;e.spell=e.spell or h.spell;e.level=e.level or h.level;e.elite=e.elite or h.elite;e.npc=e.npc or h.npc
            by[k]=e
        end
    end
    local list={}
    for _,e in pairs(by) do list[#list+1]=e end
    table.sort(list,function(a,b) return a.amount>b.amount end)
    if #list==0 then return nil end
    local top,total=list[1],0
    for _,e in ipairs(list) do total=total+e.amount end
    local tip,code
    if #list>=3 then tip,code='Several enemies at once: pull one at a time, and back away from groups.',1
    elseif top.elite then tip,code='That was an elite: much tougher than normal. Bring a group or come back a few levels higher.',2
    elseif top.level and myLevel and top.level>=myLevel+2 then tip,code='It was '..(top.level-myLevel)..' levels above you. Quest somewhere closer to your level first.',3
    elseif top.spell then tip,code='Most damage came from '..top.spell..'. Interrupt or move out of it next time.',4
    else tip,code='Eat or drink to full health between fights, and use your strongest abilities early.',5 end
    return {killer=top.source,share=floor(top.amount/max(1,total)*100+.5),others=#list-1,level=top.level,elite=top.elite,spell=top.spell,tip=tip,tipCode=code,npc=top.npc}
end
-- Pure: one fight summary from totals.
function BackstageForeverFightSummary(damage,healing,seconds)
    seconds=max(1,seconds or 1)
    return {damage=damage or 0,healing=healing or 0,seconds=seconds,dps=floor((damage or 0)/seconds+.5),hps=floor((healing or 0)/seconds+.5)}
end

local me,hits,fight,fights,best=nil,{},nil,{},nil
local function npcOf(guid)
    if type(guid)~='string' then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)')
    if kind=='Creature' or kind=='Vehicle' then return tonumber(id) end
end
local levels={} -- guid -> {level,elite} seen on targets/mouseover
local function remember(unit)
    local guid=call(UnitGUID,unit);if not guid then return end
    local cls=call(UnitClassification,unit)
    levels[guid]={level=call(UnitLevel,unit),elite=cls=='elite' or cls=='rareelite' or cls=='worldboss'}
end
-- Health changes stand in for the combat log, which addons may no longer register (doing so raises
-- "blocked from an action only available to the Blizzard UI"). Damage you take is credited to the
-- hostile creature you are targeting; damage you deal is your target's health loss, counted only
-- while you fight alone (in a group it cannot be told apart from your friends' damage).
local health={}
local function onHealth(unit)
    if unit~='player' and unit~='target' then return end
    local hp,guid=call(UnitHealth,unit),call(UnitGUID,unit)
    local prev=health[unit]
    if type(hp)~='number' or not guid then health[unit]=nil return end
    health[unit]={guid=guid,hp=hp}
    if not prev or prev.guid~=guid then return end
    local lost=prev.hp-hp
    if lost<=0 then return end
    local now=call(GetTime) or 0
    if unit=='player' then
        local foe=call(UnitGUID,'target')
        local hostile=foe and call(UnitCanAttack,'player','target')==true and call(UnitIsDead,'target')~=true
        local info=hostile and levels[foe] or {}
        hits[#hits+1]={t=now,source=hostile and call(UnitName,'target') or nil,amount=lost,level=info.level,elite=info.elite,npc=hostile and npcOf(foe) or nil}
        while #hits>40 or (hits[1] and now-hits[1].t>WINDOW) do table.remove(hits,1) end
    elseif fight and call(IsInGroup)~=true and call(UnitCanAttack,'player','target')==true then
        fight.damage=fight.damage+lost
    end
end
local function startFight() fight={start=call(GetTime) or 0,damage=0,healing=0} end
local function endFight()
    if not fight then return end
    local s=BackstageForeverFightSummary(fight.damage,fight.healing,(call(GetTime) or 0)-fight.start)
    fight=nil
    if s.damage<=0 and s.healing<=0 then return end
    fights[#fights+1]=s;while #fights>50 do table.remove(fights,1) end
    if s.seconds>=5 and (not best or s.dps>best.dps) then best=s end
end
local function onDeath()
    local review=BackstageForeverDeathReview(hits,call(GetTime) or 0,call(UnitLevel,'player'))
    hits={}
    -- The desktop app's death screen gets the same review over the live strip.
    if type(BackstageForeverMomentsDeath)=='function' then pcall(BackstageForeverMomentsDeath,review) end
    if not review then return end
    local who=review.killer..(review.level and (' (level '..review.level..(review.elite and ', elite' or '')..')') or (review.elite and ' (elite)' or ''))
    local line=who..' did '..review.share..'% of the damage'..(review.others>0 and (', with '..review.others..' other'..(review.others==1 and '' or 's')) or '')..'.'
    if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,'What happened',line..' '..review.tip) else say(line..' '..review.tip) end
end
function BackstageForeverStatsCommand()
    if #fights==0 then return say('No fights yet this session.') end
    local d,h,t=0,0,0
    for _,f in ipairs(fights) do d=d+f.damage;h=h+f.healing;t=t+f.seconds end
    say(('This session: %d fights, %d damage, %d damage per second on average (solo fights).'):format(#fights,d,floor(d/max(1,t)+.5)))
    if best then say(('Best fight: %d damage per second over %d seconds.'):format(best.dps,best.seconds)) end
    local last=fights[#fights];say(('Last fight: %d damage per second, %d seconds.'):format(last.dps,last.seconds))
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'UNIT_HEALTH','PLAYER_DEAD','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,unit)
            if event=='UNIT_HEALTH' then pcall(onHealth,plain(unit))
            elseif event=='PLAYER_DEAD' then endFight();pcall(onDeath)
            elseif event=='PLAYER_REGEN_DISABLED' then startFight()
            elseif event=='PLAYER_REGEN_ENABLED' then endFight()
            elseif event=='PLAYER_TARGET_CHANGED' then remember('target') health.target=nil pcall(onHealth,'target')
            elseif event=='UPDATE_MOUSEOVER_UNIT' then remember('mouseover') end
        end)
    end
end

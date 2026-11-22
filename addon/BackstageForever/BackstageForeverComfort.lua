-- Comfort helpers (1.22): five small things said in chat, never a frame.
--   /bf rested         rested XP, how long until it is full, and a nudge when you log out outside a rest area
--   /bf weapons        your weapon skills against the cap; one line when you equip a weapon you are unskilled with
--   /bf flights times  flight times you timed yourself; "About 2m 10s" at take-off for a trip you flew before
--   /bf durability     wear per slot, lowest first; one line when you walk into a rest area with a slot under 20%
--   /bf explore        the named areas you discovered on this map
-- Public API only, every game call guarded. Nothing here moves, clicks, flies or repairs for you.
local floor=math.floor
local unpackAll=unpack or table.unpack
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
    for i=2,14 do r[i]=plain(r[i]) end
    return unpackAll(r,2,14)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function num(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return v end end
-- A name from the game, safe to print and to keep: bounded, no colour or link codes.
local function label(v,max)
    v=plain(v);if type(v)~='string' then return nil end
    v=v:gsub('|','||'):gsub('%c',' ')
    if v=='' or #v>(max or 80) then return nil end
    return v
end
local function T(s)
    local tr=BackstageForeverTr
    if type(tr)~='function' then return s end
    local ok,r=pcall(tr,s)
    return ok and type(r)=='string' and r or s
end
-- Whole lines are translated here; lines built from already translated pieces pass through unchanged.
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local raw=say
local function combat() return call(InCombatLockdown)==true end
local function now() return num(call(GetTime),0,1e12) or 0 end

-- ---------------------------------------------------------------- switches
local KEYS={'rested','weapons','flights','durability'}
local NAMES={rested='Log-off rested nudge',weapons='Weapon skill warning',flights='Flight time at take-off',durability='Low durability warning'}
BackstageForeverComfortHelpers=KEYS
-- Each helper speaks on its own until you switch it off; the commands always answer.
function BackstageForeverComfortEnabled(key)
    local s=BackstageForeverComfortSettings
    return NAMES[key]~=nil and (type(s)~='table' or rawget(s,key)~=false)
end
local enabled=BackstageForeverComfortEnabled
function BackstageForeverComfortCommand(message)
    local which,arg=(type(message)=='string' and #message<=60 and message:lower() or ''):match('^comfort%s*(%a*)%s*(%a*)')
    if which and NAMES[which] then
        if type(BackstageForeverComfortSettings)~='table' then BackstageForeverComfortSettings={} end
        local on
        if arg=='on' then on=true elseif arg=='off' then on=false else on=not enabled(which) end
        BackstageForeverComfortSettings[which]=on
        raw(T(NAMES[which])..' — '..T(on and 'On' or 'Off'))
        return on
    end
    say('Comfort helpers (each speaks on its own until you switch it off):')
    for _,k in ipairs(KEYS) do raw(('  %s — %s (/bf comfort %s %s)'):format(T(NAMES[k]),T(enabled(k) and 'On' or 'Off'),k,enabled(k) and 'off' or 'on')) end
end

-- ---------------------------------------------------------------- Q12 rested
-- Reference rate (Classic rules, not measured on this game build): one bar, 5% of a level,
-- per 8 hours resting in an inn or city; a quarter of that elsewhere; full at 30 bars.
local REST_BARS,REST_HOURS_PER_BAR=30,8
-- Pure. exhaustion = rested XP left (nil when none), xpMax = XP this level needs.
function BackstageForeverRestedState(exhaustion,xpMax,resting,capped)
    if capped==true or type(xpMax)~='number' or xpMax~=xpMax or xpMax<=0 then return {capped=true} end
    local rested=type(exhaustion)=='number' and exhaustion==exhaustion and exhaustion>0 and exhaustion or 0
    local bars=rested/xpMax*20
    if bars>REST_BARS then bars=REST_BARS end
    local missing=REST_BARS-bars
    local full=missing<0.05
    return {capped=false,bars=bars,percent=floor(bars*5+.5),full=full,resting=resting==true,
        hoursInn=full and 0 or missing*REST_HOURS_PER_BAR,hoursElsewhere=full and 0 or missing*REST_HOURS_PER_BAR*4}
end
-- Pure: hours -> "under an hour", "5 h", "3 days 5 h".
function BackstageForeverRestTime(hours)
    if type(hours)~='number' or hours~=hours or hours<0 or hours==math.huge then return nil end
    local h=floor(hours+.5)
    if h<1 then return 'under an hour' end
    if h<24 then return ('%d h'):format(h) end
    if h%24==0 then return ('%d days'):format(h/24) end
    return ('%d days %d h'):format(floor(h/24),h%24)
end
-- Pure: the chat lines for /bf rested.
function BackstageForeverRestedLines(state)
    if type(state)~='table' then return {'Rested XP is not readable in this game client.'} end
    if state.capped then return {'You are at the level cap. Rested XP has nothing to add.'} end
    local lines={}
    if state.full then lines[1]='Rested XP is full: 30 bars, a level and a half.'
    else
        lines[1]=('Rested XP: %.1f of 30 bars (%d%% of a level).'):format(state.bars,state.percent)
        lines[2]=('Full in about %s at an inn or city, about %s elsewhere. Reference rate: one bar per 8 hours in an inn or city.')
            :format(T(BackstageForeverRestTime(state.hoursInn)),T(BackstageForeverRestTime(state.hoursElsewhere)))
    end
    lines[#lines+1]=state.resting and 'You are resting now.' or 'You are not in a rest area now.'
    return lines
end
-- Pure: the one line said when the logout countdown starts, or nil.
function BackstageForeverRestedNudge(state)
    if type(state)~='table' or state.capped or state.full or state.resting then return nil end
    return 'You are logging out outside a rest area. Rested XP builds four times faster in an inn or city (reference rate).'
end
local function restedNow()
    local xpMax=num(call(UnitXPMax,'player'),0,2147483647)
    if not xpMax then return nil end
    local level,top=num(call(UnitLevel,'player'),1,1000),num(call(GetMaxPlayerLevel),1,1000)
    local capped=xpMax==0 or (level and top and level>=top) or call(IsXPUserDisabled)==true
    return BackstageForeverRestedState(num(call(GetXPExhaustion),0,2147483647),xpMax,call(IsResting)==true,capped)
end
function BackstageForeverRestedCommand()
    for _,line in ipairs(BackstageForeverRestedLines(restedNow())) do say(line) end
end
local function onCamping()
    if not enabled('rested') or combat() then return end
    local line=BackstageForeverRestedNudge(restedNow())
    if line then say(line) end
end

-- ---------------------------------------------------------------- Q13 weapon skills
-- Pure: the skill line an item subtype trains, matched by the game's own names so it works in any
-- language. "Two-Handed Maces" matches itself; "One-Handed Maces" matches the skill "Maces".
-- nil when nothing matches: the caller then stays quiet.
function BackstageForeverWeaponSkillFor(subtype,skills)
    if type(subtype)~='string' or subtype=='' or type(skills)~='table' then return nil end
    local want=subtype:lower()
    local best,bestLength
    for _,skill in ipairs(skills) do
        local name=type(skill)=='table' and skill.name
        if type(name)=='string' and #name>=3 then
            local lower=name:lower()
            if lower==want then return skill end
            -- The first letter may be an accented capital the game's lower() leaves alone ("Äxte" in "Einhandäxte").
            local tail=lower:gsub('^[\194-\244][\128-\191]*','')
            if want:find(lower,1,true) or (tail~=lower and #tail>=3 and want:find(tail,1,true)) then
                if not bestLength or #lower>bestLength then best,bestLength=skill,#lower end
            end
        end
    end
    return best
end
-- Pure: the skill cap at a level (Classic rule).
function BackstageForeverWeaponSkillCap(level)
    if type(level)~='number' or level~=level or level<1 then return nil end
    return floor(level)*5
end
-- Pure: the warning for a weapon skill well below the cap, or nil.
function BackstageForeverWeaponSkillLine(skill,level)
    local cap=BackstageForeverWeaponSkillCap(level)
    if not cap or type(skill)~='table' or type(skill.name)~='string' or type(skill.rank)~='number' then return nil end
    if cap-skill.rank<25 or skill.rank>=cap*.85 then return nil end
    return ('%s %d/%d: expect misses until it rises.'):format(skill.name,skill.rank,cap)
end
-- Pure: the chat lines for /bf weapons, lowest skill first.
function BackstageForeverWeaponLines(skills,level)
    local cap=BackstageForeverWeaponSkillCap(level)
    if not cap or type(skills)~='table' or #skills==0 then return {'Weapon skills are not readable in this game client.'} end
    local sorted={}
    for _,skill in ipairs(skills) do sorted[#sorted+1]=skill end
    table.sort(sorted,function(a,b) if a.rank~=b.rank then return a.rank<b.rank end return a.name<b.name end)
    local lines={('Weapon skills, lowest first. The cap at level %d is %d.'):format(floor(level),cap)}
    local parts={}
    for i,skill in ipairs(sorted) do
        parts[#parts+1]=('%s %d/%d'):format(skill.name,skill.rank,cap)
        if #parts==4 or i==#sorted then lines[#lines+1]='  '..table.concat(parts,', ');parts={} end
        if #lines>=6 then break end
    end
    return lines
end
-- Every skill line the game lists, in order, with the header it sits under.
local function skillLines()
    local out,group={},0
    local api=plain(C_SkillInfo)
    local count=num(call(field(api,'GetNumSkillLines')),0,200)
    if count and type(field(api,'GetSkillLineInfo'))=='function' then
        for i=1,count do
            local info=call(api.GetSkillLineInfo,i)
            if field(info,'isHeader')==true then group=group+1
            else
                local name,rank,top=label(field(info,'name'),60),num(field(info,'rank'),0,10000),num(field(info,'maxRank'),0,10000)
                if name and rank and top then out[#out+1]={name=name,rank=rank,max=top,group=group} end
            end
        end
        return out
    end
    -- Older clients: GetSkillLineInfo(i) -> name, isHeader, isExpanded, rank, temp, modifier, maxRank.
    count=num(call(GetNumSkillLines),0,200) or 0
    for i=1,count do
        local name,header,_,rank,_,_,top=call(GetSkillLineInfo,i)
        if header then group=group+1
        else
            name,rank,top=label(name,60),num(rank,0,10000),num(top,0,10000)
            if name and rank and top then out[#out+1]={name=name,rank=rank,max=top,group=group} end
        end
    end
    return out
end
local function itemInfo(link)
    local api=plain(C_Item)
    local read=field(api,'GetItemInfo') or plain(GetItemInfo)
    local _,_,_,_,_,_,subtype,_,_,_,_,classId,subclassId=call(read,link)
    return label(subtype,60),num(classId,0,100),num(subclassId,0,100)
end
local WEAPON_CLASS,FISHING_POLE=2,20
-- The skill of the weapon in a slot (16 main hand, 17 off hand, 18 ranged), or nil.
local function slotSkill(slot,skills)
    local link=call(GetInventoryItemLink,'player',slot)
    if type(link)~='string' then return nil end
    local subtype,classId,subclassId=itemInfo(link)
    if classId~=WEAPON_CLASS or subclassId==FISHING_POLE then return nil end
    return BackstageForeverWeaponSkillFor(subtype,skills)
end
-- Weapon skills: every skill a weapon type trains, plus the others under the same header that
-- rise with your level (Defense, Unarmed).
local function weaponSkills(level)
    local skills=skillLines()
    local cap=BackstageForeverWeaponSkillCap(level)
    local picked,list,groups={},{},{}
    local function take(skill)
        if skill and not picked[skill] and skill.max>1 then picked[skill]=true;list[#list+1]=skill;groups[skill.group]=true end
    end
    local api=plain(C_Item)
    local subclassName=field(api,'GetItemSubClassInfo') or plain(GetItemSubClassInfo)
    for subclass=0,19 do take(BackstageForeverWeaponSkillFor(label((call(subclassName,WEAPON_CLASS,subclass)),60),skills)) end
    for _,slot in ipairs({16,17,18}) do take(slotSkill(slot,skills)) end
    for _,skill in ipairs(skills) do
        if skill.group>0 and groups[skill.group] and cap and skill.max==cap then take(skill) end
    end
    return list
end
function BackstageForeverWeaponsCommand()
    local level=num(call(UnitLevel,'player'),1,1000)
    local lines=BackstageForeverWeaponLines(level and weaponSkills(level) or {},level)
    for i,line in ipairs(lines) do if i==1 then say(line) else raw(line) end end
end
local weaponWarned,weaponPending={},false
local function checkWeapons()
    if not enabled('weapons') then weaponPending=false;return end
    if combat() then weaponPending=true;return end
    weaponPending=false
    local level=num(call(UnitLevel,'player'),1,1000)
    if not level then return end
    local skills=skillLines()
    for _,slot in ipairs({16,17,18}) do
        local skill=slotSkill(slot,skills)
        if skill and not weaponWarned[skill.name] then
            local line=BackstageForeverWeaponSkillLine(skill,level)
            if line then weaponWarned[skill.name]=true;say(line) end
        end
    end
end

-- ---------------------------------------------------------------- Q14 flight times
local MAX_TRIPS=200
-- Pure: seconds -> "45s", "2m 10s".
function BackstageForeverFlightDuration(seconds)
    if type(seconds)~='number' or seconds~=seconds or seconds<0 or seconds==math.huge then return nil end
    local s=floor(seconds+.5)
    if s<60 then return s..'s' end
    return ('%dm %02ds'):format(floor(s/60),s%60)
end
local function trips(db)
    local list=type(db)=='table' and rawget(db,'trips')
    return type(list)=='table' and list or nil
end
local function findTrip(db,from,to)
    for _,row in ipairs(trips(db) or {}) do
        if type(row)=='table' and row.from==from and row.to==to then return row end
    end
end
-- Pure: the time you measured for this exact trip, or nil.
function BackstageForeverFlightKnownTime(db,from,to)
    local row=type(from)=='string' and type(to)=='string' and findTrip(db,from,to)
    return row and type(row.seconds)=='number' and row.seconds or nil
end
-- Pure: keep one timed flight. The latest time wins (flights are scripted, so it barely moves);
-- at most 200 trips, the one flown longest ago goes first. Returns the row, or nil when refused.
function BackstageForeverFlightRecord(db,from,to,seconds,at)
    local list=trips(db)
    if not list or type(from)~='string' or type(to)~='string' or from=='' or to=='' or from==to or #from>80 or #to>80 then return nil end
    if type(seconds)~='number' or seconds~=seconds or seconds<5 or seconds>3600 then return nil end
    at=type(at)=='number' and at or 0
    local row=findTrip(db,from,to)
    if row then
        row.seconds=floor(seconds+.5);row.count=(type(row.count)=='number' and row.count or 1)+1;row.at=at
        return row
    end
    while #list>=MAX_TRIPS do
        local oldest=1
        for i,other in ipairs(list) do if (tonumber(other.at) or 0)<(tonumber(list[oldest].at) or 0) then oldest=i end end
        table.remove(list,oldest)
    end
    row={from=from,to=to,seconds=floor(seconds+.5),count=1,at=at}
    list[#list+1]=row
    return row
end
-- Pure: the chat lines for /bf flights times, latest flown first.
function BackstageForeverFlightLines(db,limit)
    local sorted={}
    for _,row in ipairs(trips(db) or {}) do
        if type(row)=='table' and type(row.from)=='string' and type(row.to)=='string' and type(row.seconds)=='number' then sorted[#sorted+1]=row end
    end
    if #sorted==0 then return {'No flight times learned yet. Take a flight and the addon times it.'} end
    table.sort(sorted,function(a,b)
        local x,y=tonumber(a.at) or 0,tonumber(b.at) or 0
        if x~=y then return x>y end
        if a.from~=b.from then return a.from<b.from end
        return a.to<b.to
    end)
    local lines={('Flight times you learned: %d.'):format(#sorted)}
    for i=1,math.min(#sorted,limit or 12) do
        local row=sorted[i]
        local count=type(row.count)=='number' and row.count or 1
        lines[#lines+1]=count==1 and ('%s to %s: %s, flown once.'):format(row.from,row.to,BackstageForeverFlightDuration(row.seconds))
            or ('%s to %s: %s, flown %d times.'):format(row.from,row.to,BackstageForeverFlightDuration(row.seconds),count)
    end
    return lines
end
-- Pure: one step of the flight watcher. state = {from, dest, closedAt, flying, startedAt}.
-- -> 'takeoff' | 'landed', seconds | 'expired' | nil
function BackstageForeverFlightStep(state,onTaxi,at)
    if type(state)~='table' or type(at)~='number' then return nil end
    if state.flying then
        if onTaxi then return nil end
        state.flying=false
        return 'landed',at-(state.startedAt or at)
    end
    if not state.from then return nil end
    if onTaxi then state.flying=true;state.startedAt=at;state.closedAt=nil;return 'takeoff' end
    -- The flight map was closed and nothing took off: you walked away.
    if state.closedAt and at-state.closedAt>20 then state.from=nil;state.dest=nil;state.closedAt=nil;return 'expired' end
end
local function flightDB()
    local db=BackstageForeverFlightTimesDB
    if type(db)~='table' or type(rawget(db,'trips'))~='table' then db={v=1,trips={}};BackstageForeverFlightTimesDB=db end
    return db
end
-- "Subzone, Zone" where you stand, the way flight points are named.
local function place()
    local zone,sub=label((call(GetZoneText)),40),label((call(GetSubZoneText)),40)
    if zone and sub and sub~=zone then return sub..', '..zone end
    return zone or sub
end
local function taxiNodes()
    local api=plain(C_TaxiMap)
    local mapId=num(call(GetTaxiMapID),1,2147483647)
    local nodes=mapId and call(field(api,'GetAllTaxiNodes'),mapId)
    return type(nodes)=='table' and nodes or nil
end
-- The flight point you are standing at, by the game's own name.
local function currentNode()
    local nodes=taxiNodes()
    if nodes then
        for i=1,200 do
            local node=field(nodes,i)
            if node==nil then break end
            -- Enum.FlightPathState: 0 is the point you are at.
            if field(node,'state')==0 then return label(field(node,'name'),80) end
        end
        return nil
    end
    for i=1,num(call(NumTaxiNodes),0,400) or 0 do
        if call(TaxiNodeGetType,i)=='CURRENT' then return label((call(TaxiNodeName,i)),80) end
    end
end
local function nodeBySlot(slot)
    local nodes=taxiNodes()
    if nodes then
        for i=1,200 do
            local node=field(nodes,i)
            if node==nil then break end
            if field(node,'slotIndex')==slot then return label(field(node,'name'),80) end
        end
    end
    return label((call(TaxiNodeName,slot)),80)
end
local flight={}
BackstageForeverFlightState=flight
local function flightTick()
    if not flight.from and not flight.flying then return end
    local what,seconds=BackstageForeverFlightStep(flight,call(UnitOnTaxi,'player')==true,now())
    if what=='takeoff' then
        local known=flight.dest and BackstageForeverFlightKnownTime(flightDB(),flight.from,flight.dest)
        if known and enabled('flights') then say(('About %s to %s.'):format(BackstageForeverFlightDuration(known),flight.dest)) end
    elseif what=='landed' then
        local from,to=flight.from,flight.dest or place()
        flight.from=nil;flight.dest=nil
        if from and to then BackstageForeverFlightRecord(flightDB(),from,to,seconds,num(call(GetServerTime),0,1e11) or 0) end
    end
end
BackstageForeverFlightTick=flightTick
function BackstageForeverFlightTimesCommand()
    for _,line in ipairs(BackstageForeverFlightLines(flightDB())) do say(line) end
end

-- ---------------------------------------------------------------- C5 durability
local SLOTS={{1,'HEADSLOT','Head'},{3,'SHOULDERSLOT','Shoulder'},{5,'CHESTSLOT','Chest'},{6,'WAISTSLOT','Waist'},{7,'LEGSSLOT','Legs'},
    {8,'FEETSLOT','Feet'},{9,'WRISTSLOT','Wrist'},{10,'HANDSSLOT','Hands'},{16,'MAINHANDSLOT','Main Hand'},{17,'SECONDARYHANDSLOT','Off Hand'},{18,'RANGEDSLOT','Ranged'}}
-- Pure. slots = {{name=,cur=,max=}} -> {worn = damaged slots, lowest first; lost = percent of all
-- durability gone (0..100); counted = slots that have durability}.
function BackstageForeverGearWear(slots)
    local worn,current,total,counted={},0,0,0
    for _,slot in ipairs(type(slots)=='table' and slots or {}) do
        local cur,max=type(slot)=='table' and tonumber(slot.cur),type(slot)=='table' and tonumber(slot.max)
        if cur and max and max>0 and cur>=0 and cur<=max then
            counted=counted+1;current=current+cur;total=total+max
            if cur<max then worn[#worn+1]={name=tostring(slot.name or '?'),percent=floor(cur/max*100),cur=cur,max=max} end
        end
    end
    table.sort(worn,function(a,b) if a.percent~=b.percent then return a.percent<b.percent end return a.name<b.name end)
    local lost=0
    if total>0 and current<total then lost=math.max(1,floor((1-current/total)*100+.5)) end
    return {worn=worn,lost=lost,counted=counted}
end
-- Pure: the chat lines for /bf durability.
function BackstageForeverGearWearLines(wear)
    if type(wear)~='table' or wear.counted==0 then return {'Nothing you wear has durability to read.'} end
    if #wear.worn==0 then return {'All your gear is at full durability.'} end
    local parts={}
    for _,slot in ipairs(wear.worn) do parts[#parts+1]=('%s %d%%'):format(slot.name,slot.percent) end
    return {('Your gear has lost %d%% of its durability. Most worn first:'):format(wear.lost),'  '..table.concat(parts,', ')}
end
-- Pure: the one line said on entering a rest area, or nil when no slot is under 20%.
function BackstageForeverGearWearWarning(wear)
    local low=type(wear)=='table' and wear.worn and wear.worn[1]
    if not low or low.percent>=20 then return nil end
    local more=0
    for i=2,#wear.worn do if wear.worn[i].percent<20 then more=more+1 end end
    if more==0 then return ('%s is at %d%% durability. Repair before you head out: /bf repair.'):format(low.name,low.percent) end
    return ('%s is at %d%% durability and %d more are under 20%%. Repair before you head out: /bf repair.'):format(low.name,low.percent,more)
end
local function readWear()
    local slots={}
    for _,row in ipairs(SLOTS) do
        local cur,max=call(GetInventoryItemDurability,row[1])
        if type(cur)=='number' and type(max)=='number' then
            slots[#slots+1]={name=label(_G[row[2]],30) or T(row[3]),cur=cur,max=max}
        end
    end
    return BackstageForeverGearWear(slots)
end
function BackstageForeverDurabilityCommand()
    local lines=BackstageForeverGearWearLines(readWear())
    for i,line in ipairs(lines) do if i==1 then say(line) else raw(line) end end
end
local wasResting,wearWarnedAt=nil,nil
local function onResting(baseline)
    local resting=call(IsResting)==true
    local entered=resting and wasResting==false
    wasResting=resting
    if baseline or not entered or not enabled('durability') or combat() then return end
    local at=now()
    if wearWarnedAt and at-wearWarnedAt<300 then return end
    local line=BackstageForeverGearWearWarning(readWear())
    if line then wearWarnedAt=at;say(line) end
end

-- ---------------------------------------------------------------- W3 exploration
-- The game tells addons which named areas you HAVE discovered at a map position, and nothing about
-- the ones you have not. So this lists what is discovered and says plainly what it cannot know.
local NOT_TOLD='This game version does not tell addons which areas are undiscovered.'
-- Pure: names = discovered area names (any order, repeats allowed) or nil when unreadable.
function BackstageForeverExploreLines(names)
    if type(names)~='table' then return {NOT_TOLD} end
    local seen,list={},{}
    for _,name in ipairs(names) do
        if type(name)=='string' and name~='' and not seen[name] then seen[name]=true;list[#list+1]=name end
    end
    if #list==0 then return {'No discovered area was found on this map.',NOT_TOLD} end
    table.sort(list)
    local shown={}
    for i=1,math.min(#list,12) do shown[i]=list[i] end
    local text=table.concat(shown,', ')
    if #list>#shown then text=text..(', +%d'):format(#list-#shown) end
    return {('Discovered on this map: %d named areas.'):format(#list),'  '..text,NOT_TOLD}
end
local function exploredNames()
    local maps,explore=plain(C_Map),plain(C_MapExplorationInfo)
    local at=field(explore,'GetExploredAreaIDsAtPosition')
    local areaName=field(maps,'GetAreaInfo')
    local vector=plain(CreateVector2D)
    local map=num(call(field(maps,'GetBestMapForUnit'),'player'),1,2147483647)
    if type(at)~='function' or type(areaName)~='function' or type(vector)~='function' or not map then return nil end
    local ids,names,read={},{},false
    for gx=0,19 do
        for gy=0,19 do
            local position=call(vector,(gx+.5)/20,(gy+.5)/20)
            local found=position and call(at,map,position)
            if type(found)=='table' then
                read=true
                for i=1,8 do
                    local id=num(field(found,i),1,2147483647)
                    if not id then break end
                    if not ids[id] then
                        ids[id]=true
                        local name=label((call(areaName,id)),60)
                        if name then names[#names+1]=name end
                    end
                end
            end
        end
    end
    -- No answer at any point: either nothing is discovered or the call does nothing here. Say only what is known.
    if not read then return {} end
    return names
end
function BackstageForeverExploreCommand()
    if combat() then return say('Try /bf explore outside combat.') end
    local ok,names=pcall(exploredNames)
    local lines=BackstageForeverExploreLines(ok and names or nil)
    for _,line in ipairs(lines) do if line:sub(1,2)=='  ' then raw(line) else say(line) end end
end

-- ---------------------------------------------------------------- events
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        -- PLAYER_CAMPING is the start of the logout countdown. A client without it refuses the
        -- registration (guarded) and the nudge simply never speaks.
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','PLAYER_CAMPING','PLAYER_EQUIPMENT_CHANGED','PLAYER_REGEN_ENABLED',
            'PLAYER_UPDATE_RESTING','TAXIMAP_OPENED','TAXIMAP_CLOSED','PLAYER_CONTROL_LOST','PLAYER_CONTROL_GAINED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a)
            if event=='PLAYER_LOGIN' then
                flightDB()
                -- A post-hook only reads which flight point you clicked; it never chooses one.
                if type(hooksecurefunc)=='function' and type(TakeTaxiNode)=='function' then
                    pcall(hooksecurefunc,'TakeTaxiNode',function(slot)
                        if flight.from and not flight.flying then local ok,name=pcall(nodeBySlot,plain(slot));flight.dest=ok and name or nil end
                    end)
                end
            elseif event=='PLAYER_ENTERING_WORLD' then pcall(onResting,true)
            elseif event=='PLAYER_UPDATE_RESTING' then pcall(onResting,false)
            elseif event=='PLAYER_CAMPING' then pcall(onCamping)
            elseif event=='PLAYER_EQUIPMENT_CHANGED' then
                local slot=plain(a)
                if slot==16 or slot==17 or slot==18 then pcall(checkWeapons) end
            elseif event=='PLAYER_REGEN_ENABLED' then if weaponPending then pcall(checkWeapons) end
            elseif event=='TAXIMAP_OPENED' then
                if not flight.flying then
                    local ok,name=pcall(currentNode)
                    flight.from=(ok and name) or place();flight.dest=nil;flight.closedAt=nil
                end
            elseif event=='TAXIMAP_CLOSED' then if flight.from and not flight.flying then flight.closedAt=now() end;pcall(flightTick)
            else pcall(flightTick) end
        end)
        local wait=0
        pcall(events.SetScript,events,'OnUpdate',function(_,elapsed)
            if not flight.from and not flight.flying then return end
            wait=wait-(tonumber(elapsed) or 0);if wait>0 then return end;wait=.25
            pcall(flightTick)
        end)
    end
end

-- Journey journal: when each level was reached (with /played time), first-time moments and
-- zones visited. Kept per character and exported to the desktop app for speed splits and
-- badges. Public API only; the /played request is made quietly (its chat line is hidden once).
local floor,min=math.floor,math.min
local function plain(v)
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,12 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,12)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return floor(v) end end
local MAX_LEVELS,MAX_FIRSTS,MAX_ZONES,MAX_GIVERS=80,40,120,400
local MAX_ENCOUNTERS=100
local FIRSTS={dungeon=true,flight=true,mount=true,death=true,rested=true,group=true,hearth=true}

local db
local pendingNpc=nil
local function store()
    if type(BackstageForeverJournalDB)~='table' then BackstageForeverJournalDB={} end
    db=BackstageForeverJournalDB
    if type(db.levels)~='table' then db.levels={} end
    if type(db.firsts)~='table' then db.firsts={} end
    if type(db.zones)~='table' then db.zones={} end
    if type(db.givers)~='table' then db.givers={} end
    if type(db.encounters)~='table' then db.encounters={} end
    return db
end
local function now() return int(call(time),0,253402300799) end

-- Pure-ish helpers (exposed for tests).
function BackstageForeverJournalLevel(level,at)
    local d=store();level=int(level,1,1000);at=int(at,0,253402300799)
    if not level or not at then return end
    for _,e in ipairs(d.levels) do if e.level==level then return e end end
    local e={level=level,at=at};d.levels[#d.levels+1]=e
    while #d.levels>MAX_LEVELS do table.remove(d.levels,1) end
    return e
end
function BackstageForeverJournalPlayed(total)
    local d=store();total=int(total,0,10^10)
    if not total then return end
    d.played=total;d.playedAt=now()
    -- The newest level without a /played reading gets this one (it was just reached).
    local last=d.levels[#d.levels]
    if last and not last.played and d.playedAt and d.playedAt-last.at<=600 then last.played=total end
end
function BackstageForeverJournalFirst(key,at)
    local d=store();at=int(at,0,253402300799)
    if not FIRSTS[key] or not at then return false end
    for _,f in ipairs(d.firsts) do if f.key==key then return false end end
    if #d.firsts>=MAX_FIRSTS then return false end
    d.firsts[#d.firsts+1]={key=key,at=at}
    return true
end
function BackstageForeverJournalZone(mapId)
    local d=store();mapId=int(mapId,1,2147483647)
    if not mapId then return false end
    for _,z in ipairs(d.zones) do if z==mapId then return false end end
    if #d.zones>=MAX_ZONES then return false end
    d.zones[#d.zones+1]=mapId
    return true
end
-- 1.4 (J14): who gave each quest and where you stood when you accepted it. Teaches the app's
-- guided route the quest givers its bundled data has no position for.
function BackstageForeverJournalGiver(questId,npcId,mapId,x,y,at)
    local d=store();questId=int(questId,1,2147483647);npcId=int(npcId,1,2147483647);mapId=int(mapId,1,2147483647);at=int(at,0,253402300799)
    x=plain(x);y=plain(y)
    if not questId or not npcId or not mapId or not at or type(x)~='number' or type(y)~='number' or x<0 or x>1 or y<0 or y>1 then return false end
    for _,g in ipairs(d.givers) do if g.q==questId then return false end end
    d.givers[#d.givers+1]={q=questId,n=npcId,m=mapId,x=floor(x*10000+.5)/10000,y=floor(y*10000+.5)/10000,at=at}
    while #d.givers>MAX_GIVERS do table.remove(d.givers,1) end
    return true
end
local function encounterInt(v,lo,hi)
    local n=int(v,lo,hi)
    if n and n==v then return n end
end

local function encounterSnapshot(d)
    local encounters={}
    for i=math.max(1,#d.encounters-MAX_ENCOUNTERS+1),#d.encounters do
        local e=d.encounters[i]
        if type(e)=='table' then encounters[#encounters+1]={encounterId=e.encounterId,name=e.name,instanceMap=e.instanceMap,instanceType=e.instanceType,difficultyId=e.difficultyId,at=e.at} end
    end
    return #encounters>0 and encounters or nil
end

-- Called only for a successful ENCOUNTER_END. Use the instance ID, not a UI map or target NPC.
function BackstageForeverJournalEncounter(encounterId,name,difficultyId)
    local _,kind,_,_,_,_,_,instanceMap=call(GetInstanceInfo)
    if kind~='party' and kind~='raid' then return end
    instanceMap=encounterInt(instanceMap,1,2147483647)
    encounterId=encounterInt(encounterId,1,2147483647)
    difficultyId=encounterInt(difficultyId,0,2147483647)
    name=plain(name)
    local at=now()
    if not instanceMap or not encounterId or not difficultyId or not at or at==0
        or type(name)~='string' or #name>120 or name:find('[%z\1-\31\127]') or not name:find('%S') then return end
    local d=store()
    for i=math.max(1,#d.encounters-MAX_ENCOUNTERS+1),#d.encounters do
        local e=d.encounters[i]
        if type(e)=='table' and type(e.at)=='number' and math.abs(at-e.at)<10 and e.encounterId==encounterId
            and e.instanceMap==instanceMap and e.instanceType==kind and e.difficultyId==difficultyId then return end
    end
    d.encounters[#d.encounters+1]={encounterId=encounterId,name=name,instanceMap=instanceMap,instanceType=kind,difficultyId=difficultyId,at=at}
    while #d.encounters>MAX_ENCOUNTERS do table.remove(d.encounters,1) end
    if type(BackstageForeverRequestEncounterCapture)=='function' then
        pcall(BackstageForeverRequestEncounterCapture,encounterSnapshot(d),at)
    end
end

-- Export block (the optional encounters array is only sent when nonempty).
function BackstageForeverJournalSnapshot()
    local d=store()
    local levels,firsts,zones={},{},{}
    for i=1,min(#d.levels,MAX_LEVELS) do local e=d.levels[i];levels[#levels+1]={level=e.level,at=e.at,played=e.played} end
    for i=1,min(#d.firsts,MAX_FIRSTS) do firsts[#firsts+1]={key=d.firsts[i].key,at=d.firsts[i].at} end
    for i=1,min(#d.zones,MAX_ZONES) do zones[#zones+1]=d.zones[i] end
    local givers={}
    for i=1,min(#d.givers,MAX_GIVERS) do local g=d.givers[i];givers[#givers+1]={q=g.q,n=g.n,m=g.m,x=g.x,y=g.y,at=g.at} end
    local encounters=encounterSnapshot(d)
    if #levels==0 and #firsts==0 and #zones==0 and #givers==0 and not encounters and not d.played then return nil end
    return {levels=levels,firsts=firsts,zones=zones,givers=givers,encounters=encounters,played=d.played}
end

-- Badges in game (1.1.1): the same rules as the app's Characters → Badges, from what this
-- character knows right now. /bf badges lists them; a new one gets a small toast.
local BADGES={}
local PIN_FACT={Levels='level',Exploring='zones',Gold='gold'}
local PIN_BADGES={}
local function add(id,group,name,how,test)
    local badge={id=id,group=group,name=name,how=how,test=test}
    BADGES[#BADGES+1]=badge
    if PIN_FACT[group] then PIN_BADGES[id]=badge end
end
for _,n in ipairs({10,20,30,40,50,60}) do add('level-'..n,'Levels','Level '..n,'Reach level '..n..'.',function(f) return f.level>=n,f.level,n end) end
for _,b in ipairs({{25,'Errand runner'},{100,'Quest hero'},{500,'Living legend'}}) do add('quests-'..b[1],'Quests',b[2],'Complete '..b[1]..' quests.',function(f) return f.quests>=b[1],f.quests,b[1] end) end
for _,b in ipairs({{5,'Wanderer'},{15,'Pathfinder'},{30,'World explorer'}}) do add('explorer-'..b[1],'Exploring',b[2],'Visit '..b[1]..' zones.',function(f) return f.zones>=b[1],f.zones,b[1] end) end
for _,b in ipairs({{'dungeon','Into the depths','Enter your first dungeon.'},{'flight','Taking wing','Take your first flight.'},{'mount','Saddle up','Ride your own mount.'},{'group','Better together','Join a group.'},{'hearth','Home again','Use your Hearthstone.'},{'rested','Well rested','Earn a rested bonus by logging out in an inn or city.'},{'death','Back from the dead','Die once (it happens to everyone) and run back.'}}) do
    add('first-'..b[1],'Firsts',b[2],b[3],function(f) return f.firsts[b[1]]==true end)
end
add('speed','Speed','Fast learner','Gain a level in under one hour of play.',function(f) return f.fastest~=nil and f.fastest<3600 end)
for _,b in ipairs({{75,'Apprentice'},{150,'Journeyman'},{225,'Expert'},{300,'Artisan'}}) do add('profession-'..b[1],'Professions',b[2],'Reach skill '..b[1]..' in any profession.',function(f) return f.profession>=b[1],f.profession,b[1] end) end
for _,b in ipairs({{10,'Pocket money'},{100,'Mount money'},{1000,'Gold baron'}}) do add('gold-'..b[1],'Gold',b[2],'Carry '..b[1]..' gold at once.',function(f) return f.gold>=b[1],f.gold,b[1] end) end
for _,b in ipairs({{6,'rep-honored','Good friends','Honored'},{7,'rep-revered','Trusted ally','Revered'},{8,'rep-exalted','Exalted','Exalted'}}) do add(b[2],'Reputation',b[3],'Reach '..b[4]..' with any faction.',function(f) return f.standing>=b[1] end) end

-- Facts: the journal here, live values from the game, the rest from the last save of this character.
function BackstageForeverBadgeFacts()
    local d=store()
    local saved=type(BackstageForeverSavedFacts)=='function' and select(2,pcall(BackstageForeverSavedFacts)) or nil
    if type(saved)~='table' then saved={} end
    local f={level=int(call(UnitLevel,'player'),0,1000) or int(saved.level,0,1000) or 0,zones=#d.zones,firsts={},fastest=nil,
        quests=int(saved.quests,0,100000) or 0,profession=int(saved.profession,0,10000) or 0,standing=int(saved.standing,0,8) or 0}
    local copper=int(call(GetMoney),0,10^12) or int(saved.money,0,10^12) or 0
    f.gold=floor(copper/10000)
    for _,x in ipairs(d.firsts) do f.firsts[x.key]=true end
    for i=2,#d.levels do
        local a,b=d.levels[i-1],d.levels[i]
        if a.played and b.played and b.level==a.level+1 and b.played>a.played then local s=b.played-a.played;if not f.fastest or s<f.fastest then f.fastest=s end end
    end
    return f
end
function BackstageForeverBadgeList(f)
    f=f or BackstageForeverBadgeFacts()
    local out,earned={},0
    for _,b in ipairs(BADGES) do
        local ok,done,have,need=pcall(b.test,f)
        done=ok and done==true
        if done then earned=earned+1 end
        out[#out+1]={id=b.id,group=b.group,name=b.name,how=b.how,earned=done,have=ok and have or nil,need=ok and need or nil}
    end
    return out,earned
end
-- Newly earned since last check: a toast each (at most two), the first check is the baseline.
function BackstageForeverBadgeCheck(quiet)
    local d=store();local list=BackstageForeverBadgeList()
    local first=type(d.badges)~='table';if first then d.badges={} end
    local seen={};for _,id in ipairs(d.badges) do seen[id]=true end
    local fresh={}
    for _,b in ipairs(list) do if b.earned and not seen[b.id] then fresh[#fresh+1]=b;d.badges[#d.badges+1]=b.id end end
    if not first and not quiet and type(BackstageForeverToast)=='function' then
        for i=1,min(#fresh,2) do pcall(BackstageForeverToast,'Badge earned: '..fresh[i].name,fresh[i].how..' See them all with /bf badges or in the app.',nil,'badge') end
    end
    return fresh
end
local function say(line)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(line)) end
end
-- Compass progress uses public game readings and recorded zone visits only. In particular,
-- saved balances, quest counts and profession ranks are not live progress.
local eventLevel,eventLevelOwner
local function liveLevel(d)
    local level=int(call(UnitLevel,'player'),1,1000)
    -- The level-up payload can arrive before UnitLevel reflects the new level.
    if d==eventLevelOwner and eventLevel then
        if not level or level<eventLevel then return eventLevel end
        eventLevel,eventLevelOwner=nil,nil
    end
    return level
end
local function liveBadgeFacts()
    local copper=int(call(GetMoney),0,10^12)
    local d=store()
    return {level=liveLevel(d),zones=min(#d.zones,MAX_ZONES),gold=copper and floor(copper/10000)}
end
local function liveProgress(b,f)
    if f[PIN_FACT[b.group]]~=nil then return b.test(f) end
end
local function pinnedLine(b,done,have,need)
    local prefix='Pinned: '..b.name
    if done then return prefix..' (goal reached)' end
    if done==nil then return prefix..' (progress unavailable)' end
    return string.format('%s %d/%d',prefix,have,need)
end
local function pinnedBadge()
    local id=plain(store().pinnedBadge)
    return type(id)=='string' and PIN_BADGES[id] or nil
end
local function pinCompleted(d,b)
    local completed=plain(d.completedPins)
    return type(completed)=='table' and plain(completed[b.id])==true
end
local function observePin(b)
    local d=store()
    if pinCompleted(d,b) then return true end
    local done,have,need=liveProgress(b,liveBadgeFacts())
    if done then
        -- Separate from legacy badge/toast history, which can use saved facts.
        if type(plain(d.completedPins))~='table' then d.completedPins={} end
        d.completedPins[b.id]=true
    end
    return done,have,need
end
function BackstageForeverPinnedBadgeLine()
    local b=pinnedBadge()
    if b then return pinnedLine(b,observePin(b)) end
end
-- Optional badge-only repaint: do not capture or replace the current HUD snapshot.
local function refreshBadge(fact)
    local b=fact and pinnedBadge()
    local matches=b and PIN_FACT[b.group]==fact
    -- Record confirmed progress even if there is no visible HUD or we're in combat.
    if matches then observePin(b) end
    if (not fact or matches or (not b and fact=='level')) and type(BackstageForeverHUDRefreshBadge)=='function' and call(InCombatLockdown)==false then
        pcall(BackstageForeverHUDRefreshBadge)
    end
end
-- J28 (1.6): the pin takes precedence over the closest live badge on the Compass.
function BackstageForeverNextBadgeLine()
    local pinned=BackstageForeverPinnedBadgeLine()
    if pinned then return pinned end
    local f,d=liveBadgeFacts(),store()
    local best,share,progress=nil,-1,nil
    for _,b in ipairs(BADGES) do
        if PIN_BADGES[b.id] and not pinCompleted(d,b) then
            local done,have,need=liveProgress(b,f)
            if done==false and have>0 and have/need>share then
                best,share,progress=b,have/need,string.format('%d/%d',have,need)
            end
        end
    end
    if not best then return nil end
    return 'Next badge: '..best.name..' '..progress
end
-- J29 (1.5): at login, a few reminders about your other characters (from BackstageForever.lua).
function BackstageForeverRemind()
    if type(BackstageForeverReminderLines)~='function' then return 0 end
    local ok,lines=pcall(BackstageForeverReminderLines,nil,call(UnitGUID,'player'))
    if not ok or type(lines)~='table' then return 0 end
    for _,l in ipairs(lines) do say('Reminder: '..l) end
    return #lines
end
local PIN_HELP='Use /bf badges pin to see Compass goals, or /bf badges clear to remove your pin.'
local function badgePinFeedback(line)
    if type(BackstageForeverHUDRefreshBadge)~='function' then line=line..' Use /bf show to refresh the Compass.' end
    say(line)
end
local function badgePinCommand(args)
    if call(InCombatLockdown)~=false then return say('Compass badge changes wait until you leave combat.') end
    local d=store()
    if args=='clear' then
        d.pinnedBadge=nil
        refreshBadge()
        return badgePinFeedback('Cleared the Compass badge pin.')
    elseif args=='pin' then
        local f,count=liveBadgeFacts(),0
        for _,b in ipairs(BADGES) do
            if PIN_BADGES[b.id] and not pinCompleted(d,b) then
                local done,have,need=liveProgress(b,f)
                if done==false then
                    say(string.format('%s %d/%d. %s /bf badges pin %s',b.name,have,need,b.how,b.id))
                    count=count+1
                end
            end
        end
        if count==0 then say('No unfinished badge goals with available progress.') end
        return
    end
    local id=args:match('^pin%s+([%w-]+)$')
    if not id then return say(PIN_HELP) end
    local b=PIN_BADGES[id]
    if not b then return say('That badge cannot be pinned. Use /bf badges pin to see available goals.') end
    local f=liveBadgeFacts()
    local done,have,need=liveProgress(b,f)
    if done or pinCompleted(d,b) then return say(b.name..' is already at its goal; your pin was not changed.') end
    if done==nil then return say('Progress is unavailable for '..b.name..'; your pin was not changed.') end
    d.pinnedBadge=b.id
    refreshBadge()
    badgePinFeedback(pinnedLine(b,done,have,need)..'. '..b.how..' Clear with /bf badges clear.')
end
function BackstageForeverBadgesCommand(message)
    message=plain(message)
    local args=type(message)=='string' and message:lower():match('^badges%s+(.-)%s*$') or ''
    if args~='' and args~='all' then return badgePinCommand(args) end
    local list,earned=BackstageForeverBadgeList()
    BackstageForeverBadgeCheck(true)
    local wantAll=args=='all'
    say(string.format('%d of %d badges earned.',earned,#list))
    if wantAll then
        local groups,order={},{}
        for _,b in ipairs(list) do if b.earned then if not groups[b.group] then groups[b.group]={};order[#order+1]=b.group end;table.insert(groups[b.group],b.name) end end
        for _,g in ipairs(order) do say(g..': '..table.concat(groups[g],', ')) end
    end
    local upcoming,f,d={},liveBadgeFacts(),store()
    for _,b in ipairs(BADGES) do
        if PIN_BADGES[b.id] and not pinCompleted(d,b) then
            local done,have,need=liveProgress(b,f)
            if done==false and have>0 then upcoming[#upcoming+1]={name=b.name,how=b.how,have=have,need=need} end
        end
    end
    table.sort(upcoming,function(x,y) local a,c=x.have/x.need,y.have/y.need;if a~=c then return a>c end;return x.need<y.need end)
    for i=1,min(#upcoming,3) do local b=upcoming[i];say(string.format('Next: %s, %d / %d. %s',b.name,min(b.have,b.need),b.need,b.how)) end
    if not wantAll then say('Type /bf badges all for the full list; the app shows them all with dates in Characters > Badges.') end
    local pinned=BackstageForeverPinnedBadgeLine()
    if pinned then say(pinned) end
    say(PIN_HELP)
end

-- Quiet /played: chat windows briefly stop listening for the play-time message while our own
-- request is answered, then listen again. Blizzard's chat functions are never replaced (replacing
-- them taints the default UI and triggers "blocked from an action only available to the Blizzard UI").
local muted=nil
local function chatFrames()
    local list,n={},tonumber(plain(NUM_CHAT_WINDOWS)) or 10
    for i=1,n do local f=plain(_G and _G['ChatFrame'..i]) if type(f)=='table' then list[#list+1]=f end end
    return list
end
local function unmute()
    if not muted then return end
    for _,f in ipairs(muted) do if type(f.RegisterEvent)=='function' then pcall(f.RegisterEvent,f,'TIME_PLAYED_MSG') end end
    muted=nil
end
local function requestPlayed()
    if type(RequestTimePlayed)~='function' or muted then return end
    muted={}
    for _,f in ipairs(chatFrames()) do
        local listening=type(f.IsEventRegistered)=='function' and select(2,pcall(f.IsEventRegistered,f,'TIME_PLAYED_MSG'))
        if listening==true and type(f.UnregisterEvent)=='function' and pcall(f.UnregisterEvent,f,'TIME_PLAYED_MSG') then muted[#muted+1]=f end
    end
    -- Never leave chat deaf: listen again after a few seconds even if no answer comes.
    local timer=plain(C_Timer)
    if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,5,unmute) end
    if not pcall(RequestTimePlayed) then unmute() end
end

local function zoneNow()
    local mapApi=plain(C_Map)
    local mapId=int(call(field(mapApi,'GetBestMapForUnit'),'player'),1,2147483647)
    if not mapId then return nil end
    -- Count zones, not sub-maps: walk up to the zone level (type 3) when the API offers it.
    for _=1,4 do
        local info=call(field(mapApi,'GetMapInfo'),mapId)
        local kind=int(field(info,'mapType'),0,10)
        if not kind or kind<=3 then break end
        local parent=int(field(info,'parentMapID'),1,2147483647);if not parent then break end
        mapId=parent
    end
    return mapId
end
local function first(key)
    if BackstageForeverJournalFirst(key,now()) and type(BackstageForeverToast)=='function' then
        local words={dungeon='First dungeon!',flight='First flight!',mount='First ride on your own mount!',death='First death: it happens to everyone',rested='First rested bonus',group='First group adventure',hearth='First trip home by Hearthstone'}
        pcall(BackstageForeverToast,words[key] or 'A first!','A new badge waits in the Backstage Forever app.',nil,'first')
    end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_LEVEL_UP','PLAYER_MONEY','TIME_PLAYED_MSG','PLAYER_ENTERING_WORLD','ZONE_CHANGED_NEW_AREA','PLAYER_DEAD','PLAYER_CONTROL_LOST','PLAYER_MOUNT_DISPLAY_CHANGED','UPDATE_EXHAUSTION','GROUP_ROSTER_UPDATE','UNIT_SPELLCAST_SUCCEEDED','QUEST_DETAIL','QUEST_ACCEPTED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b,c)
            store()
            if event=='PLAYER_LOGIN' then
                eventLevel,eventLevelOwner=nil,nil
                local level=int(call(UnitLevel,'player'),1,1000)
                if level and #db.levels==0 then BackstageForeverJournalLevel(level,now()) end
                local pin=pinnedBadge();if pin then observePin(pin) end
                requestPlayed()
                local timer=plain(C_Timer);if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,20,function() pcall(BackstageForeverBadgeCheck);pcall(BackstageForeverRemind) end) end
            elseif event=='PLAYER_LEVEL_UP' then
                local level=int(a,1,1000)
                if level then
                    eventLevel=(eventLevelOwner==db and eventLevel and math.max(eventLevel,level)) or level
                    eventLevelOwner=db
                    BackstageForeverJournalLevel(level,now())
                end
                requestPlayed();pcall(BackstageForeverBadgeCheck);refreshBadge('level')
            elseif event=='PLAYER_MONEY' then refreshBadge('gold')
            elseif event=='TIME_PLAYED_MSG' then BackstageForeverJournalPlayed(a)
                local timer=plain(C_Timer);if type(timer)=='table' and type(timer.After)=='function' then pcall(timer.After,0,unmute) else unmute() end
            elseif event=='PLAYER_ENTERING_WORLD' or event=='ZONE_CHANGED_NEW_AREA' then
                local inside,kind=call(IsInInstance)
                if inside and (kind=='party' or kind=='raid') then first('dungeon') end
                local z=zoneNow()
                -- A zone visited for the first time is also a moment for the desktop app.
                if z and BackstageForeverJournalZone(z) then
                    if type(BackstageForeverMomentsZone)=='function' then pcall(BackstageForeverMomentsZone,z) end
                    refreshBadge('zones')
                end
            elseif event=='PLAYER_DEAD' then first('death')
            elseif event=='PLAYER_CONTROL_LOST' then if call(UnitOnTaxi,'player') then first('flight') end
            elseif event=='PLAYER_MOUNT_DISPLAY_CHANGED' then if call(IsMounted) then first('mount') end
            elseif event=='UPDATE_EXHAUSTION' then if call(GetXPExhaustion) then first('rested') end
            elseif event=='GROUP_ROSTER_UPDATE' then if call(IsInGroup) then first('group') end
            elseif event=='QUEST_DETAIL' then
                local guid=call(UnitGUID,'questnpc') or call(UnitGUID,'npc')
                local kind,id=nil,nil;if type(guid)=='string' then kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)') end
                pendingNpc=kind=='Creature' and tonumber(id) or nil
            elseif event=='QUEST_ACCEPTED' then
                local questId=int(b,1,2147483647) or int(a,1,2147483647)
                if b==nil then questId=int(a,1,2147483647) end
                local mapApi=plain(C_Map);local mapId=zoneNow()
                local pos=mapId and call(field(mapApi,'GetPlayerMapPosition'),mapId,'player')
                local x,y=nil,nil;if pos then local fx,fy=field(pos,'x'),field(pos,'y');if type(fx)=='number' then x,y=fx,fy else x,y=call(field(pos,'GetXY'),pos) end end
                if pendingNpc and questId then BackstageForeverJournalGiver(questId,pendingNpc,mapId,x,y,now()) end
                pendingNpc=nil
            elseif event=='UNIT_SPELLCAST_SUCCEEDED' then if a=='player' and (c==8690) then first('hearth') end end
        end)
    end
end

-- Backstage Forever moments: notable things that just happened in your game. A death (with
-- the death review), an elite, rare or boss kill, a profession milestone, a zone visited for
-- the first time, a new flight path and an equipped upgrade. Each one is handed to the live
-- strip (BackstageForeverLiveMoment) so the desktop app can show it, and kills and profession
-- milestones can also show a quiet in-game toast once you are out of combat (/bf moments).
-- Public API only. It reads and reports; it never acts in game, and it replaces no game function.
local floor,min,max=math.floor,math.min,math.max
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn) if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,14 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,14)
end
local function field(t,k)
    t=plain(t) if type(t)~='table' then return nil end
    local ok,v=pcall(function() return t[k] end) if ok then return plain(v) end
end
local function int(v,lo,hi) v=tonumber(plain(v)) if v and v==v and v>=lo and v<=hi then return floor(v) end end
local function str(v) v=plain(v) if type(v)=='string' and v~='' and #v<=80 then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end
local function now() return tonumber(call(GetTime)) or 0 end

-- Moment types on the strip (mirrored in src/core/moments.cjs). Parameters a (24-bit), b (16-bit), c (8-bit):
--  1 death       a killer NPC id (0 unknown), b killer level*256 + damage share %, c elite(1) + tip*2 + others*16
--  2 elite kill  a NPC id, b level (0 unknown), c classification
--  3 rare kill   a NPC id, b level, c classification
--  4 boss kill   a NPC id (0 unknown), b encounter id (0 unknown), c classification
--  5 profession  a skill line id, b new rank, c max rank / 5
--  6 new zone    a zone map id
--  7 flight path a zone map id where it was learned
--  8 upgrade     a item id, b score gain * 10, c inventory slot
local TYPES={death=1,elite=2,rare=3,boss=4,profession=5,zone=6,flight=7,upgrade=8}
local CLASS={elite=1,rare=2,rareelite=3,worldboss=4}
BackstageForeverMomentTypes=TYPES

local function settings()
    if type(BackstageForeverMomentsSettings)~='table' then BackstageForeverMomentsSettings={} end
    local s=BackstageForeverMomentsSettings
    if type(s.toasts)~='boolean' then s.toasts=true end
    return s
end

-- Pure helpers (exposed for tests).
-- Kind of moment for a kill, or nil: dungeon trash is elite, so inside instances only rares and
-- world bosses count (dungeon bosses come from ENCOUNTER_END).
function BackstageForeverMomentsKillType(cls,inInstance)
    if cls=='worldboss' then return TYPES.boss end
    if cls=='rare' or cls=='rareelite' then return TYPES.rare end
    if cls=='elite' and not inInstance then return TYPES.elite end
end
-- 'milestone' each time a rank reaches a multiple of 25, 'cap' on reaching the rank's maximum, else nil.
function BackstageForeverMomentsSkillStep(old,new,maxRank)
    old,new,maxRank=tonumber(old),tonumber(new),tonumber(maxRank)
    if not old or not new or new<=old then return nil end
    if maxRank and maxRank>0 and new>=maxRank then return 'cap' end
    if floor(new/25)>floor(old/25) then return 'milestone' end
end
-- Death review (BackstageForeverDeathReview) -> strip parameters a, b, c.
function BackstageForeverMomentsDeathParams(review)
    if type(review)~='table' then return 0,0,5*2 end
    local a=int(review.npc,1,16777215) or 0
    local level=min(255,int(review.level,0,1000000) or 0)
    local share=min(100,int(review.share,0,1000000) or 0)
    local tip=int(review.tipCode,1,7) or 5
    local others=min(7,int(review.others,0,1000) or 0)
    return a,level*256+share,(review.elite and 1 or 0)+tip*2+others*16
end
local TIERS={[75]='Journeyman',[150]='Expert',[225]='Artisan'}
-- In-game toast for a moment, or nil (deaths, zones, flights and upgrades have their own messages).
function BackstageForeverMomentsToastText(kind,info)
    info=type(info)=='table' and info or {}
    local name=str(info.name)
    if kind==TYPES.boss then return 'Boss defeated!',(name and (name..' has fallen.') or 'The boss has fallen.')..' Check the loot.' end
    if kind==TYPES.rare then return 'Rare defeated!',(name or 'A rare creature')..' is down. Rares often carry something special: check the loot.' end
    if kind==TYPES.elite then return 'Elite defeated',(name or 'An elite')..' is down. Nicely done.' end
    if kind==TYPES.profession then
        local skill,rank,top=str(info.skill) or 'Profession',tonumber(info.rank) or 0,tonumber(info.max) or 0
        if info.cap then
            local tier=TIERS[top]
            return ('%s %d'):format(skill,rank),tier and ('You reached the limit of this rank. Learn %s %s from a profession trainer to keep going.'):format(tier,skill) or ('%s mastered!'):format(skill)
        end
        return ('%s %d'):format(skill,rank),('Profession milestone. Next one at %d.'):format(min(top>0 and top or rank+25,rank+25))
    end
end

-- Toasts wait while you are in combat and are shown one at a time afterwards.
local queue={}
local function inCombat() return call(InCombatLockdown)==true end
local function flush()
    if inCombat() or #queue==0 then return end
    local t=table.remove(queue,1)
    if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,t[1],t[2]) end
    if #queue>0 then
        local timer=plain(C_Timer)
        if type(field(timer,'After'))=='function' then pcall(timer.After,4,function() pcall(flush) end) end
    end
end
-- Records a moment on the strip and queues its toast. Returns the strip sequence number.
local function push(kind,a,b,c,info)
    local seq
    if type(BackstageForeverLiveMoment)=='function' then local ok,s=pcall(BackstageForeverLiveMoment,kind,a,b,c) if ok then seq=s end end
    local title,sub=BackstageForeverMomentsToastText(kind,info)
    if title and settings().toasts then
        queue[#queue+1]={title,sub}
        while #queue>5 do table.remove(queue,1) end
        flush()
    end
    return seq
end
BackstageForeverMomentsPush=push

-- Called by BackstageForeverCombat.lua after a death (review may be nil: no recent hits).
function BackstageForeverMomentsDeath(review)
    local a,b,c=BackstageForeverMomentsDeathParams(review)
    return push(TYPES.death,a,b,c)
end
-- Called by BackstageForeverJournal.lua for a zone visited for the first time.
function BackstageForeverMomentsZone(mapId)
    mapId=int(mapId,1,16777215)
    if mapId then return push(TYPES.zone,mapId,0,0) end
end

-- Kills: creatures you or your pet fought (hit or were hit by) that then died. Classification
-- comes from the target, mouseover and nameplates seen before the kill.
local me,pet
local seen,seenCount={},0         -- guid -> {cls, level, name, t}
local credited,creditedCount={},0 -- guid -> time its kill was counted (once per creature)
local lastCombat=nil               -- GetTime() when the player was last in combat
local lastKill,lastBossAt=nil,nil
local function npcOf(guid)
    if type(guid)~='string' then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)')
    if kind=='Creature' or kind=='Vehicle' then return tonumber(id) end
end
local function prune(t,count,age)
    if count<=250 then return count end
    local cut,n=now()-age,0
    for k,v in pairs(t) do if (type(v)=='table' and v.t or v)<cut then t[k]=nil else n=n+1 end end
    if n>250 then for k in pairs(t) do t[k]=nil end n=0 end
    return n
end
local function remember(unit)
    local guid=call(UnitGUID,unit)
    if not npcOf(guid) or call(UnitIsPlayer,unit) then return end
    local cls=call(UnitClassification,unit)
    if not seen[guid] then seenCount=seenCount+1 end
    seen[guid]={cls=type(cls)=='string' and cls or nil,level=int(call(UnitLevel,unit),1,255),name=str(call(UnitName,unit)),t=now()}
    seenCount=prune(seen,seenCount,600)
end
local function killed(guid,name)
    local npc=npcOf(guid)
    if not npc then return end
    local info=seen[guid] or {}
    local inside=call(IsInInstance)==true
    lastKill={npc=npc,at=now(),cls=info.cls}
    local kind=BackstageForeverMomentsKillType(info.cls,inside)
    if not kind then return end
    if kind==TYPES.boss then lastBossAt=now() end
    push(kind,npc,info.level or 0,CLASS[info.cls] or 0,{name=info.name or str(name)})
end
-- Kills come from your target: the game no longer lets addons read the combat log (registering it
-- raises "blocked from an action only available to the Blizzard UI"). A creature counts when your
-- target dies, you have the kill credit (not tapped by someone else) and you were just fighting.
local function onTargetHealth()
    local guid=call(UnitGUID,'target')
    if not npcOf(guid) or credited[guid] or call(UnitIsPlayer,'target') then return end
    if call(UnitIsDead,'target')~=true or call(UnitIsTapDenied,'target')==true then return end
    if not (call(InCombatLockdown)==true or (lastCombat and now()-lastCombat<=10)) then return end
    if not credited[guid] then creditedCount=creditedCount+1 end
    credited[guid]=now();creditedCount=prune(credited,creditedCount,600)
    remember('target')
    killed(guid,call(UnitName,'target'))
end
-- A dungeon or raid boss: ENCOUNTER_END reports the win; the creature that died just before is the boss.
local function onEncounterEnd(encounterId,name,_,_,success)
    if not (plain(success)==1 or plain(success)==true) then return end
    if lastBossAt and now()-lastBossAt<10 then return end
    lastBossAt=now()
    local recent=lastKill and now()-lastKill.at<=6 and lastKill or nil
    push(TYPES.boss,recent and recent.npc or 0,int(encounterId,0,65535) or 0,recent and CLASS[recent.cls] or 0,{name=str(name)})
end

-- Professions: a moment at every 25 points and on reaching the rank's maximum.
local PROFESSIONS={[129]='First Aid',[164]='Blacksmithing',[165]='Leatherworking',[171]='Alchemy',[182]='Herbalism',[185]='Cooking',[186]='Mining',[197]='Tailoring',[202]='Engineering',[333]='Enchanting',[356]='Fishing',[393]='Skinning'}
local BY_NAME={}
for id,name in pairs(PROFESSIONS) do BY_NAME[name]=id end
local ranks=nil
local function skills()
    local out={}
    local api=plain(C_SkillInfo)
    local count=int(call(field(api,'GetNumSkillLines')),0,200)
    if count and type(field(api,'GetSkillLineInfo'))=='function' then
        for i=1,count do
            local info=call(api.GetSkillLineInfo,i)
            local id=int(field(info,'skillID'),1,65535)
            if id and PROFESSIONS[id] and field(info,'isHeader')~=true then
                local rank,top=int(field(info,'rank'),0,10000),int(field(info,'maxRank'),0,10000)
                if rank and top then out[#out+1]={id=id,rank=rank,max=top,name=str(field(info,'name')) or PROFESSIONS[id]} end
            end
        end
        return out
    end
    -- Older clients: GetSkillLineInfo(i) -> name, isHeader, isExpanded, rank, temp, modifier, maxRank.
    count=int(call(GetNumSkillLines),0,200) or 0
    for i=1,count do
        local name,header,_,rank,_,_,top=call(GetSkillLineInfo,i)
        local id=type(name)=='string' and BY_NAME[name]
        rank,top=int(rank,0,10000),int(top,0,10000)
        if id and not header and rank and top then out[#out+1]={id=id,rank=rank,max=top,name=name} end
    end
    return out
end
local function onSkills()
    local list=skills()
    if not ranks then ranks={} for _,s in ipairs(list) do ranks[s.id]=s.rank end return end
    for _,s in ipairs(list) do
        local step=BackstageForeverMomentsSkillStep(ranks[s.id],s.rank,s.max)
        ranks[s.id]=s.rank
        if step then push(TYPES.profession,s.id,s.rank,min(255,floor(s.max/5)),{skill=s.name,rank=s.rank,max=s.max,cap=step=='cap'}) end
    end
end

-- Zone for the flight path moment (walks sub-maps up to their zone, like the journal does).
local function zoneNow()
    local mapApi=plain(C_Map)
    local mapId=int(call(field(mapApi,'GetBestMapForUnit'),'player'),1,16777215)
    if not mapId then return nil end
    for _=1,4 do
        local info=call(field(mapApi,'GetMapInfo'),mapId)
        local kind=int(field(info,'mapType'),0,10)
        if not kind or kind<=3 then break end
        local parent=int(field(info,'parentMapID'),1,16777215) if not parent then break end
        mapId=parent
    end
    return mapId
end
local function onInfoMessage(a,b)
    local want=plain(ERR_NEWTAXIPATH)
    if type(want)~='string' or (plain(a)~=want and plain(b)~=want) then return end
    push(TYPES.flight,zoneNow() or 0,0,0)
end

-- Equipped upgrades, scored with the same weights as the gear helper (BackstageForeverGear).
local links={}
local function linkAt(slot) local l=call(GetInventoryItemLink,'player',slot) return type(l)=='string' and l or nil end
local function snapshotGear() for slot=1,19 do links[slot]=linkAt(slot) end end
-- Pure-ish: gain from replacing old with new (nil when either is unknown or the new one is not usable).
function BackstageForeverMomentsUpgradeGain(newItem,oldItem,ctx)
    local G=plain(BackstageForeverGear)
    if type(G)~='table' or type(G.score)~='function' or type(newItem)~='table' or newItem.unknown then return nil end
    local ok,mine=pcall(G.score,newItem,ctx)
    if not ok or type(mine)~='table' or not mine.usable then return nil end
    local theirs=0
    if oldItem~=nil then
        if type(oldItem)~='table' or oldItem.unknown then return nil end
        local ok2,s=pcall(G.score,oldItem,ctx)
        if not ok2 or type(s)~='table' then return nil end
        theirs=s.score
    end
    return mine.score-theirs
end
local function onEquipment(slot)
    slot=int(slot,1,19)
    if not slot then return end
    local old,new=links[slot],linkAt(slot)
    links[slot]=new
    if not new or new==old then return end
    -- Moving or swapping rings, trinkets or weapons between slots is not an upgrade.
    for s=1,19 do if s~=slot and (links[s]==new or (old and links[s]==old)) then return end end
    local G=plain(BackstageForeverGear)
    if type(G)~='table' or type(G.item)~='function' then return end
    local okN,newItem=pcall(G.item,new)
    local oldItem=nil
    if old then local okO,o=pcall(G.item,old) oldItem=okO and o or {unknown=true} end
    local ctx=type(G.context)=='function' and select(2,pcall(G.context)) or {}
    local gain=okN and BackstageForeverMomentsUpgradeGain(newItem,oldItem,ctx)
    if gain and gain>=1 and int(newItem.id,1,16777215) then push(TYPES.upgrade,newItem.id,min(65535,floor(gain*10+.5)),slot) end
end

-- /bf moments [on|off|status]: in-game toasts for kills and profession milestones.
function BackstageForeverMomentsCommand(message)
    local arg=(type(message)=='string' and message:lower() or ''):match('^moments%s*(%a*)') or ''
    local s=settings()
    if arg=='status' then
        return say(('Moment toasts are %s. The desktop app shows every moment either way; turn its moments off in Settings there.'):format(s.toasts and 'on' or 'off'))
    end
    if arg=='on' then s.toasts=true elseif arg=='off' then s.toasts=false elseif arg=='' then s.toasts=not s.toasts
    else return say('Use /bf moments on, /bf moments off or /bf moments status.') end
    say(s.toasts and 'Moment toasts on: elite, rare and boss kills and profession milestones get a short message after combat.' or 'Moment toasts off. The desktop app still shows your moments.')
    return s.toasts
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_ENTERING_WORLD','UNIT_HEALTH','PLAYER_REGEN_DISABLED','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT','NAME_PLATE_UNIT_ADDED','UNIT_PET','ENCOUNTER_END','SKILL_LINES_CHANGED','CHAT_MSG_SKILL','UI_INFO_MESSAGE','PLAYER_EQUIPMENT_CHANGED','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b,c,d,e)
            if event=='UNIT_HEALTH' then if plain(a)=='target' then pcall(onTargetHealth) end
            elseif event=='PLAYER_REGEN_DISABLED' then lastCombat=now()
            elseif event=='PLAYER_TARGET_CHANGED' then remember('target')
            elseif event=='UPDATE_MOUSEOVER_UNIT' then remember('mouseover')
            elseif event=='NAME_PLATE_UNIT_ADDED' then if type(plain(a))=='string' then remember(a) end
            elseif event=='ENCOUNTER_END' then pcall(onEncounterEnd,a,b,c,d,e)
            elseif event=='SKILL_LINES_CHANGED' or event=='CHAT_MSG_SKILL' then pcall(onSkills)
            elseif event=='UI_INFO_MESSAGE' then pcall(onInfoMessage,a,b)
            elseif event=='PLAYER_EQUIPMENT_CHANGED' then pcall(onEquipment,a)
            elseif event=='PLAYER_REGEN_ENABLED' then lastCombat=now() pcall(onTargetHealth) pcall(flush)
            elseif event=='UNIT_PET' then if plain(a)=='player' then pet=call(UnitGUID,'pet') end
            elseif event=='PLAYER_LOGIN' or event=='PLAYER_ENTERING_WORLD' then
                settings() me=call(UnitGUID,'player') pet=call(UnitGUID,'pet')
                if not ranks then pcall(onSkills) end
                pcall(snapshotGear)
            end
        end)
    end
end

-- Class kits and the ready check (1.23): two things said in chat, never a frame.
--   /bf kit     what your class carries: shards, runes, powders, poisons, ammo, totems, candles, seeds
--   /bf ready   before a pull: a class buff you know but do not have, no food buff, a reagent running low
-- The ready check also speaks once by itself when you walk into a dungeon or raid, outside combat.
-- Public API only, every game call guarded. Buffs are read outside combat only and never cast,
-- nothing is bought, used or moved.
-- Item and spell ids were checked by name against the game's own data on build 1.60.1.71037.
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
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local function combat() return call(InCombatLockdown)==true end

-- ---------------------------------------------------------------- data
-- One row per thing a class carries. items: one id, or several counted together. low: fewer than
-- this is "low". spells: the row matters once you know one of them; level: used when no spell
-- decides it. quiet: shown by /bf kit, never in the dungeon warning.
local KITS={
    WARLOCK={
        {label='Soul Shard',items={6265},low=3,level=10},
        {label='Infernal Stone',items={5565},low=1,spells={1122},quiet=true},
        {label='Demonic Figurine',items={16583},low=1,spells={18540},quiet=true},
    },
    MAGE={
        {label='Rune of Teleportation',items={17031},low=2,spells={3561,3562,3563,3565,3566,3567},quiet=true},
        {label='Rune of Portals',items={17032},low=2,spells={10059,11416,11417,11418,11419,11420},quiet=true},
        {label='Arcane Powder',items={17020},low=2,spells={23028}},
        {label='Light Feather',items={17056},low=1,spells={130},quiet=true},
    },
    ROGUE={
        {label='Poisons',group=true,items={6947,6949,6950,8926,8927,8928,2892,2893,8984,8985,20844,3775,3776,5237,6951,9186,10918,10920,10921,10922},low=2,level=20},
        {label='Flash Powder',items={5140},low=2,spells={1856}},
        {label='Blinding Powder',items={5530},low=2,spells={2094},quiet=true},
        {label="Thieves' Tools",items={5060},low=1,spells={1804},quiet=true},
    },
    SHAMAN={
        {label='Ankh',items={17030},low=2,spells={20608}},
    },
    PALADIN={
        {label='Symbol of Kings',items={21177},low=10,spells={25782,25894,25898}},
        {label='Symbol of Divinity',items={17033},low=1,spells={19752},quiet=true},
    },
    PRIEST={
        {label='Candles',group=true,items={17028,17029},low=2,spells={21562,21564,27681,27683}},
        {label='Light Feather',items={17056},low=1,spells={1706},quiet=true},
    },
    DRUID={
        {label='Rebirth seeds',group=true,items={17034,17035,17036,17037,17038},low=1,spells={20484}},
        {label='Gift of the Wild reagents',group=true,items={17021,17026},low=2,spells={21849,21850}},
    },
}
-- Shaman totems: carried or not. They are quest rewards, so a missing one is named, not counted.
local TOTEMS={{5175,'Earth Totem'},{5176,'Fire Totem'},{5177,'Water Totem'},{5178,'Air Totem'}}
-- Mage: every rank of the two conjure spells, lowest first.
local CONJURE={{587,597,990,6129,10144,10145,28612},{5504,5505,5506,6127,10138,10139,10140}}
-- Long class buffs. need: you know one of these (the last one you know names the buff);
-- have: the buff counts as up when an aura carries the name of any of these.
local BUFFS={
    MAGE={{need={1459},have={1459,23028}},{need={168,7302,6117},have={168,7302,6117}}},
    PRIEST={{need={1243},have={1243,21562}},{need={588},have={588}}},
    DRUID={{need={1126},have={1126,21849}}},
    WARLOCK={{need={687,706},have={687,706}}},
    SHAMAN={{need={324},have={324}}},
    HUNTER={{need={5118,13159,13161,20043,13163,13165},have={5118,13159,13161,20043,13163,13165}}},
}
-- Paladin blessings are left out: three of them could not be confirmed in the game data, and
-- without them a paladin under one of those would be told a blessing is missing.
local WELL_FED=19705
local LOW_AMMO=200
BackstageForeverKitData={kits=KITS,totems=TOTEMS,conjure=CONJURE,buffs=BUFFS,wellFed=WELL_FED}

-- ---------------------------------------------------------------- switch
function BackstageForeverKitEnabled()
    local s=BackstageForeverKitSettings
    return type(s)~='table' or rawget(s,'ready')~=false
end
local function setEnabled(on)
    if type(BackstageForeverKitSettings)~='table' then BackstageForeverKitSettings={} end
    BackstageForeverKitSettings.ready=on
    say(on and 'Ready check at dungeons: on.' or 'Ready check at dungeons: off. /bf ready still answers.')
    return on
end

-- ---------------------------------------------------------------- pure
-- Pure. counts = {[itemId]=n}; known = {[spellId]=true}, or nil when the game does not say which
-- spells you know. -> rows {label, count, low, quiet, items} for what this class carries.
function BackstageForeverKitRows(class,level,counts,known)
    local rows={}
    level=type(level)=='number' and level or 1
    counts=type(counts)=='table' and counts or {}
    for _,entry in ipairs(KITS[class] or {}) do
        local count=0
        for _,id in ipairs(entry.items) do count=count+(tonumber(counts[id]) or 0) end
        local relevant
        if entry.spells and type(known)=='table' then
            relevant=false
            for _,id in ipairs(entry.spells) do if known[id] then relevant=true end end
        elseif entry.spells then relevant=false
        else relevant=level>=(entry.level or 1) end
        if relevant or count>0 then
            rows[#rows+1]={label=entry.label,count=count,low=relevant and count<entry.low,quiet=entry.quiet==true,group=entry.group==true,item=entry.items[1]}
        end
    end
    return rows
end
-- Pure: the highest rank known, 0 for none, nil when unknown. ranks = spell ids, lowest first.
function BackstageForeverBestRank(ranks,known)
    if type(ranks)~='table' or type(known)~='table' then return nil end
    local best=0
    for i,id in ipairs(ranks) do if known[id] then best=i end end
    return best
end
-- Pure: class buffs you know but do not have. names = {[spellId]=the game's own name};
-- auras = {[name]=true} for the buffs on you. -> list of names, in table order.
function BackstageForeverMissingBuffs(class,known,names,auras)
    local missing={}
    if type(known)~='table' or type(names)~='table' or type(auras)~='table' then return missing end
    for _,group in ipairs(BUFFS[class] or {}) do
        local best
        for _,id in ipairs(group.need) do if known[id] and type(names[id])=='string' then best=names[id] end end
        if best then
            local up=false
            for _,id in ipairs(group.have) do if names[id] and auras[names[id]] then up=true end end
            if not up then missing[#missing+1]=best end
        end
    end
    return missing
end
local function listed(rows,quietToo)
    local parts={}
    for _,row in ipairs(rows) do
        if quietToo or (row.low and not row.quiet) then
            parts[#parts+1]=('%s %d'):format(row.name or T(row.label),row.count)..((quietToo and row.low) and (' ('..T('low')..')') or '')
        end
    end
    return parts
end
-- Pure: the one line for /bf kit. kit = {class, rows, ammo, ammoLow, pet (1..3), totems={have={},missing={}},
-- conjure={{name,rank},...}}. Names are the game's own when the caller filled them in.
function BackstageForeverKitLine(kit)
    if type(kit)~='table' then return T('Your class is not readable in this game client.') end
    local parts=listed(kit.rows or {},true)
    if kit.ammo then table.insert(parts,1,('%s %d'):format(T('Ammo'),kit.ammo)..(kit.ammoLow and (' ('..T('low')..')') or '')) end
    local sentences={}
    if #parts>0 then sentences[#sentences+1]=T('Your kit:')..' '..table.concat(parts,', ')..'.' end
    local totems=kit.totems
    if type(totems)=='table' then
        if #totems.have>0 then sentences[#sentences+1]=T('Totems carried:')..' '..table.concat(totems.have,', ')..'.' end
        if #totems.missing>0 then sentences[#sentences+1]=T('Totems not carried:')..' '..table.concat(totems.missing,', ')..'.' end
    end
    for _,spell in ipairs(kit.conjure or {}) do
        if type(spell)=='table' and spell.name and (spell.rank or 0)>0 then sentences[#sentences+1]=T(('%s: rank %d is your best.'):format(spell.name,spell.rank)) end
    end
    if kit.pet==1 then sentences[#sentences+1]=T('Your pet is unhappy: feed it before you head out.')
    elseif kit.pet==2 then sentences[#sentences+1]=T('Your pet is content.')
    elseif kit.pet==3 then sentences[#sentences+1]=T('Your pet is happy.') end
    if #sentences==0 then return T('Your class carries nothing the addon counts yet.') end
    return table.concat(sentences,' ')
end
-- Pure: the one ready line, or nil when there is nothing to say and nobody asked.
-- state = {buffs = list of missing buff names, or nil when buffs are not readable; food = true
-- (buff is up), false (not up) or nil (not readable); rows = kit rows; ammo, ammoLow; asked}.
function BackstageForeverReadyLine(state)
    if type(state)~='table' then return nil end
    local parts={}
    if type(state.buffs)=='table' and #state.buffs>0 then parts[#parts+1]=T(('missing %s'):format(table.concat(state.buffs,', '))) end
    if state.food==false then parts[#parts+1]=T('no food buff') end
    local low=listed(state.rows or {},false)
    if state.ammoLow and state.ammo then table.insert(low,1,('%s %d'):format(T('Ammo'),state.ammo)) end
    if #low>0 then parts[#parts+1]=T(('low: %s'):format(table.concat(low,', '))) end
    local unread=state.buffs==nil and (' '..T('Your buffs are not readable right now, so they were not checked.')) or ''
    if #parts>0 then return T('Before you pull:')..' '..table.concat(parts,'; ')..'.'..(state.asked and unread or '') end
    if not state.asked then return nil end
    return T('Ready: nothing is missing that the addon can check.')..unread
end
-- Pure: is this a place the ready check speaks in? kind is the game's instance type.
function BackstageForeverReadyPlace(inside,kind)
    return inside==true and (kind=='party' or kind=='raid')
end

-- ---------------------------------------------------------------- game reads
local function spellName(id)
    local info=call(field(plain(C_Spell),'GetSpellInfo'),id)
    local name=label(field(info,'name'),60)
    if name then return name end
    return label((call(GetSpellInfo,id)),60)
end
local function knownExact(id)
    if call(IsPlayerSpell,id)==true or call(IsSpellKnown,id)==true then return true end
    return call(field(plain(C_SpellBook),'IsSpellKnown'),id)==true
end
-- The game answers "do you know this spell" in more than one way across versions; nil when none answers.
local function canAskKnown()
    return type(plain(IsPlayerSpell))=='function' or type(plain(IsSpellKnown))=='function' or type(field(plain(C_SpellBook),'IsSpellKnown'))=='function'
end
local function knownSet(ids)
    if not canAskKnown() then return nil end
    local known={}
    for _,id in ipairs(ids) do if knownExact(id) then known[id]=true end end
    return known
end
local function itemCount(id)
    local n=num(call(field(plain(C_Item),'GetItemCount'),id),0,1000000)
    if n then return n end
    return num(call(GetItemCount,id),0,1000000) or 0
end
local function itemName(id,fallback)
    local name=call(field(plain(C_Item),'GetItemInfo'),id)
    if type(name)~='string' then name=call(GetItemInfo,id) end
    return label(name,60) or T(fallback)
end
-- The names of the buffs on you, or nil when they cannot be read (in combat, or a hidden value).
local function auraNames()
    if combat() then return nil end
    local names,read={},false
    local byIndex=field(plain(C_UnitAuras),'GetAuraDataByIndex')
    if type(byIndex)=='function' then
        for i=1,40 do
            local ok,info=pcall(byIndex,'player',i,'HELPFUL')
            if not ok then return nil end
            if info==nil then read=true break end
            local name=label(field(info,'name'),80)
            if not name then return nil end
            names[name]=true
            if i==40 then read=true end
        end
        if read then return names end
    end
    local old=plain(UnitBuff) or plain(UnitAura)
    if type(old)~='function' then return nil end
    for i=1,40 do
        local ok,name=pcall(old,'player',i,'HELPFUL')
        if not ok then return nil end
        if name==nil then break end
        name=label(name,80)
        if not name then return nil end
        names[name]=true
    end
    return names
end
local function classToken()
    local _,token=call(UnitClass,'player')
    return type(token)=='string' and token or nil
end
local function spellIds(class)
    local ids={}
    for _,entry in ipairs(KITS[class] or {}) do for _,id in ipairs(entry.spells or {}) do ids[#ids+1]=id end end
    for _,group in ipairs(BUFFS[class] or {}) do for _,id in ipairs(group.need) do ids[#ids+1]=id end end
    if class=='MAGE' then for _,ranks in ipairs(CONJURE) do for _,id in ipairs(ranks) do ids[#ids+1]=id end end end
    return ids
end
-- Everything read once: class, level, kit rows with the game's own item names, ammo, pet.
local function readKit()
    local class=classToken()
    if not class then return nil end
    local level=num(call(UnitLevel,'player'),1,1000) or 1
    local known=knownSet(spellIds(class))
    local counts={}
    for _,entry in ipairs(KITS[class] or {}) do for _,id in ipairs(entry.items) do counts[id]=itemCount(id) end end
    local kit={class=class,level=level,known=known,rows=BackstageForeverKitRows(class,level,counts,known)}
    for _,row in ipairs(kit.rows) do if not row.group then row.name=itemName(row.item,row.label) end end
    if class=='HUNTER' then
        local slot=num(call(GetInventorySlotInfo,'AmmoSlot'),0,100)
        if slot then
            -- An empty ammo slot still answers 1 in some clients, so the item itself is asked for first.
            local loaded=call(GetInventoryItemID,'player',slot)
            kit.ammo=loaded and num(call(GetInventoryItemCount,'player',slot),0,100000) or 0
            kit.ammoLow=kit.ammo<LOW_AMMO
        end
        if call(UnitExists,'pet')==true then kit.pet=num(call(GetPetHappiness),1,3) end
    elseif class=='SHAMAN' then
        kit.totems={have={},missing={}}
        for _,totem in ipairs(TOTEMS) do
            local list=itemCount(totem[1])>0 and kit.totems.have or kit.totems.missing
            list[#list+1]=itemName(totem[1],totem[2])
        end
    elseif class=='MAGE' and known then
        kit.conjure={}
        for _,ranks in ipairs(CONJURE) do
            kit.conjure[#kit.conjure+1]={name=spellName(ranks[1]),rank=BackstageForeverBestRank(ranks,known)}
        end
    end
    return kit
end
local function readReady(asked)
    local kit=readKit()
    if not kit then return nil end
    local state={rows=kit.rows,ammo=kit.ammo,ammoLow=kit.ammoLow,asked=asked}
    local auras=auraNames()
    if auras then
        local names={}
        for _,group in ipairs(BUFFS[kit.class] or {}) do
            for _,id in ipairs(group.need) do names[id]=names[id] or spellName(id) end
            for _,id in ipairs(group.have) do names[id]=names[id] or spellName(id) end
        end
        -- Without the list of known spells nothing is called missing.
        state.buffs=kit.known and BackstageForeverMissingBuffs(kit.class,kit.known,names,auras) or {}
        -- "Well Fed" by the game's own name for it, so it works in any language.
        local fed=spellName(WELL_FED)
        if fed then state.food=auras[fed]==true end
    end
    return state
end

-- How many things your class carries are running low (ammo counts as one), for the party
-- readiness check. A number only: no names leave this file. nil when your class is not readable.
function BackstageForeverKitLowCount()
    local ok,kit=pcall(readKit)
    if not ok or type(kit)~='table' then return nil end
    local low=kit.ammoLow and 1 or 0
    for _,row in ipairs(kit.rows or {}) do if row.low and not row.quiet then low=low+1 end end
    return low
end

-- ---------------------------------------------------------------- commands
function BackstageForeverKitCommand()
    if combat() then return say('Try /bf kit outside combat.') end
    local ok,kit=pcall(readKit)
    say(BackstageForeverKitLine(ok and kit or nil))
end
function BackstageForeverReadyCommand(message)
    local arg=type(message)=='string' and #message<=40 and message:lower():match('^ready%s+(%a+)') or nil
    if arg=='on' or arg=='off' then return setEnabled(arg=='on') end
    if combat() then return say('Try /bf ready outside combat.') end
    local ok,state=pcall(readReady,true)
    say(ok and BackstageForeverReadyLine(state) or 'Your class is not readable in this game client.')
end

-- ---------------------------------------------------------------- the dungeon door
local wasInside,pending=nil,false
local function speak()
    pending=false
    if not BackstageForeverKitEnabled() then return end
    if combat() then pending=true;return end
    local ok,state=pcall(readReady,false)
    local line=ok and BackstageForeverReadyLine(state)
    if line then say(line) end
end
local function onWorld(reloading)
    local inside,kind=call(IsInInstance)
    local here=BackstageForeverReadyPlace(inside,kind)
    local entered=here and wasInside~=true
    wasInside=here
    -- A /reload inside the dungeon is not walking in.
    if entered and reloading~=true then speak() elseif not here then pending=false end
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_ENTERING_WORLD','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,_,reloading)
            if event=='PLAYER_ENTERING_WORLD' then pcall(onWorld,plain(reloading))
            elseif pending then pcall(speak) end
        end)
    end
end

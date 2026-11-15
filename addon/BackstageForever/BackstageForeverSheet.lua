-- Character sheet and gear sets (0.36). Two parts, both read-only until the player asks:
--  * Stats: the character's base stats, armor, attack power and resistances, read with public
--    Unit* functions whenever the addon saves, for the desktop app's Characters -> Sheet page.
--  * Gear sets: /bf set save|wear|list|delete NAME. Save remembers the item id in each equipment
--    slot (per character, in BackstageForeverSheetDB). Wear equips the saved items that are in
--    your bags with EquipItemByName, only when you type the command and never in combat. Nothing
--    here runs by itself, replaces a Blizzard function or touches the bank, mail or vendors.
local floor=math.floor
local unpacked=unpack or table.unpack
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
    for i=2,12 do r[i]=plain(r[i]) end
    return unpacked(r,2,12)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function int(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return floor(v) end end
local function str(v,limit)
    v=plain(v)
    if type(v)~='string' or #v==0 or #v>(limit or 100) or v:find('[%z\1-\31\127]') then return nil end
    return v
end
local function now() return int(call(time),0,253402300799) end
local function say(message)
    local chat=plain(DEFAULT_CHAT_FRAME);local add=field(chat,'AddMessage')
    if type(add)=='function' then pcall(add,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(message)) end
end
local function request()
    if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
end

local SLOTS={'Head','Neck','Shoulder','Shirt','Chest','Waist','Legs','Feet','Wrist','Hands','Ring 1','Ring 2','Trinket 1','Trinket 2','Back','Main hand','Off hand','Ranged','Tabard'}
-- Rings, trinkets and weapons can sit in either slot of a pair.
local PAIR={[11]=12,[12]=11,[13]=14,[14]=13,[16]=17,[17]=16}
local MAX_SETS=20

local function store()
    if type(BackstageForeverSheetDB)~='table' then BackstageForeverSheetDB={} end
    local db=BackstageForeverSheetDB
    if type(db.sets)~='table' then db.sets={} end
    return db
end
local function itemName(id)
    local name=call(field(plain(C_Item),'GetItemInfo'),id)
    if not name then name=call(GetItemInfo,id) end
    return str(name,100)
end
local function worn(slot)
    return int(call(GetInventoryItemID,'player',slot),1,2147483647)
end
-- Item id -> how many sit in the backpack and the four bags (never the bank).
local function bagCounts()
    local counts={}
    local api=plain(C_Container)
    local slotsOf=field(api,'GetContainerNumSlots') or plain(GetContainerNumSlots)
    local infoOf=field(api,'GetContainerItemInfo')
    local legacy=plain(GetContainerItemLink)
    if type(slotsOf)~='function' then return counts end
    for bag=0,4 do
        for slot=1,int(call(slotsOf,bag),0,64) or 0 do
            local id
            if type(infoOf)=='function' then
                local info=call(infoOf,bag,slot)
                id=int(field(info,'itemID'),1,2147483647)
            elseif type(legacy)=='function' then
                local link=str(call(legacy,bag,slot),600)
                id=link and int(tonumber(link:match('item:(%d+)')),1,2147483647)
            end
            if id then counts[id]=(counts[id] or 0)+1 end
        end
    end
    return counts
end
-- "  Leveling gear " -> "Leveling gear", "leveling gear"; nil when the name is unusable.
local function setName(raw)
    if type(raw)~='string' then return nil end
    local name=raw:gsub('^%s+',''):gsub('%s+$',''):gsub('%s+',' ')
    if #name<1 or #name>24 or name:find("[^%w %-_']") then return nil end
    return name,name:lower()
end
local function countOf(set)
    local n=0;for _ in pairs(set.slots) do n=n+1 end;return n
end

-- Base stats for the app's character sheet. nil when the game gave nothing usable.
function BackstageForeverSheetStats()
    local out={schemaVersion=1}
    local any=false
    for i,key in ipairs({'strength','agility','stamina','intellect','spirit'}) do
        local _,effective=call(UnitStat,'player',i)
        effective=int(effective,0,100000)
        if effective then out[key]=effective;any=true end
    end
    local _,armor=call(UnitArmor,'player')
    armor=int(armor,0,1000000);if armor then out.armor=armor;any=true end
    for key,fn in pairs({attackPower=UnitAttackPower,rangedAttackPower=UnitRangedAttackPower}) do
        local base,pos,neg=call(fn,'player')
        base=int(base,0,1000000)
        if base then out[key]=math.max(0,base+(int(pos,0,1000000) or 0)+(int(neg,-1000000,0) or 0));any=true end
    end
    local resist={}
    for i,key in ipairs({'holy','fire','nature','frost','shadow','arcane'}) do
        local _,total=call(UnitResistance,'player',i)
        total=int(total,0,10000);if total then resist[key]=total end
    end
    if next(resist) then out.resist=resist;any=true end
    local health=int(call(UnitHealthMax,'player'),1,10000000);if health then out.health=health;any=true end
    local _,token=call(UnitPowerType,'player')
    token=type(token)=='string' and token:lower() or nil
    if token=='mana' or token=='rage' or token=='energy' or token=='focus' then
        local power=int(call(UnitPowerMax,'player'),0,10000000)
        if power then out.power=power;out.powerKind=token end
    end
    local at=now()
    if not any or not at then return nil end
    out.seenAt=at
    return out
end

-- Export block: every saved set with its items per slot. BackstageForever.lua marks the lists.
function BackstageForeverSheetSets()
    local db=store()
    local sets={}
    for key,set in pairs(db.sets) do
        if type(set)=='table' and type(set.slots)=='table' and setName(set.name) then
            local items={}
            for slot=1,19 do
                local id=int(set.slots[slot],1,2147483647)
                if id then items[#items+1]={slot=slot,itemId=id,name=type(set.names)=='table' and str(set.names[slot],100) or nil} end
            end
            if #items>0 then sets[#sets+1]={name=set.name,savedAt=int(set.savedAt,0,253402300799) or 0,items=items} end
        end
    end
    table.sort(sets,function(a,b)return a.name:lower()<b.name:lower()end)
    return {schemaVersion=1,sets=sets}
end

local USAGE='Use /bf set save NAME, /bf set wear NAME, /bf set list or /bf set delete NAME.'
local function save(name,key)
    local db=store()
    local existing=db.sets[key]
    if not existing then
        local n=0;for _ in pairs(db.sets) do n=n+1 end
        if n>=MAX_SETS then say(('You have %d sets, the most the addon keeps. Delete one first (/bf set delete NAME).'):format(MAX_SETS));return nil end
    end
    local slots,names,count={}, {},0
    for slot=1,19 do
        local id=worn(slot)
        if id then slots[slot]=id;names[slot]=itemName(id);count=count+1 end
    end
    if count==0 then say('You are not wearing anything the addon can see, so there is nothing to save.');return nil end
    db.sets[key]={name=name,savedAt=now() or 0,slots=slots,names=names}
    say(('%s set "%s": %d item%s.'):format(existing and 'Updated' or 'Saved',name,count,count==1 and '' or 's'))
    request()
    return count
end
local function wear(name,key)
    local set=store().sets[key]
    if type(set)~='table' or type(set.slots)~='table' then say(('No set called "%s". /bf set list shows your sets.'):format(name));return nil end
    -- Equipping is never done in combat (the game does not allow it, and we would not anyway).
    if call(InCombatLockdown)~=false then say('You are in combat. Gear sets can only be worn out of combat.');return 'combat' end
    if call(CursorHasItem)==true then say('Put down the item on your cursor first, then try again.');return 'cursor' end
    local equip=plain(EquipItemByName)
    if type(equip)~='function' then say('This game version cannot equip items from an addon command.');return nil end
    local bags=bagCounts()
    local result={equipped=0,already=0,elsewhere={},missing={}}
    -- Main hand before off hand, so a one-hander and a shield land after a two-hander leaves.
    for slot=1,19 do
        local id=int(set.slots[slot],1,2147483647)
        if id then
            local label=type(set.names)=='table' and str(set.names[slot],100) or itemName(id) or ('item '..id)
            if worn(slot)==id then result.already=result.already+1
            elseif (bags[id] or 0)>0 then
                bags[id]=bags[id]-1
                pcall(equip,id,slot)
                result.equipped=result.equipped+1
            elseif PAIR[slot] and worn(PAIR[slot])==id then result.elsewhere[#result.elsewhere+1]=('%s (in %s)'):format(label,SLOTS[PAIR[slot]])
            else result.missing[#result.missing+1]=label end
        end
    end
    say(('Wearing "%s": %d put on, %d already on.'):format(set.name,result.equipped,result.already))
    if #result.elsewhere>0 then say('Already worn in the other slot: '..table.concat(result.elsewhere,', ')..'.') end
    if #result.missing>0 then say('Not in your bags: '..table.concat(result.missing,', ')..'. The desktop app shows where they are (bank, mail or another character).') end
    if result.equipped>0 then request() end
    return result
end
local function list()
    local db=store()
    local keys={}
    for key,set in pairs(db.sets) do if type(set)=='table' and type(set.slots)=='table' then keys[#keys+1]=key end end
    table.sort(keys)
    if #keys==0 then say('No gear sets yet. Put on the gear you want and type /bf set save NAME.');return 0 end
    local bags=bagCounts()
    say(('Your gear sets (%d):'):format(#keys))
    for _,key in ipairs(keys) do
        local set=db.sets[key];local on,carried,total=0,0,0
        for slot,id in pairs(set.slots) do
            total=total+1
            if worn(slot)==id then on=on+1 elseif (bags[id] or 0)>0 then carried=carried+1 end
        end
        say(('  %s: %d items, %d worn now, %d in your bags, %d elsewhere.'):format(set.name,total,on,carried,total-on-carried))
    end
    return #keys
end
local function delete(name,key)
    local db=store()
    if not db.sets[key] then say(('No set called "%s".'):format(name));return false end
    db.sets[key]=nil
    say(('Deleted set "%s".'):format(name))
    request()
    return true
end
function BackstageForeverSetCommand(message)
    local rest=type(message)=='string' and message:match('^%s*[Ss][Ee][Tt]%s*(.*)$') or ''
    local sub,arg=rest:match('^(%a*)%s*(.*)$')
    sub=(sub or ''):lower()
    if sub=='list' then return list() end
    if sub=='save' or sub=='wear' or sub=='delete' then
        local name,key=setName(arg)
        if not name then say('Set names are 1 to 24 letters, numbers, spaces or dashes. '..USAGE);return nil end
        if sub=='save' then return save(name,key) elseif sub=='wear' then return wear(name,key) else return delete(name,key) end
    end
    say(USAGE)
    return nil
end

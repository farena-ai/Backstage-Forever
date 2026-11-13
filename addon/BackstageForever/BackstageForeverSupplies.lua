-- Supplies and class helpers: ammo, food and drink, pet happiness, soul shards and poisons.
-- Public API only: it reads bags, the ammo slot and your pet, and shows a reminder. It never
-- buys, feeds, uses or moves anything. /bf supplies shows everything; /bf supplies off silences it.
local floor,min=math.floor,math.min
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
    return (unpack or table.unpack)(r,2,12)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function num(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
end
local SOUL_SHARD=6265
local LOW_AMMO,OUT_AMMO,LOW_FOOD=200,50,4

local settings
local function loadSettings()
    if type(BackstageForeverSuppliesSettings)~='table' then BackstageForeverSuppliesSettings={} end
    settings=BackstageForeverSuppliesSettings
    if settings.enabled==nil then settings.enabled=true end
    return settings
end

-- Pure: the readings -> reminders {key,title,sub}. Keys let each reminder fire once per state.
function BackstageForeverSupplyAdvice(r)
    local out={}
    if type(r)~='table' then return out end
    local level=r.level or 1
    if r.className=='Hunter' and r.ranged then
        local kind=r.ranged=='gun' and 'bullets' or 'arrows'
        if r.ammo and r.ammo<=OUT_AMMO then out[#out+1]={key='ammo-out',title='Almost out of '..kind,sub=r.ammo..' left. Buy more from a vendor before the next fight (/bf find vendor).'}
        elseif r.ammo and r.ammo<=LOW_AMMO then out[#out+1]={key='ammo-low',title='Running low on '..kind,sub=r.ammo..' left. Next time you pass a vendor, stock up (/bf find vendor).'} end
    end
    if level>=5 and r.food and r.food<=LOW_FOOD then
        out[#out+1]={key=r.food==0 and 'food-out' or 'food-low',title=r.food==0 and 'No food or drink' or 'Low on food and drink',sub=(r.food==0 and 'Eating and drinking between fights saves a lot of time.' or r.food..' left.')..' Innkeepers and general vendors sell them (/bf find vendor).'}
    end
    if r.className=='Hunter' and r.petHappiness==1 then out[#out+1]={key='pet-unhappy',title='Your pet is unhappy',sub='Feed it (Feed Pet, then click food it likes) or it does less damage and may run away.'} end
    if r.className=='Warlock' and level>=10 and r.shards and r.shards<=1 then out[#out+1]={key=r.shards==0 and 'shards-out' or 'shards-low',title=r.shards==0 and 'No soul shards' or 'One soul shard left',sub='Use Drain Soul as an enemy dies to collect more.'} end
    if r.className=='Rogue' and level>=20 and r.instance and not r.poisoned then out[#out+1]={key='poison',title='No poison on your weapons',sub='Apply poisons before the first pull: more damage for free.'} end
    return out
end

local function bagsFood()
    local api=plain(C_Container);local n=0
    for bag=0,4 do
        local slots=num(call(field(api,'GetContainerNumSlots'),bag),0,64) or 0
        for slot=1,slots do
            local info=call(field(api,'GetContainerItemInfo'),bag,slot)
            local id=type(info)=='table' and num(field(info,'itemID'),1,10^9)
            if id then
                local _,_,_,_,_,classID,subID=call(GetItemInfoInstant,id)
                if classID==0 and subID==5 then n=n+(num(field(info,'stackCount'),1,1000) or 1) end
            end
        end
    end
    return n
end
local function readings()
    local r={level=num(call(UnitLevel,'player'),1,1000)}
    local cls=call(UnitClass,'player');r.className=type(cls)=='string' and cls or nil
    local slot=call(GetInventorySlotInfo,'AmmoSlot')
    if r.className=='Hunter' then
        local weapon=call(GetInventoryItemID,'player',18)
        if weapon then
            local _,_,_,_,_,_,sub=call(GetItemInfo,weapon)
            r.ranged=type(sub)=='string' and (sub:find('Gun') and 'gun' or (sub:find('Bow') or sub:find('Crossbow')) and 'bow') or nil
        end
        if slot then r.ammo=num(call(GetInventoryItemCount,'player',slot),0,100000) end
        if call(UnitExists,'pet') then r.petHappiness=num(call(GetPetHappiness),1,3) end
    end
    if r.className=='Warlock' then r.shards=num(call(GetItemCount,SOUL_SHARD),0,1000) end
    if r.className=='Rogue' then local has=call(GetWeaponEnchantInfo);r.poisoned=has==true;r.instance=call(IsInInstance)==true end
    r.food=bagsFood()
    return r
end

local fired={}
local function check(quiet)
    if not settings.enabled or call(InCombatLockdown)==true then return end
    local now={}
    for _,a in ipairs(BackstageForeverSupplyAdvice(readings())) do
        now[a.key]=true
        if not fired[a.key] and not quiet then
            if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,a.title,a.sub) else say(a.title..': '..a.sub) end
        end
    end
    -- A reminder can fire again once its problem was fixed and comes back.
    fired=now
end

function BackstageForeverSuppliesCommand(message)
    if not settings then loadSettings() end
    local arg=type(message)=='string' and message:lower():match('^supplies%s*(%a*)') or ''
    if arg=='on' or arg=='off' then settings.enabled=arg=='on';return say('Supply reminders '..(settings.enabled and 'on.' or 'off.')) end
    local r=readings()
    local parts={}
    if r.className=='Hunter' then parts[#parts+1]=(r.ammo and (r.ammo..' '..(r.ranged=='gun' and 'bullets' or 'arrows')) or 'no ammo equipped')..(r.petHappiness and (', pet '..({'unhappy','content','happy'})[r.petHappiness]) or '') end
    if r.className=='Warlock' then parts[#parts+1]=(r.shards or 0)..' soul shards' end
    parts[#parts+1]=(r.food or 0)..' food and drink'
    say('Supplies: '..table.concat(parts,', ')..'.')
    local advice=BackstageForeverSupplyAdvice(r)
    for _,a in ipairs(advice) do say('  '..a.title..': '..a.sub) end
    if #advice==0 then say('  All stocked up.') end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','BAG_UPDATE_DELAYED','UNIT_PET','UNIT_HAPPINESS','PLAYER_REGEN_ENABLED','PLAYER_ENTERING_WORLD','UNIT_INVENTORY_CHANGED'}) do pcall(events.RegisterEvent,events,e) end
        local last=0
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if not settings then loadSettings() end
            if event=='PLAYER_LOGIN' then pcall(check,true);return end
            local t=num(call(GetTime),0,10^9) or 0
            if t-last<2 and event~='PLAYER_ENTERING_WORLD' then return end
            last=t
            pcall(check,false)
        end)
    end
end

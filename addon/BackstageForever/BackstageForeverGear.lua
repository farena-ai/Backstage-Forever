-- Gear helper: verified quest reward comparisons and a one-line upgrade hint on item tooltips.
-- The legacy score model mirrors src/core/gear-score.cjs; reward highlights do not use its weights.
-- Public API only. It only highlights and explains: it never picks a reward, completes a quest
-- or equips anything for you.
local floor=math.floor
local unpackAll=unpack or table.unpack
local G={}
BackstageForeverGear=G

local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    local n=0 for k in pairs(r) do if type(k)=='number' and k>n then n=k end end
    for i=2,n do r[i]=plain(r[i]) end
    return unpackAll(r,2,math.max(n,2))
end
local function num(v) v=tonumber(plain(v)) if v and v==v then return v end end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end end
local function round(x,p) return floor(x*p+0.5)/p end
-- Numbers as gear-score.cjs prints them: 6, 5.5, 3.38.
local function fmt(x)
    if x==floor(x) then return ('%d'):format(x) end
    local s=('%.2f'):format(x):gsub('0+$',''):gsub('%.$','')
    return s
end
local function signed(x) return (x>0 and '+' or '')..fmt(x) end
local function has(list,v) for _,x in ipairs(list) do if x==v then return true end end return false end

-- ---------------------------------------------------------------- weights (gear-score.cjs)
local WEIGHTS={
    Warrior={Strength=1.0,Agility=0.6,Stamina=0.5,Spirit=0.1,['Attack Power']=0.5,armor=0.02,meleeDps=6,rangedDps=0.5},
    Paladin={Strength=1.0,Agility=0.4,Stamina=0.5,Intellect=0.4,Spirit=0.2,['Attack Power']=0.5,['Spell Damage']=0.3,['Spell Power']=0.3,Healing=0.2,armor=0.02,meleeDps=6},
    Shaman={Strength=0.9,Agility=0.5,Stamina=0.5,Intellect=0.6,Spirit=0.3,['Attack Power']=0.45,['Spell Damage']=0.5,['Spell Power']=0.5,Healing=0.3,armor=0.015,meleeDps=5},
    Rogue={Agility=1.0,Strength=0.5,Stamina=0.4,['Attack Power']=0.5,armor=0.01,meleeDps=6,rangedDps=0.3},
    Hunter={Agility=1.0,Intellect=0.4,Stamina=0.5,Spirit=0.2,Strength=0.1,['Ranged Attack Power']=0.5,['Attack Power']=0.3,armor=0.01,meleeDps=0.8,rangedDps=6},
    Druid={Strength=0.7,Agility=0.6,Intellect=0.7,Spirit=0.5,Stamina=0.5,['Spell Damage']=0.5,['Spell Power']=0.5,Healing=0.3,['Attack Power']=0.35,armor=0.015,meleeDps=0.5},
    Mage={Intellect=1.0,Spirit=0.6,Stamina=0.5,['Spell Damage']=1.0,['Spell Power']=1.0,armor=0.005,meleeDps=0.2,wandDps=2.5},
    Priest={Intellect=0.9,Spirit=1.0,Stamina=0.5,['Spell Damage']=0.8,['Spell Power']=0.8,Healing=0.5,armor=0.005,meleeDps=0.2,wandDps=3},
    Warlock={Stamina=0.8,Intellect=0.8,Spirit=0.6,['Spell Damage']=1.0,['Spell Power']=1.0,armor=0.005,meleeDps=0.2,wandDps=2.5},
}
local COMMON={Health=0.05,Mana=0.04,['Spell Power']=0.9,['Mana Regeneration']=1.5,['Health Regeneration']=1.0,['Defense Rating']=0.3,['Block Value']=0.1,['Hit Rating']=1.0,['Crit Rating']=1.0}
local SPECS={
    tank={Stamina=1.0,Agility=0.6,armor=0.05,['Defense Rating']=1.0,['Block Value']=0.4},
    healer={Intellect=1.0,Spirit=0.8,Healing=1.0,['Mana Regeneration']=2.0,meleeDps=0.2},
    caster={Intellect=1.0,Spirit=0.5,['Spell Damage']=1.0,meleeDps=0.2},
}
local NO_CLASS={Strength=0.5,Agility=0.5,Stamina=0.5,Intellect=0.5,Spirit=0.3,armor=0.01,meleeDps=2,rangedDps=1,wandDps=1}
local WEAPONS={
    Warrior={0,1,2,3,4,5,6,7,8,10,13,15,16,18},
    Paladin={0,1,4,5,6,7,8},
    Hunter={0,1,2,3,6,7,8,10,13,15,16,18},
    Rogue={2,3,4,7,13,15,16,18},
    Priest={4,10,15,19},
    Shaman={0,1,4,5,10,13,15},
    Mage={7,10,15,19},
    Warlock={7,10,15,19},
    Druid={4,5,10,13,15},
}
local ARMOR={Warrior={3,4},Paladin={3,4},Hunter={2,3},Shaman={2,3},Rogue={2,2},Druid={2,2},Mage={1,1},Priest={1,1},Warlock={1,1}}
local SHIELDS={'Warrior','Paladin','Shaman'}
local RELICS={[7]='Paladin',[8]='Druid',[9]='Shaman'}
local DUAL_WIELD={Warrior=20,Rogue=1,Hunter=20}
local ARMOR_NAMES={[1]='cloth',[2]='leather',[3]='mail',[4]='plate'}
-- Same singular names game-data.cjs uses, so wording does not depend on the client language.
local WEAPON_KINDS={[0]='Axe',[1]='Two-Handed Axe',[2]='Bow',[3]='Gun',[4]='Mace',[5]='Two-Handed Mace',[6]='Polearm',[7]='Sword',[8]='Two-Handed Sword',[10]='Staff',[13]='Fist Weapon',[14]='Miscellaneous',[15]='Dagger',[16]='Thrown',[18]='Crossbow',[19]='Wand',[20]='Fishing Pole'}
local ARMOR_KINDS={[0]='Miscellaneous',[1]='Cloth',[2]='Leather',[3]='Mail',[4]='Plate',[6]='Shield',[7]='Libram',[8]='Idol',[9]='Totem'}
G.WEIGHTS,G.SPECS,G.WEAPONS,G.ARMOR=WEIGHTS,SPECS,WEAPONS,ARMOR

local function className(ctx)
    local n=type(ctx)=='table' and type(ctx.className)=='string' and ctx.className:lower() or ''
    for k in pairs(WEIGHTS) do if k:lower()==n then return k end end
end
local function weightsFor(ctx)
    local w,cls={},className(ctx)
    for k,v in pairs(COMMON) do w[k]=v end
    for k,v in pairs(cls and WEIGHTS[cls] or NO_CLASS) do w[k]=v end
    local spec=type(ctx)=='table' and SPECS[ctx.spec]
    if spec then for k,v in pairs(spec) do w[k]=v end end
    return w
end
local function isWeapon(item) return type(item)=='table' and item.classId==2 end
local function dpsKey(item)
    if not isWeapon(item) then return nil end
    if item.subclassId==19 then return 'wandDps' end
    local inv=item.inventoryType
    if inv==15 or inv==25 or inv==26 then return 'rangedDps' end
    return 'meleeDps'
end
local function levelOf(ctx)
    local l=type(ctx)=='table' and ctx.level
    if type(l)=='number' and l==floor(l) then return l end
end

-- Can this class equip it now? -> list of reasons it cannot (empty when usable).
function G.blockers(item,ctx)
    local cls,level,out=className(ctx),levelOf(ctx),{}
    if type(item)~='table' then return {'Unknown item'} end
    if level and type(item.requiredLevel)=='number' and item.requiredLevel>level then out[#out+1]=('Requires level %d'):format(item.requiredLevel) end
    if cls and type(item.classes)=='table' and not has(item.classes,cls) then out[#out+1]=cls..'s cannot use it' end
    if not cls then return out end
    local sub,inv=item.subclassId,item.inventoryType
    if isWeapon(item) and sub~=14 and sub~=20 and not has(WEAPONS[cls],sub) then
        out[#out+1]=('%ss cannot use %s'):format(cls,item.kind and (tostring(item.kind):lower()..'s') or 'this weapon')
    end
    if isWeapon(item) and inv==22 and not (DUAL_WIELD[cls] and (level==nil or level>=DUAL_WIELD[cls])) then
        out[#out+1]=cls..'s cannot dual wield'..(DUAL_WIELD[cls] and ' yet' or '')
    end
    if item.classId==4 then
        if type(sub)=='number' and sub>=1 and sub<=4 and inv~=16 then
            local max=ARMOR[cls][(level and level<40) and 1 or 2]
            if sub>max then
                out[#out+1]=(level and level<40 and ARMOR[cls][2]>=sub) and ('%ss can wear %s from level 40'):format(cls,ARMOR_NAMES[sub]) or ('%ss cannot wear %s'):format(cls,ARMOR_NAMES[sub])
            end
        end
        if sub==6 and not has(SHIELDS,cls) then out[#out+1]=cls..'s cannot use shields' end
        if RELICS[sub] and RELICS[sub]~=cls then out[#out+1]=('Only %ss can use it'):format(RELICS[sub]) end
    end
    return out
end

-- Value of one item (no comparison).
function G.score(item,ctx)
    if type(item)~='table' then return {score=0,usable=false,reasons={'Unknown item'}} end
    local w,score=weightsFor(ctx),0
    local armor=item.armor or 0
    for _,s in ipairs(item.stats or {}) do
        if s.stat=='Armor' then armor=armor+s.amount
        else score=score+(w[s.stat] or (tostring(s.stat):find('Resistance$') and 0.05 or 0.1))*s.amount end
    end
    score=score+armor*(w.armor or 0)
    local key=dpsKey(item)
    if key and item.dps and item.dps~=0 then score=score+item.dps*(w[key] or 0) end
    local reasons=G.blockers(item,ctx)
    return {score=round(score,100),usable=#reasons==0,reasons=reasons}
end

local function totals(items)
    local stats,order,armor,dps={},{},0,{meleeDps=0,rangedDps=0,wandDps=0}
    for _,it in ipairs(items) do
        armor=armor+(it.armor or 0)
        for _,s in ipairs(it.stats or {}) do
            if s.stat=='Armor' then armor=armor+s.amount
            else
                if stats[s.stat]==nil then order[#order+1]=s.stat stats[s.stat]=0 end
                stats[s.stat]=stats[s.stat]+s.amount
            end
        end
        local k=dpsKey(it)
        if k and it.dps and it.dps~=0 then dps[k]=math.max(dps[k],it.dps) end
    end
    return {stats=stats,order=order,armor=armor,dps=dps}
end
local function list(equipped)
    if type(equipped)~='table' then return {} end
    if equipped.stats or equipped.unknown or equipped.classId or equipped.id then return {equipped} end
    local out={}
    for i=1,table.maxn and table.maxn(equipped) or #equipped do if equipped[i] then out[#out+1]=equipped[i] end end
    return out
end

-- candidate vs what it would replace (an item, a list of items for a two-hander, or nothing).
function G.compare(candidate,equipped,ctx)
    ctx=ctx or {}
    local current=list(equipped)
    local mine=G.score(candidate,ctx)
    if not mine.usable then return {better=false,delta=0,reasons=mine.reasons} end
    local theirs=0
    for _,it in ipairs(current) do theirs=theirs+G.score(it,ctx).score end
    local delta=round(mine.score-theirs,100)
    local w,a,b,lines=weightsFor(ctx),totals({candidate}),totals(current),{}
    local seen,keys={},{}
    for _,k in ipairs(a.order) do if not seen[k] then seen[k]=true keys[#keys+1]=k end end
    for _,k in ipairs(b.order) do if not seen[k] then seen[k]=true keys[#keys+1]=k end end
    for _,stat in ipairs(keys) do
        local d=(a.stats[stat] or 0)-(b.stats[stat] or 0)
        if d~=0 then lines[#lines+1]={text=signed(d)..' '..stat,weight=math.abs(d*(w[stat] or 0.1))} end
    end
    if a.armor~=b.armor then local d=a.armor-b.armor lines[#lines+1]={text=signed(d)..' armor',weight=math.abs(d*(w.armor or 0))} end
    for _,k in ipairs({'meleeDps','rangedDps','wandDps'}) do
        local d=round(a.dps[k]-b.dps[k],10)
        if d~=0 and (a.dps[k]~=0 or b.dps[k]~=0) then
            lines[#lines+1]={text=signed(d)..' '..(k=='wandDps' and 'wand ' or k=='rangedDps' and 'ranged ' or '')..'DPS',weight=math.abs(d*(w[k] or 0))}
        end
    end
    for i,l in ipairs(lines) do l.i=i end
    table.sort(lines,function(x,y) if x.weight~=y.weight then return x.weight>y.weight end return x.i<y.i end)
    local reasons={}
    for _,l in ipairs(lines) do reasons[#reasons+1]=l.text end
    if #current==0 and ctx.equipmentKnown~=false then table.insert(reasons,1,'Fills an empty slot') end
    for _,it in ipairs(current) do if it.unknown then table.insert(reasons,1,"Compared without your current item's stats") break end end
    while #reasons>6 do table.remove(reasons) end
    return {better=delta>0,delta=delta,reasons=reasons}
end

-- Equipment slots (1 head ... 19 tabard) an item would replace.
local SLOT_MAP={[1]={1},[2]={2},[3]={3},[4]={4},[5]={5},[20]={5},[6]={6},[7]={7},[8]={8},[9]={9},[10]={10},[11]={11,12},[12]={13,14},[16]={15},[19]={19},[13]={16},[21]={16},[22]={17},[14]={17},[23]={17},[15]={18},[25]={18},[26]={18},[28]={18}}
function G.slotsFor(item)
    local inv=type(item)=='table' and item.inventoryType
    if inv==17 then return {slots={16,17},together=true} end
    local s=SLOT_MAP[inv]
    return {slots=s and {unpackAll(s)} or {},together=false}
end
-- What the candidate replaces: both hands for a two-hander, the weaker of two rings/trinkets.
function G.replaced(item,ctx,equippedBySlot)
    local function get(slot) return type(equippedBySlot)=='table' and (equippedBySlot[slot] or equippedBySlot[tostring(slot)]) or nil end
    local r=G.slotsFor(item)
    local slots=r.slots
    if #slots==0 then return {slots=slots,items={}} end
    if r.together then
        local items={}
        for _,s in ipairs(slots) do local it=get(s) if it then items[#items+1]=it end end
        return {slots=slots,items=items}
    end
    if #slots==1 then return {slots=slots,items={get(slots[1])}} end
    for _,s in ipairs(slots) do if not get(s) then return {slots={s},items={}} end end
    local pairs_={}
    for i,s in ipairs(slots) do pairs_[i]={s=s,i=i,score=G.score(get(s),ctx).score} end
    table.sort(pairs_,function(x,y) if x.score~=y.score then return x.score<y.score end return x.i<y.i end)
    return {slots={pairs_[1].s},items={get(pairs_[1].s)}}
end

-- choices[i] is an item table or false/nil (not cached). Returns the pick (1-based index) or nil.
-- tie is true when another usable choice is exactly as good.
function G.bestReward(choices,ctx,equippedBySlot,n)
    ctx=ctx or {}
    n=n or (type(choices)=='table' and (table.maxn and table.maxn(choices) or #choices)) or 0
    local rated={}
    for index=1,n do
        local item=choices[index]
        if type(item)=='table' and item.inventoryType~=nil and item.name then
            local rep=G.replaced(item,ctx,equippedBySlot)
            local block=G.blockers(item,ctx)
            local usable=#block==0
            local equippable=usable and #rep.slots>0
            local cmp=equippable and G.compare(item,rep.items,ctx) or {better=false,delta=0,reasons=usable and {'Not equipment'} or block}
            rated[#rated+1]={index=index,item=item,usable=equippable,score=G.score(item,ctx).score,better=cmp.better,delta=cmp.delta,reasons=cmp.reasons,order=#rated+1}
        end
    end
    if #rated==0 then return nil end
    local usable={}
    for _,r in ipairs(rated) do if r.usable then usable[#usable+1]=r end end
    local pick,why,tie
    local function sell(r) return r.item.sellPrice or 0 end
    if #usable>0 then
        table.sort(usable,function(a,b)
            if a.delta~=b.delta then return a.delta>b.delta end
            if a.score~=b.score then return a.score>b.score end
            if sell(a)~=sell(b) then return sell(a)>sell(b) end
            return a.order<b.order
        end)
        pick=usable[1]
        tie=usable[2]~=nil and usable[2].delta==pick.delta and usable[2].score==pick.score
        if pick.better then why=pick.reasons
        else
            why={'No upgrade among these; this one is closest'}
            for _,r in ipairs(pick.reasons) do if #why<6 then why[#why+1]=r end end
        end
    else
        local all={unpackAll(rated)}
        table.sort(all,function(a,b) if sell(a)~=sell(b) then return sell(a)>sell(b) end return a.order<b.order end)
        pick=all[1]
        why={'None of these fit your character; this one sells for the most'}
    end
    local considered={}
    for _,r in ipairs(rated) do considered[#considered+1]={itemId=r.item.id,usable=r.usable,score=r.score,delta=r.delta} end
    return {itemId=pick.item.id,name=pick.item.name,index=pick.index,item=pick.item,upgrade=(pick.usable and pick.better)==true,
        usable=pick.usable,delta=pick.delta,reasons=why,tie=tie==true,considered=considered}
end

-- ---------------------------------------------------------------- game facts (public API)
local INVTYPES={INVTYPE_HEAD=1,INVTYPE_NECK=2,INVTYPE_SHOULDER=3,INVTYPE_BODY=4,INVTYPE_CHEST=5,INVTYPE_WAIST=6,INVTYPE_LEGS=7,
    INVTYPE_FEET=8,INVTYPE_WRIST=9,INVTYPE_HAND=10,INVTYPE_FINGER=11,INVTYPE_TRINKET=12,INVTYPE_WEAPON=13,INVTYPE_SHIELD=14,
    INVTYPE_RANGED=15,INVTYPE_CLOAK=16,INVTYPE_2HWEAPON=17,INVTYPE_BAG=18,INVTYPE_TABARD=19,INVTYPE_ROBE=20,
    INVTYPE_WEAPONMAINHAND=21,INVTYPE_WEAPONOFFHAND=22,INVTYPE_HOLDABLE=23,INVTYPE_AMMO=24,INVTYPE_THROWN=25,
    INVTYPE_RANGEDRIGHT=26,INVTYPE_QUIVER=27,INVTYPE_RELIC=28}
-- GetItemStats keys -> the stat names gear-score.cjs weighs (fixed order keeps reasons stable).
local STAT_KEYS={
    {'ITEM_MOD_STRENGTH_SHORT','Strength'},{'ITEM_MOD_AGILITY_SHORT','Agility'},{'ITEM_MOD_STAMINA_SHORT','Stamina'},
    {'ITEM_MOD_INTELLECT_SHORT','Intellect'},{'ITEM_MOD_SPIRIT_SHORT','Spirit'},
    {'ITEM_MOD_ATTACK_POWER_SHORT','Attack Power'},{'ITEM_MOD_RANGED_ATTACK_POWER_SHORT','Ranged Attack Power'},
    {'ITEM_MOD_SPELL_DAMAGE_DONE_SHORT','Spell Damage'},{'ITEM_MOD_SPELL_HEALING_DONE_SHORT','Healing'},{'ITEM_MOD_SPELL_POWER_SHORT','Spell Power'},
    {'ITEM_MOD_MANA_REGENERATION_SHORT','Mana Regeneration'},{'ITEM_MOD_HEALTH_REGEN_SHORT','Health Regeneration'},{'ITEM_MOD_HEALTH_REGENERATION_SHORT','Health Regeneration'},
    {'ITEM_MOD_DEFENSE_SKILL_RATING_SHORT','Defense Rating'},{'ITEM_MOD_DODGE_RATING_SHORT','Dodge Rating'},{'ITEM_MOD_PARRY_RATING_SHORT','Parry Rating'},
    {'ITEM_MOD_BLOCK_RATING_SHORT','Block Rating'},{'ITEM_MOD_BLOCK_VALUE_SHORT','Block Value'},
    {'ITEM_MOD_HIT_RATING_SHORT','Hit Rating'},{'ITEM_MOD_CRIT_RATING_SHORT','Crit Rating'},
    {'ITEM_MOD_HIT_SPELL_RATING_SHORT','Spell Hit Rating'},{'ITEM_MOD_CRIT_SPELL_RATING_SHORT','Spell Crit Rating'},
    {'ITEM_MOD_HEALTH_SHORT','Health'},{'ITEM_MOD_MANA_SHORT','Mana'},
    {'RESISTANCE1_NAME','Holy Resistance'},{'RESISTANCE2_NAME','Fire Resistance'},{'RESISTANCE3_NAME','Nature Resistance'},
    {'RESISTANCE4_NAME','Frost Resistance'},{'RESISTANCE5_NAME','Shadow Resistance'},{'RESISTANCE6_NAME','Arcane Resistance'},
}
local COMPARED_KEYS={RESISTANCE0_NAME=true}
for _,row in ipairs(STAT_KEYS)do COMPARED_KEYS[row[1]]=true end
local function itemInfo(link)
    if type(C_Item)=='table' and type(C_Item.GetItemInfo)=='function' then
        local r={call(C_Item.GetItemInfo,link)}
        if r[1] then return unpackAll(r,1,13) end
    end
    return call(GetItemInfo,link)
end
local function itemStats(link)
    local s
    if type(C_Item)=='table' and type(C_Item.GetItemStats)=='function' then s=call(C_Item.GetItemStats,link) end
    if type(s)~='table' then s=call(GetItemStats,link) end
    return type(s)=='table' and s or nil
end
local cache=setmetatable({},{__mode='v'})
-- An item table shaped like game-data.cjs item(), or nil while the client has not cached it.
function G.item(link)
    if type(link)~='string' or link=='' then return nil end
    if cache[link] then return cache[link] end
    local name,_,quality,itemLevel,reqLevel,_,_,_,equipLoc,_,sellPrice,classId,subclassId=itemInfo(link)
    if not name then return nil end
    classId,subclassId=num(classId),num(subclassId)
    local observed,stats=itemStats(link),{}
    local raw=observed or {}
    local seen={}
    for _,p in ipairs(STAT_KEYS) do
        local v=num(raw[p[1]])
        if v and v~=0 and not seen[p[2]] then seen[p[2]]=true stats[#stats+1]={stat=p[2],amount=v} end
    end
    local item={id=num(link:match('item:(%d+)')),name=name,link=link,quality=num(quality),itemLevel=num(itemLevel),requiredLevel=num(reqLevel) or 0,
        classId=classId,subclassId=subclassId,inventoryType=INVTYPES[equipLoc],equipLoc=equipLoc,
        kind=classId==2 and WEAPON_KINDS[subclassId] or classId==4 and ARMOR_KINDS[subclassId] or nil,
        armor=num(raw.RESISTANCE0_NAME) or 0,stats=stats,dps=num(raw.ITEM_MOD_DAMAGE_PER_SECOND_SHORT),sellPrice=num(sellPrice) or 0}
    item.statsKnown=observed~=nil
    item.rewardStatsKnown=item.statsKnown and getmetatable(raw)==nil
    if item.rewardStatsKnown then
        for key,value in next,raw do
            key,value=plain(key),plain(value)
            if not key or not COMPARED_KEYS[key] or type(value)~='number' or value~=value or math.abs(value)>1000000 then
                item.rewardStatsKnown=false;break
            end
        end
    end
    if observed then cache[link]=item end
    return item
end
function G.context()
    local _,file=call(UnitClass,'player')
    local cls=type(file)=='string' and file:sub(1,1):upper()..file:sub(2):lower() or nil
    if not cls then cls=call(UnitClass,'player') end
    local level=num(call(UnitLevel,'player'))
    return {className=cls,level=level and floor(level) or nil}
end
-- Equipped items for the slots these candidates would replace (unknown when not cached).
function G.equipped(candidates)
    local out={}
    for _,item in pairs(candidates) do
        if type(item)=='table' then
            for _,slot in ipairs(G.slotsFor(item).slots) do
                if out[slot]==nil then
                    local link=call(GetInventoryItemLink,'player',slot)
                    out[slot]=link and (G.item(link) or {unknown=true,id=num(link:match('item:(%d+)')),stats={},armor=0}) or false
                end
            end
        end
    end
    for k,v in pairs(out) do if v==false then out[k]=nil end end
    return out
end

-- ---------------------------------------------------------------- settings and command
local function enabled()
    local s=BackstageForeverGearSettings
    return not (type(s)=='table' and s.enabled==false)
end
function BackstageForeverGearCommand(message)
    if type(BackstageForeverGearSettings)~='table' then BackstageForeverGearSettings={} end
    local arg=(type(message)=='string' and message:lower() or ''):match('^%a+%s*(%a*)') or ''
    local s=BackstageForeverGearSettings
    if arg=='on' then s.enabled=true elseif arg=='off' then s.enabled=false else s.enabled=not enabled() end
    if not s.enabled and G.clearPick then G.clearPick() end
    say(('Gear hints %s: upgrade lines on item tooltips and the best quest reward.'):format(s.enabled and 'on' or 'off'))
    return s.enabled
end

-- ---------------------------------------------------------------- tooltip line
local GREEN,RED,GREY={0.25,1,0.25},{1,0.3,0.3},{0.6,0.6,0.6}
local SKIP_INV={[4]=true,[18]=true,[19]=true,[24]=true,[27]=true}
-- -> text,r,g,b for one item link, or nil (not equipment, not cached, or the item you wear).
function G.tooltipLine(link)
    if not enabled() then return nil end
    local item=G.item(link)
    if not item or not item.inventoryType or SKIP_INV[item.inventoryType] then return nil end
    local slots=G.slotsFor(item).slots
    if #slots==0 then return nil end
    for _,slot in ipairs(slots) do if call(GetInventoryItemLink,'player',slot)==link then return nil end end
    local ctx=G.context()
    local block=G.blockers(item,ctx)
    if #block>0 then return 'Not for you: '..block[1],unpackAll(RED) end
    local rep=G.replaced(item,ctx,G.equipped({item}))
    local cmp=G.compare(item,rep.items,ctx)
    if cmp.better then
        local top={}
        for i=1,math.min(3,#cmp.reasons) do top[i]=cmp.reasons[i] end
        return 'Upgrade for you'..(#top>0 and (': '..table.concat(top,', ')) or ''),unpackAll(GREEN)
    end
    return 'Not an upgrade',unpackAll(GREY)
end
local function linkOf(tooltip,data)
    local link
    if type(tooltip)=='table' and type(tooltip.GetItem)=='function' then local _,l=call(tooltip.GetItem,tooltip) link=l end
    if type(link)~='string' and type(data)=='table' then
        link=plain(data.hyperlink)
        if type(link)~='string' and num(data.id) then local _,l=itemInfo(num(data.id)) link=l end
    end
    return type(link)=='string' and link or nil
end
function G.onTooltip(tooltip,data,resize)
    if type(tooltip)~='table' then return end
    if tooltip~=GameTooltip and tooltip~=ItemRefTooltip then return end
    local text,r,g,b=G.tooltipLine(linkOf(tooltip,data))
    if not text then return end
    pcall(tooltip.AddLine,tooltip,text,r,g,b)
    if resize then pcall(tooltip.Show,tooltip) end
    return text
end
local function hookTooltips()
    if type(TooltipDataProcessor)=='table' and type(TooltipDataProcessor.AddTooltipPostCall)=='function'
        and type(Enum)=='table' and type(Enum.TooltipDataType)=='table' and Enum.TooltipDataType.Item~=nil then
        pcall(TooltipDataProcessor.AddTooltipPostCall,Enum.TooltipDataType.Item,function(tooltip,data) pcall(G.onTooltip,tooltip,data,false) end)
        return 'postcall'
    end
    local hooked
    for _,tip in ipairs({GameTooltip,ItemRefTooltip}) do
        if type(tip)=='table' and type(tip.HookScript)=='function' then
            if pcall(tip.HookScript,tip,'OnTooltipSetItem',function(self) pcall(G.onTooltip,self,nil,true) end) then hooked='script' end
        end
    end
    return hooked
end
G.hookMode=hookTooltips()

-- ---------------------------------------------------------------- quest reward picker
-- The classic quest frame's reward button for choice #index (first one that matches).
function G.rewardButton(index)
    local function ok(b)
        if type(b)~='table' then return false end
        return plain(b.type)=='choice' and num(call(b.GetID,b))==index and call(b.IsShown,b)==true
    end
    local rf=type(QuestInfoFrame)=='table' and QuestInfoFrame.rewardsFrame or (type(QuestInfoRewardsFrame)=='table' and QuestInfoRewardsFrame) or nil
    local env=_G or {}
    -- Choice buttons carry type 'choice' and their choice number as ID.
    for i=1,index+12 do
        local b=env['QuestInfoRewardsFrameQuestInfoItem'..i]
        if ok(b) then return b,'QuestInfoRewardsFrameQuestInfoItem'..i end
    end
    -- QuestInfo_GetRewardButton can allocate a Blizzard button. Read the existing list only.
    if rf and type(rf.RewardButtons)=='table' then
        for i=1,index+12 do if ok(rf.RewardButtons[i]) then return rf.RewardButtons[i],'rewardsFrame.RewardButtons' end end
    end
    for _,name in ipairs({'QuestInfoRewardsFrameQuestInfoItem'..index,'QuestRewardItem'..index}) do
        if ok(env[name]) then return env[name],name end
    end
end

local glow
local function glowFrame()
    if glow or type(CreateFrame)~='function' then return glow end
    local f=call(CreateFrame,'Frame','BackstageForeverGearPick',UIParent)
    if not f then return nil end
    local tex=call(f.CreateTexture,f,nil,'OVERLAY')
    if tex then
        pcall(tex.SetTexture,tex,'Interface\\Buttons\\UI-ActionButton-Border')
        pcall(tex.SetBlendMode,tex,'ADD')
        pcall(tex.SetVertexColor,tex,1,0.82,0,1)
    end
    local label=call(f.CreateFontString,f,nil,'OVERLAY','GameFontNormalSmall')
    if label then pcall(label.SetTextColor,label,1,0.82,0) end
    f.bfTexture,f.bfLabel=tex,label
    pcall(f.Hide,f)
    glow=f
    return f
end
function G.clearPick()
    if glow then pcall(glow.Hide,glow) glow.bfButton=nil end
end
local function showGlow(button,name)
    local f=glowFrame()
    if not f then return end
    pcall(f.SetParent,f,button)
    pcall(f.ClearAllPoints,f)
    pcall(f.SetAllPoints,f,button)
    local level=type(button.GetFrameLevel)=='function' and num(call(button.GetFrameLevel,button))
    if level then pcall(f.SetFrameLevel,f,level+5) end
    local icon=button.Icon or button.icon or (name and (_G or {})[name..'IconTexture'])
    local tex=f.bfTexture
    if tex then
        pcall(tex.ClearAllPoints,tex)
        if type(icon)=='table' then
            pcall(tex.SetPoint,tex,'CENTER',icon,'CENTER',0,0)
            pcall(tex.SetSize,tex,68,68)
        else pcall(tex.SetAllPoints,tex,f) end
    end
    if f.bfLabel then
        pcall(f.bfLabel.ClearAllPoints,f.bfLabel)
        pcall(f.bfLabel.SetPoint,f.bfLabel,'TOPRIGHT',f,'TOPRIGHT',-2,-1)
        pcall(f.bfLabel.SetText,f.bfLabel,(BackstageForeverTr or tostring)('Higher observed stats'))
    end
    f.bfButton=button
    pcall(f.Show,f)
end

local pending,spoken,scope=false,nil,nil
local function rewardEnabled()
    return enabled() and (type(BackstageForeverHelperEnabled)~='function' or call(BackstageForeverHelperEnabled,'rewardReasons')==true)
end
local function validScope(token)
    return token and token==scope and rewardEnabled() and call(InCombatLockdown)==false
        and call(UnitGUID,'player')==token.owner and call(GetQuestID)==token.quest
end
-- Limit the first verified comparison to fixed-slot armor. No assumptions about
-- weapon proficiency, both-hand replacement, empty slots, trinkets or set bonuses.
local fixedArmor={[1]=true,[3]=true,[5]=true,[6]=true,[7]=true,[8]=true,[9]=true,[10]=true,[15]=true}
local function rewardEvidence(link,slot)
    local item=G.item(link)
    if not item or not item.rewardStatsKnown or item.classId~=4 then return end
    local slots=G.slotsFor(item).slots
    if #slots~=1 or not fixedArmor[slots[1]] or (slot and slot~=slots[1]) then return end
    return item,slots[1]
end
local function statDelta(candidate,current)
    local a,b=totals({candidate}),totals({current})
    local more,less,lines=false,false,{}
    local function change(delta,stat)
        if delta~=0 then lines[#lines+1]=signed(delta)..' '..stat end
        more=more or delta>0;less=less or delta<0
    end
    change(a.armor-b.armor,(BackstageForeverTr or tostring)('armor'))
    for _,key in ipairs(a.order)do change(a.stats[key]-(b.stats[key] or 0),key)end
    for _,key in ipairs(b.order)do if not a.stats[key] then change(-b.stats[key],key)end end
    return more,less,table.concat(lines,', ')
end
-- Only a same-slot, strictly dominating observed-stat comparison can glow.
-- Otherwise report trade-offs/unknowns without making a selection or sale suggestion.
function G.pickRewards()
    G.clearPick()
    pending=false
    local token=scope
    if not validScope(token) then return end
    local n=num(call(GetNumQuestChoices))
    if not n or n<2 or n>12 or n%1~=0 then return end
    local tr=BackstageForeverTr or tostring
    local function once(line)
        if spoken~=line and validScope(token) then spoken=line;say(line)end
    end
    local ctx=G.context()
    if not className(ctx) or not levelOf(ctx) then return end
    local choices,currentSlot,current,missing,unknown={},nil,nil,false,false
    for i=1,n do
        local link=call(GetQuestItemLink,'choice',i)
        local base=G.item(link)
        local _,_,_,_,usable=call(GetQuestItemInfo,'choice',i)
        if not base then missing=true
        elseif usable~=false then
            local item,slot=rewardEvidence(link)
            if not item then unknown=true;missing=missing or not base.statsKnown
            elseif usable~=true or #G.blockers(item,ctx)>0 then unknown=true
            elseif currentSlot and currentSlot~=slot then unknown=true
            else
                currentSlot=slot
                choices[#choices+1]={item=item,index=i}
            end
        end
    end
    if currentSlot then
        local link=call(GetInventoryItemLink,'player',currentSlot)
        current=rewardEvidence(link,currentSlot)
        if link and not current then local base=G.item(link);missing=missing or not base or not base.statsKnown end
    end
    if missing and validScope(token) then pending=true;return {pending=true} end
    if not current or unknown then
        local line=tr('Quest rewards unranked: no verified same-slot comparison for all choices.')
        once(line);return {line=line}
    end
    local winner
    for _,row in ipairs(choices)do
        local more,less,deltas=statDelta(row.item,current)
        row.deltas=deltas
        if more and not less then
            local dominates=true
            for _,other in ipairs(choices)do
                if row~=other then local m,l=statDelta(row.item,other.item);if not m or l then dominates=false;break end end
            end
            if dominates then winner=row end
        end
    end
    if winner and validScope(token) then
        local button,name=G.rewardButton(winner.index)
        if button then showGlow(button,name) end
    end
    local details={}
    for _,row in ipairs(choices)do
        if row.deltas~='' then details[#details+1]=tr('%s vs. equipped %s: %s.'):format(row.item.name,current.name,row.deltas) end
    end
    local line=(winner and tr('Higher observed stats:') or tr('No clear quest reward winner on observed stats.'))
    if #details>0 then line=line..' '..table.concat(details,' ') end
    once(line)
    return {line=line,index=winner and winner.index}
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'QUEST_COMPLETE','QUEST_FINISHED','GET_ITEM_INFO_RECEIVED','PLAYER_EQUIPMENT_CHANGED','PLAYER_REGEN_DISABLED','PLAYER_ENTERING_WORLD','PLAYER_LOGOUT'}) do pcall(events.RegisterEvent,events,e) end
        local function later(token)
            local function refresh() if validScope(token) then pcall(G.pickRewards) end end
            if type(C_Timer)=='table' and type(C_Timer.After)=='function' then pcall(C_Timer.After,0,refresh) else refresh() end
        end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='QUEST_COMPLETE' then
                scope=nil;pending=false;spoken=nil;G.clearPick()
                if not rewardEnabled() or call(InCombatLockdown)~=false then return end
                local id,quest=call(UnitGUID,'player'),call(GetQuestID)
                if type(id)=='string' and id~='' and type(quest)=='number' and quest>0 and quest%1==0 then
                    scope={owner=id,quest=quest};later(scope)
                end
            elseif event=='GET_ITEM_INFO_RECEIVED' or event=='PLAYER_EQUIPMENT_CHANGED' then
                if not validScope(scope) then scope=nil;pending=false;G.clearPick()
                elseif pending or event=='PLAYER_EQUIPMENT_CHANGED' then G.clearPick();later(scope) end
            else scope=nil;pending=false;G.clearPick() end
        end)
    end
end

-- Generated offline by scripts/build-forever-pets.cjs; do not edit.
-- Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
-- Recorded tames only, places approximate. Ability names come from the game itself.
BackstageForeverPetData={build="1.60.1.71037",beasts={
{i=199,n="Young Fleshripper",f="Carrion Bird",lo=11,hi=11,a={24423},m=1436,x=0.543,y=0.444},
{i=505,n="Greater Tarantula",f="Spider",lo=19,hi=19,a={17256}},
{i=628,n="Black Ravager",f="Wolf",lo=25,hi=25,a={17257},m=1431,x=0.575,y=0.624},
{i=681,n="Young Stranglethorn Tiger",f="Cat",lo=30,hi=30,a={1754},m=1434,x=0.36,y=0.125},
{i=682,n="Stranglethorn Tiger",f="Cat",lo=33,hi=33,a={23099}},
{i=822,n="Young Forest Bear",f="Bear",lo=9,hi=9,a={16828},m=1429,x=0.26,y=0.893},
{i=834,n="Coyote",f="Wolf",lo=10,hi=11,a={17255},m=1436,x=0.514,y=0.465},
{i=923,n="Young Black Ravager",f="Wolf",lo=23,hi=23,a={},m=1431,x=0.474,y=0.659},
{i=1216,n="Shore Crawler",f="Crab",lo=18,hi=18,a={16829,1264735},m=1436,x=0.304,y=0.796},
{i=1922,n="Gray Forest Wolf",f="Wolf",lo=8,hi=8,a={17253},m=1429,x=0.602,y=0.695},
{i=2043,n="Nightsaber Stalker",f="Cat",lo=8,hi=8,a={},m=1438,x=0.563,y=0.724},
{i=2070,n="Moonstalker Runt",f="Cat",lo=11,hi=11,a={1742},m=1439,x=0.398,y=0.489},
{i=2237,n="Moonstalker Sire",f="Cat",lo=18,hi=18,a={1753},m=1439,x=0.376,y=0.797},
{i=2563,n="Plains Creeper",f="Spider",lo=32,hi=32,a={17258},m=1417,x=0.424,y=0.586},
{i=3127,n="Venomtail Scorpid",f="Scorpid",lo=9,hi=9,a={16828,24640},m=1411,x=0.429,y=0.204},
{i=3810,n="Elder Ashenvale Bear",f="Bear",lo=26,hi=26,a={16830},m=1440,x=0.612,y=0.644},
},training={
[1742]={l=5,c=8},
[1753]={l=15,c=10},
[1754]={l=25,c=12},
[2649]={l=1,c=0},
[4187]={l=1,c=5},
[4188]={l=12,c=10},
[4189]={l=18,c=15},
[4190]={l=24,c=25},
[14916]={l=10,c=0},
[14917]={l=20,c=0},
[14918]={l=30,c=0},
[16828]={l=8,c=4},
[16829]={l=16,c=7},
[16830]={l=24,c=10},
[17253]={l=1,c=1},
[17255]={l=8,c=4},
[17256]={l=16,c=7},
[17257]={l=24,c=10},
[17258]={l=32,c=13},
[24423]={l=8,c=0},
[24492]={l=20,c=5},
[24502]={l=30,c=15},
[24545]={l=1,c=1},
[24549]={l=12,c=5},
[24550]={l=18,c=10},
[24551]={l=24,c=15},
[24552]={l=30,c=25},
[24640]={l=8,c=0},
}}
-- Hunter pet book runtime (B3, roadmap C7). Pure functions over BackstageForeverPetData and the
-- /bf pet command. Chat only; nothing is shown in combat.
-- spellName: function(spellId) -> name, rank text (both optional). mapName: function(mapId) -> name.
local function petAbility(id,spellName)
    local name,rank
    if type(spellName)=='function' then
        local ok,a,b=pcall(spellName,id)
        if ok and type(a)=='string' and a~='' and #a<=60 then name=a:gsub('|','||') end
        if ok and type(b)=='string' and b~='' and #b<=20 then rank=b:gsub('|','||') end
    end
    local T=BackstageForeverTr or tostring
    return (name or (T('ability')..' #'..id))..(rank and (' ('..rank..')') or '')
end
-- Pure: one chat line for a beast.
function BackstageForeverPetLine(beast,data,spellName,mapName)
    if type(beast)~='table' or type(beast.n)~='string' then return nil end
    local T=BackstageForeverTr or tostring
    local levels=beast.lo==beast.hi and tostring(beast.lo) or (beast.lo..'-'..beast.hi)
    local where=''
    if type(beast.m)=='number' and type(beast.x)=='number' and type(beast.y)=='number' then
        local zone
        if type(mapName)=='function' then local ok,v=pcall(mapName,beast.m) if ok and type(v)=='string' and v~='' and #v<=60 then zone=v:gsub('|','||') end end
        where=(', %s %d, %d'):format(zone or (T('map')..' '..beast.m),math.floor(beast.x*100+.5),math.floor(beast.y*100+.5))
    end
    local teaches={}
    local training=type(data)=='table' and type(data.training)=='table' and data.training or {}
    for i=1,type(beast.a)=='table' and math.min(#beast.a,4) or 0 do
        local id=beast.a[i]
        local t=training[id]
        local need=type(t)=='table' and type(t.l)=='number' and t.l>0 and (' '..T('pet level')..' '..t.l) or ''
        teaches[#teaches+1]=petAbility(id,spellName)..need
    end
    local family=type(beast.f)=='string' and beast.f~='' and (T(beast.f)..', ') or ''
    return ('%s (%s%s %s%s): %s'):format(beast.n,family,T('level'),levels,where,#teaches>0 and table.concat(teaches,'; ') or T('no ability recorded'))
end
-- Pure: the beasts to list. query: nil for "what I can tame now" (your level and up to five below,
-- lowest first), or text matched against the beast, its family and its ability names.
function BackstageForeverPetFind(data,query,level,spellName,limit)
    local out={}
    if type(data)~='table' or type(data.beasts)~='table' then return out,0 end
    limit=type(limit)=='number' and limit or 8
    local text=type(query)=='string' and query:lower():gsub('^%s+',''):gsub('%s+$','') or ''
    local total=0
    for _,b in ipairs(data.beasts) do
        local hit=false
        if type(b)=='table' and type(b.n)=='string' and type(b.lo)=='number' then
            if text=='' then hit=type(level)~='number' or (b.lo<=level and b.lo>=level-5)
            elseif b.n:lower():find(text,1,true) or (type(b.f)=='string' and b.f:lower():find(text,1,true)) then hit=true
            else for _,id in ipairs(type(b.a)=='table' and b.a or {}) do if petAbility(id,spellName):lower():find(text,1,true) then hit=true break end end end
        end
        if hit then total=total+1;if #out<limit then out[#out+1]=b end end
    end
    table.sort(out,function(a,b) if a.lo~=b.lo then return a.lo<b.lo end return a.n<b.n end)
    return out,total
end
function BackstageForeverPetCommand(message)
    local T=BackstageForeverTr or tostring
    local function say(text)
        if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text)) end
    end
    if type(InCombatLockdown)=='function' then local ok,busy=pcall(InCombatLockdown) if not ok or busy then return end end
    local data=BackstageForeverPetData
    if type(data)~='table' or type(data.beasts)~='table' then say(T('The pet book is not available.')) return end
    local build
    if type(GetBuildInfo)=='function' then local ok,version,number=pcall(GetBuildInfo) if ok and type(version)=='string' and type(number)=='string' then build=version..'.'..number end end
    if build and type(BackstageForeverBuildUsable)=='function' and not BackstageForeverBuildUsable(data.build,build) then say(T('The pet book was recorded on another patch and is not shown.')) return end
    local query=type(message)=='string' and #message<=60 and message:match('^%a+%s+(.+)$') or nil
    local level
    if type(UnitLevel)=='function' then local ok,v=pcall(UnitLevel,'player') if ok and type(v)=='number' and v>0 and v<=100 then level=v end end
    local function spellName(id)
        local name,rank
        if type(GetSpellInfo)=='function' then local ok,v=pcall(GetSpellInfo,id) if ok and type(v)=='string' then name=v end end
        if type(GetSpellSubtext)=='function' then local ok,v=pcall(GetSpellSubtext,id) if ok and type(v)=='string' then rank=v end end
        return name,rank
    end
    local function mapName(id)
        local api=type(C_Map)=='table' and rawget(C_Map,'GetMapInfo')
        if type(api)~='function' then return nil end
        local ok,info=pcall(api,id)
        return ok and type(info)=='table' and info.name or nil
    end
    local rows,total=BackstageForeverPetFind(data,query,level,spellName,8)
    if #rows==0 then
        say(query and T('No recorded beast matches that. Try a family (cat, wolf) or an ability name.') or T('No recorded beast is near your level. Try /bf pet with a family or an ability name.'))
    else
        say(query and T('Recorded beasts that match:') or T('Recorded beasts you can tame near your level:'))
        for _,b in ipairs(rows) do say(BackstageForeverPetLine(b,data,spellName,mapName)) end
        if total>#rows then say(('%d %s'):format(total-#rows,T('more match; add a word to narrow it down.'))) end
    end
    say(T('Taming a beast teaches you the ability it comes with. Recorded tames only; places are approximate.'))
    if type(UnitClass)=='function' then
        local ok,_,class=pcall(UnitClass,'player')
        if ok and type(class)=='string' and class~='HUNTER' then say(T('Only hunters can tame beasts.')) end
    end
end

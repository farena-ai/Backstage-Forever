-- Narrow public gathering observations. GUIDs exist only in ephemeral correlation state.
local H=BackstageForeverPublicFacts
local public,field,number,text,sequence=H.public,H.field,H.number,H.text,H.sequence
local pending,owner,generation,active=nil,nil,0,false
local methods={[2576]='mining',[2368]='herbalism'}
-- Chests: the client's Opening / Pick Lock casts on a world object whose English name
-- reads like a chest. Lockboxes opened from bags have no world object and are never kept.
local OPENING={[3365]=true,[6247]=true,[6477]=true,[6478]=true,[21248]=true,[22810]=true,[1804]=true}
local OPENING_NAMES={['Opening']=true,['Opening - No Text']=true,['Pick Lock']=true}
local CHEST_WORDS={'Chest','Footlocker','Strongbox','Coffer','Lockbox','Trunk'}
-- Bounded private memory: up to 500 nodes, one per node type per rounded spot (0.5% of the map).
local KEEP=500
local VALID_METHODS={mining=true,herbalism=true,chest=true}
local function call(fn,...)
    fn=public(fn);if type(fn)~='function' then return nil end
    local ok,a,b=pcall(fn,...);if not ok then return nil end
    return public(a),public(b)
end
local function property(value,key)
    value=public(value);if type(value)~='table' and type(value)~='userdata' then return nil end
    local ok,v=pcall(function()return value[key]end);if ok then return public(v)end
end
local function decimal(value)
    value=public(value);if type(value)=='number' and value==value and value>=0 and value<=1 then return value end
end
local function buildValue(value)
    value=text(value,30);if value and value:match('^%d%d?%d?%.%d%d?%d?%.%d%d?%d?%.%d+$') then
        local final=value:match('%.(%d+)$');if #final<=8 then return value end
    end
end
local function clientBuild()
    local version,build=call(GetBuildInfo);version=text(version,12);build=text(build,8)
    if version and build and build:match('^%d+$') then return buildValue(version..'.'..build)end
end
local function clock()local v=call(GetTime);if type(v)=='number' and v==v and v>=0 and v<1e12 then return v end end
local function epoch()return number(call(time),0,253402300799)end
local function position()
    local api=public(C_Map);local map=number(call(property(api,'GetBestMapForUnit'),'player'),1,2147483647)
    if not map then return nil end
    local p=call(property(api,'GetPlayerMapPosition'),map,'player')
    local x,y=decimal(property(p,'x')),decimal(property(p,'y'))
    if not x or not y then local a,b=call(property(p,'GetXY'),p);x,y=decimal(a),decimal(b)end
    if x and y then return {mapId=map,x=x,y=y}end
end
local function exactKeys(value,keys)
    value=public(value);if type(value)~='table' then return false end
    local metadata,readable=public(getmetatable(value));if not readable or metadata~=nil then return false end
    local previous=nil
    for _=1,#keys+1 do
        local k=next(value,previous);local key,readable=public(k);if not readable then return false end
        if key==nil then return true end
        local allowed=false;for _,name in ipairs(keys)do if key==name then allowed=true;break end end
        if not allowed then return false end;previous=key
    end
    return false
end
local function itemIds(value)
    value=public(value);if type(value)~='table' then return nil end
    local metadata,readable=public(getmetatable(value));if not readable or metadata~=nil then return nil end
    local out,seen,count,highest,previous={},{},0,0,nil
    for _=1,9 do
        local k,v=next(value,previous);local key,readable=public(k);if not readable then return nil end
        if key==nil then if count>0 and count==highest then table.sort(out);return out end;return nil end
        local i=number(key,1,8);local id=number(v,1,2147483647)
        if not i or not id or seen[id] then return nil end
        seen[id]=true;out[#out+1]=id;count=count+1;highest=math.max(highest,i);previous=key
    end
end
local function spellName(spell)
    local api=public(C_Spell);local info=call(property(api,'GetSpellInfo'),spell)
    local name=text(property(info,'name'),60);if name then return name end
    return text((call(GetSpellInfo,spell)),60)
end
local function gatherMethod(spell,target)
    if methods[spell] then return methods[spell] end
    if not (OPENING[spell] or OPENING_NAMES[spellName(spell) or '']) then return nil end
    for _,word in ipairs(CHEST_WORDS)do if target:find(word,1,true) then return 'chest' end end
end
-- One remembered node per node type per rounded spot.
function BackstageForeverGatheringCell(r)
    return r.method..':'..r.entityId..':'..r.mapId..':'..math.floor(r.x*200+.5)..':'..math.floor(r.y*200+.5)
end
local function identity(method,entity,map,x,y,build)
    return 'wowf:'..method..':'..entity..':'..map..':'..math.floor(x*10000+.5)..':'..math.floor(y*10000+.5)..':'..build
end
local recordKeys={'id','method','entityId','itemIds','mapId','x','y','observedAt','clientBuild','name','evidence','precision','approximate'}
local function record(value,at)
    if not exactKeys(value,recordKeys)then return nil end
    local method=text(field(value,'method'),10);local entity=number(field(value,'entityId'),1,2147483647)
    local map=number(field(value,'mapId'),1,2147483647);local x,y=decimal(field(value,'x')),decimal(field(value,'y'))
    local build=buildValue(field(value,'clientBuild'));local name=text(field(value,'name'),120)
    local observed=number(field(value,'observedAt'),0,253402300799);local ids=itemIds(field(value,'itemIds'))
    if not VALID_METHODS[method or ''] or not entity or not map or not x or not y or not build or not name or not observed or observed>at or not ids then return nil end
    local id=identity(method,entity,map,x,y,build)
    if text(field(value,'id'),160)~=id or field(value,'evidence')~='observed-gathering-loot' or field(value,'precision')~='recorded-standing-point' or field(value,'approximate')~=true then return nil end
    return {id=id,method=method,entityId=entity,itemIds=ids,mapId=map,x=x,y=y,observedAt=observed,clientBuild=build,name=name,evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
end
local function records(value,at,cap)
    local raw=sequence(value,cap);if not raw then return nil end
    local out,seen={},{}
    for _,v in ipairs(raw)do local r=record(v,at);if not r or seen[r.id]then return nil end;seen[r.id]=true;out[#out+1]=r end
    table.sort(out,function(a,b)if a.observedAt~=b.observedAt then return a.observedAt>b.observedAt end;return a.id<b.id end)
    return out
end
-- Data-only validator shared by the pure map model; no API/store access.
function BackstageForeverGatheringValidateSnapshot(value,capturedAt)
    if not exactKeys(value,{'schemaVersion','status','recording','observedAt','limited','totalRecords','records'})then return nil end
    local at=number(field(value,'observedAt'),0,253402300799);local now=number(capturedAt,0,253402300799)
    local status=field(value,'status');local recording=field(value,'recording');local limited=field(value,'limited');local total=number(field(value,'totalRecords'),0,KEEP)
    if not now or not at or at>now or field(value,'schemaVersion')~=1 or (status~='available' and status~='unavailable') or type(recording)~='boolean' or type(limited)~='boolean' or not total then return nil end
    local rows=records(field(value,'records'),at,KEEP)
    if not rows or total<#rows or (not limited and total~=#rows)then return nil end
    return {schemaVersion=1,status=status,recording=recording,observedAt=at,limited=limited,totalRecords=total,records=rows}
end
local function store()
    local db=public(BackstageForeverGatheringDB)
    local rows=records(field(db,'records'),253402300799,KEEP)
    local recording=field(db,'recording')
    if field(db,'schemaVersion')~=1 or not rows then rows={}end
    BackstageForeverGatheringDB={schemaVersion=1,recording=recording~=false,records=rows}
    return BackstageForeverGatheringDB
end
local function retire()generation=generation+1;pending=nil end
local function bind()
    if not active then return nil end
    local id=text(call(UnitGUID,'player'),200)
    if not id then retire();return nil end
    if owner and owner~=id then retire();return nil end
    owner=id;return id
end
-- Build one complete observation, without checking then rereading changing APIs.
-- No owner binding or store mutation is allowed until every required value exists.
local function observation()
    if call(InCombatLockdown)~=false or call(GetLocale)~='enUS' then return nil end
    for _,fn in ipairs({'GetLootSourceInfo','GetLootSlotLink','GetNumLootItems'})do if type(public(_G[fn]))~='function' then return nil end end
    local id=text(call(UnitGUID,'player'),200)
    local build,tick,at,p=clientBuild(),clock(),epoch(),position()
    if not id or not build or not tick or not at or not p then return nil end
    return {owner=id,build=build,clock=tick,at=at,mapId=p.mapId,x=p.x,y=p.y}
end
local function capabilities()return observation()~=nil end
function BackstageForeverGatheringSession(event)
    event=text(event,50);retire()
    if event=='PLAYER_LOGOUT' then active=false;return end
    if event=='PLAYER_LOGIN' then active=true;bind();store()end
end
local ownedTypes=nil -- nil: unknown; else {herbalism=true,mining=true}
local ownedRanks={} -- 1.2: skill per gathering profession from the last save
function BackstageForeverGatheringSnapshot(character)
    local at=number(field(character,'updatedAt'),0,253402300799);if not at then return nil end
    local items=sequence(field(field(field(field(character,'readiness'),'workshop'),'professions'),'items'),20)
    if items then ownedTypes={};for _,p in ipairs(items)do local id=number(field(p,'skillLineId'),1,2147483647);local rank=number(field(p,'rank'),0,10000);if id==182 then ownedTypes.herbalism=true;ownedRanks.herbalism=rank elseif id==186 then ownedTypes.mining=true;ownedRanks.mining=rank end end end
    local id=bind();local db=store();local rows={}
    if id and text(field(character,'id'),200)==id and buildValue(field(character,'clientBuild'))==clientBuild()then
        for _,r in ipairs(db.records)do if r.observedAt<=at and #rows<KEEP then rows[#rows+1]=record(r,at)end end
    end
    local total=id and text(field(character,'id'),200)==id and #db.records or 0
    return {schemaVersion=1,status=id and capabilities() and 'available' or 'unavailable',recording=db.recording,observedAt=at,limited=total>#rows,totalRecords=total,records=rows}
end
local function signal()if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture)end end
local function marksChanged()if type(BackstageForeverGatheringMarksChanged)=='function' then pcall(BackstageForeverGatheringMarksChanged)end end
function BackstageForeverGatheringSetRecording(enabled)
    if type(public(enabled))~='boolean' or not bind() or call(InCombatLockdown)~=false then return end
    retire();store().recording=enabled;signal()
end
-- UI obtains a confirmation closure; owner/session/clear changes invalidate it.
function BackstageForeverGatheringClearAction()
    if not bind() or call(InCombatLockdown)~=false then return nil end
    local token,id=generation,owner
    return function()
        if token~=generation or not active or text(call(UnitGUID,'player'),200)~=id or call(InCombatLockdown)~=false then return end
        retire();store().records={};marksChanged()
        if type(BackstageForeverMapUpdate)=='function' then pcall(BackstageForeverMapUpdate,nil)end
        signal()
    end
end
local function context()
    if not active then return nil end
    local current=observation()
    if not current then return nil end
    -- Unexpected identity during this Lua session retires correlation, never the
    -- per-character journal. A fresh client session owns any new character DB.
    if owner and owner~=current.owner then retire();return nil end
    if not store().recording then return nil end
    owner=current.owner
    return current
end
local function same(a,b)
    return a and b and a.owner==b.owner and a.build==b.build and a.mapId==b.mapId and b.clock>=a.clock and b.clock-a.clock<=10 and (a.x-b.x)^2+(a.y-b.y)^2<=.005^2
end
local function pack(...)return {n=select('#',...),...}end
local function lootFacts(chest)
    local count=number(call(GetNumLootItems),1,64);if not count then return nil end
    local source,entity,ids,seen=nil,nil,{},{}
    for i=1,count do
        local ok,values=pcall(function()return pack(GetLootSourceInfo(i))end)
        if not ok or values.n<2 or values.n>32 or values.n%2~=0 then return nil end
        for j=1,values.n,2 do
            local guid=text(values[j],200);local amount=number(values[j+1],1,1000000)
            if not guid or not amount then return nil end
            local raw=guid:match('^GameObject%-%d+%-%d+%-%d+%-%d+%-(%d+)%-[%w_]+$')
            local object=raw and #raw<=10 and number(tonumber(raw),1,2147483647)
            if not object or (source and source~=guid)then return nil end
            source=guid;entity=object
        end
        local link=text(call(GetLootSlotLink,i),1000)
        local raw=link and link:match('|Hitem:(%d+):');local id=raw and #raw<=10 and number(tonumber(raw),1,2147483647)
        -- A chest's coin slot has no item link; gathering loot must be all items.
        if not id and not (chest and link==nil) then return nil end
        if id and not seen[id]then seen[id]=true;ids[#ids+1]=id end
        if #ids>64 then return nil end
    end
    if #ids==0 or not source then return nil end
    return {source=source,entityId=entity,itemIds=ids}
end
local function reconcile()
    local p=pending;if not p or not p.success or not p.loot then return end
    pending=nil
    if math.abs(p.success.clock-p.loot.context.clock)>2 or not same(p.context,p.success) or not same(p.context,p.loot.context)then return end
    local matches,seen={},{}
    local rows=p.method~='chest' and sequence(field(BackstageForeverAcquisition,'rows'),64) or nil
    if p.method=='chest' then table.sort(p.loot.itemIds);for _,id in ipairs(p.loot.itemIds)do if #matches<8 then seen[id]=true;matches[#matches+1]=id end end end
    for _,raw in ipairs(rows or {})do
        if field(raw,'kind')=='gathered-object-loot' and number(field(raw,'entityId'),1,2147483647)==p.loot.entityId and number(field(raw,'gatherSpellId'),1,2147483647)==p.spell and text(field(raw,'referenceName'),120)==p.target then
            local item=number(field(raw,'itemId'),1,2147483647)
            for _,id in ipairs(p.loot.itemIds)do if item==id and not seen[id]then seen[id]=true;matches[#matches+1]=id end end
        end
    end
    if #matches==0 or #matches>8 then return end;table.sort(matches)
    local ctx=p.loot.context;local method=p.method
    local r={id=identity(method,p.loot.entityId,ctx.mapId,ctx.x,ctx.y,ctx.build),method=method,entityId=p.loot.entityId,itemIds=matches,mapId=ctx.mapId,x=ctx.x,y=ctx.y,observedAt=ctx.at,clientBuild=ctx.build,name=p.target,evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
    -- Validate the complete candidate before touching retained history. Context
    -- completeness is required above; this is the independent persistence fence.
    r=record(r,ctx.at);if not r then return end
    local db=store();local kept={};local cell=BackstageForeverGatheringCell(r)
    for _,old in ipairs(db.records)do
        if old.id~=r.id and BackstageForeverGatheringCell(old)~=cell then kept[#kept+1]=old
        else for _,id in ipairs(old.itemIds)do if not seen[id] and #r.itemIds<8 then seen[id]=true;r.itemIds[#r.itemIds+1]=id end end end
    end
    table.sort(r.itemIds)
    r=record(r,ctx.at);if not r then return end
    table.insert(kept,1,r);while #kept>KEEP do table.remove(kept)end
    db.records=kept;signal();marksChanged()
end
-- /bf nodes: nearest remembered nodes of your gathering types on this map.
-- Pure helpers (no API access) are global for tests; the command reads only public APIs.
local DIRS={'north','northeast','east','southeast','south','southwest','west','northwest'}
local KIND_LABEL={herbalism='herb',mining='ore',chest='chest'}
-- dx grows east, dy grows south (map fractions, or yards when scaled).
function BackstageForeverGatheringDirection(dx,dy)
    if type(dx)~='number' or type(dy)~='number' or dx~=dx or dy~=dy then return nil end
    if dx*dx+dy*dy==0 then return 'here' end
    local atan2=math.atan2 or math.atan
    local degrees=(math.deg(atan2(dx,-dy))+360)%360
    return DIRS[math.floor(degrees/45+.5)%8+1]
end
-- records: remembered rows; here: {mapId,x,y}; options: {types={method=true},limit=n,size={w,h} yards}.
function BackstageForeverGatheringNearest(records,here,options)
    options=type(options)=='table' and options or {}
    local types=type(options.types)=='table' and options.types or nil
    local limit=number(options.limit,1,20) or 5
    local size=options.size
    if type(size)~='table' or type(size[1])~='number' or type(size[2])~='number' or not (size[1]>=1 and size[1]<=100000 and size[2]>=1 and size[2]<=100000) then size=nil end
    if type(records)~='table' or type(here)~='table' or not number(here.mapId,1,2147483647) or not decimal(here.x) or not decimal(here.y) then return {} end
    local out={}
    for _,r in ipairs(records)do
        if type(r)=='table' and r.mapId==here.mapId and (not types or types[r.method]) and decimal(r.x) and decimal(r.y) then
            local dx,dy=r.x-here.x,r.y-here.y
            if size then dx,dy=dx*size[1],dy*size[2] end
            out[#out+1]={record=r,kind=KIND_LABEL[r.method] or r.method,distance=math.sqrt(dx*dx+dy*dy),unit=size and 'yards' or 'map',direction=BackstageForeverGatheringDirection(dx,dy)}
        end
    end
    table.sort(out,function(a,b)if a.distance~=b.distance then return a.distance<b.distance end;return a.record.id<b.record.id end)
    while #out>limit do table.remove(out)end
    return out
end
function BackstageForeverGatheringNodeLine(n)
    local r=n.record
    local far=n.unit=='yards' and (math.floor(n.distance+.5)..' yd') or (string.format('%.1f%% of the map',n.distance*100))
    return string.format('%s (%s) - %s %s - %.1f, %.1f',r.name,n.kind,far,n.direction=='here' and 'right here' or n.direction,r.x*100,r.y*100)
end
local function say(m)if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(m))end end
local function mapSize(map)
    local api=public(C_Map);local get=property(api,'GetWorldPosFromMapPos');local vector=public(CreateVector2D)
    if type(get)~='function' or type(vector)~='function' then return nil end
    local _,a=call(get,map,vector(0,0));local _,b=call(get,map,vector(1,1))
    local ax,ay,bx,by=property(a,'x'),property(a,'y'),property(b,'x'),property(b,'y')
    if type(ax)~='number' or type(ay)~='number' or type(bx)~='number' or type(by)~='number' then local p,q=call(property(a,'GetXY'),a);local s,t=call(property(b,'GetXY'),b);ax,ay,bx,by=p,q,s,t end
    for _,v in ipairs({ax,ay,bx,by})do if type(v)~='number' or v~=v or math.abs(v)>1e7 then return nil end end
    local w,h=math.abs(by-ay),math.abs(bx-ax)
    if w>=1 and h>=1 and w<=100000 and h<=100000 then return {w,h} end
end
-- Skill each classic node needs (1.2): matched on the node's English name.
local NODE_SKILL={
    {'Copper Vein',1},{'Tin Vein',65},{'Incendicite',65},{'Silver Vein',75},{'Lesser Bloodstone',75},{'Iron Deposit',125},{'Indurium',150},{'Gold Vein',155},
    {'Mithril Deposit',175},{'Truesilver Deposit',230},{'Dark Iron Deposit',230},{'Small Thorium Vein',245},{'Ooze Covered Thorium Vein',245},{'Rich Thorium Vein',275},{'Ooze Covered Rich Thorium Vein',275},
    {'Peacebloom',1},{'Silverleaf',1},{'Earthroot',15},{'Mageroyal',50},{'Briarthorn',70},{'Stranglekelp',85},{'Bruiseweed',100},{'Wild Steelbloom',115},{'Grave Moss',120},
    {'Kingsblood',125},{'Liferoot',150},{'Fadeleaf',160},{'Goldthorn',170},{"Khadgar's Whisker",185},{'Wintersbite',195},{'Firebloom',205},{'Purple Lotus',210},
    {"Arthas' Tears",220},{'Sungrass',230},{'Blindweed',235},{'Ghost Mushroom',245},{'Gromsblood',250},{'Golden Sansam',260},{'Dreamfoil',270},
    {'Mountain Silversage',280},{'Plaguebloom',285},{'Icecap',290},{'Black Lotus',300},
}
function BackstageForeverNodeSkill(name)
    name=text(name,120);if not name then return nil end
    local best=nil
    for _,row in ipairs(NODE_SKILL)do if name:find(row[1],1,true) and (not best or #row[1]>#best[1])then best=row end end
    return best and best[2] or nil
end
-- Can this character gather that node? true / false / nil (unknown skill or not a skill node).
function BackstageForeverNodeGatherable(r,ranks)
    if type(r)~='table' or r.method=='chest' then return true end
    local need=BackstageForeverNodeSkill(r.name);local have=type(ranks)=='table' and ranks[r.method] or nil
    if not need or type(have)~='number' then return nil end
    return have>=need,need,have
end
-- Advisor pins are approximate last-seen standing points, never world objects.
local NODE_ICON={mining='Interface\\Icons\\INV_Ore_Copper_01',herbalism='Interface\\Icons\\INV_Misc_Flower_02',chest='Interface\\Icons\\INV_Box_01'}
-- Existing acquisition reference corroborates both identities on 70862; the skill
-- threshold remains a starter-node reference, not an observed tooltip requirement.
local STARTER_NODES={[1731]={name='Copper Vein',method='mining',skill=186},[1617]={name='Silverleaf',method='herbalism',skill=182}}
local MARK_TTL=7*24*60*60
local function mapContext(mapId)
    if type(BackstageForeverHelperEnabled)=='function' and call(BackstageForeverHelperEnabled,'gatheringMarks')~=true then return end
    if call(InCombatLockdown)~=false or not bind() then return end
    local build=clientBuild()
    -- Checked on 70862; used on every build of that patch.
    local usable=BackstageForeverBuildUsable
    local supported=build=='1.60.1.70862'
    if type(usable)=='function' then supported=call(usable,'1.60.1.70862',build)==true end
    if not supported or call(property(C_Map,'GetBestMapForUnit'),'player')~=mapId then return end
    return build,epoch()
end
local function liveRanks()
    local api=public(C_SkillInfo)
    local count=number(call(property(api,'GetNumSkillLines')),0,100)
    if not count then return {} end
    local ranks={}
    for i=1,count do
        local info=call(property(api,'GetSkillLineInfo'),i)
        local skill=field(info,'skillID')
        if field(info,'isHeader')==false and (skill==182 or skill==186) then
            local rank=number(field(info,'rank'),1,10000)
            local cap=number(field(info,'maxRank'),1,10000)
            if ranks[skill]~=nil or not rank or not cap or rank>cap then ranks[skill]=false else ranks[skill]=rank end
        end
    end
    return ranks
end
function BackstageForeverGatheringMarkCurrent(mapId,mark)
    if type(mark)~='table' then return false end
    local build,at=mapContext(mapId)
    return build==mark.build and owner==mark.owner and at~=nil and mark.at<=at and at-mark.at<MARK_TTL
        and (liveRanks()[mark.skill] or 0)>=mark.need
end
function BackstageForeverGatheringMapPoints(mapId,records,types,_,limit)
    mapId=number(mapId,1,2147483647);if not mapId then return {} end
    local build,at=mapContext(mapId)
    if not at then return {} end
    records=sequence(records or field(BackstageForeverGatheringDB,'records'),KEEP) or {}
    -- Only a current visible skill-line read qualifies. Captured ranks can outlive unlearning.
    local ranks=liveRanks()
    local out={}
    for _,value in ipairs(records)do
        local r=record(value,at)
        local node=r and STARTER_NODES[r.entityId]
        if node and r.name==node.name and r.method==node.method and r.mapId==mapId and r.clientBuild==build
            and at-r.observedAt<MARK_TTL and (not types or types[r.method]) then
            local need,have=BackstageForeverNodeSkill(node.name),ranks[node.skill]
            if need and have and have>=need then
                local tr=BackstageForeverTr or tostring
                local detail=tr('Last-seen gathering spot (approximate, not a live spawn).')..' '..
                    tr('Skill: %d / %d (starter-node reference).'):format(have,need)
                out[#out+1]={layer='gather',x=r.x,y=r.y,title=r.name,detail=detail,icon=NODE_ICON[r.method],
                    expiresIn=MARK_TTL-(at-r.observedAt),mark={owner=owner,build=build,at=r.observedAt,skill=node.skill,need=need}}
            end
        end
    end
    table.sort(out,function(a,b)if a.mark.at~=b.mark.at then return a.mark.at>b.mark.at end;if a.x~=b.x then return a.x<b.x end;return a.y<b.y end)
    limit=number(limit,1,500) or 100
    while #out>limit do table.remove(out)end
    return out
end
local WORDS={herb='herbalism',herbs='herbalism',herbalism='herbalism',ore='mining',ores='mining',mining='mining',chest='chest',chests='chest'}
function BackstageForeverNodesCommand(message)
    if call(InCombatLockdown)~=false then return say('Node lists wait until you leave combat.')end
    local word=type(message)=='string' and message:lower():match('^nodes%s+(%a+)') or nil
    local types
    if word=='all' then types=nil
    elseif word and WORDS[word] then types={[WORDS[word]]=true}
    elseif word then return say('Use /bf nodes, or /bf nodes herb, ore, chest or all.')
    elseif ownedTypes then types={chest=true};for k in pairs(ownedTypes)do types[k]=true end end
    local here=position();if not here then return say('Your position is not available here.')end
    local db=store();local zone=type(BackstageForeverFindMaps)=='table' and text(BackstageForeverFindMaps[here.mapId],60) or ('map '..here.mapId)
    local usable,tooHigh={},0
    for _,r in ipairs(db.records)do if BackstageForeverNodeGatherable(r,ownedRanks)==false then tooHigh=tooHigh+1 else usable[#usable+1]=r end end
    local list=BackstageForeverGatheringNearest(usable,here,{types=types,limit=5,size=mapSize(here.mapId)})
    if #list==0 then
        local what=types and (types.herbalism and types.mining and 'herb, ore or chest' or types.herbalism and 'herb or chest' or types.mining and 'ore or chest' or 'chest') or 'gathering'
        return say('No remembered '..what..' spots in '..zone..' yet. Gather or open chests here and they are remembered (up to 500).'..(db.recording and '' or ' Recording is paused on the BF map panel.'))
    end
    say('Nearest remembered spots in '..zone..' ('..#db.records..' remembered in all):')
    for i,n in ipairs(list)do say((i==1 and '> ' or '  ')..BackstageForeverGatheringNodeLine(n))end
    local best=list[1].record
    if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,string.format('way %d %.1f %.1f %s',best.mapId,best.x*100,best.y*100,best.name))end
    if tooHigh>0 then say(tooHigh..' remembered spot'..(tooHigh==1 and ' needs' or 's need')..' more skill than you have and '..(tooHigh==1 and 'is' or 'are')..' left out.')end
    if not types or types.herbalism or types.mining then say('Past spots, not live nodes: someone may have gathered them already.')end
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    for _,e in ipairs({'UNIT_SPELLCAST_SENT','UNIT_SPELLCAST_SUCCEEDED','UNIT_SPELLCAST_FAILED','UNIT_SPELLCAST_FAILED_QUIET','UNIT_SPELLCAST_INTERRUPTED','LOOT_READY','LOOT_CLOSED','PLAYER_REGEN_DISABLED','ZONE_CHANGED_NEW_AREA','PLAYER_ENTERING_WORLD'})do pcall(frame.RegisterEvent,frame,e)end
    frame:SetScript('OnEvent',function(_,event,...)
        event=text(event,50);if not event then retire();return end
        if event=='PLAYER_REGEN_DISABLED' or event=='ZONE_CHANGED_NEW_AREA' or event=='PLAYER_ENTERING_WORLD' then retire();return end
        if event=='LOOT_CLOSED' then return end -- Fast auto-loot may close before SUCCEEDED.
        local args=pack(...)
        if event=='UNIT_SPELLCAST_SENT' then
            local unit=text(args[1],20);if unit~='player' then if not unit then retire()end;return end
            retire();local target=text(args[2],120);local cast=text(args[3],200);local spell=number(args[4],1,2147483647);local ctx=context()
            local method=target and spell and gatherMethod(spell,target)
            if target and cast and spell and method and ctx then pending={target=target,cast=cast,spell=spell,method=method,context=ctx}end
            return
        end
        if not pending then return end
        local candidate=pending;local ctx=context();if pending~=candidate or not same(candidate.context,ctx)then retire();return end
        if event=='LOOT_READY' then
            local loot=lootFacts(pending.method=='chest');if not loot then retire();return end
            if pending.loot then
                local old=pending.loot;local matches=old.source==loot.source and #old.itemIds==#loot.itemIds
                for i,id in ipairs(old.itemIds)do if id~=loot.itemIds[i]then matches=false end end
                if not matches then retire()end
                return
            end
            loot.context=ctx;pending.loot=loot;reconcile();return
        end
        local unit=text(args[1],20);if unit~='player' then if not unit then retire()end;return end
        local cast=text(args[2],200);local spell=number(args[3],1,2147483647)
        if event~='UNIT_SPELLCAST_SUCCEEDED' or cast~=pending.cast or spell~=pending.spell then retire();return end
        pending.success=ctx;reconcile()
    end)
end

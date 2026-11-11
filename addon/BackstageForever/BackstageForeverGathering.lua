-- Narrow public gathering observations. GUIDs exist only in ephemeral correlation state.
local H=BackstageForeverPublicFacts
local public,field,number,text,sequence=H.public,H.field,H.number,H.text,H.sequence
local pending,owner,generation,active=nil,nil,0,false
local methods={[2576]='mining',[2368]='herbalism'}
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
    if (method~='mining' and method~='herbalism') or not entity or not map or not x or not y or not build or not name or not observed or observed>at or not ids then return nil end
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
    local status=field(value,'status');local recording=field(value,'recording');local limited=field(value,'limited');local total=number(field(value,'totalRecords'),0,128)
    if not now or not at or at>now or field(value,'schemaVersion')~=1 or (status~='available' and status~='unavailable') or type(recording)~='boolean' or type(limited)~='boolean' or not total then return nil end
    local rows=records(field(value,'records'),at,64)
    if not rows or total<#rows or (not limited and total~=#rows)then return nil end
    return {schemaVersion=1,status=status,recording=recording,observedAt=at,limited=limited,totalRecords=total,records=rows}
end
local function store()
    local db=public(BackstageForeverGatheringDB)
    local rows=records(field(db,'records'),253402300799,128)
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
    if owner and owner~=id then retire();BackstageForeverGatheringDB=nil end
    owner=id;return id
end
local function capabilities()
    if call(InCombatLockdown)~=false or not clock() or not epoch() or call(GetLocale)~='enUS' or not clientBuild() or not position()then return false end
    for _,fn in ipairs({'GetLootSourceInfo','GetLootSlotLink','GetNumLootItems'})do if type(public(_G[fn]))~='function' then return false end end
    return true
end
function BackstageForeverGatheringSession(event)
    event=text(event,50);retire()
    if event=='PLAYER_LOGOUT' then active=false;return end
    if event=='PLAYER_LOGIN' then active=true;bind();store()end
end
function BackstageForeverGatheringSnapshot(character)
    local at=number(field(character,'updatedAt'),0,253402300799);if not at then return nil end
    local id=bind();local db=store();local rows={}
    if id and text(field(character,'id'),200)==id and buildValue(field(character,'clientBuild'))==clientBuild()then
        for _,r in ipairs(db.records)do if r.observedAt<=at and #rows<64 then rows[#rows+1]=record(r,at)end end
    end
    local total=id and text(field(character,'id'),200)==id and #db.records or 0
    return {schemaVersion=1,status=id and capabilities() and 'available' or 'unavailable',recording=db.recording,observedAt=at,limited=total>#rows,totalRecords=total,records=rows}
end
local function signal()if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture)end end
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
        retire();store().records={}
        if type(BackstageForeverMapUpdate)=='function' then pcall(BackstageForeverMapUpdate,nil)end
        signal()
    end
end
local function context()
    local id=bind();if not id or not store().recording or not capabilities()then return nil end
    local p=position();if not p then return nil end
    p.owner=id;p.build=clientBuild();p.clock=clock();p.at=epoch();return p
end
local function same(a,b)
    return a and b and a.owner==b.owner and a.build==b.build and a.mapId==b.mapId and b.clock>=a.clock and b.clock-a.clock<=10 and (a.x-b.x)^2+(a.y-b.y)^2<=.005^2
end
local function pack(...)return {n=select('#',...),...}end
local function lootFacts()
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
        if not id then return nil end
        if not seen[id]then seen[id]=true;ids[#ids+1]=id end
        if #ids>64 then return nil end
    end
    return {source=source,entityId=entity,itemIds=ids}
end
local function reconcile()
    local p=pending;if not p or not p.success or not p.loot then return end
    pending=nil
    if math.abs(p.success.clock-p.loot.context.clock)>2 or not same(p.context,p.success) or not same(p.context,p.loot.context)then return end
    local matches,seen={},{}
    local rows=sequence(field(BackstageForeverAcquisition,'rows'),64)
    for _,raw in ipairs(rows or {})do
        if field(raw,'kind')=='gathered-object-loot' and number(field(raw,'entityId'),1,2147483647)==p.loot.entityId and number(field(raw,'gatherSpellId'),1,2147483647)==p.spell and text(field(raw,'referenceName'),120)==p.target then
            local item=number(field(raw,'itemId'),1,2147483647)
            for _,id in ipairs(p.loot.itemIds)do if item==id and not seen[id]then seen[id]=true;matches[#matches+1]=id end end
        end
    end
    if #matches==0 or #matches>8 then return end;table.sort(matches)
    local ctx=p.loot.context;local method=methods[p.spell]
    local r={id=identity(method,p.loot.entityId,ctx.mapId,ctx.x,ctx.y,ctx.build),method=method,entityId=p.loot.entityId,itemIds=matches,mapId=ctx.mapId,x=ctx.x,y=ctx.y,observedAt=ctx.at,clientBuild=ctx.build,name=p.target,evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
    local db=store();local kept={}
    for _,old in ipairs(db.records)do
        if old.id~=r.id then kept[#kept+1]=old
        else for _,id in ipairs(old.itemIds)do if not seen[id] and #r.itemIds<8 then seen[id]=true;r.itemIds[#r.itemIds+1]=id end end end
    end
    table.sort(r.itemIds);table.insert(kept,1,r);while #kept>128 do table.remove(kept)end
    db.records=kept;signal()
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
            if target and cast and spell and methods[spell] and ctx then pending={target=target,cast=cast,spell=spell,context=ctx}end
            return
        end
        if not pending then return end
        local candidate=pending;local ctx=context();if pending~=candidate or not same(candidate.context,ctx)then retire();return end
        if event=='LOOT_READY' then
            local loot=lootFacts();if not loot then retire();return end
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

-- Pure current public profession advice. No APIs, actions, inference or I/O.
-- Coach owns these defensive primitives; calls between models occur only after TOC load.
local H=BackstageForeverPublicFacts
local field,number,text,sequence,collection=H.field,H.number,H.text,H.sequence,H.collection
local function clone(v)
    if type(v)~='table' then return v end
    local out={};for k,x in pairs(v)do out[k]=clone(x)end;return out
end
local function options(value)
    local crafts=number(field(value,'crafts'),1,20) or 1
    return {crafts=crafts,skillLineId=number(field(value,'skillLineId'),1,2147483647),recipeId=number(field(value,'recipeId'),1,2147483647)}
end
local function coverage(c)return {status=c and (c.complete and 'complete' or 'partial') or 'unknown',observedAt=c and c.observedAt,complete=c and c.complete,itemCount=c and #c.items}end
local function acquisition(character,itemIds)
    local pack=BackstageForeverAcquisition
    local result={status=type(pack)=='table' and 'available' or 'unavailable',rows={},limitations={'Historical approximate player-standing points, never exact nodes. Current presence, rank requirements and availability remain unknown.','Seven selected relations are partial coverage; no source does not mean unobtainable.'}}
    if result.status=='available' then result.reference={sourceRepository=pack.sourceRepository,sourceCommit=pack.sourceCommit,product=pack.product,clientBuild=pack.clientBuild,license=pack.license,licenseUrl=pack.licenseUrl,attribution=pack.attribution,sourceDates=clone(pack.sourceDates),changes=pack.changes}end
    for _,id in ipairs(itemIds)do
        local row={itemId=id,status=result.status=='available' and 'unknown' or 'unavailable',reason=result.status=='available' and 'No observed source in this reference; availability is unknown.' or 'Acquisition reference unavailable.',sources={}}
        for _,raw in ipairs(type(pack)=='table' and pack.rows or {})do if raw.itemId==id and #row.sources<3 then
            local source=clone(raw);source.itemId=nil
            source.qualification='browse-only'
            source.reason='Historical browsing only: a dated current public character and matching build are required.'
            if H.stamp(field(character,'updatedAt')) and text(field(character,'clientBuild'))==pack.clientBuild then
                local allowed=true
                if raw.kind=='historical-vendor-listing' then
                    local faction=text(field(character,'faction'));local reactions=faction and raw.observedReactionsByFaction[faction]
                    allowed=type(reactions)=='table' and #reactions>0
                    for _,reaction in ipairs(reactions or {})do if reaction<4 or reaction>8 then allowed=false end end
                    local maps={};for _,point in ipairs(raw.positions)do maps[point.mapId]=true end
                    local count=0;for _ in pairs(maps)do count=count+1 end;if count>1 then allowed=false end
                    if not allowed then source.reason='Historical browsing only: faction access unknown, hostile/conflicting, or interaction history spans multiple maps; current access unknown.'end
                end
                if allowed then source.qualification='qualified-historical';source.reason='Matching-build historical place to look; current presence, requirements and access remain unknown.'end
            end
            row.sources[#row.sources+1]=source
            if source.qualification=='qualified-historical' then row.status='qualified-historical' elseif row.status~='qualified-historical' then row.status='browse-only'end
            row.reason=row.sources[1].reason
        end end
        result.rows[#result.rows+1]=row
    end
    return result
end
function BackstageForeverBuildProfessionCoach(character,value)
    local o=options(value);local now=H.stamp(field(character,'updatedAt'));local w=field(field(character,'readiness'),'workshop')
    local pc=collection(w,'professions',20,now);local rc=collection(w,'recipes',100,now);local mc=collection(w,'materials',256,now)
    local result={version=1,status='unavailable',selection={crafts=o.crafts,automatic=o.recipeId==nil,skillLineId=o.skillLineId,recipeId=o.recipeId},coverage={professions=coverage(pc),recipes=coverage(rc),materials=coverage(mc)},ownedProfessionChoices={},recipeChoices={},shoppingRows={},planning={available=false,checklistAvailable=false,requirementsKnown=false,inventoryExact=false,reason='No current learned skill-up recipe observed. Open your own profession normally, or choose a manual plan.'}}
    local owners,pids,valid={},{},pc~=nil
    for _,raw in ipairs(pc and pc.items or {})do
        local id=number(field(raw,'skillLineId'),1,2147483647);local pid=number(field(raw,'professionId'),1,2147483647);local rank=number(field(raw,'rank'),0,10000);local max=number(field(raw,'maxRank'),0,10000);local name=text(field(raw,'name'))
        if not id or not pid or not rank or not max or rank>max or not name or owners[id] or pids[pid] then valid=false
        else owners[id]={skillLineId=id,professionId=pid,rank=rank,maxRank=max,name=name};pids[pid]=true end
    end
    if not valid then owners={} end
    for _,owner in pairs(owners)do result.ownedProfessionChoices[#result.ownedProfessionChoices+1]=owner end
    table.sort(result.ownedProfessionChoices,function(a,b)return a.skillLineId<b.skillLineId end)
    local materials,materialValid={},mc and field(mc,'scope')=='bags-0-4'
    for _,raw in ipairs(mc and mc.items or {})do
        local id=number(field(raw,'itemId'),1,2147483647);local count=number(field(raw,'count'),1,1000000)
        if not id or not count or materials[id] then materialValid=false else materials[id]={count=count,name=text(field(raw,'name'))}end
    end
    if not materialValid then materials={}end
    local exact=materialValid and mc.complete and rc and mc.observedAt>=rc.observedAt
    local recipes,ids,duplicates={},{},{}
    for _,raw in ipairs(rc and rc.items or {})do local id=number(field(raw,'id'),1,2147483647);if id then if ids[id] then duplicates[id]=true end;ids[id]=true end end
    for _,raw in ipairs(rc and rc.items or {})do
        local id=number(field(raw,'id'),1,2147483647);local skill=number(field(raw,'skillLineId'),1,2147483647);local name=text(field(raw,'name'))
        if id and not duplicates[id] and skill and name then
            local r={id=id,skillLineId=skill,name=name,canSkillUp=field(raw,'canSkillUp')==true,reagents={},reagentsKnown=false}
            local reagents=sequence(field(raw,'reagents'),10);local known=field(raw,'reagentsKnown')==true and reagents and #reagents>0;local seen={}
            for _,reagent in ipairs(reagents or {})do
                local item=number(field(reagent,'itemId'),1,2147483647);local required=number(field(reagent,'required'),1,100000)
                if not item or not required or seen[item] then known=false else seen[item]=true;r.reagents[#r.reagents+1]={itemId=item,required=required,name=text(field(reagent,'name'))}end
            end
            r.reagentsKnown=known==true;if not r.reagentsKnown then r.reagents={}end
            r.levelingEligible=now~=nil and text(field(character,'clientBuild'))~=nil and owners[skill]~=nil and pc.observedAt<=rc.observedAt and r.canSkillUp and r.reagentsKnown
            local missingTypes,units=0,0
            for _,reagent in ipairs(r.reagents)do local missing=math.max(0,reagent.required*o.crafts-(materials[reagent.itemId] and materials[reagent.itemId].count or 0));if missing>0 then missingTypes=missingTypes+1;units=units+missing end end
            r.score={exact and (units==0 and 0 or 1) or 2,exact and missingTypes or 0,exact and units or 0,id};recipes[#recipes+1]=r
        end
    end
    table.sort(recipes,function(a,b)for i=1,4 do if a.score[i]~=b.score[i] then return a.score[i]<b.score[i]end end;return false end)
    local explicit,best
    for _,r in ipairs(recipes)do if r.id==o.recipeId then explicit=r end;if r.levelingEligible and not best then best=r end end
    local skill=o.skillLineId or explicit and explicit.skillLineId or best and best.skillLineId or result.ownedProfessionChoices[1] and result.ownedProfessionChoices[1].skillLineId
    result.selection.skillLineId=skill;result.profession=owners[skill]
    local selected
    for _,r in ipairs(recipes)do if r.skillLineId==skill and owners[skill] then
        if (o.recipeId and r.id==o.recipeId) or (not o.recipeId and r.levelingEligible and not selected)then selected=r end
        local choice=clone(r);choice.score=nil;result.recipeChoices[#result.recipeChoices+1]=choice
    end end
    table.sort(result.recipeChoices,function(a,b)return a.id<b.id end)
    if selected then
        result.selectedRecipe=clone(selected);result.selectedRecipe.score=nil;result.selection.recipeId=selected.id
        if selected.reagentsKnown and now and text(field(character,'clientBuild')) then
            result.status='ready';result.planning={available=true,checklistAvailable=true,requirementsKnown=true,inventoryExact=exact==true}
            for _,r in ipairs(selected.reagents)do
                local m=materials[r.itemId];local required=r.required*o.crafts
                result.shoppingRows[#result.shoppingRows+1]={itemId=r.itemId,name=r.name or m and m.name or ('Item '..r.itemId),required=required,have=m and m.count or exact and 0 or nil,missing=exact and math.max(0,required-(m and m.count or 0)) or nil,quantityKind=exact and 'exact' or m and 'lower-bound' or 'unknown'}
            end
        end
    elseif o.recipeId then result.planning.reason='The selected recipe is unavailable for this observed owned profession.' end
    local itemIds={};for _,row in ipairs(result.shoppingRows)do itemIds[#itemIds+1]=row.itemId end
    local facts=acquisition(character,itemIds);for i,row in ipairs(result.shoppingRows)do row.acquisition=facts.rows[i]end
    result.acquisitionReference={status=facts.status,reference=facts.reference,limitations=facts.limitations}
    local spell=({[182]=2368,[186]=2576})[skill];local gatheringIds={}
    if spell then for _,row in ipairs(type(BackstageForeverAcquisition)=='table' and BackstageForeverAcquisition.rows or {})do if row.gatherSpellId==spell then gatheringIds[#gatheringIds+1]=row.itemId end end end
    if #gatheringIds>0 then result.gatheringReference=acquisition(character,gatheringIds)end
    local owner=result.profession;local cap=now and text(field(character,'clientBuild')) and owner and owner.maxRank>0 and owner.rank==owner.maxRank
    local leveling=selected and selected.levelingEligible and result.planning.available
    local missing=0;for _,row in ipairs(result.shoppingRows)do if row.missing and row.missing>0 then missing=missing+1 end end
    local summary={};for _,row in ipairs(result.shoppingRows)do if row.missing and row.missing>0 and #summary<2 then summary[#summary+1]=row.missing..' x '..row.name end end
    local materialSummary=table.concat(summary,', ')..(missing>2 and ('; '..(missing-2)..' more materials') or '')
    local kind=leveling and exact and missing==0 and 'craft-ready' or cap and 'profession-cap' or leveling and exact and 'materials-needed' or selected and 'craft-plan' or 'observe-profession'
    result.recommendation={kind=kind,title=kind=='craft-ready' and ('Try '..selected.name) or kind=='materials-needed' and ('Gather supplies for '..selected.name) or kind=='profession-cap' and ('Check '..owner.name..' training') or selected and ('Plan '..selected.name) or 'Open your own profession',detail=kind=='profession-cap' and 'Check whether further training is available. A higher rank, trainer, cost or unlock is not established.' or kind=='craft-ready' and ('Carried materials cover '..o.crafts..' attempt(s); output and skill-ups are not guaranteed.') or kind=='materials-needed' and ('Need '..materialSummary..' for '..o.crafts..' attempt(s). Observed supplies; check in game.') or 'Manual plan or supply check; current skill-up eligibility and sufficient supply are not established.',levelingEligible=leveling==true,atObservedCap=cap==true,qualification=cap and 'Check training before expecting rank progress.' or nil}
    return result
end

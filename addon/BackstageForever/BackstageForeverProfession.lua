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
-- Skill-up colours from the client's own difficulty. Chances are estimates (classic:
-- orange always, yellow usually, green rarely, grey never); grey is never inferred.
local COLORS={optimal={color='orange',label='Orange',chance=1,words='always a skill-up',rank=0},medium={color='yellow',label='Yellow',chance=.75,words='usually a skill-up',rank=1},easy={color='green',label='Green',chance=.25,words='sometimes a skill-up',rank=3},trivial={color='grey',label='Grey',chance=0,words='no skill-ups',rank=4}}
local UNKNOWN={color='unknown',label='Colour unknown',words='skill-up chance not observed',rank=2}
function BackstageForeverSkillColor(difficulty)
    local c=type(difficulty)=='string' and rawget(COLORS,difficulty) or nil
    local out={difficulty=c and difficulty or 'unknown',observed=c~=nil};for k,v in pairs(c or UNKNOWN)do out[k]=v end;return out
end
-- Estimated crafts to the next point and to the current cap, if the recipe kept its colour.
function BackstageForeverSkillCountdown(profession,recipe)
    if type(profession)~='table' or type(recipe)~='table' or type(profession.rank)~='number' or type(profession.maxRank)~='number' then return nil end
    local c=BackstageForeverSkillColor(recipe.difficulty);local points=math.max(0,profession.maxRank-profession.rank)
    local chance=recipe.canSkillUp==false and 0 or c.chance
    local out={estimate=true,color=c.color,label=c.label,rank=profession.rank,maxRank=profession.maxRank,pointsToCap=points,chance=chance}
    if points==0 then out.status='at-cap';out.craftsToCap=0;out.detail=profession.name..' is at its cap ('..profession.maxRank..'). Train the next rank.'
    elseif chance==nil then out.status='unknown';out.detail='Skill-up colour not observed; open your profession once.'
    elseif chance==0 then out.status='grey';out.detail=recipe.name..' is grey: no more skill-ups from it.'
    else out.status='estimate';out.craftsToNextPoint=math.ceil(1/chance);out.craftsToCap=math.ceil(points/chance)
        out.detail='Estimate: about '..out.craftsToCap..' crafts to '..profession.maxRank..' if it stayed '..c.label:lower()..'.' end
    return out
end
-- Plain chat lines for /bf prof from one built coach model (pure; no API access).
function BackstageForeverProfessionLines(coach)
    if type(coach)~='table' then return {'Profession advice is not ready yet. Open your profession once, then try again.'} end
    local p=coach.profession
    if not p then return {'No profession observed yet. Open your profession window once so the addon can read it.'} end
    local lines={p.name..': '..p.rank..' / '..p.maxRank}
    local sel=coach.selectedRecipe
    if sel then lines[#lines+1]='Planned: '..sel.name..' - '..(sel.skill and (sel.skill.label..', '..sel.skill.words) or 'colour unknown') end
    local n=coach.nextRecipe
    if n then lines[#lines+1]='Best next recipe: '..n.name..' ('..n.reason..')'
    else lines[#lines+1]='No skill-up recipe observed: train new recipes or open your profession once.' end
    local c=coach.skillUp
    if c then lines[#lines+1]=c.craftsToCap and c.status=='estimate' and ('Countdown (estimate): next point in ~'..c.craftsToNextPoint..' craft(s), ~'..c.craftsToCap..' crafts to '..c.maxRank..'.') or c.detail end
    local short={};for _,row in ipairs(coach.shoppingRows or {})do if row.missing and row.missing>0 and #short<3 then short[#short+1]=row.missing..' x '..row.name end end
    if #short>0 then lines[#lines+1]='Still need: '..table.concat(short,', ') end
    return lines
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
            local difficulty=text(field(raw,'difficulty'),10);if difficulty and rawget(COLORS,difficulty) and (difficulty=='trivial')~=r.canSkillUp then r.difficulty=difficulty end
            r.skill=BackstageForeverSkillColor(r.difficulty)
            local reagents=sequence(field(raw,'reagents'),10);local known=field(raw,'reagentsKnown')==true and reagents and #reagents>0;local seen={}
            for _,reagent in ipairs(reagents or {})do
                local item=number(field(reagent,'itemId'),1,2147483647);local required=number(field(reagent,'required'),1,100000)
                if not item or not required or seen[item] then known=false else seen[item]=true;r.reagents[#r.reagents+1]={itemId=item,required=required,name=text(field(reagent,'name'))}end
            end
            r.reagentsKnown=known==true;if not r.reagentsKnown then r.reagents={}end
            r.levelingEligible=now~=nil and text(field(character,'clientBuild'))~=nil and owners[skill]~=nil and pc.observedAt<=rc.observedAt and r.canSkillUp and r.reagentsKnown
            local missingTypes,units=0,0
            for _,reagent in ipairs(r.reagents)do local missing=math.max(0,reagent.required*o.crafts-(materials[reagent.itemId] and materials[reagent.itemId].count or 0));if missing>0 then missingTypes=missingTypes+1;units=units+missing end end
            local perCraft=0;for _,reagent in ipairs(r.reagents)do perCraft=perCraft+reagent.required end
            -- Orange, then yellow, then fewest missing (exact bags), else fewest materials per craft.
            r.missingTypes=missingTypes
            r.score={r.skill.rank,exact and (units==0 and 0 or 1) or 2,exact and missingTypes or 0,exact and units or 0,exact and 0 or perCraft,id};recipes[#recipes+1]=r
        end
    end
    table.sort(recipes,function(a,b)for i=1,6 do if a.score[i]~=b.score[i] then return a.score[i]<b.score[i]end end;return false end)
    local explicit,best
    for _,r in ipairs(recipes)do if r.id==o.recipeId then explicit=r end;if r.levelingEligible and not best then best=r end end
    local skill=o.skillLineId or explicit and explicit.skillLineId or best and best.skillLineId or result.ownedProfessionChoices[1] and result.ownedProfessionChoices[1].skillLineId
    result.selection.skillLineId=skill;result.profession=owners[skill]
    local selected
    for _,r in ipairs(recipes)do if r.skillLineId==skill and owners[skill] then
        if (o.recipeId and r.id==o.recipeId) or (not o.recipeId and r.levelingEligible and not selected)then selected=r end
        local choice=clone(r);choice.score=nil;choice.missingTypes=nil;result.recipeChoices[#result.recipeChoices+1]=choice
    end end
    table.sort(result.recipeChoices,function(a,b)return a.id<b.id end)
    for _,r in ipairs(recipes)do if r.skillLineId==skill and owners[skill] and r.levelingEligible then
        local why=r.score[2]==0 and ('your bags cover '..o.crafts..' craft(s)') or r.score[2]==1 and (r.missingTypes..' material(s) short') or (r.score[5]..' material(s) per craft')
        result.nextRecipe={id=r.id,name=r.name,difficulty=r.skill.difficulty,color=r.skill.color,label=r.skill.label,reason=r.skill.label..': '..r.skill.words..' | '..why};break
    end end
    if selected then
        result.selectedRecipe=clone(selected);result.selectedRecipe.score=nil;result.selectedRecipe.missingTypes=nil;result.selection.recipeId=selected.id
        result.skillUp=BackstageForeverSkillCountdown(owners[skill],selected)
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

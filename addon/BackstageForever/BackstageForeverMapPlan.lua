-- Pure same-map projection of the reviewed quest and profession models.
local H=BackstageForeverPublicFacts
local field,number,text,sequence=H.field,H.number,H.text,H.sequence
local function coordinate(v)v=H.public(v);if type(v)=='number' and v==v and v>=0 and v<=1 then return v end end
local function copy(value,keys)
    local out={};for _,k in ipairs(keys)do local v=field(value,k);if type(v)=='string' then out[k]=text(v,800)elseif type(v)=='number' and v==v and math.abs(v)<1e12 then out[k]=v elseif type(v)=='boolean' then out[k]=v end end;return out
end
local function point(value)
    local map=number(field(value,'mapId'),1,2147483647);local x,y=coordinate(field(value,'x')),coordinate(field(value,'y'))
    if map and x and y then return {mapId=map,x=x,y=y,text=text(field(value,'text'))}end
end
local function safeQuests(character)
    local c=copy(character,{'updatedAt','clientBuild','locale','level'});c.location=copy(field(character,'location'),{'mapId','x','y','zone'});c.quests={}
    local quests=sequence(field(character,'quests'),25)
    for _,q in ipairs(quests or {})do
        local out=copy(q,{'id','title','complete','level','zone'});out.destination=point(field(q,'destination'));out.objectives={}
        local objectives=sequence(field(q,'objectives'),10)
        for _,o in ipairs(objectives or {})do out.objectives[#out.objectives+1]=copy(o,{'text','done','type','required','fulfilled'})end
        c.quests[#c.quests+1]=out
    end
    return c,quests~=nil
end
local function clone(value)
    if type(value)~='table' then return value end;local out={};for k,v in pairs(value)do out[k]=clone(v)end;return out
end
function BackstageForeverBuildMap(character,options)
    local map=number(field(options,'mapId'),1,2147483647)
    local result={version=1,status='unavailable',mapId=map,points={},counts={quest=0,material=0,find=0,total=0},limitations={'Reference places and recorded interactions are not active resources. Presence, requirements, access, safety and routes are unknown.','Historical coordinates and personal records are approximate player standing points, not exact objects.','Only the viewed map is shown. Older builds are browsing references; source coverage is incomplete.'}}
    local now=H.stamp(field(character,'updatedAt'));if not map or not now then return result end
    local layers=field(options,'layers');local function enabled(k)return field(layers,k)~=false end
    local older=field(layers,'olderReferences')==true
    local indexed={}
    local function add(p)
        if p.mapId~=map or not coordinate(p.x) or not coordinate(p.y) or indexed[p.id] or #result.points>=128 then return nil end
        indexed[p.id]=p;result.points[#result.points+1]=p;result.counts[p.kind]=result.counts[p.kind]+1;return p
    end
    local c,knownQuests=safeQuests(character)
    if enabled('quest') and knownQuests and type(BackstageForeverBuildPlan)=='function' then
        -- Drain the planner's three-card batches before same-map filtering.
        for _=1,9 do
            local plan=BackstageForeverBuildPlan(c,{minutes=60});if #plan.steps==0 then break end
            local selected={}
            for _,step in ipairs(plan.steps)do
                selected[step.questId]=true
                local d=point(step.destination)
                if d then add({id='quest:'..step.questId..':'..step.phase..':'..d.mapId,kind='quest',mapId=d.mapId,x=d.x,y=d.y,title=step.title,detail=step.detail,evidence=step.source=='game' and 'current-game-marker' or 'qualified-quest-reference',precision=step.source=='game' and 'game-marker' or 'approximate-reference',qualification=step.source=='game' and 'game' or 'qualified-historical',clientBuild=text(field(character,'clientBuild'),30),observedAt=now,itemIds={},sources={},questStep=clone(step)})end
            end
            local remaining={};for _,q in ipairs(c.quests)do if not selected[q.id]then remaining[#remaining+1]=q end end
            c.quests=remaining;if #remaining==0 then break end
        end
    end
    local goal=field(options,'goal');local coach
    if type(BackstageForeverBuildProfessionCoach)=='function' then coach=BackstageForeverBuildProfessionCoach(character,goal)end
    local function materials(row)
        local item=number(field(row,'itemId'),1,2147483647);if not item then return end
        for _,source in ipairs(sequence(field(row,'sources'),3) or {})do
            local qualification=field(source,'qualification');local kind=text(field(source,'kind'),40)
            local entity=number(field(source,'entityId'),1,2147483647);local build=text(field(source,'clientBuild'),30)
            local spell=number(field(source,'gatherSpellId'),1,2147483647)
            local layer=spell==2368 and 'herbs' or spell==2576 and 'ore' or 'supplies'
            if enabled(layer) and entity and build and kind and (qualification=='qualified-historical' or (qualification=='browse-only' and older))then
                local facts=copy(source,{'sourceKey','kind','entityId','referenceName','gatherSpellId','clientBuild','observedOn','qualification','reason','positionEvidence','exactObjectPosition','limitedStock','positionCountInOriginal','contributingFiles','observedLootWindows','lastSeen'})
                facts.context={};local contexts=field(source,'context')
                for i=1,8 do local v=text(field(contexts,i),100);if not v then break end;facts.context[#facts.context+1]=v end
                for _,raw in ipairs(sequence(field(source,'positions'),3) or {})do
                    local d=point(raw)
                    if d and d.mapId==map then
                        local id=table.concat({'material',kind,entity,spell or 0,build,map,string.format('%.17g',d.x),string.format('%.17g',d.y)},':')
                        local p=indexed[id]
                        if not p then p=add({id=id,kind='material',layer=layer,mapId=map,x=d.x,y=d.y,title=text(field(source,'referenceName'),120) or ('Source #'..entity),detail=text(field(source,'reason'),800) or 'Historical place; current presence unknown.',evidence=text(field(source,'positionEvidence'),100) or 'historical-standing-point',precision='approximate-reference',qualification=qualification,clientBuild=build,observedOn=text(field(source,'observedOn'),10),itemIds={},sources={facts}})end
                        if p then local seen=false;for _,v in ipairs(p.itemIds)do if v==item then seen=true end end;if not seen and #p.itemIds<8 then p.itemIds[#p.itemIds+1]=item;table.sort(p.itemIds)end end
                    end
                end
            end
        end
    end
    if coach then
        for _,row in ipairs(coach.shoppingRows or {})do if row.missing==nil or row.missing>0 then materials(row.acquisition)end end
        for _,owned in ipairs(coach.ownedProfessionChoices or {})do
            if owned.skillLineId==182 or owned.skillLineId==186 then
                local gathering=BackstageForeverBuildProfessionCoach(character,{skillLineId=owned.skillLineId}).gatheringReference
                for _,row in ipairs(gathering and gathering.rows or {})do materials(row)end
            end
        end
    end
    local gathering=type(BackstageForeverGatheringValidateSnapshot)=='function' and BackstageForeverGatheringValidateSnapshot(field(character,'gathering'),now)
    if enabled('finds') and gathering then for _,r in ipairs(gathering.records)do
        add({id='find:'..r.id,kind='find',layer='finds',mapId=r.mapId,x=r.x,y=r.y,title=r.name,detail='Past supported gathering loot observed here. Approximate standing point; items collected and current presence are unknown.',evidence=r.evidence,precision=r.precision,qualification='own-recorded',clientBuild=r.clientBuild,observedAt=r.observedAt,itemIds=clone(r.itemIds),sources={{entityId=r.entityId,method=r.method}}})
    end end
    result.counts.total=#result.points;result.status=#result.points>0 and 'ready' or (knownQuests or coach and coach.coverage.professions.status~='unknown' or gathering) and 'empty' or 'unavailable'
    return result
end

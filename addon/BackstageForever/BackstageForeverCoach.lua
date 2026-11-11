-- Pure advice from bounded public observations. No game actions or I/O.
local function public(value)
    if type(issecretvalue)=='function' then local ok,secret=pcall(issecretvalue,value);if not ok or secret then return nil,false end end
    return value,true
end
local function field(value,key) value=public(value);if type(value)=='table' then local item=public(rawget(value,key));return item end end
local function number(value,min,max) value=public(value);if type(value)=='number' and value==value and value>=min and value<=max and value%1==0 then return value end end
local function text(value,max) value=public(value);if type(value)=='string' and #value>0 and #value<=(max or 200) and not value:find('[%z\1-\31\127]') then return value end end
-- Validate shape before interpreting absence. Raw next avoids metatable iteration;
-- guard keys and rows before comparisons, indexing, or coercion.
local function sequence(value,cap)
    local items,readable=public(value)
    if not readable or type(items)~='table' then return nil end
    local metadata,metadataReadable=public(getmetatable(items))
    if not metadataReadable or metadata~=nil then return nil end
    local out,count,highest,previous={},0,0,nil
    for _=1,cap+1 do
        local key,row=next(items,previous)
        local safeKey,keyReadable=public(key)
        if not keyReadable then return nil end
        if safeKey==nil then return count==highest and out or nil end
        local index=number(safeKey,1,cap)
        local safeRow,rowReadable=public(row)
        if not index or not rowReadable or type(safeRow)~='table' then return nil end
        count=count+1;if count>cap then return nil end
        highest=math.max(highest,index);out[index]=safeRow;previous=safeKey
    end
    return nil
end
local function meaningful(value)
    value=text(value)
    if not value then return false end
    -- Match desktop trim's Unicode whitespace without treating blank prose as work.
    value=value:gsub('%s','')
    for last=128,138 do value=value:gsub(string.char(226,128,last),'')end
    for _,space in ipairs({string.char(194,160),string.char(225,154,128),
        string.char(226,128,168),string.char(226,128,169),string.char(226,128,175),
        string.char(226,129,159),string.char(227,128,128),string.char(239,187,191)})do
        value=value:gsub(space,'')
    end
    return #value>0
end
local function copyFields(value,keys)
    local out={};for _,key in ipairs(keys)do local v=field(value,key);if type(v)=='string' then out[key]=text(v,800) elseif type(v)=='boolean' then out[key]=v elseif type(v)=='number' and v==v and math.abs(v)<1e12 then out[key]=v end end;return out
end
local function point(value)return copyFields(value,{'mapId','x','y','text','zone'})end
local function safeCharacter(raw)
    local c=copyFields(raw,{'clientBuild','locale','level','updatedAt'})
    c.location=point(field(raw,'location'))
    local quests=field(raw,'quests')
    if type(quests)=='table' then c.quests={};for i=1,25 do local q=field(quests,i);if q==nil then break end
        local out=copyFields(q,{'id','title','complete','level','zone'});out.objectives={}
        for j=1,10 do local o=field(field(q,'objectives'),j);if o==nil then break end;out.objectives[j]=copyFields(o,{'text','done','type','required','fulfilled'})end
        if field(q,'destination')~=nil then out.destination=point(field(q,'destination'))end;c.quests[#c.quests+1]=out
    end end
    c.readiness={bags=copyFields(field(field(raw,'readiness'),'bags'),{'free','total'})};return c
end
local function stamp(value) return number(value,0,8640000000000) end
local function collection(w,key,cap,now)
    local c=field(w,key);local at=stamp(field(c,'observedAt'));local items=sequence(field(c,'items'),cap)
    local complete=field(c,'complete')
    if not now or not at or at>now or not items or type(complete)~='boolean' then return nil end
    return {observedAt=at,complete=complete,items=items,scope=field(c,'scope')}
end
-- Shared public normalization, consumed lazily by the profession model after TOC load.
BackstageForeverPublicFacts={public=public,field=field,number=number,text=text,sequence=sequence,collection=collection,stamp=stamp}
local function signature(id,values)
    local out={id};for _,v in ipairs(values)do local s=tostring(v);out[#out+1]=#s..':'..s end;return table.concat(out,'|')
end
-- Drain bounded planner batches so its preview cap cannot hide coach candidates.
-- The planner still owns ordering, reference qualification and command creation.
local function questPool(character)
    local remaining={};for key,value in pairs(character)do remaining[key]=value end
    local steps,status={},nil
    for _=1,9 do
        local plan=BackstageForeverBuildPlan(remaining,{minutes=60})
        status=status or plan.status
        if #plan.steps==0 then break end
        local selected={}
        for _,step in ipairs(plan.steps)do steps[#steps+1]=step;selected[step.questId]=true end
        local quests={}
        for _,quest in ipairs(remaining.quests or {})do if not selected[quest.id] then quests[#quests+1]=quest end end
        if #quests==0 then break end
        remaining.quests=quests
    end
    return steps,status
end
function BackstageForeverBuildCoach(character,options)
    local mode=field(options,'mode');if mode~='questing' and mode~='professions' then mode='adventure'end
    local result={version=1,status='unavailable',mode=mode,alternatives={},limitations={'Open your own profession normally to observe learned recipes and carried materials.','You choose every action; skill-ups and output are not guaranteed.','Advice covers observed recipes only; a partial catalog may omit other choices.'}}
    if type(public(character))~='table' then return result end
    local c=safeCharacter(character);local rows={}
    local function add(rank,kind,identity,title,reason,detail,evidence,facts,extra)
        local id=kind..':'..identity;local value={id=id,kind=kind,title=title,reason=reason,detail=detail,evidence=evidence,signature=signature(id,facts)}
        for k,v in pairs(extra or {})do value[k]=v end
        rows[#rows+1]={rank=rank,order=#rows+1,value=value}
    end
    local prep=BackstageForeverBuildPreparation(c)
    if prep then add(mode=='questing' and 1 or 0,'bags','carried','Make room in your bags',prep.free..' of '..prep.total..' carried slots are free.','Review carried items before collecting more. Nothing is sold or deleted automatically.','Current game bags',{prep.free,prep.total}) end
    local questSteps,questStatus=questPool(c)
    for i,step in ipairs(questSteps)do
        local q;for _,v in ipairs(c.quests or {})do if v.id==step.questId then q=v;break end end
        local actionable=step.source=='game' and step.destination~=nil
        for _,o in ipairs(q and q.objectives or {})do if o.done==false and meaningful(o.text) then actionable=true end end
        local localQuest=actionable and q and q.zone and q.zone==c.location.zone or step.source=='game' and step.destination and step.destination.mapId==c.location.mapId
        local rank=mode=='questing' and 0 or mode=='professions' and 3 or step.phase=='t' and 1 or localQuest and 2 or 4
        -- Keep unknown check-log fallbacks behind established work in this tier.
        if mode~='questing' and step.phase~='t' and not actionable and not step.destination then rank=rank+0.5 end
        local facts={step.questId,step.phase,step.title,step.detail,step.command or ''}
        for _,o in ipairs(q and q.objectives or {})do for _,key in ipairs({'text','done','type','required','fulfilled'})do facts[#facts+1]=tostring(o[key])end end
        add(rank,'quest',step.questId,step.title,step.reason,step.detail,step.source=='reference' and 'Approximate reference; verify quest details' or 'Current quest log',facts,{questStep=step})
    end
    local profession=BackstageForeverBuildProfessionCoach(character,options)
    local pc=profession.coverage.professions.status~='unknown'
    local nextStep=profession.recommendation
    if nextStep and (nextStep.kind=='craft-ready' or nextStep.kind=='materials-needed' or nextStep.kind=='profession-cap' or (nextStep.kind=='craft-plan' and profession.selection.automatic==false)) then
        local kind=nextStep.kind
        local rank=kind=='craft-ready' and (mode=='questing' and 2 or mode=='professions' and 1 or 3)
            or kind=='profession-cap' and (mode=='questing' and 3 or mode=='professions' and 2 or 5)
            or kind=='craft-plan' and (mode=='professions' and 3 or 5)
            or (mode=='questing' and 4 or mode=='professions' and 2.5 or 4.25)
        local selected=profession.selection;local owner=profession.profession
        local values={selected.recipeId or 0,selected.skillLineId or 0,selected.crafts,owner and owner.rank or 0,owner and owner.maxRank or 0}
        for _,r in ipairs(profession.shoppingRows)do values[#values+1]=r.itemId;values[#values+1]=r.required;values[#values+1]=r.have or 'unknown';values[#values+1]=r.missing or 'unknown' end
        add(rank,kind,selected.recipeId or selected.skillLineId or 0,nextStep.title,nextStep.detail,
            nextStep.detail..(nextStep.qualification and (' '..nextStep.qualification) or ''),'Current owned profession and observed supplies',values,
            {recipeId=selected.recipeId,professionId=owner and owner.professionId})
    end
    table.sort(rows,function(a,b)if a.rank~=b.rank then return a.rank<b.rank end;if a.value.kind=='quest' and b.value.kind=='quest' then return a.order<b.order end;return a.value.id<b.value.id end)
    if mode=='questing' and #rows>3 then for i=4,#rows do if rows[i].value.kind=='bags' then rows[3]=rows[i];break end end end
    result.status=#rows>0 and 'ready' or questStatus=='unavailable' and not pc and 'unavailable' or 'empty'
    result.recommendation=rows[1] and rows[1].value or nil
    for i=2,math.min(3,#rows)do result.alternatives[#result.alternatives+1]=rows[i].value end
    return result
end

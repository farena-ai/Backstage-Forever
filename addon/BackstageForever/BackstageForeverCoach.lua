-- Pure advice from bounded public observations. No game actions or I/O.
local function public(value)
    if type(issecretvalue)=='function' then local ok,secret=pcall(issecretvalue,value);if not ok or secret then return nil,false end end
    return value,true
end
local function field(value,key) value=public(value);if type(value)=='table' then local item=public(rawget(value,key));return item end end
local function number(value,min,max) value=public(value);if type(value)=='number' and value==value and value>=min and value<=max and value%1==0 then return value end end
local function text(value,max) value=public(value);if type(value)=='string' and #value>0 and #value<=(max or 200) and not value:find('[%z\1-\31\127]') then return value end end

-- Read-only rank maintenance, not a rotation cue. Exact Forever Frostbolt 3 -> 4 pilot.
local rankOwner, rankNotice
local function rankRead(fn,...)
    if type(public(fn))~='function' then return end
    local ok,a,b=pcall(fn,...);if ok then return public(a),public(b) end
end
local function rankEnabled()
    return type(BackstageForeverHelperEnabled)~='function' or rankRead(BackstageForeverHelperEnabled,'spellRankReminder')==true
end
function BackstageForeverSpellRankRefresh()
    if not rankEnabled() or not rankOwner or text(rankRead(UnitGUID,'player'),200)~=rankOwner or rankRead(InCombatLockdown)~=false then return end
    local version,build=rankRead(GetBuildInfo)
    -- Checked on 70959; used on every build of that patch.
    if type(version)~='string' or type(build)~='string' then return end
    local usable=BackstageForeverBuildUsable
    if type(usable)=='function' then
        local ok,value=pcall(usable,'1.60.1.70959',version..'.'..build);if not ok or value~=true then return end
    elseif version~='1.60.1' or build~='70959' then return end
    local _,class=rankRead(UnitClass,'player');if class~='MAGE' then return end
    local bank=field(field(Enum,'SpellBookSpellBank'),'Player')
    local spell=field(field(Enum,'SpellBookItemType'),'Spell')
    if type(bank)~='number' or type(spell)~='number' then return end
    local book=public(C_SpellBook)
    local function learned(id,rank)
        if rankRead(field(book,'IsSpellKnown'),id,bank)~=true then return end
        local slot,foundBank=rankRead(field(book,'FindSpellBookSlotForSpell'),id,true,false,false,false)
        if foundBank~=bank or not number(slot,1,1000) then return end
        local row=rankRead(field(book,'GetSpellBookItemInfo'),slot,bank)
        local pattern=text(SPELL_RANK,80)
        local ok,label=pcall(string.format,pattern or 'Rank %d',rank)
        if not ok or (not pattern and rankRead(GetLocale)~='enUS') or field(row,'subName')~=label then return end
        if field(row,'itemType')==spell and field(row,'actionID')==id and field(row,'spellID')==id
            and field(row,'isPassive')==false and field(row,'isOffSpec')==false then return text(field(row,'name'),120) end
    end
    local lower,higher=learned(837,3),learned(7322,4)
    if not higher or lower~=higher or type(public(GetActionInfo))~='function' then return end
    local slots={}
    for slot=1,120 do
        local kind,id=rankRead(GetActionInfo,slot)
        if kind=='spell' and id==837 then slots[#slots+1]=slot end
    end
    local signature=table.concat(slots,', ')
    if signature==rankNotice then return end
    rankNotice=signature
    if #slots>0 then
        local tr=BackstageForeverTr or tostring
        rankRead(DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,
            'Backstage Forever: '..tr('%s: action slot(s) %s still use rank %d. Rank %d is learned; update the bar manually if wanted.'):format(higher,signature,3,4))
    end
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_LOGOUT','SPELLS_CHANGED','ACTIONBAR_SLOT_CHANGED','PLAYER_REGEN_ENABLED'}) do pcall(frame.RegisterEvent,frame,event) end
    pcall(frame.SetScript,frame,'OnEvent',function(_,event)
        if event=='PLAYER_LOGOUT' then rankOwner=nil;rankNotice=nil;return end
        if event=='PLAYER_LOGIN' then rankOwner=text(rankRead(UnitGUID,'player'),200);rankNotice=nil end
        BackstageForeverSpellRankRefresh()
    end)
end
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
    -- Optional, not a new primary or a route. Quest log headings and reference
    -- points cannot establish where a current hand-in actually is.
    local primary=result.recommendation
    local map=number(c.location.mapId,1,2147483647)
    local route=field(options,'route')
    local exclude=field(options,'detourQuestId')
    local wanted=field(options,'activeDetourId')
    if map and ((route and route.mapId==map) or (not route and primary and mode~='professions')) then
        for _,step in ipairs(questSteps)do
            local marker=step.destination
            local id='on-my-way:'..step.questId
            if step.phase=='t' and step.source=='game' and marker and marker.mapId==map
                and meaningful(step.title) and (not wanted or wanted==id)
                and (route and not route.questIds[step.questId]
                    or not route and step.questId~=exclude and (exclude or 'quest:'..step.questId~=primary.id)) then
                result.onMyWay={id=id,questId=step.questId,title=step.title,
                    signature=signature(id,{step.title,map,marker.x,marker.y}),mapId=map,questStep=step}
                break
            end
        end
    end
    return result
end

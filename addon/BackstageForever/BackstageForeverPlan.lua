-- Pure bounded quest planning from already-public observations. No game APIs or actions.
local QUEST_CAP,OBJECTIVE_CAP=25,10
local localized={deDE=true,frFR=true,esES=true,esMX=true,itIT=true,ptBR=true,ruRU=true,koKR=true,zhCN=true,zhTW=true}
local function field(value,key)
    if type(value)=='table' then return rawget(value,key) end
end
local function text(value,limit)
    if type(value)=='string' and #value>0 and #value<=(limit or 200) and not value:find('[%z\1-\31\127]') then return value end
end
local function integer(value,low,high)
    if type(value)=='number' and value==value and value>=low and value<=high and value%1==0 then return value end
end
local function coordinate(value)
    if type(value)=='number' and value==value and value>=0 and value<=1 then return value end
end
local function build(value)
    if not text(value,30) then return nil end
    local a,b,c,d=value:match('^(%d+)%.(%d+)%.(%d+)%.(%d+)$')
    if a and #a<=3 and #b<=3 and #c<=3 and #d<=8 then return value end
end
local function point(value)
    local map=integer(field(value,'mapId'),1,2147483647)
    local x,y=coordinate(field(value,'x')),coordinate(field(value,'y'))
    local label=field(value,'text')
    if not map or not x or not y or (label~=nil and label~='' and not text(label)) then return nil end
    return {mapId=map,x=x,y=y,text=text(label)}
end
local function referenceInfo(character)
    local raw=BackstageForeverReference
    local result={status='unavailable'}
    local commit=field(raw,'sourceCommit')
    if field(raw,'schemaVersion')~=1 or not build(field(raw,'build')) or field(raw,'locale')~='enUS'
        or field(raw,'license')~='CC BY 4.0' or not text(field(raw,'attribution'))
        or not text(commit,40) or #commit~=40 or not commit:match('^[a-f0-9]+$')
        or type(field(raw,'quests'))~='table' then return nil,result end
    result.build=field(raw,'build');result.locale='enUS';result.sourceCommit=commit
    result.attribution=field(raw,'attribution');result.license='CC BY 4.0'
    result.observedThrough=text(field(raw,'observedThrough'),10)
    result.status=build(field(character,'clientBuild')) and 'build-mismatch' or 'unknown-build'
    if field(character,'clientBuild')~=result.build then return nil,result end
    result.status='match'
    return raw,result
end
local function referenceRow(reference,character,id,title)
    local row=field(field(reference,'quests'),id)
    local alias=text(field(row,'title'))
    if not alias then return nil end
    if alias==title then return row end
    -- Only a known translated locale permits a qualified English alias. English
    -- hotfixes and unknown locales cannot silently borrow another quest's route.
    if localized[field(character,'locale')] then return row,alias end
end
local function observedPoint(value,evidence)
    if field(value,'approximate')~=true or field(value,'evidence')~=evidence then return nil end
    local p=point(value)
    if not p then return nil end
    local name=field(value,'name')
    if name~=nil and not text(name) then return nil end
    return p,text(name)
end
local function unfinishedObjective(quest)
    local objectives=field(quest,'objectives')
    for i=1,OBJECTIVE_CAP do
        local o=field(objectives,i)
        if field(o,'done')==false and text(field(o,'text')) then return field(o,'text') end
    end
end
local function referenceDestination(row,quest,phase)
    if phase=='t' then
        local turnIn=field(row,'turnIn')
        local kind=field(turnIn,'kind')
        if kind~='npc' and kind~='object' then return nil end
        local p,name=observedPoint(turnIn,'observed-turn-in-npc')
        if p then return p,'Approximate reference: observed turn-in '..(kind=='object' and 'object' or 'NPC')..(name and (' '..name) or '')..'.' end
        return nil
    end
    local objectives=field(row,'objectives')
    for i=1,OBJECTIVE_CAP do
        local loc=field(objectives,i)
        local index=integer(field(loc,'index'),1,OBJECTIVE_CAP)
        local current=field(field(quest,'objectives'),index)
        local kind=text(field(loc,'type'),40)
        local required=integer(field(loc,'required'),0,100000)
        if index and kind and required and field(current,'done')==false and field(current,'type')==kind and field(current,'required')==required then
            local p=observedPoint(field(loc,'destination'),'observed-objective-gain')
            if p then return p,'Approximate reference: observed objective progress location.' end
        end
    end
    -- A sole delivery-style NPC mention is an optional objective clue, never a
    -- quest giver or finisher. The compiler excludes monster/item/object targets.
    -- Current game objectives may have changed since that observation.
    for i=1,OBJECTIVE_CAP do
        local kind=field(field(field(quest,'objectives'),i),'type')
        if kind=='monster' or kind=='item' or kind=='gameObject' then return nil end
    end
    local p,name=observedPoint(field(row,'mention'),'mentioned-in-objective')
    if p then return p,'Approximate reference: '..(name or 'NPC')..' mentioned in objective; verify your quest details.' end
end
local function candidate(character,quest,reference)
    local id=integer(field(quest,'id'),1,2147483647)
    local title=text(field(quest,'title'))
    local complete=field(quest,'complete')
    if not id or not title or type(complete)~='boolean' then return nil end
    local phase=complete and 't' or 'o'
    local objective=not complete and unfinishedObjective(quest) or nil
    local step={questId=id,phase=phase,title=title,source=complete and 'game' or (objective and 'game' or 'none')}
    step.detail=complete and 'Ready to turn in. Check your quest log for the turn-in location.'
        or objective or 'Check your quest log for the next objective; objective details are unavailable.'
    local actual=field(quest,'destination')
    local row,alias=referenceRow(reference,character,id,title)
    if actual~=nil then
        -- An explicitly malformed current marker must not be replaced by a
        -- plausible-looking community location.
        step.destination=point(actual)
        if step.destination then
            step.source='game'
            if step.destination.text then step.detail=step.detail..' Game marker: '..step.destination.text..'.' end
        end
    elseif row then
        local destination,detail=referenceDestination(row,quest,phase)
        if destination then
            step.destination=destination;step.source='reference'
            step.detail=(complete and 'Ready to turn in. ' or (step.detail..' '))..detail
            if alias then step.detail=step.detail..' English reference: '..alias..'.' end
        end
    end
    local currentBuild=build(field(character,'clientBuild'))
    if step.destination then
        -- Use the same precision in the preview and the explicit guide command.
        step.destination.x=math.floor(step.destination.x*10000+0.5)/10000
        step.destination.y=math.floor(step.destination.y*10000+0.5)/10000
    end
    if step.destination and currentBuild then
        local d=step.destination
        -- This is inert text. Only the existing explicit click/command handler
        -- may re-check the live quest phase/build and invoke a waypoint API.
        step.command=string.format('/bf guide %d %s %d %.4f %.4f %s',id,phase,d.mapId,d.x,d.y,currentBuild)
    end
    return {step=step,objective=objective~=nil,actual=step.destination~=nil and step.source=='game'}
end
function BackstageForeverBuildPlan(character,options)
    local reference,info=referenceInfo(character)
    local counts={quests=0,ready=0,unfinished=0,invalid=0,limited=false}
    local result={status='unavailable',headline='Quest observations are unavailable.',steps={},counts=counts,reference=info}
    local quests=field(character,'quests')
    if type(quests)~='table' then return result end
    local focus=field(options,'focus')
    if focus~='nearby' and focus~='turn-ins' then focus='balanced' end
    local minutes=field(options,'minutes')
    local cap=minutes==15 and 1 or (minutes==60 and 3 or 2)
    local candidates,seen={},{}
    local location=point(field(character,'location'))
    for i=1,QUEST_CAP do
        local quest=field(quests,i)
        if quest==nil then break end
        local item=candidate(character,quest,reference)
        if not item or seen[item.step.questId] then counts.invalid=counts.invalid+1
        else
            local s=item.step;seen[s.questId]=true;counts.quests=counts.quests+1
            if s.phase=='t' then counts.ready=counts.ready+1 else counts.unfinished=counts.unfinished+1 end
            if focus~='turn-ins' or s.phase=='t' then
                if location and s.destination and location.mapId==s.destination.mapId then
                    item.distance=(location.x-s.destination.x)^2+(location.y-s.destination.y)^2
                end
                candidates[#candidates+1]=item
            end
        end
    end
    counts.limited=field(quests,QUEST_CAP+1)~=nil
    table.sort(candidates,function(a,b)
        local x,y=a.step,b.step
        if focus=='nearby' then
            if (a.distance~=nil)~=(b.distance~=nil) then return a.distance~=nil end
            if a.distance~=nil and b.distance~=nil and a.distance~=b.distance then return a.distance<b.distance end
        end
        if x.phase~=y.phase then return x.phase=='t' end
        if a.actual~=b.actual then return a.actual end
        if a.objective~=b.objective then return a.objective end
        if focus~='nearby' and (a.distance~=nil)~=(b.distance~=nil) then return a.distance~=nil end
        if focus~='nearby' and a.distance~=nil and b.distance~=nil and a.distance~=b.distance then return a.distance<b.distance end
        return x.questId<y.questId
    end)
    for i=1,math.min(cap,#candidates) do result.steps[i]=candidates[i].step end
    local nearby=candidates[1] and candidates[1].distance~=nil
    result.status=#result.steps>0 and 'ready' or 'empty'
    result.headline=#result.steps>0 and (focus=='turn-ins' and 'Ready quest turn-ins' or (focus=='nearby' and nearby and 'Quest steps near your current map position' or 'Your next quest steps'))
        or (focus=='turn-ins' and 'No observed quests are ready to turn in.' or 'No active quest observations yet.')
    return result
end

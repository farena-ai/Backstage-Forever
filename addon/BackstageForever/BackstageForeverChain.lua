-- /bf chain (1.19): where each quest in your log sits in its chain, from the reported follow-up
-- links in the bundled reference. Reported links, not proven prerequisites. Chat only.
local previous
-- Pure: the chain through questId as an ordered list of ids, and the position of questId in it.
function BackstageForeverQuestChain(quests,questId)
    if type(quests)~='table' or type(questId)~='number' or type(rawget(quests,questId))~='table' then return nil end
    if not previous or previous.source~=quests then
        previous={source=quests,of={}}
        for id,row in pairs(quests) do
            local nextId=type(row)=='table' and rawget(row,'next')
            if type(nextId)=='number' and (not previous.of[nextId] or id<previous.of[nextId]) then previous.of[nextId]=id end
        end
    end
    local seen,ids={[questId]=true},{questId}
    local at=questId
    for _=1,40 do
        local before=previous.of[at]
        if not before or seen[before] then break end
        seen[before]=true;table.insert(ids,1,before);at=before
    end
    local position=#ids
    at=questId
    for _=1,40 do
        local row=rawget(quests,at)
        local after=type(row)=='table' and rawget(row,'next')
        if type(after)~='number' or seen[after] or type(rawget(quests,after))~='table' then break end
        seen[after]=true;ids[#ids+1]=after;at=after
    end
    return ids,position
end
-- Pure: one chat line for a quest in a chain, or nil when it stands alone.
function BackstageForeverChainLine(quests,questId,title)
    local ids,position=BackstageForeverQuestChain(quests,questId)
    if not ids or #ids<2 then return nil end
    local T=BackstageForeverTr or tostring
    local name=title or rawget(rawget(quests,questId),'title') or ('#'..questId)
    local line=('%s: %s %d %s %d.'):format(name,T('step'),position,T('of'),#ids)
    local nextId=ids[position+1]
    local nextRow=nextId and rawget(quests,nextId)
    if type(nextRow)=='table' and type(rawget(nextRow,'title'))=='string' then line=line..' '..T('Next:')..' '..rawget(nextRow,'title')..'.'
    elseif not nextId then line=line..' '..T('This is the last step.') end
    return line
end
function BackstageForeverChainCommand()
    local function say(text)
        if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
            DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
        end
    end
    local quests=type(BackstageForeverReference)=='table' and rawget(BackstageForeverReference,'quests')
    local api=C_QuestLog
    if type(quests)~='table' or type(api)~='table' or type(api.GetNumQuestLogEntries)~='function' or type(api.GetInfo)~='function' then
        say('Quest chains are not available in this game client.') return
    end
    local ok,count=pcall(api.GetNumQuestLogEntries)
    local shown=0
    for i=1,ok and type(count)=='number' and math.min(count,60) or 0 do
        local read,info=pcall(api.GetInfo,i)
        if read and type(info)=='table' and info.isHeader==false and type(info.questID)=='number' then
            local title=type(info.title)=='string' and #info.title<=120 and info.title:gsub('|','||') or nil
            local line=BackstageForeverChainLine(quests,info.questID,title)
            if line and shown<10 then shown=shown+1;say(line) end
        end
    end
    if shown==0 then say('None of the quests in your log is part of a known chain.') end
end

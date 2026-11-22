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
-- Pure (1.26, roadmap Q6): the lines a quest tooltip gets, or nil when the quest stands alone:
-- "Step 3 of 7 in its quest chain." and what the chain ends with, by the title of its last quest.
-- The reference knows titles and follow-up links only, so no reward is named.
function BackstageForeverChainTip(quests,questId)
    local ids,position=BackstageForeverQuestChain(quests,questId)
    if not ids or #ids<2 then return nil end
    local T=BackstageForeverTr or tostring
    local lines={T(('Step %d of %d in its quest chain.'):format(position,#ids))}
    if position==#ids then lines[2]=T('This is the last step of the chain.')
    else
        local last=rawget(quests,ids[#ids])
        local title=type(last)=='table' and rawget(last,'title')
        if type(title)=='string' and title~='' and #title<=120 then lines[2]=T('The chain ends with:')..' '..title:gsub('|','||')..'.' end
    end
    return lines
end
-- Pure: the quest id inside a quest link ("quest:123:20" or a whole chat link), or nil.
function BackstageForeverChainLinkQuest(link)
    if type(link)~='string' or #link>400 then return nil end
    local id=tonumber(link:match('^quest:(%d+)') or link:match('|Hquest:(%d+)'))
    if id and id>=1 and id<=2147483647 then return id end
end
function BackstageForeverChainTipsOn()
    local s=BackstageForeverPanelSettings
    return type(s)~='table' or rawget(s,'chainTips')~=false
end
-- Adds the lines to a tooltip the game (or the addon) has just filled. Returns how many were added.
function BackstageForeverChainTooltip(tip,questId)
    if not BackstageForeverChainTipsOn() or type(tip)~='table' or type(tip.AddLine)~='function' then return 0 end
    if type(InCombatLockdown)=='function' then local ok,busy=pcall(InCombatLockdown) if not ok or busy then return 0 end end
    local quests=type(BackstageForeverReference)=='table' and rawget(BackstageForeverReference,'quests')
    if type(quests)~='table' then return 0 end
    local ok,lines=pcall(BackstageForeverChainTip,quests,questId)
    if not ok or type(lines)~='table' then return 0 end
    for _,line in ipairs(lines) do pcall(tip.AddLine,tip,line,.79,.62,.27,true) end
    if type(tip.Show)=='function' then pcall(tip.Show,tip) end
    return #lines
end
function BackstageForeverChainCommand(message)
    local function say(text)
        if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
            DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
        end
    end
    local which,arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^chain%s+(%a+)%s*(%a*)$')
    if which=='tips' then
        if arg=='on' or arg=='off' then
            if type(BackstageForeverPanelSettings)~='table' then BackstageForeverPanelSettings={} end
            BackstageForeverPanelSettings.chainTips=arg=='on'
        end
        say(BackstageForeverChainTipsOn() and 'Chain steps in quest tooltips: on. A quest link shows which step of its chain it is.' or 'Chain steps in quest tooltips: off. /bf chain still lists them.')
        return
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
-- Quest links (chat, quest log) open in the game's link tooltip. hooksecurefunc runs our code after
-- the game's own SetHyperlink; the tooltip only gains lines.
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Chain',events) end
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        pcall(events.SetScript,events,'OnEvent',function()
            if type(hooksecurefunc)~='function' then return end
            for _,name in ipairs({'ItemRefTooltip','GameTooltip'}) do
                local tip=_G[name]
                if type(tip)=='table' and type(tip.SetHyperlink)=='function' then
                    pcall(hooksecurefunc,tip,'SetHyperlink',function(self,link)
                        local ok,id=pcall(BackstageForeverChainLinkQuest,link)
                        if ok and id then pcall(BackstageForeverChainTooltip,self,id) end
                    end)
                end
            end
        end)
    end
end

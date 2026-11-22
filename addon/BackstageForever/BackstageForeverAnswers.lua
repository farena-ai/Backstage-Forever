-- Answers inside the game and "Explain this" (1.26, roadmap A1 and A2).
--   /bf answers        the last answers the companion gave you, read from the desktop hand-off
--   /bf answers 2      one of them in full
--   /bf explain        opens the companion panel with the thing you point at, your target or your
--                      tracked quest in its question box. Nothing is asked until you press Enter.
--   /bf explain WORDS  the same with your own words (an item or quest link works)
--   /bf explain click on|off   Alt-click on an item does the same. Off until you switch it on.
-- The answers come from BackstageForeverDesktop.lua, which the desktop app writes when it prepares
-- the addon; the game reads it at login or /reload, so they are as old as your last reload.
-- The addon never receives an answer while you play and never sends a question for you.
local floor,min=math.floor,math.min
local unpackAll=unpack or table.unpack
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,8 do r[i]=plain(r[i]) end
    return unpackAll(r,2,8)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function method(o,k,...) return call(field(o,k),o,...) end
local function T(s)
    local tr=BackstageForeverTr
    if type(tr)~='function' then return s end
    local ok,r=pcall(tr,s)
    return ok and type(r)=='string' and r or s
end
local PREFIX='Backstage Forever: '
local function emit(line)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,line) end
end
local function say(m) emit('Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
local function combat() return call(InCombatLockdown)==true end

-- ---------------------------------------------------------------- A1 answers
local MAX_ANSWERS,MAX_QUESTION,MAX_ANSWER,LINE,MAX_LINES=5,800,6000,200,30
-- One piece of text from the file: a string, cut to max bytes without splitting a character.
local function text(v,max)
    if type(v)~='string' or v=='' then return nil end
    if #v>max then v=v:sub(1,max):gsub('[\192-\255][\128-\191]*$','') end
    return v~='' and v or nil
end
-- Pure: the answers the desktop sent for this character, newest first: {{q=,a=,t=}}. data is
-- BackstageForeverDesktopData. Anything that is not a clean entry is skipped.
function BackstageForeverAnswersRead(data,name,realm)
    local out={}
    if type(data)~='table' or data.schema~=1 or type(data.characters)~='table' or type(name)~='string' or type(realm)~='string' then return out end
    local row=data.characters[name..'-'..realm]
    local list=type(row)=='table' and row.ans or nil
    if type(list)~='table' then return out end
    for i=1,min(#list,20) do
        local entry=list[i]
        local q=type(entry)=='table' and text(entry.q,MAX_QUESTION)
        local a=type(entry)=='table' and text(entry.a,MAX_ANSWER)
        if q and a and #out<MAX_ANSWERS then
            local t=entry.t
            out[#out+1]={q=q,a=a,t=type(t)=='number' and t==t and t>0 and t<4102444800 and floor(t) or nil}
        end
    end
    return out
end
-- Pure: text as chat lines of at most width bytes. Line breaks are kept, long lines break at a
-- space, control characters go, and | is doubled so nothing in the text can act as a chat code.
function BackstageForeverAnswerWrap(body,width)
    local lines={}
    if type(body)~='string' then return lines end
    width=type(width)=='number' and width>=20 and floor(width) or LINE
    for piece in (body..'\n'):gmatch('(.-)\n') do
        piece=piece:gsub('%c',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
        while #piece>width do
            local cut=piece:sub(1,width):gsub('[\192-\255][\128-\191]*$','')
            local at=cut:match('^.*() ')
            if at and at>width/2 then cut=cut:sub(1,at-1) end
            if cut=='' then break end
            lines[#lines+1]=(cut:gsub('|','||'))
            piece=piece:sub(#cut+1):gsub('^ ','')
        end
        if piece~='' then lines[#lines+1]=(piece:gsub('|','||')) end
    end
    return lines
end
-- Pure: how long ago, in plain words, or nil when either time is not known.
function BackstageForeverAnswerAge(at,now)
    if type(at)~='number' or type(now)~='number' or now<at then return nil end
    local minutes=floor((now-at)/60)
    if minutes<1 then return T('just now') end
    if minutes<60 then return T(('%d min ago'):format(minutes)) end
    if minutes<60*48 then return T(('%d h ago'):format(floor(minutes/60))) end
    return T(('%d days ago'):format(floor(minutes/1440)))
end
-- Pure: the chat lines for /bf answers (index nil: the list) and /bf answers N (one in full).
function BackstageForeverAnswersLines(list,index,now)
    list=type(list)=='table' and list or {}
    if #list==0 then
        return {T('No answers here yet. Ask with /bf ask, let the desktop app prepare the addon, then type /reload.')}
    end
    local lines={}
    if index==nil then
        lines[1]=T(('Your last answers from the companion: %d. They are as of your last /reload.'):format(#list))
        for i,entry in ipairs(list) do
            local q=BackstageForeverAnswerWrap(entry.q,120)[1] or '?'
            local age=BackstageForeverAnswerAge(entry.t,now)
            lines[#lines+1]=('  %d. %s%s'):format(i,q,age and (' ('..age..')') or '')
        end
        lines[#lines+1]=T('Type /bf answers 1 to read the newest in full.')
        return lines
    end
    local entry=type(index)=='number' and list[index] or nil
    if not entry then return {T(('Pick a number from 1 to %d, for example /bf answers 1.'):format(#list))} end
    local age=BackstageForeverAnswerAge(entry.t,now)
    lines[1]=T('You asked:')..' '..(BackstageForeverAnswerWrap(entry.q,160)[1] or '?')..(age and (' ('..age..')') or '')
    local body=BackstageForeverAnswerWrap(entry.a,LINE)
    for i=1,min(#body,MAX_LINES) do lines[#lines+1]='  '..body[i] end
    if #body>MAX_LINES then lines[#lines+1]='  '..T('The rest is in the desktop app.') end
    return lines
end
function BackstageForeverAnswersCommand(message)
    local rest=type(message)=='string' and #message<=40 and message:lower():match('^%a+%s*(.-)%s*$') or ''
    local list=BackstageForeverAnswersRead(BackstageForeverDesktopData,call(UnitName,'player'),call(GetRealmName))
    local index=nil
    if rest~='' then index=tonumber(rest:match('^(%d%d?)$')) or 0 end
    local now=call(time)
    for i,line in ipairs(BackstageForeverAnswersLines(list,index,type(now)=='number' and now or nil)) do
        emit(i==1 and (PREFIX..line) or line)
    end
end

-- ---------------------------------------------------------------- A2 explain this
local EXPLAIN_MAX=180
-- Bytes 1 and 255 in front: 255 is never part of UTF-8 text, so a desktop app that does not know
-- this signal drops it whole instead of asking it as a question.
local FILL='\1\255fill:'
BackstageForeverExplainSignalPrefix=FILL
local function tidy(name)
    local clean=BackstageForeverAskClean
    if type(clean)~='function' then return nil end
    local ok,out=pcall(clean,name)
    return ok and type(out)=='string' and out or nil
end
-- Pure: the text put in the question box. kind: 'item', 'quest', 'npc' or nil for your own words.
function BackstageForeverExplainText(kind,name)
    name=tidy(name)
    if not name then return nil end
    local line=kind=='item' and T(('Explain the item: %s'):format(name)) or kind=='quest' and T(('Explain the quest: %s'):format(name))
        or kind=='npc' and T(('Who is %s?'):format(name)) or name
    line=tidy(line)
    if not line then return nil end
    if type(BackstageForeverAskLength)=='function' and BackstageForeverAskLength(line)>EXPLAIN_MAX then
        local out,n={},0
        for ch in line:gmatch('[\1-\127\194-\244][\128-\191]*') do n=n+1;if n>EXPLAIN_MAX then break end;out[n]=ch end
        line=table.concat(out)
    end
    return line
end
-- Pure: what to explain, the most exact thing first: the item under the mouse, the unit under the
-- mouse, your target, then your tracked quest. found = {item=,unit=,target=,quest=} (names).
function BackstageForeverExplainPick(found)
    found=type(found)=='table' and found or {}
    local function name(v) return type(v)=='string' and v~='' and v or nil end
    if name(found.item) then return 'item',found.item end
    if name(found.unit) then return 'npc',found.unit end
    if name(found.target) then return 'npc',found.target end
    if name(found.quest) then return 'quest',found.quest end
end
-- Pure: the bytes that go on the live strip, or nil.
function BackstageForeverExplainSignal(line)
    if type(line)~='string' or line=='' or #FILL+#line>600 or line:find('%c') then return nil end
    return FILL..line
end
-- Pure: the visible name inside an item or quest link, or nil.
function BackstageForeverLinkName(link)
    if type(link)~='string' or #link>400 then return nil end
    local name=link:match('|h%[(.-)%]|h')
    return name and name~='' and name or nil
end
function BackstageForeverExplainClickOn()
    local s=BackstageForeverAskSettings
    return type(s)=='table' and rawget(s,'explainClick')==true
end
local lastAt=nil
-- Opens the panel with the text filled in. Returns 'sent', 'combat', 'off', 'busy', 'empty' or 'invalid'.
function BackstageForeverExplain(kind,name)
    local line=BackstageForeverExplainText(kind,name)
    local signal=line and BackstageForeverExplainSignal(line)
    if not signal then say('There is nothing to explain here. Point at an item, target someone, or type /bf explain and a few words.') return 'empty' end
    if combat() then say('Explain waits until you leave combat.') return 'combat' end
    local send=BackstageForeverLiveQuestion
    if type(send)~='function' then say('The live link is off, so the desktop app cannot open its panel. Type /bf live on, then try again.') return 'off' end
    local at=call(GetTime)
    if type(at)=='number' and lastAt and at>=lastAt and at-lastAt<2 then return 'busy' end
    local ok,id,why=pcall(send,signal)
    if not ok or not id then
        if why=='off' then say('The live link is off, so the desktop app cannot open its panel. Type /bf live on, then try again.') return 'off' end
        if why=='busy' then say('Still sending your earlier questions; try again in a few seconds.') return 'busy' end
        say('That could not be handed to the desktop app; try fewer words.') return 'invalid'
    end
    lastAt=type(at)=='number' and at or nil
    emit(PREFIX..T('The companion panel opens with this in its question box:')..' "'..line:gsub('|','||')..'". '..T('Nothing is asked until you press Enter there.'))
    return 'sent'
end
local function tooltipItem()
    local tip=plain(GameTooltip)
    if type(tip)~='table' or method(tip,'IsShown')~=true then return nil end
    local name=method(tip,'GetItem')
    return type(name)=='string' and name~='' and name or nil
end
local function trackedQuest()
    local id=call(field(plain(C_SuperTrack),'GetSuperTrackedQuestID'))
    local api=plain(C_QuestLog)
    if type(id)~='number' or id<1 then id=call(field(api,'GetQuestIDForQuestWatchIndex'),1) end
    if type(id)~='number' or id<1 then return nil end
    local title=call(field(api,'GetTitleForQuestID'),id)
    return type(title)=='string' and title~='' and title or nil
end
local function unitName(unit)
    if call(UnitExists,unit)~=true then return nil end
    local name=call(UnitName,unit)
    return type(name)=='string' and name~='' and name or nil
end
function BackstageForeverExplainCommand(message)
    local rest=type(message)=='string' and #message<=600 and message:match('^%a+%s*(.-)%s*$') or ''
    local which,arg=rest:lower():match('^(%a+)%s+(%a+)$')
    if which=='click' and (arg=='on' or arg=='off') then
        if type(BackstageForeverAskSettings)~='table' then BackstageForeverAskSettings={} end
        BackstageForeverAskSettings.explainClick=arg=='on'
        return say(arg=='on' and 'Explain on Alt-click: on. Alt-click an item to put it in the companion panel\'s question box. Nothing is asked for you.'
            or 'Explain on Alt-click: off. /bf explain still works.')
    end
    if rest~='' then return BackstageForeverExplain(nil,BackstageForeverLinkName(rest) or rest) end
    local kind,name=BackstageForeverExplainPick({item=tooltipItem(),unit=unitName('mouseover'),target=unitName('target'),quest=trackedQuest()})
    return BackstageForeverExplain(kind,name)
end
-- The game calls HandleModifiedItemClick itself when you click an item with a modifier key held.
-- hooksecurefunc runs our code after the game's own; the click is only read, never changed.
function BackstageForeverExplainItemClick(link)
    if not BackstageForeverExplainClickOn() or combat() then return false end
    if call(IsAltKeyDown)~=true or call(IsShiftKeyDown)==true or call(IsControlKeyDown)==true then return false end
    local name=BackstageForeverLinkName(plain(link))
    if not name then return false end
    return BackstageForeverExplain('item',name)=='sent'
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Answers',events) end
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        pcall(events.SetScript,events,'OnEvent',function()
            if type(hooksecurefunc)=='function' and type(HandleModifiedItemClick)=='function' then
                pcall(hooksecurefunc,'HandleModifiedItemClick',function(link) pcall(BackstageForeverExplainItemClick,link) end)
            end
        end)
    end
end

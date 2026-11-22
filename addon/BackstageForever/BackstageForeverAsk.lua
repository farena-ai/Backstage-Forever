-- Ask the companion from inside the game (0.38, roadmap A15; one window since 0.39.1).
-- A painted button on the edge of the minimap (drag it around; /bf ask hide|show) and /bf ask open
-- the Backstage Forever panel over the game: the desktop app's own window, where you type the
-- question and read the answer, follow-ups in the same place. The click sends one short "open"
-- signal on the live strip (BackstageForeverLive.lua); /bf ask QUESTION sends the question itself.
-- The addon never receives the answer and sends nothing anywhere else.
-- Never in combat: a question or an open asked in combat waits until combat ends.
-- Own frames and own art only: no Blizzard textures on the button, no hooks, no secure templates,
-- no changes to Blizzard tables.
--   /bf ask                open the companion panel over the game
--   /bf ask QUESTION       send a question straight away (answered in the same panel)
--   /bf ask hide|show      hide or show the minimap button
--   /bf ask cancel         drop a question waiting for combat to end
local floor=math.floor
local MAX_CHARS,MAX_BYTES,RECENT=200,600,5
local ICON='Interface\\AddOns\\BackstageForever\\Art\\Buttons\\ask'
local DEFAULT_ANGLE,BUTTON_SIZE,EDGE=210,28,6

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
    return (unpack or table.unpack)(r,2,8)
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function method(o,k,...)return call(field(o,k),o,...)end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end
local function combat() return call(InCombatLockdown)==true end
local function finite(v) return type(v)=='number' and v==v and v>-1e9 and v<1e9 end

local settings
local function loadSettings()
    if type(BackstageForeverAskSettings)~='table' then BackstageForeverAskSettings={} end
    settings=BackstageForeverAskSettings
    if not finite(settings.angle) then settings.angle=DEFAULT_ANGLE end
    if type(settings.recent)~='table' then settings.recent={} end
    for i=#settings.recent,1,-1 do local r=settings.recent[i] if type(r)~='table' or type(r.text)~='string' then table.remove(settings.recent,i) end end
    while #settings.recent>RECENT do table.remove(settings.recent) end
    return settings
end

-- Pure: the characters of a UTF-8 string (malformed bytes are skipped).
local function chars(text)
    local out={}
    for ch in text:gmatch('[\1-\127\194-\244][\128-\191]*') do
        local b=ch:byte(1)
        local need=(b<128 and 1) or (b<224 and 2) or (b<240 and 3) or 4
        if #ch==need then out[#out+1]=ch end
    end
    return out
end
-- Pure: number of characters in a UTF-8 string.
function BackstageForeverAskLength(text) return type(text)=='string' and #chars(text) or 0 end
-- Pure: what the player typed -> the exact text that goes to the app, or nil when nothing is left.
-- Item and quest links become their visible names ([Linen Cloth]), colour and texture codes go,
-- control characters and runs of spaces become one space, and the text is cut to 200 characters
-- (and 600 bytes) without splitting a character.
function BackstageForeverAskClean(text)
    text=plain(text)
    if type(text)~='string' then return nil end
    text=text:sub(1,4000)
    text=text:gsub('|H.-|h(.-)|h','%1')
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|r',''):gsub('|T.-|t',''):gsub('||','|')
    text=text:gsub('[%z\1-\31\127]',' '):gsub('%s+',' ')
    local out,bytes={},0
    for _,ch in ipairs(chars(text)) do
        if #out>=MAX_CHARS or bytes+#ch>MAX_BYTES then break end
        out[#out+1]=ch bytes=bytes+#ch
    end
    text=table.concat(out):match('^%s*(.-)%s*$')
    if text=='' then return nil end
    return text
end
-- Pure: button angle (degrees, 0 = right, 90 = top) and radius -> offset from the minimap centre.
function BackstageForeverAskButtonOffset(angle,radius)
    local a=math.rad(tonumber(angle) or DEFAULT_ANGLE)
    radius=tonumber(radius) or 80
    return floor(math.cos(a)*radius*100+.5)/100,floor(math.sin(a)*radius*100+.5)/100
end
-- Pure: minimap centre and cursor (same units) -> the button angle in degrees, 0 to 360.
function BackstageForeverAskAngle(cx,cy,px,py)
    local atan2=math.atan2 or math.atan
    local a=math.deg(atan2(py-cy,px-cx))
    if a<0 then a=a+360 end
    return floor(a*10+.5)/10
end

-- Recent questions, newest first: {text, at, status}. Status: sent, waiting, cancelled, off, busy.
local function remember(text,status)
    local recent=settings.recent
    table.insert(recent,1,{text=text,at=call(time) or 0,status=status})
    while #recent>RECENT do table.remove(recent) end
end
local function mark(text,from,to)
    for _,r in ipairs(settings.recent) do if r.text==text and r.status==from then r.status=to return end end
end
local pending -- the question waiting for combat to end
local MESSAGES={
    sent='Sent. The answer appears in the Backstage Forever panel over your game.',
    queued='You are in combat: your question goes to the app as soon as combat ends. Cancel drops it.',
    empty='Type a question first (up to 200 characters).',
    off='The live link is off, so the desktop app cannot read your question. Type /bf live on, then ask again.',
    busy='Still sending your earlier questions; ask again in a few seconds.',
    invalid='That question cannot be sent; shorten it and try again.',
}
function BackstageForeverAskMessage(status) return MESSAGES[status] or MESSAGES.invalid end
-- Sends a question the player chose to send (Ask button, Enter, /bf ask QUESTION).
-- Returns status ('sent', 'queued', 'empty', 'off', 'busy', 'invalid') and the cleaned text.
function BackstageForeverAskSubmit(text)
    if not settings then loadSettings() end
    local clean=BackstageForeverAskClean(text)
    if not clean then return 'empty' end
    if type(BackstageForeverLiveQuestion)~='function' then return 'off',clean end
    if combat() then
        if pending then mark(pending,'waiting','cancelled') end
        pending=clean remember(clean,'waiting')
        return 'queued',clean
    end
    local id,why=BackstageForeverLiveQuestion(clean)
    if not id then
        local status=(why=='off' or why=='busy') and why or 'invalid'
        remember(clean,status)
        return status,clean
    end
    remember(clean,'sent')
    return 'sent',clean
end
-- Drops the question waiting for combat to end. Returns it, or nil when none waits.
function BackstageForeverAskCancel()
    if not settings then loadSettings() end
    local q=pending
    pending=nil
    if q then mark(q,'waiting','cancelled') end
    return q
end
function BackstageForeverAskPending() return pending end

-- Minimap button.
local button
local function radius() local w=method(Minimap,'GetWidth') return (finite(w) and w>0 and w/2 or 70)+EDGE end
local function place()
    if not button then return end
    local x,y=BackstageForeverAskButtonOffset(settings.angle,radius())
    method(button,'ClearAllPoints')
    method(button,'SetPoint','CENTER',Minimap,'CENTER',x,y)
end
local function dragUpdate()
    local mx,my=call(GetCursorPosition)
    local scale=method(Minimap,'GetEffectiveScale')
    local cx,cy=method(Minimap,'GetCenter')
    if not (finite(mx) and finite(my) and finite(scale) and scale>0 and finite(cx) and finite(cy)) then return end
    settings.angle=BackstageForeverAskAngle(cx,cy,mx/scale,my/scale)
    place()
end
local function showButton()
    if not button then return end
    if settings.hidden then method(button,'Hide') else method(button,'Show') end
end
local function buildButton()
    if button or type(CreateFrame)~='function' or type(plain(Minimap))~='table' then return button end
    button=CreateFrame('Button','BackstageForeverAskButton',Minimap)
    if not button then return nil end
    method(button,'SetSize',BUTTON_SIZE,BUTTON_SIZE)
    method(button,'SetFrameStrata','MEDIUM')
    method(button,'SetFrameLevel',8)
    local icon=method(button,'CreateTexture',nil,'ARTWORK')
    if icon then method(icon,'SetAllPoints',button);method(icon,'SetTexture',ICON) end
    local glow=method(button,'CreateTexture',nil,'HIGHLIGHT')
    if glow then method(glow,'SetAllPoints',button);method(glow,'SetTexture',ICON);method(glow,'SetBlendMode','ADD');method(glow,'SetAlpha',.35) end
    method(button,'RegisterForClicks','LeftButtonUp','RightButtonUp')
    method(button,'RegisterForDrag','LeftButton')
    method(button,'SetScript','OnClick',function(_,mouse)
        -- Right-click: the settings window (1.18). Left-click: the companion panel, as before.
        if mouse=='RightButton' and type(BackstageForeverOptionsToggle)=='function' then pcall(BackstageForeverOptionsToggle) return end
        BackstageForeverAskOpen()
    end)
    method(button,'SetScript','OnDragStart',function(self) method(self,'SetScript','OnUpdate',dragUpdate) end)
    method(button,'SetScript','OnDragStop',function(self) method(self,'SetScript','OnUpdate',nil);dragUpdate() end)
    method(button,'SetScript','OnEnter',function(self)
        method(GameTooltip,'SetOwner',self,'ANCHOR_LEFT')
        method(GameTooltip,'SetText','Backstage Forever',1,.82,.3)
        method(GameTooltip,'AddLine','Click: open the companion panel over your game and type your question there.',1,1,1,true)
        method(GameTooltip,'AddLine','Right-click: settings for every helper.',1,1,1,true)
        method(GameTooltip,'AddLine','Drag: move this button around the minimap.',.8,.8,.8,true)
        method(GameTooltip,'Show')
    end)
    method(button,'SetScript','OnLeave',function() method(GameTooltip,'Hide') end)
    place()
    showButton()
    return button
end

-- The open signal: a control byte the question cleaner can never produce, then "open".
local OPEN_SIGNAL='\1open'
BackstageForeverAskOpenSignal=OPEN_SIGNAL
local pendingOpen=false
local OPEN_MESSAGES={
    queued='You are in combat: the companion panel opens when combat ends.',
    off=MESSAGES.off,
    busy=MESSAGES.busy,
    invalid='The companion panel could not be opened; try again in a moment.',
}
-- Opens the companion panel over the game (owl click, /bf ask). Returns 'sent', 'queued', 'off',
-- 'busy' or 'invalid'. Nothing but the open signal is sent.
function BackstageForeverAskOpen()
    if not settings then loadSettings() end
    if type(BackstageForeverLiveQuestion)~='function' then say(OPEN_MESSAGES.off) return 'off' end
    if combat() then pendingOpen=true say(OPEN_MESSAGES.queued) return 'queued' end
    local id,why=BackstageForeverLiveQuestion(OPEN_SIGNAL)
    if not id then local status=(why=='off' or why=='busy') and why or 'invalid' say(OPEN_MESSAGES[status]) return status end
    return 'sent'
end
-- Kept for older keybindings and macros: the owl box is now the panel over the game.
function BackstageForeverAskToggle() return BackstageForeverAskOpen()=='sent' end
-- Sends the question waiting for the end of combat (called when combat ends).
local function flush()
    if combat() then return end
    if pendingOpen then pendingOpen=false BackstageForeverAskOpen() end
    if not pending then return end
    local q=pending
    pending=nil
    mark(q,'waiting','sending')
    local id,why=type(BackstageForeverLiveQuestion)=='function' and BackstageForeverLiveQuestion(q)
    local status=id and 'sent' or ((why=='off' or why=='busy') and why or 'invalid')
    mark(q,'sending',status)
    if status=='sent' then say('combat is over, your question went to the app: '..q:gsub('|','||'))
    else say(BackstageForeverAskMessage(status)) end
    return status
end

function BackstageForeverAskCommand(message)
    if not settings then loadSettings() end
    local rest=type(message)=='string' and message:match('^%s*[Aa][Ss][Kk]%f[%A]%s*(.-)%s*$') or ''
    local word=rest:lower()
    if rest=='' then return 'open:'..BackstageForeverAskOpen() end
    if word=='hide' then
        settings.hidden=true showButton()
        say('minimap button hidden. /bf ask show brings it back; /bf ask still opens the companion panel.')
        return 'hide'
    end
    if word=='show' then
        settings.hidden=nil buildButton() showButton()
        say('minimap button shown. Drag it around the minimap edge to move it.')
        return 'show'
    end
    if word=='cancel' then
        local dropped=BackstageForeverAskCancel()
        pendingOpen=false
        say(dropped and 'your waiting question was dropped; nothing was sent.' or 'no question is waiting.')
        return 'cancel'
    end
    local status,clean=BackstageForeverAskSubmit(rest)
    if status=='sent' or status=='queued' then say('asking the desktop app: "'..clean:gsub('|','||')..'"') end
    say(BackstageForeverAskMessage(status))
    return status
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then loadSettings() pcall(buildButton)
            elseif event=='PLAYER_REGEN_ENABLED' then pcall(flush) end
        end)
    end
end

-- Ask the companion from inside the game (0.38, roadmap A15).
-- A painted button on the edge of the minimap (drag it around; /bf ask hide|show) and /bf ask
-- open a small question box. Only when the player presses Ask (or Enter) does the question go on
-- the live strip (BackstageForeverLive.lua) for the desktop app, which answers in its own panel
-- window over the game. The addon never receives the answer and sends nothing anywhere else.
-- Never in combat: a question asked in combat waits, visibly, until combat ends (Cancel drops it).
-- Own frames and own art only: no Blizzard textures on the button, no hooks, no secure templates,
-- no changes to Blizzard tables. Escape closes the box through its own edit box
-- (OnEscapePressed) rather than by adding the frame to UISpecialFrames, a Blizzard table that the
-- game menu walks; this client blocks addons that touch Blizzard UI state, so we leave it alone.
--   /bf ask                open or close the question box
--   /bf ask QUESTION       send a question straight away (the same rules as the Ask button)
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
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..m) end
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
local button,box,ui
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
    method(button,'RegisterForClicks','LeftButtonUp')
    method(button,'RegisterForDrag','LeftButton')
    method(button,'SetScript','OnClick',function() BackstageForeverAskToggle() end)
    method(button,'SetScript','OnDragStart',function(self) method(self,'SetScript','OnUpdate',dragUpdate) end)
    method(button,'SetScript','OnDragStop',function(self) method(self,'SetScript','OnUpdate',nil);dragUpdate() end)
    method(button,'SetScript','OnEnter',function(self)
        method(GameTooltip,'SetOwner',self,'ANCHOR_LEFT')
        method(GameTooltip,'SetText','Backstage Forever',1,.82,.3)
        method(GameTooltip,'AddLine','Click: ask the companion a question.',1,1,1,true)
        method(GameTooltip,'AddLine','Drag: move this button around the minimap.',.8,.8,.8,true)
        method(GameTooltip,'Show')
    end)
    method(button,'SetScript','OnLeave',function() method(GameTooltip,'Hide') end)
    place()
    showButton()
    return button
end

-- Question box.
local STATUS_WORDS={sent='sent',waiting='waits for combat to end',cancelled='not sent',off='not sent: live link off',busy='not sent: busy',invalid='not sent'}
local function ago(at)
    local now=call(time)
    if not finite(now) or not finite(at) or at<=0 then return '' end
    local s=math.max(0,now-at)
    if s<60 then return 'just now' elseif s<3600 then return floor(s/60)..' min ago' else return floor(s/3600)..' h ago' end
end
-- One line of a question in the box: at most n characters (UTF-8 aware), then an ellipsis.
local function short(text,n)
    if type(text)~='string' then return '' end
    local count,cut=0,nil
    for pos in text:gmatch('()[^\128-\191]') do count=count+1 if count==n+1 then cut=pos break end end
    return cut and (text:sub(1,cut-1)..'...') or text
end
-- The box grows with its text: the status under the buttons, then the recent list, never overlapping.
local function fit()
    if not ui or not box then return end
    local function h(fs,min) local v=tonumber(method(fs,'GetStringHeight')) return (v and v>0) and v or min end
    local total=128+h(ui.status,12)+10+h(ui.recentTitle,12)+4+h(ui.recent,12)+14
    method(box,'SetHeight',math.max(214,floor(total+.5)))
end
local function paintBox(status,clean)
    if not ui then return end
    if status then
        local text=BackstageForeverAskMessage(status)
        if clean and (status=='sent' or status=='queued') then text=text..'\n|cff9d9d9dYou asked:|r '..(short(clean,90):gsub('|','||')) end
        method(ui.status,'SetText',text)
    end
    local lines={}
    for i=1,math.min(3,#settings.recent) do
        local r=settings.recent[i]
        local when=ago(r.at)
        lines[#lines+1]='• '..(short(r.text,64):gsub('|','||'))..' |cff9d9d9d('..(STATUS_WORDS[r.status] or r.status)..(when~='' and ', '..when or '')..')|r'
    end
    method(ui.recent,'SetText',#lines>0 and table.concat(lines,'\n') or '|cff9d9d9dNo questions yet.|r')
    local n=BackstageForeverAskLength(method(ui.edit,'GetText') or '')
    method(ui.count,'SetText',n..'/'..MAX_CHARS)
    fit()
end
local function send()
    if not ui then return end
    local typed=method(ui.edit,'GetText') or ''
    local status,clean=BackstageForeverAskSubmit(typed)
    if status=='sent' or status=='queued' then method(ui.edit,'SetText','') end
    paintBox(status,clean)
    return status
end
local function closeBox()
    if not box then return end
    method(ui.edit,'ClearFocus')
    method(box,'Hide')
end
local function buildBox()
    if box or type(CreateFrame)~='function' then return box end
    box=CreateFrame('Frame','BackstageForeverAskFrame',UIParent)
    if not box then return nil end
    ui={}
    method(box,'SetSize',380,214)
    method(box,'SetPoint','CENTER',UIParent,'CENTER',0,140)
    method(box,'SetFrameStrata','DIALOG')
    method(box,'SetMovable',true);method(box,'EnableMouse',true);method(box,'SetClampedToScreen',true)
    method(box,'RegisterForDrag','LeftButton')
    method(box,'SetScript','OnDragStart',function(f) method(f,'StartMoving') end)
    method(box,'SetScript','OnDragStop',function(f) method(f,'StopMovingOrSizing') end)
    local bg=method(box,'CreateTexture',nil,'BACKGROUND')
    if bg then method(bg,'SetAllPoints',box);method(bg,'SetColorTexture',.09,.05,.03,.94) end
    local edge=method(box,'CreateTexture',nil,'BORDER')
    if edge then method(edge,'SetPoint','TOPLEFT',box,'TOPLEFT',0,0);method(edge,'SetPoint','TOPRIGHT',box,'TOPRIGHT',0,0);method(edge,'SetHeight',2);method(edge,'SetColorTexture',.78,.6,.29,1) end
    local crest=method(box,'CreateTexture',nil,'ARTWORK')
    if crest then method(crest,'SetSize',26,26);method(crest,'SetPoint','TOPLEFT',box,'TOPLEFT',10,-8);method(crest,'SetTexture',ICON) end
    local function text(font,x,y,w)
        local t=method(box,'CreateFontString',nil,'OVERLAY',font)
        if t then method(t,'SetPoint','TOPLEFT',box,'TOPLEFT',x,y);method(t,'SetWidth',w);method(t,'SetJustifyH','LEFT') end
        return t
    end
    ui.title=text('GameFontNormal',42,-14,280)
    method(ui.title,'SetText','Ask the companion')
    local close=CreateFrame('Button','BackstageForeverAskClose',box,'UIPanelButtonTemplate')
    if close then method(close,'SetSize',22,18);method(close,'SetPoint','TOPRIGHT',box,'TOPRIGHT',-6,-8);method(close,'SetText','x');method(close,'SetScript','OnClick',closeBox) end
    local well=method(box,'CreateTexture',nil,'ARTWORK')
    if well then method(well,'SetPoint','TOPLEFT',box,'TOPLEFT',12,-42);method(well,'SetSize',356,26);method(well,'SetColorTexture',0,0,0,.65) end
    ui.edit=CreateFrame('EditBox','BackstageForeverAskInput',box)
    method(ui.edit,'SetPoint','TOPLEFT',box,'TOPLEFT',16,-43)
    method(ui.edit,'SetSize',300,24)
    method(ui.edit,'SetFontObject',plain(ChatFontNormal) or plain(GameFontHighlight))
    method(ui.edit,'SetAutoFocus',false)
    method(ui.edit,'SetMultiLine',false)
    method(ui.edit,'SetMaxLetters',MAX_CHARS)
    method(ui.edit,'SetScript','OnEnterPressed',function() send() end)
    method(ui.edit,'SetScript','OnEscapePressed',closeBox)
    method(ui.edit,'SetScript','OnTextChanged',function() paintBox() end)
    ui.count=text('GameFontDisableSmall',322,-50,44)
    method(ui.count,'SetJustifyH','RIGHT')
    ui.hint=text('GameFontHighlightSmall',12,-74,356)
    method(ui.hint,'SetText','|cff9d9d9dOnly what you type is sent, and only when you press Ask, never in combat. Keep the Backstage Forever app open on this PC.|r')
    local function push(label,x,fn)
        local b=CreateFrame('Button',nil,box,'UIPanelButtonTemplate')
        if b then method(b,'SetSize',84,22);method(b,'SetPoint','TOPLEFT',box,'TOPLEFT',x,-100);method(b,'SetText',label);method(b,'SetScript','OnClick',fn) end
        return b
    end
    ui.ask=push('Ask',12,function() send() end)
    ui.cancel=push('Cancel',100,function()
        local dropped=BackstageForeverAskCancel()
        if dropped then paintBox();method(ui.status,'SetText','Your waiting question was dropped; nothing was sent.') return end
        method(ui.edit,'SetText','')
        closeBox()
    end)
    -- Stacked: each line starts under the one above, however many lines it wraps to.
    ui.status=text('GameFontHighlightSmall',12,-128,356)
    ui.recentTitle=method(box,'CreateFontString',nil,'OVERLAY','GameFontNormalSmall')
    if ui.recentTitle then method(ui.recentTitle,'SetPoint','TOPLEFT',ui.status,'BOTTOMLEFT',0,-10);method(ui.recentTitle,'SetWidth',356);method(ui.recentTitle,'SetJustifyH','LEFT') end
    method(ui.recentTitle,'SetText','Recent questions')
    ui.recent=method(box,'CreateFontString',nil,'OVERLAY','GameFontHighlightSmall')
    if ui.recent then method(ui.recent,'SetPoint','TOPLEFT',ui.recentTitle,'BOTTOMLEFT',0,-4);method(ui.recent,'SetWidth',356);method(ui.recent,'SetJustifyH','LEFT') end
    method(box,'Hide')
    return box
end
function BackstageForeverAskToggle()
    if not settings then loadSettings() end
    if not buildBox() then return false end
    if method(box,'IsShown') then closeBox() return false end
    method(box,'Show')
    method(ui.status,'SetText',pending and MESSAGES.queued or '')
    paintBox()
    method(ui.edit,'SetFocus')
    return true
end
-- Sends the question waiting for the end of combat (called when combat ends).
local function flush()
    if not pending or combat() then return end
    local q=pending
    pending=nil
    mark(q,'waiting','sending')
    local id,why=type(BackstageForeverLiveQuestion)=='function' and BackstageForeverLiveQuestion(q)
    local status=id and 'sent' or ((why=='off' or why=='busy') and why or 'invalid')
    mark(q,'sending',status)
    if status=='sent' then say('combat is over, your question went to the app: '..q:gsub('|','||'))
    else say(BackstageForeverAskMessage(status)) end
    paintBox(status,q)
    return status
end

function BackstageForeverAskCommand(message)
    if not settings then loadSettings() end
    local rest=type(message)=='string' and message:match('^%s*[Aa][Ss][Kk]%f[%A]%s*(.-)%s*$') or ''
    local word=rest:lower()
    if rest=='' then BackstageForeverAskToggle() return 'toggle' end
    if word=='hide' then
        settings.hidden=true showButton()
        say('minimap button hidden. /bf ask show brings it back; /bf ask still opens the question box.')
        return 'hide'
    end
    if word=='show' then
        settings.hidden=nil buildButton() showButton()
        say('minimap button shown. Drag it around the minimap edge to move it.')
        return 'show'
    end
    if word=='cancel' then
        local dropped=BackstageForeverAskCancel()
        say(dropped and 'your waiting question was dropped; nothing was sent.' or 'no question is waiting.')
        paintBox()
        return 'cancel'
    end
    local status,clean=BackstageForeverAskSubmit(rest)
    if status=='sent' or status=='queued' then say('asking the desktop app: "'..clean:gsub('|','||')..'"') end
    say(BackstageForeverAskMessage(status))
    paintBox(status,clean)
    return status
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then loadSettings() pcall(buildButton)
            -- Combat: the keyboard goes back to the game at once (the typed text stays in the box).
            elseif event=='PLAYER_REGEN_DISABLED' then if ui then method(ui.edit,'ClearFocus') end
            elseif event=='PLAYER_REGEN_ENABLED' then pcall(flush) end
        end)
    end
end

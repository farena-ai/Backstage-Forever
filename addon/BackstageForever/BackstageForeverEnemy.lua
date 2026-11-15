-- Enemy player alerts (A10): "Alliance level 32 Rogue nearby" when an enemy player who can attack
-- you shows up as your target, under your mouse or as a nameplate, with a short history.
-- Public unit info only (faction, level, class, name). It never targets, marks, reports or acts.
-- Horde and Alliance alike. /bf enemy shows the history; /bf enemy off silences the alerts.
local floor=math.floor
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
    for i=2,6 do r[i]=plain(r[i]) end
    return (unpack or table.unpack)(r,2,6)
end
local function str(v,max) v=plain(v);if type(v)~='string' or v=='' then return nil end return v:sub(1,max or 40) end
local function num(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end

local HISTORY_MAX,REPEAT_GAP,ALERT_GAP=20,300,4
local settings
local function loadSettings()
    if type(BackstageForeverEnemySettings)~='table' then BackstageForeverEnemySettings={} end
    settings=BackstageForeverEnemySettings
    if settings.enabled==nil then settings.enabled=true end
    if settings.sound==nil then settings.sound=false end
    if type(settings.history)~='table' then settings.history={} end
    return settings
end

-- Pure: {faction,level,class} -> "Alliance level 32 Rogue". Level -1 (a skull) reads "level ??".
function BackstageForeverEnemyDescribe(e)
    if type(e)~='table' then return 'Enemy player' end
    local level=e.level and (e.level<0 and 'level ??' or 'level '..e.level)
    local parts={}
    for _,p in ipairs({e.faction,level,e.class}) do if p then parts[#parts+1]=p end end
    return #parts>0 and table.concat(parts,' ') or 'Enemy player'
end

-- Pure: how long ago, in plain words.
function BackstageForeverEnemyAgo(seconds)
    seconds=type(seconds)=='number' and seconds or 0
    if seconds<60 then return 'just now' end
    if seconds<3600 then return floor(seconds/60)..' min ago' end
    if seconds<172800 then return floor(seconds/3600)..' h ago' end
    return floor(seconds/86400)..' days ago'
end

-- Pure: remembers a sighting in state {history,lastAlert} and says whether to alert.
-- The same player alerts again only after 5 minutes away; alerts are at least 4s apart
-- (a group of five shows one alert, and every one of them still lands in the history).
function BackstageForeverEnemyNote(state,e,now)
    if type(state)~='table' or type(e)~='table' or not e.name then return false end
    if type(state.history)~='table' then state.history={} end
    local h=state.history
    local found
    for i,x in ipairs(h) do if x.name==e.name then found=x table.remove(h,i) break end end
    local fresh=not found or (now-(found.last or 0))>=REPEAT_GAP
    local entry=found or {name=e.name,first=now,count=0}
    entry.faction=e.faction or entry.faction;entry.class=e.class or entry.class
    if e.level then entry.level=e.level end
    entry.zone=e.zone or entry.zone
    if fresh then entry.count=(entry.count or 0)+1 end
    entry.last=now
    table.insert(h,1,entry)
    while #h>HISTORY_MAX do table.remove(h) end
    if not fresh then return false end
    if state.lastAlert and now-state.lastAlert<ALERT_GAP then return false end
    state.lastAlert=now
    return true
end

-- Reads a unit, or nil unless it is an enemy player who can attack you right now.
local function readUnit(unit)
    if call(UnitExists,unit)~=true or call(UnitIsPlayer,unit)~=true then return nil end
    if call(UnitIsUnit,unit,'player')==true then return nil end
    if call(UnitCanAttack,unit,'player')~=true then return nil end
    local faction=str(call(UnitFactionGroup,unit),20)
    if faction and faction==str(call(UnitFactionGroup,'player'),20) then return nil end
    local name=str(call(UnitName,unit),40)
    if not name then return nil end
    return {name=name,faction=faction,level=num(call(UnitLevel,unit),-1,1000),class=str(call(UnitClass,unit),30),zone=str(call(GetRealZoneText),60)}
end

local function clock() return num(call(time),0,10^11) or num(call(GetTime),0,10^11) or 0 end
local function battleground()
    local _,kind=call(IsInInstance)
    return kind=='pvp' or kind=='arena'
end

local banner
local function showBanner(line)
    if type(CreateFrame)~='function' then return say(line) end
    if not banner then
        local parent=plain(UIParent)
        banner=CreateFrame('Frame',nil,parent)
        if not banner then return say(line) end
        pcall(banner.SetSize,banner,640,40)
        pcall(banner.SetPoint,banner,'TOP',parent,'TOP',0,-190)
        pcall(banner.SetFrameStrata,banner,'HIGH')
        banner.text=banner:CreateFontString(nil,'OVERLAY','GameFontNormalHuge')
        pcall(banner.text.SetPoint,banner.text,'CENTER')
        pcall(banner.text.SetTextColor,banner.text,1,.32,.24)
        pcall(banner.text.SetShadowOffset,banner.text,2,-2)
        pcall(banner.SetScript,banner,'OnUpdate',function(self,elapsed)
            self.left=(self.left or 0)-(elapsed or 0)
            if self.left<=0 then self:Hide() elseif self.left<1 then self:SetAlpha(self.left) end
        end)
    end
    pcall(banner.text.SetText,banner.text,line)
    banner.left=5
    pcall(banner.SetAlpha,banner,1)
    pcall(banner.Show,banner)
end

local function seen(unit)
    if not settings then loadSettings() end
    if not settings.enabled or battleground() then return end
    local e=readUnit(unit)
    if not e then return end
    if BackstageForeverEnemyNote(settings,e,clock()) then
        local line=BackstageForeverEnemyDescribe(e)..' nearby'
        pcall(showBanner,line)
        say('|cffff5040'..line..'|r: '..e.name..(e.zone and (' in '..e.zone) or '')..'.')
        if settings.sound then local kit=plain(SOUNDKIT);call(PlaySound,type(kit)=='table' and plain(kit.RAID_WARNING) or 8959) end
    end
end
BackstageForeverEnemySeen=seen

function BackstageForeverEnemyCommand(message)
    if not settings then loadSettings() end
    local rest=type(message)=='string' and message:lower():match('^enemy%s*(.*)$') or ''
    rest=rest:gsub('%s+$','')
    if rest=='on' or rest=='off' then settings.enabled=rest=='on';return say('Enemy player alerts '..(settings.enabled and 'on.' or 'off.')) end
    if rest=='sound on' or rest=='sound off' then settings.sound=rest=='sound on';return say('Enemy alert sound '..(settings.sound and 'on.' or 'off.')) end
    if rest=='clear' then settings.history={};return say('Enemy player history cleared.') end
    local h=settings.history
    say('Enemy player alerts '..(settings.enabled and 'on' or 'off')..(settings.sound and ', with sound' or '')..'. '..(#h==0 and 'No enemy players seen yet.' or 'Recently seen:'))
    local now=clock()
    for i=1,math.min(#h,8) do
        local x=h[i]
        say(('  %s, %s%s, %s%s'):format(x.name,BackstageForeverEnemyDescribe(x),x.zone and (' in '..x.zone) or '',BackstageForeverEnemyAgo(now-(x.last or now)),(x.count or 1)>1 and (' (seen '..x.count..' times)') or ''))
    end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT','NAME_PLATE_UNIT_ADDED'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a)
            if event=='PLAYER_LOGIN' then loadSettings() return end
            if event=='PLAYER_TARGET_CHANGED' then pcall(seen,'target')
            elseif event=='UPDATE_MOUSEOVER_UNIT' then pcall(seen,'mouseover')
            elseif event=='NAME_PLATE_UNIT_ADDED' then a=plain(a) if type(a)=='string' then pcall(seen,a) end end
        end)
    end
end

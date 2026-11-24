-- Quality of life pack (A11). Four small helpers, each OFF until you switch it on with /bf qol:
--   coords     your map coordinates under the minimap
--   loot       faster auto-loot: when the game would auto-loot anyway, every slot is taken at once
--   dismount   get off your mount when you open a flight master's map (out of combat only)
--   questtext  show quest text instantly instead of fading it in (the game's own setting)
-- Public API only. It never accepts, completes or picks a quest, and never loots unless the
-- game's own auto-loot (or your auto-loot key) says so. It never replaces Blizzard functions.
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
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function()return t[k]end);if ok then return plain(v) end
end
local function num(v,lo,hi) v=plain(v);if type(v)=='number' and v==v and v>=lo and v<=hi then return v end end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end

local HELPERS={'coords','loot','dismount','questtext'}
local NAMES={coords='Coordinates under the minimap',loot='Faster auto-loot',dismount='Dismount at flight masters',questtext='Instant quest text'}
local QUEST_CVAR='questFadingDisable'
BackstageForeverQoLHelpers=HELPERS

local settings
local function loadSettings()
    if type(BackstageForeverQoLSettings)~='table' then BackstageForeverQoLSettings={} end
    settings=BackstageForeverQoLSettings
    for _,k in ipairs(HELPERS) do if settings[k]==nil then settings[k]=false end end
    return settings
end

-- Pure: map position (0..1) -> "42.3, 67.8"; nil when the game gives no position (instances).
function BackstageForeverQoLCoords(x,y)
    if type(x)~='number' or type(y)~='number' or x~=x or y~=y or (x==0 and y==0) or x<0 or x>1 or y<0 or y>1 then return nil end
    return ('%.1f, %.1f'):format(floor(x*1000+.5)/10,floor(y*1000+.5)/10)
end

-- Pure: should the loot window be emptied straight away? Only when the game itself is
-- auto-looting: auto-loot on (or the LOOT_READY flag says so), flipped by the auto-loot key.
function BackstageForeverQoLAutoLoot(eventFlag,autoLootDefault,toggleKeyDown)
    if eventFlag==true then return true end
    if eventFlag==false then return false end
    return (autoLootDefault==true)~=(toggleKeyDown==true)
end

local function cvarBool(name)
    local v=call(GetCVar,name)
    if v==nil then return nil end
    return v=='1'
end

local coordFrame
local function updateCoords()
    if not settings.coords then if coordFrame then pcall(coordFrame.Hide,coordFrame) end return end
    if not coordFrame then
        local minimap=plain(Minimap)
        coordFrame=call(CreateFrame,'Frame','BackstageForeverCoords',plain(UIParent))
        if not coordFrame then return end
        pcall(coordFrame.SetSize,coordFrame,90,16)
        if minimap then pcall(coordFrame.SetPoint,coordFrame,'TOP',minimap,'BOTTOM',0,-4) else pcall(coordFrame.SetPoint,coordFrame,'TOPRIGHT',plain(UIParent),'TOPRIGHT',-60,-200) end
        coordFrame.text=coordFrame:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        pcall(coordFrame.text.SetPoint,coordFrame.text,'CENTER')
        local wait=0
        pcall(coordFrame.SetScript,coordFrame,'OnUpdate',function(self,elapsed)
            wait=wait-(elapsed or 0);if wait>0 then return end;wait=.2
            local api=plain(C_Map)
            local map=num(call(field(api,'GetBestMapForUnit'),'player'),1,2147483647)
            local pos=map and call(field(api,'GetPlayerMapPosition'),map,'player')
            local x,y
            if pos then local getXY=field(pos,'GetXY');if getXY then x,y=call(getXY,pos) end end
            pcall(self.text.SetText,self.text,BackstageForeverQoLCoords(x,y) or '')
        end)
    end
    pcall(coordFrame.Show,coordFrame)
end

local function applyQuestText(on)
    if cvarBool(QUEST_CVAR)==nil then return false end
    if on then
        if settings.questtextBefore==nil then settings.questtextBefore=call(GetCVar,QUEST_CVAR) end
        call(SetCVar,QUEST_CVAR,'1')
    elseif settings.questtextBefore~=nil then
        call(SetCVar,QUEST_CVAR,settings.questtextBefore);settings.questtextBefore=nil
    end
    return true
end

local function fastLoot(flag)
    if not settings.loot then return end
    local key=call(IsModifiedClick,'AUTOLOOTTOGGLE')
    if not BackstageForeverQoLAutoLoot(flag,cvarBool('autoLootDefault'),key) then return end
    local n=num(call(GetNumLootItems),0,100) or 0
    for i=n,1,-1 do call(LootSlot,i) end
end

local function dismount()
    if not settings.dismount or call(InCombatLockdown)==true then return end
    if call(IsMounted)==true then call(Dismount) end
end

function BackstageForeverQoLCommand(message)
    if not settings then loadSettings() end
    local which,arg=(type(message)=='string' and message:lower() or ''):match('^qol%s*(%a*)%s*(%a*)')
    if which and NAMES[which] then
        local on
        if arg=='on' then on=true elseif arg=='off' then on=false else on=not settings[which] end
        if which=='questtext' and not applyQuestText(on) then return say('Instant quest text is not available in this game client.') end
        settings[which]=on
        if which=='coords' then pcall(updateCoords) end
        return say(NAMES[which]..(on and ' on.' or ' off.'))
    end
    say('Quality of life helpers (each off until you switch it on):')
    for _,k in ipairs(HELPERS) do say(('  %s: %s (/bf qol %s %s)'):format(NAMES[k],settings[k] and 'on' or 'off',k,settings[k] and 'off' or 'on')) end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','LOOT_READY','TAXIMAP_OPENED','UI_ERROR_MESSAGE'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'QoL',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b)
            if not settings then loadSettings() end
            if event=='PLAYER_LOGIN' then
                pcall(updateCoords)
                if settings.questtext then pcall(applyQuestText,true) end
            elseif event=='LOOT_READY' then pcall(fastLoot,plain(a))
            elseif event=='TAXIMAP_OPENED' then pcall(dismount)
            elseif event=='UI_ERROR_MESSAGE' then
                local msg=plain(b) or plain(a)
                local mounted=plain(ERR_TAXIPLAYERALREADYMOUNTED)
                if mounted and msg==mounted then pcall(dismount) end
            end
        end)
    end
end

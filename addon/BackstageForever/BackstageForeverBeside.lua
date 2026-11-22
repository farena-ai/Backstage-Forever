-- Works beside other addons (1.25, roadmap F7): looks which well-known addons are running and
-- steps aside where two would draw the same thing.
--   /bf addons          what was found and what Backstage Forever changed because of it
--   /bf addons on|off   stepping aside (on until you switch it off)
-- It only ever changes Backstage Forever's own switches, once, and says so in one chat line with
-- the command that turns the thing back on. A switch you turn back on is never touched again.
-- It never changes, hides or talks to another addon.
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    fn=plain(fn);if type(fn)~='function' then return nil end
    local ok,a=pcall(fn,...)
    if ok then return plain(a) end
end
local function field(t,k)
    t=plain(t);if type(t)~='table' and type(t)~='userdata' then return nil end
    local ok,v=pcall(function() return t[k] end);if ok then return plain(v) end
end
local function T(s)
    local tr=BackstageForeverTr
    if type(tr)~='function' then return s end
    local ok,r=pcall(tr,s)
    return ok and type(r)=='string' and r or s
end
local function say(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end
end

-- ---------------------------------------------------------------- what is known
-- Folder name, kind, and which Backstage Forever feature steps aside for it (if any).
local ADDONS={
    {'Questie','quest',{'minimap','plates'}},
    {'pfQuest','quest',{'minimap'}},
    {'ClassicCodex','quest',{'minimap'}},
    {'Guidelime','guide'},
    {'RXPGuides','guide'},
    {'TomTom','way',{'way'}},
    {'Bagnon','bags'},{'Baganator','bags'},{'ArkInventory','bags'},{'AdiBags','bags'},{'OneBag3','bags'},{'Inventorian','bags'},
    {'ElvUI','ui'},{'Tukui','ui'},{'GW2_UI','ui'},{'pfUI','ui'},
    {'Leatrix_Maps','map'},{'Mapster','map'},{'Leatrix_Plus','comfort'},
    {'AtlasLootClassic','loot'},{'AtlasLoot','loot'},
    {'Auctionator','auction',{'shop'}},{'TradeSkillMaster','auction',{'shop'}},{'Auc-Advanced','auction',{'shop'}},
    {'LFGBulletinBoard','lfg'},
    {'DBM-Core','boss'},{'BigWigs','boss'},
}
local KIND={quest='quest helper',guide='leveling guide',way='waypoints',bags='bags',ui='interface',map='map',comfort='comfort',
    loot='loot lists',auction='auction house',lfg='group finder',boss='boss warnings'}
-- The features that can step aside: the saved switch behind each and the words for it.
local FEATURES={
    {key='minimap',saved='BackstageForeverMinimapSettings',field='enabled',label='Minimap pins',command='/bf minimap on',
        off='%s also draws quest pins on the minimap, so ours are off. /bf minimap on turns them back on.'},
    {key='plates',saved='BackstageForeverRouteSettings',field='plates',label='Quest icons over enemies',command='/bf plates on',
        off='%s also marks quest enemies, so our quest icons over enemies are off. /bf plates on turns them back on.'},
    {key='shop',saved='BackstageForeverShopSettings',field='enabled',label='Auction shopping list',command='/bf shop on',
        off='%s has its own shopping list, so ours stays closed at the auction house. /bf shop on turns it back on.'},
}
BackstageForeverBesideAddons=ADDONS
BackstageForeverBesideFeatures=FEATURES

-- ---------------------------------------------------------------- pure
-- Pure: isLoaded(name) -> true when that addon runs. -> the known addons that do: {name=,kind=,yields={}}.
function BackstageForeverBesideDetect(isLoaded)
    local found={}
    if type(isLoaded)~='function' then return found end
    for _,row in ipairs(ADDONS) do
        local ok,loaded=pcall(isLoaded,row[1])
        if ok and loaded==true then found[#found+1]={name=row[1],kind=row[2],yields=row[3] or {}} end
    end
    return found
end
-- Pure: the first running addon a feature steps aside for, or nil.
function BackstageForeverBesideBecause(detected,feature)
    for _,addon in ipairs(type(detected)=='table' and detected or {}) do
        for _,key in ipairs(addon.yields or {}) do if key==feature then return addon.name end end
    end
end
-- Pure: the decision table. current[feature] = is that switch on now; memory[feature] = 'yielded'
-- (we switched it off) or 'kept' (the player's own choice stands); enabled: the master switch.
-- -> actions {{feature=,action='off'|'on',because=}}, and the memory to keep.
--   another addon runs, never decided, switch on    -> off, remember 'yielded'
--   another addon runs, never decided, switch off   -> nothing, remember 'kept' (you had it off yourself)
--   'yielded' and you switched it back on           -> nothing, remember 'kept'
--   'yielded', the other addon is gone (or stepping aside is off), still off -> on again, forget
--   'kept'                                          -> nothing, until the other addon is gone
function BackstageForeverBesideDecide(detected,current,memory,enabled)
    local actions,keep={},{}
    current=type(current)=='table' and current or {}
    memory=type(memory)=='table' and memory or {}
    for _,feature in ipairs(FEATURES) do
        local key=feature.key
        local because=enabled~=false and BackstageForeverBesideBecause(detected,key) or nil
        local was=memory[key]
        if because then
            if was=='kept' then keep[key]='kept'
            elseif was=='yielded' then keep[key]=current[key]==true and 'kept' or 'yielded'
            elseif current[key]==false then keep[key]='kept'
            else actions[#actions+1]={feature=key,action='off',because=because};keep[key]='yielded' end
        elseif was=='yielded' and current[key]==false then
            actions[#actions+1]={feature=key,action='on'}
        elseif was=='kept' and enabled==false then keep[key]='kept' end
    end
    return actions,keep
end
local function featureOf(key) for _,feature in ipairs(FEATURES) do if feature.key==key then return feature end end end
-- Pure: the one chat line for an action.
function BackstageForeverBesideLine(action)
    local feature=type(action)=='table' and featureOf(action.feature)
    if not feature then return nil end
    if action.action=='off' then return T(feature.off:format(tostring(action.because))) end
    return T(('%s: back on. The addon it stepped aside for is no longer running.'):format(T(feature.label)))
end
-- Pure: the chat lines for /bf addons.
function BackstageForeverBesideLines(detected,memory,enabled,way)
    detected=type(detected)=='table' and detected or {}
    memory=type(memory)=='table' and memory or {}
    if #detected==0 then return {T('None of the addons Backstage Forever knows about is running. Nothing was changed.')} end
    local names={}
    for _,addon in ipairs(detected) do names[#names+1]=('%s (%s)'):format(addon.name,T(KIND[addon.kind] or addon.kind)) end
    local lines={T('Other addons found:')..' '..table.concat(names,', ')..'.'}
    if enabled==false then lines[#lines+1]='  '..T('Stepping aside is off: Backstage Forever changes nothing because of them. /bf addons on turns it on.') return lines end
    local changed=false
    for _,feature in ipairs(FEATURES) do
        local because=BackstageForeverBesideBecause(detected,feature.key)
        if because and memory[feature.key]=='yielded' then
            changed=true
            lines[#lines+1]='  '..T(('%s: off because of %s. %s turns it back on.'):format(T(feature.label),because,feature.command))
        elseif because and memory[feature.key]=='kept' then
            changed=true
            lines[#lines+1]='  '..T(('%s: left as you set it, beside %s.'):format(T(feature.label),because))
        end
    end
    if way then changed=true;lines[#lines+1]='  '..T(('/way is left to %s. /bf way still works.'):format(way)) end
    for _,addon in ipairs(detected) do
        if addon.kind=='bags' then lines[#lines+1]='  '..T(('Bag marks are drawn on the game\'s own bags only, not in the windows of %s.'):format(addon.name)) changed=true break end
    end
    if not changed then lines[#lines+1]='  '..T('Nothing needed changing.') end
    return lines
end

-- ---------------------------------------------------------------- live
local function loaded(name)
    local fn=field(plain(C_AddOns),'IsAddOnLoaded')
    if type(fn)=='function' then return call(fn,name)==true end
    return call(IsAddOnLoaded,name)==true
end
local function settings()
    if type(BackstageForeverBesideSettings)~='table' then BackstageForeverBesideSettings={} end
    return BackstageForeverBesideSettings
end
function BackstageForeverBesideEnabled()
    local s=BackstageForeverBesideSettings
    return type(s)~='table' or rawget(s,'enabled')~=false
end
-- /way: decided each login, nothing to remember. BackstageForeverOptions.lua asks before it registers /way.
function BackstageForeverBesideYields(feature)
    if not BackstageForeverBesideEnabled() then return nil end
    return BackstageForeverBesideBecause(BackstageForeverBesideDetect(loaded),feature)
end
local function isOn(feature)
    local saved=_G[feature.saved]
    local value
    if type(saved)=='table' then value=rawget(saved,feature.field) end
    return value~=false
end
local function setOn(feature,on)
    if type(_G[feature.saved])~='table' then _G[feature.saved]={} end
    _G[feature.saved][feature.field]=on
    if feature.key=='plates' and type(BackstageForeverPlatesRefresh)=='function' then pcall(BackstageForeverPlatesRefresh) end
end
local function apply(quiet)
    local s=settings()
    local current={}
    for _,feature in ipairs(FEATURES) do current[feature.key]=isOn(feature) end
    local actions,keep=BackstageForeverBesideDecide(BackstageForeverBesideDetect(loaded),current,s.memory,BackstageForeverBesideEnabled())
    for _,action in ipairs(actions) do
        local feature=featureOf(action.feature)
        setOn(feature,action.action=='on')
        if not quiet then say(BackstageForeverBesideLine(action)) end
    end
    s.memory=keep
    return actions
end
BackstageForeverBesideApply=apply -- for tests
function BackstageForeverBesideCommand(message)
    local arg=type(message)=='string' and #message<=40 and message:lower():match('^%a+%s+(%a+)') or nil
    if arg=='on' or arg=='off' then
        if call(InCombatLockdown)==true then return say('Change this outside combat.') end
        settings().enabled=arg=='on'
        say(arg=='on' and 'Stepping aside for other addons: on.' or 'Stepping aside for other addons: off. What it had switched off is back on.')
        apply(false)
        return arg=='on'
    end
    local detected=BackstageForeverBesideDetect(loaded)
    local enabled=BackstageForeverBesideEnabled()
    for _,line in ipairs(BackstageForeverBesideLines(detected,settings().memory,enabled,enabled and BackstageForeverBesideBecause(detected,'way') or nil)) do say(line) end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Beside',events) end
        pcall(events.SetScript,events,'OnEvent',function()
            settings()
            -- A moment after login, so every addon and every saved switch is in place. Never in combat.
            local function run() if call(InCombatLockdown)~=true then pcall(apply,false) end end
            local after=field(plain(C_Timer),'After')
            if type(after)~='function' or not pcall(after,3,run) then run() end
        end)
    end
end

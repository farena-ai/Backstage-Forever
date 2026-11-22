-- Performance per module (1.26, roadmap F8). /bf perf on times every module's event handler;
-- /bf perf then lists events and milliseconds per module and marks one that is over its budget.
-- Off until you switch it on, and off again after /bf perf off: while it is off the handlers are
-- the modules' own functions, untouched, so there is no cost at all.
-- How it works: each module hands its event frame to BackstageForeverPerfFrame when it loads (one
-- table entry). Switching the readout on puts a timing function around the frame's own OnEvent
-- handler; switching it off puts the original back. Only the addon's own frames are touched.
local floor=math.floor
local MAX_FRAMES=200
local frames,stats,wrapped,on={},{},{},false
BackstageForeverPerfStats=stats

-- Average milliseconds per event a module should stay under. First estimates, to be tightened
-- with numbers from real play; tests/addon-perf.test.cjs keeps the table and the modules in step.
local BUDGET={default=2,Capture=25,HUD=8,Live=4,Gear=6,Ledger=8,Journal=6,Gathering=6,Panels=6,QuestIntel=6}
BackstageForeverPerfBudget=BUDGET

-- Pure: the budget of one module in ms per event.
function BackstageForeverPerfBudgetFor(name,budget)
    budget=type(budget)=='table' and budget or BUDGET
    local own=budget[name] or (type(name)=='string' and budget[(name:gsub('%d+$',''))])
    return type(own)=='number' and own or budget.default
end
-- Pure: adds one timed event to a module's numbers.
function BackstageForeverPerfAdd(all,name,ms)
    if type(all)~='table' or type(name)~='string' then return end
    local row=all[name]
    if not row then row={events=0,ms=0,worst=0};all[name]=row end
    row.events=row.events+1
    if type(ms)=='number' and ms==ms and ms>=0 then
        row.ms=row.ms+ms
        if ms>row.worst then row.worst=ms end
    end
end
-- Pure: the modules whose average per event is over budget, slowest first: {{name=,each=,budget=}}.
function BackstageForeverPerfOver(all,budget)
    local out={}
    for name,row in pairs(type(all)=='table' and all or {}) do
        if type(row)=='table' and type(row.events)=='number' and row.events>0 and type(row.ms)=='number' then
            local each,limit=row.ms/row.events,BackstageForeverPerfBudgetFor(name,budget)
            if type(limit)=='number' and each>limit then out[#out+1]={name=name,each=each,budget=limit} end
        end
    end
    table.sort(out,function(a,b) if a.each~=b.each then return a.each>b.each end return a.name<b.name end)
    return out
end
-- Pure: the chat lines for /bf perf, the module that used the most time first.
function BackstageForeverPerfLines(all,budget,limit)
    local T=BackstageForeverTr or tostring
    local rows,events,ms={},0,0
    for name,row in pairs(type(all)=='table' and all or {}) do
        if type(row)=='table' and type(row.events)=='number' and row.events>0 then
            rows[#rows+1]={name=name,events=row.events,ms=row.ms or 0,worst=row.worst or 0}
            events=events+row.events;ms=ms+(row.ms or 0)
        end
    end
    if #rows==0 then return {T('No events timed yet. Play for a minute, then type /bf perf again.')} end
    table.sort(rows,function(a,b) if a.ms~=b.ms then return a.ms>b.ms end return a.name<b.name end)
    limit=type(limit)=='number' and limit or 10
    local lines={T(('Timed %d events in %d modules: %.1f ms in all.'):format(events,#rows,ms))}
    for i=1,math.min(#rows,limit) do
        local r=rows[i]
        local each,cap=r.ms/r.events,BackstageForeverPerfBudgetFor(r.name,budget)
        local line=('  %s: %d, %.1f ms, %.2f ms %s, %s %.1f ms'):format(r.name,r.events,r.ms,each,T('each'),T('slowest'),r.worst)
        if type(cap)=='number' and each>cap then line=line..' - '..T(('over its budget of %.1f ms each'):format(cap)) end
        lines[#lines+1]=line
    end
    if #rows>limit then lines[#lines+1]='  '..T(('and %d more.'):format(#rows-limit)) end
    return lines
end

local function wrap(entry)
    local frame=entry.frame
    if wrapped[frame] or type(frame)~='table' or type(frame.GetScript)~='function' or type(frame.SetScript)~='function' then return false end
    local ok,original=pcall(frame.GetScript,frame,'OnEvent')
    if not ok or type(original)~='function' then return false end
    local name,clock=entry.name,debugprofilestop
    local timed=type(clock)=='function'
    local function wrapper(...)
        if not timed then BackstageForeverPerfAdd(stats,name,nil) return original(...) end
        local start=clock()
        original(...)
        local took=clock()-start
        BackstageForeverPerfAdd(stats,name,took)
    end
    if not pcall(frame.SetScript,frame,'OnEvent',wrapper) then return false end
    wrapped[frame]={original=original,wrapper=wrapper}
    return true
end
local function unwrap(frame)
    local w=wrapped[frame]
    if not w then return end
    wrapped[frame]=nil
    -- A module that replaced its handler in the meantime keeps its new one.
    local ok,current=pcall(frame.GetScript,frame,'OnEvent')
    if ok and current==w.wrapper then pcall(frame.SetScript,frame,'OnEvent',w.original) end
end
-- Each module calls this once for its event frame, just before it sets its handler.
function BackstageForeverPerfFrame(name,frame)
    if type(name)~='string' or name=='' or #name>40 or type(frame)~='table' or #frames>=MAX_FRAMES then return false end
    local entry={name=name,frame=frame}
    frames[#frames+1]=entry
    if on then
        -- The handler is set on the next line of the module; wrap it a moment later.
        local after=type(C_Timer)=='table' and C_Timer.After
        if type(after)=='function' then pcall(after,0,function() if on then pcall(wrap,entry) end end) end
    end
    return true
end
function BackstageForeverPerfModules()
    local names={}
    for i,entry in ipairs(frames) do names[i]=entry.name end
    return names
end
function BackstageForeverPerfOn() return on end
-- Switches the timing on or off. Returns how many handlers are timed now.
function BackstageForeverPerfSet(value)
    on=value==true
    local n=0
    for _,entry in ipairs(frames) do
        if on then pcall(wrap,entry) else pcall(unwrap,entry.frame) end
        if wrapped[entry.frame] then n=n+1 end
    end
    if on then for name in pairs(stats) do stats[name]=nil end end
    return n
end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
-- /bf perf on|off and the module lines of /bf perf. Returns true when it handled the command.
function BackstageForeverPerfModuleCommand(message)
    local arg=(type(message)=='string' and #message<=40 and message:lower() or ''):match('^perf%s+(%a+)%s*$')
    if arg=='on' or arg=='off' then
        if type(InCombatLockdown)=='function' then local ok,busy=pcall(InCombatLockdown) if not ok or busy then say('Switch the timing outside combat.') return true end end
        if type(BackstageForeverPerfSettings)~='table' then BackstageForeverPerfSettings={} end
        BackstageForeverPerfSettings.on=arg=='on'
        local n=BackstageForeverPerfSet(arg=='on')
        if arg=='on' then say(('Timing is on for %d event handlers. Play for a while, then type /bf perf. /bf perf off stops it.'):format(n))
        else say('Timing is off. Nothing is measured and nothing is slowed.') end
        return true
    end
    if not on then say('Module timing is off. /bf perf on measures events and time per module.') return false end
    for _,line in ipairs(BackstageForeverPerfLines(stats,BUDGET)) do say(line) end
    return false
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        pcall(events.SetScript,events,'OnEvent',function()
            -- This frame was made first, so a saved "on" wraps every module before its own login work runs.
            local s=BackstageForeverPerfSettings
            if type(s)=='table' and rawget(s,'on')==true then pcall(BackstageForeverPerfSet,true) end
        end)
    end
end

-- Lockouts (roadmap "Dungeons and raids": lockout and reset calendar). Which raids and dungeons
-- this character is saved to and when each resets, as the game's own list of saved instances
-- tells it. /bf lockouts prints them, with your other characters as they were last saved.
-- The list rides to the desktop app in the saved file, in a block of its own, and shows on its
-- Calendar. Reading only. When the game client has no list of saved instances, this says so.
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
    for i=2,15 do r[i]=plain(r[i]) end
    return unpackAll(r,2,15)
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

-- ---------------------------------------------------------------- pure
local MAX,NAME_MAX,T_MIN,T_MAX,RESET_MAX=40,60,1000000000,9999999999,60*86400
local function whole(v,lo,hi) return type(v)=='number' and v==v and v%1==0 and v>=lo and v<=hi end
local function label(text,limit)
    if type(text)~='string' then return nil end
    text=text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|[hrn]',''):gsub('[|%c]',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #text>limit then text=text:sub(1,limit):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    return text~='' and text or nil
end
-- Pure: one saved row made clean, or nil. row = {n=name,r=reset time in seconds since 1970,
-- raid=true or nil,d=difficulty name,p=bosses down,t=bosses}
function BackstageForeverLockoutRow(row)
    if type(row)~='table' then return nil end
    local name=label(row.n,NAME_MAX)
    if not name or not whole(row.r,T_MIN,T_MAX) then return nil end
    local out={n=name,r=row.r}
    if row.raid==true then out.raid=true end
    local difficulty=label(row.d,30)
    if difficulty then out.d=difficulty end
    if whole(row.t,1,40) and whole(row.p,0,row.t) then out.p,out.t=row.p,row.t end
    return out
end
-- Pure: the game's saved instances as rows. count: how many the game lists; read(i): what
-- GetSavedInstanceInfo(i) returns; now: seconds since 1970. Only instances you are locked to and
-- that still have time to run are kept, soonest reset first, at most 40.
function BackstageForeverLockoutRows(count,read,now)
    local rows={}
    if not whole(count,0,1000) or type(read)~='function' or not whole(now,T_MIN,T_MAX) then return rows end
    for i=1,min(count,100) do
        local ok,name,_,reset,_,locked,_,_,isRaid,_,difficulty,total,progress=pcall(read,i)
        if ok and locked==true and type(reset)=='number' and reset>0 and reset<=RESET_MAX then
            -- To the minute: the same lockout read a moment later is the same row.
            local row=BackstageForeverLockoutRow({n=name,r=floor((now+reset)/60+.5)*60,raid=isRaid==true,d=difficulty,p=progress,t=total})
            if row and #rows<MAX then rows[#rows+1]=row end
        end
    end
    table.sort(rows,function(a,b) if a.r~=b.r then return a.r<b.r end return a.n<b.n end)
    return rows
end
-- Pure: "3 days 4 h", "5 h 20 min", "12 min".
function BackstageForeverLockoutWait(seconds)
    if type(seconds)~='number' or seconds<=0 then return T('now') end
    local minutes=floor(seconds/60+.5)
    if minutes<1 then minutes=1 end
    local days,hours=floor(minutes/1440),floor(minutes%1440/60)
    if days>=1 then return T(('%d days %d h'):format(days,hours)) end
    if hours>=1 then return T(('%d h %d min'):format(hours,minutes%60)) end
    return T(('%d min'):format(minutes))
end
local function line(row,now)
    local text=row.n
    if row.d then text=text..' ('..row.d..')' end
    if row.t then text=text..' '..T(('%d of %d bosses'):format(row.p,row.t)) end
    return ('  %s: %s'):format(text,T(('resets in %s'):format(BackstageForeverLockoutWait(row.r-now))))
end
-- Pure: the chat lines for /bf lockouts. mine: this character's rows, or nil when the game has no
-- list of saved instances; others: {{name=,at=,rows=}} as last saved; resets that passed are left out.
function BackstageForeverLockoutLines(mine,others,now)
    local lines={}
    if type(mine)~='table' then lines[1]=T('This game client does not tell addons which instances you are saved to, so there are no lockouts to show.')
    elseif #mine==0 then lines[1]=T('This character is not saved to any dungeon or raid.')
    else
        lines[1]=T(('This character is saved to %d.'):format(#mine))
        for _,row in ipairs(mine) do lines[#lines+1]=line(row,now) end
    end
    for _,other in ipairs(type(others)=='table' and others or {}) do
        local rows={}
        for _,raw in ipairs(type(other)=='table' and type(other.rows)=='table' and other.rows or {}) do
            local row=BackstageForeverLockoutRow(raw)
            if row and row.r>now and #rows<MAX then rows[#rows+1]=row end
        end
        if #rows>0 and type(other.name)=='string' and #lines<60 then
            lines[#lines+1]=T(('%s, as last saved: %d.'):format(label(other.name,40) or '?',#rows))
            for _,row in ipairs(rows) do lines[#lines+1]=line(row,now) end
        end
    end
    return lines
end

-- ---------------------------------------------------------------- live
local clock=time or (os and os.time)
local function epoch() local t=call(clock);return type(t)=='number' and floor(t) or 0 end
local function available() return type(plain(GetNumSavedInstances))=='function' and type(plain(GetSavedInstanceInfo))=='function' end
local function rows()
    if not available() then return nil end
    local count=call(GetNumSavedInstances)
    local now=epoch()
    if type(count)~='number' or now<T_MIN then return nil end
    return BackstageForeverLockoutRows(floor(count),function(i) return call(GetSavedInstanceInfo,i) end,now)
end
-- The optional capture block: {v=1,at=,rows={...}}; {v=1,at=,na=true,rows={}} when the game
-- client has no list of saved instances; nil when it could not be read right now.
function BackstageForeverLockoutSnapshot()
    local now=epoch()
    if now<T_MIN then return nil end
    if not available() then return {v=1,at=now,na=true,rows={}} end
    local list=rows()
    if not list then return nil end
    return {v=1,at=now,rows=list}
end
function BackstageForeverLockoutsCommand()
    local others={}
    if type(BackstageForeverRosterLockouts)=='function' then
        local ok,list=pcall(BackstageForeverRosterLockouts)
        if ok and type(list)=='table' then others=list end
    end
    for _,text in ipairs(BackstageForeverLockoutLines(rows(),others,epoch())) do say(text) end
    if available() then
        -- Ask the game for a fresh list; it answers a moment later and the next /bf lockouts has it.
        local request=plain(RequestRaidInfo)
        if type(request)=='function' then pcall(request) end
    end
end
if type(CreateFrame)=='function' then
    local frame=CreateFrame('Frame')
    if frame then
        for _,e in ipairs({'PLAYER_LOGIN','UPDATE_INSTANCE_INFO'}) do pcall(frame.RegisterEvent,frame,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Lockouts',frame) end
        pcall(frame.SetScript,frame,'OnEvent',function(_,event)
            if event=='PLAYER_LOGIN' then
                local request=plain(RequestRaidInfo)
                if available() and type(request)=='function' then pcall(request) end
                return
            end
            -- The game sent its list: the next save carries it.
            if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end
        end)
    end
end

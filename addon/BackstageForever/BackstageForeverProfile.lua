-- Profiles (roadmap "One addon instead of ten"): every Backstage Forever setting of this character
-- as one text code, to keep, to paste on another character, or to pass through the desktop app.
--   /bf profile                 the window: Export fills the box with the code, Import reads the box
--   /bf profile save NAME       keep the settings as they are now under a name (up to 8 per character)
--   /bf profile load NAME       put a kept profile back; /bf profile delete NAME; /bf profile list
--   /bf profile share on|off    lets the desktop app list this character's kept profiles (off at first)
--   /bf profile accept          applies the profile the desktop app sent; /bf profile dismiss ignores it
-- A code is data, never a program: it is read by the small reader below, character by character.
-- Nothing in it is run. Unknown tables and keys are dropped, every value is checked against the list
-- of settings this file knows, and the code carries a version, a checksum and a size limit.
-- "Include my data" adds your player notes, flight times and gathering spots; they are added to what
-- the other character has, never put in its place. The Journal, the Ledger, gear sets, learned item
-- sources and scout notes belong to one character and are never part of a code. Three switches that
-- change a setting of the game itself (instant quest text, chat timestamps, class colours in chat)
-- are not copied either: switch those on each character.
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
    for i=2,10 do r[i]=plain(r[i]) end
    return unpackAll(r,2,10)
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
local function line(m)
    local chat=plain(DEFAULT_CHAT_FRAME)
    if type(chat)=='table' and type(chat.AddMessage)=='function' then pcall(chat.AddMessage,chat,m) end
end
local function combat() return call(InCombatLockdown)~=false end

-- ---------------------------------------------------------------- limits
local PREFIX='BF1'
local MAX_CODE=240000          -- a code with your data
local MAX_SETTINGS_CODE=16000  -- a code with settings only: what a kept profile and the desktop app may hold
local MAX_DEPTH,MAX_NODES,MAX_STRING,MAX_NUMBER=8,30000,400,24
BackstageForeverProfileLimits={code=MAX_CODE,settings=MAX_SETTINGS_CODE,depth=MAX_DEPTH,nodes=MAX_NODES,string=MAX_STRING}

-- ---------------------------------------------------------------- pure: the settings this file knows
local B={'b'}
local function N(lo,hi,whole) return {'n',lo,hi,whole} end
local function E(...) local set={} for _,v in ipairs({...}) do set[v]=true end return {'e',set} end
local function M(fields,whole) return {'m',fields,whole} end
-- A position needs both numbers.
local XY=M({x=N(0,1e7),y=N(0,1e7)},true)
local ANCHOR=E('TOPLEFT','TOP','TOPRIGHT','LEFT','CENTER','RIGHT','BOTTOMLEFT','BOTTOM','BOTTOMRIGHT')
-- Each entry: the saved table, its settings, and how the owning file treats a missing key.
-- fill: the owner fills in every setting at login, so a key the code lacks is left as it is.
-- keep: a key that must never be cleared (a missing value would not mean "the default").
-- all: keys that only make sense together.
local SETTINGS={
    HUD={global='BackstageForeverHUDSettings',fill=true,all={{'point','relativePoint','x','y'}},keys={visible=B,collapsed=B,
        mode=E('adventure','questing','professions'),focus=E('balanced','nearby','turn-ins'),minutes=E(15,30,60),
        point=ANCHOR,relativePoint=ANCHOR,x=N(-10000,10000),y=N(-10000,10000)}},
    Map={global='BackstageForeverMapSettings',fill=true,keys={enabled=B,details=B,layers=M({quest=B,herbs=B,ore=B,supplies=B,finds=B,olderReferences=B})}},
    Advisor={global='BackstageForeverAdvisorSettings',fill=true,keys={enabled=B,open=B,layers=M({pickup=B,handin=B,class=B,profession=B,flight=B,gather=B})}},
    Live={global='BackstageForeverLiveSettings',keep={enabled=true},keys={enabled=B,pos=E('topright','bottomleft','bottomright'),safe=B,compact=B}},
    Assist={global='BackstageForeverAssistSettings',fill=true,keys={toasts=B,danger=B,junk=B,bossTips=B,talentPlan=B}},
    Gear={global='BackstageForeverGearSettings',keys={enabled=B}},
    Route={global='BackstageForeverRouteSettings',fill=true,keys={shown=B,arrow=B,tooltips=B,arrivals=B,plates=B,mode=E('guide','zone')}},
    Supplies={global='BackstageForeverSuppliesSettings',fill=true,keys={enabled=B}},
    Moments={global='BackstageForeverMomentsSettings',keys={toasts=B,shots=B}},
    Ask={global='BackstageForeverAskSettings',fill=true,keys={hidden=B,explainClick=B,angle=N(0,360)}},
    Enemy={global='BackstageForeverEnemySettings',fill=true,keys={enabled=B,sound=B}},
    QoL={global='BackstageForeverQoLSettings',fill=true,keys={coords=B,loot=B,dismount=B}},
    Party={global='BackstageForeverPartySettings',fill=true,keys={enabled=B,answerChecks=B,live=B,say=M({quest=E('party','guild'),objective=E('party','guild'),ready=E('party','guild')})}},
    Helper={global='BackstageForeverHelperSettings',keys={questTracker=B,objectiveHints=B,questDetours=B,beforeLeaving=B,rewardReasons=B,questBlockers=B,
        gatheringMarks=B,sharedObjectives=B,keepQuestItems=B,questItemCue=B,spellRankReminder=B}},
    Minimap={global='BackstageForeverMinimapSettings',fill=true,keys={enabled=B}},
    Comfort={global='BackstageForeverComfortSettings',keys={rested=B,weapons=B,flights=B,durability=B}},
    World={global='BackstageForeverWorldSettings',fill=true,keys={rares=B,searchBox=B}},
    Kit={global='BackstageForeverKitSettings',keys={ready=B}},
    Social={global='BackstageForeverSocialSettings',keys={notes=B,mail=B,marks=B,text=B,large=B}},
    Panel={global='BackstageForeverPanelSettings',keys={tracker=B,run=B,runCombat=B,wish=B,bags=B,chainTips=B,pos=M({tracker=XY,run=XY})}},
    Lfg={global='BackstageForeverLfgSettings',keys={enabled=B,sort=E('age','dungeon'),pos=XY}},
    Guild={global='BackstageForeverGuildSettings',keys={share=B}},
    Shop={global='BackstageForeverShopSettings',keys={enabled=B}},
    Beside={global='BackstageForeverBesideSettings',keys={enabled=B}},
    Perf={global='BackstageForeverPerfSettings',keys={on=B}},
    Raid={global='BackstageForeverRaidSettings',keys={enabled=B}},
    Bag={global='BackstageForeverBagSettings',keys={enabled=B,sort=E('category','bag','name','quality'),pos=M({bag=XY})}},
    Chat={global='BackstageForeverChatSettings',keys={links=B,filter=B}},
    Profile={global='BackstageForeverProfileDB',keys={share=B}},
    -- Switches that live in a data table.
    Ledger={global='BackstageForeverLedgerDB',fill=true,keys={pricesOn=B,priceTips=B}},
    Scout={global='BackstageForeverScoutDB',keys={on=B}},
    Events={global='BackstageForeverEventsDB',keys={on=B,loot=B}},
    LiveGuild={global='BackstageForeverLiveGuildDB',keys={desk=B}},
    Gathering={global='BackstageForeverGatheringDB',fill=true,keys={recording=B}},
}
BackstageForeverProfileSettings=SETTINGS
-- Saved tables that hold no setting worth copying: one character's own records, or a list for one run.
BackstageForeverProfileNotCopied={'BackstageForeverCrewSettings','BackstageForeverQuestItemSourcesDB','BackstageForeverWaresDB','BackstageForeverJournalDB','BackstageForeverSheetDB',
    'BackstageForeverFlightTimesDB','BackstageForeverNotesDB'}
local function finite(v) return type(v)=='number' and v==v and v>-1e300 and v<1e300 end
-- Pure: a value checked against one entry of the list. nil when it does not fit.
local function check(spec,v)
    local kind=spec[1]
    if kind=='b' then if type(v)=='boolean' then return v end return nil end
    if kind=='n' then
        if finite(v) and v>=spec[2] and v<=spec[3] and (not spec[4] or floor(v)==v) then return v end
        return nil
    end
    if kind=='e' then if (type(v)=='string' or type(v)=='number') and spec[2][v] then return v end return nil end
    if kind=='m' then
        if type(v)~='table' then return nil end
        local out={}
        for key,sub in pairs(spec[2]) do
            local c=check(sub,rawget(v,key))
            if c~=nil then out[key]=c elseif spec[3] then return nil end
        end
        if next(out)==nil then return nil end
        return out
    end
end
local function cleanTable(entry,raw)
    if type(raw)~='table' then return nil end
    local out={}
    for key,spec in pairs(entry.keys) do
        local c=check(spec,rawget(raw,key))
        if c~=nil then out[key]=c end
    end
    for _,group in ipairs(entry.all or {}) do
        local whole=true
        for _,key in ipairs(group) do if out[key]==nil then whole=false end end
        if not whole then for _,key in ipairs(group) do out[key]=nil end end
    end
    if next(out)==nil then return nil end
    return out
end

-- ---------------------------------------------------------------- pure: your data
local function text(v,max,pattern)
    if type(v)~='string' or v=='' or #v>max or v:find('[%c|]') then return nil end
    if pattern and not v:match(pattern) then return nil end
    return v
end
local function whole(v,lo,hi) return finite(v) and v>=lo and v<=hi and floor(v)==v and v or nil end
local MAX_T=253402300799
local DATA={
    Notes={global='BackstageForeverNotesDB',list='notes',max=200,fresh=function() return {v=1,notes={}} end,
        key=function(r) return r.name:lower() end,
        row=function(r)
            if type(r)~='table' then return nil end
            local name=text(r.name,48)
            if name and type(BackstageForeverNoteName)=='function' then name=BackstageForeverNoteName(name) end
            local note=text(r.text,120)
            if not name or not note then return nil end
            return {name=name,text=note,at=whole(r.at,0,MAX_T),zone=text(r.zone,60)}
        end},
    Flights={global='BackstageForeverFlightTimesDB',list='trips',max=200,fresh=function() return {v=1,trips={}} end,
        key=function(r) return r.from..'\n'..r.to end,
        row=function(r)
            if type(r)~='table' then return nil end
            local from,to,seconds=text(r.from,90),text(r.to,90),whole(r.seconds,1,36000)
            if not from or not to or not seconds then return nil end
            return {from=from,to=to,seconds=seconds,count=whole(r.count,1,100000) or 1,at=whole(r.at,0,MAX_T)}
        end},
    Spots={global='BackstageForeverGatheringDB',list='records',max=500,gathering=true,fresh=function() return {schemaVersion=1,recording=true,records={}} end,
        key=function(r) return r.id end,
        row=function(r)
            if type(r)~='table' then return nil end
            local ids={}
            if type(r.itemIds)~='table' then return nil end
            for i=1,8 do local id=rawget(r.itemIds,i);if id==nil then break end;if not whole(id,1,2147483647) then return nil end;ids[i]=id end
            local out={id=text(r.id,160),method=text(r.method,10,'^%l+$'),entityId=whole(r.entityId,1,2147483647),itemIds=ids,mapId=whole(r.mapId,1,2147483647),
                x=finite(r.x) and r.x>=0 and r.x<=1 and r.x or nil,y=finite(r.y) and r.y>=0 and r.y<=1 and r.y or nil,observedAt=whole(r.observedAt,0,MAX_T),
                clientBuild=text(r.clientBuild,30,'^%d+%.%d+%.%d+%.%d+$'),name=text(r.name,120),evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true}
            if not (out.id and out.method and out.entityId and out.mapId and out.x and out.y and out.observedAt and out.clientBuild and out.name) or #ids==0 then return nil end
            if r.evidence~=out.evidence or r.precision~=out.precision or r.approximate~=true then return nil end
            return out
        end},
}
BackstageForeverProfileData=DATA
local function cleanRows(entry,raw)
    if type(raw)~='table' then return nil end
    local out,seen={},{}
    for i=1,entry.max do
        local r=rawget(raw,i)
        if r==nil then break end
        local row=entry.row(r)
        if row then
            local key=entry.key(row)
            if not seen[key] then seen[key]=true;out[#out+1]=row end
        end
    end
    if #out==0 then return nil end
    return out
end

-- ---------------------------------------------------------------- pure: collect, check, apply
local function world(env)
    if type(env)=='table' then return env.get,env.set end
    return function(name) return _G[name] end,function(name,value) _G[name]=value end
end
local function metaText(v) return text(v,60) end
-- Pure: a profile document from the saved tables. env = {get=function(name),set=function(name,table)},
-- or nil for the real ones. who = {name=,realm=,class=,at=}. -> {v=1,m={...},s={...},d={...} or nil}
function BackstageForeverProfileCollect(env,includeData,who)
    local get=world(env)
    local doc={v=1,m={},s={}}
    who=type(who)=='table' and who or {}
    doc.m.n,doc.m.r,doc.m.c=metaText(who.name),metaText(who.realm),text(who.class,20,'^%u+$')
    doc.m.t=whole(who.at,1,MAX_T)
    for short,entry in pairs(SETTINGS) do
        local clean=cleanTable(entry,get(entry.global))
        if clean then doc.s[short]=clean end
    end
    if includeData then
        doc.d={}
        for short,entry in pairs(DATA) do
            local db=get(entry.global)
            local rows=type(db)=='table' and cleanRows(entry,rawget(db,entry.list))
            if rows then doc.d[short]=rows end
        end
        if next(doc.d)==nil then doc.d=nil end
    end
    return doc
end
-- Pure: a document read from a code, with everything this file does not know dropped and every
-- value checked. raw is whatever the reader produced. -> clean document, or nil, why.
function BackstageForeverProfileClean(raw)
    if type(raw)~='table' or rawget(raw,'v')~=1 then return nil,'version' end
    local doc={v=1,m={},s={}}
    local m=rawget(raw,'m')
    if type(m)=='table' then
        doc.m.n,doc.m.r,doc.m.c=metaText(rawget(m,'n')),metaText(rawget(m,'r')),text(rawget(m,'c'),20,'^%u+$')
        doc.m.t=whole(rawget(m,'t'),1,MAX_T)
    end
    local s=rawget(raw,'s')
    if type(s)~='table' then return nil,'empty' end
    for short,entry in pairs(SETTINGS) do
        local clean=cleanTable(entry,rawget(s,short))
        if clean then doc.s[short]=clean end
    end
    local d=rawget(raw,'d')
    if type(d)=='table' then
        doc.d={}
        for short,entry in pairs(DATA) do
            local rows=cleanRows(entry,rawget(d,short))
            if rows then doc.d[short]=rows end
        end
        if next(doc.d)==nil then doc.d=nil end
    end
    if next(doc.s)==nil and not doc.d then return nil,'empty' end
    return doc
end
local function leaves(v)
    if type(v)~='table' then return 1 end
    local n=0
    for _,x in pairs(v) do n=n+leaves(x) end
    return n
end
-- Pure: how much a document holds -> settings, data rows.
function BackstageForeverProfileCount(doc)
    local settings,rows=0,0
    if type(doc)~='table' then return 0,0 end
    for _,t in pairs(type(doc.s)=='table' and doc.s or {}) do settings=settings+leaves(t) end
    for _,list in pairs(type(doc.d)=='table' and doc.d or {}) do rows=rows+#list end
    return settings,rows
end
-- Writes a checked value into a saved table in place: files that hold on to their table keep it.
local function assign(t,key,new)
    local old=rawget(t,key)
    if type(new)~='table' then
        if old==new then return 0 end
        t[key]=new
        return 1
    end
    if type(old)~='table' then old={};t[key]=old end
    local changed=0
    for k,v in pairs(new) do changed=changed+assign(old,k,v) end
    return changed
end
-- Pure apart from env: puts a clean document into the saved tables. Settings replace; a setting the
-- code does not carry goes back to its default unless its file fills it in itself. Data is added:
-- a note, flight or gathering spot the character already has is left as it is.
-- -> {settings=changed count,rows=added count,skipped={data kinds refused}}
function BackstageForeverProfileApply(doc,env,withData)
    local get,set=world(env)
    local result={settings=0,rows=0,skipped={}}
    if type(doc)~='table' or type(doc.s)~='table' then return result end
    for short,entry in pairs(SETTINGS) do
        local new=doc.s[short]
        if type(new)=='table' then
            local t=get(entry.global)
            if type(t)~='table' then t={};set(entry.global,t) end
            for key in pairs(entry.keys) do
                if new[key]~=nil then result.settings=result.settings+assign(t,key,new[key])
                elseif not entry.fill and not (entry.keep and entry.keep[key]) and rawget(t,key)~=nil then t[key]=nil;result.settings=result.settings+1 end
            end
        end
    end
    if withData and type(doc.d)=='table' then
        for short,entry in pairs(DATA) do
            local rows=doc.d[short]
            if type(rows)=='table' then
                local db=get(entry.global)
                if type(db)~='table' or type(rawget(db,entry.list))~='table' then db=entry.fresh();set(entry.global,db) end
                local list=db[entry.list]
                local have,fresh={},{}
                for _,r in ipairs(list) do
                    local ok,key=pcall(entry.key,r)
                    if ok and key then have[key]=true end
                end
                for _,row in ipairs(rows) do
                    local key=entry.key(row)
                    if not have[key] and #list+#fresh<entry.max then have[key]=true;fresh[#fresh+1]=row end
                end
                local allowed=true
                if entry.gathering and #fresh>0 then
                    -- The gathering file throws its whole list away when one row is wrong, so its own
                    -- checker judges the new list first. No checker: the spots are not added.
                    local judge=BackstageForeverGatheringValidateSnapshot
                    local both={}
                    for _,r in ipairs(list) do both[#both+1]=r end
                    for _,r in ipairs(fresh) do both[#both+1]=r end
                    local ok,checked=pcall(judge,{schemaVersion=1,status='available',recording=true,observedAt=MAX_T,limited=false,totalRecords=#both,records=both},MAX_T)
                    allowed=type(judge)=='function' and ok and type(checked)=='table'
                end
                if allowed then
                    for _,row in ipairs(fresh) do list[#list+1]=row end
                    result.rows=result.rows+#fresh
                elseif #fresh>0 then result.skipped[#result.skipped+1]=short end
            end
        end
    end
    return result
end

-- ---------------------------------------------------------------- pure: the code
-- Adler-32, written with sums and remainders only.
function BackstageForeverProfileSum(s)
    local a,b=1,0
    for i=1,#s do
        a=(a+s:byte(i))%65521
        b=(b+a)%65521
    end
    return ('%04x%04x'):format(b,a)
end
local function escape(s) return (s:gsub('[^%w_%.%-]',function(c) return ('%%%02X'):format(c:byte()) end)) end
local function number(v)
    if floor(v)==v and v>-1e15 and v<1e15 then return ('%d'):format(v) end
    local s=('%.14g'):format(v)
    if tonumber(s)~=v then s=('%.17g'):format(v) end
    return s
end
local function write(v,out,depth)
    local kind=type(v)
    if kind=='boolean' then out[#out+1]=v and 't' or 'f'
    elseif kind=='number' then out[#out+1]='n'..number(v)..';'
    elseif kind=='string' then out[#out+1]='s'..escape(v)..';'
    elseif kind=='table' then
        if depth>=MAX_DEPTH then error('deep',0) end
        local keys={}
        for k in pairs(v) do if type(k)=='string' or type(k)=='number' then keys[#keys+1]=k end end
        table.sort(keys,function(x,y)
            if type(x)~=type(y) then return type(x)=='number' end
            return x<y
        end)
        out[#out+1]='{'
        for _,k in ipairs(keys) do
            local value=v[k]
            if value~=nil and (type(value)~='number' or (finite(value) and value>-1e15 and value<1e15)) and (type(value)~='string' or #value<=MAX_STRING)
                and (type(k)~='number' or (floor(k)==k and k>=1 and k<=1e6)) and (type(k)~='string' or #k<=MAX_STRING) then
                write(k,out,depth+1);write(value,out,depth+1)
            end
        end
        out[#out+1]='}'
    end
end
-- Pure: a document as one line of text. limit: the most characters it may have.
-- -> code, or nil and 'big'.
function BackstageForeverProfileEncode(doc,limit)
    local out={}
    local ok=pcall(write,doc,out,0)
    if not ok then return nil,'big' end
    local payload=table.concat(out)
    local code=PREFIX..':'..BackstageForeverProfileSum(payload)..':'..payload
    if #code>(type(limit)=='number' and limit or MAX_CODE) then return nil,'big' end
    return code
end
-- The reader. One character at a time, with a count of everything it makes; it stops at the first
-- thing that is not exactly as written by the writer above. It never runs anything.
local function read(payload)
    local pos,nodes=1,0
    local function fail(why) error(why,0) end
    local function value(depth)
        nodes=nodes+1
        if nodes>MAX_NODES then fail('big') end
        local c=payload:sub(pos,pos)
        if c=='t' then pos=pos+1 return true end
        if c=='f' then pos=pos+1 return false end
        if c=='n' or c=='s' then
            local stop=payload:find(';',pos,true)
            if not stop then fail('cut') end
            local raw=payload:sub(pos+1,stop-1)
            pos=stop+1
            if c=='n' then
                if #raw>MAX_NUMBER or not (raw:match('^%-?%d+$') or raw:match('^%-?%d+%.%d+$') or raw:match('^%-?%d+%.?%d*e[%+%-]?%d%d?%d?$')) then fail('number') end
                local v=tonumber(raw)
                if not finite(v) then fail('number') end
                return v
            end
            if #raw>MAX_STRING*3 or raw:find('[^%w_%.%-%%]') then fail('text') end
            local bad=false
            local s=raw:gsub('%%(.?.?)',function(hex)
                if not hex:match('^%x%x$') then bad=true return '' end
                return string.char(tonumber(hex,16))
            end)
            if bad or #s>MAX_STRING then fail('text') end
            return s
        end
        if c=='{' then
            if depth>=MAX_DEPTH then fail('deep') end
            pos=pos+1
            local t={}
            while true do
                local n=payload:sub(pos,pos)
                if n=='}' then pos=pos+1 return t end
                if n=='' then fail('cut') end
                if n~='n' and n~='s' then fail('key') end
                local key=value(depth+1)
                if type(key)=='number' and (floor(key)~=key or key<1 or key>1e6) then fail('key') end
                if t[key]~=nil then fail('twice') end
                t[key]=value(depth+1)
            end
        end
        fail(c=='' and 'cut' or 'sign')
    end
    local doc=value(0)
    if pos~=#payload+1 then fail('more') end
    return doc
end
-- Pure: a code back into a clean document. -> document, or nil and why:
-- 'big', 'form' (not a Backstage Forever code), 'version', 'sum' (damaged), 'read', 'empty'.
function BackstageForeverProfileDecode(code,limit)
    if type(code)~='string' then return nil,'form' end
    code=code:gsub('^%s+',''):gsub('%s+$','')
    if #code>(type(limit)=='number' and limit or MAX_CODE) then return nil,'big' end
    local prefix,sum,payload=code:match('^(%u%u%d+):(%x%x%x%x%x%x%x%x):(.*)$')
    if not prefix then return nil,'form' end
    if prefix~=PREFIX then return nil,'version' end
    if payload:find('[^%w_%.%-%%;{}]') then return nil,'form' end
    if BackstageForeverProfileSum(payload)~=sum:lower() then return nil,'sum' end
    local ok,raw=pcall(read,payload)
    if not ok then return nil,'read' end
    local doc,why=BackstageForeverProfileClean(raw)
    if not doc then return nil,why end
    return doc
end
local WHY={big='This code is too long.',form='This is not a Backstage Forever profile code.',version='This code comes from a newer Backstage Forever. Update the addon first.',
    sum='This code is damaged: a piece is missing or changed. Copy it again, all of it.',read='This code is damaged and cannot be read.',empty='This code holds no settings.'}
function BackstageForeverProfileWhy(why) return WHY[why] or WHY.read end

-- ---------------------------------------------------------------- pure: kept profiles and the desktop app
local MAX_KEPT,NAME_MAX=8,20
-- Pure: a profile name as it is kept: letters, digits and hyphens, lower case, at most 20.
function BackstageForeverProfileName(name)
    if type(name)~='string' then return nil end
    name=name:lower():gsub('^%s+',''):gsub('%s+$','')
    if #name<1 or #name>NAME_MAX or not name:match('^[%l%d][%l%d%-]*$') then return nil end
    return name
end
-- Pure: the kept profiles of a store, oldest name first. -> {{name=,code=,at=}}
function BackstageForeverProfileList(db)
    local out={}
    local kept=type(db)=='table' and rawget(db,'profiles')
    for name,row in pairs(type(kept)=='table' and kept or {}) do
        if BackstageForeverProfileName(name)==name and type(row)=='table' and type(row.code)=='string' and #row.code<=MAX_SETTINGS_CODE then
            out[#out+1]={name=name,code=row.code,at=whole(row.at,1,MAX_T)}
        end
    end
    table.sort(out,function(a,b) return a.name<b.name end)
    while #out>MAX_KEPT+1 do table.remove(out) end
    return out
end
-- Pure: the block the capture carries for the desktop app, only with sharing on.
-- {v=1,profiles={{n=name,c=code,t=time}},done=checksum of the sent profile already dealt with}
function BackstageForeverProfileBlock(db)
    if type(db)~='table' or rawget(db,'share')~=true then return nil end
    local block={v=1,profiles={}}
    for _,row in ipairs(BackstageForeverProfileList(db)) do block.profiles[#block.profiles+1]={n=row.name,c=row.code,t=row.at} end
    local done=rawget(db,'done')
    if type(done)=='string' and done:match('^%x%x%x%x%x%x%x%x$') then block.done=done end
    if #block.profiles==0 and not block.done then return nil end
    return block
end
-- Pure: the profile the desktop app sent to this character, or nil. data is BackstageForeverDesktopData.
-- -> {name=,from=,code=,sum=}
function BackstageForeverProfileSent(data,name,realm)
    if type(data)~='table' or rawget(data,'schema')~=1 or type(name)~='string' or type(realm)~='string' then return nil end
    local all=rawget(data,'characters')
    local mine=type(all)=='table' and rawget(all,name..'-'..realm)
    local sent=type(mine)=='table' and rawget(mine,'prof')
    if type(sent)~='table' then return nil end
    local code=rawget(sent,'c')
    if type(code)~='string' or #code>MAX_SETTINGS_CODE then return nil end
    local label=BackstageForeverProfileName(rawget(sent,'n'))
    if not label then return nil end
    return {name=label,from=text(rawget(sent,'f'),130) or '?',code=code,sum=BackstageForeverProfileSum(code)}
end

-- ---------------------------------------------------------------- live
local function db()
    if type(BackstageForeverProfileDB)~='table' then BackstageForeverProfileDB={} end
    local d=BackstageForeverProfileDB
    if type(rawget(d,'profiles'))~='table' then d.profiles={} end
    return d
end
function BackstageForeverProfileShared()
    local d=BackstageForeverProfileDB
    return type(d)=='table' and rawget(d,'share')==true
end
function BackstageForeverProfileSnapshot()
    local ok,block=pcall(BackstageForeverProfileBlock,BackstageForeverProfileDB)
    return ok and block or nil
end
local function me()
    local _,class=call(UnitClass,'player')
    return {name=call(UnitName,'player'),realm=call(GetRealmName),class=class,at=call(time)}
end
local function capture() if type(BackstageForeverRequestCapture)=='function' then pcall(BackstageForeverRequestCapture) end end
local function currentCode(includeData)
    local doc=BackstageForeverProfileCollect(nil,includeData,me())
    local code,why=BackstageForeverProfileEncode(doc,includeData and MAX_CODE or MAX_SETTINGS_CODE)
    return code,why,doc
end
-- Puts a code into this character. Before anything changes, the settings as they are go into the
-- kept profile "undo". -> result, or nil and a sentence.
local function applyCode(code,withData)
    if combat() then return nil,'Change profiles outside combat.' end
    local doc,why=BackstageForeverProfileDecode(code)
    if not doc then return nil,BackstageForeverProfileWhy(why) end
    local before=currentCode(false)
    if before then db().profiles.undo={code=before,at=call(time)} end
    local ok,result=pcall(BackstageForeverProfileApply,doc,nil,withData)
    if not ok or type(result)~='table' then return nil,'The profile could not be applied.' end
    capture()
    return result,nil,doc
end
local function applied(result,doc)
    local from=doc and doc.m and doc.m.n and (' '..T('from %s'):format(doc.m.n)) or ''
    local text=T('Profile applied%s: %d settings changed.'):format(from,result.settings)
    if result.rows>0 then text=text..' '..T('%d notes, flights and spots added.'):format(result.rows) end
    if #result.skipped>0 then text=text..' '..T('Gathering spots were not added: they did not pass this addon\'s own check.') end
    return text..' '..T('Type /reload so every window follows. /bf profile load undo puts the old settings back.')
end

-- ---------------------------------------------------------------- the window
local WIDTH,HEIGHT,INSET=460,196,16
local frame
local function status(m) if frame then frame.status:SetText(m or '') end end
local function build()
    if frame or type(CreateFrame)~='function' or not UIParent then return frame end
    local f=CreateFrame('Frame','BackstageForeverProfileFrame',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT);f:SetPoint('CENTER',0,60)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',f.StartMoving);f:SetScript('OnDragStop',f.StopMovingOrSizing)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    title:SetPoint('TOPLEFT',INSET,-12);title:SetWidth(WIDTH-INSET*2-22);title:SetJustifyH('LEFT');title:SetWordWrap(false)
    title:SetText(T('Profiles'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide() end)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,-30)
    local about=f:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    about:SetPoint('TOPLEFT',INSET,-38);about:SetSize(WIDTH-INSET*2,26);about:SetJustifyH('LEFT');about:SetJustifyV('TOP');about:SetWordWrap(true)
    about:SetText(T('Export writes this character\'s settings as one code. Paste a code here and press Import to use it.'))
    local edit=CreateFrame('EditBox',nil,f)
    edit:SetSize(WIDTH-INSET*2-8,18);edit:SetPoint('TOPLEFT',INSET+4,-74)
    pcall(edit.SetFontObject,edit,'GameFontHighlightSmall');pcall(edit.SetAutoFocus,edit,false);pcall(edit.SetMaxLetters,edit,MAX_CODE)
    local back=edit:CreateTexture(nil,'BACKGROUND');back:SetPoint('TOPLEFT',-4,2);back:SetPoint('BOTTOMRIGHT',4,-2);back:SetColorTexture(0,0,0,.5)
    edit:SetScript('OnEscapePressed',function(self) pcall(self.ClearFocus,self) end)
    edit:SetScript('OnEnterPressed',function(self) pcall(self.ClearFocus,self) end)
    f.edit=edit
    local data=CreateFrame('CheckButton',nil,f,'UICheckButtonTemplate')
    data:SetSize(24,24);data:SetPoint('TOPLEFT',INSET-2,-100)
    local caption=data:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    caption:SetPoint('LEFT',data,'RIGHT',2,0);caption:SetWidth(WIDTH-INSET*2-30);caption:SetJustifyH('LEFT');caption:SetWordWrap(false)
    caption:SetText(T('Include my data: player notes, flight times, gathering spots'))
    f.data=data
    local function button(x,width,label,onClick)
        local b=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
        b:SetSize(width,22);b:SetPoint('TOPLEFT',x,-130);b:SetText(T(label))
        local caption=call(field(b,'GetFontString'),b)
        if caption then pcall(caption.SetWidth,caption,width-12);pcall(caption.SetWordWrap,caption,false) end
        b:SetScript('OnClick',function() pcall(onClick) end)
        return b
    end
    button(INSET,136,'Export',function()
        if combat() then return status(T('Change profiles outside combat.')) end
        local withData=f.data:GetChecked()==true
        local code,_,doc=currentCode(withData)
        if not code then return status(T('Your data is too large for one code. Untick "Include my data".')) end
        edit:SetText(code);pcall(edit.SetFocus,edit);pcall(edit.HighlightText,edit)
        local settings,rows=BackstageForeverProfileCount(doc)
        status(T('%d settings, %d data rows, %d characters. Press Ctrl+C to copy.'):format(settings,rows,#code))
    end)
    button(INSET+146,136,'Import',function()
        local result,why,doc=applyCode(edit:GetText() or '',f.data:GetChecked()==true)
        if not result then return status(T(why)) end
        status(T('Applied: %d settings changed. Type /reload.'):format(result.settings))
        say(applied(result,doc))
    end)
    button(INSET+292,WIDTH-INSET*2-292,'Clear',function() edit:SetText('');status('') end)
    f.status=f:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    f.status:SetPoint('BOTTOMLEFT',INSET,14);f.status:SetWidth(WIDTH-INSET*2);f.status:SetJustifyH('LEFT');f.status:SetWordWrap(false)
    f:RegisterEvent('PLAYER_REGEN_DISABLED');f:SetScript('OnEvent',function() f:Hide() end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverProfileFrame') end
    frame=f
    return f
end
local function open()
    if combat() then say('Open profiles outside combat.') return false end
    local ok,f=pcall(build)
    if not ok or not f then say('The profile window is not available in this game client. /bf profile save NAME and /bf profile load NAME still work.') return false end
    status('');f:Show()
    return true
end

-- ---------------------------------------------------------------- /bf profile
local sent=nil
local function offered()
    if sent==nil then
        local who=me()
        local ok,found=pcall(BackstageForeverProfileSent,BackstageForeverDesktopData,who.name,who.realm)
        sent=ok and found or false
    end
    if sent and rawget(db(),'done')~=sent.sum then return sent end
end
function BackstageForeverProfileCommand(message)
    local raw=type(message)=='string' and #message<=80 and message or ''
    local arg,value=raw:lower():match('^profile%s*(%a*)%s*(.-)%s*$')
    arg=arg or ''
    if arg=='' or arg=='export' or arg=='import' then
        if open() and arg=='export' and frame then frame.data:SetChecked(value=='data') end
        return
    end
    if arg=='list' then
        local rows=BackstageForeverProfileList(BackstageForeverProfileDB)
        if #rows==0 then return say('No profile is kept on this character yet. /bf profile save NAME keeps the settings as they are now.') end
        say(('Profiles kept on this character: %d.'):format(#rows))
        for _,row in ipairs(rows) do line(('  %s - /bf profile load %s'):format(row.name,row.name)) end
        return rows
    end
    if arg=='share' then
        if value~='on' and value~='off' then value=BackstageForeverProfileShared() and 'off' or 'on' end
        db().share=value=='on'
        capture()
        return say(value=='on' and 'Profiles to the desktop app: on. After /reload the desktop app lists this character\'s kept profiles under Settings. Nothing leaves this computer.'
            or 'Profiles to the desktop app: off.')
    end
    if combat() then return say('Change profiles outside combat.') end
    if arg=='accept' or arg=='dismiss' then
        local offer=offered()
        if not offer then return say('The desktop app has sent no new profile to this character.') end
        if arg=='dismiss' then db().done=offer.sum;capture() return say('The profile from the desktop app is left alone.') end
        local result,why,doc=applyCode(offer.code,false)
        if not result then return say(why) end
        db().done=offer.sum;capture()
        return say(applied(result,doc))
    end
    local name=BackstageForeverProfileName(value)
    if arg=='save' or arg=='load' or arg=='delete' then
        if not name then return say('Give the profile a short name: letters, digits and hyphens, for example /bf profile save raiding.') end
        local kept=db().profiles
        if arg=='save' then
            if name=='undo' then return say('The name "undo" is kept for the settings before your last import.') end
            local count=0
            for other in pairs(kept) do if other~='undo' and other~=name then count=count+1 end end
            if count>=MAX_KEPT then return say('Eight profiles are kept on this character already. /bf profile delete NAME makes room.') end
            local code=currentCode(false)
            if not code then return say('The settings could not be written as a code.') end
            kept[name]={code=code,at=call(time)}
            capture()
            return say(('Profile "%s" kept: this character\'s settings as they are now.'):format(name))
        end
        local row=kept[name]
        if type(row)~='table' or type(row.code)~='string' then return say(('No profile named "%s" is kept on this character. /bf profile list shows them.'):format(name)) end
        if arg=='delete' then kept[name]=nil;capture() return say(('Profile "%s" deleted.'):format(name)) end
        local result,why,doc=applyCode(row.code,false)
        if not result then return say(why) end
        return say(applied(result,doc))
    end
    say('Use /bf profile for the window, or /bf profile save NAME, load NAME, delete NAME, list, share on, accept or dismiss.')
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        pcall(events.RegisterEvent,events,'PLAYER_LOGIN')
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Profile',events) end
        pcall(events.SetScript,events,'OnEvent',function()
            local after=field(plain(C_Timer),'After')
            -- A profile sent from the desktop app is only offered. It is applied when you type the command.
            local function offer()
                local found=offered()
                if found then say(('The desktop app sent the profile "%s" from %s. /bf profile accept uses it; /bf profile dismiss leaves your settings alone.'):format(found.name,found.from)) end
            end
            if type(after)=='function' then pcall(after,8,function() pcall(offer) end) else pcall(offer) end
        end)
    end
end

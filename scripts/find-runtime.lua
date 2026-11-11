-- /bf find <words>: nearest matching NPC, flight master, trainer, vendor, herb or ore.
-- Prefers your current map, sets a native waypoint for the best match and lists others.
-- Lua 5.1 compatible (no goto, no integer division).
local KIND_WORDS={f={'flight','fly','flightmaster','gryphon','wind','bat'},t={'trainer','train'},v={'vendor','merchant','shop','sell','buy'},h={'herb','herbs','flower'},o={'ore','mine','mining','vein','node'}}
local function norm(s) local v=tostring(s or ''):lower():gsub("[%'`]",''):gsub('[^%w]+',' ') return v end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..m) end end
local function zone(id) return (BackstageForeverFindMaps or {})[id] or ('map '..id) end
local function here()
    local api=type(C_Map)=='table' and C_Map or nil
    if not api then return nil end
    local ok,map=pcall(api.GetBestMapForUnit,'player'); if not ok or type(map)~='number' then return nil end
    local ok2,pos=pcall(api.GetPlayerMapPosition,map,'player')
    local x,y
    if ok2 and type(pos)=='table' and type(pos.GetXY)=='function' then local ok3,a,b=pcall(pos.GetXY,pos) if ok3 then x,y=a,b end end
    if type(issecretvalue)=='function' and ((x~=nil and issecretvalue(x)) or (y~=nil and issecretvalue(y))) then x,y=nil,nil end
    return map,tonumber(x),tonumber(y)
end
local function describe(r) return r[1]..(r[2]~='' and (' ('..r[2]..')') or '') end
function BackstageForeverFind(message)
    local query=type(message)=='string' and message:match('^find%s+(.+)$')
    if not query or #query>60 then return say('Use /bf find NAME, or /bf find flight, trainer, vendor, herb or ore.') end
    local q=norm(query); local words={}
    for w in q:gmatch('%S+') do words[#words+1]=w end
    local kinds={}
    for code,list in pairs(KIND_WORDS) do for _,w in ipairs(list) do for _,qw in ipairs(words) do if qw==w then kinds[code]=true end end end end
    local map,px,py=here()
    local found={}
    for _,r in ipairs(BackstageForeverFindData or {}) do
        local hay=norm(r[1]..' '..r[2])
        local textHit=true
        for _,w in ipairs(words) do if not hay:find(w,1,true) then textHit=false break end end
        local kindHit=kinds[r[6]]
        if textHit or kindHit then
            local score=(norm(r[1])==q and 4 or 0)+(r[3]==map and 2 or 0)+(kindHit and 1 or 0)
            local d=(r[3]==map and px and py) and math.sqrt((r[4]/1000-px)^2+(r[5]/1000-py)^2) or 9
            found[#found+1]={r=r,score=score,d=d}
        end
        if #found>400 then break end
    end
    if #found==0 then return say('No match for "'..query..'" in the bundled reference. Coverage grows with each release.') end
    table.sort(found,function(a,b) if a.score~=b.score then return a.score>b.score end return a.d<b.d end)
    local best=found[1].r
    if best[3]~=map then say(describe(best)..' is in '..zone(best[3])..'; travel there first.') end
    if type(BackstageForeverWay)=='function' then BackstageForeverWay(('way %d %.1f %.1f %s'):format(best[3],best[4]/10,best[5]/10,best[1])) end
    local seen={[best[1]..'@'..best[3]]=true}
    local shown=0
    for i=2,#found do
        local r=found[i].r
        local key=r[1]..'@'..r[3]
        if shown<3 and not seen[key] then
            seen[key]=true shown=shown+1
            say(('  also: %s, %s %.1f, %.1f — /bf way %d %.1f %.1f'):format(describe(r),zone(r[3]),r[4]/10,r[5]/10,r[3],r[4]/10,r[5]/10))
        end
    end
end

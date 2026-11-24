-- /bf find <words>: nearest matching NPC, quest giver (by any quest players met), flight master,
-- trainer, vendor (or what a vendor sells), dungeon, boss, rare enemy, herb, ore, chest or mailbox
-- from the bundled reference. The same index the desktop's "Search everything" uses, cut to fit.
-- Prefers your current map, sets a native waypoint for the best match and lists others.
-- Lua 5.1 compatible (no goto, no integer division).
local KIND_WORDS={f={'flight','fly','flightmaster','gryphon','wind','bat'},t={'trainer','train'},v={'vendor','merchant','shop','sell','buy'},h={'herb','herbs','flower'},o={'ore','mine','mining','vein','node'},
    q={'quest','quests','questgiver'},r={'rare','rares'},c={'chest','chests','treasure'},m={'mail','mailbox','post'},d={'dungeon','dungeons','instance','raid'},b={'boss','bosses'}}
local function norm(s) local v=tostring(s or ''):lower():gsub("[%'`]",''):gsub('[^%w]+',' ') return v end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end end
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
BackstageForeverFindHere=here
-- quest: a quest title from BackstageForeverFindQuests that this giver hands out (level may be 0: unknown).
local function describe(r,item,quest,level)
    if quest then return quest..' ('..(level and level>0 and ('quest, level '..level) or 'quest')..') from '..r[1] end
    return r[1]..(r[2]~='' and (' ('..r[2]..')') or '')..(item and (' sells '..item) or '')
end
BackstageForeverFindDescribe=describe
-- Pure: rows matching the words, best first: an exact name, then your own map, then the nearest.
-- map, px, py: where you are (may be nil). Returns a list of {r=row,score=,d=,item=}; item is the
-- ware that matched when a vendor was found by what it sells; quest and level are set when a quest
-- title matched (r is then its giver). One entry per name and map. The list also carries .total,
-- the number of different matches before the limit.
function BackstageForeverFindSearch(query,map,px,py,limit)
    local found={}
    if type(query)~='string' or query=='' or #query>60 then return found end
    local q=norm(query); local words={}
    for w in q:gmatch('%S+') do words[#words+1]=w end
    if #words==0 then return found end
    local kinds={}
    for code,list in pairs(KIND_WORDS) do for _,w in ipairs(list) do for _,qw in ipairs(words) do if qw==w then kinds[code]=true end end end end
    -- Wares whose name holds every word.
    local wares,anyWare={},false
    for i,name in ipairs(BackstageForeverFindItems or {}) do
        local hay=norm(name); local hit=true
        for _,w in ipairs(words) do if not hay:find(w,1,true) then hit=false break end end
        if hit then wares[i]=name anyWare=true end
    end
    for _,r in ipairs(BackstageForeverFindData or {}) do
        local hay=norm(r[1]..' '..r[2])
        local textHit=true
        for _,w in ipairs(words) do if not hay:find(w,1,true) then textHit=false break end end
        local kindHit=kinds[r[6]]
        local item=nil
        if anyWare and not textHit and r[7] then for _,i in ipairs(r[7]) do if wares[i] then item=wares[i] break end end end
        if textHit or kindHit or item then
            local score=(norm(r[1])==q and 4 or 0)+(r[3]==map and 2 or 0)+(kindHit and 1 or 0)+(textHit and 1 or 0)
            local d=(r[3]==map and px and py) and math.sqrt((r[4]/1000-px)^2+(r[5]/1000-py)^2) or 9
            found[#found+1]={r=r,score=score,d=d,item=item}
        end
    end
    -- Quests players met in Forever: any title finds its giver.
    local data=BackstageForeverFindData or {}
    for _,quest in ipairs(BackstageForeverFindQuests or {}) do
        local r=data[quest[3]]
        if r then
            local hay=norm(quest[1]); local hit=true
            for _,w in ipairs(words) do if not hay:find(w,1,true) then hit=false break end end
            if hit then
                local d=(r[3]==map and px and py) and math.sqrt((r[4]/1000-px)^2+(r[5]/1000-py)^2) or 9
                found[#found+1]={r=r,score=(hay==q and 4 or 0)+(r[3]==map and 2 or 0)+1,d=d,quest=quest[1],level=quest[2]}
            end
        end
    end
    table.sort(found,function(a,b)
        if a.score~=b.score then return a.score>b.score end
        if a.d~=b.d then return a.d<b.d end
        local an,bn=a.quest or a.r[1],b.quest or b.r[1]
        if an~=bn then return an<bn end
        return a.r[3]<b.r[3]
    end)
    local out,seen,total={},{},0
    limit=type(limit)=='number' and limit or 8
    for _,f in ipairs(found) do
        local key=(f.quest and ('q:'..f.quest) or f.r[1])..'@'..f.r[3]
        if not seen[key] then seen[key]=true total=total+1 if #out<limit then out[#out+1]=f end end
    end
    out.total=total
    return out
end
function BackstageForeverFind(message)
    local query=type(message)=='string' and message:match('^find%s+(.+)$')
    if not query or #query>60 then return say('Use /bf find NAME, or /bf find flight, trainer, vendor, dungeon, quest, rare, herb, ore, chest or mailbox.') end
    local map,px,py=here()
    local found=BackstageForeverFindSearch(query,map,px,py,4)
    if #found==0 then return say('No match for "'..query..'" in the bundled reference. Coverage grows with each release.') end
    local best=found[1].r
    if found[1].quest then say(describe(best,nil,found[1].quest,found[1].level)..'.') end
    if found[1].item then say(describe(best,found[1].item)..'.') end
    if best[6]=='d' or best[6]=='b' then say('This marks the entrance. The spot is approximate.') end
    if best[6]=='r' then say('Rare enemies are not always there: this is where a player met it.') end
    if best[3]~=map then say(describe(best)..' is in '..zone(best[3])..'; travel there first.') end
    if type(BackstageForeverWay)=='function' then BackstageForeverWay(('way %d %.1f %.1f %s'):format(best[3],best[4]/10,best[5]/10,best[1])) end
    for i=2,#found do
        local r=found[i].r
        say(('  also: %s, %s %.1f, %.1f — /bf way %d %.1f %.1f'):format(describe(r,found[i].item,found[i].quest,found[i].level),zone(r[3]),r[4]/10,r[5]/10,r[3],r[4]/10,r[5]/10))
    end
end

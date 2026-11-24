-- Group finder board (1.25, roadmap G7): the looking-for-group lines of the chat channels you
-- have already joined, read into a small sortable list.
--   /bf lfg            shows or hides the board        /bf lfg list   the same rows in chat
--   /bf lfg on|off     reading on or off               /bf lfg post DUNGEON   your own line, in your chat box
--   /bf lfg board      the realm board the desktop app handed over at your last /reload, in chat
--   /bf lfg list DUNGEON ...   your own listing on that realm board (BackstageForeverLiveGuild.lua)
-- Reading only: the addon never joins a channel and never sends a chat line. A click on a row puts
-- "/w Name " in your chat box; the post button puts your own line there. You press Enter.
-- The board lives in memory for this session; nothing other players wrote is saved.
local floor,min,max=math.floor,math.min,math.max
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
local function finite(v) return type(v)=='number' and v==v and v>-1e7 and v<1e7 end
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
local function combat() return call(InCombatLockdown)==true end

-- ---------------------------------------------------------------- dungeons and their short names
-- id (the Instance Atlas id), name, and what players type. Matching is on whole words only.
local DUNGEONS={
    {'rfc','Ragefire Chasm',{'rfc','ragefire','ragefire chasm','flammenschlund'}},
    {'wc','Wailing Caverns',{'wc','wailing caverns','wailing','hdw'}},
    {'dm','Deadmines',{'vc','deadmines','dead mines','the deadmines','todesminen'}},
    {'sfk','Shadowfang Keep',{'sfk','shadowfang','shadowfang keep','bsf'}},
    {'bfd','Blackfathom Deeps',{'bfd','blackfathom','blackfathom deeps','tsg'}},
    {'stocks','The Stockade',{'stocks','stockade','stockades','the stockade','verlies'}},
    {'gnomer','Gnomeregan',{'gnomer','gnomeregan'}},
    {'rfk','Razorfen Kraul',{'rfk','kraul','razorfen kraul','kral'}},
    {'sm','Scarlet Monastery',{'sm','scarlet monastery','monastery','sm gy','sm lib','sm arm','sm armory','sm cath','cath','kloster'}},
    {'rfd','Razorfen Downs',{'rfd','razorfen downs'}},
    {'ulda','Uldaman',{'ulda','uldaman','uld'}},
    {'zf','Zul\'Farrak',{'zf','zul farrak','zulfarrak'}},
    {'mara','Maraudon',{'mara','maraudon'}},
    {'st','Sunken Temple',{'st','sunken temple','temple of atal hakkar','temple of atalhakkar','versunkener tempel'}},
    {'brd','Blackrock Depths',{'brd','blackrock depths','brt'}},
    {'lbrs','Lower Blackrock Spire',{'lbrs','lower blackrock spire','lower brs'}},
    {'dme','Dire Maul',{'dire maul','diremaul','dme','dmw','dmn','dmt','dm east','dm west','dm north','dm e','dm w','dm n','dm tribute','dm trib','duesterbruch','d\195\188sterbruch'}},
    {'scholo','Scholomance',{'scholo','scholomance'}},
    {'strat','Stratholme',{'strat','stratholme','strat live','strat ud','strat dead'}},
    {'ubrs','Upper Blackrock Spire',{'ubrs','upper blackrock spire','upper brs'}},
    {'zg','Zul\'Gurub',{'zg','zul gurub','zulgurub'}},
    {'mc','Molten Core',{'mc','molten core'}},
    {'ony','Onyxia\'s Lair',{'ony','onyxia','onyxias lair'}},
    {'bwl','Blackwing Lair',{'bwl','blackwing lair'}},
    {'aq20','Ruins of Ahn\'Qiraj',{'aq20','ruins of ahn qiraj','ruins of ahnqiraj'}},
    {'aq40','Temple of Ahn\'Qiraj',{'aq40','temple of ahn qiraj','temple of ahnqiraj'}},
    {'naxx','Naxxramas',{'naxx','naxxramas'}},
}
local NAME,ORDER,ALIAS={},{},{}
for i,row in ipairs(DUNGEONS) do
    NAME[row[1]]=row[2];ORDER[row[1]]=i
    for _,alias in ipairs(row[3]) do ALIAS[alias]=row[1] end
end
BackstageForeverLfgDungeons=DUNGEONS
-- "dm" alone is Deadmines to a low character and Dire Maul to a high one; the board says both.
-- It is not a dungeon at all in "dm me" or "pls dm".
local DM_NOT_AFTER={me=true,us=true,you=true,u=true,him=true,her=true,pls=true,plz=true,please=true}
local DM_NOT_BEFORE={pls=true,plz=true,please=true,just=true}
local TRADE={wts=true,wtb=true,wtt=true,selling=true,buying=true,verkaufe=true,kaufe=true}
local ROLE={tank='tank',tanks='tank',mt='tank',
    healer='healer',heal='healer',heals='healer',healers='healer',heiler='healer',
    dps='dps',dd='dps',dds='dps',damage='dps',dmg='dps'}
local ROLE_ORDER={'tank','healer','dps'}
-- "lf", "looking for" and the German "suche": a group when followed by one of these, players otherwise.
local OPEN={lf=true,suche=true,suchen=true,sucht=true}
local GROUP_WORD={group=true,grp=true,gruppe=true,party=true,dungeon=true,run=true}
local NOT_A_GROUP={guild=true,gilde=true,work=true,enchanter=true,enchant=true,port=true,portal=true,summon=true,crafter=true,
    blacksmith=true,tailor=true,alchemist=true}
local NEED={need=true,needs=true,brauchen=true,braucht=true}
local SKIP={['for']=true,a=true,an=true,the=true,more=true,m=true,eine=true,einen=true,noch=true,['f\195\188r']=true,fuer=true}

-- Colour codes and links carry no words of their own beyond the bracketed name.
local function strip(text)
    return (text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|[hr]',''):gsub('|',' '))
end
local function tokens(text)
    local out={}
    text=strip(text):lower():gsub("'",''):gsub('\226\128\153','')
    for word in text:gmatch('[%w\128-\255]+') do
        out[#out+1]=word
        if #out>=48 then break end
    end
    return out
end
-- The word after an opening word, past "for", "a", "1", "more" and the like.
local function after(t,i)
    for j=i+1,min(#t,i+4) do
        local w=t[j]
        if not SKIP[w] and not w:match('^%d+$') then return w end
    end
end
-- Pure: the dungeon a few words name. -> id, other id when "dm" could be either, or nil.
local function dungeonAt(t,i)
    for len=min(4,#t-i+1),1,-1 do
        local phrase=len==1 and t[i] or table.concat(t,' ',i,i+len-1)
        local id=ALIAS[phrase]
        if id then return id,nil,len end
    end
    if t[i]=='dm' and not DM_NOT_AFTER[t[i+1] or ''] and not DM_NOT_BEFORE[t[i-1] or ''] then return 'dm','dme',1 end
end
-- Pure: a dungeon typed by the player ("sm", "Scarlet Monastery", "dm east") -> id or nil.
function BackstageForeverLfgDungeon(text)
    if type(text)~='string' or #text>60 then return nil end
    local t=tokens(text)
    for i=1,#t do
        local id=dungeonAt(t,i)
        if id then return id end
    end
end
function BackstageForeverLfgName(id,either)
    local name=NAME[id]
    if not name then return nil end
    if either and NAME[either] then return name..' / '..NAME[either] end
    return name
end
-- Pure: one chat line -> {dungeon=id, either=id or nil, kind='want' (a group wants players) or
-- 'seek' (a player wants a group), roles={'tank','healer','dps'}} or nil when it is not a
-- looking-for-group line for a dungeon the board knows.
function BackstageForeverLfgParse(text)
    if type(text)~='string' or #text<3 or #text>255 then return nil end
    local t=tokens(text)
    if #t==0 or TRADE[t[1]] then return nil end
    local kind,found,either,roles=nil,nil,nil,{}
    local i=1
    while i<=#t do
        local w=t[i]
        local step=1
        if w=='lfg' then kind=kind or 'seek'
        elseif w=='lfm' or w:match('^lf%d+m$') then kind='want'
        elseif OPEN[w] or (w=='looking' and t[i+1]=='for') then
            local nextWord=after(t,w=='looking' and i+1 or i)
            if nextWord and NOT_A_GROUP[nextWord] then -- "LF guild", "LF enchanter": not a group
            elseif nextWord and GROUP_WORD[nextWord] then kind=kind or 'seek'
            else kind=kind or 'want' end
        elseif NEED[w] then kind=kind or 'want' end
        if ROLE[w] then roles[ROLE[w]]=true end
        if not found then
            local id,other,len=dungeonAt(t,i)
            if id then found,either,step=id,other,len end
        end
        i=i+step
    end
    if not kind or not found then return nil end
    local list={}
    for _,role in ipairs(ROLE_ORDER) do if roles[role] then list[#list+1]=role end end
    return {dungeon=found,either=either,kind=kind,roles=list}
end

-- ---------------------------------------------------------------- the board
local MAX_ROWS,KEEP_SECONDS=60,15*60
-- Pure: a sender's name as the board keeps it: letters, an optional -Realm, nothing else.
function BackstageForeverLfgWho(name)
    if type(name)~='string' or #name<2 or #name>48 then return nil end
    if name:find('[%d%c%s|]') then return nil end
    if name:find('%p') and not name:match('^[^%p]+%-[^%p]+$') then return nil end
    return name
end
local function sameName(a,b) return a:lower()==b:lower() end
-- Pure: drops rows older than 15 minutes (and rows from the future, after a clock change).
function BackstageForeverLfgPrune(board,now)
    if type(board)~='table' or type(now)~='number' then return 0 end
    local dropped=0
    for i=#board,1,-1 do
        local at=board[i].at
        if type(at)~='number' or now-at>=KEEP_SECONDS or at>now+60 then table.remove(board,i);dropped=dropped+1 end
    end
    return dropped
end
-- Pure: one row per player; a new line from the same player replaces the old one. At most 60 rows,
-- the oldest goes first. -> the row kept, or nil for anything that is not a clean line.
function BackstageForeverLfgAdd(board,who,text,now,channel)
    if type(board)~='table' or type(now)~='number' then return nil end
    who=BackstageForeverLfgWho(who)
    local parsed=who and BackstageForeverLfgParse(text)
    if not parsed then return nil end
    for i=#board,1,-1 do if sameName(board[i].who,who) then table.remove(board,i) end end
    BackstageForeverLfgPrune(board,now)
    while #board>=MAX_ROWS do
        local oldest=1
        for i,row in ipairs(board) do if row.at<board[oldest].at then oldest=i end end
        table.remove(board,oldest)
    end
    local row={who=who,dungeon=parsed.dungeon,either=parsed.either,kind=parsed.kind,roles=parsed.roles,at=now,
        channel=type(channel)=='number' and channel>=1 and channel<=40 and floor(channel) or nil}
    board[#board+1]=row
    return row
end
-- Pure: a copy in the order asked for. by: 'dungeon' (lowest dungeon first, newest inside) or 'age' (newest first).
function BackstageForeverLfgSorted(board,by)
    local out={}
    for i,row in ipairs(type(board)=='table' and board or {}) do out[i]=row end
    table.sort(out,function(a,b)
        if by=='dungeon' and a.dungeon~=b.dungeon then return (ORDER[a.dungeon] or 999)<(ORDER[b.dungeon] or 999) end
        if a.at~=b.at then return a.at>b.at end
        return a.who<b.who
    end)
    return out
end
-- Pure: "now", "1 min", "14 min".
function BackstageForeverLfgAge(seconds)
    if type(seconds)~='number' or seconds~=seconds then return '' end
    if seconds<60 then return T('now') end
    if seconds>=7200 then return ('%d %s'):format(floor(seconds/3600),T('h')) end
    return ('%d %s'):format(floor(seconds/60),T('min'))
end
-- Pure: the realm board rows the desktop app handed over (BackstageForeverDeskBoard) as the board
-- paints them: {dungeon=,wanted=,who=,age=,row=}, at most limit, and how many were left out. now:
-- seconds since 1970; the age says how old a listing was when you last looked, never "now".
function BackstageForeverLfgBoardRows(rows,now,limit)
    limit=type(limit)=='number' and limit>=1 and limit or 6
    local out={}
    rows=type(rows)=='table' and rows or {}
    for i=1,min(#rows,limit) do
        local row=rows[i]
        local wanted=type(BackstageForeverListingWanted)=='function' and BackstageForeverListingWanted(row) or ''
        if row.note then wanted=wanted..' · '..row.note end
        out[i]={dungeon=BackstageForeverLfgName(row.place) or row.place,wanted=wanted,who=row.who..(type(row.level)=='number' and (' ('..row.level..')') or ''),
            age=BackstageForeverLfgAge(max(60,(type(now)=='number' and now or row.at)-row.at)),row=row}
    end
    return out,#rows-#out
end
local ROLE_WORD={tank='tank',healer='healer',dps='damage'}
-- Pure: what a row is after, in plain words.
function BackstageForeverLfgWanted(row)
    if type(row)~='table' then return '' end
    local words={}
    for _,role in ipairs(type(row.roles)=='table' and row.roles or {}) do words[#words+1]=T(ROLE_WORD[role] or role) end
    if row.kind=='want' then
        if #words==0 then return T('players') end
        return T('needs')..' '..table.concat(words,', ')
    end
    if #words==0 then return T('wants a group') end
    return T('plays')..' '..table.concat(words,', ')
end
-- Pure: the rows the board paints: {dungeon=,wanted=,who=,age=,row=}, at most limit, and how many were left out.
function BackstageForeverLfgRows(board,by,now,limit)
    limit=type(limit)=='number' and limit>=1 and limit or 12
    local sorted=BackstageForeverLfgSorted(board,by)
    local out={}
    for i=1,min(#sorted,limit) do
        local row=sorted[i]
        out[i]={dungeon=BackstageForeverLfgName(row.dungeon,row.either) or row.dungeon,wanted=BackstageForeverLfgWanted(row),who=row.who,
            age=BackstageForeverLfgAge((type(now)=='number' and now or row.at)-row.at),row=row}
    end
    return out,#sorted-#out
end
-- Pure: your own line for the chat box. channel: the number of the channel the board row came from;
-- the line then starts with "/4 " so it goes there when you press Enter.
function BackstageForeverLfgPost(dungeon,level,class,channel)
    local name=NAME[dungeon]
    if not name then return nil end
    local text
    if type(level)=='number' and level>=1 and type(class)=='string' and class~='' and #class<=30 and not class:find('[|%c]') then
        text=T(('LFG %s, level %d %s'):format(name,floor(level),class))
    else text=T(('LFG %s'):format(name)) end
    if type(channel)=='number' and channel>=1 and channel<=40 then text=('/%d %s'):format(floor(channel),text) end
    return text
end
-- Pure: the whisper start for a row. The name was checked when the row was made.
function BackstageForeverLfgWhisper(row)
    local who=type(row)=='table' and BackstageForeverLfgWho(row.who)
    return who and ('/w '..who..' ') or nil
end

-- ---------------------------------------------------------------- switches and state
function BackstageForeverLfgEnabled()
    local s=BackstageForeverLfgSettings
    return type(s)~='table' or rawget(s,'enabled')~=false
end
local function settings()
    if type(BackstageForeverLfgSettings)~='table' then BackstageForeverLfgSettings={} end
    return BackstageForeverLfgSettings
end
local board={}
BackstageForeverLfgBoard=board
local selected=nil -- the row you clicked last: the post button writes for its dungeon
local function clock() local t=call(GetTime);return type(t)=='number' and t or 0 end
local function sortBy() return rawget(settings(),'sort')=='age' and 'age' or 'dungeon' end
-- Puts text in the chat box for the player to read, change and send. It never sends.
local function toChatBox(text)
    local open=field(plain(ChatFrameUtil),'OpenChat') or plain(ChatFrame_OpenChat)
    if type(open)~='function' then return false end
    return (pcall(open,text))
end

-- ---------------------------------------------------------------- the board on screen
-- Fixed column widths and no wrapping: a long name is cut short, it never runs into the next column.
local WIDTH,INSET,LINE,TOP,LINES=460,16,14,-52,12
local BOARD_LINES=6 -- rows of the realm board under the chat rows
local function wallClock() local t=call(time);return type(t)=='number' and t or 0 end
-- The realm board as of the last /reload: rows, and whether the desktop app handed one over at all.
local function deskBoard()
    local fn=BackstageForeverLfgDeskRows
    if type(fn)~='function' then return {},false end
    local ok,rows,given=pcall(fn)
    if not ok or type(rows)~='table' then return {},false end
    return rows,given==true
end
local COLUMNS={{'dungeon',0,135,'LEFT','Dungeon'},{'wanted',141,130,'LEFT','Looking for'},{'who',277,90,'LEFT','Who'},{'age',373,55,'RIGHT','Seen'}}
BackstageForeverLfgColumns=COLUMNS
local frame
local function paint()
    if not frame then return end
    local at=clock()
    BackstageForeverLfgPrune(board,at)
    local by=sortBy()
    local rows,more=BackstageForeverLfgRows(board,by,at,LINES)
    for i,line in ipairs(frame.lines) do
        local data=rows[i]
        if data then
            for _,column in ipairs(COLUMNS) do line[column[1]]:SetText(data[column[1]] or '') end
            line.data=data.row
            line.mark:SetAlpha(selected==data.row and 1 or 0)
            line:Show()
        else line.data=nil;line:Hide() end
    end
    local note
    if #rows==0 then note=T(BackstageForeverLfgEnabled() and 'No looking-for-group line seen yet in the channels you have joined.' or 'Reading is off. /bf lfg on turns it on.')
    elseif more>0 then note=('+%d %s'):format(more,T('more')) else note='' end
    frame.note:SetText(note)
    frame.note:ClearAllPoints();frame.note:SetPoint('TOPLEFT',INSET,TOP-#rows*LINE-2)
    frame.heads.dungeon:SetText((by=='dungeon' and '|cffffffff' or '|cffffd100')..T('Dungeon')..'|r')
    frame.heads.age:SetText((by=='age' and '|cffffffff' or '|cffffd100')..T('Seen')..'|r')
    -- Under the chat rows: the realm board the desktop app handed over, as old as your last /reload.
    local used=#rows+(note~='' and 1 or 0)
    local listed,given=deskBoard()
    local extra=0
    if given then
        local boardRows,boardMore=BackstageForeverLfgBoardRows(listed,wallClock(),BOARD_LINES)
        local y=TOP-used*LINE-10
        frame.boardHead:ClearAllPoints();frame.boardHead:SetPoint('TOPLEFT',INSET,y)
        frame.boardHead:SetText(T('Realm board, from the desktop app, as of your last /reload'));frame.boardHead:Show()
        for i,line in ipairs(frame.boardLines) do
            local data=boardRows[i]
            if data then
                line:ClearAllPoints();line:SetPoint('TOPLEFT',INSET,y-LINE-2-(i-1)*LINE)
                for _,column in ipairs(COLUMNS) do line[column[1]]:SetText(data[column[1]] or '') end
                line.data=data.row;line:Show()
            else line.data=nil;line:Hide() end
        end
        local boardNote=#boardRows==0 and T('No listing on the realm board at your last /reload.') or boardMore>0 and ('+%d %s'):format(boardMore,T('more')) or ''
        frame.boardNote:ClearAllPoints();frame.boardNote:SetPoint('TOPLEFT',INSET,y-LINE-2-#boardRows*LINE)
        frame.boardNote:SetText(boardNote)
        extra=10+LINE+2+(#boardRows+(boardNote~='' and 1 or 0))*LINE
    else
        frame.boardHead:Hide();frame.boardNote:SetText('')
        for _,line in ipairs(frame.boardLines) do line.data=nil;line:Hide() end
    end
    frame:SetHeight(-TOP+used*LINE+extra+48)
end
local function build()
    if frame or type(CreateFrame)~='function' or not UIParent then return frame end
    local f=CreateFrame('Frame','BackstageForeverLfgFrame',UIParent)
    f:Hide();f:SetSize(WIDTH,160)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    local pos=rawget(settings(),'pos')
    if type(pos)=='table' and finite(pos.x) and finite(pos.y) and pos.x>=0 and pos.y>=0 then f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',pos.x,pos.y)
    else f:SetPoint('TOPLEFT',UIParent,'TOPLEFT',24,-180) end
    f:SetFrameStrata('MEDIUM');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    local function startDrag() if not combat() then f:StartMoving() end end
    local function stopDrag()
        f:StopMovingOrSizing()
        local left,top=call(f.GetLeft,f),call(f.GetTop,f)
        if finite(left) and finite(top) and left>=0 and top>=0 then
            f:ClearAllPoints();f:SetPoint('TOPLEFT',UIParent,'BOTTOMLEFT',left,top)
            settings().pos={x=left,y=top}
        end
    end
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',startDrag);f:SetScript('OnDragStop',stopDrag)
    -- The same painted leather-and-brass frame as the quest list and the run panel.
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    title:SetPoint('TOPLEFT',INSET,-12);title:SetWidth(WIDTH-INSET*2-22);title:SetJustifyH('LEFT');title:SetWordWrap(false)
    title:SetText(T('Group finder board'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide() end)
    f.heads={}
    for _,column in ipairs(COLUMNS) do
        local key=column[1]
        local head=CreateFrame('Button',nil,f)
        head:SetSize(column[3],LINE);head:SetPoint('TOPLEFT',INSET+column[2],-32)
        local label=head:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
        label:SetAllPoints();label:SetJustifyH(column[4]);label:SetWordWrap(false);label:SetText(T(column[5]))
        if key=='dungeon' or key=='age' then
            head:SetScript('OnClick',function() settings().sort=key;paint() end)
            head:SetScript('OnEnter',function(self)
                if type(GameTooltip)~='table' then return end
                pcall(GameTooltip.SetOwner,GameTooltip,self,'ANCHOR_TOP')
                pcall(GameTooltip.SetText,GameTooltip,T(key=='dungeon' and 'Click: sort by dungeon.' or 'Click: newest first.'),1,1,1)
                pcall(GameTooltip.Show,GameTooltip)
            end)
            head:SetScript('OnLeave',function() if type(GameTooltip)=='table' then pcall(GameTooltip.Hide,GameTooltip) end end)
        end
        f.heads[key]=label
    end
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,TOP+3)
    f.lines={}
    for i=1,LINES do
        local line=CreateFrame('Button',nil,f)
        line:SetSize(WIDTH-INSET*2,LINE);line:SetPoint('TOPLEFT',INSET,TOP-(i-1)*LINE)
        local hover=line:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        line.mark=line:CreateTexture(nil,'BACKGROUND');line.mark:SetAllPoints();line.mark:SetColorTexture(.79,.62,.27,.22);line.mark:SetAlpha(0)
        for _,column in ipairs(COLUMNS) do
            local text=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
            text:SetPoint('LEFT',column[2],0);text:SetWidth(column[3]);text:SetJustifyH(column[4]);text:SetWordWrap(false)
            line[column[1]]=text
        end
        line:RegisterForDrag('LeftButton');line:SetScript('OnDragStart',startDrag);line:SetScript('OnDragStop',stopDrag)
        line:SetScript('OnClick',function(self)
            if not self.data then return end
            selected=self.data
            local text=BackstageForeverLfgWhisper(self.data)
            if not text or not toChatBox(text) then say('The chat box cannot be opened from here.') end
            paint()
        end)
        line:Hide()
        f.lines[i]=line
    end
    f.note=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    f.note:SetWidth(WIDTH-INSET*2);f.note:SetJustifyH('LEFT');f.note:SetWordWrap(false)
    -- The realm board section: a heading, six rows in the same columns, a note. Hidden until the
    -- desktop app handed a board over.
    f.boardHead=f:CreateFontString(nil,'OVERLAY','GameFontNormalSmall')
    f.boardHead:SetWidth(WIDTH-INSET*2);f.boardHead:SetJustifyH('LEFT');f.boardHead:SetWordWrap(false);f.boardHead:Hide()
    f.boardNote=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    f.boardNote:SetWidth(WIDTH-INSET*2);f.boardNote:SetJustifyH('LEFT');f.boardNote:SetWordWrap(false)
    f.boardLines={}
    for i=1,BOARD_LINES do
        local line=CreateFrame('Button',nil,f)
        line:SetSize(WIDTH-INSET*2,LINE)
        local hover=line:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        for _,column in ipairs(COLUMNS) do
            local text=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
            text:SetPoint('LEFT',column[2],0);text:SetWidth(column[3]);text:SetJustifyH(column[4]);text:SetWordWrap(false)
            line[column[1]]=text
        end
        line:RegisterForDrag('LeftButton');line:SetScript('OnDragStart',startDrag);line:SetScript('OnDragStop',stopDrag)
        line:SetScript('OnClick',function(self)
            if not self.data then return end
            local text=BackstageForeverLfgWhisper({who=self.data.who})
            if not text or not toChatBox(text) then say('The chat box cannot be opened from here.') end
        end)
        line:Hide()
        f.boardLines[i]=line
    end
    local post=CreateFrame('Button',nil,f,'UIPanelButtonTemplate')
    post:SetSize(170,22);post:SetPoint('BOTTOMLEFT',INSET,12);post:SetText(T('Write my line'))
    post:SetScript('OnClick',function() pcall(BackstageForeverLfgCommand,'lfg post') end)
    local hint=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    hint:SetPoint('LEFT',post,'RIGHT',8,0);hint:SetWidth(WIDTH-INSET*2-178);hint:SetJustifyH('LEFT');hint:SetWordWrap(false)
    hint:SetText(T('Click a row to whisper. You press Enter.'))
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverLfgFrame') end
    frame=f
    return f
end
local function show()
    if combat() then return false end
    local ok,f=pcall(build)
    if not ok or not f then return false end
    paint();f:Show()
    return true
end

-- ---------------------------------------------------------------- commands
local function post(dungeon,channel)
    local level=call(UnitLevel,'player')
    local class=call(UnitClass,'player')
    local text=BackstageForeverLfgPost(dungeon,type(level)=='number' and level or nil,type(class)=='string' and class or nil,channel)
    if not text then return say('Name a dungeon the board knows, for example /bf lfg post sm.') end
    if not toChatBox(text) then say('The chat box cannot be opened from here. The line was:');say('  '..text) return end
    say('Your line is in the chat box. Change it as you like and press Enter to send it.')
end
function BackstageForeverLfgCommand(message)
    local rest=type(message)=='string' and #message<=80 and message:match('^%a+%s*(.-)%s*$') or ''
    local word,tail=rest:lower():match('^(%a*)%s*(.*)$')
    -- The realm board the desktop app handed over, in chat.
    local function boardInChat(always)
        local listed,given=deskBoard()
        if not given then
            if always then say('No realm board from the desktop app yet. It arrives at login or /reload when the realm board is switched on in the app.') end
            return
        end
        local rows,more=BackstageForeverLfgBoardRows(listed,wallClock(),8)
        if #rows==0 then return say('Realm board: no listing at your last /reload.') end
        say(('Realm board, as of your last /reload: %d.'):format(#rows+more))
        for _,row in ipairs(rows) do say(('  %s: %s, %s (%s)'):format(row.dungeon,row.who,row.wanted,row.age)) end
    end
    if word=='board' then return boardInChat(true) end
    -- /bf lfg list DUNGEON ... posts your own listing; the bare word still prints the chat board.
    if word=='list' and type(BackstageForeverListingCommand)=='function' then
        local ok,handled=pcall(BackstageForeverListingCommand,rest:match('^%a*%s*(.*)$') or '')
        if ok and handled then return end
    end
    if word=='on' or word=='off' then
        settings().enabled=word=='on'
        if word=='off' then for i=#board,1,-1 do board[i]=nil end selected=nil end
        if frame then paint() end
        return say(word=='on' and 'Group finder board: on. It reads the channels you have joined and never sends.' or 'Group finder board: off. No chat line is read.')
    end
    if word=='post' then
        if combat() then return say('Try /bf lfg post outside combat.') end
        if tail~='' then return post(BackstageForeverLfgDungeon(tail),nil) end
        if not selected then return say('Click a row first, or name the dungeon: /bf lfg post sm.') end
        return post(selected.dungeon,selected.channel)
    end
    if word=='list' then
        local at=clock()
        BackstageForeverLfgPrune(board,at)
        local rows,more=BackstageForeverLfgRows(board,sortBy(),at,10)
        if #rows==0 then say(BackstageForeverLfgEnabled() and 'No looking-for-group line seen yet in the channels you have joined.' or 'Reading is off. /bf lfg on turns it on.') return boardInChat(false) end
        say(#rows+more==1 and 'Group finder board: 1 line in the last 15 minutes.' or ('Group finder board: %d lines in the last 15 minutes.'):format(#rows+more))
        for _,row in ipairs(rows) do say(('  %s: %s, %s (%s)'):format(row.dungeon,row.who,row.wanted,row.age)) end
        return boardInChat(false)
    end
    if combat() then return say('Open the board outside combat.') end
    if frame and frame:IsShown() then frame:Hide() return false end
    if not show() then return say('The board is not available in this game client. /bf lfg list prints it in chat.') end
    return true
end

-- A line from a channel you are in. Only read: who, which dungeon, which roles. The text is not kept.
local function onChannel(text,sender,channelIndex)
    if not BackstageForeverLfgEnabled() then return end
    text,sender=plain(text),plain(sender)
    if type(text)~='string' or type(sender)~='string' then return end
    local short=call(Ambiguate,sender,'short')
    if type(short)=='string' and short~='' then sender=short end
    local mine=call(UnitName,'player')
    if type(mine)=='string' and sender==mine then return end
    if BackstageForeverLfgAdd(board,sender,text,clock(),plain(channelIndex)) and frame and frame:IsShown() and not combat() then paint() end
end
BackstageForeverLfgHeard=onChannel -- for tests

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','CHAT_MSG_CHANNEL','PLAYER_REGEN_DISABLED'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Lfg',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,text,sender,_,_,_,_,_,channelIndex)
            if event=='CHAT_MSG_CHANNEL' then pcall(onChannel,text,sender,channelIndex)
            elseif event=='PLAYER_REGEN_DISABLED' then if frame then frame:Hide() end
            else
                settings()
                -- The ages move on; repaint the open board now and then, never in combat.
                local timer=plain(C_Timer)
                if type(timer)=='table' and type(timer.NewTicker)=='function' then
                    pcall(timer.NewTicker,20,function() if frame and frame:IsShown() and not combat() then pcall(paint) end end)
                end
            end
        end)
    end
end

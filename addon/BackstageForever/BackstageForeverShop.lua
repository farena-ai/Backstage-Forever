-- Shopping at the auction house (1.25, roadmap E8): when you open the auction window, the
-- materials your profession plan still needs are listed in a small panel beside it.
--   /bf shop           the same list in chat, anywhere
--   /bf shop on|off    the panel at the auction house
-- A click on a line writes the item's name into the auction window's search box. The addon never
-- presses Search, never bids, buys or posts. The list is the profession plan /bf prof shows.
local min=math.min
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
local function combat() return call(InCombatLockdown)==true end

-- ---------------------------------------------------------------- pure
local MAX_ROWS,SEARCH_MAX=12,63
-- Pure: an item name fit for a search box: one line, no colour or link codes, at most 63 bytes.
function BackstageForeverShopSearch(name)
    if type(name)~='string' then return nil end
    name=name:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|H[^|]*|h',''):gsub('|T[^|]*|t',''):gsub('|[hr]',''):gsub('|',''):gsub('%c',' '):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if #name>SEARCH_MAX then name=name:sub(1,SEARCH_MAX):gsub('[\192-\255][\128-\191]*$',''):gsub(' $','') end
    return name~='' and name or nil
end
-- Pure: what the profession plan still needs. coach: the result of BackstageForeverBuildProfessionCoach.
-- -> rows {name=,missing= (nil when the amount is not known),required=}, at most 12; nil when there is no plan to read.
function BackstageForeverShopRows(coach)
    if type(coach)~='table' or type(coach.shoppingRows)~='table' then return nil end
    local rows={}
    for _,row in ipairs(coach.shoppingRows) do
        local name=type(row)=='table' and BackstageForeverShopSearch(row.name)
        if name and #rows<MAX_ROWS then
            local missing=type(row.missing)=='number' and row.missing==row.missing and row.missing>=0 and row.missing<1e6 and row.missing or nil
            if missing==nil or missing>0 then rows[#rows+1]={name=name,missing=missing,required=type(row.required)=='number' and row.required or nil} end
        end
    end
    return rows
end
-- Pure: how much of a row is missing, in words.
function BackstageForeverShopAmount(row)
    if type(row)~='table' then return '' end
    if row.missing then return ('%d %s'):format(row.missing,T('missing')) end
    return T('amount not known')
end
-- Pure: the chat lines for /bf shop.
function BackstageForeverShopLines(rows)
    if type(rows)~='table' then return {T('Your profession plan is not readable yet. Open your profession once, then try again.')} end
    if #rows==0 then return {T('Your profession plan needs nothing more right now. /bf prof shows the plan.')} end
    local lines={#rows==1 and T('Shopping list from your profession plan: 1 item.') or T(('Shopping list from your profession plan: %d items.'):format(#rows))}
    for _,row in ipairs(rows) do lines[#lines+1]=('  %s: %s'):format(row.name,BackstageForeverShopAmount(row)) end
    return lines
end

-- ---------------------------------------------------------------- live
function BackstageForeverShopEnabled()
    local s=BackstageForeverShopSettings
    return type(s)~='table' or rawget(s,'enabled')~=false
end
local latest=nil
function BackstageForeverShopUpdate(character) latest=type(character)=='table' and character or nil end
local function readRows()
    if not latest or type(BackstageForeverBuildProfessionCoach)~='function' then return nil end
    local hud=BackstageForeverHUDSettings
    local choice=type(hud)=='table' and rawget(hud,'profession')
    local ok,coach=pcall(BackstageForeverBuildProfessionCoach,latest,type(choice)=='table' and choice or {})
    return ok and BackstageForeverShopRows(coach) or nil
end
-- The auction window's own search box: the classic one, or the newer frame's.
local function searchBox()
    local box=plain(_G.BrowseName)
    if type(box)=='table' and type(box.SetText)=='function' then return box end
    box=field(field(plain(_G.AuctionHouseFrame),'SearchBar'),'SearchBox')
    if type(box)=='table' and type(box.SetText)=='function' then return box end
end
local WIDTH,INSET,LINE,TOP,RIGHT_WIDTH=250,14,14,-32,84
local frame
local function clicked(row)
    if combat() then return say('The search box waits until you leave combat.') end
    local text=BackstageForeverShopSearch(row.name)
    local box=searchBox()
    -- A plain text change on a plain edit box, from your click. Search stays yours to press.
    if not text or not box or not pcall(box.SetText,box,text) then return say(('The search box is not reachable here. Search for: %s'):format(text or '?')) end
end
local function build()
    if frame or type(CreateFrame)~='function' or not UIParent then return frame end
    local f=CreateFrame('Frame','BackstageForeverShopFrame',UIParent)
    f:Hide();f:SetSize(WIDTH,96)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    f:SetFrameStrata('MEDIUM');f:SetClampedToScreen(true);f:EnableMouse(true)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',32,11)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.96) end
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
    title:SetPoint('TOPLEFT',INSET,-12);title:SetWidth(WIDTH-INSET*2-22);title:SetJustifyH('LEFT');title:SetWordWrap(false)
    title:SetText(T('Shopping list'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(22,22);close:SetPoint('TOPRIGHT',-5,-5);close:SetScript('OnClick',function() f:Hide() end)
    local rule=f:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.6)
    rule:SetSize(WIDTH-INSET*2,1);rule:SetPoint('TOPLEFT',INSET,TOP+3)
    f.lines={}
    for i=1,MAX_ROWS do
        local line=CreateFrame('Button',nil,f)
        line:SetSize(WIDTH-INSET*2,LINE);line:SetPoint('TOPLEFT',INSET,TOP-(i-1)*LINE)
        local hover=line:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        line.left=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.left:SetPoint('LEFT',0,0);line.left:SetWidth(WIDTH-INSET*2-RIGHT_WIDTH-6);line.left:SetJustifyH('LEFT');line.left:SetWordWrap(false)
        line.right=line:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        line.right:SetPoint('RIGHT',0,0);line.right:SetWidth(RIGHT_WIDTH);line.right:SetJustifyH('RIGHT');line.right:SetWordWrap(false)
        line:SetScript('OnClick',function(self) if self.data then pcall(clicked,self.data) end end)
        line:Hide()
        f.lines[i]=line
    end
    f.hint=f:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    f.hint:SetPoint('BOTTOMLEFT',INSET,12);f.hint:SetWidth(WIDTH-INSET*2);f.hint:SetJustifyH('LEFT');f.hint:SetWordWrap(false)
    f.hint:SetText(T('Click a line to fill the search box.'))
    frame=f
    return f
end
local function show()
    if not BackstageForeverShopEnabled() or combat() then return false end
    local rows=readRows()
    -- Nothing to buy: no panel. /bf shop says why.
    if not rows or #rows==0 then if frame then frame:Hide() end return false end
    local ok,f=pcall(build)
    if not ok or not f then return false end
    for i,line in ipairs(f.lines) do
        local row=rows[i]
        if row then line.left:SetText(row.name);line.right:SetText(BackstageForeverShopAmount(row));line.data=row;line:Show()
        else line.data=nil;line:Hide() end
    end
    f:SetHeight(-TOP+#rows*LINE+34)
    f:ClearAllPoints()
    -- Our own frame, placed beside the auction window; the auction window itself is not changed.
    local host=plain(_G.AuctionFrame) or plain(_G.AuctionHouseFrame)
    if type(host)=='table' and pcall(f.SetPoint,f,'TOPLEFT',host,'TOPRIGHT',4,-12) then else f:SetPoint('TOPLEFT',UIParent,'TOPLEFT',24,-180) end
    f:Show()
    return true
end
function BackstageForeverShopCommand(message)
    local arg=type(message)=='string' and #message<=40 and message:lower():match('^%a+%s+(%a+)') or nil
    if arg=='on' or arg=='off' then
        if type(BackstageForeverShopSettings)~='table' then BackstageForeverShopSettings={} end
        BackstageForeverShopSettings.enabled=arg=='on'
        if arg=='off' and frame then frame:Hide() end
        return say(arg=='on' and 'Auction shopping list: on. It opens beside the auction window when your profession plan needs something.' or 'Auction shopping list: off. /bf shop still prints the list.')
    end
    for _,line in ipairs(BackstageForeverShopLines(readRows())) do say(line) end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'AUCTION_HOUSE_SHOW','AUCTION_HOUSE_CLOSED','PLAYER_REGEN_DISABLED'}) do pcall(events.RegisterEvent,events,e) end
        if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'Shop',events) end
        pcall(events.SetScript,events,'OnEvent',function(_,event)
            if event=='AUCTION_HOUSE_SHOW' then pcall(show)
            elseif frame then frame:Hide() end
        end)
    end
end

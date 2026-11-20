-- Beginner assist: plain-language help at the moments new players get lost.
-- Toasts for level-ups, deaths and finished quests, a warning over dangerous targets,
-- a click-to-sell junk button at vendors and your XP pace.
-- Public API only. Nothing acts in game without your click; toasts and chat lines only.
local floor,ceil=math.floor,math.ceil
local unpackAll=unpack or table.unpack
local function plain(v)
    if v==nil then return nil end
    local check=issecretvalue
    if type(check)=='function' then local ok,secret=pcall(check,v) if not ok or secret then return nil end end
    return v
end
local function call(fn,...)
    if type(fn)~='function' then return nil end
    local r={pcall(fn,...)}
    if not r[1] then return nil end
    for i=2,12 do r[i]=plain(r[i]) end
    return unpackAll(r,2,12)
end
local function field(t,k) if type(t)=='table' then return plain(t[k]) end end
local function num(v) v=tonumber(plain(v)) if v and v==v then return v end end
local function say(m) if type(DEFAULT_CHAT_FRAME)=='table' then pcall(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(m)) end end
local function combat() return call(InCombatLockdown)==true end
local settings
local function loadSettings()
    local s=type(BackstageForeverAssistSettings)=='table' and BackstageForeverAssistSettings or {}
    local tbl=function(v) return type(v)=='table' and v or {} end
    settings={toasts=s.toasts~=false,danger=s.danger~=false,junk=s.junk~=false,welcomed=s.welcomed==true,bossTips=s.bossTips~=false,
        repairers=tbl(s.repairers),flightNpcs=tbl(s.flightNpcs),flightNodes=tbl(s.flightNodes)}
    BackstageForeverAssistSettings=settings
    return settings
end

-- Pure: copper -> "1g 2s 3c".
function BackstageForeverMoney(copper)
    copper=floor(tonumber(copper) or 0)
    if copper<=0 then return '0c' end
    local g,s,c=floor(copper/10000),floor(copper/100)%100,copper%100
    local out={}
    if g>0 then out[#out+1]=g..'g' end
    if s>0 then out[#out+1]=s..'s' end
    if c>0 and g==0 then out[#out+1]=c..'c' end
    return table.concat(out,' ')
end
-- Pure: seconds -> "1 h 05 min" / "12 min" / "under a minute".
function BackstageForeverDuration(seconds)
    seconds=tonumber(seconds)
    if not seconds or seconds~=seconds or seconds==math.huge then return nil end
    if seconds<60 then return 'under a minute' end
    local m=floor(seconds/60+.5)
    if m<60 then return m..' min' end
    return ('%d h %02d min'):format(floor(m/60),m%60)
end
-- Pure: the level at or below which mobs give no experience (classic rules).
function BackstageForeverGreyLevel(level)
    level=tonumber(level) or 1
    if level<=5 then return 0 elseif level<=39 then return level-5-floor(level/10) else return level-1-floor(level/5) end
end
-- Pure: how risky a target is, in plain words. t={level,playerLevel,classification,attackable,isPlayer,dead}
-- -> {tone='red'|'orange'|'yellow'|'grey', text} or nil when there is nothing to say.
function BackstageForeverDanger(t)
    if type(t)~='table' or not t.attackable or t.isPlayer or t.dead then return nil end
    local lvl,me,class=tonumber(t.level),tonumber(t.playerLevel) or 1,t.classification or 'normal'
    if class=='worldboss' then return {tone='red',text='World boss: needs a full raid. Stay away.'} end
    if lvl==-1 then return {tone='red',text='Skull: far above your level. Avoid it.'} end
    if not lvl then return nil end
    local diff=lvl-me
    local elite=class=='elite' or class=='rareelite'
    if elite then return {tone=diff>=0 and 'red' or 'orange',text=('Elite (level %d): hits like several normal enemies. Bring a group.'):format(lvl)} end
    if diff>=5 then return {tone='red',text=('Level %d, %d above you: very likely to kill you. Avoid it.'):format(lvl,diff)} end
    if diff>=3 then return {tone='orange',text=('Level %d: a hard fight. Pull it alone and use everything you have.'):format(lvl)} end
    if class=='rare' then return {tone='yellow',text='Rare: tougher than usual, often drops something good.'} end
    if lvl<=BackstageForeverGreyLevel(me) then return {tone='grey',text='Too low to give experience. Not worth the time.'} end
    return nil
end
-- Pure: XP pace from a session table {start, gained} at time now, with cur/max XP.
-- -> {perHour, toLevel (seconds) or nil}
function BackstageForeverPace(session,now,cur,max)
    if type(session)~='table' then return nil end
    local elapsed=(tonumber(now) or 0)-(tonumber(session.start) or 0)
    local gained=tonumber(session.gained) or 0
    if elapsed<120 or gained<=0 then return nil end
    local perHour=gained/elapsed*3600
    local left=(tonumber(max) or 0)-(tonumber(cur) or 0)
    return {perHour=floor(perHour+.5),toLevel=left>0 and left/perHour*3600 or nil}
end
-- Pure: grey items worth selling. items={{bag,slot,quality,count,price,noValue}} -> list,total copper.
function BackstageForeverJunk(items)
    local list,total={},0
    for _,it in ipairs(type(items)=='table' and items or {}) do
        local price=tonumber(it.price) or 0
        if it.quality==0 and not it.noValue and price>0 then
            list[#list+1]=it
            total=total+price*(tonumber(it.count) or 1)
        end
    end
    return list,total
end

-- XP pace for this play session (in memory only).
local session={start=nil,gained=0,lastXP=nil,lastMax=nil,levelStart=nil,deaths=0,quests=0}
local function now() return num(call(GetTime)) or 0 end
local function xpNow() return num(call(UnitXP,'player')),num(call(UnitXPMax,'player')) end
local function trackXP()
    local cur,max=xpNow()
    if not cur or not max then return end
    if not session.start then session.start=now() session.levelStart=session.start end
    if session.lastXP then
        if cur>=session.lastXP then session.gained=session.gained+(cur-session.lastXP)
        elseif session.lastMax then session.gained=session.gained+(session.lastMax-session.lastXP)+cur end
    end
    session.lastXP,session.lastMax=cur,max
end
-- The Compass's short pace line (0.54): nil until a few minutes of play give a real pace.
function BackstageForeverPaceSummary()
    local cur,max=xpNow()
    local p=BackstageForeverPace(session,now(),cur,max)
    if not p then return nil end
    local rate=type(BreakUpLargeNumbers)=='function' and select(2,pcall(BreakUpLargeNumbers,p.perHour)) or p.perHour
    local eta=p.toLevel and BackstageForeverDuration(p.toLevel)
    local T=function(v) local ok,r=pcall(BackstageForeverTr or tostring,v);return ok and type(r)=='string' and r or v end
    return T(('Pace: %s XP/hour'):format(tostring(rate)))..(eta and (' · '..T(('next level in about %s'):format(T(eta)))) or '')
end
function BackstageForeverPaceLine()
    local cur,max=xpNow()
    local p=BackstageForeverPace(session,now(),cur,max)
    local rested=num(call(GetXPExhaustion))
    local parts={}
    if p then
        parts[#parts+1]=('%d XP/hour'):format(p.perHour)
        local eta=p.toLevel and BackstageForeverDuration(p.toLevel)
        if eta then parts[#parts+1]='next level in about '..eta end
    else parts[#parts+1]='play a few minutes to see your XP pace' end
    if rested and rested>0 then parts[#parts+1]=('%d rested XP (kills give double until it runs out)'):format(rested) end
    return table.concat(parts,' · ')
end

-- Toast: a short message at the top of the screen that fades by itself. G14 (0.39): every kind of
-- message has its own painting (Art/Messages/<kind>.tga, 1024x128) under a gold title and a ribbon,
-- like the zone banners. The painting is cropped to the box, never stretched.
local MESSAGE_ART='Interface\\AddOns\\BackstageForever\\Art\\Messages\\'
local MESSAGE_KINDS={flight=true,quest=true,levelup=true,death=true,spirit=true,revive=true,gear=true,hearth=true,
    ready=true,supplies=true,first=true,review=true,victory=true,profession=true}
function BackstageForeverMessageKinds() local out={} for k in pairs(MESSAGE_KINDS) do out[#out+1]=k end table.sort(out) return out end
function BackstageForeverMessageArt(kind) return MESSAGE_ART..(MESSAGE_KINDS[kind] and kind or 'ready') end
-- Pure: texture coordinates that fill a w x h box from the 8:1 painting without stretching it.
function BackstageForeverMessageCrop(w,h)
    w,h=tonumber(w) or 560,tonumber(h) or 74
    if w<=0 or h<=0 then return 0,1,0,1 end
    local r=w/h
    if r<8 then local u=r/8 return (1-u)/2,(1+u)/2,0,1 end
    local v=8/r return 0,1,(1-v)/2,(1+v)/2
end
-- Pure: the box height for a title and a sub line of the given text size (big = the level-up banner).
function BackstageForeverMessageHeight(big,subHeight)
    local sub=tonumber(subHeight) or 0
    if sub<=0 then return big and 84 or 54 end
    return (big and 72 or 46)+sub+(big and 26 or 20)
end
local toast,toastArt,toastTitle,toastSub,toastRibbon,toastShown,toastLen=nil,nil,nil,nil,nil,0,6
local toastEdges={}
local function tex(f,layer,r,g,b,a)
    local t=f:CreateTexture(nil,layer)
    if t and r then pcall(t.SetColorTexture,t,r,g,b,a) end
    return t
end
local function toastFrame()
    if toast or type(CreateFrame)~='function' then return toast end
    toast=CreateFrame('Frame','BackstageForeverToast',UIParent)
    if not toast then return nil end
    pcall(toast.SetSize,toast,560,74)
    pcall(toast.SetPoint,toast,'TOP',UIParent,'TOP',0,-150)
    pcall(toast.SetFrameStrata,toast,'HIGH')
    -- Solid dark under the painting, so a missing texture still reads.
    local bg=tex(toast,'BACKGROUND',.04,.025,.01,1)
    if bg then pcall(bg.SetAllPoints,bg,toast) end
    toastArt=tex(toast,'BORDER')
    if toastArt then pcall(toastArt.SetAllPoints,toastArt,toast) end
    toastRibbon=tex(toast,'ARTWORK',.16,.09,.03,.92)
    -- Gold frame (2px) all round, like the zone banners.
    local function edge(p1,p2,w,h)
        local e=tex(toast,'ARTWORK',.78,.6,.29,1)
        if not e then return end
        pcall(e.SetPoint,e,p1,toast,p1,0,0) pcall(e.SetPoint,e,p2,toast,p2,0,0)
        if w then pcall(e.SetWidth,e,w) end
        if h then pcall(e.SetHeight,e,h) end
        toastEdges[#toastEdges+1]=e
    end
    edge('TOPLEFT','TOPRIGHT',nil,2) edge('BOTTOMLEFT','BOTTOMRIGHT',nil,2)
    edge('TOPLEFT','BOTTOMLEFT',2,nil) edge('TOPRIGHT','BOTTOMRIGHT',2,nil)
    toastTitle=toast:CreateFontString(nil,'OVERLAY','GameFontNormalHuge')
    pcall(toastTitle.SetPoint,toastTitle,'TOP',toast,'TOP',0,-9)
    pcall(toastTitle.SetTextColor,toastTitle,1,.82,0)
    pcall(toastTitle.SetShadowColor,toastTitle,0,0,0,1)
    pcall(toastTitle.SetShadowOffset,toastTitle,2,-2)
    toastSub=toast:CreateFontString(nil,'OVERLAY','GameFontHighlight')
    pcall(toastSub.SetPoint,toastSub,'TOP',toastTitle,'BOTTOM',0,-10)
    pcall(toastSub.SetWidth,toastSub,500)
    if toastRibbon then
        pcall(toastRibbon.SetPoint,toastRibbon,'TOPLEFT',toastSub,'TOPLEFT',-14,5)
        pcall(toastRibbon.SetPoint,toastRibbon,'BOTTOMRIGHT',toastSub,'BOTTOMRIGHT',14,-5)
    end
    pcall(toast.Hide,toast)
    pcall(toast.SetScript,toast,'OnUpdate',function(self)
        local t=now()-toastShown
        if t<.25 then pcall(self.SetScale,self,1+(.25-t)*1.6) pcall(self.SetAlpha,self,t/.25)
        elseif t<toastLen-1 then pcall(self.SetScale,self,1) pcall(self.SetAlpha,self,1)
        elseif t<toastLen then pcall(self.SetAlpha,self,toastLen-t)
        else pcall(self.Hide,self) end
    end)
    return toast
end
-- Shows a toast (also echoed to chat so it is never missed). Returns the text for tests.
-- big=true: the level-up banner, larger and longer. kind: which painting (see MESSAGE_KINDS).
function BackstageForeverToast(title,sub,big,kind)
    if not settings then loadSettings() end
    -- 4.3 (0.53): the game's language when a translation exists.
    if type(BackstageForeverTr)=='function' then title=BackstageForeverTr(title);if sub then sub=BackstageForeverTr(sub) end end
    if sub then say(title..' '..sub) else say(title) end
    if not settings.toasts or not toastFrame() then return title end
    toastLen=big and 9 or 6
    local w=big and 760 or 560
    local font=type(toastTitle.GetFont)=='function' and select(1,toastTitle:GetFont())
    if font then pcall(toastTitle.SetFont,toastTitle,font,big and 40 or 26,big and 'THICKOUTLINE' or '') end
    pcall(toastTitle.SetPoint,toastTitle,'TOP',toast,'TOP',0,big and -14 or -9)
    pcall(toastTitle.SetWidth,toastTitle,w-30)
    pcall(toastTitle.SetText,toastTitle,title)
    pcall(toastSub.SetText,toastSub,sub or '')
    -- The sub line wraps inside the box; the ribbon hugs the text, so measure it first.
    local textW=num(type(toastSub.GetStringWidth)=='function' and call(toastSub.GetStringWidth,toastSub)) or 0
    local maxW=w-70
    local subW=sub and math.max(40,math.min(maxW,floor(textW+.5))) or 0
    if sub then pcall(toastSub.SetWidth,toastSub,subW) end
    local subH=sub and (num(type(toastSub.GetStringHeight)=='function' and call(toastSub.GetStringHeight,toastSub)) or 14*math.max(1,ceil(textW/maxW))) or 0
    local h=BackstageForeverMessageHeight(big,subH)
    pcall(toast.SetSize,toast,w,h)
    if toastArt then
        pcall(toastArt.SetTexture,toastArt,BackstageForeverMessageArt(kind))
        pcall(toastArt.SetTexCoord,toastArt,BackstageForeverMessageCrop(w,h))
    end
    if toastRibbon then pcall(sub and toastRibbon.Show or toastRibbon.Hide,toastRibbon) end
    toastShown=now()
    pcall(toast.SetAlpha,toast,0)
    pcall(toast.Show,toast)
    return title
end

-- Your class trainer: nearest on this map, else in your faction's cities.
local CAPITALS={1454,1456,1458,1453,1455,1457}
local function classTrainer()
    local data=type(BackstageForeverAdvisorData)=='table' and BackstageForeverAdvisorData.npcs
    local className=call(UnitClass,'player')
    if type(data)~='table' or type(className)~='string' then return nil end
    local faction=call(UnitFactionGroup,'player')
    local side=faction=='Horde' and 'H' or faction=='Alliance' and 'A' or nil
    local want=className:lower()..' trainer'
    local mapApi=type(C_Map)=='table' and C_Map or nil
    local here=mapApi and num(call(mapApi.GetBestMapForUnit,'player'))
    local px,py
    if here then local pos=call(mapApi.GetPlayerMapPosition,here,'player') if type(pos)=='table' and type(pos.GetXY)=='function' then px,py=call(pos.GetXY,pos) end end
    local function match(n) return type(n)=='table' and n.k=='c' and type(n.r)=='string' and n.r:lower()==want and (n.s==nil or n.s=='B' or side==nil or n.s==side) end
    local best,bestD
    for _,n in ipairs(here and data[here] or {}) do
        if match(n) then local d=px and ((n.x-px)^2+(n.y-py)^2) or 0 if not bestD or d<bestD then best,bestD=n,d end end
    end
    if best then return {mapId=here,x=best.x,y=best.y,name=best.n} end
    local order={}
    for _,m in ipairs(CAPITALS) do order[#order+1]=m end
    for m in pairs(data) do order[#order+1]=m end
    for _,m in ipairs(order) do for _,n in ipairs(data[m] or {}) do if match(n) then return {mapId=m,x=n.x,y=n.y,name=n.n} end end end
end
local function mapName(id)
    local info=type(C_Map)=='table' and call(C_Map.GetMapInfo,id)
    return field(info,'name') or ('map '..tostring(id))
end
function BackstageForeverTrain()
    local t=classTrainer()
    if not t then return say('No trainer for your class is recorded yet. Ask a guard in any town: they mark trainers on your map.') end
    if type(BackstageForeverWay)=='function' then BackstageForeverWay(('way %d %.4f %.4f %s'):format(t.mapId,t.x,t.y,t.name)) end
    return t
end

-- Events.
local lastLevelAt=nil
local function onLevel(level)
    local t=classTrainer()
    local took=lastLevelAt and BackstageForeverDuration(now()-lastLevelAt)
    lastLevelAt=now()
    local sub=t and ('New skills may be waiting: %s in %s. Type /bf train for an arrow.'):format(t.name,mapName(t.mapId)) or 'Visit your class trainer for new skills.'
    if (tonumber(level) or 0)>=10 then sub=sub..' You also have a talent point: press N; the Talents page in the app suggests which.' end
    if took then sub=sub..' This level took '..took..'.' end
    BackstageForeverToast(('Level %s!'):format(tostring(level)),sub,true,'levelup')
end
local function onQuestTurnedIn(xp)
    session.quests=session.quests+1
    xp=num(xp)
    local cur,max=xpNow()
    local sub='Type /bf next for the nearest thing to do.'
    if xp and xp>0 and cur and max then
        local left=max-cur
        local more=ceil(left/xp)
        sub=('+%d XP · about %d more quest%s like this to level up. /bf next shows the nearest one.'):format(xp,more,more==1 and '' or 's')
    end
    BackstageForeverToast('Quest complete',sub,nil,'quest')
end
-- No automatic waypoints: the game forbids addons from setting them outside a click or command,
-- and these run from events. The game already marks your body on the minimap and map.
local function onAlive()
    if call(UnitIsGhost,'player')==true then
        BackstageForeverToast('Run back to your body','Your body shows on the minimap and map. '..'Walk over it and click Resurrect. The Spirit Healer can revive you here instead, but your gear loses durability and you are weak for a while.',nil,'spirit')
    end
end
local function onUnghost()
    BackstageForeverToast('Back on your feet','Sit and eat or drink to recover health and mana before the next fight.',nil,'revive')
end

-- Danger line just above the target frame.
local dangerText
local TONES={red={1,.25,.2},orange={1,.55,.1},yellow={1,.9,.2},grey={.65,.65,.65}}
local function updateDanger()
    if not settings then loadSettings() end
    if not dangerText and type(CreateFrame)=='function' then
        local holder=CreateFrame('Frame','BackstageForeverDanger',UIParent)
        if holder then
            pcall(holder.SetSize,holder,320,18)
            if type(TargetFrame)=='table' then pcall(holder.SetPoint,holder,'BOTTOMLEFT',TargetFrame,'TOPLEFT',10,0) else pcall(holder.SetPoint,holder,'TOP',UIParent,'TOP',0,-230) end
            dangerText=holder:CreateFontString(nil,'OVERLAY','GameFontNormal')
            pcall(dangerText.SetPoint,dangerText,'LEFT',holder,'LEFT',0,0)
        end
    end
    if not dangerText then return end
    local d=settings.danger and call(UnitExists,'target')==true and BackstageForeverDanger({
        level=num(call(UnitLevel,'target')),playerLevel=num(call(UnitLevel,'player')),
        classification=call(UnitClassification,'target'),attackable=call(UnitCanAttack,'player','target')==true,
        isPlayer=call(UnitIsPlayer,'target')==true,dead=call(UnitIsDead,'target')==true})
    if d then
        local c=TONES[d.tone] or TONES.yellow
        pcall(dangerText.SetTextColor,dangerText,c[1],c[2],c[3])
        pcall(dangerText.SetText,dangerText,d.text)
        pcall(dangerText.Show,dangerText)
    else pcall(dangerText.Hide,dangerText) end
    return d or nil
end
BackstageForeverUpdateDanger=updateDanger

-- Junk button on the vendor window. Selling happens only when you click it.
local junkButton,merchantOpen
local function questSlot(api,bag,slot)
    local q=call(api.GetContainerItemQuestInfo,bag,slot)
    if type(q)~='table' then return nil end
    local ok,rawId=pcall(function() return q.questID end)
    if not ok then return nil end
    if type(issecretvalue)=='function' then
        local safe,secret=pcall(issecretvalue,rawId)
        if not safe or secret then return nil end
    end
    local quest,active,id=field(q,'isQuestItem'),field(q,'isActive'),plain(rawId)
    if quest==true or active==true or (type(id)=='number' and id>0) then return true end
    if quest==false and active==false and (id==nil or id==0) then return false end
end
local function sellableSlot(api,bag,slot)
    local info=call(api.GetContainerItemInfo,bag,slot)
    local id=field(info,'itemID')
    if type(id)~='number' or id<=0 or id%1~=0 or field(info,'quality')~=0 or field(info,'isLocked')==true or field(info,'hasNoValue')==true
        or questSlot(api,bag,slot)~=false then return nil end
    if type(BackstageForeverReviewedQuestItem)=='function' and BackstageForeverReviewedQuestItem(id) then return nil end
    local price=num(select(11,call(GetItemInfo,id)))
    local count=field(info,'stackCount')
    if not price or price<=0 or price%1~=0 or type(count)~='number' or count<1 or count%1~=0 then return nil end
    return {id=id,bag=bag,slot=slot,quality=0,count=count,price=price}
end
local function bagItems()
    local api=type(C_Container)=='table' and C_Container or nil
    local out={}
    if not api then return out end
    for bag=0,4 do
        local slots=num(call(api.GetContainerNumSlots,bag)) or 0
        for slot=1,math.min(slots,100) do
            local it=sellableSlot(api,bag,slot)
            if it then out[#out+1]=it end
        end
    end
    return out
end
function BackstageForeverSellJunk()
    if call(InCombatLockdown)~=false or not merchantOpen or call(field(MerchantFrame,'IsShown'),MerchantFrame)~=true
        or not (settings or loadSettings()).junk then return 0 end
    local list=bagItems()
    local api=type(C_Container)=='table' and C_Container or nil
    if not api or type(api.UseContainerItem)~='function' then return 0 end
    local sold,total=0,0
    for _,it in ipairs(list) do
        if not merchantOpen or call(InCombatLockdown)~=false or call(field(MerchantFrame,'IsShown'),MerchantFrame)~=true then break end
        local current=sellableSlot(api,it.bag,it.slot)
        if current and current.id==it.id and pcall(api.UseContainerItem,it.bag,it.slot) then
            sold,total=sold+1,total+current.price*current.count
        end
    end
    if sold>0 then say(('Sold %d junk item%s for %s.'):format(sold,sold==1 and '' or 's',BackstageForeverMoney(total))) end
    return sold,total
end
local function updateJunk(open)
    if not settings then loadSettings() end
    if not junkButton and type(CreateFrame)=='function' and type(MerchantFrame)=='table' then
        junkButton=CreateFrame('Button','BackstageForeverSellJunkButton',MerchantFrame,'UIPanelButtonTemplate')
        if junkButton then
            pcall(junkButton.SetSize,junkButton,210,22)
            pcall(junkButton.SetPoint,junkButton,'BOTTOMRIGHT',MerchantFrame,'TOPRIGHT',-8,2)
            pcall(junkButton.SetScript,junkButton,'OnClick',function() BackstageForeverSellJunk() updateJunk(merchantOpen) end)
        end
    end
    if not junkButton then return end
    local list,total={},0
    if open and settings.junk and not combat() then list,total=BackstageForeverJunk(bagItems()) end
    if open and settings.junk and #list>0 then
        pcall(junkButton.SetText,junkButton,('Sell junk: %d item%s · %s'):format(#list,#list==1 and '' or 's',BackstageForeverMoney(total)))
        pcall(junkButton.Show,junkButton)
    else pcall(junkButton.Hide,junkButton) end
end


-- Gear durability: warn once when it gets low, again when something breaks.
-- Pure: per-slot {cur,max} list -> lowest percent (nil when nothing has durability), broken count.
function BackstageForeverDurability(slots)
    local low,broken=nil,0
    for _,s in ipairs(type(slots)=='table' and slots or {}) do
        local cur,max=tonumber(s[1]),tonumber(s[2])
        if cur and max and max>0 then
            local pct=floor(cur/max*100)
            if not low or pct<low then low=pct end
            if cur<=0 then broken=broken+1 end
        end
    end
    return low,broken
end
local function readDurability()
    local slots={}
    for slot=1,18 do local cur,max=call(GetInventoryItemDurability,slot) if cur and max then slots[#slots+1]={cur,max} end end
    return BackstageForeverDurability(slots)
end
local repairWarned=nil -- nil, 'low' or 'broken'
local function onDurability()
    local low,broken=readDurability()
    if not low then return end
    if broken>0 and repairWarned~='broken' then
        repairWarned='broken'
        return BackstageForeverToast('Gear broken',('%d item%s no longer work until repaired. Visit a blacksmith or armor vendor: /bf repair shows the nearest.'):format(broken,broken==1 and '' or 's'),nil,'gear')
    end
    if low<=25 and not repairWarned then
        repairWarned='low'
        return BackstageForeverToast(('Gear wearing out (%d%%)'):format(low),'Repair soon at a blacksmith or armor vendor. /bf repair shows the nearest.',nil,'gear')
    end
    if low>50 then repairWarned=nil end
end

-- Remember who you have talked to (merchants that repair, flight masters you have met).
local function npcIdOf(unit)
    local guid=call(UnitGUID,unit)
    if type(guid)~='string' then return nil end
    local kind,id=guid:match('^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)')
    if kind=='Creature' then return tonumber(id) end
end
local function herePosition()
    local mapApi=type(C_Map)=='table' and C_Map or nil
    local map=mapApi and num(call(mapApi.GetBestMapForUnit,'player'))
    if not map then return nil end
    local pos=call(mapApi.GetPlayerMapPosition,map,'player')
    local x,y
    if type(pos)=='table' and type(pos.GetXY)=='function' then x,y=call(pos.GetXY,pos) end
    if type(x)=='number' and type(y)=='number' then return map,x,y end
    return map
end
local function count(t) local n=0 for _ in pairs(t) do n=n+1 end return n end
local function learnRepairer()
    if call(CanMerchantRepair)~=true then return end
    local id=npcIdOf('npc'); local map,x,y=herePosition()
    if not id or not map or not x then return end
    settings.repairers=type(settings.repairers)=='table' and settings.repairers or {}
    if not settings.repairers[id] and count(settings.repairers)>=60 then return end
    settings.repairers[id]={m=map,x=floor(x*1e4)/1e4,y=floor(y*1e4)/1e4,n=tostring(call(UnitName,'npc') or 'Repair vendor'):sub(1,40)}
end
local function learnFlights()
    settings.flightNpcs=type(settings.flightNpcs)=='table' and settings.flightNpcs or {}
    settings.flightNodes=type(settings.flightNodes)=='table' and settings.flightNodes or {}
    local id=npcIdOf('npc')
    if id then settings.flightNpcs[id]=true end
    local taxi=type(C_TaxiMap)=='table' and C_TaxiMap or nil
    local mapId=num(call(GetTaxiMapID))
    local nodes=taxi and mapId and call(taxi.GetAllTaxiNodes,mapId)
    if type(nodes)=='table' then
        for _,n in ipairs(nodes) do
            local node,state=num(field(n,'nodeID')),num(field(n,'state'))
            -- Enum.FlightPathState: 0 current, 1 reachable (known), 2 unreachable (not learned).
            if node and state and state<2 then settings.flightNodes[node]=true end
        end
    end
end

-- Rows from the bundled advisor data for this map: kind 'r' (repair) or 'f' (flight master).
local function rowsOf(kind,map)
    local data=type(BackstageForeverAdvisorData)=='table' and BackstageForeverAdvisorData.npcs
    local out={}
    if type(data)~='table' then return out end
    local faction=call(UnitFactionGroup,'player')
    local side=faction=='Horde' and 'H' or faction=='Alliance' and 'A' or nil
    local function add(m,list) for _,n in ipairs(list or {}) do if type(n)=='table' and n.k==kind and (n.s==nil or n.s=='B' or side==nil or n.s==side) then out[#out+1]={mapId=m,x=n.x,y=n.y,name=n.n,id=n.i,node=n.t,title=n.r} end end end
    if map then add(map,data[map]) else for m,list in pairs(data) do add(m,list) end end
    return out
end
-- Pure: is this flight master already learned? (met it, or its node is known from the flight map)
function BackstageForeverFlightKnown(row,known)
    known=type(known)=='table' and known or {}
    return (row.id and (known.npcs or {})[row.id]) or (row.node and (known.nodes or {})[row.node]) or false
end
local function knownFlights() return {npcs=settings.flightNpcs or {},nodes=settings.flightNodes or {}} end
local function nearest(list,map,x,y)
    local best,bestD
    for _,r in ipairs(list) do
        if r.mapId==map and x then local d=((r.x-x)^2+(r.y-y)^2)^.5 if not bestD or d<bestD then best,bestD=r,d end end
    end
    return best,bestD
end
function BackstageForeverRepair()
    if not settings then loadSettings() end
    local map,x,y=herePosition()
    local list=rowsOf('r',map)
    for _,r in pairs(type(settings.repairers)=='table' and settings.repairers or {}) do if r.m==map then list[#list+1]={mapId=r.m,x=r.x,y=r.y,name=r.n} end end
    local best=nearest(list,map,x,y)
    if not best then
        local all=rowsOf('r',nil)
        for _,m in ipairs(CAPITALS) do for _,r in ipairs(all) do if not best and r.mapId==m then best=r end end end
        best=best or all[1]
    end
    if not best then return say('No repair vendor is recorded here yet. Blacksmiths and armor vendors in towns can repair; open one and the addon remembers it.') end
    if type(BackstageForeverWay)=='function' then BackstageForeverWay(('way %d %.4f %.4f %s'):format(best.mapId,best.x,best.y,best.name or 'repair')) end
    return best
end
function BackstageForeverFlights()
    if not settings then loadSettings() end
    local map=herePosition()
    local list=rowsOf('f',map)
    if #list==0 then return say('No flight masters are recorded in this zone.') end
    local known=knownFlights()
    for _,r in ipairs(list) do
        say(('%s%s: %s'):format(r.name or 'Flight master',r.title and r.title~='Flight Master' and (' ('..r.title..')') or '',BackstageForeverFlightKnown(r,known) and 'learned' or 'not learned yet. Talk to them to add this flight path.'))
    end
    return list
end
-- Passing near a flight master you haven't met: one reminder per master per session.
local flightHinted={}
local function checkFlightNearby()
    if not settings or not settings.toasts or combat() then return end
    local map,x,y=herePosition()
    if not x then return end
    local known=knownFlights()
    for _,r in ipairs(rowsOf('f',map)) do
        local key=r.id or r.name
        if key and not flightHinted[key] and not BackstageForeverFlightKnown(r,known) and ((r.x-x)^2+(r.y-y)^2)^.5<0.035 then
            flightHinted[key]=true
            BackstageForeverToast('Flight master nearby: '..tostring(r.name),'Talk to them to learn this flight path. Later you can fly back here instead of running.',nil,'flight')
            return r
        end
    end
end
BackstageForeverCheckFlightNearby=checkFlightNearby

-- Pure: should your Hearthstone move? bind = inn name; zones = advisor zone rows; side 'H'|'A'.
-- -> { home = mapId|nil, town = suggested inn town } or nil when it's already in a sensible place.
function BackstageForeverHearthAdvice(bind,mapId,level,side,zones)
    if type(bind)~='string' or not mapId or type(zones)~='table' then return nil end
    local function towns(z) return (side=='A' and (z.ta or (z.a and {z.a}))) or (side=='H' and (z.th or (z.h and {z.h}))) or {} end
    local home,here=nil,nil
    for _,z in ipairs(zones) do
        for _,t in ipairs(towns(z)) do if t==bind then home=z.m end end
        if z.m==mapId then here=z end
    end
    if not here or home==mapId then return nil end
    local list=towns(here)
    if #list==0 then return nil end
    level=tonumber(level) or 0
    if level<(here.lo or 0)-1 or level>(here.hi or 99)+2 then return nil end
    return {home=home,town=list[1]}
end
local hearthHinted={}
local function hearthCheck(force)
    local bind=call(GetBindLocation)
    local map=herePosition()
    local faction=call(UnitFactionGroup,'player')
    local side=faction=='Horde' and 'H' or faction=='Alliance' and 'A' or nil
    local zones=type(BackstageForeverAdvisorData)=='table' and BackstageForeverAdvisorData.zones
    local a=BackstageForeverHearthAdvice(bind,map,num(call(UnitLevel,'player')),side,zones)
    if not a or (hearthHinted[map] and not force) then return a end
    hearthHinted[map]=true
    if not force then BackstageForeverToast('Move your Hearthstone?',('It takes you to %s, but you are questing in %s. Talk to the innkeeper in %s and choose "Make this inn your home".'):format(bind,mapName(map),a.town),nil,'hearth') end
    return a
end
function BackstageForeverAssistCommand(message)
    if not settings then loadSettings() end
    local cmd,arg=(type(message)=='string' and message:lower() or ''):match('^(%a+)%s*(%a*)')
    if cmd=='train' then return BackstageForeverTrain() end
    if cmd=='repair' then return BackstageForeverRepair() end
    if cmd=='flights' then return BackstageForeverFlights() end
    if cmd=='xp' then return say(BackstageForeverPaceLine()) end
    if cmd=='hearth' then
        local where=call(GetBindLocation)
        local a=hearthCheck(true)
        if where and a then return say(('Your Hearthstone takes you to %s. You are questing in %s, so the inn in %s would save you long runs: talk to the innkeeper and choose "Make this inn your home".'):format(where,mapName(herePosition()),a.town)) end
        return say(where and ('Your Hearthstone takes you to %s. To change it, talk to an innkeeper and choose "Make this inn your home".'):format(where) or 'Talk to an innkeeper to set where your Hearthstone takes you.')
    end
    if cmd=='toasts' or cmd=='danger' or cmd=='junk' then
        if arg=='on' then settings[cmd]=true elseif arg=='off' then settings[cmd]=false else settings[cmd]=not settings[cmd] end
        say(('%s %s.'):format(cmd=='toasts' and 'Pop-up tips' or cmd=='danger' and 'Danger warnings' or 'Sell-junk button',settings[cmd] and 'on' or 'off'))
        if cmd=='danger' then updateDanger() end
        return settings[cmd]
    end
    if cmd=='help' then
        local lines={
            '/bf next - an arrow to the nearest quest to hand in or pick up',
            '/bf how - how to do your tracked quest: what to get and where it came from',
            '/bf train - an arrow to your class trainer',
            '/bf repair - an arrow to the nearest repair vendor',
            '/bf flights - which flight paths here you have learned',
            '/bf find NAME - find a person or place, e.g. /bf find flight master',
            '/bf xp - your experience per hour and time to the next level',
            '/bf prof - your profession: recipe colour, best next recipe, crafts to your cap',
            '/bf nodes - your remembered herbs, ore and chests nearby, with distance and direction',
            '/bf hearth - where your Hearthstone takes you',
            '/bf badges - badges earned and the three closest next (/bf badges all for the list)',
            '/bf ledger - gold across your characters, and when the addon last saw your bank and mail',
            '/bf prices - remember Auction House prices on pages you open yourself (on, off, status, or tips for tooltip lines)',
            '/bf sell - what in your bags is worth more at auction than at a vendor',
            '/bf plates - quest icons over enemies a quest still needs (on or off)',
            '/bf boss - the tip for the boss you target (on or off for the pop-ups)',
            '/bf set save NAME, /bf set wear NAME - save the gear you wear as a set, put it back on later (out of combat); /bf set list, /bf set delete NAME',
            '/bf show, /bf hide - the Adventure Compass panel',
            '/bf helpers - list individual helper settings for this character',
            '/bf toasts, danger, junk - turn pop-up tips, target warnings or the sell-junk button on or off',
            '/bf moments - turn the short messages for elite, rare and boss kills and profession milestones on or off',
            '/bf party - the quests of your party next to yours (party members with Backstage Forever); /bf party way shares your waypoint, /bf party go follows one',
            '/bf route guide - the full guided route for your race, step by step; /bf route skip skips a step, /bf route zone shows this zone only',
            '/bf qol - small helpers, each off until you switch it on: coords, loot, dismount, questtext',
            '/bf enemy - enemy players you saw recently; /bf enemy off silences the alerts, /bf enemy sound on adds a sound',
            '/bf gear - turn upgrade hints on item tooltips and the best-quest-reward highlight on or off',
            '/bf live - the thin line along the top edge that lets the desktop app follow you; /bf live safe if the app cannot read it',
            '/bf ask - ask the companion a question (or click the owl button on the minimap); the answer appears in the Backstage Forever panel over your game',
        }
        for _,l in ipairs(lines) do say(l) end
        return lines
    end
end

if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    if events then
        for _,e in ipairs({'PLAYER_LOGIN','PLAYER_XP_UPDATE','PLAYER_LEVEL_UP','QUEST_TURNED_IN','PLAYER_DEAD','PLAYER_ALIVE','PLAYER_UNGHOST','PLAYER_TARGET_CHANGED','UNIT_CLASSIFICATION_CHANGED','MERCHANT_SHOW','MERCHANT_CLOSED','BAG_UPDATE_DELAYED','QUEST_LOG_UPDATE','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED','UPDATE_INVENTORY_DURABILITY','TAXIMAP_OPENED','QUEST_ACCEPTED','ZONE_CHANGED','ZONE_CHANGED_NEW_AREA','ZONE_CHANGED_INDOORS'}) do pcall(events.RegisterEvent,events,e) end
        pcall(events.SetScript,events,'OnEvent',function(_,event,a,b)
            if event=='PLAYER_LOGIN' then
                loadSettings() trackXP() lastLevelAt=now()
                if not settings.welcomed then
                    settings.welcomed=true
                    BackstageForeverToast('Backstage Forever is ready','Type /bf next any time for an arrow to your next quest. /bf help lists everything.',nil,'ready')
                end
            elseif event=='PLAYER_XP_UPDATE' then trackXP()
            elseif event=='PLAYER_LEVEL_UP' then trackXP() onLevel(a)
            elseif event=='QUEST_TURNED_IN' then onQuestTurnedIn(b)
            elseif event=='PLAYER_DEAD' then session.deaths=session.deaths+1 BackstageForeverToast('You died','Click "Release Spirit". You will appear at a graveyard as a ghost; an arrow will lead you back to your body.',nil,'death')
            elseif event=='PLAYER_ALIVE' then onAlive()
            elseif event=='PLAYER_UNGHOST' then onUnghost()
            elseif event=='PLAYER_TARGET_CHANGED' or (event=='UNIT_CLASSIFICATION_CHANGED' and a=='target') then updateDanger();if event=='PLAYER_TARGET_CHANGED' and type(BackstageForeverBossTarget)=='function' then pcall(BackstageForeverBossTarget) end
            elseif event=='MERCHANT_SHOW' then merchantOpen=true pcall(learnRepairer) updateJunk(true)
            elseif event=='UPDATE_INVENTORY_DURABILITY' then onDurability()
            elseif event=='TAXIMAP_OPENED' then pcall(learnFlights)
            elseif event=='QUEST_ACCEPTED' then pcall(hearthCheck)
            elseif event=='ZONE_CHANGED' or event=='ZONE_CHANGED_NEW_AREA' or event=='ZONE_CHANGED_INDOORS' then checkFlightNearby()
            elseif event=='MERCHANT_CLOSED' then merchantOpen=false updateJunk(false)
            elseif merchantOpen and (event=='BAG_UPDATE_DELAYED' or event=='QUEST_LOG_UPDATE' or event=='PLAYER_REGEN_DISABLED' or event=='PLAYER_REGEN_ENABLED') then updateJunk(true) end
        end)
        local tick=0
        pcall(events.SetScript,events,'OnUpdate',function(_,dt) tick=tick+(tonumber(dt) or 0) if tick>=5 then tick=0 pcall(checkFlightNearby) end end)
    end
end
BackstageForeverAssistSession=session

-- Boss tips: the first time you target a covered boss this session, a short tip as a
-- toast. Text only, no timers. /bf boss repeats the tip for your target; /bf boss off|on.
local bossShown={}
local function currentBossTip()
    if call(UnitIsPlayer,'target') then return nil end
    local name=call(UnitName,'target')
    local tips=BackstageForeverBossTips
    if type(tips)~='table' or type(name)~='string' then return nil end
    local tip=tips[name:lower()]
    if type(tip)=='table' then
        -- Reference advice is not evidence: require the actual creature and raid map.
        local _,kind,_,_,_,_,_,map=call(GetInstanceInfo)
        local id=npcIdOf('target')
        if kind~='raid' or not map or map~=tip.instanceMap or not id or id~=tip.npcId then return nil end
        tip=tip.tip
    end
    if type(tip)=='string' then return name,tip end
end
local function targetBoss(force)
    if type(BackstageForeverAssistSettings)=='table' and BackstageForeverAssistSettings.bossTips==false and not force then return nil end
    local name,tip=currentBossTip()
    if not tip then return nil end
    local key=name:lower()
    if bossShown[key] and not force then return nil end
    bossShown[key]=true
    if type(BackstageForeverToast)=='function' then pcall(BackstageForeverToast,'Boss: '..name,tip,nil,'boss') end
    return tip
end
BackstageForeverBossTarget=targetBoss
function BackstageForeverBossCommand(message)
    local arg=(type(message)=='string' and message:lower() or ''):match('^%a+%s*(%a*)') or ''
    if type(BackstageForeverAssistSettings)~='table' then BackstageForeverAssistSettings={} end
    if arg=='off' then BackstageForeverAssistSettings.bossTips=false;say('Boss tips off.');return false end
    if arg=='on' then BackstageForeverAssistSettings.bossTips=true;say('Boss tips on: a short tip when you first target a covered boss.');return true end
    local name,tip=currentBossTip()
    if tip then say(name..': '..tip) else say('Target a covered dungeon or raid boss first.') end
    return tip
end


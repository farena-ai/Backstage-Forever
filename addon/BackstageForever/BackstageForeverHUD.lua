-- Optional native display only. It never performs character actions.
local panel,body,latest,captureMessage
local visible,collapsed=true,false
local settings
local anchors={TOPLEFT=true,TOP=true,TOPRIGHT=true,LEFT=true,CENTER=true,RIGHT=true,BOTTOMLEFT=true,BOTTOM=true,BOTTOMRIGHT=true}
local function finite(value) return type(value)=='number' and value==value and math.abs(value)<=10000 end
local function save()
    if not settings then return end
    settings.visible=visible;settings.collapsed=collapsed
end
local function safe(fn,...)
    if type(fn)~='function' then return nil end
    local ok,value=pcall(fn,...);if not ok then return nil end
    if type(issecretvalue)=='function' then
        local allowed,secret=pcall(issecretvalue,value);if not allowed or secret then return nil end
    end
    return value
end
local function combat() return safe(InCombatLockdown)~=false end
local function update()
    if not panel then return end
    if combat() or not visible then safe(panel.Hide,panel);return end
    local text='Waiting for a public character snapshot.'
    if latest then
        text=latest.name..'  |  Level '..latest.level..' '..latest.className
        if not collapsed then
            text=text..'\n'..(latest.location.zone or '')
            local xp=latest.progress
            text=text..'\n'..(xp and ('XP '..xp.current..' / '..xp.max) or 'XP unavailable')
            if latest.quests then
                local ready=0;for _,q in ipairs(latest.quests) do if q.complete then ready=ready+1 end end
                text=text..'\n'..#latest.quests..' observed quests | '..ready..' ready'
                for _,q in ipairs(latest.quests) do if q.complete then text=text..'\nReady: '..q.title;break end end
            else text=text..'\nQuest data unavailable' end
            local recent=latest.history and latest.history.recent
            if recent and recent[1] then text=text..'\nLast turn-in: '..recent[1].title end
            if latest.quests then
                for _,q in ipairs(latest.quests) do
                    if q.destination then
                        local d=q.destination
                        text=text..'\nWaypoint: '..(d.text or ('Map '..d.mapId))..' ('..math.floor(d.x*100)..', '..math.floor(d.y*100)..')'
                        break
                    end
                end
            end
        end
    end
    if captureMessage then text=text..'\n'..captureMessage end
    safe(body.SetText,body,text)
    local height=safe(body.GetStringHeight,body)
    if not finite(height) or height<1 then local _,lines=text:gsub('\n','');height=(lines+1)*14 end
    safe(body.SetHeight,body,math.min(height,234))
    safe(panel.SetHeight,panel,math.max(110,math.min(320,height+86)));safe(panel.Show,panel)
end
BackstageForeverHUDUpdate=function(character) latest=character;update() end
BackstageForeverHUDCaptureStatus=function(state)
    captureMessage=state=='partial' and 'Some public data is unavailable. Try again outside combat.'
        or state=='unavailable' and 'Snapshot unavailable. Try again outside combat, then reload or log out.' or nil
    pcall(update)
end
local function initialize()
    if combat() or panel or type(CreateFrame)~='function' then return end
    local saved=type(BackstageForeverHUDSettings)=='table' and BackstageForeverHUDSettings or {}
    settings={visible=saved.visible~=false,collapsed=saved.collapsed==true}
    if anchors[saved.point] and anchors[saved.relativePoint] and finite(saved.x) and finite(saved.y) then
        settings.point=saved.point;settings.relativePoint=saved.relativePoint;settings.x=saved.x;settings.y=saved.y
    end
    BackstageForeverHUDSettings=settings;visible=settings.visible;collapsed=settings.collapsed
    panel=CreateFrame('Frame','BackstageForeverCompass',UIParent,'BackdropTemplate')
    panel:SetSize(290,170)
    if settings.point then panel:SetPoint(settings.point,UIParent,settings.relativePoint,settings.x,settings.y)
    else panel:SetPoint('CENTER',UIParent,'CENTER',260,60) end
    panel:SetMovable(true);panel:EnableMouse(true);panel:RegisterForDrag('LeftButton');panel:SetClampedToScreen(true)
    panel:SetBackdrop({bgFile='Interface/DialogFrame/UI-DialogBox-Background',edgeFile='Interface/DialogFrame/UI-DialogBox-Border',tile=true,tileSize=32,edgeSize=32,insets={left=8,right=8,top=8,bottom=8}})
    panel:SetBackdropColor(1,1,1,.96)
    local function startDrag() if not combat() then panel:StartMoving() end end
    local function stopDrag()
        panel:StopMovingOrSizing()
        local ok,point,relative,relativePoint,x,y=pcall(panel.GetPoint,panel,1)
        if ok and (relative==nil or relative==UIParent) and anchors[point] and anchors[relativePoint] and finite(x) and finite(y) then
            settings.point=point;settings.relativePoint=relativePoint;settings.x=x;settings.y=y
        end
        save()
    end
    panel:SetScript('OnDragStart',startDrag);panel:SetScript('OnDragStop',stopDrag)
    local title=CreateFrame('Button',nil,panel);title:SetPoint('TOPLEFT',10,-9);title:SetSize(222,20)
    title:RegisterForDrag('LeftButton');title:SetScript('OnDragStart',startDrag);title:SetScript('OnDragStop',stopDrag)
    local heading=title:CreateFontString(nil,'OVERLAY','GameFontNormal');heading:SetAllPoints();heading:SetText('Adventure Compass')
    local close=CreateFrame('Button','BackstageForeverCompassClose',panel,'UIPanelCloseButton')
    close:SetSize(24,24);close:SetPoint('TOPRIGHT',-4,-4)
    close:SetScript('OnClick',function()
        if combat() then return end
        visible=false;save();update()
        if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: Compass hidden. Type /bf show to reopen it.') end
    end)
    local minimize=CreateFrame('Button','BackstageForeverCompassCollapse',panel,'UIPanelButtonTemplate')
    minimize:SetSize(22,20);minimize:SetPoint('TOPRIGHT',-30,-7);minimize:SetText('-')
    minimize:SetScript('OnClick',function() if not combat() then collapsed=not collapsed;save();update() end end)
    body=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');body:SetPoint('TOPLEFT',12,-35);body:SetWidth(266);body:SetJustifyH('LEFT')
    local hint=panel:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    hint:SetPoint('BOTTOMLEFT',14,15);hint:SetWidth(262);hint:SetJustifyH('LEFT')
    hint:SetText('Drag title to move | X: hide | -: collapse\nShow again: /bf show')
    update()
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'}) do safe(events.RegisterEvent,events,event) end
    events:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_REGEN_DISABLED' then if panel then safe(panel.Hide,panel) end;return end
        pcall(initialize);pcall(update)
    end)
end
if type(SlashCmdList)=='table' then
    SLASH_BACKSTAGEFOREVER1='/bf'
    SlashCmdList.BACKSTAGEFOREVER=function(message)
        if type(message)=='string' and message:match('^guide') then
            if type(BackstageForeverGuide)=='function' then pcall(BackstageForeverGuide,message) end
            return
        end
        if combat() then return end
        message=type(message)=='string' and message:lower() or ''
        if message=='hide' then visible=false elseif message=='show' then visible=true
        elseif message=='status' then
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(latest and 'public snapshot available; desktop export is saved on reload/logout.' or 'waiting for public snapshot.')) end
            return
        elseif message=='' then visible=not visible
        else
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: /bf show, hide, status, or guide QuestID t/o/r MapID X Y Build.') end
            return
        end
        pcall(initialize);save();pcall(update)
    end
end

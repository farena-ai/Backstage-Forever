-- Optional native display only. It never performs character actions.
local panel,body,latest
local visible,collapsed=true,false
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
        text=latest.name..'  |  Level '..latest.level..' '..latest.className..'\n'..(latest.location.zone or '')
        if not collapsed then
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
            text=text..'\n/bf hide | Click title to collapse'
        end
    end
    safe(body.SetText,body,text);safe(panel.SetHeight,panel,collapsed and 68 or 215);safe(panel.Show,panel)
end
BackstageForeverHUDUpdate=function(character) latest=character;update() end
local function initialize()
    if combat() or panel or type(CreateFrame)~='function' then return end
    panel=CreateFrame('Frame','BackstageForeverCompass',UIParent,'BackdropTemplate')
    panel:SetSize(290,170);panel:SetPoint('CENTER',UIParent,'CENTER',260,60)
    panel:SetMovable(true);panel:EnableMouse(true);panel:RegisterForDrag('LeftButton');panel:SetClampedToScreen(true)
    panel:SetBackdrop({bgFile='Interface/Tooltips/UI-Tooltip-Background',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=true,tileSize=16,edgeSize=16,insets={left=4,right=4,top=4,bottom=4}})
    panel:SetBackdropColor(.035,.03,.02,.92)
    panel:SetScript('OnDragStart',function(self) if not combat() then self:StartMoving() end end)
    panel:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end)
    local title=CreateFrame('Button',nil,panel);title:SetPoint('TOPLEFT',10,-9);title:SetSize(265,20)
    local heading=title:CreateFontString(nil,'OVERLAY','GameFontNormal');heading:SetAllPoints();heading:SetText('Adventure Compass')
    title:SetScript('OnClick',function() if not combat() then collapsed=not collapsed;update() end end)
    body=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');body:SetPoint('TOPLEFT',12,-35);body:SetWidth(266);body:SetJustifyH('LEFT')
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
        if combat() then return end
        message=type(message)=='string' and message:lower() or ''
        if message=='hide' then visible=false elseif message=='show' then visible=true
        elseif message=='status' then
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(latest and 'public snapshot available; desktop export is saved on reload/logout.' or 'waiting for public snapshot.')) end
            return
        else visible=not visible end
        pcall(initialize);pcall(update)
    end
end

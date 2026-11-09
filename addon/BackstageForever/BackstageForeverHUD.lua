-- Native display and explicit waypoint clicks only; capture remains event driven.
local panel,body,hint,actionTitle,actionSource,preparationLine,focusButton,sessionButton,waypointButton
local latest,preparation,captureMessage,settings
local visible,collapsed,active=true,false,false
local epoch=0
local anchors={TOPLEFT=true,TOP=true,TOPRIGHT=true,LEFT=true,CENTER=true,RIGHT=true,BOTTOMLEFT=true,BOTTOM=true,BOTTOMRIGHT=true}
local focuses={balanced='nearby',nearby='turn-ins',['turn-ins']='balanced'}
local function finite(value) return type(value)=='number' and value==value and math.abs(value)<=10000 end
local function safe(fn,...)
    if type(fn)~='function' then return nil end
    local ok,value=pcall(fn,...);if not ok then return nil end
    if type(issecretvalue)=='function' then
        local allowed,secret=pcall(issecretvalue,value);if not allowed or secret then return nil end
    end
    return value
end
local function combat() return safe(InCombatLockdown)~=false end
-- Pipes introduce WoW hyperlinks/textures/formatting. Display them literally.
local function text(value,limit)
    if type(value)~='string' then return '' end
    value=value:gsub('[%z\1-\31\127]',' ')
    if #value>(limit or 100) then
        local last=(limit or 100)-3
        while last>0 and value:byte(last+1)>=128 and value:byte(last+1)<192 do last=last-1 end
        value=value:sub(1,last)..'...'
    end
    return (value:gsub('|','||'))
end
local function save()
    if settings then settings.visible=visible;settings.collapsed=collapsed end
end
local function loadSettings()
    local saved=type(BackstageForeverHUDSettings)=='table' and BackstageForeverHUDSettings or {}
    settings={schemaVersion=1,visible=saved.visible~=false,collapsed=saved.collapsed==true,
        focus=focuses[saved.focus] and saved.focus or 'balanced',minutes=(saved.minutes==15 or saved.minutes==30 or saved.minutes==60) and saved.minutes or 30}
    if anchors[saved.point] and anchors[saved.relativePoint] and finite(saved.x) and finite(saved.y) then
        settings.point=saved.point;settings.relativePoint=saved.relativePoint;settings.x=saved.x;settings.y=saved.y
    end
    BackstageForeverHUDSettings=settings;visible=settings.visible;collapsed=settings.collapsed
    if panel then
        safe(panel.ClearAllPoints,panel)
        if settings.point then safe(panel.SetPoint,panel,settings.point,UIParent,settings.relativePoint,settings.x,settings.y)
        else safe(panel.SetPoint,panel,'CENTER',UIParent,'CENTER',260,60) end
    end
end
local function validCommand(step)
    if type(step)~='table' or type(step.command)~='string' or #step.command>154 then return nil end
    local id,phase,map,x,y,build=step.command:match('^/bf guide (%d+) ([to]) (%d+) (%d*%.?%d+) (%d*%.?%d+) (%d+%.%d+%.%d+%.%d+)$')
    if not id or tonumber(id)~=step.questId or phase~=step.phase or tonumber(map)<1 then return nil end
    x=tonumber(x);y=tonumber(y)
    if not x or not y or x<0 or x>1 or y<0 or y>1 then return nil end
    return step.command:sub(5)
end
local function sourceLabel(step)
    if step.source~='reference' then return step.source=='game' and 'Current game' or 'Check quest log' end
    local detail=type(step.detail)=='string' and step.detail or ''
    -- Keep the planner's relationship/localization qualification visible even
    -- when a long current objective fills the bounded detail preview.
    local offset
    for start in detail:gmatch('()Approximate reference:')do offset=start end
    local reference=offset and detail:sub(offset) or ''
    local label='Approximate reference'
    if reference:find('observed turn-in NPC',1,true) then label=label..': observed turn-in NPC'
    elseif reference:find('observed turn-in object',1,true) then label=label..': observed turn-in object'
    elseif reference:find('observed objective progress',1,true) then label=label..': observed objective progress'
    elseif reference:find('mentioned in objective',1,true) then label=label..': mentioned in objective' end
    local alias=reference:match('English reference: (.*)')
    if alias then label=label..'; English reference: '..text(alias,48) end
    return label
end
local function update()
    if not panel then return end
    safe(preparationLine.SetText,preparationLine,'')
    safe(waypointButton.Disable,waypointButton)
    safe(waypointButton.SetScript,waypointButton,'OnClick',nil)
    if combat() or not visible or not active then safe(panel.Hide,panel);return end
    local lines={'Waiting for a public character snapshot.'}
    local selected,command,stepIndex
    if latest then
        lines={text(latest.name,60)..'  |  Level '..text(tostring(latest.level),4)..' '..text(latest.className,30)}
        if not collapsed then
            local xp=latest.progress
            lines[#lines+1]=text(latest.location and latest.location.zone,70)..' | '..(xp and ('XP '..text(tostring(xp.current),12)..' / '..text(tostring(xp.max),12)) or 'XP unavailable')
            local plan=safe(BackstageForeverBuildPlan,latest,{focus=settings.focus,minutes=settings.minutes})
            if type(plan)=='table' and (plan.status=='ready' or plan.status=='empty') and type(plan.steps)=='table' then
                lines[#lines+1]=text(plan.headline,88)
                local cap=settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2
                for i=1,cap do
                    local step=plan.steps[i];if type(step)~='table' then break end
                    local source=sourceLabel(step)
                    lines[#lines+1]=i..'. '..text(step.title,74)..' ['..source..']'
                    lines[#lines+1]=text(step.detail,150)
                    local candidate=validCommand(step)
                    if not selected and candidate and type(BackstageForeverGuide)=='function' then selected=step;command=candidate;stepIndex=i end
                end
            elseif type(latest.quests)=='table' then
                local ready=0;for i=1,math.min(#latest.quests,25)do if latest.quests[i].complete then ready=ready+1 end end
                lines[#lines+1]=#latest.quests..' observed quests | '..ready..' ready'
                lines[#lines+1]='Live plan unavailable; check your quest log.'
            else lines[#lines+1]='Quest data unavailable' end
        end
    end
    if captureMessage then lines[#lines+1]=captureMessage end
    safe(body.SetText,body,table.concat(lines,'\n'))
    safe(body.ClearAllPoints,body)
    safe(body.SetPoint,body,'TOPLEFT',14,collapsed and -35 or -66)
    safe(body.SetHeight,body,collapsed and (captureMessage and 60 or 30) or 244)
    safe(panel.SetHeight,panel,collapsed and (captureMessage and 152 or 122) or 440)
    safe(focusButton.SetText,focusButton,'Focus: '..settings.focus)
    safe(sessionButton.SetText,sessionButton,settings.minutes..' min / '..(settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2)..' cards')
    for _,control in ipairs({focusButton,sessionButton,waypointButton,actionTitle,actionSource,preparationLine})do safe(collapsed and control.Hide or control.Show,control) end
    if preparation and not collapsed then safe(preparationLine.SetText,preparationLine,text(preparation.text,80)) end
    if selected and not collapsed then
        local qualifier=selected.source=='reference' and 'Approximate reference' or 'Current game'
        safe(actionTitle.SetText,actionTitle,'Step '..stepIndex..': '..text(selected.title,62))
        safe(actionSource.SetText,actionSource,qualifier..' — '..(selected.phase=='t' and 'turn-in' or 'objective'))
        local clickEpoch,clickCharacter=epoch,latest
        safe(waypointButton.SetScript,waypointButton,'OnClick',function()
            if not active or epoch~=clickEpoch or latest~=clickCharacter or combat() or type(BackstageForeverGuide)~='function' then return end
            safe(BackstageForeverGuide,command)
        end)
        safe(waypointButton.Enable,waypointButton)
    else
        safe(actionTitle.SetText,actionTitle,'No supported waypoint in these steps.')
        safe(actionSource.SetText,actionSource,'Check the quest log for directions.')
    end
    safe(panel.Show,panel)
end
BackstageForeverHUDUpdate=function(character)
    latest=character
    preparation=safe(BackstageForeverBuildPreparation,character)
    update()
end
BackstageForeverHUDSession=function(event)
    epoch=epoch+1;latest=nil;preparation=nil;captureMessage=nil
    if preparationLine then safe(preparationLine.SetText,preparationLine,'') end
    active=event=='PLAYER_LOGIN'
    if not active and panel then safe(panel.Hide,panel) end
end
BackstageForeverHUDCaptureStatus=function(state)
    -- Status changes cannot revive facts from a previously successful capture.
    if state=='unavailable' then preparation=nil end
    captureMessage=state=='partial' and 'Some public data is unavailable. Try again outside combat.'
        or state=='unavailable' and 'Snapshot unavailable. Try again outside combat.' or nil
    pcall(update)
end
local function initialize()
    if combat() or panel or type(CreateFrame)~='function' then return end
    if not settings then loadSettings() end
    panel=CreateFrame('Frame','BackstageForeverCompass',UIParent,'BackdropTemplate')
    panel:SetSize(340,440)
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
    local title=CreateFrame('Button',nil,panel);title:SetPoint('TOPLEFT',10,-9);title:SetSize(272,20)
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
    body=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');body:SetPoint('TOPLEFT',14,-66);body:SetWidth(312);body:SetJustifyH('LEFT');safe(body.SetJustifyV,body,'TOP')
    safe(body.SetMaxLines,body,21)
    hint=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
    hint:SetPoint('BOTTOMLEFT',14,13);hint:SetWidth(312);hint:SetJustifyH('LEFT')
    hint:SetText('Live in WoW | Desktop saves on logout / UI reload\nDrag title | X: hide | -: collapse | /bf show')
    local function button(name,x,width)
        local control=CreateFrame('Button',name,panel,'UIPanelButtonTemplate');control:SetPoint('TOPLEFT',x,-36);control:SetSize(width,22);return control
    end
    focusButton=button('BackstageForeverCompassFocus',14,174)
    focusButton:SetScript('OnClick',function()if active and not combat() then settings.focus=focuses[settings.focus] or 'balanced';save();update()end end)
    sessionButton=button('BackstageForeverCompassSession',192,134)
    sessionButton:SetScript('OnClick',function()if active and not combat() then settings.minutes=settings.minutes==15 and 30 or settings.minutes==30 and 60 or 15;save();update()end end)
    -- Independent rows prevent a wide title from hiding the waypoint qualifier.
    local function actionRow(y)
        local row=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        row:SetPoint('BOTTOMLEFT',14,y);row:SetWidth(312);row:SetHeight(16);row:SetJustifyH('LEFT')
        safe(row.SetMaxLines,row,1);safe(row.SetWordWrap,row,false)
        return row
    end
    actionTitle=actionRow(97);actionSource=actionRow(81)
    preparationLine=actionRow(113)
    waypointButton=CreateFrame('Button','BackstageForeverCompassWaypoint',panel,'UIPanelButtonTemplate');waypointButton:SetPoint('BOTTOMLEFT',14,51);waypointButton:SetSize(312,24);waypointButton:SetText('Show waypoint')
    update()
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_LOGOUT','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'})do safe(events.RegisterEvent,events,event)end
    events:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_LOGOUT' then BackstageForeverHUDSession(event);return end
        if event=='PLAYER_REGEN_DISABLED' then if panel then safe(panel.Hide,panel)end;return end
        if event=='PLAYER_LOGIN' then active=true;epoch=epoch+1;loadSettings()end
        pcall(initialize);pcall(update)
    end)
end
if type(SlashCmdList)=='table' then
    SLASH_BACKSTAGEFOREVER1='/bf'
    SlashCmdList.BACKSTAGEFOREVER=function(message)
        if type(message)=='string' and message:match('^guide') then
            if active and type(BackstageForeverGuide)=='function' then pcall(BackstageForeverGuide,message)end
            return
        end
        if combat() or not active then return end
        message=type(message)=='string' and message:lower() or ''
        if message=='hide' then visible=false elseif message=='show' then visible=true
        elseif message=='status' then
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(latest and 'live guidance in WoW; desktop saves on logout / UI reload.' or 'waiting for public snapshot.'))end
            return
        elseif message=='' then visible=not visible
        else
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: /bf show, hide, status, or guide QuestID t/o/r MapID X Y Build.')end
            return
        end
        pcall(initialize);save();pcall(update)
    end
end

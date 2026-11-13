-- Native display and explicit waypoint clicks only; capture remains event driven.
local panel,body,hint,actionTitle,actionSource,preparationLine,focusButton,sessionButton,waypointButton
local goalButton,notNowButton,detailsButton,selectedCoach
local questDetails=false
local professionDetails=false
local professionDetailsButton,professionButton,recipeButton,attemptsButton
local dismissed,dismissOrder={},{}
local latest,ownerId,preparation,captureMessage,settings
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
    if type(BackstageForeverMapGoalChanged)=='function' then pcall(BackstageForeverMapGoalChanged)end
end
local function loadSettings()
    local saved=type(BackstageForeverHUDSettings)=='table' and BackstageForeverHUDSettings or {}
    settings={schemaVersion=1,visible=saved.visible~=false,collapsed=saved.collapsed==true,
        mode=(saved.mode=='questing' or saved.mode=='professions') and saved.mode or 'adventure',
        focus=focuses[saved.focus] and saved.focus or 'balanced',minutes=(saved.minutes==15 or saved.minutes==30 or saved.minutes==60) and saved.minutes or 30}
    if anchors[saved.point] and anchors[saved.relativePoint] and finite(saved.x) and finite(saved.y) then
        settings.point=saved.point;settings.relativePoint=saved.relativePoint;settings.x=saved.x;settings.y=saved.y
    end
    local preference=type(saved.profession)=='table' and saved.profession or {}
    local function id(v)return type(v)=='number' and v==v and v%1==0 and v>0 and v<=2147483647 and v or nil end
    settings.profession={skillLineId=id(preference.skillLineId),recipeId=id(preference.recipeId),crafts=id(preference.crafts) and preference.crafts<=20 and preference.crafts or 1}
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
local update
update=function()
    if not panel then return end
    safe(preparationLine.SetText,preparationLine,'')
    selectedCoach=nil
    if notNowButton then safe(notNowButton.Disable,notNowButton);safe(notNowButton.SetScript,notNowButton,'OnClick',nil)end
    safe(waypointButton.Disable,waypointButton)
    safe(waypointButton.SetScript,waypointButton,'OnClick',nil)
    if combat() or not visible or not active then safe(panel.Hide,panel);return end
    local lines={'Getting ready. If this stays, type /reload once.'}
    local selected,command,stepIndex
    if latest then
        lines={text(latest.name,60)..'  |  Level '..text(tostring(latest.level),4)..' '..text(latest.className,30)}
        if not collapsed then
            local xp=latest.progress
            lines[#lines+1]=text(latest.location and latest.location.zone,70)..' | '..(xp and ('XP '..text(tostring(xp.current),12)..' / '..text(tostring(xp.max),12)..((tonumber(xp.max) or 0)>0 and (' ('..math.floor((tonumber(xp.current) or 0)/xp.max*100)..'%)') or '')..((tonumber(xp.rested) or 0)>0 and ' | rested' or '')) or 'XP unavailable')
            local coach=safe(BackstageForeverBuildCoach,latest,{mode=settings.mode,skillLineId=settings.profession.skillLineId,recipeId=settings.profession.recipeId,crafts=settings.profession.crafts})
            if type(coach)=='table' then
                local opportunities={};if coach.recommendation then opportunities[1]=coach.recommendation end
                for _,v in ipairs(coach.alternatives or {})do opportunities[#opportunities+1]=v end
                local shown={};for _,v in ipairs(opportunities)do if dismissed[v.id]~=v.signature then shown[#shown+1]=v end end
                selectedCoach=shown[1]
                if selectedCoach then
                    lines[#lines+1]='Next: '..text(selectedCoach.title,80)
                    lines[#lines+1]=text(selectedCoach.reason,150)
                    if not questDetails then lines[#lines+1]=text(selectedCoach.detail,170)end
                    lines[#lines+1]='Evidence: '..(selectedCoach.questStep and sourceLabel(selectedCoach.questStep) or text(selectedCoach.evidence,100))
                    if not questDetails then for i=2,math.min(3,#shown)do lines[#lines+1]='Or: '..text(shown[i].title,70)end end
                    local step=selectedCoach.kind=='quest' and selectedCoach.questStep or nil
                    local candidate=step and validCommand(step)
                    if candidate and type(BackstageForeverGuide)=='function' then selected=step;command=candidate;stepIndex=1 end
                    local clickEpoch,clickCharacter,chosen=epoch,latest,selectedCoach
                    safe(notNowButton.SetScript,notNowButton,'OnClick',function()
                        if not active or not visible or collapsed or combat() or epoch~=clickEpoch or latest~=clickCharacter or not selectedCoach or selectedCoach.id~=chosen.id or selectedCoach.signature~=chosen.signature then return end
                        if not dismissed[chosen.id] then dismissOrder[#dismissOrder+1]=chosen.id end
                        dismissed[chosen.id]=chosen.signature
                        while #dismissOrder>20 do dismissed[table.remove(dismissOrder,1)]=nil end
                        epoch=epoch+1;update()
                    end)
                    safe(notNowButton.Enable,notNowButton)
                else
                    lines[#lines+1]=#opportunities>0 and 'Quiet for now. Continue at your own pace.' or 'Nothing to suggest yet. Type /bf next for the nearest quest.'
                    lines[#lines+1]='Open your own profession normally for recipe advice.'
                end
                if questDetails then
                    local plan=safe(BackstageForeverBuildPlan,latest,{focus=settings.focus,minutes=settings.minutes})
                    lines[#lines+1]='Quest details | the time button sets how many steps you see.'
                    selected=nil;command=nil;stepIndex=nil
                    local cap=settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2
                    for i=1,cap do local step=type(plan)=='table' and type(plan.steps)=='table' and plan.steps[i] or nil;if not step then break end
                        lines[#lines+1]=i..'. '..text(step.title,42)
                        lines[#lines+1]=text(step.detail,46)
                        local candidate=validCommand(step)
                        if not selected and candidate and type(BackstageForeverGuide)=='function' then selected=step;command=candidate;stepIndex=i end
                    end
                end
            else
            local plan=safe(BackstageForeverBuildPlan,latest,{focus=settings.focus,minutes=settings.minutes})
            if type(plan)=='table' and (plan.status=='ready' or plan.status=='empty') and type(plan.steps)=='table' then
                lines[#lines+1]=text(plan.headline,88)
                local cap=settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2
                for i=1,cap do
                    local step=plan.steps[i];if type(step)~='table' then break end
                    local source=sourceLabel(step)
                    lines[#lines+1]=i..'. '..text(step.title,74)..' ['..source..']'
                    local detail=step.detail
                    if step.source=='game' and type(step.destination)=='table' and type(step.destination.text)=='string' and step.destination.text~='' then
                        -- Preserve the game's marker qualification before a
                        -- long objective consumes the bounded detail preview.
                        detail='Game marker: '..step.destination.text..'. '..(type(detail)=='string' and detail or '')
                    end
                    lines[#lines+1]=text(detail,150)
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
    end
    if captureMessage then lines[#lines+1]=captureMessage end
    safe(body.SetText,body,table.concat(lines,'\n'))
    safe(body.ClearAllPoints,body)
    safe(body.SetPoint,body,'TOPLEFT',14,collapsed and -35 or professionDetails and -148 or type(BackstageForeverBuildProfessionCoach)=='function' and -120 or -94)
    safe(body.SetHeight,body,collapsed and (captureMessage and 60 or 30) or 216)
    safe(panel.SetHeight,panel,collapsed and (captureMessage and 152 or 122) or professionDetails and 494 or type(BackstageForeverBuildProfessionCoach)=='function' and 466 or 440)
    safe(goalButton.SetText,goalButton,'Goal: '..({adventure='Adventure',questing='Quests',professions='Professions'})[settings.mode])
    safe(focusButton.SetText,focusButton,'Focus: '..(({balanced='everything',['turn-ins']='hand-ins'})[settings.focus] or settings.focus))
    safe(sessionButton.SetText,sessionButton,settings.minutes..' min: '..(settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2)..' steps')
    for _,control in ipairs({focusButton,sessionButton,goalButton,notNowButton,detailsButton,waypointButton,actionTitle,actionSource,preparationLine})do safe(collapsed and control.Hide or control.Show,control) end
    if type(BackstageForeverBuildCoach)=='function' then
        for _,control in ipairs({focusButton,sessionButton})do safe((collapsed or not questDetails) and control.Hide or control.Show,control)end
        safe(detailsButton.SetText,detailsButton,questDetails and 'Less' or 'Quest details')
        safe(detailsButton.SetPoint,detailsButton,'TOPLEFT',questDetails and 252 or 14,-64)
        safe(detailsButton.SetSize,detailsButton,questDetails and 74 or 312,22)
    else safe(detailsButton.Hide,detailsButton)end
    if professionDetailsButton then
        for _,control in ipairs({professionDetailsButton,professionButton,recipeButton,attemptsButton})do
            safe(control.SetScript,control,'OnClick',nil)
            safe((collapsed or not latest or (control~=professionDetailsButton and not professionDetails)) and control.Hide or control.Show,control)
        end
        local current=safe(BackstageForeverBuildProfessionCoach,latest,settings.profession)
        local clickEpoch,clickCharacter=epoch,latest
        local function bind(control,fn)
            safe(control.SetScript,control,'OnClick',function()
                if not active or not visible or collapsed or combat() or not latest or epoch~=clickEpoch or latest~=clickCharacter then return end
                fn();epoch=epoch+1;save();update()
            end)
        end
        safe(professionDetailsButton.SetText,professionDetailsButton,professionDetails and 'Less profession detail' or 'Profession details')
        bind(professionDetailsButton,function()professionDetails=not professionDetails end)
        if current then
            if professionDetails then
                if current.profession then lines[#lines+1]=text(current.profession.name,40)..': '..current.profession.rank..' / '..current.profession.maxRank end
                lines[#lines+1]=text(current.planning.reason or current.recommendation.detail,150)
                safe(body.SetText,body,table.concat(lines,'\n'))
            end
            local choice=settings.profession
            safe(professionButton.SetText,professionButton,'Profession: '..(choice.skillLineId and text(current.profession and current.profession.name or 'Unavailable',15) or 'Auto'))
            safe(recipeButton.SetText,recipeButton,'Recipe: '..(choice.recipeId and text(current.selectedRecipe and current.selectedRecipe.name or 'Unavailable',15) or 'Auto'))
            safe(attemptsButton.SetText,attemptsButton,choice.crafts..' attempts')
            local function nextId(items,key,id)
                if not id then return items[1] and items[1][key] end
                for i,item in ipairs(items)do if item[key]==id then return items[i+1] and items[i+1][key] end end
                return nil
            end
            bind(professionButton,function()choice.skillLineId=nextId(current.ownedProfessionChoices,'skillLineId',choice.skillLineId);choice.recipeId=nil end)
            bind(recipeButton,function()choice.recipeId=nextId(current.recipeChoices,'id',choice.recipeId)end)
            bind(attemptsButton,function()choice.crafts=({[1]=5,[5]=10,[10]=20,[20]=1})[choice.crafts] or 1 end)
        end
    end
    if preparation and not collapsed then safe(preparationLine.SetText,preparationLine,text(preparation.text,80)) end
    if selected and not collapsed then
        local qualifier=selected.source=='reference' and 'Approximate reference' or 'Current game'
        safe(actionTitle.SetText,actionTitle,'Step '..stepIndex..': '..text(selected.title,62))
        safe(actionSource.SetText,actionSource,qualifier..' — '..(selected.phase=='t' and 'turn-in' or 'objective'))
        local clickEpoch,clickCharacter,clickCoach=epoch,latest,selectedCoach
        safe(waypointButton.SetScript,waypointButton,'OnClick',function()
            if not active or not visible or collapsed or epoch~=clickEpoch or latest~=clickCharacter or combat() or type(BackstageForeverGuide)~='function' then return end
            if clickCoach and (not selectedCoach or selectedCoach.id~=clickCoach.id or selectedCoach.signature~=clickCoach.signature)then return end
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
    epoch=epoch+1
    if ownerId and character and ownerId~=character.id then epoch=epoch+1;dismissed={};dismissOrder={};questDetails=false;professionDetails=false end
    latest=character;ownerId=character and character.id or ownerId
    preparation=safe(BackstageForeverBuildPreparation,character)
    update()
end
BackstageForeverHUDSession=function(event)
    epoch=epoch+1;latest=nil;ownerId=nil;preparation=nil;captureMessage=nil;selectedCoach=nil;dismissed={};dismissOrder={};questDetails=false;professionDetails=false
    if preparationLine then safe(preparationLine.SetText,preparationLine,'') end
    active=event=='PLAYER_LOGIN'
    if not active and panel then safe(panel.Hide,panel) end
end
BackstageForeverHUDCaptureStatus=function(state)
    -- Status changes cannot revive facts from a previously successful capture.
    if state=='unavailable' then epoch=epoch+1;latest=nil;preparation=nil;selectedCoach=nil end
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
    hint:SetText('Updates as you play | /bf help lists commands\nDrag the title to move | X: hide | -: shrink | /bf show')
    local function button(name,x,width)
        local control=CreateFrame('Button',name,panel,'UIPanelButtonTemplate');control:SetPoint('TOPLEFT',x,-64);control:SetSize(width,22);return control
    end
    goalButton=button('BackstageForeverCompassGoal',14,174);goalButton:SetPoint('TOPLEFT',14,-36)
    goalButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.mode=({adventure='questing',questing='professions',professions='adventure'})[settings.mode];save();update()end end)
    notNowButton=button('BackstageForeverCompassNotNow',192,134);notNowButton:SetPoint('TOPLEFT',192,-36);notNowButton:SetText('Not now')
    focusButton=button('BackstageForeverCompassFocus',14,126)
    focusButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.focus=focuses[settings.focus] or 'balanced';save();update()end end)
    sessionButton=button('BackstageForeverCompassSession',144,104)
    sessionButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.minutes=settings.minutes==15 and 30 or settings.minutes==30 and 60 or 15;save();update()end end)
    detailsButton=button('BackstageForeverCompassDetails',14,312)
    detailsButton:SetScript('OnClick',function()if active and not combat()then epoch=epoch+1;questDetails=not questDetails;update()end end)
    professionDetailsButton=button('BackstageForeverCompassProfessionDetails',14,312);professionDetailsButton:SetPoint('TOPLEFT',14,-90)
    professionButton=button('BackstageForeverCompassProfession',14,126);professionButton:SetPoint('TOPLEFT',14,-118)
    recipeButton=button('BackstageForeverCompassRecipe',144,104);recipeButton:SetPoint('TOPLEFT',144,-118)
    attemptsButton=button('BackstageForeverCompassAttempts',252,74);attemptsButton:SetPoint('TOPLEFT',252,-118)
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
        if event=='PLAYER_REGEN_DISABLED' then epoch=epoch+1;if waypointButton then safe(waypointButton.SetScript,waypointButton,'OnClick',nil);safe(waypointButton.Disable,waypointButton)end;if notNowButton then safe(notNowButton.SetScript,notNowButton,'OnClick',nil)end;if panel then safe(panel.Hide,panel)end;return end
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
        if type(message)=='string' and message:lower():match('^find%s') then
            if type(BackstageForeverFind)=='function' then pcall(BackstageForeverFind,message:gsub('^%S+','find',1))end
            return
        end
        if type(message)=='string' and message:lower():match('^way%s') then
            if type(BackstageForeverWay)=='function' then pcall(BackstageForeverWay,message)end
            return
        end
        if type(message)=='string' and message:lower():match('^next') then
            if type(BackstageForeverNext)=='function' then pcall(BackstageForeverNext)end
            return
        end
        if type(message)=='string' and message:lower():match('^live') then
            if type(BackstageForeverLiveCommand)=='function' then pcall(BackstageForeverLiveCommand,message)end
            return
        end
        if type(message)=='string' then
            local word=message:lower():match('^(%a+)')
            if word=='train' or word=='repair' or word=='flights' or word=='xp' or word=='hearth' or word=='help' or word=='toasts' or word=='danger' or word=='junk' then
                if type(BackstageForeverAssistCommand)=='function' then pcall(BackstageForeverAssistCommand,message)end
                return
            end
            if word=='gear' then
                if type(BackstageForeverGearCommand)=='function' then pcall(BackstageForeverGearCommand,message)end
                return
            end
            if word=='how' then
                if type(BackstageForeverHowCommand)=='function' then pcall(BackstageForeverHowCommand,message)end
                return
            end
            if word=='stats' then
                if type(BackstageForeverStatsCommand)=='function' then pcall(BackstageForeverStatsCommand)end
                return
            end
            if word=='supplies' then
                if type(BackstageForeverSuppliesCommand)=='function' then pcall(BackstageForeverSuppliesCommand,message)end
                return
            end
            if word=='route' then
                if type(BackstageForeverRouteCommand)=='function' then pcall(BackstageForeverRouteCommand,message:lower())end
                return
            end
        end
        if combat() or not active then return end
        message=type(message)=='string' and message:lower() or ''
        if message=='hide' then visible=false elseif message=='show' then visible=true
        elseif message=='status' then
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(latest and 'live guidance in WoW; desktop saves on logout / UI reload.' or 'waiting for public snapshot.'))end
            return
        elseif message=='' then visible=not visible
        else
            if type(DEFAULT_CHAT_FRAME)=='table' then safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: try /bf next (where to go), /bf train (your trainer), /bf find NAME, or /bf help for everything.')end
            return
        end
        pcall(initialize);save();pcall(update)
    end
end

-- Native display and explicit waypoint clicks only; capture remains event driven.
local panel,body,hint,actionTitle,actionSource,preparationLine,focusButton,sessionButton,waypointButton
local goalButton,notNowButton,detailsButton,selectedCoach
local onMyWayTitle,onMyWayEvidence,onMyWayNotNow
local onMyWayFresh=false
local onMyWayShown
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
-- Nil-safe method call for optional widgets (the XP bar is plain textures; a client without them keeps the text).
local function invoke(o,k,...) if o and type(o[k])=='function' then return safe(o[k],o,...) end end
-- Layout (0.54): text and controls sit inside the painted brass border, not on it.
local INSET,WIDE=22,296
local head,xpEdge,xpBack,xpRested,xpFill,xpText
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
-- The game's language for the Compass's own lines (0.54); English when no translation exists.
local function T(s) local v=type(BackstageForeverTr)=='function' and safe(BackstageForeverTr,s);return type(v)=='string' and v or s end
local function number(n)
    n=math.floor(tonumber(n) or 0)
    if type(BreakUpLargeNumbers)=='function' then local v=safe(BreakUpLargeNumbers,n);if type(v)=='string' then return v end end
    return tostring(n)
end
-- The compact Compass (0.54): what a player wants at a glance while playing, from facts already captured.
-- -> head text (two lines), XP {cur,max,rested} or nil, body lines
local function compactView(c)
    local where=text(c.location and c.location.zone,40)
    local sub=text(c.location and c.location.subZone,40)
    if sub~='' and sub~=where then where=where~='' and (where..' - '..sub) or sub end
    local headText='|cffffd100'..text(c.name,40)..'|r  ·  '..T('Level')..' '..text(tostring(c.level),4)..' '..text(c.className,30)..'\n'..(where~='' and where or T('Somewhere in the world'))
    local xp=type(c.progress)=='table' and c.progress or nil
    local cur,max=xp and tonumber(xp.current),xp and tonumber(xp.max)
    local bar=(cur and max and max>0) and {cur=math.max(0,math.min(cur,max)),max=max,rested=math.max(0,tonumber(xp.rested) or 0)} or nil
    local out={}
    if type(c.quests)=='table' then
        local ready=0
        for i=1,math.min(#c.quests,50) do if type(c.quests[i])=='table' and c.quests[i].complete then ready=ready+1 end end
        out[#out+1]=T(('Quests: %d in your log'):format(#c.quests))..(ready>0 and (' · |cff7ad67a'..T(('%d ready to hand in'):format(ready))..'|r') or '')
    end
    local pace=type(BackstageForeverPaceSummary)=='function' and safe(BackstageForeverPaceSummary)
    out[#out+1]=type(pace)=='string' and pace or T('Pace: shown after a few minutes of play')
    if xp and xp.resting then out[#out+1]=T('Resting: rested XP is building up') end
    local route=type(BackstageForeverRouteNow)=='function' and safe(BackstageForeverRouteNow)
    if type(route)=='table' and type(route.text)=='string' then
        out[#out+1]='|cffffd100Route '..number(route.index)..'/'..number(route.total)..':|r '..text(route.text,120)
    else
        local coach=type(BackstageForeverBuildCoach)=='function' and safe(BackstageForeverBuildCoach,c,{mode=settings.mode,skillLineId=settings.profession.skillLineId,recipeId=settings.profession.recipeId,crafts=settings.profession.crafts})
        local pick=type(coach)=='table' and coach.recommendation
        if type(pick)~='table' or dismissed[pick.id]==pick.signature then pick=nil
            for _,v in ipairs(type(coach)=='table' and coach.alternatives or {}) do if type(v)=='table' and dismissed[v.id]~=v.signature then pick=v;break end end
        end
        if type(pick)=='table' and pick.title then out[#out+1]='|cffffd100'..T('Next:')..'|r '..text(pick.title,110)
        else
            local plan=type(BackstageForeverBuildPlan)=='function' and safe(BackstageForeverBuildPlan,c,{focus=settings.focus,minutes=settings.minutes})
            local step=type(plan)=='table' and type(plan.steps)=='table' and plan.steps[1]
            out[#out+1]=type(step)=='table' and ('|cffffd100'..T('Next:')..'|r '..text(step.title,110)) or ('|cffffd100'..T('Next:')..'|r '..T('type /bf next for the nearest quest'))
        end
    end
    return headText,bar,out
end
-- Paints the XP bar, or hides it (expanded view, max level, no data).
local function paintXp(bar)
    for _,piece in ipairs({xpEdge,xpBack,xpRested,xpFill,xpText}) do invoke(piece,bar and 'Show' or 'Hide') end
    if not bar then return end
    local f=bar.cur/bar.max
    local r=math.min(1,(bar.cur+bar.rested)/bar.max)
    invoke(xpFill,f>0 and 'Show' or 'Hide');invoke(xpFill,'SetWidth',math.max(1,WIDE*f))
    invoke(xpRested,r>f and 'Show' or 'Hide');invoke(xpRested,'SetWidth',math.max(1,WIDE*r))
    invoke(xpText,'SetText',math.floor(f*100)..'%  ·  '..T(('%s XP to level up'):format(number(bar.max-bar.cur)))..(bar.rested>0 and ('  ·  '..T('rested')) or ''))
end
local update
local function rememberDismissal(chosen)
    if not dismissed[chosen.id] then dismissOrder[#dismissOrder+1]=chosen.id end
    dismissed[chosen.id]=chosen.signature
    while #dismissOrder>20 do dismissed[table.remove(dismissOrder,1)]=nil end
    epoch=epoch+1;update()
end
local function clearOnMyWay()
    onMyWayShown=nil
    for _,row in ipairs({onMyWayTitle,onMyWayEvidence})do invoke(row,'SetText','');invoke(row,'Hide')end
    invoke(onMyWayNotNow,'SetScript','OnClick',nil)
    invoke(onMyWayNotNow,'Disable');invoke(onMyWayNotNow,'Hide')
end
update=function()
    if not panel then return end
    safe(preparationLine.SetText,preparationLine,'')
    selectedCoach=nil
    clearOnMyWay()
    if notNowButton then safe(notNowButton.Disable,notNowButton);safe(notNowButton.SetScript,notNowButton,'OnClick',nil)end
    safe(waypointButton.Disable,waypointButton)
    safe(waypointButton.SetScript,waypointButton,'OnClick',nil)
    if combat() or not visible or not active then safe(panel.Hide,panel);return end
    local lines={'Getting ready. If this stays, type /reload once.'}
    local selected,command,stepIndex,onMyWay
    if latest then
        lines={text(latest.name,60)..'  |  Level '..text(tostring(latest.level),4)..' '..text(latest.className,30)}
        if not collapsed then
            local xp=latest.progress
            lines[#lines+1]=text(latest.location and latest.location.zone,70)..' | '..(xp and ('XP '..text(tostring(xp.current),12)..' / '..text(tostring(xp.max),12)..((tonumber(xp.max) or 0)>0 and (' ('..math.floor((tonumber(xp.current) or 0)/xp.max*100)..'%)') or '')..((tonumber(xp.rested) or 0)>0 and ' | rested' or '')) or 'XP unavailable')
            local pace=type(BackstageForeverPaceSummary)=='function' and safe(BackstageForeverPaceSummary)
            if type(pace)=='string' then lines[#lines+1]=pace end
            local coach=safe(BackstageForeverBuildCoach,latest,{mode=settings.mode,skillLineId=settings.profession.skillLineId,recipeId=settings.profession.recipeId,crafts=settings.profession.crafts})
            if type(coach)=='table' then
                local opportunities={};if coach.recommendation then opportunities[1]=coach.recommendation end
                for _,v in ipairs(coach.alternatives or {})do opportunities[#opportunities+1]=v end
                local shown={};for _,v in ipairs(opportunities)do if dismissed[v.id]~=v.signature then shown[#shown+1]=v end end
                selectedCoach=shown[1]
                if selectedCoach then
                    local extra=coach.onMyWay
                    if onMyWayFresh and not captureMessage and not questDetails and not professionDetails
                        and selectedCoach==coach.recommendation and extra and not safe(BackstageForeverRouteNow) then
                        if dismissed[extra.id]~=extra.signature then onMyWay=extra end
                    else extra=nil end
                    lines[#lines+1]='Next: '..text(selectedCoach.title,80)
                    lines[#lines+1]=text(selectedCoach.reason,150)
                    if not questDetails then lines[#lines+1]=text(selectedCoach.detail,170)end
                    lines[#lines+1]='Evidence: '..(selectedCoach.questStep and sourceLabel(selectedCoach.questStep) or text(selectedCoach.evidence,100))
                    if not questDetails then for i=2,math.min(3,#shown)do
                        if not extra or shown[i].id~='quest:'..extra.questId then lines[#lines+1]='Or: '..text(shown[i].title,70)end
                    end end
                    local step=selectedCoach.kind=='quest' and selectedCoach.questStep or nil
                    local candidate=step and validCommand(step)
                    if candidate and type(BackstageForeverGuide)=='function' then selected=step;command=candidate;stepIndex=1 end
                    local clickEpoch,clickCharacter,chosen=epoch,latest,selectedCoach
                    safe(notNowButton.SetScript,notNowButton,'OnClick',function()
                        if not active or not visible or collapsed or combat() or epoch~=clickEpoch or latest~=clickCharacter or not selectedCoach or selectedCoach.id~=chosen.id or selectedCoach.signature~=chosen.signature then return end
                        rememberDismissal(chosen)
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
    local headText,bar
    if collapsed and latest then headText,bar,lines=compactView(latest) end
    if captureMessage then lines[#lines+1]=captureMessage end
    invoke(head,'SetText',headText or '');invoke(head,headText and 'Show' or 'Hide')
    paintXp(bar)
    safe(body.SetText,body,table.concat(lines,'\n'))
    safe(body.ClearAllPoints,body)
    local top=collapsed and (headText and (bar and -88 or -70) or -40) or professionDetails and -148 or type(BackstageForeverBuildProfessionCoach)=='function' and -120 or -94
    safe(body.SetPoint,body,'TOPLEFT',INSET,top)
    if collapsed then
        -- The compact Compass grows with its lines, keeping the footer clear of them.
        local measured=safe(body.GetStringHeight,body)
        local h=type(measured)=='number' and measured>0 and math.min(measured,160) or #lines*14
        safe(body.SetHeight,body,h)
        safe(panel.SetHeight,panel,math.floor(-top+h+42))
    else
        safe(body.SetHeight,body,216)
        local height=professionDetails and 494 or type(BackstageForeverBuildCoach)=='function' and 466 or 440
        safe(panel.SetHeight,panel,height+(onMyWay and 48 or 0))
    end
    safe(goalButton.SetText,goalButton,'Goal: '..({adventure='Adventure',questing='Quests',professions='Professions'})[settings.mode])
    safe(focusButton.SetText,focusButton,'Focus: '..(({balanced='everything',['turn-ins']='hand-ins'})[settings.focus] or settings.focus))
    safe(sessionButton.SetText,sessionButton,settings.minutes..' min: '..(settings.minutes==15 and 1 or settings.minutes==60 and 3 or 2)..' steps')
    for _,control in ipairs({focusButton,sessionButton,goalButton,notNowButton,detailsButton,waypointButton,actionTitle,actionSource,preparationLine})do safe(collapsed and control.Hide or control.Show,control) end
    if type(BackstageForeverBuildCoach)=='function' then
        for _,control in ipairs({focusButton,sessionButton})do safe((collapsed or not questDetails) and control.Hide or control.Show,control)end
        safe(detailsButton.SetText,detailsButton,questDetails and 'Less' or 'Quest details')
        safe(detailsButton.SetPoint,detailsButton,'TOPLEFT',questDetails and 246 or INSET,-64)
        safe(detailsButton.SetSize,detailsButton,questDetails and 72 or WIDE,22)
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
            if professionDetails and not collapsed then
                if current.profession then lines[#lines+1]=text(current.profession.name,40)..': '..current.profession.rank..' / '..current.profession.maxRank end
                local sel,best,count=current.selectedRecipe,current.nextRecipe,current.skillUp
                if sel and type(sel.skill)=='table' then lines[#lines+1]=text(sel.name,40)..': '..text(sel.skill.label,20)..(best and best.id~=sel.id and (' | best next: '..text(best.name,30)..' ('..text(best.label,20)..')') or '') elseif best then lines[#lines+1]='Best next: '..text(best.name,40)..' ('..text(best.label,20)..')' end
                if count and count.status=='estimate' then lines[#lines+1]='~'..count.craftsToCap..' crafts to '..count.maxRank..' (estimate)' end
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
    BackstageForeverHUDRefreshBadge()
    if onMyWay then
        onMyWayShown=onMyWay
        invoke(onMyWayTitle,'SetText','On my way: '..text(onMyWay.title,60))
        invoke(onMyWayEvidence,'SetText','Current game: hand-in on this map')
        invoke(onMyWayNotNow,'SetScript','OnClick',function()
            if onMyWayShown~=onMyWay or combat() or safe(BackstageForeverRouteNow) then return end
            rememberDismissal(onMyWay)
        end)
        invoke(onMyWayTitle,'Show');invoke(onMyWayEvidence,'Show')
        invoke(onMyWayNotNow,'Enable');invoke(onMyWayNotNow,'Show')
    end
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
function BackstageForeverHUDRefreshBadge()
    if not preparationLine or not active or not visible or collapsed or combat() then return end
    local line=safe(BackstageForeverPinnedBadgeLine) or (preparation and preparation.text) or safe(BackstageForeverNextBadgeLine)
    safe(preparationLine.SetText,preparationLine,text(line,80))
end
BackstageForeverHUDUpdate=function(character)
    epoch=epoch+1
    if ownerId and character and ownerId~=character.id then epoch=epoch+1;dismissed={};dismissOrder={};questDetails=false;professionDetails=false end
    latest=character;ownerId=character and character.id or ownerId
    onMyWayFresh=character~=nil and not combat()
    preparation=safe(BackstageForeverBuildPreparation,character)
    update()
end
BackstageForeverHUDSession=function(event)
    epoch=epoch+1;latest=nil;ownerId=nil;preparation=nil;captureMessage=nil;selectedCoach=nil;dismissed={};dismissOrder={};questDetails=false;professionDetails=false
    if preparationLine then safe(preparationLine.SetText,preparationLine,'') end
    onMyWayFresh=false;clearOnMyWay()
    active=event=='PLAYER_LOGIN'
    if not active and panel then safe(panel.Hide,panel) end
end
BackstageForeverHUDCaptureStatus=function(state)
    -- Status changes cannot revive facts from a previously successful capture.
    if state=='unavailable' then epoch=epoch+1;latest=nil;preparation=nil;selectedCoach=nil end
    if state~='ready' then onMyWayFresh=false end
    captureMessage=state=='partial' and 'Some public data is unavailable. Try again outside combat.'
        or state=='unavailable' and 'Snapshot unavailable. Try again outside combat.' or nil
    pcall(update)
end
-- G9 (0.49): painted frames for the Compass and the step frame, cut from our own painting
-- (Art/Frames, made locally with ComfyUI). Every call is guarded: a missing method or texture
-- leaves the frame plain rather than breaking it.
local FRAME_ART='Interface\\AddOns\\BackstageForever\\Art\\Frames\\'
local function call(o,k,...) if o and type(o[k])=='function' then local ok,v=pcall(o[k],o,...);if ok then return v end end end
local function piece(f,file,size,layer,sub,l,r,t,b)
    local x=call(f,'CreateTexture',nil,layer,nil,sub)
    if not x then return nil end
    call(x,'SetTexture',FRAME_ART..file);call(x,'SetTexCoord',l/size[1],r/size[1],t/size[2],b/size[2])
    return x
end
-- Nine pieces from a 512x512 atlas: 64px corners, 384px edges and centre. corner/edge are on-screen sizes.
function BackstageForeverPaintNineSlice(f,file,corner,edge)
    local A={512,512}
    local c=piece(f,file,A,'BACKGROUND',-1,64,448,64,448)
    call(c,'SetPoint','TOPLEFT',f,'TOPLEFT',edge,-edge);call(c,'SetPoint','BOTTOMRIGHT',f,'BOTTOMRIGHT',-edge,edge)
    local t=piece(f,file,A,'BORDER',0,64,448,0,64);call(t,'SetPoint','TOPLEFT',f,'TOPLEFT',corner,0);call(t,'SetPoint','TOPRIGHT',f,'TOPRIGHT',-corner,0);call(t,'SetHeight',corner)
    local b=piece(f,file,A,'BORDER',0,64,448,448,512);call(b,'SetPoint','BOTTOMLEFT',f,'BOTTOMLEFT',corner,0);call(b,'SetPoint','BOTTOMRIGHT',f,'BOTTOMRIGHT',-corner,0);call(b,'SetHeight',corner)
    local l=piece(f,file,A,'BORDER',0,0,64,64,448);call(l,'SetPoint','TOPLEFT',f,'TOPLEFT',0,-corner);call(l,'SetPoint','BOTTOMLEFT',f,'BOTTOMLEFT',0,corner);call(l,'SetWidth',corner)
    local r=piece(f,file,A,'BORDER',0,448,512,64,448);call(r,'SetPoint','TOPRIGHT',f,'TOPRIGHT',0,-corner);call(r,'SetPoint','BOTTOMRIGHT',f,'BOTTOMRIGHT',0,corner);call(r,'SetWidth',corner)
    for _,k in ipairs({{'TOPLEFT',0,64,0,64},{'TOPRIGHT',448,512,0,64},{'BOTTOMLEFT',0,64,448,512},{'BOTTOMRIGHT',448,512,448,512}}) do
        local x=piece(f,file,A,'BORDER',1,k[2],k[3],k[4],k[5]);call(x,'SetPoint',k[1],f,k[1],0,0);call(x,'SetSize',corner,corner)
    end
    return c
end
-- Three pieces from a 256x128 atlas (rod | parchment | rod) for the step scroll.
function BackstageForeverPaintScroll(f,file,cap)
    local A={256,128}
    local m=piece(f,file,A,'BACKGROUND',0,64,192,0,128);call(m,'SetPoint','TOPLEFT',f,'TOPLEFT',cap-6,-4);call(m,'SetPoint','BOTTOMRIGHT',f,'BOTTOMRIGHT',-cap+6,4)
    local l=piece(f,file,A,'BORDER',0,0,64,0,128);call(l,'SetPoint','TOPLEFT',f,'TOPLEFT',0,0);call(l,'SetPoint','BOTTOMLEFT',f,'BOTTOMLEFT',0,0);call(l,'SetWidth',cap)
    local r=piece(f,file,A,'BORDER',0,192,256,0,128);call(r,'SetPoint','TOPRIGHT',f,'TOPRIGHT',0,0);call(r,'SetPoint','BOTTOMRIGHT',f,'BOTTOMRIGHT',0,0);call(r,'SetWidth',cap)
    return m
end
BackstageForeverFrameArt=FRAME_ART
local function initialize()
    if combat() or panel or type(CreateFrame)~='function' then return end
    if not settings then loadSettings() end
    panel=CreateFrame('Frame','BackstageForeverCompass',UIParent,'BackdropTemplate')
    panel:SetSize(340,440)
    if settings.point then panel:SetPoint(settings.point,UIParent,settings.relativePoint,settings.x,settings.y)
    else panel:SetPoint('CENTER',UIParent,'CENTER',260,60) end
    panel:SetMovable(true);panel:EnableMouse(true);panel:RegisterForDrag('LeftButton');panel:SetClampedToScreen(true)
    -- G9 (0.49): our painted leather-and-brass frame and its compass crest instead of the stock dialog border.
    BackstageForeverPaintNineSlice(panel,'compass',40,14)
    local crest=piece(panel,'compass-crest',{128,64},'ARTWORK',2,0,128,0,64)
    call(crest,'SetSize',96,48);call(crest,'SetPoint','BOTTOM',panel,'TOP',0,-16)
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
    -- Centred on the panel, under the compass crest (0.54), clear of the - and X buttons.
    local title=CreateFrame('Button',nil,panel);title:SetPoint('TOP',0,-11);title:SetSize(212,20)
    title:RegisterForDrag('LeftButton');title:SetScript('OnDragStart',startDrag);title:SetScript('OnDragStop',stopDrag)
    local heading=title:CreateFontString(nil,'OVERLAY','GameFontNormal');heading:SetAllPoints();heading:SetText(T('Adventure Compass'))
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
    body=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');body:SetPoint('TOPLEFT',INSET,-66);body:SetWidth(WIDE);body:SetJustifyH('LEFT');safe(body.SetJustifyV,body,'TOP')
    safe(body.SetMaxLines,body,21)
    hint=panel:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    hint:SetPoint('BOTTOM',0,21);hint:SetWidth(WIDE);hint:SetJustifyH('CENTER')
    hint:SetText(T('Drag the title to move  ·  /bf help  ·  /bf show'))
    -- The compact view's two-line heading and XP bar (0.54).
    head=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');head:SetPoint('TOPLEFT',INSET,-38);head:SetWidth(WIDE);head:SetJustifyH('LEFT')
    safe(head.SetMaxLines,head,2)
    local function barPiece(sub,r,g,b,a,grow)
        grow=grow or 0
        local t=invoke(panel,'CreateTexture',nil,'ARTWORK',nil,sub)
        invoke(t,'SetColorTexture',r,g,b,a);invoke(t,'SetPoint','TOPLEFT',panel,'TOPLEFT',INSET-grow,-70+grow);invoke(t,'SetSize',WIDE+2*grow,12+2*grow)
        return t
    end
    -- A thin brass edge around a warm dark well, matching the painted frame.
    xpEdge=barPiece(-1,.62,.47,.22,.9,1);xpBack=barPiece(0,.09,.06,.03,.92)
    xpRested=barPiece(1,.27,.45,.85,.6);xpFill=barPiece(2,.86,.64,.2,.95)
    xpText=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');xpText:SetPoint('TOPLEFT',INSET,-69);xpText:SetWidth(WIDE);xpText:SetJustifyH('CENTER')
    safe(xpText.SetHeight,xpText,14)
    local function button(name,x,width)
        local control=CreateFrame('Button',name,panel,'UIPanelButtonTemplate');control:SetPoint('TOPLEFT',x,-64);control:SetSize(width,22);return control
    end
    goalButton=button('BackstageForeverCompassGoal',INSET,168);goalButton:SetPoint('TOPLEFT',INSET,-38)
    goalButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.mode=({adventure='questing',questing='professions',professions='adventure'})[settings.mode];save();update()end end)
    notNowButton=button('BackstageForeverCompassNotNow',194,124);notNowButton:SetPoint('TOPLEFT',194,-38);notNowButton:SetText('Not now')
    focusButton=button('BackstageForeverCompassFocus',INSET,122)
    focusButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.focus=focuses[settings.focus] or 'balanced';save();update()end end)
    sessionButton=button('BackstageForeverCompassSession',148,96)
    sessionButton:SetScript('OnClick',function()if active and not combat() then epoch=epoch+1;settings.minutes=settings.minutes==15 and 30 or settings.minutes==30 and 60 or 15;save();update()end end)
    detailsButton=button('BackstageForeverCompassDetails',INSET,WIDE)
    detailsButton:SetScript('OnClick',function()if active and not combat()then epoch=epoch+1;questDetails=not questDetails;update()end end)
    professionDetailsButton=button('BackstageForeverCompassProfessionDetails',INSET,WIDE);professionDetailsButton:SetPoint('TOPLEFT',INSET,-90)
    professionButton=button('BackstageForeverCompassProfession',INSET,122);professionButton:SetPoint('TOPLEFT',INSET,-118)
    recipeButton=button('BackstageForeverCompassRecipe',148,94);recipeButton:SetPoint('TOPLEFT',148,-118)
    attemptsButton=button('BackstageForeverCompassAttempts',246,72);attemptsButton:SetPoint('TOPLEFT',246,-118)
    -- Independent rows prevent a wide title from hiding the waypoint qualifier.
    local function actionRow(y)
        local row=panel:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall')
        row:SetPoint('BOTTOMLEFT',INSET,y);row:SetWidth(WIDE);row:SetHeight(16);row:SetJustifyH('LEFT')
        safe(row.SetMaxLines,row,1);safe(row.SetWordWrap,row,false)
        return row
    end
    actionTitle=actionRow(97);actionSource=actionRow(81)
    preparationLine=actionRow(113)
    onMyWayTitle=actionRow(155);onMyWayEvidence=actionRow(137)
    onMyWayEvidence:SetWidth(204)
    onMyWayNotNow=CreateFrame('Button','BackstageForeverCompassOnMyWayNotNow',panel,'UIPanelButtonTemplate')
    onMyWayNotNow:SetPoint('BOTTOMLEFT',238,134);onMyWayNotNow:SetSize(80,22);onMyWayNotNow:SetText('Not now')
    waypointButton=CreateFrame('Button','BackstageForeverCompassWaypoint',panel,'UIPanelButtonTemplate');waypointButton:SetPoint('BOTTOMLEFT',INSET,51);waypointButton:SetSize(WIDE,24);waypointButton:SetText('Show waypoint')
    update()
end
if type(CreateFrame)=='function' then
    local events=CreateFrame('Frame')
    for _,event in ipairs({'PLAYER_LOGIN','PLAYER_LOGOUT','PLAYER_REGEN_DISABLED','PLAYER_REGEN_ENABLED'})do safe(events.RegisterEvent,events,event)end
    events:SetScript('OnEvent',function(_,event)
        if event=='PLAYER_LOGOUT' then BackstageForeverHUDSession(event);return end
        if event=='PLAYER_REGEN_DISABLED' then epoch=epoch+1;onMyWayFresh=false;clearOnMyWay();if waypointButton then safe(waypointButton.SetScript,waypointButton,'OnClick',nil);safe(waypointButton.Disable,waypointButton)end;if notNowButton then safe(notNowButton.SetScript,notNowButton,'OnClick',nil)end;if panel then safe(panel.Hide,panel)end;return end
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
            if word=='nodes' then
                if type(BackstageForeverNodesCommand)=='function' then pcall(BackstageForeverNodesCommand,message)end
                return
            end
            if word=='prof' then
                if not combat() and type(BackstageForeverProfessionLines)=='function' and type(DEFAULT_CHAT_FRAME)=='table' then
                    local coach=latest and safe(BackstageForeverBuildProfessionCoach,latest,settings and settings.profession or {})
                    local ok,lines=pcall(BackstageForeverProfessionLines,coach)
                    for _,line in ipairs(ok and lines or {})do safe(DEFAULT_CHAT_FRAME.AddMessage,DEFAULT_CHAT_FRAME,'Backstage Forever: '..(BackstageForeverTr or tostring)(text(line,200)))end
                end
                return
            end
            if word=='ledger' or word=='prices' then
                if type(BackstageForeverLedgerCommand)=='function' then pcall(BackstageForeverLedgerCommand,message)end
                return
            end
            if word=='boss' then
                if type(BackstageForeverBossCommand)=='function' then pcall(BackstageForeverBossCommand,message)end
                return
            end
            if word=='plates' then
                if type(BackstageForeverPlatesCommand)=='function' then pcall(BackstageForeverPlatesCommand,message)end
                return
            end
            if word=='sell' then
                if type(BackstageForeverSellCommand)=='function' then pcall(BackstageForeverSellCommand,message)end
                return
            end
            if word=='badges' then
                if type(BackstageForeverBadgesCommand)=='function' then pcall(BackstageForeverBadgesCommand,message)end
                return
            end
            if word=='set' then
                if type(BackstageForeverSetCommand)=='function' then pcall(BackstageForeverSetCommand,message)end
                return
            end
            if word=='ask' then
                if type(BackstageForeverAskCommand)=='function' then pcall(BackstageForeverAskCommand,message)end
                return
            end
            if word=='moments' then
                if type(BackstageForeverMomentsCommand)=='function' then pcall(BackstageForeverMomentsCommand,message)end
                return
            end
            if word=='stats' then
                if type(BackstageForeverStatsCommand)=='function' then pcall(BackstageForeverStatsCommand)end
                return
            end
            if word=='party' then
                if type(BackstageForeverPartyCommand)=='function' then pcall(BackstageForeverPartyCommand,message)end
                return
            end
            if word=='qol' then
                if type(BackstageForeverQoLCommand)=='function' then pcall(BackstageForeverQoLCommand,message)end
                return
            end
            if word=='enemy' then
                if type(BackstageForeverEnemyCommand)=='function' then pcall(BackstageForeverEnemyCommand,message)end
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

-- The guild events window (/bf event, /bf event add). Thin: every rule lives in
-- BackstageForeverEvents.lua and is reached through BackstageForeverEventsApi. Two panes in one
-- painted frame: the list with one event and its sign-ups, and the form for a new or changed event.
-- Fixed widths everywhere and no word wrap on names, so long text is cut and never overlaps.
local T=BackstageForeverTr or function(text) return text end
local ART='Interface\\AddOns\\BackstageForever\\Art\\'
local WIDTH,HEIGHT=600,440
local LIST_X,LIST_TOP,LIST_ROW,LIST_ROWS,LIST_WIDTH=28,-48,34,9,232
local PANE_X,PANE_WIDTH=276,296
local GROUPS={{'t','Tanks'},{'h','Healers'},{'d','Damage'},{'m','Maybe'},{'n','Not coming'}}
local ANSWERS={{'t','Tank',96,0,0},{'h','Healer',96,100,0},{'d','Damage',96,200,0},{'m','Maybe',146,0,-24},{'n','No',146,150,-24}}
local ANSWER_WORD={t='You signed up as tank.',h='You signed up as healer.',d='You signed up as damage.',m='You answered maybe.',n='You answered no.'}
local window,listPane,formPane
local rows,groups,answerButtons={},{},{}
local selected,form=nil,nil
local function api() return type(BackstageForeverEventsApi)=='table' and BackstageForeverEventsApi or nil end
local function busy() return type(InCombatLockdown)=='function' and InCombatLockdown()~=false end
local function say(text)
    if DEFAULT_CHAT_FRAME and type(DEFAULT_CHAT_FRAME.AddMessage)=='function' then
        DEFAULT_CHAT_FRAME:AddMessage('Backstage Forever: '..(BackstageForeverTr or tostring)(text))
    end
end
local function text(parent,font,x,y,width,height)
    local s=parent:CreateFontString(nil,'OVERLAY',font)
    s:SetPoint('TOPLEFT',x,y);s:SetJustifyH('LEFT')
    if height then s:SetSize(width,height);s:SetJustifyV('TOP');s:SetWordWrap(true) else s:SetWidth(width);s:SetWordWrap(false) end
    return s
end
local function button(parent,label,width,x,y,click)
    local b=CreateFrame('Button',nil,parent,'UIPanelButtonTemplate')
    b:SetSize(width,22);b:SetPoint('TOPLEFT',x,y);b:SetText(T(label));b:SetScript('OnClick',click)
    return b
end
local function current()
    local a=api()
    local list=a and a.list() or {}
    local chosen
    for _,e in ipairs(list) do if e.id==selected then chosen=e end end
    if not chosen then chosen=list[1];selected=chosen and chosen.id or nil end
    return list,chosen
end
local function showList()
    local a=api()
    if not a or not window then return end
    local list,e=current()
    for i,row in ipairs(rows) do
        local item=list[i]
        if item then
            row.event=item.id
            row.title:SetText(item.title);row.when:SetText(a.when(item.at))
            if item.id==selected then row.mark:Show() else row.mark:Hide() end
            row:Show()
        else row.event=nil;row:Hide() end
    end
    listPane.empty:SetText(#list==0 and T('No guild events ahead. Propose one with New event.') or '')
    listPane.more:SetText(#list>LIST_ROWS and ('+'..(#list-LIST_ROWS)) or '')
    if not e then
        for _,s in ipairs({listPane.name,listPane.when,listPane.where,listPane.note,listPane.mine}) do s:SetText('') end
        for _,g in ipairs(groups) do g.head:SetText('');g.names:SetText('') end
        for _,b in ipairs(answerButtons) do b:Hide() end
        listPane.change:Hide();listPane.off:Hide()
        return
    end
    listPane.name:SetText(e.title)
    listPane.when:SetText(a.when(e.at))
    listPane.where:SetText(a.place(e.dungeon)..'  ·  '..T('by')..' '..e.creator)
    listPane.note:SetText(e.note or '')
    local counts=a.counts(e)
    local wanted={t=e.roles.t,h=e.roles.h,d=e.roles.d}
    for i,g in ipairs(groups) do
        local key=GROUPS[i][1]
        local names=a.names(e,key)
        g.head:SetText(T(GROUPS[i][2])..' '..counts[key]..(wanted[key] and (' '..T('of')..' '..wanted[key]) or ''))
        g.names:SetText(names)
    end
    local mine=a.mine(e)
    listPane.mine:SetText(T(mine and ANSWER_WORD[mine] or 'You have not answered yet.'))
    for _,b in ipairs(answerButtons) do
        b:Show()
        if b.status==mine then b:LockHighlight() else b:UnlockHighlight() end
    end
    if a.mayEdit(e) then listPane.change:Show();listPane.off:Show() else listPane.change:Hide();listPane.off:Hide() end
end
local function showForm()
    local a=api()
    if not a or not form then return end
    local places=a.places()
    formPane.place:SetText(places[form.place] and places[form.place].name or '')
    formPane.day:SetText(a.dayText(form.day))
    formPane.time:SetText(('%02d:%02d'):format(form.hour,form.min))
    formPane.tanks:SetText(tostring(form.t));formPane.healers:SetText(tostring(form.h));formPane.damage:SetText(tostring(form.d))
    formPane.head:SetText(T(form.id and 'Change the event' or 'New guild event'))
end
local function mode(which)
    if which=='form' then listPane:Hide();formPane:Show();showForm() else formPane:Hide();listPane:Show();showList() end
end
local function clamp(v,lo,hi) if v<lo then return lo end if v>hi then return hi end return v end
local function openForm(e)
    local a=api()
    if not a then return end
    local places=a.places()
    form={place=1,t=1,h=1,d=3,hour=20,min=0}
    local today=a.today()
    form.day=today and {year=today.year,month=today.month,day=today.day} or {year=2026,month=1,day=1}
    local title,note='',''
    if e then
        form.id=e.id;form.t,form.h,form.d=e.roles.t,e.roles.h,e.roles.d
        title,note=e.title,e.note or ''
        for i,p in ipairs(places) do if p.id==e.dungeon then form.place=i end end
        local p=a.partsOf(e.at)
        if p then form.day={year=p.year,month=p.month,day=p.day};form.hour,form.min=p.hour,p.min-p.min%15 end
    end
    formPane.title:SetText(title);formPane.note:SetText(note);formPane.message:SetText('')
    mode('form')
end
local function save()
    local a=api()
    if not a or not form then return end
    if busy() then formPane.message:SetText(T('Save the event outside combat.')) return end
    local at,why=a.epoch(form.day,form.hour,form.min)
    if not at then
        formPane.message:SetText(T(why=='gap' and 'That time does not exist on that day: the clocks change. Pick another time.' or 'Pick a day and a time.'))
        return
    end
    local places=a.places()
    local fields={title=formPane.title:GetText(),note=formPane.note:GetText(),at=at,dungeon=places[form.place] and places[form.place].id or 'other',roles={t=form.t,h=form.h,d=form.d}}
    local e,problem
    if form.id then e,problem=a.change(form.id,fields) else e,problem=a.create(fields) end
    if not e then formPane.message:SetText(T(problem or 'That did not work.')) return end
    if why=='twice' then say('That hour happens twice that night because the clocks change. The first one is used.') end
    selected=e.id;form=nil
    mode('list')
end
local function stepper(parent,label,y,minus,plus,valueWidth,step)
    text(parent,'GameFontNormal',40,y-4,120):SetText(T(label))
    button(parent,'<',26,170,y,minus)
    local value=text(parent,'GameFontHighlight',202,y-4,valueWidth)
    value:SetJustifyH('CENTER')
    button(parent,'>',26,208+valueWidth,y,plus)
    return value
end
local function build()
    if window or type(CreateFrame)~='function' or not UIParent then return window end
    local f=CreateFrame('Frame','BackstageForeverEvents',UIParent)
    f:Hide();f:SetSize(WIDTH,HEIGHT);f:SetPoint('CENTER',0,10)
    if type(BackstageForeverApplyTextSize)=='function' then pcall(BackstageForeverApplyTextSize,f) end
    f:SetFrameStrata('DIALOG');f:SetClampedToScreen(true);f:EnableMouse(true);f:SetMovable(true)
    f:RegisterForDrag('LeftButton');f:SetScript('OnDragStart',f.StartMoving);f:SetScript('OnDragStop',f.StopMovingOrSizing)
    if type(BackstageForeverPaintNineSlice)=='function' then pcall(BackstageForeverPaintNineSlice,f,'compass',40,14)
    else local bg=f:CreateTexture(nil,'BACKGROUND');bg:SetAllPoints();bg:SetColorTexture(.07,.065,.055,.98) end
    local crest=f:CreateTexture(nil,'ARTWORK');crest:SetTexture(ART..'Frames\\compass-crest')
    crest:SetSize(96,48);crest:SetPoint('BOTTOM',f,'TOP',0,-16)
    local title=f:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    title:SetPoint('TOP',0,-16);title:SetText(T('Guild events'))
    local close=CreateFrame('Button',nil,f,'UIPanelCloseButton')
    close:SetSize(24,24);close:SetPoint('TOPRIGHT',-4,-4);close:SetScript('OnClick',function() f:Hide() end)

    -- The list and the chosen event.
    listPane=CreateFrame('Frame',nil,f);listPane:SetAllPoints()
    for i=1,LIST_ROWS do
        local row=CreateFrame('Button',nil,listPane)
        row:SetSize(LIST_WIDTH,LIST_ROW-2);row:SetPoint('TOPLEFT',LIST_X,LIST_TOP-(i-1)*LIST_ROW)
        row.mark=row:CreateTexture(nil,'BACKGROUND');row.mark:SetAllPoints();row.mark:SetColorTexture(.79,.62,.27,.28)
        local hover=row:CreateTexture(nil,'HIGHLIGHT');hover:SetAllPoints();hover:SetColorTexture(1,1,1,.08)
        row.title=row:CreateFontString(nil,'OVERLAY','GameFontHighlight')
        row.title:SetPoint('TOPLEFT',4,-2);row.title:SetWidth(LIST_WIDTH-8);row.title:SetJustifyH('LEFT');row.title:SetWordWrap(false)
        row.when=row:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
        row.when:SetPoint('TOPLEFT',4,-17);row.when:SetWidth(LIST_WIDTH-8);row.when:SetJustifyH('LEFT');row.when:SetWordWrap(false)
        row:SetScript('OnClick',function(self) if self.event then selected=self.event;showList() end end)
        rows[i]=row
    end
    listPane.empty=text(listPane,'GameFontDisable',LIST_X+4,LIST_TOP-4,LIST_WIDTH-8,40)
    listPane.more=text(listPane,'GameFontDisableSmall',LIST_X+4,LIST_TOP-LIST_ROWS*LIST_ROW,60)
    local divider=listPane:CreateTexture(nil,'OVERLAY');divider:SetColorTexture(.79,.62,.27,.5)
    divider:SetSize(1,HEIGHT-124);divider:SetPoint('TOPLEFT',266,-46)
    listPane.name=text(listPane,'GameFontNormalLarge',PANE_X,-48,PANE_WIDTH)
    listPane.when=text(listPane,'GameFontHighlightSmall',PANE_X,-70,PANE_WIDTH)
    listPane.where=text(listPane,'GameFontHighlightSmall',PANE_X,-85,PANE_WIDTH)
    listPane.note=text(listPane,'GameFontNormalSmall',PANE_X,-102,PANE_WIDTH,26)
    local rule=listPane:CreateTexture(nil,'OVERLAY');rule:SetColorTexture(.79,.62,.27,.5)
    rule:SetSize(PANE_WIDTH,1);rule:SetPoint('TOPLEFT',PANE_X,-132)
    for i=1,#GROUPS do
        local y=-138-(i-1)*29
        groups[i]={head=text(listPane,'GameFontNormalSmall',PANE_X,y,PANE_WIDTH),names=text(listPane,'GameFontHighlightSmall',PANE_X,y-13,PANE_WIDTH)}
    end
    listPane.mine=text(listPane,'GameFontNormal',PANE_X,-288,PANE_WIDTH)
    for i,spec in ipairs(ANSWERS) do
        local b=button(listPane,spec[2],spec[3],PANE_X+spec[4],-308+spec[5],function(self)
            if busy() then say('Answer outside combat.') return end
            local a=api()
            if a and selected and not a.answer(selected,self.status) then say(a.reason('gone')) end
        end)
        b.status=spec[1]
        answerButtons[i]=b
    end
    local rule2=listPane:CreateTexture(nil,'OVERLAY');rule2:SetColorTexture(.79,.62,.27,.5)
    rule2:SetSize(WIDTH-56,1);rule2:SetPoint('BOTTOMLEFT',28,74)
    local foot=listPane:CreateFontString(nil,'OVERLAY','GameFontDisableSmall')
    foot:SetPoint('BOTTOMLEFT',28,54);foot:SetWidth(WIDTH-56);foot:SetJustifyH('LEFT');foot:SetWordWrap(false)
    foot:SetText(T('Times are your computer\'s time. Realm time uses the realm clock as it is now.'))
    local add=CreateFrame('Button',nil,listPane,'UIPanelButtonTemplate')
    add:SetSize(130,22);add:SetPoint('BOTTOMLEFT',28,26);add:SetText(T('New event'))
    add:SetScript('OnClick',function() if busy() then say('Open the form outside combat.') return end openForm(nil) end)
    listPane.change=CreateFrame('Button',nil,listPane,'UIPanelButtonTemplate')
    listPane.change:SetSize(130,22);listPane.change:SetPoint('BOTTOMLEFT',PANE_X,26);listPane.change:SetText(T('Change'))
    listPane.change:SetScript('OnClick',function() local _,e=current();if e and not busy() then openForm(e) end end)
    listPane.off=CreateFrame('Button',nil,listPane,'UIPanelButtonTemplate')
    listPane.off:SetSize(130,22);listPane.off:SetPoint('BOTTOMLEFT',PANE_X+140,26);listPane.off:SetText(T('Call off'))
    listPane.off:SetScript('OnClick',function()
        local a=api()
        local _,e=current()
        if not a or not e or busy() then return end
        local done,why=a.change(e.id,{cancelled=true})
        if not done then say(why) else say(('Guild event called off: %s.'):format(e.title)) end
    end)

    -- The form.
    formPane=CreateFrame('Frame',nil,f);formPane:SetAllPoints();formPane:Hide()
    formPane.head=text(formPane,'GameFontNormal',40,-48,400)
    text(formPane,'GameFontNormal',40,-80,120):SetText(T('Title'))
    formPane.title=CreateFrame('EditBox',nil,formPane,'InputBoxTemplate')
    formPane.title:SetSize(330,20);formPane.title:SetPoint('TOPLEFT',176,-76);formPane.title:SetAutoFocus(false);formPane.title:SetMaxLetters(40)
    formPane.title:SetScript('OnEscapePressed',function(self) self:ClearFocus() end)
    formPane.title:SetScript('OnEnterPressed',function(self) self:ClearFocus() end)
    formPane.place=stepper(formPane,'Dungeon or raid',-110,function() local n=#api().places();form.place=(form.place-2)%n+1;showForm() end,
        function() local n=#api().places();form.place=form.place%n+1;showForm() end,270)
    formPane.day=stepper(formPane,'Day',-140,function() form.day=api().dayStep(form.day,-1) or form.day;showForm() end,
        function() form.day=api().dayStep(form.day,1) or form.day;showForm() end,270)
    text(formPane,'GameFontNormal',40,-174,120):SetText(T('Time'))
    button(formPane,'-1 h',54,170,-170,function() form.hour=(form.hour-1)%24;showForm() end)
    button(formPane,'+1 h',54,226,-170,function() form.hour=(form.hour+1)%24;showForm() end)
    formPane.time=text(formPane,'GameFontHighlightLarge',290,-172,70);formPane.time:SetJustifyH('CENTER')
    button(formPane,'-15',54,368,-170,function() form.min=(form.min-15)%60;showForm() end)
    button(formPane,'+15',54,424,-170,function() form.min=(form.min+15)%60;showForm() end)
    text(formPane,'GameFontDisableSmall',176,-194,330):SetText(T('Your computer\'s time.'))
    formPane.tanks=stepper(formPane,'Tanks wanted',-214,function() form.t=clamp(form.t-1,0,9);showForm() end,function() form.t=clamp(form.t+1,0,9);showForm() end,40)
    formPane.healers=stepper(formPane,'Healers wanted',-242,function() form.h=clamp(form.h-1,0,9);showForm() end,function() form.h=clamp(form.h+1,0,9);showForm() end,40)
    formPane.damage=stepper(formPane,'Damage wanted',-270,function() form.d=clamp(form.d-1,0,40);showForm() end,function() form.d=clamp(form.d+1,0,40);showForm() end,40)
    text(formPane,'GameFontNormal',40,-304,120):SetText(T('Note'))
    formPane.note=CreateFrame('EditBox',nil,formPane,'InputBoxTemplate')
    formPane.note:SetSize(330,20);formPane.note:SetPoint('TOPLEFT',176,-300);formPane.note:SetAutoFocus(false);formPane.note:SetMaxLetters(80)
    formPane.note:SetScript('OnEscapePressed',function(self) self:ClearFocus() end)
    formPane.note:SetScript('OnEnterPressed',function(self) self:ClearFocus() end)
    formPane.message=text(formPane,'GameFontRedSmall',40,-332,WIDTH-80,28)
    text(formPane,'GameFontDisableSmall',40,-364,WIDTH-80,26):SetText(T('Plain words only: no links. The event goes to guild members who run Backstage Forever and switched guild events on.'))
    local keep=CreateFrame('Button',nil,formPane,'UIPanelButtonTemplate')
    keep:SetSize(130,22);keep:SetPoint('BOTTOMLEFT',40,26);keep:SetText(T('Save and share'));keep:SetScript('OnClick',save)
    local back=CreateFrame('Button',nil,formPane,'UIPanelButtonTemplate')
    back:SetSize(130,22);back:SetPoint('BOTTOMLEFT',180,26);back:SetText(T('Back'));back:SetScript('OnClick',function() form=nil;mode('list') end)

    f:RegisterEvent('PLAYER_REGEN_DISABLED')
    if type(BackstageForeverPerfFrame)=='function' then pcall(BackstageForeverPerfFrame,'EventsWindow',f) end
    f:SetScript('OnEvent',function() f:Hide() end)
    if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'BackstageForeverEvents') end
    window=f
    return f
end
-- Called when an event or a sign-up changed while the window is open.
function BackstageForeverEventsWindowRefresh()
    if window and window:IsShown() and listPane:IsShown() then showList() end
end
-- /bf event (toggles the list) and /bf event add (opens the form). -> true when it handled the call.
function BackstageForeverEventsWindowOpen(what)
    if not api() or busy() then return false end
    if window and window:IsShown() and what~='add' then window:Hide() return true end
    local ok,f=pcall(build)
    if not ok or not f then return false end
    f:Show()
    if what=='add' then openForm(nil) else mode('list') end
    return true
end

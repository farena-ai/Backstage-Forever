-- Run from the repository root through tests/lua-stdin.cjs or a standalone Lua VM.
local locked=false
function InCombatLockdown() return locked end
PaperDollFrame={}
CharacterFrame={}

local menu,events
local textures=0
local canPaint=true
local function widget()
    local w={}
    function w:SetPoint(...) self.point={...} end
    function w:SetSize(...) self.size={...} end
    function w:SetScript(name,fn) self[name]=fn end
    function w:SetText(text) self.text=text end
    function w:SetBackdrop(backdrop) self.backdrop=backdrop end
    function w:Show() self.shown=true end
    function w:Hide() self.shown=false end
    for _,name in ipairs({'RegisterEvent','SetFrameStrata','SetWidth','SetJustifyH','ClearAllPoints','Enable','Disable'}) do
        w[name]=function() end
    end
    return w
end
function CreateFrame(kind,name)
    local w=widget()
    if kind=='Frame' and not name then events=w end
    if name=='BackstageForeverSetMenu' then
        menu=w
        function w:CreateFontString(_,layer)
            local label=widget();label.layer=layer;return label
        end
        if canPaint then
            function w:CreateTexture(_,layer)
                assert(not locked,'must not create art during combat')
                textures=textures+1
                local art=widget()
                function art:SetTexture(path) self.path=path end
                function art:SetVertexColor(r,g,b) self.tint={r,g,b} end
                art.layer=layer
                self.art=art
                return art
            end
        end
    end
    return w
end

for _,painting in ipairs({true,false}) do
    canPaint=painting
    menu=nil
    dofile('addon/BackstageForever/BackstageForeverSheet.lua')
    events:OnEvent('PLAYER_LOGIN')
    locked=true
    BackstageForeverSetMenuShow()
    assert(menu==nil,'the menu still refuses to open in combat')
    locked=false
    BackstageForeverSetMenuShow()
    assert(menu and menu.shown and menu.backdrop,'the menu opens with its original backdrop')
    assert(menu.size[1]==212 and menu.size[2]==46,'empty menu footprint is unchanged')
    assert(menu.hint.text=='No sets yet. Wear the gear, then type /bf set save NAME.','empty hint is unchanged')
    if painting then
        local art=assert(menu.art,'the gear sets menu has painted footer art')
        assert(art.path=='Interface\\AddOns\\BackstageForever\\Art\\Messages\\gear','uses the bundled gear painting')
        assert(art.layer=='BACKGROUND' and menu.hint.layer=='OVERLAY','art is behind the text')
        assert(art.tint and math.max(art.tint[1],art.tint[2],art.tint[3])<=.42,'keeps the pale hint readable over highlights')
        assert(art.point[1]=='BOTTOM' and art.point[2]==menu and art.point[3]=='BOTTOM','anchors within the footer')
        assert(art.point[5]>=0 and art.point[5]+art.size[2]<=46 and art.size[1]<=212,'does not extend the footprint')
        assert(art.size[1]==8*art.size[2],'reuses the painting without stretching it')
    else
        assert(not menu.art,'the original backdrop works without texture support')
    end
    local firstArt=menu.art
    BackstageForeverSheetDB={sets={leveling={name='Leveling',slots={}}}}
    BackstageForeverSetMenuShow()
    assert(menu.art==firstArt and menu.size[2]==68,'art stays fixed to the footer as rows are added')
    assert(menu.rows[1].text=='Leveling (worn)' and menu.hint.text=='Save the gear you wear: /bf set save NAME.')
    locked=true;events:OnEvent('PLAYER_REGEN_DISABLED')
    assert(not menu.shown,'menu still hides on combat entry')
    locked=false
    BackstageForeverSheetDB=nil
end
assert(textures==1,'paint once only; no new art on refresh or combat transitions')
print('Gear Sets art fixture passed')

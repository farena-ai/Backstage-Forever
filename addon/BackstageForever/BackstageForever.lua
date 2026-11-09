-- Experimental: validate all API behavior in the intended client before use.
local panel
local function showExport()
    if InCombatLockdown() then
        print("Backstage Forever: leave combat before opening the copy panel.")
        return
    end
    if not panel then
        panel = CreateFrame("Frame", "BackstageForeverCopyPanel", UIParent)
        panel:SetSize(520, 260)
        panel:SetPoint("CENTER")
        panel:SetFrameStrata("DIALOG")
        local background = panel:CreateTexture(nil, "BACKGROUND")
        background:SetAllPoints()
        background:SetColorTexture(0.04, 0.06, 0.09, 0.98)
        local title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        title:SetPoint("TOP", 0, -16)
        title:SetText("Backstage Forever - experimental manual copy")
        local help = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        help:SetPoint("TOP", 0, -40)
        help:SetText("Ctrl+C to copy. Enter these details manually in the desktop app.")
        local box = CreateFrame("EditBox", nil, panel)
        box:SetMultiLine(true)
        box:SetFontObject("ChatFontNormal")
        box:SetSize(480, 135)
        box:SetPoint("TOP", 0, -65)
        box:SetAutoFocus(false)
        box:SetScript("OnEscapePressed", function() panel:Hide() end)
        panel.box = box
        local close = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
        close:SetSize(100, 24)
        close:SetPoint("BOTTOM", 0, 14)
        close:SetText("Close")
        close:SetScript("OnClick", function() panel:Hide() end)
        panel:RegisterEvent("PLAYER_REGEN_DISABLED")
        panel:SetScript("OnEvent", function() panel:Hide() end)
    end
    local version, build, date, interface = GetBuildInfo()
    local _, className = UnitClass("player")
    local text = string.format("Experimental manual record\nName: %s\nRealm: %s\nClass: %s\nLevel: %s\nClient: %s (%s)\nInterface: %s",
        UnitName("player") or "", GetRealmName() or "", className or "",
        tostring(UnitLevel("player") or ""), tostring(version), tostring(build), tostring(interface))
    panel.box:SetText(text)
    panel:Show()
    panel.box:SetFocus()
    panel.box:HighlightText()
end
SLASH_BACKSTAGEFOREVER1 = "/backstageforever"
SlashCmdList["BACKSTAGEFOREVER"] = showExport

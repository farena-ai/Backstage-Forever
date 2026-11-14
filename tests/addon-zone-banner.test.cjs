"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
// A small game: frames record what the banner does, the event frame's handler is kept so tests can
// fire ZONE_CHANGED_NEW_AREA, and the map follows `here`.
const WORLD = String.raw`
local fighting=false
InCombatLockdown=function() return fighting end
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local named,handlers,t={},{},100
GetTime=function() return t end
local function region(kind)
  local o={kind=kind,shown=true,points={},textures={},fonts={},width=0,height=0,texture=false,coord=false,color=false,text=false,size=0,OnEvent=false,OnUpdate=false}
  function o:SetTexture(p) self.texture=p end
  function o:SetTexCoord(...) self.coord={...} end
  function o:SetColorTexture(...) self.color={...} end
  function o:SetText(s) self.text=s end
  function o:GetStringWidth() return #(self.text or '')*7 end
  function o:GetFont() return 'Fonts\\FRIZQT__.TTF',20,'' end
  function o:SetFont(_,size,flags) self.size=size self.flags=flags end
  function o:SetWidth(w) self.width=w end
  function o:SetHeight(h) self.height=h end
  function o:SetSize(w,h) self.width,self.height=w,h end
  function o:SetPoint(...) self.points[#self.points+1]={...} end
  function o:Show() self.shown=true end
  function o:Hide() self.shown=false end
  function o:SetScript(k,fn) self[k]=fn end
  function o:CreateTexture(_,layer) local r=region('texture') r.layer=layer self.textures[#self.textures+1]=r return r end
  function o:CreateFontString(_,layer,tmpl) local r=region('font') r.layer=layer r.template=tmpl self.fonts[#self.fonts+1]=r return r end
  local any=function() end
  setmetatable(o,{__index=function() return any end})
  return o
end
CreateFrame=function(kind,name) local f=region('frame') if name then named[name]=f end handlers[#handlers+1]=f return f end
UIParent=region('frame')
local here=1411
C_Map={GetBestMapForUnit=function() return here end,GetPlayerMapPosition=function() return nil end,
  GetMapInfo=function(id) return ({[1411]={name='Durotar'},[1413]={name='The Barrens'},[1454]={name='Orgrimmar'},[1450]={name='Moonglade'},[9999]={name='Somewhere New'}})[id] end}
C_QuestLog={GetNumQuestLogEntries=function() return 0 end,GetAllCompletedQuestIDs=function() return {} end}
UnitLevel=function() return 14 end UnitFactionGroup=function() return 'Horde' end UnitClass=function() return 'Hunter' end
BackstageForeverAdvisorData={zones={{m=1411,lo=1,hi=10},{m=1413,lo=10,hi=25}}}
local quests={[1413]=6}
BackstageForeverAdvisorPoints=function(mapId) local r={} for i=1,(quests[mapId] or 0) do r[i]={} end return r end
dofile('addon/BackstageForever/BackstageForeverRoute.lua')
local function fire(event) for _,f in ipairs(handlers) do if f.OnEvent then f.OnEvent(f,event) end end end
local function go(id) here=id fire('ZONE_CHANGED_NEW_AREA') end
local function parts()
  local b=named.BackstageForeverZoneBanner
  if not b then return nil end
  local art,ribbon
  for _,tx in ipairs(b.textures) do if tx.layer=='BACKGROUND' then art=tx elseif tx.layer=='BORDER' then ribbon=tx end end
  return b,art,b.fonts[1],b.fonts[2],ribbon
end
fire('PLAYER_LOGIN')
`;

test("zone banner: the zone's own painting, level and quest line on a ribbon sized to the text, one chat line", () => lua(WORLD + String.raw`
go(1413)
local b,art,name,sub,ribbon=parts()
assert(b,'a dedicated banner frame')
assert(b.width==560 and b.height==74,'560x74')
assert(b.points[1][1]=='TOP' and b.points[1][5]==-150,'same place as the toast')
assert(b.shown,'shown')
assert(art.texture=='Interface\\AddOns\\BackstageForever\\Art\\Zones\\1413',tostring(art.texture))
assert(art.coord[1]==.027 and art.coord[2]==.973 and art.coord[3]==0 and art.coord[4]==1,'8:1 painting cropped, not stretched')
assert(not art.color,'the painting is not see-through black')
assert(name.text=='The Barrens' and name.template=='GameFontNormalHuge' and name.size>=26,'big gold name')
assert(sub.text=='Levels 10–25 · 6 quests for your level',sub.text)
assert(ribbon.shown and ribbon.color[1]==.16 and ribbon.color[4]==.92,'dark ribbon')
assert(ribbon.width==#sub.text*7+52,'ribbon follows the text: '..tostring(ribbon.width))
local edges=0 for _,tx in ipairs(b.textures) do if tx.layer=='ARTWORK' and tx.color and tx.color[1]==.78 then edges=edges+1 end end
assert(edges==4,'gold edges: '..edges)
assert(#said==1 and said[1]=='Backstage Forever: The Barrens Levels 10–25 · 6 quests for your level',said[1])
assert(BackstageForeverToast==nil,'the shared toast is not used for arrivals')
-- A longer line gets a wider ribbon; the fade runs and hides the banner by itself.
go(1411)
assert(art.texture:sub(-4)=='1411' and sub.text=='Levels 1–10' and ribbon.width==#'Levels 1–10'*7+52,tostring(ribbon.width))
b.OnUpdate(b) assert(b.shown) t=t+7 b.OnUpdate(b) assert(not b.shown,'fades out')
`));

test("zone banner: unknown maps use the default painting; capitals say so; Moonglade shows just its name", () => lua(WORLD + String.raw`
go(9999)
local b,art,name,sub,ribbon=parts()
assert(art.texture=='Interface\\AddOns\\BackstageForever\\Art\\Zones\\default',art.texture)
assert(name.text=='Somewhere New' and sub.text=='' and not ribbon.shown,'no line, no ribbon')
go(1454)
assert(art.texture:sub(-4)=='1454' and name.text=='Orgrimmar' and sub.text=='Capital city' and ribbon.shown,sub.text)
go(1450)
assert(art.texture:sub(-4)=='1450' and name.text=='Moonglade' and sub.text=='' and not ribbon.shown)
assert(said[#said]=='Backstage Forever: Moonglade')
assert(BackstageForeverZoneLine(1450,nil,2)=='2 quests for your level' and BackstageForeverZoneLine(1450,nil,1)=='1 quest for your level')
assert(BackstageForeverZoneLine(1455,nil,3)=='Capital city · 3 quests for your level')
local ids=BackstageForeverZonePaintings() assert(#ids==46,'46 paintings')
local seen={} for _,id in ipairs(ids) do assert(not seen[id]) seen[id]=true assert(BackstageForeverZoneArt(id):sub(-4)==tostring(id)) end
`));

test("zone banner: quiet in combat, off with /bf route arrivals switched off, skipped for the first zone after login", () => lua(WORLD + String.raw`
assert(named.BackstageForeverZoneBanner==nil and #said==0,'the first zone after login is skipped')
fighting=true go(1413)
assert(named.BackstageForeverZoneBanner==nil and #said==0,'nothing in combat')
fighting=false
BackstageForeverRouteSettings.arrivals=false go(1411)
assert(named.BackstageForeverZoneBanner==nil and #said==0,'nothing when arrivals are off')
BackstageForeverRouteSettings.arrivals=true go(1413)
assert(named.BackstageForeverZoneBanner and named.BackstageForeverZoneBanner.shown)
go(1413) assert(#said==1,'same zone again: nothing')
-- Pop-ups switched off (/bf toasts): only the chat line.
named.BackstageForeverZoneBanner:Hide()
BackstageForeverAssistSettings={toasts=false} go(1411)
assert(#said==2 and not named.BackstageForeverZoneBanner.shown,'chat only')
`));

test("zone banner uses textures and fonts only: no protected calls, no combat log, no waypoints", () => {
  const src = require("node:fs").readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverRoute.lua"), "utf8");
  const start = src.indexOf("-- G2/G13"), end = src.indexOf("local lastZone", start);
  const block = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(block, /COMBAT_LOG|SetUserWaypoint|SecureActionButton|RegisterEvent|CastSpell|UseAction|TargetUnit/);
});

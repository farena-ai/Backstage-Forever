"use strict";
// G14 (0.39): every in-game message box is painted, like the zone banners.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const WORLD = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local named,t={},100
GetTime=function() return t end
InCombatLockdown=function() return false end
local function region(kind)
  local o={kind=kind,shown=true,points={},textures={},fonts={},width=0,height=0,texture=false,coord=false,color=false,text=false,size=0}
  function o:SetTexture(p) self.texture=p end
  function o:SetTexCoord(...) self.coord={...} end
  function o:SetColorTexture(...) self.color={...} end
  function o:SetText(s) self.text=s end
  function o:GetStringWidth() return #(self.text or '')*7 end
  function o:GetStringHeight() local w=self.width>0 and self.width or 500 return 14*math.max(1,math.ceil(#(self.text or '')*7/w)) end
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
CreateFrame=function(kind,name) local f=region('frame') if name then named[name]=f end return f end
UIParent=region('frame')
dofile('addon/BackstageForever/BackstageForeverAssist.lua')
local function parts()
  local b=named.BackstageForeverToast
  local bg,art,ribbon,edges=nil,nil,nil,0
  for _,tx in ipairs(b.textures) do
    if tx.layer=='BACKGROUND' then bg=tx elseif tx.layer=='BORDER' then art=tx
    elseif tx.layer=='ARTWORK' and tx.color and tx.color[1]==.16 then ribbon=tx
    elseif tx.layer=='ARTWORK' and tx.color and tx.color[1]==.78 then edges=edges+1 end
  end
  return b,bg,art,ribbon,edges,b.fonts[1],b.fonts[2]
end
`;

test("message box: its own painting, gold title, ribbon round the text, solid and framed", () => lua(WORLD + String.raw`
BackstageForeverToast('Flight master nearby: Thor','Talk to them to learn this flight path.',nil,'flight')
local b,bg,art,ribbon,edges,title,sub=parts()
assert(b.shown and b.width==560,'560 wide: '..b.width)
assert(b.points[1][1]=='TOP' and b.points[1][5]==-150,'same place as before')
assert(bg.color[4]==1,'solid, not see-through: '..tostring(bg.color[4]))
assert(art.texture=='Interface\\AddOns\\BackstageForever\\Art\\Messages\\flight',tostring(art.texture))
assert(edges==4,'gold frame: '..edges)
assert(ribbon.shown,'ribbon under the line')
assert(title.text=='Flight master nearby: Thor' and title.size==26,'gold title')
assert(sub.text=='Talk to them to learn this flight path.' and sub.width==#sub.text*7,'ribbon hugs the text: '..sub.width)
assert(b.height==BackstageForeverMessageHeight(false,14),'one line: '..b.height)
local u0,u1,v0,v1=table.unpack(art.coord)
assert(v0==0 and v1==1 and math.abs((u1-u0)-(560/b.height)/8)<1e-9,'cropped to the box, not stretched')
assert(said[#said]=='Backstage Forever: Flight master nearby: Thor Talk to them to learn this flight path.')
-- A long line wraps: the box grows and the painting is cropped narrower to keep its shape.
local long=('Release, then run back to your body. '):rep(4)
BackstageForeverToast('You died',long,nil,'death')
assert(art.texture:sub(-5)=='death' and sub.width==490,'wraps at the box width: '..sub.width)
assert(b.height==BackstageForeverMessageHeight(false,42),'three lines: '..b.height)
-- No line, no ribbon; unknown kinds use the ready painting.
BackstageForeverToast('Elite defeated',nil,nil,'nope')
assert(not ribbon.shown and art.texture:sub(-5)=='ready' and b.height==54)
-- Level up: the big banner.
BackstageForeverToast('Level 12!','New spells at your trainer.',true,'levelup')
assert(b.width==760 and title.size==40 and art.texture:sub(-7)=='levelup')
b.OnUpdate(b) assert(b.shown) t=t+10 b.OnUpdate(b) assert(not b.shown,'fades out')
-- Pop-ups off: chat only.
BackstageForeverAssistSettings.toasts=false
`));

test("message crop keeps the 8:1 painting's shape for any box", () => lua(WORLD + String.raw`
local u0,u1,v0,v1=BackstageForeverMessageCrop(800,100) assert(u0==0 and u1==1 and v0==0 and v1==1)
u0,u1,v0,v1=BackstageForeverMessageCrop(400,100) assert(u0==.25 and u1==.75 and v0==0 and v1==1)
u0,u1,v0,v1=BackstageForeverMessageCrop(1600,100) assert(u0==0 and u1==1 and v0==.25 and v1==.75)
u0,u1,v0,v1=BackstageForeverMessageCrop(0,0) assert(u0==0 and u1==1)
`));

test("every message kind has its painting in the addon, and every caller names one", () => {
  const kinds = lua(WORLD + "print(table.concat(BackstageForeverMessageKinds(),','))").split(",");
  assert.equal(kinds.length, 14);
  for (const k of kinds) {
    const file = path.join(root, "addon/BackstageForever/Art/Messages", k + ".tga");
    const buf = fs.readFileSync(file);
    assert.equal(buf[2], 2, k + ": uncompressed true-colour TGA");
    assert.equal(buf.readUInt16LE(12), 1024, k + " width"); assert.equal(buf.readUInt16LE(14), 128, k + " height");
  }
  const dir = path.join(root, "addon/BackstageForever");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".lua"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/BackstageForeverToast[(,]([^\n]*)/g)) {
      if (/^function|^=|==nil|=='function'/.test(m[0].slice(21)) || m[0].startsWith("BackstageForeverToast(title")) continue;
      if (/type\(BackstageForeverToast\)/.test(m[0])) continue;
      assert.match(m[1], /,'[a-z]+'\)|,"levelup"\)|,t\[3\]\)/, f + ": " + m[0]);
    }
  }
});

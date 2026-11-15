"use strict";
// 0.38 (A15) ask the companion from inside the game: the minimap button (painted, draggable around
// the edge, position saved per character); since 0.39.1 a click (or /bf ask) sends only the "open"
// signal and the question is typed in the app's panel over the game; /bf ask QUESTION still sends
// the question itself; never in combat (it waits, and /bf ask cancel drops it). Real live strip module.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const luaString = (text) => '"' + [...Buffer.from(text, "utf8")].map((b) => "\\" + b).join("") + '"';

const HARNESS = String.raw`
local handlers,named,ALL={},{},{}
local function obj(kind,name,parent)
  local o={kind=kind,name=name,parent=parent,scripts={},shown=true,text='',calls={}}
  setmetatable(o,{__index=function(t,k) if type(k)~='string' or not k:match('^%u') then return nil end return function(self,...) local c=rawget(t,'calls') c[k]=c[k] or {} table.insert(c[k],{...}) end end})
  function o:SetScript(k,fn) self.scripts[k]=fn end
  function o:Show() self.shown=true end
  function o:Hide() self.shown=false end
  function o:IsShown() return self.shown end
  function o:SetPoint(...) self.point={...} end
  function o:ClearAllPoints() self.point=nil end
  function o:SetText(t) self.text=t end
  function o:GetText() return self.text end
  function o:SetFocus() self.focused=true end
  function o:ClearFocus() self.focused=false end
  function o:SetTexture(p) self.texture=p end
  function o:SetMaxLetters(n) self.maxLetters=n end
  function o:CreateTexture(_,layer) local t=obj('Texture') t.layer=layer self.textures=rawget(self,'textures') or {} table.insert(self.textures,t) return t end
  function o:CreateFontString() return obj('FontString') end
  function o:RegisterEvent(e) handlers[e]=handlers[e] or {} table.insert(handlers[e],self) end
  if name then named[name]=o end
  ALL[#ALL+1]=o
  return o
end
CreateFrame=function(kind,name,parent) return obj(kind,name,parent) end
UIParent=obj('Frame','UIParent')
Minimap=obj('Minimap','Minimap')
function Minimap:GetWidth() return 140 end
function Minimap:GetCenter() return 500,400 end
function Minimap:GetEffectiveScale() return 2 end
CURSOR={1000,800}
GetCursorPosition=function() return CURSOR[1],CURSOR[2] end
GameTooltip=obj('GameTooltip','GameTooltip')
CLOCK=1000000
time=function() return CLOCK end
GetTime=function() return CLOCK end
COMBAT=false
InCombatLockdown=function() return COMBAT end
UnitGUID=function(u) if u=='player' then return 'Player-1-ABC' end end
GetPhysicalScreenSize=function() return 1920,1080 end
local chat={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) chat[#chat+1]=m end}
local function fire(e,...) for _,f in ipairs(handlers[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
dofile('addon/BackstageForever/BackstageForeverAsk.lua')
local sent={}
local realQuestion=BackstageForeverLiveQuestion
BackstageForeverLiveQuestion=function(t) sent[#sent+1]=t return realQuestion(t) end
fire('PLAYER_LOGIN')
local button=named.BackstageForeverAskButton
local function lastChat() return chat[#chat] or '' end
local OPEN='\1open'
`;

test("pure helpers: what the player typed becomes exactly what is sent", () => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverAsk.lua')
local C,N=BackstageForeverAskClean,BackstageForeverAskLength
assert(C('  Where   is\\tthe   inn?  ')=='Where is the inn?')
assert(C('How do I get |cff1eff00|Hitem:2589::::::::|h[Linen Cloth]|h|r fast?')=='How do I get [Linen Cloth] fast?',C('How do I get |cff1eff00|Hitem:2589::::::::|h[Linen Cloth]|h|r fast?'))
assert(C('a||b |TInterface\\\\Icons\\\\x:0|t ok')=='a|b ok')
assert(C('')==nil and C('   ')==nil and C(nil)==nil and C(42)==nil)
assert(N(string.rep('x',250))==250)
assert(#C(string.rep('x',250))==200,'200 characters')
local e=C(string.rep('\\226\\130\\172',250)) assert(N(e)==200 and #e==600,'200 euro signs = 600 bytes')
local cjk=C(string.rep('\\228\\184\\173',199)..'ab') assert(N(cjk)==200 and #cjk==598 and cjk:sub(-1)=='a')
local four=C(string.rep('\\240\\159\\152\\128',200)) assert(N(four)==150 and #four==600,'cut at 600 bytes, never mid-character')
assert(C('ok \\195')=='ok','a broken character is dropped')
local x,y=BackstageForeverAskButtonOffset(0,76) assert(x==76 and y==0)
x,y=BackstageForeverAskButtonOffset(90,76) assert(math.abs(x)<0.01 and y==76)
assert(BackstageForeverAskAngle(0,0,1,0)==0 and BackstageForeverAskAngle(0,0,0,1)==90 and BackstageForeverAskAngle(0,0,-1,0)==180 and BackstageForeverAskAngle(0,0,0,-1)==270)
for a=0,350,35 do local px,py=BackstageForeverAskButtonOffset(a,80) assert(math.abs(BackstageForeverAskAngle(0,0,px,py)-a)<0.2,a) end
print('ok')`);
  assert.equal(out, "ok");
});

test("the minimap button: own painted texture, placed on the edge, dragged around it, saved per character, hidden and shown", () => {
  const out = lua(HARNESS + String.raw`
assert(button and button.parent==Minimap,'a button on the minimap')
assert(button.textures[1].texture=='Interface\\AddOns\\BackstageForever\\Art\\Buttons\\ask','our own painted crest')
for _,t in ipairs(button.textures) do assert(t.texture:find('AddOns\\BackstageForever',1,true),'no Blizzard art: '..t.texture) end
-- Default place: 210 degrees on a 140px minimap -> radius 76.
assert(button.point[1]=='CENTER' and button.point[2]==Minimap and math.abs(button.point[4]-76*math.cos(math.rad(210)))<0.01 and math.abs(button.point[5]-76*math.sin(math.rad(210)))<0.01)
-- Drag: the cursor (in screen pixels, minimap scale 2) right of the centre -> angle 0.
button.scripts.OnDragStart(button)
assert(button.scripts.OnUpdate,'follows the cursor while dragging')
CURSOR={1200,800} button.scripts.OnUpdate(button)
assert(button.point[4]==76 and button.point[5]==0,'right edge')
CURSOR={1000,1000} button.scripts.OnDragStop(button)
assert(button.scripts.OnUpdate==nil)
assert(BackstageForeverAskSettings.angle==90 and button.point[5]==76,'top edge, saved')
-- A reload keeps it (SavedVariablesPerCharacter).
-- Tooltip and click.
button.scripts.OnEnter(button) assert(#GameTooltip.calls.AddLine>=2)
button.scripts.OnClick(button) assert(#sent==1 and sent[1]==OPEN,'a click sends only the open signal')
assert(named.BackstageForeverAskFrame==nil and named.BackstageForeverAskInput==nil,'no question box in game any more')
BackstageForeverAskCommand('ask hide') assert(not button.shown and BackstageForeverAskSettings.hidden==true)
assert(lastChat():find('/bf ask show',1,true))
BackstageForeverAskCommand('ASK show') assert(button.shown and BackstageForeverAskSettings.hidden==nil)
print('ok')`);
  assert.equal(out, "ok");
  const again = lua(String.raw`BackstageForeverAskSettings={angle=135,hidden=true,recent={{text='old',at=1,status='sent'},'junk'}}
` + HARNESS + String.raw`
assert(math.abs(button.point[4]+76*math.sqrt(.5))<0.01 and math.abs(button.point[5]-76*math.sqrt(.5))<0.01,'saved angle restored')
assert(not button.shown,'stays hidden')
assert(#BackstageForeverAskSettings.recent==1,'bad saved rows are dropped')
print('ok')`);
  assert.equal(again, "ok");
});

test("the owl opens the app's panel: one open signal, never in combat, and a clear note when the link is off", () => {
  const out = lua(HARNESS + String.raw`
assert(BackstageForeverAskOpenSignal==OPEN and #OPEN==5)
assert(BackstageForeverAskClean(OPEN)=='open','no typed question can be the open signal')
assert(BackstageForeverAskOpen()=='sent' and sent[1]==OPEN)
assert(BackstageForeverAskCommand('ask')=='open:sent' and sent[2]==OPEN,'/bf ask opens the panel too')
assert(#BackstageForeverAskSettings.recent==0,'opening is not a question')
-- In combat: it waits and opens when combat ends; /bf ask cancel drops it.
COMBAT=true
assert(BackstageForeverAskOpen()=='queued' and #sent==2 and lastChat():find('opens when combat ends',1,true))
COMBAT=false fire('PLAYER_REGEN_ENABLED')
assert(#sent==3 and sent[3]==OPEN,'opened as soon as combat ends')
COMBAT=true BackstageForeverAskOpen() BackstageForeverAskCommand('ask cancel')
COMBAT=false fire('PLAYER_REGEN_ENABLED') assert(#sent==3,'cancelled')
-- Live link off: nothing is sent and chat says how to fix it.
BackstageForeverLiveCommand('live off')
local waiting=BackstageForeverLiveQuestionStatus().waiting
assert(BackstageForeverAskOpen()=='off' and BackstageForeverLiveQuestionStatus().waiting==waiting and lastChat():find('/bf live on',1,true))
BackstageForeverLiveCommand('live on')
-- Old macros calling the toggle still open the panel.
BackstageForeverAskToggle() assert(sent[#sent]==OPEN,'old macros still ask for the panel')
print('ok')`);
  assert.equal(out, "ok");
  // The app reads the open signal off the strip as an open, never as a question.
  const pages = L.encodeQuestionPages(7, "\u0001open", 42);
  const parts = new Map(pages.map((p) => { const pg = L.parseQuestionPage(p); return [pg.index, pg.bytes]; }));
  assert.equal(L.assembleQuestion(parts, pages.length, L.parseQuestionPage(pages[0]).sum), L.OPEN_SIGNAL);
});

test("never in combat: a question asked in combat waits, goes up when combat ends, and cancel drops it", () => {
  const out = lua(HARNESS + String.raw`
COMBAT=true
assert(BackstageForeverAskCommand('ask Is this elite too strong for me?')=='queued')
assert(#sent==0,'nothing goes on the strip in combat')
assert(BackstageForeverAskPending()=='Is this elite too strong for me?')
assert(BackstageForeverAskSettings.recent[1].status=='waiting')
COMBAT=false fire('PLAYER_REGEN_ENABLED')
assert(#sent==1 and sent[1]=='Is this elite too strong for me?','sent as soon as combat ends')
assert(BackstageForeverAskSettings.recent[1].status=='sent')
assert(lastChat():find('your question went to the app',1,true))
COMBAT=true
assert(BackstageForeverAskCommand('ask where is the graveyard?')=='queued')
assert(chat[#chat-1]:find('asking the desktop app: "where is the graveyard?"',1,true))
assert(BackstageForeverAskCommand('ask cancel')=='cancel' and BackstageForeverAskPending()==nil)
COMBAT=false fire('PLAYER_REGEN_ENABLED') assert(#sent==1)
assert(BackstageForeverAskSettings.recent[1].status=='cancelled')
print('ok')`);
  assert.equal(out, "ok");
});

test("/bf ask QUESTION sends straight away with its own case, shows it in chat, and refuses when the live link is off", () => {
  const out = lua(HARNESS + String.raw`
assert(BackstageForeverAskCommand('ask How do I get to Thunder Bluff?')=='sent')
assert(sent[1]=='How do I get to Thunder Bluff?')
assert(chat[#chat-1]=='Backstage Forever: asking the desktop app: "How do I get to Thunder Bluff?"',chat[#chat-1])
assert(lastChat():find('panel over your game',1,true))
assert(BackstageForeverAskCommand('ask')=='open:sent' and sent[2]=='\1open')
assert(BackstageForeverAskCommand('askhow')~='sent','the word must be ask')
BackstageForeverLiveCommand('live off')
assert(BackstageForeverAskCommand('ask anyone there?')=='off')
assert(lastChat():find('/bf live on',1,true))
assert(BackstageForeverAskSettings.recent[1].status=='off')
BackstageForeverLiveCommand('live on')
assert(BackstageForeverAskCommand('ask four')=='busy','three at most wait for the strip (two opens and a question here)')
assert(#BackstageForeverAskSettings.recent==3,'opening the panel is not a question')
print('ok')`);
  assert.equal(out, "ok");
});

test("the strip carries what the box sent, byte for byte", () => {
  const text = "Où est le maître de vol ? 十字路口";
  const out = lua(HARNESS + `
BackstageForeverAskCommand('ask '..${luaString(text)})
local p=BackstageForeverLiveQuestionPages(BackstageForeverLiveSettings.questionSeq,sent[1],BackstageForeverLiveIdentity('Player-1-ABC'))
local parts={}
for _,b in ipairs(p) do for i=6,5+b[26] do parts[#parts+1]=b[i] end end
print(#p..' '..table.concat(parts,','))`).split(" ");
  const bytes = out[1].split(",").map(Number);
  assert.equal(Buffer.from(bytes).toString("utf8"), text);
  const pages = L.encodeQuestionPages(1, text, L.identityHash("Player-1-ABC"));
  assert.equal(Number(out[0]), pages.length);
});

test("the ask module is installed, routed by /bf, listed in help, and stays within the client's rules", () => {
  const src = read("addon/BackstageForever/BackstageForeverAsk.lua");
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^BackstageForeverAsk\.lua\r?$/m);
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverAskSettings/);
  assert.ok(toc.indexOf("BackstageForeverLive.lua") < toc.indexOf("BackstageForeverAsk.lua"), "after the live strip");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='ask'[\s\S]{0,120}BackstageForeverAskCommand/);
  for (const m of src.matchAll(/^(?:function\s+([A-Za-z_][\w.:]*)|([A-Za-z_][\w.]*)\s*=)/gm)) assert.match(m[1] || m[2], /^BackstageForever/, `global ${m[1] || m[2]}`);
  assert.doesNotMatch(src, /hooksecurefunc|SecureHook|tinsert\(UISpecialFrames|UISpecialFrames\[|table\.insert\(UISpecialFrames|SendChatMessage|SetUserWaypoint|SetSuperTrackedUserWaypoint|ClearUserWaypoint|COMBAT_LOG|SecureActionButton|RunMacro|CastSpell/);
  const events = [...src.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).filter((e) => /^(PLAYER|UNIT|COMBAT|CHAT|QUEST)_/.test(e));
  assert.deepEqual([...new Set(events)].sort(), ["PLAYER_LOGIN", "PLAYER_REGEN_ENABLED"]);
  assert.doesNotMatch(src, /'Interface\\\\(?!AddOns\\\\BackstageForever)/, "no Blizzard textures");
  assert.match(src, /issecretvalue/);
  assert.ok(fs.existsSync(path.join(root, "addon/BackstageForever/Art/Buttons/ask.tga")), "the painted button ships");
  const tga = fs.readFileSync(path.join(root, "addon/BackstageForever/Art/Buttons/ask.tga"));
  assert.deepEqual([tga[2], tga.readUInt16LE(12), tga.readUInt16LE(14), tga[16]], [2, 64, 64, 32], "64x64 uncompressed 32-bit TGA with alpha");
});

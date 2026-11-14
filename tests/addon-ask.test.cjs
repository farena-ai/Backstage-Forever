"use strict";
// 0.38 (A15) ask the companion from inside the game: the minimap button (painted, draggable around
// the edge, position saved per character), the question box (Ask, Enter, Cancel, Escape, a 200
// character cap), the send rules (only on Ask/Enter/typed command, never in combat: it waits,
// visibly, and Cancel drops it) and the typed /bf ask commands, with the real live strip module.
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
BackstageForeverAskToggle() BackstageForeverAskToggle()
local box,edit=named.BackstageForeverAskFrame,named.BackstageForeverAskInput
assert(box and not box.shown,'the box starts closed')
local function lastChat() return chat[#chat] or '' end
local function pushButton(label) for _,o in ipairs(ALL) do if o.kind=='Button' and o.parent==box and o.text==label then return o end end end
local function texts() local t={} for _,o in ipairs(ALL) do if o.kind=='FontString' and type(o.text)=='string' then t[#t+1]=o.text end end return table.concat(t,'\n') end
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
button.scripts.OnClick(button) assert(box.shown and edit.focused,'click opens the box with the cursor in it')
button.scripts.OnClick(button) assert(not box.shown,'and closes it')
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

test("the question box: Enter or Ask sends exactly the cleaned text once, shows it, caps at 200 characters and lists recent questions", () => {
  const out = lua(HARNESS + String.raw`
BackstageForeverAskToggle()
assert(edit.maxLetters==200,'the edit box stops at 200 characters')
edit.text='   ' edit.scripts.OnEnterPressed(edit)
assert(#sent==0,'nothing typed, nothing sent')
assert(named.BackstageForeverAskFrame and box.shown)
edit.text='Where is the |cffffd000flight master|r in Crossroads?'
edit.scripts.OnTextChanged(edit)
edit.scripts.OnEnterPressed(edit)
assert(#sent==1 and sent[1]=='Where is the flight master in Crossroads?',sent[1])
assert(edit.text=='','the box empties after sending')
local st=BackstageForeverLiveQuestionStatus()
assert(st and st.count==3 and st.page==1,'three strip pages wait to go up')
print(BackstageForeverAskSettings.recent[1].text..'|'..BackstageForeverAskSettings.recent[1].status)
edit.text=string.rep('y',230) edit.scripts.OnEnterPressed(edit)
assert(#sent[2]==200,'cut to 200 characters')
print('done')`).split("\n");
  assert.equal(out[0], "Where is the flight master in Crossroads?|sent");
  assert.equal(out.at(-1), "done");
  // What the box shows after the Ask button (status, the exact text, the recent list and the counter).
  const shown = lua(HARNESS + String.raw`
BackstageForeverAskToggle()
edit.text='How do I train  First Aid?' edit.scripts.OnTextChanged(edit)
assert(texts():find('26/200',1,true),'a character counter')
pushButton('Ask').scripts.OnClick()
print(texts())`);
  assert.match(shown, /Sent\. The answer appears in the Backstage Forever panel over your game\.\n\|cff9d9d9dYou asked:\|r How do I train First Aid\?/);
  assert.match(shown, /• How do I train First Aid\? \|cff9d9d9d\(sent, just now\)\|r/);
  assert.match(shown, /Only what you type is sent, and only when you press Ask, never in combat/);
});

test("never in combat: a question asked in combat waits, goes up when combat ends, and Cancel drops it", () => {
  const out = lua(HARNESS + String.raw`
COMBAT=true
BackstageForeverAskToggle()
edit.text='Is this elite too strong for me?' edit.scripts.OnEnterPressed(edit)
assert(#sent==0,'nothing goes on the strip in combat')
assert(BackstageForeverAskPending()=='Is this elite too strong for me?')
assert(BackstageForeverAskSettings.recent[1].status=='waiting')
fire('PLAYER_REGEN_DISABLED') assert(edit.focused==false,'combat gives the keyboard back to the game')
COMBAT=false fire('PLAYER_REGEN_ENABLED')
assert(#sent==1 and sent[1]=='Is this elite too strong for me?','sent as soon as combat ends')
assert(BackstageForeverAskSettings.recent[1].status=='sent')
assert(lastChat():find('your question went to the app',1,true))
-- Asked in combat, then dropped with Cancel: never sent.
COMBAT=true
edit.text='Second thoughts' edit.scripts.OnEnterPressed(edit)
assert(texts():find('You are in combat',1,true) and texts():find('Second thoughts',1,true),'the box shows what waits')
pushButton('Cancel').scripts.OnClick()
assert(box.shown and texts():find('dropped; nothing was sent',1,true),'Cancel drops the waiting question first')
pushButton('Cancel').scripts.OnClick()
assert(not box.shown,'then Cancel closes the box')
COMBAT=false fire('PLAYER_REGEN_ENABLED')
assert(#sent==1,'a dropped question is never sent')
assert(BackstageForeverAskSettings.recent[1].status=='cancelled')
-- Typed in combat: the same rule, and chat says what will be sent.
COMBAT=true
assert(BackstageForeverAskCommand('ask where is the graveyard?')=='queued')
assert(chat[#chat-1]:find('asking the desktop app: "where is the graveyard?"',1,true))
assert(BackstageForeverAskCommand('ask cancel')=='cancel' and BackstageForeverAskPending()==nil)
COMBAT=false fire('PLAYER_REGEN_ENABLED') assert(#sent==1)
-- Escape closes the box through the edit box itself.
BackstageForeverAskToggle() if not box.shown then BackstageForeverAskToggle() end
edit.scripts.OnEscapePressed(edit) assert(not box.shown and edit.focused==false)
print('ok')`);
  assert.equal(out, "ok");
});

test("/bf ask QUESTION sends straight away with its own case, shows it in chat, and refuses when the live link is off", () => {
  const out = lua(HARNESS + String.raw`
assert(BackstageForeverAskCommand('ask How do I get to Thunder Bluff?')=='sent')
assert(sent[1]=='How do I get to Thunder Bluff?')
assert(chat[#chat-1]=='Backstage Forever: asking the desktop app: "How do I get to Thunder Bluff?"',chat[#chat-1])
assert(lastChat():find('panel over your game',1,true))
assert(BackstageForeverAskCommand('ask')=='toggle' and box.shown)
assert(BackstageForeverAskCommand('askhow')~='sent','the word must be ask')
BackstageForeverLiveCommand('live off')
assert(BackstageForeverAskCommand('ask anyone there?')=='off')
assert(lastChat():find('/bf live on',1,true))
assert(BackstageForeverAskSettings.recent[1].status=='off')
BackstageForeverLiveCommand('live on')
assert(BackstageForeverAskCommand('ask two')=='sent' and BackstageForeverAskCommand('ask three')=='sent')
assert(BackstageForeverAskCommand('ask four')=='busy','three questions at most wait for the strip')
assert(#BackstageForeverAskSettings.recent==5,'five recent questions are kept')
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
  assert.deepEqual([...new Set(events)].sort(), ["PLAYER_LOGIN", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED"]);
  assert.doesNotMatch(src, /'Interface\\\\(?!AddOns\\\\BackstageForever)/, "no Blizzard textures");
  assert.match(src, /issecretvalue/);
  assert.ok(fs.existsSync(path.join(root, "addon/BackstageForever/Art/Buttons/ask.tga")), "the painted button ships");
  const tga = fs.readFileSync(path.join(root, "addon/BackstageForever/Art/Buttons/ask.tga"));
  assert.deepEqual([tga[2], tga.readUInt16LE(12), tga.readUInt16LE(14), tga[16]], [2, 64, 64, 32], "64x64 uncompressed 32-bit TGA with alpha");
});

test("the owl box stacks its text (status, then Recent questions, then the list) and grows instead of overlapping", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../addon/BackstageForever/BackstageForeverAsk.lua"), "utf8");
  assert.match(src, /ui\.recentTitle,'SetPoint','TOPLEFT',ui\.status,'BOTTOMLEFT'/);
  assert.match(src, /ui\.recent,'SetPoint','TOPLEFT',ui\.recentTitle,'BOTTOMLEFT'/);
  assert.match(src, /short\(r\.text,64\)/);
  assert.match(src, /method\(box,'SetHeight',math\.max\(214/);
});

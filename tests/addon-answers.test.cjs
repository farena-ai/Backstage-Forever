"use strict";
// 1.26 (roadmap A1, A2): the last answers ride the desktop hand-off into the game (/bf answers),
// and "Explain this" opens the companion panel with a question filled in, never asked.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const handoff = require("../src/core/desktop-handoff.cjs");
const L = require("../src/core/live-bridge.cjs");
const { InGameAsk } = require("../src/core/ask-in-game.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const saved = (id, name, realm) => ({ id, name, realm, source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });
const FILES = "dofile('addon/BackstageForever/BackstageForeverAsk.lua')\ndofile('addon/BackstageForever/BackstageForeverAnswers.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end,
  SetSize=function() end,SetFrameStrata=function() end,SetFrameLevel=function() end,CreateTexture=function() end,RegisterForClicks=function() end,RegisterForDrag=function() end,
  ClearAllPoints=function() end,SetPoint=function() end,Show=function() end,Hide=function() end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local combat=false InCombatLockdown=function() return combat end
local clock=1000 GetTime=function() return clock end
time=function() return 1700003600 end
UnitName=function(u) if u=='player' then return 'Abel' end if u=='target' then return target end if u=='mouseover' then return mouse end end
UnitExists=function(u) return (u=='target' and target~=nil) or (u=='mouseover' and mouse~=nil) end
GetRealmName=function() return 'Thunder Hold' end
local asked={}
BackstageForeverLiveQuestion=function(text) asked[#asked+1]=text return #asked,1 end
`;

test("the hand-off carries at most five plain answers per character, and gives way before anything else", () => {
  const profiles = [saved("a", "Abel", "Thunder Hold"), saved("b", "Zed", "Thunder Hold")];
  const answers = { a: [
    { question: "Where is **Thork**?", answer: "# Thork\r\nHe stands in `Orgrimmar`.\n\n- at 51, 30\u0007\nSay |cffff0000hi|r", at: 1700000000000 },
    { question: "  ", answer: "no question", at: 5 }, { question: "no answer", answer: "", at: 5 }, { question: 7, answer: "x", at: 5 },
    ...Array.from({ length: 9 }, (_, i) => ({ question: "Q" + i, answer: "A" + i, at: 1000 * (i + 1) })),
  ] };
  const text = handoff.compile({ profiles, wishlist: (id) => (id === "b" ? [9] : []), answers: (id) => answers[id] || [] });
  assert.equal(text, handoff.compile({ profiles: [...profiles].reverse(), wishlist: (id) => (id === "b" ? [9] : []), answers: (id) => answers[id] || [] }), "same bytes for the same input");
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n/, "schema stays 1");
  const abel = text.split("\n").find((l) => l.startsWith('["Abel-Thunder Hold"]'));
  assert.ok(abel.startsWith('["Abel-Thunder Hold"]={wish={},ans={{q="Where is Thork?",a="Thork\\010He stands in Orgrimmar.\\010- at 51, 30\\010Say |cffff0000hi|r",t=1700000000},'), abel);
  assert.equal((abel.match(/\{q=/g) || []).length, handoff.MAX_ANSWERS, "five at most, entries without question or answer are skipped");
  assert.match(abel, /\{q="Q3",a="A3",t=4\}\}\},$/);
  assert.match(text, /\["Zed-Thunder Hold"\]=\{wish=\{9\}\},/, "a character without answers is written as before");
  assert.equal(handoff.compile({ profiles, answers: () => [] }), handoff.EMPTY);
  assert.equal(handoff.compile({ profiles, answers: () => { throw Error("no"); } }), handoff.EMPTY, "a failing supplier never breaks the file");
  // Bounded: a question is cut to 200 characters, an answer to 1200.
  const long = handoff.compile({ profiles: [profiles[0]], answers: () => [{ question: "q".repeat(900), answer: "ä".repeat(5000), at: 1 }] });
  assert.equal(long.match(/q="(q+)"/)[1].length, handoff.MAX_QUESTION);
  assert.equal(long.match(/a="((?:\\\d{3})+)"/)[1].length / 8, handoff.MAX_ANSWER);
  // The size limit: wishes, plans and loops of all hundred characters stay whole; answers are left out first.
  const many = Array.from({ length: 100 }, (_, i) => saved("p" + i, "N" + i, "R"));
  const ids = Array.from({ length: 200 }, (_, i) => 2000000000 + i);
  const big = { question: "q", answer: "x".repeat(1200), at: 1 };
  const full = handoff.compile({ profiles: many, wishlist: () => ids, answers: () => [big] });
  assert.ok(Buffer.byteLength(full) <= handoff.MAX_BYTES);
  const rows = full.split("\n").filter((l) => l.startsWith("["));
  assert.equal(rows.length, 100);
  for (const row of rows) assert.equal(row.match(/wish=\{([\d,]+)\}/)[1].split(",").length, 200, "every wish list is whole");
  assert.ok(rows.some((r) => r.includes(",ans=")) && rows.some((r) => !r.includes(",ans=")), "some answers fit, the rest are left out");
  // What the game reads back.
  const out = lua(STUBS + FILES + text.replace(/^--.*$/gm, "") + String.raw`
local list=BackstageForeverAnswersRead(BackstageForeverDesktopData,'Abel','Thunder Hold')
assert(#list==5 and list[1].q=='Where is Thork?' and list[1].t==1700000000 and list[1].a:find('He stands in Orgrimmar.',1,true),list[1] and list[1].q)
assert(#BackstageForeverAnswersRead(BackstageForeverDesktopData,'Zed','Thunder Hold')==0 and #BackstageForeverAnswersRead(BackstageForeverDesktopData,'Nobody','X')==0)
BackstageForeverAnswersCommand('answers')
assert(said[1]=='Backstage Forever: Your last answers from the companion: 5. They are as of your last /reload.',said[1])
assert(said[2]=='  1. Where is Thork? (1 h ago)',said[2])
assert(#said==7 and last():find('/bf answers 1',1,true))
said={} BackstageForeverAnswersCommand('answers 1')
assert(said[1]=='Backstage Forever: You asked: Where is Thork? (1 h ago)' and said[2]=='  Thork' and said[3]=='  He stands in Orgrimmar.' and said[4]=='  - at 51, 30',said[1])
assert(said[5]=='  Say ||cffff0000hi||r','a colour code in an answer is shown as text, never run: '..said[5])
said={} BackstageForeverAnswersCommand('answers 9') assert(#said==1 and said[1]:find('Pick a number from 1 to 5',1,true))
said={} BackstageForeverAnswersCommand('answers nonsense') assert(#said==1 and said[1]:find('Pick a number',1,true))
print('ok')`);
  assert.equal(out, "ok");
});

test("in game: a damaged or foreign answers block is ignored, long answers wrap and stop", () => lua(STUBS + FILES + String.raw`
local R,W=BackstageForeverAnswersRead,BackstageForeverAnswerWrap
local function data(ans) return {schema=1,characters={['Abel-Thunder Hold']={wish={},ans=ans}}} end
assert(#R(nil,'Abel','Thunder Hold')==0 and #R({schema=2,characters={}},'Abel','Thunder Hold')==0 and #R(data('text'),'Abel','Thunder Hold')==0 and #R(data({}),'Abel',nil)==0)
local list=R(data({{q='ok',a='fine',t=5},'junk',{q='',a='x'},{q='x'},{q=5,a='x'},{q='late',a='no time',t='soon'},{q='neg',a='x',t=-4},{q='nan',a='x',t=0/0}}),'Abel','Thunder Hold')
assert(#list==4 and list[1].t==5 and list[2].q=='late' and list[2].t==nil and list[3].t==nil and list[4].t==nil)
local nine={} for i=1,9 do nine[i]={q='q'..i,a='a'..i,t=i} end
assert(#R(data(nine),'Abel','Thunder Hold')==5,'five at most')
local big=R(data({{q=string.rep('q',5000),a=string.rep('ä',9000),t=1}}),'Abel','Thunder Hold')[1]
assert(#big.q==800 and #big.a<=6000 and #big.a>=5996 and #big.a%2==0,'cut to a fixed size, never mid-character: '..#big.a)
-- Wrapping: lines of at most the width, breaks at spaces, line breaks kept, | doubled, control bytes gone.
local lines=W('one two three four five six seven eight nine ten',20)
for _,l in ipairs(lines) do assert(#l<=20,l) end
assert(table.concat(lines,' ')=='one two three four five six seven eight nine ten' and #lines>=3)
lines=W('a\n\nb|c\1d',50) assert(#lines==2 and lines[1]=='a' and lines[2]=='b||c d',lines[2])
lines=W(string.rep('x',95),40) assert(#lines==3 and #lines[1]==40 and #lines[3]==15,'a word longer than the line is cut')
lines=W(string.rep('ä',50),31) for _,l in ipairs(lines) do assert(#l%2==0 and #l<=31) end
assert(#W(nil)==0 and #W('')==0)
assert(BackstageForeverAnswerAge(100,100)=='just now' and BackstageForeverAnswerAge(100,100+59*60)=='59 min ago' and BackstageForeverAnswerAge(100,100+47*3600)=='47 h ago'
  and BackstageForeverAnswerAge(100,100+72*3600)=='3 days ago' and BackstageForeverAnswerAge(200,100)==nil and BackstageForeverAnswerAge(nil,100)==nil)
local long={{q='Q',a=string.rep('word ',2000),t=1}}
local shown=BackstageForeverAnswersLines(long,1,10)
assert(#shown==32 and shown[32]=='  The rest is in the desktop app.','thirty lines of answer at most: '..#shown)
assert(BackstageForeverAnswersLines({},nil,1)[1]:find('No answers here yet',1,true) and #BackstageForeverAnswersLines(nil,nil,1)==1)
BackstageForeverDesktopData=nil BackstageForeverAnswersCommand('answers') assert(#said==1 and last():find('No answers here yet',1,true))
`));

test("explain: the thing is put in the question box as a signal an older app drops; nothing is ever asked", () => lua(STUBS + FILES + String.raw`
local X,P=BackstageForeverExplainText,BackstageForeverExplainPick
assert(X('item','Linen Cloth')=='Explain the item: Linen Cloth' and X('quest','The Barrens Oases')=='Explain the quest: The Barrens Oases' and X('npc','Thork')=='Who is Thork?')
assert(X(nil,'what does spirit do')=='what does spirit do' and X('item','')==nil and X('item',nil)==nil and X('item',5)==nil)
assert(X('item','|cff1eff00|Hitem:2589::::::::20:::::|h[Linen Cloth]|h|r')=='Explain the item: [Linen Cloth]','links become their visible name')
assert(BackstageForeverAskLength(X(nil,string.rep('ä',900)))==180,'cut to a fixed length')
local kind,name=P({item='Sword',unit='Wolf',target='Thork',quest='Q'}) assert(kind=='item' and name=='Sword')
kind,name=P({unit='Wolf',target='Thork',quest='Q'}) assert(kind=='npc' and name=='Wolf')
kind,name=P({target='Thork',quest='Q'}) assert(kind=='npc' and name=='Thork')
kind,name=P({quest='Q'}) assert(kind=='quest' and name=='Q')
assert(P({})==nil and P(nil)==nil and P({item=''})==nil)
assert(BackstageForeverExplainSignal('Who is Thork?')=='\1\255fill:Who is Thork?' and BackstageForeverExplainSignal('')==nil and BackstageForeverExplainSignal('a\nb')==nil and BackstageForeverExplainSignal(string.rep('x',600))==nil)
assert(BackstageForeverLinkName('|cff1eff00|Hitem:2589|h[Linen Cloth]|h|r')=='Linen Cloth' and BackstageForeverLinkName('plain')==nil and BackstageForeverLinkName(nil)==nil)
-- /bf explain with a target.
target='Thork'
BackstageForeverExplainCommand('explain')
assert(#asked==1 and asked[1]=='\1\255fill:Who is Thork?',asked[1])
assert(last()=='Backstage Forever: The companion panel opens with this in its question box: "Who is Thork?". Nothing is asked until you press Enter there.',last())
-- At most one every two seconds; the mouse-over item wins over the target; your own words go as they are.
BackstageForeverExplainCommand('explain') assert(#asked==1)
clock=1010 GameTooltip={IsShown=function() return true end,GetItem=function() return 'Linen Cloth','link' end}
BackstageForeverExplainCommand('explain') assert(#asked==2 and asked[2]=='\1\255fill:Explain the item: Linen Cloth')
clock=1020 BackstageForeverExplainCommand('explain Why do I miss so often?') assert(#asked==3 and asked[3]=='\1\255fill:Why do I miss so often?')
clock=1030 BackstageForeverExplainCommand('EXPLAIN |cffffff00|Hquest:870:14|h[The Forgotten Pools]|h|r') assert(asked[4]=='\1\255fill:The Forgotten Pools')
-- Never in combat, and nothing to explain says so.
clock=1040 combat=true BackstageForeverExplainCommand('explain') assert(#asked==4 and last():find('until you leave combat',1,true)) combat=false
GameTooltip=nil target=nil BackstageForeverExplainCommand('explain') assert(#asked==4 and last():find('nothing to explain here',1,true))
-- The tracked quest when nothing else is there.
C_SuperTrack={GetSuperTrackedQuestID=function() return 870 end} C_QuestLog={GetTitleForQuestID=function(id) return id==870 and 'The Forgotten Pools' or nil end}
BackstageForeverExplainCommand('explain') assert(asked[5]=='\1\255fill:Explain the quest: The Forgotten Pools',asked[5])
-- Live link off or busy: said plainly, nothing queued.
clock=1050 BackstageForeverLiveQuestion=function() return nil,'off' end
BackstageForeverExplainCommand('explain') assert(last():find('live link is off',1,true))
-- Alt-click: off until switched on, alt alone, never in combat.
BackstageForeverLiveQuestion=function(text) asked[#asked+1]=text return 1,1 end
local alt,shift=true,false IsAltKeyDown=function() return alt end IsShiftKeyDown=function() return shift end IsControlKeyDown=function() return false end
local link='|cff1eff00|Hitem:2589|h[Linen Cloth]|h|r'
clock=1060 assert(BackstageForeverExplainClickOn()==false and BackstageForeverExplainItemClick(link)==false and #asked==5)
BackstageForeverExplainCommand('explain click on') assert(BackstageForeverAskSettings.explainClick==true and last():find('Explain on Alt-click: on',1,true))
assert(BackstageForeverExplainItemClick(link)==true and asked[6]=='\1\255fill:Explain the item: Linen Cloth')
clock=1070 shift=true assert(BackstageForeverExplainItemClick(link)==false) shift=false alt=false assert(BackstageForeverExplainItemClick(link)==false) alt=true
combat=true assert(BackstageForeverExplainItemClick(link)==false) combat=false
assert(BackstageForeverExplainItemClick('no link')==false and BackstageForeverExplainItemClick(nil)==false and #asked==6)
BackstageForeverExplainCommand('explain click off') assert(BackstageForeverExplainItemClick(link)==false)
-- The hook is only placed with the game's own hook function, after login.
local hooked hooksecurefunc=function(name,fn) hooked={name,fn} end HandleModifiedItemClick=function() end
fire('PLAYER_LOGIN') assert(hooked and hooked[1]=='HandleModifiedItemClick')
`));

test("the desktop reads the explain signal as a prefill, never as a question, and an older reader drops it", () => {
  const bytes = [1, 255, ...Buffer.from("fill:Who is Thork?", "utf8")];
  const parts = new Map(), sum = L.crc8(bytes, bytes.length);
  for (let i = 0; i * L.QUESTION_CHUNK < bytes.length; i++) parts.set(i, bytes.slice(i * L.QUESTION_CHUNK, (i + 1) * L.QUESTION_CHUNK));
  assert.equal(L.assembleQuestion(parts, parts.size, sum), L.PREFILL_SIGNAL + "Who is Thork?");
  // What an older desktop does with the same bytes: byte 255 is not UTF-8, so the text never decodes.
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)));
  const one = (text, lead = [1, 255]) => { const b = [...lead, ...Buffer.from(text, "utf8")]; return L.assembleQuestion(new Map([[0, b]]), 1, L.crc8(b, b.length)); };
  assert.equal(one("fill:"), null, "nothing to fill in");
  assert.equal(one("fill:   "), null);
  assert.equal(one("open"), null, "only fill: follows the two bytes");
  assert.equal(one("fill:" + "x".repeat(201)), null, "more than 200 characters");
  assert.equal(one("fill:a\u0001b"), L.PREFILL_SIGNAL + "a b", "control characters become spaces");
  assert.equal(L.assembleQuestion(new Map([[0, [1, 255, 0xc3]]]), 1, L.crc8([1, 255, 0xc3], 3)), null, "broken UTF-8");
});

test("the companion keeps the last five answers per character for the hand-off and opens the panel for a prefill", async () => {
  const shown = [], opened = [];
  const state = { profiles: [{ id: "p1", source: { kind: "wow-addon", id: "guid-1" } }], activeProfileId: "p1", provider: { id: "local" } };
  let n = 0, clock = 1000;
  const ask = new InGameAsk({
    companion: { ask: async (request) => { n++; if (request.prompt === "fail") throw Error("Provider is down"); return { text: "answer " + n, kind: "ai" }; } },
    getState: () => state, liveKeyFor: () => 4242, panel: { show: (s) => shown.push(s), open: (text) => opened.push(text) }, now: () => clock++,
  });
  assert.deepEqual(ask.recent("p1"), []);
  for (let i = 1; i <= 7; i++) await ask.handle({ id: i, text: "question " + i, characterHash: 4242 });
  await ask.handle({ id: 8, text: "fail", characterHash: 4242 });
  const recent = ask.recent("p1");
  assert.equal(recent.length, 5);
  assert.deepEqual(recent.map((r) => r.question), ["question 7", "question 6", "question 5", "question 4", "question 3"], "newest first, a failed question is not kept");
  assert.equal(recent[0].answer, "answer 7"); assert.ok(Number.isFinite(recent[0].at));
  recent[0].answer = "changed"; assert.equal(ask.recent("p1")[0].answer, "answer 7", "callers get copies");
  // A question from another character than the app's active one is answered but not filed under it.
  await ask.handle({ id: 9, text: "from an alt", characterHash: 777 });
  assert.equal(ask.recent("p1")[0].question, "question 7");
  assert.deepEqual(ask.recent("nobody"), []);
  // Prefill: the panel opens with the text; the companion is not asked and nothing joins the answers.
  const before = n;
  assert.equal(await ask.handle({ id: 10, kind: "prefill", text: "Who is Thork?", characterHash: 4242 }), null);
  assert.deepEqual(opened, ["Who is Thork?"]); assert.equal(n, before); assert.equal(ask.recent("p1").length, 5);
  // And the hand-off takes what the companion kept.
  const text = handoff.compile({ profiles: [saved("p1", "Abel", "Thunder Hold")], answers: (id) => ask.recent(id) });
  assert.match(text, /ans=\{\{q="question 7",a="answer 7",t=\d+\},/);
});

test("the panel offers a prefill to its page for a short while and never asks it", () => {
  const { createAskPanel } = require("../src/core/ask-panel.cjs");
  const handlers = new Map(), sent = [];
  class Win {
    constructor() { this.webContents = { send: (c, v) => sent.push([c, v]), on() {}, setWindowOpenHandler() {}, mainFrame: {} }; }
    on() {} once() {} loadURL() {} isDestroyed() { return false; } isVisible() { return true; } getBounds() { return { x: 0, y: 0, width: 10, height: 10 }; }
    setBounds() {} showInactive() {} show() {} focus() {} hide() {} setAlwaysOnTop() {} getPosition() { return [0, 0]; } destroy() {}
  }
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const asked = [];
  const panel = createAskPanel({ BrowserWindow: Win, ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler() {} }, screen: { getAllDisplays: () => [{ workArea: area }], getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area }) },
    rendererDir: path.join(root, "src", "renderer"), onAsk: (q) => asked.push(q), setTimer: () => ({ unref() {} }), clearTimer() {} });
  const win = () => panel.window();
  const state = () => handlers.get("askPanel:state")({ sender: win().webContents, senderFrame: win().webContents.mainFrame });
  assert.equal(panel.open(), true);
  assert.equal(state().draft, undefined, "a plain open offers no text");
  assert.equal(panel.open("  Who is\u0001 Thork?  "), true);
  assert.deepEqual(state().draft, { seq: 1, text: "Who is Thork?" });
  panel.open("x".repeat(500));
  assert.deepEqual(state().draft, { seq: 1, text: "Who is Thork?" }, "text that is not a clean question changes nothing");
  panel.open("Explain the item: Linen Cloth");
  assert.equal(state().draft.seq, 2);
  assert.deepEqual(asked, [], "opening with text never asks");
  const realNow = Date.now; Date.now = () => realNow() + 60000;
  try { assert.equal(state().draft, undefined, "an old prefill is not offered to a page made later"); } finally { Date.now = realNow; }
  panel.close();
  const page = read("src/renderer/ask-panel.js");
  assert.match(page, /v\.draft\.seq !== draft[^\n]*input\.value = v\.draft\.text/);
  assert.doesNotMatch(page.slice(page.indexOf("v.draft"), page.indexOf("v.draft") + 300), /api\.ask/, "the page fills the box and does not send");
});

test("wiring: files listed, commands routed and catalogued, the binding and its switch exist", () => {
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  assert.ok(ADDON_FILES.includes("BackstageForeverAnswers.lua"));
  const toc = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/);
  assert.ok(toc.indexOf("BackstageForeverAnswers.lua") > toc.indexOf("BackstageForeverAsk.lua"), "needs the question cleaner");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /word=='answers' then\s+if type\(BackstageForeverAnswersCommand\)=='function' then pcall\(BackstageForeverAnswersCommand,message\)end/);
  assert.match(hud, /word=='explain' then\s+if type\(BackstageForeverExplainCommand\)=='function' then pcall\(BackstageForeverExplainCommand,message\)end/);
  assert.match(read("addon/BackstageForever/Bindings.xml"), /<Binding name="BACKSTAGEFOREVER_EXPLAIN" category="ADDONS">\s+BackstageForeverBinding\('explain'\)/);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.match(options, /BINDING_NAME_BACKSTAGEFOREVER_EXPLAIN='/);
  assert.match(options, /switch\('Explain on Alt-click',[^\n]*off\('BackstageForeverAskSettings','explainClick'\),'explain click'\)/, "off until switched on");
  assert.match(read("src/main.cjs"), /answers: \(id\) => recentGameAnswers\(id\)/);
  const source = read("addon/BackstageForever/BackstageForeverAnswers.lua");
  assert.doesNotMatch(source, /SendChatMessage|SendAddonMessage|RunMacroText|:Click\(/, "nothing is sent or clicked");
  assert.equal((source.match(/hooksecurefunc/g) || []).length, 3, "one hook, placed through the game's own hook function (and two mentions)");
});

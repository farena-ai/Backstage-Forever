"use strict";
// 0.38 (A15) in-game questions over the live strip: the addon's kind 4 pages carry a question the
// player typed (17 UTF-8 bytes a page), in bursts between the ordinary pages. The Lua encoder and
// the app decoder must agree byte for byte, a question must survive missed pages (two passes),
// arrive once, and never go up in combat. The simulated timing below gives the real throughput.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1048576 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const bytesJson = (v) => `do local a={} for _,x in ipairs(${v}) do a[#a+1]=x end print('['..table.concat(a,',')..']') end`;
// Lua string literal from UTF-8 bytes (fengari reads source bytes; escapes keep it exact).
const luaString = (text) => '"' + [...Buffer.from(text, "utf8")].map((b) => "\\" + b).join("") + '"';

const SAMPLES = {
  ascii: "Where is the flight master in Crossroads?",
  accents: "Où est le maître de vol à Orgrimmar ? ¿Dónde está?",
  euro: "Wie viel kostet Reiten? 90 € oder 90g — sag es mir",
  cjk: "十字路口的飞行管理员在哪里？",
  max: "x".repeat(199) + "€", // 202 bytes, 200 characters
};

test("Lua question pages match the app encoder byte for byte, and decode back exactly (ASCII, accents, euro, CJK, max)", () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local pages=BackstageForeverLiveQuestionPages(7,${luaString(text)},4242)
print(#pages)
for _,p in ipairs(pages) do ${bytesJson("p")} end`).split("\n");
    const js = L.encodeQuestionPages(7, text, 4242);
    assert.equal(Number(out[0]), Math.ceil(Buffer.byteLength(text) / 17), name);
    assert.equal(js.length, Number(out[0]), name);
    js.forEach((p, i) => assert.deepEqual(JSON.parse(out[1 + i]), p, `${name} page ${i}`));
    const parts = new Map(js.map((p) => { const q = L.parseQuestionPage(p); return [q.index, q.bytes]; }));
    const first = L.parseQuestionPage(js[0]);
    assert.equal(first.kind, "question"); assert.equal(first.id, 7); assert.equal(first.identity, 4242); assert.equal(first.count, js.length);
    assert.equal(L.assembleQuestion(parts, first.count, first.sum), text, name);
  }
});

test("question pages: limits, corruption and other page kinds", () => {
  assert.equal(L.encodeQuestionPages(1, "a".repeat(600)).length, 36, "600 bytes is the most a question carries");
  assert.deepEqual(L.encodeQuestionPages(1, "a".repeat(601)), []);
  assert.deepEqual(L.encodeQuestionPages(0, "hi"), []); assert.deepEqual(L.encodeQuestionPages(256, "hi"), []); assert.deepEqual(L.encodeQuestionPages(1, ""), []);
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
print(#BackstageForeverLiveQuestionPages(1,string.rep('a',600),0), #BackstageForeverLiveQuestionPages(1,string.rep('a',601),0), #BackstageForeverLiveQuestionPages(0,'hi',0), #BackstageForeverLiveQuestionPages(1,'',0), #BackstageForeverLiveQuestionPages(1,nil,0))`);
  assert.equal(out, "36\t0\t0\t0\t0");
  const pages = L.encodeQuestionPages(9, SAMPLES.accents, 77);
  // A flipped bit fails the page CRC on the strip.
  const bad = [...pages[0]]; bad[8] ^= 1;
  const levels = [[0, 85, 170, 255], [0, 85, 170, 255], [0, 85, 170, 255]];
  assert.deepEqual(Array.from(L.decodeCellsV4(L.encodePageCellsV4(pages[0]), levels, L.PAGE_VERSION)), pages[0]);
  assert.equal(L.decodeCellsV4(L.encodePageCellsV4(bad), levels, L.PAGE_VERSION), null);
  // Quest-page and moment parsers (and apps before 0.38) ignore kind 4; the question parser ignores the others.
  assert.equal(L.parsePage(pages[0]), null); assert.equal(L.parseMomentPage(pages[0]), null);
  assert.equal(L.parseQuestionPage(L.encodePages(1, [{ id: 5, complete: false }])[0]), null);
  // Short pages before the last, or lengths past 17, are refused.
  const short = [...pages[0]]; short[25] = 3; assert.equal(L.parseQuestionPage(short), null);
  const long = [...pages.at(-1)]; long[25] = 18; assert.equal(L.parseQuestionPage(long), null);
  // A wrong whole-text checksum, or bytes that are not UTF-8, never become a question.
  const parts = new Map(pages.map((p) => { const q = L.parseQuestionPage(p); return [q.index, q.bytes]; }));
  const sum = L.parseQuestionPage(pages[0]).sum;
  assert.equal(L.assembleQuestion(parts, pages.length, (sum + 1) & 255), null);
  const broken = new Map([[0, [0xc3]]]);
  assert.equal(L.assembleQuestion(broken, 1, L.crc8([0xc3], 1)), null);
  assert.equal(L.assembleQuestion(new Map([[0, [65]]]), 2, 0), null, "a missing page");
  const over = "y".repeat(201), overParts = new Map(L.encodeQuestionPages(1, over).map((p) => { const q = L.parseQuestionPage(p); return [q.index, q.bytes]; }));
  assert.equal(L.assembleQuestion(overParts, overParts.size, L.parseQuestionPage(L.encodeQuestionPages(1, over)[0]).sum), null, "more than 200 characters");
});

// A painted strip: Live.lua with stubbed frames and a clock; each tick prints both rows.
const HARNESS = String.raw`
local frames,textures,handlers={}, {}, {}
local clock=100
GetTime=function() return clock end
UIParent={GetEffectiveScale=function()return 1 end}
GetPhysicalScreenSize=function()return 1920,1080 end
DEFAULT_CHAT_FRAME={AddMessage=function()end}
UnitGUID=function(u) if u=='player' then return 'Player-1-ABC' end end
UnitLevel=function() return 12 end
UnitHealth=function()return 50 end UnitHealthMax=function()return 100 end
COMBAT=false
InCombatLockdown=function()return COMBAT end
C_Map={GetBestMapForUnit=function()return 1436 end,GetPlayerMapPosition=function()return {GetXY=function()return 0.5,0.5 end}end}
C_QuestLog={GetNumQuestLogEntries=function() return 1 end,GetInfo=function() return {questID=93739} end,IsComplete=function() return false end}
CreateFrame=function(kind,name)
  local f={shown=false,scripts={},events={}}
  function f:SetScript(k,fn)self.scripts[k]=fn end
  function f:RegisterEvent(e)self.events[e]=true handlers[e]=handlers[e] or {} table.insert(handlers[e],self) end
  function f:SetIgnoreParentScale(v)end
  function f:SetScale(v)end
  function f:Show()self.shown=true end
  function f:Hide()self.shown=false end
  function f:SetSize(w,h)self.w,self.h=w,h end
  function f:ClearAllPoints()end
  function f:SetPoint(p)self.point=p end
  function f:CreateTexture()
    local t={}
    for _,k in ipairs({'SetSize','ClearAllPoints','SetPoint','Show','Hide'}) do t[k]=function()end end
    function t:SetColorTexture(r,g,b)self.c={math.floor(r*255+.5),math.floor(g*255+.5),math.floor(b*255+.5)} end
    textures[#textures+1]=t return t
  end
  for _,k in ipairs({'SetFrameStrata','SetFrameLevel'})do f[k]=function()end end
  frames[#frames+1]=f return f
end
local function fire(e,...) for _,f in ipairs(handlers[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
fire('PLAYER_LOGIN')
local function strip() for _,f in ipairs(frames) do if f.scripts.OnUpdate then return f end end end
local function tick(dt) local s=strip() clock=clock+dt s.scripts.OnUpdate(s,dt) end
local function row(n,first) local a={} for i=first,first+n-1 do local c=textures[i].c or {0,0,0} a[#a+1]='['..c[1]..','..c[2]..','..c[3]..']' end return '['..table.concat(a,',')..']' end
local function rows() return string.format('%.2f',clock)..'|'..row(42,1)..'|'..row(36,43) end
`;
function decodeRows(r1, r2) {
  const width = 200, height = 16, rgb = Buffer.alloc(width * height * 3, 30);
  [r1, r2].forEach((cells, r) => cells.forEach((c, i) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = ((r * 2 + dy) * width + i * 2 + dx) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; }
  }));
  return L.decodeStrip({ width, height, rgb });
}
// Runs the painted strip for `seconds` after queueing `text`, one line per 0.2s tick.
function paint(text, { seconds = 30, before = "", during = "" } = {}) {
  const out = lua(HARNESS + `
BackstageForeverLiveCommand('live on')
tick(1) tick(1)
${before}
local id,count=BackstageForeverLiveQuestion(${luaString(text)})
print(tostring(id)..' '..tostring(count))
for i=1,${Math.round(seconds / 0.2)} do ${during} tick(0.2) print(rows()) end
print(tostring(BackstageForeverLiveQuestionStatus()))`).split("\n");
  const [id, count] = out[0].split(" ").map(Number);
  const frames = out.slice(1, -1).map((l) => { const [t, a, b] = l.split("|"); const d = decodeRows(JSON.parse(a), JSON.parse(b)); assert.ok(d && d.page, `strip at ${t} decodes`); return { t: Number(t), bytes: d.bytes, page: d.page }; });
  return { id, count, frames, after: out.at(-1) };
}
// The sequence of distinct pages (each change of the second row), with when it went up.
function shown(frames) {
  const seq = [];
  for (const f of frames) { const key = f.page.join(","); if (!seq.length || seq.at(-1).key !== key) seq.push({ key, t: f.t, page: f.page }); }
  return seq;
}

test("a 200-character question goes up in bursts of four 0.4s pages between ordinary pages, twice, then the strip returns to normal", () => {
  const text = "Where do I find the flight master and the innkeeper in Crossroads, and which quests there are good for level 14? Also where can I train First Aid nearby?";
  const full = (text + " Thanks a lot for the help, friend!").padEnd(200, "!"); // 200 ASCII characters = 200 bytes
  assert.equal(full.length, 200);
  const { id, count, frames, after } = paint(full);
  assert.equal(id, 1); assert.equal(count, 12, "200 bytes, 17 a page");
  const seq = shown(frames);
  const kinds = seq.map((s) => (s.page[1] === 4 ? "q" : "N")).join("");
  // Pass 1: 12 question pages in bursts of 4 with one ordinary page between; then pass 2.
  assert.match(kinds, /^qqqqNqqqqNqqqqNqqqqNqqqqNqqqqN+$/, kinds);
  const q = seq.filter((s) => s.page[1] === 4);
  assert.deepEqual(q.map((s) => s.page[3]), [...Array(12).keys(), ...Array(12).keys()], "every chunk twice, in order");
  // Timing: question pages stay up two ticks (0.4s); ordinary pages one second.
  const dwell = seq.slice(0, -1).map((s, i) => Math.round((seq[i + 1].t - s.t) * 10) / 10);
  const lastQuestion = seq.map((s) => s.page[1]).lastIndexOf(4);
  for (let i = 0; i <= lastQuestion; i++) assert.equal(dwell[i], seq[i].page[1] === 4 ? 0.4 : 1, `page ${i} (${kinds[i]}) stayed ${dwell[i]}s`);
  const firstPass = seq.findIndex((s, i) => s.page[1] === 4 && s.page[3] === 11) + 1;
  const pass1 = Math.round((seq[firstPass].t - seq[0].t) * 10) / 10;
  const lastQ = seq.map((s) => s.page[1]).lastIndexOf(4);
  const both = Math.round((seq[lastQ + 1].t - seq[0].t) * 10) / 10;
  assert.equal(pass1, 6.8, "one full pass: 12 x 0.4s + 2 ordinary pages");
  assert.equal(both, 14.6, "both passes");
  assert.equal(after, "nil", "nothing left to send");
  // The bridge assembles it once, from the first pass alone.
  let t = 1_000;
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  bridge.frame = { characterHash: L.identityHash("Player-1-ABC") };
  const got = [];
  bridge.subscribeQuestions((x) => got.push(x));
  for (const s of seq) { t = 1000 + s.t * 1000; if (s.page[1] === 4) bridge.questionPage(L.parseQuestionPage(s.page)); }
  clearTimeout(bridge.slowTimer);
  assert.equal(got.length, 1, "the second pass is a duplicate");
  assert.equal(got[0].text, full); assert.equal(got[0].id, 1);
  console.log(`[throughput] 200 ASCII chars: ${count} pages x 17 bytes; one pass ${pass1}s, both passes ${both}s; ${(17 / 0.4).toFixed(1)} bytes/s during a burst, ${(200 / pass1).toFixed(1)} bytes/s overall`);
});

test("missed pages are filled from the second pass; non-ASCII arrives intact; quest pages keep flowing", () => {
  const text = SAMPLES.cjk + " " + SAMPLES.accents; // multi-byte characters across page borders
  const { count, frames } = paint(text, { seconds: 20 });
  const seq = shown(frames);
  assert.equal(count, Math.ceil(Buffer.byteLength(text) / 17));
  let t = 0;
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  bridge.frame = { characterHash: L.identityHash("Player-1-ABC") };
  const got = [];
  bridge.subscribeQuestions((x) => got.push(x));
  // Drop every third question page of the first pass (a slow capture), keep the second pass.
  const qs = seq.filter((s) => s.page[1] === 4);
  qs.forEach((s, i) => { t = s.t * 1000; if (i < count && i % 3 === 1) return; bridge.questionPage(L.parseQuestionPage(s.page)); });
  clearTimeout(bridge.slowTimer);
  assert.equal(got.length, 1); assert.equal(got[0].text, text);
  const normal = seq.filter((s) => s.page[1] !== 4).map((s) => L.parsePage(s.page)?.kind);
  assert.ok(normal.includes("questLog"), "quest log pages between bursts");
});

test("no question page goes up in combat; the question waits and goes up after; live off refuses", () => {
  const { frames } = paint("Where is my class trainer?", { seconds: 6, before: "COMBAT=true", during: "if i==15 then COMBAT=false end" });
  const seq = shown(frames);
  const firstQ = seq.find((s) => s.page[1] === 4);
  assert.ok(firstQ, "sent after combat");
  assert.ok(firstQ.t >= 102 + 15 * 0.2 - 0.01, `not before combat ended (${firstQ.t})`);
  for (const f of frames) if (f.bytes[10] & 1) assert.notEqual(f.page[1], 4, "no question page while the main row says combat");
  const out = lua(HARNESS + `
BackstageForeverLiveCommand('live off')
print(BackstageForeverLiveQuestion('hello'))
BackstageForeverLiveCommand('live on')
print(BackstageForeverLiveQuestion(''))
print(BackstageForeverLiveQuestion(string.rep('a',601)))
print(BackstageForeverLiveQuestion('one'), BackstageForeverLiveQuestion('two'), BackstageForeverLiveQuestion('three'))
print(BackstageForeverLiveQuestion('four'))
print(BackstageForeverLiveSettings.questionSeq)`).split("\n");
  assert.deepEqual(out, ["nil\toff", "nil\tinvalid", "nil\tinvalid", "1\t2\t3\t1", "nil\tbusy", "3"]);
});

test("question ids continue across reloads and wrap at 255", () => {
  const out = lua(HARNESS + `
BackstageForeverLiveSettings.questionSeq=254
print((BackstageForeverLiveQuestion('a')))
print((BackstageForeverLiveQuestion('b')))`).split("\n");
  assert.deepEqual(out, ["255", "1"]);
});

test("bridge: questions bind to the character on the main row, are reported once and speed up sampling for a while", () => {
  let t = 10_000;
  const writes = [];
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  bridge.child = { stdin: { write: (s) => writes.push(s) } };
  const got = [];
  bridge.subscribeQuestions((q) => got.push(q));
  const pages = L.encodeQuestionPages(5, "How do I get to Thunder Bluff?", 4242).map(L.parseQuestionPage);
  bridge.frame = { characterHash: 1 };
  for (const p of pages) bridge.questionPage(p);
  assert.equal(got.length, 0, "another character's question is ignored");
  assert.deepEqual(writes, []);
  bridge.frame = { characterHash: 4242 };
  bridge.questionPage(pages[1]);
  assert.deepEqual(writes, [`interval ${L.QUESTION_INTERVAL_MS}\n`], "faster sampling as soon as a question page shows");
  bridge.questionPage(pages[0]);
  assert.equal(got.length, 1); assert.deepEqual({ ...got[0], at: 0 }, { id: 5, text: "How do I get to Thunder Bluff?", characterHash: 4242, at: 0 });
  for (const p of pages) bridge.questionPage(p);
  assert.equal(got.length, 1, "repeats are ignored");
  // The same id with other text (the addon reloaded without saving its counter) is a new question.
  for (const p of L.encodeQuestionPages(5, "Where is Grimtotem Post?", 4242).map(L.parseQuestionPage)) bridge.questionPage(p);
  assert.equal(got.length, 2); assert.equal(got[1].text, "Where is Grimtotem Post?");
  // Half a question older than 90 seconds is forgotten.
  const two = L.encodeQuestionPages(6, "q".repeat(40), 4242).map(L.parseQuestionPage);
  bridge.questionPage(two[0]); t += 91000; bridge.questionPage(two[1]); bridge.questionPage(two[2]);
  assert.equal(got.length, 2);
  bridge.questionPage(two[0]);
  assert.equal(got.length, 3);
  clearTimeout(bridge.slowTimer);
  bridge.sendInterval(500);
  assert.equal(writes.at(-1), "interval 500\n");
});

test("bridge: question pages on a captured compact strip reach subscribers through line(); the game window rectangle is kept while fresh", () => {
  let t = 5_000_000;
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  bridge.enabled = true;
  const got = [];
  bridge.subscribeQuestions((q) => got.push(q));
  const frame = new Array(27).fill(0);
  frame[0] = 4; frame[1] = 3; frame[8] = 12; frame[23] = 4242 >> 8; frame[24] = 4242 & 255; frame[25] = 1; frame[26] = L.crc8(frame, 26);
  const row1 = L.encodeCellsV4(Uint8Array.from(frame));
  for (const page of L.encodeQuestionPages(3, "Wo ist der Flugmeister?", 4242)) {
    const row2 = L.encodePageCellsV4(page), width = 200, height = 16, rgb = Buffer.alloc(width * height * 3, 30);
    [row1, row2].forEach((cells, r) => cells.forEach((c, i) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = ((r * 2 + dy) * width + i * 2 + dx) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } }));
    bridge.line(`ok topleft ${width} ${height} ${rgb.toString("base64")}`);
  }
  clearTimeout(bridge.slowTimer);
  assert.deepEqual(got.map((q) => q.text), ["Wo ist der Flugmeister?"]);
  assert.equal(bridge.gameWindow(), null);
  bridge.line("rect 1920 0 2560 1440");
  assert.deepEqual(bridge.gameWindow(), { x: 1920, y: 0, width: 2560, height: 1440 });
  bridge.line("rect nope 0 1 1"); bridge.line("rect 0 0 0 10");
  assert.deepEqual(bridge.gameWindow(), { x: 1920, y: 0, width: 2560, height: 1440 }, "bad lines are ignored");
  t += 16000;
  assert.equal(bridge.gameWindow(), null, "stale after 15 seconds");
  bridge.line("rect -1280 100 1280 720"); bridge.line("minimized");
  assert.equal(bridge.gameWindow(), null, "a minimized game has no rectangle");
});

test("the capture worker accepts only bounded interval changes and reports the client rectangle; no input APIs", () => {
  const w = L.WORKER;
  assert.match(w, /p\[0\] == "interval" && int\.TryParse\(p\[1\], out ms\) && ms >= 100 && ms <= 2000/);
  assert.match(w, /Start-Sleep -Milliseconds \(\[BFLiveCapture\]::Delay\(\)\)/);
  assert.match(w, /"rect " \+ p\.X/);
  assert.doesNotMatch(w, /SendInput|keybd_event|mouse_event|ReadProcessMemory|OpenProcess|PostMessage|SendMessage|SetForegroundWindow/);
});

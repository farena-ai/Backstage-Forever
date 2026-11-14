"use strict";
// 0.33 "live moments": the addon's kind 3 pages (a ring of recent moments on the strip's second
// row) and the moments it records in game. The Lua encoder and the app decoder must agree byte
// for byte, pages must interleave with the quest pages, and the bridge must report each once.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const bytesJson = (v) => `do local a={} for _,x in ipairs(${v}) do a[#a+1]=x end print('['..table.concat(a,',')..']') end`;

test("Lua moments pages match the app encoder byte for byte and decode back", () => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local ev={{type=1,seq=9,at=100,a=1732,b=17*256+72,c=1+2*2+1*16},{type=2,seq=8,at=97.5,a=448,b=40,c=1},{type=5,seq=7,at=-5,a=186,b=75,c=15},{type=8,seq=6,at=10,a=272998,b=123,c=5},{type=6,seq=5,at=100,a=1436,b=0,c=0}}
local pages=BackstageForeverLiveMomentPages(ev,4242,101)
print(#pages)
for _,p in ipairs(pages) do ${bytesJson("p")} end
print(#BackstageForeverLiveMomentPages({},4242,1))`).split("\n");
  assert.equal(Number(out[0]), 3, "five moments, two to a page");
  const js = L.encodeMomentPages([
    { type: 1, seq: 9, age: 1, a: 1732, b: 17 * 256 + 72, c: 1 + 2 * 2 + 16 }, { type: 2, seq: 8, age: 3.5, a: 448, b: 40, c: 1 },
    { type: 5, seq: 7, age: 106, a: 186, b: 75, c: 15 }, { type: 8, seq: 6, age: 91, a: 272998, b: 123, c: 5 }, { type: 6, seq: 5, age: 1, a: 1436, b: 0, c: 0 },
  ], 4242);
  for (let i = 0; i < 3; i++) assert.deepEqual(JSON.parse(out[1 + i]), js[i], `page ${i}`);
  assert.equal(Number(out[4]), 0, "no moments: no pages");
  const p0 = L.parseMomentPage(js[0]), p2 = L.parseMomentPage(js[2]);
  assert.equal(p0.kind, "moments"); assert.equal(p0.identity, 4242); assert.equal(p0.total, 5); assert.equal(p0.newest, 9);
  assert.deepEqual(p0.moments[0], { type: 1, seq: 9, ageS: 1, a: 1732, b: 17 * 256 + 72, c: 5 + 16 });
  assert.deepEqual(p0.moments[1], { type: 2, seq: 8, ageS: 3, a: 448, b: 40, c: 1 });
  assert.equal(p2.moments.length, 1, "the last page carries only the fifth moment");
  assert.equal(L.parsePage(js[0]), null, "quest-page parsers (and apps before 0.33) ignore kind 3");
  const bad = [...js[0]]; bad[8] ^= 1;
  assert.equal(L.decodeCellsV4(L.encodePageCellsV4(bad), [[0, 85, 170, 255], [0, 85, 170, 255], [0, 85, 170, 255]], L.PAGE_VERSION), null, "a corrupted page fails its CRC");
});

// A painted strip: Live.lua with Moments.lua, stubbed frames and a clock.
const HARNESS = String.raw`
local frames,textures,handlers={}, {}, {}
local clock=100
GetTime=function() return clock end
UIParent={GetEffectiveScale=function()return 1 end}
GetPhysicalScreenSize=function()return 1920,1080 end
local messages={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)messages[#messages+1]=m end}
local SECRET=setmetatable({},{__tostring=function()return 'secret'end})
issecretvalue=function(v)return v==SECRET end
UnitGUID=function(u) if u=='player' then return 'Player-1-ABC' end if u=='target' then return TARGET end end
UnitLevel=function(u) if u=='target' then return 17 end return 12 end
UnitClassification=function(u) return TARGET_CLASS end
UnitName=function(u) return TARGET_NAME end
UnitIsPlayer=function() return false end
UnitHealth=function()return 50 end UnitHealthMax=function()return 100 end
COMBAT=false
InCombatLockdown=function()return COMBAT end
INSTANCE=false
IsInInstance=function() return INSTANCE end
C_Map={GetBestMapForUnit=function()return 1436 end,GetPlayerMapPosition=function()return {GetXY=function()return 0.5,0.5 end}end,GetMapInfo=function(id) return {mapType=3} end}
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
dofile('addon/BackstageForever/BackstageForeverMoments.lua')
fire('PLAYER_LOGIN')
local function strip() for _,f in ipairs(frames) do if f.scripts.OnUpdate then return f end end end
local function tick(dt) local s=strip() clock=clock+dt s.scripts.OnUpdate(s,dt) end
local function row(n,first) local a={} for i=first,first+n-1 do local c=textures[i].c or {0,0,0} a[#a+1]='['..c[1]..','..c[2]..','..c[3]..']' end return '['..table.concat(a,',')..']' end
local function rows() return row(42,1)..'\n'..row(36,43) end
`;
function strip(rowsText) {
  const [r1, r2] = rowsText.split("\n").map((x) => JSON.parse(x));
  const width = 200, height = 16, rgb = Buffer.alloc(width * height * 3, 30);
  [r1, r2].forEach((cells, r) => cells.forEach((c, i) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = ((r * 2 + dy) * width + i * 2 + dx) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; }
  }));
  return L.decodeStrip({ width, height, rgb });
}

test("a new moment is on the strip at the next page, then alternates with quest pages until shown four times", () => {
  const out = lua(HARNESS + String.raw`
BackstageForeverLiveCommand('live on')
tick(1) print(rows())                                   -- quest page, nothing happened yet
BackstageForeverLiveMoment(5,186,75,15)
tick(0.2) print(rows())                                 -- the moment, straight away
for _=1,8 do tick(2) print(rows()) end
COMBAT=true BackstageForeverLiveMoment(2,448,17,1) tick(1) tick(1) print(rows()) COMBAT=false
tick(0.2) print(rows())                                 -- after combat: the new moment first
print(BackstageForeverLiveSettings.momentSeq)`).split("\n");
  const pages = [];
  for (let i = 0; i + 1 < out.length - 1; i += 2) { const d = strip(out[i] + "\n" + out[i + 1]); assert.ok(d && d.page, `strip ${i / 2} decodes`); pages.push(d.page); }
  const kinds = pages.map((p) => (p[1] === 3 ? "M" : "Q"));
  assert.equal(kinds[0], "Q");
  assert.deepEqual(kinds.slice(1, 10).join(""), "MQMQMQMQQ", "shown four times, interleaved, then quest pages only");
  const m = L.parseMomentPage(pages[1]);
  assert.deepEqual(m.moments.map((x) => [x.type, x.seq, x.a, x.b, x.c]), [[5, 1, 186, 75, 15]]);
  assert.equal(m.identity, L.identityHash("Player-1-ABC"));
  assert.equal(L.parsePage(pages[0]).kind, "questLog", "quest pages keep flowing");
  assert.equal(kinds[10], "Q", "nothing new on the second row during combat");
  const after = L.parseMomentPage(pages[11]);
  assert.deepEqual(after.moments.map((x) => [x.type, x.seq, x.ageS]), [[2, 2, 2], [5, 1, 18]], "newest first, with ages");
  assert.equal(Number(out[out.length - 1]), 2, "the sequence is saved with the live settings (kept across reloads)");
});

test("moments.lua: kills, bosses, deaths, professions, flight paths and upgrades become strip moments", () => {
  const out = lua(HARNESS + String.raw`
local got={}
local real=BackstageForeverLiveMoment
BackstageForeverLiveMoment=function(k,a,b,c) got[#got+1]=table.concat({k,a,b,c},',') return real(k,a,b,c) end
local toasts={}
BackstageForeverToast=function(t,s) toasts[#toasts+1]=t..' | '..(s or '') end
local ev
CombatLogGetCurrentEventInfo=function() return table.unpack(ev) end
local function log(...) ev={0,...} fire('COMBAT_LOG_EVENT_UNFILTERED') end
-- An elite you targeted and fought dies: one elite moment; its toast waits for the end of combat.
TARGET='Creature-0-1-2-3-1732-0000' TARGET_CLASS='elite' TARGET_NAME='Defias Pillager'
fire('PLAYER_TARGET_CHANGED')
COMBAT=true
log('SWING_DAMAGE',false,'Player-1-ABC','Me',0,0,TARGET,'Defias Pillager',0,0,40)
log('UNIT_DIED',false,'',nil,0,0,TARGET,'Defias Pillager')
log('PARTY_KILL',false,'Player-1-ABC','Me',0,0,TARGET,'Defias Pillager')
assert(#got==1 and got[1]=='2,1732,17,1',got[1])
assert(#toasts==0,'no toast in combat')
COMBAT=false fire('PLAYER_REGEN_ENABLED')
assert(#toasts==1 and toasts[1]:find('Elite defeated',1,true) and toasts[1]:find('Defias Pillager',1,true),toasts[1])
-- A creature you never fought dies: nothing.
log('UNIT_DIED',false,'',nil,0,0,'Creature-0-1-2-3-99-0001','Boar')
assert(#got==1)
-- Dungeon trash is elite: no moment inside an instance; the boss comes from ENCOUNTER_END with the NPC that just died.
INSTANCE=true
TARGET='Creature-0-1-2-3-639-0002' TARGET_CLASS='elite' TARGET_NAME='Edwin VanCleef' fire('PLAYER_TARGET_CHANGED')
log('SPELL_DAMAGE',false,TARGET,'Edwin VanCleef',0,0,'Player-1-ABC','Me',0,0,1,'Strike',1,50)
log('UNIT_DIED',false,'',nil,0,0,TARGET,'Edwin VanCleef')
assert(#got==1,'elite trash inside instances is quiet')
fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1)
assert(got[2]=='4,639,1144,1',got[2])
fire('ENCOUNTER_END',1144,'Edwin VanCleef',1,5,1) assert(#got==2,'one boss moment per kill')
fire('ENCOUNTER_END',1145,'Wipe',1,5,0) assert(#got==2,'a wipe is not a moment')
INSTANCE=false
-- Rares count anywhere; world bosses are bosses.
TARGET='Creature-0-1-2-3-462-0003' TARGET_CLASS='rareelite' TARGET_NAME='Vultros' fire('PLAYER_TARGET_CHANGED')
log('SWING_DAMAGE',false,'Player-1-ABC','Me',0,0,TARGET,'Vultros',0,0,40) log('UNIT_DIED',false,'',nil,0,0,TARGET,'Vultros')
assert(got[3]=='3,462,17,3',got[3])
-- Death: the review travels as killer NPC, level and share, elite flag, tip and helpers.
BackstageForeverMomentsDeath({killer='Defias Pillager',npc=1732,level=17,share=72,elite=true,others=1,tipCode=2})
assert(got[4]=='1,1732,'..(17*256+72)..','..(1+2*2+16),got[4])
BackstageForeverMomentsDeath(nil) assert(got[5]=='1,0,0,10','a death with no recent hits still counts')
-- Professions: silent first scan, then each 25 and the rank limit.
local mining=70
C_SkillInfo={GetNumSkillLines=function() return 2 end,GetSkillLineInfo=function(i) if i==1 then return {isHeader=true,name='Professions'} end return {isHeader=false,skillID=186,name='Mining',rank=mining,maxRank=75} end}
fire('SKILL_LINES_CHANGED') assert(#got==5,'first scan is silent')
mining=74 fire('SKILL_LINES_CHANGED') assert(#got==5)
mining=75 fire('CHAT_MSG_SKILL') assert(got[6]=='5,186,75,15',got[6])
assert(toasts[#toasts]:find('Mining 75',1,true) and toasts[#toasts]:find('Journeyman Mining',1,true),toasts[#toasts])
-- Flight path: the game's own "new flight path" message.
ERR_NEWTAXIPATH='New flight path discovered!'
fire('UI_INFO_MESSAGE',0,'Something else') fire('UI_INFO_MESSAGE',0,'New flight path discovered!')
assert(got[7]=='7,1436,0,0',got[7])
-- Zone: called by the journal for a first visit.
BackstageForeverMomentsZone(1436) assert(got[8]=='6,1436,0,0')
-- Upgrade: scored like the gear helper; swaps between slots do not count.
local equipped={[5]='item:100',[11]='item:200',[12]='item:300'}
GetInventoryItemLink=function(_,slot) return equipped[slot] end
BackstageForeverGear={item=function(l) return {id=tonumber(l:match('item:(%d+)')),stats={}} end,context=function() return {} end,
  score=function(it) return {score=it.id/10,usable=true,reasons={}} end}
fire('PLAYER_ENTERING_WORLD')
equipped[5]='item:150' fire('PLAYER_EQUIPMENT_CHANGED',5)
assert(got[9]=='8,150,50,5',got[9])
equipped[11],equipped[12]='item:300','item:200' fire('PLAYER_EQUIPMENT_CHANGED',11) fire('PLAYER_EQUIPMENT_CHANGED',12)
assert(#got==9,'a ring swap is not an upgrade')
equipped[5]='item:120' fire('PLAYER_EQUIPMENT_CHANGED',5) assert(#got==9,'a downgrade is not a moment')
-- /bf moments off silences toasts, never the app.
local before=#toasts
BackstageForeverMomentsCommand('moments off')
assert(BackstageForeverMomentsSettings.toasts==false)
TARGET='Creature-0-1-2-3-1733-0009' TARGET_CLASS='elite' fire('PLAYER_TARGET_CHANGED')
log('SWING_DAMAGE',false,'Player-1-ABC','Me',0,0,TARGET,'X',0,0,40) log('UNIT_DIED',false,'',nil,0,0,TARGET,'X')
assert(#got==10 and #toasts==before,'moment still sent, toast silent')
BackstageForeverMomentsCommand('moments on') assert(BackstageForeverMomentsSettings.toasts==true)
-- Secret values are unknown, never errors.
TARGET='Creature-0-1-2-3-1734-0010' TARGET_CLASS=SECRET TARGET_NAME=SECRET fire('PLAYER_TARGET_CHANGED')
log('SWING_DAMAGE',false,'Player-1-ABC','Me',0,0,TARGET,'X',0,0,40) log('UNIT_DIED',false,'',nil,0,0,TARGET,'X')
assert(#got==10,'unknown classification: no moment')
print('ok')`);
  assert.equal(out.split("\n").pop(), "ok");
});

test("moments.lua pure helpers: kill kinds, skill steps, death parameters and toast text", () => {
  const out = lua(String.raw`dofile('addon/BackstageForever/BackstageForeverMoments.lua')
local K=BackstageForeverMomentsKillType
assert(K('elite',false)==2 and K('elite',true)==nil and K('rare',true)==3 and K('rareelite',false)==3 and K('worldboss',true)==4 and K('normal',false)==nil and K(nil,false)==nil)
local S=BackstageForeverMomentsSkillStep
assert(S(nil,30,75)==nil and S(30,30,75)==nil and S(49,50,75)=='milestone' and S(50,51,75)==nil and S(74,75,75)=='cap' and S(148,150,150)=='cap' and S(24,26,150)=='milestone')
local a,b,c=BackstageForeverMomentsDeathParams({npc=3,level=300,share=150,others=20,tipCode=9})
assert(a==3 and b==255*256+100 and c==5*2+7*16,c)
assert(select(1,BackstageForeverMomentsToastText(4,{name='Hogger'}))=='Boss defeated!')
assert(BackstageForeverMomentsToastText(6,{})==nil and BackstageForeverMomentsToastText(1,{})==nil,'zones and deaths have their own messages')
local t,s=BackstageForeverMomentsToastText(5,{skill='Mining',rank=300,max=300,cap=true}) assert(s=='Mining mastered!',s)
local t2,s2=BackstageForeverMomentsToastText(5,{skill='Herbalism',rank=100,max=150}) assert(t2=='Herbalism 100' and s2:find('125',1,true),s2)
print('ok')`);
  assert.equal(out, "ok");
});

test("bridge: moments are reported once, bound to the character, oldest first, and stale ones are skipped", () => {
  let t = 1_000_000;
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  const got = [];
  bridge.subscribeMoments((m) => got.push(m));
  bridge.frame = { characterHash: 4242 };
  const pages = L.encodeMomentPages([{ type: 2, seq: 8, age: 1, a: 448, b: 40, c: 1 }, { type: 1, seq: 7, age: 3, a: 1732, b: 4424, c: 5 }, { type: 6, seq: 6, age: 200, a: 1436, b: 0, c: 0 }], 4242);
  bridge.momentPage(L.parseMomentPage(pages[0]));
  assert.deepEqual(got.map((m) => [m.type, m.seq]), [[1, 7], [2, 8]], "oldest first");
  assert.equal(got[0].at, t - 3000); assert.equal(got[0].characterHash, 4242);
  bridge.momentPage(L.parseMomentPage(pages[0]));
  bridge.momentPage(L.parseMomentPage(pages[1]));
  assert.equal(got.length, 2, "repeats and moments older than two minutes are not reported");
  // The same sequence number with different content (the addon reloaded without saving) is new.
  bridge.momentPage(L.parseMomentPage(L.encodeMomentPages([{ type: 2, seq: 8, age: 0, a: 449, b: 40, c: 1 }], 4242)[0]));
  assert.equal(got.length, 3);
  bridge.frame = { characterHash: 1 };
  bridge.momentPage(L.parseMomentPage(L.encodeMomentPages([{ type: 3, seq: 9, age: 0, a: 1, b: 1, c: 2 }], 4242)[0]));
  assert.equal(got.length, 3, "another character's moments are ignored");
});

test("bridge: a moments page on a captured compact strip reaches subscribers through line()", () => {
  let t = 5_000_000;
  const bridge = new L.LiveBridge({ platform: "linux", now: () => t });
  bridge.enabled = true;
  const got = [];
  bridge.subscribeMoments((m) => got.push(m));
  const frame = new Array(27).fill(0);
  frame[0] = 4; frame[1] = 3; frame[8] = 12; frame[23] = 4242 >> 8; frame[24] = 4242 & 255; frame[25] = 1; frame[26] = L.crc8(frame, 26);
  const row1 = L.encodeCellsV4(Uint8Array.from(frame)), row2 = L.encodePageCellsV4(L.encodeMomentPages([{ type: 4, seq: 3, age: 0, a: 639, b: 1144, c: 1 }], 4242)[0]);
  const width = 200, height = 16, rgb = Buffer.alloc(width * height * 3, 30);
  [row1, row2].forEach((cells, r) => cells.forEach((c, i) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = ((r * 2 + dy) * width + i * 2 + dx) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } }));
  bridge.line(`ok topleft ${width} ${height} ${rgb.toString("base64")}`);
  assert.deepEqual(got.map((m) => [m.type, m.a, m.b]), [[4, 639, 1144]]);
});

test("moments.lua defines only its own globals, guards API values and never replaces a game function", () => {
  const src = require("node:fs").readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverMoments.lua"), "utf8");
  for (const m of src.matchAll(/^(?:function\s+([A-Za-z_][\w.:]*)|([A-Za-z_][\w.]*)\s*=)/gm)) {
    const name = m[1] || m[2];
    assert.match(name, /^BackstageForever/, `global ${name}`);
  }
  assert.doesNotMatch(src, /hooksecurefunc|SecureHook|RunMacro|CastSpell|UseAction|TargetUnit|Equip(Item|Cursor)/, "reads and reports only");
  assert.match(src, /issecretvalue/);
  const toc = require("node:fs").readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8");
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverMomentsSettings/);
});

test("death review carries the killer's NPC id and a tip code for the app", () => {
  const out = lua(String.raw`dofile('addon/BackstageForever/BackstageForeverCombat.lua')
local r=BackstageForeverDeathReview({{t=99,source='Defias Pillager',amount=300,level=17,elite=true,npc=589},{t=99,source='Defias Thug',amount=100,npc=38}},100,15)
print(r.npc,r.tipCode,r.share,r.others)`);
  assert.equal(out, "589\t2\t75\t1");
});

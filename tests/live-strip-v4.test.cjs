"use strict";
// 0.32 "quiet live strip": compact version 4 strip (2px cells, calibrated four levels per
// channel), corner placement, idle heartbeat, and back-compat with version 3 / 2 strips.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const STATE = "{seq=7,heartbeat=19,mapId=1454,x=0.4321,y=0.6543,level=12,health=88,targetNpcId=3057,targetHealth=100,xp=42,freeSlots=9,questId=93739,objectives=5,questHash=201,facing=1.5,resting=true,identity=4242}";
const list = (v) => `local a={} for _,x in ipairs(${v}) do a[#a+1]=x end`;
const cellsJson = (v) => `local a={} for _,c in ipairs(${v}) do a[#a+1]='['..c[1]..','..c[2]..','..c[3]..']' end print('['..table.concat(a,',')..']')`;
// Lua compact frame row + bytes, and a compact pages row.
function luaCompact(state = STATE) {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local b=BackstageForeverLivePayload(${state})
${cellsJson("BackstageForeverLiveCompactCells(b,true)")}
${list("b")} print('['..table.concat(a,',')..']')
local p=BackstageForeverLivePages(1,{{id=93739,complete=true},{id=812,complete=false}},4242)[1]
${cellsJson("BackstageForeverLiveCompactCells(p,false)")}`).split("\n");
  return { cells: JSON.parse(out[0]), bytes: JSON.parse(out[1]), page: JSON.parse(out[2]) };
}
const COMPACT = luaCompact();
const V3BYTES = (() => { const b = Uint8Array.from(COMPACT.bytes); b[0] = 3; b[26] = L.crc8(b, 26); return b; })();

// Paints strip rows into a capture region with the strip anchored at `corner`.
// `map` distorts each channel value; `noise` adds deterministic +-noise per pixel.
function region(rows, { corner = "topleft", cell = 2, width = L.REGION.width, height = L.REGION.height, map = null, noise = 0, background = 30, inset = 0 } = {}) {
  const rgb = Buffer.alloc(width * height * 3, background);
  const stripW = Math.max(...rows.map((r) => r.length)) * cell;
  const ox = corner.endsWith("right") ? width - stripW - inset : inset, oy = corner.startsWith("bottom") ? height - rows.length * cell - inset : inset;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  rows.forEach((cells, r) => cells.forEach((c, i) => {
    for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
      const o = ((oy + r * cell + dy) * width + ox + i * cell + dx) * 3;
      for (let ch = 0; ch < 3; ch++) rgb[o + ch] = clamp((map ? map(c[ch]) : c[ch]) + (noise ? (rnd() * 2 - 1) * noise : 0));
    }
  }));
  return { width, height, rgb };
}
const remote = (v) => 40 + 215 * Math.pow(v / 255, 0.55); // 85 -> ~157, 170 -> ~212 (observed over remote access)
const SHIFTS = {
  none: {},
  "gamma 2.2": { map: (v) => 255 * Math.pow(v / 255, 2.2) },
  "gamma 0.45": { map: (v) => 255 * Math.pow(v / 255, 0.45) },
  remote: { map: remote },
  "remote + noise 6": { map: remote, noise: 6 },
  "dim and lifted": { map: (v) => 60 + v * 0.5 },
  "brightness +40": { map: (v) => v + 40 },
  "brightness -40": { map: (v) => v - 40 },
  "noise 8": { noise: 8 },
};

test("Lua compact cells match the app encoder byte for byte; frames default to version 4", () => {
  const { cells, bytes, page } = COMPACT;
  assert.equal(bytes[0], 4, "the addon emits version 4 by default");
  assert.equal(bytes[25], 19, "heartbeat byte");
  assert.deepEqual(L.encodeCellsV4(Uint8Array.from(bytes)), cells);
  assert.equal(cells.length, 42, "6 header cells + 36 payload cells");
  assert.deepEqual(cells.slice(0, 6), [[255, 0, 255], [255, 0, 255], [0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]]);
  assert.ok(cells.slice(6).every((c) => c.every((v) => L.V4.levels.includes(v))), "payload uses only the four calibrated levels");
  assert.equal(page.length, 36, "pages row has no header");
  assert.deepEqual(L.encodePageCellsV4(L.encodePages(1, [{ id: 93739, complete: true }, { id: 812, complete: false }], 4242)[0]), page);
  const f = L.parsePayload(L.decodeCells(cells));
  assert.equal(f.version, 4); assert.equal(f.heartbeat, 19); assert.equal(f.seq, 7);
  assert.equal(f.position.mapId, 1454);
  assert.deepEqual(f.quest, { id: 93739, objectivesDone: [1, 3] });
  assert.equal(f.characterHash, 4242);
});

test("compact strip round-trips through colour shifts and noise at 2px and 3px cells", () => {
  for (const cell of [2, 3]) for (const [name, opts] of Object.entries(SHIFTS)) {
    const d = L.decodeStrip(region([COMPACT.cells, COMPACT.page], { cell, ...opts }));
    assert.ok(d, `${name} at ${cell}px`);
    assert.equal(d.version, 4); assert.equal(d.mode, "compact");
    assert.equal(d.pitch, cell, `pitch measured at ${cell}px`);
    assert.deepEqual(d.footprint, { width: 42 * cell, height: 2 * cell });
    assert.equal(L.parsePayload(d.bytes).position.mapId, 1454, name);
    assert.deepEqual(L.parsePage(d.page).ids, [{ id: 93739, complete: true }, { id: 812, complete: false }], `${name} pages at ${cell}px`);
  }
});

test("compact strip footprint is 84 x 4 physical pixels for both rows", () => {
  const d = L.decodeStrip(region([COMPACT.cells, COMPACT.page]));
  assert.deepEqual(d.footprint, { width: 84, height: 4 });
  const layout = JSON.parse(lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local c=BackstageForeverLiveLayout(false) local s=BackstageForeverLiveLayout(true,'bottomright')
print('{"compact":['..c.width..','..c.height..','..c.cell..',"'..c.point..'"],"safe":['..s.width..','..s.height..','..s.cell..',"'..s.point..'"]}')`));
  assert.deepEqual(layout, { compact: [84, 4, 2, "TOPLEFT"], safe: [456, 12, 6, "BOTTOMRIGHT"] });
});

test("strips are found in every corner, compact and safe, with offsets", () => {
  for (const corner of L.CORNERS) {
    for (const cell of [2, 3]) {
      const d = L.decodeStrip(region([COMPACT.cells, COMPACT.page], { corner, cell, map: remote }), { corner });
      assert.ok(d && d.version === 4, `compact ${corner} ${cell}px`);
      assert.ok(L.parsePage(d.page), `pages ${corner}`);
      // A small compact capture region holds the strip too.
      assert.ok(L.decodeStrip(region([COMPACT.cells, COMPACT.page], { corner, cell, ...L.COMPACT_REGION }), { corner }), `compact region ${corner} ${cell}px`);
    }
    const safe = L.decodeStrip(region([L.encodeCells(V3BYTES)], { corner, cell: 6, inset: 1 }), { corner });
    assert.ok(safe && safe.version === 3 && safe.mode === "safe", `safe ${corner}`);
  }
  // A strip in one corner is not mistaken for one in another.
  assert.equal(L.decodeStrip(region([COMPACT.cells], { corner: "bottomright" }), { corner: "topleft" }), null);
});

test("version 3 and version 2 strips from older addons still decode", () => {
  const v3 = L.decodeStrip(region([L.encodeCells(V3BYTES)], { cell: 6, map: remote }));
  assert.ok(v3 && v3.version === 3 && v3.mode === "safe");
  assert.equal(L.parsePayload(v3.bytes).position.mapId, 1454);
  const b2 = Uint8Array.from(COMPACT.bytes); b2[0] = 2; b2[26] = L.crc8(b2, 26);
  const v2 = L.decodeStrip(region([L.encodeCellsV2(b2)], { cell: 4, map: (v) => 255 * Math.pow(v / 255, 1.3) }));
  assert.ok(v2 && v2.version === 2 && v2.mode === "legacy");
  assert.equal(L.parsePayload(v2.bytes).level, 12);
  assert.equal(L.parsePayload(L.decodeCells(L.encodeCells(V3BYTES))).version, 3);
});

test("calibration too tight to separate levels: compact is refused with a hint, safe mode still reads", () => {
  // A crushing tone curve: 85 and 0 nearly meet, 170 and 255 nearly meet.
  const crush = (v) => (v < 128 ? v * 0.1 : 255 - (255 - v) * 0.1);
  const img = region([COMPACT.cells, COMPACT.page], { map: crush });
  assert.equal(L.decodeStrip(img), null);
  assert.equal(L.stripHint(img), "compact-unreadable");
  const safe = L.decodeStrip(region([L.encodeCells(V3BYTES)], { cell: 6, map: crush }));
  assert.ok(safe && safe.version === 3, "the one-bit safe strip survives the same curve");
  // The decoder measures the levels: an unshifted calibration passes, a flattened one does not.
  assert.ok(L.decodeCellsV4(COMPACT.cells));
  const flat = COMPACT.cells.map((c) => [...c]); flat[3] = [8, 8, 8];
  assert.equal(L.decodeCellsV4(flat), null, `gap below ${L.MIN_LEVEL_GAP} is refused`);
});

test("corruption and noise never decode as a compact strip", () => {
  const bad = COMPACT.cells.map((c) => [...c]); bad[20] = [bad[20][0] === 0 ? 85 : 0, bad[20][1], bad[20][2]];
  assert.equal(L.decodeStrip(region([bad])), null, "one changed level fails the checksum");
  for (const corner of L.CORNERS) {
    const noise = { ...L.REGION, rgb: Buffer.from(Array.from({ length: L.REGION.width * L.REGION.height * 3 }, (_, i) => (i * 2654435761) % 256)) };
    assert.equal(L.decodeStrip(noise, { corner }), null, corner);
  }
});

test("bridge reads corner captures, shrinks to a compact region and walks the corners when lost", () => {
  let t = 1000;
  const writes = [];
  const b = new L.LiveBridge({ now: () => t, platform: "linux" });
  b.enabled = true; b.child = { stdin: { write: (s) => writes.push(s) } };
  const line = (corner, img) => b.line(`ok ${corner} ${img.width} ${img.height} ${img.rgb.toString("base64")}`);
  const empty = (w = 640, h = 28) => ({ width: w, height: h, rgb: Buffer.alloc(w * h * 3, 30) });
  line("topleft", empty()); t += 500;
  assert.equal(b.status().signal, "no-signal"); assert.deepEqual(writes, []);
  line("topleft", empty()); t += 500;
  assert.deepEqual(writes, ["region topright 640 28\n"], "two misses move on to the next corner");
  line("topright", region([COMPACT.cells, COMPACT.page], { corner: "topright" })); t += 500;
  const s = b.status();
  assert.equal(s.signal, "live");
  assert.deepEqual({ ...s.strip, idle: undefined }, { mode: "compact", version: 4, corner: "topright", pitch: 2, width: 84, height: 4, idle: undefined });
  assert.equal(writes.at(-1), "region topright 200 16\n", "a found compact strip needs only a small capture");
  line("topright", region([COMPACT.cells], { corner: "topright", ...L.COMPACT_REGION })); t += 500;
  assert.equal(b.status().signal, "live"); assert.equal(writes.length, 2);
  // Strip moved (/bf live pos bottomleft): the small region misses, grows back, then walks on.
  line("topright", empty(200, 16)); t += 500;
  assert.equal(writes.at(-1), "region topright 640 28\n");
  line("topright", empty()); line("topright", empty());
  assert.equal(writes.at(-1), "region bottomleft 640 28\n");
  line("bottomleft", region([L.encodeCells(V3BYTES)], { corner: "bottomleft", cell: 6 }));
  assert.equal(b.status().strip.mode, "safe"); assert.equal(b.status().strip.corner, "bottomleft");
  assert.equal(writes.at(-1), "region bottomleft 640 28\n", "safe strips keep the full region");
  // A strip that is visible but unreadable is not searched for elsewhere.
  const crush = (v) => (v < 128 ? v * 0.1 : 255 - (255 - v) * 0.1);
  const n = writes.length;
  for (let i = 0; i < 4; i++) line("bottomleft", region([COMPACT.cells], { corner: "bottomleft", map: crush }));
  assert.equal(writes.length, n); assert.equal(b.signal, "compact-unreadable");
  // Old-format worker lines ("ok <base64>", top-left 640 wide) still decode.
  b.line("ok " + region([COMPACT.cells]).rgb.toString("base64"));
  assert.equal(b.status().signal, "live");
});

test("an unchanged strip stays live while its heartbeat moves; a frozen compact strip goes stale", () => {
  let t = 1000;
  const b = new L.LiveBridge({ now: () => t, platform: "linux" });
  b.enabled = true;
  const frame = (heartbeat, seq = 7) => { const x = Uint8Array.from(COMPACT.bytes); x[1] = seq; x[25] = heartbeat; x[26] = L.crc8(x, 26); return L.encodeCellsV4(x); };
  const feed = (cells) => b.line("ok topleft 640 28 " + region([cells]).rgb.toString("base64"));
  // Idle addon: same state, heartbeat every 2s, captured twice a second for 30s.
  for (let i = 0; i < 60; i++) { feed(frame(Math.floor(i / 4))); t += 500; assert.equal(b.status().signal, "live", `idle second ${i / 2}`); }
  assert.equal(b.status().strip.idle, true, "nothing changed for a while: idle, still live");
  feed(frame(20, 8)); assert.equal(b.status().strip.idle, false, "a state change wakes it");
  // A frozen picture: same heartbeat for longer than the stale window.
  for (let i = 0; i < 44; i++) { t += 500; feed(frame(20, 8)); }
  assert.equal(b.status().signal, "stale");
  assert.equal(b.current(), null);
  // Version 3 strips (older addons never move the heartbeat) are not held to that rule.
  const c = new L.LiveBridge({ now: () => t, platform: "linux" }); c.enabled = true;
  for (let i = 0; i < 50; i++) { t += 500; c.line("ok topleft 640 28 " + region([L.encodeCells(V3BYTES)], { cell: 6 }).rgb.toString("base64")); }
  assert.equal(c.status().signal, "live");
});

// Addon harness: a fake client with frames that record their anchors and textures that
// record their colours, sizes and offsets.
const HARNESS = String.raw`
local frames,textures={}, {}
local clock=0
UIParent={GetEffectiveScale=function()return 0.71 end}
GetPhysicalScreenSize=function()return 2560,1440 end
local messages={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)messages[#messages+1]=m end}
local SECRET=setmetatable({},{__tostring=function()return 'secret'end})
issecretvalue=function(v)return v==SECRET end
UnitGUID=function()return 'Player-1-ABC' end
UnitLevel=function()return 12 end
UnitHealth=function()return SECRET end UnitHealthMax=function()return 100 end
InCombatLockdown=function()return false end
local px,py=0.5,0.5
C_Map={GetBestMapForUnit=function()return 1454 end,GetPlayerMapPosition=function()return {GetXY=function()return px,py end}end}
CreateFrame=function(kind,name)
  local f={shown=false,scripts={}}
  function f:SetScript(k,fn)self.scripts[k]=fn end
  function f:RegisterEvent()end
  function f:SetIgnoreParentScale(v)self.ignore=v end
  function f:SetScale(v)self.scale=v end
  function f:Show()self.shown=true end
  function f:Hide()self.shown=false end
  function f:SetSize(w,h)self.w,self.h=w,h end
  function f:ClearAllPoints()self.point=nil end
  function f:SetPoint(p,_,rp,x,y)self.point,self.rp,self.x,self.y=p,rp,x,y end
  function f:CreateTexture()
    local t={shown=true}
    function t:SetSize(w,h)self.w,self.h=w,h end
    function t:ClearAllPoints()end
    function t:SetPoint(_,_,_,x,y)self.x,self.y=x,y end
    function t:SetColorTexture(r,g,b)self.c={math.floor(r*255+.5),math.floor(g*255+.5),math.floor(b*255+.5)} self.painted=(self.painted or 0)+1 end
    function t:Show()self.shown=true end
    function t:Hide()self.shown=false end
    textures[#textures+1]=t return t
  end
  for _,k in ipairs({'SetFrameStrata','SetFrameLevel'})do f[k]=function()end end
  frames[#frames+1]=f return f
end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
local function strip() for _,f in ipairs(frames) do if f.scripts.OnUpdate or f.point then return f end end end
local function tick(dt) local s=strip() s.scripts.OnUpdate(s,dt) end
local function row(n,first) local a={} for i=first or 1,(first or 1)+n-1 do local c=textures[i].c or {0,0,0} a[#a+1]='['..c[1]..','..c[2]..','..c[3]..']' end return '['..table.concat(a,',')..']' end
local function shown() local n=0 for _,t in ipairs(textures) do if t.shown then n=n+1 end end return n end
`;

test("/bf live parsing covers pos, safe, compact and the old words", () => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local function p(m) local a,v=BackstageForeverLiveParse(m) return a..':'..tostring(v) end
print(table.concat({p('live'),p('live on'),p('LIVE OFF'),p('live status'),p('live safe'),p('live compact'),p('live pos topright'),p('live pos BottomLeft'),p('live position br'),p('live pos middle'),p('live pos'),p('live sideways'),p(nil)},' '))`);
  assert.equal(out, "toggle:nil on:nil off:nil status:nil safe:nil compact:nil pos:topright pos:bottomleft pos:bottomright pos:nil pos:nil usage:nil toggle:nil");
});

test("addon draws a pixel-exact compact strip, moves corners, switches safe mode and persists all of it", () => {
  const out = lua(HARNESS + String.raw`
BackstageForeverLiveCommand('live on')
local s=strip()
assert(s.shown and s.ignore==true and math.abs(s.scale-768/1440)<1e-9,'1 unit = 1 physical pixel')
assert(s.point=='TOPLEFT' and s.rp=='TOPLEFT' and s.w==84 and s.h==4,'compact 84x4 at the top-left')
assert(#textures==78 and shown()==78)
assert(textures[1].w==2 and textures[42].x==82 and textures[42].y==0 and textures[43].x==0 and textures[43].y==-2,'2px cells, pages row below')
tick(1)
print(row(42)) print(row(36,43))
BackstageForeverLiveCommand('live pos bottomright')
assert(BackstageForeverLiveSettings.pos=='bottomright' and s.point=='BOTTOMRIGHT' and s.rp=='BOTTOMRIGHT')
BackstageForeverLiveCommand('live pos nowhere')
assert(BackstageForeverLiveSettings.pos=='bottomright','a bad corner changes nothing')
BackstageForeverLiveCommand('live safe')
assert(BackstageForeverLiveSettings.safe==true and s.w==456 and s.h==12 and #textures==152 and shown()==152 and textures[1].w==6)
tick(1)
print(row(76))
BackstageForeverLiveCommand('live compact')
assert(BackstageForeverLiveSettings.safe==nil and s.w==84 and shown()==78,'extra safe-mode cells hide again')
BackstageForeverLiveCommand('live pos topleft')
assert(BackstageForeverLiveSettings.pos==nil and s.point=='TOPLEFT','topleft is the default and is not stored')
BackstageForeverLiveSettings.pos='middle' BackstageForeverLiveCommand('live on')
assert(s.point=='TOPLEFT','a corrupt saved corner falls back to top-left')
BackstageForeverLiveCommand('live status')
print(messages[#messages])`).split("\n");
  const compact = L.decodeStrip(region([JSON.parse(out[0]), JSON.parse(out[1])]));
  assert.ok(compact && compact.version === 4, "the painted compact strip decodes");
  const f = L.parsePayload(compact.bytes);
  assert.equal(f.position.mapId, 1454); assert.equal(f.healthPercent, null, "secret health stays unknown");
  assert.equal(L.parsePage(compact.page).kind, "questLog");
  const safe = L.decodeStrip(region([JSON.parse(out[2])], { cell: 6 }));
  assert.ok(safe && safe.version === 3, "safe mode paints a version 3 strip");
  assert.match(out[3], /compact 84x4 px at top-left/);
});

test("addon slows down when idle but keeps a heartbeat, and wakes on movement", () => {
  const out = lua(HARNESS + String.raw`
BackstageForeverLiveCommand('live on')
local paints=0
local function frame() return row(42) end
local seen={}
-- 20 seconds at 60 fps with the player standing still.
local states=0
local base=BackstageForeverLiveState
BackstageForeverLiveState=function() states=states+1 return base() end
for i=1,1200 do tick(1/60) if i%60==0 then seen[#seen+1]=frame() end end
print(states)
print('['..table.concat(seen,',')..']')
-- Movement wakes it: the next state read is at most a second away and the update rate returns.
px=0.6 states=0
for i=1,60 do tick(1/60) end
local woke=states
for i=1,60 do tick(1/60) end
print(woke..' '..states)`).split("\n");
  const reads = Number(out[0]);
  // 5 reads a second for the first ~5 seconds, then 1 a second: well under 5 * 20.
  assert.ok(reads >= 35 && reads <= 45, `state reads while idle: ${reads}`);
  const frames = JSON.parse(out[1]).map((cells) => L.parsePayload(L.decodeCells(cells)));
  assert.ok(frames.every((f) => f && f.seq === frames[0].seq), "the sequence holds while nothing changes");
  const beats = new Set(frames.map((f) => f.heartbeat));
  assert.ok(beats.size >= 9, `heartbeat keeps moving every ~2s while idle (${beats.size} values in 20s)`);
  const [woke, after] = out[2].split(" ").map(Number);
  assert.ok(woke >= 1, "movement is noticed within a second");
  assert.ok(after - woke >= 4, `back to about 5 updates a second after moving (${after - woke})`);
});

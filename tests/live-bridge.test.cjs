"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const STATE = "{seq=7,mapId=1454,x=0.4321,y=0.6543,level=12,health=88,targetNpcId=3057,targetHealth=100,xp=42,freeSlots=9,questId=93739,objectives=5,questHash=201,facing=1.5,resting=true}";
function luaCells(state) {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local b=BackstageForeverLivePayload(${state}) local c=BackstageForeverLiveCells(b)
local a={} for _,v in ipairs(c) do a[#a+1]='['..v[1]..','..v[2]..','..v[3]..']' end
local bb={} for _,v in ipairs(b) do bb[#bb+1]=v end
print('['..table.concat(a,',')..']') print('['..table.concat(bb,',')..']')`).split("\n");
  return { cells: JSON.parse(out[0]), bytes: JSON.parse(out[1]) };
}
function image(cells, { ox = 0, oy = 0, gamma = 1, background = 30 } = {}) {
  const { width: W, height: H } = L.REGION, img = Buffer.alloc(W * H * 3, background);
  const g = (v) => Math.round(255 * Math.pow(v / 255, gamma));
  cells.forEach((c, i) => { for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const o = ((oy + dy) * W + ox + i * 4 + dx) * 3; img[o] = g(c[0]); img[o + 1] = g(c[1]); img[o + 2] = g(c[2]); } });
  return { width: W, height: H, rgb: img };
}

test("addon encoder and desktop decoder agree byte for byte", () => {
  const { cells, bytes } = luaCells(STATE);
  assert.deepEqual(L.encodeCells(Uint8Array.from(bytes)), cells);
  assert.equal(cells.length, 40);
  const f = L.parsePayload(L.decodeCells(cells));
  assert.equal(f.position.mapId, 1454);
  assert.ok(Math.abs(f.position.x - 0.4321) < 1e-4 && Math.abs(f.position.y - 0.6543) < 1e-4);
  assert.deepEqual(f.target, { npcId: 3057, healthPercent: 100 });
  assert.deepEqual(f.quest, { id: 93739, objectivesDone: [1, 3] });
  assert.equal(f.level, 12); assert.equal(f.healthPercent, 88); assert.equal(f.freeBagSlots, 9); assert.equal(f.resting, true);
});

test("combat freezes every detail except the combat flag", () => {
  const { cells } = luaCells(STATE.replace("{", "{combat=true,"));
  const f = L.parsePayload(L.decodeCells(cells));
  assert.equal(f.combat, true);
  assert.equal(f.position, undefined); assert.equal(f.target, undefined); assert.equal(f.level, undefined);
});

test("strip decodes through gamma shifts and offsets and rejects noise or corruption", () => {
  const { cells } = luaCells(STATE);
  for (const gamma of [0.75, 1, 1.3]) for (const [ox, oy] of [[0, 0], [5, 3]]) assert.ok(L.decodeStrip(image(cells, { gamma, ox, oy })), `gamma ${gamma} offset ${ox},${oy}`);
  const bad = cells.map((c) => [...c]); bad[20] = bad[20][0] === 0 ? [255, bad[20][1], bad[20][2]] : [0, bad[20][1], bad[20][2]];
  assert.equal(L.decodeStrip(image(bad)), null, "single flipped cell must fail the checksum");
  const noise = { ...L.REGION, rgb: Buffer.from(Array.from({ length: L.REGION.width * L.REGION.height * 3 }, (_, i) => (i * 2654435761) % 256)) };
  assert.equal(L.decodeStrip(noise), null);
  assert.equal(L.decodeStrip({ width: 2, height: 2, rgb: Buffer.alloc(3) }), null);
});

test("bridge reports live only while frames are fresh and maps worker states", () => {
  let now = 1000;
  const b = new L.LiveBridge({ now: () => now, platform: "linux" });
  b.enabled = true;
  const seen = [];
  b.subscribe((s) => seen.push(s.signal));
  const { cells } = luaCells(STATE);
  b.read("nogame\n");
  assert.equal(b.status().signal, "nogame");
  b.read("ok " + image(cells, { ox: 2 }).rgb.toString("base64") + "\nok ");
  assert.equal(b.status().signal, "live");
  assert.equal(b.status().frame.zone, "Orgrimmar");
  b.read(image(cells).rgb.toString("base64").slice(0, 10)); // partial line buffers
  now += L.FRESH_MS + 1;
  assert.equal(b.current(), null);
  assert.equal(b.status().signal, "stale");
  b.read("x\nminimized\n");
  assert.equal(b.status().signal, "minimized");
  assert.deepEqual(seen.slice(0, 2), ["nogame", "live"]);
});

test("preference persists, and the capture worker is spawned bounded with no shell or stdin", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-live-"));
  const calls = [];
  const fake = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    const listeners = {};
    return { stdout: { setEncoding() {}, on() {} }, stderr: { on() {} }, on: (e, f) => (listeners[e] = f), kill() { calls.push("killed"); } };
  };
  const b = new L.LiveBridge({ dataDir: dir, spawn: fake, platform: "win32" });
  assert.equal(b.enabled, true, "on by default for new installs");
  b.setEnabled(false);
  assert.equal(new L.LiveBridge({ dataDir: dir }).enabled, false, "an explicit off is remembered");
  b.setEnabled(true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "live-link.json"), "utf8")).enabled, true);
  assert.equal(new L.LiveBridge({ dataDir: dir }).enabled, true);
  const { exe, args, opts } = calls[0];
  assert.match(exe, /powershell\.exe$/i);
  assert.ok(args.includes("-EncodedCommand") && args.includes("-NonInteractive"));
  assert.equal(opts.shell, false); assert.equal(opts.stdio[0], "ignore");
  assert.deepEqual(Object.keys(opts.env).filter((k) => /KEY|TOKEN|SECRET/i.test(k)), []);
  const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");
  assert.match(script, /CopyFromScreen/);
  assert.doesNotMatch(script, /SendInput|keybd_event|mouse_event|ReadProcessMemory|OpenProcess|PostMessage|SendMessage/);
  b.setEnabled(false);
  assert.ok(calls.includes("killed"));
  assert.throws(() => b.setEnabled("yes"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("/bf live toggles a 40-cell pixel-exact strip and persists the account setting", () => {
  const out = lua(String.raw`
local textures,frames=0,{}
UIParent={GetEffectiveScale=function()return 0.8 end}
GetPhysicalScreenSize=function()return 3440,1440 end
local messages={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)messages[#messages+1]=m end}
CreateFrame=function(kind,name)
  local f={shown=false,scripts={}}
  function f:SetScript(k,fn)self.scripts[k]=fn end
  function f:RegisterEvent()end
  function f:SetIgnoreParentScale(v)self.ignore=v end
  function f:SetScale(v)self.scale=v end
  function f:Show()self.shown=true end
  function f:Hide()self.shown=false end
  function f:CreateTexture()textures=textures+1 return {SetSize=function()end,SetPoint=function()end,SetColorTexture=function(t,r,g,b)t.c={r,g,b}end} end
  for _,k in ipairs({'SetFrameStrata','SetFrameLevel','SetSize','ClearAllPoints','SetPoint'})do f[k]=function()end end
  frames[#frames+1]=f return f
end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
BackstageForeverLiveCommand('live on')
local strip=frames[2]
assert(BackstageForeverLiveSettings.enabled==true)
assert(strip.shown and strip.ignore==true and math.abs(strip.scale-768/1440)<1e-9,'pixel exact scale')
assert(textures==40)
strip.scripts.OnUpdate(strip,1)
BackstageForeverLiveCommand('live off')
assert(BackstageForeverLiveSettings.enabled==false and not strip.shown)
print(#messages)`);
  assert.equal(out, "2");
});

test("live frames reach the AI as authoritative current state", async () => {
  const { createCompanionTools } = require("../src/core/companion-tools.cjs");
  const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const index = new KnowledgeIndex(JSON.parse(fs.readFileSync(path.join(root, "data/forever/pack.json"), "utf8")));
  const npcReference = JSON.parse(fs.readFileSync(path.join(root, "data/forever-npc-locations/pack.json"), "utf8"));
  const { cells } = luaCells(STATE.replace("mapId=1454,x=0.4321,y=0.6543", "mapId=1456,x=0.55,y=0.5").replace("{", "{identity=BackstageForeverLiveIdentity('o'),"));
  const live = { ...L.parsePayload(L.decodeCells(cells)), ageMs: 900 };
  const profile = { name: "P", level: 12, faction: "Horde", location: { zone: "The Barrens", mapId: 1413, x: 0.6, y: 0.2 } };
  const t = createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index, npcReference, live });
  const state = JSON.parse(await t.call("get_live_state", {}));
  assert.equal(state.status, "live");
  assert.equal(state.position.zone, "Thunder Bluff");
  assert.equal(state.target.name, "Cairne Bloodhoof");
  assert.equal(state.trackedQuest.title, "Exploring the Horde");
  const ch = JSON.parse(await t.call("get_character", {}));
  assert.equal(ch.character.locationSource, "live-game");
  assert.equal(ch.character.location.zoneFromMap, "Thunder Bluff");
  const npc = JSON.parse(await t.call("find_npc", { name: "Cairne" }));
  assert.equal(npc.matches[0].locations[0].sameMapAsPlayer, true);
  const off = createCompanionTools({ profile, shareProfile: true, knowledgeIndex: index, liveStatus: { enabled: false, signal: "off" } });
  assert.equal(JSON.parse(await off.call("get_live_state", {})).status, "off");
  const unshared = createCompanionTools({ profile, shareProfile: false, live });
  assert.equal(JSON.parse(await unshared.call("get_live_state", {})).status, "not-shared");

  const { CompanionContext } = require("../src/core/companion-context.cjs");
  const { CompanionRequest } = require("../src/core/companion-request.cjs");
  const { MemoryService } = require("../src/core/memory.cjs");
  const { CompanionService } = require("../src/core/companion-service.cjs");
  const providers = require("../src/core/providers.cjs");
  L.rememberLiveKey("digest-of-o", "o");
  const s = { activeProfileId: "A", profiles: [{ id: "A", ...profile, source: { kind: "wow-addon", id: "digest-of-o" } }], provider: { id: "anthropic", model: "m", authMode: "api" }, memories: [] };
  const store = { state: s, getKey: () => "k" }, context = new CompanionContext(() => s);
  let seen;
  const service = new CompanionService({ store, context, requests: new CompanionRequest(context), memory: new MemoryService({ store, context }), ai: { ...providers, ask: async (i) => { seen = i; return "ok"; } }, chatgpt: {}, claude: {}, knowledge: { index: () => index }, npcReference, live: { status: () => ({ enabled: true, signal: "live", frame: live }) } });
  await service.ask({ provider: "anthropic", prompt: "Which quest should I do next?", profileId: "A", shareProfile: true, memoryIds: [] });
  assert.match(seen.context, /Live game link \(read from the game screen 1s ago/);
  assert.match(seen.context, /"zone":"Thunder Bluff"/);
  await service.ask({ provider: "anthropic", prompt: "Which quest after that?", profileId: "A", shareProfile: false, memoryIds: [] });
  assert.doesNotMatch(String(seen.context), /Live game link/);
});

test("protected secret values from the client become unknown instead of breaking the strip", () => {
  const out = lua(String.raw`
local SECRET=setmetatable({},{__tostring=function()return 'secret'end,__div=function()error('attempt to perform arithmetic on a secret number value')end})
issecretvalue=function(v)return v==SECRET end
UnitHealth=function()return SECRET end
UnitHealthMax=function()return SECRET end
UnitLevel=function()return 15 end
C_Map={GetBestMapForUnit=function()return 1456 end,GetPlayerMapPosition=function()return {GetXY=function()return 0.47,0.495 end}end}
dofile('addon/BackstageForever/BackstageForeverLive.lua')
local s=BackstageForeverLiveState()
assert(s.health==nil and s.level==15 and s.mapId==1456)
local cells=BackstageForeverLiveCells(BackstageForeverLivePayload(s))
print(#cells)`);
  assert.equal(out, "40");
});

test("review fixes: identity binding, Claude live context, stale worker output, AFK changes and saved-file compatibility", async () => {
  // Identity hash mirrors the addon.
  assert.equal(Number(lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua') print(BackstageForeverLiveIdentity('Player-6923-01D2C2FB'))`)), L.identityHash("Player-6923-01D2C2FB"));
  // A frame from another character never reaches the selected character's context.
  const { CompanionContext } = require("../src/core/companion-context.cjs");
  const { CompanionRequest } = require("../src/core/companion-request.cjs");
  const { MemoryService } = require("../src/core/memory.cjs");
  const { CompanionService } = require("../src/core/companion-service.cjs");
  const providers = require("../src/core/providers.cjs");
  const { cells } = luaCells(STATE.replace("{", "{identity=BackstageForeverLiveIdentity('someone-else'),"));
  const other = { ...L.parsePayload(L.decodeCells(cells)), ageMs: 100 };
  L.rememberLiveKey("digest-of-o", "o"); // game sync learns the key while reading SavedVariables
  const s = { activeProfileId: "A", profiles: [{ id: "A", name: "P", level: 12, source: { kind: "wow-addon", id: "digest-of-o" }, location: { zone: "The Barrens", mapId: 1413, x: 0.6, y: 0.2 } }], provider: { id: "anthropic", model: "m", authMode: "subscription" }, memories: [] };
  const store = { state: s, getKey: () => "k" }, context = new CompanionContext(() => s);
  const seen = [];
  const claude = { ask: async (i) => { seen.push(i); return "ok"; } };
  const mk = (frame) => new CompanionService({ store, context, requests: new CompanionRequest(context), memory: new MemoryService({ store, context }), ai: providers, chatgpt: {}, claude, knowledge: { index: () => null }, live: { status: () => ({ enabled: true, signal: "live", frame }) } });
  await mk(other).ask({ provider: "anthropic", prompt: "Which quest next?", profileId: "A", shareProfile: true, memoryIds: [] });
  assert.equal(seen[0].live, undefined, "other character's frame must be dropped");
  assert.equal(JSON.parse(await seen[0].tools.call("get_live_state", {})).status, "other-character");
  const mine = { ...L.parsePayload(L.decodeCells(luaCells(STATE.replace("{", "{identity=BackstageForeverLiveIdentity('o'),")).cells)), ageMs: 100 };
  await mk(mine).ask({ provider: "anthropic", prompt: "Which quest after that?", profileId: "A", shareProfile: true, memoryIds: [] });
  assert.equal(seen[1].live.zone, "Orgrimmar", "Claude subscription receives the live summary");

  // Output from a stopped worker is ignored.
  const b = new L.LiveBridge({ platform: "linux" });
  b.enabled = true;
  b.read("ok " + image(mine ? luaCells(STATE).cells : []).rgb.toString("base64") + "\n");
  assert.equal(b.status().signal, "live");
  b.enabled = false; b.stop();
  b.read("ok " + image(luaCells(STATE).cells).rgb.toString("base64") + "\n");
  assert.equal(b.frame, null);

  // AFK alone changes the transmitted payload.
  const afk = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local a=BackstageForeverLivePayload({seq=1,afk=false}) local b=BackstageForeverLivePayload({seq=1,afk=true}) print(a[11]~=b[11])`);
  assert.equal(afk, "true");

  // Saved files written by 0.14 test builds still import; anything else trailing is rejected.
  const { parseSavedVariables } = require("../src/core/game-sync.cjs");
  const exportLine = 'BackstageForeverExport = ' + JSON.stringify(JSON.stringify({ schema: 1, characters: [], activeId: null, observedAt: 1794414545 })) + "\n";
  const settings = 'BackstageForeverLiveSettings = {\n["enabled"] = true,\n}\n';
  for (const raw of [exportLine + settings, settings + exportLine]) assert.deepEqual(parseSavedVariables(raw).characters, []);
  for (const raw of [exportLine + 'Other = {\n}\n', exportLine + settings.replace("true", "loadstring('x')")]) assert.throws(() => parseSavedVariables(raw));
});

test("/bf way places a native waypoint and super-tracks it, refusing combat and bad input", () => {
  const out = lua(String.raw`
local set,tracked,msgs=nil,false,{}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)msgs[#msgs+1]=m end}
local fighting=false
InCombatLockdown=function()return fighting end
UiMapPoint={CreateFromCoordinates=function(m,x,y)return {m=m,x=x,y=y}end}
C_Map={CanSetUserWaypointOnMap=function(m)return m==1413 end,SetUserWaypoint=function(p)set=p end}
C_SuperTrack={SetSuperTrackedUserWaypoint=function(v)tracked=v end}
dofile('addon/BackstageForever/BackstageForeverLive.lua')
BackstageForeverWay('way 1413 51.5 30.4 Devrak')
assert(set and set.m==1413 and math.abs(set.x-0.515)<1e-9 and math.abs(set.y-0.304)<1e-9 and tracked==true)
assert(msgs[#msgs]:find('Devrak at 51.5, 30.4',1,true))
set=nil fighting=true BackstageForeverWay('way 1413 0.5 0.5') assert(set==nil and msgs[#msgs]:find('combat'))
fighting=false BackstageForeverWay('way 9999 50 50') assert(set==nil and msgs[#msgs]:find('Cannot place'))
BackstageForeverWay('way 1413 150 20') assert(set==nil)
BackstageForeverWay('way nonsense') assert(set==nil)
print('ok')`);
  assert.equal(out, "ok");
});

test("/bf find picks the nearest match on your map, sets a waypoint and lists distinct alternatives", () => {
  const out = lua(String.raw`
local msgs,set={},nil
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)msgs[#msgs+1]=m end}
InCombatLockdown=function()return false end
UiMapPoint={CreateFromCoordinates=function(m,x,y)return {m=m,x=x,y=y}end}
C_Map={GetBestMapForUnit=function()return 1413 end,GetPlayerMapPosition=function()return {GetXY=function()return 0.6,0.1 end}end,CanSetUserWaypointOnMap=function()return true end,SetUserWaypoint=function(p)set=p end}
C_SuperTrack={SetSuperTrackedUserWaypoint=function()end}
dofile('addon/BackstageForever/BackstageForeverLive.lua')
dofile('addon/BackstageForever/BackstageForeverFind.lua')
BackstageForeverFind('find flight master')
assert(set.m==1413 and msgs[1]:find('Devrak',1,true),'nearest flight master on this map first')
local also=0 local seen={} for _,m in ipairs(msgs) do local n=m:match('also: ([^,(]+)') if n then also=also+1 assert(not seen[n],'distinct alternatives') seen[n]=true end end
assert(also>=2)
msgs={} set=nil BackstageForeverFind('find Cairne Bloodhoof')
assert(set.m==1456 and msgs[1]:find('Thunder Bluff; travel there first',1,true))
msgs={} set=nil BackstageForeverFind('find zzzz') assert(set==nil and msgs[1]:find('No match',1,true))
print('ok')`);
  assert.equal(out, "ok");
});

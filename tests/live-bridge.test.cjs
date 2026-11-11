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
  assert.equal(cells.length, 36);
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
  assert.equal(b.enabled, false);
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

test("/bf live toggles a 36-cell pixel-exact strip and persists the account setting", () => {
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
assert(textures==36)
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
  const { cells } = luaCells(STATE.replace("mapId=1454,x=0.4321,y=0.6543", "mapId=1456,x=0.55,y=0.5"));
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
  const s = { activeProfileId: "A", profiles: [{ id: "A", ...profile, source: { kind: "wow-addon", id: "o" } }], provider: { id: "anthropic", model: "m", authMode: "api" }, memories: [] };
  const store = { state: s, getKey: () => "k" }, context = new CompanionContext(() => s);
  let seen;
  const service = new CompanionService({ store, context, requests: new CompanionRequest(context), memory: new MemoryService({ store, context }), ai: { ...providers, ask: async (i) => { seen = i; return "ok"; } }, chatgpt: {}, claude: {}, knowledge: { index: () => index }, npcReference, live: { status: () => ({ enabled: true, signal: "live", frame: live }) } });
  await service.ask({ provider: "anthropic", prompt: "Which quest should I do next?", profileId: "A", shareProfile: true, memoryIds: [] });
  assert.match(seen.context, /Live game link \(read from the game screen 1s ago/);
  assert.match(seen.context, /"zone":"Thunder Bluff"/);
  await service.ask({ provider: "anthropic", prompt: "Which quest after that?", profileId: "A", shareProfile: false, memoryIds: [] });
  assert.doesNotMatch(String(seen.context), /Live game link/);
});

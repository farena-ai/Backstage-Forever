"use strict";
// Roadmap E4, W1 and W4: gathering loops, the rare and treasure finder and the wider /bf find.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.join(__dirname, "..");
const L = require("../src/core/gathering-loop.cjs");
const ipc = require("../src/core/gathering-loop-ipc.cjs");
const W = require("../src/core/world-finds.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const saved = (id, name, extra = {}) => ({ id, name, realm: "Thunder Hold", source: { kind: "wow-addon", id: "s-" + id }, ...extra });
const ring = (n, name = "Peacebloom", source = "yours") => Array.from({ length: n }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos((2 * Math.PI * i) / n), y: 0.5 + 0.3 * Math.sin((2 * Math.PI * i) / n), name, source }));

// ---------- E4: the loop builder ----------
test("a loop visits every stop once, closes, and is as short as the ring it was made from", () => {
  const spots = ring(12).sort((a, b) => a.y - b.y); // shuffled order in, ring order out
  const loop = L.buildLoop(spots, { skill: 300, size: { width: 3000, height: 2000 } });
  assert.equal(loop.status, "ok");
  assert.equal(loop.stops.length, 12);
  assert.deepEqual(loop.stops.map((s) => s.n), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(loop.stops.map((s) => `${s.x}:${s.y}`)).size, 12);
  // Neighbours in the loop are neighbours on the ring: no leg crosses the middle.
  const leg = (a, b) => Math.hypot((a.x - b.x) * 3000, (a.y - b.y) * 2000);
  const longest = Math.max(...loop.stops.map((s, i) => leg(s, loop.stops[(i + 1) % 12])));
  assert.ok(longest < 600, `longest leg ${longest}`);
  const walked = loop.stops.reduce((t, s, i) => t + leg(s, loop.stops[(i + 1) % 12]), 0);
  assert.ok(Math.abs(loop.length.yards - walked) <= 2, "the length is the closed walk in yards");
  assert.equal(loop.length.walkMinutes, Math.max(1, Math.round(loop.length.yards / 7 / 60)));
  assert.match(loop.note, /^Based on 12 past spots \(12 of your own\)\. Past spots, not live nodes\.$/);
  assert.equal(loop.skillNote, null);
});

test("2-opt removes a crossing that nearest-neighbour alone leaves in", () => {
  // Two rows of spots: walking one row out and the other back beats zig-zagging or crossing.
  const spots = [];
  for (let i = 0; i < 6; i++) { spots.push({ x: 0.1 + i * 0.15, y: 0.3, name: "Copper Vein" }); spots.push({ x: 0.1 + i * 0.15, y: 0.6, name: "Copper Vein" }); }
  const loop = L.buildLoop(spots, { skill: 10 });
  const crossings = (stops) => {
    const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    let n = 0;
    for (let i = 0; i < stops.length; i++) for (let j = i + 2; j < stops.length; j++) {
      if (i === 0 && j === stops.length - 1) continue;
      const [a, b, c, d] = [stops[i], stops[(i + 1) % stops.length], stops[j], stops[(j + 1) % stops.length]];
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) n++;
    }
    return n;
  };
  assert.equal(crossings(loop.stops), 0);
  assert.equal(loop.length.yards, null, "no yards without the size of the zone");
  assert.ok(loop.length.map > 0);
});

test("spots above the character's skill are left out and counted; an unknown skill leaves nothing out", () => {
  const spots = [...ring(6, "Peacebloom"), ...ring(5, "Dreamfoil").map((s) => ({ ...s, x: s.x * 0.5, y: s.y * 0.5 }))];
  const low = L.buildLoop(spots, { skill: 40 });
  assert.equal(low.basedOn.tooHigh, 5); assert.equal(low.basedOn.spots, 6); assert.equal(low.stops.length, 6);
  assert.match(low.skillNote, /^5 spots need more skill than you have and are left out\.$/);
  const unknown = L.buildLoop(spots, { skill: null });
  assert.equal(unknown.basedOn.tooHigh, 0); assert.equal(unknown.basedOn.spots, 11);
  assert.match(unknown.skillNote, /skill is not known/);
  const high = L.buildLoop(spots, { skill: 300 });
  assert.equal(high.basedOn.spots, 11); assert.equal(high.skillNote, null);
  // A node name the table does not know is kept and counted as unknown, never dropped.
  const odd = L.buildLoop(ring(4, "Glowing Fern"), { skill: 1 });
  assert.equal(odd.status, "ok"); assert.equal(odd.basedOn.unknownSkill, 4);
  assert.equal(L.nodeSkill("Rich Thorium Vein"), 275);
  assert.equal(L.nodeSkill("Ooze Covered Rich Thorium Vein"), 275);
  assert.equal(L.nodeSkill("Poor Copper Vein"), 1);
  assert.equal(L.nodeInfo("Khadgar's Whisker").kind, "herb");
  assert.equal(L.nodeInfo("Battered Chest"), null);
});

test("too few spots are said plainly, never padded into a loop", () => {
  const none = L.buildLoop([], { skill: 100 });
  assert.equal(none.status, "too-few"); assert.equal(none.note, "No spots are known here yet."); assert.deepEqual(none.stops, []);
  const two = L.buildLoop([{ x: 0.2, y: 0.2, name: "Tin Vein" }, { x: 0.8, y: 0.8, name: "Tin Vein" }], { skill: 100 });
  assert.equal(two.status, "too-few"); assert.match(two.note, /^Only 2 spots in 2 places here\. A loop needs at least 3 places\.$/);
  // Many spots in one place are still one place.
  const heap = L.buildLoop(Array.from({ length: 9 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.5, name: "Tin Vein" })), { skill: 100 });
  assert.equal(heap.status, "too-few"); assert.match(heap.note, /^Only 9 spots in 1 place here/);
  const hard = L.buildLoop(ring(8, "Black Lotus"), { skill: 10 });
  assert.equal(hard.status, "too-few"); assert.equal(hard.note, "Every spot known here needs more skill than you have.");
  assert.equal(L.buildLoop([{ x: 2, y: 0 }, { x: NaN, y: 0 }, null, "x"], {}).basedOn.spots, 0, "bad rows are ignored");
});

test("the size is bounded: near spots share a stop and the busiest stops are kept", () => {
  const spots = [];
  for (let i = 0; i < 60; i++) { const x = 0.05 + (i % 10) * 0.09, y = 0.1 + Math.floor(i / 10) * 0.15; for (let k = 0; k <= (i < 5 ? 3 : 0); k++) spots.push({ x: x + k * 0.002, y, name: "Silverleaf", source: i % 2 ? "community" : "reference" }); }
  const loop = L.buildLoop(spots, { skill: 300 });
  assert.equal(loop.stops.length, L.MAX_STOPS);
  assert.equal(loop.basedOn.leftOut, 20);
  assert.equal(loop.stops.filter((s) => s.spots === 4).length, 5, "the five busy places survive the cut");
  assert.match(loop.note, /from the community, \d+ from the bundled reference\)\. Past spots, not live nodes\. 20 quieter places are left out to keep the walk short\.$/);
  assert.equal(L.buildLoop(spots, { skill: 300, maxStops: 10 }).stops.length, 10);
  // The loop starts at the stop nearest to where the character stands.
  const from = L.buildLoop(ring(8), { skill: 300, start: { x: 0.81, y: 0.5 } });
  assert.deepEqual([from.stops[0].x, from.stops[0].y], [0.8, 0.5]);
});

test("spots come from the character, the community and the bundled reference, each labelled", () => {
  const profile = { gathering: { records: [{ method: "herbalism", mapId: 1411, x: 0.1, y: 0.1, name: "Peacebloom" }, { method: "mining", mapId: 1411, x: 0.2, y: 0.2, name: "Copper Vein" }, { method: "chest", mapId: 1411, x: 0.3, y: 0.3, name: "Battered Chest" }] } };
  const community = { nodesByMap: new Map([[1411, [{ kind: "herb", name: "Silverleaf", x: 0.4, y: 0.4 }, { kind: "ore", name: "Copper Vein", x: 0.5, y: 0.5 }, { kind: "herb", name: "Peacebloom", x: 0.1, y: 0.1 }]]]) };
  const worldPack = { nodes: [{ id: 1, name: "Earthroot", kind: "herb", skill: 15, positions: [{ mapId: 1411, x: 0.6, y: 0.6 }, { mapId: 1412, x: 0.6, y: 0.6 }] }, { id: 2, name: "Tin Vein", kind: "ore", skill: 65, positions: [{ mapId: 1411, x: 0.7, y: 0.7 }] }] };
  const acquisitionPack = { rows: [{ kind: "gathered-object-loot", referenceName: "Silverleaf", positions: [{ mapId: 1411, x: 0.8, y: 0.8 }] }, { kind: "gathered-object-loot", referenceName: "Copper Vein", positions: [{ mapId: 1411, x: 0.9, y: 0.9 }] }, { kind: "vendor", referenceName: "Silverleaf", positions: [{ mapId: 1411, x: 0.9, y: 0.1 }] }] };
  const herbs = L.collectSpots({ profile, community, worldPack, acquisitionPack, profession: "herbalism" });
  assert.deepEqual(herbs.get(1411).map((s) => `${s.name}:${s.source}`), ["Peacebloom:yours", "Silverleaf:community", "Earthroot:reference", "Silverleaf:reference"], "your own spot wins over the same community spot");
  assert.equal(herbs.get(1412).length, 1);
  assert.deepEqual(L.collectSpots({ profile, community, worldPack, acquisitionPack, profession: "mining" }).get(1411).map((s) => s.source), ["yours", "community", "reference", "reference"]);
  assert.deepEqual(L.collectSpots({ profile, community, worldPack, acquisitionPack, profession: "herbalism", extra: false }).get(1411).map((s) => s.name), ["Peacebloom"]);
  assert.equal(L.collectSpots({ profile, profession: "fishing" }).size, 0);
  assert.equal(L.professionSkill({ readiness: { workshop: { professions: { items: [{ skillLineId: 182, rank: 85 }, { skillLineId: 186, rank: 300 }] } } } }, "herbalism"), 85);
  assert.equal(L.professionSkill({}, "mining"), null);
});

test("the loop view picks the character's profession and zone, and says what the game holds", () => {
  const records = ring(9, "Peacebloom").map((s, i) => ({ method: "herbalism", mapId: 1411, x: s.x, y: s.y, name: i < 3 ? "Dreamfoil" : "Peacebloom" }));
  const profile = saved("a", "Abel", { location: { mapId: 1411, x: 0.8, y: 0.5 }, gathering: { records }, readiness: { workshop: { professions: { items: [{ skillLineId: 182, rank: 100 }] } } } });
  const transport = { maps: { 1411: { instance: 1, x0: 0, x1: -3000, y0: 0, y1: -4500 } } };
  const v = ipc.loopView({ profile, transport }, {});
  assert.equal(v.profession, "herbalism"); assert.equal(v.mapId, 1411); assert.equal(v.mapName, "Durotar"); assert.equal(v.skill, 100);
  assert.deepEqual(v.zones, [{ mapId: 1411, name: "Durotar", spots: 9, yours: 9 }]);
  assert.equal(v.loop.status, "ok"); assert.equal(v.loop.stops.length, 6); assert.equal(v.loop.basedOn.tooHigh, 3);
  assert.ok(v.loop.length.yards > 0, "the transport pack gives the zone's size in yards");
  assert.deepEqual(ipc.mapSize(transport, 1411), { width: 4500, height: 3000 });
  assert.equal(ipc.mapSize(transport, 1412), null);
  assert.deepEqual(v.inGame, { canSend: true, sent: false, chosen: null });
  const mining = ipc.loopView({ profile, transport }, { profession: "mining" });
  assert.equal(mining.skill, null); assert.equal(mining.loop.status, "too-few");
  const chosen = { mapId: 1411, profession: "herbalism", stops: v.loop.stops.map((s) => [s.x, s.y]) };
  assert.equal(ipc.loopView({ profile, transport, chosen }, {}).inGame.sent, true);
  assert.deepEqual(ipc.loopView({ profile, transport, chosen }, { mapId: 1412 }).inGame, { canSend: true, sent: false, chosen: { mapId: 1411, mapName: "Durotar", profession: "herbalism", stops: 6 } });
  assert.equal(ipc.loopView({ profile: { ...profile, source: { kind: "manual" } }, transport }, {}).inGame.canSend, false);
  assert.equal(ipc.loopView({}, {}).loop, null, "no character and no spots: nothing to draw");
  for (const bad of [{ profession: "fishing" }, { mapId: -1 }, { mapId: 1.5 }, "x", []]) assert.throws(() => ipc.loopView({ profile }, bad), /Invalid gathering loop request/);
});

test("the chosen loop is saved per character and sending it rewrites the hand-off", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-loops-"));
  try {
    const records = ring(9).map((s) => ({ method: "herbalism", mapId: 1411, x: s.x, y: s.y, name: "Peacebloom" }));
    const state = { activeProfileId: "a", profiles: [saved("a", "Abel", { gathering: { records } })] };
    const loops = new L.GatheringLoops(dir), handlers = {};
    let changes = 0;
    ipc.registerGatheringLoop({ handle: (n, fn) => { handlers[n] = fn; }, getState: () => state, loops, onChange: () => { changes++; } });
    assert.equal(handlers.gatheringLoop({}).loop.stops.length, 9);
    const sent = handlers.gatheringLoopUse({ mapId: 1411, profession: "herbalism" });
    assert.equal(sent.inGame.sent, true); assert.equal(changes, 1);
    assert.equal(new L.GatheringLoops(dir).get("a").stops.length, 9, "it survives a restart");
    assert.throws(() => handlers.gatheringLoopUse({ mapId: 1412, profession: "herbalism" }), /no loop to send/);
    assert.equal(handlers.gatheringLoopUse(null).inGame.chosen, null); assert.equal(changes, 2);
    assert.equal(new L.GatheringLoops(dir).get("a"), null);
    state.activeProfileId = null;
    assert.throws(() => handlers.gatheringLoopUse({ mapId: 1411, profession: "herbalism" }), /Choose a character first/);
    for (const bad of [{ mapId: 1411, profession: "herbalism", stops: [[0.1, 0.1], [0.2, 0.2]] }, { mapId: 1411, profession: "fishing", stops: [[0, 0], [0.1, 0.1], [0.2, 0.2]] }, { mapId: 1411, profession: "mining", stops: [[0, 0], [0.1, 2], [0.2, 0.2]] }, { mapId: 0, profession: "mining", stops: [[0, 0], [0.1, 0.1], [0.2, 0.2]] }]) assert.throws(() => loops.set("a", bad), /cannot be sent/);
    fs.writeFileSync(path.join(dir, "gathering-loops.json"), "{ not json");
    assert.equal(new L.GatheringLoops(dir).get("a"), null, "a damaged file is an empty one");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- E4: hand-off and the in-game walker ----------
test("the hand-off carries the loop as an extra field and stays schema 1, bounded and escaped", () => {
  const profiles = [saved("a", "Abel"), saved("b", "Zed"), saved("c", "Cara")];
  const loop = { mapId: 1411, profession: "herbalism", stops: [[0.1, 0.2], [0.33333, 0.4], [1, 0]] };
  const text = handoff.compile({ profiles, wishlist: (id) => (id === "a" ? [5202] : []), loops: (id) => (id === "a" || id === "b" ? { ...loop, profession: id === "a" ? "herbalism" : "mining" } : null) });
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n/);
  assert.match(text, /\["Abel-Thunder Hold"\]=\{wish=\{5202\},loop=\{m=1411,k="h",s=\{1000,2000,3333,4000,10000,0\}\}\},/);
  assert.match(text, /\["Zed-Thunder Hold"\]=\{wish=\{\},loop=\{m=1411,k="o",s=\{[\d,]+\}\}\},/, "a character with only a loop is still named");
  assert.doesNotMatch(text, /Cara/);
  assert.equal(handoff.compile({ profiles, wishlist: () => [] }), handoff.EMPTY, "without loops the file is unchanged");
  for (const bad of [{ ...loop, profession: "fishing" }, { ...loop, mapId: 0 }, { ...loop, stops: loop.stops.slice(0, 2) }, { ...loop, stops: Array.from({ length: 41 }, () => [0.5, 0.5]) }, { ...loop, stops: [[0.1, 0.2], [0.3, 1.4], [1, 0]] }, { ...loop, stops: [[0.1], [0.3, 0.4], [1, 0]] }, "x"])
    assert.equal(handoff.compile({ profiles, loops: () => bad }), handoff.EMPTY, JSON.stringify(bad));
  assert.equal(handoff.compile({ profiles, loops: () => { throw Error("no"); } }), handoff.EMPTY);
  // Worst case: 100 characters with full wish lists and 40-stop loops stay inside the limit.
  const many = Array.from({ length: 150 }, (_, i) => saved("p" + i, "N".repeat(50) + i));
  const worst = handoff.compile({ profiles: many, wishlist: () => Array.from({ length: 300 }, (_, i) => 2000000000 + i), loops: () => ({ mapId: 2147483647, profession: "mining", stops: Array.from({ length: 40 }, () => [1, 1]) }) });
  assert.ok(Buffer.byteLength(worst) <= handoff.MAX_BYTES);
  assert.equal(worst.split("\n").filter((l) => l.startsWith("[")).length, handoff.MAX_CHARACTERS);
  assert.ok(/wish=\{2000000000/.test(worst), "wishes are never dropped to make room for a loop");
  assert.equal(handoff.MAX_LOOP_STOPS, L.MAX_STOPS);
});

const STUBS = String.raw`
local msgs,set,now,combat,pos,ticks={},nil,100,false,{map=1411,x=.10,y=.20},{}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) msgs[#msgs+1]=m end}
InCombatLockdown=function() return combat end
UnitName=function() return 'Abel' end
GetRealmName=function() return 'Thunder Hold' end
UiMapPoint={CreateFromCoordinates=function(m,x,y) return {m=m,x=x,y=y} end}
CreateVector2D=function(x,y) return {x=x,y=y} end
C_Map={GetBestMapForUnit=function() return pos.map end,GetPlayerMapPosition=function() return {GetXY=function() return pos.x,pos.y end} end,
  CanSetUserWaypointOnMap=function() return true end,SetUserWaypoint=function(p) set=p end,
  GetWorldPosFromMapPos=function(_,v) return 1,{GetXY=function() return -v.y*2000,-v.x*3000 end} end}
C_SuperTrack={SetSuperTrackedUserWaypoint=function() end}
C_Timer={NewTicker=function(s,fn) local t={fn=fn,seconds=s,Cancel=function(self) self.cancelled=true end} ticks[#ticks+1]=t return t end}
BackstageForeverFindMaps={[1411]='Durotar'}
`;
test("the game reads only a clean loop for its own character", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverLoop.lua')
local read=BackstageForeverLoopRead
local data={schema=1,characters={['Abel-Thunder Hold']={wish={},loop={m=1411,k='h',s={1000,2000,3000,4000,10000,0}}},['Zed-Thunder Hold']={wish={7}}}}
local loop=read(data,'Abel','Thunder Hold')
assert(loop.mapId==1411 and loop.kind=='h' and #loop.stops==3 and loop.stops[1].x==.1 and loop.stops[3].x==1 and loop.stops[3].y==0)
assert(read(data,'Zed','Thunder Hold')==nil and read(data,'Nobody','x')==nil and read(nil,'Abel','Thunder Hold')==nil and read(data,nil,nil)==nil)
local function with(l) return read({schema=1,characters={['A-R']={loop=l}}},'A','R') end
assert(with({m=1411,k='h',s={1,2,3,4,5,6}}))
for _,bad in ipairs({{m=1411,k='x',s={1,2,3,4,5,6}},{m=0,k='h',s={1,2,3,4,5,6}},{m=1.5,k='h',s={1,2,3,4,5,6}},{m=1411,k='h',s={1,2,3,4}},{m=1411,k='h',s={1,2,3,4,5}},
  {m=1411,k='h',s={1,2,3,4,5,10001}},{m=1411,k='h',s={1,2,3,4,5,'x'}},{m=1411,k='h',s='x'},{m='1411',k='h',s={1,2,3,4,5,6}},'x'}) do assert(with(bad)==nil) end
local long={} for i=1,82 do long[i]=1 end
assert(with({m=1411,k='o',s=long})==nil,'more than 40 stops is refused')
assert(read({schema=2,characters=data.characters},'Abel','Thunder Hold')==nil)
dofile('addon/BackstageForever/BackstageForeverDesktop.lua')
assert(read(BackstageForeverDesktopData,'Abel','Thunder Hold')==nil,'the shipped file holds no loop')
`));

test("arriving moves the loop on, a far stop does not, and a lap is reported", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverLoop.lua')
local stops={{x=.1,y=.2},{x=.3,y=.4},{x=.5,y=.2}}
local size={width=3000,height=2000}
local d,unit=BackstageForeverLoopDistance(stops[1],.1,.21,size) assert(unit=='yards' and math.abs(d-20)<1e-6)
d,unit=BackstageForeverLoopDistance(stops[1],.1,.21,nil) assert(unit=='map' and math.abs(d-.01)<1e-9)
assert(BackstageForeverLoopDistance(stops[1],nil,.2,size)==nil and BackstageForeverLoopDistance({x=2,y=0},.1,.2,size)==nil)
assert(BackstageForeverLoopArrived(stops[1],.1,.21,size)==true,'20 yards is there')
assert(BackstageForeverLoopArrived(stops[1],.1,.22,size)==false,'40 yards is not')
assert(BackstageForeverLoopArrived(stops[1],.1,.21,nil)==true and BackstageForeverLoopArrived(stops[1],.1,.22,nil)==false,'1.2% of the map without a size')
assert(BackstageForeverLoopNearest(stops,.31,.41,size)==2 and BackstageForeverLoopNearest(stops,.9,.1,size)==3 and BackstageForeverLoopNearest({},.1,.1,size)==nil)
local state={index=1,count=0}
assert(BackstageForeverLoopAdvance(state,stops,.3,.4,size)==nil and state.index==1,'standing at another stop changes nothing')
local index,lap=BackstageForeverLoopAdvance(state,stops,.1,.2,size) assert(index==2 and lap==false)
index,lap=BackstageForeverLoopAdvance(state,stops,.3,.4,size) assert(index==3 and lap==false)
index,lap=BackstageForeverLoopAdvance(state,stops,.5,.2,size) assert(index==1 and lap==true,'the third arrival closes the loop')
index,lap=BackstageForeverLoopAdvance(state,stops,nil,nil,nil,true) assert(index==2 and state.visited==3,'a skipped stop is not counted as visited')
assert(BackstageForeverLoopAdvance({index=9},stops,.1,.2,size)==nil and BackstageForeverLoopAdvance(nil,stops,.1,.2,size)==nil and BackstageForeverLoopAdvance({index=1},{},.1,.2,size)==nil)
assert(BackstageForeverLoopLine({kind='h',stops=stops},2)=='Loop stop 2 of 3 (herbs): 30.0, 40.0')
assert(BackstageForeverLoopLine({kind='o',stops=stops},3)=='Loop stop 3 of 3 (ore): 50.0, 20.0' and BackstageForeverLoopLine({kind='o',stops=stops},4)==nil)
`));

test("/bf loop starts at the nearest stop, advances on a slow ticker out of combat, skips and stops", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverLoop.lua')
local function last() return msgs[#msgs] end
BackstageForeverLoopCommand('loop')
assert(last():find('No gathering loop from the desktop app yet',1,true) and set==nil and #ticks==0)
BackstageForeverDesktopData={schema=1,characters={['Abel-Thunder Hold']={wish={},loop={m=1411,k='h',s={1000,2000,3000,4000,5000,2000}}}}}
pos.map=1412 BackstageForeverLoopCommand('loop')
assert(last():find('Your gathering loop is for Durotar (3 stops)',1,true) and set==nil and BackstageForeverLoopActive()==nil,'another zone never starts it')
pos={map=1411,x=.29,y=.41} combat=true BackstageForeverLoopCommand('loop')
assert(last():find('waits until you leave combat',1,true) and set==nil)
combat=false msgs={} BackstageForeverLoopCommand('loop')
assert(msgs[1]:find('Gathering loop in Durotar: 3 stops. These are past spots, not live nodes.',1,true),msgs[1])
assert(msgs[2]:find('Loop stop 2 of 3 (herbs): 30.0, 40.0. Follow the arrow.',1,true),msgs[2])
assert(set.m==1411 and set.x==.3 and set.y==.4 and #ticks==1 and ticks[1].seconds==2,'one slow ticker, the nearest stop first')
-- Not there yet: nothing changes.
set=nil ticks[1].fn() assert(set==nil and BackstageForeverLoopActive().index==2)
-- Arrived, but in combat: it waits.
pos.x,pos.y=.3,.4 combat=true ticks[1].fn() assert(set==nil and BackstageForeverLoopActive().index==2)
combat=false msgs={} ticks[1].fn()
assert(set.x==.5 and set.y==.2 and BackstageForeverLoopActive().index==3 and msgs[1]:find('Loop stop 3 of 3',1,true))
-- On another map the ticker leaves the waypoint alone.
set=nil pos={map=1412,x=.5,y=.2} ticks[1].fn() assert(set==nil and BackstageForeverLoopActive().index==3)
pos={map=1411,x=.5,y=.2} ticks[1].fn() assert(set.x==.1 and BackstageForeverLoopActive().index==1)
pos={map=1411,x=.1,y=.2} msgs={} ticks[1].fn()
assert(msgs[1]:find('That was the whole loop',1,true) and BackstageForeverLoopActive().index==2,'three arrivals are one lap')
msgs={} BackstageForeverLoopCommand('loop next') assert(BackstageForeverLoopActive().index==3 and set.x==.5 and msgs[1]:find('Loop stop 3 of 3',1,true))
BackstageForeverLoopCommand('loop sideways') assert(last():find('Use /bf loop, /bf loop next or /bf loop stop.',1,true) and BackstageForeverLoopActive().index==3)
BackstageForeverLoopCommand('loop stop')
assert(BackstageForeverLoopActive()==nil and ticks[1].cancelled==true and last():find('Gathering loop stopped',1,true))
set=nil ticks[1].fn() assert(set==nil,'a stopped loop sets nothing')
BackstageForeverLoopCommand('loop stop') assert(last():find('No gathering loop is running.',1,true))
BackstageForeverLoopCommand('loop next') assert(last():find('Type /bf loop to start it',1,true))
-- A start while one runs replaces it: the old ticker is cancelled.
BackstageForeverLoopCommand('loop') assert(#ticks==2) BackstageForeverLoopCommand('loop') assert(#ticks==3 and ticks[2].cancelled==true)
-- A game that refuses the waypoint still names the coordinates.
C_Map.CanSetUserWaypointOnMap=function() return false end msgs={} BackstageForeverLoopCommand('loop next')
assert(msgs[1]:find('would not place a waypoint here; walk to those coordinates',1,true))
`));

test("the loop file only acts on a typed command and never moves, targets or gathers", () => {
  const src = read("addon/BackstageForever/BackstageForeverLoop.lua");
  for (const forbidden of ["TargetUnit", "MoveForward", "InteractUnit", "CastSpell", "UseAction", "SendChatMessage", "COMBAT_LOG", "RunMacro", "TurnOrAction"]) assert.ok(!src.includes(forbidden), forbidden);
  assert.match(src, /if call\(InCombatLockdown\)~=false then return end/, "the ticker waits in combat");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='loop'/);
});

test("remembered spots your skill can gather reach the minimap, with the next loop stop", () => lua(STUBS + String.raw`
local enabled=true
BackstageForeverHelperEnabled=function(key) return key=='gatheringMarks' and enabled end
local calls=0
BackstageForeverGatheringSpots=function(map) calls=calls+1 if map==1411 then return {{x=.2,y=.2,name='Peacebloom',method='herbalism'},{x=.6,y=.6,name='Battered Chest',method='chest'}} end return {} end
dofile('addon/BackstageForever/BackstageForeverLoop.lua')
local rows=BackstageForeverLoopMinimapPoints(1411,100)
assert(#rows==2 and rows[1].layer=='node' and rows[1].title=='Peacebloom' and rows[1].icon:find('Flower',1,true) and rows[2].icon:find('INV_Box',1,true))
BackstageForeverLoopMinimapPoints(1411,105) assert(calls==1,'the list is cached for 20 seconds')
BackstageForeverLoopMinimapPoints(1411,121) assert(calls==2)
assert(#BackstageForeverLoopMinimapPoints(1412,121)==0 and calls==3,'another map is read again')
enabled=false assert(#BackstageForeverLoopMinimapPoints(1411,200)==0,'the Gathering marks switch hides them')
assert(#BackstageForeverLoopMinimapPoints(nil,200)==0)
BackstageForeverDesktopData={schema=1,characters={['Abel-Thunder Hold']={loop={m=1411,k='o',s={1000,2000,3000,4000,5000,2000}}}}}
BackstageForeverLoopCommand('loop')
rows=BackstageForeverLoopMinimapPoints(1411,300)
assert(#rows==1 and rows[1].layer=='loop' and rows[1].x==.1 and rows[1].detail:find('Loop stop 1 of 3 (ore)',1,true))
assert(#BackstageForeverLoopMinimapPoints(1412,300)==0)
`));

test("the minimap adds at most twelve node pins after the quest pins and stays display only", () => {
  const src = read("addon/BackstageForever/BackstageForeverMinimap.lua");
  assert.match(src, /local MAX_NODES=12/);
  assert.match(src, /pcall\(BackstageForeverLoopMinimapPoints,mapId,now\)/);
  assert.match(src, /if x and \(not edge or point\.layer=='loop'\) then/, "only the loop stop may sit on the edge");
  assert.match(src, /for i=1,math\.min\(MAX_NODES,#extra\) do chosen\[#chosen\+1\]=extra\[i\] end/);
  assert.match(src, /frame\.icon:SetTexture\(row\.icon or icons\[row\.layer\]\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverGathering.lua"), /function BackstageForeverGatheringSpots\(mapId\)[\s\S]{0,200}BackstageForeverNodeGatherable\(r,ownedRanks\)~=false/);
});

// ---------- W1: rare enemies, chests and mailboxes ----------
test("the bundled world finds pack is intact and says where its rare flag comes from", () => {
  const { check, counts } = require("../scripts/build-forever-world.cjs");
  const lock = check();
  const pack = W.loadWorldPack();
  assert.deepEqual(counts(pack), lock.counts);
  assert.equal(pack.classification, W.CLASSIFICATION);
  assert.ok(pack.rares.length >= 400 && lock.counts.raresPlaced >= 20 && lock.counts.raresPlaced < pack.rares.length, "most rares are known by name only");
  // Evidence for the flag: every creature players saw as rare in game is rare in the client data too.
  assert.equal(lock.crossCheck.alsoClassifiedRare, lock.crossCheck.observedRareCreatures);
  assert.ok(lock.crossCheck.observedRareCreatures >= 40);
  const bundled = require("../data/forever-creatures/pack.json").creatures.filter((c) => c.rare).map((c) => c.id);
  const ids = new Set(pack.rares.map((r) => r.id));
  assert.deepEqual(bundled.filter((id) => !ids.has(id)), [], "every rare of the creature reference is listed");
  for (const r of pack.rares) assert.ok(!/[\[\]]|UNUSED|TEST/.test(r.name), r.name);
  assert.ok(pack.nodes.every((n) => L.nodeInfo(n.name)?.kind === n.kind && L.nodeSkill(n.name) === n.skill));
  assert.ok(pack.chests.every((c) => /Chest$|Footlocker$/.test(c.name)));
  assert.ok(lock.bytes < W.LIMITS.bytes);
  assert.match(read(".gitattributes"), /data\/forever-world\/\* text eol=lf/);
  assert.match(read("package.json"), /"check:forever-world": "node scripts\/build-forever-world\.cjs --check"/);
});

test("the world finds validator refuses anything out of shape", () => {
  const good = () => ({ schemaVersion: 1, kind: "forever-world", product: "wowf", build: "1.60.1.71037", builds: ["1.60.1.71037"], sourceCommit: "a".repeat(40), license: "CC BY 4.0", attribution: W.ATTRIBUTION, classification: W.CLASSIFICATION,
    rares: [{ id: 5, name: "Old Vicejaw", positions: [], drops: [] }, { id: 9, name: "Gesharahan", elite: true, minLevel: 20, maxLevel: 21, positions: [{ mapId: 1413, x: 0.4, y: 0.2 }], drops: [{ itemId: 7, name: "Bandit Bracers", chance: 1, drops: 2 }, { itemId: 8, name: null, chance: 0.5, drops: 1 }] }],
    nodes: [{ id: 1, name: "Peacebloom", kind: "herb", skill: 1, positions: [{ mapId: 1411, x: 0.1, y: 0.2 }] }], chests: [{ id: 2, name: "Battered Chest", positions: [{ mapId: 1411, x: 0.3, y: 0.3 }] }], mailboxes: [{ mapId: 1454, x: 0.5, y: 0.6 }] });
  assert.doesNotThrow(() => W.validateWorldPack(good()));
  const broken = [(p) => { p.kind = "x"; }, (p) => { p.classification = "guessed"; }, (p) => { p.rares[0].id = 9; p.rares[1].id = 5; }, (p) => { p.rares[1].elite = false; }, (p) => { p.rares[1].minLevel = 30; },
    (p) => { p.rares[1].positions[0].mapId = 1414; }, (p) => { p.rares[1].positions[0].x = 1.2; }, (p) => { p.rares[1].drops[0].chance = 0; }, (p) => { p.rares[1].drops[0].extra = 1; },
    (p) => { p.nodes[0].kind = "fish"; }, (p) => { p.nodes[0].positions = []; }, (p) => { p.chests[0].name = ""; }, (p) => { p.mailboxes[0].mapId = 5; }, (p) => { p.sourceCommit = "x"; }, (p) => { p.build = "1.60.1.70959"; }, (p) => { p.extra = 1; }];
  for (const breakIt of broken) { const p = good(); breakIt(p); assert.throws(() => W.validateWorldPack(p), /Invalid world finds pack/, breakIt.toString()); }
  const g = good();
  assert.equal(W.rareLabel(g.rares[1]), "Rare elite · level 20-21"); assert.equal(W.rareLabel(g.rares[0]), "Rare");
  assert.equal(W.dropLine(g.rares[1]), "Bandit Bracers (seen 2×), Item #8 (seen 1×)"); assert.equal(W.dropLine(g.rares[0]), null);
  const pins = W.worldPins(g);
  assert.deepEqual(pins.map((p) => p.kind), ["rare", "herb", "chest", "mailbox"]);
  assert.match(pins[0].source, /rares are not always up/);
  assert.deepEqual(W.rareSummary(g, 1413), { here: [{ id: 9, name: "Gesharahan", label: "Rare elite · level 20-21", elite: true, x: 0.4, y: 0.2, drops: "Bandit Bracers (seen 2×), Item #8 (seen 1×)", dropItems: [7, 8] }], total: 2, placed: 1, withDrops: 1 });
  assert.deepEqual(W.rareSummary(g, 1411).here, []); assert.deepEqual(W.rareSummary(null, 1411), { here: [], total: 0, placed: 0, withDrops: 0 });
  assert.equal(W.loadWorldPack(path.join(root, "package.json")), null, "a wrong file is no pack");
});

test("the World Map gets rare, chest and mailbox layers and an honest rare list", () => {
  const { WorldMap, KINDS, buildStaticIndex } = require("../src/core/world-map.cjs");
  for (const k of ["rare", "chest", "mailbox"]) assert.ok(KINDS.includes(k));
  const pack = W.loadWorldPack();
  const state = { activeProfileId: null, profiles: [] };
  const map = new WorldMap({ getState: () => state, worldPack: pack });
  const barrens = map.build({ mapId: 1413 });
  assert.ok(barrens.counts.rare >= 5 && barrens.rares.here.length >= 5 && barrens.rares.total === pack.rares.length && barrens.rares.placed < barrens.rares.total);
  assert.ok(barrens.pins.some((p) => p.kind === "rare" && p.creatureId && /Rare/.test(p.sub)));
  const durotar = map.build({ mapId: 1411 });
  assert.ok(durotar.counts.nodes > 100 && !durotar.counts.herb && durotar.pins.filter((p) => p.reference).length === durotar.counts.nodes, "reference spots are their own layer, not counted as herbs or ore");
  assert.ok(map.search("mailbox").results.every((r) => r.kind === "mailbox") && map.search("mailbox").results.length > 5);
  assert.ok(map.search("Gesharahan").results[0].kind === "rare");
  assert.deepEqual(new WorldMap({ getState: () => state }).build({ mapId: 1413 }).rares, { here: [], total: 0, placed: 0, withDrops: 0 }, "without the pack the list is empty, not invented");
  assert.equal([...buildStaticIndex({}).values()].length, 0, "the advisor and other compilers are untouched unless they ask for the pack");
});

test("the addon's rare list reproduces from the pack and stays small", () => {
  const { compile, MAX_BYTES } = require("../scripts/build-addon-rares.cjs");
  const text = compile();
  assert.equal(read("addon/BackstageForever/BackstageForeverRareData.lua").replace(/\r\n/g, "\n"), text, "run npm run build:addon-rares");
  assert.ok(Buffer.byteLength(text) < MAX_BYTES);
  assert.equal((text.match(/\[\d+\]="/g) || []).length >= W.loadWorldPack().rares.length, true);
  const small = compile({ build: "1.60.1.71037", rares: [{ id: 5, name: 'Old "Vice" jaw', positions: [], drops: [] }, { id: 9, name: "Gesharahan", elite: true, positions: [], drops: [{ itemId: 7, name: "Bandit Bracers", chance: 1, drops: 2 }, { itemId: 8, name: null, chance: 1, drops: 1 }, { itemId: 9, name: "Sash", chance: 1, drops: 1 }, { itemId: 10, name: "Third", chance: 1, drops: 1 }] }] });
  assert.match(small, /n=\{\[5\]="Old \\034Vice\\034 jaw",\[9\]="Gesharahan"\},\ne=\{\[9\]=1\},\nd=\{\[9\]="Bandit Bracers, Sash"\}\}/);
  assert.match(read("package.json"), /"check:addon-rares": "node scripts\/build-addon-rares\.cjs --check"/);
});

test("a rare alerts once per session on target or mouseover, out of combat, and can be switched off", () => lua(String.raw`
local msgs,combat,unit={},false,nil
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) msgs[#msgs+1]=m end}
InCombatLockdown=function() return combat end
UnitExists=function(u) return unit~=nil and unit.at==u end
UnitIsPlayer=function() return unit.player==true end
UnitIsDead=function() return unit.dead==true end
UnitGUID=function() return unit.guid end
UnitName=function() return unit.name end
UnitLevel=function() return unit.level end
dofile('addon/BackstageForever/BackstageForeverRares.lua')
local id=BackstageForeverRareCreatureId
assert(id('Creature-0-4444-1-12-5832-0000A1B2C3')==5832 and id('Vehicle-0-4444-1-12-77-00001234AB')==77)
assert(id('Player-4444-00ABCDEF')==nil and id('Pet-0-4444-1-12-5832-0000A1B2C3')==nil and id('GameObject-0-4444-1-12-5832-0000A1B2C3')==nil and id(nil)==nil and id('Creature-0-1-1-1-99999999999-00')==nil)
BackstageForeverRareData={build='1.60.1.71037',n={[5832]='Thunderstomp',[3398]='Gesharahan'},e={[3398]=1},d={[5832]='Superior Belt'}}
local look=BackstageForeverRareLookup
local r=look(BackstageForeverRareData,5832) assert(r.name=='Thunderstomp' and r.elite==false and r.drops=='Superior Belt')
r=look(BackstageForeverRareData,3398) assert(r.elite==true and r.drops==nil)
assert(look(BackstageForeverRareData,1)==nil and look(nil,5832)==nil and look({},5832)==nil and look(BackstageForeverRareData,'5832')==nil)
assert(BackstageForeverRareLine(look(BackstageForeverRareData,5832),'Thunderstomp',24)=='Rare enemy: Thunderstomp (rare, level 24). Players saw it drop: Superior Belt.')
assert(BackstageForeverRareLine(look(BackstageForeverRareData,3398),nil,-1)=='Rare enemy: Gesharahan (rare elite, level ??).')
assert(BackstageForeverRareLine(look(BackstageForeverRareData,3398),'Gescharahan',nil)=='Rare enemy: Gescharahan (rare elite).','the game'.."'s own name is shown")
local seen={} assert(BackstageForeverRareNote(seen,5)==true and BackstageForeverRareNote(seen,5)==false and BackstageForeverRareNote(seen,6)==true and BackstageForeverRareNote(nil,5)==false)
-- A normal creature and a player say nothing.
unit={at='target',guid='Creature-0-1-1-1-6-0000000001',name='Kobold Vermin',level=1} BackstageForeverRareLook('target') assert(#msgs==0)
unit={at='mouseover',guid='Player-1-0000000A',name='Thunderstomp',player=true} BackstageForeverRareLook('mouseover') assert(#msgs==0)
-- A dead rare, and a rare while in combat, say nothing and do not use up the one alert.
unit={at='target',guid='Creature-0-1-1-1-5832-0000000002',name='Thunderstomp',level=24,dead=true} BackstageForeverRareLook('target') assert(#msgs==0)
unit.dead=false combat=true BackstageForeverRareLook('target') assert(#msgs==0)
combat=false BackstageForeverRareLook('mouseover') assert(#msgs==0,'the unit is the target, not under the mouse')
BackstageForeverRareLook('target')
assert(#msgs==1 and msgs[1]:find('Rare enemy: Thunderstomp (rare, level 24). Players saw it drop: Superior Belt.',1,true),msgs[1])
BackstageForeverRareLook('target') unit.at='mouseover' BackstageForeverRareLook('mouseover') assert(#msgs==1,'once per rare per session')
unit={at='mouseover',guid='Creature-0-1-1-1-3398-0000000003',name='Gesharahan',level=20}
assert(BackstageForeverRaresCommand('rares off')==false and msgs[#msgs]:find('Rare enemy alerts off.',1,true))
BackstageForeverRareLook('mouseover') assert(#msgs==2,'switched off: silent')
assert(BackstageForeverRaresCommand('rares on')==true and BackstageForeverWorldSettings.rares==true)
BackstageForeverRareLook('mouseover') assert(msgs[#msgs]:find('Gesharahan (rare elite, level 20)',1,true))
msgs={} BackstageForeverRaresCommand('rares')
assert(msgs[1]:find('Rare enemy alerts are on. 2 rare enemies are known by name.',1,true) and msgs[2]:find('Met this session: Thunderstomp, Gesharahan.',1,true))
`));

test("the rare alert file reads units only and registers no combat or nameplate scanning", () => {
  const src = read("addon/BackstageForever/BackstageForeverRares.lua");
  for (const forbidden of ["TargetUnit", "SetRaidTarget", "SendChatMessage", "COMBAT_LOG", "NAME_PLATE", "PlaySound", "FocusUnit"]) assert.ok(!src.includes(forbidden), forbidden);
  assert.match(src, /'PLAYER_LOGIN','PLAYER_TARGET_CHANGED','UPDATE_MOUSEOVER_UNIT'/);
  assert.match(src, /call\(InCombatLockdown\)~=false then return end/);
  assert.match(read("addon/BackstageForever/BackstageForeverOptions.lua"), /switch\('Rare enemy alerts',[^\n]*on\('BackstageForeverWorldSettings','rares'\),'rares'\)/);
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /BackstageForeverWorldSettings/);
});

// ---------- W4: the wider finder ----------
test("the finder index covers more kinds within its size cap, and reproduces", () => {
  const { compile, coverage, MAX_BYTES } = require("../scripts/build-find-index.cjs");
  const text = compile().replace(/\r\n/g, "\n");
  assert.equal(read("addon/BackstageForever/BackstageForeverFind.lua").replace(/\r\n/g, "\n"), text, "run npm run build:find-index");
  assert.ok(Buffer.byteLength(text) < MAX_BYTES, `finder file is ${Buffer.byteLength(text)} bytes`);
  const c = coverage();
  assert.ok(c.rows >= 2800 && c.maps >= 40, JSON.stringify(c));
  for (const kind of ["f", "t", "v", "q", "n", "x", "h", "o", "r", "c", "m", "d", "b"]) assert.ok(c.kinds[kind] > 0, `no rows of kind ${kind}`);
  assert.ok(c.quests >= 1000, "quests players met in Forever point at their givers");
  assert.ok(c.kinds.f >= 30, "flight masters come from the transport pack too");
  assert.ok(c.kinds.q >= 500 && c.items >= 900);
  assert.ok(c.kinds.r === W.loadWorldPack().rares.filter((r) => r.positions.length).length, "only rares with a place can be found");
});

const FIND = STUBS + String.raw`
pos={map=1413,x=.6,y=.1}
dofile('addon/BackstageForever/BackstageForeverLive.lua')
dofile('addon/BackstageForever/BackstageForeverFind.lua')
local function first(q,limit) return BackstageForeverFindSearch(q,pos.map,pos.x,pos.y,limit or 6) end
`;
test("the search finds quest givers by quest, vendors by their wares, rares, nodes and mailboxes", () => lua(FIND + String.raw`
local f=first('mailbox') assert(#f>0 and f[1].r[6]=='m' and f[1].r[3]==1413,'the nearest mailbox on your own map first')
assert(f[1].d<=(f[2] and f[2].r[3]==1413 and f[2].d or 9))
f=first('rare') assert(#f>0 and f[1].r[6]=='r' and f[1].r[3]==1413 and f[1].r[2]:find('Rare',1,true))
f=first('herb') assert(#f>0 and f[1].r[6]=='h' and f[1].r[2]:find('skill',1,true))
f=first('chest') assert(#f>0 and f[1].r[6]=='c')
f=first('quest') assert(#f==6 and f[1].r[6]=='q' and f[1].r[2]:find('Quest: ',1,true))
-- One entry per name and map, even when a node has many spots.
local seen={} for _,x in ipairs(first('copper vein',8)) do local k=x.r[1]..'@'..x.r[3] assert(not seen[k]) seen[k]=true end
-- A ware finds the vendor that sells it, and says which ware matched.
local ware=BackstageForeverFindItems[1]
f=first(ware) assert(#f>0)
local sold=false for _,x in ipairs(f) do if x.item==ware and x.r[6]=='v' then sold=true end end assert(sold,'no vendor found for '..ware)
assert(BackstageForeverFindDescribe(f[1].r,f[1].item):find(' sells '..ware,1,true) or f[1].item==nil)
-- A quest title finds its giver.
local giver for _,r in ipairs(BackstageForeverFindData) do if r[6]=='q' and r[2]:match('^Quest: [%a ]+$') and #r[2]>14 then giver=r break end end
local title=giver[2]:match('^Quest: ([%a ]+)$')
f=first(title) local hit=false for _,x in ipairs(f) do if x.r==giver or x.r[1]==giver[1] then hit=true end end assert(hit,'quest title '..title)
-- Any quest players met finds its giver, not only the first quest a giver hands out; the list says how many matched.
local quest=BackstageForeverFindQuests[1]
assert(type(quest[1])=='string' and type(quest[2])=='number' and BackstageForeverFindData[quest[3]],'quest rows point at a giver row')
f=first(quest[1]) hit=false for _,x in ipairs(f) do if x.quest==quest[1] and x.r==BackstageForeverFindData[quest[3]] then hit=true end end assert(hit,'quest '..quest[1])
assert(type(f.total)=='number' and f.total>=#f)
assert(BackstageForeverFindDescribe(BackstageForeverFindData[quest[3]],nil,quest[1],12):find(quest[1]..' (quest, level 12) from ',1,true))
-- Dungeons and bosses are found at the entrance.
f=first('dungeon') assert(#f>0 and f[1].r[6]=='d' and f[1].r[2]:find('Dungeon',1,true))
local boss for _,r in ipairs(BackstageForeverFindData) do if r[6]=='b' then boss=r break end end
f=first(boss[1]) hit=false for _,x in ipairs(f) do if x.r[6]=='b' and x.r[2]:find('^Boss in ') then hit=true end end assert(hit,'boss '..boss[1])
msgs={} set=nil BackstageForeverFind('find '..boss[1]) local said=false for _,m in ipairs(msgs) do if m:find('This marks the entrance',1,true) then said=true end end assert(set and said)
msgs={} set=nil BackstageForeverFind('find '..quest[1]) assert(set and msgs[1]:find(quest[1],1,true),msgs[1])
assert(#first('zzzz')==0 and #first('')==0 and #first(string.rep('a',61))==0 and #first(nil)==0)
assert(#first('trainer',3)==3,'the limit is kept')
-- The command still sets the waypoint on the best match and names the others.
msgs={} set=nil BackstageForeverFind('find mailbox')
assert(set and set.m==1413 and #msgs>=2)
msgs={} set=nil BackstageForeverFind('find '..ware)
assert(set and msgs[1]:find(' sells '..ware,1,true),msgs[1])
msgs={} set=nil BackstageForeverFind('find rare') assert(msgs[1]:find('Rare enemies are not always there',1,true) and set)
msgs={} set=nil BackstageForeverFind('find') assert(set==nil and msgs[1]:find('quest, rare, herb, ore, chest or mailbox',1,true))
`));

test("the map search box lists matches and sets a waypoint only when one is clicked", () => lua(FIND + String.raw`
local frames={}
local function widget(kind)
  local w={kind=kind,scripts={},shown=true}
  for _,m in ipairs({'SetSize','SetPoint','SetFrameStrata','SetBackdrop','SetBackdropColor','SetWidth','SetJustifyH','SetWordWrap','SetAutoFocus','SetMaxLetters','ClearFocus','RegisterEvent'}) do w[m]=function() end end
  w.SetText=function(self,t) self.text=t end w.GetText=function(self) return self.text end
  w.Show=function(self) self.shown=true end w.Hide=function(self) self.shown=false end w.IsShown=function(self) return self.shown end
  w.SetScript=function(self,name,fn) self.scripts[name]=fn end w.HookScript=function(self,name,fn) self.scripts[name]=fn end
  w.CreateFontString=function() return widget('FontString') end
  frames[#frames+1]=w return w
end
CreateFrame=function(kind) return widget(kind) end
WorldMapFrame=widget('Map') WorldMapFrame.ScrollContainer=widget('Canvas')
GameTooltip=widget('Tooltip')
local events
dofile('addon/BackstageForever/BackstageForeverMapSearch.lua')
for _,w in ipairs(frames) do if w.scripts.OnEvent then events=w end end
local rows=BackstageForeverMapSearchRows('mailbox',1413,.6,.1)
assert(#rows>0 and #rows<=8 and rows.total>=#rows and rows[1].kind=='m' and rows[1].text=='Mailbox' and rows[1].where:match('^%d+%.%d, %d+%.%d$') and rows[1].way:match('^way 1413 [%d%.]+ [%d%.]+ Mailbox$'),rows[1].where)
local far for _,row in ipairs(BackstageForeverMapSearchRows('mailbox',1429,.5,.5)) do if row.where:find('^%a') then far=row end end
assert(#BackstageForeverMapSearchRows('zzzz',1413,.6,.1)==0)
-- A quest match names the quest and its giver; the waypoint goes to the giver.
local quest=BackstageForeverFindQuests[1] local giver=BackstageForeverFindData[quest[3]]
local qrow for _,row in ipairs(BackstageForeverMapSearchRows(quest[1],giver[3],.5,.5)) do if row.kind=='q' and row.text==quest[1]..' ('..giver[1]..')' then qrow=row end end
assert(qrow and qrow.way:find(giver[1],1,true),'quest row for '..quest[1])
-- Opening the map builds the box; a search fills rows; nothing is set until a click.
events.scripts.OnEvent(events,'PLAYER_LOGIN')
WorldMapFrame.scripts.OnShow()
local box,buttons for _,w in ipairs(frames) do if w.kind=='EditBox' then box=w end end
buttons={} for _,w in ipairs(frames) do if w.kind=='Button' then buttons[#buttons+1]=w end end
assert(box and #buttons==8)
for _,b in ipairs(buttons) do assert(b.shown==false) end
set=nil box.text='mailbox' box.scripts.OnEnterPressed(box)
assert(set==nil,'typing and Enter never set a waypoint')
assert(buttons[1].shown==true and buttons[1].way:match('^way 1413 '))
-- The results panel: a heading, a kind per row, and a line when there are more matches than rows.
local panel,head for _,w in ipairs(frames) do if w.text=='Click a match for a waypoint.' then head=w end end
assert(head,'the panel says a click sets the waypoint')
assert(buttons[1].tag.text=='Mail' and buttons[1].label.text=='Mailbox' and buttons[1].where.text:match('^%d+%.%d, %d+%.%d$'))
box.text='trainer' box.scripts.OnEnterPressed(box)
local more for _,w in ipairs(frames) do if type(w.text)=='string' and w.text:find(' more. Type more letters.',1,true) then more=w end end
assert(more and more.shown==true and buttons[8].shown==true and buttons[1].tag.text=='Trainer','eight rows and a count of the rest')
box.text='zzzz' box.scripts.OnEnterPressed(box)
assert(head.text=='No match in the bundled reference.' and buttons[1].shown==false)
set=nil box.text='mailbox' box.scripts.OnEnterPressed(box)
buttons[1].scripts.OnClick(buttons[1])
assert(set and set.m==1413,'the click sets the waypoint')
box.scripts.OnEscapePressed(box) for _,b in ipairs(buttons) do assert(b.shown==false and b.way==nil) end
-- In combat the box hides and a search does nothing.
combat=true events.scripts.OnEvent(events,'PLAYER_REGEN_DISABLED')
set=nil box.text='mailbox' box.scripts.OnEnterPressed(box) assert(buttons[1].shown==false and set==nil)
combat=false
assert(BackstageForeverMapSearchCommand('mapsearch off')==false and BackstageForeverWorldSettings.searchBox==false)
assert(BackstageForeverMapSearchCommand('mapsearch on')==true and msgs[#msgs]:find('Map search box on',1,true))
assert(BackstageForeverMapSearchCommand('mapsearch nonsense')==true and msgs[#msgs]:find('Use /bf mapsearch on or /bf mapsearch off.',1,true))
`));

// ---------- wiring ----------
test("the desktop wires the loop and the finder layers end to end", () => {
  const main = read("src/main.cjs"), preload = read("src/preload.cjs"), html = read("src/renderer/index.html"), wm = read("src/renderer/world-map.js"), wf = read("src/renderer/world-finders.js");
  assert.match(main, /loops: \(id\) => gatheringLoops\?\.get\(id\) \|\| null/);
  assert.match(main, /registerGatheringLoop\(\{ handle,/);
  assert.match(main, /worldPack: require\("\.\/core\/world-finds\.cjs"\)\.loadWorldPack\(\)/);
  assert.match(main, /gatheringLoops\?\.clear\(\)/, "a full reset forgets the loops");
  assert.match(preload, /gatheringLoop: \(input\) => invoke\("gatheringLoop", input\)/);
  assert.match(preload, /gatheringLoopUse: \(input\) => invoke\("gatheringLoopUse", input\)/);
  assert.ok(html.indexOf('<script src="world-finders.js">') > 0 && html.indexOf('<script src="world-finders.js">') < html.indexOf('<script src="world-map.js">'));
  assert.match(html, /href="world-finders\.css"/);
  assert.match(wm, /World: \[\["rare", "Rare enemies"\], \["nodes", "Reference herbs and ore"\], \["chest", "Chests"\], \["mailbox", "Mailboxes"\]\]/);
  assert.match(wm, /OFF_BY_DEFAULT = new Set\(\["npc", "otherFaction", "nodes", "chest", "mailbox", "c-npc"\]\)/, "the busy reference layers start off");
  assert.match(wm, /\(!p\.reference \|\| layers\.nodes\)/);
  assert.match(wf, /extra = true, show = false,/, "the loop is not drawn until asked for");
  assert.match(wm, /window\.WorldFinders\?\.draw\(ctx, toScreen, model\?\.mapId\)/);
  assert.match(wf, /Past spots|loop\.note/);
  assert.match(wf, /Rares are not always up\./);
});

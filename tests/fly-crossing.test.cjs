"use strict";
// B2: boats and zeppelins in /bf fly. The desktop hands the stops it worked out from the player's
// game files to the game; the game adds the ride when the place is across the sea.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), addon = path.join(root, "addon", "BackstageForever");
const handoff = require("../src/core/desktop-handoff.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const saved = (id, name, faction) => ({ id, name, realm: "Realm", faction, source: { kind: "wow-addon", id: "s-" + id, updatedAt: "2026-11-22T00:00:00Z" } });
const stop = (label, instance, wx, wy) => ({ key: "k", label, named: true, instance, wx, wy, sides: 2 });
const zeppelin = { id: 1, name: "The Thundercaller", mode: "zeppelin", side: "Horde", timing: "estimated", source: "game-files", stops: [stop("Orgrimmar zeppelin tower", 1, 1300.4, -4400.6), stop("Tirisfal Glades zeppelin tower", 0, 2050, 290)], rides: [{ from: 0, to: 1, seconds: 118, dock: 60, yards: 9000, via: [] }, { from: 1, to: 0, seconds: 121, dock: 60, yards: 9000, via: [] }] };
const boat = { id: 2, name: null, mode: "boat", side: "Alliance", timing: "estimated", source: "game-files", stops: [stop("Menethil Harbor dock", 0, -3700, -600), stop("Theramore dock", 1, -4000, -4700)], rides: [{ from: 0, to: 1, seconds: 200 }, { from: 1, to: 0, seconds: 200 }] };
const neutral = { ...boat, id: 3, name: 'The "Maiden"', side: "Both", stops: [stop("Ratchet dock", 1, -1000, -3800), stop("Booty Bay dock", 0, -14280, 560)] };
const tram = { id: "tram", name: "Deeprun Tram", mode: "tram", side: "Alliance", timing: "unknown", source: "reference", stops: [stop("Stormwind", 0, 0, 0), stop("Ironforge", 0, 1, 1)], rides: [{ from: 0, to: 1, seconds: 0 }] };
const rides = { transports: [zeppelin, boat, neutral, tram] };

test("the hand-off carries the stops per faction, additively, data only and bounded", () => {
  const horde = [saved("a", "Abel", "Horde")], both = [...horde, saved("b", "Bea", "Alliance")];
  const text = handoff.compile({ profiles: horde, wishlist: () => [5], ships: () => rides });
  assert.match(text, /BackstageForeverDesktopData=\{schema=1,characters=\{\n\["Abel-Realm"\]=\{wish=\{5\}\},\n\},ships=\{H=\{/, "schema stays 1; characters are untouched");
  assert.match(text, /\{k="z",n="The Thundercaller",s=\{\{"Orgrimmar zeppelin tower",1,1300,-4401\},\{"Tirisfal Glades zeppelin tower",0,2050,290\}\},r=\{\{1,2,118\},\{2,1,121\}\}\}/);
  assert.match(text, /n="The \\034Maiden\\034"/, "names are escaped, never executable");
  assert.doesNotMatch(text, /Menethil|Deeprun|A=\{/, "the other faction's boat and the tram (no place, no time) stay out");
  const two = handoff.compile({ profiles: both, ships: () => rides });
  assert.match(two, /ships=\{A=\{\{k="b",s=\{\{"Menethil Harbor dock"/); assert.match(two, /,H=\{\{k="z"/);
  assert.match(two, /characters=\{\n\},ships=/, "stops are written even when no character has a wish");
  // No stops known, a supplier that throws, or damaged rows: the file is the plain one.
  const plain = handoff.compile({ profiles: horde, wishlist: () => [5] });
  assert.doesNotMatch(plain, /ships/);
  assert.equal(handoff.compile({ profiles: horde, wishlist: () => [5], ships: () => { throw Error("no game"); } }), plain);
  assert.equal(handoff.compile({ profiles: horde, wishlist: () => [5], ships: () => null }), plain);
  const bad = (change) => handoff.compile({ profiles: horde, wishlist: () => [5], ships: () => ({ transports: [{ ...zeppelin, ...change }] }) });
  for (const change of [{ stops: [zeppelin.stops[0]] }, { stops: [{ ...zeppelin.stops[0], label: "a|b" }, zeppelin.stops[1]] }, { stops: [{ ...zeppelin.stops[0], wx: Infinity }, zeppelin.stops[1]] }, { rides: [{ from: 0, to: 5, seconds: 10 }] }, { rides: [{ from: 0, to: 1, seconds: 0 }] }, { source: "reference" }, { stops: [zeppelin.stops[0], { ...zeppelin.stops[1], named: false }] }])
    assert.equal(bad(change), plain, JSON.stringify(change));
  assert.equal(handoff.EMPTY, handoff.compile(), "the shipped empty file is unchanged");
  // Caps: at most 24 transports and 30 rides each; a field past its byte cap is left out whole.
  const many = { transports: Array.from({ length: 40 }, (_, i) => ({ ...zeppelin, id: i, name: "Ship " + i })) };
  assert.equal(handoff.compile({ profiles: horde, ships: () => many }).match(/k="z"/g).length, handoff.MAX_SHIPS);
  const wide = { transports: Array.from({ length: 24 }, (_, i) => ({ ...zeppelin, name: "N".repeat(60), stops: Array.from({ length: 6 }, (_, j) => stop("S".repeat(58) + i % 10 + j, 1, j * 100, 0)), rides: Array.from({ length: 40 }, (_, j) => ({ from: j % 6, to: (j + 1) % 6, seconds: 36000 })) })) };
  const capped = handoff.compile({ profiles: both, ships: () => wide });
  assert.ok(Buffer.byteLength(capped) < handoff.MAX_BYTES);
  if (/ships=/.test(capped)) assert.ok(Buffer.byteLength(capped.match(/ships=.*$/m)[0]) <= handoff.MAX_SHIP_BYTES + 2);
});

const HELPERS = fs.readFileSync(path.join(addon, "BackstageForeverHelpers.lua"), "utf8");
const TRAVEL = fs.readFileSync(path.join(addon, "BackstageForeverTravel.lua"), "utf8");
// Two continents: 1 (west: Barrens 10, Orgrimmar 11) and 0 (east: Undercity 20, Tarren Mill 21).
const WORLD = String.raw`
said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
function BackstageForeverMoney(c) return c..'c' end
CreateFrame=function() local f={} f.RegisterEvent=function() end f.SetScript=function() end return f end
GetBuildInfo=function() return '1.60.1','123' end
here={map=1413,x=0.5,y=0.5}
C_Map={GetBestMapForUnit=function() return here.map end,GetPlayerMapPosition=function() return {GetXY=function() return here.x,here.y end} end,GetMapInfo=function() return nil end}
UnitFactionGroup=function() return 'Horde' end
BackstageForeverTravelData={build='1.60.1.100',speed=30,flights={
  nodes={[10]={wx=0,wy=0,i=1,n='Devrak'},[11]={wx=1400,wy=-4300,i=1,n='Doras'},[20]={wx=1900,wy=240,i=0,n='Michael'},[21]={wx=0,wy=-900,i=0,n='Zarise'}},
  edges={[10]={[11]={100,50}},[11]={[10]={100,50}},[20]={[21]={200,70}},[21]={[20]={200,70}}},routes={},
  maps={[1413]={x0=1000,x1=-1000,y0=1000,y1=-1000,i=1}}}}
BackstageForeverAssistSettings={flightNames={[10]='Crossroads',[11]='Orgrimmar',[20]='Undercity',[21]='Tarren Mill'},flightNodes={[10]=true,[11]=true,[20]=true,[21]=true}}
`;
const run = (body, desktop) => lua(`${WORLD}\n${HELPERS}\n${desktop}\n${TRAVEL}\nlocal D=BackstageForeverTravelData\n${body}\nprint('ok')`);
const DESKTOP = handoff.compile({ profiles: [saved("a", "Abel", "Horde")], ships: () => rides }).replace(/^--.*\n/gm, "");

test("/bf fly across the sea: fly to the tower, ride, fly on, with the wait left open", () => {
  run(String.raw`
local ships=BackstageForeverFlyShips(BackstageForeverDesktopData,'H')
assert(#ships==2 and ships[1].kind=='z' and ships[1].name=='The Thundercaller' and #ships[1].stops==2 and ships[1].rides[1].seconds==118)
assert(#BackstageForeverFlyShips(BackstageForeverDesktopData,'A')==0 and #BackstageForeverFlyShips(nil,'H')==0 and #BackstageForeverFlyShips({ships={H='x'}},'H')==0)
-- Damaged rows are skipped one by one.
assert(#BackstageForeverFlyShips({ships={H={{k='z',s={{'a',1,0,0},{'b',0,0,0}},r={{1,2,10}}},{k='q',s={},r={}},{k='b',s={{'a',1,0,0},{'b','x',0,0}},r={{1,2,10}}},{k='b',s={{'a',1,0,0},{'b',0,0,0}},r={{1,9,10}}}}}},'H')==1)
local c=BackstageForeverFlyCrossing(D,ships,10,21,nil)
assert(c and c.ship.kind=='z' and c.near==11 and c.far==20 and c.before and c.after,'fly to Orgrimmar, ride, fly on from Undercity')
assert(c.before.seconds==100 and c.after.seconds==200 and c.ride.seconds==118)
assert(math.abs(c.seconds-(100+c.nearYards/7+118+c.farYards/7+200))<0.01)
assert(BackstageForeverFlyCrossing(D,ships,10,11,nil)==nil,'the same continent is not a crossing')
assert(BackstageForeverFlyCrossing(D,{},10,21,nil)==nil)
-- Only the two ends known: the walk to the tower is from the nearest flight point you do know, and it says how far.
local far=BackstageForeverFlyCrossing(D,ships,10,21,{[10]=true,[21]=true})
assert(far and far.near==10 and far.far==21 and not far.before and not far.after and far.nearYards>4000)
-- Starting at the tower's own flight point there is no first flight.
local direct=BackstageForeverFlyCrossing(D,ships,11,20,nil)
assert(direct and not direct.before and not direct.after)
local label=function(id) return BackstageForeverAssistSettings.flightNames[id] end
local lines=BackstageForeverFlyCrossingLines(c,label,false,30)
assert(lines[1]:find('^To Tarren Mill: about ') and lines[1]:find('plus the wait for the zeppelin.',1,true),lines[1])
assert(lines[2]:find('Fly from Crossroads to Orgrimmar',1,true),lines[2])
assert(lines[3]:find('^Go to the Orgrimmar zeppelin tower: about %d+ yards from the flight master at Orgrimmar%.$'),lines[3])
assert(lines[4]=='Ride the zeppelin from Orgrimmar zeppelin tower to Tirisfal Glades zeppelin tower: about 1 min 58 s, plus the wait.',lines[4])
assert(lines[5]:find('^Then go to the flight master at Undercity: about %d+ yards from the Tirisfal Glades zeppelin tower%.$'),lines[5])
assert(lines[6]:find('Fly from Undercity to Tarren Mill',1,true),lines[6])
assert(lines[#lines]:find('Nobody can know the wait',1,true))
local short=BackstageForeverFlyCrossingLines(direct,label,true,nil)
assert(short[2]:find('^Go to the Orgrimmar zeppelin tower') and short[4]:find('^Undercity is about %d+ yards from the Tirisfal Glades zeppelin tower%.$'),short[4])
assert(short[#short]:find('This assumes you know these flight points',1,true))
-- The command: a place across the sea prints the crossing.
said={} local got=BackstageForeverFlyCommand('fly tarren mill')
assert(got and got.dest==21 and #said>=6,#said)
assert(said[1]:find('Backstage Forever: To Tarren Mill: about',1,true),said[1])
-- A place on this continent is unchanged.
said={} BackstageForeverFlyCommand('fly orgrimmar')
assert(said[1]:find('Fly from Crossroads to Orgrimmar',1,true),said[1])
print('ok')`, DESKTOP);
});

test("/bf fly across the sea without stops from the desktop says how to get them", () => {
  run(String.raw`
said={} BackstageForeverFlyCommand('fly undercity')
assert(#said==1 and said[1]:find('That place is on another continent',1,true) and said[1]:find('/reload',1,true),said[1])
-- Stops known, but none joins these continents for this faction: the old answer stands.
BackstageForeverDesktopData={schema=1,characters={},ships={H={{k='b',s={{'A dock',5,0,0},{'B dock',6,0,0}},r={{1,2,60}}}}}}
said={} BackstageForeverFlyCommand('fly undercity')
assert(#said==1 and said[1]:find('No recorded flight connects',1,true),said[1])
print('ok')`, "BackstageForeverDesktopData={schema=1,characters={}}");
});

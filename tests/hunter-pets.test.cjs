"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const H = require("../src/core/hunter-pets.cjs");
const inv = require("./pack-invariants.cjs");
const COMMIT = "a".repeat(40);
const meta = (dataset, build) => ({ dataset, clientBuild: build, collectedOn: { first: "2026-11-20", last: "2026-11-22" } });
const raw = (build, beasts, training, creatures, details) => ({ build, files: {
  "hunter_pets.json": Buffer.from(JSON.stringify({ meta: meta("hunter_pets", build), beasts, training })),
  "creatures.json": Buffer.from(JSON.stringify({ meta: meta("creatures", build), creatures })),
  "creature_details.enUS.json": Buffer.from(JSON.stringify({ meta: meta("creature_details", build), creatures: details })),
} });
const tame = (family, level, spells, count = 1) => ({ sources: 1, tames: { count, families: { [family]: count }, levels: { [level]: count }, diet: { enUS: { Meat: 1 } }, spells } });
const builds = [
  raw("1.60.1.200", { 10: tame(1, 8, { 500: { count: 1, passive: false }, 900: { count: 1, passive: true } }), 30: tame(2, 30, {}) }, { 500: { costs: { 0: 2, 4: 1 }, families: { 1: 2, 2: 1 }, level: 8 } },
    { 10: { positions: [{ uiMap: 1429, mapX: 0.6021, mapY: 0.6954 }, { uiMap: 1429, mapX: 0.1, mapY: 0.1 }] } }, { 10: { name: "Gray Wolf", family: 1 }, 30: { name: "Тигр" } }),
  raw("1.60.1.100", { 10: tame(1, 9, { 501: { count: 2, passive: false } }, 2), 20: tame(4, 12, { 502: { count: 1, passive: false } }) }, { 500: { costs: { 6: 1 }, families: { 4: 1 }, level: 6 }, 502: { costs: {}, families: {}, level: 10 } },
    { 20: { positions: [{ uiMap: 1411, mapX: 0.5, mapY: 0.5 }] } }, { 10: { name: "Old Name" }, 20: { name: "Brown Bear" } }),
];
const compiled = () => H.compilePets(builds, { commit: COMMIT });

test("beasts join over the builds; abilities, levels and places are kept, other languages are left out", () => {
  const p = compiled();
  assert.deepEqual(p.beasts.map((b) => b.name), ["Gray Wolf", "Brown Bear"], "the beast seen only with a non-Latin name is left out");
  const wolf = p.beasts[0];
  assert.deepEqual({ family: wolf.family, minLevel: wolf.minLevel, maxLevel: wolf.maxLevel, abilities: wolf.abilities, passives: wolf.passives, tames: wolf.tames }, { family: 1, minLevel: 8, maxLevel: 9, abilities: [500, 501], passives: [900], tames: 3 });
  assert.deepEqual(wolf.spots, [{ mapId: 1429, x: 0.602, y: 0.695 }], "one place per zone map");
  assert.deepEqual(p.training, [{ id: 500, petLevel: 8, cost: 6, families: [1, 2, 4] }, { id: 502, petLevel: 10, cost: null, families: [] }]);
  assert.deepEqual(p.counts, { beasts: 2, withAbility: 2, abilities: 2, families: 2, unnamed: 1 });
});

test("the pack is validated strictly", () => {
  const p = compiled();
  for (const bad of [{ ...p, kind: "x" }, { ...p, beasts: [{ ...p.beasts[0], name: "a|b" }, p.beasts[1]] }, { ...p, beasts: [p.beasts[1], p.beasts[0]] }, { ...p, counts: { ...p.counts, beasts: 3 } },
    { ...p, beasts: [{ ...p.beasts[0], spots: [{ mapId: 1, x: 2, y: 0 }] }, p.beasts[1]] }, { ...p, training: [{ ...p.training[0], cost: -1 }, p.training[1]] }, { ...p, beasts: [{ ...p.beasts[0], minLevel: 20 }, p.beasts[1]] }])
    assert.throws(() => H.validatePets(bad), /Invalid hunter pet data/);
});

test("the pet book names abilities from the game files and says what it cannot know", () => {
  const p = compiled();
  const book = H.petBook(p, { spells: (ids) => ids.map((id) => (id === 500 ? { name: "Bite", rank: "Rank 1" } : null)), mapName: (m) => ({ 1429: "Elwynn Forest" })[m], level: 8 });
  assert.equal(book.named, true);
  const wolf = book.beasts[0];
  assert.equal(wolf.family, "Wolf"); assert.equal(wolf.tameable, true); assert.equal(book.beasts[1].tameable, false, "a level 12 beast is above a level 8 hunter");
  assert.deepEqual(wolf.abilities, [{ id: 500, name: "Bite", rank: "Rank 1", named: true, petLevel: 8, cost: 6 }, { id: 501, name: "Ability #501", rank: null, named: false, petLevel: null, cost: null }]);
  assert.deepEqual(wolf.places, [{ mapId: 1429, x: 0.602, y: 0.695, zone: "Elwynn Forest" }]);
  assert.deepEqual(book.abilities.find((a) => a.id === 500).taughtBy, ["Gray Wolf"]);
  assert.deepEqual(book.abilities.find((a) => a.id === 500).families, ["Wolf", "Cat", "Bear"]);
  assert.ok(book.notes.some((n) => /cannot say what your pet still lacks/.test(n)));
  assert.ok(book.notes.some((n) => /Only tames that players recorded/.test(n)));
  const bare = H.petBook(p, { spells: () => { throw Error("no game"); } });
  assert.equal(bare.named, false); assert.equal(bare.beasts[0].tameable, null);
  assert.ok(bare.notes.some((n) => /own game files/.test(n)));
  assert.equal(H.familyName(999), "Family 999");
});

test("the bundled pack matches its lock and notice, and the in-game copy matches the pack", () => {
  const tool = require("../scripts/build-forever-pets.cjs");
  const pack = tool.checkBundle(), lock = tool.readLock();
  inv.assertNewestFirst(pack.builds, 1);
  assert.match(lock.commit, inv.COMMIT); assert.match(lock.compiled.sha256, inv.SHA256);
  assert.deepEqual(H.loadPets(), pack);
  assert.ok(pack.counts.beasts >= 10 && pack.counts.abilities >= 20, JSON.stringify(pack.counts));
  for (const b of pack.beasts) assert.ok(H.FAMILIES[b.family], `${b.name}: family ${b.family} has a name`);
  const notice = fs.readFileSync(path.join(__dirname, "../data/forever-pets/NOTICE"), "utf8");
  assert.ok(notice.includes(`${pack.counts.beasts} beasts`) && notice.includes("not a full list"));
  const lua = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverPetData.lua"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(lua, tool.luaFile(pack));
  assert.ok(Buffer.byteLength(lua) < 64 * 1024);
});

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: body, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout;
}
test("/bf pet: near your level, search by family or ability, quiet in combat, refused on another patch", () => {
  lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverPetData.lua')
local real=BackstageForeverPetData
assert(type(real.beasts)=='table' and #real.beasts>=10 and type(real.training)=='table')
local data={build='1.60.1.71037',beasts={
  {i=1,n='Gray Wolf',f='Wolf',lo=8,hi=8,a={500},m=1429,x=.602,y=.695},
  {i=2,n='Old Cat',f='Cat',lo=30,hi=31,a={501,502}},
  {i=3,n='Plain Boar',f='Boar',lo=7,hi=7,a={}}},training={[500]={l=8,c=4},[501]={l=30}}}
local names={[500]={'Bite','Rank 2'},[501]={'Claw | x',nil}}
local function spell(id) local n=names[id] if n then return n[1],n[2] end end
local function map(id) return id==1429 and 'Elwynn Forest' or nil end
assert(BackstageForeverPetLine(data.beasts[1],data,spell,map)=='Gray Wolf (Wolf, level 8, Elwynn Forest 60, 70): Bite (Rank 2) pet level 8',BackstageForeverPetLine(data.beasts[1],data,spell,map))
assert(BackstageForeverPetLine(data.beasts[2],data,spell,map)=='Old Cat (Cat, level 30-31): Claw || x pet level 30; ability #502',BackstageForeverPetLine(data.beasts[2],data,spell,map))
assert(BackstageForeverPetLine(data.beasts[3],data,nil,nil)=='Plain Boar (Boar, level 7): no ability recorded')
assert(BackstageForeverPetLine(nil)==nil)
local rows,total=BackstageForeverPetFind(data,nil,9,spell)
assert(#rows==2 and total==2 and rows[1].n=='Plain Boar' and rows[2].n=='Gray Wolf')
rows=BackstageForeverPetFind(data,nil,31,spell) assert(#rows==1 and rows[1].n=='Old Cat')
rows=BackstageForeverPetFind(data,' CAT ',9,spell) assert(#rows==1 and rows[1].n=='Old Cat')
rows=BackstageForeverPetFind(data,'bite',9,spell) assert(#rows==1 and rows[1].n=='Gray Wolf')
rows=BackstageForeverPetFind(data,'zzz',9,spell) assert(#rows==0)
rows,total=BackstageForeverPetFind(data,nil,nil,spell,1) assert(#rows==1 and total==3)
assert(#BackstageForeverPetFind(nil,nil,9)==0)
-- The command: chat only.
local said={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,text) said[#said+1]=text end}
BackstageForeverPetData=data
UnitLevel=function() return 9 end
UnitClass=function() return 'Hunter','HUNTER' end
GetBuildInfo=function() return '1.60.1','70999' end
GetSpellInfo=function(id) return names[id] and names[id][1] end
GetSpellSubtext=function(id) return names[id] and names[id][2] end
C_Map={GetMapInfo=function(id) return id==1429 and {name='Elwynn Forest'} or nil end}
BackstageForeverPetCommand('pet')
assert(#said==4,#said)
assert(said[1]=='Backstage Forever: Recorded beasts you can tame near your level:')
assert(said[3]:find('Gray Wolf (Wolf, level 8, Elwynn Forest 60, 70): Bite (Rank 2) pet level 8',1,true),said[3])
assert(said[4]:find('Recorded tames only',1,true))
said={} BackstageForeverPetCommand('pet claw')
assert(#said==3 and said[1]:find('that match',1,true) and said[2]:find('Old Cat',1,true))
said={} BackstageForeverPetCommand('pet dragon')
assert(#said==2 and said[1]:find('No recorded beast matches',1,true))
said={} UnitClass=function() return 'Mage','MAGE' end BackstageForeverPetCommand('pet wolf')
assert(said[#said]=='Backstage Forever: Only hunters can tame beasts.')
said={} InCombatLockdown=function() return true end BackstageForeverPetCommand('pet')
assert(#said==0) InCombatLockdown=function() return false end
said={} GetBuildInfo=function() return '1.60.2','1' end BackstageForeverPetCommand('pet')
assert(#said==1 and said[1]:find('another patch',1,true))
said={} BackstageForeverPetData=nil BackstageForeverPetCommand('pet')
assert(#said==1 and said[1]:find('not available',1,true))
print('ok')`);
});

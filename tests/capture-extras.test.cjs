"use strict";
// Capture gaps: spent talents, every known recipe id, the key ring and play sessions
// ride one optional "extras" block. The Lua is run for real (fengari) against a small stand-in
// client; the desktop parser is tried with valid, missing and damaged blocks.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const X = require("../src/core/capture-extras.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");
const root = path.join(__dirname, "..");

const WORLD = String.raw`
local handlers,timers={},{}
combat=false;now=1790000000;money=120000
CreateFrame=function()return {RegisterEvent=function()end,SetScript=function(_,_,f)handlers[#handlers+1]=f end}end
InCombatLockdown=function()return combat end
issecretvalue=function(v)return v=='SECRET' end
C_Timer={After=function(_,f)timers[#timers+1]=f end}
UnitGUID=function()return 'Player-1-0001' end
UnitFullName=function()return 'Aeralyn','Realm'end
UnitName=function()return 'Aeralyn' end
GetRealmName=function()return 'Realm' end
UnitClass=function()return 'Mage'end
UnitLevel=function()return 24 end
GetBuildInfo=function()return '1.60.1','70862' end
GetLocale=function()return 'enUS'end
GetZoneText=function()return 'Forest'end
GetSubZoneText=function()return ''end
time=function()return now end
GetMoney=function()return money end
DEFAULT_CHAT_FRAME={AddMessage=function()end}
for _,name in ipairs({'RequestTimePlayed','LearnTalent','UseContainerItem','PickupContainerItem'}) do _G[name]=function() error('must not be called: '..name) end end
-- Talents as the classic client reports them: name, icon, tier, column, rank, highest rank.
talentTabs={
  {name='Arcane',talents={{'Arcane Subtlety',1,1,2,2},{'Arcane Focus',1,2,0,5},{'Wand Specialization',2,1,1,2}}},
  {name='Fire',talents={{'Improved Fireball',1,2,5,5},{'Ignite',2,1,0,5}}},
  {name='Frost',talents={}},
}
unspent=2
GetNumTalentTabs=function()return #talentTabs end
GetTalentTabInfo=function(i)return talentTabs[i].name,'icon',0,'file' end
GetNumTalents=function(i)return #talentTabs[i].talents end
GetTalentInfo=function(i,j)local t=talentTabs[i].talents[j];return t[1],'icon',t[2],t[3],t[4],t[5] end
UnitCharacterPoints=function()return unspent end
KEYRING_CONTAINER=-2
keys={[1]={itemID=7146,stackCount=1},[3]={itemID=11000,stackCount=1},[4]={itemID=7146,stackCount=1}}
ringSlots=8
C_Container={GetContainerNumSlots=function(b) if b==-2 then return ringSlots end return 0 end,
  GetContainerNumFreeSlots=function()return 0 end,
  GetContainerItemInfo=function(b,s) if b==-2 then return keys[s] end end}
function event(e,a) handlers[1](nil,e,a) end
function load()
  handlers={}
  dofile('addon/BackstageForever/BackstageForever.lua')
  dofile('addon/BackstageForever/BackstageForeverTalents.lua')
  dofile('addon/BackstageForever/BackstageForeverLedger.lua')
end
function save() print(BackstageForeverExport) end
load()
`;
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: WORLD + source, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1048576 });
  assert.equal(r.status, 0, r.stderr || r.error?.message); assert.equal(r.stderr, "");
  return r.stdout.trim().split(/\r?\n/).filter(Boolean);
}
const saves = (source) => lua(source).map((raw) => ({ raw: JSON.parse(raw), parsed: parseSavedVariables("BackstageForeverExport = " + JSON.stringify(raw)) }));

test("the addon saves spent talents, the key ring and sessions in one optional block the desktop reads", () => {
  const [first, later, reloaded, nextDay] = saves(String.raw`
event('PLAYER_LOGIN');save()
now=now+1800;money=money+45000;event('PLAYER_ENTERING_WORLD');save()
-- A quick /reload continues the session; a login hours later starts a new one.
now=now+60;load();event('PLAYER_LOGIN');save()
now=now+20000;money=money-5000;load();event('PLAYER_LOGIN');now=now+900;money=money+2500;event('PLAYER_ENTERING_WORLD');save()
`);
  const c = first.raw.characters[0];
  assert.equal(c.captureVersion, "1.23.0", "the capture version does not change");
  assert.deepEqual(c.extras.talents, { at: 1790000000, unspent: 2, tabs: [{ n: "Arcane", t: [[1, 1, 2, 2, "Arcane Subtlety"], [2, 1, 1, 2, "Wand Specialization"]] }, { n: "Fire", t: [[1, 2, 5, 5, "Improved Fireball"]] }, { n: "Frost", t: [] }] });
  assert.deepEqual(c.extras.keyring, { at: 1790000000, slots: 8, ids: [7146, 11000] }, "each key once, sorted");
  assert.deepEqual(c.extras.sessions, [[1790000000, 1790000000, 120000, 120000]]);
  assert.equal(c.extras.recipes, undefined, "no profession API here: no recipe list, and nothing else is lost");
  // The desktop keeps the block as it was written.
  assert.deepEqual(first.parsed.characters[0].extras, { v: 1, talents: c.extras.talents, keyring: c.extras.keyring, sessions: c.extras.sessions });
  assert.deepEqual(later.parsed.characters[0].extras.sessions, [[1790000000, 1790001800, 120000, 165000]]);
  assert.deepEqual(reloaded.parsed.characters[0].extras.sessions, [[1790000000, 1790001860, 120000, 165000]], "a /reload within five minutes is the same session");
  assert.deepEqual(nextDay.parsed.characters[0].extras.sessions, [[1790000000, 1790001860, 120000, 165000], [1790021860, 1790022760, 160000, 162500]]);
});

test("nothing is read in combat, hidden or broken values save nothing, and the last good part is kept", () => {
  const out = saves(String.raw`
event('PLAYER_LOGIN');save()
-- In combat no capture runs at all.
combat=true;unspent=0;now=now+10;event('PLAYER_ENTERING_WORLD');save();combat=false
assert(BackstageForeverTalentSnapshot()~=nil)
combat=true;assert(BackstageForeverTalentSnapshot()==nil,'talents are never read in combat');assert(BackstageForeverKeyringSnapshot()==nil,'nor the key ring');combat=false;assert(BackstageForeverKeyringSnapshot()~=nil)
-- A talent the game hides: the whole part is left out and the last saved one stays, with its date.
GetTalentInfo=function(i,j) return 'SECRET','icon',1,1,1,5 end
KEYRING_CONTAINER=nil
now=now+10;event('PLAYER_ENTERING_WORLD');save()
GetTalentInfo=function() error('PRIVATE') end
C_Container.GetContainerItemInfo=function() error('PRIVATE') end
KEYRING_CONTAINER=-2
now=now+10;event('PLAYER_ENTERING_WORLD');save()
`);
  assert.equal(out[1].raw.observedAt, out[0].raw.observedAt, "the save made before combat is untouched");
  for (const s of out.slice(2)) {
    const e = s.parsed.characters[0].extras;
    assert.equal(e.talents.at, 1790000000); assert.equal(e.talents.unspent, 2); assert.equal(e.talents.tabs[1].t[0][4], "Improved Fireball");
    assert.deepEqual(e.keyring, { at: 1790000000, slots: 8, ids: [7146, 11000] });
    assert.equal(e.sessions.length, 1);
  }
});

test("a client without a key ring or talents saves only what it has; pure helpers hold their bounds", () => {
  const lines = lua(String.raw`
KEYRING_CONTAINER=nil;GetNumTalentTabs=nil
event('PLAYER_LOGIN');save()
assert(BackstageForeverKeyringSnapshot()==nil)
KEYRING_CONTAINER=-2;ringSlots=0;assert(BackstageForeverKeyringSnapshot()==nil,'no slots: unknown, not empty')
ringSlots=500;assert(BackstageForeverKeyringSnapshot()==nil,'an absurd size is not read')
-- Sessions: bounded at 40, clock going backwards adds nothing, bad input changes nothing.
local d={}
for i=1,60 do BackstageForeverSessionMark(d,1000+i*10000,i,true);BackstageForeverSessionMark(d,1000+i*10000+600,i+5,false) end
assert(#d.sessions==40 and d.sessions[1][1]==1000+21*10000 and d.sessions[40][2]==1000+60*10000+600 and d.sessions[40][4]==65)
BackstageForeverSessionMark(d,5,1,true);assert(#d.sessions==40)
assert(BackstageForeverSessionMark(d,'x',1,true)==nil and BackstageForeverSessionMark(d,10,-1,true)==nil and BackstageForeverSessionMark(nil,10,1,true)==nil)
-- Without a fresh load a long gap still continues the record (the addon never unloaded).
local e={};BackstageForeverSessionMark(e,100,1,true);BackstageForeverSessionMark(e,9000,2,false);assert(#e.sessions==1 and e.sessions[1][2]==9000)
BackstageForeverSessionMark(e,9200,2,true);assert(#e.sessions==1,'within five minutes');BackstageForeverSessionMark(e,9600,3,true);assert(#e.sessions==2)
-- Talent ranks out of range save nothing.
GetNumTalentTabs=function()return 1 end;GetTalentTabInfo=function()return 'Fire' end;GetNumTalents=function()return 1 end
GetTalentInfo=function()return 'Ignite','icon',1,1,6,5 end;assert(BackstageForeverTalentSnapshot()==nil)
GetTalentInfo=function()return 'Ignite','icon',1,1,3,5 end;local t=BackstageForeverTalentSnapshot();assert(t.tabs[1].t[1][3]==3 and t.unspent==2)
print('ok')
`);
  const first = JSON.parse(lines[0]).characters[0];
  assert.deepEqual(Object.keys(first.extras).sort(), ["sessions", "v"]);
  assert.equal(lines[lines.length - 1], "ok");
});

test("the new Lua never asks for /played, spends a point or uses an item", () => {
  for (const file of ["BackstageForeverTalents.lua", "BackstageForeverLedger.lua"]) {
    const text = fs.readFileSync(path.join(root, "addon", "BackstageForever", file), "utf8");
    assert.doesNotMatch(text, /RequestTimePlayed|LearnTalent|UseContainerItem|PickupContainerItem/);
  }
});

// ---- Desktop parser -------------------------------------------------------------------------
const good = () => ({ v: 1,
  talents: { at: 1790000000, unspent: 1, tabs: [{ n: "Combat", t: [[2, 2, 2, 2, "Endurance"], [1, 1, 5, 5, "Precision"], [1, 2, 3, 3, "Improved Gouge"]] }, { n: "Subtlety", t: {} }] },
  recipes: { at: 1790000001, lines: [{ l: 185, r: 120, c: false, ids: [2540, 2538] }, { l: 171, r: 225, c: true, ids: [3170, 2330, 2329] }] },
  keyring: { at: 1790000002, slots: 12, ids: [11000, 7146] },
  sessions: [[1790000000, 1790003600, 100, 5100], [1790010000, 1790010300, 5100, 4000]] });

test("a valid block is kept in one fixed shape; checking it again changes nothing", () => {
  const out = X.normalizeExtrasCapture(good());
  assert.deepEqual(out.talents.tabs[0].t, [[1, 1, 5, 5, "Precision"], [1, 2, 3, 3, "Improved Gouge"], [2, 2, 2, 2, "Endurance"]]);
  assert.deepEqual(out.talents.tabs[1], { n: "Subtlety", t: [] }, "Lua's empty table is an empty list");
  assert.deepEqual(out.recipes.lines, [{ l: 171, r: 225, c: true, ids: [2329, 2330, 3170] }, { l: 185, r: 120, c: false, ids: [2538, 2540] }]);
  assert.deepEqual(out.keyring.ids, [7146, 11000]);
  assert.deepEqual(X.normalizeExtrasCapture(out), out);
  assert.doesNotThrow(() => X.validateExtras(out)); assert.doesNotThrow(() => X.validateExtras(undefined));
  assert.throws(() => X.validateExtras(good()), /Invalid extras/, "a stored block must already be in the fixed shape");
});

test("a missing or damaged part is left out on its own; a block that is not one is refused", () => {
  assert.equal(X.normalizeExtrasCapture({ v: 1 }), undefined);
  for (const bad of [null, [], "x", { v: 2, sessions: good().sessions }, {}]) assert.throws(() => X.normalizeExtrasCapture(bad), /Invalid extras/);
  const damaged = {
    talents: [{ at: 0, tabs: [] }, { at: 5, tabs: [] }, { at: 5, tabs: [{ n: "A", t: [[1, 1, 6, 5, "X"]] }] }, { at: 5, tabs: [{ n: "A", t: [[1, 1, 1, 5, "X"], [1, 1, 1, 5, "Y"]] }] }, { at: 5, tabs: [{ n: "A", t: [[1, 1, 1, 5, "X\u0000"]] }] },
      { at: 5, tabs: [{ n: "", t: [] }] }, { at: 5, unspent: -1, tabs: [{ n: "A", t: [] }] }, { at: 5, tabs: Array(7).fill({ n: "A", t: [] }) }, { at: 5, tabs: [{ n: "A", t: [[1, 1, 1, 5]] }] }, { at: 5, tabs: [{ n: "A", t: [], extra: 1 }] },
      { at: 5, tabs: Array.from({ length: 6 }, () => ({ n: "A", t: Array.from({ length: 4 }, (_, i) => [1, i + 1, 5, 5, "T"]) })) }],
    recipes: [{ at: 5, lines: [] }, { at: 5, lines: [{ l: 1, r: 1, c: "yes", ids: [] }] }, { at: 5, lines: [{ l: 1, r: 1, c: true, ids: [5, 5] }] }, { at: 5, lines: [{ l: 1, r: 1, c: true, ids: [1.5] }] },
      { at: 5, lines: [{ l: 1, r: 1, c: true, ids: [] }, { l: 1, r: 1, c: true, ids: [] }] }, { at: 5, lines: [{ l: 1, r: 1, c: true, ids: Array.from({ length: 601 }, (_, i) => i + 1) }] }, { lines: [{ l: 1, r: 1, c: true, ids: [] }] }],
    keyring: [{ at: 5, slots: 0, ids: [] }, { at: 5, slots: 4, ids: [0] }, { at: 5, slots: 4, ids: [3, 3] }, { at: 5, slots: 4, ids: "none" }, { at: 5, slots: 65, ids: [] }],
    sessions: [[], [[5, 4, 1, 1]], [[5, 6, 1]], [[5, 6, 1, -1]], [[5, 9, 1, 1], [9, 12, 1, 1]], "x", Array.from({ length: 41 }, (_, i) => [i * 10 + 1, i * 10 + 2, 0, 0])],
  };
  for (const [part, list] of Object.entries(damaged)) for (const bad of list) {
    const out = X.normalizeExtrasCapture({ ...good(), [part]: bad });
    assert.equal(out[part], undefined, `${part}: ${JSON.stringify(bad).slice(0, 80)}`);
    assert.equal(Object.keys(out).length, 4, "the other three parts stay");
  }
  // Limits that still pass.
  assert.equal(X.normalizeExtrasCapture({ v: 1, recipes: { at: 5, lines: [{ l: 1, r: 1, c: true, ids: Array.from({ length: 600 }, (_, i) => i + 1) }] } }).recipes.lines[0].ids.length, 600);
  assert.equal(X.normalizeExtrasCapture({ v: 1, keyring: { at: 5, slots: 4, ids: [] } }).keyring.ids.length, 0, "an empty key ring is a fact");
});

test("the saved file: a damaged extras block never costs the character, and the profile store keeps a good one", () => {
  const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
  const { validateState, defaultState } = require("../src/core/validation.cjs");
  const character = (extras) => ({ id: "Player-1-0001", name: "Aeralyn", realm: "Realm", className: "Rogue", level: 30, updatedAt: 1790000500, clientBuild: "1.60.1.70862", ...(extras === undefined ? {} : { extras }) });
  const read = (extras) => parseSavedVariables("BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: [character(extras)], activeId: "Player-1-0001", observedAt: 1790000500 })));
  assert.equal(read(undefined).characters[0].extras, undefined);
  for (const bad of ["text", 7, [], { v: 9 }, { v: 1, talents: "x", sessions: 4 }]) { const s = read(bad); assert.equal(s.characters[0].name, "Aeralyn"); assert.equal(s.characters[0].extras, undefined); }
  const snapshot = read(good());
  assert.deepEqual(Object.keys(snapshot.characters[0].extras), ["v", "talents", "recipes", "keyring", "sessions"]);
  const whole = mergeSnapshot(defaultState(), snapshot);
  assert.equal(whole.profiles.length, 1, "the character was imported");
  assert.deepEqual(whole.profiles[0].extras, snapshot.characters[0].extras);
  // A stored profile with a tampered block is refused like any other damaged part of the journal.
  assert.doesNotThrow(() => validateState(whole));
  const tampered = structuredClone(whole); tampered.profiles[0].extras.keyring.ids = [5, 5];
  assert.throws(() => validateState(tampered));
  // A newer save without the block (an older addon ran) removes it: omission is not kept as current.
  const older = read(undefined); older.characters[0].updatedAt = new Date(1790000900 * 1000).toISOString(); older.observedAt = older.characters[0].updatedAt;
  const after = mergeSnapshot(whole, older);
  assert.equal(after.profiles[0].extras, undefined);
});

// ---- Talents on the trees --------------------------------------------------------------------
const talent = (id, row, column, maxRank, name, prerequisites = []) => ({ id, row, column, maxRank, name, iconFileId: null, ranks: [], descriptions: [], prerequisites });
const trees = () => ({ className: "Rogue", tabs: [
  { id: 1, name: "Combat", talents: [talent(11, 0, 0, 5, "Precision"), talent(12, 0, 1, 3, "Improved Gouge"), talent(13, 1, 0, 1, "Riposte"), talent(14, 1, 1, 2, "Endurance", [{ talentId: 12, rank: 3 }]), talent(15, 2, 1, 1, "Blade Flurry", [{ talentId: 14, rank: 2 }])] },
  { id: 2, name: "Subtlety", talents: [talent(21, 0, 0, 5, "Camouflage"), talent(22, 1, 0, 5, "Elusiveness")] },
] });

test("saved talents map to the trees by tree, tier and column first, by name second", () => {
  const block = X.normalizeExtrasCapture(good()).talents;
  const now = X.currentTalents(trees(), block);
  assert.deepEqual([...now.ranks], [[11, 5], [12, 3], [14, 2]]);
  assert.deepEqual(now.tabs, [{ name: "Combat", points: 10 }, { name: "Subtlety", points: 0 }]);
  assert.equal(now.spent, 10); assert.equal(now.unspent, 1); assert.deepEqual(now.unmatched, []);
  // A German client: other names, same places.
  const german = { at: 5, tabs: [{ n: "Kampf", t: [[1, 1, 5, 5, "Präzision"]] }, { n: "Täuschung", t: [[1, 1, 2, 5, "Tarnung"]] }] };
  assert.deepEqual([...X.currentTalents(trees(), german).ranks], [[11, 5], [21, 2]]);
  // A talent that moved (the place holds another highest rank): found by its name in that tree.
  const moved = { at: 5, tabs: [{ n: "Combat", t: [[4, 3, 1, 1, "Riposte"]] }, { n: "Subtlety", t: [] }] };
  assert.deepEqual([...X.currentTalents(trees(), moved).ranks], [[13, 1]]);
  // Trees saved in another order: the tree is found by its name.
  const swapped = { at: 5, tabs: [{ n: "Subtlety", t: [[1, 1, 3, 5, "Camouflage"]] }, { n: "Combat", t: [[1, 2, 2, 3, "Improved Gouge"]] }] };
  assert.deepEqual([...X.currentTalents(trees(), swapped).ranks].sort((a, b) => a[0] - b[0]), [[12, 2], [21, 3]]);
  // What the trees do not have is named, never guessed.
  const odd = { at: 5, tabs: [{ n: "Combat", t: [[7, 4, 1, 1, "Adrenaline Rush"]] }] };
  const r = X.currentTalents(trees(), odd);
  assert.equal(r.ranks.size, 0); assert.deepEqual(r.unmatched, [{ name: "Adrenaline Rush", tab: "Combat", rank: 1 }]); assert.equal(r.unspent, null);
  assert.equal(X.currentTalents(trees(), undefined), null); assert.equal(X.currentTalents(null, block).ranks.size, 0);
});

test("the planner starts from the current talents and compares them with the plan", (t) => {
  const { registerTalentPlanner } = require("../src/core/talent-planner-ipc.cjs");
  const { TalentBuilds } = require("../src/core/talent-builds.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-extras-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const extras = X.normalizeExtrasCapture(good());
  let profile = { id: "p1", name: "Aeralyn", className: "Rogue", level: 20, source: { kind: "wow-addon", id: "s", updatedAt: "2026-11-22T00:00:00Z" }, extras };
  const h = {};
  registerTalentPlanner({ handle: (n, fn) => { h[n] = fn; }, getState: () => ({ activeProfileId: profile.id, profiles: [profile] }), gameData: { talents: () => trees() }, builds: new TalentBuilds(dir) });
  const open = h.talentPlanner({ op: "open", className: "Rogue", level: 20 });
  assert.deepEqual(open.current, { at: 1790000000, unspent: 1, spent: 10, tabs: [{ name: "Combat", points: 10 }, { name: "Subtlety", points: 0 }], ranks: { 11: 5, 12: 3, 14: 2 }, unmatched: [], usable: true });
  const start = h.talentPlanner({ op: "fromCurrent", className: "Rogue", order: [], level: 20 });
  assert.equal(start.ok, true); assert.equal(start.order.length, 10);
  assert.deepEqual([11, 12, 14].map((id) => start.view.talents[id].rank), [5, 3, 2]);
  assert.equal(start.view.ok, true, "the order found for the saved ranks obeys the talent rules");
  // Current against a plan that went another way.
  const plan = [...Array(5).fill(21), 22];
  const cmp = h.talentPlanner({ op: "compareCurrent", className: "Rogue", order: plan });
  assert.equal(cmp.ok, true); assert.equal(cmp.diff.totalA, 6); assert.equal(cmp.diff.totalB, 10);
  assert.deepEqual(cmp.diff.rows.map((r) => [r.name, r.a, r.b]), [["Precision", 0, 5], ["Improved Gouge", 0, 3], ["Endurance", 0, 2], ["Camouflage", 5, 0], ["Elusiveness", 1, 0]]);
  assert.deepEqual(cmp.order, plan, "comparing changes nothing");
  // Another class previewed, a character without saved talents, and talents the trees do not hold.
  assert.equal(h.talentPlanner({ op: "open", className: "Mage" }).current, null);
  profile = { ...profile, extras: undefined };
  const none = h.talentPlanner({ op: "fromCurrent", className: "Rogue", order: [11] });
  assert.equal(none.ok, false); assert.match(none.reason, /not in this character's save yet/); assert.deepEqual(none.order, [11]);
  profile = { ...profile, extras: { v: 1, talents: { at: 5, tabs: [{ n: "Combat", t: [[2, 1, 1, 1, "Riposte"]] }] } } };
  const illegal = h.talentPlanner({ op: "fromCurrent", className: "Rogue", order: [] });
  assert.equal(illegal.ok, false, "one point in row two cannot be reached by any order"); assert.match(illegal.reason, /do not fit the talent trees/); assert.equal(illegal.current.usable, false);
});

test("coach's notes mention talent points only when the newest save reported them waiting", () => {
  const { coachNotes } = require("../src/core/coach-notes.cjs");
  const T = 1790000000, iso = (at) => new Date(at * 1000).toISOString();
  const profile = (talents) => ({ id: "a", name: "Aeralyn", className: "Mage", level: 14, source: { kind: "wow-addon", id: "s", updatedAt: iso(T + 86400) },
    journal: { levels: [{ level: 14, at: T + 3600, played: 60000 }] }, extras: talents ? { v: 1, talents } : undefined });
  const args = { previous: { savedAt: iso(T), level: 13 }, current: { savedAt: iso(T + 86400), level: 14 } };
  const note = (talents) => coachNotes(profile(talents), args).change;
  assert.deepEqual(note({ at: T + 86400, unspent: 3, tabs: [{ n: "Fire", t: [] }] }), { kind: "talents", text: "You have 3 talent points waiting to be spent.", advice: "Press N in game and spend them. Characters → Talents shows your plan and what comes next." });
  assert.equal(note({ at: T + 86400, unspent: 1, tabs: [{ n: "Fire", t: [] }] }).text, "You have 1 talent point waiting to be spent.");
  assert.equal(note({ at: T + 86400, unspent: 0, tabs: [{ n: "Fire", t: [] }] }), null);
  assert.equal(note({ at: T + 86400, tabs: [{ n: "Fire", t: [] }] }), null, "the game did not say");
  assert.equal(note({ at: T - 5, unspent: 3, tabs: [{ n: "Fire", t: [] }] }), null, "kept from an older save: not news for this session");
  assert.equal(note(null), null);
});

// ---- Recipes, key ring, sessions -------------------------------------------------------------
test("the recipe book knows every listed recipe and drops the 100-recipe warning when the list is whole", () => {
  const R = require("../src/core/recipe-book.cjs");
  const workshop = (n) => ({ professions: { items: [{ skillLineId: 171, professionId: 4, name: "Alchemy", rank: 225, maxRank: 300 }, { skillLineId: 185, professionId: 5, name: "Cooking", rank: 120, maxRank: 150 }] },
    recipes: { complete: false, items: Array.from({ length: n }, (_, i) => ({ id: 9000 + i, skillLineId: 171, name: `R${i}` })) } });
  const old = R.knownRecipes({ readiness: { workshop: workshop(100) } });
  assert.equal(old.listed, false); assert.equal(old.capped, true); assert.equal(old.whole(171), false); assert.equal(old.ids.size, 100);
  const withList = R.knownRecipes({ readiness: { workshop: workshop(100) }, extras: X.normalizeExtrasCapture(good()) });
  assert.equal(withList.listed, true); assert.equal(withList.capped, false); assert.equal(withList.ids.size, 105);
  assert.equal(withList.whole(171), true); assert.equal(withList.whole(185), false, "Cooking's list was not handed over whole"); assert.equal(withList.complete, false);
  assert.equal(R.knownRecipes({}).observed, false);
  // The book itself: a recipe beyond the first 100 is known, and the note goes away for the whole list.
  const game = { recipes: { lines: { 171: ["Alchemy"], 185: ["Cooking"] }, teach: {}, rows: [[3170, 171, 50, 100, 0, 1, 0, 1, []], [2538, 185, 50, 100, 0, 1, 0, 1, []], [2999, 185, 50, 100, 0, 1, 0, 1, []]] },
    items: (ids) => ids.map(() => null), spells: (ids) => ids.map((id) => ({ name: `Spell ${id}` })) };
  const index = { trainer: new Map(), vendors: new Map(), drops: new Map(), questItems: new Map(), questSpells: new Map(), vendorListed: new Set(), carried: false };
  const profile = { readiness: { workshop: workshop(100) }, extras: X.normalizeExtrasCapture(good()) };
  const book = R.recipeBook(profile, game, index, { skillLineId: 171 });
  assert.equal(book.status, "available");
  assert.equal(book.recipes.find((r) => r.id === 3170).known, true, "a recipe the 100-recipe list does not hold");
  assert.ok(!book.notes.some((n) => /at most 100 recipes|did not hand over/.test(n)), "no warning for a whole list");
  const cooking = R.recipeBook(profile, game, index, { skillLineId: 185 });
  assert.ok(cooking.notes.some((n) => /did not hand over the full recipe list/.test(n)));
  assert.equal(cooking.recipes.find((r) => r.id === 2538).known, true); assert.equal(cooking.recipes.find((r) => r.id === 2999).known, false);
  // Without the id list the old warning stays.
  const before = R.recipeBook({ readiness: { workshop: workshop(100) } }, game, index, { skillLineId: 171 });
  assert.ok(before.notes.some((n) => /at most 100 recipes/.test(n))); assert.equal(before.recipes.find((r) => r.id === 3170).known, false);
});

test("the addon lists every learned recipe id per profession, remembers them, and marks a cut list", () => {
  const TRADE = String.raw`
Enum={BagIndex={Backpack=0,Bag_1=1,Bag_2=2,Bag_3=3,Bag_4=4}}
local lines={{skillID=171,name='Alchemy',isHeader=false,isCollapsed=false,rank=50,maxRank=150}}
C_SkillInfo={GetNumSkillLines=function()return #lines end,GetSkillLineInfo=function(i)return lines[i]end}
spells={};for i=1,250 do spells[i]=5000+i end
infoReads=0
C_TradeSkillUI={GetProfessionInfoBySkillLineID=function(id)return {professionID=id==171 and 4 or 0}end,
 GetProfessionSpells=function()return spells end,
 GetRecipeInfo=function(id)infoReads=infoReads+1;return {recipeID=id,name='Recipe '..id,learned=id%2==1}end}
`;
  const out = saves(TRADE + String.raw`
event('PLAYER_LOGIN');assert(infoReads==250,'each recipe is asked about once, not twice');save()
-- The list cannot be read any more (window closed, API silent): the saved ids stay, not marked whole.
C_TradeSkillUI.GetProfessionSpells=function()return nil end;now=now+5;event('NEW_RECIPE_LEARNED');timers[#timers]();save()
-- More than 600 known recipes: the first 600 are kept and the list is not called whole.
C_TradeSkillUI.GetProfessionSpells=function()return spells end;C_TradeSkillUI.GetRecipeInfo=function(id)return {recipeID=id,name='R',learned=true}end
spells={};for i=1,700 do spells[i]=5000+i end;now=now+5;event('NEW_RECIPE_LEARNED');timers[#timers]();save()
`);
  const first = out[0].parsed.characters[0];
  assert.equal(first.readiness.workshop.recipes.items.length, 50, "the detailed list still stops reading at 100 recipes");
  const line = first.extras.recipes.lines[0];
  assert.equal(line.l, 171); assert.equal(line.r, 50); assert.equal(line.c, true); assert.equal(line.ids.length, 125); assert.equal(line.ids[0], 5001); assert.equal(line.ids[124], 5249);
  const kept = out[1].parsed.characters[0].extras.recipes.lines[0];
  assert.equal(kept.c, false); assert.equal(kept.ids.length, 125);
  const cut = out[2].parsed.characters[0].extras.recipes.lines[0];
  assert.equal(cut.c, false); assert.equal(cut.ids.length, 600);
});

test("keys on the saved key ring count for Keys & attunements", () => {
  const { attunementView, CHAINS } = require("../src/core/attunements.cjs");
  const pack = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  const chain = CHAINS.find((c) => c.key && Number.isInteger(c.key.id));
  assert.ok(chain, "a chain with a key exists");
  const names = new Map(CHAINS.flatMap((c) => [c.key, ...c.steps]).filter((s) => s && Number.isInteger(s.id) && s.name).map((s) => [s.id, s.name]));
  const view = (profile, o) => attunementView(profile, { ...o, pack });
  const itemName = (id) => names.get(id) || null;
  const base = { id: "p", faction: chain.side || "Alliance", history: { completedIdsKnown: true, completedIds: [], recent: [] }, quests: [], ledger: { bags: { items: [] } } };
  const without = view(base, { itemName });
  assert.notEqual(without.chains.find((c) => c.id === chain.id).status, "done");
  assert.equal(without.keyringKnown, false); assert.ok(without.notes.some((n) => /key ring is not in this save yet/.test(n)));
  const withRing = view({ ...base, extras: { v: 1, keyring: { at: 5, slots: 12, ids: [chain.key.id] } } }, { itemName });
  assert.equal(withRing.keyringKnown, true); assert.ok(withRing.notes.some((n) => /on your saved key ring/.test(n)));
  const row = withRing.chains.find((c) => c.id === chain.id);
  assert.equal(row.key.confirmed, true); assert.equal(row.key.held, "keyring"); assert.equal(row.status, "done");
  const empty = view({ ...base, extras: { v: 1, keyring: { at: 5, slots: 12, ids: [] } } }, { itemName });
  assert.equal(empty.chains.find((c) => c.id === chain.id).key.held, null);
});

test("sessions merge without overlap and give coin per hour only for sessions of ten minutes or more", (t) => {
  const E = require("../src/core/economy.cjs");
  const a = [[1000, 4600, 10000, 30000], [9000, 9300, 30000, 29000]];
  const merged = E.mergeSessions(a, [[9000, 12600, 30000, 20000], [12000, 13000, 1, 2], [20000, 27200, 20000, 80000], "junk", [5, 4, 1, 1], [30000, 30001, -1, 0]]);
  assert.deepEqual(merged, [[1000, 4600, 10000, 30000], [9000, 12600, 30000, 20000], [20000, 27200, 20000, 80000]], "same start: the longer one; overlapping and damaged rows are dropped");
  assert.equal(E.mergeSessions(Array.from({ length: 500 }, (_, i) => [i * 10 + 1, i * 10 + 5, 0, 0]), null).length, E.LIMITS.sessions);
  const view = E.sessionView([...merged, [40000, 40300, 80000, 80500]]);
  assert.deepEqual(view.rows.map((r) => [r.seconds, r.change, r.perHour]), [[300, 500, null], [7200, 60000, 30000], [3600, -10000, -10000], [3600, 20000, 20000]]);
  assert.deepEqual(view.total, { sessions: 3, seconds: 14400, change: 70000, perHour: 17500 });
  assert.equal(E.sessionView([]), null); assert.equal(E.sessionView([[1, 100, 5, 9]]).total, null);
  // The desktop keeps them beyond the addon's forty, per character, and forgets them with the character.
  const profile = (id, sessions) => ({ id, name: id, extras: { v: 1, sessions } });
  let data = E.absorb(null, [profile("a", a), profile("b", [[50, 900, 1, 2]])]);
  data = E.absorb(data, [profile("a", [[9000, 9900, 30000, 31000], [20000, 20900, 31000, 32000]]), profile("b", undefined)]);
  assert.deepEqual(data.sessions.a, [[1000, 4600, 10000, 30000], [9000, 9900, 30000, 31000], [20000, 20900, 31000, 32000]]);
  assert.deepEqual(data.sessions.b, [[50, 900, 1, 2]], "a save without sessions keeps what was known");
  data = E.absorb(data, [profile("b", undefined)]);
  assert.equal(data.sessions.a, undefined, "a deleted character takes its sessions with it");
  assert.deepEqual(E.migrate({ sessions: { a: [[1, 2, 3, 4], "bad"], "__proto__": [[1, 2, 3, 4]], c: "x" } }).sessions, { a: [[1, 2, 3, 4]] });
  assert.deepEqual(E.migrate({ version: 1, money: {} }).sessions, {}, "a file from before sessions gains them empty");
  // The store writes and reads them back.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-eco-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "economy.json");
  const store = new E.EconomyStore({ file }); store.absorb({ profiles: [profile("a", a)] });
  assert.deepEqual(new E.EconomyStore({ file }).data.sessions.a, a);
  store.clear(); assert.deepEqual(new E.EconomyStore({ file }).data.sessions, {});
});

// ---- Scout export and kept answers -------------------------------------------------------------
test("Save my scout notes writes only the file the player picked", async () => {
  const { registerScoutHandlers } = require("../src/core/scout-ipc.cjs");
  const { GameSync } = require("../src/core/game-sync.cjs");
  const { normalizeScoutCapture } = require("../src/core/scout.cjs");
  const block = normalizeScoutCapture({ version: 1, records: [{ k: "v", n: 54, m: 1429, x: 0.4, y: 0.6, at: 1790000000 }, { k: "g", n: 197, q: 783, m: 1429, x: 0.48, y: 0.43, at: 1790000100, name: "Marshal McBride" }] });
  let blocks = [{ id: "x", name: "Aeralyn", realm: "Realm", faction: "Alliance", clientBuild: "1.60.1.70862", scout: block }];
  const game = { scoutCapture: () => blocks.map((e) => ({ ...e })), scoutExport(at) { return GameSync.prototype.scoutExport.call(this, at); } };
  const h = {}, opts = {}, written = [], dialogs = [];
  let answer = { canceled: false, filePath: "C:\\picked\\notes.json" };
  registerScoutHandlers({ handle: (n, fn, o) => { h[n] = fn; opts[n] = o; }, getGame: () => game, getWindow: () => "window",
    dialog: { showSaveDialog: async (win, o) => { dialogs.push([win, o]); return answer; } }, writeFile: async (file, text) => { written.push([file, text]); }, now: () => 1790000999 });
  assert.deepEqual(opts.exportScoutNotes, { privateOnly: true }, "saving a file is never offered to the shared views");
  assert.deepEqual(h.scoutNotes(), { characters: [{ name: "Aeralyn", realm: "Realm", records: 2 }], records: 2 });
  assert.deepEqual(await h.exportScoutNotes(), { saved: true, characters: 1, records: 2 });
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0][0], "window"); assert.equal(dialogs[0][1].defaultPath, "Backstage-Forever-scout-notes.json");
  assert.equal(written.length, 1); assert.equal(written[0][0], "C:\\picked\\notes.json");
  const doc = JSON.parse(written[0][1]);
  assert.equal(doc.format, "backstage-forever-scout"); assert.equal(doc.exportedAt, 1790000999); assert.equal(doc.characters[0].records.length, 2); assert.equal(doc.characters[0].name, "Aeralyn");
  assert.doesNotMatch(written[0][1], /"id"/, "the character's game id is not in the file");
  // Cancelled: nothing is written.
  answer = { canceled: true };
  assert.deepEqual(await h.exportScoutNotes(), { saved: false, reason: "cancelled" }); assert.equal(written.length, 1);
  // Nothing recorded: no dialog at all.
  blocks = [];
  assert.deepEqual(await h.exportScoutNotes(), { saved: false, reason: "empty" }); assert.equal(dialogs.length, 2);
  assert.deepEqual(h.scoutNotes(), { characters: [], records: 0 });
  await assert.rejects(async () => h.exportScoutNotes("x"), /Invalid scout request/); assert.throws(() => h.scoutNotes(1), /Invalid scout request/);
  // No game connection yet.
  const h2 = {}; registerScoutHandlers({ handle: (n, fn) => { h2[n] = fn; }, getGame: () => null, getWindow: () => null, dialog: { showSaveDialog: async () => { throw Error("no dialog"); } } });
  assert.deepEqual(h2.scoutNotes(), { characters: [], records: 0 }); assert.deepEqual(await h2.exportScoutNotes(), { saved: false, reason: "empty" });
});

test("the last in-game answers survive a restart, go with a deleted character and with a data reset", async (t) => {
  const { AskAnswers, normalize } = require("../src/core/ask-answers.cjs");
  const { InGameAsk } = require("../src/core/ask-in-game.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-answers-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ask-answers.json");
  let clock = 1000;
  const make = () => new InGameAsk({ companion: { ask: async (r) => ({ text: `Answer to ${r.prompt}`, kind: "quick" }) }, getState: () => ({ activeProfileId: active, profiles: [{ id: "a" }, { id: "b" }], provider: { id: "none" } }),
    panel: { show() {} }, now: () => clock++, answers: new AskAnswers(dir) });
  let active = "a";
  const first = make();
  for (let i = 1; i <= 7; i++) await first.handle({ text: `question ${i}`, characterHash: 5 });
  active = "b"; await first.handle({ text: "other", characterHash: 5 });
  assert.equal(first.recent("a").length, 5);
  // A new app start reads them back, newest first.
  const second = make();
  assert.deepEqual(second.recent("a").map((e) => e.question), ["question 7", "question 6", "question 5", "question 4", "question 3"]);
  assert.equal(second.recent("a")[0].answer, "Answer to question 7"); assert.equal(second.recent("b").length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion, 1);
  // Character a is deleted.
  assert.equal(second.forget(["b"]), true); assert.equal(second.forget(["b"]), false);
  assert.deepEqual(make().recent("a"), []); assert.equal(make().recent("b").length, 1);
  // Delete all local data.
  second.clear(); assert.equal(fs.existsSync(file), false); assert.deepEqual(make().recent("b"), []);
  // A damaged file starts empty; bad entries are dropped one by one; nothing throws.
  fs.writeFileSync(file, "{ not json"); assert.deepEqual(make().recent("a"), []);
  const kept = normalize({ schemaVersion: 1, profiles: { a: [{ question: "q", answer: "a", at: 5 }, { question: 5, answer: "a", at: 5 }, { question: "q", answer: " ", at: 5 }, { question: "q", answer: "a", at: "x" }], "": [{ question: "q", answer: "a", at: 5 }], b: "x",
    c: Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, answer: "a", at: i })) } });
  assert.deepEqual([...kept.keys()], ["a", "c"]); assert.equal(kept.get("a").length, 1); assert.equal(kept.get("c").length, 5);
  assert.equal(normalize({ schemaVersion: 2, profiles: { a: [{ question: "q", answer: "a", at: 5 }] } }).size, 0); assert.equal(normalize(null).size, 0);
  // Without a store (older callers) the answers stay in memory as before; a failing write never blocks an answer.
  const plain = new InGameAsk({ companion: { ask: async () => ({ text: "x", kind: "quick" }) }, getState: () => ({ activeProfileId: "a", profiles: [], provider: { id: "none" } }), panel: { show() {} } });
  await plain.handle({ text: "q", characterHash: 1 }); assert.equal(plain.recent("a").length, 1); assert.doesNotThrow(() => plain.clear());
  const failing = new AskAnswers(dir, { write: () => { throw Error("disk full"); } });
  assert.equal(failing.save(new Map([["a", [{ question: "q", answer: "a", at: 5 }]]])), false);
  // main.cjs wires all of it.
  const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
  assert.match(main, /answers: new \(require\("\.\/core\/ask-answers\.cjs"\)\.AskAnswers\)\(app\.getPath\("userData"\)\)/);
  assert.match(main, /forgetGameAnswers\?\.\(store\.state\.profiles\.map/); assert.match(main, /clearGameAnswers\?\.\(\)/);
  assert.match(main, /registerScoutHandlers\(\{ handle, getGame: \(\) => game, dialog, getWindow: \(\) => win \}\)/);
  const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  assert.match(preload, /exportScoutNotes: \(\) => invoke\("exportScoutNotes"\)/); assert.match(preload, /scoutNotes: \(\) => invoke\("scoutNotes"\)/);
});

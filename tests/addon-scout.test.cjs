"use strict";
// 1.26 (roadmap S1, local part): scout mode notes the quest givers, hand-ins, trainers, vendors and
// flight masters a character talks to. Off until switched on, bounded, and it stays on the computer.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const scout = require("../src/core/scout.cjs");
const { parseSavedVariables, GameSync, ADDON_FILES } = require("../src/core/game-sync.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverScout.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local clock,epoch=1000,1700000000 GetTime=function() return clock end time=function() return epoch end
local guid,name='Creature-0-4444-0-12-3296-0000ABCDEF','Thork'
UnitGUID=function(u) if u=='npc' then return guid end end
UnitName=function(u) if u=='npc' then return name end end
local map,x,y=1411,.5123456,.3098765
C_Map={GetBestMapForUnit=function() return map end,GetPlayerMapPosition=function() if not x then return nil end return {GetXY=function() return x,y end} end,
  GetMapInfo=function(id) return ({[1411]={name='Durotar'},[1413]={name='The Barrens'}})[id] end}
local quest=870 GetQuestID=function() return quest end
local captures=0 BackstageForeverRequestCapture=function() captures=captures+1 end
`;

test("records: one per NPC and role, checked field by field, bounded, the oldest makes room", () => lua(FILE + String.raw`
local N,R,A=BackstageForeverScoutNpcId,BackstageForeverScoutRecord,BackstageForeverScoutAdd
assert(N('Creature-0-4444-0-12-3296-0000ABCDEF')==3296 and N('Vehicle-0-1-0-12-77-00AB')==77)
for _,bad in ipairs({'Player-4444-0ABCDEF','Pet-0-4444-0-12-3296-0000ABCDEF','GameObject-0-4444-0-12-3296-0000ABCDEF','Creature-0-4444-0-12-0-0000ABCDEF','Creature-0-4444-0-12-x-00',
  'Creature-0-4444-0-12-3296','Creature-3296',string.rep('C',200),'',5,nil}) do assert(N(bad)==nil,tostring(bad)) end
local r=R({k='v',n=3296,name='Thork  the |cffff0000Bold|r\n',m=1411,x=.51234567,y=.3,at=1700000000})
assert(r.k=='v' and r.n==3296 and r.m==1411 and r.x==.5123 and r.y==.3 and r.at==1700000000 and r.q==nil and r.name=='Thork the cffff0000Bold r',r.name)
assert(R({k='g',n=1,m=1,x=0,y=1,q=870,at=5}).q==870 and R({k='v',n=1,m=1,x=0,y=1,q=870,at=5}).q==nil,'only givers and hand-ins carry a quest')
assert(#R({k='t',n=1,name=string.rep('\195\164',100),m=1,x=0,y=0,at=5}).name<=60)
for _,bad in ipairs({{k='x',n=1,m=1,x=0,y=0,at=5},{k='v',n=0,m=1,x=0,y=0,at=5},{k='v',n=1.5,m=1,x=0,y=0,at=5},{k='v',n=1,m=0,x=0,y=0,at=5},{k='v',n=1,m=1,x=1.01,y=0,at=5},
  {k='v',n=1,m=1,x=0,y=-.1,at=5},{k='v',n=1,m=1,x=0/0,y=0,at=5},{k='v',n=1,m=1,x=0,y=0},{k='v',n=1,m=1,x=0,y=0,at=0},{k='g',n=1,m=1,x=0,y=0,at=5},{k='h',n=1,m=1,x=0,y=0,q='870',at=5},'junk',nil}) do
  assert(R(bad)==nil)
end
local list={}
assert(A(list,{k='v',n=10,m=1411,x=.1,y=.1,at=100})=='new' and A(list,{k='t',n=10,m=1411,x=.1,y=.1,at=101})=='new','one NPC may hold two roles')
assert(A(list,{k='v',n=10,m=1411,x=.2,y=.2,at=200})=='seen' and #list==2 and list[1].x==.2 and list[1].at==200,'seen again: only place and time are refreshed')
assert(A(list,{k='g',n=10,m=1411,x=.1,y=.1,q=1,at=102})=='new' and A(list,{k='g',n=10,m=1411,x=.1,y=.1,q=2,at=103})=='new' and A(list,{k='g',n=10,m=1411,x=.1,y=.1,q=1,at=104})=='seen' and #list==4)
assert(A(list,{k='z'})==nil and A(nil,{k='v',n=1,m=1,x=0,y=0,at=1})==nil and #list==4)
local small={}
for i=1,5 do A(small,{k='v',n=i,m=1,x=0,y=0,at=100+i},3) end
assert(#small==3 and small[1].n==3 and small[3].n==5,'the one seen longest ago goes first')
local big={}
for i=1,450 do A(big,{k='v',n=i,m=1,x=0,y=0,at=i}) end
assert(#big==BackstageForeverScoutMax and BackstageForeverScoutMax==400 and big[1].n==51)
local clean=BackstageForeverScoutClean({{k='v',n=1,m=1,x=0,y=0,at=1},'junk',{k='v',n=1,m=1,x=.5,y=.5,at=2},{k='q'},{k='f',n=2,m=2,x=0,y=0,at=3}})
assert(#clean==2 and clean[1].x==.5 and clean[2].k=='f' and #BackstageForeverScoutClean(nil)==0 and #BackstageForeverScoutClean('x')==0)
-- Counts per zone and the chat lines.
local recs={{k='g',n=1,m=1411,q=1},{k='g',n=2,m=1411,q=2},{k='h',n=1,m=1411,q=1},{k='v',n=3,m=1411},{k='f',n=4,m=1413},{k='t',n=5,m=1413},{k='t',n=6,m=1413},{k='x',n=7,m=1}}
local counts=BackstageForeverScoutCounts(recs)
assert(#counts==2 and counts[1].map==1411 and counts[1].total==4 and counts[1].g==2 and counts[1].h==1 and counts[1].v==1 and counts[2].t==2 and counts[2].f==1)
local names={[1411]='Durotar'}
local lines=BackstageForeverScoutLines(recs,true,function(id) return names[id] end)
assert(#lines==3 and lines[1]=='Scout mode is on. Records on this character: 7 of 400.',lines[1])
assert(lines[2]=='  Durotar: 4 (2 quest givers, 1 hand-in, 1 vendor)' and lines[3]=='  Map #1413: 3 (2 trainers, 1 flight master)',lines[3])
lines=BackstageForeverScoutLines({},false) assert(#lines==1 and lines[1]:find('Scout mode is off. Records on this character: 0.',1,true))
lines=BackstageForeverScoutLines({},true) assert(#lines==2 and lines[2]:find('Talk to a quest giver',1,true))
local wide={} for i=1,20 do wide[i]={k='v',n=i,m=i} end
lines=BackstageForeverScoutLines(wide,true,function() error('no names') end,5) assert(#lines==7 and lines[7]=='  and 15 more.')
`));

test("in game: nothing is noted until scout mode is on; each window notes its role once; clear forgets", () => lua(STUBS + FILE + String.raw`
fire('PLAYER_LOGIN')
assert(BackstageForeverScoutOn()==false and BackstageForeverScoutSnapshot()==nil)
for _,e in ipairs({'GOSSIP_SHOW','QUEST_DETAIL','QUEST_COMPLETE','MERCHANT_SHOW','TRAINER_SHOW','TAXIMAP_OPENED'}) do fire(e) end
assert(#BackstageForeverScoutDB.records==0 and captures==0,'off: nothing is noted')
BackstageForeverScoutCommand('scout') assert(last():find('Scout mode is off',1,true))
BackstageForeverScoutCommand('scout on')
assert(BackstageForeverScoutOn()==true and last():find('Scout mode: on',1,true) and last():find('Nothing is sent to anyone',1,true))
fire('MERCHANT_SHOW')
local r=BackstageForeverScoutDB.records
assert(#r==1 and r[1].k=='v' and r[1].n==3296 and r[1].name=='Thork' and r[1].m==1411 and r[1].x==.5123 and r[1].y==.3099 and r[1].at==1700000000 and r[1].q==nil and captures==1)
fire('MERCHANT_SHOW') assert(#r==1 and captures==1,'the same vendor again changes nothing new')
fire('QUEST_DETAIL') fire('QUEST_COMPLETE') fire('TRAINER_SHOW') fire('TAXIMAP_OPENED')
assert(#r==5 and r[2].k=='g' and r[2].q==870 and r[3].k=='h' and r[3].q==870 and r[4].k=='t' and r[5].k=='f')
fire('GOSSIP_SHOW') fire('UNKNOWN_EVENT') assert(#r==5,'talking alone notes no role')
-- A quest window without a readable quest, a player or object, or no position: nothing is noted.
quest=0 fire('QUEST_DETAIL') quest=nil fire('QUEST_COMPLETE') quest=871 assert(#r==5)
guid='Player-4444-0ABCDEF' clock=2000 fire('MERCHANT_SHOW') assert(#r==5)
guid='GameObject-0-4444-0-12-3296-0000ABCDEF' fire('QUEST_DETAIL') assert(#r==5,'an object that gives a quest is not an NPC')
guid='Creature-0-4444-0-12-5000-0000ABCDEF' name='Innkeeper' x=nil fire('MERCHANT_SHOW') assert(#r==5,'no map position, as inside a dungeon')
x=0 y=0 fire('MERCHANT_SHOW') assert(#r==5) x,y=.25,.75
-- The trainer window may open after the talk window closed the "npc" unit: the one just seen is used.
fire('GOSSIP_SHOW') guid=nil clock=2005 fire('TRAINER_SHOW')
assert(#r==6 and r[6].k=='t' and r[6].n==5000 and r[6].name=='Innkeeper')
clock=2100 fire('TAXIMAP_OPENED') assert(#r==6,'but not minutes later')
-- /bf scout: counts per zone with the game's zone names.
map=1413 guid='Creature-0-4444-0-12-6000-0000ABCDEF' name='Devrak' fire('TAXIMAP_OPENED')
said={} BackstageForeverScoutCommand('scout')
assert(said[1]=='Backstage Forever: Scout mode is on. Records on this character: 7 of 400.' and said[2]=='Backstage Forever:   Durotar: 6 (1 quest giver, 1 hand-in, 2 trainers, 1 vendor, 1 flight master)' and said[3]=='Backstage Forever:   The Barrens: 1 (1 flight master)',said[2])
-- The capture block: a clean copy, and only when there is something.
local block=BackstageForeverScoutSnapshot()
assert(block.version==1 and #block.records==7 and block.records~=r and block.records[1].n==3296)
-- Off keeps what was recorded; clear forgets it.
BackstageForeverScoutCommand('scout off') fire('MERCHANT_SHOW') assert(#BackstageForeverScoutDB.records==7 and BackstageForeverScoutSnapshot()~=nil)
BackstageForeverScoutCommand('scout clear') assert(#BackstageForeverScoutDB.records==0 and last()=='Backstage Forever: Scout records of this character cleared: 7.' and BackstageForeverScoutSnapshot()==nil)
-- A saved table from an earlier session is checked again when it is read back.
BackstageForeverScoutDB={on=true,records={{k='v',n=1,m=1411,x=.1,y=.1,at=5},{k='v',n='evil'},'junk'}}
BackstageForeverScoutCommand('scout') assert(#BackstageForeverScoutDB.records==1)
`));

test("the desktop checks the block strictly and can lay it out as one export document", () => {
  const rec = (over = {}) => ({ k: "v", n: 3296, name: "Thork", m: 1411, x: 0.51234, y: 0.3, at: 1700000000, ...over });
  const block = scout.normalizeScoutCapture({ version: 1, records: [rec(), rec({ k: "g", q: 870, n: 5 }), rec({ k: "h", q: 870, n: 5 }), rec({ k: "f", n: 9, m: 1413, name: undefined })] });
  assert.deepEqual(block.records[1], { kind: "quest-giver", npcId: 5, name: "Thork", mapId: 1411, x: 0.5123, y: 0.3, questId: 870, seenAt: 1700000000 });
  assert.deepEqual(block.records.map((r) => r.kind + ":" + r.npcId), ["hand-in:5", "quest-giver:5", "vendor:3296", "flight-master:9"], "sorted by map, NPC and role");
  assert.deepEqual(block.records[3], { kind: "flight-master", npcId: 9, mapId: 1413, x: 0.5123, y: 0.3, seenAt: 1700000000 });
  assert.deepEqual(scout.normalizeScoutCapture({ version: 1, records: {} }), { version: 1, records: [] }, "an empty Lua table arrives as an object");
  const bad = [null, [], { version: 2, records: [] }, { version: 1 }, { version: 1, records: [rec()], extra: 1 }, { version: 1, records: "x" }, { version: 1, records: { a: 1 } },
    ...[{ k: "x" }, { n: 0 }, { n: 1.5 }, { n: "1" }, { m: 0 }, { m: 2000000 }, { x: 1.1 }, { y: -0.1 }, { x: NaN }, { at: 0 }, { at: "now" }, { q: 870 }, { k: "g" }, { k: "h", q: 0 }, { name: "" }, { name: "x".repeat(61) }, { name: "a|cff" }, { name: "a\nb" }, { name: 5 }, { evil: true }]
      .map((over) => ({ version: 1, records: [rec(over)] })),
    { version: 1, records: [rec(), rec()] }, { version: 1, records: [null] }, { version: 1, records: Array.from({ length: 401 }, (_, i) => rec({ n: i + 1 })) }];
  for (const b of bad) assert.throws(() => scout.normalizeScoutCapture(b), /Invalid scout capture/, JSON.stringify(b)?.slice(0, 80));
  assert.equal(scout.normalizeScoutCapture({ version: 1, records: Array.from({ length: 400 }, (_, i) => rec({ n: i + 1 })) }).records.length, scout.MAX_RECORDS);
  assert.deepEqual(scout.zoneCounts(block.records), [{ mapId: 1411, total: 3, kinds: { "hand-in": 1, "quest-giver": 1, vendor: 1 } }, { mapId: 1413, total: 1, kinds: { "flight-master": 1 } }]);
  const doc = scout.scoutExport([{ id: "x", name: "Zed", realm: "R", faction: "Horde", clientBuild: "1.60.1.71037", scout: block }, { name: "Abel", realm: "R", scout: block }, { name: "Empty", realm: "R", scout: { version: 1, records: [] } }, null, { name: 5 }], { exportedAt: 1700000100 });
  assert.equal(doc.format, "backstage-forever-scout"); assert.equal(doc.version, 1); assert.equal(doc.exportedAt, 1700000100);
  assert.deepEqual(doc.characters.map((c) => c.name), ["Abel", "Zed"]);
  assert.deepEqual(Object.keys(doc.characters[1]), ["name", "realm", "faction", "clientBuild", "zones", "records"], "no character id leaves the capture");
  assert.equal(doc.characters[1].records.length, 4);
  assert.equal(JSON.stringify(scout.scoutExport([])), '{"format":"backstage-forever-scout","version":1,"characters":[]}');
});

test("the saved file: a scout block is read beside the characters, a bad one is dropped alone, older files read as before", () => {
  const character = (over = {}) => ({ id: "GUID-1", name: "Abel", realm: "Thunder Hold", className: "Mage", level: 12, updatedAt: 1700000000, captureVersion: "0.12.3", clientBuild: "1.60.1.71037", faction: "Horde", ...over });
  const savedFile = (chars) => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: chars, activeId: "GUID-1", observedAt: 1700000000 }));
  const block = { version: 1, records: [{ k: "v", n: 3296, name: "Thork", m: 1411, x: 0.5, y: 0.3, at: 1700000000 }] };
  const plain = parseSavedVariables(savedFile([character()]));
  assert.equal(Object.hasOwn(plain, "scout"), false, "no block, no new key");
  const withScout = parseSavedVariables(savedFile([character({ scout: block }), character({ id: "GUID-2", name: "Zed", scout: { version: 1, records: [{ k: "nonsense" }] } }), character({ id: "GUID-3", name: "Cy", scout: { version: 1, records: {} } })]));
  assert.deepEqual(withScout.characters.map((c) => c.name), ["Abel", "Zed", "Cy"], "an invalid optional block never costs the character");
  for (const c of withScout.characters) assert.equal(Object.hasOwn(c, "scout"), false, "the profile store never sees the block");
  assert.deepEqual(withScout.characters[0], plain.characters[0], "the character itself reads exactly as without the block");
  assert.equal(withScout.scout.length, 1);
  assert.deepEqual(withScout.scout[0], { id: plain.characters[0].id, name: "Abel", realm: "Thunder Hold", faction: "Horde", clientBuild: "1.60.1.71037", scout: { version: 1, records: [{ kind: "vendor", npcId: 3296, name: "Thork", mapId: 1411, x: 0.5, y: 0.3, seenAt: 1700000000 }] } });
  // GameSync keeps what it read and hands out the export document; nothing is written or sent by itself.
  const sync = Object.create(GameSync.prototype);
  assert.deepEqual(sync.scoutCapture(), []);
  sync.scoutBlocks = withScout.scout;
  const doc = sync.scoutExport(1700000100);
  assert.equal(doc.characters.length, 1); assert.equal(doc.characters[0].records[0].npcId, 3296); assert.equal(doc.exportedAt, 1700000100);
  assert.doesNotMatch(read("src/core/scout.cjs"), /require\("(node:)?(https?|net|child_process)"\)|fetch\(/, "no network in the scout module");
});

test("wiring: the block rides the capture as an optional extra, the switch is off by default, the command is routed", () => {
  assert.ok(ADDON_FILES.includes("BackstageForeverScout.lua"));
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^BackstageForeverScout\.lua\r?$/m);
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverScoutDB\b/m, "per character, never account-wide");
  assert.doesNotMatch(toc.match(/^## SavedVariables:.*$/m)[0], /Scout/);
  const capture = read("addon/BackstageForever/BackstageForever.lua");
  assert.match(capture, /pcall\(BackstageForeverScoutSnapshot\)\s+if ok and type\(scout\)=='table' and type\(scout\.records\)=='table' and #scout\.records>0 then array\(scout\.records\);character\.scout=scout end/);
  assert.ok(capture.indexOf("discard(chars[i],'scout')") > 0 && capture.indexOf("discard(chars[i],'scout')") < capture.indexOf("local gathering=chars[i].gathering"), "the first block to go when the export is too big");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='scout' then\s+if type\(BackstageForeverScoutCommand\)=='function' then pcall\(BackstageForeverScoutCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForeverOptions.lua"), /switch\('Scout mode',[^\n]*off\('BackstageForeverScoutDB','on'\),'scout'\)/);
  const source = read("addon/BackstageForever/BackstageForeverScout.lua");
  assert.doesNotMatch(source, /SendAddonMessage|SendChatMessage|BackstageForeverPartySend|SelectGossip|:Click\(|hooksecurefunc/, "nothing is sent, selected, clicked or hooked");
});

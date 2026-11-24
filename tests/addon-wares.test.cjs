"use strict";
// 1.27: vendor wares. The addon notes which NPC sold which item ids in vendor windows the player
// opened and where the player stood (no prices, no character data); the desktop checks the block strictly.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { normalizeWaresCapture } = require("../src/core/wares.cjs");
const { ADDON_FILES } = require("../src/core/game-sync.cjs");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverWares.lua')\n";
const STUBS = String.raw`
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local epoch=1700000000 time=function() return epoch end
local guid,name='Creature-0-4444-0-12-3296-0000ABCDEF','Thork'
UnitGUID=function(u) if u=='npc' then return guid end end
UnitName=function(u) if u=='npc' then return name end end
local stock={159,4540,159,2512}
GetMerchantNumItems=function() return #stock end
GetMerchantItemID=function(i) return stock[i] end
local bought=0 BuyMerchantItem=function() bought=bought+1 end
local captures=0 BackstageForeverRequestCapture=function() captures=captures+1 end
local map,x,y=1411,.5123456,.3098765
C_Map={GetBestMapForUnit=function() return map end,GetPlayerMapPosition=function() if not x then return nil end return {GetXY=function() return x,y end} end}
`;

test("vendors: one per NPC, item ids unique and sorted, bounded, the oldest makes room", () => lua(FILE + String.raw`
local V,A,N=BackstageForeverWaresVendor,BackstageForeverWaresAdd,BackstageForeverWaresNpcId
assert(N('Creature-0-4444-0-12-3296-0000ABCDEF')==3296)
for _,bad in ipairs({'Player-4444-0ABCDEF','Pet-0-4444-0-12-3296-0000ABCDEF','GameObject-0-4444-0-12-3296-0000ABCDEF','',5}) do assert(N(bad)==nil,tostring(bad)) end
local v=V({n=3296,name='Thork  the |cffff0000Bold|r\n',items={4540,159,159,'x',0,2.5,2512},at=1700000000,price=5,x=.5})
assert(v.n==3296 and v.at==1700000000 and table.concat(v.items,',')=='159,2512,4540' and v.name=='Thork the cffff0000Bold r',v.name)
assert(v.price==nil and v.x==nil and v.m==nil,'only the known fields are kept; half a place is no place')
local w=V({n=1,items={1},at=5,m=1411,x=.51234567,y=.3})
assert(w.m==1411 and w.x==.5123 and w.y==.3)
for _,p in ipairs({{m=0,x=.5,y=.5},{m=1411,x=1.2,y=.5},{m=1411,x=.5},{m=1411,x=0,y=0},{m=1.5,x=.5,y=.5}}) do local r=V({n=1,items={1},at=5,m=p.m,x=p.x,y=p.y}) assert(r and r.m==nil and r.x==nil and r.y==nil) end
assert(#V({n=1,name=string.rep('\195\164',100),items={1},at=5}).name<=60)
local many={} for i=1,400 do many[i]=i end
assert(#V({n=1,items=many,at=5}).items==200)
for _,bad in ipairs({{n=0,items={1},at=5},{n=1.5,items={1},at=5},{n=1,items={},at=5},{n=1,items={'a'},at=5},{n=1,items={1}},{n=1,items={1},at=0},{n=1,at=5},'junk'}) do assert(V(bad)==nil) end
local list={}
assert(A(list,{n=1,items={1,2},at=10})=='new' and A(list,{n=1,items={2,1},at=20})=='seen' and #list==1 and list[1].at==20)
assert(A(list,{n=1,items={1,2,3},at=30})=='changed' and #list==1 and #list[1].items==3)
assert(A(list,{n=1,items={},at=40})==nil and #list[1].items==3,'an unreadable window never empties what was seen')
for i=2,5 do assert(A(list,{n=i,items={i},at=30+i},3)=='new') end
assert(#list==3 and list[1].n==3 and list[3].n==5,'the vendor seen longest ago went')
local clean=BackstageForeverWaresClean({{n=7,items={1},at=5},{n=7,items={2},at=6},'junk',{n=8,items={},at=5}})
assert(#clean==1 and clean[1].items[1]==2)
`));

test("the vendor window is read once when it opens: id, name and item ids only, nothing bought", () => lua(STUBS + FILE + String.raw`
fire('PLAYER_LOGIN')
assert(BackstageForeverWaresSnapshot()==nil,'nothing before a window was opened')
fire('MERCHANT_SHOW')
local s=BackstageForeverWaresSnapshot()
assert(s.version==1 and #s.vendors==1 and captures==1 and bought==0)
local v=s.vendors[1]
assert(v.n==3296 and v.name=='Thork' and v.at==1700000000 and table.concat(v.items,',')=='159,2512,4540' and v.m==1411 and v.x==.5123 and v.y==.3099)
local keys={} for k in pairs(v) do keys[#keys+1]=k end table.sort(keys)
assert(table.concat(keys,',')=='at,items,m,n,name,x,y',table.concat(keys,','))
x=nil epoch=epoch+1 fire('MERCHANT_SHOW')
assert(BackstageForeverWaresSnapshot().vendors[1].m==1411,'a window where the place could not be read keeps the place seen before')
epoch=epoch+60 fire('MERCHANT_SHOW')
assert(#BackstageForeverWaresSnapshot().vendors==1 and captures==1,'the same stock again asks for no new capture')
stock={159} fire('MERCHANT_SHOW')
assert(captures==2 and #BackstageForeverWaresSnapshot().vendors[1].items==1)
guid='Player-4444-0ABCDEF' stock={1,2} fire('MERCHANT_SHOW')
guid=nil fire('MERCHANT_SHOW')
guid='Creature-0-4444-0-12-77-0000ABCDEF' stock={} fire('MERCHANT_SHOW')
assert(#BackstageForeverWaresSnapshot().vendors==1 and captures==2,'players, no unit and empty windows are not noted')
-- Secret values (combat) are skipped.
issecretvalue=function(x) return x==guid end
stock={5} fire('MERCHANT_SHOW')
assert(#BackstageForeverWaresSnapshot().vendors==1)
-- A damaged saved table is cleaned on login.
issecretvalue=nil
BackstageForeverWaresDB={vendors={{n=5,items={9,9,3},at=7,junk=true},{n='x'},5},other=1}
fire('PLAYER_LOGIN')
assert(BackstageForeverWaresDB.other==nil and #BackstageForeverWaresDB.vendors==1 and BackstageForeverWaresDB.vendors[1].junk==nil)
`));

test("desktop: the wares block is checked strictly, in the addon and in the stored shape", () => {
  const block = { version: 1, vendors: [{ n: 3296, name: "Thork", items: [4540, 159], at: 1700000000, m: 1411, x: 0.5123, y: 0.3099 }, { n: 12, items: [7], at: 5 }] };
  const clean = normalizeWaresCapture(block);
  assert.deepEqual(clean, { version: 1, vendors: [{ npcId: 12, itemIds: [7], seenAt: 5 }, { npcId: 3296, name: "Thork", itemIds: [159, 4540], seenAt: 1700000000, mapId: 1411, x: 0.5123, y: 0.3099 }] });
  assert.deepEqual(normalizeWaresCapture(clean), clean, "the stored shape passes the same check unchanged");
  assert.deepEqual(normalizeWaresCapture({ version: 1, vendors: {} }), { version: 1, vendors: [] });
  const v = (extra) => ({ version: 1, vendors: [{ n: 1, items: [1], at: 5, ...extra }] });
  for (const bad of [null, [], { version: 2, vendors: [] }, { version: 1 }, { version: 1, vendors: [], extra: 1 }, v({ n: 0 }), v({ n: 1.5 }), v({ items: [] }), v({ items: [1, 1] }), v({ items: ["1"] }),
    v({ items: Array.from({ length: 201 }, (_, i) => i + 1) }), v({ at: 0 }), v({ name: "" }), v({ name: "a|b" }), v({ name: "a\nb" }), v({ name: "x".repeat(61) }), v({ price: 5 }), v({ character: "Thrall" }), v({ m: 1411 }), v({ m: 1411, x: 0.5 }), v({ x: 0.5, y: 0.5 }), v({ m: 0, x: 0.5, y: 0.5 }), v({ m: 1411, x: 1.5, y: 0.5 }),
    { version: 1, vendors: [{ n: 1, items: [1], at: 5 }, { n: 1, items: [2], at: 6 }] }, { version: 1, vendors: Array.from({ length: 61 }, (_, i) => ({ n: i + 1, items: [1], at: 5 })) }])
    assert.throws(() => normalizeWaresCapture(bad), /Invalid wares capture/, JSON.stringify(bad)?.slice(0, 80));
});

test("the saved file: wares ride with the character into the profile, a bad block is dropped alone, the AI context never sees them", () => {
  const { parseSavedVariables } = require("../src/core/game-sync.cjs");
  const { defaultState, validateState } = require("../src/core/validation.cjs");
  const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
  const character = (over = {}) => ({ id: "GUID-1", name: "Abel", realm: "Thunder Hold", className: "Mage", level: 12, updatedAt: 1700000000, captureVersion: "0.12.3", clientBuild: "1.60.1.71037", faction: "Horde", locale: "enUS", ...over });
  const savedFile = (chars) => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: chars, activeId: "GUID-1", observedAt: 1700000000 }));
  const block = { version: 1, vendors: [{ n: 3296, name: "Thork", items: [4540, 159], at: 1700000000, m: 1411, x: 0.5123, y: 0.3099 }] };
  const plain = parseSavedVariables(savedFile([character()]));
  assert.equal(Object.hasOwn(plain.characters[0], "wares"), false, "no block, no new key");
  const read = parseSavedVariables(savedFile([character({ wares: block }), character({ id: "GUID-2", name: "Zed", wares: { version: 1, vendors: [{ n: "x" }] } }), character({ id: "GUID-3", name: "Cy", wares: { version: 1, vendors: {} } })]));
  assert.deepEqual(read.characters.map((c) => [c.name, Object.hasOwn(c, "wares")]), [["Abel", true], ["Zed", false], ["Cy", false]], "an invalid or empty optional block never costs the character");
  assert.deepEqual(read.characters[0].wares, { version: 1, vendors: [{ npcId: 3296, name: "Thork", itemIds: [159, 4540], seenAt: 1700000000, mapId: 1411, x: 0.5123, y: 0.3099 }] });
  const state = validateState(mergeSnapshot(defaultState(), read));
  const profile = state.profiles.find((p) => p.name === "Abel");
  assert.deepEqual(profile.wares, read.characters[0].wares);
  // What sharing makes of it: the stock, and the rounded place as an NPC place. Nothing about the character.
  const { collectObservations } = require("../src/core/community.cjs");
  const out = collectObservations(state.profiles, { extended: true });
  assert.deepEqual(out.map((o) => [o.category, o.entry]), [["vendors", { npcId: 3296, itemIds: [159, 4540], name: "Thork" }], ["npcs", { npcId: 3296, mapId: 1411, x: 0.51, y: 0.31 }]]);
  assert.doesNotMatch(JSON.stringify(out.map((o) => o.entry)), /Abel|Thunder|GUID|Mage|1700000000|0\.5123/);
  // The companion's AI context and the approved profile never carry the block.
  const providers = require("../src/core/providers.cjs");
  assert.equal(providers.approvedProfile(profile).wares, undefined);
  assert.doesNotMatch(JSON.stringify(providers.approvedProfile(profile)), /Thork|3296/);
});

test("the file ships with the addon and its saved table is per character", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverWaresDB\b/m);
  assert.match(toc, /^BackstageForeverWares\.lua\r?$/m);
  assert.ok(ADDON_FILES.includes("BackstageForeverWares.lua"));
  const src = read("addon/BackstageForever/BackstageForeverWares.lua");
  // It reads; it never buys, sells, clicks or talks.
  assert.doesNotMatch(src, /BuyMerchantItem|UseContainerItem|PickupMerchantItem|SendChatMessage|SendAddonMessage|:Click\(|RunMacro/);
  // No prices and nothing about the character is read.
  assert.doesNotMatch(src, /GetMerchantItemInfo|GetMoney|UnitName\('player'\)|GetRealmName|UnitGUID\('player'\)/);
});

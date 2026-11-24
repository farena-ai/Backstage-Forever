"use strict";
// 1.23: class kits (/bf kit) and the ready check (/bf ready, and one line at the dungeon door).
// Pure functions first, then the thin game-facing parts with stubs.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverKits.lua')\n";
// A small game: a class, a level, bags, known spells, buffs, an instance.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler
CreateFrame=function()
  local f={RegisterEvent=function() end}
  f.SetScript=function(_,k,fn) if k=='OnEvent' then handler=fn end end
  return f
end
local combat=false InCombatLockdown=function() return combat end
local class,level='MAGE',30 UnitClass=function() return class,class end UnitLevel=function() return level end
local bags={} GetItemCount=function(id) return bags[id] or 0 end
local itemNames={[6265]='Soul Shard',[17020]='Arcane Powder',[17031]='Rune of Teleportation',[17032]='Rune of Portals',[5140]='Flash Powder'}
GetItemInfo=function(id) return itemNames[id] end
local known={} IsPlayerSpell=function(id) return known[id]==true end
local spellNames={[1459]='Arcane Intellect',[23028]='Arcane Brilliance',[168]='Frost Armor',[7302]='Ice Armor',[6117]='Mage Armor',[19705]='Well Fed',[587]='Conjure Food',[5504]='Conjure Water',
  [1243]='Power Word: Fortitude',[21562]='Prayer of Fortitude',[588]='Inner Fire',[687]='Demon Skin',[706]='Demon Armor'}
GetSpellInfo=function(id) return spellNames[id] end
local buffs={} UnitBuff=function(unit,i) assert(unit=='player') return buffs[i] end
local inside,kind=false,'none' IsInInstance=function() return inside,kind end
local function last() return said[#said] end
`;

test("kit rows: what a class carries, when it matters and when it is low", () => lua(FILE + String.raw`
local function row(rows,label) for _,r in ipairs(rows) do if r.label==label then return r end end end
-- A warlock from level 10 counts shards; the summoning stones only once the spell is known.
local rows=BackstageForeverKitRows('WARLOCK',30,{[6265]=1},{})
assert(#rows==1 and rows[1].label=='Soul Shard' and rows[1].count==1 and rows[1].low==true and rows[1].quiet==false)
assert(#BackstageForeverKitRows('WARLOCK',5,{},{})==0,'no shard talk before level 10')
assert(BackstageForeverKitRows('WARLOCK',5,{[6265]=2},{})[1].low==false,'carried but not yet needed is never low')
rows=BackstageForeverKitRows('WARLOCK',60,{[6265]=12,[5565]=0},{[1122]=true})
assert(row(rows,'Soul Shard').low==false and row(rows,'Infernal Stone').low==true and row(rows,'Infernal Stone').quiet==true and not row(rows,'Demonic Figurine'))
-- A mage: runes once a teleport or portal is known, powder once Arcane Brilliance is.
rows=BackstageForeverKitRows('MAGE',40,{[17031]=4,[17032]=1},{[3567]=true,[11417]=true})
assert(#rows==2 and row(rows,'Rune of Teleportation').count==4 and row(rows,'Rune of Teleportation').low==false and row(rows,'Rune of Portals').low==true)
assert(#BackstageForeverKitRows('MAGE',60,{},{})==0,'nothing known, nothing carried: nothing listed')
assert(#BackstageForeverKitRows('MAGE',60,{[17020]=3},nil)==1 and BackstageForeverKitRows('MAGE',60,{[17020]=0},nil)[1]==nil,'known spells unreadable: only what you carry, never low')
assert(BackstageForeverKitRows('MAGE',60,{[17020]=1},nil)[1].low==false)
-- A rogue: every poison counts as one row.
rows=BackstageForeverKitRows('ROGUE',40,{[6947]=3,[2892]=2,[5140]=0},{[1856]=true})
assert(row(rows,'Poisons').count==5 and row(rows,'Poisons').low==false and row(rows,'Poisons').group==true and row(rows,'Flash Powder').low==true)
assert(row(BackstageForeverKitRows('ROGUE',19,{},{}),'Poisons')==nil and row(BackstageForeverKitRows('ROGUE',20,{},{}),'Poisons').low==true)
-- Priest candles and druid seeds are counted together.
rows=BackstageForeverKitRows('PRIEST',60,{[17028]=1,[17029]=4},{[21562]=true})
assert(row(rows,'Candles').count==5 and row(rows,'Candles').low==false)
rows=BackstageForeverKitRows('DRUID',40,{[17036]=1},{[20484]=true,[21849]=true})
assert(row(rows,'Rebirth seeds').count==1 and row(rows,'Rebirth seeds').low==false and row(rows,'Gift of the Wild reagents').low==true)
rows=BackstageForeverKitRows('PALADIN',60,{[21177]=4},{[25898]=true})
assert(row(rows,'Symbol of Kings').low==true and row(rows,'Symbol of Kings').count==4)
assert(row(BackstageForeverKitRows('SHAMAN',40,{[17030]=5},{[20608]=true}),'Ankh').low==false)
assert(#BackstageForeverKitRows('WARRIOR',60,{},{})==0 and #BackstageForeverKitRows(nil,nil,nil,nil)==0)
assert(BackstageForeverBestRank({587,597,990},{[587]=true,[597]=true})==2 and BackstageForeverBestRank({587,597},{})==0 and BackstageForeverBestRank({587},nil)==nil)
`));

test("every item and spell id in the kit tables is one the game data confirmed by name", () => {
  // Checked against the game's own item and spell tables on build 1.60.1.71037 (read locally, never bundled).
  const ITEMS = [6265, 5565, 16583, 17031, 17032, 17020, 17056, 6947, 6949, 6950, 8926, 8927, 8928, 2892, 2893, 8984, 8985, 20844, 3775, 3776, 5237, 6951, 9186, 10918, 10920, 10921, 10922, 5140, 5530, 5060, 17030, 21177, 17033, 17028, 17029, 17034, 17035, 17036, 17037, 17038, 17021, 17026, 5175, 5176, 5177, 5178];
  const SPELLS = [1122, 18540, 3561, 3562, 3563, 3565, 3566, 3567, 10059, 11416, 11417, 11418, 11419, 11420, 23028, 130, 1856, 2094, 1804, 20608, 25782, 25894, 25898, 19752, 21562, 21564, 27681, 27683, 1706, 20484, 21849, 21850,
    587, 597, 990, 6129, 10144, 10145, 28612, 5504, 5505, 5506, 6127, 10138, 10139, 10140, 1459, 168, 7302, 6117, 1243, 588, 1126, 687, 706, 324, 5118, 13159, 13161, 20043, 13163, 13165, 19705];
  const out = lua(FILE + String.raw`
local d=BackstageForeverKitData
local items,spells={},{}
for _,kit in pairs(d.kits) do for _,e in ipairs(kit) do
  assert(#e.label<=30 and e.low>=1 and (e.spells or e.level),e.label)
  for _,id in ipairs(e.items) do items[id]=true end
  for _,id in ipairs(e.spells or {}) do spells[id]=true end
end end
for _,t in ipairs(d.totems) do items[t[1]]=true end
for _,ranks in ipairs(d.conjure) do for _,id in ipairs(ranks) do spells[id]=true end end
for _,groups in pairs(d.buffs) do for _,g in ipairs(groups) do for _,id in ipairs(g.need) do spells[id]=true end for _,id in ipairs(g.have) do spells[id]=true end end end
spells[d.wellFed]=true
local a,b={},{} for id in pairs(items) do a[#a+1]=id end for id in pairs(spells) do b[#b+1]=id end
table.sort(a) table.sort(b) print(table.concat(a,',')) print(table.concat(b,','))
`).split("\n");
  const sorted = (list) => [...list].sort((x, y) => x - y).join(",");
  assert.equal(out[0], sorted(ITEMS)); assert.equal(out[1], sorted(SPELLS));
});

test("missing buffs: only a buff you know, named by the game, and any version of it counts as up", () => lua(FILE + String.raw`
local names={[1459]='Arcane Intellect',[23028]='Arcane Brilliance',[168]='Frost Armor',[7302]='Ice Armor',[6117]='Mage Armor'}
local function list(known,auras) return table.concat(BackstageForeverMissingBuffs('MAGE',known,names,auras),'|') end
assert(list({[1459]=true,[168]=true},{})=='Arcane Intellect|Frost Armor')
assert(list({[1459]=true,[168]=true,[7302]=true,[6117]=true},{})=='Arcane Intellect|Mage Armor','the best armor you know names the line')
assert(list({[1459]=true,[168]=true,[7302]=true},{['Arcane Brilliance']=true,['Frost Armor']=true})=='','the group version and an older armor both count')
assert(list({},{})=='','a spell you never learned is never missing')
assert(list({[1459]=true},{['Arcane Intellect']=true})=='')
assert(#BackstageForeverMissingBuffs('MAGE',{[1459]=true},{},{})==0,'no name from the game, no claim')
assert(#BackstageForeverMissingBuffs('MAGE',nil,names,{})==0 and #BackstageForeverMissingBuffs('MAGE',{[1459]=true},names,nil)==0)
assert(#BackstageForeverMissingBuffs('WARRIOR',{[1459]=true},names,{})==0 and #BackstageForeverMissingBuffs('PALADIN',{},names,{})==0)
local de={[1243]='Machtwort: Seelenst\195\164rke',[21562]='Gebet der Seelenst\195\164rke',[588]='Inneres Feuer'}
assert(table.concat(BackstageForeverMissingBuffs('PRIEST',{[1243]=true,[588]=true},de,{['Gebet der Seelenst\195\164rke']=true}),'|')=='Inneres Feuer','works on the names of any language')
`));

test("the kit line and the ready line read plainly and stay one line", () => lua(FILE + String.raw`
local rows={{label='Rune of Teleportation',count=4,low=false,quiet=true},{label='Rune of Portals',count=1,low=true,quiet=true},{label='Arcane Powder',count=0,low=true,quiet=false}}
assert(BackstageForeverKitLine({class='MAGE',rows=rows,conjure={{name='Conjure Food',rank=4},{name='Conjure Water',rank=0}}})
  =='Your kit: Rune of Teleportation 4, Rune of Portals 1 (low), Arcane Powder 0 (low). Conjure Food: rank 4 is your best.')
assert(BackstageForeverKitLine({class='HUNTER',rows={},ammo=150,ammoLow=true,pet=1})=='Your kit: Ammo 150 (low). Your pet is unhappy: feed it before you head out.')
assert(BackstageForeverKitLine({class='HUNTER',rows={},ammo=800,ammoLow=false,pet=3})=='Your kit: Ammo 800. Your pet is happy.')
assert(BackstageForeverKitLine({class='HUNTER',rows={},ammo=800})=='Your kit: Ammo 800.','no pet out, or its mood is not readable: nothing said')
assert(BackstageForeverKitLine({class='SHAMAN',rows={{label='Ankh',count=3,low=false}},totems={have={'Earth Totem','Fire Totem'},missing={'Water Totem','Air Totem'}}})
  =='Your kit: Ankh 3. Totems carried: Earth Totem, Fire Totem. Totems not carried: Water Totem, Air Totem.')
assert(BackstageForeverKitLine({class='WARRIOR',rows={}})=='Your class carries nothing the addon counts yet.')
assert(BackstageForeverKitLine(nil)=='Your class is not readable in this game client.')
-- Ready: quiet rows never reach the dungeon line.
assert(BackstageForeverReadyLine({buffs={'Arcane Intellect','Mage Armor'},food=false,rows=rows})=='Before you pull: missing Arcane Intellect, Mage Armor; no food buff; low: Arcane Powder 0.')
assert(BackstageForeverReadyLine({buffs={},food=true,rows={rows[1],rows[2]}})==nil,'nothing wrong and nobody asked: silence')
assert(BackstageForeverReadyLine({buffs={},food=true,rows={},asked=true})=='Ready: nothing is missing that the addon can check.')
assert(BackstageForeverReadyLine({buffs={},food=false,rows={}})=='Before you pull: no food buff.')
assert(BackstageForeverReadyLine({rows={},ammo=40,ammoLow=true})=='Before you pull: low: Ammo 40.','buffs not readable: they are left out, not called missing')
assert(BackstageForeverReadyLine({rows={},asked=true})=='Ready: nothing is missing that the addon can check. Your buffs are not readable right now, so they were not checked.')
assert(BackstageForeverReadyLine({rows={},ammo=40,ammoLow=true,asked=true}):find('were not checked',1,true))
assert(BackstageForeverReadyLine(nil)==nil)
assert(BackstageForeverReadyPlace(true,'party') and BackstageForeverReadyPlace(true,'raid'))
assert(not BackstageForeverReadyPlace(true,'pvp') and not BackstageForeverReadyPlace(true,'arena') and not BackstageForeverReadyPlace(false,'none') and not BackstageForeverReadyPlace(nil,'party'))
`));

test("in game: /bf kit and /bf ready read bags, spells and buffs; never in combat", () => lua(STUBS + FILE + String.raw`
known={[1459]=true,[168]=true,[7302]=true,[3567]=true,[23028]=true,[587]=true,[597]=true,[5504]=true}
bags={[17031]=3,[17020]=1}
BackstageForeverKitCommand()
assert(#said==1 and said[1]=='Backstage Forever: Your kit: Rune of Teleportation 3, Arcane Powder 1 (low). Conjure Food: rank 2 is your best. Conjure Water: rank 1 is your best.',said[1])
buffs={'Arcane Brilliance'}
BackstageForeverReadyCommand('ready')
assert(last()=='Backstage Forever: Before you pull: missing Ice Armor; no food buff; low: Arcane Powder 1.',last())
buffs={'Arcane Intellect','Ice Armor','Well Fed'} bags[17020]=20
BackstageForeverReadyCommand('ready') assert(last()=='Backstage Forever: Ready: nothing is missing that the addon can check.',last())
combat=true local n=#said
BackstageForeverReadyCommand('ready') assert(#said==n+1 and last():find('outside combat',1,true))
BackstageForeverKitCommand() assert(#said==n+2 and last():find('outside combat',1,true))
combat=false
-- Buffs the game hides are left out, never called missing.
issecretvalue=function(v) return v=='hidden' end
buffs={'hidden'} BackstageForeverReadyCommand('ready')
assert(last()=='Backstage Forever: Ready: nothing is missing that the addon can check. Your buffs are not readable right now, so they were not checked.',last())
issecretvalue=nil
UnitBuff=function() error('blocked') end BackstageForeverReadyCommand('ready') assert(last():find('were not checked',1,true))
-- The newer aura call is used when the client has it.
C_UnitAuras={GetAuraDataByIndex=function(unit,i,filter) assert(unit=='player' and filter=='HELPFUL') local name=({'Arcane Intellect','Well Fed'})[i] return name and {name=name} or nil end}
BackstageForeverReadyCommand('ready') assert(last()=='Backstage Forever: Before you pull: missing Ice Armor.',last())
-- No way to ask which spells you know: counts only, and no buff is called missing.
IsPlayerSpell=nil BackstageForeverReadyCommand('ready') assert(last()=='Backstage Forever: Ready: nothing is missing that the addon can check.',last())
BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your kit: Rune of Teleportation 3, Arcane Powder 20.',last())
UnitClass=function() error('gone') end BackstageForeverKitCommand() assert(last():find('not readable',1,true))
BackstageForeverReadyCommand('ready') assert(last():find('not readable',1,true))
`));

test("in game: hunters, warlocks and shamans get their own kit", () => lua(STUBS + FILE + String.raw`
class,level='HUNTER',20
GetInventorySlotInfo=function(name) assert(name=='AmmoSlot') return 0 end
local ammo=150 GetInventoryItemID=function(_,slot) return ammo>0 and 2512 or nil end
GetInventoryItemCount=function(_,slot) return ammo>0 and ammo or 1 end
local pet,mood=true,1 UnitExists=function(unit) return unit=='pet' and pet end GetPetHappiness=function() return mood end
BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your kit: Ammo 150 (low). Your pet is unhappy: feed it before you head out.',last())
BackstageForeverReadyCommand('ready') assert(last()=='Backstage Forever: Before you pull: no food buff; low: Ammo 150.',last())
ammo=0 pet=false BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your kit: Ammo 0 (low).','an empty ammo slot is zero, not one: '..last())
ammo=900 pet=true mood=nil BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your kit: Ammo 900.',last())
class,level='WARLOCK',25 bags={[6265]=2}
BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your kit: Soul Shard 2 (low).',last())
class='SHAMAN' bags={[5175]=1,[5177]=1}
BackstageForeverKitCommand() assert(last()=='Backstage Forever: Totems carried: Earth Totem, Water Totem. Totems not carried: Fire Totem, Air Totem.',last())
class='WARRIOR' BackstageForeverKitCommand() assert(last()=='Backstage Forever: Your class carries nothing the addon counts yet.')
`));

test("at the dungeon door: one line on walking in, after combat, not on a reload, off with its switch", () => lua(STUBS + FILE + String.raw`
class,level='WARLOCK',30 known={[687]=true,[706]=true} bags={[6265]=1} buffs={'Well Fed'}
handler(nil,'PLAYER_ENTERING_WORLD',true,false) assert(#said==0,'not in a dungeon')
inside,kind=true,'party' handler(nil,'PLAYER_ENTERING_WORLD',false,false)
assert(#said==1 and said[1]=='Backstage Forever: Before you pull: missing Demon Armor; low: Soul Shard 1.',said[1])
handler(nil,'PLAYER_ENTERING_WORLD',false,false) handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==1,'once per visit')
inside,kind=false,'none' handler(nil,'PLAYER_ENTERING_WORLD',false,false)
inside,kind=true,'raid' combat=true handler(nil,'PLAYER_ENTERING_WORLD',false,false) assert(#said==1,'never in combat')
combat=false handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==2,'said when combat ends')
handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==2)
inside,kind=false,'none' handler(nil,'PLAYER_ENTERING_WORLD',false,false)
inside,kind=true,'pvp' handler(nil,'PLAYER_ENTERING_WORLD',false,false) assert(#said==2,'battlegrounds are not dungeons')
inside,kind=false,'none' handler(nil,'PLAYER_ENTERING_WORLD',false,false)
buffs={'Demon Armor','Well Fed'} bags[6265]=10 inside,kind=true,'party' handler(nil,'PLAYER_ENTERING_WORLD',false,false) assert(#said==2,'nothing missing: silence')
inside,kind=false,'none' handler(nil,'PLAYER_ENTERING_WORLD',false,false)
buffs={} BackstageForeverReadyCommand('ready off') assert(BackstageForeverKitSettings.ready==false and last():find('off',1,true))
local n=#said inside,kind=true,'party' handler(nil,'PLAYER_ENTERING_WORLD',false,false) assert(#said==n,'switched off')
BackstageForeverReadyCommand('ready') assert(#said==n+1 and last():find('missing Demon Armor',1,true),'the command still answers')
BackstageForeverReadyCommand('ready on') assert(BackstageForeverKitSettings.ready==true and BackstageForeverKitEnabled())
`+ FILE + String.raw`
said={} inside,kind=true,'party' handler(nil,'PLAYER_ENTERING_WORLD',false,true) assert(#said==0,'a /reload inside is not walking in')
`));

test("the kit helpers are wired in, saved per character, switchable, and never act for the player", () => {
  const src = read("addon/BackstageForever/BackstageForeverKits.lua");
  for (const banned of ["CastSpell", "UseItem", "UseContainerItem", "BuyMerchantItem", "PickupContainerItem", "SendChatMessage", "RunMacro", "CreateFontString", "CreateTexture", "COMBAT_LOG"]) assert.ok(!src.includes(banned), banned);
  assert.match(src, /local function auraNames\(\)\r?\n    if combat\(\) then return nil end/, "buffs are never read in combat");
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariables: BackstageForeverExport\r?$/m);
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverKitSettings\b/m);
  assert.match(toc, /^BackstageForeverKits\.lua\r?$/m);
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const word of ["kit", "ready"]) assert.ok(hud.includes(`word=='${word}'`), word);
  assert.ok(read("addon/BackstageForever/BackstageForeverOptions.lua").includes("on('BackstageForeverKitSettings','ready'),'ready'"));
  const { CATALOG } = require("../src/renderer/commands.js");
  for (const command of ["/bf kit", "/bf ready [on|off]"]) assert.ok(CATALOG.some((c) => c.command === command), command);
  const help = read("addon/BackstageForever/BackstageForeverAssist.lua");
  for (const word of ["kit", "ready", "rested", "weapons", "durability", "explore", "comfort"]) assert.ok(help.includes(`'/bf ${word} `), `/bf help lists ${word}`);
});

test("German clients get the kit and ready lines in German", () => {
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua') dofile('addon/BackstageForever/BackstageForeverLocaleDe.lua') dofile('addon/BackstageForever/BackstageForeverLocaleEs.lua') dofile('addon/BackstageForever/BackstageForeverLocaleFr.lua')
` + FILE + String.raw`
print(BackstageForeverReadyLine({buffs={'Arkane Intelligenz'},food=false,rows={{label='Soul Shard',name='Seelensplitter',count=1,low=true}}}))
print(BackstageForeverReadyLine({buffs={},food=true,rows={},asked=true}))
print(BackstageForeverKitLine({class='HUNTER',rows={},ammo=150,ammoLow=true,pet=1}))
print(BackstageForeverKitLine({class='MAGE',rows={{label='Arcane Powder',count=2,low=false}},conjure={{name='Essen herbeizaubern',rank=4}}}))
print(BackstageForeverKitLine({class='ROGUE',rows={{label='Poisons',count=0,low=true,group=true}}}))
print(BackstageForeverKitLine({class='WARRIOR',rows={}}))
`).split("\n");
  assert.equal(out[0], "Vor dem Kampf: es fehlt Arkane Intelligenz; kein Essens-Buff; knapp: Seelensplitter 1.");
  assert.equal(out[1], "Bereit: Es fehlt nichts, was das Addon prüfen kann.");
  assert.equal(out[2], "Dein Vorrat: Munition 150 (knapp). Dein Begleiter ist unglücklich: füttere ihn, bevor du losziehst.");
  assert.equal(out[3], "Dein Vorrat: Arkanes Pulver 2. Essen herbeizaubern: Rang 4 ist dein bester.");
  assert.equal(out[4], "Dein Vorrat: Gifte 0 (knapp).");
  assert.equal(out[5], "Deine Klasse trägt noch nichts, was das Addon zählt.");
});

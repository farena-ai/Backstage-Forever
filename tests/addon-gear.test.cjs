"use strict";
// In-game gear helper: scoring parity with src/core/gear-score.cjs, the quest reward highlight
// and the tooltip upgrade line, run through the real addon file in fengari.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { scoreItem, compare, bestReward, blockers } = require("../src/core/gear-score.cjs");
const root = path.join(__dirname, "..");
function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const LOAD = "dofile('addon/BackstageForever/BackstageForeverGear.lua')";

// JS value -> Lua literal (items, contexts, slot maps).
function toLua(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `{${v.map(toLua).join(",")}}`;
  return `{${Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => `${/^\d+$/.test(k) ? `[${k}]` : `[${JSON.stringify(k)}]`}=${toLua(x)}`).join(",")}}`;
}

// Shapes as game-data.cjs item() returns them (same helpers as tests/gear-score.test.cjs).
const armor = (id, name, inventoryType, subclassId, armorValue, stats, extra = {}) => ({
  id, name, quality: 2, itemLevel: 25, requiredLevel: 20, classId: 4, subclassId, inventoryType, slot: null,
  kind: { 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield" }[subclassId] || "Miscellaneous",
  armor: armorValue, stats: Object.entries(stats).map(([stat, amount]) => ({ stat, amount })), damage: null, speed: null, dps: null,
  sellPrice: 1000, bonding: null, classes: null, iconFileId: 1, ...extra,
});
const weapon = (id, name, inventoryType, subclassId, dps, stats, extra = {}) => ({
  ...armor(id, name, inventoryType, 0, null, stats), classId: 2, subclassId, kind: "Weapon", requiredLevel: 5, dps, speed: 2.5, damage: { min: 1, max: 2 }, ...extra,
});
const agilityMail = armor(1, "Chain Vest", 5, 3, 210, { Agility: 6, Stamina: 3 });
const strengthPlate = armor(2, "Plated Chest", 5, 4, 380, { Strength: 7, Stamina: 4 });
const intCloth = armor(3, "Robe of Insight", 20, 1, 45, { Intellect: 6, Spirit: 3 });
const strMail = armor(4, "Warrior's Chain", 5, 3, 210, { Strength: 6, Stamina: 3 });
const heavySpikedMace = weapon(4778, "Heavy Spiked Mace", 17, 5, 12.5, { Strength: 6 });
const compactHammer = weapon(1009, "Compact Hammer", 21, 4, 7.0, { Stamina: 1 });
const buckler = armor(5, "Buckler", 14, 6, 300, { Stamina: 2 });
const gloves = armor(5299, "Gloves of the Moon", 10, 2, 48, { Stamina: 3, Agility: 3 });
const oldGloves = armor(6, "Old Gloves", 10, 2, 30, { Agility: 1 });
const ring = (id, int, sell = 100) => armor(id, `Ring ${id}`, 11, 0, 0, { Intellect: int }, { sellPrice: sell });
const wand = weapon(7, "Wand", 26, 19, 9, { Intellect: 2 });
const bow = weapon(8, "Hunting Bow", 15, 2, 8.4, { Agility: 2 });
const offhand = weapon(9, "Off-hand Sword", 22, 7, 8, {});
const fireCloak = armor(10, "Ember Cloak", 16, 1, 20, { "Fire Resistance": 10, Stamina: 2 });
const spellRobe = armor(11, "Spell Robe", 20, 1, 50, { "Spell Damage": 7, Intellect: 4, "Mana Regeneration": 2 });
const totem = armor(12, "Totem", 28, 9, 0, { Stamina: 1 });
const ALL = [agilityMail, strengthPlate, intCloth, strMail, heavySpikedMace, compactHammer, buckler, gloves, oldGloves, ring(20, 3), wand, bow, offhand, fireCloak, spellRobe, totem];
const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

const n = (x) => String(x);
const ops = [];
for (const className of CLASSES) for (const level of [10, 30, 40, 60]) for (const item of ALL) ops.push(["score", item, { className, level }]);
for (const item of ALL) ops.push(["score", item, {}], ["score", item, { className: "Warrior", level: 40, spec: "tank" }], ["score", item, { className: "Priest", level: 30, spec: "healer" }]);
const compares = [
  [heavySpikedMace, [compactHammer], { className: "Warrior", level: 20 }],
  [heavySpikedMace, [compactHammer, buckler], { className: "Warrior", level: 20 }],
  [heavySpikedMace, [compactHammer], { className: "Priest", level: 20 }],
  [gloves, oldGloves, { className: "Rogue", level: 20 }],
  [oldGloves, gloves, { className: "Rogue", level: 20 }],
  [gloves, null, { className: "Rogue", level: 20 }],
  [gloves, null, { className: "Rogue", level: 20, equipmentKnown: false }],
  [gloves, gloves, { className: "Rogue", level: 20 }],
  [gloves, { id: 9, unknown: true, stats: [], armor: 0 }, { className: "Rogue", level: 20 }],
  [agilityMail, strMail, { className: "Hunter", level: 45 }],
  [agilityMail, intCloth, { className: "Priest", level: 45 }],
  [spellRobe, intCloth, { className: "Mage", level: 25 }],
  [bow, wand, { className: "Hunter", level: 25 }],
  [wand, bow, { className: "Mage", level: 25 }],
  [fireCloak, null, { className: "Druid", level: 25 }],
];
for (const [c, e, ctx] of compares) ops.push(["compare", c, e, ctx]);
const rewards = [
  [[strengthPlate, agilityMail], { className: "Hunter", level: 40 }, {}],
  [[agilityMail, strengthPlate], { className: "Warrior", level: 40 }, {}],
  [[agilityMail, strMail, strengthPlate], { className: "Warrior", level: 30 }, {}],
  [[strengthPlate, agilityMail, intCloth], { className: "Mage", level: 25 }, {}],
  [[strengthPlate, agilityMail, intCloth], { className: "Priest", level: 25 }, {}],
  [[strengthPlate, agilityMail, intCloth], { className: "Warlock", level: 25 }, {}],
  [[compactHammer, heavySpikedMace], { className: "Warrior", level: 20 }, { 16: compactHammer, 17: buckler }],
  [[ring(10, 3)], { className: "Mage", level: 25 }, { 11: ring(11, 5), 12: ring(12, 1) }],
  [[{ ...strengthPlate, sellPrice: 50 }, { ...agilityMail, sellPrice: 90 }], { className: "Mage", level: 25 }, {}],
  [[ring(13, 1)], { className: "Mage", level: 25 }, { 11: ring(11, 5), 12: ring(12, 4) }],
  [[bow, wand, spellRobe], { className: "Hunter", level: 30 }, { 18: weapon(30, "Old Bow", 15, 2, 4, {}) }],
];
for (const [choices, ctx, eq] of rewards) ops.push(["best", choices, ctx, eq]);
const blockerCases = [
  [strengthPlate, { className: "Hunter", level: 40 }], [agilityMail, { className: "Hunter", level: 30 }], [agilityMail, { className: "Priest", level: 45 }],
  [strengthPlate, { className: "Paladin", level: 39 }], [strengthPlate, { className: "Paladin", level: 40 }], [strengthPlate, { className: "Rogue", level: 60 }],
  [{ ...intCloth, requiredLevel: 30 }, { className: "Mage", level: 25 }], [{ ...intCloth, classes: ["Priest"] }, { className: "Mage", level: 25 }],
  [buckler, { className: "Rogue", level: 25 }], [offhand, { className: "Warrior", level: 10 }], [offhand, { className: "Mage", level: 30 }],
  [heavySpikedMace, { className: "Priest", level: 20 }], [totem, { className: "Druid", level: 20 }], [agilityMail, {}],
];
for (const [item, ctx] of blockerCases) ops.push(["blockers", item, ctx]);

function jsLine([fn, a, b, c]) {
  if (fn === "score") { const r = scoreItem(a, b); return [n(r.score), r.usable, r.reasons.join(";")].join("|"); }
  if (fn === "blockers") return blockers(a, b).join(";");
  if (fn === "compare") { const r = compare(a, b, c); return [r.better, n(r.delta), r.reasons.join(";")].join("|"); }
  const r = bestReward(a, b, c);
  return [r.index, r.itemId, r.upgrade, n(r.delta), r.reasons.join(";")].join("|");
}
function luaOp([fn, a, b, c]) {
  if (fn === "score") return `local r=G.score(${toLua(a)},${toLua(b)}) out(num(r.score)..'|'..tostring(r.usable)..'|'..table.concat(r.reasons,';'))`;
  if (fn === "blockers") return `out(table.concat(G.blockers(${toLua(a)},${toLua(b)}),';'))`;
  if (fn === "compare") return `local r=G.compare(${toLua(a)},${toLua(b)},${toLua(c)}) out(tostring(r.better)..'|'..num(r.delta)..'|'..table.concat(r.reasons,';'))`;
  return `local r=G.bestReward(${toLua(a)},${toLua(b)},${toLua(c)}) out((r.index-1)..'|'..r.itemId..'|'..tostring(r.upgrade)..'|'..num(r.delta)..'|'..table.concat(r.reasons,';'))`;
}

test("scoring, usability, comparisons and reward picks match gear-score.cjs", () => {
  const script = `${LOAD}
local G=BackstageForeverGear
local function num(x) if x==math.floor(x) then return ('%d'):format(x) end return tostring(x) end
local function out(s) io.write('>',s,'\\n') end
${ops.map((o) => `do ${luaOp(o)} end`).join("\n")}`;
  const got = lua(script).split("\n").map((l) => l.slice(1));
  assert.equal(got.length, ops.length);
  ops.forEach((o, i) => assert.equal(got[i], jsLine(o), `${o[0]} #${i}: ${o[1]?.name || o[1].map?.((x) => x.name).join(",")} ${JSON.stringify(o[o[0] === "score" || o[0] === "blockers" ? 2 : o[0] === "compare" ? 3 : 2])}`));
  assert.ok(ops.length > 600);
});

test("named cases read the way players expect", () => {
  const out = lua(`${LOAD}
local G=BackstageForeverGear
print(table.concat(G.blockers(${toLua(strengthPlate)},{className='Hunter',level=40}),';'))
print(table.concat(G.blockers(${toLua(agilityMail)},{className='Hunter',level=30}),';'))
print(table.concat(G.blockers(${toLua(agilityMail)},{className='Priest',level=45}),';'))
print(table.concat(G.blockers(${toLua(strengthPlate)},{className='Warrior',level=39}),';'))
local r=G.compare(${toLua(heavySpikedMace)},{${toLua(compactHammer)}},{className='Warrior',level=20}) print(table.concat(r.reasons,';'))
print(G.bestReward({${toLua(strengthPlate)},${toLua(agilityMail)}},{className='Hunter',level=40},{}).index)
print(G.bestReward({${toLua(strengthPlate)},${toLua(agilityMail)},${toLua(intCloth)}},{className='Mage',level=25},{}).index)`).split("\n");
  assert.deepEqual(out, ["Hunters cannot wear plate", "Hunters can wear mail from level 40", "Priests cannot wear mail", "Warriors can wear plate from level 40", "+5.5 DPS;+6 Strength;-1 Stamina", "2", "3"]);
});

// A small fake client: item cache, equipped slots, quest choices, frames and tooltips.
const GAME = String.raw`
local msgs,frames,touched={}, {}, {}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) msgs[#msgs+1]=m end}
local function obj(name)
  local o={name=name,shown=false,scripts={},events={},points={}}
  function o:Show() self.shown=true end function o:Hide() self.shown=false end
  function o:IsShown() return self.shown end
  function o:SetParent(p) self.parent=p end
  function o:SetText(t) self.text=t end
  function o:SetPoint(...) self.points[#self.points+1]={...} end
  function o:RegisterEvent(e) self.events[e]=true end
  function o:SetScript(k,fn) self.scripts[k]=fn end
  function o:CreateTexture() return obj() end
  function o:CreateFontString() return obj() end
  return setmetatable(o,{__index=function(_,k) if type(k)=='string' and k:match('^%u') then return function() end end end})
end
CreateFrame=function(_,name) local f=obj(name) frames[#frames+1]=f if name then frames[name]=f end return f end
UIParent=obj('UIParent')
local items,stats,equipped={},{},{}
local function def(link,info,st) items[link]=info stats[link]=st end
GetItemInfo=function(link) local i=items[link] if not i then return nil end return i[1],link,2,25,i[2],'Armor','Mail',1,i[3],1,i[4] or 100,i[5],i[6] end
GetItemStats=function(link) return stats[link] end
GetInventoryItemLink=function(_,slot) return equipped[slot] end
local class,classFile,level='Hunter','HUNTER',40
UnitClass=function() return class,classFile end
UnitLevel=function() return level end
-- Items: name, required level, equip slot, sell price, classID, subclassID.
def('item:101',{'Chain Vest',20,'INVTYPE_CHEST',900,4,3},{ITEM_MOD_AGILITY_SHORT=6,ITEM_MOD_STAMINA_SHORT=3,RESISTANCE0_NAME=210})
def('item:102',{'Plated Chest',20,'INVTYPE_CHEST',1500,4,4},{ITEM_MOD_STRENGTH_SHORT=7,ITEM_MOD_STAMINA_SHORT=4,RESISTANCE0_NAME=380})
def('item:103',{'Robe of Insight',20,'INVTYPE_ROBE',800,4,1},{ITEM_MOD_INTELLECT_SHORT=6,ITEM_MOD_SPIRIT_SHORT=3,RESISTANCE0_NAME=45})
def('item:104',{'Worn Leather Vest',10,'INVTYPE_CHEST',50,4,2},{ITEM_MOD_AGILITY_SHORT=3,RESISTANCE0_NAME=198})
def('item:105',{'Heavy Spiked Mace',5,'INVTYPE_2HWEAPON',2000,2,5},{ITEM_MOD_STRENGTH_SHORT=6,ITEM_MOD_DAMAGE_PER_SECOND_SHORT=12.5})
def('item:106',{'Compact Hammer',5,'INVTYPE_WEAPONMAINHAND',300,2,4},{ITEM_MOD_STAMINA_SHORT=1,ITEM_MOD_DAMAGE_PER_SECOND_SHORT=7})
def('item:107',{'Linen Bandage',1,'',10,0,0},{})
equipped[5]='item:104'
`;
const PICKER = String.raw`
local choices={'item:102','item:101'}
GetNumQuestChoices=function() return #choices end
GetQuestItemLink=function(kind,i) return kind=='choice' and choices[i] or nil end
GetQuestID=function() return 77 end
GetQuestReward=function() touched[#touched+1]='GetQuestReward' end
QuestFrameCompleteQuestButton=obj('complete') QuestFrameCompleteQuestButton.Click=function() touched[#touched+1]='Click' end
local function button(i,kind,id) local b=obj('QuestInfoRewardsFrameQuestInfoItem'..i) b.type=kind b.shown=true b.GetID=function() return id end b.Icon=obj('icon'..i) _G['QuestInfoRewardsFrameQuestInfoItem'..i]=b return b end
-- A fixed reward listed first with ID 2 must not be mistaken for choice #2.
local fixed=button(1,'reward',2) local first=button(2,'choice',1) local second=button(3,'choice',2)
QuestInfoFrame={rewardsFrame=obj('rewards')}
`;
const fire = (event) => `for _,f in ipairs(frames) do if f.events['${event}'] and f.scripts.OnEvent then f.scripts.OnEvent(f,'${event}') end end`;

test("reward picker glows the best choice for the class and never takes the reward", () => {
  const out = lua(`${GAME}${PICKER}${LOAD}
${fire("QUEST_COMPLETE")}
local glow=frames.BackstageForeverGearPick
assert(glow and glow.shown,'glow shown')
assert(glow.parent==second,'hunter at 40 gets the agility mail (choice 2), found by type and ID')
assert(glow.bfLabel.text=='Best for you')
assert(#touched==0,'never completes or selects')
print(msgs[1])
local pick=BackstageForeverGear.pickRewards() print(pick.line, pick.index, #msgs)
-- A warrior at 40 wants the plate instead.
class,classFile='Warrior','WARRIOR'
${fire("QUEST_COMPLETE")}
assert(glow.parent==first and glow.shown,'warrior gets choice 1')
-- A priest can use neither: no glow, one brief line.
class,classFile='Priest','PRIEST'
${fire("QUEST_COMPLETE")}
assert(not glow.shown,'no glow when nothing fits') print(msgs[#msgs])
${fire("QUEST_FINISHED")}
assert(#touched==0)
print(BackstageForeverGear.rewardButton(2)==second, select(2,BackstageForeverGear.rewardButton(1)))`).split("\n");
  assert.equal(out[0], "Backstage Forever: Best for you: +3 Agility, +3 Stamina, +12 armor (item:101)");
  assert.equal(out[1], "Best for you: +3 Agility, +3 Stamina, +12 armor\t2\t1", "re-evaluating does not repeat the chat line");
  assert.equal(out[2], "Backstage Forever: None of these rewards fit your character; pick the one that sells for the most.");
  assert.equal(out[3], "true\tQuestInfoRewardsFrameQuestInfoItem2");
});

test("reward picker waits for uncached items and falls back to QuestInfo_GetRewardButton", () => {
  const out = lua(`${GAME}
GetNumQuestChoices=function() return 2 end
GetQuestItemLink=function(_,i) return ({'item:102','item:999'})[i] end
local b1,b2=obj('b1'),obj('b2') b1.shown=true b2.shown=true
QuestInfoFrame={rewardsFrame=obj('rewards')}
QuestInfo_GetRewardButton=function(frame,i) assert(frame==QuestInfoFrame.rewardsFrame) return ({b1,b2})[i] end
${LOAD}
${fire("QUEST_COMPLETE")}
local glow=frames.BackstageForeverGearPick
print(glow==nil or not glow.shown, #msgs)
def('item:999',{'Ranger Chain',20,'INVTYPE_CHEST',900,4,3},{ITEM_MOD_AGILITY_SHORT=8,RESISTANCE0_NAME=220})
${fire("GET_ITEM_INFO_RECEIVED")}
glow=frames.BackstageForeverGearPick
print(glow.shown, glow.parent==b2, #msgs)`).split("\n");
  assert.deepEqual(out, ["true\t0", "true\ttrue\t1"]);
});

const TIP = String.raw`
local tipLines,current={},nil
GameTooltip=obj('GameTooltip') GameTooltip.GetItem=function() return 'x',current end
GameTooltip.AddLine=function(_,t,r,g,b) tipLines[#tipLines+1]=('%s %.2f %.2f %.2f'):format(t,r,g,b) end
local post
Enum={TooltipDataType={Item=0}}
TooltipDataProcessor={AddTooltipPostCall=function(kind,fn) assert(kind==0) post=fn end}
local function hover(link) current=link local before=#tipLines post(GameTooltip,{}) return #tipLines>before and tipLines[#tipLines] or 'none' end
`;

test("tooltips say upgrade, not for you, or not an upgrade, and /bf gear off silences them", () => {
  const out = lua(`${GAME}${TIP}${LOAD}
print(BackstageForeverGear.hookMode)
print(hover('item:101'))
print(hover('item:102'))
print(hover('item:104'))
print(hover('item:107'))
print(hover('item:404'))
level=30 print(hover('item:101'))
class,classFile,level='Priest','PRIEST',45 print(hover('item:101'))
class,classFile,level='Warrior','WARRIOR',20 equipped[16]='item:106' print(hover('item:105'))
local shopping=obj('ShoppingTooltip1') current='item:101' post(shopping,{}) print(#tipLines)
BackstageForeverGearCommand('gear off') print(hover('item:105'), BackstageForeverGearSettings.enabled, msgs[#msgs])
BackstageForeverGearCommand('gear on') print(hover('item:105'))`).split("\n");
  assert.deepEqual(out, [
    "postcall",
    "Upgrade for you: +3 Agility, +3 Stamina, +12 armor 0.25 1.00 0.25",
    "Not for you: Hunters cannot wear plate 1.00 0.30 0.30",
    "none",
    "none",
    "none",
    "Not for you: Hunters can wear mail from level 40 1.00 0.30 0.30",
    "Not for you: Priests cannot wear mail 1.00 0.30 0.30",
    "Upgrade for you: +5.5 DPS, +6 Strength, -1 Stamina 0.25 1.00 0.25",
    "5",
    "none\tfalse\tBackstage Forever: Gear hints off: upgrade lines on item tooltips and the best quest reward.",
    "Upgrade for you: +5.5 DPS, +6 Strength, -1 Stamina 0.25 1.00 0.25",
  ]);
});

test("weaker gear says not an upgrade; legacy OnTooltipSetItem hook works without TooltipDataProcessor", () => {
  const out = lua(`${GAME}
local tipLines,current,hook={},nil,nil
GameTooltip=obj('GameTooltip') GameTooltip.GetItem=function() return 'x',current end
GameTooltip.AddLine=function(_,t) tipLines[#tipLines+1]=t end
GameTooltip.HookScript=function(_,k,fn) assert(k=='OnTooltipSetItem') hook=fn end
equipped[5]='item:101'
${LOAD}
print(BackstageForeverGear.hookMode)
current='item:104' hook(GameTooltip) print(tipLines[#tipLines])
current='item:101' hook(GameTooltip) print(#tipLines)`).split("\n");
  assert.deepEqual(out, ["script", "Not an upgrade", "1"]);
});

test("/bf gear is routed by the slash handler, listed in help, saved per character and installed", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud.slice(hud.indexOf("SlashCmdList.BACKSTAGEFOREVER=")), /word=='gear'[\s\S]{0,120}BackstageForeverGearCommand/);
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf gear - /);
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverGearSettings/);
  assert.ok(toc.indexOf("BackstageForeverGear.lua") > toc.indexOf("BackstageForeverAssist.lua"));
  assert.match(read("src/core/game-sync.cjs"), /"BackstageForeverGear\.lua"/);
  const gear = read("addon/BackstageForever/BackstageForeverGear.lua");
  for (const banned of ["GetQuestReward(", ":Click(", "EquipItemByName", "PickupInventoryItem", "UseContainerItem", "SelectQuestReward"]) assert.equal(gear.includes(banned), false, banned);
});

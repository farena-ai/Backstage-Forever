"use strict";
// Roadmap C3 (stat weights you can edit) and C2 (gear plan per slot, pinned targets).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { WEIGHTS, weightsFor, scoreItem, compare } = require("../src/core/gear-score.cjs");
const SW = require("../src/core/stat-weights.cjs");
const { gearPlan, sourceIndex, fitsSlot, GearPins, PLAN_SLOTS } = require("../src/core/gear-plan.cjs");
const { upgradeVerdict, equipmentContext, upgradeIds, itemCard } = require("../src/core/boss-loot.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const { registerGearPlanning } = require("../src/core/gear-planning-ipc.cjs");
const { WishList } = require("../src/core/wishlist.cjs");

const BUILD = "1.60.1.70888";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-gear-planning-"));
const armor = (id, name, inventoryType, subclassId, stats, extra = {}) => ({
  id, name, quality: 2, itemLevel: 22, requiredLevel: 18, classId: 4, subclassId, inventoryType, slot: null, kind: "Cloth", armor: 20,
  stats: Object.entries(stats).map(([stat, amount]) => ({ stat, amount })), damage: null, speed: null, dps: null, sellPrice: 100, bonding: null, classes: null, iconFileId: 5, ...extra,
});
const ITEMS = {
  100: armor(100, "Worn Robe", 20, 1, { Intellect: 2 }),
  101: armor(101, "Old Ring", 11, 0, { Stamina: 1 }, { armor: 0 }),
  102: armor(102, "Fine Ring", 11, 0, { Stamina: 5 }, { armor: 0 }),
  200: armor(200, "Robe of Spirit", 20, 1, { Spirit: 8 }),
  201: armor(201, "Robe of Wit", 20, 1, { Intellect: 7 }),
  202: armor(202, "Robe of the Bear", 20, 1, { Stamina: 9 }),
  203: armor(203, "Robe of Later", 20, 1, { Intellect: 12 }, { requiredLevel: 22 }),
  204: armor(204, "Robe of Far Later", 20, 1, { Intellect: 30 }, { requiredLevel: 30 }),
  205: armor(205, "Plate of No Use", 5, 4, { Strength: 30 }),
  206: armor(206, "Weak Robe", 20, 1, { Intellect: 1 }),
  207: armor(207, "Ring of Wit", 11, 0, { Intellect: 6 }, { armor: 0 }),
  208: armor(208, "Sewn Robe", 20, 1, { Intellect: 9 }),
  209: armor(209, "Alliance Robe", 20, 1, { Intellect: 40 }),
  300: { id: 300, name: "Great Staff", quality: 2, itemLevel: 22, requiredLevel: 18, classId: 2, subclassId: 10, inventoryType: 17, slot: "Two-Hand", kind: "Staff", armor: 0, stats: [{ stat: "Intellect", amount: 9 }], damage: { min: 20, max: 30 }, speed: 3, dps: 8.3, classes: null },
};
const gameItems = (ids) => ids.map((id) => ITEMS[id] || null);
const priest = (extra = {}) => ({ id: "p1", name: "Vael", realm: "Thunder Hold", className: "Priest", level: 20, faction: "Horde", race: "Undead", clientBuild: BUILD,
  source: { kind: "wow-addon", id: "s1", updatedAt: "2026-11-20T10:00:00.000Z" },
  readiness: { equipment: [{ slot: 5, itemId: 100, name: "Worn Robe" }, { slot: 11, itemId: 101, name: "Old Ring" }, { slot: 12, itemId: 102, name: "Fine Ring" }] },
  history: { completedIdsKnown: true, completedIds: [9], recent: [] }, quests: [], ...extra });
const questPack = () => ({ build: BUILD,
  npcs: { "npc:1": { id: 1, kind: "npc", name: "Apothecary Zinge", positions: [{ mapId: 1420, x: 0.5, y: 0.5 }], side: "Horde" }, "npc:2": { id: 2, kind: "npc", name: "Marshal Dughan", positions: [{ mapId: 1429, x: 0.5, y: 0.5 }], side: "Alliance" } },
  quests: {
    1: { id: 1, title: "A Fine Robe", level: 20, minLevel: 15, givers: [{ id: 1, kind: "npc" }], rewards: { items: [], choices: [{ itemId: 200 }, { itemId: 201 }] } },
    2: { id: 2, title: "Too Far Ahead", level: 40, minLevel: 35, givers: [], rewards: { items: [{ itemId: 201 }], choices: [] } },
    3: { id: 3, title: "For the Alliance", level: 20, minLevel: 15, givers: [{ id: 2, kind: "npc" }], rewards: { items: [{ itemId: 209 }], choices: [] } },
    9: { id: 9, title: "Already Done", level: 20, minLevel: 15, givers: [], rewards: { items: [{ itemId: 204 }, { itemId: 206 }], choices: [] } },
    4: { id: 4, title: "Rings and Things", level: 21, minLevel: 16, givers: [], rewards: { items: [{ itemId: 207 }, { itemId: 205 }, { itemId: 206 }, { itemId: 204 }], choices: [] } },
  } });
const vendorPack = () => ({ vendors: [
  { id: 50, name: "Tailor Hesk", lastSeen: "2026-11-19", positions: [{ mapId: 1411, x: 0.4, y: 0.4 }], observedReactionsByFaction: { Horde: [5] }, listings: [{ key: "item:202", itemId: 202, name: "Robe of the Bear", sources: 2 }] },
  { id: 51, name: "Alliance Only", lastSeen: "2026-11-19", positions: [{ mapId: 1429, x: 0.4, y: 0.4 }], observedReactionsByFaction: { Alliance: [5] }, listings: [{ key: "item:209", itemId: 209, name: "Alliance Robe", sources: 2 }] },
] });
const bossPack = () => ({ instances: { wc: { bosses: [{ name: "Lord Cobrahn", npcIds: [3669], items: [{ itemId: 203, chance: 0.4, drops: 4 }] }] }, naxx: { bosses: [{ name: "Patchwerk", npcIds: [1], items: [{ itemId: 209, chance: 1, drops: 1 }] }] } } });
const packs = () => ({ items: gameItems, installedBuild: BUILD, questPack: questPack(), vendorPack: vendorPack(), bossLootPack: bossPack(), lootPack: { items: { 300: [{ kind: "npc", id: 7, name: "Bog Lurker", chance: 0.02, drops: 3 }] } } });
const slot = (plan, n) => plan.slots.find((s) => s.slot === n);

test("the default preset is the built-in row, and an untouched character scores exactly as before", () => {
  for (const cls of Object.keys(WEIGHTS)) {
    assert.equal(SW.scoringWeights(cls, null), null, cls);
    assert.equal(SW.scoringWeights(cls, { preset: "leveling", custom: {} }), null);
    const view = SW.weightsView(cls, null);
    assert.equal(view.preset, "leveling"); assert.equal(view.isDefault, true); assert.equal(view.changed, 0);
    for (const s of view.stats) assert.equal(s.value, Math.round((weightsFor({ className: cls })[s.key] ?? 0.1) * 1000) / 1000, `${cls} ${s.key}`);
  }
  assert.deepEqual(weightsFor({ className: "Mage", weights: null }), weightsFor({ className: "Mage" }));
});

test("presets follow class and role; a class is never offered a role it cannot fill", () => {
  assert.deepEqual(SW.rolesFor("Mage"), ["leveling", "caster"]);
  assert.deepEqual(SW.rolesFor("Warrior"), ["leveling", "tank"]);
  assert.deepEqual(SW.rolesFor("Druid"), ["leveling", "tank", "healer", "caster"]);
  assert.deepEqual(SW.rolesFor("Rogue"), ["leveling"]);
  assert.deepEqual(SW.rolesFor(undefined), ["leveling"]);
  assert.equal(SW.normalizeChoice({ preset: "tank" }, "Mage").preset, "leveling", "an impossible role falls back");
  const tank = SW.scoringWeights("Warrior", { preset: "tank" });
  assert.equal(tank.Stamina, 1); assert.equal(tank.armor, 0.05); assert.equal(tank.meleeDps, WEIGHTS.Warrior.meleeDps, "the class row stays under the role");
  assert.equal(SW.presetWeights("Priest", "healer").Healing, 1);
});

test("changed weights are bounded, snapped to the step and dropped when equal to the preset", () => {
  const c = SW.normalizeChoice({ preset: "leveling", custom: { Spirit: 2.523, Stamina: 0.5, armor: 9, Bogus: 1, Intellect: "2", Agility: -4, Strength: NaN } }, "Priest");
  assert.deepEqual(c, { preset: "leveling", custom: { Spirit: 2.5, armor: 0.2, Agility: 0 } });
  const w = SW.scoringWeights("Priest", c);
  assert.equal(w.Spirit, 2.5); assert.equal(w.Intellect, WEIGHTS.Priest.Intellect); assert.equal(w.armor, 0.2);
  const view = SW.weightsView("Priest", c);
  assert.equal(view.changed, 3); assert.equal(view.isDefault, false);
  assert.deepEqual(view.stats.find((s) => s.key === "Spirit"), { key: "Spirit", label: "Spirit", max: 3, step: 0.05, preset: 1, value: 2.5, changed: true });
});

test("every verdict follows the chosen weights: score, comparison, loot verdict, item card and hand-off list", () => {
  const spirit = ITEMS[200], wit = ITEMS[201];
  const base = { className: "Mage", level: 20 }, mine = { ...base, weights: SW.scoringWeights("Mage", { custom: { Spirit: 3, Intellect: 0 } }) };
  assert.ok(scoreItem(wit, base).score > scoreItem(spirit, base).score);
  assert.ok(scoreItem(spirit, mine).score > scoreItem(wit, mine).score);
  assert.equal(compare(spirit, [wit], base).better, false);
  assert.equal(compare(spirit, [wit], mine).better, true);
  const mage = { ...priest(), className: "Mage", readiness: { equipment: [{ slot: 5, itemId: 201, name: "Robe of Wit" }] } };
  const gameData = { build: () => BUILD, items: gameItems, cached: () => true };
  assert.equal(upgradeVerdict(spirit, equipmentContext(mage, gameData)).verdict, "not-upgrade");
  assert.equal(upgradeVerdict(spirit, equipmentContext(mage, gameData, mine.weights)).verdict, "upgrade");
  const pack = { instances: { wc: { bosses: [{ name: "Boss", npcIds: [1], items: [{ itemId: 200, chance: 1, drops: 1 }] }] } } };
  assert.deepEqual(upgradeIds(pack, { profile: mage, gameData }), []);
  assert.deepEqual(upgradeIds(pack, { profile: mage, gameData, weights: mine.weights }), [200]);
  assert.equal(itemCard(pack, 200, { profile: mage, gameData, weights: mine.weights }).verdict.verdict, "upgrade");
  const text = handoff.compile({ profiles: [mage], upgrades: () => upgradeIds(pack, { profile: mage, gameData, weights: mine.weights }) });
  assert.match(text, /\["Vael-Thunder Hold"\]=\{wish=\{\},up=\{200\}\},/);
});

test("saved weights survive a restart, reset removes them, and a damaged file is ignored", () => {
  const dir = tmp(), store = new SW.StatWeights(dir);
  assert.equal(store.get("p1"), null);
  store.set("p1", "Priest", { preset: "healer", custom: { Spirit: 2 } });
  assert.deepEqual(new SW.StatWeights(dir).get("p1"), { preset: "healer", custom: { Spirit: 2 } });
  store.set("p1", "Priest", null);
  assert.equal(new SW.StatWeights(dir).get("p1"), null, "reset to default stores nothing");
  assert.throws(() => store.set("", "Priest", null), /Choose a character/);
  fs.writeFileSync(path.join(dir, "stat-weights.json"), "{broken");
  assert.equal(new SW.StatWeights(dir).get("p1"), null);
  fs.writeFileSync(path.join(dir, "stat-weights.json"), JSON.stringify({ schemaVersion: 1, profiles: { p1: { preset: "wizard", custom: { Spirit: 99, Evil: 1 } } } }));
  assert.deepEqual(new SW.StatWeights(dir).get("p1"), { preset: "leveling", custom: { Spirit: 3 } });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the plan lists up to three reachable upgrades per slot, best first, each with its source", () => {
  const plan = gearPlan(priest(), packs());
  assert.equal(plan.status, "available");
  assert.deepEqual(plan.slots.map((s) => s.slot), PLAN_SLOTS);
  const chest = slot(plan, 5);
  assert.equal(chest.worn.name, "Worn Robe");
  assert.deepEqual(chest.upgrades.map((u) => u.itemId), [203, 200, 201], "ranked by gain; never more than three");
  assert.ok(chest.upgrades[0].delta > chest.upgrades[1].delta && chest.upgrades[1].delta > chest.upgrades[2].delta);
  const later = chest.upgrades[0];
  assert.equal(later.later, true, "usable within a few levels is marked, not hidden");
  assert.deepEqual(later.sources[0], { kind: "dungeon", instanceId: "wc", instance: "Wailing Caverns", boss: "Lord Cobrahn", chance: 0.4, drops: 4, levels: [17, 24] });
  const quest = chest.upgrades[1].sources[0];
  assert.equal(quest.kind, "quest"); assert.equal(quest.title, "A Fine Robe"); assert.equal(quest.choice, true);
  assert.deepEqual(quest.giver, { name: "Apothecary Zinge", zone: "Tirisfal Glades", side: "Horde" });
  const ids = plan.slots.flatMap((s) => s.upgrades.map((u) => u.itemId));
  for (const hidden of [204, 205, 206, 209]) assert.ok(!ids.includes(hidden), `item ${hidden} is out of reach, unusable or no gain`);
});

test("sources are filtered to what this character can reach", () => {
  const { sources, counts } = sourceIndex(priest(), packs());
  assert.equal(sources.has(209), false, "other side's quest giver, other side's vendor and a raid far above the level");
  assert.deepEqual(sources.get(201).map((s) => s.title), ["A Fine Robe"], "a quest far above the character is left out");
  assert.equal(sources.get(204).some((s) => s.title === "Already Done"), false, "finished quests give nothing again");
  assert.deepEqual(sources.get(202)[0], { kind: "vendor", npcId: 50, name: "Tailor Hesk", zone: "Durotar", lastSeen: "2026-11-19", price: null });
  assert.equal(sources.get(300)[0].kind, "drop");
  assert.deepEqual(counts, { quest: 6, vendor: 1, dungeon: 1, drop: 1, craft: 0 });
  const alliance = sourceIndex({ ...priest(), faction: "Alliance", race: "Human" }, packs()).sources;
  assert.ok(alliance.has(209) && !alliance.has(202), "the same rule serves the Alliance");
});

test("vendor prices appear only when the player saw them; crafted gear only from recipes the character knows", () => {
  const craft = priest({ readiness: { ...priest().readiness, workshop: { professions: { items: [{ skillLineId: 197, name: "Tailoring", rank: 80 }] },
    recipes: { items: [{ id: 7, skillLineId: 197, name: "Sewn Robe", outputItemId: 208, reagentsKnown: true, reagents: [{ itemId: 2996, required: 2, name: "Bolt of Linen Cloth" }] }, { id: 8, skillLineId: 999, name: "No Profession", outputItemId: 201 }] } } } });
  const plan = gearPlan(craft, { ...packs(), vendorPrices: new Map([[202, { id: 202, cost: 4500, n: 1, at: 1795000000 }]]) });
  const chest = slot(plan, 5);
  const sewn = chest.upgrades.find((u) => u.itemId === 208);
  assert.deepEqual(sewn.sources[0], { kind: "craft", recipeId: 7, name: "Sewn Robe", profession: "Tailoring", reagents: [{ itemId: 2996, required: 2, name: "Bolt of Linen Cloth" }] });
  assert.equal(plan.counts.craft, 1);
  const noCraft = gearPlan(priest(), packs());
  assert.ok(noCraft.gaps.some((g) => /^Crafted gear:/.test(g)), "the missing source is said plainly");
  const bear = sourceIndex(priest(), { ...packs(), vendorPrices: new Map([[202, { id: 202, cost: 4500, n: 1, at: 1795000000 }]]) }).sources.get(202)[0];
  assert.deepEqual(bear.price, { copper: 4500, count: 1, at: 1795000000 });
});

test("each ring is compared with the ring in that slot, and a slot with nothing says so", () => {
  const plan = gearPlan(priest(), packs());
  assert.deepEqual(slot(plan, 11).upgrades.map((u) => u.itemId), [207]);
  assert.ok(slot(plan, 11).upgrades[0].delta > slot(plan, 12).upgrades[0].delta, "the weaker ring gains more");
  const head = slot(plan, 1);
  assert.equal(head.worn, null); assert.deepEqual(head.upgrades, []);
  assert.equal(head.note, "The data has no item for this slot from a source you can reach.");
  const main = slot(plan, 16);
  assert.equal(main.upgrades[0].itemId, 300); assert.equal(main.upgrades[0].twoHanded, true);
  const strong = gearPlan(priest({ readiness: { equipment: [{ slot: 5, itemId: 204 }] } }), packs());
  assert.match(slot(strong, 5).note, /^Nothing better in the data: \d+ items for this slot checked\.$/);
});

test("the plan is ranked by the chosen weights", () => {
  const plan = gearPlan(priest(), { ...packs(), weights: SW.scoringWeights("Priest", { custom: { Stamina: 3, Intellect: 0, Spirit: 0 } }) });
  assert.equal(plan.customWeights, true);
  assert.deepEqual(slot(plan, 5).upgrades.map((u) => u.itemId), [202]);
});

test("the plan refuses to guess: no gear, another patch, unknown worn items, no game data", () => {
  assert.match(gearPlan(null, packs()).reason, /Pick or create/);
  assert.match(gearPlan(priest({ readiness: {} }), packs()).reason, /No gear seen/);
  assert.match(gearPlan(priest({ className: "" }), packs()).reason, /class or level/);
  assert.equal(gearPlan(priest({ clientBuild: "1.60.2.1" }), packs()).status, "unavailable", "another patch is refused");
  assert.equal(gearPlan(priest({ clientBuild: "1.60.1.71037" }), packs()).carried, true, "another build of the same patch is used and labelled");
  assert.match(gearPlan(priest(), { ...packs(), items: (ids) => ids.map(() => null) }).reason, /Item stats are not available/);
  const unknown = gearPlan(priest({ readiness: { equipment: [{ slot: 5, itemId: 999, name: "Hotfix Robe" }, { slot: 11, itemId: 101 }] } }), packs());
  assert.equal(slot(unknown, 5).worn.known, false);
  assert.deepEqual(slot(unknown, 5).upgrades, []);
  assert.match(slot(unknown, 5).note, /not in your game data/);
  const otherPatch = gearPlan(priest(), { ...packs(), questPack: { ...questPack(), build: "1.60.2.1" } });
  assert.ok(otherPatch.gaps.some((g) => /another patch/.test(g)));
  assert.equal(slot(otherPatch, 5).upgrades.some((u) => u.sources.some((s) => s.kind === "quest")), false);
});

test("one target is pinned per slot, kept in its own file, and shown even when it is not in the top three", () => {
  const dir = tmp(), pins = new GearPins(dir);
  assert.deepEqual(pins.get("p1"), {});
  pins.set("p1", 5, 201); pins.set("p1", 5, 202); pins.set("p1", 11, 207);
  assert.deepEqual(new GearPins(dir).get("p1"), { 5: 202, 11: 207 });
  assert.deepEqual(pins.ids("p1"), [202, 207]);
  assert.throws(() => pins.set("p1", 4, 201), /Invalid gear target/, "the shirt slot has no plan");
  assert.throws(() => pins.set("p1", 5, 0), /Invalid gear target/);
  const plan = gearPlan(priest(), { ...packs(), pins: pins.get("p1") });
  assert.equal(slot(plan, 5).pinned.itemId, 202);
  assert.ok(slot(plan, 5).pinned.delta > 0);
  assert.equal(slot(plan, 5).upgrades.some((u) => u.pinned), false, "the pin is outside the top three here");
  assert.equal(slot(plan, 11).upgrades[0].pinned, true);
  assert.deepEqual(plan.pinnedIds, [202, 207]);
  pins.set("p1", 5, null); pins.set("p1", 11, null);
  assert.deepEqual(new GearPins(dir).get("p1"), {});
  assert.equal(fitsSlot(ITEMS[300], 16), true); assert.equal(fitsSlot(ITEMS[300], 17), false); assert.equal(fitsSlot(ITEMS[207], 12), true); assert.equal(fitsSlot(null, 5), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("IPC: weights and pins are saved for the active character only and reach the game hand-off", () => {
  const dir = tmp(), handlers = {}, state = { activeProfileId: "p1", profiles: [priest(), { ...priest(), id: "p2", name: "Other" }] };
  const statWeights = new SW.StatWeights(dir), gearPins = new GearPins(dir), wishlist = new WishList(dir);
  let changes = 0;
  registerGearPlanning({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state, gameData: { build: () => BUILD, items: gameItems }, statWeights, gearPins, wishlist,
    questPack: () => questPack(), vendorPack: () => vendorPack(), bossLootPack: () => bossPack(), lootPack: () => null, onChange: () => { changes++; } });
  assert.equal(handlers.statWeights("p1").isDefault, true);
  assert.throws(() => handlers.statWeights("p2"), /active character changed/);
  assert.throws(() => handlers.statWeights(), /Invalid request/);
  const saved = handlers.setStatWeights("p1", { preset: "healer", custom: { Spirit: 2 } });
  assert.equal(saved.preset, "healer"); assert.equal(saved.changed, 1); assert.equal(changes, 1);
  assert.throws(() => handlers.setStatWeights("p1", { preset: "healer", custom: { Spirit: 1e9 } }), /Invalid stat weights/);
  assert.throws(() => handlers.setStatWeights("p1", { preset: "healer", extra: 1 }));
  assert.equal(handlers.gearPlan("p1").customWeights, true);
  assert.equal(handlers.setStatWeights("p1", null).isDefault, true, "Reset to default");
  assert.equal(handlers.gearPlan("p1").customWeights, false);
  const pinned = handlers.setGearPin("p1", 5, 201);
  assert.equal(pinned.slots.find((s) => s.slot === 5).pinned.itemId, 201);
  assert.throws(() => handlers.setGearPin("p1", 1, 201), /does not go in this slot/);
  assert.throws(() => handlers.setGearPin("p1", 5, 424242), /does not go in this slot/, "an item the game data does not know cannot be pinned");
  assert.throws(() => handlers.setGearPin("p2", 5, 201), /active character changed/);
  wishlist.set("p1", 777, true);
  const text = handoff.compile({ profiles: state.profiles, wishlist: (id) => [...gearPins.ids(id), ...wishlist.get(id)] });
  assert.match(text, /\["Vael-Thunder Hold"\]=\{wish=\{201,777\}\},/, "the in-game atlas marks pinned targets like wishes");
  handlers.setGearPin("p1", 5, null);
  assert.equal(handlers.gearPlan("p1").slots.find((s) => s.slot === 5).pinned, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

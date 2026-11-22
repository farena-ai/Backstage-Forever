"use strict";
// Recipe book (E2), computed skill path (E1), who can craft it (E3), cooking from your bags (E5):
// the recipe reader over synthetic game tables, and every projection over a small synthetic game.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const db2 = require("../src/core/db2.cjs");
const { GameData, TABLES, extractRecipes } = require("../src/core/game-data.cjs");
const R = require("../src/core/recipe-book.cjs");
const { registerRecipeBook } = require("../src/core/recipe-book-ipc.cjs");

// --- Synthetic game tables (rows in the layouts game-data.cjs reads) -----------------------------
const row = (id, fields, relation) => ({ id, fields, relation });
const line = (id, name, category) => row(id, [name, "", "", "", "", id, category, 1000 + id, 1, 0, 0, 128, 0, 0, 0]);
// [raceMask, ?, id, skillLine, spell, minRank, classMask, supercedes, acquire, greyAt, yellowAt, flags, skillUps, ...]
const ability = (id, skillLine, spell, yellow, grey, { acquire = 0, minRank = 1, ups = 1 } = {}) => row(id, [0, 0, id, skillLine, spell, minRank, 0, 0, acquire, grey, yellow, 0, ups, 0, 0, 0, [0, 0], [0, 0]], skillLine);
const uses = (id, spell, list) => { const items = Array(8).fill(0), counts = Array(8).fill(0); list.forEach(([item, n], i) => { items[i] = item; counts[i] = n; }); return row(id, [spell, items, counts, Array(8).fill(0), Array(8).fill(0)]); };
const effect = (id, spell, kind, item, points = 1, difficulty = 0) => { const f = Array(29).fill(0); f[1] = difficulty; f[3] = kind; f[10] = item; f[22] = points; return row(id, f, spell); };
const itemEffect = (id, trigger, spell) => row(id, [0, trigger, 0, 0, 0, 0, spell, 0, 0]);
const sparse = (id, name, { skill = 0, rank = 0 } = {}) => { const f = Array(68).fill(0); f[4] = name; f[48] = rank; f[49] = skill; return row(id, f); };
function tables() {
  return {
    skillLine: [line(185, "Cooking", 9), line(164, "Blacksmithing", 11), line(26, "Arms", 7)],
    skillLineAbility: [
      ability(1, 185, 2538, 45, 85, { acquire: 1 }),          // Charred Wolf Meat: taught with the skill
      ability(2, 185, 2539, 50, 90),                          // Spiced Wolf Meat: trainer
      ability(3, 185, 7751, 45, 85),                          // Brilliant Smallfish: vendor recipe
      ability(4, 185, 15855, 215, 255),                       // Roast Raptor: recipe item, nobody sells it
      ability(5, 185, 2550, 0, 0),                            // the profession rank itself: no materials
      ability(6, 164, 2737, 55, 95),                          // Copper Mace
      ability(7, 164, 2737, 55, 95),                          // the same recipe listed twice (a race copy)
      ability(8, 26, 100, 0, 0),                              // a class skill, not a profession
      ability(9, 185, 9999, 10, 20),                          // makes an item the game does not have
      ability(10, 164, 3923, 60, 100),                        // Rough Copper Bomb: makes two
    ],
    spellReagents: [uses(1, 2538, [[2672, 1]]), uses(2, 2539, [[2672, 1], [2678, 1]]), uses(3, 7751, [[6291, 1]]), uses(4, 15855, [[12184, 1], [2692, 1]]),
      uses(5, 2737, [[2840, 6], [2880, 1]]), uses(6, 100, [[1, 1]]), uses(7, 9999, [[2672, 1]]), uses(8, 3923, [[2840, 1], [4357, 2]])],
    spellEffect: [effect(1, 2538, 24, 2679), effect(2, 2539, 24, 2680), effect(3, 7751, 24, 6290), effect(4, 15855, 24, 12210), effect(5, 2737, 24, 2844),
      effect(6, 2737, 24, 1, 1, 1), effect(7, 9999, 24, 77777), effect(8, 3923, 24, 4360, 2), effect(9, 2538, 6, 0)],
    itemEffect: [itemEffect(900, 6, 7751), itemEffect(901, 6, 15855), itemEffect(902, 0, 7751), itemEffect(903, 6, 424242)],
    itemXItemEffect: [row(1, [900], 6325), row(2, [901], 12228), row(3, [902], 6290), row(4, [903], 5000), row(5, [901], 88888)],
    itemSparse: [sparse(6325, "Recipe: Brilliant Smallfish", { skill: 185, rank: 1 }), sparse(12228, "Recipe: Roast Raptor", { skill: 185, rank: 175 })],
  };
}
function fakeStorage(source, layouts = {}) {
  const byFdid = Object.fromEntries(Object.entries(TABLES).map(([n, t]) => [t.fdid, n]));
  const original = db2.readDb2;
  db2.readDb2 = (buf) => { const name = byFdid[buf.fdid]; if (!source[name]) throw Error("missing"); return { header: { layoutHash: layouts[name] ?? TABLES[name].layout }, rows: source[name] }; };
  return { storage: { readFileId: (fdid) => ({ fdid }), close() {} }, restore: () => { db2.readDb2 = original; } };
}

test("recipe reader: profession recipes with colours, materials, what they make and the item that teaches them", (t) => {
  const f = fakeStorage(tables()); t.after(f.restore);
  const { recipes, notes } = extractRecipes(f.storage);
  assert.deepEqual(notes, []);
  assert.deepEqual(recipes.lines, { 164: ["Blacksmithing", 11, 1164], 185: ["Cooking", 9, 1185] }, "class skills are not professions");
  // [spell, line, yellow, grey, taughtWithSkillAt, skillUps, madeItem, madeCount, materials]
  assert.deepEqual(recipes.rows, [
    [2737, 164, 55, 95, 0, 1, 2844, 1, [2840, 6, 2880, 1]],
    [3923, 164, 60, 100, 0, 1, 4360, 2, [2840, 1, 4357, 2]],
    [9999, 185, 10, 20, 0, 1, 77777, 1, [2672, 1]],
    [2538, 185, 45, 85, 1, 1, 2679, 1, [2672, 1]],
    [7751, 185, 45, 85, 0, 1, 6290, 1, [6291, 1]],
    [2539, 185, 50, 90, 0, 1, 2680, 1, [2672, 1, 2678, 1]],
    [15855, 185, 215, 255, 0, 1, 12210, 1, [12184, 1, 2692, 1]],
  ], "no rank spells, no duplicates, sorted by profession then yellow");
  assert.deepEqual(recipes.teach, { 7751: [6325, 1], 15855: [12228, 175] }, "only learn effects of items the game has");
});

test("recipe reader: a different layout is refused; missing recipe item tables only drop that part", (t) => {
  const moved = fakeStorage(tables(), { skillLineAbility: 0x1 });
  assert.throws(() => extractRecipes(moved.storage), (e) => e.code === "LAYOUT");
  moved.restore();
  const partial = tables(); delete partial.itemEffect;
  const f = fakeStorage(partial); t.after(f.restore);
  const { recipes, notes } = extractRecipes(f.storage);
  assert.equal(recipes.rows.length, 7);
  assert.deepEqual(recipes.teach, {});
  assert.deepEqual(notes, ["itemEffect: unreadable"]);
});

test("GameData.recipes(): read once per build, cached on disk, null when the game cannot be read", (t) => {
  const f = fakeStorage({ ...tables(), spellName: [row(2538, ["Charred Wolf Meat"])] }); t.after(f.restore);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-rb-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "_forever_"));
  fs.writeFileSync(path.join(root, ".build.info"), "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\nus|1|1.60.1.70938|wowf\n");
  let opened = 0;
  const make = () => new GameData({ getRoot: () => path.join(root, "_forever_"), cacheDir: path.join(root, "cache"), idleMs: 5, open: () => { opened++; return f.storage; } });
  const g = make();
  assert.equal(g.recipes().rows.length, 7);
  assert.equal(g.recipes().rows.length, 7);
  assert.equal(opened, 1);
  assert.ok(fs.existsSync(path.join(root, "cache", "1.60.1.70938", "recipes.json")));
  assert.equal(make().recipes().teach[7751][0], 6325, "a new session reads the cached file");
  assert.equal(opened, 1);
  assert.deepEqual(g.spells([2538, 5, -1]).map((s) => s?.name || null), ["Charred Wolf Meat", null, null]);
  g.release();
  assert.equal(new GameData({ getRoot: () => null, cacheDir: path.join(root, "none") }).recipes(), null);
});

// --- A small game for the projections -------------------------------------------------------------
const ITEMS = { 2679: "Charred Wolf Meat", 2680: "Spiced Wolf Meat", 6290: "Brilliant Smallfish", 12210: "Roast Raptor", 2844: "Copper Mace", 4360: "Rough Copper Bomb",
  2672: "Stringy Wolf Meat", 2678: "Mild Spices", 6291: "Raw Brilliant Smallfish", 12184: "Raptor Flesh", 2692: "Hot Spices", 2840: "Copper Bar", 2880: "Weak Flux", 4357: "Rough Blasting Powder",
  6325: "Recipe: Brilliant Smallfish", 12228: "Recipe: Roast Raptor" };
const SPELLS = { 2538: "Charred Wolf Meat", 2539: "Spiced Wolf Meat", 7751: "Brilliant Smallfish", 15855: "Roast Raptor", 2737: "Copper Mace", 3923: "Rough Copper Bomb", 9999: "Leftover Stew" };
function game() {
  const f = fakeStorage(tables());
  const recipes = extractRecipes(f.storage).recipes;
  f.restore();
  return { recipes, spells: (ids) => ids.map((id) => (SPELLS[id] ? { id, name: SPELLS[id], iconFileId: 5000 + id } : null)), items: (ids) => ids.map((id) => (ITEMS[id] ? { id, name: ITEMS[id], quality: 1, iconFileId: 9000 + id } : null)) };
}
const BUILD = "1.60.1.71037";
const packs = (build = BUILD) => ({
  trainerPack: { build, professions: { Cooking: [{ id: 2539, name: "Spiced Wolf Meat", level: 0, cost: 50, honored: 45, skill: 10, step: false }], Blacksmithing: [{ id: 2737, name: "Copper Mace", level: 0, cost: null, honored: 90, skill: 15, step: false }, { id: 3923, name: "Rough Copper Bomb", level: 0, cost: null, honored: null, skill: 0, step: false }] } },
  vendorPack: { build, vendors: [{ id: 66, name: "Tharynn Bouden", positions: [{ mapId: 1429, x: 0.4, y: 0.6 }], observedReactionsByFaction: { Alliance: [5] }, listings: [{ itemId: 6325, name: "Recipe: Brilliant Smallfish" }, { itemId: 2678, name: "Mild Spices" }] },
    { id: 67, name: "Kiro", positions: [{ mapId: 1454, x: 0.4, y: 0.6 }], observedReactionsByFaction: { Horde: [5], Alliance: [2] }, listings: [{ itemId: 6325, name: "Recipe: Brilliant Smallfish" }] }] },
  lootPack: { builds: [build], items: { 12228: [{ kind: "npc", id: 1, name: "Stranglethorn Raptor", chance: 0.02, drops: 3 }, { kind: "npc", id: 2, name: null, chance: 0.5, drops: 1 }] } },
  bossLootPack: { builds: [build], instances: { rfc: { bosses: [{ name: "Oggleflint", npcIds: [1], items: [{ itemId: 12228, chance: 0.1, drops: 2 }] }] } } },
  questPack: { build, quests: { 7: { id: 7, title: "Dinner for Two", sides: ["Horde"], rewards: { items: [{ itemId: 6325 }], choices: [], spells: [{ spellId: 2538 }] } } } },
  instanceNames: { rfc: "Ragefire Chasm" },
});
const index = (build = BUILD, packBuild = BUILD) => R.sourceIndex({ ...packs(packBuild), build });
const cook = (extra = {}) => ({
  id: "brakka", name: "Brakka", realm: "Test", faction: "Horde", className: "Warrior", level: 20,
  readiness: { workshop: { professions: { items: [{ skillLineId: 185, professionId: 1, name: "Cooking", rank: 60, maxRank: 75 }, { skillLineId: 356, professionId: 2, name: "Fishing", rank: 30, maxRank: 75 }] },
    recipes: { complete: true, items: [{ id: 2538, skillLineId: 185, name: "Charred Wolf Meat", reagentsKnown: true, reagents: [{ itemId: 2672, required: 1, name: "Stringy Wolf Meat" }], outputItemId: 2679 }] } } },
  ...extra,
});

test("colours: orange until yellow, green halfway to grey, and a falling skill-up chance", () => {
  const t = R.thresholds(45, 85, 1);
  assert.deepEqual(t, { orange: 1, yellow: 45, green: 65, grey: 85 });
  assert.equal(R.thresholds(45, 85).orange, null, "the skill to learn it is never invented");
  assert.deepEqual([1, 44, 45, 64, 65, 84, 85, 300].map((s) => R.colourAt(t, s)), ["orange", "orange", "yellow", "yellow", "green", "green", "grey", "grey"]);
  assert.equal(R.colourAt(t, null), null);
  assert.deepEqual([10, 45, 65, 85].map((s) => R.skillUpChance(t, s)), [1, 1, 0.5, 0]);
  assert.equal(R.skillUpChance(R.thresholds(20, 20), 20), 0);
});

test("sources: joined from the packs; another patch is refused, another build of the patch is marked", () => {
  const ix = index();
  assert.equal(ix.carried, false);
  assert.deepEqual(ix.trainer.get(2539), { profession: "Cooking", skill: 10, copper: 50, estimated: false, level: null });
  assert.deepEqual(ix.trainer.get(2737), { profession: "Blacksmithing", skill: 15, copper: 100, estimated: true, level: null }, "full price worked out from the Honored price");
  assert.equal(ix.trainer.get(3923).skill, null);
  assert.deepEqual(ix.vendors.get(6325).map((v) => [v.name, v.zone, v.sides]), [["Tharynn Bouden", "Elwynn Forest", ["Alliance"]], ["Kiro", "Orgrimmar", ["Horde"]]]);
  assert.ok(ix.vendorListed.has(2678));
  assert.deepEqual(ix.drops.get(12228).map((d) => [d.kind, d.name]), [["drop", "Stranglethorn Raptor"], ["dungeon", "Oggleflint"]], "a drop without a name is left out");
  assert.equal(ix.drops.get(12228)[1].instance, "Ragefire Chasm");
  assert.equal(ix.questItems.get(6325)[0].title, "Dinner for Two");
  assert.equal(ix.questSpells.get(2538)[0].questId, 7);
  assert.equal(index("1.60.1.99999").carried, true, "same patch, other build: used and labelled");
  const other = index("1.60.2.1");
  assert.deepEqual([other.trainer.size, other.vendors.size, other.drops.size, other.questItems.size], [0, 0, 0, 0], "another patch is refused");
});

test("recipe book: known, learnable now, skill needed and every recorded source", () => {
  const vendorSeen = new Map([[6325, { unit: 40, at: 1000 }]]);
  const book = R.recipeBook(cook(), game(), index(), { skillLineId: 185, vendorSeen });
  assert.equal(book.status, "available");
  assert.deepEqual(book.choices.map((c) => [c.name, c.yours]), [["Cooking", true]], "other professions need at least ten recipes to be listed");
  assert.deepEqual(book.recipes.map((r) => r.name), ["Brilliant Smallfish", "Charred Wolf Meat", "Spiced Wolf Meat", "Roast Raptor"]);
  assert.deepEqual(book.counts, { total: 4, known: 1, missing: 3, learnable: 2, trainer: 1, vendor: 1, drop: 1, quest: 2, auto: 1, none: 0 });
  assert.ok(book.notes.some((n) => /1 entry in the game files left out/.test(n)), "a recipe for an item the game lacks is a leftover");
  const [fish, wolf, spiced, raptor] = book.recipes;
  assert.equal(wolf.known, true); assert.equal(wolf.colour, "yellow"); assert.equal(wolf.learnable, false);
  assert.deepEqual(wolf.sourceKinds, ["auto", "quest"]);
  assert.deepEqual([spiced.orange, spiced.yellow, spiced.green, spiced.grey], [10, 50, 70, 90]);
  assert.deepEqual(spiced.sources, [{ kind: "trainer", skill: 10, copper: 50, estimated: false, level: null }]);
  assert.equal(spiced.learnable, true);
  assert.deepEqual(fish.sources.map((s) => [s.kind, s.name || s.title, s.otherSide]), [["vendor", "Kiro", false], ["vendor", "Tharynn Bouden", true], ["quest", "Dinner for Two", false]], "your own faction's vendor first");
  assert.deepEqual(fish.sources[0].price, { copper: 40, at: 1000 }, "a vendor price is only what you saw yourself");
  assert.equal(fish.orange, 1, "the recipe item says the skill it needs");
  assert.equal(raptor.learnable, false); assert.equal(raptor.orange, 175);
  assert.deepEqual(raptor.sources.map((s) => s.kind), ["dungeon", "drop"]);
  assert.deepEqual(raptor.materials.map((m) => [m.name, m.count, m.unit]), [["Raptor Flesh", 1, null], ["Hot Spices", 1, null]]);
  assert.equal(raptor.cost, null);
});

test("recipe book: honest when nothing is recorded, when the save is partial and without game files", () => {
  const g = game(), bare = R.sourceIndex({});
  const book = R.recipeBook(cook(), g, bare, { skillLineId: 185 });
  const raptor = book.recipes.find((r) => r.name === "Roast Raptor"), spiced = book.recipes.find((r) => r.name === "Spiced Wolf Meat");
  assert.deepEqual(raptor.sources, []); assert.equal(raptor.orange, 175, "the recipe item still tells the skill");
  assert.equal(raptor.recipeItems[0].name, "Recipe: Roast Raptor");
  assert.deepEqual([spiced.sources, spiced.orange, spiced.learnable], [[], null, false], "no source recorded: not called learnable");
  assert.equal(book.counts.none, 3);
  const partial = cook(); partial.readiness.workshop.recipes.complete = false;
  assert.ok(R.recipeBook(partial, g, bare, {}).notes.some((n) => /at most 100 recipes/.test(n)));
  const none = cook(); delete none.readiness.workshop.recipes;
  assert.ok(R.recipeBook(none, g, bare, {}).notes.some((n) => /No recipes are saved/.test(n)));
  assert.equal(R.recipeBook(cook(), null, null).status, "no-game-data");
  const smith = R.recipeBook({ id: "x", readiness: { workshop: { professions: { items: [{ skillLineId: 999, professionId: 9, name: "blacksmithing", rank: 20, maxRank: 75 }] } } } }, g, index(), {});
  assert.equal(smith.profession.skillLineId, 164, "a saved profession is matched by name when its id is unknown");
  assert.equal(smith.recipes.find((r) => r.name === "Rough Copper Bomb").made.count, 2);
  assert.equal(smith.recipes.find((r) => r.name === "Rough Copper Bomb").orange, null, "a trainer row without a skill does not invent one");
});

// A hand-made profession to check the path arithmetic.
const mat = (itemId, count, unit) => ({ itemId, name: `Item ${itemId}`, count, unit });
const rec = (id, name, orange, yellow, grey, materials, extra = {}) => ({ id, name, iconFileId: null, known: false, orange, yellow, green: Math.floor((yellow + grey) / 2), grey, materials,
  cost: materials.every((m) => m.unit !== null) ? materials.reduce((n, m) => n + m.unit * m.count, 0) : null, sourceKinds: ["trainer"], ...extra });

test("skill path: the cheapest orange or yellow recipe per range, with crafts, materials and total", () => {
  const recipes = [rec(1, "Cheap", 1, 30, 50, [mat(10, 2, 5)]), rec(2, "Dear", 1, 60, 80, [mat(11, 1, 100)]), rec(3, "Later", 25, 60, 90, [mat(12, 1, 20)])];
  const path = R.levelingPath(recipes, { rank: 27, from: 1, to: 60 });
  assert.deepEqual(path.ranges.map((r) => [r.from, r.to, r.kind, r.recipe?.name || null]), [[1, 40, "priced", "Cheap"], [40, 60, "priced", "Later"]]);
  const [first, second] = path.ranges;
  // 29 sure points while orange (1..29), then yellow points 30..39 at a chance of (50-s)/20. Green is never planned.
  const crafts = Math.ceil(29 + [30, 31, 32, 33, 34, 35, 36, 37, 38, 39].reduce((n, s) => n + 20 / (50 - s), 0));
  assert.equal(first.crafts, crafts);
  assert.equal(first.cost, crafts * 10);
  assert.deepEqual(first.materials, [{ itemId: 10, name: "Item 10", count: 2 * crafts }]);
  assert.deepEqual(first.others.map((o) => o.name), ["Dear"], "the next cheapest at the start of the range");
  assert.deepEqual([first.current, first.done, second.current, second.done], [true, false, false, false]);
  assert.equal(second.crafts, 20); assert.equal(second.cost, 400);
  assert.deepEqual([path.total, path.covered, path.points], [crafts * 10 + 400, 59, 59]);
  // A yellow recipe loses to a sure point once its expected cost per point is higher.
  const steep = R.levelingPath([rec(1, "Fading", 1, 10, 30, [mat(10, 1, 10)]), rec(2, "Sure", 1, 60, 80, [mat(11, 1, 15)])], { from: 1, to: 20 });
  assert.deepEqual(steep.ranges.map((r) => [r.from, r.to, r.recipe.name]), [[1, 17, "Fading"], [17, 20, "Sure"]], "10 / chance passes 15 at skill 17");
});

test("skill path: a price never seen stays unknown and is never the cheapest", () => {
  const recipes = [rec(1, "Unseen", 1, 40, 60, [mat(10, 1, null)]), rec(2, "Seen", 20, 40, 60, [mat(11, 1, 500)])];
  const path = R.levelingPath(recipes, { from: 1, to: 40 });
  assert.deepEqual(path.ranges.map((r) => [r.from, r.to, r.kind]), [[1, 20, "unpriced"], [20, 40, "priced"]]);
  assert.deepEqual(path.ranges[0].options.map((o) => [o.name, o.cost]), [["Unseen", null]]);
  assert.equal(path.ranges[0].cost, undefined);
  assert.equal(path.ranges[1].recipe.name, "Seen");
  assert.equal(path.ranges[1].unpricedCount, 1, "says another recipe without a price could be cheaper");
  assert.deepEqual([path.total, path.covered], [20 * 500, 20]);
  assert.equal(R.levelingPath([recipes[0]], { from: 1, to: 10 }).total, null);
});

test("skill path: gaps, recipes without a recorded skill, luck-only sources and recipes you know", () => {
  const drop = rec(3, "Dropped", 10, 30, 40, [mat(10, 1, 7)], { sourceKinds: ["drop"] });
  const noSkill = rec(4, "Mystery", null, 30, 40, [mat(10, 1, 1)]);
  const trainer = rec(5, "Trained", 20, 30, 40, [mat(10, 1, 9)]);
  const path = R.levelingPath([drop, noSkill, trainer], { from: 1, to: 30 });
  assert.deepEqual(path.ranges.map((r) => [r.from, r.to, r.kind, r.uncertain, r.recipe?.name || null]), [[1, 10, "gap", false, null], [10, 20, "priced", true, "Dropped"], [20, 30, "priced", false, "Trained"]]);
  assert.deepEqual(path.leftOut, { noSkill: 1, otherSource: 1 });
  // A recipe the character knows is usable from the character's skill on, even with no recorded skill.
  const known = R.levelingPath([{ ...noSkill, known: true }], { rank: 15, from: 1, to: 30 });
  assert.deepEqual(known.ranges.map((r) => [r.from, r.to, r.kind, r.done]), [[1, 15, "gap", true], [15, 30, "priced", false]]);
  assert.equal(known.ranges[1].recipe.known, true);
});

test("skill path from the recipe book uses only prices the player saw", () => {
  const prices = new Map([[2672, { latest: 30, latestAt: 5 }], [2678, { latest: 90, latestAt: 5 }]]), vendorSeen = new Map([[2678, { unit: 10, at: 9 }]]);
  const book = R.recipeBook(cook(), game(), index(), { skillLineId: 185, prices, vendorSeen });
  const spiced = book.recipes.find((r) => r.name === "Spiced Wolf Meat");
  assert.deepEqual(spiced.materials.map((m) => [m.unit, m.priceSource]), [[30, "auction"], [10, "vendor"]], "the cheaper of auction memory and a vendor window");
  assert.equal(spiced.cost, 40);
  assert.equal(book.recipes.find((r) => r.name === "Brilliant Smallfish").cost, null);
  const path = R.levelingPath(book.recipes, { rank: book.rank });
  assert.equal(path.ranges[0].recipe.name, "Charred Wolf Meat");
  assert.equal(path.ranges[0].recipe.cost, 30);
  assert.equal(path.ranges.at(-1).kind, "gap", "nothing recorded gives skill up to 300 in this small game");
  assert.deepEqual(R.unitPrice(1, prices, vendorSeen), null);
});

test("who can craft it: makers first, then the closest in skill, across every saved character", () => {
  const smith = (id, rank, recipes = []) => ({ id, name: id, faction: "Alliance", readiness: { workshop: { professions: { items: [{ skillLineId: 164, professionId: 1, name: "Blacksmithing", rank, maxRank: 75 }] }, recipes: { complete: true, items: recipes } } } });
  const roster = [smith("Low", 5), smith("Maker", 70, [{ id: 2737, skillLineId: 164, name: "Copper Mace", reagentsKnown: false, reagents: [] }]), smith("Close", 12), smith("Ready", 40), cook()];
  const found = R.whoCanCraft(roster, game(), index(), "copper mace");
  assert.equal(found.status, "available"); assert.equal(found.gameData, true);
  assert.equal(found.results.length, 1);
  const r = found.results[0];
  assert.deepEqual([r.name, r.profession, r.orange, r.yellow, r.grey, r.itemId], ["Copper Mace", "Blacksmithing", 15, 55, 95, 2844]);
  assert.deepEqual(r.makers.map((m) => [m.name, m.knows, m.gap, m.rank]), [["Maker", true, 0, 70], ["Ready", false, 0, 40], ["Close", false, 3, 12], ["Low", false, 10, 5]]);
  assert.equal(r.makers[0].colour, "yellow");
  assert.deepEqual(R.whoCanCraft(roster, game(), index(), "copper").results.map((x) => x.name), ["Copper Mace", "Rough Copper Bomb"]);
  assert.equal(R.whoCanCraft(roster, game(), index(), "copper").results[1].makers[0].gap, null, "skill needed not recorded");
  assert.equal(R.whoCanCraft(roster, game(), index(), "raptor").results[0].makers[0].name, "Brakka");
  assert.equal(R.whoCanCraft(roster, game(), index(), "x").status, "empty");
  assert.deepEqual(R.whoCanCraft(roster, game(), index(), "zzzz").results, []);
  // Without game files only what each save holds can be searched.
  const saved = R.whoCanCraft(roster, null, null, "mace");
  assert.equal(saved.gameData, false);
  assert.deepEqual(saved.results.map((x) => [x.name, x.makers.map((m) => m.name)]), [["Copper Mace", ["Maker"]]]);
});

test("cooking: what you can cook now, what is short and what you could learn, from bags and bank", () => {
  const ledger = { bags: { seenAt: 100, items: [{ id: 2672, n: 3 }, { id: 6291, n: 2 }, { id: 2678, n: 1 }] }, bank: { seenAt: 50, items: [{ id: 2672, n: 2 }, { id: 12184, n: 4 }] } };
  const c = cook({ ledger });
  c.readiness.workshop.recipes.items.push({ id: 15855, skillLineId: 185, name: "Roast Raptor", reagentsKnown: true, reagents: [] });
  const now = R.cookNow(c, game(), index());
  assert.equal(now.status, "available");
  assert.deepEqual(now.cooking, { rank: 60, maxRank: 75 }); assert.deepEqual(now.fishing, { rank: 30, maxRank: 75 });
  assert.match(now.fishingNote, /not in the game files/);
  assert.deepEqual(now.inventory, { source: "ledger", seenAt: 100, bank: true, bankSeenAt: 50, kinds: 4 });
  assert.deepEqual(now.ready.map((r) => [r.name, r.crafts, r.colour]), [["Charred Wolf Meat", 5, "yellow"]], "bags and bank are added up");
  assert.deepEqual(now.short.map((r) => [r.name, r.missing]), [["Roast Raptor", [{ itemId: 2692, name: "Hot Spices", need: 1, vendor: false }]]]);
  assert.deepEqual(now.learn.map((r) => [r.name, r.canLearn, r.sources[0].kind]), [["Brilliant Smallfish", true, "vendor"], ["Spiced Wolf Meat", true, "trainer"]]);
  assert.equal(now.learn[0].sources[0].name, "Kiro", "your own faction's vendor first");
  // Holding only a vendor good (spices) is not an ingredient worth a row.
  const spices = R.cookNow(cook({ ledger: { bags: { seenAt: 1, items: [{ id: 2678, n: 20 }] } } }), game(), index());
  assert.deepEqual([spices.ready, spices.short, spices.learn], [[], [], []]);
  assert.ok(spices.notes.some((n) => /bank was not seen/.test(n)));
  assert.equal(R.cookNow(cook(), game(), index()).status, "no-bags");
  assert.equal(R.cookNow({ id: "n", readiness: { workshop: { professions: { items: [] } } } }, game(), index()).status, "no-cooking");
  // Without game files the saved recipes still work.
  const offline = R.cookNow(cook({ ledger }), null, R.sourceIndex({}));
  assert.deepEqual(offline.ready.map((r) => [r.name, r.crafts]), [["Charred Wolf Meat", 5]]);
  assert.equal(offline.gameData, false);
});

test("IPC: only the active character, strict arguments, and the path rides along with the book", () => {
  const handlers = {};
  const state = { activeProfileId: "brakka", profiles: [cook({ ledger: { prices: [], bags: { seenAt: 1, items: [{ id: 2672, n: 1 }] } } })] };
  const g = game();
  registerRecipeBook({ handle: (name, fn) => { handlers[name] = fn; }, getState: () => state,
    gameData: { recipes: () => g.recipes, spells: g.spells, items: g.items, build: () => BUILD }, ...Object.fromEntries(Object.entries(packs()).map(([k, v]) => [k, () => v])) });
  const book = handlers.recipeBook("brakka", null);
  assert.equal(book.status, "available"); assert.equal(book.build, BUILD); assert.equal(book.profileId, "brakka");
  assert.equal(book.path.to, 300); assert.equal(book.path.rank, 60);
  assert.equal(handlers.recipeBook("brakka", 185).profession.name, "Cooking");
  assert.throws(() => handlers.recipeBook("someone", null), /active character/);
  assert.throws(() => handlers.recipeBook("brakka"), /Invalid/);
  assert.throws(() => handlers.recipeBook("brakka", "185"), /Invalid/);
  assert.throws(() => handlers.recipeBook("brakka", -1), /Invalid/);
  assert.equal(handlers.whoCanCraft("wolf meat").results.length, 2);
  assert.throws(() => handlers.whoCanCraft(5), /Invalid/);
  assert.throws(() => handlers.whoCanCraft("a".repeat(101)), /Invalid/);
  assert.equal(handlers.cookNow("brakka").ready[0].name, "Charred Wolf Meat");
  assert.throws(() => handlers.cookNow(), /Invalid/);
  // A game that cannot be read: the book says so, the search and cooking fall back to the saves.
  const offline = {};
  registerRecipeBook({ handle: (name, fn) => { offline[name] = fn; }, getState: () => state, gameData: { recipes: () => null, build: () => { throw Error("no game"); } } });
  assert.equal(offline.recipeBook("brakka", null).status, "no-game-data");
  assert.match(offline.recipeBook("brakka", null).reason, /Connect your WoW Forever folder/);
  const moved = {};
  registerRecipeBook({ handle: (name, fn) => { moved[name] = fn; }, getState: () => state, gameData: { recipes: () => null, build: () => BUILD, load: () => { throw Object.assign(Error("This game build stores its tables in another layout."), { code: "LAYOUT" }); } } });
  assert.match(moved.recipeBook("brakka", null).reason, /^This game build stores its tables in another layout\. The recipe list is read from your own game files\.$/);
  assert.equal(offline.whoCanCraft("wolf").results[0].name, "Charred Wolf Meat");
  assert.equal(offline.cookNow("brakka").ready.length, 1);
});

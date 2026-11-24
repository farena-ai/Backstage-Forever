"use strict";
// World search ("Search everything"): the index, the ranking, where each result links to, the
// same-patch rule, the map clustering for the community layers and the "help fill this zone" facts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/core/world-search.cjs");
const { sourcesFromDisk } = require("../src/core/world-search-sources.cjs");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

// A small world, so every ranking rule can be seen on its own.
const PIN = (npcId, label, kind, mapId, x, y, extra = {}) => ({ id: `npc:${npcId}`, npcId, label, kind, mapId, x, y, sub: extra.sub || null, sides: extra.sides || null });
function world(extra = {}) {
  return {
    knowledgePack: {
      build: "1.60.1.71037",
      quests: {
        1: { id: 1, title: "Hidden Enemies", level: 12, sides: ["Horde"], observedInPlay: true, givers: [{ kind: "npc", id: 10 }], rewards: { items: [{ itemId: 500 }], choices: [] } },
        2: { id: 2, title: "Hidden Enemies", level: 12, sides: ["Horde"], givers: [{ kind: "npc", id: 10 }] },
        3: { id: 3, title: "Enemies of the Light", level: 40, sides: ["Alliance"], givers: [{ kind: "npc", id: 11 }] },
        4: { id: 4, title: "The Hidden Path", level: 14, givers: [] },
        5: { id: 5, title: "[UNUSED] Test Quest", level: 1, givers: [] },
      },
      npcs: {
        "npc:10": { id: 10, kind: "npc", name: "Thrall", positions: [{ mapId: 1454, x: 0.32, y: 0.37 }] },
        "npc:11": { id: 11, kind: "npc", name: "Brother Hidden", positions: [{ mapId: 1453, x: 0.5, y: 0.5 }] },
        "object:77": { id: 77, kind: "object", name: "Wanted Poster", positions: [{ mapId: 1413, x: 0.5, y: 0.3 }] },
      },
    },
    pins: new Map([[1454, [PIN(10, "Thrall", "npc", 1454, 0.32, 0.37, { sides: ["Horde"] }), PIN(20, "Doras", "flight", 1454, 0.45, 0.63, { sides: ["Horde"] }), PIN(21, "Trak'gen", "vendor", 1454, 0.4, 0.5, { sides: ["Horde"] })]],
      [1453, [PIN(11, "Brother Hidden", "npc", 1453, 0.5, 0.5, { sides: ["Alliance"] }), PIN(30, "Khelden Bremen", "class-trainer", 1453, 0.4, 0.8, { sub: "Mage Trainer", sides: ["Alliance"] })]]]),
    vendorPack: { vendors: [{ id: 21, name: "Trak'gen", listings: [{ itemId: 500, name: "Gladius", price: 536 }] }] },
    insights: { trainers: [{ id: 30, name: "Khelden Bremen", title: "Mage Trainer", services: [{ spellId: 116, name: "Frostbolt", observedLevel: 4 }] }], items: [{ id: 500, name: "Gladius" }] },
    trainerPack: { classes: { Mage: [{ id: 116, name: "Frostbolt", level: 4, cost: 100 }] } },
    lootPack: { items: { 500: [{ kind: "npc", id: 10, name: "Thrall", chance: 0.25, drops: 4 }] } },
    bossLootPack: { instances: { rfc: { bosses: [{ name: "Bazzalan", items: [{ itemId: 500, chance: 0.4 }] }] } } },
    instanceNames: { rfc: "Ragefire Chasm" },
    atlas: { entries: [{ id: "rfc", name: "Ragefire Chasm", kind: "dungeon", levels: { min: 13, max: 18 }, faction: "Horde", zone: "Orgrimmar", bosses: [{ name: "Bazzalan", observedInForever: true }] }] },
    worldPack: { rares: [{ id: 61, name: "Sister Rathtalon", minLevel: 19, maxLevel: 19, positions: [{ mapId: 1413, x: 0.4, y: 0.2 }] }, { id: 62, name: "Unplaced Rare", positions: [] }] },
    transport: { nodes: [{ id: 23, npcId: 20, master: "Doras", side: "Horde", mapId: 1454, x: 0.45, y: 0.63 }], transports: [{ id: 1, name: "Zeppelin - Orgrimmar to Undercity", mode: "zeppelin" }, { id: 2, name: "TEST Ship", mode: "boat" }] },
    levelingZones: [{ mapId: 1413, min: 10, max: 25, faction: "Horde" }],
    commands: { CATALOG: [{ group: "Finding your way", command: "/bf way MapID X Y [name]", word: "way", what: "Puts the arrow on exact map coordinates.", when: "From a guide.", example: "/bf way 1413 52 30" }], FEATURES: [{ name: "Map search box", where: "World map", what: "Type a name." }] },
    game: {
      build: "1.60.1.71037",
      items: { 500: ["Gladius", 2, 15, 10, 2, 7, 21, null, null, 0, 0, 0, 100, 0, -1, 1234], 501: ["Hidden Dagger", 1, 5, 1, 2, 15, 13, null, null, 0, 0, 0, 10, 0, -1, 0] },
      spells: { 116: ["Frostbolt", 99, "Launches a bolt of frost.", "Rank 1"], 205: ["Frostbolt", 99, "Launches a bolt of frost.", "Rank 2"], 900: ["Internal Thing", 0, null, null], 901: ["Smelt Copper", 5, "Smelt it.", null] },
      talents: { Mage: { className: "Mage", tabs: [{ name: "Frost", talents: [{ id: 37, name: "Improved Frostbolt", maxRank: 5, iconFileId: 9 }] }] } },
      recipes: { lines: { 186: ["Mining", 11, 0] }, rows: [[901, 186, 25, 50, 0, 1, 2840, 1, [2770, 1]]], teach: {} },
      flightPoints: { 23: ["Orgrimmar, Durotar", 1, 0, 0, 2] },
      spellLevels: {},
    },
    clientBuild: "1.60.1.71037",
    ...extra,
  };
}
const names = (r, kind) => (r.groups.find((g) => g.kind === kind)?.results || []).map((x) => x.name);
const one = (r, kind, name) => r.groups.find((g) => g.kind === kind)?.results.find((x) => x.name === name);

test("the index covers every kind, drops junk, keeps one row per repeated quest and says where facts come from", () => {
  const index = S.buildIndex(world());
  for (const kind of ["quest", "npc", "object", "item", "spell", "talent", "recipe", "zone", "dungeon", "boss", "rare", "flight", "transport", "command", "help"]) assert.ok(index.counts[kind] > 0, `no ${kind} rows`);
  assert.equal(index.entries.filter((e) => e.k === "quest" && e.name === "Hidden Enemies").length, 1, "the same quest listed twice is one row");
  assert.equal(index.entries.find((e) => e.k === "quest" && e.name === "Hidden Enemies").id, 1, "the row players met in play is the one kept");
  assert.ok(!index.entries.some((e) => /UNUSED|TEST Ship|Internal Thing|Unplaced Rare/.test(e.name)), "junk, internal spells and rares without a place are left out");
  assert.equal(index.entries.filter((e) => e.k === "spell" && e.name === "Frostbolt").length, 1, "one row per spell name");
  assert.equal(index.entries.find((e) => e.k === "spell" && e.name === "Frostbolt").id, 116, "the rank a trainer teaches is the row");
  assert.ok(!index.entries.some((e) => e.k === "spell" && e.name === "Smelt Copper"), "a recipe is a recipe row, not also a spell row");
  const src = (k) => new Set(index.entries.filter((e) => e.k === k).map((e) => e.src));
  assert.deepEqual([...src("item")], ["game"]); assert.deepEqual([...src("talent")], ["game"]); assert.deepEqual([...src("quest")], ["bundled"]); assert.deepEqual([...src("command")], ["app"]);
  assert.deepEqual(Object.keys(S.SOURCES), ["game", "bundled", "community", "app"]);
  assert.ok(index.builtMs >= 0 && index.bytes > 0);
  assert.deepEqual(index.limits, []);
});

test("ranking: exact beats prefix beats a word beats text inside, and a close spelling comes last", () => {
  const index = S.buildIndex(world());
  const e = (name) => index.entries.find((x) => x.name === name);
  const tier = (name, q) => S.matchTier(e(name), S.norm(q), S.norm(q).split(" "));
  assert.equal(tier("Hidden Enemies", "hidden enemies"), S.TIER.exact);
  assert.equal(tier("Hidden Enemies", "hidden"), S.TIER.prefix);
  assert.equal(tier("The Hidden Path", "hidden"), S.TIER.word);
  assert.equal(tier("Enemies of the Light", "nemies"), S.TIER.inside);
  assert.equal(tier("Thrall", "orgrimmar"), S.TIER.about, "an NPC is found by its zone");
  assert.equal(tier("Khelden Bremen", "mage trainer"), S.TIER.about, "and by its role");
  assert.equal(tier("Thrall", "zzzz"), 0);
  assert.equal(tier("/bf way MapID X Y [name]", "way"), S.TIER.exact, "a command answers to its word");
  assert.equal(S.fuzzyTier(e("Bazzalan"), ["bazalan"]), S.TIER.fuzzy);
  assert.equal(S.fuzzyTier(e("Bazzalan"), ["bzl"]), 0, "short words are never guessed");
  assert.equal(S.fuzzyTier(e("Thrall"), ["bazalan"]), 0);
  assert.equal(S.editDistance("frostbolt", "frostbalt", 2), 1);
  assert.ok(S.editDistance("frostbolt", "fireball", 2) > 2);
  // Every nudge together stays smaller than the gap between two tiers.
  const tiers = Object.values(S.TIER).sort((a, b) => a - b), gap = Math.min(...tiers.slice(1).map((t, i) => t - tiers[i]));
  const best = S.nudge({ k: "zone", n: "a", side: "Horde", lv: 15, mapId: 1, seen: true }, { faction: "Horde", level: 15, mapId: 1 });
  const worst = S.nudge({ k: "spell", n: "x".repeat(60), side: "Alliance", lv: 60 }, { faction: "Horde", level: 15, mapId: 1 });
  assert.ok(best - worst < gap, `nudges span ${best - worst}, tiers are ${gap} apart`);
  const r = S.search(index, "hidden", { faction: "Horde", level: 12 });
  assert.deepEqual(names(r, "quest"), ["Hidden Enemies", "The Hidden Path", "Enemies of the Light"], "a title that starts with the word, then one that holds it, then a quest whose giver is named so");
  assert.equal(r.fuzzy, false);
  const typo = S.search(index, "bazalan", {});
  assert.equal(typo.fuzzy, true); assert.deepEqual(names(typo, "boss"), ["Bazzalan"]);
});

test("your faction and level nudge the order without hiding anything", () => {
  const index = S.buildIndex(world());
  const horde = S.search(index, "enemies", { faction: "Horde", level: 12 }), alliance = S.search(index, "enemies", { faction: "Alliance", level: 40 });
  assert.deepEqual(names(horde, "quest"), ["Enemies of the Light", "Hidden Enemies"], "a better match stays first whatever your faction: nudges never cross a tier");
  // Two equally good matches: your faction and level decide.
  const pair = S.buildIndex({ knowledgePack: { build: "1.60.1.71037", npcs: {}, quests: { 1: { id: 1, title: "Lost Shield", level: 40, sides: ["Alliance"], givers: [] }, 2: { id: 2, title: "Lost Sword", level: 12, sides: ["Horde"], givers: [] } } } });
  assert.deepEqual(names(S.search(pair, "lost", { faction: "Horde", level: 12 }), "quest"), ["Lost Sword", "Lost Shield"]);
  assert.deepEqual(names(S.search(pair, "lost", { faction: "Alliance", level: 40 }), "quest"), ["Lost Shield", "Lost Sword"]);
  assert.equal(one(horde, "quest", "Enemies of the Light").otherFaction, true);
  assert.equal(one(alliance, "quest", "Enemies of the Light").otherFaction, false);
  assert.equal(one(alliance, "quest", "Hidden Enemies").otherFaction, true, "the other faction's quest is still listed, and marked");
  const a = S.nudge({ k: "quest", n: "x", side: "Horde", lv: 12 }, { faction: "Horde", level: 12 }), b = S.nudge({ k: "quest", n: "x", side: "Alliance", lv: 40 }, { faction: "Horde", level: 12 });
  assert.ok(a > b);
  assert.ok(S.nudge({ k: "quest", n: "x", lv: 12 }, { level: 13 }) > S.nudge({ k: "quest", n: "x", lv: 12 }, { level: 50 }));
});

test("results are grouped by kind, the best group first, with a total and a way to see one kind in full", () => {
  const big = world();
  for (let i = 0; i < 30; i++) big.game.items[600 + i] = [`Copper Thing ${i}`, 1, 5, 1, 15, 0, 0, null, null, 0, 0, 0, 1, 0, -1, 0];
  const index = S.buildIndex(big);
  const r = S.search(index, "copper", {});
  const items = r.groups.find((g) => g.kind === "item");
  assert.equal(items.total, 30); assert.equal(items.results.length, 5, "five per group until you ask for the kind");
  assert.equal(r.total, 30 + (r.groups.find((g) => g.kind === "recipe")?.total || 0));
  const all = S.search(index, "copper", {}, { kind: "item" });
  assert.equal(all.groups.length, 1); assert.equal(all.groups[0].results.length, 30);
  assert.deepEqual(S.search(index, "   ", {}).groups, []);
  assert.throws(() => S.search(index, "x".repeat(81), {}), /Invalid search/);
  assert.throws(() => S.search(index, 5, {}), /Invalid search/);
  const first = S.search(index, "ragefire", {});
  assert.equal(first.groups[0].kind, "dungeon", "the dungeon itself before its bosses");
  for (const g of r.groups) for (const row of g.results) assert.ok(row.sourceLabel && row.target, "every result says its source and where it opens");
});

test("each kind links to the right screen at the right thing", () => {
  const index = S.buildIndex(world());
  const t = (q, kind, name) => one(S.search(index, q, {}), kind, name)?.target;
  assert.deepEqual(t("hidden enemies", "quest", "Hidden Enemies"), { quest: 1 });
  assert.deepEqual(t("thrall", "npc", "Thrall"), { map: { mapId: 1454, x: 0.32, y: 0.37, npcId: 10, label: "Thrall", sub: "Quest giver", kind: "npc" } });
  assert.equal(t("doras", "npc", "Doras").map.kind, "flight");
  assert.deepEqual(t("wanted", "object", "Wanted Poster").map.mapId, 1413);
  assert.deepEqual(t("gladius", "item", "Gladius"), { item: 500 });
  assert.deepEqual(t("frostbolt", "spell", "Frostbolt"), { spell: 116 });
  assert.deepEqual(t("improved frostbolt", "talent", "Improved Frostbolt"), { talent: { className: "Mage", talentId: 37, tab: "Frost", name: "Improved Frostbolt" } });
  assert.deepEqual(t("smelt", "recipe", "Smelt Copper"), { recipe: { skillLineId: 186, spellId: 901, name: "Smelt Copper" } });
  assert.deepEqual(t("barrens", "zone", "The Barrens"), { zone: 1413 });
  assert.deepEqual(t("ragefire", "dungeon", "Ragefire Chasm"), { dungeon: "rfc" });
  assert.deepEqual(t("bazzalan", "boss", "Bazzalan"), { dungeon: "rfc", boss: "Bazzalan" });
  assert.equal(t("rathtalon", "rare", "Sister Rathtalon").map.kind, "rare");
  const flight = t("orgrimmar durotar", "flight", "Orgrimmar, Durotar");
  assert.deepEqual([flight.map.kind, flight.map.npcId, flight.map.label], ["flight", 20, "Doras"], "a flight point opens the map on its flight master");
  assert.deepEqual(t("zeppelin", "transport", "Zeppelin - Orgrimmar to Undercity"), { nav: "travel" });
  assert.deepEqual(t("way", "command", "/bf way MapID X Y [name]"), { command: "way", text: "/bf way MapID X Y [name]" });
  assert.deepEqual(t("rested", "help", "Rested"), { nav: "guide" });
  assert.deepEqual(t("data coverage", "help", "Data coverage"), { nav: "coverage" });
  // The renderer opens exactly these shapes, through the shell's own navigation.
  const view = read("src/renderer/world-search.js");
  for (const key of ["t.quest", "t.map", "t.zone", "t.dungeon", "t.talent", "t.recipe", "t.command", "t.nav"]) assert.ok(view.includes(key), `the overlay opens ${key}`);
  for (const helper of ["DungeonAtlas?.focus", "TalentsView?.focus", "RecipeBookView?.focusRecipe", "CommandsView?.focus", "questOpen", "mapFocus", "mapZone"]) assert.ok(view.includes(helper), helper);
  assert.match(read("src/renderer/dungeon-atlas.js"), /return \{ page, mounted, awaitPracticeReturn, focus \}/);
  assert.match(read("src/renderer/talents.js"), /return \{ page, academy, mounted, focus,/);
  assert.match(read("src/renderer/recipe-book.js"), /show, focusRecipe, view:/);
  assert.match(read("src/renderer/commands.js"), /window\.CommandsView = \{ page, mounted, focus,/);
});

test("an item says where it comes from: vendor with price, boss, drop, quest reward, recipe; a spell says who teaches it", () => {
  const w = world();
  w.game.recipes.rows.push([902, 186, 1, 2, 0, 1, 500, 1, [2770, 1]]); w.game.spells[902] = ["Forge Gladius", 5, "Makes a gladius.", null];
  w.community = { npcPositions: new Map(), vendors: new Map(), dropsByItem: new Map([[500, [{ npcId: 10, rate: 0.1, samples: 30, installs: 4 }]]]) };
  const index = S.buildIndex(w);
  const lines = S.itemSources(index, 500), types = lines.map((l) => l.type);
  assert.deepEqual([...new Set(types)], ["vendor", "boss", "drop", "quest", "recipe"]);
  const vendor = lines.find((l) => l.type === "vendor");
  assert.equal(vendor.text, "Sold by Trak'gen for 5s 36c"); assert.equal(vendor.target.map.npcId, 21); assert.equal(vendor.sourceLabel, "Bundled reference");
  assert.deepEqual(lines.find((l) => l.type === "boss").target, { dungeon: "rfc", boss: "Bazzalan" });
  assert.match(lines.find((l) => l.type === "boss").text, /Drops from Bazzalan in Ragefire Chasm · 40%/);
  assert.match(lines.find((l) => l.type === "drop" && l.source === "bundled").text, /Drops from Thrall · 25% of 4 looted/);
  assert.match(lines.find((l) => l.source === "community").text, /10% · seen by 4 players/);
  assert.equal(lines.find((l) => l.source === "community").sourceLabel, "Community data");
  assert.deepEqual(lines.find((l) => l.type === "quest").target, { quest: 1 });
  assert.equal(lines.find((l) => l.type === "recipe").sourceLabel, "Your game files");
  assert.deepEqual(S.itemSources(index, 501), [], "nothing is invented for an item the packs do not know");
  const spell = S.spellSources(index, 116);
  assert.match(spell[0].text, /Trainers teach it at level 4 · 1s/);
  assert.match(spell[1].text, /Khelden Bremen, Mage Trainer/); assert.equal(spell[1].target.map.npcId, 30);
  assert.deepEqual(S.spellSources(index, 900), []);
});

test("data from another patch is not searched, and the result says so; another build of the same patch is", () => {
  const other = S.buildIndex(world({ clientBuild: "1.60.2.1", game: { ...world().game, build: "1.60.2.1" } }));
  assert.equal(other.refused, true);
  assert.match(other.limits[0], /another patch \(1\.60\.2\.1\).*not searched/);
  for (const kind of ["quest", "npc", "object", "rare", "flight", "transport"]) assert.ok(!other.counts[kind], `${kind} rows from the other patch`);
  assert.ok(other.counts.item > 0 && other.counts.spell > 0 && other.counts.command > 0 && other.counts.zone > 0, "your own game files and the app itself are still searched");
  assert.deepEqual(S.itemSources(other, 500).map((l) => l.type), [], "nor are its vendors, drops and rewards");
  assert.equal(S.search(other, "thrall", {}).total, 0);
  const carried = S.buildIndex(world({ clientBuild: "1.60.1.70888" }));
  assert.equal(carried.refused, false); assert.ok(carried.counts.quest > 0);
  assert.match(carried.limits[0], /checked on build 71037 of your patch/);
});

test("without the game files only bundled item names are searched, and the result says so", () => {
  const index = S.buildIndex(world({ game: null }));
  assert.ok(!index.counts.spell && !index.counts.talent && !index.counts.recipe);
  assert.equal(index.entries.find((e) => e.k === "item").src, "bundled");
  assert.match(index.limits[0], /Connect your game folder/);
});

test("the community pack adds only what the bundled reference lacks, and is labelled", () => {
  const w = world();
  w.creatures = new Map([[900, { id: 900, name: "Wandering Trader" }]]);
  w.community = { npcPositions: new Map([[900, [{ mapId: 1413, x: 0.5, y: 0.5, installs: 4 }]], [10, [{ mapId: 1413, x: 0.1, y: 0.1, installs: 9 }]], [901, [{ mapId: 1413, x: 0.2, y: 0.2, installs: 3 }]]]), vendors: new Map([[900, [{ itemId: 159, installs: 3 }]]]) };
  const index = S.buildIndex(w);
  const trader = index.entries.find((e) => e.name === "Wandering Trader");
  assert.equal(trader.src, "community"); assert.match(trader.sub, /Vendor · The Barrens · seen by 4 players/);
  assert.equal(index.entries.filter((e) => e.k === "npc" && e.name === "Thrall").length, 1, "an NPC the reference places is not repeated");
  assert.ok(!index.entries.some((e) => e.id === 901 && e.k === "npc"), "an NPC nobody can name is not listed");
});

test("the service builds once per data version, off the typing path, and reports its size", () => {
  let builds = 0, now = 1000, deferred = null;
  const loaded = new Set(["items", "spells"]);
  const tables = { items: { items: world().game.items, hotfix: "h1" }, spells: { spells: world().game.spells }, talents: { talents: world().game.talents }, recipes: { recipes: world().game.recipes }, extras: { extras: { flightPoints: {}, spellLevels: {} } } };
  const gameData = { build: () => "1.60.1.71037", cached: (k) => loaded.has(k), load: (k) => { if (!loaded.has(k)) loaded.add(k); return tables[k]; }, spell: (id) => ({ id, name: "Frostbolt", description: "Launches a bolt of frost." }) };
  let community = null;
  const svc = new S.WorldSearch({ gameData, sources: () => { builds++; const { game, clientBuild, ...rest } = world(); return rest; }, getProfile: () => ({ faction: "Horde", level: 12, location: { mapId: 1454 } }), getCommunity: () => community, defer: (fn) => { deferred = fn; }, now: () => now });
  const first = svc.search("frostbolt");
  assert.equal(builds, 1);
  assert.match(first.limits[0], /Reading your game files/);
  assert.ok(!first.groups.some((g) => g.kind === "talent"), "talents are not read on the typing path");
  assert.equal(typeof deferred, "function");
  svc.search("frost"); svc.search("frostb");
  assert.equal(builds, 1, "typing reuses the index");
  deferred(); // the background read finishes
  const second = svc.search("frostbolt");
  assert.equal(builds, 2);
  assert.ok(second.groups.some((g) => g.kind === "talent"));
  assert.deepEqual(second.limits, []);
  now += 6000; svc.search("frostbolt"); assert.equal(builds, 2, "the same data version is not rebuilt");
  community = { version: "v2", npcPositions: new Map(), vendors: new Map() }; now += 6000; svc.search("frostbolt");
  assert.equal(builds, 3, "a new community pack is a new data version");
  const stats = second.index;
  assert.ok(stats.entries > 20 && stats.builtMs >= 0 && stats.bytes > 0 && stats.gameBuild === "1.60.1.71037");
  assert.deepEqual(Object.keys(svc.detail("item", 500)), ["kind", "id", "sources"]);
  assert.equal(svc.detail("spell", 116).spell.name, "Frostbolt");
  for (const bad of [[null, 1], ["quest", 1], ["item", 0], ["item", "500"]]) assert.throws(() => svc.detail(...bad), /Invalid search detail/);
  for (const bad of [["", {}], ["x", null], ["x", []], [5, {}]]) assert.throws(() => svc.search(...bad), /Invalid search/);
  assert.equal(svc.context().faction, "Horde");
});

test("the real bundled reference indexes quickly and finds well-known things", () => {
  const index = S.buildIndex({ ...sourcesFromDisk(), game: null });
  assert.ok(index.entries.length > 8000, `${index.entries.length} entries`);
  assert.ok(index.builtMs < 3000, `built in ${index.builtMs} ms`);
  assert.ok(index.counts.quest > 3000 && index.counts.npc > 1000 && index.counts.boss > 100 && index.counts.command > 50 && index.counts.zone > 30);
  const started = process.hrtime.bigint();
  const r = S.search(index, "hidden enemies", { faction: "Horde", level: 12 });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 500);
  assert.equal(r.groups[0].kind, "quest"); assert.equal(r.groups[0].results[0].name, "Hidden Enemies");
  assert.equal(S.search(index, "ragefire chasm", {}).groups[0].kind, "dungeon");
  assert.equal(S.search(index, "/bf way", {}).groups[0].kind, "command");
  // Every glossary word the search knows is a word the Field guide really explains.
  const app = read("src/renderer/app.js");
  for (const [name] of S.HELP_TOPICS) assert.ok(app.includes(`<dt>${name}`), `Field guide explains "${name}"`);
});

test("the app wires the search: one IPC pair, the preload, the page, Ctrl+K and no new tab", () => {
  const main = read("src/main.cjs"), preload = read("src/preload.cjs"), html = read("src/renderer/index.html"), view = read("src/renderer/world-search.js"), nav = read("src/renderer/player-navigation.js");
  assert.match(main, /handle\("worldSearch", \(query, options, \.\.\.extra\) =>/);
  assert.match(main, /handle\("worldSearchDetail", \(kind, id, \.\.\.extra\) =>/);
  assert.match(preload, /worldSearch: \(query, options\) => invoke\("worldSearch", query, options\)/);
  assert.match(preload, /worldSearchDetail: \(kind, id\) => invoke\("worldSearchDetail", kind, id\)/);
  assert.ok(html.indexOf('<script src="world-search.js">') > 0 && html.indexOf('<script src="world-search.js">') < html.indexOf('<script src="app.js">'));
  assert.match(html, /href="world-search\.css"/);
  assert.match(view, /e\.ctrlKey \|\| e\.metaKey/); assert.match(view, /e\.key === "k"/);
  assert.match(read("src/renderer/app.js"), /\$\{WorldSearchView\.railButton\(\)\}/);
  assert.ok(!nav.includes("world-search"), "search is an overlay, not a route or a tab");
});

// ---------------------------------------------------------------- community layers
test("community spots cluster at low zoom and stand alone once you are close", () => {
  const C = require("../src/renderer/map-cluster.js");
  const pts = []; for (let i = 0; i < 40; i++) pts.push({ sx: 100 + (i % 8) * 6, sy: 100 + Math.floor(i / 8) * 6, id: i });
  pts.push({ sx: 600, sy: 400, id: "far" });
  const groups = C.grid(pts, C.cellFor(1));
  assert.equal(groups.reduce((t, g) => t + g.items.length, 0), 41, "no spot is lost");
  assert.ok(groups.length <= 3, `40 close spots became ${groups.length} marks`);
  assert.equal(groups[0].items.length >= 20, true); assert.equal(groups[groups.length - 1].items[0].id, "far");
  assert.ok(Math.abs(groups[0].sx - 121) < 30 && Math.abs(groups[0].sy - 112) < 30, "a mark sits in the middle of its spots");
  // Two spots either side of a grid line are one mark, not two overlapping ones.
  assert.equal(C.grid([{ sx: 95, sy: 50 }, { sx: 97, sy: 50 }], 96).length, 1);
  assert.equal(C.grid([{ sx: 10, sy: 10 }, { sx: 400, sy: 300 }], 96).length, 2);
  assert.deepEqual(C.grid([], 96), []); assert.deepEqual(C.grid([{ sx: NaN, sy: 1 }], 96), []);
  assert.ok(C.cellFor(1) > C.cellFor(2) && C.cellFor(2) > 0, "marks get smaller as you zoom in");
  assert.equal(C.cellFor(3), 0); assert.equal(C.cellFor(8), 0);
  assert.ok(C.radiusFor(1) < C.radiusFor(50) && C.radiusFor(100000) <= 17, "a big count never becomes a big blot");
  // On a 780x520 map at the default zoom, 150 scattered spots stay a handful of marks.
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const many = Array.from({ length: 150 }, () => ({ sx: rnd() * 780, sy: rnd() * 520 }));
  assert.ok(C.grid(many, C.cellFor(1)).length <= 48, "the default view stays sparse");
  const wm = read("src/renderer/world-map.js");
  assert.match(wm, /Community: \[\["c-herb", "Community herbs"\], \["c-ore", "Community ore"\], \["c-chest", "Community chests"\], \["c-npc", "NPCs players placed"\], \["c-vendor", "Community vendors"\]\]/);
  assert.match(wm, /window\.MapCluster\.grid\(shared, cell\)/);
});

test("community pins: a layer each, seen by N players, skill filter facts, your own finds, and one honest date", () => {
  const W = require("../src/core/world-map.cjs"), { indexPack, validatePack } = require("../src/core/community.cjs");
  const pack = validatePack({ format: 1, version: "v1", generatedAt: "2026-11-20T00:00:00.000Z", minInstalls: 3,
    nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs"], rows: [["herb", 1618, null, 1413, 0.45, 0.36, 5], ["herb", null, "Mageroyal", 1413, 0.5, 0.4, 3], ["ore", 1731, null, 1413, 0.6, 0.5, 7], ["chest", 2843, null, 1413, 0.2, 0.2, 3], ["herb", 1618, null, 1411, 0.5, 0.5, 3]] },
    npcs: { columns: ["npcId", "mapId", "x", "y", "installs"], rows: [[900, 1413, 0.3, 0.3, 4], [901, 1413, 0.35, 0.3, 3], [10, 1413, 0.1, 0.1, 9]] },
    vendors: { columns: ["npcId", "itemId", "installs"], rows: [[900, 159, 3]] } });
  const community = indexPack(pack);
  const facts = (n) => (n.objectId === 1618 ? { name: "Earthroot", skill: 15 } : n.objectId === 1731 ? { name: "Copper Vein", skill: 1 } : n.name === "Mageroyal" ? { name: "Mageroyal", skill: 50 } : null);
  const mine = W.ownSpotKeys([{ source: { kind: "wow-addon", id: "a" }, clientBuild: "1.60.1.71037", gathering: { records: [{ method: "herbalism", entityId: 1618, mapId: 1413, x: 0.4512, y: 0.3588 }] } }]);
  assert.ok(mine.has("herb:1618:1413:0.45:0.36"), "your find, rounded the way the pack rounds");
  const pins = W.communityPins(community, 1413, { staticNpcIds: new Set([10]), npcName: (id) => (id === 900 ? "Wandering Trader" : null), nodeFacts: facts, skills: { herb: 40, ore: -1 }, mine });
  assert.deepEqual(pins.map((p) => p.layer).sort(), ["c-chest", "c-herb", "c-herb", "c-npc", "c-ore", "c-vendor"]);
  assert.ok(pins.every((p) => W.COMMUNITY_LAYERS.includes(p.layer) && p.community && /seen by \d+ players?/.test(p.sub) && /^Community · \d+ players/.test(p.source)));
  const earth = pins.find((p) => p.label === "Earthroot"), mage = pins.find((p) => p.label === "Mageroyal"), copper = pins.find((p) => p.label === "Copper Vein"), chest = pins.find((p) => p.layer === "c-chest");
  assert.deepEqual([earth.gatherable, earth.skill, earth.yours, earth.installs], [true, 15, true, 5]);
  assert.deepEqual([mage.gatherable, mage.skill, mage.yours], [false, 50, false], "needs more Herbalism than you have");
  assert.equal(copper.gatherable, false, "Mining is not learned"); assert.equal(chest.gatherable, true);
  assert.equal(pins.find((p) => p.layer === "c-vendor").label, "Wandering Trader");
  assert.ok(!pins.some((p) => p.npcId === 10), "an NPC the reference already places is never duplicated");
  assert.deepEqual([W.canGather(40, 50), W.canGather(50, 50), W.canGather(null, 50), W.canGather(40, null), W.canGather(-1, null)], [false, true, null, null, false]);
  const sum = W.communitySummary(community, pins, { now: Date.parse("2026-11-23T06:00:00.000Z"), skills: { herb: 40, ore: -1 } });
  assert.deepEqual({ total: sum.total, yours: sum.yours, layers: sum.layers, beyondSkill: sum.beyondSkill, ageDays: sum.ageDays, perFactDates: sum.perFactDates },
    { total: 6, yours: 1, layers: { "c-herb": 2, "c-ore": 1, "c-chest": 1, "c-npc": 1, "c-vendor": 1 }, beyondSkill: 2, ageDays: 3, perFactDates: false });
  assert.equal(W.communitySummary(null, []), null);
  assert.deepEqual(W.communityPins(null, 1413), []);
});

test("help fill this zone: only where the numbers are really thin, for your own faction's zones", () => {
  const { zoneGaps, coverageScore, COVERAGE_GOOD } = require("../src/core/world-map.cjs");
  const row = (faction, f) => ({ mapId: 1, name: "Somewhere", faction, Horde: { questGivers: 0, objectiveAreas: 0, classTrainers: 0, professionTrainers: 0, vendors: 0, flightMasters: 0, ...f }, Alliance: { questGivers: 0, objectiveAreas: 0, classTrainers: 0, professionTrainers: 0, vendors: 0, flightMasters: 0 } });
  const thin = zoneGaps(row("Horde", { questGivers: 2, vendors: 1 }), "Horde");
  assert.deepEqual(thin.missing, [{ key: "questGivers", count: 2 }, { key: "flightMasters", count: 0 }, { key: "trainers", count: 0 }, { key: "vendors", count: 1 }]);
  assert.equal(zoneGaps(row("Horde", { questGivers: 30, objectiveAreas: 20, professionTrainers: 4, vendors: 8, flightMasters: 1 }), "Horde"), null, "a well covered zone shows no card");
  assert.equal(zoneGaps(row("Horde", { questGivers: 12, objectiveAreas: 10, vendors: 4, flightMasters: 1, professionTrainers: 1 }), "Horde"), null, "a middling zone is not nagged about");
  assert.equal(zoneGaps(row("Alliance", {}), "Horde"), null, "the other faction's zone is not yours to fill");
  assert.ok(zoneGaps(row("Contested", {}), "Alliance"), "a contested zone counts for both");
  assert.equal(coverageScore(Object.fromEntries(Object.keys(COVERAGE_GOOD).map((k) => [k, 999]))), 1);
  // The page words: counts stay outside the sentences, and both places use the same lines.
  const cov = read("src/renderer/coverage.js"), wm = read("src/renderer/world-map.js");
  assert.match(cov, /data-cov-fill=/); assert.match(cov, /data-cov-help/); assert.match(wm, /window\.CoverageView\?\.gapLines\(gap\)/);
  assert.match(cov, /\/bf scout on/); assert.match(wm, /\/bf scout on/);
});

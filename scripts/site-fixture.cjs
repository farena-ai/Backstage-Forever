"use strict";
// Fixture characters for the website screenshots (scripts/site-screenshots.cjs).
// Invented names only. Quest, item and place ids are real so the bundled data packs light up.
const reference = require("../data/forever/pack.json");
const bossLoot = require("../data/forever-boss-loot/pack.json");
const transport = require("../data/forever-transport/pack.json");

const DAY = 86400;
const item = (id, n, name, q = 1) => ({ id, n, q, name });

// Loot rows for a run: the first few bundled drops of that dungeon's bosses.
const SLUGS = { 36: "dm", 48: "bfd", 189: "sm", 209: "zf", 230: "brd", 329: "strat", 289: "scholo", 229: "ubrs", 409: "mc" };
function lootFor(instanceMap, count) {
  const named = [], other = [];
  for (const boss of bossLoot.instances[SLUGS[instanceMap]]?.bosses || []) for (const drop of boss.items || []) {
    const list = reference.items?.[drop.itemId] ? named : other;
    if (!named.includes(drop.itemId) && !other.includes(drop.itemId)) list.push(drop.itemId);
  }
  return [...named, ...other].slice(0, count).map((id) => ({ id, n: 1 }));
}

function questRow(id, progress = []) {
  const q = reference.quests[id];
  if (!q) throw Error(`Fixture quest ${id} is not in the bundled pack`);
  const objectives = (q.objectives || []).map((o, i) => {
    const [have, name] = progress[i] || [0, "Objective"];
    return { text: o.required === 1 && o.type !== "item" ? name : `${have}/${o.required} ${name}`, done: have >= o.required, type: o.type === "monster" ? "monster" : o.type === "item" ? "item" : "event", required: o.required, fulfilled: Math.min(have, o.required) };
  });
  return { id, title: q.title, complete: objectives.length > 0 && objectives.every((o) => o.done), objectives };
}

const encounterIds = new Map(require("../data/forever-encounters/pack.json").encounters.map((e) => [e.name, e.id]));
// Boss names come from the bundled loot pack; the id is the game's where the encounter pack has it.
const bossesOf = (instanceMap) => (bossLoot.instances[SLUGS[instanceMap]]?.bosses || []).map((b, i) => ({ name: b.name, encounterId: encounterIds.get(b.name) || b.npcIds?.[0] || 900000 + instanceMap * 100 + i }));

function gatheringBlock(build, at) {
  const node = (method, entityId, mapId, x, y, name, itemId) => ({ id: `wowf:${method}:${entityId}:${mapId}:${Math.floor(x * 10000 + 0.5)}:${Math.floor(y * 10000 + 0.5)}:${build}`, method, entityId, itemIds: [itemId], mapId, x, y, observedAt: at, clientBuild: build, name, evidence: "observed-gathering-loot", precision: "recorded-standing-point", approximate: true });
  const records = [];
  // A herb round north-west of the Crossroads and a copper line along the eastern hills.
  const herbs = [[0.44, 0.36], [0.46, 0.33], [0.49, 0.31], [0.47, 0.38], [0.43, 0.41], [0.45, 0.44], [0.49, 0.42], [0.41, 0.34], [0.42, 0.29]];
  for (const [x, y] of herbs) records.push(node("herbalism", 1619, 1413, x, y, "Earthroot", 2449));
  const ore = [[0.58, 0.34], [0.6, 0.31], [0.62, 0.28], [0.61, 0.38], [0.63, 0.42], [0.59, 0.45]];
  for (const [x, y] of ore) records.push(node("mining", 1731, 1413, x, y, "Copper Vein", 2770));
  records.push(node("chest", 2843, 1413, 0.55, 0.2, "Battered Chest", 2589));
  return { schemaVersion: 1, status: "available", recording: true, observedAt: at, limited: false, totalRecords: records.length, records };
}

// What the level 60 mage wears: [slot, item id, name, item level]. Head and feet are left weaker
// on purpose so the gear plan has something to suggest.
const THESSALY_GEAR = [[1, 10041, "Dreamweave Circlet", 50], [2, 18691, "Dark Advisor's Pendant", 61], [3, 16689, "Magister's Mantle", 60], [15, 13386, "Archivist Cape", 61],
  [5, 16688, "Magister's Robes", 63], [9, 16683, "Magister's Bindings", 57], [10, 16684, "Magister's Gloves", 59], [6, 16685, "Magister's Belt", 58], [7, 16687, "Magister's Leggings", 61],
  [8, 11822, "Omnicast Boots", 59], [11, 12545, "Eye of Orgrimmar", 60], [12, 13001, "Maiden's Circle", 61], [13, 12930, "Briarwood Reed", 60], [14, 11832, "Burst of Knowledge", 58],
  [16, 13964, "Witchblade", 62], [17, 22253, "Tome of the Lost", 63], [18, 13938, "Bonecreeper Stylus", 62]];

// The optional extras block (src/core/capture-extras.cjs) for the level 60 mage, built from the
// player's own game files when the screenshot script was given --game: talents spent row by row
// (16 Arcane, 35 Frost), every trainer-taught recipe she has outgrown, and two keys on the key ring.
function mageExtras(game, at, professions, workshopIds) {
  const extras = { v: 1, keyring: { at, slots: 12, ids: [7146, 12382] } };
  if (!game) return extras;
  const spend = (tab, budget) => {
    const rows = [];
    let spent = 0;
    for (const t of [...tab.talents].sort((a, b) => a.row - b.row || a.column - b.column)) {
      if (spent >= budget || spent < t.row * 5) continue;
      const rank = Math.min(t.maxRank, budget - spent);
      spent += rank;
      rows.push([t.row + 1, t.column + 1, rank, t.maxRank, t.name]);
    }
    return { n: tab.name, t: rows, spent };
  };
  const want = { Arcane: 16, Frost: 35 };
  const tabs = (game.talents?.tabs || []).map((tab) => spend(tab, want[tab.name] || 0));
  if (tabs.length && tabs.reduce((n, t) => n + t.spent, 0) <= 51) extras.talents = { at, unspent: 51 - tabs.reduce((n, t) => n + t.spent, 0), tabs: tabs.map(({ n, t }) => ({ n, t })) };
  const taughtByItem = new Set(Object.keys(game.recipes?.teach || {}).map(Number));
  const lines = professions.map((p) => {
    // Row: [spell, skill line, yellow from, grey from, ...]. Known: gone yellow a while ago and not from a recipe item.
    const ids = (game.recipes?.rows || []).filter((r) => r[1] === p.skillLineId && r[2] > 0 && r[2] <= p.rank - 12 && !taughtByItem.has(r[0])).map((r) => r[0]);
    return { l: p.skillLineId, r: p.rank, c: true, ids: [...new Set([...ids, ...workshopIds.filter(([, line]) => line === p.skillLineId).map(([id]) => id)])].sort((a, b) => a - b).slice(0, 600) };
  }).filter((line) => line.ids.length);
  if (lines.length) extras.recipes = { at, lines };
  return extras;
}

function buildCharacters({ clock, version, game = null }) {
  const build = reference.build;
  const at = (daysAgo, seconds = 0) => clock - daysAgo * DAY + seconds;
  const side = (s) => transport.nodes.filter((n) => n.side === s || n.side === "Both" || n.side === "Neutral");
  // known: how many of that side's flight points (in pack order), or the exact node ids.
  const flights = (s, known) => side(s).map((n, i) => ({ id: n.id, known: Array.isArray(known) ? known.includes(n.id) : i < known }));
  const levels = (from, to, startDaysAgo, hoursPer) => Array.from({ length: to - from + 1 }, (_, i) => ({ level: from + i, at: at(startDaysAgo) + Math.round(i * (startDaysAgo * DAY / (to - from + 1))), played: Math.round((from + i - 1) * hoursPer * 3600 * (1 + i / 60)) }));

  const aelora = {
    id: "Fixture-Aelora", name: "Aelora", faction: "Horde", race: "Tauren", className: "Hunter", sex: "female", level: 16,
    location: { zone: "The Barrens", subZone: "The Crossroads", mapId: 1413, x: 0.52, y: 0.3 },
    progress: { current: 6150, max: 10800, rested: 3200, resting: false },
    quests: [questRow(870, [[1, "Explore the waters of the Forgotten Pools"]]), questRow(845, [[3, "Zhevra Hooves"]]), questRow(869, [[7, "Raptor Head"]]), questRow(848, [[1, "Fungal Spores"]]), questRow(855, [[9, "Centaur Bracers"]]), questRow(867, [[0, "Witchwing Talon"]]), questRow(5041, [[0, "Crossroads' Supply Crates"]]), questRow(6128, [[5, "Earthroot"], [2, "Kodo Horn"]])],
    history: { recent: [], completedIdsKnown: true, completedIds: [743, 744, 745, 746, 747, 750, 752, 753, 757, 761, 764, 765, 766, 767, 771, 780, 833, 840, 842, 844, 871] },
    journal: { levels: levels(1, 16, 9, 0.55), firsts: [{ key: "flight", at: at(6) }, { key: "death", at: at(8) }, { key: "group", at: at(4) }, { key: "hearth", at: at(8, 900) }, { key: "rested", at: at(7) }], zones: [1412, 1456, 1413, 1454, 1411], played: Math.round(16.4 * 3600) },
    gathering: gatheringBlock(build, at(1)),
    travel: { seenAt: clock, nodes: flights("Horde", [22, 23, 25, 77]), bind: { name: "The Crossroads", mapId: 1413, x: 0.52, y: 0.299 }, hearthReadyAt: clock + 1500 },
    stats: { schemaVersion: 1, seenAt: clock, strength: 34, agility: 61, stamina: 48, intellect: 29, spirit: 33, armor: 512, attackPower: 96, health: 720, power: 610, powerKind: "mana" },
    readiness: { bags: { free: 11, total: 52 }, workshop: {
      professions: { observedAt: clock, complete: true, items: [{ skillLineId: 182, professionId: 182, name: "Herbalism", rank: 74, maxRank: 150 }, { skillLineId: 186, professionId: 186, name: "Mining", rank: 61, maxRank: 75 }] } } },
    ledger: { schemaVersion: 1, money: 38450, moneyAt: clock, moneyLog: [[4200, at(8)], [9100, at(6)], [15800, at(4)], [24100, at(2)], [38450, at(0, -600)]],
      bags: { seenAt: clock, complete: true, items: [item(2449, 14, "Earthroot"), item(765, 20, "Silverleaf"), item(2770, 18, "Copper Ore"), item(2589, 12, "Linen Cloth"), item(118, 4, "Minor Healing Potion"), item(4540, 10, "Tough Hunk of Bread")] },
      reputations: { seenAt: clock, factions: [{ id: 81, name: "Thunder Bluff", standing: 5, min: 3000, max: 9000, value: 5450 }, { id: 76, name: "Orgrimmar", standing: 4, min: 0, max: 3000, value: 2100 }, { id: 530, name: "Darkspear Trolls", standing: 4, min: 0, max: 3000, value: 600 }] },
      mail: { seenAt: at(1), complete: true, letters: 3, money: 12500, expiresAt: clock + DAY * 3, items: [item(2589, 20, "Linen Cloth")] },
      cooldowns: [], prices: [], pricesOn: true },
  };

  // A run and the boss kills inside it, spread evenly between the first pull and the end.
  const kills = [];
  const run = (instanceMap, name, daysAgo, minutes, deaths, loot, bosses, instanceType = "party") => {
    const startedAt = at(daysAgo), endedAt = at(daysAgo, minutes * 60);
    bossesOf(instanceMap).slice(0, bosses).forEach((boss, i) => kills.push({ encounterId: boss.encounterId, name: boss.name, instanceMap, instanceType, difficultyId: 1, at: startedAt + Math.round((i + 1) * (minutes * 60 - 60) / bosses) }));
    return { instanceMap, instanceType, name, startedAt, endedAt, deaths, loot: Array.isArray(loot) ? loot.map((id) => ({ id, n: 1 })) : lootFor(instanceMap, loot) };
  };
  const price = (id, name, q, series) => ({ id, name, q, hist: series.slice(-5).reverse().map(([p, daysAgo]) => [p, at(daysAgo, -900)]) });
  const thessalyRuns = [run(36, "The Deadmines", 62, 71, 1, 2, 6), run(48, "Blackfathom Deeps", 55, 64, 0, 1, 5), run(189, "Scarlet Monastery", 44, 38, 0, 2, 4), run(189, "Scarlet Monastery", 43, 35, 0, 1, 4), run(209, "Zul'Farrak", 33, 52, 2, 2, 6), run(230, "Blackrock Depths", 21, 143, 3, [11815, 11684, 11920], 7), run(329, "Stratholme", 12, 66, 1, [13346, 13340], 5), run(289, "Scholomance", 9, 58, 0, [14340, 13938], 5), run(329, "Stratholme", 6, 49, 0, [13353], 5), run(229, "Blackrock Spire", 4, 74, 1, [12940, 12926], 5), run(409, "Molten Core", 2, 171, 2, [], 10, "raid")];
  const thessaly = {
    id: "Fixture-Thessaly", name: "Thessaly", faction: "Alliance", race: "Human", className: "Mage", sex: "female", level: 60,
    location: { zone: "Stormwind City", subZone: "Trade District", mapId: 1453, x: 0.56, y: 0.62 },
    quests: [{ id: 4264, title: "A Crumpled Up Note", complete: false, objectives: [] }],
    history: { recent: [], completedIdsKnown: true, completedIds: [4182, 4183, 4184, 4185, 4186, 4223, 4224, 4241, 4242, 7848] },
    journal: { levels: levels(1, 60, 70, 2.1), firsts: [{ key: "flight", at: at(64) }, { key: "dungeon", at: at(62) }, { key: "mount", at: at(31) }, { key: "death", at: at(67, 4000) }, { key: "group", at: at(63) }, { key: "hearth", at: at(66, 2000) }, { key: "rested", at: at(68) }],
      zones: [1429, 1453, 1436, 1433, 1431, 1434, 1417, 1443, 1446, 1449, 1452, 1422, 1423, 1428, 1427],
      runs: thessalyRuns, encounters: kills.splice(0),
      played: Math.round(6.2 * DAY) },
    travel: { seenAt: clock, nodes: flights("Alliance", 18), bind: { name: "Stormwind City", mapId: 1453, x: 0.525, y: 0.655 }, hearthReadyAt: clock - 60 },
    stats: { schemaVersion: 1, seenAt: clock, strength: 38, agility: 44, stamina: 212, intellect: 301, spirit: 188, armor: 842, attackPower: 28, health: 3350, power: 5620, powerKind: "mana", resist: { fire: 62, frost: 10 } },
    gearSets: { schemaVersion: 1, sets: [{ name: "Dungeon", savedAt: at(2), items: THESSALY_GEAR.map(([slot, itemId, name]) => ({ slot, itemId, name })) },
      { name: "Fire resist", savedAt: at(5), items: [{ slot: 15, itemId: 18350, name: "Amplifying Cloak" }, { slot: 11, itemId: 12543, name: "Songstone of Ironforge" }] }] },
    readiness: { equipment: THESSALY_GEAR.map(([slot, itemId, name, itemLevel]) => ({ slot, itemId, name, quality: 3, itemLevel })), bags: { free: 23, total: 84 }, workshop: {
      professions: { observedAt: clock, complete: true, items: [{ skillLineId: 197, professionId: 197, name: "Tailoring", rank: 281, maxRank: 300 }, { skillLineId: 171, professionId: 171, name: "Alchemy", rank: 262, maxRank: 300 }, { skillLineId: 185, professionId: 185, name: "Cooking", rank: 225, maxRank: 300 }, { skillLineId: 129, professionId: 129, name: "First Aid", rank: 300, maxRank: 300 }] },
      recipes: { observedAt: clock, complete: true, items: [
        { id: 18401, skillLineId: 197, name: "Bolt of Runecloth", outputItemId: 14048, canSkillUp: false, reagentsKnown: true, reagents: [{ itemId: 14047, name: "Runecloth", required: 5 }] },
        { id: 18405, skillLineId: 197, name: "Runecloth Bag", outputItemId: 14046, canSkillUp: true, reagentsKnown: true, reagents: [{ itemId: 14048, name: "Bolt of Runecloth", required: 5 }, { itemId: 8170, name: "Rugged Leather", required: 2 }, { itemId: 14341, name: "Rune Thread", required: 1 }] },
        { id: 18445, skillLineId: 197, name: "Mooncloth Bag", outputItemId: 14155, canSkillUp: true, reagentsKnown: true, reagents: [{ itemId: 14048, name: "Bolt of Runecloth", required: 4 }, { itemId: 14342, name: "Mooncloth", required: 1 }, { itemId: 14341, name: "Rune Thread", required: 1 }] },
        { id: 17573, skillLineId: 171, name: "Greater Arcane Elixir", outputItemId: 13454, canSkillUp: true, reagentsKnown: true, reagents: [{ itemId: 13463, name: "Dreamfoil", required: 3 }, { itemId: 13465, name: "Mountain Silversage", required: 1 }, { itemId: 8925, name: "Crystal Vial", required: 1 }] },
        { id: 17556, skillLineId: 171, name: "Major Healing Potion", outputItemId: 13446, canSkillUp: true, reagentsKnown: true, reagents: [{ itemId: 13464, name: "Golden Sansam", required: 2 }, { itemId: 13465, name: "Mountain Silversage", required: 1 }, { itemId: 8925, name: "Crystal Vial", required: 1 }] },
        { id: 11461, skillLineId: 171, name: "Arcane Elixir", outputItemId: 9155, canSkillUp: false, reagentsKnown: true, reagents: [{ itemId: 8839, name: "Blindweed", required: 1 }, { itemId: 3821, name: "Goldthorn", required: 1 }, { itemId: 8925, name: "Crystal Vial", required: 1 }] },
      ] },
      materials: { observedAt: clock, complete: true, scope: "bags-0-4", items: [{ itemId: 14047, name: "Runecloth", count: 86 }, { itemId: 14048, name: "Bolt of Runecloth", count: 9 }, { itemId: 14341, name: "Rune Thread", count: 4 }, { itemId: 13463, name: "Dreamfoil", count: 22 }, { itemId: 13465, name: "Mountain Silversage", count: 6 }, { itemId: 13464, name: "Golden Sansam", count: 12 }, { itemId: 8925, name: "Crystal Vial", count: 20 }] } } },
    ledger: { schemaVersion: 1, money: 4823511, moneyAt: clock,
      moneyLog: [[1210400, at(13)], [1498000, at(12)], [1502300, at(11)], [1987000, at(10)], [2240100, at(9)], [2101900, at(8)], [2650000, at(7)], [3120800, at(6)], [3099000, at(5)], [3704400, at(4)], [4011000, at(3)], [4390200, at(2)], [4605000, at(1)], [4823511, at(0, -600)]],
      bags: { seenAt: clock, complete: true, items: [item(14047, 86, "Runecloth"), item(14048, 9, "Bolt of Runecloth"), item(14341, 4, "Rune Thread"), item(13463, 22, "Dreamfoil"), item(13465, 6, "Mountain Silversage"), item(13464, 12, "Golden Sansam"), item(8925, 20, "Crystal Vial"), item(13444, 9, "Major Mana Potion"), item(13446, 6, "Major Healing Potion"), item(13454, 5, "Greater Arcane Elixir", 1), item(8545, 18, "Heavy Mageweave Bandage"), item(11000, 1, "Shadowforge Key")] },
      bank: { seenAt: at(1), complete: true, items: [item(14342, 3, "Mooncloth", 1), item(14344, 4, "Large Brilliant Shard", 3), item(12811, 1, "Righteous Orb", 2), item(7078, 5, "Essence of Fire", 2), item(14047, 140, "Runecloth"), item(4338, 60, "Mageweave Cloth")] },
      mail: { seenAt: at(0, -3600), complete: true, letters: 2, money: 184500, expiresAt: clock + DAY * 5, items: [item(13463, 20, "Dreamfoil")] },
      reputations: { seenAt: clock, factions: [{ id: 72, name: "Stormwind", standing: 7, min: 21000, max: 42000, value: 30120 }, { id: 47, name: "Ironforge", standing: 6, min: 9000, max: 21000, value: 15400 }, { id: 529, name: "Argent Dawn", standing: 6, min: 9000, max: 21000, value: 17250 }, { id: 576, name: "Timbermaw Hold", standing: 4, min: 0, max: 3000, value: 1875 }, { id: 749, name: "Hydraxian Waterlords", standing: 5, min: 3000, max: 9000, value: 4100 }, { id: 59, name: "Thorium Brotherhood", standing: 4, min: 0, max: 3000, value: 950 }] },
      cooldowns: [{ key: "mooncloth", spellId: 18560, readyAt: clock + 26 * 3600 }, { key: "transmute", spellId: 17187, readyAt: clock - 2 * 3600 }],
      prices: [
        price(14047, "Runecloth", 1, [[410, 13], [395, 11], [430, 9], [455, 7], [440, 5], [480, 3], [505, 1], [520, 0]]),
        price(14048, "Bolt of Runecloth", 1, [[2300, 9], [2450, 5], [2600, 0]]),
        price(14341, "Rune Thread", 1, [[5000, 9], [5000, 0]]),
        price(14342, "Mooncloth", 1, [[142000, 12], [150500, 9], [139000, 6], [161000, 3], [168000, 0]]),
        price(14046, "Runecloth Bag", 2, [[21000, 9], [22500, 4], [24000, 0]]),
        price(14155, "Mooncloth Bag", 2, [[285000, 9], [301000, 4], [312000, 0]]),
        price(13463, "Dreamfoil", 1, [[2100, 13], [2250, 10], [1980, 8], [2400, 6], [2620, 4], [2550, 2], [2710, 0]]),
        price(13465, "Mountain Silversage", 1, [[3900, 10], [4200, 6], [4050, 3], [4400, 0]]),
        price(13464, "Golden Sansam", 1, [[1800, 10], [1650, 6], [1900, 3], [1950, 0]]),
        price(8170, "Rugged Leather", 1, [[900, 9], [1050, 4], [1100, 0]]),
        price(8925, "Crystal Vial", 1, [[400, 10], [400, 0]]),
        price(13454, "Greater Arcane Elixir", 1, [[14500, 10], [15200, 6], [16800, 3], [17400, 0]]),
        price(13446, "Major Healing Potion", 1, [[9800, 10], [10400, 6], [11200, 0]]),
        price(7078, "Essence of Fire", 2, [[31000, 12], [34500, 8], [33000, 4], [38000, 0]]),
        price(12811, "Righteous Orb", 2, [[220000, 12], [245000, 6], [262000, 0]]),
        // The herbs and vials an alchemist buys on the way up, so the skill path has prices to work with.
        ...[[765, "Silverleaf", 95], [2447, "Peacebloom", 80], [2449, "Earthroot", 140], [785, "Mageroyal", 210], [2450, "Briarthorn", 260], [2453, "Bruiseweed", 380], [2452, "Swiftthistle", 520], [3820, "Stranglekelp", 610],
          [3355, "Wild Steelbloom", 540], [3356, "Kingsblood", 470], [3357, "Liferoot", 590], [3818, "Fadeleaf", 760], [3821, "Goldthorn", 880], [3358, "Khadgar's Whisker", 720], [3819, "Wintersbite", 940], [4625, "Firebloom", 1150],
          [8831, "Purple Lotus", 1320], [8836, "Arthas' Tears", 990], [8838, "Sungrass", 1480], [8839, "Blindweed", 1650], [8845, "Ghost Mushroom", 2400], [8846, "Gromsblood", 1900], [13466, "Plaguebloom", 3100], [13467, "Icecap", 2800],
          [3371, "Empty Vial", 20], [3372, "Leaded Vial", 40]].map(([id, name, p], i) => price(id, name, 1, [[Math.round(p * 0.9), 11 - (i % 3)], [Math.round(p * 1.08), 6], [p, i % 4]])),
      ], pricesOn: true },
  };

  const brannocRuns = [run(36, "The Deadmines", 30, 62, 0, 1, 6), run(189, "Scarlet Monastery", 14, 41, 1, 1, 4)];
  const brannoc = {
    id: "Fixture-Brannoc", name: "Brannoc", faction: "Alliance", race: "Dwarf", className: "Warrior", sex: "male", level: 42,
    location: { zone: "Stranglethorn Vale", subZone: "Booty Bay", mapId: 1434, x: 0.27, y: 0.77 },
    progress: { current: 41200, max: 63900, rested: 21000, resting: true },
    quests: [],
    journal: { levels: levels(1, 42, 40, 1.4), firsts: [{ key: "flight", at: at(39) }, { key: "dungeon", at: at(30) }, { key: "mount", at: at(3) }], zones: [1426, 1455, 1432, 1437, 1433, 1434, 1417], runs: brannocRuns, encounters: kills.splice(0), played: Math.round(2.6 * DAY) },
    stats: { schemaVersion: 1, seenAt: clock, strength: 142, agility: 71, stamina: 131, intellect: 22, spirit: 44, armor: 2210, attackPower: 404, health: 2540, power: 100, powerKind: "rage" },
    // Worn gear a few levels behind, so a level 34-45 dungeon has upgrades to show.
    readiness: { equipment: [[1, 3836, "Green Iron Helm", 34], [3, 3841, "Golden Scale Shoulders", 35], [15, 6593, "Battleforge Cloak", 26], [5, 3844, "Green Iron Hauberk", 36], [9, 3835, "Green Iron Bracers", 33], [10, 3485, "Green Iron Gauntlets", 30],
      [6, 6594, "Battleforge Girdle", 28], [7, 3843, "Golden Scale Leggings", 34], [8, 3846, "Polished Steel Boots", 37], [16, 6687, "Corpsemaker", 34]].map(([slot, itemId, name, itemLevel]) => ({ slot, itemId, name, quality: 2, itemLevel })),
      bags: { free: 6, total: 68 }, workshop: { professions: { observedAt: clock, complete: true, items: [{ skillLineId: 164, professionId: 164, name: "Blacksmithing", rank: 205, maxRank: 225 }, { skillLineId: 186, professionId: 186, name: "Mining", rank: 214, maxRank: 225 }] } } },
    ledger: { schemaVersion: 1, money: 612300, moneyAt: clock, moneyLog: [[310000, at(6)], [455000, at(3)], [612300, at(0, -600)]],
      bags: { seenAt: clock, complete: true, items: [item(3860, 24, "Mithril Bar"), item(3859, 12, "Steel Bar"), item(7911, 9, "Truesilver Ore", 2), item(3928, 5, "Superior Healing Potion")] },
      reputations: { seenAt: clock, factions: [{ id: 47, name: "Ironforge", standing: 6, min: 9000, max: 21000, value: 11200 }, { id: 21, name: "Booty Bay", standing: 4, min: 0, max: 3000, value: 2500 }] },
      mail: { seenAt: at(2), complete: true, letters: 1, money: 0, expiresAt: clock + DAY * 2, items: [item(3860, 10, "Mithril Bar")] },
      cooldowns: [], prices: [], pricesOn: true },
  };
  thessaly.extras = mageExtras(game, clock, thessaly.readiness.workshop.professions.items, thessaly.readiness.workshop.recipes.items.map((r) => [r.id, r.skillLineId]));

  return [aelora, thessaly, brannoc].map((c) => ({ realm: "Fixture Realm", updatedAt: clock, clientBuild: build, captureVersion: version, ...c }));
}

module.exports = { buildCharacters };

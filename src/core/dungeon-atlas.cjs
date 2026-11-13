"use strict";
// Dungeons & Raids atlas. Two clearly separated layers:
//  - "Observed in Forever": bundled community encounter observations (CC BY 4.0).
//  - "Classic-era baseline": a hand-curated guide to the original instances (level band,
//    zone, approximate entrance, boss roster). Forever may differ; it is labelled as such.
const fs = require("node:fs");
const path = require("node:path");

const BASELINE = [
  // id, name, kind, min, max, faction, zone, mapId, entrance [x,y] (approximate), instance map, bosses
  ["rfc", "Ragefire Chasm", "dungeon", 13, 18, "Horde", "Orgrimmar", 1454, [52, 49], 389, ["Oggleflint", "Taragaman the Hungerer", "Jergosh the Invoker", "Bazzalan"]],
  ["wc", "Wailing Caverns", "dungeon", 17, 24, null, "The Barrens", 1413, [46, 36], 43, ["Lady Anacondra", "Lord Cobrahn", "Kresh", "Lord Pythas", "Skum", "Lord Serpentis", "Verdan the Everliving", "Mutanus the Devourer"]],
  ["dm", "The Deadmines", "dungeon", 17, 26, "Alliance", "Westfall", 1436, [42, 72], 36, ["Rhahk'Zor", "Sneed", "Gilnid", "Mr. Smite", "Captain Greenskin", "Edwin VanCleef"]],
  ["sfk", "Shadowfang Keep", "dungeon", 22, 30, null, "Silverpine Forest", 1421, [44, 67], 33, ["Rethilgore", "Razorclaw the Butcher", "Baron Silverlaine", "Commander Springvale", "Odo the Blindwatcher", "Fenrus the Devourer", "Wolf Master Nandos", "Archmage Arugal"]],
  ["bfd", "Blackfathom Deeps", "dungeon", 24, 32, null, "Ashenvale", 1440, [14, 14], 48, ["Ghamoo-ra", "Lady Sarevess", "Gelihast", "Lorgus Jett", "Baron Aquanis", "Twilight Lord Kelris", "Old Serra'kis", "Aku'mai"]],
  ["stocks", "The Stockade", "dungeon", 24, 32, "Alliance", "Stormwind City", 1453, [50, 67], 34, ["Targorr the Dread", "Kam Deepfury", "Hamhock", "Bazil Thredd", "Dextren Ward"]],
  ["gnomer", "Gnomeregan", "dungeon", 29, 38, null, "Dun Morogh", 1426, [24, 39], 90, ["Grubbis", "Viscous Fallout", "Electrocutioner 6000", "Crowd Pummeler 9-60", "Mekgineer Thermaplugg"]],
  ["rfk", "Razorfen Kraul", "dungeon", 29, 38, null, "The Barrens", 1413, [42, 90], 47, ["Roogug", "Aggem Thorncurse", "Death Speaker Jargba", "Overlord Ramtusk", "Agathelos the Raging", "Charlga Razorflank"]],
  ["sm", "Scarlet Monastery", "dungeon", 34, 45, null, "Tirisfal Glades", 1420, [85, 32], 189, ["Interrogator Vishas", "Bloodmage Thalnos", "Houndmaster Loksey", "Arcanist Doan", "Herod", "High Inquisitor Fairbanks", "Scarlet Commander Mograine", "High Inquisitor Whitemane"]],
  ["rfd", "Razorfen Downs", "dungeon", 37, 46, null, "The Barrens", 1413, [49, 93], 129, ["Tuten'kash", "Mordresh Fire Eye", "Glutton", "Amnennar the Coldbringer"]],
  ["ulda", "Uldaman", "dungeon", 41, 51, null, "Badlands", 1418, [42, 18], 70, ["Revelosh", "Ironaya", "Obsidian Sentinel", "Ancient Stone Keeper", "Galgann Firehammer", "Grimlok", "Archaedas"]],
  ["zf", "Zul'Farrak", "dungeon", 44, 54, null, "Tanaris", 1446, [39, 21], 209, ["Antu'sul", "Theka the Martyr", "Witch Doctor Zum'rah", "Nekrum Gutchewer", "Sergeant Bly", "Hydromancer Velratha", "Chief Ukorz Sandscalp"]],
  ["mara", "Maraudon", "dungeon", 46, 55, null, "Desolace", 1443, [29, 62], 349, ["Noxxion", "Razorlash", "Lord Vyletongue", "Celebras the Cursed", "Landslide", "Tinkerer Gizlock", "Rotgrip", "Princess Theradras"]],
  ["st", "Sunken Temple", "dungeon", 50, 60, null, "Swamp of Sorrows", 1435, [70, 54], 109, ["Atal'alarion", "Dreamscythe", "Weaver", "Jammal'an the Prophet", "Ogom the Wretched", "Morphaz", "Hazzas", "Shade of Eranikus"]],
  ["brd", "Blackrock Depths", "dungeon", 52, 60, null, "Searing Gorge", 1427, [35, 84], 230, ["Lord Roccor", "High Interrogator Gerstahn", "Bael'Gar", "Lord Incendius", "General Angerforge", "Golem Lord Argelmach", "Ambassador Flamelash", "Magmus", "Emperor Dagran Thaurissan"]],
  ["lbrs", "Lower Blackrock Spire", "dungeon", 55, 60, null, "Searing Gorge", 1427, [35, 84], 229, ["Highlord Omokk", "Shadow Hunter Vosh'gajin", "War Master Voone", "Mother Smolderweb", "Overlord Wyrmthalak"]],
  ["dme", "Dire Maul", "dungeon", 55, 60, null, "Feralas", 1444, [59, 44], 429, ["Zevrim Thornhoof", "Hydrospawn", "Alzzin the Wildshaper", "Immol'thar", "Prince Tortheldrin", "King Gordok"]],
  ["scholo", "Scholomance", "dungeon", 58, 60, null, "Western Plaguelands", 1422, [69, 73], 289, ["Kirtonos the Herald", "Jandice Barov", "Rattlegore", "Ras Frostwhisper", "Darkmaster Gandling"]],
  ["strat", "Stratholme", "dungeon", 58, 60, null, "Eastern Plaguelands", 1423, [31, 15], 329, ["Timmy the Cruel", "Balnazzar", "Baroness Anastari", "Maleki the Pallid", "Ramstein the Gorger", "Baron Rivendare"]],
  ["ubrs", "Upper Blackrock Spire", "raid", 58, 60, null, "Searing Gorge", 1427, [35, 84], 229, ["Pyroguard Emberseer", "Warchief Rend Blackhand", "The Beast", "General Drakkisath"]],
  ["zg", "Zul'Gurub", "raid", 58, 60, null, "Stranglethorn Vale", 1434, [53, 17], 309, ["High Priestess Jeklik", "High Priest Venoxis", "High Priestess Mar'li", "High Priest Thekal", "High Priestess Arlokk", "Bloodlord Mandokir", "Jin'do the Hexxer", "Hakkar"]],
  ["mc", "Molten Core", "raid", 60, 60, null, "Searing Gorge", 1427, [35, 84], 409, ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Golemagg the Incinerator", "Sulfuron Harbinger", "Majordomo Executus", "Ragnaros"]],
  ["ony", "Onyxia's Lair", "raid", 60, 60, null, "Dustwallow Marsh", 1445, [52, 76], 249, ["Onyxia"]],
  ["bwl", "Blackwing Lair", "raid", 60, 60, null, "Searing Gorge", 1427, [35, 84], 469, ["Razorgore the Untamed", "Vaelastrasz the Corrupt", "Broodlord Lashlayer", "Firemaw", "Ebonroc", "Flamegor", "Chromaggus", "Nefarian"]],
  ["aq20", "Ruins of Ahn'Qiraj", "raid", 60, 60, null, "Silithus", 1451, [36, 93], 509, ["Kurinnaxx", "General Rajaxx", "Moam", "Buru the Gorger", "Ayamiss the Hunter", "Ossirian the Unscarred"]],
  ["aq40", "Temple of Ahn'Qiraj", "raid", 60, 60, null, "Silithus", 1451, [28, 92], 531, ["The Prophet Skeram", "Battleguard Sartura", "Fankriss the Unyielding", "Princess Huhuran", "Twin Emperors", "C'Thun"]],
  ["naxx", "Naxxramas", "raid", 60, 60, null, "Eastern Plaguelands", 1423, [39, 26], 533, ["Anub'Rekhan", "Grand Widow Faerlina", "Maexxna", "Noth the Plaguebringer", "Heigan the Unclean", "Loatheb", "Instructor Razuvious", "Gothik the Harvester", "The Four Horsemen", "Patchwerk", "Grobbulus", "Gluth", "Thaddius", "Sapphiron", "Kel'Thuzad"]],
];
const ROLES = {
  dungeon: ["Tank (holds attention)", "Healer", "Three damage dealers"],
  raid: ["2–8 tanks by encounter", "Healers for roughly a quarter of the raid", "Ranged and melee damage", "Raid leader and loot rules agreed first"],
};
const PREP = {
  dungeon: ["Repair gear and empty bags", "Food and water for the run", "Hearthstone ready to return", "Quests for this instance picked up first"],
  raid: ["Consumables (potions, elixirs, food)", "Resistance gear where the encounter needs it", "Attunement or key requirements checked", "Repair and reagents"],
};
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function loadEncounters(file = path.join(__dirname, "../../data/forever-encounters/pack.json")) {
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    if (p.kind !== "forever-encounters" || !Array.isArray(p.encounters) || p.encounters.length > 2000) return null;
    return p;
  } catch { return null; }
}
// WoW-style difficulty colour for the player's level against an instance band.
function difficulty(level, min, max) {
  if (!Number.isInteger(level)) return "unknown";
  if (level < min - 2) return "impossible";
  if (level < min) return "hard";
  if (level <= max - 3) return "right";
  if (level <= max) return "easy";
  return "trivial";
}
// Quests that send you into a dungeon: kill/collect objectives naming one of its bosses.
function dungeonQuests(pack, bossNames, profile, dungeonName = "") {
  if (!pack?.quests) return [];
  const faction = profile?.faction || null, level = Number.isInteger(profile?.level) ? profile.level : null;
  const inLog = new Set((profile?.quests || []).map((q) => q.id));
  const done = new Set(profile?.history?.completedIds || []);
  const out = [];
  for (const q of Object.values(pack.quests)) {
    if (inLog.has(q.id) || done.has(q.id)) continue;
    if (faction && q.sides?.length && !q.sides.includes(faction)) continue;
    if (level && q.minLevel && q.minLevel > level + 3) continue;
    const hit = (q.objectives || []).some((o) => {
      const n = o.type === "monster" ? pack.creatures?.[String(o.objectId)]?.name : null;
      return n && bossNames.has(norm(n));
    });
    const text = norm(`${q.objectiveEvidence || ""} ${q.title || ""}`), place = norm(dungeonName);
    const named = (place && place.length > 4 && text.includes(place)) || [...bossNames].some((b) => b && b.length > 4 && text.includes(b));
    if (!hit && !named) continue;
    const giverRef = (q.givers || [])[0], giver = giverRef && pack.npcs?.[`${giverRef.kind}:${giverRef.id}`];
    const at = giver?.positions?.[0];
    out.push({ id: q.id, title: q.title, level: q.level || null, minLevel: q.minLevel || null, giver: giver ? { name: giver.name, npcId: giver.kind === "npc" ? giver.id : null, mapId: at?.mapId ?? null, x: at?.x ?? null, y: at?.y ?? null } : null });
  }
  return out.sort((a, b) => (a.level || 0) - (b.level || 0)).slice(0, 8);
}
function buildAtlas({ profile = null, encounters = null, knowledgePack = null } = {}) {
  const level = Number.isInteger(profile?.level) ? profile.level : null;
  const faction = profile?.faction || null;
  const observedByMap = new Map();
  for (const e of encounters?.encounters || []) {
    if (!observedByMap.has(e.instanceMap)) observedByMap.set(e.instanceMap, []);
    observedByMap.get(e.instanceMap).push(e);
  }
  const quests = profile?.quests || [];
  const entries = BASELINE.map(([id, name, kind, min, max, side, zone, mapId, [ex, ey], instanceMap, bosses]) => {
    const observed = observedByMap.get(instanceMap) || [];
    observedByMap.delete(instanceMap);
    const bossNames = new Set([...bosses, ...observed.map((o) => o.name)].map(norm));
    // Your quests that point here: dungeon-tagged titles, or objectives naming a boss.
    const yours = quests.filter((q) => (q.objectives || []).some((o) => [...bossNames].some((b) => b && norm(o.text).includes(b))) || norm(q.title).includes(norm(name))).map((q) => ({ id: q.id, title: q.title, complete: Boolean(q.complete), objectives: (q.objectives || []).slice(0, 6) }));
    const observedNames = new Set(observed.map((o) => norm(o.name)));
    return {
      id, name, kind, levels: { min, max }, faction: side, zone, mapId, entrance: { x: ex / 100, y: ey / 100, approximate: true },
      difficulty: difficulty(level, min, max),
      factionNote: side && faction && side !== faction ? `${side}-side entrance; reachable but deep in enemy territory.` : null,
      bosses: bosses.map((b) => ({ name: b, observedInForever: observedNames.has(norm(b)), kills: observed.find((o) => norm(o.name) === norm(b))?.kills || 0 })),
      observedOnly: observed.filter((o) => !bosses.some((b) => norm(b) === norm(o.name))).map((o) => ({ name: o.name, kills: o.kills })),
      observedRuns: observed.reduce((m, o) => Math.max(m, o.runs || 0), 0),
      yourQuests: yours, roles: ROLES[kind], prep: PREP[kind], pickUp: dungeonQuests(knowledgePack, bossNames, profile, name),
      source: "Classic-era baseline (verify in Forever)" + (observed.length ? " + observed Forever encounters" : ""),
    };
  });
  // Instances observed in Forever that the baseline does not know (new Forever content).
  for (const [instanceMap, list] of observedByMap) {
    entries.push({
      id: `forever-${instanceMap}`, name: `Forever instance ${instanceMap}`, kind: "dungeon", levels: null, faction: null, zone: null, mapId: null, entrance: null,
      difficulty: "unknown", factionNote: null, foreverOriginal: true,
      bosses: list.map((o) => ({ name: o.name, observedInForever: true, kills: o.kills })), observedOnly: [], observedRuns: list.reduce((m, o) => Math.max(m, o.runs || 0), 0),
      yourQuests: [], roles: ROLES.dungeon, prep: PREP.dungeon, source: "Observed Forever encounters only (name, level and entrance not yet observed)",
    });
  }
  const order = { right: 0, easy: 1, hard: 2, trivial: 3, impossible: 4, unknown: 5 };
  const suggested = entries.filter((e) => e.kind === "dungeon" && ["right", "easy"].includes(e.difficulty)).sort((a, b) => order[a.difficulty] - order[b.difficulty] || a.levels.min - b.levels.min).slice(0, 3).map((e) => e.id);
  return {
    level, faction, suggested, entries,
    attribution: encounters ? `${encounters.attribution} Encounters observed through ${encounters.source?.collectedOn?.last || "unknown"}.` : null,
    caution: "Baseline levels, entrances and bosses come from the original game era; World of Warcraft: Forever may differ. Observed Forever encounters are marked.",
  };
}
module.exports = { buildAtlas, loadEncounters, difficulty, BASELINE };

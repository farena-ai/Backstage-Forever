"use strict";
// The companion's understanding layer (0.58): works out what a player is really asking, finds the
// people, places, items, quests and dungeons they mean in WoW Forever's own data (spelling slips,
// possessives and roleplay phrasing included) and answers from that data. With no AI model the
// answer text is returned as is; with a model, `facts` goes into its context so the model answers
// in voice but from verified Forever facts. Nothing here guesses a location the data lacks.
const fs = require("node:fs"), path = require("node:path");
const { MAP_NAMES } = require("./map-names.cjs");
const { MASTERS } = require("./flight-masters.cjs");
const { BASELINE } = require("./dungeon-atlas.cjs");

const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`´]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const loose = (s) => norm(s).replace(/'/g, "");
const pct = (v) => (v * 100).toFixed(1);
const zoneOf = (mapId) => MAP_NAMES[mapId] || null;
// Words too common in names to identify anyone on their own.
const COMMON = new Set(["young", "great", "greater", "lesser", "elder", "master", "trainer", "keeper", "defias", "scarlet", "bloodscalp", "skullsplitter", "venture", "captain", "lieutenant", "sergeant", "commander", "apprentice", "journeyman", "expert", "artisan", "guard", "guardian", "warrior", "hunter", "priest", "rogue", "shaman", "warlock", "paladin", "druid", "mage", "innkeeper", "banker", "auctioneer", "vendor", "merchant", "supplier", "quartermaster", "brother", "sister", "father", "mother", "elite", "plainstrider", "goretusk", "thunderhead", "stranglethorn", "barrens", "ashenvale", "westfall", "durotar", "mulgore", "orgrimmar", "undercity", "stormwind", "ironforge", "darnassus", "thunder", "bluff", "warsong", "horde", "alliance", "silverwing"]);
const STOP = new Set(["the", "a", "an", "of", "to", "in", "at", "is", "my", "i", "me", "do", "where", "can", "how", "what", "who", "for", "and", "on"]);

// ---------- data (loaded once per process; injectable for tests) ----------
let cache = null;
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "../..", rel), "utf8")); } catch { return null; } }
function loadData(overrides = {}) {
  if (cache && !Object.keys(overrides).length) return cache;
  const d = {
    pack: overrides.pack || readJson("data/forever/pack.json"),
    historical: overrides.historical || readJson("data/forever-npc-locations/pack.json"),
    insights: overrides.insights || readJson("data/forever-insights/pack.json"),
    loot: overrides.loot || readJson("data/forever-loot/pack.json"),
    creatures: overrides.creatures || readJson("data/forever-creatures/pack.json"),
    vendors: overrides.vendors || readJson("data/forever-vendors/pack.json"),
    bossLoot: overrides.bossLoot || readJson("data/forever-boss-loot/pack.json"),
  };
  d.index = buildIndex(d);
  TOWNS = d.index.towns;
  if (!Object.keys(overrides).length) cache = d;
  return d;
}
const placeLike = (name) => { const k = loose(name).replace(/^the /, ""); return Object.values(MAP_NAMES).some((z) => loose(z).replace(/^the /, "") === k) || Object.keys(PLACES).some((a) => loose(a) === k) || Object.keys(TOWN_ZONE).some((t) => loose(t).replace(/^the /, "") === k) || Object.keys(TOWN_ANCHORS).some((t) => loose(t).replace(/^the /, "") === k); };
function buildIndex(d) {
  const npcs = new Map(); // id -> {id,name,positions,side}
  const addNpc = (n, side) => {
    if (!n?.id || !n.name) return;
    const cur = npcs.get(n.id) || { id: n.id, name: n.name, positions: [], side: side || null };
    for (const p of n.positions || []) if (p && Number.isFinite(p.x) && cur.positions.length < 6) cur.positions.push(p);
    cur.side ||= side || null;
    npcs.set(n.id, cur);
  };
  for (const n of Object.values(d.pack?.npcs || {})) if (n.kind === "npc") addNpc(n, n.side);
  for (const n of d.historical?.npcs || []) addNpc(n, n.side);
  const items = new Map(); // id -> name
  const addItem = (id, name) => { if (Number.isSafeInteger(id) && typeof name === "string" && name && !/^Item #/.test(name) && !items.has(id)) items.set(id, name); };
  for (const i of Object.values(d.pack?.items || {})) addItem(i.id, i.name);
  for (const v of d.vendors?.vendors || []) for (const l of v.listings || []) addItem(l.itemId, l.name);
  for (const i of Object.values(d.insights?.items || {})) addItem(i.id, i.name);
  const walk = (o, depth = 0) => { if (!o || typeof o !== "object" || depth > 5) return; if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; } if (Number.isSafeInteger(o.itemId ?? o.id) && typeof o.name === "string" && ("itemId" in o || "quality" in o || "chance" in o)) addItem(o.itemId ?? o.id, o.name); for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1); };
  walk(d.bossLoot);
  // Quest text names the items its objectives ask for ("Bring 10 Linen Cloth to ...").
  for (const q of Object.values(d.pack?.quests || {})) {
    const ev = String(q.objectiveEvidence || ""); if (!ev) continue;
    const objs = (q.objectives || []).filter((o) => o.type === "item" && Number.isSafeInteger(o.objectId) && Number.isSafeInteger(o.required));
    for (const o of objs) {
      if (items.has(o.objectId) || objs.filter((x) => x.required === o.required).length > 1) continue;
      const m = ev.match(new RegExp(String.raw`\b${o.required}\s+([A-Z][A-Za-z' -]{2,40}?)(?=\s+(?:to|from|and|for|in|at|of the|back)\b|[,.;]|$)`));
      const one = !m && o.required === 1 && objs.length === 1 ? ev.match(/(?:\b(?:his|her|its|their)|^(?:Bring|Collect|Obtain|Retrieve|Recover|Find)|\. (?:Bring|Collect|Obtain|Retrieve|Recover|Find))\s+([A-Z][a-z']+(?: [A-Z][A-Za-z']+){1,4})(?=\s+(?:to|from|and|for|in|at|of the|back)\b|[,.;]|$)/) : null;
      const hit = m || one;
      if (hit && (placeLike(hit[1]) || /^(?:the|a|an|his|her|its|their)\b/i.test(hit[1]))) continue;
      if (hit) addItem(o.objectId, hit[1].trim());
    }
  }
  const creatures = new Map();
  for (const c of Object.values(d.creatures?.creatures || {})) if (c?.id && c.name) creatures.set(c.id, c);
  // Creature -> items it was seen dropping (inverted loot pack).
  const drops = new Map();
  for (const [itemId, sources] of Object.entries(d.loot?.items || {})) for (const s of sources || []) {
    if (s.kind !== "npc" || !s.id) continue;
    const list = drops.get(s.id) || []; list.push({ itemId: Number(itemId), chance: s.chance, drops: s.drops }); drops.set(s.id, list);
    if (s.name && !creatures.has(s.id)) creatures.set(s.id, { id: s.id, name: s.name });
  }
  for (const [inst, row] of Object.entries(d.bossLoot?.instances || {})) for (const b of row.bosses || []) for (const npcId of b.npcIds || []) {
    const list = drops.get(npcId) || [];
    for (const it of b.items || []) if (!list.some((x) => x.itemId === it.itemId)) list.push({ itemId: it.itemId, chance: it.chance, drops: it.drops, instance: inst });
    drops.set(npcId, list);
    if (!creatures.has(npcId)) creatures.set(npcId, { id: npcId, name: b.name });
  }
  const itemQuest = new Map(), bossSources = new Map();
  for (const q of Object.values(d.pack?.quests || {})) for (const o of q.objectives || []) if (o.type === "item" && Number.isSafeInteger(o.objectId) && !itemQuest.has(o.objectId) && q.title) itemQuest.set(o.objectId, q);
  for (const [inst, row] of Object.entries(d.bossLoot?.instances || {})) for (const b of row.bosses || []) for (const it of b.items || []) { const a = bossSources.get(it.itemId) || []; a.push({ boss: b.name, instance: inst, chance: it.chance }); bossSources.set(it.itemId, a); }
  const quests = new Map();
  for (const q of Object.values(d.pack?.quests || {})) if (q?.id && q.title && !/^<|\bnyi\b/i.test(q.title)) quests.set(q.id, q);
  // Name lookups: loose name -> ids, per kind.
  const names = { npc: new Map(), item: new Map(), creature: new Map(), quest: new Map() };
  const put = (m, name, id) => { const k = loose(name); if (k.length < 3) return; const a = m.get(k) || []; if (!a.includes(id)) a.push(id); m.set(k, a); };
  for (const n of npcs.values()) put(names.npc, n.name, n.id);
  for (const [id, n] of items) put(names.item, n, id);
  for (const c of creatures.values()) put(names.creature, c.name, c.id);
  for (const q of quests.values()) put(names.quest, q.title, q.id);
  const trainers = (d.insights?.trainers || []).filter((t) => t?.name && t.title && t.positions?.length);
  const flight = [];
  for (const [id, m] of Object.entries(MASTERS || {})) { const n = npcs.get(Number(id)); if (n?.positions.length) flight.push({ ...n, name: n.name || m.name }); }
  // Towns: the travel reference's own places, then towns anchored on a resident NPC's observed spot.
  const towns = [];
  for (const n of readJson("data/forever-travel/pack.json")?.nodes || []) if (n.position?.uiMap && n.label) towns.push({ name: n.label, mapId: n.position.uiMap, x: n.position.mapX, y: n.position.mapY });
  for (const [town, anchor] of Object.entries(TOWN_ANCHORS)) {
    if (towns.some((t) => loose(t.name).replace(/^the /, "") === loose(town).replace(/^the /, ""))) continue;
    const ids = names.npc.get(loose(anchor)) || []; const n = ids.map((id) => npcs.get(id)).find((x) => x?.positions.length);
    if (n) towns.push({ name: town, mapId: n.positions[0].mapId, x: n.positions[0].x, y: n.positions[0].y });
  }
  // Distinctive words of names ("helbrim", "vancleef", "outrunner") for questions that use only one.
  const tokens = { npc: new Map(), creature: new Map() };
  for (const kind of ["npc", "creature"]) for (const [name, ids] of names[kind]) for (const w of name.split(" ")) {
    if (w.length < 5 || COMMON.has(w)) continue;
    const a = tokens[kind].get(w) || []; for (const id of ids) if (!a.includes(id)) a.push(id); tokens[kind].set(w, a);
  }
  // Where quest targets were observed: creature id -> positions and the quest that sends you.
  const creatureAreas = new Map();
  for (const q of Object.values(d.pack?.quests || {})) for (const loc of q.objectiveLocations || []) {
    if (loc.type !== "monster") continue;
    const o = (q.objectives || []).find((x) => x.index === loc.index && x.type === "monster");
    if (!o || !Number.isSafeInteger(o.objectId) || !loc.positions?.length) continue;
    const cur = creatureAreas.get(o.objectId) || { positions: [], quests: [] };
    for (const pt of loc.positions) if (cur.positions.length < 24) cur.positions.push(pt);
    if (q.title && !cur.quests.includes(q.title)) cur.quests.push(q.title);
    creatureAreas.set(o.objectId, cur);
  }
  // Recipes taught by trainers, with the skill rank they need.
  const recipes = new Map();
  for (const t of trainers) for (const sv of t.services || []) {
    if (!sv.skill || !Number.isSafeInteger(sv.skillRank) || !sv.name) continue;
    const k = loose(sv.name), cur = recipes.get(k) || { name: sv.name, skill: sv.skill, rank: sv.skillRank, trainers: [] };
    cur.rank = Math.min(cur.rank, sv.skillRank); if (!cur.trainers.includes(t)) cur.trainers.push(t);
    recipes.set(k, cur);
  }
  names.recipe = new Map([...recipes.keys()].map((k) => [k, [k]]));
  return { npcs, items, creatures, drops, quests, names, trainers, flight, towns, itemQuest, bossSources, tokens, creatureAreas, recipes };
}

// ---------- understanding ----------
const DUNGEON_ALIASES = { dm: "dm", rfc: "rfc", ragefire: "rfc", wc: "wc", "wailing caverns": "wc", deadmines: "dm", "the deadmines": "dm", vc: "dm", vancleef: "dm", "van cleef": "dm", sfk: "sfk", shadowfang: "sfk", bfd: "bfd", "blackfathom": "bfd", stocks: "stocks", stockade: "stocks", gnomer: "gnomer", gnomeregan: "gnomer", rfk: "rfk", "razorfen kraul": "rfk", sm: "sm", scarlet: "sm", "scarlet monastery": "sm", rfd: "rfd", "razorfen downs": "rfd", ulda: "ulda", uldaman: "ulda", zf: "zf", "zul'farrak": "zf", zulfarrak: "zf", mara: "mara", maraudon: "mara", "sunken temple": "st", "temple of atal'hakkar": "st", brd: "brd", "blackrock depths": "brd", lbrs: "lbrs", "lower blackrock": "lbrs", "dire maul": "dme", scholo: "scholo", scholomance: "scholo", strat: "strat", stratholme: "strat", ubrs: "ubrs", "upper blackrock": "ubrs", zg: "zg", "zul'gurub": "zg", zulgurub: "zg", mc: "mc", "molten core": "mc", ony: "ony", onyxia: "ony", "onyxia's lair": "ony", bwl: "bwl", "blackwing lair": "bwl", aq20: "aq20", "ruins of ahn'qiraj": "aq20", aq40: "aq40", "temple of ahn'qiraj": "aq40", naxx: "naxx", naxxramas: "naxx" };
const DUNGEONS = new Map(BASELINE.map((r) => [r[0], { id: r[0], name: r[1], kind: r[2], min: r[3], max: r[4], faction: r[5], zone: r[6], mapId: r[7], entrance: r[8], bosses: r[10] || [] }]));
const PLACES = { org: "Orgrimmar", orgrimmar: "Orgrimmar", ogrimmar: "Orgrimmar", tb: "Thunder Bluff", "thunder bluff": "Thunder Bluff", uc: "Undercity", undercity: "Undercity", sw: "Stormwind City", stormwind: "Stormwind City", "stormwind city": "Stormwind City", if: null, ironforge: "Ironforge", darnassus: "Darnassus", xroads: "The Crossroads", crossroads: "The Crossroads", "the crossroads": "The Crossroads", "booty bay": "Booty Bay", bb: "Booty Bay", ratchet: "Ratchet", "sentinel hill": "Sentinel Hill", "grom'gol": "Grom'gol Base Camp", gromgol: "Grom'gol Base Camp", "splintertree post": "Splintertree Post", splintertree: "Splintertree Post", "camp taurajo": "Camp Taurajo", auberdine: "Auberdine", goldshire: "Goldshire", brill: "Brill", razor_hill: null, "razor hill": "Razor Hill" };
// Towns and the zone they are in, for travel and "where is" answers about places.
const TOWN_ZONE = { "The Crossroads": 1413, "Camp Taurajo": 1413, Ratchet: 1413, "Booty Bay": 1434, "Grom'gol Base Camp": 1434, "Sentinel Hill": 1436, "Splintertree Post": 1440, Auberdine: 1439, Goldshire: 1429, Brill: 1420, "Razor Hill": 1411 };
// Conventional town names anchored on an NPC who stands there; the position always comes from the data.
const TOWN_ANCHORS = { "The Crossroads": "Devrak", "Camp Taurajo": "Omusa Thunderhorn", Ratchet: "Bragok", "Splintertree Post": "Vhulgra", Astranaar: "Daelyshia", "Sentinel Hill": "Thor", "Booty Bay": "Krazek", "Grom'gol Base Camp": "Thysta", "Rebel Camp": "Lieutenant Doren", Goldshire: "Innkeeper Farley", "Razor Hill": "Innkeeper Grosk", Brill: "Innkeeper Renee", Auberdine: "Caylais Moonfeather", Lakeshire: "Ariena Stormfeather", Darkshire: "Felicia Maline", Thelsamar: "Thorgrum Borrelson", "Menethil Harbor": "Shellei Brondir", Kharanos: "Innkeeper Belm", Dolanaar: "Innkeeper Keldamyr", "Bloodhoof Village": "Innkeeper Kauth", "The Sepulcher": "Karos Razok", "Tarren Mill": "Zarise", Southshore: "Darla Harris", Gadgetzan: "Bulkrek Ragefist", Theramore: "Baldruc", "Sun Rock Retreat": "Tharm", "Freewind Post": "Nyse", "Camp Mojache": "Shyn", "Feathermoon Stronghold": "Fyldren Moonfeather", Stonard: "Breyk", Kargath: "Gorrik", Hammerfall: "Urda", "Refuge Pointe": "Cedrik Prose", Everlook: "Yugrek", "Cenarion Hold": "Runk Windtamer", "Chillwind Camp": "Bibilfaz Featherwhistle", "Nijel's Point": "Baritanas Skyriver", "Shadowprey Village": "Thalon" };
const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
const PROFESSIONS = { alchemy: "Alchemist", blacksmithing: "Blacksmith", enchanting: "Enchanter", engineering: "Engineer", herbalism: "Herbalist", leatherworking: "Leatherworker", mining: "Miner", skinning: "Skinner", tailoring: "Tailor", cooking: "Cook", "first aid": "First Aid", fishing: "Fishing" };
const PROF_ALIASES = { herb: "herbalism", herbs: "herbalism", herbalist: "herbalism", mine: "mining", miner: "mining", skin: "skinning", skinner: "skinning", tailor: "tailoring", cook: "cooking", chef: "cooking", bandage: "first aid", bandages: "first aid", fish: "fishing", fisher: "fishing", lw: "leatherworking", leatherworker: "leatherworking", bs: "blacksmithing", blacksmith: "blacksmithing", alchemist: "alchemy", enchanter: "enchanting", engineer: "engineering", firstaid: "first aid" };
const CATEGORY_ITEMS = { bread: ["bread", "muffin", "biscuit", "loaf"], cheese: ["cheese"], meat: ["meat", "jerky", "ham"], fish: ["fish", "snapper", "mackerel", "salmon"], arrows: ["arrow"], arrow: ["arrow"], bullets: ["shot", "bullet"], ammo: ["arrow", "shot"], thread: ["thread"], dye: ["dye"], flux: ["flux"], vials: ["vial"], vial: ["vial"], water: ["water", "juice"], drink: ["water", "juice"], food: ["bread", "cheese", "meat", "jerky"], reagents: ["candle", "powder", "dust", "ankh", "rune"], quiver: ["quiver"], quivers: ["quiver"], bag: ["bag", "pouch"], bags: ["bag", "pouch"], "fishing pole": ["fishing pole"], pole: ["fishing pole"] };

function variants(q) {
  // "mankriks wife" -> also "mankrik wife"; "thrall's" -> "thrall".
  const base = loose(q);
  const v = new Set([base, base.replace(/\b(\w{4,})s\b/g, "$1")]);
  return [...v];
}
// Longest name of a kind that appears as whole words in the question (or a near spelling).
function mentioned(question, kind, index, { minLen = 4 } = {}) {
  const m = index.names[kind]; if (!m) return null;
  let best = null;
  for (const text of variants(question)) {
    const padded = ` ${text} `;
    // Whole-word n-grams up to 6 words, longest first.
    const words = text.split(" ");
    for (let len = Math.min(6, words.length); len >= 1; len--) {
      for (let i = 0; i + len <= words.length; i++) {
        const gram = words.slice(i, i + len).join(" ");
        if (gram.length < minLen || (len === 1 && STOP.has(gram))) continue;
        const ids = m.get(gram);
        if (ids && padded.includes(` ${gram} `) && (!best || gram.length > best.gram.length)) best = { gram, ids, kind };
      }
      if (best) return best;
    }
  }
  return best;
}
// Fuzzy fallback: one-letter slips in a name ("thral", "mankirk").
function lev(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function fuzzy(phrase, kind, index) {
  const p = loose(phrase); if (p.length < 4) return null;
  let best = null;
  for (const [name, ids] of index.names[kind]) {
    if (Math.abs(name.length - p.length) > 2) continue;
    const dist = lev(p, name); if (dist <= (p.length >= 7 ? 2 : 1) && (!best || dist < best.dist)) best = { gram: name, ids, kind, dist };
  }
  return best;
}
// The object of the question: what follows the question words ("where is X", "who is X").
function subject(question) {
  const q = norm(question).replace(/^(?:hey|hi|hello|greetings|ok|okay|so|um|uh|please|pls|yo)\b[ ,]*/g, "").replace(/\b(?:please|pls|thanks|thank you|mate|friend|buddy|companion)\b/g, "").trim();
  const m = q.match(/(?:where(?:'s| is| are| can i find| do i find)|who(?:'s| is)|how (?:do|can) i find|looking for|find|location of|seen)\s+(.+)$/);
  return (m ? m[1] : q).replace(/\b(?:at|in|near)\s+(?:the\s+)?[a-z' ]+$/, (t) => t).replace(/^(?:the|a|an)\s+/, "").trim();
}
const ZONE_SHORT = (() => {
  const out = { stv: "Stranglethorn Vale", barrens: "The Barrens", ungoro: "Un'Goro Crater", epl: "Eastern Plaguelands", wpl: "Western Plaguelands", hillsbrad: "Hillsbrad Foothills", hinterlands: "The Hinterlands", needles: "Thousand Needles", stonetalon: "Stonetalon Mountains", redridge: "Redridge Mountains", arathi: "Arathi Highlands", alterac: "Alterac Mountains", dustwallow: "Dustwallow Marsh", tirisfal: "Tirisfal Glades", silverpine: "Silverpine Forest", elwynn: "Elwynn Forest", loch: "Loch Modan" };
  for (const z of Object.values(MAP_NAMES)) { const first = loose(z).replace(/^the /, "").split(" ")[0]; if (first.length >= 6 && !out[first]) out[first] = z; }
  return out;
})();
function placeIn(question) {
  const q = ` ${loose(question)} `;
  let best = null;
  for (const [alias, place] of Object.entries(ZONE_SHORT)) if (q.includes(` ${alias} `) && (!best || alias.length > best.alias.length)) best = { alias, place };
  for (const [alias, place] of Object.entries(PLACES)) if (place && q.includes(` ${loose(alias)} `) && (!best || alias.length > best.alias.length)) best = { alias, place };
  for (const name of Object.values(MAP_NAMES)) { const k = loose(name).replace(/^the /, ""); if (q.includes(` ${k} `) && (!best || k.length > best.alias.length)) best = { alias: k, place: name }; }
  return best?.place || null;
}
function placesIn(question) {
  const q = ` ${loose(question)} `, found = [];
  const add = (alias, place) => { const k = loose(alias).replace(/^the /, ""); if (k.length < 2) return; let i = q.indexOf(` ${k} `); while (i >= 0) { found.push({ place, start: i, end: i + k.length }); i = q.indexOf(` ${k} `, i + 1); } };
  for (const [alias, place] of Object.entries(PLACES)) if (place) add(alias, place);
  for (const [alias, place] of Object.entries(ZONE_SHORT)) add(alias, place);
  for (const name of Object.values(MAP_NAMES)) add(name, name);
  for (const t of TOWNS) add(t.name, t.name);
  found.sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept = [];
  for (const f of found) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  return kept.sort((a, b) => a.start - b.start).map((f) => f.place);
}
function pointOf(place) {
  if (!place) return null;
  const t = TOWNS.find((x) => loose(x.name).replace(/^the /, "") === loose(place).replace(/^the /, ""));
  if (t) return { mapId: t.mapId, x: t.x, y: t.y, town: t.name };
  const z = Object.entries(MAP_NAMES).find(([, n]) => n === place);
  return z ? { mapId: Number(z[0]) } : TOWN_ZONE[place] ? { mapId: TOWN_ZONE[place] } : null;
}
// A name found through one distinctive word ("the apothecary dude, helbrim" -> Apothecary Helbrim).
function byToken(question, kind, index) {
  const words = new Set(variants(question).flatMap((v) => v.split(" ")));
  const score = new Map();
  for (const w of words) for (const id of index.tokens[kind].get(w) || []) score.set(id, (score.get(id) || 0) + 1);
  if (!score.size) return null;
  const top = Math.max(...score.values()), ids = [...score].filter(([, n]) => n === top).map(([id]) => id);
  if (ids.length > 12) return null;
  const pick = kind === "npc" ? index.npcs.get(ids[0]) : index.creatures.get(ids[0]);
  return { gram: loose(pick?.name || ""), ids, kind };
}
function dungeonIn(question) {
  const q = ` ${loose(question)} `;
  let best = null;
  for (const [alias, id] of Object.entries(DUNGEON_ALIASES)) { const k = loose(alias); if (q.includes(` ${k} `) && (!best || k.length > best.k.length)) best = { k, id }; }
  // "dm" alone means The Deadmines only when it is not "dire maul".
  return best ? DUNGEONS.get(best.id) : null;
}
function classIn(question) { const q = ` ${loose(question)} `; return CLASSES.find((c) => q.includes(` ${c} `) || q.includes(` ${c}s `)) || null; }
function professionIn(question) {
  const q = ` ${loose(question)} `;
  for (const p of Object.keys(PROFESSIONS)) if (q.includes(` ${p} `)) return p;
  for (const [a, p] of Object.entries(PROF_ALIASES)) if (q.includes(` ${a} `)) return p;
  return null;
}

const RX = {
  turnin: /\b(turn(?:ing)? ?in|hand(?:ing)? ?in|hand (?:it|this|them|.+?) (?:in )?to|who do i (?:give|hand|bring|take)|who wants (?:them|it|these|those)|who (?:takes|gets) (?:them|it)|deliver|complete the quest)\b/,
  trainer: /\b(trainers?|train(?:ing)?|learn (?:new )?(?:spells|skills|abilities|ranks))\b/,
  vendor: /\b(buy|buying|purchase|sells?|selling|vendors?|merchant|shop|restock|supplies)\b|\b(?:need|grab|get|pick up|stock up on)\s+(?:some |more )?(?:food|water|drinks?|arrows|ammo|bullets|thread|reagents|candles|bags?|bread|vials?)\b/,
  drops: /\bwhat (?:does|do|did) (.+?) drop\b|\bloot (?:from|of)\b/,
  source: /\bwhere (?:do|can|could|should) i (?:get|find|farm|obtain|loot|collect|gather)\b|\bhow (?:do|can) i get (?!to\b)|\bfarm(?:ing)?\b|\bwhere (?:are|is|does) .+? (?:found|dropped|drop)\b|\bwho drops\b|\bwhat drops\b|\bwhere does .+ drop\b|\bwhich .+? drops?\b|\bdo .+? drop (?:em|them|it)\b|\bdrop (?:em|them)\b|\bwho has (?:it|them|one)\b/,
  travel: /\b(how (?:do|can|should) i (?:even )?get (?:to|there)|take me to|way to|way from|route to|path to|directions? to|go to|fly to|get to|travel to|how far|run to|walk to|head to|reach|catch the (?:zeppelin|boat|ship|tram)|take the (?:zeppelin|boat|ship|tram)|hop on the (?:zeppelin|boat|ship|tram)|zeppelin (?:to|from)|boat (?:to|from)|tram (?:to|from)|from here|never been to)\b/,
  who: /\b(who(?:'s| is| are)|where(?:'s| is| are)|wheres|where can i find|where do i find|how (?:do|can) i find|looking for|location of|find|seen|is there an?|where does .+? (?:hang out|live|stay|hide)|where (?:are|is) (?:they|it) (?:hiding|at))\b/,
  next: /\b(what (?:should|do|can) i do|what(?:'s| is) next|next (?:quest|step)|what quest(?:s)? (?:should|can|do)|i(?:'m| am) (?:lost|stuck|bored)|help me level|where (?:should|do) i (?:level|quest|go)|what now|lost,? help|any (?:tasks|work|quests|errands|jobs)|anything (?:to do|for me)|need (?:work|a task))\b/,
  quest: /\bquests?\b|\bwhat(?:'s| is|s) .+? about\b/,
  lore: /\b(lore|story|history|tell me about|who rules|leader of|why (?:does|do|did|is))\b/,
};

// Roles players ask for by job, not name.
const ROLES = [
  { id: "flight", rx: /\b(flight ?(?:master|path|point)|gryphon|griffon|wind ?rider|bat (?:handler|master)|hippogryph|fp)\b/ },
  { id: "inn", rx: /\b(inn ?keeper|innkeeper|an inn|the inn|tavern|hearth(?:stone)? (?:at|in|to))\b/, name: /^innkeeper\b/ },
  { id: "auction", rx: /\b(auction ?(?:house|eer)?|(?:the|to|at|nearest|an?) ah)\b/, name: /^auctioneer\b/ },
  { id: "bank", rx: /\b(bank(?:er)?)\b/, name: /^banker\b/ },
  { id: "weapon", rx: /\b(weapon ?master|weapon skills?|(?:learn|teach(?:es)?|train) (?:to use |me )?(?:two ?handed |one ?handed |2h |1h )?(?:swords?|axes?|maces?|daggers?|staves|staff|bows?|guns?|crossbows?|polearms?|fist weapons?|thrown)|who teaches (?:two ?handed |one ?handed |2h |1h )?(?:swords?|axes?|maces?|daggers?|staves|staff|bows?|guns?|crossbows?|polearms?|fist weapons?|thrown))\b/, title: /weapon master/i },
  { id: "stable", rx: /\b(stable ?master|stables?)\b/, name: /^stable ?master\b/ },
];
// Names that contain every word of the question's subject ("lady sylvanas" -> Lady Sylvanas Windrunner).
function partial(phrase, kind, index) {
  const words = loose(phrase).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
  if (!words.length) return null;
  let best = null;
  for (const [name, ids] of index.names[kind]) {
    const nw = name.split(" ");
    if (words.every((w) => nw.some((x) => x === w || (w.length >= 5 && x.startsWith(w)))) && (!best || name.length < best.gram.length)) best = { gram: name, ids, kind };
  }
  return best;
}
const slang = (s) => norm(s).replace(/\bwheres\b/g, "where's").replace(/\bwhats\b/g, "what's").replace(/\bwhos\b/g, "who's").replace(/\bzeps?\b/g, "zeppelin").replace(/\blvl\b/g, "level").replace(/\bw\/e\b/g, "").replace(/\br\b/g, "are");
function understand(question, { profile = null, data = loadData() } = {}) {
  const q = slang(question), idx = data.index;
  const dungeon = dungeonIn(question), place = placeIn(question), cls = classIn(question), prof = professionIn(question);
  const npc = mentioned(question, "npc", idx), quest = mentioned(question, "quest", idx, { minLen: 6 }), item = mentioned(question, "item", idx), creature = mentioned(question, "creature", idx);
  const recipe = mentioned(question, "recipe", idx, { minLen: 6 });
  const role = ROLES.find((r) => r.rx.test(q)) || null;
  const out = { intent: null, dungeon, place, cls, prof, npc, quest, item, creature, role, recipe };
  const who = RX.who.test(q), subj = subject(q);
  const someone = () => npc || partial(subj, "npc", idx) || byToken(q, "npc", idx) || fuzzy(subj, "npc", idx);
  const beast = () => {
    if (creature && (!npc || creature.gram.length > npc.gram.length) && !(npc && creature.ids.every((id) => npc.ids.includes(id)))) return creature;
    const t = byToken(q.split(" ").filter((w) => !npc || !npc.gram.split(" ").includes(w.replace(/'/g, ""))).join(" "), "creature", idx);
    if (!t) return null;
    const located = t.ids.filter((id) => idx.creatureAreas.has(id));
    return located.length ? { ...t, ids: located, gram: loose(idx.creatures.get(located[0])?.name || t.gram) } : t;
  };
  const questy = quest && quest.gram.split(" ").length >= 2;
  if (RX.turnin.test(q)) { out.intent = quest || (item && idx.itemQuest.get(item.ids[0])) ? "quest-turnin" : "turnin-which"; if (!quest && item) out.questFromItem = idx.itemQuest.get(item.ids[0]) || null; }
  else if (recipe && /\b(skill|level|rank|need|make|craft|learn)\b/.test(q)) out.intent = "recipe";
  else if ((RX.trainer.test(q) || /\b(learn|teach(?:es)?|taught)\b/.test(q)) && (cls || prof || /\b(my|class) (?:spells|skills|abilities|trainer)\b|\btrain my\b/.test(q)) && role?.id !== "weapon") out.intent = "trainer";
  else if (role && (who || role.id === "weapon" || /\b(near|in|at|nearest|closest|any)\b/.test(q) || RX.vendor.test(q) === false)) out.intent = "role";
  else if (who && /\bwhy\b|\bstory\b|\blore\b/.test(q)) out.intent = "lore";
  else if (questy && (!npc || quest.gram.length > npc.gram.length) && !RX.travel.test(q) && (RX.quest.test(q) || who || /\?|\bwants?\b|\bwhich\b/.test(q))) out.intent = "quest-info";
  else if (/\bwhat (?:does|do|did) .+? drop\b/.test(q) && (creature || npc || byToken(q, "creature", idx) || fuzzy(subject(q.replace(/^what (?:does|do|did)\s+/, "").replace(/\s+drop.*$/, "")), "creature", idx))) { out.intent = "drops"; out.creature = creature || (npc && idx.creatures.has(npc.ids[0]) ? npc : null) || byToken(q, "creature", idx) || fuzzy(subject(q.replace(/^what (?:does|do|did)\s+/, "").replace(/\s+drop.*$/, "")), "creature", idx); }
  else if (/\b(mine|mining|pick|picking|gather|gathering|herb(?:s|alism)?|nodes?|veins?)\b/.test(q) && Object.keys(GATHER_WORDS).some((k) => new RegExp(`\\b${k}\\b`).test(q)) && !/\b(learn|train|teach|trainer)\b/.test(q)) out.intent = "gather";
  else if (RX.source.test(q) && (item || Object.keys(CATEGORY_ITEMS).some((k) => q.includes(k)))) out.intent = "item-source";
  else if (quest && RX.source.test(q)) out.intent = "quest-info";
  else if (RX.vendor.test(q) && !/\bsell (?:my )?junk\b/.test(q)) out.intent = "vendor";
  else if (dungeon && !RX.travel.test(q)) out.intent = "dungeon";
  else if (RX.travel.test(q) && (place || dungeon || /\bfrom here\b/.test(q))) out.intent = "travel";
  else if (who && /\b(kill|slay|hunt|hiding|mobs?|they|them)\b/.test(q) && beast()) { out.intent = "creature"; out.creature = beast(); }
  else if (who && creature && (!npc || creature.gram.length > npc.gram.length) && creature.ids.some((id) => idx.creatureAreas.has(id)) && beast()) { out.intent = "creature"; out.creature = beast(); }
  else if (who && npc && (!item || npc.gram.length >= item.gram.length) && !/\b(drop|drops|farm|loot)\b/.test(q)) out.intent = "npc-location";
  else if (RX.next.test(q)) out.intent = "quest-next";
  else if (quest && (RX.quest.test(q) || who || /\bwhat(?:'s| is)\b/.test(q))) out.intent = "quest-info";
  else if (who && someone()) { out.intent = "npc-location"; out.npc = someone(); }
  else if (who && beast()) { out.intent = "creature"; out.creature = beast(); }
  else if (who && place) out.intent = "place";
  else if (prof) out.intent = "profession";
  else if (RX.lore.test(q)) out.intent = "lore";
  else out.intent = "rp";
  if (out.intent === "lore" && !out.npc) out.npc = someone();
  return out;
}

// ---------- answers ----------
const side = (profile) => (["Horde", "Alliance"].includes(profile?.faction) ? profile.faction : null);
const CAPITAL = { 1454: "Horde", 1456: "Horde", 1458: "Horde", 1453: "Alliance", 1455: "Alliance", 1457: "Alliance" };
// Friendly to the player's faction: observed friendly, or not observed but only seen friendly by nobody
// else and not standing in the other faction's capital.
function friendly(reactions, faction, positions = []) {
  if (!faction) return true;
  const mine = reactions?.[faction], other = reactions?.[faction === "Horde" ? "Alliance" : "Horde"];
  if (Array.isArray(mine) && mine.length) return mine.every((n) => n >= 4);
  if (Array.isArray(other) && other.length && other.every((n) => n >= 5)) return false;
  return !positions.some((p) => (CAPITAL[p.mapId] || HOME_ZONE_SIDE()[p.mapId]) && (CAPITAL[p.mapId] || HOME_ZONE_SIDE()[p.mapId]) !== faction);
}
let homeZoneSide = null;
const HOME_ZONE_SIDE = () => homeZoneSide || (homeZoneSide = Object.fromEntries([["Durotar", "Horde"], ["Mulgore", "Horde"], ["Tirisfal Glades", "Horde"], ["Elwynn Forest", "Alliance"], ["Dun Morogh", "Alliance"], ["Teldrassil", "Alliance"]].map(([z, sd]) => [Object.entries(MAP_NAMES).find(([, n]) => n === z)?.[0], sd]).filter(([id]) => id)));
const here = (profile) => (profile?.location && Number.isFinite(profile.location.mapId) ? profile.location : null);
// Same map by distance, then the same continent, then across the sea.
const KALIMDOR_MAPS = new Set([1411, 1412, 1413, 1414, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457]);
// 1.0.1: a capital next to the zone you're in comes before the rest of the continent.
const CAPITAL_NEXT_TO = { 1454: [1411, 1413], 1456: [1412, 1413], 1458: [1420, 1421], 1453: [1429, 1436, 1433], 1455: [1426, 1432], 1457: [1438] };
const nextDoor = (a, b) => (CAPITAL_NEXT_TO[a] || []).includes(b) || (CAPITAL_NEXT_TO[b] || []).includes(a);
const near = (p, h) => (h && p.mapId === h.mapId && Number.isFinite(h.x) ? Math.hypot(p.x - h.x, p.y - h.y) : p.mapId === h?.mapId ? 0.5 : h && nextDoor(p.mapId, h.mapId) ? 2 : h && KALIMDOR_MAPS.has(p.mapId) === KALIMDOR_MAPS.has(h.mapId) ? 5 : 9);
let TOWNS = [];
const townAt = (p) => { let best = null; for (const t of TOWNS) if (t.mapId === p.mapId) { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < 0.07 && (!best || d < best.d)) best = { ...t, d }; } return best?.name || null; };
function where(p, h) {
  const z = zoneOf(p.mapId) || `map ${p.mapId}`, town = townAt(p);
  let s = `${town && loose(town) !== loose(z) ? `${town}, ${z}` : z}, around ${pct(p.x)}, ${pct(p.y)}`;
  if (h && !h.asked && p.mapId === h.mapId && Number.isFinite(h.x)) { const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy); if (d < 0.015) s += " (right where you are)"; else s += ` (${["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 / 45) % 8]} of you)`; }
  return s;
}
const SRC = "Locations are approximate player-observed points (Efficient Games, CC BY 4.0).";
function npcSide(n, faction, data) { return !faction || !n.side || n.side === faction || n.side === "Both" || n.side === "Neutral"; }

function answerNpc(u, { profile, data }) {
  const ids = u.npc?.ids || [];
  const list = ids.map((id) => data.index.npcs.get(id)).filter((n) => n?.positions.length);
  if (!list.length) return null;
  const h = here(profile), faction = side(profile);
  list.sort((a, b) => (npcSide(b, faction) ? 1 : 0) - (npcSide(a, faction) ? 1 : 0) || near(a.positions[0], h) - near(b.positions[0], h));
  const n = list[0], p = [...n.positions].sort((a, b) => near(a, h) - near(b, h))[0];
  const text = `${n.name} is in ${where(p, h)}.${n.side && faction && n.side !== faction && !["Both", "Neutral"].includes(n.side) ? ` ${n.name} is with the ${n.side}, so expect a hostile welcome.` : ""}`;
  return { text: `${text}\n${SRC}`, facts: [`NPC ${n.name}: ${where(p, null)}${n.side ? ` (${n.side})` : ""}.`] };
}
function answerPlace(u, { profile }) {
  const town = u.place, mapId = TOWN_ZONE[town];
  if (mapId) return { text: `${town} is in ${zoneOf(mapId)}.`, facts: [`${town} is a town in ${zoneOf(mapId)}.`] };
  return { text: `${town} is its own zone on the world map.`, facts: [`${town} is a zone.`] };
}
const PROF_TITLE = { alchemy: /alchem/i, blacksmithing: /blacksmith/i, enchanting: /enchant/i, engineering: /engineer/i, herbalism: /herbalis/i, leatherworking: /leatherwork/i, mining: /\bmin(?:ing|er)\b/i, skinning: /skinn/i, tailoring: /tailor/i, cooking: /\bcook/i, "first aid": /first aid|physician|doctor/i, fishing: /fish/i };
function trainerTitle(t, want) { return want instanceof RegExp ? want.test(t.title) : new RegExp(`\\b${want}\\b`, "i").test(t.title); }
function answerTrainer(u, { profile, data }) {
  const faction = side(profile), h = here(profile);
  const cls = u.cls || (!u.prof && /\b(my|class)\b/.test(norm(u.q || "")) ? String(profile?.className || "").toLowerCase() : null);
  const want = u.prof ? PROF_TITLE[u.prof] : cls ? `${cls} trainer` : null;
  if (!want) return null;
  const label = u.prof ? `${u.prof[0].toUpperCase()}${u.prof.slice(1)} trainer` : `${cls[0].toUpperCase()}${cls.slice(1)} trainer`;
  let rows = data.index.trainers.filter((t) => trainerTitle(t, want) && friendly(t.observedReactionsByFaction, faction, t.positions));
  let note = "";
  if (u.place) { const there = inPlace(rows, u.place, (t) => t.positions); if (there.length) rows = there; else if (rows.length) note = `I don't have one observed in ${u.place}; the nearest I know:\n`; }
  if (!rows.length) return { text: `I don't have a ${label.toLowerCase()} for ${faction || "your faction"} in the Forever reference yet, so I won't guess one. Capital cities usually have them; ask a city guard in game.`, facts: [`No observed ${label.toLowerCase()} for ${faction || "this faction"} in the reference.`] };
  rows.sort((a, b) => near(a.positions[0], h) - near(b.positions[0], h));
  const top = rows.slice(0, 3).map((t) => `${t.name} (${t.title}) in ${where(t.positions[0], h)}`);
  return { text: `${note}${label}${rows.length > 1 ? "s" : ""} for you:\n${top.map((s) => "• " + s).join("\n")}\n${SRC}`, facts: rows.slice(0, 3).map((t) => `${t.title} ${t.name}: ${where(t.positions[0], null)}.`) };
}
function itemsFor(u, q, data) {
  const words = Object.entries(CATEGORY_ITEMS).find(([k]) => new RegExp(`\\b${k}\\b`).test(q))?.[1];
  if (u.item && !(words && u.item.gram.split(" ").length === 1)) return u.item.ids;
  if (!words) return [];
  const ids = [];
  for (const [id, name] of data.index.items) if (words.some((w) => loose(name).includes(w))) ids.push(id);
  return ids;
}
function answerVendor(u, { profile, data }) {
  const q = loose(u.q || ""), ids = new Set(itemsFor(u, q, data));
  if (!ids.size) return null;
  const faction = side(profile), h = here(profile);
  const sellers = (data.vendors?.vendors || []).filter((v) => v.positions?.length && v.listings.some((l) => ids.has(l.itemId)) && friendly(v.observedReactionsByFaction, faction, v.positions));
  if (!sellers.length) return { text: `I haven't seen a ${faction ? faction + "-friendly " : ""}vendor selling that in the Forever reference, so I won't guess one.`, facts: [] };
  const placed = u.place ? inPlace(sellers, u.place, (v) => v.positions) : sellers;
  let lead = "Where to buy it:";
  if (placed.length) sellers.splice(0, sellers.length, ...placed); else if (u.place) lead = `I haven't seen it sold in ${u.place}; the nearest sellers I know:`;
  sellers.sort((a, b) => near(a.positions[0], h) - near(b.positions[0], h));
  const rows = sellers.slice(0, 3).map((v) => { const what = [...new Set(v.listings.filter((l) => ids.has(l.itemId)).map((l) => l.name))].slice(0, 3).join(", "); return `${v.name} in ${where(v.positions[0], h)} sells ${what}`; });
  return { text: `${lead}\n${rows.map((s) => "• " + s).join("\n")}\nPrices and stock aren't guaranteed. ${SRC}`, facts: rows.map((r) => r.replace(/ \((?:right where you are|[a-z-]+ of you)\)/, "") + ".") };
}
function answerDrops(u, { data }) {
  const c = u.creature; if (!c) return null;
  const id = c.ids[0], cr = data.index.creatures.get(id), name = cr?.name || c.gram;
  const list = (data.index.drops.get(id) || []).sort((a, b) => b.chance - a.chance).slice(0, 6);
  const giver = [...data.index.quests.values()].find((q) => (q.givers || []).some((g) => (g.id ?? g) === id || loose(g.name) === loose(name)));
  if (!list.length) {
    const friendlyNpc = cr && Array.isArray(cr.hostileTo) && cr.hostileTo.length === 0;
    return { text: `${name} isn't seen dropping anything in the Forever loot reference.${friendlyNpc ? ` ${name} isn't hostile to players${giver ? ` and gives the quest "${giver.title}"` : ""}.` : ""}`, facts: [`${name}: no observed drops${friendlyNpc ? ", not hostile" : ""}${giver ? `, quest giver of "${giver.title}"` : ""}.`] };
  }
  const rows = list.filter((x) => data.index.items.has(x.itemId)).map((x) => `${data.index.items.get(x.itemId)} (${Math.round(x.chance * 100)}%)`);
  const inst = list.find((x) => x.instance)?.instance, place = inst ? ` in ${DUNGEONS.get(inst)?.name || inst}` : "";
  if (!rows.length) return { text: `${name}${place} drops items I can't name yet in the Forever reference.`, facts: [] };
  return { text: `${name}${place} was seen dropping: ${rows.join(", ")}. Drop chances are from community observations and aren't guaranteed.`, facts: [`${name}${place} drops: ${rows.join(", ")}.`] };
}
function answerItemSource(u, { profile, data }) {
  const q = loose(u.q || ""), ids = itemsFor(u, q, data).slice(0, 3);
  if (!ids.length) return null;
  const id = ids[0], name = data.index.items.get(id) || u.item?.gram;
  const h = here(profile), area = (s) => data.index.creatureAreas.get(s.id);
  const dist = (s) => (area(s) && h ? near(centerOf(area(s).positions), h) : 99);
  const all = (data.loot?.items?.[String(id)] || []).filter((s) => s.kind === "npc" && s.name);
  const bucket = (s) => { const d = dist(s); return d < 2 ? 0 : d < 6 ? 1 : 2; };
  const sources = (h ? all.sort((a, b) => bucket(a) - bucket(b) || b.chance - a.chance) : all.sort((a, b) => b.chance - a.chance)).slice(0, 4);
  const parts = [];
  const elite = (s) => (data.index.creatures.get(s.id)?.elite ? ", elite" : "");
  const zoneTag = (s) => { const a = area(s); const z = a ? zoneOf(centerOf(a.positions).mapId) : null; return z ? `, ${z}` : ""; };
  if (sources.length) parts.push(`dropped by ${sources.map((s) => `${s.name} (${Math.round(s.chance * 100)}%${elite(s)}${zoneTag(s)})`).join(", ")}`);
  const bosses = h && all.some((s) => bucket(s) < 2) ? [] : (data.index.bossSources.get(id) || []).filter((b) => !h || !DUNGEONS.get(b.instance)?.mapId || KALIMDOR_MAPS.has(DUNGEONS.get(b.instance).mapId) === KALIMDOR_MAPS.has(h.mapId) || !all.length).slice(0, 3);
  if (bosses.length) parts.push(`dropped by ${bosses.map((b) => `${b.boss} in ${DUNGEONS.get(b.instance)?.name || b.instance} (${Math.round(b.chance * 100)}%)`).join(", ")}`);
  const forQuest = data.index.itemQuest.get(id);
  if (forQuest) { const t = (forQuest.turnIns || [])[0]; parts.push(`it's for the quest "${forQuest.title}"${t ? `, turned in to ${npcWhere(t, data, here(profile))}` : ""}`); }
  const v = answerVendor({ ...u, item: { ids: [id], gram: name } }, { profile, data });
  if (v?.facts?.length) parts.push(`sold by ${v.facts.map((f) => f.split(" sells ")[0]).join("; ")}`);
  if (!parts.length) return { text: `I don't have a source for ${name} in the Forever reference yet, so I won't guess one.`, facts: [] };
  return { text: `${name}: ${parts.join(". Also ")}.\nCommunity observations; chances and stock aren't guaranteed.`, facts: [`${name}: ${parts.join("; ")}.`] };
}
function questById(u, data, profile) {
  if (!u.quest) return null;
  const list = u.quest.ids.map((id) => data.index.quests.get(id)).filter(Boolean);
  const active = new Set((profile?.quests || []).map((q) => q.id));
  const asked = new Set(loose(u.q || "").split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !loose(list[0]?.title || "").split(" ").includes(w)));
  const textScore = (q) => [...asked].filter((w) => loose(`${q.objectiveEvidence || ""}`).split(" ").some((x) => x.startsWith(w))).length;
  if (list.length > 1 && asked.size) { const best = [...list].sort((a, b) => textScore(b) - textScore(a)); if (textScore(best[0]) > textScore(best[1])) return best[0]; }
  if (/\b(last|final)\b/.test(loose(u.q || "")) && list.length > 1) return [...list].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  // The one in the player's log, else the one nearest their level.
  return list.find((q) => active.has(q.id)) || list.sort((a, b) => Math.abs((a.level ?? 99) - (profile?.level ?? 0)) - Math.abs((b.level ?? 99) - (profile?.level ?? 0)))[0] || null;
}
function npcWhere(ref, data, h) { const id = ref?.id ?? ref; const n = data.index.npcs.get(id); return n?.positions.length ? `${n.name} in ${where(n.positions[0], h)}` : ref?.name || null; }
function answerQuest(u, { profile, data }) {
  const q = questById(u, data, profile) || u.questFromItem || null; if (!q) return null;
  const others = (u.quest?.ids || []).map((id) => data.index.quests.get(id)).filter((x) => x && x.id !== q.id);
  const h = here(profile);
  const turnin = (q.turnIns || q.turnin || []).map((t) => npcWhere(t, data, h)).filter(Boolean)[0];
  const giver = (q.givers || []).map((t) => npcWhere(t, data, h)).filter(Boolean)[0];
  const obj = q.objectiveEvidence || q.objectives?.map((o) => o.text).filter(Boolean).join("; ");
  const area = (q.objectiveLocations || [])[0]?.positions?.[0];
  if (u.intent === "quest-turnin") {
    if (!turnin) return { text: `I don't have the turn-in for "${q.title}" in the reference.`, facts: [] };
    return { text: `Turn in "${q.title}" to ${turnin}.`, facts: [`Quest "${q.title}" (level ${q.level ?? "?"}) turns in to ${turnin}.`] };
  }
  const lines = [`"${q.title}"${q.level ? ` (level ${q.level})` : ""}${giver ? `, from ${giver}` : ""}.`];
  if (obj) lines.push(`Goal: ${String(obj).slice(0, 240)}`);
  const areas = (q.objectiveLocations || []).filter((l) => l.positions?.length);
  for (const l of areas.slice(0, 3)) lines.push(`Objective ${l.index}${l.type === "monster" ? ` (${data.index.creatures.get((q.objectives || []).find((o) => o.index === l.index)?.objectId)?.name || "targets"})` : ""}: around ${where(centerOf(l.positions), h)}.`);
  if (!areas.length && area) lines.push(`Objective area: ${where(area, h)}.`);
  for (const o of (q.objectives || []).filter((x) => x.type === "item").slice(0, 2)) {
    const name = data.index.items.get(o.objectId), from = (data.loot?.items?.[String(o.objectId)] || []).filter((x) => x.name).sort((a, b) => b.chance - a.chance).slice(0, 2);
    if (name && from.length) lines.push(`${name} drops from ${from.map((x) => `${x.name} (${Math.round(x.chance * 100)}%)`).join(", ")}.`);
  }
  if (turnin) lines.push(`Turn in to ${turnin}.`);
  for (const o of others.slice(0, 2)) { const g = (o.givers || []).map((t) => npcWhere(t, data, h)).filter(Boolean)[0]; lines.push(`There's also a "${o.title}"${o.level ? ` (level ${o.level})` : ""}${g ? ` from ${g}` : ""}.`); }
  return { text: lines.join("\n"), facts: [lines.join(" ")] };
}
function answerDungeon(u, { profile }) {
  const d = u.dungeon; if (!d) return null;
  const lvl = profile?.level;
  const fit = Number.isFinite(lvl) ? (lvl < d.min - 2 ? ` At level ${lvl} it's still too hard; come back around ${d.min}.` : lvl > d.max + 3 ? ` At level ${lvl} it's easy and gives little XP.` : ` Level ${lvl} fits.`) : "";
  const ent = d.entrance ? ` The entrance is around ${d.entrance[0]}, ${d.entrance[1]} in ${d.zone}.` : "";
  const text = `${d.name} is a ${d.kind === "raid" ? "raid" : "dungeon"} in ${d.zone} for levels ${d.min}–${d.max}${d.faction ? ` (mainly ${d.faction})` : ""}.${ent}${fit}${d.bosses.length ? `\nBosses: ${d.bosses.join(", ")}.` : ""}`;
  return { text, facts: [`${d.name}: ${d.kind} in ${d.zone}, levels ${d.min}-${d.max}${d.entrance ? `, entrance ~${d.entrance[0]}, ${d.entrance[1]}` : ""}; bosses ${d.bosses.join(", ")}.`] };
}
function flightNear(profile, data) {
  const h = here(profile), faction = side(profile);
  if (!h) return null;
  const list = data.index.flight.filter((n) => n.positions.some((p) => p.mapId === h.mapId) && npcSide(n, faction)).sort((a, b) => near(a.positions[0], h) - near(b.positions[0], h));
  return list[0] || null;
}
function answerTravel(u, { profile, data }) {
  const ends = travelEnds(u, profile);
  const dest = u.dungeon ? `${u.dungeon.name} (${u.dungeon.zone})` : ends.dest;
  if (!dest) return null;
  const dp = pointOf(ends.dest), destZone = u.dungeon ? u.dungeon.zone : dp ? zoneOf(dp.mapId) : ends.dest;
  const startPt = ends.origin ? pointOf(ends.origin) : here(profile);
  const h = startPt && Number.isFinite(startPt.x) ? startPt : ends.origin ? { ...startPt, x: 0.5, y: 0.5 } : here(profile);
  const fm = h ? flightNear({ ...(profile || {}), location: h }, data) : null;
  const lines = [`${dest}${destZone && destZone !== dest && !u.dungeon ? ` is in ${destZone}` : ""}.`];
  if (h && zoneOf(h.mapId) === destZone && !ends.origin) lines.push("You're already in that zone.");
  else if (fm) lines.push(`${ends.origin ? `From ${ends.origin}, the` : "Your nearest"} flight master is ${fm.name} in ${where(fm.positions.find((p) => p.mapId === h.mapId), ends.origin ? null : h)}; fly toward ${destZone} if you have that flight path, otherwise ride there.`);
  else return null;
  return { text: lines.join(" "), facts: [lines.join(" ")] };
}

function placeMapId(place) {
  if (!place) return null;
  const m = Object.entries(MAP_NAMES).find(([, n]) => n === place);
  if (m) return { mapId: Number(m[0]) };
  const t = TOWNS.find((x) => loose(x.name).replace(/^the /, "") === loose(place).replace(/^the /, ""));
  return t ? { mapId: t.mapId, town: t } : TOWN_ZONE[place] ? { mapId: TOWN_ZONE[place] } : null;
}
// Narrow a list of located things to a named place (a town keeps those near it).
function inPlace(rows, place, posOf) {
  const at = placeMapId(place); if (!at) return rows;
  const town = rows.filter((r) => posOf(r).some((p) => p.mapId === at.mapId && (!at.town || Math.hypot(p.x - at.town.x, p.y - at.town.y) < 0.06)));
  if (town.length) return town;
  return rows.filter((r) => posOf(r).some((p) => p.mapId === at.mapId));
}
function answerRole(u, { profile, data }) {
  const r = u.role, faction = side(profile), h = here(profile);
  let rows;
  if (r.id === "flight") rows = data.index.flight.filter((n) => npcSide(n, faction));
  else if (r.title) rows = data.index.trainers.filter((t) => r.title.test(t.title) && friendly(t.observedReactionsByFaction, faction, t.positions));
  else rows = [...data.index.npcs.values()].filter((n) => r.name.test(loose(n.name)) && n.positions.length && npcSide(n, faction) && friendly(null, faction, n.positions));
  const label = { flight: "flight master", inn: "innkeeper", auction: "auctioneer", bank: "banker", weapon: "weapon master", stable: "stable master" }[r.id];
  if (r.id === "weapon") {
    const q = slang(u.q), two = /\b(two ?handed|2h)\b/.test(q), one = /\b(one ?handed|1h)\b/.test(q);
    const w = (q.match(/\b(swords?|axes?|maces?|daggers?|staves|staff|bows?|guns?|crossbows?|polearms?|fist|thrown)\b/) || [])[1];
    if (w) { const stem = w.replace(/s$/, "").replace(/^staff$|^stave$/, "stave").replace(/^bow$/, "bow"); const want = (sv) => { const n = loose(sv.name); return n.includes(stem) && (!two || n.startsWith("two")) && (!one || n.startsWith("one")) && !(stem === "bow" && n.includes("crossbow")); }; const teach = rows.filter((t) => (t.services || []).some(want)); if (teach.length) rows = teach; }
  }
  if (u.place) rows = inPlace(rows, u.place, (x) => x.positions);
  else if (h && r.id !== "weapon") { const local = rows.filter((x) => x.positions.some((p) => p.mapId === h.mapId)); if (local.length) rows = local; }
  if (!rows.length) return { text: `I don't have a ${faction ? faction + " " : ""}${label}${u.place ? ` in ${u.place}` : " near you"} in the Forever reference, so I won't guess one.`, facts: [] };
  rows.sort((a, b) => near(a.positions[0], h) - near(b.positions[0], h));
  const top = rows.slice(0, 2).map((n) => { const p = [...n.positions].sort((a, b) => near(a, h) - near(b, h))[0]; return `${n.name}${n.title ? ` (${n.title})` : ""} in ${where(p, h)}`; });
  return { text: `${top.length > 1 ? `${label[0].toUpperCase() + label.slice(1)}s` : `The ${label}`}: ${top.join("; ")}.\n${SRC}`, facts: top.map((t) => `${label}: ${t.replace(/ \((?:right where you are|[a-z-]+ of you)\)/, "")}.`) };
}
function answerTurninWhich(u, { profile, data }) {
  const ready = (profile?.quests || []).filter((q) => q.complete);
  if (!ready.length) return { text: "Which quest? Tell me its name and I'll say who takes it.", facts: [], clarify: true };
  const lines = ready.slice(0, 4).map((q) => { const rec = data.index.quests.get(q.id); const t = (rec?.turnIns || [])[0]; return `"${q.title}" -> ${t ? npcWhere(t, data, here(profile)) : "turn-in not in the reference"}`; });
  return { text: `Ready to turn in:\n${lines.map((l) => "• " + l).join("\n")}`, facts: lines };
}
function answerLore(u, { profile, data }) {
  const n = answerNpc(u, { profile, data });
  // Lore itself is the model's to tell in voice; the verified part is where they are.
  return n ? { text: n.text, facts: n.facts, model: true } : null;
}
function answerRp(u, { profile, data }) {
  const facts = [];
  const h = here(profile);
  if (h) { const town = townAt(h); facts.push(`${profile.name || "The character"} is in ${town ? `${town}, ` : ""}${zoneOf(h.mapId) || "an unnamed area"}.`); }
  if (u.place) { const at = placeMapId(u.place); facts.push(`${u.place}${at?.town ? ` is a town in ${zoneOf(at.mapId)}` : CAPITAL[at?.mapId] ? ` is a ${CAPITAL[at.mapId]} capital city` : " is a zone"}.`); }
  if (u.npc) { const n = answerNpc(u, { profile, data }); if (n) facts.push(...n.facts); }
  return facts.length ? { text: null, facts, model: true } : null;
}
const GATHER_WORDS = { copper: ["copper"], tin: ["tin"], silver: ["silver"], iron: ["iron"], gold: ["gold"], mithril: ["mithril"], peacebloom: ["peacebloom"], silverleaf: ["silverleaf"], earthroot: ["earthroot"], mageroyal: ["mageroyal"], briarthorn: ["briarthorn"], bruiseweed: ["bruiseweed"], stranglekelp: ["stranglekelp"], herbs: ["peacebloom", "silverleaf", "earthroot", "mageroyal", "briarthorn", "bruiseweed"], ore: ["copper", "tin", "iron", "silver"] };
function answerGather(u, { profile, data }) {
  const q = loose(u.q || ""), key = Object.keys(GATHER_WORDS).find((k) => new RegExp(`\\b${k}\\b`).test(q));
  if (!key) return null;
  const words = GATHER_WORDS[key], h = here(profile);
  let rows = [];
  try { rows = (require("./acquisition-data.cjs").loadAcquisitionPack().rows || []).filter((r) => r.kind === "gathered-object-loot" && words.some((w) => loose(`${r.referenceName} ${data.index.items.get(r.itemId) || ""}`).includes(w))); } catch {}
  const own = (profile?.gathering?.records || []).filter((r) => r && Number.isFinite(r.x) && words.some((w) => loose(r.name || "").includes(w)));
  const spots = [];
  for (const r of rows) for (const p of r.positions || []) spots.push({ name: r.referenceName || data.index.items.get(r.itemId), p, own: false });
  for (const r of own) spots.push({ name: r.name, p: { mapId: r.mapId, x: r.x, y: r.y }, own: true });
  if (u.place) { const at = placeMapId(u.place); if (at) { const there = spots.filter((x) => x.p.mapId === at.mapId); if (there.length) spots.splice(0, spots.length, ...there); } }
  if (!spots.length) return { text: `I don't have a recorded ${key} spot in the Forever reference yet. Spots you gather yourself are remembered and shown here and on the World Map.`, facts: [] };
  spots.sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0) || near(a.p, h) - near(b.p, h));
  // One line per spot, even when two records stood at the same point.
  const seen = new Set();
  const unique = spots.filter((x) => { const k = `${x.p.mapId}:${Math.round(x.p.x * 200)}:${Math.round(x.p.y * 200)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  spots.length = 0; spots.push(...unique);
  const lines = spots.slice(0, 4).map((x) => `${x.name} in ${where(x.p, h)}${x.own ? " (you gathered here)" : ""}`);
  const skill = /copper|tin|iron|silver|gold|mithril|ore/.test(key) ? "Mining" : "Herbalism";
  return { text: `${skill} spots:\n${lines.map((l) => "• " + l).join("\n")}\nRecorded gathering points; nodes respawn and move, so check nearby.`, facts: lines.map((l) => `${skill}: ${l}.`) };
}
function centerOf(points) {
  const byMap = new Map(); for (const pt of points) byMap.set(pt.mapId, [...(byMap.get(pt.mapId) || []), pt]);
  const best = [...byMap.values()].sort((a, b) => b.length - a.length)[0];
  return { mapId: best[0].mapId, x: best.reduce((n, pt) => n + pt.x, 0) / best.length, y: best.reduce((n, pt) => n + pt.y, 0) / best.length };
}
function answerCreature(u, { profile, data }) {
  const ids = u.creature?.ids || [];
  for (const id of ids) {
    const area = data.index.creatureAreas.get(id), name = data.index.creatures.get(id)?.name || u.creature.gram;
    if (!area) continue;
    const c = centerOf(area.positions), h = here(profile);
    const text = `${name} were seen around ${where(c, h)}${area.quests.length ? ` (for "${area.quests[0]}")` : ""}. That's where players fought them; they spread around that spot.`;
    return { text, facts: [`${name}: around ${where(c, null)}${area.quests.length ? `, quest "${area.quests[0]}"` : ""}.`] };
  }
  return null;
}
function answerRecipe(u, { profile, data }) {
  const r = data.index.recipes.get(u.recipe?.gram); if (!r) return null;
  const faction = side(profile), h = here(profile);
  const ts = r.trainers.filter((t) => friendly(t.observedReactionsByFaction, faction, t.positions)).sort((a, b) => near(a.positions[0], h) - near(b.positions[0], h)).slice(0, 2);
  const text = `${r.name} needs ${r.skill} ${r.rank}.${ts.length ? ` It's taught by ${ts.map((t) => `${t.name} (${t.title}) in ${where(t.positions[0], h)}`).join(" or ")}.` : ""}`;
  return { text, facts: [text] };
}
function answerProfession(u, ctx) { return answerTrainer({ ...u, cls: null }, ctx); }
const KALIMDOR = new Set([1411, 1412, 1413, 1414, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457]);
// Transport stops and the places they serve.
const STOPS = { "orgrimmar-zeppelin-tower": { serves: ["Orgrimmar", "Durotar"], k: true }, "tirisfal-zeppelin-tower": { serves: ["Undercity", "Tirisfal Glades"], k: false }, "gromgol-zeppelin-tower": { serves: ["Stranglethorn Vale", "Grom'gol Base Camp"], k: false }, "stormwind-harbour": { serves: ["Stormwind City", "Elwynn Forest"], k: false }, "auberdine-dock": { serves: ["Darkshore", "Auberdine"], k: true }, "stormwind-tram": { serves: ["Stormwind City"], k: false }, "ironforge-tram": { serves: ["Ironforge", "Dun Morogh"], k: false } };
function travelEnds(u, profile) {
  const q = loose(u.q), places = placesIn(u.q);
  const fromM = q.match(/\bfrom\s+(.+?)(?:\s+(?:to|where|how|if|and)\b|$)/);
  let origin = fromM && !/^here\b/.test(fromM[1]) ? placesIn(fromM[1])[0] || null : null;
  const toM = q.match(/\bto\s+(.+)$/);
  const dest = u.dungeon ? u.dungeon.zone : (toM && placesIn(toM[1]).find((pl) => pl !== origin)) || places.find((pl) => pl !== origin) || null;
  if (!origin && dest && /\b(zeppelin|boat|ship|tram)\b/.test(slang(u.q))) origin = places.find((pl) => pl !== dest) || null;
  return { origin, dest };
}
function answerTransport(u, { profile }) {
  const ref = readJson("data/forever-travel/pack.json"); if (!ref) return null;
  const ends = travelEnds(u, profile), dest = ends.dest; if (!dest) return null;
  const startPt = ends.origin ? pointOf(ends.origin) : here(profile);
  const faction = side(profile), h = startPt, onK = h ? KALIMDOR.has(h.mapId) : null;
  const label = (id) => ref.nodes.find((n) => n.id === id)?.label || id;
  const want = new RegExp(`\\b(${(slang(u.q).match(/\b(zeppelin|boat|ship|tram)\b/) || [])[1] || "zeppelin|boat|tram"})\\b`.replace("ship", "boat"));
  const served = (e) => STOPS[e.to]?.serves.includes(dest) || STOPS[e.to]?.serves.some((x) => loose(x).replace(/^the /, "") === loose(dest).replace(/^the /, ""));
  const all = ref.edges.filter((e) => e.mode !== "flight" && served(e) && want.test(e.mode.replace("ship", "boat")));
  const edges = all.filter((e) => !faction || !e.faction || e.faction === faction);
  if (!edges.length && all.length && faction) { const other = all[0].faction; const text = `The ${all[0].mode} from ${label(all[0].from)} to ${label(all[0].to)} is a ${other} route. As ${faction} you'd be boarding in hostile territory, so take your own faction's way instead.`; return { text, facts: [text] }; }
  if (!edges.length && /\b(zeppelin|boat|ship|tram)\b/.test(slang(u.q))) { const mode = slang(u.q).match(/\b(zeppelin|boat|ship|tram)\b/)[1]; const text = `There's no ${mode} to ${dest} in the travel reference${ends.origin ? ` from ${ends.origin}` : ""}. Fly there if you have the flight path, otherwise ride.`; return { text, facts: [text] }; }
  if (!edges.length) return null;
  // Prefer a departure on the player's own continent.
  const fromOrigin = (e) => (ends.origin && STOPS[e.from]?.serves.some((x) => loose(x) === loose(ends.origin)) ? 1 : 0);
  edges.sort((a, b) => fromOrigin(b) - fromOrigin(a) || (STOPS[b.from]?.k === onK ? 1 : 0) - (STOPS[a.from]?.k === onK ? 1 : 0));
  const e = edges[0], how = (e.steps || [])[0] || "";
  const text = `Take the ${e.mode} from ${label(e.from)} to ${label(e.to)}${STOPS[e.to] ? ` (${STOPS[e.to].serves.join(", ")})` : ""}. ${how}`.trim();
  return { text, facts: [text] };
}
function answerTravelPlan(u, { profile, data }) {
  const ends = travelEnds(u, profile), startPt = ends.origin ? pointOf(ends.origin) : here(profile), destPt = pointOf(ends.dest);
  // Walking within one zone: direction and the spot.
  if (startPt && destPt && startPt.mapId === destPt.mapId && Number.isFinite(destPt.x) && !/\b(zeppelin|boat|ship|tram)\b/.test(slang(u.q))) {
    const text = `${ends.dest} is ${where(destPt, startPt).replace(/^[^,]+, /, "in ")}.`.replace(/ \(([a-z-]+) of you\)/, " ($1 of you)");
    return { text, facts: [text] };
  }
  const transportDest = ["Undercity", "Tirisfal Glades", "Stranglethorn Vale", "Grom'gol Base Camp", "Darkshore", "Auberdine", "Ironforge", "Dun Morogh", "Stormwind City", "Orgrimmar", "Durotar"].includes(ends.dest);
  const crossSea = startPt && destPt && KALIMDOR.has(startPt.mapId) !== KALIMDOR.has(destPt.mapId);
  const t = /\b(zeppelin|boat|ship|tram)\b/.test(slang(u.q)) || (transportDest && (crossSea || ["Ironforge", "Dun Morogh"].includes(ends.dest))) ? answerTransport(u, { profile }) : null;
  if (t) return t;
  try {
    const { parseTravelIntent, planTravel } = require("./travel.cjs");
    const ref = readJson("data/forever-travel/pack.json");
    const h = here(profile), fromTown = ends.origin || (h ? townAt(h) || zoneOf(h.mapId) : null);
    const dest = ends.dest;
    const question = fromTown && dest ? `from ${fromTown} to ${dest}` : null;
    const intent = question ? parseTravelIntent(question, { profile }) : null;
    const plan = intent ? planTravel(ref, intent, { profile }) : null;
    if (plan?.status === "route" && plan.text) return { text: plan.text, facts: [plan.text.split("\n").slice(0, 6).join(" ")] };
  } catch {}
  return answerTravel(u, { profile, data });
}
const ANSWER = { "npc-location": answerNpc, place: answerPlace, trainer: answerTrainer, vendor: answerVendor, drops: answerDrops, "item-source": answerItemSource, "quest-info": answerQuest, "quest-turnin": answerQuest, dungeon: answerDungeon, travel: answerTravelPlan, role: answerRole, "turnin-which": answerTurninWhich, lore: answerLore, profession: answerProfession, rp: answerRp, gather: answerGather, creature: answerCreature, recipe: answerRecipe };
// 1.0.1: "the dwarf hunter trainer" or "first aid in Stormwind" with no character shared means the
// Alliance; a place the question names is where "nearest" is measured from.
const RACE_SIDE = [[/\b(humans?|dwarf|dwarves|dwarven|gnomes?|gnomish|night ?elf|night ?elves|kaldorei|alliance)\b/, "Alliance"], [/\b(orcs?|orcish|trolls?|tauren|undead|forsaken|horde)\b/, "Horde"]];
const SIDE_ZONES = { Alliance: ["Stormwind City", "Ironforge", "Darnassus", "Elwynn Forest", "Dun Morogh", "Teldrassil", "Westfall", "Loch Modan", "Darkshore", "Redridge Mountains", "Duskwood", "Wetlands"], Horde: ["Orgrimmar", "Thunder Bluff", "Undercity", "Durotar", "Mulgore", "Tirisfal Glades", "Silverpine Forest", "The Barrens"] };
function askedSide(question, u) {
  const q = loose(question), hits = new Set(RACE_SIDE.filter(([rx]) => rx.test(q)).map(([, side]) => side));
  if (hits.size) return hits.size === 1 ? [...hits][0] : null;
  if (u.intent === "travel" || !u.place) return null;
  const at = placeMapId(u.place), zone = at ? zoneOf(at.mapId) : null;
  return Object.keys(SIDE_ZONES).find((sd) => SIDE_ZONES[sd].includes(u.place) || SIDE_ZONES[sd].includes(zone)) || null;
}
const RACE_HOME = [[/\bhumans?\b/, "Stormwind City"], [/\b(dwarf|dwarves|dwarven|gnomes?|gnomish)\b/, "Ironforge"], [/\b(night ?elf|night ?elves|kaldorei)\b/, "Darnassus"], [/\b(orcs?|orcish|trolls?)\b/, "Orgrimmar"], [/\btauren\b/, "Thunder Bluff"], [/\b(undead|forsaken)\b/, "Undercity"]];
function askedProfile(question, u, p) {
  let out = p;
  if (!side(p)) { const sd = askedSide(question, u); if (sd) out = { ...(out || {}), faction: sd }; }
  if (!here(p) && u.intent !== "travel") {
    const homes = RACE_HOME.filter(([rx]) => rx.test(loose(question))).map(([, c]) => c);
    const place = u.place || (homes.length === 1 && ["trainer", "role", "vendor", "profession", "item-source", "gather"].includes(u.intent) ? homes[0] : null);
    const pt = place ? pointOf(place) : null;
    if (pt) out = { ...(out || {}), location: { mapId: pt.mapId, x: Number.isFinite(pt.x) ? pt.x : 0.5, y: Number.isFinite(pt.y) ? pt.y : 0.5, asked: true } };
  }
  return out;
}
function resolve(question, { profile = null, shareProfile = true, data = loadData() } = {}) {
  const shared = shareProfile ? profile : null;
  // 1.4 (J15): boss tips, class unlocks and reputation quests answer first when clearly asked.
  try {
    const sp = require("./companion-unlocks.cjs").answerSpecial(question, { profile: shared, pack: data.pack });
    if (sp) return { intent: sp.intent, understood: { intent: sp.intent, q: question }, answer: sp.text, facts: sp.facts, preferModel: false, clarify: false };
  } catch { /* fall through to the ordinary route */ }
  const u = understand(question, { profile: shared, data }); u.q = question;
  const p = askedProfile(question, u, shared);
  const fn = ANSWER[u.intent];
  let a = null;
  try { a = fn ? fn(u, { profile: p, data }) : null; } catch { a = null; }
  // Lore and roleplay are the model's to tell in voice; their facts ground it. Without a model the
  // lore answer still states what is verified.
  return { intent: u.intent, understood: u, answer: a?.text || null, facts: a?.facts || [], preferModel: Boolean(a?.model), clarify: Boolean(a?.clarify) };
}
// "Sentinel Hill, Westfall" for a point, for answers built elsewhere.
function placeLabel(p) { loadData(); const z = zoneOf(p.mapId), town = townAt(p); return z ? (town && loose(town) !== loose(z) ? `${town}, ${z}` : z) : null; }
module.exports = { understand, resolve, loadData, norm, placeLabel };

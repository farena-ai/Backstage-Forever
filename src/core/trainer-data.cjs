"use strict";
// Trainer costs (roadmap C6, D4): what class, profession, weapon and riding trainers teach,
// the level it needs and what it costs, as upstream players saw it in the trainer window.
// Built offline by scripts/build-forever-trainers.cjs from Efficient Games trainers.json and
// creature_details.enUS.json (CC BY 4.0). Facts only: no advice on what to skip.
const fs = require("node:fs"), path = require("node:path");

const FILES = Object.freeze(["trainers.json", "creature_details.enUS.json"]);
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMITS = Object.freeze({ "trainers.json": 8 * 1024 * 1024, "creature_details.enUS.json": 16 * 1024 * 1024 });
const PACK_LIMIT = 512 * 1024, MAX_BUILDS = 16, MAX_ROWS = 4000, MAX_GROUPS = 60;
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const { latinName } = require("./latin-name.cjs");
const CLASSES = Object.freeze(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]);
const CLASS_TITLE = new RegExp(`^(${CLASSES.join("|")}) Trainer$`);
const fail = (why = "") => { throw Error("Invalid trainer data." + (why ? " " + why : "")); };
const int = (n, max = 2147483647) => Number.isSafeInteger(n) && n > 0 && n <= max;
const text = (s, max = 100) => typeof s === "string" && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const money = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 100000000;
const rankNumber = (r) => { const m = /(\d+)/.exec(r || ""); return m ? Number(m[1]) : 0; };

/** Which list a trainer's services belong to, from the NPC's title. */
function groupOf(title, trainer) {
  const m = CLASS_TITLE.exec(title || "");
  if (m) return { list: "classes", key: m[1], from: "class" };
  if (title === "Portal Trainer") return { list: "classes", key: "Mage", from: "portal" };
  if (title === "Pet Trainer") return { list: "classes", key: "Hunter", from: "pet" };
  if (title === "Weapon Master") return { list: "weapons" };
  if (/\bRiding\b/.test(title || "")) return { list: "riding" };
  if (trainer.tradeskill === true) return { list: "professions" };
  return null;
}
/**
 * builds: [{ build, files: { "trainers.json": Buffer, "creature_details.enUS.json": Buffer } }], newest first.
 * Rows join by exact spell id inside a list. The newest build's name and price win. The level is
 * the highest level any player was shown: a trainer window reports 0 once the player has the level.
 */
function compileTrainers(builds, { commit }) {
  if (!Array.isArray(builds) || !builds.length || builds.length > MAX_BUILDS || !/^[a-f0-9]{40}$/.test(commit || "")) fail();
  const titles = new Map(), dates = [];
  const parsed = builds.map(({ build, files }) => {
    if (!BUILD_RE.test(build)) fail();
    const trainers = JSON.parse(files["trainers.json"]), details = JSON.parse(files["creature_details.enUS.json"]);
    if (trainers?.meta?.dataset !== "trainers" || details?.meta?.dataset !== "creature_details" || trainers.meta.clientBuild !== build || details.meta.clientBuild !== build) fail("Source metadata.");
    dates.push(trainers.meta.collectedOn.first, trainers.meta.collectedOn.last);
    for (const [id, c] of Object.entries(details.creatures || {})) if (text(c?.title) && !titles.has(id)) titles.set(id, c.title);
    return trainers;
  });
  const lists = { classes: new Map(), professions: new Map(), weapons: new Map(), riding: new Map() };
  const seenTrainers = { classes: new Map(), professions: new Set(), weapons: new Set(), riding: new Set() };
  const counts = { trainers: 0, untitledTrainers: 0, otherTrainers: 0, droppedServices: 0, barteredOnly: 0 };
  const skills = new Set();
  for (const t of parsed) for (const x of Object.values(t.trainers || {})) for (const s of Object.values(x?.services || {})) if (text(s?.skill, 40) && latinName(s.skill)) skills.add(s.skill);
  const professionOf = (trainer, service) => {
    if (text(service.skill, 40)) return service.skill;
    const tally = {};
    for (const s of Object.values(trainer.services || {})) if (text(s?.skill, 40) && latinName(s.skill)) tally[s.skill] = (tally[s.skill] || 0) + 1;
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) return top[0];
    // "Apprentice Herbalism", "Apprentice Alchemist": match the profession by its first letters.
    const name = String(service.name || "").replace(/^\w+\s+/, "").toLowerCase();
    return [...skills].sort().find((k) => name.slice(0, 5) === k.toLowerCase().slice(0, 5)) || null;
  };
  const counted = new Set();
  for (const t of parsed) {
    for (const [npc, x] of Object.entries(t.trainers || {})) {
      if (!/^[1-9]\d*$/.test(npc) || !x || typeof x !== "object") continue;
      const title = titles.get(npc) || null, g = groupOf(title, x);
      if (!counted.has(npc)) { counted.add(npc); counts.trainers++; if (!title) counts.untitledTrainers++; else if (!g) counts.otherTrainers++; }
      if (!g) continue;
      if (g.list === "classes") { if (!seenTrainers.classes.has(g.key)) seenTrainers.classes.set(g.key, new Set()); seenTrainers.classes.get(g.key).add(npc); } else seenTrainers[g.list].add(npc);
      for (const s of Object.values(x.services || {})) {
        if (!int(s?.spellId) || !text(s?.name) || !Number.isSafeInteger(s.level) || s.level < 0 || s.level > 100) { counts.droppedServices++; continue; }
        // Seen in a game in another language: an older build's English row is used, or none.
        if (![s.name, s.rankText, s.skill].every((v) => v === undefined || latinName(v))) { counts.droppedServices++; continue; }
        const key = g.list === "classes" ? g.key : g.list === "professions" ? professionOf(x, s) : "all";
        if (!key) { counts.droppedServices++; continue; }
        const map = lists[g.list];
        if (!map.has(key)) map.set(key, new Map());
        const rows = map.get(key);
        let row = rows.get(s.spellId);
        if (!row) {
          row = { id: s.spellId, name: s.name, rank: text(s.rankText, 40) ? s.rankText : null, level: 0, cost: null, honored: null };
          if (g.list === "classes") row.from = g.from;
          if (g.list === "professions") { row.skill = 0; row.step = s.step === true || s.profession === true; }
          rows.set(s.spellId, row);
        }
        if (s.level > row.level) row.level = s.level;
        if (g.list === "professions" && Number.isSafeInteger(s.skillRank) && s.skillRank > row.skill && s.skillRank <= 1000) row.skill = s.skillRank;
        // Reputation standing 4 and 5 pay the full price; 6 and up pay 10% less.
        const costs = s.costs || {}, full = costs["5"] ?? costs["4"], honored = costs["6"] ?? costs["7"];
        if (row.cost === null && money(full)) row.cost = full;
        if (row.honored === null && money(honored)) row.honored = honored;
        if (s.bartered && !s.costs) row.bartered = true;
      }
    }
  }
  const order = (a, b) => (a.level || 999) - (b.level || 999) || (a.skill || 0) - (b.skill || 0) || a.name.localeCompare(b.name) || rankNumber(a.rank) - rankNumber(b.rank) || a.id - b.id;
  const finish = (rows) => [...rows.values()].map((r) => { if (r.bartered) { if (r.cost === null && r.honored === null) counts.barteredOnly++; delete r.bartered; } return r; }).sort(order);
  const classes = {}, professions = {};
  for (const c of CLASSES) if (lists.classes.has(c)) classes[c] = finish(lists.classes.get(c));
  for (const k of [...lists.professions.keys()].sort()) professions[k] = finish(lists.professions.get(k));
  const weapons = finish(lists.weapons.get("all") || new Map()), riding = finish(lists.riding.get("all") || new Map());
  const coverage = {};
  for (const [c, rows] of Object.entries(classes)) coverage[c] = { trainers: seenTrainers.classes.get(c).size, services: rows.length, withLevel: rows.filter((r) => r.level > 0).length, priced: rows.filter((r) => r.cost !== null || r.honored !== null).length };
  return validateTrainerPack({
    schemaVersion: 1, kind: "forever-trainers", product: "wowf", build: builds[0].build, builds: builds.map((b) => b.build), sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION,
    collectedOn: { first: dates.sort()[0], last: dates.at(-1) },
    counts: { ...counts, classServices: Object.values(classes).reduce((n, r) => n + r.length, 0), professionServices: Object.values(professions).reduce((n, r) => n + r.length, 0), weaponServices: weapons.length, ridingServices: riding.length },
    coverage, classes, professions, weapons, riding,
  });
}
function validateRows(rows, kind) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) fail("Rows.");
  const ids = new Set();
  for (const r of rows) {
    if (!int(r.id) || ids.has(r.id) || !text(r.name) || !(r.rank === null || text(r.rank, 40)) || !Number.isSafeInteger(r.level) || r.level < 0 || r.level > 100 || !(r.cost === null || money(r.cost)) || !(r.honored === null || money(r.honored))) fail("Row.");
    if (kind === "classes" && !["class", "portal", "pet"].includes(r.from)) fail("Row source.");
    if (kind === "professions" && (!Number.isSafeInteger(r.skill) || r.skill < 0 || r.skill > 1000 || typeof r.step !== "boolean")) fail("Profession row.");
    ids.add(r.id);
  }
}
function validateTrainerPack(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-trainers" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(p.sourceCommit || "")) fail("Header.");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > MAX_BUILDS || p.builds[0] !== p.build || p.builds.some((b) => !BUILD_RE.test(b)) || new Set(p.builds).size !== p.builds.length) fail("Builds.");
  if (!/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.first || "") || !/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.last || "") || p.collectedOn.first > p.collectedOn.last) fail("Dates.");
  for (const k of ["classes", "professions", "coverage"]) if (!p[k] || typeof p[k] !== "object" || Array.isArray(p[k]) || Object.keys(p[k]).length > MAX_GROUPS) fail("Groups.");
  for (const [c, rows] of Object.entries(p.classes)) {
    if (!CLASSES.includes(c)) fail("Class.");
    validateRows(rows, "classes");
    const v = p.coverage[c];
    if (!v || !int(v.trainers, 10000) || v.services !== rows.length || v.withLevel !== rows.filter((r) => r.level > 0).length || v.priced !== rows.filter((r) => r.cost !== null || r.honored !== null).length) fail("Coverage.");
  }
  if (Object.keys(p.coverage).some((c) => !p.classes[c])) fail("Coverage.");
  for (const [k, rows] of Object.entries(p.professions)) { if (!text(k, 40)) fail("Profession."); validateRows(rows, "professions"); }
  validateRows(p.weapons, "weapons"); validateRows(p.riding, "riding");
  const c = p.counts;
  if (!c || c.classServices !== Object.values(p.classes).reduce((n, r) => n + r.length, 0) || c.professionServices !== Object.values(p.professions).reduce((n, r) => n + r.length, 0) || c.weaponServices !== p.weapons.length || c.ridingServices !== p.riding.length) fail("Counts.");
  for (const k of ["trainers", "untitledTrainers", "otherTrainers", "droppedServices", "barteredOnly"]) if (!Number.isSafeInteger(c[k]) || c[k] < 0) fail("Counts.");
  return p;
}
let cached = null;
function loadTrainerPack(file = path.join(__dirname, "../../data/forever-trainers/pack.json")) {
  const bundled = arguments.length === 0;
  if (bundled && cached) return cached;
  if (fs.statSync(file).size > PACK_LIMIT) fail("Pack too large.");
  const pack = validateTrainerPack(JSON.parse(fs.readFileSync(file)));
  if (bundled) cached = pack;
  return pack;
}

/** Full price of a row: as seen, or worked out from the Honored price (10% less). */
function priceOf(row) {
  if (row.cost !== null) return { copper: row.cost, estimated: false };
  if (row.honored !== null) return { copper: Math.round(row.honored / 0.9), estimated: true };
  return { copper: null, estimated: false };
}
/**
 * "At the trainer": what a class can newly train at this level and the next `ahead` levels.
 * Facts only. money is the character's saved copper, or null when the saved data has none.
 */
const CITY_SIDE = Object.freeze({ Orgrimmar: "Horde", Undercity: "Horde", "Thunder Bluff": "Horde", Stormwind: "Alliance", Ironforge: "Alliance", Darnassus: "Alliance" });
// A teleport or portal to the other faction's city is not for this character.
const forFaction = (row, faction) => { if (row.from !== "portal" || !faction) return true; const city = /: (.+)$/.exec(row.name)?.[1]; return !CITY_SIDE[city] || CITY_SIDE[city] === faction; };
// Characters stop at level 60: a level 59 or 60 character is not shown levels that do not exist.
const LEVEL_CAP = 60;
// The level a skill with no recorded level is learned at, from the player's game files. A level
// of 1 there is the table's default for passive skills, not a trainer level, so it is not used.
const gameLevel = (spellLevels, id) => { const l = spellLevels?.[id]; return Number.isSafeInteger(l) && l > 1 && l <= 100 ? l : 0; };
function trainerPlan(pack, className, level, { ahead = 2, money: purse = null, faction = null, spellLevels = null } = {}) {
  const rows = pack?.classes?.[className];
  const v = pack?.coverage?.[className];
  if (!rows || !Number.isSafeInteger(level) || level < 1 || level > 100) return { available: false, className, level, reason: rows ? "The character's level is not known." : `No ${className || "class"} trainer has been recorded yet.` };
  const levels = [];
  const levelOf = (r) => r.level || gameLevel(spellLevels, r.id);
  const fromGame = rows.filter((r) => !r.level && levelOf(r)).length, unknown = v.services - v.withLevel - fromGame;
  const last = Math.max(level, Math.min(level + ahead, LEVEL_CAP));
  for (let l = level; l <= last; l++) {
    const list = rows.filter((r) => levelOf(r) === l && forFaction(r, faction)).map((r) => { const p = priceOf(r); return { id: r.id, name: r.name, rank: r.rank, from: r.from, copper: p.copper, estimated: p.estimated, ...(r.level ? {} : { levelFrom: "game" }) }; });
    levels.push({ level: l, rows: list, total: list.reduce((n, r) => n + (r.copper || 0), 0), unpriced: list.filter((r) => r.copper === null).length, estimated: list.some((r) => r.estimated) });
  }
  const total = levels.reduce((n, l) => n + l.total, 0);
  const notes = [];
  if (fromGame) notes.push(`${fromGame} ${className} skill${fromGame === 1 ? " has" : "s have"} no level recorded at a trainer; ${fromGame === 1 ? "its level comes" : "their levels come"} from your game files.`);
  if (unknown > 0) notes.push(`${unknown} of ${v.services} recorded ${className} skills have no recorded level and are not listed here.`);
  if (v.services < 60) notes.push(`Only ${v.services} ${className} skills from ${v.trainers} trainer${v.trainers === 1 ? "" : "s"} have been recorded so far, so this list is far from complete.`);
  if (levels.some((l) => l.estimated)) notes.push("Some prices were only seen at Honored reputation; the full price is worked out from the 10% discount.");
  notes.push("Ranks of talent skills show for everyone; you can only train the ones whose talent you have.");
  const later = rows.map(levelOf).filter((l) => l > last && l <= LEVEL_CAP);
  return {
    available: true, className, level, levels, total, money: Number.isSafeInteger(purse) && purse >= 0 ? purse : null,
    nextLevel: later.length ? Math.min(...later) : null, notes, coverage: { ...v },
    source: `Seen in trainer windows by players on game builds ${pack.builds.at(-1).split(".").pop()} to ${pack.build.split(".").pop()}. Efficient Games, CC BY 4.0.`,
  };
}
module.exports = { FILES, ATTRIBUTION, RAW_LIMITS, PACK_LIMIT, CLASSES, compileTrainers, validateTrainerPack, loadTrainerPack, priceOf, trainerPlan, groupOf };

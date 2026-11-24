"use strict";
// Hunter pet book (roadmap C7, B3): which wild beasts players tamed, which abilities the tamed
// beast came with (taming one teaches the hunter that ability rank), and what each ability asks
// of a pet at the pet trainer page. Built offline by scripts/build-forever-pets.cjs from Efficient
// Games hunter_pets.json, creatures.json and creature_details.enUS.json (CC BY 4.0).
// Recorded tames only: a beast that nobody recorded is not listed. No advice is derived.
const fs = require("node:fs"), path = require("node:path");
const { latinName } = require("./latin-name.cjs");

const FILES = Object.freeze(["hunter_pets.json", "creatures.json", "creature_details.enUS.json"]);
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMITS = Object.freeze({ "hunter_pets.json": 4 * 1024 * 1024, "creatures.json": 16 * 1024 * 1024, "creature_details.enUS.json": 16 * 1024 * 1024 });
const PACK_LIMIT = 256 * 1024, MAX_BUILDS = 16, MAX_BEASTS = 2000, MAX_ABILITIES = 1000, MAX_SPELLS = 12, MAX_SPOTS = 3;
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
// The game's pet family numbers. Only used to print a word for a number the data holds.
const FAMILIES = Object.freeze({ 1: "Wolf", 2: "Cat", 3: "Spider", 4: "Bear", 5: "Boar", 6: "Crocolisk", 7: "Carrion Bird", 8: "Crab", 9: "Gorilla", 11: "Raptor", 12: "Tallstrider", 20: "Scorpid", 21: "Turtle", 24: "Bat", 25: "Hyena", 26: "Owl", 27: "Wind Serpent" });
const fail = (why = "") => { throw Error("Invalid hunter pet data." + (why ? " " + why : "")); };
const id = (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const level = (n) => Number.isSafeInteger(n) && n >= 1 && n <= 100;
const text = (s, max = 80) => typeof s === "string" && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f|]/.test(s);
const unit = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
const numbers = (object, ok) => Object.keys(object && typeof object === "object" ? object : {}).map(Number).filter(ok).sort((a, b) => a - b);

/**
 * builds: [{ build, files }], newest first. A beast joins by creature id over the builds: its
 * abilities and levels are unioned, the newest English name wins, tames are added up.
 */
function compilePets(builds, { commit }) {
  if (!Array.isArray(builds) || !builds.length || builds.length > MAX_BUILDS || !/^[a-f0-9]{40}$/.test(commit || "")) fail();
  const beasts = new Map(), abilities = new Map(), dates = [];
  let unnamed = 0;
  for (const { build, files } of builds) {
    if (!BUILD_RE.test(build)) fail();
    const pets = JSON.parse(files["hunter_pets.json"]), creatures = JSON.parse(files["creatures.json"]).creatures || {}, details = JSON.parse(files["creature_details.enUS.json"]).creatures || {};
    if (pets?.meta?.dataset !== "hunter_pets" || pets.meta.clientBuild !== build) fail("Source metadata.");
    dates.push(pets.meta.collectedOn.first, pets.meta.collectedOn.last);
    for (const [key, b] of Object.entries(pets.beasts || {})) {
      const creature = Number(key), t = b?.tames;
      if (!id(creature) || !t || typeof t !== "object") continue;
      let row = beasts.get(creature);
      if (!row) { row = { id: creature, name: null, family: 0, levels: new Set(), abilities: new Set(), passives: new Set(), diet: new Set(), tames: 0, spots: [] }; beasts.set(creature, row); }
      const named = details[creature]?.name ?? creatures[creature]?.name;
      if (!row.name && text(named) && latinName(named)) row.name = named;
      if (!row.family) row.family = numbers(t.families, (n) => id(n) && n < 1000)[0] || (id(details[creature]?.family) ? details[creature].family : 0);
      for (const l of numbers(t.levels, level)) row.levels.add(l);
      for (const [spell, s] of Object.entries(t.spells && typeof t.spells === "object" ? t.spells : {})) if (id(Number(spell))) (s?.passive === true ? row.passives : row.abilities).add(Number(spell));
      for (const food of Object.keys(t.diet?.enUS || {})) if (text(food, 20) && latinName(food)) row.diet.add(food);
      row.tames += Number.isSafeInteger(t.count) && t.count > 0 && t.count < 1000000 ? t.count : 1;
      for (const p of Array.isArray(creatures[creature]?.positions) ? creatures[creature].positions : []) {
        if (row.spots.length >= MAX_SPOTS || !id(p?.uiMap) || !unit(p.mapX) || !unit(p.mapY) || row.spots.some((s) => s.mapId === p.uiMap)) continue;
        row.spots.push({ mapId: p.uiMap, x: Math.round(p.mapX * 1000) / 1000, y: Math.round(p.mapY * 1000) / 1000 });
      }
    }
    for (const [key, a] of Object.entries(pets.training || {})) {
      const spell = Number(key);
      if (!id(spell) || !a || typeof a !== "object") continue;
      let row = abilities.get(spell);
      if (!row) { row = { id: spell, petLevel: 0, costs: new Set(), families: new Set() }; abilities.set(spell, row); }
      if (level(a.level) && a.level > row.petLevel) row.petLevel = a.level;
      for (const c of numbers(a.costs, (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000)) row.costs.add(c);
      for (const f of numbers(a.families, (n) => id(n) && n < 1000)) row.families.add(f);
    }
  }
  const list = (set) => [...set].sort((a, b) => (typeof a === "number" ? a - b : a < b ? -1 : 1));
  const rows = [];
  for (const b of [...beasts.values()].sort((a, c) => a.id - c.id)) {
    if (!b.name || !b.levels.size) { unnamed++; continue; }
    rows.push({ id: b.id, name: b.name, family: b.family, minLevel: Math.min(...b.levels), maxLevel: Math.max(...b.levels), abilities: list(b.abilities).slice(0, MAX_SPELLS), passives: list(b.passives).slice(0, MAX_SPELLS), diet: list(b.diet).slice(0, 8), tames: b.tames, spots: b.spots });
  }
  const training = [...abilities.values()].sort((a, b) => a.id - b.id).map((a) => ({ id: a.id, petLevel: a.petLevel, cost: a.costs.size ? Math.max(...a.costs) : null, families: list(a.families) }));
  return validatePets({
    schemaVersion: 1, kind: "forever-pets", product: "wowf", build: builds[0].build, builds: builds.map((b) => b.build), sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION,
    collectedOn: { first: dates.sort()[0], last: dates.at(-1) },
    counts: { beasts: rows.length, withAbility: rows.filter((r) => r.abilities.length).length, abilities: training.length, families: new Set(rows.map((r) => r.family)).size, unnamed },
    beasts: rows, training,
  });
}
function validatePets(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-pets" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(p.sourceCommit || "")) fail("Header.");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > MAX_BUILDS || p.builds[0] !== p.build || p.builds.some((b) => !BUILD_RE.test(b)) || new Set(p.builds).size !== p.builds.length) fail("Builds.");
  if (!/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.first || "") || !/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.last || "") || p.collectedOn.first > p.collectedOn.last) fail("Dates.");
  if (!Array.isArray(p.beasts) || p.beasts.length > MAX_BEASTS || !Array.isArray(p.training) || p.training.length > MAX_ABILITIES) fail("Rows.");
  const ids = (list, max) => Array.isArray(list) && list.length <= max && list.every(id) && new Set(list).size === list.length;
  let last = 0;
  for (const b of p.beasts) {
    if (!b || !id(b.id) || b.id <= last || !text(b.name) || !Number.isSafeInteger(b.family) || b.family < 0 || b.family > 999 || !level(b.minLevel) || !level(b.maxLevel) || b.minLevel > b.maxLevel) fail("Beast.");
    if (!ids(b.abilities, MAX_SPELLS) || !ids(b.passives, MAX_SPELLS) || !Array.isArray(b.diet) || b.diet.length > 8 || b.diet.some((d) => !text(d, 20)) || !id(b.tames)) fail("Beast.");
    if (!Array.isArray(b.spots) || b.spots.length > MAX_SPOTS || b.spots.some((s) => !id(s?.mapId) || !unit(s.x) || !unit(s.y))) fail("Beast place.");
    last = b.id;
  }
  last = 0;
  for (const a of p.training) {
    if (!a || !id(a.id) || a.id <= last || !Number.isSafeInteger(a.petLevel) || a.petLevel < 0 || a.petLevel > 100 || !(a.cost === null || (Number.isSafeInteger(a.cost) && a.cost >= 0 && a.cost <= 1000))) fail("Ability.");
    if (!Array.isArray(a.families) || a.families.length > 40 || a.families.some((f) => !id(f) || f > 999)) fail("Ability.");
    last = a.id;
  }
  const c = p.counts;
  if (!c || c.beasts !== p.beasts.length || c.withAbility !== p.beasts.filter((b) => b.abilities.length).length || c.abilities !== p.training.length || c.families !== new Set(p.beasts.map((b) => b.family)).size || !Number.isSafeInteger(c.unnamed) || c.unnamed < 0) fail("Counts.");
  return p;
}
let cached = null;
function loadPets(file = path.join(__dirname, "../../data/forever-pets/pack.json")) {
  const bundled = arguments.length === 0;
  if (bundled && cached) return cached;
  if (fs.statSync(file).size > PACK_LIMIT) fail("Pack too large.");
  const pack = validatePets(JSON.parse(fs.readFileSync(file)));
  if (bundled) cached = pack;
  return pack;
}
const familyName = (n) => FAMILIES[n] || (n ? `Family ${n}` : "Unknown family");

/**
 * The pet book for the Characters screen.
 * spells: (ids) => [{ name, rank } | null] from the player's own game files (ability names are
 * not bundled), or null. mapName: (mapId) => string | undefined. level: the hunter's level.
 */
function petBook(pack, { spells = null, mapName = () => undefined, level: hunterLevel = null, note = null } = {}) {
  const wanted = [...new Set(pack.beasts.flatMap((b) => [...b.abilities, ...b.passives]).concat(pack.training.map((a) => a.id)))];
  let views = null;
  try { views = spells ? spells(wanted) : null; } catch { views = null; }
  const names = new Map();
  if (Array.isArray(views)) wanted.forEach((spell, i) => { const v = views[i]; if (text(v?.name, 60)) names.set(spell, { name: v.name, rank: text(v.rank, 20) ? v.rank : null }); });
  const training = new Map(pack.training.map((a) => [a.id, a]));
  const ability = (spell) => {
    const n = names.get(spell), t = training.get(spell);
    return { id: spell, name: n?.name || `Ability #${spell}`, rank: n?.rank || null, named: Boolean(n), petLevel: t?.petLevel || null, cost: t?.cost ?? null };
  };
  const beasts = pack.beasts.map((b) => ({
    id: b.id, name: b.name, family: familyName(b.family), minLevel: b.minLevel, maxLevel: b.maxLevel, tames: b.tames, diet: b.diet,
    abilities: b.abilities.map(ability), passives: b.passives.map(ability),
    places: b.spots.map((s) => ({ ...s, zone: mapName(s.mapId) || null })),
    // A hunter can tame a beast of their own level or lower.
    tameable: Number.isSafeInteger(hunterLevel) ? b.minLevel <= hunterLevel : null,
  })).sort((a, b) => a.minLevel - b.minLevel || (a.name < b.name ? -1 : 1));
  const abilities = pack.training.map((a) => ({ ...ability(a.id), families: a.families.map(familyName), taughtBy: pack.beasts.filter((b) => b.abilities.includes(a.id)).map((b) => b.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.petLevel || 0) - (b.petLevel || 0) || a.id - b.id);
  const notes = [
    `Only tames that players recorded are listed: ${pack.counts.beasts} beasts so far, ${pack.counts.withAbility} of them with an ability. A beast that is not here may still teach something.`,
    "Your pet's own abilities are not in the saved data, so this book cannot say what your pet still lacks.",
  ];
  if (!names.size) notes.push("Ability names come from your own game files. Connect your WoW Forever folder in Settings to see names instead of numbers.");
  if (note) notes.push(note);
  return {
    available: true, level: Number.isSafeInteger(hunterLevel) ? hunterLevel : null, beasts, abilities, named: names.size > 0, notes, counts: { ...pack.counts },
    source: `Recorded by players on game builds ${pack.builds.at(-1).split(".").pop()} to ${pack.build.split(".").pop()}, ${pack.collectedOn.first} to ${pack.collectedOn.last}. Efficient Games, CC BY 4.0. Places are approximate.`,
  };
}
module.exports = { FILES, ATTRIBUTION, RAW_LIMITS, PACK_LIMIT, FAMILIES, compilePets, validatePets, loadPets, petBook, familyName };

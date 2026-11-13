"use strict";
// Item, spell, icon and talent facts read from the player's own WoW Forever installation at
// runtime. Nothing here is bundled with the app or sent anywhere: the game's tables are decoded
// once per client build into compact JSON under userData, and icons into small local PNGs.
const fs = require("node:fs");
const path = require("node:path");

// FileDataIDs and layout hashes (WoWDBDefs) for the 1.60.x WoW Forever client. A different layout
// means the columns moved: the table is reported unavailable instead of being misread.
const TABLES = {
  itemSparse: { fdid: 1572924, layout: 0x6fcc3191, opts: { strings: [0, 1, 2, 3, 4], floats: [6, 9, 13, 14, 25, 26], signed: [5, 7, 11, 12, 15, 16, 17, 18, 19, 21, 27, 28, 29, 30, 31, 32, 33, 34, 51, 63, 64, 65, 66] } },
  item: { fdid: 841626, layout: 0x9a2a4834, opts: { typed: true, signed: [0, 3, 5, 6, 7, 9, 10, 12, 13] } },
  randPropPoints: { fdid: 1310245, layout: 0x4fd22743, opts: { typed: true, floats: [0, 1, 4, 5, 6] } },
  armorQuality: { fdid: 1283021, layout: 0x2935aa9d, opts: { floats: [0] } },
  armorTotal: { fdid: 1283022, layout: 0xeb155d51, opts: { typed: true, floats: [1, 2, 3, 4] } },
  armorShield: { fdid: 1277741, layout: 0x7e6c94f9, opts: { typed: true, floats: [0] } },
  armorLocation: { fdid: 1284818, layout: 0xfb67352f, opts: { floats: [0, 1, 2, 3, 4] } },
  damageOneHand: { fdid: 1277743, layout: 0x56f30531, opts: { typed: true, floats: [1] } },
  damageOneHandCaster: { fdid: 1277739, layout: 0x56f30531, opts: { typed: true, floats: [1] } },
  damageTwoHand: { fdid: 1277738, layout: 0x56f30531, opts: { typed: true, floats: [1] } },
  damageTwoHandCaster: { fdid: 1277742, layout: 0x56f30531, opts: { typed: true, floats: [1] } },
  damageRanged: { fdid: 6156256, layout: 0x3cd722c1, opts: { typed: true, floats: [1] } },
  damageWand: { fdid: 6156258, layout: 0x3cd722c1, opts: { typed: true, floats: [1] } },
  spellName: { fdid: 1990283, layout: 0x782ee721, opts: { strings: [0] } },
  spellMisc: { fdid: 1003144, layout: 0x434b3607, opts: { typed: true, signed: [10, 11] } },
  spell: { fdid: 1140089, layout: 0xe3d134fb, opts: { strings: [0, 1, 2] } },
  spellEffect: { fdid: 1140088, layout: 0x5362e3d4, opts: { typed: true, floats: [4, 7, 8, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22], signed: [0, 1, 2, 5, 6, 9, 10, 11, 15, 23, 24, 25, 28] } },
  spellDuration: { fdid: 1137828, layout: 0x4fdf0951, opts: { signed: [0, 1, 2, 3] } },
  talent: { fdid: 1369062, layout: 0x147b0045, opts: { strings: [0], typed: true } },
  talentTab: { fdid: 2178102, layout: 0xb436f3c7, opts: { strings: [0, 1, 2], signed: [3, 4, 5, 6, 7, 8, 9] } },
};
const FORMAT = 1; // bump when the cached JSON shape or a formula changes

// Classic class ids (ChrClasses) and their AllowableClass / ClassMask bits.
const CLASSES = { 1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid" };
const CLASS_IDS = Object.fromEntries(Object.entries(CLASSES).map(([id, n]) => [n.toLowerCase(), Number(id)]));
const ALL_CLASSES_MASK = Object.keys(CLASSES).reduce((m, id) => m | (1 << (id - 1)), 0);

const SLOTS = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard",
  20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Projectile", 25: "Thrown", 26: "Ranged", 27: "Quiver", 28: "Relic",
};
// ItemModType -> tooltip name. Resistances and bonus armor are item stats in this client.
const STATS = {
  0: "Mana", 1: "Health", 3: "Agility", 4: "Strength", 5: "Intellect", 6: "Spirit", 7: "Stamina",
  12: "Defense Rating", 13: "Dodge Rating", 14: "Parry Rating", 15: "Block Rating", 16: "Melee Hit Rating", 17: "Ranged Hit Rating",
  18: "Spell Hit Rating", 19: "Melee Crit Rating", 20: "Ranged Crit Rating", 21: "Spell Crit Rating", 31: "Hit Rating", 32: "Crit Rating",
  35: "Resilience", 36: "Haste Rating", 37: "Expertise Rating", 38: "Attack Power", 39: "Ranged Attack Power", 41: "Healing",
  42: "Spell Damage", 43: "Mana Regeneration", 45: "Spell Power", 46: "Health Regeneration", 47: "Spell Penetration", 48: "Block Value",
  50: "Armor", 51: "Fire Resistance", 52: "Frost Resistance", 53: "Holy Resistance", 54: "Shadow Resistance", 55: "Nature Resistance", 56: "Arcane Resistance",
};
const WEAPON_KINDS = { 0: "Axe", 1: "Two-Handed Axe", 2: "Bow", 3: "Gun", 4: "Mace", 5: "Two-Handed Mace", 6: "Polearm", 7: "Sword", 8: "Two-Handed Sword", 10: "Staff", 13: "Fist Weapon", 14: "Miscellaneous", 15: "Dagger", 16: "Thrown", 18: "Crossbow", 19: "Wand", 20: "Fishing Pole" };
const ARMOR_KINDS = { 0: "Miscellaneous", 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield", 7: "Libram", 8: "Idol", 9: "Totem" };
const BONDING = { 1: "Binds when picked up", 2: "Binds when equipped", 3: "Binds when used", 4: "Quest item" };

const unavailable = (reason, code) => Object.assign(Error(reason), { code });

function readTable(storage, name) {
  const { readDb2 } = require("./db2.cjs");
  const t = TABLES[name];
  const db = readDb2(storage.readFileId(t.fdid, { zeroEncrypted: true }), t.opts);
  if (db.header.layoutHash !== t.layout) throw unavailable(`The ${name} table layout differs from what this app reads.`, "LAYOUT");
  return db.rows;
}
// Optional tables: a missing or different one leaves its facts empty rather than failing everything.
function tryTable(storage, name, notes) {
  try { return readTable(storage, name); } catch (e) { notes.push(`${name}: ${e.code === "LAYOUT" ? "layout differs" : "unreadable"}`); return null; }
}

// --- Items -------------------------------------------------------------------------------------
// Classic-era items in this client use the modern formulas: stats from a budget (RandPropPoints)
// times each stat's share, armor from per-level totals, weapon damage from per-level DPS tables.
function propIndex(inv, subclass) {
  if ([1, 4, 5, 7, 17, 20, 25].includes(inv)) return 0;
  if (inv === 15) return 0;
  if (inv === 26) return subclass === 19 ? 3 : 0;
  if ([13, 21, 22].includes(inv)) return 3;
  if ([3, 6, 8, 10, 12].includes(inv)) return 1;
  if ([2, 9, 11, 14, 16, 23].includes(inv)) return 2;
  if (inv === 28) return 4;
  return -1;
}

function extractItems(storage) {
  const notes = [];
  const sparse = readTable(storage, "itemSparse");
  const base = new Map(readTable(storage, "item").map((r) => [r.id, r.fields]));
  const byId = (rows) => rows && new Map(rows.map((r) => [r.id, r.fields]));
  const byLevel = (rows, levelField) => rows && new Map(rows.map((r) => [r.fields[levelField], r.fields]));
  const rpp = byId(tryTable(storage, "randPropPoints", notes));
  const aq = byId(tryTable(storage, "armorQuality", notes));
  const at = byLevel(tryTable(storage, "armorTotal", notes), 0);
  const ash = byLevel(tryTable(storage, "armorShield", notes), 1);
  const al = byId(tryTable(storage, "armorLocation", notes));
  const dmg = {};
  for (const k of ["damageOneHand", "damageOneHandCaster", "damageTwoHand", "damageTwoHandCaster", "damageRanged", "damageWand"]) dmg[k] = byLevel(tryTable(storage, k, notes), 0);
  const out = {};
  for (const r of sparse) {
    const F = r.fields, name = F[4];
    if (!name) continue;
    const b = base.get(r.id);
    const quality = F[66], ilvl = F[50], inv = F[65], cls = b ? b[0] : null, sub = b ? b[1] : null, q = quality === 7 ? 3 : quality;
    let armor = null;
    if (cls === 4 && sub === 6) { const s = ash?.get(ilvl); armor = s ? Math.floor((s[0][q] || 0) + 0.5) : null; }
    else if (cls === 4 && sub >= 1 && sub <= 4) {
      const t = at?.get(ilvl), l = al?.get(inv === 20 ? 5 : inv), m = aq?.get(ilvl);
      armor = t && l && m ? Math.floor((m[0][q] || 0) * t[sub] * l[sub - 1] + 0.5) : at && al && aq ? 0 : null;
    } else if (cls === 4) armor = 0;
    const stats = [];
    const pts = rpp?.get(ilvl), pi = propIndex(inv, sub);
    for (let i = 0; i < 10; i++) {
      const type = F[16][i], share = F[15][i];
      if (type < 0 || !share) continue;
      if (!pts || pi < 0) { stats.length = 0; stats.push(null); break; }
      const budget = (quality === 4 ? pts[7] : quality === 3 || quality === 7 ? pts[8] : pts[9])[pi];
      const amount = Math.floor(share * budget / 10000 + 0.5);
      if (amount) stats.push(type, amount);
    }
    let dmin = 0, dmax = 0;
    const delay = F[46];
    if (cls === 2 && delay > 0) {
      const caster = (F[27][1] & 0x200) !== 0;
      const table = inv === 17 ? (caster ? dmg.damageTwoHandCaster : dmg.damageTwoHand)
        : [13, 21, 22].includes(inv) ? (caster ? dmg.damageOneHandCaster : dmg.damageOneHand)
        : [15, 25, 26].includes(inv) ? (sub === 19 ? dmg.damageWand : [2, 3, 16, 18].includes(sub) ? dmg.damageRanged : null) : null;
      const dps = table?.get(ilvl)?.[1]?.[q];
      if (dps) {
        const avg = dps * delay / 1000, v = F[6];
        dmin = Math.floor(avg * (1 - v / 2)); dmax = Math.floor(avg * (1 + v / 2) + 0.5);
      }
    }
    // [name, quality, itemLevel, requiredLevel, classId, subclassId, inventoryType, armor, stats, min, max, delay, sell, bonding, classMask, icon]
    out[r.id] = [name, quality, ilvl, F[64], cls, sub, inv, armor, stats[0] === null ? null : stats, dmin, dmax, delay, F[22], F[59], F[51], b ? b[7] : 0];
  }
  return { items: out, notes };
}

function itemView(id, row) {
  if (!row) return null;
  const [name, quality, itemLevel, requiredLevel, classId, subclassId, inventoryType, armor, stats, min, max, delay, sellPrice, bonding, mask, icon] = row;
  const statList = stats ? [] : null;
  if (stats) for (let i = 0; i < stats.length; i += 2) statList.push({ stat: STATS[stats[i]] || `Stat ${stats[i]}`, amount: stats[i + 1] });
  const speed = classId === 2 && delay > 0 ? delay / 1000 : null;
  const damage = max > 0 ? { min, max } : null;
  const m = mask & ALL_CLASSES_MASK;
  const classes = mask === -1 || mask === 0 || m === ALL_CLASSES_MASK ? null : Object.entries(CLASSES).filter(([cid]) => m & (1 << (cid - 1))).map(([, n]) => n);
  return {
    id, name, quality, itemLevel, requiredLevel, classId, subclassId, inventoryType,
    slot: SLOTS[inventoryType] || null,
    kind: classId === 2 ? WEAPON_KINDS[subclassId] || null : classId === 4 ? ARMOR_KINDS[subclassId] || null : null,
    armor, stats: statList, damage, speed,
    dps: damage && speed ? Math.round((damage.min + damage.max) / 2 / speed * 10) / 10 : null,
    sellPrice, bonding: BONDING[bonding] || null, classes, iconFileId: icon || null,
  };
}

// --- Spells ------------------------------------------------------------------------------------
function formatDuration(ms) {
  if (!(ms > 0)) return null;
  const s = ms / 1000;
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? "" : "s"}`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  return `${Math.round(s * 10) / 10} sec`;
}
const round = (n) => Math.round(n * 10) / 10;

// Tiny evaluator for "${...}" tooltip math: numbers, + - * / and parentheses only.
function arithmetic(src) {
  const t = String(src).match(/\d+(?:\.\d+)?|\S/g) || [];
  let i = 0;
  const atom = () => {
    const x = t[i++];
    if (x === "(") { const v = sum(); if (t[i++] !== ")") throw Error("paren"); return v; }
    if (x === "-") return -atom();
    if (x !== undefined && /^\d/.test(x)) return Number(x);
    throw Error("token");
  };
  const product = () => { let v = atom(); while (t[i] === "*" || t[i] === "/") v = t[i++] === "*" ? v * atom() : v / atom(); return v; };
  const sum = () => { let v = product(); while (t[i] === "+" || t[i] === "-") v = t[i++] === "+" ? v + product() : v - product(); return v; };
  try { const v = sum(); return i === t.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

// Crude $-token resolution for tooltip text. Anything it cannot resolve drops the description.
function resolveDescription(text, spellId, facts, depth = 0) {
  if (!text) return null;
  let s = String(text);
  const effects = (id) => facts.effects.get(id) || [];
  // Shown values are magnitudes ("reduces by 2 sec"); "${...}" math uses the signed number.
  const value = (id, kind, n, { signed = false, range = true } = {}) => {
    const e = effects(id)[n - 1];
    if (!e) return null;
    const bp = signed ? e.bp : Math.abs(e.bp), dur = facts.duration.get(id) || 0;
    if (kind === "s" || kind === "m") {
      if (kind === "s" && range && e.variance > 0) { const lo = Math.round(bp * (1 - e.variance / 2)), hi = Math.round(bp * (1 + e.variance / 2)); if (lo !== hi) return `${lo} to ${hi}`; }
      return String(Math.round(bp));
    }
    if (kind === "o") return e.period > 0 && dur > 0 ? String(Math.round(bp * dur / e.period)) : null;
    if (kind === "t") return e.period > 0 ? String(round(e.period / 1000)) : null;
    if (kind === "x") return e.chain > 0 ? String(e.chain) : null;
    return null;
  };
  const numeric = (id, kind, n, signed = false) => { const v = value(id, kind, n, { signed, range: false }); return v === null ? null : Number(v); };
  for (let i = 0; i < 4 && /\$\?/.test(s); i++) s = s.replace(/\$\?[^[\]$]*(?:\$[^[\]]*)?\[([^[\]]*)\]\[([^[\]]*)\]/g, "$2");
  s = s.replace(/\$[lL]([^:;]*):([^;]*);/g, "$2").replace(/\$[gG]([^:;]*):([^;]*);/g, "$1");
  s = s.replace(/\$\/(\d+);(\d*)([sSmMoO])(\d)/g, (m, div, id, k, n) => { const v = numeric(id ? Number(id) : spellId, k.toLowerCase(), Number(n)); return v === null ? m : String(round(v / Number(div))); });
  s = s.replace(/\$\*([\d.]+);(\d*)([sSmMoO])(\d)/g, (m, mul, id, k, n) => { const v = numeric(id ? Number(id) : spellId, k.toLowerCase(), Number(n)); return v === null ? m : String(round(v * Number(mul))); });
  s = s.replace(/\$\{([^{}]*)\}/g, (m, expr) => {
    const e = expr.replace(/\$(\d*)([sSmMoOtT])(\d)/g, (mm, id, k, n) => { const v = numeric(id ? Number(id) : spellId, k.toLowerCase(), Number(n), true); return v === null ? "?" : `(${v})`; });
    const v = arithmetic(e);
    return v === null ? m : String(round(Math.abs(v)));
  });
  s = s.replace(/\$@spelldesc(\d+)/g, (m, id) => { if (depth) return m; const t = resolveDescription(facts.text.get(Number(id)), Number(id), facts, 1); return t ?? m; });
  s = s.replace(/\$(\d*)([sSmMoOtTxX])(\d)/g, (m, id, k, n) => value(id ? Number(id) : spellId, k.toLowerCase(), Number(n)) ?? m);
  s = s.replace(/\$(\d*)[dD](?![a-z])/g, (m, id) => formatDuration(facts.duration.get(id ? Number(id) : spellId)) ?? m);
  s = s.replace(/\|c[0-9a-fA-F]{8}|\|r/g, "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (/\$/.test(s) || !s) return null;
  return s.length > 600 ? s.slice(0, 597) + "..." : s;
}

function extractSpells(storage) {
  const notes = [];
  const names = readTable(storage, "spellName");
  const misc = tryTable(storage, "spellMisc", notes);
  const text = tryTable(storage, "spell", notes);
  const effectRows = text ? tryTable(storage, "spellEffect", notes) : null;
  const durationRows = text ? tryTable(storage, "spellDuration", notes) : null;
  const icons = new Map(), durationIndex = new Map();
  for (const r of misc || []) if (r.relation && r.fields[1] === 0 && !icons.has(r.relation)) { icons.set(r.relation, r.fields[10]); durationIndex.set(r.relation, r.fields[3]); }
  const durations = new Map((durationRows || []).map((r) => [r.id, r.fields[0]]));
  const facts = { effects: new Map(), duration: new Map(), text: new Map() };
  for (const r of effectRows || []) {
    if (!r.relation || r.fields[1] !== 0) continue;
    const list = facts.effects.get(r.relation) || [];
    list[r.fields[2]] = { bp: r.fields[22], variance: r.fields[19], period: r.fields[6], chain: r.fields[9] };
    facts.effects.set(r.relation, list);
  }
  for (const [id, di] of durationIndex) if (durations.has(di)) facts.duration.set(id, durations.get(di));
  const rank = new Map();
  for (const r of text || []) { facts.text.set(r.id, r.fields[1]); if (r.fields[0]) rank.set(r.id, r.fields[0]); }
  const out = {};
  for (const r of names) {
    if (!r.fields[0]) continue;
    const description = effectRows && durationRows ? resolveDescription(facts.text.get(r.id), r.id, facts) : null;
    out[r.id] = [r.fields[0], icons.get(r.id) || 0, description, rank.get(r.id) || null];
  }
  return { spells: out, notes };
}

function spellView(id, row) {
  if (!row) return null;
  const v = { id, name: row[0], iconFileId: row[1] || null };
  if (row[3]) v.rank = row[3];
  if (row[2]) v.description = row[2];
  return v;
}

// --- Talents -----------------------------------------------------------------------------------
function extractTalents(storage, spells) {
  const tabs = readTable(storage, "talentTab"), talents = readTable(storage, "talent");
  const out = {};
  for (const [cid, className] of Object.entries(CLASSES)) {
    const bit = 1 << (cid - 1);
    const mine = tabs.filter((t) => (t.fields[5] & bit) !== 0).sort((a, b) => a.fields[3] - b.fields[3]);
    if (!mine.length) continue;
    out[className] = {
      className, classId: Number(cid),
      tabs: mine.map((t) => ({
        id: t.id, name: t.fields[0], order: t.fields[3], background: t.fields[1] || null, iconFileId: t.fields[7] > 0 ? t.fields[7] : null,
        talents: talents.filter((x) => x.fields[4] === t.id).map((x) => {
          const ranks = x.fields[11].filter((s) => s > 0);
          const first = spells[ranks[0]];
          return {
            id: x.id, row: x.fields[1], column: x.fields[3], maxRank: ranks.length, ranks,
            name: first ? first[0] : null, iconFileId: first && first[1] ? first[1] : null,
            descriptions: ranks.map((s) => spells[s]?.[2] || null),
            prerequisites: x.fields[12].map((p, i) => (p > 0 ? { talentId: p, rank: x.fields[13][i] + 1 } : null)).filter(Boolean),
          };
        }).sort((a, b) => a.row - b.row || a.column - b.column),
      })),
    };
  }
  return { talents: out, notes: [] };
}

// --- Service -----------------------------------------------------------------------------------
class GameData {
  constructor({ getRoot, cacheDir, idleMs = 60000, open = null, maxFileBytes = 32 * 1024 * 1024, maxIconBytes = 16 * 1024 * 1024, maxIconSide = 256, memoryIcons = 128 }) {
    this.getRoot = getRoot;
    this.cacheDir = cacheDir;
    this.idleMs = idleMs;
    this.openStorage = open || ((installDir) => new (require("./casc-reader.cjs").CascStorage)({ installDir }));
    this.maxFileBytes = maxFileBytes;
    this.maxIconBytes = maxIconBytes;
    this.maxIconSide = maxIconSide;
    this.memoryIcons = memoryIcons;
    this.storage = null;
    this.timer = null;
    this.data = {}; // kind -> { build, value } or { build, error }
    this.iconMemo = new Map();
  }
  installDir() { const root = this.getRoot(); return root ? path.dirname(root) : null; }
  // Build from .build.info only (cheap): cached tables need no CASC access at all.
  build() {
    const dir = this.installDir();
    if (!dir) throw unavailable("Connect your WoW Forever folder first.", "NOGAME");
    try {
      const { parseBuildInfo } = require("./casc-reader.cjs");
      const rows = parseBuildInfo(fs.readFileSync(path.join(dir, ".build.info"), "utf8"));
      const row = rows.find((r) => r.Product === "wowf" && r.Active === "1") || rows.find((r) => r.Product === "wowf");
      if (row?.Version) return String(row.Version);
    } catch {}
    throw unavailable("Your WoW installation could not be read.", "UNREADABLE");
  }
  open() {
    const dir = this.installDir();
    if (this.storage && this.storage.installDir === dir) return this.storage;
    this.release();
    this.storage = this.openStorage(dir);
    this.storage.installDir = dir;
    return this.storage;
  }
  release() { clearTimeout(this.timer); this.timer = null; if (this.storage) try { this.storage.close(); } catch {} this.storage = null; }
  idle() { clearTimeout(this.timer); this.timer = setTimeout(() => this.release(), this.idleMs); this.timer.unref?.(); }
  buildDir(build) { return path.join(this.cacheDir, String(build).replace(/[^\w.-]/g, "_")); }

  load(kind) {
    const build = this.build();
    const have = this.data[kind];
    if (have && have.build === build) { if (have.error) throw have.error; return have.value; }
    const file = path.join(this.buildDir(build), `${kind}.json`);
    try {
      if (fs.statSync(file).size <= this.maxFileBytes) {
        const j = JSON.parse(fs.readFileSync(file, "utf8"));
        if (j && j.format === FORMAT && j.build === build && j.kind === kind && j.data && typeof j.data === "object") {
          this.data[kind] = { build, value: j.data };
          return j.data;
        }
      }
    } catch {}
    let value;
    try {
      const spells = kind === "talents" ? this.load("spells").spells : null;
      const s = this.open();
      try {
        const r = kind === "items" ? extractItems(s) : kind === "spells" ? extractSpells(s) : extractTalents(s, spells);
        value = { [kind]: r[kind], notes: r.notes };
      } finally { this.idle(); }
    } catch (e) {
      const error = e.code === "LAYOUT"
        ? unavailable("This game build stores its item and spell tables in a layout this app does not read yet.", "LAYOUT")
        : e.code === "NOGAME" ? e : unavailable("Your WoW installation could not be read.", "UNREADABLE");
      error.detail = e.message;
      this.data[kind] = { build, error };
      throw error;
    }
    this.data[kind] = { build, value };
    this.persist(build, kind, value);
    return value;
  }
  persist(build, kind, value) {
    try {
      const text = JSON.stringify({ format: FORMAT, build, kind, data: value });
      if (Buffer.byteLength(text) > this.maxFileBytes) return;
      const dir = this.buildDir(build);
      fs.mkdirSync(dir, { recursive: true });
      // Only the current build is kept: older builds' caches are removed.
      for (const other of fs.readdirSync(this.cacheDir)) if (path.join(this.cacheDir, other) !== dir) fs.rmSync(path.join(this.cacheDir, other), { recursive: true, force: true });
      fs.writeFileSync(path.join(dir, `${kind}.json.tmp`), text);
      fs.renameSync(path.join(dir, `${kind}.json.tmp`), path.join(dir, `${kind}.json`));
    } catch {}
  }

  status() {
    try {
      const build = this.build();
      const v = this.load("items");
      const out = { available: true, build };
      if (v.notes?.length) out.limitations = v.notes.slice(0, 10);
      return out;
    } catch (e) {
      let build = null;
      try { build = this.build(); } catch {}
      return { available: false, build, reason: e.message };
    }
  }
  item(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    try { return itemView(id, this.load("items").items[id]); } catch { return null; }
  }
  items(ids) {
    let table = null;
    try { table = this.load("items").items; } catch {}
    return ids.map((id) => (table && Number.isSafeInteger(id) && id > 0 ? itemView(id, table[id]) : null));
  }
  spell(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    try { return spellView(id, this.load("spells").spells[id]); } catch { return null; }
  }
  talents(className) {
    const key = String(className || "").toLowerCase();
    if (!CLASS_IDS[key]) return null;
    try { return this.load("talents").talents[CLASSES[CLASS_IDS[key]]] || null; } catch { return null; }
  }
  // Icons the game's own tables point at; anything else is refused.
  knownIcon(fileId) {
    if (!this.iconIds || this.iconIds.build !== this.data.items?.build) {
      const ids = new Set();
      for (const kind of ["items", "spells", "talents"]) {
        let v; try { v = this.load(kind); } catch { continue; }
        if (kind === "items") for (const r of Object.values(v.items)) { if (r[15]) ids.add(r[15]); }
        if (kind === "spells") for (const r of Object.values(v.spells)) { if (r[1]) ids.add(r[1]); }
        if (kind === "talents") for (const c of Object.values(v.talents)) for (const t of c.tabs) if (t.iconFileId) ids.add(t.iconFileId);
      }
      this.iconIds = { build: this.data.items?.build, ids };
    }
    return this.iconIds.ids.has(fileId);
  }
  // -> PNG Buffer, or null when the icon is unknown, missing or too large.
  icon(fileId) {
    if (!Number.isSafeInteger(fileId) || fileId <= 0) return null;
    let build;
    try { build = this.build(); } catch { return null; }
    const memo = this.iconMemo.get(fileId);
    if (memo && memo.build === build) { this.iconMemo.delete(fileId); this.iconMemo.set(fileId, memo); return memo.png; }
    const dir = path.join(this.buildDir(build), "icons"), file = path.join(dir, `${fileId}.png`);
    let png = null;
    try { png = fs.readFileSync(file); } catch {}
    if (!png) {
      if (!this.knownIcon(fileId)) return null;
      try {
        const s = this.open();
        try {
          const { decodeBlp, encodePng } = require("./blp.cjs");
          const t = decodeBlp(s.readFileId(fileId));
          if (t.width > this.maxIconSide || t.height > this.maxIconSide) return null;
          png = encodePng(t.width, t.height, t.rgba);
        } finally { this.idle(); }
      } catch { return null; }
      this.storeIcon(dir, file, png);
    }
    this.iconMemo.set(fileId, { build, png });
    while (this.iconMemo.size > this.memoryIcons) this.iconMemo.delete(this.iconMemo.keys().next().value);
    return png;
  }
  storeIcon(dir, file, png) {
    try {
      if (png.length > this.maxIconBytes) return;
      fs.mkdirSync(dir, { recursive: true });
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => { const p = path.join(dir, f), st = fs.statSync(p); return { p, size: st.size, t: st.mtimeMs }; });
      let total = files.reduce((n, f) => n + f.size, 0) + png.length;
      files.sort((a, b) => a.t - b.t);
      while (total > this.maxIconBytes && files.length) { const f = files.shift(); try { fs.rmSync(f.p, { force: true }); } catch {} total -= f.size; }
      fs.writeFileSync(file, png);
    } catch {}
  }
}

module.exports = { GameData, arithmetic, TABLES, CLASSES, SLOTS, STATS, itemView, spellView, resolveDescription, extractItems, extractSpells, extractTalents, propIndex };

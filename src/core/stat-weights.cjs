"use strict";
// Stat weights you can edit (roadmap C3). Each character picks a preset for its class and role and
// may change single weights; every gear verdict (dungeon loot, item cards, the sheet, the gear plan
// and the upgrade list handed to the game) is scored with the result. The built-in leveling row of
// gear-score.cjs is the default preset, so a character that never opens this page scores as before.
// Kept in its own small file in the app data folder (stat-weights.json), never sent anywhere.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const { WEIGHTS, SPECS, weightsFor } = require("./gear-score.cjs");

const MAX_PROFILES = 100;
// What the page lets you change: [key in the weight table, label, highest value, step].
const STATS = Object.freeze([
  ["Strength", "Strength", 3, 0.05], ["Agility", "Agility", 3, 0.05], ["Stamina", "Stamina", 3, 0.05],
  ["Intellect", "Intellect", 3, 0.05], ["Spirit", "Spirit", 3, 0.05],
  ["Attack Power", "Attack power", 3, 0.05], ["Ranged Attack Power", "Ranged attack power", 3, 0.05],
  ["Spell Damage", "Spell damage", 3, 0.05], ["Spell Power", "Spell power", 3, 0.05], ["Healing", "Healing", 3, 0.05],
  ["Hit Rating", "Hit", 3, 0.05], ["Crit Rating", "Critical strike", 3, 0.05],
  ["Mana Regeneration", "Mana regeneration", 5, 0.05], ["Health Regeneration", "Health regeneration", 5, 0.05],
  ["Defense Rating", "Defense", 3, 0.05], ["Block Value", "Block value", 3, 0.05],
  ["armor", "Armor (per point)", 0.2, 0.005],
  ["meleeDps", "Melee weapon DPS", 10, 0.1], ["rangedDps", "Ranged weapon DPS", 10, 0.1], ["wandDps", "Wand DPS", 10, 0.1],
].map(([key, label, max, step]) => Object.freeze({ key, label, max, step })));
const STAT = new Map(STATS.map((s) => [s.key, s]));
const ROLE_LABELS = Object.freeze({ leveling: "Leveling", tank: "Tank", healer: "Healer", caster: "Caster damage" });
// Roles a class can really fill; every class has the leveling preset.
const ROLE_CLASSES = Object.freeze({
  tank: ["Warrior", "Paladin", "Druid"],
  healer: ["Priest", "Paladin", "Shaman", "Druid"],
  caster: ["Mage", "Warlock", "Priest", "Shaman", "Druid"],
});
const DEFAULT = "leveling";
const classKey = (name) => Object.keys(WEIGHTS).find((k) => k.toLowerCase() === String(name || "").toLowerCase()) || null;
const round = (n) => Math.round(n * 1000) / 1000;
const snap = (value, stat) => round(Math.min(stat.max, Math.max(0, Math.round(value / stat.step) * stat.step)));

function rolesFor(className) {
  const cls = classKey(className);
  return [DEFAULT, ...Object.keys(ROLE_CLASSES).filter((role) => cls && ROLE_CLASSES[role].includes(cls))];
}
/** The editable weights of one preset, as the scoring code sees them. */
function presetWeights(className, preset = DEFAULT) {
  const cls = classKey(className);
  const role = rolesFor(cls).includes(preset) ? preset : DEFAULT;
  const all = weightsFor({ className: cls || undefined, spec: role === DEFAULT ? undefined : role });
  return Object.fromEntries(STATS.map((s) => [s.key, round(Object.hasOwn(all, s.key) ? all[s.key] : 0.1)]));
}
function presetsFor(className) {
  return rolesFor(className).map((id) => ({ id, label: ROLE_LABELS[id], weights: presetWeights(className, id) }));
}
/** A saved choice -> { preset, custom } with only real presets, known stats and values that differ. */
function normalizeChoice(raw, className) {
  const preset = raw && typeof raw.preset === "string" && rolesFor(className).includes(raw.preset) ? raw.preset : DEFAULT;
  const base = presetWeights(className, preset), custom = {};
  const src = raw && raw.custom && typeof raw.custom === "object" && !Array.isArray(raw.custom) ? raw.custom : {};
  for (const [key, value] of Object.entries(src)) {
    const stat = STAT.get(key);
    if (!stat || typeof value !== "number" || !Number.isFinite(value)) continue;
    const v = snap(value, stat);
    if (v !== base[key]) custom[key] = v;
  }
  return { preset, custom };
}
const isDefault = (choice) => !choice || (choice.preset === DEFAULT && !Object.keys(choice.custom || {}).length);
/**
 * What goes into a scoring context as `weights`: null for the untouched default (the built-in row
 * is used as is), otherwise the full row of the chosen preset with the player's changes on top.
 */
function scoringWeights(className, raw) {
  const choice = normalizeChoice(raw, className);
  if (isDefault(choice)) return null;
  const cls = classKey(className);
  return { ...weightsFor({ className: cls || undefined, spec: choice.preset === DEFAULT ? undefined : choice.preset }), ...choice.custom };
}
/** Everything the page shows for one character. */
function weightsView(className, raw) {
  const choice = normalizeChoice(raw, className), base = presetWeights(className, choice.preset);
  return {
    className: classKey(className), classKnown: Boolean(classKey(className)), preset: choice.preset, presetLabel: ROLE_LABELS[choice.preset],
    presets: rolesFor(className).map((id) => ({ id, label: ROLE_LABELS[id] })),
    isDefault: isDefault(choice), changed: Object.keys(choice.custom).length,
    stats: STATS.map((s) => ({ key: s.key, label: s.label, max: s.max, step: s.step, preset: base[s.key], value: Object.hasOwn(choice.custom, s.key) ? choice.custom[s.key] : base[s.key], changed: Object.hasOwn(choice.custom, s.key) })),
  };
}

const profileKey = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;
class StatWeights {
  constructor(dir) {
    this.file = path.join(dir, "stat-weights.json");
    this.profiles = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const profiles = raw && raw.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
      for (const [k, v] of Object.entries(profiles).slice(0, MAX_PROFILES)) if (profileKey(k) && v && typeof v === "object") {
        // The class is not known here; presets and values are checked again when they are used.
        const custom = {};
        for (const [key, value] of Object.entries(v.custom && typeof v.custom === "object" ? v.custom : {})) if (STAT.has(key) && typeof value === "number" && Number.isFinite(value)) custom[key] = snap(value, STAT.get(key));
        this.profiles[k] = { preset: Object.hasOwn(ROLE_LABELS, v.preset) ? v.preset : DEFAULT, custom };
      }
    } catch {}
  }
  get(profileId) { const v = profileKey(profileId) ? this.profiles[profileId] : null; return v ? { preset: v.preset, custom: { ...v.custom } } : null; }
  /** Saves the choice for one character; the untouched default is stored as nothing at all. */
  set(profileId, className, raw) {
    if (!profileKey(profileId)) throw Error("Choose a character.");
    const choice = normalizeChoice(raw, className);
    if (isDefault(choice)) delete this.profiles[profileId];
    else {
      if (!this.profiles[profileId] && Object.keys(this.profiles).length >= MAX_PROFILES) throw Error("Too many saved stat weights.");
      this.profiles[profileId] = choice;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomic(this.file, JSON.stringify({ schemaVersion: 1, profiles: this.profiles }) + "\n");
    return choice;
  }
  clear() { this.profiles = {}; try { fs.rmSync(this.file, { force: true }); } catch {} }
}

module.exports = { STATS, ROLE_LABELS, ROLE_CLASSES, DEFAULT, rolesFor, presetWeights, presetsFor, normalizeChoice, isDefault, scoringWeights, weightsView, StatWeights, SPECS };

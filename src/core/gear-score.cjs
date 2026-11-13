"use strict";
// Simple, explainable leveling gear scores. Pure functions over item() objects from game-data.cjs:
// no game access, no network. Weights are rough leveling priorities, not theorycraft.

// Points per unit of each stat. "armor" is per armor point; the dps keys are per point of weapon
// DPS in that kind of slot (melee, ranged bow/gun/crossbow/thrown, wand).
// Melee classes value weapon DPS most while leveling (every swing scales with it); casters value
// Intellect/Spirit (fewer drinking breaks) and wand DPS; hunters live on Agility and ranged DPS.
const WEIGHTS = {
  // 1 Strength = 2 attack power; Agility gives crit, dodge and armor. Two-handers win through DPS.
  Warrior: { Strength: 1.0, Agility: 0.6, Stamina: 0.5, Spirit: 0.1, "Attack Power": 0.5, armor: 0.02, meleeDps: 6, rangedDps: 0.5 },
  // Strength first for Retribution leveling; Intellect keeps Seal/heals going between fights.
  Paladin: { Strength: 1.0, Agility: 0.4, Stamina: 0.5, Intellect: 0.4, Spirit: 0.2, "Attack Power": 0.5, "Spell Damage": 0.3, "Spell Power": 0.3, Healing: 0.2, armor: 0.02, meleeDps: 6 },
  // Enhancement-style leveling: Strength and weapon speed/DPS, with Intellect for shocks and heals.
  Shaman: { Strength: 0.9, Agility: 0.5, Stamina: 0.5, Intellect: 0.6, Spirit: 0.3, "Attack Power": 0.45, "Spell Damage": 0.5, "Spell Power": 0.5, Healing: 0.3, armor: 0.015, meleeDps: 5 },
  // Agility is attack power, crit and dodge for rogues; main-hand DPS drives Sinister Strike.
  Rogue: { Agility: 1.0, Strength: 0.5, Stamina: 0.4, "Attack Power": 0.5, armor: 0.01, meleeDps: 6, rangedDps: 0.3 },
  // Agility gives ranged attack power and crit; Intellect is mana for Aspect/Serpent Sting.
  Hunter: { Agility: 1.0, Intellect: 0.4, Stamina: 0.5, Spirit: 0.2, Strength: 0.1, "Ranged Attack Power": 0.5, "Attack Power": 0.3, armor: 0.01, meleeDps: 0.8, rangedDps: 6 },
  // Hybrid: forms ignore weapon DPS, so stats count more than the weapon itself.
  Druid: { Strength: 0.7, Agility: 0.6, Intellect: 0.7, Spirit: 0.5, Stamina: 0.5, "Spell Damage": 0.5, "Spell Power": 0.5, Healing: 0.3, "Attack Power": 0.35, armor: 0.015, meleeDps: 0.5 },
  Mage: { Intellect: 1.0, Spirit: 0.6, Stamina: 0.5, "Spell Damage": 1.0, "Spell Power": 1.0, armor: 0.005, meleeDps: 0.2, wandDps: 2.5 },
  // Spirit drives priest regeneration (and Spirit Tap); wands carry the early levels.
  Priest: { Intellect: 0.9, Spirit: 1.0, Stamina: 0.5, "Spell Damage": 0.8, "Spell Power": 0.8, Healing: 0.5, armor: 0.005, meleeDps: 0.2, wandDps: 3 },
  // Life Tap turns Stamina into mana, so Stamina matters nearly as much as Intellect.
  Warlock: { Stamina: 0.8, Intellect: 0.8, Spirit: 0.6, "Spell Damage": 1.0, "Spell Power": 1.0, armor: 0.005, meleeDps: 0.2, wandDps: 2.5 },
};
// Small values for everything else; resistances barely matter while leveling.
const COMMON = { Health: 0.05, Mana: 0.04, "Spell Power": 0.9, "Mana Regeneration": 1.5, "Health Regeneration": 1.0, "Defense Rating": 0.3, "Block Value": 0.1, "Hit Rating": 1.0, "Crit Rating": 1.0 };
// Optional spec focus applied on top of the class row.
const SPECS = {
  tank: { Stamina: 1.0, Agility: 0.6, armor: 0.05, "Defense Rating": 1.0, "Block Value": 0.4 },
  healer: { Intellect: 1.0, Spirit: 0.8, Healing: 1.0, "Mana Regeneration": 2.0, meleeDps: 0.2 },
  caster: { Intellect: 1.0, Spirit: 0.5, "Spell Damage": 1.0, meleeDps: 0.2 },
};

// Weapon subclasses each class can learn (classic trainers). 0 1H axe, 1 2H axe, 2 bow, 3 gun,
// 4 1H mace, 5 2H mace, 6 polearm, 7 1H sword, 8 2H sword, 10 staff, 13 fist, 15 dagger,
// 16 thrown, 18 crossbow, 19 wand, 14 miscellaneous, 20 fishing pole.
const WEAPONS = {
  Warrior: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18],
  Paladin: [0, 1, 4, 5, 6, 7, 8],
  Hunter: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  Rogue: [2, 3, 4, 7, 13, 15, 16, 18],
  Priest: [4, 10, 15, 19],
  Shaman: [0, 1, 4, 5, 10, 13, 15],
  Mage: [7, 10, 15, 19],
  Warlock: [7, 10, 15, 19],
  Druid: [4, 5, 10, 13, 15],
};
// Heaviest armor: [before level 40, from level 40]. 1 cloth, 2 leather, 3 mail, 4 plate.
const ARMOR = { Warrior: [3, 4], Paladin: [3, 4], Hunter: [2, 3], Shaman: [2, 3], Rogue: [2, 2], Druid: [2, 2], Mage: [1, 1], Priest: [1, 1], Warlock: [1, 1] };
const SHIELDS = ["Warrior", "Paladin", "Shaman"];
const RELICS = { 7: "Paladin", 8: "Druid", 9: "Shaman" };
const DUAL_WIELD = { Warrior: 20, Rogue: 1, Hunter: 20 };
const ARMOR_NAMES = { 1: "cloth", 2: "leather", 3: "mail", 4: "plate" };

const className = (ctx) => {
  const n = String(ctx?.className || "").toLowerCase();
  return Object.keys(WEIGHTS).find((k) => k.toLowerCase() === n) || null;
};
function weightsFor(ctx) {
  const cls = className(ctx);
  return { ...COMMON, ...(cls ? WEIGHTS[cls] : { Strength: 0.5, Agility: 0.5, Stamina: 0.5, Intellect: 0.5, Spirit: 0.3, armor: 0.01, meleeDps: 2, rangedDps: 1, wandDps: 1 }), ...(SPECS[ctx?.spec] || {}) };
}
const isWeapon = (item) => item?.classId === 2;
function dpsKey(item) {
  if (!isWeapon(item)) return null;
  if (item.subclassId === 19) return "wandDps";
  if ([15, 25, 26].includes(item.inventoryType)) return "rangedDps";
  return "meleeDps";
}

// Can this class equip it now? -> list of reasons it cannot (empty when usable).
function blockers(item, ctx) {
  const cls = className(ctx), level = Number.isInteger(ctx?.level) ? ctx.level : null, out = [];
  if (!item) return ["Unknown item"];
  if (level !== null && item.requiredLevel > level) out.push(`Requires level ${item.requiredLevel}`);
  if (cls && Array.isArray(item.classes) && !item.classes.includes(cls)) out.push(`${cls}s cannot use it`);
  if (!cls) return out;
  if (isWeapon(item) && ![14, 20].includes(item.subclassId) && !WEAPONS[cls].includes(item.subclassId)) out.push(`${cls}s cannot use ${item.kind ? item.kind.toLowerCase() + "s" : "this weapon"}`);
  if (isWeapon(item) && item.inventoryType === 22 && !(DUAL_WIELD[cls] && (level === null || level >= DUAL_WIELD[cls]))) out.push(`${cls}s cannot dual wield${DUAL_WIELD[cls] ? " yet" : ""}`);
  if (item.classId === 4) {
    const sub = item.subclassId;
    if (sub >= 1 && sub <= 4 && item.inventoryType !== 16) {
      const max = ARMOR[cls][level !== null && level < 40 ? 0 : 1];
      if (sub > max) out.push(level !== null && level < 40 && ARMOR[cls][1] >= sub ? `${cls}s can wear ${ARMOR_NAMES[sub]} from level 40` : `${cls}s cannot wear ${ARMOR_NAMES[sub]}`);
    }
    if (sub === 6 && !SHIELDS.includes(cls)) out.push(`${cls}s cannot use shields`);
    if (RELICS[sub] && RELICS[sub] !== cls) out.push(`Only ${RELICS[sub]}s can use it`);
  }
  return out;
}

// Value of one item (no comparison).
function scoreItem(item, ctx = {}) {
  if (!item) return { score: 0, usable: false, reasons: ["Unknown item"] };
  const w = weightsFor(ctx);
  let score = 0;
  for (const s of item.stats || []) if (s.stat !== "Armor") score += (w[s.stat] ?? (/Resistance$/.test(s.stat) ? 0.05 : 0.1)) * s.amount;
  const armor = (item.armor || 0) + (item.stats || []).filter((s) => s.stat === "Armor").reduce((n, s) => n + s.amount, 0);
  score += armor * (w.armor || 0);
  const key = dpsKey(item);
  if (key && item.dps) score += item.dps * (w[key] || 0);
  const reasons = blockers(item, ctx);
  return { score: Math.round(score * 100) / 100, usable: reasons.length === 0, reasons };
}

function totals(items) {
  const stats = new Map();
  let armor = 0, dps = { meleeDps: 0, rangedDps: 0, wandDps: 0 };
  for (const it of items) {
    if (!it) continue;
    armor += it.armor || 0;
    for (const s of it.stats || []) { if (s.stat === "Armor") armor += s.amount; else stats.set(s.stat, (stats.get(s.stat) || 0) + s.amount); }
    const k = dpsKey(it);
    if (k && it.dps) dps[k] = Math.max(dps[k], it.dps);
  }
  return { stats, armor, dps };
}

// candidate vs what it would replace (an item, an array of items for a two-hander, or nothing).
function compare(candidate, equipped, ctx = {}) {
  const current = (Array.isArray(equipped) ? equipped : [equipped]).filter(Boolean);
  const mine = scoreItem(candidate, ctx);
  if (!mine.usable) return { better: false, delta: 0, reasons: mine.reasons };
  const theirs = current.reduce((n, it) => n + scoreItem(it, ctx).score, 0);
  const delta = Math.round((mine.score - theirs) * 100) / 100;
  const w = weightsFor(ctx), a = totals([candidate]), b = totals(current), lines = [];
  for (const stat of new Set([...a.stats.keys(), ...b.stats.keys()])) {
    const d = (a.stats.get(stat) || 0) - (b.stats.get(stat) || 0);
    if (d) lines.push({ text: `${d > 0 ? "+" : ""}${d} ${stat}`, weight: Math.abs(d * (w[stat] ?? 0.1)) });
  }
  if (a.armor !== b.armor) { const d = a.armor - b.armor; lines.push({ text: `${d > 0 ? "+" : ""}${d} armor`, weight: Math.abs(d * (w.armor || 0)) }); }
  for (const k of ["meleeDps", "rangedDps", "wandDps"]) {
    const d = Math.round((a.dps[k] - b.dps[k]) * 10) / 10;
    if (d && (a.dps[k] || b.dps[k])) lines.push({ text: `${d > 0 ? "+" : ""}${d} ${k === "wandDps" ? "wand " : k === "rangedDps" ? "ranged " : ""}DPS`, weight: Math.abs(d * (w[k] || 0)) });
  }
  lines.sort((x, y) => y.weight - x.weight);
  const reasons = lines.map((l) => l.text);
  if (!current.length && ctx.equipmentKnown !== false) reasons.unshift("Fills an empty slot");
  if (current.some((it) => it.unknown)) reasons.unshift("Compared without your current item's stats");
  return { better: delta > 0, delta, reasons: reasons.slice(0, 6) };
}

// Equipment slots (1 head ... 19 tabard) an item would replace.
function slotsFor(item, ctx = {}) {
  const inv = item?.inventoryType;
  const map = { 1: [1], 2: [2], 3: [3], 4: [4], 5: [5], 20: [5], 6: [6], 7: [7], 8: [8], 9: [9], 10: [10], 11: [11, 12], 12: [13, 14], 16: [15], 19: [19], 13: [16], 21: [16], 22: [17], 14: [17], 23: [17], 15: [18], 25: [18], 26: [18], 28: [18] };
  if (inv === 17) return { slots: [16, 17], together: true };
  return { slots: map[inv] || [], together: false };
}
// What the candidate replaces: both hands for a two-hander, the weaker of two rings/trinkets.
function replaced(item, ctx, equippedBySlot = {}) {
  const get = (slot) => equippedBySlot?.[slot] || equippedBySlot?.[String(slot)] || null;
  const { slots, together } = slotsFor(item, ctx);
  if (!slots.length) return { slots, items: [] };
  if (together) return { slots, items: slots.map(get).filter(Boolean) };
  if (slots.length === 1) return { slots, items: [get(slots[0])].filter(Boolean) };
  const pairs = slots.map((s) => ({ s, it: get(s) }));
  const empty = pairs.find((p) => !p.it);
  if (empty) return { slots: [empty.s], items: [] };
  pairs.sort((x, y) => scoreItem(x.it, ctx).score - scoreItem(y.it, ctx).score);
  return { slots: [pairs[0].s], items: [pairs[0].it] };
}

// choices: item() objects or quest rewards carrying { itemId, details }. Returns the pick or null.
function bestReward(choices, ctx = {}, equippedBySlot = {}) {
  const list = (choices || []).map((c, index) => ({ index, item: c?.details || (c && c.name && c.inventoryType !== undefined ? c : null) })).filter((x) => x.item);
  if (!list.length) return null;
  const rated = list.map(({ index, item }) => {
    const rep = replaced(item, ctx, equippedBySlot);
    const usable = blockers(item, ctx).length === 0;
    const equippable = usable && rep.slots.length > 0;
    const cmp = equippable ? compare(item, rep.items, ctx) : { better: false, delta: 0, reasons: usable ? ["Not equipment"] : blockers(item, ctx) };
    return { index, item, usable: equippable, score: scoreItem(item, ctx).score, ...cmp };
  });
  const usable = rated.filter((r) => r.usable);
  let pick, why;
  if (usable.length) {
    pick = usable.sort((a, b) => b.delta - a.delta || b.score - a.score || (b.item.sellPrice || 0) - (a.item.sellPrice || 0))[0];
    why = pick.better ? pick.reasons : ["No upgrade among these; this one is closest", ...pick.reasons].slice(0, 6);
  } else {
    pick = [...rated].sort((a, b) => (b.item.sellPrice || 0) - (a.item.sellPrice || 0))[0];
    why = ["None of these fit your character; this one sells for the most"];
  }
  return {
    itemId: pick.item.id, name: pick.item.name, index: pick.index, upgrade: !!(pick.usable && pick.better), delta: pick.delta, reasons: why,
    considered: rated.map((r) => ({ itemId: r.item.id, usable: r.usable, score: r.score, delta: r.delta })),
  };
}

module.exports = { WEIGHTS, SPECS, WEAPONS, ARMOR, scoreItem, compare, bestReward, blockers, slotsFor, replaced };

"use strict";
// Read-only estimates over exact installed item IDs. No comparison of instance modifiers.
const { gearAcquisition } = require("./gear-acquisition.cjs");
const buildCompat = require("./build-compat.cjs");
const { WEIGHTS, blockers, slotsFor, weightsFor, statWeight, dpsKey } = require("./gear-score.cjs");
const { SLOT_LABELS } = require("./sheet.cjs");
// "mine" scores with the stat weights the character chose (roadmap C3); the others are the built-in presets.
const ROLES = Object.freeze({ mine: "Your stat weights", leveling: "Leveling", tank: "Tank", healer: "Healer", caster: "Caster damage" });
const isId = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
const round = n => Math.round(n * 10000) / 10000 || 0;
const DPS = { meleeDps: "Melee DPS", rangedDps: "Ranged DPS", wandDps: "Wand DPS" };
const DPS_KEYS = Object.fromEntries(Object.entries(DPS).map(([key, label]) => [label, key]));

function fitsSavedSlot(item, slot, replacementSlots) {
  // A two-hander replaces both hands but is equipped in the main hand. An ordinary
  // one-hander may be recorded in either hand; blockers checks off-hand eligibility.
  if (item.inventoryType === 17) return slot === 16;
  if (item.inventoryType === 13 && item.classId === 2 && slot === 17) return true;
  return replacementSlots.includes(slot);
}

function option(input, facts, wished, ctx) {
  const totals = new Map();
  const add = (stat, amount) => { if (amount) totals.set(stat, (totals.get(stat) || 0) + amount); };
  const issues = [];
  if (!input.items.length) issues.push("No scored slots in this set.");
  const mainHand = facts.get(input.items.find(p => p.slot === 16)?.itemId);
  if (mainHand?.inventoryType === 17 && input.items.some(p => p.slot === 17)) issues.push("The saved set has a two-handed weapon and an off-hand item.");
  const pieces = input.items.map(({ itemId, name, slot }) => {
    const it = facts.get(itemId);
    const piece = { itemId, name: it?.name || name || `Item #${itemId}`, slot: SLOT_LABELS[slot] || it?.slot || null, wished: wished.has(itemId) };
    const warn = text => issues.push(`#${itemId}: ${text}`);
    if (!it) { warn("Exact item data unavailable."); return piece; }
    const { slots } = slotsFor(it, ctx);
    if (![2, 4].includes(it.classId) || !slots.some(s => s !== 4 && s !== 19) || (slot && !fitsSavedSlot(it, slot, slots))) {
      warn("Not scoreable equipment for this slot."); return piece;
    }
    for (const reason of blockers(it, ctx, slot)) warn(reason);
    if (!Number.isInteger(it.requiredLevel) || !(it.classes === null || Array.isArray(it.classes))) warn("Equip restrictions are incomplete.");
    if (!Array.isArray(it.stats)) warn("Base stat data unavailable.");
    else for (const { stat, amount } of it.stats) {
      if (!Number.isFinite(amount) || /^Stat \d+$/.test(stat)) { warn(`Unscored base stat: ${stat}.`); continue; }
      add(stat, amount);
    }
    if (Number.isFinite(it.armor)) add("Armor", it.armor);
    else if (it.classId === 4) warn("Armor data unavailable.");
    const key = dpsKey(it);
    if (key && !Number.isFinite(it.dps)) warn("Weapon DPS unavailable.");
    else if (key) add(DPS[key], it.dps);
    return piece;
  });
  return { name: input.name || pieces[0]?.name, pieces, issues: [...new Set(issues)], totals };
}

function registerSheetComparison({ handle, getState, gameData, wishlist, weightsFor: chosenWeights = () => null }) {
  handle("sheetComparison", (...args) => {
    const [profileId, role, mode, a, b] = args;
    const invalid = () => { throw Error("Choose two different options and a supported role."); };
    if (![1, 5].includes(args.length) || typeof profileId !== "string" || !profileId || profileId.length > 100) invalid();
    const state = getState();
    const profile = state.profiles.find(p => p.id === state.activeProfileId && p.id === profileId);
    if (!profile) throw Error("The active character changed.");
    const sets = profile.gearSets?.sets || [], wished = wishlist.get(profile.id);
    const { clientBuild: build, className, level } = profile;
    if (args.length === 1) {
      const { leads } = gearAcquisition(profile, gameData, wished);
      return { profileId, roles: ROLES, sets: sets.map(s => s.name), wished,
        leads: leads.map(({ itemId, itemName, kind, sourceName }) => ({ itemId, itemName, kind, sourceName })) };
    }
    if (typeof role !== "string" || !Object.hasOwn(ROLES, role) || a === b) invalid();
    let inputs;
    if (mode === "items" && [a, b].every(isId)) inputs = [a, b].map(itemId => ({ items: [{ itemId }] }));
    else if (mode === "sets" && [a, b].every(name => typeof name === "string" && name.length <= 24)) {
      inputs = [a, b].map(name => sets.find(s => s.name === name));
      if (inputs.some(s => !s)) invalid();
      inputs = inputs.map(s => ({ name: s.name, items: s.items.filter(p => p.slot !== 4 && p.slot !== 19) }));
    } else invalid();
    const result = { profileId, build: build || null, className, role: ROLES[role], mode };
    let installed;
    try { installed = gameData.build(); } catch {}
    if (profile.source?.kind !== "wow-addon" || !/^\d+\.\d+\.\d+\.\d+$/.test(build || "") || !buildCompat.usable(installed, build))
      return { ...result, reason: "A saved addon character and an installed WoW Forever game on the same patch are required." };
    if (!Object.hasOwn(WEIGHTS, className) || !Number.isInteger(level))
      return { ...result, reason: "The saved class or level is unavailable for this estimate." };
    let own = null;
    if (role === "mine") try { own = chosenWeights(profile) || null; } catch {}
    const ctx = role === "mine" ? { className, level, ...(own ? { weights: own } : {}) } : { className, level, spec: role }, weights = weightsFor(ctx);
    const ids = [...new Set(inputs.flatMap(input => input.items.map(p => p.itemId)))];
    let found = [];
    try { found = ids.length ? gameData.items(ids) : []; } catch {}
    const facts = new Map(ids.flatMap((id, i) => found[i]?.id === id ? [[id, found[i]]] : []));
    const wishIds = new Set(wished);
    const options = inputs.map(input => option(input, facts, wishIds, ctx));
    const [left, right] = options;
    const weight = stat => stat === "Armor" ? weights.armor : Object.hasOwn(DPS_KEYS, stat) ? weights[DPS_KEYS[stat]] || 0 : statWeight(weights, stat);
    const rows = [...new Set([...left.totals.keys(), ...right.totals.keys()])].map(stat => {
      const w = weight(stat), a = left.totals.get(stat) || 0, b = right.totals.get(stat) || 0;
      return { stat, weight: w, a, b, points: round((b - a) * w) };
    }).sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.stat.localeCompare(b.stat));
    const sameCoverage = mode === "items" || inputs[0].items.map(p => p.slot).join() === inputs[1].items.map(p => p.slot).join();
    const comparable = sameCoverage && options.every(o => !o.issues.length);
    return { ...result, sameCoverage, rows, delta: comparable ? round(rows.reduce((n, r) => n + (r.b - r.a) * r.weight, 0)) : null,
      options: options.map(({ totals, ...o }) => ({ ...o, score: o.issues.length ? null : round([...totals].reduce((n, [stat, amount]) => n + amount * weight(stat), 0)) })) };
  });
}
module.exports = { registerSheetComparison };

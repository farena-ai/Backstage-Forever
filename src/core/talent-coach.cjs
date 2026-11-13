"use strict";
// Talent coach: solo-friendly leveling paths per class, placed on the player's own talent trees
// (read from their install). Paths are Backstage Coding's own advice, written against WoW Forever's
// trees; the planner obeys the game's rules (5 points per row, prerequisites) and skips anything
// it cannot find, so a renamed or hidden talent never produces an impossible plan.

// Each step: [tree, talent name, ranks to reach]. Order is the order to spend points.
const BUILDS = Object.freeze({
  Warrior: { tree: "Arms", why: "Big two-handed hits, Sweeping Strikes for groups, and Mortal Strike at 40. Rage stays high, downtime stays low.", steps: [
    ["Arms", "Improved Heroic Strike", 3], ["Arms", "Deflection", 2], ["Arms", "Improved Tactical Mastery", 5], ["Arms", "Improved Overpower", 2],
    ["Arms", "Anger Management", 1], ["Arms", "Improved Rend", 3], ["Arms", "Deep Wounds", 3], ["Arms", "Two-Handed Weapon Specialization", 5], ["Arms", "Impale", 2],
    ["Arms", "Sweeping Strikes", 1], ["Arms", "Weaponmaster", 5], ["Arms", "Improved Hamstring", 3], ["Arms", "Mortal Strike", 1],
    ["Fury", "Cruelty", 5], ["Fury", "Unbridled Wrath", 5], ["Fury", "Improved Battle Shout", 5], ["Fury", "Enrage", 5], ["Fury", "Improved Cleave", 3]] },
  Paladin: { tree: "Retribution", why: "Seal of Command and two-handed weapon damage kill fast, with strong self-healing between pulls.", steps: [
    ["Retribution", "Benediction", 5], ["Retribution", "Improved Judgement", 2], ["Retribution", "Improved Seal of the Crusader", 3], ["Retribution", "Deflection", 5],
    ["Retribution", "Seal of Command", 1], ["Retribution", "Conviction", 5], ["Retribution", "Pursuit of Justice", 2], ["Retribution", "Vindication", 3],
    ["Retribution", "Two-Handed Weapon Specialization", 3], ["Retribution", "Sanctity Aura", 1], ["Retribution", "Vengeance", 5], ["Retribution", "Repentance", 1],
    ["Holy", "Divine Strength", 5], ["Holy", "Divine Intellect", 5], ["Protection", "Improved Devotion Aura", 5], ["Protection", "Precision", 3]] },
  Hunter: { tree: "Beast Mastery", why: "Your pet does the heavy lifting: tougher and faster pets mean safe, quick kills and almost no deaths.", steps: [
    ["Beast Mastery", "Improved Aspect of the Monkey", 1], ["Beast Mastery", "Endurance Training", 4], ["Beast Mastery", "Improved Aspect of the Monkey", 5], ["Beast Mastery", "Thick Hide", 3],
    ["Beast Mastery", "Pathfinding", 2], ["Beast Mastery", "Unleashed Fury", 5], ["Beast Mastery", "Improved Mend Pet", 2], ["Beast Mastery", "Ferocity", 5],
    ["Beast Mastery", "Intimidation", 1], ["Beast Mastery", "Bestial Discipline", 2], ["Beast Mastery", "Spirit Bond", 2], ["Beast Mastery", "Frenzy", 5], ["Beast Mastery", "Bestial Wrath", 1],
    ["Marksmanship", "Improved Concussive Shot", 5], ["Marksmanship", "Lethal Attacks", 5], ["Marksmanship", "Aimed Shot", 1], ["Marksmanship", "Improved Arcane Shot", 5]] },
  Rogue: { tree: "Combat", why: "Reliable damage and survivability: Riposte, Blade Flurry and Adrenaline Rush turn bad pulls around.", steps: [
    ["Combat", "Improved Gouge", 3], ["Combat", "Lightning Reflexes", 2], ["Combat", "Precision", 5], ["Combat", "Deflection", 5],
    ["Combat", "Riposte", 1], ["Combat", "Endurance", 2], ["Combat", "Dual Wield Specialization", 5], ["Combat", "Improved Sprint", 2],
    ["Combat", "Blade Flurry", 1], ["Combat", "Hack and Slash", 5], ["Combat", "Weapon Expertise", 2], ["Combat", "Aggression", 3], ["Combat", "Adrenaline Rush", 1],
    ["Assassination", "Malice", 5], ["Assassination", "Ruthlessness", 3], ["Assassination", "Murder", 2], ["Assassination", "Improved Slice and Dice", 3], ["Assassination", "Relentless Strikes", 1], ["Assassination", "Lethality", 5]] },
  Priest: { tree: "Shadow", why: "Spirit Tap and Shadowform make you a self-sufficient damage dealer who rarely stops to drink.", steps: [
    ["Shadow", "Spirit Tap", 5], ["Shadow", "Blackout", 5], ["Shadow", "Improved Shadow Word: Pain", 2], ["Shadow", "Shadow Focus", 3],
    ["Shadow", "Improved Mind Blast", 5], ["Shadow", "Mind Flay", 1], ["Shadow", "Shadow Reach", 3], ["Shadow", "Shadow Weaving", 5],
    ["Shadow", "Vampiric Embrace", 1], ["Shadow", "Improved Vampiric Embrace", 2], ["Shadow", "Darkness", 5], ["Shadow", "Shadowform", 1],
    ["Discipline", "Wand Specialization", 5], ["Discipline", "Improved Power Word: Shield", 3], ["Discipline", "Improved Power Word: Fortitude", 2], ["Discipline", "Meditation", 3]] },
  Shaman: { tree: "Enhancement", why: "Big two-handed weapons with Windfury, Flurry and Stormstrike, plus shields and totems for safety.", steps: [
    ["Enhancement", "Ancestral Knowledge", 5], ["Enhancement", "Shield Specialization", 2], ["Enhancement", "Thundering Strikes", 5], ["Enhancement", "Improved Ghost Wolf", 2],
    ["Enhancement", "Two-Handed Axes and Maces", 1], ["Enhancement", "Enhancing Totems", 2], ["Enhancement", "Flurry", 5], ["Enhancement", "Elemental Weapons", 3],
    ["Enhancement", "Toughness", 2], ["Enhancement", "Spirit Weapons", 1], ["Enhancement", "Weapon Mastery", 5], ["Enhancement", "Stormstrike", 1],
    ["Restoration", "Improved Healing Wave", 5], ["Restoration", "Tidal Focus", 5], ["Restoration", "Totemic Focus", 5], ["Restoration", "Nature's Guidance", 3]] },
  Mage: { tree: "Frost", why: "Frost slows everything down: safe kiting, long-range Frostbolts and Ice Barrier keep you alive.", steps: [
    ["Frost", "Improved Frostbolt", 5], ["Frost", "Ice Shards", 5], ["Frost", "Frostbite", 3], ["Frost", "Permafrost", 3], ["Frost", "Piercing Ice", 3],
    ["Frost", "Improved Blizzard", 1], ["Frost", "Arctic Reach", 2], ["Frost", "Frost Channeling", 3], ["Frost", "Improved Frost Nova", 2], ["Frost", "Shatter", 5], ["Frost", "Ice Block", 1],
    ["Frost", "Improved Cone of Cold", 3], ["Frost", "Winter's Chill", 2], ["Frost", "Ice Barrier", 1],
    ["Arcane", "Arcane Subtlety", 2], ["Arcane", "Arcane Focus", 3], ["Arcane", "Improved Channeling", 0], ["Arcane", "Arcane Concentration", 5], ["Arcane", "Arcane Meditation", 3]] },
  Warlock: { tree: "Affliction", why: "Damage over time while your pet tanks: drain, life tap and move on with very little downtime.", steps: [
    ["Affliction", "Improved Corruption", 5], ["Affliction", "Improved Life Tap", 2], ["Affliction", "Suppression", 3], ["Affliction", "Improved Bane of Agony", 3],
    ["Affliction", "Fel Concentration", 2], ["Affliction", "Amplify Curse", 1], ["Affliction", "Nightfall", 2], ["Affliction", "Grim Reach", 2],
    ["Affliction", "Siphon Life", 1], ["Affliction", "Shadow Mastery", 5],
    ["Demonology", "Improved Imp", 3], ["Demonology", "Demonic Embrace", 5], ["Demonology", "Improved Voidwalker", 3], ["Demonology", "Fel Vitality", 3], ["Demonology", "Fel Domination", 1], ["Demonology", "Unholy Power", 5]] },
  Druid: { tree: "Feral Combat", why: "Cat form for fast kills and bear form when things go wrong, with almost no mana downtime.", steps: [
    ["Feral Combat", "Ferocity", 5], ["Feral Combat", "Feral Instinct", 3], ["Feral Combat", "Thick Hide", 2], ["Feral Combat", "Feral Swiftness", 2], ["Feral Combat", "Sharpened Claws", 3],
    ["Feral Combat", "Feral Charge (Bear)", 1], ["Feral Combat", "Predatory Strikes", 3], ["Feral Combat", "Blood Frenzy", 2], ["Feral Combat", "Shredding Attacks", 2],
    ["Feral Combat", "Savage Fury", 2], ["Feral Combat", "Heart of the Wild", 5], ["Feral Combat", "Leader of the Pack", 1],
    ["Restoration", "Furor", 5], ["Restoration", "Improved Mark of the Wild", 5], ["Restoration", "Naturalist", 5]] },
});
const maxPoints = (level) => Math.max(0, Math.min(51, (Number(level) || 0) - 9));

// Pure: lay a build onto the player's real trees. Returns an ordered list of single points.
function plan(trees, className) {
  const build = BUILDS[className];
  if (!build || !trees?.tabs?.length) return null;
  const tab = (name) => trees.tabs.find((t) => t.name === name);
  const spent = new Map(); // talentId -> ranks
  const inTree = new Map(); // tab name -> points
  const order = [], missing = [];
  const canTake = (t, tabName) => {
    if ((inTree.get(tabName) || 0) < t.row * 5) return false;
    return (t.prerequisites || []).every((p) => (spent.get(p.talentId) || 0) >= (p.rank || 1));
  };
  const take = (t, tabName, upTo) => {
    let took = false;
    while ((spent.get(t.id) || 0) < Math.min(upTo, t.maxRank) && order.length < 51 && canTake(t, tabName)) {
      spent.set(t.id, (spent.get(t.id) || 0) + 1); inTree.set(tabName, (inTree.get(tabName) || 0) + 1);
      order.push({ tab: tabName, talentId: t.id, name: t.name, rank: spent.get(t.id), maxRank: t.maxRank, row: t.row, column: t.column, iconFileId: t.iconFileId || null });
      took = true;
    }
    return took;
  };
  // Fill a tree's cheapest-useful filler talents when a row gate blocks the next step.
  const filler = (tabName, needRow) => {
    const tb = tab(tabName); if (!tb) return false;
    for (let row = 0; row < needRow && (inTree.get(tabName) || 0) < needRow * 5; row++)
      for (const t of tb.talents.filter((x) => x.row === row && x.name).sort((a, b) => a.column - b.column))
        while ((inTree.get(tabName) || 0) < needRow * 5 && (spent.get(t.id) || 0) < t.maxRank && order.length < 51 && canTake(t, tabName)) take(t, tabName, (spent.get(t.id) || 0) + 1);
    return (inTree.get(tabName) || 0) >= needRow * 5;
  };
  for (const [tabName, name, ranks] of build.steps) {
    if (order.length >= 51) break;
    const tb = tab(tabName);
    const candidates = tb?.talents.filter((t) => t.name === name) || [];
    if (!candidates.length || ranks <= 0) { if (ranks > 0) missing.push(`${name} (${tabName})`); continue; }
    // Several talents can share a name (e.g. three "Weaponmaster"): take the first that can still grow.
    const t = candidates.find((c) => (spent.get(c.id) || 0) < Math.min(ranks, c.maxRank)) || candidates[0];
    if (!canTake(t, tabName)) filler(tabName, t.row);
    if (!take(t, tabName, ranks) && (spent.get(t.id) || 0) < Math.min(ranks, t.maxRank)) missing.push(`${name} (${tabName})`);
  }
  // Any points left: deepen the main tree, top to bottom.
  const main = tab(build.tree);
  for (const t of (main?.talents || []).filter((x) => x.name).sort((a, b) => a.row - b.row || a.column - b.column)) take(t, build.tree, t.maxRank);
  return { className, tree: build.tree, why: build.why, order, missing };
}

// What to do at this level: points you should have, the next ones to spend, per-tree totals.
function coach(trees, className, level) {
  const p = plan(trees, className);
  if (!p) return null;
  const have = Math.min(maxPoints(level), p.order.length);
  const totals = {};
  for (const s of p.order.slice(0, have)) totals[s.tab] = (totals[s.tab] || 0) + 1;
  return { ...p, level: Number(level) || null, points: maxPoints(level), spentByNow: p.order.slice(0, have), next: p.order.slice(have, have + 5), totals, firstAt: 10 };
}

module.exports = { BUILDS, plan, coach, maxPoints };

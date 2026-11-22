"use strict";
// Collections (roadmap C11, first cut): only what the saved data can prove. The addon saves what a
// character carries (bags, bank), wears, and the recipes its professions know; the player's own
// game files say which of those items are mounts, companion pets, tabards or recipe scrolls. A
// mount or pet that was learned and no longer sits in a bag is not saved anywhere, so it cannot be
// listed, and nothing here says what is missing. Pure.
const FAMILIES = Object.freeze([
  { key: "mounts", label: "Mounts", is: (it) => it.classId === 15 && it.subclassId === 5 },
  { key: "pets", label: "Companion pets", is: (it) => it.classId === 15 && it.subclassId === 2 },
  { key: "tabards", label: "Tabards", is: (it) => it.inventoryType === 19 },
  { key: "recipes", label: "Recipes not learned yet", is: (it) => it.classId === 9 },
]);
const PLACES = Object.freeze({ worn: "worn", bags: "bags", bank: "bank" });

/** itemFact(id) -> item facts from the player's game files, or null. */
function collections(profile, { itemFact = () => null } = {}) {
  const base = { profileId: profile?.id ?? null };
  if (!profile) return { ...base, status: "unavailable", reason: "Pick or create a character first.", families: [], recipes: [] };
  const fact = (id) => { try { return itemFact(id) || null; } catch { return null; } };
  const held = new Map();
  const add = (id, n, where, name, quality) => {
    if (!Number.isSafeInteger(id) || id < 1) return;
    const row = held.get(id) || { itemId: id, name: name || null, quality: quality ?? null, count: 0, where: [] };
    row.count += n; if (!row.where.includes(where)) row.where.push(where);
    if (!row.name && name) row.name = name;
    held.set(id, row);
  };
  for (const e of profile.readiness?.equipment || []) add(e.itemId, 1, PLACES.worn, e.name, e.quality);
  for (const key of ["bags", "bank"]) for (const e of profile.ledger?.[key]?.items || []) add(e.id, e.n, PLACES[key], e.name, e.q);
  let known = 0;
  const families = FAMILIES.map((f) => ({ key: f.key, label: f.label, items: [] }));
  for (const row of held.values()) {
    const it = fact(row.itemId);
    if (!it) continue;
    known++;
    const i = FAMILIES.findIndex((f) => f.is(it));
    if (i < 0) continue;
    families[i].items.push({ ...row, name: it.name || row.name || `Item #${row.itemId}`, quality: Number.isInteger(it.quality) ? it.quality : row.quality, iconFileId: it.iconFileId || null });
  }
  for (const f of families) { f.items.sort((a, b) => a.name.localeCompare(b.name) || a.itemId - b.itemId); f.count = f.items.length; }
  // Recipes the professions know, as the addon saved them, counted per profession.
  const workshop = profile.readiness?.workshop, byLine = new Map();
  for (const r of workshop?.recipes?.items || []) byLine.set(r.skillLineId, (byLine.get(r.skillLineId) || 0) + 1);
  // The id list in the extras block is not cut at 100 recipes, so its count wins where it is higher.
  const idList = require("./capture-extras.cjs").knownRecipeList(profile);
  for (const [line, row] of idList?.lines || []) if (row.count > (byLine.get(line) || 0)) byLine.set(line, row.count);
  const seen = new Set(), recipes = [];
  for (const p of workshop?.professions?.items || []) {
    if (!byLine.has(p.skillLineId) || seen.has(p.name)) continue;
    seen.add(p.name);
    recipes.push({ profession: p.name, rank: Number.isInteger(p.rank) ? p.rank : null, count: byLine.get(p.skillLineId) });
  }
  recipes.sort((a, b) => b.count - a.count || a.profession.localeCompare(b.profession));
  const bagsKnown = Boolean(profile.ledger?.bags), bankKnown = Boolean(profile.ledger?.bank);
  const notes = [];
  if (!bagsKnown) notes.push("Bags are not saved for this character yet. Log in with the addon on, then type /reload once.");
  else if (!bankKnown) notes.push("The bank was not seen yet. Open it once in game.");
  if (held.size && !known) notes.push("Item kinds are not available. Connect your WoW Forever folder so the app can read them from your own game files.");
  notes.push("Only what sits in your bags or bank, or is worn, can be listed. A mount or pet you learned is not saved by the game for the addon to read.");
  if (workshop?.recipes && workshop.recipes.complete === false && !(idList && [...idList.lines.values()].every((l) => l.whole))) notes.push("The recipe list was not complete at the last save, so the recipe counts may be low.");
  return { ...base, status: "available", bagsKnown, bankKnown, itemsChecked: held.size, itemsKnown: known,
    bagsSeenAt: profile.ledger?.bags?.seenAt ?? null, bankSeenAt: profile.ledger?.bank?.seenAt ?? null,
    families, recipes, recipesKnown: recipes.reduce((n, r) => n + r.count, 0), recipesSeen: Boolean(workshop?.recipes), notes };
}

module.exports = { collections };

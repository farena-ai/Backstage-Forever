"use strict";
const { validateState, str } = require("./validation.cjs");
const { applyJourneyAction } = require("./journeys.cjs");
function invalid() { throw Error("Invalid preparation request."); }
function validatePreparationOptions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !["recipeId", "crafts"].includes(key))) invalid();
  const out = { crafts: value.crafts === undefined ? 1 : value.crafts };
  if (!Number.isSafeInteger(out.crafts) || out.crafts < 1 || out.crafts > 20) invalid();
  if (value.recipeId !== undefined) {
    if (!Number.isSafeInteger(value.recipeId) || value.recipeId < 1 || value.recipeId > 2147483647) invalid();
    out.recipeId = value.recipeId;
  }
  return out;
}
function character(profile) {
  const p = profile || {};
  return { id: p.id ?? null, name: p.name || "Choose a character", realm: p.realm ?? null, className: p.className || null, level: p.level ?? null, race: p.race ?? null, faction: p.faction ?? null };
}
function source(profile) {
  return profile?.source ? { kind: profile.source.kind, updatedAt: profile.source.updatedAt, clientBuild: profile.clientBuild ?? null } : null;
}
function coverage(collection) {
  return { status: !collection ? "unknown" : collection.complete ? "complete" : "partial", observedAt: collection?.observedAt ?? null, complete: collection?.complete ?? null, itemCount: collection?.items.length ?? null };
}
function facts(profile) {
  const workshop = profile?.readiness?.workshop;
  return { character: character(profile), source: source(profile), coverage: Object.fromEntries(["professions", "recipes", "materials"].map(key => [key, coverage(workshop?.[key])])), professions: workshop?.professions?.items || [], recipes: workshop?.recipes?.items || [], materials: workshop?.materials?.items || [] };
}
/** A dated local projection, not a crafting eligibility or live inventory assertion. */
function buildPreparation(state, profileId, options = {}) {
  if (profileId !== null) str(profileId, 100, false);
  const valid = validateState(state), settings = validatePreparationOptions(options);
  const profile = valid.profiles.find(p => p.id === profileId), selected = facts(profile), workshop = profile?.readiness?.workshop;
  const owned = recipe => selected.professions.some(p => p.skillLineId === recipe.skillLineId);
  const recipe = settings.recipeId !== undefined ? selected.recipes.find(r => r.id === settings.recipeId) :
    selected.recipes.find(r => owned(r) && r.reagentsKnown && r.reagents.length) || selected.recipes.find(owned) || selected.recipes[0];
  const profession = recipe ? selected.professions.find(p => p.skillLineId === recipe.skillLineId) : null;
  const sourceValid = profile?.source?.kind === "wow-addon" && Boolean(profile.clientBuild) &&
    Object.values(workshop || {}).every(c => c.observedAt <= profile.source.updatedAt);
  const reason = !sourceValid ? "Import a saved addon character with compatible source dates and build."
    : !workshop?.recipes ? "Known recipes have not been observed."
    : !recipe ? "The selected recipe is unavailable in the saved observations."
    : !profession ? "This recipe has no currently observed owned profession."
    : !recipe.reagentsKnown ? "This recipe's required materials are unknown or ambiguous."
    : !recipe.reagents.length ? "No material checklist is available for this recipe."
    : null;
  const available = reason === null;
  // A material collection older than the recipe is useful dated context, not an exact shortfall source.
  const inventoryExact = Boolean(available && workshop.materials?.complete && workshop.materials.observedAt >= workshop.recipes.observedAt);
  const materialById = new Map(selected.materials.map(m => [m.itemId, m]));
  const shoppingRows = available ? recipe.reagents.map(reagent => {
    const material = materialById.get(reagent.itemId), required = reagent.required * settings.crafts;
    return { itemId: reagent.itemId, name: reagent.name || material?.name || `Item ${reagent.itemId}`, required,
      have: material?.count ?? (workshop.materials ? 0 : null),
      quantityKind: inventoryExact ? "exact" : workshop.materials ? "lower-bound" : "unknown",
      missing: inventoryExact ? Math.max(0, required - (material?.count || 0)) : null };
  }) : [];
  return structuredClone({ version: 1, status: available ? "ready" : workshop?.recipes?.complete && !selected.recipes.length ? "empty" : "unavailable",
    ...selected, equipment: profile?.readiness?.equipment ?? null, bags: profile?.readiness?.bags ?? null,
    selection: { recipeId: recipe?.id ?? null, crafts: settings.crafts }, selectedRecipe: recipe || null, profession: profession || null,
    planning: { available, reason, requirementsKnown: recipe?.reagentsKnown === true, inventoryExact, checklistAvailable: available }, shoppingRows,
    otherCharacters: valid.profiles.filter(p => p.id !== profileId && p.readiness?.workshop).map(facts),
    limitations: ["Desktop observations are last saved, not live game inventory.", "Crafts means craft attempts or batches, not guaranteed output items or skill-ups.", "Materials cover backpack plus four bags (bags 0–4), excluding all other storage.", "Partial carried counts are lower-bound observations; absent items and exact shortfalls are unknown.", "Other characters are separate dated observations; no transfer or automatic subtraction is assumed.", "Checklists are manual and do not craft, purchase or automatically complete anything."] });
}
function createPreparationJourney(state, profileId, options, { now = Date.now(), id } = {}) {
  str(profileId, 100, false);
  const valid = validateState(state), settings = validatePreparationOptions(options);
  if (state.activeProfileId !== profileId) throw Error("Choose the current saved addon character for a preparation checklist.");
  const preparation = buildPreparation(valid, profileId, settings);
  if (!preparation.planning.checklistAvailable) throw Error("Known recipe materials are unavailable for a manual checklist.");
  const hooks = { now, ...(id ? { id } : {}) }, recipe = preparation.selectedRecipe;
  let next = applyJourneyAction(valid, { type: "create", title: `${recipe.name} — ${settings.crafts} craft attempt${settings.crafts === 1 ? "" : "s"}`.slice(0, 100), template: "blank", profileId }, hooks);
  const journeyId = next.journeys.at(-1).id;
  const add = text => { next = applyJourneyAction(next, { type: "add-note", journeyId, profileId, text: text.slice(0, 300) }, hooks); };
  if (!preparation.planning.inventoryExact) add("Manual material check: carried supply is incomplete or unknown. Quantities below are total requirements. Review actual carried supply manually.");
  for (const row of preparation.shoppingRows) {
    if (!preparation.planning.inventoryExact) add(`Check total required: ${row.required} × ${row.name} (item ${row.itemId}). Carried supply is incomplete or unknown.`);
    else if (row.missing === 0) add(`Manually verify ${row.required} × ${row.name} (item ${row.itemId}); saved carried supply met this requirement.`);
    else add(`Check shortfall: ${row.missing} × ${row.name} (item ${row.itemId}); ${row.required} total required, ${row.have} carried in the saved observation.`);
  }
  return { state: next, journeyId };
}
module.exports = { buildPreparation, createPreparationJourney, validatePreparationOptions };

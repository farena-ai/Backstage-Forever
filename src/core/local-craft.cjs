"use strict";
const { createHash } = require("node:crypto");
const fs = require("node:fs"), path = require("node:path");
const MAX_TOKEN = 75; // 10-digit recipe ID, colon and SHA-256 digest.
const LEGACY_FILE = "local-craft.json";
const LEGACY_STAGE = /^local-craft\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const DAY = 86400000;
const id = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

function choiceScope(profile) {
  return profile?.source?.kind === "wow-addon" && profile.clientBuild
    ? { profileId: profile.id, sourceId: profile.source.id, build: profile.clientBuild } : null;
}
function sameScope(choice, profile) {
  const scope = choiceScope(profile);
  return scope && Object.keys(scope).every(k => choice[k] === scope[k]);
}
function sameChoice(a, b) {
  return ["profileId", "sourceId", "build", "recipeId", "skillLineId", "itemId"].every(k => a[k] === b[k]);
}

// Qualify the recipe, not the crafter's supplies, rank forecast, cooldown or ability to trade.
function candidate(profile, recipeId, now = Date.now(), generation) {
  const scope = choiceScope(profile), workshop = profile?.readiness?.workshop;
  if (!scope || !id(recipeId) || !workshop?.recipes || !workshop.professions) return null;
  const dates = [workshop.professions.observedAt, workshop.recipes.observedAt, profile.source.updatedAt].map(Date.parse);
  if (!dates.every(d => Number.isFinite(d) && d > 0) || dates[0] > dates[1] || dates[1] > dates[2] || dates[2] > now) return null;
  const recipe = workshop.recipes.items.find(r => r.id === recipeId);
  if (!recipe || !id(recipe.outputItemId) || !workshop.professions.items.some(p => p.skillLineId === recipe.skillLineId)) return null;
  const choice = { ...scope, recipeId, skillLineId: recipe.skillLineId, itemId: recipe.outputItemId };
  const observedAt = workshop.recipes.observedAt;
  const fingerprint = createHash("sha256").update(JSON.stringify([choice, observedAt, recipe.name, generation])).digest("hex");
  return { choice, token: `${recipeId}:${fingerprint}`,
    lead: { character: profile.name, realm: profile.realm ?? null, recipe: recipe.name, itemId: choice.itemId,
      observedAt, stale: now - dates[1] > DAY } };
}

function eligibleLead(profile, choice, now) {
  if (!sameScope(choice, profile)) return null;
  const match = candidate(profile, choice.recipeId, now);
  return match && sameChoice(match.choice, choice) ? match.lead : null;
}
function ledgerCraftLeads(state, choices, now = Date.now()) {
  const active = state.profiles.find(p => p.id === state.activeProfileId);
  if (!choiceScope(active)) return [];
  return choices.flatMap(choice => {
    if (choice.build !== active.clientBuild) return [];
    const lead = eligibleLead(state.profiles.find(p => p.id === choice.profileId), choice, now);
    return lead ? [lead] : [];
  });
}
function localCraftLeads(state, choices, model, now = Date.now()) {
  if (model.batchDecision?.status !== "planned") return [];
  const needs = new Set(model.batchDecision.rows.filter(row => row.missing > 0).map(row => row.itemId));
  return ledgerCraftLeads(state, choices.filter(c => c.profileId !== state.activeProfileId && needs.has(c.itemId)), now);
}
const removalToken = generation => `remove:${generation}`;
function workshopCraft(state, choices, model, now, generation) {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const saved = choices.find(c => sameScope(c, profile));
  const current = candidate(profile, model.selectedRecipe?.id, now, generation);
  return { enabled: Boolean(saved), removeToken: saved ? removalToken(generation) : null, saved: saved ? eligibleLead(profile, saved, now) : null,
    choice: current && (!saved || !sameChoice(saved, current.choice)) ? { token: current.token, ...current.lead } : null,
    leads: localCraftLeads(state, choices, model, now) };
}
function clearLegacyLocalCraft(dir) {
  let complete = true;
  try {
    const entries = fs.opendirSync(dir);
    try {
      let entry;
      while ((entry = entries.readSync())) {
        if (entry.name !== LEGACY_FILE && !LEGACY_STAGE.test(entry.name)) continue;
        try { fs.unlinkSync(path.join(dir, entry.name)); }
        catch (error) { if (error.code !== "ENOENT") complete = false; }
      }
    } finally { entries.closeSync(); }
  } catch { return false; }
  return complete;
}
module.exports = { MAX_TOKEN, candidate, sameScope, removalToken, ledgerCraftLeads, localCraftLeads, workshopCraft, clearLegacyLocalCraft };

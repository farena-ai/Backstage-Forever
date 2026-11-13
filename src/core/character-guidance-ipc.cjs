"use strict";
const crypto = require("node:crypto");
const { buildCharacterGuidance, searchHistoricalTrainers, checklistSteps, guidancePrompt } = require("./character-guidance.cjs");
const { applyJourneyAction } = require("./journeys.cjs");
const INVALID = "Invalid character guidance request.", EXPIRED = "Refresh character guidance before using this choice.";
// Gear review from the player's own install: icon and stats per slot, and how each piece holds up at this level.
function gearReview(model, profile, gameData) {
  const rows = model?.gear?.rows || [];
  if (!gameData || !rows.length) return;
  const details = gameData.items(rows.map((r) => r.itemId));
  if (!details.some(Boolean)) return;
  const level = Number.isInteger(profile?.level) ? profile.level : null;
  const ctx = { className: profile?.className, level };
  const { scoreItem } = require("./gear-score.cjs");
  rows.forEach((r, i) => {
    const d = details[i]; if (!d) return;
    r.details = d;
    const ilvl = d.itemLevel ?? r.itemLevel;
    const gap = level && ilvl ? level - ilvl : null;
    r.rating = gap === null ? null : gap <= 3 ? "fresh" : gap <= 8 ? "aging" : "replace";
    r.score = Math.round(scoreItem(d, ctx).score * 10) / 10;
  });
  const skip = new Set(["Shirt", "Tabard", "Body", "Tabard slot"]);
  model.gear.weakest = rows.filter((r) => r.details && r.rating && r.rating !== "fresh" && !skip.has(r.details.slot)).sort((a, b) => (a.details.itemLevel ?? 0) - (b.details.itemLevel ?? 0)).slice(0, 4).map((r) => ({ slot: r.details.slot || r.slotLabel, name: r.details.name, itemLevel: r.details.itemLevel, rating: r.rating }));
}
function registerCharacterGuidanceHandlers({ handle, getState, saveState, getInsights = () => null, getGameData = () => null, now = Date.now }) {
  let current = null;
  const clear = () => { current = null; };
  const arity = (args, n) => { if (args.length !== n) throw Error(INVALID); };
  function active(id, allowEmpty = false) {
    const state = getState();
    if (allowEmpty && id === null && state.activeProfileId === null) return state;
    if (typeof id !== "string" || !id || id.length > 100 || id !== state.activeProfileId || !state.profiles.some(p => p.id === id)) throw Error(INVALID);
    return state;
  }
  function read(id) {
    const model = buildCharacterGuidance(active(id, true), id, { insights: getInsights(), now: now() });
    try { gearReview(model, getState().profiles.find((p) => p.id === id), getGameData()); } catch {}
    if (!current || current.fingerprint !== model.token || current.profileId !== id) current = { fingerprint: model.token, profileId: id, token: crypto.randomUUID() };
    const existing = model.identity ? matchingJourney(getState(), model, id) : null;
    return { ...structuredClone(model), token: current.token, checklistCreated: Boolean(existing || getState().journeys?.some(j => j.id === current.journeyId)) };
  }
  const titleFor = model => `${model.identity.name} — character review`.slice(0, 100);
  function matchingJourney(state, model, profileId) {
    const steps = checklistSteps(model);
    return state.journeys?.find(j => j.title === titleFor(model) && j.steps.length === steps.length &&
      j.steps.every((s, i) => s.text === steps[i] && s.profileId === profileId && !s.quest && !s.observed));
  }
  function selected(args) {
    arity(args, 1);
    const input = args[0];
    if (!input || Array.isArray(input) || Object.keys(input).sort().join() !== "profileId,token" || typeof input.token !== "string" || !/^[a-f0-9-]{36}$/.test(input.token)) throw Error(INVALID);
    const state = active(input.profileId);
    const model = buildCharacterGuidance(state, input.profileId, { insights: getInsights(), now: now() });
    if (!current || current.profileId !== input.profileId || current.token !== input.token || current.fingerprint !== model.token) throw Error(EXPIRED);
    return { state, model, choice: current };
  }
  handle("characterGuidance", (...args) => { arity(args, 1); return read(args[0]); });
  handle("searchGuidanceTrainers", (...args) => {
    arity(args, 2); const state = active(args[1], true), profile = state.profiles.find(p => p.id === args[1]);
    return searchHistoricalTrainers(getInsights(), args[0], profile?.level);
  });
  handle("characterGuidancePrompt", (...args) => guidancePrompt(selected(args).model));
  handle("createCharacterChecklist", (...args) => {
    const { state, model, choice } = selected(args);
    const existing = state.journeys?.find(j => j.id === choice.journeyId) || matchingJourney(state, model, choice.profileId);
    if (existing) { choice.journeyId = existing.id; return { state: structuredClone(state), journeyId: existing.id, reused: true }; }
    // Build the entire plan off-store. A validation/capacity/write failure cannot commit partial steps.
    let next = applyJourneyAction(state, { type: "create", title: titleFor(model), template: "blank", profileId: choice.profileId }, { now: now() });
    const journeyId = next.journeys.at(-1).id;
    for (const text of checklistSteps(model)) next = applyJourneyAction(next, { type: "add-note", journeyId, text, profileId: choice.profileId });
    saveState(next);
    choice.journeyId = journeyId;
    return { state: structuredClone(getState()), journeyId };
  });
  return { clear, sync() { if (current && current.profileId !== getState().activeProfileId) clear(); } };
}
module.exports = { gearReview, registerCharacterGuidanceHandlers };

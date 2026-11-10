"use strict";
const crypto = require("node:crypto");
const { buildCharacterGuidance, searchHistoricalTrainers, checklistSteps, guidancePrompt } = require("./character-guidance.cjs");
const { applyJourneyAction } = require("./journeys.cjs");
const INVALID = "Invalid character guidance request.", EXPIRED = "Refresh character guidance before using this choice.";
function registerCharacterGuidanceHandlers({ handle, getState, saveState, getInsights = () => null, now = Date.now }) {
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
module.exports = { registerCharacterGuidanceHandlers };

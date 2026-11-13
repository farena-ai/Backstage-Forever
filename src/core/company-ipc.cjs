"use strict";
const { validateState } = require("./validation.cjs");
const { mergeUserEdits } = require("./profile-sync.cjs");
const { applyJourneyAction } = require("./journeys.cjs");
const { buildCompany } = require("./company.cjs");
const { preserveMemories } = require("./memory-data.cjs");
const captured = [
  "source", "location", "quests", "progress", "history", "readiness", "gathering", "lootSources", "journal",
  "clientBuild", "locale", "captureVersion",
];

/** Renderer forms edit journals/manual identity, never captured evidence/plans. */
function mergeOrdinaryState(current, edited, base = current) {
  current = validateState(current);
  edited = validateState(preserveMemories(current, edited));
  base = validateState(preserveMemories(current, base));
  const owned = new Map(current.profiles.map((p) => [p.id, p]));
  for (const p of edited.profiles) {
    const existing = owned.get(p.id);
    if (
      !existing?.source &&
      captured.some((key) => p[key] !== undefined && existing?.[key] === undefined)
    )
      throw Error("Captured game data can only be added through a saved game snapshot or confirmed backup import.");
  }
  const next = mergeUserEdits(current, edited, base);
  next.journeys = structuredClone(current.journeys);
  return next;
}

function registerCompanyHandlers({ handle, getState, saveState }) {
  handle("companyBrief", (...args) => {
    if (args.length) throw Error("Invalid company request.");
    return buildCompany(getState());
  });
  handle("journeyAction", (...args) => {
    if (args.length !== 1) throw Error("Invalid journey request.");
    let next;
    try {
      next = applyJourneyAction(getState(), args[0]);
    } catch {
      throw Error("Invalid journey request.");
    }
    saveState(next);
    const state = structuredClone(getState());
    return { state, company: buildCompany(state) };
  });
}
module.exports = { registerCompanyHandlers, mergeOrdinaryState };

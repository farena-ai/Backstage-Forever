"use strict";
const { buildPreparation, createPreparationJourney } = require("./preparation.cjs");
const { loadVendorPack } = require("./vendor-facts.cjs");
function request(args) {
  if (args.length !== 2 || !args[1] || typeof args[1] !== "object" || Array.isArray(args[1])) throw Error("Invalid preparation request.");
}
function registerPreparationHandlers({ handle, getState, saveState }) {
  // The separate bundled catalog is optional; a damaged reference cannot erase saved inventory facts.
  let vendorPack = null;
  try { vendorPack = loadVendorPack(); } catch { /* Reference unavailable; planner remains usable. */ }
  handle("preparationBrief", (...args) => {
    request(args);
    return buildPreparation(getState(), args[0], args[1], { vendorPack });
  });
  handle("createPreparationJourney", (...args) => {
    request(args);
    const result = createPreparationJourney(getState(), args[0], args[1]);
    saveState(result.state);
    return { state: structuredClone(getState()), journeyId: result.journeyId };
  });
}
module.exports = { registerPreparationHandlers };

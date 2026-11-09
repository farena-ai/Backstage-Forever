"use strict";
const { buildPreparation, createPreparationJourney } = require("./preparation.cjs");
function request(args) {
  if (args.length !== 2 || !args[1] || typeof args[1] !== "object" || Array.isArray(args[1])) throw Error("Invalid preparation request.");
}
function registerPreparationHandlers({ handle, getState, saveState }) {
  handle("preparationBrief", (...args) => {
    request(args);
    return buildPreparation(getState(), args[0], args[1]);
  });
  handle("createPreparationJourney", (...args) => {
    request(args);
    const result = createPreparationJourney(getState(), args[0], args[1]);
    saveState(result.state);
    return { state: structuredClone(getState()), journeyId: result.journeyId };
  });
}
module.exports = { registerPreparationHandlers };

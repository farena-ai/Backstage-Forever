"use strict";
const { createDirectorSession } = require("./director.cjs");

function registerDirectorHandlers({ handle, getState, saveState, knowledge }) {
  handle("startDirectorSession", (...args) => {
    if (args.length !== 2) throw Error("Invalid Director request.");
    const current = getState();
    const profile = current.profiles.find((p) => p.id === args[0]);
    const result = createDirectorSession(current, args[0], args[1], {
      knowledge: profile && knowledge ? knowledge.index(profile) : undefined,
    });
    if (result.created) saveState(result.state);
    return { state: structuredClone(getState()), journeyId: result.journeyId, created: result.created };
  });
}
module.exports = { registerDirectorHandlers };

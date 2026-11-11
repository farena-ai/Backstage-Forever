"use strict";
const {
  buildAdventureCoach,
  validateCoachOptions,
} = require("./adventure-coach.cjs");
const { validateState, str } = require("./validation.cjs");
const { snapshotFreshness } = require("./guidance.cjs");
function registerAdventureCoachHandlers({ handle, getState, knowledge }) {
  handle("adventureCoach", (...args) => {
    if (args.length !== 2 || args[1] === undefined)
      throw Error("Invalid adventure coach request.");
    str(args[0], 100, false);
    const options = validateCoachOptions(args[1]),
      current = getState(),
      activeId = current.activeProfileId,
      state = validateState(current);
    const profile = state.profiles.find((p) => p.id === args[0]);
    if (
      activeId !== args[0] ||
      profile?.source?.kind !== "wow-addon" ||
      !profile.clientBuild
    )
      throw Error("Choose the current saved addon character for coaching.");
    return {
      ...buildAdventureCoach(profile, options, {
        knowledge: knowledge?.index(profile),
      }),
      source: { kind: "wow-addon", updatedAt: profile.source.updatedAt },
      freshness: snapshotFreshness(profile),
    };
  });
}
module.exports = { registerAdventureCoachHandlers };

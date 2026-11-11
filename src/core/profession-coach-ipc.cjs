"use strict";
const {
  buildProfessionCoach,
  validateProfessionOptions,
} = require("./profession-coach.cjs");
const { loadAcquisitionPack } = require("./acquisition-data.cjs");
const { loadVendorPack } = require("./vendor-facts.cjs");
const { validateState, str } = require("./validation.cjs");
function registerProfessionCoachHandlers({ handle, getState }) {
  let acquisitionPack = null,
    vendorPack = null;
  try {
    acquisitionPack = loadAcquisitionPack();
  } catch {
    /* Optional reference; observed planning remains usable. */
  }
  try {
    vendorPack = loadVendorPack();
  } catch {
    /* Optional reference; observed planning remains usable. */
  }
  handle("professionCoach", (...args) => {
    if (args.length !== 2 || args[1] === undefined)
      throw Error("Invalid profession coach request.");
    str(args[0], 100, false);
    const options = validateProfessionOptions(args[1]),
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
    return buildProfessionCoach(state, args[0], options, {
      acquisitionPack,
      vendorPack,
    });
  });
}
module.exports = { registerProfessionCoachHandlers };

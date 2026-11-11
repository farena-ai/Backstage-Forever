"use strict";
const {
  buildAdventureMap,
  validateAdventureMapOptions,
} = require("./adventure-map.cjs");
const { loadAcquisitionPack } = require("./acquisition-data.cjs");
const { loadVendorPack } = require("./vendor-facts.cjs");
const { str } = require("./validation.cjs");
function registerAdventureMapHandlers({
  handle,
  getState,
  knowledge,
  gatheringReceipt = () => false,
}) {
  let acquisitionPack = null,
    vendorPack = null;
  try {
    acquisitionPack = loadAcquisitionPack();
  } catch {}
  try {
    vendorPack = loadVendorPack();
  } catch {}
  handle("adventureMap", (...args) => {
    if (args.length !== 2 || args[1] === undefined)
      throw Error("Invalid adventure map request.");
    if (args[0] !== null) str(args[0], 100, false);
    const options = validateAdventureMapOptions(args[1]),
      state = getState();
    if (
      state.activeProfileId !== args[0] ||
      (args[0] !== null && !state.profiles.some((p) => p.id === args[0]))
    )
      throw Error("Choose the current journal character for the map.");
    const profile = state.profiles.find((p) => p.id === args[0]);
    let index = null;
    try {
      index = knowledge?.index(profile);
    } catch {}
    return buildAdventureMap(state, args[0], options, {
      acquisitionPack,
      vendorPack,
      knowledge: index,
      formatReceived: gatheringReceipt(profile) === true,
    });
  });
}
module.exports = { registerAdventureMapHandlers };

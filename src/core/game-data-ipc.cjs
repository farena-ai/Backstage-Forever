"use strict";
// IPC for game facts read from the player's own install (see game-data.cjs).
const { CLASSES } = require("./game-data.cjs");

const MAX_IDS = 64;
const MAX_ID = 2147483647;
const id = (value, what) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ID) throw Error(`Invalid ${what}.`);
  return value;
};
const count = (args, n) => { if (args.length !== n) throw Error("Invalid game data request."); };

function registerGameDataHandlers({ handle, gameData }) {
  handle("gameDataStatus", (...args) => {
    count(args, 0);
    return gameData.status();
  });
  handle("gameItems", (...args) => {
    count(args, 1);
    const [ids] = args;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS) throw Error("Invalid item list.");
    ids.forEach((x) => id(x, "item ID"));
    return gameData.items(ids);
  });
  handle("gameSpell", (...args) => {
    count(args, 1);
    return gameData.spell(id(args[0], "spell ID"));
  });
  handle("gameIcon", (...args) => {
    count(args, 1);
    const png = gameData.icon(id(args[0], "icon"));
    return png ? new Uint8Array(png) : null;
  });
  handle("gameTalents", (...args) => {
    count(args, 1);
    const [name] = args;
    if (typeof name !== "string" || name.length > 20 || !Object.values(CLASSES).some((c) => c.toLowerCase() === name.toLowerCase())) throw Error("Invalid class.");
    return gameData.talents(name);
  });
}

module.exports = { registerGameDataHandlers, MAX_IDS };

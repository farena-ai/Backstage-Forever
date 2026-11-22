"use strict";
// IPC for the Professions views: recipe book with the computed skill path (E2, E1), who can craft
// it (E3) and cooking from what you carry (E5). Read-only: saved characters, the bundled reference
// packs and the player's own game files. Nothing leaves this computer.
const R = require("./recipe-book.cjs");

const MAX_ID = 2147483647;
const isId = (x) => Number.isSafeInteger(x) && x > 0 && x <= MAX_ID;

function registerRecipeBook({ handle, getState, gameData, trainerPack = () => null, vendorPack = () => null, lootPack = () => null, bossLootPack = () => null, questPack = () => null, instanceNames = () => ({}) }) {
  const safe = (fn, fallback = null) => { try { return fn() ?? fallback; } catch { return fallback; } };
  const active = (profileId) => {
    if (typeof profileId !== "string" || !profileId || profileId.length > 100) throw Error("Invalid recipe book request.");
    const s = getState();
    const p = s.profiles.find((x) => x.id === s.activeProfileId && x.id === profileId);
    if (!p) throw Error("The active character changed.");
    return p;
  };
  // The game files' recipe table, with name and icon lookups. null when the install cannot be read.
  const game = () => {
    const recipes = safe(() => gameData.recipes());
    if (!recipes) return null;
    return { recipes, spells: (ids) => safe(() => gameData.spells(ids), ids.map(() => null)), items: (ids) => safe(() => gameData.items(ids), ids.map(() => null)) };
  };
  // Source packs are joined once per installed build.
  let indexed = null;
  const index = (profile) => {
    const build = safe(() => gameData.build()) || profile?.clientBuild || null;
    if (indexed?.build === build) return indexed.value;
    const value = R.sourceIndex({ trainerPack: safe(trainerPack), vendorPack: safe(vendorPack), lootPack: safe(lootPack), bossLootPack: safe(bossLootPack), questPack: safe(() => questPack(profile)), instanceNames: safe(instanceNames, {}), build });
    indexed = { build, value };
    return value;
  };
  const seenPrices = (profiles) => ({ prices: safe(() => require("./ledger.cjs").priceIndex(profiles), new Map()), vendorSeen: safe(() => require("./economy.cjs").vendorIndex(profiles), new Map()) });

  handle("recipeBook", (...args) => {
    if (args.length !== 2 || !(args[1] === null || isId(args[1]))) throw Error("Invalid recipe book request.");
    const p = active(args[0]), g = game();
    const book = R.recipeBook(p, g, g ? index(p) : null, { skillLineId: args[1], ...seenPrices(getState().profiles) });
    const out = { profileId: p.id, build: safe(() => gameData.build()), ...book };
    // Say why the game files gave no recipes (no folder, unreadable, or a table layout this app does not read).
    if (!g && typeof gameData.load === "function") { try { gameData.load("recipes"); } catch (e) { if (e?.code) out.reason = `${e.message} The recipe list is read from your own game files.`; } }
    if (book.status === "available") out.path = R.levelingPath(book.recipes, { rank: book.rank });
    return out;
  });
  handle("whoCanCraft", (...args) => {
    if (args.length !== 1 || typeof args[0] !== "string" || args[0].length > 100) throw Error("Invalid search.");
    const g = game(), profiles = getState().profiles;
    return R.whoCanCraft(profiles, g, g ? index(profiles.find((p) => p.id === getState().activeProfileId) || null) : null, args[0]);
  });
  handle("cookNow", (...args) => {
    if (args.length !== 1) throw Error("Invalid cooking request.");
    const p = active(args[0]), g = game();
    return { profileId: p.id, ...R.cookNow(p, g, index(p), { vendorSeen: seenPrices(getState().profiles).vendorSeen }) };
  });
}

module.exports = { registerRecipeBook };

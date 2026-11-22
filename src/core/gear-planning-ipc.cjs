"use strict";
// IPC for stat weights (C3), the gear plan per slot (C2), the reputation planner (C10),
// attunements and keys (G5) and collections (C11). Everything is read from saved characters, the
// bundled reference packs and the player's own game files; nothing leaves this computer.
const v = require("./validation.cjs");
const { weightsView, scoringWeights } = require("./stat-weights.cjs");
const { gearPlan, fitsSlot, PLAN_SLOTS } = require("./gear-plan.cjs");
const { repPlan } = require("./rep-planner.cjs");
const { attunementView } = require("./attunements.cjs");
const { collections } = require("./collections.cjs");
const { INSTANCE_NAMES } = require("./boss-loot.cjs");

const MAX_ID = 2147483647;
const isId = (x) => Number.isSafeInteger(x) && x > 0 && x <= MAX_ID;
const count = (args, n) => { if (args.length !== n) throw Error("Invalid request."); };

function registerGearPlanning({ handle, getState, gameData, statWeights, gearPins, wishlist, questPack = () => null, vendorPack = () => null, bossLootPack = () => null, lootPack = () => null, onChange = () => {} }) {
  // Only the active character: these pages always show the one picked at the top of the window.
  const active = (profileId) => {
    v.str(profileId, 100, false);
    const s = getState();
    const p = s.profiles.find((x) => x.id === s.activeProfileId && x.id === profileId);
    if (!p) throw Error("The active character changed.");
    return p;
  };
  const anyProfile = (profileId) => {
    v.str(profileId, 100, false);
    const p = getState().profiles.find((x) => x.id === profileId);
    if (!p) throw Error("Choose a character.");
    return p;
  };
  const safe = (fn, fallback = null) => { try { return fn() ?? fallback; } catch { return fallback; } };
  const items = (ids) => safe(() => gameData.items(ids), ids.map(() => null));
  const fact = (id) => (isId(id) ? items([id])[0] : null);
  const installedBuild = () => safe(() => gameData.build());
  const changed = () => { try { onChange(); } catch {} };
  const weights = (p) => safe(() => scoringWeights(p.className, statWeights.get(p.id)));

  handle("statWeights", (...args) => {
    count(args, 1);
    const p = active(args[0]);
    return { profileId: p.id, ...weightsView(p.className, statWeights.get(p.id)) };
  });
  // choice: { preset, custom: { stat: number } }, or null for "Reset to default".
  handle("setStatWeights", (...args) => {
    count(args, 2);
    const p = active(args[0]), choice = args[1];
    if (choice !== null) {
      v.object(choice, ["preset", "custom"]);
      if (typeof choice.preset !== "string" || choice.preset.length > 20) throw Error("Invalid stat weights.");
      if (choice.custom !== undefined) {
        if (!choice.custom || typeof choice.custom !== "object" || Array.isArray(choice.custom) || Object.keys(choice.custom).length > 40) throw Error("Invalid stat weights.");
        for (const [k, n] of Object.entries(choice.custom)) if (k.length > 40 || typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) throw Error("Invalid stat weights.");
      }
    }
    statWeights.set(p.id, p.className, choice);
    changed(); // the upgrade list handed to the game is scored with these weights
    return { profileId: p.id, ...weightsView(p.className, statWeights.get(p.id)) };
  });

  const vendorPrices = () => {
    // What vendors charged in merchant windows the player opened, newest sighting per item.
    const out = new Map();
    for (const p of getState().profiles) for (const e of p.ledger?.vendor || []) { const prev = out.get(e.id); if (!prev || e.at > prev.at) out.set(e.id, e); }
    return out;
  };
  const plan = (p) => gearPlan(p, { items, installedBuild: installedBuild(), questPack: safe(() => questPack(p)), vendorPack: safe(vendorPack), bossLootPack: safe(bossLootPack), lootPack: safe(lootPack),
    weights: weights(p), pins: gearPins.get(p.id), wished: wishlist.get(p.id), vendorPrices: safe(vendorPrices, new Map()) });
  handle("gearPlan", (...args) => {
    count(args, 1);
    return plan(active(args[0]));
  });
  // One pinned target per slot; itemId null clears it. Pins ride to the game with the wish list.
  handle("setGearPin", (...args) => {
    count(args, 3);
    const [profileId, slot, itemId] = args, p = active(profileId);
    if (!PLAN_SLOTS.includes(slot) || !(itemId === null || isId(itemId))) throw Error("Invalid gear target.");
    if (itemId !== null && !fitsSlot(fact(itemId), slot)) throw Error("That item does not go in this slot.");
    gearPins.set(p.id, slot, itemId);
    changed();
    return plan(p);
  });

  handle("repPlanner", (...args) => {
    count(args, 3);
    const [profileId, factionId, standing] = args, p = anyProfile(profileId);
    if (!(factionId === null || (Number.isSafeInteger(factionId) && factionId > 0 && factionId <= 100000))) throw Error("Invalid faction.");
    if (!(standing === null || (Number.isInteger(standing) && standing >= 2 && standing <= 8))) throw Error("Invalid standing.");
    return repPlan(p, safe(() => questPack(p)), { factionId, standing, itemFact: fact });
  });

  handle("attunements", (...args) => {
    count(args, 1);
    const s = getState(), id = args[0];
    if (id !== null) v.str(id, 100, false);
    const p = s.profiles.find((x) => x.id === (id ?? s.activeProfileId)) || null;
    if (id && !p) throw Error("Choose a character.");
    return attunementView(p, { pack: safe(() => questPack(p)), itemName: (itemId) => fact(itemId)?.name || null, bossLoot: safe(bossLootPack), instanceNames: INSTANCE_NAMES });
  });

  handle("collections", (...args) => {
    count(args, 1);
    return collections(anyProfile(args[0]), { itemFact: fact });
  });
}
module.exports = { registerGearPlanning };

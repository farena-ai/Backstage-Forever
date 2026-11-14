"use strict";
// IPC for the Instance Atlas loot browser, the loot wish list and item hover cards.
const v = require("./validation.cjs");
const { instanceLoot, itemCard, atlasLootSummary } = require("./boss-loot.cjs");
const { dropIndex } = require("./boss-loot-data.cjs");

const MAX_ID = 2147483647;
const itemId = (x) => { if (!Number.isSafeInteger(x) || x < 1 || x > MAX_ID) throw Error("Invalid item ID."); return x; };
const count = (args, min, max = min) => { if (args.length < min || args.length > max) throw Error("Invalid loot request."); };

function registerBossLootHandlers({ handle, getState, gameData, wishlist, getPack }) {
  let index = null, indexFor = null;
  const drops = () => { const p = getPack(); if (p !== indexFor) { indexFor = p; index = p ? dropIndex(p) : new Map(); } return index; };
  // The chosen character (or the active one when null): same rules as the reference handlers.
  const profile = (profileId) => {
    const s = getState();
    if (profileId !== null && profileId !== undefined) v.str(profileId, 100, false);
    const p = s.profiles.find((x) => x.id === (profileId ?? s.activeProfileId));
    if (!p && profileId) throw Error("Choose a character.");
    return p || null;
  };
  const wished = (p) => (p?.id ? wishlist.get(p.id) : []);
  handle("dungeonLoot", (...args) => {
    count(args, 2);
    const [profileId, instanceId] = args, p = profile(profileId);
    if (typeof instanceId !== "string" || !/^[a-z0-9-]{1,24}$/.test(instanceId)) throw Error("Invalid instance.");
    const pack = getPack();
    return instanceLoot(pack, instanceId, { profile: p, gameData, wished: wished(p) }) || { instanceId, bosses: [], unavailable: !pack };
  });
  handle("itemCard", (...args) => {
    count(args, 2);
    const [profileId, id] = args, p = profile(profileId);
    return itemCard(getPack(), itemId(id), { profile: p, gameData, wished: wished(p), index: drops() });
  });
  handle("setLootWish", (...args) => {
    count(args, 3);
    const [profileId, id, on] = args, p = profile(profileId);
    itemId(id);
    if (typeof on !== "boolean") throw Error("Invalid wish list change.");
    if (!p?.id) throw Error("Choose a character.");
    return { itemIds: wishlist.set(p.id, id, on) };
  });
  // Card chips for dungeonAtlas: upgrades and starred items per instance, for the active character.
  return { summary: (p) => { try { return atlasLootSummary(getPack(), { profile: p, gameData, wished: wished(p) }); } catch { return {}; } } };
}
module.exports = { registerBossLootHandlers };

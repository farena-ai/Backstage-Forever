"use strict";
// Vendor wares (1.27): the optional "wares" block a character's capture may carry. The addon notes,
// for vendor windows the player opened, the NPC id, the name the game shows for it, the item ids on
// sale and the map spot where the player stood. No prices, no character data. This module checks the
// block. Community sharing (community.cjs) sends the id and item ids, the spot rounded to 0.5% of the
// map, and the name on English game clients, while sharing is on.
const MAX_VENDORS = 60, MAX_ITEMS = 200, MAX_NAME = 60, MAX_ID = 2147483647;
const bad = () => { throw Error("Invalid wares capture."); };
const whole = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const unit = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** The block as the addon wrote it -> { version: 1, vendors: [{ npcId, name?, itemIds, seenAt, mapId?, x?, y? }] } sorted by npc id, or a throw. */
function normalizeWaresCapture(block) {
  if (!block || typeof block !== "object" || Array.isArray(block) || block.version !== 1) bad();
  for (const k of Object.keys(block)) if (!["version", "vendors"].includes(k)) bad();
  // Lua writes an empty list as {} when nothing marked it as an array.
  const list = Array.isArray(block.vendors) ? block.vendors : block.vendors && typeof block.vendors === "object" && !Object.keys(block.vendors).length ? [] : bad();
  if (list.length > MAX_VENDORS) bad();
  const seen = new Set(), vendors = [];
  for (const v of list) {
    if (!v || typeof v !== "object" || Array.isArray(v)) bad();
    const stored = Object.hasOwn(v, "npcId"); // the saved profile shape is checked with the same rules
    for (const k of Object.keys(v)) if (!(stored ? ["npcId", "name", "itemIds", "seenAt", "mapId", "x", "y"] : ["n", "name", "items", "at", "m", "x", "y"]).includes(k)) bad();
    const npcId = stored ? v.npcId : v.n, items = stored ? v.itemIds : v.items, seenAt = stored ? v.seenAt : v.at;
    if (!whole(npcId, 1, MAX_ID) || seen.has(npcId) || !whole(seenAt, 1, 253402300799) || !Array.isArray(items) || !items.length || items.length > MAX_ITEMS) bad();
    seen.add(npcId);
    if (v.name !== undefined && (typeof v.name !== "string" || !v.name.length || v.name.length > MAX_NAME || /[\x00-\x1f\x7f|]/.test(v.name))) bad();
    const ids = new Set();
    for (const id of items) { if (!whole(id, 1, MAX_ID) || ids.has(id)) bad(); ids.add(id); }
    const mapId = stored ? v.mapId : v.m;
    if ((mapId === undefined) !== (v.x === undefined) || (mapId === undefined) !== (v.y === undefined)) bad();
    if (mapId !== undefined && (!whole(mapId, 1, 1000000) || !unit(v.x) || !unit(v.y))) bad();
    vendors.push({ npcId, ...(v.name !== undefined ? { name: v.name } : {}), itemIds: [...ids].sort((a, b) => a - b), seenAt, ...(mapId !== undefined ? { mapId, x: v.x, y: v.y } : {}) });
  }
  vendors.sort((a, b) => a.npcId - b.npcId);
  return { version: 1, vendors };
}

module.exports = { normalizeWaresCapture, MAX_VENDORS, MAX_ITEMS };

"use strict";
// Loot wish list: item ids each character has starred in the Instance Atlas. Kept in its own small
// file in the app data folder (wishlist.json), never sent anywhere.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const MAX_PROFILES = 100, MAX_ITEMS = 200;
const itemId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const profileKey = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;
function normalize(raw) {
  const out = {};
  const profiles = raw && raw.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
  for (const [k, list] of Object.entries(profiles).slice(0, MAX_PROFILES)) if (profileKey(k) && Array.isArray(list)) {
    const ids = [...new Set(list.filter(itemId))].slice(0, MAX_ITEMS);
    if (ids.length) out[k] = ids;
  }
  return out;
}
class WishList {
  constructor(dir) {
    this.file = path.join(dir, "wishlist.json");
    try { this.profiles = normalize(JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch { this.profiles = {}; }
  }
  get(profileId) { return profileKey(profileId) ? [...(this.profiles[profileId] || [])] : []; }
  has(profileId, id) { return this.get(profileId).includes(id); }
  set(profileId, id, on) {
    if (!profileKey(profileId) || !itemId(id) || typeof on !== "boolean") throw Error("Invalid wish list change.");
    const list = (this.profiles[profileId] || []).filter((x) => x !== id);
    if (on) {
      if (list.length >= MAX_ITEMS) throw Error(`The wish list holds up to ${MAX_ITEMS} items.`);
      list.unshift(id);
      if (!this.profiles[profileId] && Object.keys(this.profiles).length >= MAX_PROFILES) throw Error("Too many wish lists.");
    }
    if (list.length) this.profiles[profileId] = list; else delete this.profiles[profileId];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomic(this.file, JSON.stringify({ schemaVersion: 1, profiles: this.profiles }) + "\n");
    return this.get(profileId);
  }
  clear() { this.profiles = {}; try { fs.rmSync(this.file, { force: true }); } catch {} }
}
module.exports = { WishList, MAX_ITEMS };

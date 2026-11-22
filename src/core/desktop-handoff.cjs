"use strict";
// Desktop -> game hand-off (1.20, roadmap F3). The addon cannot hear the desktop while the game
// runs, so the desktop writes one small data-only Lua file into the addon's own folder through the
// installer's safe write path. The game reads it at the next login or /reload. Nothing is sent to
// the game, no input is simulated and SavedVariables are never touched.
//
// Content: each character's wish list (item ids starred in the Instance Atlas) and, since 1.21,
// the dungeon drops the desktop rates as an upgrade over what the character wears, so the
// in-game atlas can mark both. Characters are keyed "Name-Realm", the only identity the game and
// the desktop both know without a save round trip. The file stays on this computer.
const FILE = "BackstageForeverDesktop.lua";
const MAX_CHARACTERS = 100, MAX_ITEMS = 200, MAX_BYTES = 256 * 1024;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
const named = (v) => typeof v === "string" && v.length > 0 && v.length <= 60 && !/[\x00-\x1f]/.test(v);
const itemId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const HEADER = [
  "-- Written by the Backstage Forever desktop app when it prepares the addon. Data only.",
  "-- It carries your wish list and gear upgrades into the game; the game reads it at login or /reload.",
  "-- Safe to delete: the desktop app writes it again.",
];

// The same bytes for the same input: characters sorted by key, wishes in wish-list order,
// upgrades by item id.
function compile({ profiles = [], wishlist = () => [], upgrades = () => [] } = {}) {
  const rows = [];
  const seen = new Set();
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (p?.source?.kind !== "wow-addon" || !named(p.name) || !named(p.realm)) continue;
    const key = `${p.name}-${p.realm}`;
    if (seen.has(key)) continue;
    const list = (supplier) => { let ids = []; try { ids = supplier(p.id); } catch {} return [...new Set((Array.isArray(ids) ? ids : []).filter(itemId))]; };
    const ids = list(wishlist).slice(0, MAX_ITEMS), up = list(upgrades).sort((a, b) => a - b).slice(0, MAX_ITEMS);
    if (!ids.length && !up.length) continue;
    seen.add(key);
    rows.push([key, ids, up]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const body = rows.slice(0, MAX_CHARACTERS).map(([key, ids, up]) => `[${luaString(key)}]={wish={${ids.join(",")}}${up.length ? `,up={${up.join(",")}}` : ""}},`);
  const text = [...HEADER, "BackstageForeverDesktopData={schema=1,characters={", ...body, "}}", ""].join("\n");
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error("Desktop hand-off is too large.");
  return text;
}

module.exports = { FILE, MAX_ITEMS, MAX_CHARACTERS, compile, EMPTY: compile() };

"use strict";
// Desktop -> game hand-off (1.20, roadmap F3). The addon cannot hear the desktop while the game
// runs, so the desktop writes one small data-only Lua file into the addon's own folder through the
// installer's safe write path. The game reads it at the next login or /reload. Nothing is sent to
// the game, no input is simulated and SavedVariables are never touched.
//
// Content: each character's wish list (item ids starred in the Instance Atlas), since 1.21 the
// dungeon drops the desktop rates as an upgrade over what the character wears, and (roadmap C1)
// the talent build the player marked "Use in game": its talents by name and the order to take
// them, so /bf talents can name the next point. Characters are keyed "Name-Realm", the only
// identity the game and the desktop both know without a save round trip. The file stays on this
// computer.
//
// Roadmap E4 adds the gathering loop the player sent from the World Map: loop={m=map id,
// k="h" herbs or "o" ore, s={x1,y1,x2,y2,...}} with each stop in ten-thousandths of the map, in
// walking order. /bf loop walks it. Like the talent plan it is left out before the file grows past
// its limit.
const FILE = "BackstageForeverDesktop.lua";
const MAX_CHARACTERS = 100, MAX_ITEMS = 200, MAX_BYTES = 256 * 1024, MAX_PICKS = 51, MAX_LOOP_STOPS = 40;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
const named = (v) => typeof v === "string" && v.length > 0 && v.length <= 60 && !/[\x00-\x1f]/.test(v);
const itemId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const HEADER = [
  "-- Written by the Backstage Forever desktop app when it prepares the addon. Data only.",
  "-- It carries your wish list and gear upgrades into the game; the game reads it at login or /reload.",
  "-- Safe to delete: the desktop app writes it again.",
];

// A talent plan as Lua: t lists each talent once as {name, tree, highest rank}; o is the order of
// points, each a position in t. Returns "" for anything that is not a clean plan.
function talentPlan(plan) {
  if (!plan || !named(plan.name) || !Array.isArray(plan.picks) || !plan.picks.length || plan.picks.length > MAX_PICKS) return "";
  const table = [], at = new Map(), order = [], taken = new Map();
  for (const p of plan.picks) {
    if (!p || !named(p.name) || !named(p.tab) || !Number.isInteger(p.maxRank) || p.maxRank < 1 || p.maxRank > 9) return "";
    const key = `${p.tab}\n${p.name}`;
    if (!at.has(key)) { table.push(`{${luaString(p.name)},${luaString(p.tab)},${p.maxRank}}`); at.set(key, table.length); }
    taken.set(key, (taken.get(key) || 0) + 1);
    if (taken.get(key) > p.maxRank) return "";
    order.push(at.get(key));
  }
  return `tal={n=${luaString(plan.name)},t={${table.join(",")}},o={${order.join(",")}}}`;
}

// A gathering loop as Lua, or "" for anything that is not a clean loop of 3 to 40 stops.
function gatheringLoop(loop) {
  const kind = { herbalism: "h", mining: "o" }[loop?.profession];
  if (!loop || !kind || !itemId(loop.mapId) || !Array.isArray(loop.stops) || loop.stops.length < 3 || loop.stops.length > MAX_LOOP_STOPS) return "";
  const flat = [];
  for (const s of loop.stops) {
    if (!Array.isArray(s) || s.length !== 2 || !s.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return "";
    flat.push(Math.round(s[0] * 10000), Math.round(s[1] * 10000));
  }
  return `loop={m=${loop.mapId},k="${kind}",s={${flat.join(",")}}}`;
}

// The same bytes for the same input: characters sorted by key, wishes in wish-list order,
// upgrades by item id, talent picks in the order the player planned them. Talent plans are the
// newest passenger: when the file would grow past its limit they are left out, character by
// character, before anything else is touched.
function compile({ profiles = [], wishlist = () => [], upgrades = () => [], talents = () => null, loops = () => null } = {}) {
  const rows = [];
  const seen = new Set();
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (p?.source?.kind !== "wow-addon" || !named(p.name) || !named(p.realm)) continue;
    const key = `${p.name}-${p.realm}`;
    if (seen.has(key)) continue;
    const list = (supplier) => { let ids = []; try { ids = supplier(p.id); } catch {} return [...new Set((Array.isArray(ids) ? ids : []).filter(itemId))]; };
    const ids = list(wishlist).slice(0, MAX_ITEMS), up = list(upgrades).sort((a, b) => a - b).slice(0, MAX_ITEMS);
    let tal = ""; try { tal = talentPlan(talents(p.id)); } catch {}
    let loop = ""; try { loop = gatheringLoop(loops(p.id)); } catch {}
    if (!ids.length && !up.length && !tal && !loop) continue;
    seen.add(key);
    rows.push([key, ids, up, tal, loop]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const kept = rows.slice(0, MAX_CHARACTERS);
  const line = ([key, ids, up, tal, loop]) => `[${luaString(key)}]={wish={${ids.join(",")}}${up.length ? `,up={${up.join(",")}}` : ""}${tal ? `,${tal}` : ""}${loop ? `,${loop}` : ""}},`;
  const wrap = (body) => [...HEADER, "BackstageForeverDesktopData={schema=1,characters={", ...body, "}}", ""].join("\n");
  let room = MAX_BYTES - Buffer.byteLength(wrap(kept.map(([key, ids, up]) => line([key, ids, up, "", ""]))));
  const body = [];
  for (const row of kept) {
    for (const i of [3, 4]) {
      const cost = row[i] ? Buffer.byteLength(row[i]) + 1 : 0;
      if (cost && cost <= room) room -= cost; else row[i] = "";
    }
    if (row[1].length || row[2].length || row[3] || row[4]) body.push(line(row));
  }
  const text = wrap(body);
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error("Desktop hand-off is too large.");
  return text;
}

module.exports = { FILE, MAX_ITEMS, MAX_CHARACTERS, MAX_PICKS, MAX_LOOP_STOPS, MAX_BYTES, compile, EMPTY: compile() };

"use strict";
// Offline build tool: compiles the bundled, source-labelled references into the
// addon's in-game finder table (BackstageForeverFind.lua). --check verifies only.
// Row: { name, note, map id, x*1000, y*1000, kind [, wares] }. Kinds: f flight master, t trainer,
// v vendor, q quest giver, n other NPC, x world object, h herb, o ore, r rare enemy, c chest,
// m mailbox, d dungeon or raid entrance, b boss (at its dungeon's entrance). A vendor's wares are
// positions in BackstageForeverFindItems, so each item name is stored once.
// BackstageForeverFindQuests lists the quests players met in Forever: { title, level, row of the
// giver in BackstageForeverFindData }, so any of those titles finds its giver, not only the first
// quest a giver hands out. Quests, dungeons and bosses come from the desktop's search index
// (src/core/world-search.cjs), so the game and the desktop find the same things.
// Not in the game file, to stay under the size cap: quests nobody has met in play yet, and items
// beyond vendor wares (drops, rewards, recipes). Those are searched on the desktop only.
const fs = require("node:fs");
const path = require("node:path");
const { buildStaticIndex } = require("../src/core/world-map.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");
const { loadWorldPack, rareLabel } = require("../src/core/world-finds.cjs");
const { loadTransportPack } = require("../src/core/transport-data.cjs");
const { buildIndex } = require("../src/core/world-search.cjs");
const { sourcesFromDisk } = require("../src/core/world-search-sources.cjs");
const root = path.join(__dirname, "..");
const target = path.join(root, "addon", "BackstageForever", "BackstageForeverFind.lua");
const CODES = { flight: "f", "class-trainer": "t", "profession-trainer": "t", vendor: "v", npc: "n", herb: "h", ore: "o", rare: "r", chest: "c", mailbox: "m" };
const MAX_BYTES = 320 * 1024, MAX_WARES = 40;

const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';

function rowsOf() {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const knowledge = read("data/forever/pack.json"), vendorPack = loadVendorPack(), worldPack = loadWorldPack(), transport = loadTransportPack();
  const index = buildStaticIndex({
    knowledgePack: knowledge, npcReference: read("data/forever-npc-locations/pack.json"),
    travelReference: loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json"))),
    vendorPack, insights: loadBundledInsights(), acquisitionPack: loadAcquisitionPack(), worldPack,
  });
  // The first quest (lowest level) each NPC or object gives, and how many more.
  const gives = new Map();
  for (const q of Object.values(knowledge.quests)) {
    if (!q.title || /^\[|\(123\)|^<|\bUNUSED\b|\bTEST\b/i.test(q.title)) continue;
    for (const g of q.givers || []) { const key = `${g.kind}:${g.id}`; if (!gives.has(key)) gives.set(key, []); gives.get(key).push(q); }
  }
  const questNote = (key) => {
    const list = [...new Map((gives.get(key) || []).map((q) => [q.title, q])).values()].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.title.localeCompare(b.title));
    return list.length ? `Quest: ${list[0].title}${list.length > 1 ? ` +${list.length - 1} more` : ""}` : null;
  };
  // Vendor wares: each item name once, vendors point at them.
  const items = [], itemAt = new Map(), wares = new Map();
  for (const v of vendorPack?.vendors || []) {
    const list = [];
    for (const l of v.listings || []) {
      if (!l.name || list.length >= MAX_WARES) continue;
      if (!itemAt.has(l.name)) { items.push(l.name); itemAt.set(l.name, items.length); }
      if (!list.includes(itemAt.get(l.name))) list.push(itemAt.get(l.name));
    }
    if (list.length) wares.set(v.id, list.sort((a, b) => a - b));
  }
  const rows = [], seen = new Set();
  const add = (label, note, mapId, x, y, code, extra) => {
    const X = Math.round(x * 1000), Y = Math.round(y * 1000);
    // One row per name, kind and place: NPCs once per map, nodes once per rounded spot.
    const key = "hocm".includes(code) ? `${code}:${label}:${mapId}:${Math.round(x * 200)}:${Math.round(y * 200)}` : `${label}:${mapId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([label, note || "", mapId, X, Y, code, extra || null]);
  };
  const flightNpcs = new Set((transport?.nodes || []).filter((n) => n.npcId).map((n) => n.npcId));
  const byKindFirst = (a, b) => (a.kind === "npc") - (b.kind === "npc");
  for (const [mapId, pins] of [...index.entries()].sort((a, b) => a[0] - b[0])) {
    for (const p of [...pins].sort(byKindFirst)) {
      let code = CODES[p.kind]; if (!code) continue;
      let note = p.sub || "";
      if (code === "h" || code === "o") note = p.skill ? `skill ${p.skill}` : "";
      else if (code === "c" || code === "m") note = "";
      else if (code === "r") note = p.sub.replace(/ · /g, ", ");
      else if (code === "n" && flightNpcs.has(p.npcId)) { code = "f"; note = "Flight Master"; }
      else if (code === "n" && p.npcId && gives.has(`npc:${p.npcId}`)) { const q = questNote(`npc:${p.npcId}`); if (q) { code = "q"; note = q; } }
      add(p.label, note, mapId, p.x, p.y, code, code === "v" ? wares.get(p.npcId) : null);
    }
  }
  // Flight masters the NPC packs do not place: the transport pack knows where they stand.
  for (const n of transport?.nodes || []) if (n.master && Number.isSafeInteger(n.mapId) && n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1) add(n.master, "Flight Master", n.mapId, n.x, n.y, "f");
  // World objects from the quest reference: quest givers first (wanted posters, crates), then the rest.
  for (const o of Object.values(knowledge.npcs || {})) {
    if (o.kind !== "object" || !o.name || o.name === "Mailbox" || !o.positions?.length) continue;
    const p = o.positions[0], q = questNote(`object:${o.id}`);
    if (Number.isSafeInteger(p.mapId) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) add(o.name, q || "Object", p.mapId, p.x, p.y, q ? "q" : "x");
  }
  // Dungeons, raids and their bosses from the shared search index, placed at the entrance.
  const shared = buildIndex({ ...sourcesFromDisk(), game: { reason: "" } });
  const atlas = new Map((sourcesFromDisk().atlas?.entries || []).map((e) => [e.id, e]));
  for (const e of shared.entries) {
    if (e.k !== "dungeon" && e.k !== "boss") continue;
    const d = atlas.get(e.k === "dungeon" ? e.id : e.t.dungeon), at = d?.entrance;
    if (!d || !at || !Number.isSafeInteger(d.mapId) || !(at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1)) continue;
    if (e.k === "dungeon") add(d.name, `${d.kind === "raid" ? "Raid" : "Dungeon"}${d.levels ? `, levels ${d.levels.min}-${d.levels.max}` : ""}`, d.mapId, at.x, at.y, "d");
    else add(e.name, `Boss in ${d.name}`, d.mapId, at.x, at.y, "b");
  }
  rows.sort((a, b) => a[2] - b[2] || a[0].localeCompare(b[0]) || a[3] - b[3] || a[4] - b[4] || a[5].localeCompare(b[5]));
  // Quests met in play, each pointing at its giver's row. A title the giver's own note already
  // carries in full is left out (the row is found by it anyway).
  const rowAt = new Map();
  rows.forEach((r, i) => { const k = `${r[0]}:${r[2]}`; if (!rowAt.has(k)) rowAt.set(k, i + 1); });
  const quests = [];
  for (const e of shared.entries) {
    if (e.k !== "quest" || !e.seen) continue;
    const q = knowledge.quests[e.id], g = (q?.givers || [])[0], giver = g ? knowledge.npcs?.[`${g.kind}:${g.id}`] : null;
    const p = (giver?.positions || []).find((x) => Number.isSafeInteger(x.mapId));
    const at = giver?.name && p ? rowAt.get(`${giver.name}:${p.mapId}`) : null;
    if (!at || rows[at - 1][1] === `Quest: ${e.name}`) continue;
    quests.push([e.name, q.level > 0 ? q.level : 0, at]);
  }
  quests.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2]);
  return { rows, items, quests };
}
function compile() {
  const { rows, items, quests } = rowsOf();
  const body = rows.map((r) => `{${luaString(r[0])},${luaString(r[1])},${r[2]},${r[3]},${r[4]},"${r[5]}"${r[6] ? `,{${r[6].join(",")}}` : ""}}`).join(",\n");
  const { MAP_NAMES } = require("../src/core/companion-tools.cjs");
  const maps = Object.entries(MAP_NAMES).map(([id, n]) => `[${id}]=${luaString(n)}`).join(",");
  const text = `-- Generated offline by scripts/build-find-index.cjs; data only.
-- Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0. Positions are approximate.
-- Blizzard underlying game content and assets are excluded from the compilation license.
BackstageForeverFindData = {
${body}
}
BackstageForeverFindItems = {${items.map(luaString).join(",")}}
BackstageForeverFindQuests = {
${quests.map((q) => `{${luaString(q[0])},${q[1]},${q[2]}}`).join(",\n")}
}
BackstageForeverFindMaps = {${maps}}
` + fs.readFileSync(path.join(__dirname, "find-runtime.lua"), "utf8");
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error(`BackstageForeverFind.lua would be ${Buffer.byteLength(text)} bytes; the cap is ${MAX_BYTES}.`);
  return text;
}
/** Rows per kind and the number of maps, for tests and the release notes. */
function coverage() {
  const { rows, items, quests } = rowsOf(), kinds = {};
  for (const r of rows) kinds[r[5]] = (kinds[r[5]] || 0) + 1;
  return { rows: rows.length, maps: new Set(rows.map((r) => r[2])).size, kinds, items: items.length, quests: quests.length };
}
if (require.main === module) {
  const out = compile().replace(/\r\n/g, "\n");
  if (process.argv.includes("--check")) {
    const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
    if (now !== out) { console.error("BackstageForeverFind.lua is stale; run npm run build:find-index."); process.exit(1); }
    console.log("Offline finder index reproduction passed.");
  } else {
    fs.writeFileSync(target, out);
    console.log(`Wrote ${path.relative(root, target)} (${Buffer.byteLength(out)} bytes): ${JSON.stringify(coverage())}`);
  }
}
module.exports = { compile, coverage, MAX_BYTES };

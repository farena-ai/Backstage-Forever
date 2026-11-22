"use strict";
// Writes addon/BackstageForever/BackstageForeverSources.lua (1.19): where quest items drop and who
// sells an item, for the in-game item tooltip. Compiled offline from the bundled loot and seller
// packs (Efficient Games, CC BY 4.0). Data only; --check verifies the committed file.
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const file = path.join(root, "addon", "BackstageForever", "BackstageForeverSources.lua");
const MAX_SOURCES = 3;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
// One row per source, joined with "|": drops are "n~Name~percent" (creature) or "o~Name~percent"
// (object); sellers are "Name~mapId~side" (A, H, or B when both factions were seen trading there). "~" and "|" never appear in the names we keep.
const clean = (name) => (typeof name === "string" && name && !/[~|\x00-\x1f]/.test(name) && name.length <= 60 ? name : null);

function compile() {
  const loot = JSON.parse(fs.readFileSync(path.join(root, "data", "forever-loot", "pack.json"), "utf8"));
  const sellers = JSON.parse(fs.readFileSync(path.join(root, "data", "forever-vendors", "pack.json"), "utf8"));
  const drops = {};
  for (const [id, sources] of Object.entries(loot.items)) {
    const rows = sources.filter((s) => clean(s.name) && s.chance > 0)
      .sort((a, b) => b.chance - a.chance || b.drops - a.drops || a.id - b.id).slice(0, MAX_SOURCES)
      .map((s) => `${s.kind === "object" ? "o" : "n"}~${s.name}~${Math.max(1, Math.round(s.chance * 100))}`);
    if (rows.length) drops[id] = rows.join("|");
  }
  const sold = {};
  for (const vendor of sellers.vendors) {
    const name = clean(vendor.name), mapId = vendor.positions?.[0]?.mapId;
    if (!name || !Number.isSafeInteger(mapId)) continue;
    const friendly = (faction) => { const r = vendor.observedReactionsByFaction?.[faction]; return Array.isArray(r) && r.length > 0 && r.every((n) => n >= 4); };
    const side = friendly("Alliance") && friendly("Horde") ? "B" : friendly("Alliance") ? "A" : friendly("Horde") ? "H" : null;
    if (!side) continue;
    for (const listing of vendor.listings) {
      if (!Number.isSafeInteger(listing.itemId)) continue;
      (sold[listing.itemId] ||= []).push({ name, mapId, side, sources: vendor.sources || 0, id: vendor.id });
    }
  }
  const soldRows = {};
  for (const [id, list] of Object.entries(sold)) {
    // Up to three sellers for each side, one per map first, so a tooltip names different places.
    const picked = [];
    for (const want of ["A", "H"]) {
      const maps = new Set(); let count = 0;
      for (const v of list.sort((a, b) => b.sources - a.sources || a.id - b.id)) {
        if ((v.side !== want && v.side !== "B") || maps.has(v.mapId) || count >= MAX_SOURCES) continue;
        maps.add(v.mapId); count++;
        if (!picked.includes(v)) picked.push(v);
      }
    }
    if (picked.length) soldRows[id] = picked.map((v) => `${v.name}~${v.mapId}~${v.side}`).join("|");
  }
  const table = (rows) => Object.keys(rows).map(Number).sort((a, b) => a - b).map((id) => `[${id}]=${luaString(rows[id])},`).join("\n");
  return `-- Generated offline by scripts/build-addon-sources.cjs; data only.
-- Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0: quest item drops and
-- seller listings observed by players. Historical observations, not guaranteed drops, stock or prices.
-- Blizzard game content is excluded from that license.
BackstageForeverSourceData={
drops={
${table(drops)}
},
sold={
${table(soldRows)}
},
}
`;
}

if (require.main === module) {
  const text = compile();
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== text) throw Error("Addon source data differs from the bundled packs; run npm run build:addon-sources.");
    console.log("Addon source data reproduction passed.");
  } else {
    fs.writeFileSync(file, text);
    console.log(`Wrote ${path.relative(root, file)} (${Buffer.byteLength(text)} bytes).`);
  }
}
module.exports = { compile };

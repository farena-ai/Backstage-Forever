"use strict";
// Offline build tool: compiles the bundled, source-labelled references into the
// addon's in-game finder table (BackstageForeverFind.lua). --check verifies only.
const fs = require("node:fs");
const path = require("node:path");
const { buildStaticIndex } = require("../src/core/world-map.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { loadAcquisitionPack } = require("../src/core/acquisition-data.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");
const root = path.join(__dirname, "..");
const target = path.join(root, "addon", "BackstageForever", "BackstageForeverFind.lua");
const CODES = { flight: "f", "class-trainer": "t", "profession-trainer": "t", vendor: "v", npc: "n", herb: "h", ore: "o" };

const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';

function compile() {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
  const index = buildStaticIndex({
    knowledgePack: read("data/forever/pack.json"), npcReference: read("data/forever-npc-locations/pack.json"),
    travelReference: loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json"))),
    vendorPack: loadVendorPack(), insights: loadBundledInsights(), acquisitionPack: loadAcquisitionPack(),
  });
  const rows = [];
  for (const [mapId, pins] of [...index.entries()].sort((a, b) => a[0] - b[0]))
    for (const p of pins) if (CODES[p.kind]) rows.push([p.label, p.sub || "", mapId, Math.round(p.x * 1000), Math.round(p.y * 1000), CODES[p.kind]]);
  rows.sort((a, b) => a[2] - b[2] || a[0].localeCompare(b[0]) || a[3] - b[3]);
  const body = rows.map((r) => `{${luaString(r[0])},${luaString(r[1])},${r[2]},${r[3]},${r[4]},"${r[5]}"}`).join(",\n");
  const { MAP_NAMES } = require("../src/core/companion-tools.cjs");
  const maps = Object.entries(MAP_NAMES).map(([id, n]) => `[${id}]=${luaString(n)}`).join(",");
  return `-- Generated offline by scripts/build-find-index.cjs; data only.
-- Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0. Positions are approximate.
-- Blizzard underlying game content and assets are excluded from the compilation license.
BackstageForeverFindData = {
${body}
}
BackstageForeverFindMaps = {${maps}}
` + fs.readFileSync(path.join(__dirname, "find-runtime.lua"), "utf8");
}
const out = compile().replace(/\r\n/g, "\n");
if (process.argv.includes("--check")) {
  const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== out) { console.error("BackstageForeverFind.lua is stale; run npm run build:find-index."); process.exit(1); }
  console.log("Offline finder index reproduction passed.");
} else {
  fs.writeFileSync(target, out);
  console.log(`Wrote ${path.relative(root, target)} (${Buffer.byteLength(out)} bytes).`);
}

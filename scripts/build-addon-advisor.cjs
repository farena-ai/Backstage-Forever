"use strict";
// Offline build tool: compiles the in-game advisor layer data (quest givers with level and
// faction, trainers and flight masters with faction, zone level bands) into a Lua table.
// Usage: node scripts/build-addon-advisor.cjs [--check]
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const out = path.join(root, "addon", "BackstageForever", "BackstageForeverAdvisorData.lua");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const { buildStaticIndex } = require("../src/core/world-map.cjs");
const { loadLevelingPack } = require("../src/core/leveling.cjs");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const { loadVendorPack } = require("../src/core/vendor-facts.cjs");
const { loadBundledInsights } = require("../src/core/insights-data.cjs");

function luaString(value) {
  return '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
}
function lit(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return luaString(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return "{" + v.map(lit).join(",") + "}";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined && v[k] !== null).map((k) => (/^[A-Za-z_]\w*$/.test(k) ? k : `[${/^\d+$/.test(k) ? k : luaString(k)}]`) + "=" + lit(v[k])).join(",") + "}";
}
const side = (sides) => (!sides || !sides.length ? undefined : sides.length > 1 ? "B" : sides[0] === "Horde" ? "H" : sides[0] === "Alliance" ? "A" : undefined);
const short = (s, n = 60) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function compile() {
  const pack = read("data/forever/pack.json");
  const travel = loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json"), "utf8"));
  const vendorPack = loadVendorPack();
  const insights = loadBundledInsights();
  const npcReference = read("data/forever-npc-locations/pack.json");
  const index = buildStaticIndex({ knowledgePack: pack, npcReference, travelReference: travel, vendorPack, insights });
  const KIND = { flight: "f", "class-trainer": "c", "profession-trainer": "p" };
  const npcs = {};
  for (const [mapId, pins] of index) {
    const rows = [];
    const seen = new Set();
    for (const p of pins) {
      const k = KIND[p.kind]; if (!k) continue;
      const key = `${p.npcId}:${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`; if (seen.has(key)) continue; seen.add(key);
      rows.push({ k, n: short(p.label, 40), r: short(p.sub, 40), s: side(p.sides), x: p.x, y: p.y });
    }
    if (rows.length) npcs[mapId] = rows.sort((a, b) => a.k.localeCompare(b.k) || a.n.localeCompare(b.n));
  }
  const givers = {};
  for (const q of Object.values(pack.quests).sort((a, b) => a.id - b.id)) {
    if (!q.level || !q.givers?.length) continue;
    const g = q.givers.find((r) => r.kind === "npc"); if (!g) continue;
    const n = pack.npcs[`npc:${g.id}`]; const p = n?.positions?.[0]; if (!p) continue;
    (givers[p.mapId] ||= []).push({ q: q.id, t: short(q.title), l: q.level, m: q.minLevel || undefined, s: side(q.sides), n: short(n.name, 40), x: p.x, y: p.y });
  }
  const zones = loadLevelingPack().zones.map((z) => ({ m: z.mapId, lo: z.min, hi: z.max, f: z.faction[0], h: z.towns?.Horde?.[0], a: z.towns?.Alliance?.[0] }));
  const data = { build: pack.build, attribution: "Quest and NPC data from Efficient Games (https://efficient.games), CC BY 4.0. Zone levels: Backstage Coding review.", npcs, givers, zones };
  return [
    "-- Generated offline by scripts/build-addon-advisor.cjs; do not edit.",
    "-- Quest and NPC data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
    "-- Zone level bands: Backstage Coding review (data/forever-leveling). Positions are approximate.",
    "BackstageForeverAdvisorData=" + lit(data),
    "",
  ].join("\n");
}

const text = compile();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) { console.error("BackstageForeverAdvisorData.lua is stale; run npm run build:addon-advisor."); process.exit(1); }
  console.log("Advisor layer data reproduction passed.");
} else {
  fs.writeFileSync(out, text);
  console.log(`Wrote ${path.relative(root, out)} (${Buffer.byteLength(text)} bytes).`);
}

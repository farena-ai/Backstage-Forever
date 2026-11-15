"use strict";
// Offline build tool (0.50, roadmap 4.1): compiles the guided routes (src/core/guided-route.cjs over
// the bundled quest data, with the hand review in data/forever-route/reviews.json) into the addon's
// BackstageForeverGuideData.lua. --check verifies only.
const fs = require("node:fs");
const path = require("node:path");
const { buildGuidedRoutes } = require("../src/core/guided-route.cjs");
const root = path.join(__dirname, "..");
const target = path.join(root, "addon", "BackstageForever", "BackstageForeverGuideData.lua");
const KIND = { pickup: "p", class: "c", objective: "o", turnin: "t", travel: "g" };
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
function loadReviews() { try { return read("data/forever-route/reviews.json"); } catch { return null; } }
function compile() {
  const { routes } = buildGuidedRoutes({ pack: read("data/forever/pack.json"), zones: read("data/forever-leveling/pack.json").zones, reviews: loadReviews() });
  const body = routes.map((r) => `[${luaString(r.key)}]={f="${r.faction[0]}",z=${r.start},top=${r.reachesLevel},from=${r.startsLevel ?? 1},s={\n` +
    r.steps.map((s) => `{"${KIND[s.kind]}",${luaString(s.text)},${s.mapId},${s.x === null ? "nil" : Math.round(s.x * 1000) / 1000},${s.y === null ? "nil" : Math.round(s.y * 1000) / 1000},${s.level},{${s.ids.join(",")}},${luaString(s.id)}}`).join(",\n") + "\n}}").join(",\n");
  return `-- Generated offline by scripts/build-guided-route.cjs; data only.
-- Built from the bundled quest reference (Efficient Games, https://efficient.games, CC BY 4.0), positions approximate,
-- and hand-reviewed in data/forever-route/reviews.json. Blizzard game content is excluded from that license.
BackstageForeverGuideData = {
${body}
}
` + fs.readFileSync(path.join(__dirname, "guide-runtime.lua"), "utf8");
}
const out = compile().replace(/\r\n/g, "\n");
if (process.argv.includes("--check")) {
  const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== out) { console.error("BackstageForeverGuideData.lua is stale; run npm run build:guided-route."); process.exit(1); }
  console.log("Guided route reproduction passed.");
} else {
  fs.writeFileSync(target, out);
  console.log(`Wrote ${path.relative(root, target)} (${Buffer.byteLength(out)} bytes).`);
}

"use strict";
// Offline build tool: the rare enemies the addon can name (BackstageForeverRareData.lua), from
// the bundled world finds pack.
//   n[creature id] = name; e[creature id] = 1 for a rare elite;
//   d[creature id] = up to two named drops players looted from it (only when recorded).
// Usage: node scripts/build-addon-rares.cjs [--check]
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const out = path.join(root, "addon", "BackstageForever", "BackstageForeverRareData.lua");
const { loadWorldPack } = require("../src/core/world-finds.cjs");
const MAX_BYTES = 48 * 1024;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';

/** The bundled pack by default; tests pass a small one. */
function compile(pack = loadWorldPack()) {
  if (!pack) throw Error("The world finds pack is missing or invalid.");
  const names = [], elite = [], drops = [];
  for (const r of pack.rares) {
    names.push(`[${r.id}]=${luaString(r.name)}`);
    if (r.elite) elite.push(`[${r.id}]=1`);
    const named = r.drops.filter((d) => d.name).slice(0, 2).map((d) => d.name);
    if (named.length) drops.push(`[${r.id}]=${luaString(named.join(", "))}`);
  }
  const text = [
    "-- Generated offline by scripts/build-addon-rares.cjs; do not edit.",
    "-- Rare enemies by creature id: the classification in the game client's own creature data,",
    "-- names and looted drops from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
    `BackstageForeverRareData={build=${luaString(pack.build)},`,
    `n={${names.join(",")}},`,
    `e={${elite.join(",")}},`,
    `d={${drops.join(",")}}}`,
    "",
  ].join("\n");
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error(`BackstageForeverRareData.lua would be ${Buffer.byteLength(text)} bytes; the cap is ${MAX_BYTES}.`);
  return text;
}
if (require.main === module) {
  const text = compile();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== text) { console.error("BackstageForeverRareData.lua is stale; run npm run build:addon-rares."); process.exit(1); }
    console.log(`In-game rare list reproduction passed (${Buffer.byteLength(text)} bytes).`);
  } else {
    fs.writeFileSync(out, text);
    console.log(`Wrote ${path.relative(root, out)} (${Buffer.byteLength(text)} bytes).`);
  }
}
module.exports = { compile, MAX_BYTES };

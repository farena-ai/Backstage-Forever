"use strict";
// Offline compiler for data/forever-pets (roadmap C7, B3): the Hunter pet book.
// Usage: node scripts/build-forever-pets.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
// It also writes the small in-game copy, addon/BackstageForever/BackstageForeverPetData.lua
// (--check verifies that it matches the pack).
const fs = require("node:fs"), path = require("node:path");
const { packTool } = require("./forever-pack-tool.cjs");
const { FILES, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, FAMILIES, compilePets, validatePets } = require("../src/core/hunter-pets.cjs");
const LUA = path.join(__dirname, "../addon/BackstageForever/BackstageForeverPetData.lua"), LUA_LIMIT = 64 * 1024;

function notice(pack, lock) {
  const c = pack.counts;
  return [
    ATTRIBUTION,
    "License: https://creativecommons.org/licenses/by/4.0/",
    "Source: https://github.com/JIVESCORP/eg-link-output-wowf",
    `Immutable source commit: ${lock.commit}`,
    `Product wowf; merged client builds (newest first): ${pack.builds.join(", ")}.`,
    `Tames collected ${pack.collectedOn.first} to ${pack.collectedOn.last}.`,
    "",
    "Backstage Forever changes to the compilation: hunter_pets.json, creatures.json",
    "and creature_details.enUS.json of each build are verified against",
    "source-lock.json. A beast joins by creature id over the builds: abilities and",
    "levels are unioned, tames are added up, the newest English name wins. Kept:",
    "creature id, name, pet family number, wild level range, the spell ids a tamed",
    "beast came with (active and passive apart), diet, number of recorded tames and",
    "up to three approximate places (one per zone map) from creatures.json. Per pet",
    "ability: spell id, the highest pet level recorded as needed, the highest",
    "training point cost recorded, and the pet families it was offered to. Dropped:",
    "attack speeds, training point tallies and contributor counts. Ability names",
    "are not bundled; the app reads them from the player's own game files.",
    "",
    `Coverage: ${c.beasts} beasts (${c.withAbility} with an ability) of ${c.families} families; ${c.abilities} pet abilities;`,
    `${c.unnamed} recorded beasts without an English name or level are left out.`,
    "These are recorded tames, not a full list of beasts. No advice is derived.",
    "No runtime network request is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
/** The in-game copy: beasts (n name, f family, lo/hi level, a abilities, m/x/y first place) and abilities (l pet level, c cost). */
function luaFile(pack) {
  const beasts = pack.beasts.map((b) => { const s = b.spots[0]; return `{i=${b.id},n=${luaString(b.name)},f=${luaString(FAMILIES[b.family] || "")},lo=${b.minLevel},hi=${b.maxLevel},a={${b.abilities.join(",")}}${s ? `,m=${s.mapId},x=${s.x},y=${s.y}` : ""}},`; });
  const training = pack.training.map((a) => `[${a.id}]={l=${a.petLevel}${a.cost === null ? "" : `,c=${a.cost}`}},`);
  const out = [
    "-- Generated offline by scripts/build-forever-pets.cjs; do not edit.",
    `-- ${ATTRIBUTION}`,
    "-- Recorded tames only, places approximate. Ability names come from the game itself.",
    `BackstageForeverPetData={build=${luaString(pack.build)},beasts={`, ...beasts, "},training={", ...training, "}}",
  ].join("\n") + fs.readFileSync(path.join(__dirname, "pets-runtime.lua"), "utf8").replace(/\r\n/g, "\n");
  if (Buffer.byteLength(out) > LUA_LIMIT) throw Error("The in-game pet data is too large.");
  return out;
}
const tool = packTool({
  name: "Hunter pets", dir: path.join(__dirname, "../data/forever-pets"), files: FILES, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: compilePets, validate: validatePets, notice,
  summary: (p) => `${p.counts.beasts} beasts, ${p.counts.withAbility} with an ability, ${p.counts.abilities} pet abilities`,
});
/** The pack tool's command line, then the in-game copy: written after a build, compared on --check. */
function main(args) {
  tool.main(args);
  const out = luaFile(tool.checkBundle());
  if (args.includes("--check")) { if (!fs.existsSync(LUA) || fs.readFileSync(LUA, "utf8").replace(/\r\n/g, "\n") !== out) throw Error("BackstageForeverPetData.lua is stale; run this compiler with --source-dir."); }
  else fs.writeFileSync(LUA, out);
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { ...tool, main, notice, luaFile };

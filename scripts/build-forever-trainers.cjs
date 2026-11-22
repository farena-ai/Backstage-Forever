"use strict";
// Offline compiler for data/forever-trainers (roadmap C6, D4): trainer skills, levels and costs.
// Usage: node scripts/build-forever-trainers.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
const path = require("node:path");
const { packTool } = require("./forever-pack-tool.cjs");
const { FILES, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, compileTrainers, validateTrainerPack } = require("../src/core/trainer-data.cjs");

function notice(pack, lock) {
  const c = pack.counts;
  const classes = Object.entries(pack.coverage).map(([name, v]) => `  ${name}: ${v.services} skills from ${v.trainers} trainers, ${v.withLevel} with a level, ${v.priced} with a price`);
  return [
    ATTRIBUTION,
    "License: https://creativecommons.org/licenses/by/4.0/",
    "Source: https://github.com/JIVESCORP/eg-link-output-wowf",
    `Immutable source commit: ${lock.commit}`,
    `Product wowf; merged client builds (newest first): ${pack.builds.join(", ")}.`,
    `Trainer windows collected ${pack.collectedOn.first} to ${pack.collectedOn.last}.`,
    "",
    "Backstage Forever changes to the compilation: trainers.json and",
    "creature_details.enUS.json of each build are verified against source-lock.json.",
    "A trainer is sorted by its NPC title (\"Mage Trainer\", \"Portal Trainer\", \"Pet",
    "Trainer\", \"Weapon Master\", a riding title, or a profession trainer). Services",
    "join by exact spell id, newest build first: the newest name and price win.",
    "The level is the highest level any player was shown, because a trainer window",
    "reports level 0 once the player has the level; 0 here means no level was",
    "recorded. The price is the full price (reputation below Honored); the Honored",
    "price is kept beside it. Kept: spell id, name, rank text, level, required",
    "profession skill, prices. Dropped: icons, trainer positions and names,",
    "contributor counts, required-ability text and the undocumented \"bartered\"",
    "prices.",
    "",
    `Coverage: ${c.trainers} trainers seen; ${c.untitledTrainers} have no recorded title and`,
    `${c.otherTrainers} have a title this compiler does not sort, so their services are left out.`,
    `${c.classServices} class, ${c.professionServices} profession, ${c.weaponServices} weapon and ${c.ridingServices} riding services.`,
    `${c.barteredOnly} services have only a \"bartered\" price and so no price here.`,
    ...classes,
    "",
    "These are what players saw, not a complete list: a class with few recorded",
    "trainers is missing skills. Talent ranks appear in trainer windows only for",
    "players who have the talent. No advice is derived. No runtime network request",
    "is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const tool = packTool({
  name: "Trainer costs", dir: path.join(__dirname, "../data/forever-trainers"), files: FILES, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: compileTrainers, validate: validateTrainerPack, notice,
  summary: (p) => `${p.counts.classServices} class, ${p.counts.professionServices} profession, ${p.counts.weaponServices} weapon and ${p.counts.ridingServices} riding services from ${p.counts.trainers} trainers`,
});
if (require.main === module) tool.main(process.argv.slice(2));
module.exports = { ...tool, notice };

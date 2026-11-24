"use strict";
// Offline compiler for data/forever-encounter-roster (roadmap B3, B4): the boss fights players
// recorded in each dungeon, merged over every build of the patch.
// Usage: node scripts/build-forever-encounters.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
// data/forever-encounters (one file of one build) is a different, pinned pack: the Companion's
// dated "historical encounters" answer names that exact file, so it is never rebuilt here.
const path = require("node:path");
const { packTool } = require("./forever-pack-tool.cjs");
const { FILES, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, compileRoster, validateRoster } = require("../src/core/encounter-roster.cjs");

function notice(pack, lock) {
  const c = pack.counts;
  return [
    ATTRIBUTION,
    "License: https://creativecommons.org/licenses/by/4.0/",
    "Source: https://github.com/JIVESCORP/eg-link-output-wowf",
    `Immutable source commit: ${lock.commit}`,
    `Product wowf; merged client builds (newest first): ${pack.builds.join(", ")}.`,
    `Boss fights collected ${pack.collectedOn.first} to ${pack.collectedOn.last}.`,
    "",
    "Backstage Forever changes to the compilation: encounters.json of each build is",
    "verified against source-lock.json. Rows join by the game's encounter id. The",
    "newest build's name wins; kills, pulls and runs are added up over the builds;",
    "boss NPC ids are unioned. Kept: encounter id, name, instance map, kills, pulls,",
    "runs, boss NPC ids, number of builds. Dropped: positions, difficulties,",
    "same-run tallies and contributor counts. A name not in Latin letters (seen in",
    "a game in another language) is left out; a name from another Latin-letter",
    "language cannot be told apart and is kept as recorded.",
    "",
    `Coverage: ${c.encounters} boss fights in ${c.instances} instances; ${c.dropped} rows left out.`,
    "This is what players recorded, not a full boss list, and it holds no boss",
    "abilities or tactics. No advice is derived. No runtime network request is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const tool = packTool({
  name: "Encounter roster", dir: path.join(__dirname, "../data/forever-encounter-roster"), files: FILES, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: compileRoster, validate: validateRoster, notice,
  summary: (p) => `${p.counts.encounters} boss fights in ${p.counts.instances} instances`,
});
if (require.main === module) tool.main(process.argv.slice(2));
module.exports = { ...tool, notice };

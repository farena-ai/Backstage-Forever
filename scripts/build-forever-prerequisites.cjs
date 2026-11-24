"use strict";
// Offline compiler for data/forever-prerequisites (roadmap B3): which quests players had finished
// before they took a quest. Reads upstream quest_prerequisites.json and the reported follow-up
// links of the bundled quest pack (data/forever/pack.json), so it runs after the quest pack.
// Usage: node scripts/build-forever-prerequisites.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
const fs = require("node:fs"), path = require("node:path");
const { packTool, hash } = require("./forever-pack-tool.cjs");
const { FILES, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, NEED_RECORDS, SEEN_RECORDS, compilePrerequisites, validatePrerequisites } = require("../src/core/quest-prerequisites.cjs");
const QUEST_PACK = path.join(__dirname, "../data/forever/pack.json");
const questPack = () => { const bytes = fs.readFileSync(QUEST_PACK); return { quests: JSON.parse(bytes).quests, questPackSha256: hash(bytes) }; };

function notice(pack, lock) {
  const c = pack.counts;
  return [
    ATTRIBUTION,
    "License: https://creativecommons.org/licenses/by/4.0/",
    "Source: https://github.com/JIVESCORP/eg-link-output-wowf",
    `Immutable source commit: ${lock.commit}`,
    `Product wowf; merged client builds (newest first): ${pack.builds.join(", ")}.`,
    `Collected ${pack.collectedOn.first} to ${pack.collectedOn.last}.`,
    "",
    "Backstage Forever changes to the compilation: quest_prerequisites.json of each",
    "build is verified against source-lock.json. Upstream lists, per quest, the quests",
    "every recorded character had finished before taking it. That list holds the real",
    "prerequisites and also quests everybody simply does early, so only three careful",
    "readings are kept. The lists of the builds are intersected; record counts are",
    "added up (the same character may be counted in more than one build).",
    `  needs: a reported follow-up link X -> Q in the bundled quest pack, and every`,
    `    record had X finished first (${NEED_RECORDS} or more records). ${c.needs} quests.`,
    "  lead-ins: the only reported link X -> Q, but a record took Q without X, so X",
    `    is not required (${NEED_RECORDS} or more records). ${c.leadIns} quests.`,
    "  seen: no reported link; X is handed in to the NPC that gives Q and every record",
    `    had X finished first (${SEEN_RECORDS} or more records). A recorded pattern, not a rule.`,
    `    ${c.seen} quests.`,
    `${c.quests} quests have a record; ${c.unclear} have several reported links of which none`,
    "was finished by every record (alternatives for different characters) and are left out.",
    `Joined with data/forever/pack.json, sha256 ${pack.questPackSha256}.`,
    "Kept: quest ids and record counts. Dropped: the full lists. No advice is derived.",
    "No runtime network request is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const tool = packTool({
  name: "Quest prerequisites", dir: path.join(__dirname, "../data/forever-prerequisites"), files: FILES, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: (builds, { commit }) => compilePrerequisites(builds, { commit, ...questPack() }),
  // The offline check also refuses a pack joined with another quest pack than the bundled one.
  validate: (pack) => { validatePrerequisites(pack); if (pack.questPackSha256 !== questPack().questPackSha256) throw Error("Quest prerequisites were built from another quest pack; run this compiler again."); return pack; },
  notice,
  summary: (p) => `${p.counts.needs} quests with a needed quest, ${p.counts.leadIns} optional lead-ins, ${p.counts.seen} recorded patterns`,
});
if (require.main === module) tool.main(process.argv.slice(2));
module.exports = { ...tool, notice };

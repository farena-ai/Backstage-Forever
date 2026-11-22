"use strict";
// Offline compiler for data/forever-transport (roadmap D3): the flight graph of both factions.
// Usage: node scripts/build-forever-transport.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
const path = require("node:path");
const { packTool } = require("./forever-pack-tool.cjs");
const { FILES, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, compileTransport, validateTransportPack } = require("../src/core/transport-data.cjs");

function notice(pack, lock) {
  const c = pack.counts;
  return [
    ATTRIBUTION,
    "License: https://creativecommons.org/licenses/by/4.0/",
    "Source: https://github.com/JIVESCORP/eg-link-output-wowf",
    `Immutable source commit: ${lock.commit}`,
    `Product wowf; merged client builds (newest first): ${pack.builds.join(", ")}.`,
    `Flight observations collected ${pack.collectedOn.first} to ${pack.collectedOn.last}.`,
    "",
    "Backstage Forever changes to the compilation: flights.json and npcs.json of each",
    "build are verified against source-lock.json, then merged newest-first into",
    `${c.nodes} flight points, ${c.edges} direct connections (${c.timedEdges} with an observed`,
    `flight time, ${c.pricedEdges} with an observed price) and ${c.routes} longer routes the game`,
    `itself offered (${c.timedRoutes} with an observed time). Flight seconds are the middle value`,
    "of all recorded flights of a connection. The price is the full price (reputation",
    "below Honored); the Honored price is kept beside it. A connection that only",
    "appears as a hop of a longer route has no time and no price of its own.",
    "Flight masters join by exact NPC id; a flight point takes its place from its",
    `flight master, or from where players landed (${c.placedNodes} of ${c.nodes} are placed).`,
    "A flight point's faction is its flight master's recorded side, or else the side",
    "of the flight masters it connects to (marked \"links\").",
    "Zone map to world position lines are fitted from the recorded positions that",
    "carry both, and the typical flight speed is the middle speed of the timed",
    "connections; both are used only for estimates that the app labels as estimates.",
    "",
    "Not in the upstream data: flight point names, boats, zeppelins, the tram and",
    "portals. Nothing was added for them. Times and prices are what players saw on",
    "the listed builds; a connection nobody flew has no time. No runtime network",
    "request is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const tool = packTool({
  name: "Transport graph", dir: path.join(__dirname, "../data/forever-transport"), files: FILES, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: compileTransport, validate: validateTransportPack, notice,
  summary: (p) => `${p.counts.nodes} flight points, ${p.counts.edges} connections, ${p.counts.timedEdges} timed, ${p.counts.routes} longer routes`,
});
if (require.main === module) tool.main(process.argv.slice(2));
module.exports = { ...tool, notice };

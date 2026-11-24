"use strict";
// Offline compiler for data/forever-transport (roadmap D3): the flight graph of both factions.
// Boats, zeppelins and airships: only that they exist (name, path number, speed), from object_details.
// Usage: node scripts/build-forever-transport.cjs --check | --source-dir DIR [--check] | --relock DIR --commit SHA
const path = require("node:path");
const { packTool } = require("./forever-pack-tool.cjs");
const { FILES, OPTIONAL, RAW_LIMITS, PACK_LIMIT, ATTRIBUTION, compileTransport, validateTransportPack } = require("../src/core/transport-data.cjs");

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
    `Boats, zeppelins and airships: ${c.transports} moving transports from object_details.enUS.json`,
    "(object type 15) of the builds that have that file, newest first: object id, name,",
    "path number, speed and acceleration, exactly as recorded. Whether one is a",
    "zeppelin or an airship is read from its name; the rest count as a boat when they",
    "use the model number all named ships share, and are left out otherwise. Upstream",
    "does not record where a transport stops, how long a ride takes or which faction",
    "may board, so none of that is in this pack: the app reads the stops from the",
    "path table of the player's own game files at run time, works the ride time out",
    "from the path length and the recorded speed, and labels it as an estimate.",
    "",
    "Not in the upstream data: flight point names, transport stops, the tram and",
    "portals. Nothing was added for them. Times and prices are what players saw on",
    "the listed builds; a connection nobody flew has no time. A flight master's name",
    "seen in a game in another language gives way to its English name from another",
    "build. The app reads the names of the flight points, the places nobody recorded",
    "and the prices nobody saw from the player's own game files at run time; none of",
    "that is in this pack. No runtime network request is needed.",
    "",
    "World of Warcraft and related content are copyright Blizzard Entertainment, Inc.",
    "The license covers the compilation and observations, not Blizzard content.",
    "",
  ].join("\n");
}
const tool = packTool({
  name: "Transport graph", dir: path.join(__dirname, "../data/forever-transport"), files: FILES, optional: OPTIONAL, rawLimits: RAW_LIMITS, packLimit: PACK_LIMIT,
  compile: compileTransport, validate: validateTransportPack, notice,
  summary: (p) => `${p.counts.nodes} flight points, ${p.counts.edges} connections, ${p.counts.timedEdges} timed, ${p.counts.routes} longer routes, ${p.counts.transports} boats, zeppelins and airships`,
});
if (require.main === module) tool.main(process.argv.slice(2));
module.exports = { ...tool, notice };

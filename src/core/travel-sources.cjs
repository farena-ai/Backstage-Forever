"use strict";
// Immutable provenance and original factual curation; no guide prose is redistributed.
const COMMIT = "23f9636486d3d60479dc0bcee2356053c33faf2c";
const BUILD = "1.60.1.70862";
const INPUTS = [
  {
    name: "flights.json",
    url: "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/23f9636486d3d60479dc0bcee2356053c33faf2c/data/wowf/1.60.1.70862/flights.json",
    bytes: 21454,
    sha256: "4f5192576501cf17ceb4cbf0cbb56a63658525a5e0e16f299506ddf66d16e1cd",
    meta: {
      attribution:
        "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      clientBuild: "1.60.1.70862",
      collectedOn: {
        first: "2026-11-09",
        last: "2026-11-09",
      },
      dataset: "flights",
      license: "CC BY 4.0",
      product: "wowf",
      schemaVersion: 1,
      sources: 3,
    },
  },
  {
    name: "npcs.json",
    url: "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/23f9636486d3d60479dc0bcee2356053c33faf2c/data/wowf/1.60.1.70862/npcs.json",
    bytes: 499984,
    sha256: "aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded",
    meta: {
      attribution:
        "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      clientBuild: "1.60.1.70862",
      collectedOn: {
        first: "2026-11-09",
        last: "2026-11-09",
      },
      dataset: "npcs",
      license: "CC BY 4.0",
      product: "wowf",
      schemaVersion: 1,
      sources: 3,
    },
  },
  {
    name: "quests.enUS.json",
    url: "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/23f9636486d3d60479dc0bcee2356053c33faf2c/data/wowf/1.60.1.70862/quests.enUS.json",
    bytes: 4141584,
    sha256: "fece8cc749952f9a3eb8eeb223e6ebaea3d4d8244dd6ebd7c18091e93f5bed47",
    meta: {
      attribution:
        "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      cacheFiles: 68,
      cachesLeftOut: 0,
      clientBuild: "1.60.1.70862",
      collectedOn: {
        first: "2026-11-07",
        last: "2026-11-09",
      },
      dataset: "quests",
      license: "CC BY 4.0",
      locale: "enUS",
      product: "wowf",
      schemaVersion: 1,
      sources: 3,
    },
  },
];
const SOURCES = [
  {
    product: "wowf",
    id: "E1",
    publisher: "Efficient Games",
    url: "https://github.com/JIVESCORP/eg-link-output-wowf/tree/23f9636486d3d60479dc0bcee2356053c33faf2c/data/wowf/1.60.1.70862",
    commit: "23f9636486d3d60479dc0bcee2356053c33faf2c",
    build: "1.60.1.70862",
    scope: "exact-build-observation",
    observedOn: "2026-11-09",
    license:
      "CC BY 4.0 for compilation and observations; excludes Blizzard rights",
    reviewedOn: "2026-11-10",
  },
  {
    product: "wowf",
    id: "E2",
    publisher: "GamerBlurb",
    author: "GamerBlurb Team",
    url: "https://gamerblurb.com/articles/how-to-get-to-thunder-bluff-from-orgrimmar-in-wow-forever",
    publishedOn: "2026-11-06",
    scope: "published-forever-guidance",
    license: "All rights reserved; original factual curation only",
    reviewedOn: "2026-11-10",
  },
  {
    product: "wowf",
    id: "E3",
    publisher: "How To Video Game",
    author: "Mrs. and Mr. Video Games",
    url: "https://howtovideogame.com/wow-forever-thunder-bluff-get-to/",
    publishedOn: "2026-11-06",
    scope: "published-forever-guidance",
    license:
      "No open redistribution grant established; original factual curation only",
    reviewedOn: "2026-11-10",
  },
  {
    product: "wowf",
    id: "E4",
    publisher: "Method",
    author: "Geekmandem",
    url: "https://www.method.gg/wow-forever/all-travel-routes-in-wow-forever-boats-zeppelins",
    publishedOn: "2026-10-14",
    scope: "published-forever-guidance-prelaunch",
    license: "All rights reserved; original factual curation only",
    reviewedOn: "2026-11-10",
  },
];

const CITIES = [
  ["orgrimmar", "Orgrimmar", ["orgrimmar", "org"]],
  ["thunder-bluff", "Thunder Bluff", ["thunder bluff", "thunderbluff", "tb"]],
  ["crossroads", "Crossroads", ["crossroads", "the crossroads"]],
  ["undercity", "Undercity", ["undercity", "uc"]],
  ["gromgol", "Grom'gol", ["grom'gol", "gromgol"]],
  ["stormwind", "Stormwind", ["stormwind", "sw"]],
  ["ironforge", "Ironforge", ["ironforge"]],
  ["auberdine", "Auberdine", ["auberdine"]],
  ["ratchet", "Ratchet", ["ratchet"]],
  ["booty-bay", "Booty Bay", ["booty bay"]],
];
const ENDPOINTS = [
  ["orgrimmar-zeppelin-tower", "Orgrimmar zeppelin tower", "orgrimmar"],
  ["tirisfal-zeppelin-tower", "Tirisfal zeppelin tower", "undercity"],
  ["gromgol-zeppelin-tower", "Grom'gol zeppelin tower", "gromgol"],
  ["stormwind-harbour", "Stormwind Harbour", "stormwind"],
  ["auberdine-dock", "Auberdine dock", "auberdine"],
  ["stormwind-tram", "Stormwind tram entrance", "stormwind"],
  ["ironforge-tram", "Ironforge tram entrance", "ironforge"],
];
const MASTERS = [
  {
    city: "orgrimmar",
    npcId: 3310,
    taxiNode: 23,
    name: "Doras",
    questId: 6385,
  },
  {
    city: "thunder-bluff",
    npcId: 2995,
    taxiNode: 22,
    name: "Tal",
    questId: 6363,
  },
  {
    city: "crossroads",
    npcId: 3615,
    taxiNode: 25,
    name: "Devrak",
    questId: 6361,
  },
];
// Every direction below is independently enumerated in the cited evidence.
const FLIGHTS = ["23>22", "22>23", "23>25", "25>23", "25>22", "22>25"];
const TRANSPORTS = [
  ["orgrimmar-zeppelin-tower", "tirisfal-zeppelin-tower", "zeppelin", "Horde"],
  ["tirisfal-zeppelin-tower", "orgrimmar-zeppelin-tower", "zeppelin", "Horde"],
  ["tirisfal-zeppelin-tower", "gromgol-zeppelin-tower", "zeppelin", "Horde"],
  ["gromgol-zeppelin-tower", "tirisfal-zeppelin-tower", "zeppelin", "Horde"],
  ["orgrimmar-zeppelin-tower", "gromgol-zeppelin-tower", "zeppelin", "Horde"],
  ["gromgol-zeppelin-tower", "orgrimmar-zeppelin-tower", "zeppelin", "Horde"],
  ["stormwind-tram", "ironforge-tram", "tram", "Alliance"],
  ["ironforge-tram", "stormwind-tram", "tram", "Alliance"],
  ["stormwind-harbour", "auberdine-dock", "boat", "Alliance"],
  ["auberdine-dock", "stormwind-harbour", "boat", "Alliance"],
];
const ROAD_STEPS = [
  "Leave Orgrimmar through the main gate and follow the road south toward Razor Hill.",
  "Turn west toward the Southfury bridge and continue past Far Watch Post.",
  "Follow the Barrens road south toward Crossroads, then Camp Taurajo.",
  "Turn west through the pass into Mulgore toward Bloodhoof Village.",
  "Head north toward the base of Thunder Bluff and use the lifts to reach the city.",
];
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
module.exports = freeze({
  COMMIT,
  BUILD,
  INPUTS,
  SOURCES,
  CITIES,
  ENDPOINTS,
  MASTERS,
  FLIGHTS,
  TRANSPORTS,
  ROAD_STEPS,
});

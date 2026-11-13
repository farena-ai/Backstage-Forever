"use strict";
// Flight master NPC id -> upstream taxi node id, from Efficient Games flights.json
// (`masters: { npcId: { name, node } }`) at the pinned commit, merged newest-first across
// the bundled builds (first build that names a master wins; builds never disagree).
// Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
// Reproduce: node scripts/build-addon-advisor.cjs --source-dir DIR (DIR/<build>/flights.json).
const { createHash } = require("node:crypto"), { isDeepStrictEqual } = require("node:util");
const COMMIT = "164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1";
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMIT = 256 * 1024, MAX_MASTERS = 500;
const meta = (clientBuild, first, last, sources) => ({ attribution: ATTRIBUTION, clientBuild, collectedOn: { first, last }, dataset: "flights", license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources });
const source = (build, bytes, sha256, m) => Object.freeze({ name: "flights.json", build, bytes, sha256, url: `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/flights.json`, meta: m });
// Newest first.
const SOURCES = Object.freeze([
  source("1.60.1.70888", 24801, "3a7aefba9e6fdeb68a5ec8d606fa73411ef112754f67eff6a8807c44dcf49f6d", meta("1.60.1.70888", "2026-11-10", "2026-11-12", 4)),
  source("1.60.1.70862", 27676, "2c90f90e171642b9b50dcf63b44a16849df5b1f06591f6c035c309c658ac29dc", meta("1.60.1.70862", "2026-11-09", "2026-11-12", 5)),
  source("1.60.1.70840", 7898, "ceb80c7cfaa5e20783c085055cf4563d927b3db45d55f6d5d3b27c4e3576edc3", meta("1.60.1.70840", "2026-11-09", "2026-11-12", 3)),
  source("1.60.1.70790", 12198, "ac4b017c5c6120ef5144b903fad3a0a46a8fec40423bf409d4f14a1b332cbeb9", meta("1.60.1.70790", "2026-11-09", "2026-11-12", 4)),
]);
// npcId: [name, taxi node]
const MASTERS = Object.freeze({
  352: ["Dungar Longdrink", 2],
  523: ["Thor", 4],
  931: ["Ariena Stormfeather", 5],
  1573: ["Gryth Thurden", 6],
  2226: ["Karos Razok", 10],
  2389: ["Zarise", 13],
  2851: ["Urda", 17],
  2995: ["Tal", 22],
  3310: ["Doras", 23],
  3615: ["Devrak", 25],
  3838: ["Vesprystus", 27],
  4312: ["Tharm", 29],
  4317: ["Nyse", 30],
  4551: ["Michael Garrett", 11],
  6726: ["Thalon", 38],
  8020: ["Shyn", 42],
  10378: ["Omusa Thunderhorn", 77],
  11899: ["Shardi", 55],
  11901: ["Andruk", 58],
  12616: ["Vhulgra", 61],
  16227: ["Bragok", 80],
  255993: ["Grakna", 3203],
});
const fail = () => { throw Error("Invalid flight master reference."); };
const id = (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const text = (s) => typeof s === "string" && s.length > 0 && s.length <= 200 && !/[\x00-\x1f\x7f]/.test(s);
function validateMasters(masters) {
  if (!masters || typeof masters !== "object" || Array.isArray(masters) || Object.keys(masters).length > MAX_MASTERS) fail();
  for (const [key, row] of Object.entries(masters)) if (!/^[1-9]\d*$/.test(key) || !id(+key) || !Array.isArray(row) || row.length !== 2 || !text(row[0]) || !id(row[1])) fail();
  return masters;
}
/** rawByBuild: { build: Buffer of flights.json } for every pinned build; verified, then merged. */
function normalizeFlightMasters(rawByBuild) {
  const out = {};
  for (const s of SOURCES) {
    const bytes = rawByBuild?.[s.build];
    if (!Buffer.isBuffer(bytes) || bytes.length > RAW_LIMIT || bytes.length !== s.bytes || createHash("sha256").update(bytes).digest("hex") !== s.sha256) fail();
    const raw = JSON.parse(bytes);
    if (!isDeepStrictEqual(raw.meta, s.meta) || !raw.masters || typeof raw.masters !== "object" || Array.isArray(raw.masters)) fail();
    for (const [key, m] of Object.entries(raw.masters)) {
      if (!/^[1-9]\d*$/.test(key) || !text(m?.name) || !id(m?.node)) fail();
      if (out[key]) { if (out[key][1] !== m.node) fail(); continue; }
      out[key] = [m.name, m.node];
    }
  }
  return validateMasters(Object.fromEntries(Object.entries(out).sort((a, b) => a[0] - b[0])));
}
validateMasters(MASTERS);
/** Upstream taxi node id for a flight master NPC id, or undefined. */
const taxiNode = (npcId) => MASTERS[npcId]?.[1];
module.exports = { COMMIT, ATTRIBUTION, SOURCES, MASTERS, validateMasters, normalizeFlightMasters, taxiNode };

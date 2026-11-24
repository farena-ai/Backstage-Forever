"use strict";
// Flight master NPC id -> upstream taxi node id, from Efficient Games flights.json
// (`masters: { npcId: { name, node } }`) at the pinned commit, merged newest-first across
// the bundled builds (first build that names a master wins; builds never disagree).
// Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
// Reproduce: node scripts/build-addon-advisor.cjs --source-dir DIR (DIR/<build>/flights.json).
const { createHash } = require("node:crypto"), { isDeepStrictEqual } = require("node:util"); const { latinName } = require("./latin-name.cjs");
const COMMIT = "423d6c9645cd102406782e7400805a7c738e2d69";
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMIT = 256 * 1024, MAX_MASTERS = 500;
const meta = (clientBuild, first, last, sources) => ({ attribution: ATTRIBUTION, clientBuild, collectedOn: { first, last }, dataset: "flights", license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources });
const source = (build, bytes, sha256, m) => Object.freeze({ name: "flights.json", build, bytes, sha256, url: `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/flights.json`, meta: m });
// Newest first.
const SOURCES = Object.freeze([
  source("1.60.1.71037", 48299, "a3f4a73a4d8e9fb5112af1bea3fff845d1f92155408d13805cc7c96b8b1e55a2", meta("1.60.1.71037", "2026-11-22", "2026-11-23", 6)),
  source("1.60.1.70959", 44806, "c32910925347f21e5285a40581945037a4bd139dc8e946781bc457cd54026a80", meta("1.60.1.70959", "2026-11-19", "2026-11-23", 10)),
  source("1.60.1.70938", 38566, "4a41e20949714627eca7d422bd94210f652a0574529b474f2745335371939cc0", meta("1.60.1.70938", "2026-11-20", "2026-11-21", 8)),
  source("1.60.1.70888", 28319, "438a576ee44a876b807b3f3f42d1138e6a7fcd24c71ea94be84cc854cf1bdeab", meta("1.60.1.70888", "2026-11-20", "2026-11-21", 4)),
  source("1.60.1.70862", 27676, "94c5181c0f5dc9a095d5ad02b8f20c615e5bdc6e068c20b020f0f482c2ee6291", meta("1.60.1.70862", "2026-11-09", "2026-11-21", 5)),
  source("1.60.1.70840", 7898, "bd7ae1b3910afb82925578ad3aa5e46096edfa7d8fb04514c707a3d41ff0e9dc", meta("1.60.1.70840", "2026-11-09", "2026-11-21", 3)),
  source("1.60.1.70790", 12198, "8918141ad93ea1b1a24d867b852d2b6b90e0ca05d3d12041a0d79afb6d8e731a", meta("1.60.1.70790", "2026-11-09", "2026-11-21", 4)),
  source("1.60.1.70450", 536, "9191ddf895649c26ad4600878eea482516525baee77e0f924aa50a0378995e11", meta("1.60.1.70450", "2026-11-10", "2026-11-10", 1)),
  source("1.60.1.70338", 6280, "6719ebbc9a0309613339daf8940f81c39e153b831b95f8310045823810bbf872", meta("1.60.1.70338", "2026-11-10", "2026-11-10", 1)),
  source("1.60.1.70334", 2641, "1e743b13e9e51267f0e8f48feea2118153e9dc20e4c796fe7e10579cadd3e59e", meta("1.60.1.70334", "2026-11-10", "2026-11-10", 1)),
  source("1.60.1.70291", 1272, "1f5ce6fb6b21aa096967be8f4d96bf3975b1a52268f18be5153642aa46886099", meta("1.60.1.70291", "2026-11-10", "2026-11-10", 1)),
  source("1.60.1.70205", 6125, "37d85618f4d0468c3a2197e4c07a54b97a405526937df09a147cb00c74430512", meta("1.60.1.70205", "2026-11-10", "2026-11-10", 1)),
]);
// npcId: [name, taxi node]
const MASTERS = Object.freeze({
  352: ["Dungar Longdrink", 2],
  523: ["Thor", 4],
  931: ["Ariena Stormfeather", 5],
  1387: ["Thysta", 20],
  1571: ["Shellei Brondir", 7],
  1572: ["Thorgrum Borrelson", 8],
  1573: ["Gryth Thurden", 6],
  2226: ["Karos Razok", 10],
  2389: ["Zarise", 13],
  2409: ["Felicia Maline", 12],
  2432: ["Darla Harris", 14],
  2835: ["Cedrik Prose", 16],
  2851: ["Urda", 17],
  2858: ["Gringer", 18],
  2859: ["Gyll", 19],
  2861: ["Gorrik", 21],
  2995: ["Tal", 22],
  3305: ["Grisha", 75],
  3310: ["Doras", 23],
  3615: ["Devrak", 25],
  3838: ["Vesprystus", 27],
  3841: ["Caylais Moonfeather", 26],
  4267: ["Daelyshia", 28],
  4312: ["Tharm", 29],
  4314: ["Gorkas", 76],
  4317: ["Nyse", 30],
  4551: ["Michael Garrett", 11],
  6026: ["Breyk", 56],
  6726: ["Thalon", 38],
  7824: ["Bulkrek Ragefist", 40],
  8020: ["Shyn", 42],
  8610: ["Kroum", 44],
  10378: ["Omusa Thunderhorn", 77],
  10583: ["Gryfe", 79],
  11139: ["Yugrek", 53],
  11899: ["Shardi", 55],
  11901: ["Andruk", 58],
  12616: ["Vhulgra", 61],
  12740: ["Faustron", 69],
  13177: ["Vahgruk", 70],
  16227: ["Bragok", 80],
  41861: ["Fayran Elthas", 559],
  255993: ["Grakna", 3203],
  260626: ["Bluebell", 3242],
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
      // Newest build first; a name seen in another language gives way to an English one.
      if (out[key]) { if (out[key][1] !== m.node) fail(); if (latinName(out[key][0]) || !latinName(m.name)) continue; }
      out[key] = [m.name, m.node];
    }
  }
  return validateMasters(Object.fromEntries(Object.entries(out).sort((a, b) => a[0] - b[0])));
}
validateMasters(MASTERS);
/** Upstream taxi node id for a flight master NPC id, or undefined. */
const taxiNode = (npcId) => MASTERS[npcId]?.[1];
module.exports = { COMMIT, ATTRIBUTION, SOURCES, MASTERS, validateMasters, normalizeFlightMasters, taxiNode };

"use strict";
// Boss roster seen in play (roadmap B3, B4): which boss fights players recorded in each dungeon,
// merged over every build of the patch. Built offline by scripts/build-forever-encounters.cjs from
// Efficient Games encounters.json (CC BY 4.0). Recorded data only: a name, the instance, and how
// often it was pulled and killed. Upstream records no boss abilities, so none are shown.
const fs = require("node:fs"), path = require("node:path");
const { latinName } = require("./latin-name.cjs");

const FILES = Object.freeze(["encounters.json"]);
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMITS = Object.freeze({ "encounters.json": 4 * 1024 * 1024 });
const PACK_LIMIT = 128 * 1024, MAX_BUILDS = 16, MAX_ROWS = 2000, MAX_NPCS = 8;
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} '’.,-]{0,99}$/u;
const fail = (why = "") => { throw Error("Invalid encounter roster data." + (why ? " " + why : "")); };
const id = (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const count = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000000;

/**
 * builds: [{ build, files: { "encounters.json": Buffer } }], newest first. Rows join by the game's
 * encounter id: the newest build's name wins, kills, pulls and runs are added up over the builds
 * (each build's file holds that build's own records), boss NPC ids are unioned.
 */
function compileRoster(builds, { commit }) {
  if (!Array.isArray(builds) || !builds.length || builds.length > MAX_BUILDS || !/^[a-f0-9]{40}$/.test(commit || "")) fail();
  const rows = new Map(), dates = [];
  let dropped = 0;
  for (const { build, files } of builds) {
    if (!BUILD_RE.test(build)) fail();
    const j = JSON.parse(files["encounters.json"]);
    if (j?.meta?.dataset !== "encounters" || j.meta.clientBuild !== build || !j.encounters || typeof j.encounters !== "object") fail("Source metadata.");
    dates.push(j.meta.collectedOn.first, j.meta.collectedOn.last);
    for (const [key, e] of Object.entries(j.encounters)) {
      const encounter = Number(key);
      if (!id(encounter) || !e || !id(e.map) || typeof e.name !== "string" || !NAME.test(e.name) || !latinName(e.name) || !count(e.kills) || !count(e.runs) || !count(e.pulls)) { dropped++; continue; }
      let row = rows.get(encounter);
      if (!row) { row = { id: encounter, name: e.name, instanceMap: e.map, kills: 0, runs: 0, pulls: 0, npcIds: [], builds: 0 }; rows.set(encounter, row); }
      if (row.instanceMap !== e.map) { dropped++; continue; }
      row.kills += e.kills; row.runs += e.runs; row.pulls += e.pulls; row.builds++;
      for (const npc of Array.isArray(e.bosses) ? e.bosses : []) if (id(npc) && !row.npcIds.includes(npc) && row.npcIds.length < MAX_NPCS) row.npcIds.push(npc);
    }
  }
  const encounters = [...rows.values()].map((r) => ({ ...r, npcIds: r.npcIds.sort((a, b) => a - b) })).sort((a, b) => a.instanceMap - b.instanceMap || a.id - b.id);
  return validateRoster({
    schemaVersion: 1, kind: "forever-encounter-roster", product: "wowf", build: builds[0].build, builds: builds.map((b) => b.build), sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION,
    collectedOn: { first: dates.sort()[0], last: dates.at(-1) },
    counts: { encounters: encounters.length, instances: new Set(encounters.map((e) => e.instanceMap)).size, dropped },
    encounters,
  });
}
function validateRoster(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-encounter-roster" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(p.sourceCommit || "")) fail("Header.");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > MAX_BUILDS || p.builds[0] !== p.build || p.builds.some((b) => !BUILD_RE.test(b)) || new Set(p.builds).size !== p.builds.length) fail("Builds.");
  if (!/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.first || "") || !/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.last || "") || p.collectedOn.first > p.collectedOn.last) fail("Dates.");
  if (!Array.isArray(p.encounters) || p.encounters.length > MAX_ROWS) fail("Rows.");
  const seen = new Set();
  for (const e of p.encounters) {
    if (!e || !id(e.id) || seen.has(e.id) || !id(e.instanceMap) || typeof e.name !== "string" || !NAME.test(e.name) || !count(e.kills) || !count(e.runs) || !count(e.pulls)) fail("Row.");
    if (!Number.isSafeInteger(e.builds) || e.builds < 1 || e.builds > p.builds.length || !Array.isArray(e.npcIds) || e.npcIds.length > MAX_NPCS || e.npcIds.some((n) => !id(n))) fail("Row.");
    seen.add(e.id);
  }
  const c = p.counts;
  if (!c || c.encounters !== p.encounters.length || c.instances !== new Set(p.encounters.map((e) => e.instanceMap)).size || !count(c.dropped)) fail("Counts.");
  return p;
}
let cached;
/** The bundled roster, or null when it is missing or broken (the atlas then shows its baseline only). */
function loadRoster(file = path.join(__dirname, "../../data/forever-encounter-roster/pack.json")) {
  const bundled = arguments.length === 0;
  if (bundled && cached !== undefined) return cached;
  let pack = null;
  try { if (fs.statSync(file).size <= PACK_LIMIT) pack = validateRoster(JSON.parse(fs.readFileSync(file))); } catch { pack = null; }
  if (bundled) cached = pack;
  return pack;
}
module.exports = { FILES, ATTRIBUTION, RAW_LIMITS, PACK_LIMIT, compileRoster, validateRoster, loadRoster };

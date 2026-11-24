"use strict";
// Quest prerequisites (roadmap B3): which quests players had finished before they took a quest.
// Built offline by scripts/build-forever-prerequisites.cjs from Efficient Games
// quest_prerequisites.json (CC BY 4.0) and the reported follow-up links of the bundled quest pack.
//
// Upstream records, per quest, the quests EVERY recorded character had already finished when it
// took that quest. That list always holds the real prerequisites, and also quests everybody
// simply does early. So three careful readings are kept, and nothing else:
//   needs    a reported follow-up link X -> Q, and every record had X done first (3+ records)
//   leadIns  the only reported link X -> Q, but someone took Q without X: X is not required
//   seen     no reported link, X is handed in to the NPC that gives Q, every record had X done
//            first (5+ records). A recorded pattern, never used to hide a quest.
const fs = require("node:fs"), path = require("node:path");

const FILES = Object.freeze(["quest_prerequisites.json"]);
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const RAW_LIMITS = Object.freeze({ "quest_prerequisites.json": 16 * 1024 * 1024 });
const PACK_LIMIT = 256 * 1024, MAX_BUILDS = 16, MAX_ROWS = 6000, MAX_BEFORE = 4000, MAX_PER_QUEST = 4;
const NEED_RECORDS = 3, SEEN_RECORDS = 5;
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const fail = (why = "") => { throw Error("Invalid quest prerequisite data." + (why ? " " + why : "")); };
const id = (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

/**
 * builds: [{ build, files: { "quest_prerequisites.json": Buffer } }], newest first.
 * quests: the bundled quest pack's quests (id -> { nextQuestId, givers, turnIns }).
 * A quest's "before" list is intersected over the builds: a rule of the patch holds in each.
 */
function compilePrerequisites(builds, { commit, quests, questPackSha256 }) {
  if (!Array.isArray(builds) || !builds.length || builds.length > MAX_BUILDS || !/^[a-f0-9]{40}$/.test(commit || "") || !quests || typeof quests !== "object" || !/^[a-f0-9]{64}$/.test(questPackSha256 || "")) fail();
  const before = new Map(), records = new Map(), dates = [];
  for (const { build, files } of builds) {
    if (!BUILD_RE.test(build)) fail();
    const j = JSON.parse(files["quest_prerequisites.json"]);
    if (j?.meta?.dataset !== "quest_prerequisites" || j.meta.clientBuild !== build || !j.quests || typeof j.quests !== "object") fail("Source metadata.");
    dates.push(j.meta.collectedOn.first, j.meta.collectedOn.last);
    const keys = Object.keys(j.quests);
    if (keys.length > MAX_ROWS) fail("Too many quests.");
    for (const key of keys) {
      const q = Number(key), v = j.quests[key];
      if (!id(q) || !v || !Array.isArray(v.before) || v.before.length > MAX_BEFORE || !Number.isSafeInteger(v.characters) || v.characters < 1 || v.characters > 100000) continue;
      const set = new Set(v.before.filter((x) => id(x) && x !== q));
      before.set(q, before.has(q) ? new Set([...before.get(q)].filter((x) => set.has(x))) : set);
      records.set(q, (records.get(q) || 0) + v.characters);
    }
  }
  const previous = new Map();
  for (const q of Object.values(quests)) if (id(q?.id) && id(q.nextQuestId) && q.nextQuestId !== q.id) { if (!previous.has(q.nextQuestId)) previous.set(q.nextQuestId, []); previous.get(q.nextQuestId).push(q.id); }
  const npcs = (questId, field) => new Set((quests[questId]?.[field] || []).filter((r) => r?.kind === "npc" && id(r.id)).map((r) => r.id));
  const needs = [], leadIns = [], seen = [];
  let unclear = 0;
  for (const q of [...before.keys()].sort((a, b) => a - b)) {
    const set = before.get(q), n = records.get(q), reported = (previous.get(q) || []).sort((a, b) => a - b);
    if (!quests[q]) continue;
    const held = reported.filter((x) => set.has(x));
    if (n >= NEED_RECORDS) {
      if (held.length) needs.push([q, held.slice(0, MAX_PER_QUEST), n]);
      else if (reported.length === 1) leadIns.push([reported[0], q, n]);
      else if (reported.length > 1) unclear++;
    }
    if (n >= SEEN_RECORDS) {
      // Drop what another member of the list already implies, then keep the hand-ins to this quest's giver.
      const givers = npcs(q, "givers");
      const direct = [...set].filter((x) => quests[x] && !reported.includes(x) && ![...set].some((y) => y !== x && before.get(y)?.has(x)) && [...npcs(x, "turnIns")].some((npc) => givers.has(npc))).sort((a, b) => a - b);
      if (direct.length && direct.length <= MAX_PER_QUEST) seen.push([q, direct, n]);
    }
  }
  return validatePrerequisites({
    schemaVersion: 1, kind: "forever-prerequisites", product: "wowf", build: builds[0].build, builds: builds.map((b) => b.build), sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION,
    collectedOn: { first: dates.sort()[0], last: dates.at(-1) }, questPackSha256,
    counts: { quests: before.size, needs: needs.length, leadIns: leadIns.length, seen: seen.length, unclear },
    needs, leadIns, seen,
  });
}
function validatePrerequisites(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-prerequisites" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(p.sourceCommit || "") || !/^[a-f0-9]{64}$/.test(p.questPackSha256 || "")) fail("Header.");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > MAX_BUILDS || p.builds[0] !== p.build || p.builds.some((b) => !BUILD_RE.test(b)) || new Set(p.builds).size !== p.builds.length) fail("Builds.");
  if (!/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.first || "") || !/^\d{4}-\d\d-\d\d$/.test(p.collectedOn?.last || "") || p.collectedOn.first > p.collectedOn.last) fail("Dates.");
  const records = (n, min) => Number.isSafeInteger(n) && n >= min && n <= 1600000;
  for (const [key, min] of [["needs", NEED_RECORDS], ["seen", SEEN_RECORDS]]) {
    if (!Array.isArray(p[key]) || p[key].length > MAX_ROWS) fail("Rows.");
    let last = 0;
    for (const row of p[key]) {
      if (!Array.isArray(row) || row.length !== 3 || !id(row[0]) || row[0] <= last || !Array.isArray(row[1]) || !row[1].length || row[1].length > MAX_PER_QUEST || row[1].some((x) => !id(x) || x === row[0]) || new Set(row[1]).size !== row[1].length || !records(row[2], min)) fail("Row.");
      last = row[0];
    }
  }
  if (!Array.isArray(p.leadIns) || p.leadIns.length > MAX_ROWS) fail("Rows.");
  const targets = new Set();
  for (const row of p.leadIns) { if (!Array.isArray(row) || row.length !== 3 || !id(row[0]) || !id(row[1]) || row[0] === row[1] || targets.has(row[1]) || !records(row[2], NEED_RECORDS)) fail("Lead-in."); targets.add(row[1]); }
  if (p.needs.some((row) => targets.has(row[0]))) fail("A quest cannot both need and not need its reported link.");
  const c = p.counts;
  if (!c || c.needs !== p.needs.length || c.leadIns !== p.leadIns.length || c.seen !== p.seen.length || !Number.isSafeInteger(c.quests) || c.quests < 0 || !Number.isSafeInteger(c.unclear) || c.unclear < 0) fail("Counts.");
  return p;
}
let cached = null;
function loadPrerequisites(file = path.join(__dirname, "../../data/forever-prerequisites/pack.json")) {
  const bundled = arguments.length === 0;
  if (bundled && cached) return cached;
  if (fs.statSync(file).size > PACK_LIMIT) fail("Pack too large.");
  const pack = validatePrerequisites(JSON.parse(fs.readFileSync(file)));
  if (bundled) cached = pack;
  return pack;
}
/** The bundled pack, or null when it is missing or broken: every caller works without it. */
function bundledPrerequisites() { try { return loadPrerequisites(); } catch { return null; } }

const indexes = new WeakMap();
/** needs: quest -> { ids, records }; seen: the same shape; leadIns: quest -> { id, records }. */
function prerequisiteIndex(pack) {
  if (!pack) return { needs: new Map(), seen: new Map(), leadIns: new Map() };
  if (indexes.has(pack)) return indexes.get(pack);
  const index = {
    needs: new Map(pack.needs.map(([q, ids, records]) => [q, { ids, records }])),
    seen: new Map(pack.seen.map(([q, ids, records]) => [q, { ids, records }])),
    leadIns: new Map(pack.leadIns.map(([x, q, records]) => [q, { id: x, records }])),
  };
  indexes.set(pack, index);
  return index;
}
/** The needed quests that are not in `done` (a Set of finished quest ids). Empty: nothing known to block. */
function missingPrerequisites(pack, questId, done) {
  const row = prerequisiteIndex(pack).needs.get(questId);
  return row ? row.ids.filter((x) => !done.has(x)) : [];
}
/** Is the reported link from -> to known to be optional (players took `to` without `from`)? */
function isLeadIn(pack, from, to) { return prerequisiteIndex(pack).leadIns.get(to)?.id === from; }
/**
 * Plain facts for one quest, for the quest guide. title: (id) => string | undefined.
 * done: Set of finished ids, or null when the saved history is not known.
 */
function prerequisiteFacts(pack, questId, { title = () => undefined, done = null } = {}) {
  const index = prerequisiteIndex(pack), out = [];
  const name = (x) => ({ id: x, title: title(x) || `Quest #${x}`, ...(done ? { done: done.has(x) } : {}) });
  const needs = index.needs.get(questId), seen = index.seen.get(questId), lead = index.leadIns.get(questId);
  if (needs) out.push({ kind: "needs", quests: needs.ids.map(name), records: needs.records });
  if (seen) out.push({ kind: "seen", quests: seen.ids.map(name), records: seen.records });
  if (lead) out.push({ kind: "leadIn", quests: [name(lead.id)], records: lead.records });
  return out;
}
module.exports = { FILES, ATTRIBUTION, RAW_LIMITS, PACK_LIMIT, NEED_RECORDS, SEEN_RECORDS, compilePrerequisites, validatePrerequisites, loadPrerequisites, bundledPrerequisites, prerequisiteIndex, missingPrerequisites, isLeadIn, prerequisiteFacts };

"use strict";
// Application code: MIT. Selected publisher observations: CC BY 4.0.
const fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto"), { isDeepStrictEqual } = require("node:util");
const BUILD = "1.60.1.70862", COMMIT = "23f9636486d3d60479dc0bcee2356053c33faf2c";
const REPOSITORY = "JIVESCORP/eg-link-output-wowf";
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const CHANGES = "Selected seven exact material-to-source relations; retained at most three valid historical standing points in original order per relation; omitted chances, yields, prices and world coordinates; preserved contexts and unknown requirements/current availability. No client code or assets included.";
const PACK_LIMIT = 128 * 1024;
// This reviewed source constant, never an editable adjacent checksum, authorizes bundled facts.
const PINNED_PACK = { bytes: 6051, sha256: "6447033020706c08abf1005f97a6fe86ac3ba081b72935a7781b185f978f940b" };
const LICENSE_PIN = { bytes: 18659, sha256: "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0" };
const RAW = [
  ["loot", 975413, "6409dd43e4d28ef7a43820147571cce76aea8b1b92823246872173cbd5d82dc6", 2097152],
  ["npcs", 499984, "aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded", 1048576],
  ["creatures", 797697, "f39ef280ce15d5162b2068e9deab438f1de0c3af0f19351a24e49d5deffa5ffc", 1048576],
  ["vendors", 240965, "8f9eebe8ef227deadbcef1eaad79aae4ca75e51240903db7fa2c25225ba1a5da", 1048576],
];
const SELECTORS = [
  [765, "object:1617|spell:2368", "Silverleaf"],
  [2447, "object:1618|spell:2368|bountifulHarvest:1", "Peacebloom"],
  [2449, "object:1619|spell:2368", "Earthroot"],
  [2770, "object:1731|spell:2576", "Copper Vein"],
  [2835, "object:1731|spell:2576", "Copper Vein"],
  [2589, "npc:11910|quest", "Grimtotem Ruffian"],
  [2320, "vendor:3005/item:2320", "Mahu"],
];
const LIMITATIONS = [
  "Historical approximate player-standing observations, never exact object spawns; current presence and availability remain unknown.",
  "Gathering rank, skill requirements, access, safety, stock and prices are unknown. Context is observed, not an inferred requirement.",
  "Seven selected relations are incomplete coverage; no observed source does not mean unobtainable. No fastest route or gatherability is established.",
  "Reference source names are publisher labels of unspecified locale; material display names require actual same-ID recipe/material observations.",
];
const fail = (reason = "invalid data") => { throw Error("Acquisition reference: " + reason + "."); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => isDeepStrictEqual(a, b);
const positive = (v, max = 2147483647) => Number.isSafeInteger(v) && v > 0 && v <= max;
const text = v => typeof v === "string" && v.trim().length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f<>]/.test(v);
const plain = v => !!v && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function record(v, names) {
  if (!plain(v) || Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) fail("unexpected fields");
}
function list(v, max, min = 0) {
  if (!Array.isArray(v) || v.length < min || v.length > max || Reflect.ownKeys(v).length !== v.length + 1) fail("array bounds");
  // Each element must survive defensive cloning; holes and unrelated keys are not evidence.
  for (let i = 0; i < v.length; i++) {
    const element = Object.getOwnPropertyDescriptor(v, String(i));
    if (!element?.enumerable || !Object.hasOwn(element, "value")) fail("array indices");
  }
}
function position(p) {
  record(p, ["mapId", "x", "y"]);
  if (!positive(p.mapId) || ![p.x, p.y].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) fail("position");
}
function dates(dataset) { return { first: dataset === "creatures" ? "2026-11-07" : "2026-11-09", last: "2026-11-09" }; }
function meta(dataset) {
  return {
    attribution: ATTRIBUTION, clientBuild: BUILD, collectedOn: dates(dataset),
    ...(dataset === "creatures" ? { combatLogUploads: 7 } : {}),
    dataset, license: "CC BY 4.0", product: "wowf", schemaVersion: 1, sources: 3,
  };
}
function descriptors() {
  return Object.fromEntries(RAW.map(([dataset, bytes, sha256, maxBytes]) => [`eg-${dataset}.json`, {
    bytes, sha256, maxBytes,
    url: `https://raw.githubusercontent.com/${REPOSITORY}/${COMMIT}/data/wowf/${BUILD}/${dataset}.json`,
    meta: meta(dataset),
  }]));
}
function sourceDates() { return Object.fromEntries(RAW.map(([dataset]) => [`eg-${dataset}.json`, dates(dataset)])); }
function sourceIdentity() {
  return { sourceRepository: REPOSITORY, sourceCommit: COMMIT, product: "wowf", clientBuild: BUILD, license: "CC BY 4.0", licenseUrl: LICENSE_URL, attribution: ATTRIBUTION };
}
function grammar(key) {
  const object = /^object:([1-9]\d*)\|spell:([1-9]\d*)(\|bountifulHarvest:1)?$/.exec(key);
  if (object) return { kind: "gathered-object-loot", entityId: Number(object[1]), gatherSpellId: Number(object[2]), context: object[3] ? ["bountifulHarvest:1"] : [] };
  const corpse = /^npc:([1-9]\d*)\|quest$/.exec(key);
  if (corpse) return { kind: "creature-corpse-loot", entityId: Number(corpse[1]), gatherSpellId: null, context: ["quest"] };
  const vendor = /^vendor:([1-9]\d*)\/item:([1-9]\d*)$/.exec(key);
  if (vendor) return { kind: "historical-vendor-listing", entityId: Number(vendor[1]), gatherSpellId: null, context: [] };
  fail("source grammar");
}
function reactions(v) {
  if (!plain(v) || Object.keys(v).some(k => !["Alliance", "Horde"].includes(k))) fail("reactions");
  for (const ns of Object.values(v)) {
    list(ns, 8); if (ns.some(n => !positive(n, 8)) || new Set(ns).size !== ns.length) fail("reactions");
  }
}
const ROW_FIELDS = ["itemId", "sourceKey", "kind", "entityId", "referenceName", "nameKind", "gatherSpellId", "requiredSkillLineId", "requiredRank", "positions", "positionCountInOriginal", "positionEvidence", "exactObjectPosition", "contributingFiles", "observedLootWindows", "context", "observedOn", "clientBuild", "observedReactionsByFaction", "reactionContributingFiles", "listingContributingFiles", "lastSeen", "limitedStock", "availableNow"];
/** Validate a bounded known-relation subset; loading separately authenticates canonical bytes. */
function validateAcquisitionPack(value) {
  record(value, ["schemaVersion", ...Object.keys(sourceIdentity()), "sourceDates", "changes", "counts", "rows"]);
  if (value.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(value)) > PACK_LIMIT) fail("pack bounds");
  for (const [k, v] of Object.entries(sourceIdentity())) if (value[k] !== v) fail("provenance");
  if (!same(value.sourceDates, sourceDates()) || value.changes !== CHANGES) fail("dates/change notice");
  record(value.counts, ["relations", "positions"]); list(value.rows, 64);
  const seen = new Set(); let points = 0;
  for (const r of value.rows) {
    record(r, ROW_FIELDS);
    const selected = SELECTORS.find(([item, key]) => item === r.itemId && key === r.sourceKey);
    if (!selected || !positive(r.itemId) || !positive(r.entityId) || seen.has(r.itemId + "/" + r.sourceKey)) fail("relation identity");
    seen.add(r.itemId + "/" + r.sourceKey);
    const expected = grammar(r.sourceKey), vendor = expected.kind === "historical-vendor-listing";
    if (Object.entries(expected).some(([k, v]) => !same(r[k], v)) || !text(r.referenceName) || r.referenceName !== selected[2] || r.nameKind !== "reference-source-name") fail("source/context identity");
    if (r.requiredSkillLineId !== null || r.requiredRank !== null || r.availableNow !== null || r.exactObjectPosition !== false || r.clientBuild !== BUILD || r.observedOn !== "2026-11-09") fail("unknowns/evidence date");
    if (r.positionEvidence !== (vendor ? "historical-player-standing-interaction-point" : "historical-player-standing-loot-point")) fail("position evidence");
    list(r.context, 2); list(r.positions, 16, 1);
    const pointSet = new Set();
    for (const p of r.positions) { position(p); const key = JSON.stringify([p.mapId, p.x, p.y]); if (pointSet.has(key)) fail("duplicate position"); pointSet.add(key); }
    points += r.positions.length;
    if (!positive(r.positionCountInOriginal, 100000) || r.positionCountInOriginal < r.positions.length || !positive(r.contributingFiles, 3)) fail("observation counts");
    reactions(r.observedReactionsByFaction);
    if (vendor) {
      if (!positive(r.reactionContributingFiles, 3) || !positive(r.listingContributingFiles, 3) || r.lastSeen !== "2026-11-09" || r.observedLootWindows !== null || ![null, true, false].includes(r.limitedStock)) fail("vendor evidence");
    } else if (!positive(r.observedLootWindows, 1000000) || r.observedLootWindows < r.contributingFiles || r.reactionContributingFiles !== null || r.listingContributingFiles !== null || r.lastSeen !== null || r.limitedStock !== null || Object.keys(r.observedReactionsByFaction).length) fail("loot evidence");
  }
  if (value.counts.relations !== value.rows.length || value.counts.positions !== points) fail("counts");
  return structuredClone(value);
}
/** Four exact original Buffers, no disk/network access and no mutable lock authority. */
function compileAcquisition(inputBuffers) {
  record(inputBuffers, RAW.map(([n]) => `eg-${n}.json`));
  let total = 0;
  // Authenticate every original before parsing any imported text.
  for (const [dataset, size, digest, max] of RAW) {
    const bytes = inputBuffers[`eg-${dataset}.json`];
    if (!Buffer.isBuffer(bytes) || bytes.length > max || (total += bytes.length) > 3145728 || bytes.length !== size || hash(bytes) !== digest) fail("source bytes/hash mismatch");
  }
  const raw = {};
  for (const [dataset] of RAW) {
    raw[dataset] = JSON.parse(inputBuffers[`eg-${dataset}.json`]);
    if (!same(raw[dataset].meta, meta(dataset))) fail("source metadata mismatch");
  }
  if (raw.loot.format !== 3) fail("loot format");
  const rows = SELECTORS.map(([itemId, sourceKey, referenceName]) => {
    const g = grammar(sourceKey), vendor = g.kind === "historical-vendor-listing";
    const source = vendor ? raw.vendors.vendors[g.entityId] : raw.loot.sources[sourceKey];
    const identity = vendor ? raw.npcs.npcs[g.entityId] : g.kind === "gathered-object-loot" ? raw.npcs.approached[g.entityId] : raw.creatures.creatures[g.entityId];
    const creature = raw.creatures.creatures[g.entityId];
    if (!plain(source) || identity?.name !== referenceName || !positive(source.sources, 3)) fail("exact source ID/name join");
    const listing = vendor ? source.entries?.[`item:${itemId}`] : null;
    if (vendor) {
      if (source.name !== referenceName || creature?.name !== referenceName || !identity.interactions?.includes("Merchant") || listing?.itemId !== itemId || !positive(listing.sources, 3)) fail("exact merchant/item join");
      reactions(creature.reactions);
    } else if (!Object.hasOwn(source.items || {}, String(itemId)) || !plain(source.items[itemId]) || !positive(source.windows, 1000000)) fail("exact item membership");
    list(source.positions, 10000);
    const valid = [], seen = new Set();
    for (const p of source.positions) {
      const point = { mapId: p?.uiMap, x: p?.mapX, y: p?.mapY };
      try { position(point); } catch { continue; }
      const key = JSON.stringify(point); if (!seen.has(key)) { valid.push(point); seen.add(key); }
    }
    if (!valid.length) fail("no historical points");
    return {
      itemId, sourceKey, kind: g.kind, entityId: g.entityId, referenceName, nameKind: "reference-source-name",
      gatherSpellId: g.gatherSpellId, requiredSkillLineId: null, requiredRank: null,
      positions: valid.slice(0, 3), positionCountInOriginal: source.positions.length,
      positionEvidence: vendor ? "historical-player-standing-interaction-point" : "historical-player-standing-loot-point",
      exactObjectPosition: false, contributingFiles: source.sources, observedLootWindows: vendor ? null : source.windows,
      context: g.context, observedOn: "2026-11-09", clientBuild: BUILD,
      observedReactionsByFaction: vendor ? structuredClone(creature.reactions) : {},
      reactionContributingFiles: vendor ? creature.sources : null, listingContributingFiles: vendor ? listing.sources : null,
      lastSeen: vendor ? source.lastSeen : null,
      limitedStock: vendor && Object.hasOwn(listing, "limited") ? listing.limited : null,
      availableNow: null,
    };
  });
  const counts = { relations: rows.length, positions: rows.reduce((n, r) => n + r.positions.length, 0) };
  if (counts.relations !== 7 || counts.positions !== 17) fail("canonical matrix");
  return validateAcquisitionPack({ schemaVersion: 1, ...sourceIdentity(), sourceDates: sourceDates(), changes: CHANGES, counts, rows });
}
function readBounded(directory, name, max) {
  const file = path.join(directory, name);
  if (fs.statSync(file).size > max) fail("resource bounds");
  const bytes = fs.readFileSync(file); if (bytes.length > max) fail("resource bounds"); return bytes;
}
/** Fixed public error contains no caller paths or imported content; no partial repair. */
function loadAcquisitionPack(directory = path.join(__dirname, "../../data/forever-acquisition")) {
  try {
    const bytes = readBounded(directory, "pack.json", PACK_LIMIT);
    if (bytes.length !== PINNED_PACK.bytes || hash(bytes) !== PINNED_PACK.sha256) fail("immutable compiled identity");
    const lock = JSON.parse(readBounded(directory, "source-lock.json", 32768));
    const expected = { schemaVersion: 1, ...sourceIdentity(), files: descriptors(), compiled: PINNED_PACK, licenseFile: LICENSE_PIN };
    if (!same(lock, expected)) fail("source lock");
    const license = readBounded(directory, "LICENSE", LICENSE_PIN.bytes);
    if (license.length !== LICENSE_PIN.bytes || hash(license) !== LICENSE_PIN.sha256) fail("license");
    const notice = readBounded(directory, "NOTICE.md", 8192).toString("utf8");
    if (![ATTRIBUTION, COMMIT, BUILD, LICENSE_URL, CHANGES, "Blizzard"].every(s => notice.includes(s))) fail("notice");
    return validateAcquisitionPack(JSON.parse(bytes));
  } catch { throw Error("Acquisition reference unavailable."); }
}
function requestedIds(itemIds) {
  list(itemIds, 1000);
  if (itemIds.some(n => !positive(n))) fail("requested item IDs");
  const ids = [...new Set(itemIds)]; if (ids.length > 40) fail("requested item limit"); return ids;
}
function qualification(profile, r) {
  if (profile?.source?.kind !== "wow-addon") return ["browse-only", "Historical browsing only: saved addon character evidence is required."];
  const timestamp = profile.source.updatedAt;
  const dated = typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    && Number.isFinite(Date.parse(timestamp)) && new Date(timestamp.slice(0, 10)).toISOString().slice(0, 10) === timestamp.slice(0, 10);
  if (!dated) return ["browse-only", "Historical browsing only: a dated saved addon observation is required."];
  if (profile.clientBuild !== BUILD) return ["browse-only", "Historical browsing only: saved character build mismatch or unavailable; reference build is " + BUILD + "."];
  if (r.kind === "historical-vendor-listing") {
    const faction = ["Alliance", "Horde"].includes(profile.faction) ? profile.faction : null;
    const ns = faction ? r.observedReactionsByFaction[faction] : null;
    if (!ns?.length) return ["browse-only", "Historical browsing only: faction access unknown; no compatible reaction observation."];
    if (!ns.every(n => n >= 4 && n <= 8)) return ["browse-only", "Historical browsing only: hostile or conflicting faction reaction observations; current access unknown."];
    if (new Set(r.positions.map(p => p.mapId)).size > 1) return ["browse-only", "Historical browsing only: interaction history spans multiple maps; current location/access unknown."];
  }
  return ["qualified-historical", "Matching-build historical place to look; current presence, requirements and access remain unknown."];
}
/** Public allowlist only; never copies a profile, provider context or material name. */
function acquisitionFacts(pack, profile, itemIds) {
  const ids = requestedIds(itemIds);
  let p;
  try { p = validateAcquisitionPack(pack); } catch {
    return { version: 1, status: "unavailable", reference: null, rows: ids.map(itemId => ({ itemId, status: "unavailable", reason: "Acquisition reference unavailable.", sources: [] })), limitations: [...LIMITATIONS] };
  }
  const rows = ids.map(itemId => {
    const sources = p.rows.filter(r => r.itemId === itemId).slice(0, 3).map(r => {
      const [qualified, reason] = qualification(profile, r);
      const source = {};
      for (const k of ROW_FIELDS) if (k !== "itemId") source[k] = structuredClone(r[k]);
      source.positions = source.positions.slice(0, 3);
      return { ...source, qualification: qualified, reason };
    });
    const status = sources.some(s => s.qualification === "qualified-historical") ? "qualified-historical" : sources.length ? "browse-only" : "unknown";
    return { itemId, status, reason: sources.length ? sources[0].reason : "No observed source in this reference; availability is unknown.", sources };
  });
  return {
    version: 1, status: "available",
    reference: { ...sourceIdentity(), sourceDates: structuredClone(p.sourceDates), changes: CHANGES },
    rows, limitations: [...LIMITATIONS],
  };
}
function luaValue(v) {
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v !== "object") return String(v);
  return "{" + Object.entries(v).map(([k, n]) => `[${Array.isArray(v) ? Number(k) + 1 : JSON.stringify(k)}]=${luaValue(n)}`).join(",") + "}";
}
function buildAddonAcquisition(pack) {
  const p = validateAcquisitionPack(pack);
  return `-- Generated offline acquisition reference; data only.\n-- ${ATTRIBUTION}\n-- ${LICENSE_URL}\n-- Source: https://github.com/${REPOSITORY}/tree/${COMMIT}; build ${BUILD}\n-- Changes: ${CHANGES}\n-- Blizzard underlying game content and assets are excluded from the compilation license.\nBackstageForeverAcquisition = ${luaValue(p)}\n`;
}
module.exports = { compileAcquisition, validateAcquisitionPack, loadAcquisitionPack, acquisitionFacts, buildAddonAcquisition };

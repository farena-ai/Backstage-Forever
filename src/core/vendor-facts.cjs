"use strict";
const fs = require("node:fs"), path = require("node:path");
const { ATTRIBUTION, observedBuild } = require("./knowledge.cjs");
const FILES = Object.freeze(["vendors.json", "npcs.json", "creatures.json"]);
const MAX_BYTES = 1024 * 1024;
const LISTING_KEY = /^item:[1-9]\d*(?:#(?:[2-9]|[1-9]\d+))?$/;
const LIMITATION = "Historical listings and approximate interaction points; current stock, price and access are unverified. No observation does not mean unobtainable.";
function invalid() { throw Error("Invalid historical seller data."); }
const plain = o => !!o && typeof o === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(o));
function keys(o, expected) { if (!plain(o) || Object.keys(o).length !== expected.length || Object.keys(o).some(k => !expected.includes(k))) invalid(); }
const integer = (v, max = 2147483647, min = 1) => Number.isSafeInteger(v) && v >= min && v <= max;
const text = v => typeof v === "string" && v.trim().length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
const date = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function dates(v) { keys(v, ["first", "last"]); if (!date(v.first) || !date(v.last) || v.first > v.last) invalid(); }
function position(v) { keys(v, ["mapId", "x", "y"]); if (!integer(v.mapId) || ![v.x, v.y].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) invalid(); }
function list(v, max) { if (!Array.isArray(v) || v.length > max || Object.keys(v).length !== v.length) invalid(); }
function reactions(v) {
  if (!plain(v) || Object.keys(v).some(k => !["Alliance", "Horde"].includes(k))) invalid();
  for (const values of Object.values(v)) { list(values, 8); if (values.some(n => !integer(n, 8)) || new Set(values).size !== values.length) invalid(); }
}
const byPosition = (a, b) => a.mapId - b.mapId || a.x - b.x || a.y - b.y;
const byKey = (a, b) => a.itemId - b.itemId || a.key.localeCompare(b.key, "en");
function identity(value) {
  if (value.product !== "wowf" || typeof value.build !== "string" || !/^1\.60\.1\.\d{1,8}$/.test(value.build) || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || value.license !== "CC BY 4.0" || value.attribution !== ATTRIBUTION) invalid();
}
/** Strict detached catalog; no network, game actions or inference. */
function validateVendorPack(value) {
  keys(value, ["schemaVersion", "product", "build", "sourceCommit", "license", "attribution", "collectedOn", "counts", "vendors"]);
  if (value.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) invalid();
  identity(value); dates(value.collectedOn);
  keys(value.counts, ["vendors", "listings", "droppedVendors", "droppedListings", "droppedPositions"]);
  for (const n of Object.values(value.counts)) if (!integer(n, 1000000, 0)) invalid();
  list(value.vendors, 1000);
  const ids = new Set(); let listings = 0;
  for (const v of value.vendors) {
    keys(v, ["id", "name", "lastSeen", "sources", "positions", "listings", "observedReactionsByFaction", "reactionSources"]);
    if (!integer(v.id) || ids.has(v.id) || !text(v.name) || !date(v.lastSeen) || v.lastSeen > value.collectedOn.last || !integer(v.sources, 1000000) || !integer(v.reactionSources, 1000000)) invalid();
    ids.add(v.id); list(v.positions, 100); if (!v.positions.length) invalid();
    const positions = new Set();
    for (const p of v.positions) { position(p); const key = JSON.stringify([p.mapId, p.x, p.y]); if (positions.has(key)) invalid(); positions.add(key); }
    reactions(v.observedReactionsByFaction); list(v.listings, 10000); if (!v.listings.length) invalid();
    const listingKeys = new Set();
    for (const row of v.listings) {
      keys(row, ["key", "itemId", "name", "sources"]);
      if (!integer(row.itemId) || !text(row.name) || !integer(row.sources, 1000000) || typeof row.key !== "string" || row.key.length > 80 || !LISTING_KEY.test(row.key) || Number(row.key.match(/^item:(\d+)/)[1]) !== row.itemId || listingKeys.has(row.key)) invalid();
      listingKeys.add(row.key); listings++;
    }
  }
  if (listings > 10000 || value.counts.vendors !== ids.size || value.counts.listings !== listings || value.counts.droppedVendors + ids.size > 1000 || value.counts.droppedListings + listings > 10000 || value.counts.droppedPositions > 100000) invalid();
  return structuredClone(value);
}
function parseInputs(inputs, build) {
  keys(inputs, FILES); const parsed = {}; let total = 0;
  for (const name of FILES) {
    const input = inputs[name], bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === "string" ? input : JSON.stringify(input));
    if (bytes.length > MAX_BYTES || (total += bytes.length) > 3 * MAX_BYTES) throw Error("Historical seller source exceeds bounded size limit.");
    const d = JSON.parse(bytes), m = d.meta;
    if (!plain(d) || !plain(m) || m.dataset !== name.split(".")[0] || m.product !== "wowf" || m.clientBuild !== build || m.schemaVersion !== 1 || m.license !== "CC BY 4.0" || m.attribution !== ATTRIBUTION || !integer(m.sources, 1000000) || m.locale !== undefined) invalid();
    dates(m.collectedOn); const records = d[name.split(".")[0]];
    if (!plain(records) || Object.keys(records).length > (name === "vendors.json" ? 1000 : 10000)) invalid();
    parsed[name] = d;
  }
  return parsed;
}
/** Join only the same numeric ID and exact observed name, with Merchant evidence. */
function normalizeVendors(inputs, { commit, build } = {}) {
  identity({ product: "wowf", build, sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION });
  const raw = parseInputs(inputs, build), vs = raw["vendors.json"], ns = raw["npcs.json"].npcs, cs = raw["creatures.json"].creatures;
  const counts = { vendors: 0, listings: 0, droppedVendors: 0, droppedListings: 0, droppedPositions: 0 }, vendors = [];
  let totalListings = 0;
  for (const [key, v] of Object.entries(vs.vendors).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const id = Number(key), n = ns[key], c = cs[key];
    if (!plain(v) || (v.entries !== undefined && !plain(v.entries)) || !Array.isArray(v.positions) || v.positions.length > 100) invalid();
    const entries = Object.entries(v.entries || {}); totalListings += entries.length; if (totalListings > 10000) invalid();
    if (!/^[1-9]\d*$/.test(key) || !integer(id) || !text(v.name) || !n || !c || n.name !== v.name || c.name !== v.name || !Array.isArray(n.interactions) || !n.interactions.includes("Merchant") || !date(v.lastSeen) || v.lastSeen > vs.meta.collectedOn.last || !integer(v.sources, vs.meta.sources) || !integer(c.sources, raw["creatures.json"].meta.sources)) {
      counts.droppedVendors++; counts.droppedListings += entries.length; continue;
    }
    const positions = [], seenPositions = new Set();
    for (const p of v.positions) {
      const pos = { mapId: p?.uiMap, x: p?.mapX, y: p?.mapY };
      try { position(pos); } catch { counts.droppedPositions++; continue; }
      const k = JSON.stringify(pos); if (!seenPositions.has(k)) { positions.push(pos); seenPositions.add(k); }
    }
    const listings = [];
    for (const [entryKey, e] of entries) {
      if (!plain(e) || !LISTING_KEY.test(entryKey) || entryKey.length > 80 || !integer(e.itemId) || Number(entryKey.match(/^item:(\d+)/)[1]) !== e.itemId || !text(e.name) || !integer(e.sources, vs.meta.sources)) { counts.droppedListings++; continue; }
      listings.push({ key: entryKey, itemId: e.itemId, name: e.name, sources: e.sources });
    }
    // Unknown faction observations remain absent. Malformed reaction evidence is never promoted.
    const observedReactionsByFaction = {};
    if (c.reactions !== undefined) {
      reactions(c.reactions);
      for (const faction of ["Alliance", "Horde"]) if (c.reactions[faction] !== undefined) observedReactionsByFaction[faction] = [...c.reactions[faction]].sort((a, b) => a - b);
    }
    if (!positions.length || !listings.length) { counts.droppedVendors++; counts.droppedListings += listings.length; continue; }
    vendors.push({ id, name: v.name, lastSeen: v.lastSeen, sources: v.sources, positions: positions.sort(byPosition), listings: listings.sort(byKey), observedReactionsByFaction, reactionSources: c.sources });
  }
  counts.vendors = vendors.length; counts.listings = vendors.reduce((n, v) => n + v.listings.length, 0);
  return validateVendorPack({ schemaVersion: 1, product: "wowf", build, sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION, collectedOn: structuredClone(vs.meta.collectedOn), counts, vendors });
}
function loadVendorPack(file = path.join(__dirname, "../../data/forever-vendors/pack.json")) {
  const size = fs.statSync(file).size; if (size > MAX_BYTES) throw Error("Historical seller pack exceeds 1 MiB.");
  const bytes = fs.readFileSync(file); if (bytes.length > MAX_BYTES) throw Error("Historical seller pack exceeds 1 MiB.");
  return validateVendorPack(JSON.parse(bytes));
}
function sellerFacts(pack, profile, itemIds) {
  const catalog = validateVendorPack(pack);
  if (!Array.isArray(itemIds)) invalid();
  const ids = [...new Set(itemIds)].slice(0, 20); if (ids.some(id => !integer(id))) invalid();
  const exact = Boolean(observedBuild(profile) && profile.clientBuild === catalog.build);
  const faction = ["Alliance", "Horde"].includes(profile?.faction) ? profile.faction : null;
  const rows = ids.map(itemId => {
    const matching = catalog.vendors.filter(v => v.listings.some(r => r.itemId === itemId));
    const options = matching.map(v => {
      const observed = faction ? v.observedReactionsByFaction[faction] : undefined;
      const nonhostile = Boolean(observed?.length && observed.every(n => n >= 4 && n <= 8));
      const mobile = new Set(v.positions.map(p => p.mapId)).size > 1;
      const suggested = exact && nonhostile && !mobile;
      const qualification = !exact ? "Historical reference only: saved addon character/build mismatch or unavailable."
        : mobile ? "Historical reference only: interaction history spans multiple maps; current location/access unknown."
        : !faction || !observed?.length ? "Historical reference only: faction access unknown; no compatible reaction observation."
        : !nonhostile ? "Historical reference only: conflicting or hostile reaction observations; current access unverified."
        : `Historical nonhostile reaction observed for ${faction}; current access unverified.`;
      return { ...v, listings: v.listings.filter(r => r.itemId === itemId), suggested, qualification, approximate: true };
    }).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.id - b.id).slice(0, 3);
    return { itemId, status: !matching.length ? "unobserved" : options.some(v => v.suggested) ? "historical-suggestions" : "browse-only", observedSellerCount: matching.length, suggestions: options.filter(v => v.suggested), browse: options.filter(v => !v.suggested) };
  });
  return structuredClone({ source: { publisher: "Efficient Games", build: catalog.build, sourceCommit: catalog.sourceCommit, license: catalog.license, attribution: catalog.attribution, collectedOn: catalog.collectedOn }, limitation: LIMITATION, rows });
}
module.exports = { FILES, MAX_BYTES, LIMITATION, normalizeVendors, validateVendorPack, loadVendorPack, sellerFacts };

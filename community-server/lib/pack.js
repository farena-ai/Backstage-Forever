"use strict";
// Builds the published community pack: only facts that at least `minInstalls`
// distinct installs agree on, with drop rates pooled across installs.
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { gridToFraction, COORD_STEPS } = require("./validate");

const PACK_FORMAT = 1;
// Additions old apps can ignore bump the minor; they are served only when asked for (?v=2).
const PACK_MINOR = 1;
// One install's evidence for a drop counts for at most this many loot windows,
// so a single heavy farmer cannot dominate the pooled rate.
const DROP_LOOT_CAP_PER_INSTALL = 500;

function ident(raw) {
  return raw[0] === "o" ? { objectId: Number(raw.slice(1)), name: null } : { objectId: null, name: raw.slice(1) };
}

function compareRows(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function aggregateDrops(rows, minInstalls) {
  const byKey = new Map();
  for (const r of rows) {
    let loots = Number(r.loots), hits = Math.min(Number(r.hits), loots);
    if (loots <= 0) continue; // no denominator from this install: ignore
    if (loots > DROP_LOOT_CAP_PER_INSTALL) {
      hits = hits * DROP_LOOT_CAP_PER_INSTALL / loots;
      loots = DROP_LOOT_CAP_PER_INSTALL;
    }
    const acc = byKey.get(r.key) || { installs: 0, hits: 0, loots: 0 };
    acc.installs += 1; acc.hits += hits; acc.loots += loots;
    byKey.set(r.key, acc);
  }
  const out = [];
  for (const [key, a] of byKey) {
    if (a.installs < minInstalls) continue;
    const [npcId, itemId] = key.split("|").map(Number);
    out.push([npcId, itemId, Number((a.hits / a.loots).toFixed(4)), Math.round(a.loots), a.installs]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

// variant 1: the shape every app since 0.34 validates (no "object" kind, no days, no names).
// variant 2 (GET /v1/pack?v=2, format 1 minor 1): adds firstSeen/lastSeen UTC days to nodes, npcs
// and vendors, nodes of kind "object", and the npcNames section. The k-anonymity rule is the same.
function buildPackData(store, minInstalls, variant = 1) {
  const v2 = variant === 2;
  const days = (r) => (v2 ? [r.first, r.last] : []);
  const nodes = store.published("node", minInstalls).map(r => {
    const [kind, id, mapId, x, y] = r.key.split("|");
    const { objectId, name } = ident(id);
    return [kind, objectId, name, Number(mapId), gridToFraction(Number(x)), gridToFraction(Number(y)), r.installs, ...days(r)];
  }).filter(r => v2 || r[0] !== "object");
  const nodeItems = store.published("nodeitem", minInstalls).map(r => {
    const [kind, id, itemId] = r.key.split("|");
    const { objectId, name } = ident(id);
    return [kind, objectId, name, Number(itemId), r.installs];
  }).filter(r => v2 || r[0] !== "object");
  const npcs = store.published("npc", minInstalls).map(r => {
    const [npcId, mapId, x, y] = r.key.split("|").map(Number);
    return [npcId, mapId, gridToFraction(x), gridToFraction(y), r.installs, ...days(r)];
  });
  const vendors = store.published("vendor", minInstalls).map(r => {
    const [npcId, itemId] = r.key.split("|").map(Number);
    return [npcId, itemId, r.installs, ...days(r)];
  });
  const recipes = store.published("recipe", minInstalls).map(r => {
    const [source, npcId, spellId, itemId] = r.key.split("|");
    return [source, Number(npcId), spellId ? Number(spellId) : null, itemId ? Number(itemId) : null, r.installs];
  });
  const drops = aggregateDrops(store.dropRows(minInstalls), minInstalls);
  // Deterministic order so identical data always produces the same ETag.
  for (const list of [nodes, nodeItems, npcs, vendors, recipes]) list.sort(compareRows);
  const seen = v2 ? ["firstSeen", "lastSeen"] : [];
  const data = {
    nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs", ...seen], rows: nodes },
    nodeItems: { columns: ["kind", "objectId", "name", "itemId", "installs"], rows: nodeItems },
    npcs: { columns: ["npcId", "mapId", "x", "y", "installs", ...seen], rows: npcs },
    vendors: { columns: ["npcId", "itemId", "installs", ...seen], rows: vendors },
    drops: { columns: ["npcId", "itemId", "rate", "samples", "installs"], rows: drops },
    recipes: { columns: ["source", "npcId", "spellId", "itemId", "installs"], rows: recipes },
  };
  if (v2) data.npcNames = { columns: ["npcId", "name", "installs"], rows: npcNames(store, minInstalls) };
  return data;
}

// One name per NPC id: the one most installs sent (at least minInstalls of them); ties go to the
// alphabetically first so the pack stays deterministic. A name fewer installs agree on never leaves.
function npcNames(store, minInstalls) {
  const best = new Map();
  for (const r of store.published("npcname", minInstalls)) {
    const cut = r.key.indexOf("|"), npcId = Number(r.key.slice(0, cut)), name = r.key.slice(cut + 1);
    const cur = best.get(npcId);
    if (!cur || r.installs > cur[2] || (r.installs === cur[2] && name < cur[1])) best.set(npcId, [npcId, name, r.installs]);
  }
  return [...best.values()].sort((a, b) => a[0] - b[0]);
}

// Caches the serialized packs (both variants) and rebuilds them lazily when the store revision
// changes, at most once per `rebuildMs`.
class PackCache {
  constructor(store, { minInstalls = 3, rebuildMs = 300000, now = () => Date.now() } = {}) {
    this.store = store; this.minInstalls = minInstalls; this.rebuildMs = rebuildMs; this.now = now;
    this.variants = {}; this.current = null; this.builtRevision = -1; this.builtAt = 0;
  }

  get(variant = 1) {
    const rev = this.store.revision();
    if (!this.current || (rev !== this.builtRevision && this.now() - this.builtAt >= this.rebuildMs)) this.rebuild(rev);
    return this.variants[variant === 2 ? 2 : 1];
  }

  // Returns the variant 1 pack (also kept as `current`).
  rebuild(rev = this.store.revision()) {
    const at = this.now();
    for (const variant of [1, 2]) this.variants[variant] = this.serialize(variant, this.variants[variant], at);
    this.current = this.variants[1];
    this.builtRevision = rev; this.builtAt = at;
    return this.current;
  }

  serialize(variant, previous, at) {
    const data = buildPackData(this.store, this.minInstalls, variant);
    const version = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 20);
    // generatedAt only moves when the published content actually changes.
    const generatedAt = previous && previous.version === version ? previous.generatedAt : new Date(at).toISOString();
    const pack = {
      format: PACK_FORMAT, ...(variant === 2 ? { minor: PACK_MINOR } : {}), version, generatedAt,
      minInstalls: this.minInstalls, coordStep: 1 / COORD_STEPS,
      ...data,
    };
    const body = Buffer.from(JSON.stringify(pack));
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.rows.length]));
    return { version, generatedAt, etag: `"${version}"`, body, gzip: zlib.gzipSync(body, { level: 9 }), counts };
  }
}

module.exports = { PackCache, buildPackData, aggregateDrops, PACK_FORMAT, PACK_MINOR, DROP_LOOT_CAP_PER_INSTALL };

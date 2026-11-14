"use strict";
// Builds the published community pack: only facts that at least `minInstalls`
// distinct installs agree on, with drop rates pooled across installs.
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { gridToFraction, COORD_STEPS } = require("./validate");

const PACK_FORMAT = 1;
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

function buildPackData(store, minInstalls) {
  const nodes = store.published("node", minInstalls).map(r => {
    const [kind, id, mapId, x, y] = r.key.split("|");
    const { objectId, name } = ident(id);
    return [kind, objectId, name, Number(mapId), gridToFraction(Number(x)), gridToFraction(Number(y)), r.installs];
  });
  const nodeItems = store.published("nodeitem", minInstalls).map(r => {
    const [kind, id, itemId] = r.key.split("|");
    const { objectId, name } = ident(id);
    return [kind, objectId, name, Number(itemId), r.installs];
  });
  const npcs = store.published("npc", minInstalls).map(r => {
    const [npcId, mapId, x, y] = r.key.split("|").map(Number);
    return [npcId, mapId, gridToFraction(x), gridToFraction(y), r.installs];
  });
  const vendors = store.published("vendor", minInstalls).map(r => {
    const [npcId, itemId] = r.key.split("|").map(Number);
    return [npcId, itemId, r.installs];
  });
  const recipes = store.published("recipe", minInstalls).map(r => {
    const [source, npcId, spellId, itemId] = r.key.split("|");
    return [source, Number(npcId), spellId ? Number(spellId) : null, itemId ? Number(itemId) : null, r.installs];
  });
  const drops = aggregateDrops(store.dropRows(minInstalls), minInstalls);
  // Deterministic order so identical data always produces the same ETag.
  for (const list of [nodes, nodeItems, npcs, vendors, recipes]) list.sort(compareRows);
  return {
    nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y", "installs"], rows: nodes },
    nodeItems: { columns: ["kind", "objectId", "name", "itemId", "installs"], rows: nodeItems },
    npcs: { columns: ["npcId", "mapId", "x", "y", "installs"], rows: npcs },
    vendors: { columns: ["npcId", "itemId", "installs"], rows: vendors },
    drops: { columns: ["npcId", "itemId", "rate", "samples", "installs"], rows: drops },
    recipes: { columns: ["source", "npcId", "spellId", "itemId", "installs"], rows: recipes },
  };
}

// Caches the serialized pack and rebuilds it lazily when the store revision
// changes, at most once per `rebuildMs`.
class PackCache {
  constructor(store, { minInstalls = 3, rebuildMs = 300000, now = () => Date.now() } = {}) {
    this.store = store; this.minInstalls = minInstalls; this.rebuildMs = rebuildMs; this.now = now;
    this.current = null; this.builtRevision = -1; this.builtAt = 0;
  }

  get() {
    const rev = this.store.revision();
    if (!this.current || (rev !== this.builtRevision && this.now() - this.builtAt >= this.rebuildMs)) this.rebuild(rev);
    return this.current;
  }

  rebuild(rev = this.store.revision()) {
    const data = buildPackData(this.store, this.minInstalls);
    const version = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 20);
    const at = this.now();
    // generatedAt only moves when the published content actually changes.
    const generatedAt = this.current && this.current.version === version ? this.current.generatedAt : new Date(at).toISOString();
    const pack = {
      format: PACK_FORMAT, version, generatedAt,
      minInstalls: this.minInstalls, coordStep: 1 / COORD_STEPS,
      ...data,
    };
    const body = Buffer.from(JSON.stringify(pack));
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.rows.length]));
    this.current = {
      version, generatedAt, etag: `"${version}"`, body,
      gzip: zlib.gzipSync(body, { level: 9 }),
      counts,
    };
    this.builtRevision = rev; this.builtAt = at;
    return this.current;
  }
}

module.exports = { PackCache, buildPackData, aggregateDrops, PACK_FORMAT, DROP_LOOT_CAP_PER_INSTALL };

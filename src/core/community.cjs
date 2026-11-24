"use strict";
// Community sharing (0.34): anonymous gathering spots, creature positions and vendor wares this
// player's own addon observed go to the Backstage community service
// (community-server/CLIENT-CONTRACT.md), and a daily community pack comes back for the World Map,
// NPC cards and the loot browser.
//
// Privacy: only the fields the contract allows ever leave the computer. No character, account,
// realm or guild names, no GUIDs, chat or times; coordinates are rounded to 0.5% of the map. The
// only names sent are the ones the game itself shows for an NPC or a node, never anything typed. The install id is a random
// UUID kept in the app data folder, unrelated to the account, machine or character.
// Everything fails quietly: an unreachable service only delays the next attempt.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), os = require("node:os");
const { atomic } = require("./store.cjs");

const BASE_URL = "https://bf.backstagecoding.com";
const SUBMIT_EVERY = 30 * 60 * 1000, SUBMIT_MIN_GAP = 10 * 60 * 1000, START_DELAY = 60 * 1000;
const PACK_EVERY = 24 * 60 * 60 * 1000, PACK_CHECK = 60 * 60 * 1000;
// Waits double after each failed try, up to an hour, so an outage (or a new address) recovers on its own soon.
const BACKOFF_MIN = 60 * 1000, BACKOFF_MAX = 60 * 60 * 1000;
const MAX_ENTRIES = 500, MAX_FACTS = 5000, MAX_BODY = 256 * 1024, BATCHES_PER_TICK = 3;
const MAX_SENT = 60000, MAX_PACK_BYTES = 8 * 1024 * 1024, MAX_RESPONSE = 64 * 1024, MAX_LOG_BYTES = 65536;
const TIMEOUT = 20000;
const PACK_LIMITS = Object.freeze({ nodes: 100000, nodeItems: 200000, npcs: 100000, vendors: 200000, drops: 200000, recipes: 50000, npcNames: 100000 });
// "From you": the list of this install's own contributions is asked for at most this often, and
// again soon after something new was shared.
const MINE_EVERY = 6 * 60 * 60 * 1000, MINE_MIN_GAP = 10 * 60 * 1000, MAX_MINE = 6000, MAX_MINE_BYTES = 1024 * 1024;
const NODE_KINDS = Object.freeze(["herb", "ore", "chest", "object"]);
const REPORT_CATEGORIES = Object.freeze(["bug", "data", "crash", "suggestion", "other"]);
const KIND = Object.freeze({ herbalism: "herb", mining: "ore", chest: "chest" });
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/, VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME_RE = /^[\p{L}\p{M}\p{N} '’.,:()&!-]{1,120}$/u;
// An NPC name as the game shows it: the same characters, at most 80.
const NPC_NAME_RE = /^[\p{L}\p{M}\p{N} '’.,:()&!-]{1,80}$/u;
// Control characters other than tab/newline, plus bidi overrides and isolates: the server rejects them.
const UNSAFE_TEXT = /[\x00-\x08\x0b-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]/g;

const isId = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
const isFrac = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
/** Snap a map fraction to 0.5% of the map, as the contract requires, so exact spots never leave. */
const round = (v) => Math.min(1, Math.max(0, Math.round(v * 200) / 200));
const short = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Override for tests and staging (BF_COMMUNITY_URL). Plain http is accepted only for this machine. */
function resolveBaseUrl(env = process.env) {
  const raw = env?.BF_COMMUNITY_URL;
  if (typeof raw !== "string" || !raw.trim()) return BASE_URL;
  try {
    const u = new URL(raw.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || !(u.protocol === "https:" || (u.protocol === "http:" && local))) return BASE_URL;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch { return BASE_URL; }
}

// ---------------------------------------------------------------- observations
const utcDay = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);
/** The name the game showed, cleaned to what the contract allows, or null. Never anything a player typed. */
function gameName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return NPC_NAME_RE.test(name) ? name : null;
}
/**
 * What this computer can share, from saved addon characters only. Each item carries its local dedupe
 * keys (never sent), the client build it was seen on, the contract entry and how many stored facts it
 * expands to.
 *  - nodes: gathering records (herbalism/mining/chest) with the items gathered there; with
 *    `extended`, also other game objects the player looted a quest item from (kind "object").
 *  - npcs: where the player looted a creature (lootSources positions of kind "creature").
 *  - vendors: the NPC id and the item ids on sale, from vendor windows the player opened (wares block),
 *    and where the player stood then, as an npcs entry (so the vendor can be placed on the map).
 * `extended` (the service speaks pack format minor 1) also adds the NPC name exactly as the game showed
 * it, on English (enUS) game clients only, once per NPC.
 * `refreshFrom`: something seen again after that moment gets a second key holding its UTC day, so it is
 * sent once more and the service can tell that the spot is still there. The day itself is not sent.
 * Drops and recipes are not collected: the addon counts quest items looted, not loot windows opened, so
 * there is no honest denominator for a drop rate, and it records no trainer or recipe listings.
 */
function collectObservations(profiles, { extended = false, refreshFrom = null } = {}) {
  const out = [], seen = new Set(), named = new Set();
  const push = (item) => { if (!seen.has(item.key)) { seen.add(item.key); item.keys = [item.key, ...(item.extra || [])]; delete item.extra; out.push(item); } };
  const again = (key, at) => (refreshFrom !== null && Number.isFinite(at) && at >= refreshFrom ? [`${key}@${utcDay(at)}`] : []);
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (p?.source?.kind !== "wow-addon") continue;
    const profileBuild = typeof p.clientBuild === "string" && BUILD_RE.test(p.clientBuild) ? p.clientBuild : null;
    const names = extended && p.locale === "enUS";
    // One entry per NPC carries its name; the others would only repeat it.
    const nameOf = (npcId, value) => { const name = names && !named.has(npcId) ? gameName(value) : null; if (name) named.add(npcId); return name; };
    for (const r of p.gathering?.records || []) {
      const kind = KIND[r?.method];
      if (!kind || !isId(r.entityId) || !isId(r.mapId) || !isFrac(r.x) || !isFrac(r.y)) continue;
      const x = round(r.x), y = round(r.y);
      const itemIds = [...new Set((Array.isArray(r.itemIds) ? r.itemIds : []).filter(isId))].sort((a, b) => a - b).slice(0, 16);
      const entry = { kind, objectId: r.entityId, mapId: r.mapId, x, y, ...(itemIds.length ? { itemIds } : {}) };
      const build = typeof r.clientBuild === "string" && BUILD_RE.test(r.clientBuild) ? r.clientBuild : profileBuild;
      const key = `n:${kind}:${r.entityId}:${r.mapId}:${x}:${y}:${itemIds.join(",")}`;
      push({ key, extra: again(key, Date.parse(r.observedAt)), build, category: "nodes", entry, facts: 1 + itemIds.length });
    }
    const objects = new Map();
    for (const item of p.lootSources?.items || []) for (const s of item?.sources || []) {
      if (!isId(s?.id)) continue;
      const seenAt = Date.parse(s.lastSeen);
      if (s.kind === "object") {
        if (!extended || !isId(item.itemId)) continue;
        for (const pos of s.positions || []) {
          if (!isId(pos?.mapId) || !isFrac(pos.x) || !isFrac(pos.y)) continue;
          const x = round(pos.x), y = round(pos.y), k = `${s.id}:${pos.mapId}:${x}:${y}`;
          if (!objects.has(k)) objects.set(k, { objectId: s.id, mapId: pos.mapId, x, y, items: new Set() });
          objects.get(k).items.add(item.itemId);
        }
        continue;
      }
      if (s.kind !== "creature") continue;
      for (const [i, pos] of (s.positions || []).entries()) {
        if (!isId(pos?.mapId) || !isFrac(pos.x) || !isFrac(pos.y)) continue;
        const x = round(pos.x), y = round(pos.y), key = `p:${s.id}:${pos.mapId}:${x}:${y}`;
        if (seen.has(key)) continue;
        const name = nameOf(s.id, s.name);
        // Only the newest position (the first) is known to be as recent as the source's last sighting.
        push({ key, extra: [...(i === 0 ? again(key, seenAt) : []), ...(name ? [`N:${s.id}:${name}`] : [])], build: profileBuild, category: "npcs", entry: { npcId: s.id, mapId: pos.mapId, x, y, ...(name ? { name } : {}) }, facts: name ? 2 : 1 });
      }
    }
    for (const o of objects.values()) {
      const itemIds = [...o.items].sort((a, b) => a - b).slice(0, 16);
      push({ key: `n:object:${o.objectId}:${o.mapId}:${o.x}:${o.y}:${itemIds.join(",")}`, build: profileBuild, category: "nodes", entry: { kind: "object", objectId: o.objectId, mapId: o.mapId, x: o.x, y: o.y, itemIds }, facts: 1 + itemIds.length });
    }
    for (const v of p.wares?.vendors || []) {
      if (!isId(v?.npcId) || !Array.isArray(v.itemIds)) continue;
      const itemIds = [...new Set(v.itemIds.filter(isId))].sort((a, b) => a - b).slice(0, 200);
      if (!itemIds.length) continue;
      const key = `v:${v.npcId}:${itemIds.join(",")}`;
      if (seen.has(key)) continue;
      const name = nameOf(v.npcId, v.name);
      push({ key, extra: [...again(key, v.seenAt * 1000), ...(name ? [`N:${v.npcId}:${name}`] : [])], build: profileBuild, category: "vendors", entry: { npcId: v.npcId, itemIds, ...(name ? { name } : {}) }, facts: itemIds.length + (name ? 1 : 0) });
      if (isId(v.mapId) && isFrac(v.x) && isFrac(v.y)) {
        const x = round(v.x), y = round(v.y), place = `p:${v.npcId}:${v.mapId}:${x}:${y}`;
        push({ key: place, extra: again(place, v.seenAt * 1000), build: profileBuild, category: "npcs", entry: { npcId: v.npcId, mapId: v.mapId, x, y }, facts: 1 });
      }
    }
  }
  return out;
}
/** Group by client build, then split within the contract's entry and fact limits. */
function planBatches(items, { maxEntries = MAX_ENTRIES, maxFacts = MAX_FACTS } = {}) {
  const byBuild = new Map();
  for (const it of items) { const k = it.build || ""; if (!byBuild.has(k)) byBuild.set(k, []); byBuild.get(k).push(it); }
  const batches = [];
  for (const [build, list] of byBuild) {
    let cur = [], facts = 0;
    for (const it of list) {
      if (cur.length && (cur.length >= maxEntries || facts + it.facts > maxFacts)) { batches.push({ build: build || null, items: cur }); cur = []; facts = 0; }
      cur.push(it); facts += it.facts;
    }
    if (cur.length) batches.push({ build: build || null, items: cur });
  }
  return batches;
}
/** The exact request body: schema, installId, optional build/appVersion, observations. Nothing else. */
function submitBody({ installId, appVersion, batch }) {
  const observations = {};
  for (const it of batch.items) (observations[it.category] ||= []).push(it.entry);
  return {
    schema: 1, installId,
    ...(batch.build && BUILD_RE.test(batch.build) ? { build: batch.build } : {}),
    ...(typeof appVersion === "string" && VERSION_RE.test(appVersion) ? { appVersion } : {}),
    observations,
  };
}

// ---------------------------------------------------------------- pack
function packFail(why) { throw Error(`Invalid community pack: ${why}.`); }
const SECTIONS = Object.freeze({
  nodes: { kind: "kind", objectId: "idn", name: "namen", mapId: "id", x: "frac", y: "frac", installs: "count" },
  nodeItems: { kind: "kind", objectId: "idn", name: "namen", itemId: "id", installs: "count" },
  npcs: { npcId: "id", mapId: "id", x: "frac", y: "frac", installs: "count" },
  vendors: { npcId: "id", itemId: "id", installs: "count" },
  drops: { npcId: "id", itemId: "id", rate: "rate", samples: "count", installs: "count" },
  recipes: { source: "source", npcId: "id", spellId: "idn", itemId: "idn", installs: "count" },
  // Pack format minor 1 (asked for with ?v=2): names the game showed, agreed on by at least minInstalls installs.
  npcNames: { npcId: "id", name: "npcname", installs: "count" },
});
// Minor 1: the first and last UTC day a fact was reported. Both columns or neither.
const SEEN_DAYS = Object.freeze(["nodes", "npcs", "vendors"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v) => typeof v === "string" && DAY_RE.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const CHECK = {
  kind: (v) => NODE_KINDS.includes(v),
  id: isId, idn: (v) => v === null || isId(v),
  namen: (v) => v === null || (typeof v === "string" && NAME_RE.test(v)),
  npcname: (v) => typeof v === "string" && NPC_NAME_RE.test(v),
  frac: isFrac, rate: isFrac,
  count: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 100000000,
  source: (v) => v === "trainer" || v === "vendor",
};
/** Strict validation of an untrusted pack. Returns compact rows by section; throws on anything off. */
function validatePack(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) packFail("not an object");
  if (value.format !== 1) packFail("format");
  if (value.minor !== undefined && !(Number.isSafeInteger(value.minor) && value.minor >= 0 && value.minor <= 1000)) packFail("minor");
  if (typeof value.version !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value.version)) packFail("version");
  if (typeof value.generatedAt !== "string" || value.generatedAt.length > 40 || !Number.isFinite(Date.parse(value.generatedAt))) packFail("generatedAt");
  if (!Number.isSafeInteger(value.minInstalls) || value.minInstalls < 1 || value.minInstalls > 1000) packFail("minInstalls");
  const out = { format: 1, minor: value.minor || 0, version: value.version, generatedAt: value.generatedAt, minInstalls: value.minInstalls };
  for (const [name, spec] of Object.entries(SECTIONS)) {
    const sec = value[name];
    if (sec === undefined) { out[name] = []; continue; }
    if (!sec || typeof sec !== "object" || !Array.isArray(sec.columns) || !Array.isArray(sec.rows) || sec.columns.length > 32) packFail(name);
    if (sec.rows.length > PACK_LIMITS[name]) packFail(`${name} too large`);
    const at = {};
    for (const col of Object.keys(spec)) { at[col] = sec.columns.indexOf(col); if (at[col] < 0) packFail(`${name}.${col} missing`); }
    const first = SEEN_DAYS.includes(name) ? sec.columns.indexOf("firstSeen") : -1, last = SEEN_DAYS.includes(name) ? sec.columns.indexOf("lastSeen") : -1;
    if ((first < 0) !== (last < 0)) packFail(`${name} seen days`);
    const ids = name === "npcNames" ? new Set() : null;
    out[name] = sec.rows.map((row, i) => {
      if (!Array.isArray(row) || row.length !== sec.columns.length) packFail(`${name}[${i}]`);
      const o = {};
      for (const [col, type] of Object.entries(spec)) {
        const v = row[at[col]];
        if (!CHECK[type](v)) packFail(`${name}[${i}].${col}`);
        o[col] = v;
      }
      if (first >= 0) {
        if (!isDay(row[first]) || !isDay(row[last]) || row[first] > row[last]) packFail(`${name}[${i}] seen days`);
        o.firstSeen = row[first]; o.lastSeen = row[last];
      }
      if ((name === "nodes" || name === "nodeItems") && (o.objectId === null) === (o.name === null)) packFail(`${name}[${i}] identity`);
      if (name === "recipes" && o.spellId === null && o.itemId === null) packFail(`${name}[${i}] identity`);
      if (ids) { if (ids.has(o.npcId)) packFail(`${name}[${i}] duplicate`); ids.add(o.npcId); }
      return o;
    });
  }
  return out;
}
const counts = (p) => Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, p?.[k]?.length || 0]));
const seen = (r) => (r.lastSeen ? { firstSeen: r.firstSeen, lastSeen: r.lastSeen } : {});
/** Lookup tables for the World Map, NPC cards and the loot browser. */
function indexPack(pack) {
  if (!pack) return null;
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const nodeKey = (r) => `${r.kind}:${r.objectId ?? "n:" + r.name}`;
  const items = new Map();
  for (const r of pack.nodeItems) push(items, nodeKey(r), { itemId: r.itemId, installs: r.installs });
  const nodesByMap = new Map(), npcPositions = new Map(), vendors = new Map(), drops = new Map(), dropsByItem = new Map(), recipes = new Map(), npcNames = new Map();
  for (const r of pack.nodes) push(nodesByMap, r.mapId, { kind: r.kind, objectId: r.objectId, name: r.name, x: r.x, y: r.y, installs: r.installs, ...seen(r), items: (items.get(nodeKey(r)) || []).slice(0, 16) });
  for (const r of pack.npcs) push(npcPositions, r.npcId, { mapId: r.mapId, x: r.x, y: r.y, installs: r.installs, ...seen(r) });
  for (const r of pack.vendors) push(vendors, r.npcId, { itemId: r.itemId, installs: r.installs, ...seen(r) });
  for (const r of pack.drops) { push(drops, r.npcId, { itemId: r.itemId, rate: r.rate, samples: r.samples, installs: r.installs }); push(dropsByItem, r.itemId, { npcId: r.npcId, rate: r.rate, samples: r.samples, installs: r.installs }); }
  for (const r of pack.recipes) push(recipes, r.npcId, { source: r.source, spellId: r.spellId, itemId: r.itemId, installs: r.installs });
  for (const r of pack.npcNames || []) npcNames.set(r.npcId, { name: r.name, installs: r.installs });
  for (const m of [npcPositions, vendors]) for (const list of m.values()) list.sort((a, b) => b.installs - a.installs);
  for (const m of [drops, dropsByItem]) for (const list of m.values()) list.sort((a, b) => b.rate - a.rate);
  // Whether rows say when they were last seen (pack format minor 1). Older packs have one date for everything.
  const perFactDates = [pack.nodes, pack.npcs, pack.vendors].some((list) => list.some((r) => r.lastSeen));
  return { version: pack.version, generatedAt: pack.generatedAt, minor: pack.minor || 0, perFactDates, nodesByMap, npcPositions, vendors, drops, dropsByItem, recipes, npcNames };
}
/** "Community · N players": provenance shown everywhere community data appears. */
const provenance = (installs) => `Community · ${installs} player${installs === 1 ? "" : "s"}`;
/** Whole UTC days between a "YYYY-MM-DD" day and now (0 = today), or null when the day is missing or bad. A day in the future counts as today. */
function daysSince(day, now = Date.now()) {
  if (!isDay(day)) return null;
  return Math.max(0, Math.floor((Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000));
}

// ---------------------------------------------------------------- mine
/** Strict check of a POST /v1/mine answer -> { total, truncated, keys: [strings] }, or a throw. */
function validateMine(value) {
  const bad = () => { throw Error("Invalid contributions list."); };
  if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true || !value.keys || typeof value.keys !== "object") bad();
  const rows = (name, cols) => {
    const sec = value.keys[name];
    if (sec === undefined) return [];
    if (!sec || !Array.isArray(sec.columns) || !Array.isArray(sec.rows) || sec.columns.length > 16 || sec.rows.length > MAX_MINE) bad();
    const at = cols.map((c) => sec.columns.indexOf(c));
    if (at.some((i) => i < 0)) bad();
    return sec.rows.map((row) => { if (!Array.isArray(row) || row.length !== sec.columns.length) bad(); return at.map((i) => row[i]); });
  };
  const keys = [];
  for (const [kind, objectId, name, mapId, x, y] of rows("nodes", ["kind", "objectId", "name", "mapId", "x", "y"])) {
    if (!CHECK.kind(kind) || !CHECK.idn(objectId) || !CHECK.namen(name) || (objectId === null) === (name === null) || !isId(mapId) || !isFrac(x) || !isFrac(y)) bad();
    keys.push(mineKey.node(kind, objectId, name, mapId, x, y));
  }
  for (const [npcId, mapId, x, y] of rows("npcs", ["npcId", "mapId", "x", "y"])) {
    if (!isId(npcId) || !isId(mapId) || !isFrac(x) || !isFrac(y)) bad();
    keys.push(mineKey.npc(npcId, mapId, x, y));
  }
  for (const [npcId, itemId] of rows("vendors", ["npcId", "itemId"])) {
    if (!isId(npcId) || !isId(itemId)) bad();
    keys.push(mineKey.vendor(npcId, itemId));
  }
  if (keys.length > MAX_MINE) bad();
  return { total: Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : keys.length, truncated: value.truncated === true, keys };
}
/** How a contributed fact is named locally, for the "from you" marks. */
const mineKey = Object.freeze({
  node: (kind, objectId, name, mapId, x, y) => `${kind}:${objectId ?? "n:" + name}:${mapId}:${x}:${y}`,
  npc: (npcId, mapId, x, y) => `npc:${npcId}:${mapId}:${x}:${y}`,
  vendor: (npcId, itemId) => `vendor:${npcId}:${itemId}`,
});

// ---------------------------------------------------------------- report log
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Remove the Windows user name, home folder, local paths and email-looking strings from a log. */
function redactLog(text, { home = os.homedir(), username = (() => { try { return os.userInfo().username; } catch { return ""; } })() } = {}) {
  let s = String(text ?? "").replace(/\r\n?/g, "\n").replace(UNSAFE_TEXT, "");
  for (const h of [home, home && home.replace(/\\/g, "/")].filter((h) => typeof h === "string" && h.length > 3)) s = s.replace(new RegExp(escapeRe(h), "gi"), "~");
  s = s.replace(/\b[A-Za-z]:[\\/][^\s"'<>|]*/g, "<path>").replace(/\\\\[^\s"'<>|]+/g, "<path>").replace(/(^|[\s"'(=])\/(?:Users|home|var|tmp|mnt|opt|private)\/[^\s"'<>|]*/g, "$1<path>");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  if (typeof username === "string" && username.trim().length >= 2) s = s.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRe(username.trim())}(?=$|[^A-Za-z0-9])`, "gi"), "$1<user>");
  return capBytes(s, MAX_LOG_BYTES);
}
/** Keep the newest lines within the byte cap. */
function capBytes(s, max) {
  if (Buffer.byteLength(s, "utf8") <= max) return s;
  const buf = Buffer.from(s, "utf8").subarray(-max).toString("utf8").replace(/^�+/, "");
  const nl = buf.indexOf("\n");
  return nl >= 0 && nl < buf.length - 1 ? buf.slice(nl + 1) : buf;
}

// ---------------------------------------------------------------- service
function friendly(code) {
  return {
    offline: "The community service could not be reached. Try again later.",
    blocked: "This install can no longer share with the community service.",
    rate: "Too many requests right now. Try again in a little while.",
    inbox: "The report inbox is full right now. Try again later.",
    invalid: "The community service did not accept this request.",
  }[code] || "The community service could not be reached. Try again later.";
}
class CommunityError extends Error { constructor(code, message) { super(message || friendly(code)); this.name = "CommunityError"; this.code = code; } }

class CommunityService {
  constructor({ dir, getProfiles = () => [], appVersion = "", fetch = globalThis.fetch, now = Date.now, baseUrl = resolveBaseUrl(), randomUUID = () => crypto.randomUUID(), timers = { setTimeout, clearTimeout, setInterval, clearInterval }, getSupportText = () => "", redact = redactLog } = {}) {
    Object.assign(this, { getProfiles, appVersion, fetch, now, baseUrl, randomUUID, timers, getSupportText, redact });
    this.dir = dir ? path.join(dir, "community") : null;
    this.lines = [];
    this.preview = null;
    this.handles = [];
    this.busy = { submit: false, pack: false, mine: false };
    this.settings = this.readSettings();
    this.sent = this.readSent();
    this.pack = this.readPack();
    this.mine = this.readMine();
    this.cachedIndex = undefined;
  }
  file(name) { return this.dir ? path.join(this.dir, name) : null; }
  readJson(name, max = MAX_PACK_BYTES + 1024) {
    const f = this.file(name); if (!f) return null;
    try { const st = fs.statSync(f); if (!st.isFile() || st.size > max) return null; return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
  }
  writeJson(name, value) {
    const f = this.file(name); if (!f) return;
    try { fs.mkdirSync(this.dir, { recursive: true }); atomic(f, JSON.stringify(value)); } catch { /* best effort: settings stay in memory */ }
  }
  readSettings() {
    const raw = this.readJson("settings.json", 64 * 1024) || {};
    const time = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    const s = {
      schemaVersion: 1,
      installId: typeof raw.installId === "string" && UUID_RE.test(raw.installId) ? raw.installId : null,
      share: raw.share !== false, download: raw.download !== false,
      lastSubmitAt: time(raw.lastSubmitAt), lastAttemptAt: time(raw.lastAttemptAt), lastPackAt: time(raw.lastPackAt), lastPackCheckAt: time(raw.lastPackCheckAt),
      etag: typeof raw.etag === "string" && raw.etag.length <= 200 ? raw.etag : null,
      sentTotal: Number.isSafeInteger(raw.sentTotal) && raw.sentTotal >= 0 ? raw.sentTotal : 0,
      blocked: raw.blocked === true, backoffUntil: time(raw.backoffUntil),
      failures: Number.isSafeInteger(raw.failures) && raw.failures >= 0 && raw.failures < 64 ? raw.failures : 0,
      lastError: typeof raw.lastError === "string" && raw.lastError.length <= 40 ? raw.lastError : null,
      // Finds seen again after this moment are sent once more, so the service knows they are still there.
      refreshFrom: time(raw.refreshFrom), lastMineAt: time(raw.lastMineAt), mineStale: raw.mineStale === true,
    };
    let save = false;
    if (!s.installId) { s.installId = this.randomUUID(); save = true; }
    if (s.refreshFrom === null) { s.refreshFrom = this.now(); save = true; }
    if (save) this.writeJson("settings.json", s);
    return s;
  }
  saveSettings() { this.writeJson("settings.json", this.settings); }
  readSent() {
    const raw = this.readJson("sent.json", 4 * 1024 * 1024);
    return new Set(Array.isArray(raw?.keys) ? raw.keys.filter((k) => typeof k === "string" && /^[0-9a-f]{16}$/.test(k)).slice(-MAX_SENT) : []);
  }
  saveSent() {
    if (this.sent.size > MAX_SENT) this.sent = new Set([...this.sent].slice(-MAX_SENT));
    this.writeJson("sent.json", { schemaVersion: 1, keys: [...this.sent] });
  }
  readPack() {
    const raw = this.readJson("pack.json");
    try { return raw ? validatePack(raw) : null; } catch { return null; }
  }
  /** The saved list of this install's own contributions; null until the service has answered for this install id. */
  readMine() {
    const raw = this.readJson("mine.json", MAX_MINE_BYTES * 2);
    if (!raw || raw.schemaVersion !== 1 || raw.installId !== this.settings.installId || !Array.isArray(raw.keys) || raw.keys.length > MAX_MINE) return null;
    return { total: Number.isSafeInteger(raw.total) && raw.total >= 0 ? raw.total : raw.keys.length, truncated: raw.truncated === true, keys: new Set(raw.keys.filter((k) => typeof k === "string" && k.length <= 200)) };
  }
  clearMine() {
    this.mine = null; this.cachedIndex = undefined;
    this.settings.lastMineAt = null; this.settings.mineStale = false;
    try { const f = this.file("mine.json"); if (f) fs.rmSync(f, { force: true }); } catch { /* best effort */ }
  }
  /** The service says it speaks pack format minor 1: only then are the newer submit fields sent (an older service would refuse the whole batch). */
  extended() { return (this.pack?.minor || 0) >= 1; }
  log(line) {
    const at = new Date(this.now()).toISOString().slice(0, 19).replace("T", " ");
    this.lines.push(`${at} ${String(line).slice(0, 300)}`);
    if (this.lines.length > 200) this.lines.splice(0, this.lines.length - 200);
  }

  // -------- network
  async request(method, route, { body, headers = {}, maxBytes = MAX_RESPONSE } = {}) {
    if (typeof this.fetch !== "function") throw new CommunityError("offline");
    let res;
    try {
      res = await this.fetch(this.baseUrl + route, {
        method, redirect: "error",
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch { throw new CommunityError("offline"); }
    const text = await readCapped(res, maxBytes).catch(() => null);
    let json = null;
    if (text) try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, json, text };
  }
  backoff(code, retryAfterSec = null) {
    const s = this.settings;
    if (retryAfterSec !== null) s.backoffUntil = this.now() + Math.max(BACKOFF_MIN, Math.min(BACKOFF_MAX, retryAfterSec * 1000));
    else { s.failures = Math.min(s.failures + 1, 20); s.backoffUntil = this.now() + Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** (s.failures - 1)); }
    s.lastError = code;
  }

  // -------- submit
  pending() {
    return collectObservations(this.getProfiles(), { extended: this.extended(), refreshFrom: this.settings.refreshFrom })
      .filter((it) => it.keys.some((k) => !this.sent.has(short(k))));
  }
  /** One sharing pass: off switch, block and backoff respected; never throws. */
  async submit({ force = false } = {}) {
    const s = this.settings;
    if (!s.share || s.blocked || this.busy.submit) return { status: !s.share ? "off" : s.blocked ? "blocked" : "busy" };
    if (!force && s.backoffUntil && this.now() < s.backoffUntil) return { status: "waiting" };
    if (!force && s.lastAttemptAt && this.now() - s.lastAttemptAt < SUBMIT_MIN_GAP) return { status: "waiting" };
    let items;
    try { items = this.pending(); } catch { return { status: "error" }; }
    if (!items.length) return { status: "nothing" };
    this.busy.submit = true;
    s.lastAttemptAt = this.now();
    let sent = 0, status = "sent";
    try {
      const queue = planBatches(items);
      for (let n = 0; n < BATCHES_PER_TICK && queue.length; n++) {
        const batch = queue.shift();
        const body = submitBody({ installId: s.installId, appVersion: this.appVersion, batch });
        if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY && batch.items.length > 1) { queue.unshift(...halves(batch)); n--; continue; }
        let res;
        try { res = await this.request("POST", "/v1/submit", { body }); } catch { this.backoff("offline"); this.log("submit: service unreachable, will retry later"); status = "offline"; break; }
        if (!this.settings.share || this.settings.installId !== body.installId) { status = "off"; break; } // switched off or forgotten meanwhile
        const mark = (items) => { for (const it of items) for (const k of it.keys || [it.key]) this.sent.add(short(k)); };
        if (res.status === 200 || res.status === 201) {
          mark(batch.items); s.mineStale = true;
          sent += batch.items.length; s.sentTotal += batch.items.length; s.lastSubmitAt = this.now(); s.failures = 0; s.backoffUntil = null; s.lastError = null;
          this.log(`submit: ${batch.items.length} entries accepted`);
        } else if (res.status === 400 || res.status === 404 || res.status === 405 || res.status === 415) {
          // Client bug: drop this batch for good (never retried), keep going with the rest.
          mark(batch.items);
          this.log(`submit: batch rejected (${res.status}${res.json?.detail ? " " + String(res.json.detail).slice(0, 120) : ""})`);
        } else if (res.status === 403) {
          s.blocked = true; s.lastError = "blocked"; status = "blocked"; this.log("submit: this install is blocked; sharing stopped"); break;
        } else if (res.status === 413) {
          if (batch.items.length > 1) { queue.unshift(...halves(batch)); n--; } else mark(batch.items);
        } else if (res.status === 429) {
          const after = Number.parseInt(res.headers?.get?.("retry-after") || "", 10);
          this.backoff("rate", Number.isFinite(after) && after > 0 ? after : 600); status = "waiting"; this.log("submit: rate limited, waiting"); break;
        } else {
          this.backoff("server"); status = "offline"; this.log(`submit: server error ${res.status}, will retry later`); break;
        }
      }
    } finally {
      this.busy.submit = false;
      this.saveSent(); this.saveSettings();
    }
    return { status, sent };
  }

  // -------- pack
  /** Daily pack download with ETag; a pack that fails validation never replaces the last good one. */
  async refreshPack({ force = false } = {}) {
    const s = this.settings;
    if (!s.download || this.busy.pack) return { status: !s.download ? "off" : "busy" };
    if (!force && s.lastPackCheckAt && this.now() - s.lastPackCheckAt < PACK_EVERY) return { status: "fresh" };
    this.busy.pack = true;
    s.lastPackCheckAt = this.now();
    try {
      let res;
      try {
        // v=2 asks for pack format minor 1 (seen days, NPC names). A service that does not know it sends the plain pack.
        res = await this.request("GET", "/v1/pack?v=2", { headers: { "Accept-Encoding": "gzip", ...(s.etag && this.pack ? { "If-None-Match": s.etag } : {}) }, maxBytes: MAX_PACK_BYTES });
      } catch { this.log("pack: service unreachable, keeping the last pack"); s.lastPackCheckAt = this.now() - PACK_EVERY + PACK_CHECK; return { status: "offline" }; }
      if (res.status === 304) { s.lastPackAt = this.now(); this.log("pack: unchanged"); return { status: "unchanged" }; }
      if (res.status !== 200 || !res.json) { this.log(`pack: unavailable (${res.status})`); s.lastPackCheckAt = this.now() - PACK_EVERY + PACK_CHECK; return { status: "offline" }; }
      let pack;
      try { pack = validatePack(res.json); } catch (e) { this.log(`pack: rejected (${e.message})`); return { status: "invalid" }; }
      this.pack = pack; this.cachedIndex = undefined;
      const etag = res.headers?.get?.("etag");
      s.etag = typeof etag === "string" && etag.length <= 200 ? etag : null;
      s.lastPackAt = this.now();
      this.writeJson("pack.json", res.json);
      this.log(`pack: version ${pack.version} with ${Object.values(counts(pack)).reduce((a, b) => a + b, 0)} rows`);
      return { status: "updated" };
    } finally { this.busy.pack = false; this.saveSettings(); }
  }
  index() {
    if (this.cachedIndex === undefined) {
      this.cachedIndex = this.settings.download ? indexPack(this.pack) : null;
      // "From you": the exact list from the service, or null when it has not answered (the map then says so).
      if (this.cachedIndex) this.cachedIndex.mine = this.mine ? this.mine.keys : null;
    }
    return this.cachedIndex;
  }

  // -------- mine
  /**
   * Asks the service which facts this install contributed (POST /v1/mine), so the map can mark them
   * exactly. Sends the install id and nothing else; only while sharing is on and something was shared.
   * Never throws; an unreachable or older service leaves the last list as it was.
   */
  async refreshMine({ force = false } = {}) {
    const s = this.settings;
    if (!s.share || s.blocked || this.busy.mine) return { status: !s.share ? "off" : s.blocked ? "blocked" : "busy" };
    if (!s.sentTotal) return { status: "nothing" };
    const since = s.lastMineAt === null ? Infinity : this.now() - s.lastMineAt;
    if (!force && since < (s.mineStale ? MINE_MIN_GAP : MINE_EVERY)) return { status: "fresh" };
    this.busy.mine = true;
    s.lastMineAt = this.now();
    const installId = s.installId;
    try {
      let res;
      try { res = await this.request("POST", "/v1/mine", { body: { schema: 1, installId }, maxBytes: MAX_MINE_BYTES }); } catch { return { status: "offline" }; }
      if (this.settings.installId !== installId || !this.settings.share) return { status: "off" }; // forgotten or switched off meanwhile
      if (res.status === 404 || res.status === 405) { s.mineStale = false; this.log("mine: this service does not list contributions yet"); return { status: "unsupported" }; } // an older service: ask again in six hours, not after every submit
      if (res.status !== 200 || !res.json) { this.log(`mine: unavailable (${res.status})`); return { status: "offline" }; }
      let list;
      try { list = validateMine(res.json); } catch { this.log("mine: answer rejected"); return { status: "invalid" }; }
      this.mine = { total: list.total, truncated: list.truncated, keys: new Set(list.keys) };
      this.cachedIndex = undefined; s.mineStale = false;
      this.writeJson("mine.json", { schemaVersion: 1, installId, total: list.total, truncated: list.truncated, keys: list.keys });
      this.log(`mine: ${list.keys.length} of your contributions listed`);
      return { status: "updated", count: list.keys.length };
    } finally { this.busy.mine = false; this.saveSettings(); }
  }

  // -------- settings, forget, report
  status() {
    const s = this.settings, c = counts(this.pack);
    let pending = 0;
    try { pending = this.pending().length; } catch {}
    return {
      share: s.share, download: s.download, blocked: s.blocked,
      installId: s.installId.slice(0, 8),
      lastSubmitAt: s.lastSubmitAt ? new Date(s.lastSubmitAt).toISOString() : null,
      lastPackAt: s.lastPackAt ? new Date(s.lastPackAt).toISOString() : null,
      retryAt: s.backoffUntil && s.backoffUntil > this.now() ? new Date(s.backoffUntil).toISOString() : null,
      lastError: s.lastError,
      sent: s.sentTotal, pending,
      mine: this.mine ? { count: this.mine.keys.size, total: this.mine.total, truncated: this.mine.truncated } : null,
      received: this.pack ? { version: this.pack.version, generatedAt: this.pack.generatedAt, ...c, total: Object.values(c).reduce((a, b) => a + b, 0) } : null,
      shares: ["Herb, ore and chest spots you gathered, and other objects you looted a quest item from (kind, object id, zone map and position rounded to 0.5% of the map) and the item ids they gave", "Where you looted quest-item creatures (creature id, zone map and rounded position)", "Vendors whose window you opened (vendor id, the item ids on sale and the rounded position where you stood; no prices)", "The name the game shows for those creatures and vendors, on English game clients only", "A random install id (not linked to your account, characters or computer), the game build and the app version"],
      never: ["Character names, GUIDs, realm, account or guild", "Chat, party or anything you type", "Times of day, exact positions or your location now"],
      host: new URL(this.baseUrl).host,
    };
  }
  setSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["share", "download"].includes(k))) throw Error("Invalid community settings.");
    for (const k of ["share", "download"]) if (input[k] !== undefined && typeof input[k] !== "boolean") throw Error("Invalid community settings.");
    // Turning sharing or download on is a request to try now: drop any wait from earlier failures.
    if (input.share === true || input.download === true) { this.settings.backoffUntil = null; this.settings.failures = 0; }
    if (typeof input.share === "boolean") this.settings.share = input.share;
    if (typeof input.download === "boolean") { this.settings.download = input.download; this.cachedIndex = undefined; }
    this.saveSettings();
    this.log(`settings: sharing ${this.settings.share ? "on" : "off"}, download ${this.settings.download ? "on" : "off"}`);
    return this.status();
  }
  /** POST /v1/forget, then a fresh install id. Errors are user-facing and safe to show. */
  async forget() {
    const s = this.settings;
    let res;
    try { res = await this.request("POST", "/v1/forget", { body: { schema: 1, installId: s.installId } }); } catch (e) { throw e instanceof CommunityError ? e : new CommunityError("offline"); }
    if (res.status === 429) throw new CommunityError("rate");
    if (res.status !== 200 || res.json?.ok !== true) throw new CommunityError(res.status === 400 ? "invalid" : "offline");
    const removed = res.json.removed && typeof res.json.removed === "object" ? { observations: Number(res.json.removed.observations) || 0, reports: Number(res.json.removed.reports) || 0 } : { observations: 0, reports: 0 };
    this.clearMine(); // the list of this install's own contributions goes with the install id
    s.installId = this.randomUUID(); s.sentTotal = 0; s.lastSubmitAt = null; s.lastAttemptAt = null; s.blocked = false; s.backoffUntil = null; s.failures = 0; s.lastError = null;
    // Re-sharing the same finds would be allowed by the contract, but the user just asked us to forget
    // them: keep them marked as sent so only new finds are shared from now on.
    this.saveSettings(); this.saveSent();
    this.log("forget: contributions removed; new install id");
    try { this.onForgot?.(); } catch { /* Desk drops its local tickets; never blocks the answer */ }
    return { removed, status: this.status() };
  }
  /** The exact log text that would be attached, redacted. The renderer shows it; send() uses this copy. */
  reportPreview() {
    let support = "";
    try { support = String(this.getSupportText() || ""); } catch {}
    const text = this.redact([support.trim(), "", "Community sync log", ...(this.lines.length ? this.lines : ["(no community events yet)"])].join("\n"));
    this.preview = { id: crypto.randomBytes(16).toString("hex"), text, created: this.now() };
    return { id: this.preview.id, text, bytes: Buffer.byteLength(text, "utf8"), max: MAX_LOG_BYTES };
  }
  async report(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["category", "text", "logId"].includes(k))) throw Error("Invalid problem report.");
    const { category, logId } = input;
    if (!REPORT_CATEGORIES.includes(category)) throw Error("Invalid problem report.");
    if (typeof input.text !== "string") throw Error("Invalid problem report.");
    const text = input.text.replace(/\r\n?/g, "\n").replace(UNSAFE_TEXT, "").trim();
    if (!text || text.length > 2000) throw new CommunityError("invalid", "Describe the problem in 1 to 2,000 characters.");
    let log;
    if (logId !== undefined && logId !== null) {
      if (typeof logId !== "string" || !/^[a-f0-9]{32}$/.test(logId) || !this.preview || this.preview.id !== logId || this.now() - this.preview.created > 30 * 60 * 1000) throw new CommunityError("invalid", "Review the log again before sending.");
      log = this.preview.text;
    }
    const body = { schema: 1, installId: this.settings.installId, category, text, appVersion: VERSION_RE.test(this.appVersion) ? this.appVersion : "0.0.0", ...(log ? { log } : {}) };
    if (Buffer.byteLength(JSON.stringify(body)) > 160 * 1024) throw new CommunityError("invalid", "The attached log is too large. Untick Attach app log and try again.");
    const res = await this.request("POST", "/v1/report", { body });
    if (res.status === 201 || res.status === 200) {
      this.preview = null;
      this.log(`report: sent (${category})`);
      return { id: Number.isSafeInteger(res.json?.id) ? res.json.id : null };
    }
    this.log(`report: not sent (${res.status})`);
    if (res.status === 429) throw new CommunityError("rate");
    if (res.status === 503 && res.json?.error === "report_inbox_full") throw new CommunityError("inbox");
    if (res.status === 403) throw new CommunityError("blocked");
    if (res.status === 400 || res.status === 413) throw new CommunityError("invalid");
    throw new CommunityError("offline");
  }

  // -------- schedule
  start() {
    if (this.handles.length) return;
    const t = this.timers;
    const share = () => this.submit().catch(() => {}).then(() => this.refreshMine()).catch(() => {});
    const tick = () => { void share(); void this.refreshPack().catch(() => {}); };
    this.handles.push(["t", t.setTimeout(tick, START_DELAY)]);
    this.handles.push(["i", t.setInterval(() => { void share(); }, SUBMIT_EVERY)]);
    this.handles.push(["i", t.setInterval(() => { void this.refreshPack().catch(() => {}); }, PACK_CHECK)]);
    for (const [, h] of this.handles) h?.unref?.();
  }
  stop() {
    for (const [k, h] of this.handles) (k === "t" ? this.timers.clearTimeout : this.timers.clearInterval)(h);
    this.handles = [];
  }
  /** Delete all local data: forget local community state too (contributions stay on the server). */
  reset() {
    try { if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true }); } catch {}
    this.sent = new Set(); this.pack = null; this.mine = null; this.cachedIndex = undefined; this.preview = null; this.lines = [];
    this.settings = this.readSettings();
  }
}
function halves(batch) {
  const mid = Math.ceil(batch.items.length / 2);
  return [{ build: batch.build, items: batch.items.slice(0, mid) }, { build: batch.build, items: batch.items.slice(mid) }];
}
async function readCapped(res, max) {
  if (!res?.body?.getReader) return typeof res?.text === "function" ? (await res.text()).slice(0, max) : "";
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch {} throw Error("too large"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = {
  CommunityService, CommunityError, BASE_URL, resolveBaseUrl, round, collectObservations, planBatches, submitBody,
  validatePack, indexPack, provenance, daysSince, validateMine, mineKey, gameName, redactLog, capBytes, REPORT_CATEGORIES, PACK_LIMITS,
  SUBMIT_EVERY, SUBMIT_MIN_GAP, START_DELAY, PACK_EVERY, MINE_EVERY, MINE_MIN_GAP, MAX_LOG_BYTES,
};

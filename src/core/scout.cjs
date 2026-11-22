"use strict";
// Scout mode (roadmap S1), desktop part: the optional "scout" block a character's capture may
// carry. The addon records, only when the player switched scout mode on, the quest givers,
// hand-ins, trainers, vendors and flight masters that character talked to: NPC id, map and
// position. This module checks the block and can lay the records out as one JSON document.
// Nothing here uploads anything; there is no server part.
const MAX_RECORDS = 400, MAX_NAME = 60;
const KINDS = { g: "quest-giver", h: "hand-in", t: "trainer", v: "vendor", f: "flight-master" };
const bad = () => { throw Error("Invalid scout capture."); };
const whole = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const unit = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** The block as the addon wrote it -> { version: 1, records: [...] }, sorted, or a throw. */
function normalizeScoutCapture(block) {
  if (!block || typeof block !== "object" || Array.isArray(block) || block.version !== 1) bad();
  for (const k of Object.keys(block)) if (!["version", "records"].includes(k)) bad();
  const list = Array.isArray(block.records) ? block.records : block.records && typeof block.records === "object" && !Object.keys(block.records).length ? [] : bad();
  if (list.length > MAX_RECORDS) bad();
  const seen = new Set(), records = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || Array.isArray(r)) bad();
    for (const k of Object.keys(r)) if (!["k", "n", "name", "m", "x", "y", "q", "at"].includes(k)) bad();
    if (!Object.hasOwn(KINDS, r.k) || !whole(r.n, 1, 2147483647) || !whole(r.m, 1, 1000000) || !unit(r.x) || !unit(r.y) || !whole(r.at, 1, 253402300799)) bad();
    const quest = r.k === "g" || r.k === "h";
    if (quest ? !whole(r.q, 1, 2147483647) : r.q !== undefined) bad();
    if (r.name !== undefined && (typeof r.name !== "string" || !r.name.length || r.name.length > MAX_NAME || /[\x00-\x1f\x7f|]/.test(r.name))) bad();
    const key = `${r.k}:${r.n}:${quest ? r.q : 0}`;
    if (seen.has(key)) bad();
    seen.add(key);
    const out = { kind: KINDS[r.k], npcId: r.n };
    if (r.name !== undefined) out.name = r.name;
    Object.assign(out, { mapId: r.m, x: Math.round(r.x * 10000) / 10000, y: Math.round(r.y * 10000) / 10000 });
    if (quest) out.questId = r.q;
    out.seenAt = r.at;
    records.push(out);
  }
  records.sort((a, b) => a.mapId - b.mapId || a.npcId - b.npcId || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.questId || 0) - (b.questId || 0));
  return { version: 1, records };
}

/** How many records of each kind sit on each map: [{ mapId, total, kinds: { "vendor": 2, ... } }], busiest map first. */
function zoneCounts(records) {
  const byMap = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const row = byMap.get(r.mapId) || { mapId: r.mapId, total: 0, kinds: {} };
    row.total++; row.kinds[r.kind] = (row.kinds[r.kind] || 0) + 1;
    byMap.set(r.mapId, row);
  }
  return [...byMap.values()].sort((a, b) => b.total - a.total || a.mapId - b.mapId);
}

/**
 * The scout export document: what each character recorded, ready to be written as a JSON file.
 * entries: [{ name, realm, faction, clientBuild, scout }] where scout is a normalised block.
 * The same bytes for the same input; characters without records are left out.
 */
function scoutExport(entries, { exportedAt = null } = {}) {
  const characters = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.name !== "string" || !e.scout || !Array.isArray(e.scout.records) || !e.scout.records.length) continue;
    const row = { name: e.name, realm: typeof e.realm === "string" ? e.realm : "" };
    if (typeof e.faction === "string") row.faction = e.faction;
    if (typeof e.clientBuild === "string") row.clientBuild = e.clientBuild;
    row.zones = zoneCounts(e.scout.records);
    row.records = e.scout.records;
    characters.push(row);
  }
  characters.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.realm < b.realm ? -1 : a.realm > b.realm ? 1 : 0));
  return { format: "backstage-forever-scout", version: 1, ...(Number.isSafeInteger(exportedAt) ? { exportedAt } : {}), characters };
}

module.exports = { MAX_RECORDS, KINDS, normalizeScoutCapture, zoneCounts, scoutExport };

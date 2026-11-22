"use strict";
// World finds (data/forever-world): rare enemies, herb and ore spots, chests and mailboxes that
// players of the community met, from Efficient Games (CC BY 4.0). Strict, bounded validation.
// "Rare" is never guessed: it is the creature classification in the game client's own creature
// data (4 = rare, 2 = rare elite), which every rare seen in play agrees with.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { MAP_NAMES } = require("./map-names.cjs");
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const CLASSIFICATION = "Rare means classification 4 (rare) or 2 (rare elite) in the game client's own creature data.";
const LIMITS = Object.freeze({ bytes: 512 * 1024, rares: 2000, nodes: 200, chests: 300, mailboxes: 400, positions: 400, rarePositions: 4, drops: 5 });
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const fail = (why) => { throw Error("Invalid world finds pack" + (why ? `: ${why}` : ".")); };
const id = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const text = (v, max = 120) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const keys = (o, allowed) => { if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => !allowed.includes(k))) fail("keys"); };
const zone = (mapId) => Object.hasOwn(MAP_NAMES, mapId) && mapId !== 1414 && mapId !== 1415;
function positions(list, max) {
  if (!Array.isArray(list) || list.length > max) fail("positions");
  for (const p of list) {
    keys(p, ["mapId", "x", "y"]);
    if (!zone(p.mapId) || !(typeof p.x === "number" && p.x >= 0 && p.x <= 1) || !(typeof p.y === "number" && p.y >= 0 && p.y <= 1)) fail("position");
  }
}
function validateWorldPack(p) {
  keys(p, ["schemaVersion", "kind", "product", "build", "builds", "sourceCommit", "license", "attribution", "classification", "rares", "nodes", "chests", "mailboxes"]);
  if (p.schemaVersion !== 1 || p.kind !== "forever-world" || p.product !== "wowf" || p.license !== "CC BY 4.0" || p.attribution !== ATTRIBUTION || p.classification !== CLASSIFICATION) fail("header");
  if (typeof p.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(p.sourceCommit)) fail("commit");
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > 12 || p.builds.some((b) => !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/.test(b)) || p.build !== p.builds[0]) fail("builds");
  if (!Array.isArray(p.rares) || p.rares.length > LIMITS.rares || !Array.isArray(p.nodes) || p.nodes.length > LIMITS.nodes || !Array.isArray(p.chests) || p.chests.length > LIMITS.chests) fail("sizes");
  let prev = 0;
  for (const r of p.rares) {
    keys(r, ["id", "name", "elite", "minLevel", "maxLevel", "positions", "drops"]);
    if (!id(r.id) || r.id <= prev || !text(r.name) || ("elite" in r && r.elite !== true)) fail("rare");
    prev = r.id;
    if ("minLevel" in r || "maxLevel" in r) { if (!Number.isSafeInteger(r.minLevel) || !Number.isSafeInteger(r.maxLevel) || r.minLevel < 1 || r.maxLevel > 63 || r.minLevel > r.maxLevel) fail("rare level"); }
    positions(r.positions, LIMITS.rarePositions);
    if (!Array.isArray(r.drops) || r.drops.length > LIMITS.drops) fail("drops");
    for (const d of r.drops) {
      keys(d, ["itemId", "name", "chance", "drops"]);
      if (!id(d.itemId) || (d.name !== null && !text(d.name)) || !(typeof d.chance === "number" && d.chance > 0 && d.chance <= 1) || !Number.isSafeInteger(d.drops) || d.drops < 1) fail("drop");
    }
  }
  for (const [list, extra] of [[p.nodes, ["kind", "skill"]], [p.chests, []]]) {
    prev = 0;
    for (const n of list) {
      keys(n, ["id", "name", "positions", ...extra]);
      if (!id(n.id) || n.id <= prev || !text(n.name) || !n.positions.length) fail("object");
      prev = n.id;
      if (extra.length && ((n.kind !== "herb" && n.kind !== "ore") || !Number.isSafeInteger(n.skill) || n.skill < 1 || n.skill > 300)) fail("node");
      positions(n.positions, LIMITS.positions);
    }
  }
  positions(p.mailboxes, LIMITS.mailboxes);
  if (Buffer.byteLength(JSON.stringify(p)) > LIMITS.bytes) fail("too large");
  return p;
}
let cached;
function loadWorldPack(file = path.join(__dirname, "..", "..", "data", "forever-world", "pack.json")) {
  if (cached !== undefined && arguments.length === 0) return cached;
  let pack = null;
  try { pack = validateWorldPack(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { pack = null; }
  if (arguments.length === 0) cached = pack;
  return pack;
}
const levelText = (r) => (r.minLevel ? (r.minLevel === r.maxLevel ? String(r.minLevel) : `${r.minLevel}-${r.maxLevel}`) : null);
/** "Rare" or "Rare elite", with the level when a player saw it. */
function rareLabel(r) { const lv = levelText(r); return `${r.elite ? "Rare elite" : "Rare"}${lv ? ` · level ${lv}` : ""}`; }
/** What a rare was seen to drop, as plain words; null when nobody recorded a drop. */
function dropLine(r, limit = 3) {
  if (!r.drops?.length) return null;
  return r.drops.slice(0, limit).map((d) => `${d.name || `Item #${d.itemId}`} (seen ${d.drops}×)`).join(", ");
}
/** Pins for one kind of find, for the shared map index. */
function worldPins(pack) {
  const out = [];
  if (!pack) return out;
  const source = "Efficient Games, CC BY 4.0";
  for (const r of pack.rares) r.positions.forEach((p, i) => out.push({ id: `rare:${r.id}:${p.mapId}:${i}`, kind: "rare", creatureId: r.id, label: r.name, sub: rareLabel(r), elite: Boolean(r.elite), drops: r.drops, mapId: p.mapId, x: p.x, y: p.y, evidence: "historical", source: `${source} · where a player met it; rares are not always up` }));
  for (const n of pack.nodes) n.positions.forEach((p) => out.push({ id: `node:${n.id}:${p.mapId}:${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`, kind: n.kind, label: n.name, sub: `${n.kind === "ore" ? "Mining node" : "Herb"} (reference) · skill ${n.skill}`, skill: n.skill, mapId: p.mapId, x: p.x, y: p.y, evidence: "historical", source }));
  for (const c of pack.chests) c.positions.forEach((p) => out.push({ id: `chest:${c.id}:${p.mapId}:${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`, kind: "chest", label: c.name, sub: "Chest (reference) · chests move between spots", mapId: p.mapId, x: p.x, y: p.y, evidence: "historical", source }));
  pack.mailboxes.forEach((p) => out.push({ id: `mailbox:${p.mapId}:${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`, kind: "mailbox", label: "Mailbox", sub: null, mapId: p.mapId, x: p.x, y: p.y, evidence: "historical", source }));
  return out;
}
/** The rare list for one zone, plus how much of the whole list has a known place. */
function rareSummary(pack, mapId) {
  if (!pack) return { here: [], total: 0, placed: 0, withDrops: 0 };
  const here = pack.rares.filter((r) => r.positions.some((p) => p.mapId === mapId)).map((r) => {
    const p = r.positions.find((q) => q.mapId === mapId);
    return { id: r.id, name: r.name, label: rareLabel(r), elite: Boolean(r.elite), x: p.x, y: p.y, drops: dropLine(r), dropItems: r.drops.map((d) => d.itemId) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { here, total: pack.rares.length, placed: pack.rares.filter((r) => r.positions.length).length, withDrops: pack.rares.filter((r) => r.drops.length).length };
}
module.exports = { ATTRIBUTION, CLASSIFICATION, LIMITS, validateWorldPack, loadWorldPack, worldPins, rareSummary, rareLabel, dropLine, hash, zone };

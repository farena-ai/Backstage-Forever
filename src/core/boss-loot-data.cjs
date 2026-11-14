"use strict";
// What each Instance Atlas boss drops (data/forever-boss-loot): community loot observations from
// Efficient Games (CC BY 4.0), keyed by atlas instance id and boss name. Strict, bounded validation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const fail = () => { throw Error("Invalid boss loot pack."); };
const id = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const MIN_CHANCE = 0.03, MAX_ITEMS = 16;
function validateBossLootPack(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-boss-loot" || p.product !== "wowf" || p.license !== "CC BY 4.0" || typeof p.attribution !== "string" || p.attribution.length > 300) fail();
  if (typeof p.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(p.sourceCommit)) fail();
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > 12 || p.builds.some((b) => typeof b !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(b))) fail();
  if (p.minChance !== MIN_CHANCE) fail();
  if (!p.instances || typeof p.instances !== "object" || Array.isArray(p.instances) || Object.keys(p.instances).length > 64) fail();
  for (const [key, inst] of Object.entries(p.instances)) {
    if (!/^[a-z0-9-]{1,24}$/.test(key) || !inst || typeof inst !== "object" || !Array.isArray(inst.bosses) || !inst.bosses.length || inst.bosses.length > 20) fail();
    const names = new Set();
    for (const b of inst.bosses) {
      if (!b || typeof b.name !== "string" || !b.name || b.name.length > 120 || names.has(b.name)) fail();
      names.add(b.name);
      if (!Array.isArray(b.npcIds) || b.npcIds.length > 8 || b.npcIds.some((n) => !id(n)) || new Set(b.npcIds).size !== b.npcIds.length) fail();
      if (!Array.isArray(b.items) || b.items.length > MAX_ITEMS) fail();
      const seen = new Set();
      let last = Infinity;
      for (const it of b.items) {
        if (!it || !id(it.itemId) || seen.has(it.itemId) || !(typeof it.chance === "number" && it.chance >= MIN_CHANCE && it.chance <= 1) || !Number.isSafeInteger(it.drops) || it.drops < 1) fail();
        if (it.chance > last) fail(); // sorted by chance, best first
        seen.add(it.itemId); last = it.chance;
      }
    }
  }
  return p;
}
let cached;
function loadBossLootPack(file = path.join(__dirname, "..", "..", "data", "forever-boss-loot", "pack.json")) {
  if (cached !== undefined) return cached;
  try { cached = validateBossLootPack(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { cached = null; }
  return cached;
}
// itemId -> [{ instanceId, boss, chance }], best chance first.
function dropIndex(pack) {
  const out = new Map();
  for (const [instanceId, inst] of Object.entries(pack?.instances || {})) for (const b of inst.bosses) for (const it of b.items) {
    if (!out.has(it.itemId)) out.set(it.itemId, []);
    out.get(it.itemId).push({ instanceId, boss: b.name, chance: it.chance });
  }
  for (const list of out.values()) list.sort((a, b) => b.chance - a.chance);
  return out;
}
module.exports = { validateBossLootPack, loadBossLootPack, dropIndex, hash, MIN_CHANCE, MAX_ITEMS };

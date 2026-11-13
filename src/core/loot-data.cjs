"use strict";
// Community loot observations for quest items (data/forever-loot): strict, bounded validation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const fail = () => { throw Error("Invalid loot pack."); };
const id = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
function validateLootPack(p) {
  if (!p || p.schemaVersion !== 1 || p.kind !== "forever-loot" || p.product !== "wowf" || p.license !== "CC BY 4.0" || typeof p.attribution !== "string") fail();
  if (typeof p.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(p.sourceCommit)) fail();
  if (!Array.isArray(p.builds) || !p.builds.length || p.builds.length > 12 || p.builds.some((b) => !/^\d+\.\d+\.\d+\.\d+$/.test(b))) fail();
  if (!p.items || typeof p.items !== "object" || Array.isArray(p.items) || Object.keys(p.items).length > 20000) fail();
  for (const [k, list] of Object.entries(p.items)) {
    if (!id(+k) || !Array.isArray(list) || !list.length || list.length > 6) fail();
    for (const s of list) {
      if (!s || (s.kind !== "npc" && s.kind !== "object") || !id(s.id) || !(typeof s.chance === "number" && s.chance >= 0 && s.chance <= 1) || !Number.isSafeInteger(s.drops) || s.drops < 1) fail();
      if (s.name !== null && (typeof s.name !== "string" || s.name.length > 120)) fail();
    }
  }
  return p;
}
let cached;
function loadLootPack(file = path.join(__dirname, "..", "..", "data", "forever-loot", "pack.json")) {
  if (cached !== undefined) return cached;
  try { cached = validateLootPack(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { cached = null; }
  return cached;
}
module.exports = { validateLootPack, loadLootPack, hash };

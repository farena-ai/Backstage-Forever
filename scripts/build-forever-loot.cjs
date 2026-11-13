"use strict";
// Builds data/forever-loot/pack.json: where quest objective items come from, per community loot
// observations (Efficient Games, CC BY 4.0), merged across client builds newest first.
// Usage: node scripts/build-forever-loot.cjs --source-dir <dir with <build>/loot.json, npcs.json, object_details.enUS.json>
//        node scripts/build-forever-loot.cjs --check
const fs = require("node:fs"), path = require("node:path");
const { validateLootPack, hash } = require("../src/core/loot-data.cjs");
const root = path.join(__dirname, "..");
const BUILDS = ["1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"];
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const dir = path.join(root, "data", "forever-loot");

function compile(sourceDir, commit) {
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  const wanted = new Set();
  for (const q of Object.values(knowledge.quests)) for (const o of q.objectives || []) if (o.type === "item" && Number.isSafeInteger(o.objectId)) wanted.add(o.objectId);
  const names = { npc: new Map(), object: new Map() };
  for (const c of Object.values(knowledge.creatures || {})) names.npc.set(c.id, c.name);
  const items = new Map(); // itemId -> Map(key -> source)
  const used = [];
  for (const build of BUILDS) {
    const lootFile = path.join(sourceDir, build, "loot.json");
    if (!fs.existsSync(lootFile)) continue;
    used.push(build);
    for (const f of ["npcs.json", "object_details.enUS.json"]) {
      const p = path.join(sourceDir, build, f); if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const [id, o] of Object.entries(j.objects || {})) if (o?.name && !names.object.has(+id)) names.object.set(+id, o.name);
      for (const [id, n] of Object.entries(j.npcs || {})) if (n?.name && !names.npc.has(+id)) names.npc.set(+id, n.name);
    }
    const loot = JSON.parse(fs.readFileSync(lootFile, "utf8"));
    for (const [key, src] of Object.entries(loot.sources || {})) {
      const m = /^(npc|object):(\d+)/.exec(key); if (!m) continue;
      const kind = m[1], id = +m[2];
      for (const [itemId, row] of Object.entries(src.items || {})) {
        if (!wanted.has(+itemId)) continue;
        if (!items.has(+itemId)) items.set(+itemId, new Map());
        const k = `${kind}:${id}`, have = items.get(+itemId).get(k);
        const chance = Number(row.chance) || 0, drops = Number(row.drops) || 0;
        // Newest build first; later builds only add sources or raise the observation count.
        if (!have) items.get(+itemId).set(k, { kind, id, name: names[kind].get(id) || null, chance: Math.round(chance * 1000) / 1000, drops });
        else have.drops += drops;
      }
    }
  }
  const out = {};
  for (const [itemId, m] of [...items].sort((a, b) => a[0] - b[0])) {
    // Single sightings are noisy (a stray drop, a pickpocket); keep repeated sources, or the best lone one.
    const all = [...m.values()].filter((s) => s.drops > 0).sort((a, b) => b.drops - a.drops || b.chance - a.chance);
    const solid = all.filter((s) => s.drops >= 2);
    out[itemId] = (solid.length ? solid : all.slice(0, 1)).sort((a, b) => b.chance - a.chance || b.drops - a.drops).slice(0, 6);
    if (!out[itemId].length) delete out[itemId];
  }
  const pack = validateLootPack({ schemaVersion: 1, kind: "forever-loot", product: "wowf", sourceCommit: commit, builds: used, license: "CC BY 4.0", attribution: ATTRIBUTION, items: out });
  return JSON.stringify(pack) + "\n";
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const b = fs.readFileSync(path.join(dir, "pack.json"));
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json"), "utf8"));
    if (lock.sha256 !== hash(b) || lock.bytes !== b.length) throw Error("Loot pack checksum mismatch.");
    const p = validateLootPack(JSON.parse(b));
    if (Object.keys(p.items).length !== lock.items) throw Error("Loot pack coverage mismatch.");
    console.log(`Loot pack check passed: ${lock.items} quest items with sources.`);
  } else if (args[0] === "--source-dir" && args[1]) {
    const commit = (args[2] || fs.readFileSync(path.join(args[1], "commit.txt"), "utf8")).trim();
    const text = compile(args[1], commit);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pack.json"), text);
    const items = Object.keys(JSON.parse(text).items).length;
    fs.writeFileSync(path.join(dir, "source-lock.json"), JSON.stringify({ publisher: "Efficient Games", repository: "JIVESCORP/eg-link-output-wowf", commit, builds: JSON.parse(text).builds, license: "CC BY 4.0", attribution: ATTRIBUTION, files: ["loot.json", "npcs.json", "object_details.enUS.json"], normalization: "Only items that are quest objectives; per source kind (npc/object), id, name, observed chance and drop count; at most 6 sources per item.", items, bytes: Buffer.byteLength(text), sha256: hash(text) }, null, 2) + "\n");
    console.log(`Wrote ${items} quest items (${Buffer.byteLength(text)} bytes).`);
  } else throw Error("Use --source-dir <dir> [commit] or --check");
}
module.exports = { compile };

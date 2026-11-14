"use strict";
// Builds data/forever-boss-loot/pack.json: what each Instance Atlas boss drops, per community loot
// observations (Efficient Games, CC BY 4.0), merged across client builds.
// Usage: node scripts/build-forever-boss-loot.cjs --source-dir <dir with <build>/loot.json, npcs.json> [commit]
//        node scripts/build-forever-boss-loot.cjs --check
const fs = require("node:fs"), path = require("node:path");
const { validateBossLootPack, hash, MIN_CHANCE, MAX_ITEMS } = require("../src/core/boss-loot-data.cjs");
const { BASELINE } = require("../src/core/dungeon-atlas.cjs");
const root = path.join(__dirname, "..");
const BUILDS = ["1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"];
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const dir = path.join(root, "data", "forever-boss-loot");
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

function compile(sourceDir, commit) {
  // Boss names -> NPC ids: upstream npcs.json plus the bundled creature references (same upstream).
  const byName = new Map();
  const name = (id, n) => { if (typeof n !== "string" || !n || !Number.isSafeInteger(+id) || +id <= 0) return; if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(+id); };
  for (const c of Object.values(readJson(path.join(root, "data", "forever", "pack.json")).creatures || {})) name(c.id, c.name);
  try { for (const c of readJson(path.join(root, "data", "forever-creatures", "pack.json")).creatures || []) name(c.id, c.name); } catch {}
  const npcLoot = new Map(); // npcId -> { windows, items: Map(itemId -> drops) }
  const rollLoot = new Map(); // encounter name -> { kills, items: Map(itemId -> drops) }
  const used = [];
  for (const build of BUILDS) {
    const lootFile = path.join(sourceDir, build, "loot.json");
    if (!fs.existsSync(lootFile)) continue;
    used.push(build);
    const npcFile = path.join(sourceDir, build, "npcs.json");
    if (fs.existsSync(npcFile)) for (const [id, n] of Object.entries(readJson(npcFile).npcs || {})) name(id, n?.name);
    const loot = readJson(lootFile);
    for (const [key, src] of Object.entries(loot.sources || {})) {
      // npc:<id> with |group / |quest variants; skinning/mining/herbalism (|spell:...) are not boss drops.
      const m = /^npc:(\d+)((?:\|(?:group|quest))*)$/.exec(key); if (!m) continue;
      const windows = Number(src.windows) || 0; if (windows < 1) continue;
      if (!npcLoot.has(+m[1])) npcLoot.set(+m[1], { windows: 0, items: new Map() });
      const n = npcLoot.get(+m[1]); n.windows += windows;
      for (const [itemId, row] of Object.entries(src.items || {})) {
        if (row?.quest || !Number.isSafeInteger(+itemId) || +itemId <= 0) continue; // quest-only items
        n.items.set(+itemId, (n.items.get(+itemId) || 0) + (Number(row.drops) || 0));
      }
    }
    // Group loot rolls per encounter (uncommon and better), named by the encounter.
    for (const r of Object.values(loot.rolls || {})) {
      const n = r?.names?.enUS, kills = Number(r?.kills) || 0; if (typeof n !== "string" || kills < 1) continue;
      if (!rollLoot.has(n)) rollLoot.set(n, { kills: 0, items: new Map() });
      const e = rollLoot.get(n); e.kills += kills;
      for (const [itemId, row] of Object.entries(r.items || {})) if (!row?.quest && Number.isSafeInteger(+itemId) && +itemId > 0) e.items.set(+itemId, (e.items.get(+itemId) || 0) + (Number(row.drops) || 0));
    }
  }
  const instances = {};
  for (const [instanceId, , , , , , , , , , bosses] of BASELINE) {
    instances[instanceId] = {
      bosses: bosses.map((boss) => {
        const ids = [...(byName.get(boss) || [])].sort((a, b) => a - b);
        const looted = ids.filter((i) => npcLoot.has(i));
        const npcIds = (looted.length ? looted : ids).slice(0, 8);
        const items = new Map(); // itemId -> { chance, drops }
        let windows = 0; const drops = new Map();
        for (const i of looted) { const n = npcLoot.get(i); windows += n.windows; for (const [it, d] of n.items) drops.set(it, (drops.get(it) || 0) + d); }
        for (const [it, d] of drops) if (d > 0) items.set(it, { chance: Math.min(1, d / windows), drops: d });
        const roll = rollLoot.get(boss);
        if (roll) for (const [it, d] of roll.items) {
          if (d < 1) continue;
          const c = Math.min(1, d / roll.kills), have = items.get(it);
          if (!have || c > have.chance) items.set(it, { chance: c, drops: Math.max(d, have?.drops || 0) });
        }
        const list = [...items].map(([itemId, v]) => ({ itemId, chance: Math.round(v.chance * 1000) / 1000, drops: v.drops }))
          .filter((x) => x.chance >= MIN_CHANCE).sort((a, b) => b.chance - a.chance || b.drops - a.drops || a.itemId - b.itemId).slice(0, MAX_ITEMS);
        return { name: boss, npcIds, items: list };
      }),
    };
  }
  const pack = validateBossLootPack({ schemaVersion: 1, kind: "forever-boss-loot", product: "wowf", sourceCommit: commit, builds: used, license: "CC BY 4.0", attribution: ATTRIBUTION, minChance: MIN_CHANCE, instances });
  return JSON.stringify(pack) + "\n";
}
function stats(pack) {
  const bosses = Object.values(pack.instances).flatMap((i) => i.bosses);
  return { instances: Object.keys(pack.instances).length, bosses: bosses.length, bossesWithLoot: bosses.filter((b) => b.items.length).length, items: bosses.reduce((n, b) => n + b.items.length, 0) };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const b = fs.readFileSync(path.join(dir, "pack.json"));
    const lock = readJson(path.join(dir, "source-lock.json"));
    if (lock.sha256 !== hash(b) || lock.bytes !== b.length) throw Error("Boss loot pack checksum mismatch.");
    const s = stats(validateBossLootPack(JSON.parse(b)));
    if (s.bossesWithLoot !== lock.bossesWithLoot || s.items !== lock.items || s.bosses !== lock.bosses) throw Error("Boss loot pack coverage mismatch.");
    console.log(`Boss loot pack check passed: ${s.bossesWithLoot} of ${s.bosses} bosses with loot, ${s.items} items.`);
  } else if (args[0] === "--source-dir" && args[1]) {
    const commit = (args[2] || fs.readFileSync(path.join(args[1], "commit.txt"), "utf8")).trim();
    const text = compile(args[1], commit), pack = JSON.parse(text), s = stats(pack);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pack.json"), text);
    fs.writeFileSync(path.join(dir, "source-lock.json"), JSON.stringify({ publisher: "Efficient Games", repository: "JIVESCORP/eg-link-output-wowf", commit, builds: pack.builds, license: "CC BY 4.0", attribution: ATTRIBUTION, files: ["loot.json", "npcs.json"], normalization: `Instance Atlas bosses matched by exact name to NPC ids; their non-quest drops with an observed chance of at least ${MIN_CHANCE} per loot window (or per group-roll kill), at most ${MAX_ITEMS} items per boss.`, ...s, bytes: Buffer.byteLength(text), sha256: hash(text) }, null, 2) + "\n");
    console.log(`Wrote ${s.bossesWithLoot} of ${s.bosses} bosses with loot, ${s.items} items (${Buffer.byteLength(text)} bytes).`);
  } else throw Error("Use --source-dir <dir> [commit] or --check");
}
module.exports = { compile, stats };

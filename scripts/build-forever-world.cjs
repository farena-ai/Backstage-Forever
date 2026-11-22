"use strict";
// Builds data/forever-world/pack.json: rare enemies, herb and ore spots, chests and mailboxes from
// the community observations of Efficient Games (CC BY 4.0), merged across client builds.
//   rares      creature_details.enUS.json classification 4 (rare) or 2 (rare elite): the game
//              client's own creature data. Level and place only where a player met the creature
//              (creatures.json); drops only where a kill was looted (loot.json).
//   nodes      objects players walked up to (npcs.json "approached") whose name is a known herb or
//              ore node; the skill is the classic skill for that node name.
//   chests     approached objects of the chest type with an ordinary treasure chest name.
//   mailboxes  approached mailboxes.
// Usage: node scripts/build-forever-world.cjs --source-dir <dir with <build>/*.json> [commit]
//        node scripts/build-forever-world.cjs --check
const fs = require("node:fs"), path = require("node:path");
const { validateWorldPack, hash, zone, ATTRIBUTION, CLASSIFICATION, LIMITS } = require("../src/core/world-finds.cjs");
const { nodeInfo } = require("../src/core/gathering-loop.cjs");
const root = path.join(__dirname, "..");
const BUILDS = ["1.60.1.71037", "1.60.1.70959", "1.60.1.70938", "1.60.1.70888", "1.60.1.70862", "1.60.1.70840", "1.60.1.70790"];
const FILES = ["creature_details.enUS.json", "creatures.json", "loot.json", "npcs.json", "object_details.enUS.json"];
const dir = path.join(root, "data", "forever-world");
const RARE = { 2: "rareelite", 4: "rare" };
// Ordinary treasure chests by name; chests that belong to one quest are left out.
const CHEST_WORDS = /^(Large )?(Battered|Solid|Iron Bound|Mithril Bound|Darkwood) Chest$|^(Battered|Waterlogged|Mossy|Dented|Scarlet) Footlocker$/;
const CHEST_TYPE = 3, MAILBOX_TYPE = 19;
// Names the game itself marks as unused or test rows.
const junk = (name) => typeof name !== "string" || !name.trim() || name.length > 120 || /[\[\]<>]|\bUNUSED\b|\bTEST\b|^zz|\(old\)|\bDND\b|\bPH\b/i.test(name);
const round = (v, cell) => Math.round(v / cell) * cell;

function spots(list, cell, max) {
  const seen = new Set(), out = [];
  for (const p of list) {
    if (!p || !zone(p.uiMap) || !(p.mapX >= 0 && p.mapX <= 1) || !(p.mapY >= 0 && p.mapY <= 1)) continue;
    const x = +round(p.mapX, cell).toFixed(4), y = +round(p.mapY, cell).toFixed(4), key = `${p.uiMap}:${x}:${y}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ mapId: p.uiMap, x: Math.min(1, x), y: Math.min(1, y) });
  }
  out.sort((a, b) => a.mapId - b.mapId || a.x - b.x || a.y - b.y);
  return out.slice(0, max);
}

function compile(sourceDir, commit) {
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  const itemName = (itemId) => knowledge.items?.[String(itemId)]?.name || null;
  const used = [], sources = [];
  const rares = new Map(), seenAs = new Map(), objects = new Map(), objectType = new Map();
  const stats = { observedRare: 0, observedRareAgree: 0, classifiedRareSeenNormal: [] };
  for (const build of BUILDS) {
    const read = (f) => { const p = path.join(sourceDir, build, f); if (!fs.existsSync(p)) return null; const b = fs.readFileSync(p); sources.push({ build, name: f, bytes: b.length, sha256: hash(b) }); return JSON.parse(b); };
    const details = read("creature_details.enUS.json");
    if (!details) continue;
    used.push(build);
    // Newest build first: its name and classification win.
    for (const [key, c] of Object.entries(details.creatures || {})) {
      const cid = +key;
      if (!RARE[c?.classification] || rares.has(cid) || junk(c.name)) continue;
      rares.set(cid, { id: cid, name: c.name.trim(), elite: c.classification === 2, levels: [], positions: [], loot: new Map() });
    }
    const creatures = read("creatures.json");
    for (const [key, c] of Object.entries(creatures?.creatures || {})) {
      const cid = +key;
      for (const k of c.classifications || []) { if (!seenAs.has(cid)) seenAs.set(cid, new Set()); seenAs.get(cid).add(k); }
      const r = rares.get(cid); if (!r) continue;
      for (const lv of Object.keys(c.levels || {})) if (+lv >= 1 && +lv <= 63) r.levels.push(+lv);
      r.positions.push(...(c.positions || []));
    }
    const loot = read("loot.json");
    for (const [key, src] of Object.entries(loot?.sources || {})) {
      const m = /^npc:(\d+)(\||$)/.exec(key); const r = m && rares.get(+m[1]); if (!r) continue;
      for (const [itemId, row] of Object.entries(src.items || {})) {
        if (row.quest) continue; // quest items drop only with the quest
        const have = r.loot.get(+itemId) || { drops: 0, windows: 0 };
        have.drops += Number(row.drops) || 0; have.windows += Number(src.windows) || 0;
        r.loot.set(+itemId, have);
      }
    }
    const npcs = read("npcs.json");
    for (const [key, o] of Object.entries(npcs?.approached || {})) {
      if (!o?.name) continue;
      if (!objects.has(+key)) objects.set(+key, { id: +key, name: o.name, positions: [] });
      objects.get(+key).positions.push(...(o.positions || []));
    }
    const od = read("object_details.enUS.json");
    for (const [key, o] of Object.entries(od?.objects || {})) if (!objectType.has(+key) && Number.isInteger(o?.type)) objectType.set(+key, o.type);
  }
  // Cross-check: what players saw in game against the client classification.
  for (const [cid, set] of seenAs) {
    const rare = set.has("rare") || set.has("rareelite");
    if (rare) { stats.observedRare++; if (rares.has(cid)) stats.observedRareAgree++; }
    else if (rares.has(cid) && set.has("normal")) stats.classifiedRareSeenNormal.push(cid);
  }
  const rareRows = [...rares.values()].sort((a, b) => a.id - b.id).map((r) => {
    const row = { id: r.id, name: r.name };
    if (r.elite) row.elite = true;
    if (r.levels.length) { row.minLevel = Math.min(...r.levels); row.maxLevel = Math.max(...r.levels); }
    row.positions = spots(r.positions, 0.01, LIMITS.rarePositions);
    row.drops = [...r.loot].filter(([, v]) => v.drops > 0 && v.windows > 0)
      .map(([itemId, v]) => ({ itemId, name: itemName(itemId), chance: Math.min(1, Math.round((v.drops / v.windows) * 1000) / 1000), drops: v.drops }))
      .filter((d) => d.chance > 0).sort((a, b) => b.drops - a.drops || b.chance - a.chance || a.itemId - b.itemId).slice(0, LIMITS.drops);
    return row;
  });
  const nodes = [], chests = [], mail = [];
  for (const o of [...objects.values()].sort((a, b) => a.id - b.id)) {
    const type = objectType.get(o.id), info = nodeInfo(o.name);
    if (info && type === CHEST_TYPE) { const p = spots(o.positions, 0.005, LIMITS.positions); if (p.length) nodes.push({ id: o.id, name: o.name, kind: info.kind, skill: info.skill, positions: p }); }
    else if (type === CHEST_TYPE && CHEST_WORDS.test(o.name) && !junk(o.name)) { const p = spots(o.positions, 0.005, LIMITS.positions); if (p.length) chests.push({ id: o.id, name: o.name, positions: p }); }
    else if (type === MAILBOX_TYPE && o.name === "Mailbox") mail.push(...o.positions);
  }
  const pack = validateWorldPack({ schemaVersion: 1, kind: "forever-world", product: "wowf", build: used[0], builds: used, sourceCommit: commit, license: "CC BY 4.0", attribution: ATTRIBUTION, classification: CLASSIFICATION,
    rares: rareRows, nodes, chests, mailboxes: spots(mail, 0.015, LIMITS.mailboxes) });
  return { text: JSON.stringify(pack) + "\n", pack, sources, stats };
}
const counts = (p) => ({ rares: p.rares.length, raresPlaced: p.rares.filter((r) => r.positions.length).length, raresWithDrops: p.rares.filter((r) => r.drops.length).length, rareElites: p.rares.filter((r) => r.elite).length,
  nodes: p.nodes.length, herbSpots: p.nodes.filter((n) => n.kind === "herb").reduce((t, n) => t + n.positions.length, 0), oreSpots: p.nodes.filter((n) => n.kind === "ore").reduce((t, n) => t + n.positions.length, 0),
  chests: p.chests.length, chestSpots: p.chests.reduce((t, n) => t + n.positions.length, 0), mailboxes: p.mailboxes.length });
function check() {
  const b = fs.readFileSync(path.join(dir, "pack.json"));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json"), "utf8"));
  if (lock.sha256 !== hash(b) || lock.bytes !== b.length) throw Error("World finds pack checksum mismatch.");
  const p = validateWorldPack(JSON.parse(b));
  if (JSON.stringify(counts(p)) !== JSON.stringify(lock.counts)) throw Error("World finds pack coverage mismatch.");
  const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
  if (![lock.commit, ATTRIBUTION, "classification", ...lock.builds].every((t) => notice.includes(t))) throw Error("World finds attribution missing.");
  if (hash(fs.readFileSync(path.join(dir, "LICENSE"))) !== hash(fs.readFileSync(path.join(root, "data", "forever-loot", "LICENSE")))) throw Error("World finds license mismatch.");
  return lock;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const lock = check();
    console.log(`World finds pack check passed: ${lock.counts.rares} rares (${lock.counts.raresPlaced} with a place), ${lock.counts.herbSpots + lock.counts.oreSpots} node spots, ${lock.counts.chestSpots} chest spots, ${lock.counts.mailboxes} mailboxes.`);
  } else if (args[0] === "--source-dir" && args[1]) {
    const commit = (args[2] || path.basename(path.resolve(args[1]))).trim();
    const { text, pack, sources, stats } = compile(args[1], commit);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pack.json"), text);
    fs.copyFileSync(path.join(root, "data", "forever-loot", "LICENSE"), path.join(dir, "LICENSE"));
    const c = counts(pack);
    fs.writeFileSync(path.join(dir, "source-lock.json"), JSON.stringify({ publisher: "Efficient Games", repository: "JIVESCORP/eg-link-output-wowf", commit, builds: pack.builds, license: "CC BY 4.0", attribution: ATTRIBUTION, files: FILES, sources,
      normalization: "Rares: client creature classification 4 or 2, newest named build wins; observed level range, up to 4 places (1% squares) and up to 5 looted non-quest drops. Nodes, chests and mailboxes: approached objects of the matching type, places rounded to 0.5% squares (mailboxes 1.5%).",
      crossCheck: { observedRareCreatures: stats.observedRare, alsoClassifiedRare: stats.observedRareAgree, classifiedRareSeenAsNormal: stats.classifiedRareSeenNormal },
      counts: c, bytes: Buffer.byteLength(text), sha256: hash(text) }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "NOTICE"), [
      "Backstage Forever world finds reference", "", ATTRIBUTION, "License: https://creativecommons.org/licenses/by/4.0/", "",
      `Source: JIVESCORP/eg-link-output-wowf commit ${commit}, builds ${pack.builds.join(", ")}.`, "",
      "normalization: rare enemies are the creatures whose classification in the game client's own",
      "creature data is 4 (rare) or 2 (rare elite). Level range and places are kept only where a player",
      "met the creature; drops only where a kill was looted (quest items left out). Herb and ore spots,",
      "chests and mailboxes are objects players walked up to; herb and ore are told apart by node name.",
      "Places are rounded. They are past community observations, not live spawns and not complete.",
      "The license does not grant rights in Blizzard narrative text or game assets.", "",
    ].join("\n"));
    console.log(`Wrote ${JSON.stringify(c)} (${Buffer.byteLength(text)} bytes). Cross-check: ${JSON.stringify(stats)}`);
  } else throw Error("Use --source-dir <dir> [commit] or --check");
}
module.exports = { compile, check, counts };

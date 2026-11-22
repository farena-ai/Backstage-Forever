"use strict";
// Writes addon/BackstageForever/BackstageForeverAtlasData.lua (1.20): the dungeons and raids of the
// Instance Atlas for the in-game window: level band, side, entrance, bosses in order and observed
// boss loot. Compiled offline from src/core/dungeon-atlas.cjs (our own baseline) and the bundled
// boss loot pack (Efficient Games, CC BY 4.0). Data only; --check verifies the committed file.
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const file = path.join(root, "addon", "BackstageForever", "BackstageForeverAtlasData.lua");
const MAX_LOOT = 8, MAX_QUESTS = 6;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';

function compile() {
  const { BASELINE, dungeonQuests, norm } = require("../src/core/dungeon-atlas.cjs");
  const pack = JSON.parse(fs.readFileSync(path.join(root, "data", "forever", "pack.json"), "utf8"));
  const loot = JSON.parse(fs.readFileSync(path.join(root, "data", "forever-boss-loot", "pack.json"), "utf8"));
  const rows = BASELINE.map(([id, name, kind, min, max, side, , mapId, at, , bosses]) => {
    if (!/^[a-z0-9]{2,8}$/.test(id) || !Number.isInteger(min) || !Number.isInteger(max) || min > max) throw Error(`Bad atlas row: ${id}`);
    const observed = new Map((loot.instances[id]?.bosses || []).map((b) => [b.name, b.items]));
    const list = bosses.map((boss) => {
      // "itemId~percent" joined with "|", best chance first.
      const items = (observed.get(boss) || []).filter((i) => Number.isSafeInteger(i.itemId) && i.chance > 0)
        .sort((a, b) => b.chance - a.chance || a.itemId - b.itemId).slice(0, MAX_LOOT)
        .map((i) => `${i.itemId}~${Math.max(1, Math.round(i.chance * 100))}`).join("|");
      return `{${luaString(boss)},${luaString(items)}}`;
    });
    const where = Number.isSafeInteger(mapId) && Array.isArray(at) && at.length === 2 ? `${mapId},${(at[0] / 100).toFixed(4)},${(at[1] / 100).toFixed(4)}` : "0,0,0";
    const letter = side === "Alliance" ? "A" : side === "Horde" ? "H" : "B";
    // Quests that send you inside (objectives or titles naming the place or a boss), for both sides.
    const quests = dungeonQuests(pack, new Set(bosses.map(norm)), null, name, { min, max }).slice(0, MAX_QUESTS).map((q) => {
      const sides = pack.quests[q.id]?.sides || [];
      const who = sides.length === 1 ? (sides[0] === "Alliance" ? "A" : "H") : "B";
      const g = q.giver && Number.isSafeInteger(q.giver.mapId) && Number.isFinite(q.giver.x) && Number.isFinite(q.giver.y) ? q.giver : null;
      return `{${q.id},${luaString(q.title)},${q.level || 0},${luaString(who)},${luaString(g ? g.name : "")},${g ? g.mapId : 0},${g ? g.x.toFixed(4) : 0},${g ? g.y.toFixed(4) : 0}}`;
    });
    return `{${luaString(id)},${luaString(name)},${luaString(kind === "raid" ? "r" : "d")},${min},${max},${luaString(letter)},${where},{${list.join(",")}},{${quests.join(",")}}},`;
  });
  return `-- Generated offline by scripts/build-addon-atlas.cjs; data only.
-- Level bands, entrances and boss order are Backstage Forever's own reference. Boss loot is observed
-- by players: data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
-- Historical observations, not guaranteed drops. Blizzard game content is excluded from that license.
-- Row: id, name, kind (d dungeon, r raid), min level, max level, side (A, H, B), entrance map, x, y,
-- bosses {name, "itemId~percent|..."}, quests to bring {id, title, level, side, giver, giver map, x, y}.
BackstageForeverAtlasData={
${rows.join("\n")}
}
`;
}

if (require.main === module) {
  const text = compile();
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== text) throw Error("Addon atlas data differs from its sources; run npm run build:addon-atlas.");
    console.log("Addon atlas data reproduction passed.");
  } else {
    fs.writeFileSync(file, text);
    console.log(`Wrote ${path.relative(root, file)} (${Buffer.byteLength(text)} bytes).`);
  }
}
module.exports = { compile };

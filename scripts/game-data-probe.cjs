"use strict";
// LOCAL-ONLY probe: reads item/spell/talent facts and a few icons from this machine's own
// WoW Forever install. Not part of any test run; prints nothing if the install is absent.
//   node scripts/game-data-probe.cjs ["F:\\WorldofWarcraft\\World of Warcraft"]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GameData } = require("../src/core/game-data.cjs");
const { bestReward, compare } = require("../src/core/gear-score.cjs");

const install = process.argv[2] || "F:\\WorldofWarcraft\\World of Warcraft";
if (!fs.existsSync(path.join(install, ".build.info"))) { console.log(`No WoW install at ${install}; nothing to probe.`); process.exit(0); }
const cacheDir = path.join(os.tmpdir(), "backstage-game-data-probe");
const g = new GameData({ getRoot: () => path.join(install, "_forever_"), cacheDir, idleMs: 50 });

let t = Date.now();
console.log("status", JSON.stringify(g.status()), `${Date.now() - t} ms`);
for (const id of [25, 2092, 4924, 6125, 12784, 1275]) console.log("item", JSON.stringify(g.item(id)));
for (const id of [133, 12294]) console.log("spell", JSON.stringify(g.spell(id)));

// A real quest with reward choices from the bundled quest reference.
const pack = require("../data/forever/pack.json");
const quest = Object.values(pack.quests).find((q) => q.rewards?.choices?.length >= 3 && q.rewards.choices.every((c) => g.item(c.itemId)?.stats?.length) && q.level >= 10 && q.level <= 25);
if (quest) {
  const choices = quest.rewards.choices.map((c) => ({ ...c, details: g.item(c.itemId) }));
  console.log(`quest ${quest.id} "${quest.title}" (level ${quest.level}) choices:`);
  for (const c of choices) console.log("  ", JSON.stringify({ id: c.itemId, name: c.details.name, slot: c.details.slot, kind: c.details.kind, armor: c.details.armor, stats: c.details.stats, dps: c.details.dps }));
  for (const ctx of [{ className: "Hunter", level: quest.level }, { className: "Warrior", level: quest.level }, { className: "Mage", level: quest.level }]) {
    const pick = bestReward(choices, ctx, {});
    console.log(`  pick for ${ctx.className} ${ctx.level}: ${pick.name} (${pick.reasons.join(", ")})`);
  }
}
const show = (label, a, b, ctx) => { const r = compare(g.item(a), b.map((x) => g.item(x)), ctx); console.log(`compare ${label}:`, JSON.stringify(r)); };
show("Warrior 20: Heavy Spiked Mace (2H) vs Compact Hammer", 4778, [1009], { className: "Warrior", level: 20 });
show("Rogue 20: Gloves of the Moon vs nothing", 5299, [], { className: "Rogue", level: 20 });
show("Priest 25: Deputy Chain Coat vs nothing", 1275, [], { className: "Priest", level: 25 });

t = Date.now();
const tree = g.talents("Warrior");
console.log("talents Warrior", `${Date.now() - t} ms`, tree.tabs.map((x) => `${x.name} (order ${x.order}, ${x.talents.length} talents, bg ${x.background})`).join("; "));
console.log("  first talent", JSON.stringify(tree.tabs[0].talents[0]));
const withPrereq = tree.tabs.flatMap((x) => x.talents).find((x) => x.prerequisites.length);
console.log("  with prerequisite", JSON.stringify(withPrereq));

const out = [];
for (const [name, fileId] of [["worn-shortsword", g.item(25).iconFileId], ["fireball", g.spell(133).iconFileId], ["arms-tab", tree.tabs[0].iconFileId]]) {
  const png = g.icon(fileId);
  if (!png) { console.log("icon", name, fileId, "unavailable"); continue; }
  const file = path.join(os.tmpdir(), `backstage-icon-${name}-${fileId}.png`);
  fs.writeFileSync(file, png);
  out.push(file);
  console.log("icon", name, fileId, `${png.length} bytes ->`, file);
}
const dir = g.buildDir(g.build());
for (const f of fs.readdirSync(dir)) { const st = fs.statSync(path.join(dir, f)); console.log("cache", path.join(dir, f), st.isDirectory() ? `${fs.readdirSync(path.join(dir, f)).length} files` : `${st.size} bytes`); }
g.release();

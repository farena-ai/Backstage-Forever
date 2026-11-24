"use strict";
// Route variants (roadmap Q8): the guided route engine (guided-route.cjs) with a few choices the
// player picks per character. Pure and deterministic. Every choice uses only what the bundled
// data really holds:
//  - "elite target": a kill objective whose creature the creature pack marks elite, boss or skull;
//  - "dungeon quest": a quest whose objective or text names a dungeon or one of its bosses;
//  - quest level and the level you need to accept it.
// The data has no "group quest" mark, no cave or indoor mark and no pull sizes, and each variant
// says so in `cannot`. The solo route is today's route, byte for byte.
const VARIANT_IDS = Object.freeze(["solo", "duo", "dungeons", "trips", "careful"]);
const CAREFUL_ABOVE = 1;
const VARIANTS = Object.freeze([
  { id: "solo", name: "Solo", changes: "The route as it ships: quests up to 2 levels above you, zone by zone, each round walked nearest-first.",
    cannot: "It does not know which quests need a group. Quests with elite targets stay in; skip the ones you cannot do alone." },
  { id: "duo", name: "Duo", changes: "For two players: quests up to 3 levels above you, and in each round the quests with elite targets and the dungeon quests are done first.",
    cannot: "The data has no group-quest mark. Only quests whose kill target is marked elite, and quests that name a dungeon, are known." },
  { id: "dungeons", name: "Dungeon-heavy", changes: "Adds a visit to each dungeon two levels into its level range. Its known quests are held back and picked up right before the visit.",
    cannot: "It cannot find you a group and does not know how long a run takes. Dungeon quests are found by a boss or dungeon name in the quest, so some are missed." },
  { id: "trips", name: "Fewest trips", changes: "Bigger rounds: two more quest levels per round, givers standing close together become one stop, and quests for the same person are handed in together.",
    cannot: "It does not know your bag space or walking times. Bigger rounds mean more quests in your log at once (the log holds 20)." },
  { id: "careful", name: "Careful", changes: `For one-life play: leaves out quests with elite targets and dungeon quests, takes nothing more than ${CAREFUL_ABOVE} level above where the route expects you to be, and reaches further down for easier quests.`,
    cannot: "It does not know caves, patrols, pull sizes or how hard a fight is. Most elite quests are not marked in the data: read each quest before you go." },
].map(Object.freeze));
const variantId = (v) => (VARIANT_IDS.includes(v) ? v : "solo");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** The dungeons a route can visit, from the atlas baseline rows (raids are left out). */
function dungeonList(baseline = []) {
  return baseline.filter((r) => Array.isArray(r) && r[2] === "dungeon" && Number.isInteger(r[3]) && Number.isInteger(r[4]) && Number.isSafeInteger(r[7]) && Array.isArray(r[8]))
    .map((r) => ({ key: r[0], name: r[1], min: r[3], max: r[4], faction: r[5] === "Horde" || r[5] === "Alliance" ? r[5] : null, mapId: r[7], x: r[8][0] / 100, y: r[8][1] / 100, bosses: (r[10] || []).map(norm).filter(Boolean) }));
}
/**
 * What the data says about each quest: Map questId -> { elite?: true, dungeon?: key }.
 * pack: the quest reference; creatures: the creature pack's rows; dungeons: dungeonList().
 */
function questFlags(pack, creatures = [], dungeons = []) {
  const strong = new Set((creatures || []).filter((c) => c && (c.elite || c.worldboss || c.skull)).map((c) => c.id));
  const flags = new Map();
  for (const q of Object.values(pack?.quests || {})) {
    const f = {};
    const targets = (q.objectives || []).filter((o) => o.type === "monster");
    if (targets.some((o) => strong.has(o.objectId))) f.elite = true;
    const names = targets.map((o) => norm(pack.creatures?.[String(o.objectId)]?.name)).filter(Boolean);
    const text = norm(`${q.objectiveEvidence || ""} ${q.title || ""}`);
    for (const d of dungeons) {
      // Near the dungeon's own levels only: a level-6 errand that mentions a boss is not a dungeon quest.
      if (!q.level || q.level < d.min - 6 || q.level > d.max + 3) continue;
      const place = norm(d.name);
      if (names.some((n) => d.bosses.includes(n)) || (place.length > 4 && text.includes(place)) || d.bosses.some((b) => b.length > 4 && text.includes(b))) { f.dungeon = d.key; break; }
    }
    if (f.elite || f.dungeon) flags.set(q.id, f);
  }
  return flags;
}
/** The engine settings for one variant; null for solo, so the shipped route is untouched. */
function tuneFor(variant, { flags = new Map(), dungeons = [] } = {}) {
  switch (variantId(variant)) {
    case "duo": return { flags, above: 3, order: "group" };
    case "dungeons": return { flags, dungeons };
    case "trips": return { flags, batch: 2, hub: 0.03 };
    case "careful": return { flags, above: CAREFUL_ABOVE, below: 6, keep: (q) => !q.elite && !q.dungeon };
    default: return null;
  }
}
/** Plain numbers for the chooser: what this variant really did to one built route. */
function summary(route, flags = new Map()) {
  const steps = route?.steps || [], ids = new Set(steps.flatMap((s) => s.ids || []));
  let elite = 0, dungeon = 0;
  for (const id of ids) { const f = flags.get(id); if (f?.elite) elite++; if (f?.dungeon) dungeon++; }
  return { steps: steps.length, quests: ids.size, eliteQuests: elite, dungeonQuests: dungeon, dungeonVisits: steps.filter((s) => s.kind === "dungeon").length,
    stops: steps.filter((s) => s.kind === "pickup" || s.kind === "turnin").length, reachesLevel: route?.reachesLevel ?? null };
}
module.exports = { VARIANTS, VARIANT_IDS, CAREFUL_ABOVE, variantId, dungeonList, questFlags, tuneFor, summary };

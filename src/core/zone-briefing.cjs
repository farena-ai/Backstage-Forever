"use strict";
// Zone briefing: "you are here" in one card. Everything useful about the zone the character is in,
// for their level and faction, nearest first. Built only from bundled reference packs and the map.
const { MAP_NAMES } = require("./map-names.cjs");

const dist = (a, b) => (a && b && Number.isFinite(a.x) && Number.isFinite(b.x) ? Math.hypot(a.x - b.x, a.y - b.y) : 9);
const friendly = (faction, side) => !faction || !side || side === "Both" || side === faction;
const reacts = (faction, r) => !faction || !r || (r[faction] || []).some((v) => v >= 4) || !Object.keys(r).length;
const spot = (mapId, row) => (row?.positions || []).find((p) => p.mapId === mapId) || null;
const place = (label, sub, p, npcId = null) => ({ label, sub, x: +p.x.toFixed(4), y: +p.y.toFixed(4), npcId });

function nearest(rows, here, n = 1) {
  return rows.filter(Boolean).sort((a, b) => dist(a, here) - dist(b, here)).slice(0, n);
}

/**
 * @param build   WorldMap.build() for the zone
 * @param profile the character (level, faction, className)
 * @param band    { min, max } from the leveling table, or null
 * @param packs   { knowledge: forever pack, insights, vendors }
 */
function zoneBriefing({ build, profile, band = null, packs = {} }) {
  if (!build?.mapId) return null;
  const mapId = build.mapId, faction = profile?.faction === "Horde" || profile?.faction === "Alliance" ? profile.faction : null;
  const here = build.player?.live || build.player?.saved || null;
  const pins = (build.pins || []).filter((p) => !p.otherFaction);
  const quests = pins.filter((p) => p.kind === "quest-giver");
  const flights = nearest(pins.filter((p) => p.kind === "flight").map((p) => place(p.label, p.sub || "Flight master", p, p.npcId)), here, 2);
  const inns = nearest(Object.values(packs.knowledge?.npcs || {}).filter((n) => /^Innkeeper /.test(n.name) && friendly(faction, n.side)).map((n) => { const p = spot(mapId, n); return p && place(n.name, "Innkeeper: set your Hearthstone here", p, n.id); }), here, 1);
  const cls = profile?.className ? `${profile.className} Trainer`.toLowerCase() : null;
  const trainers = (packs.insights?.trainers || []).filter((t) => reacts(faction, t.observedReactionsByFaction));
  const classTrainers = cls ? nearest(trainers.filter((t) => String(t.title).toLowerCase() === cls).map((t) => { const p = spot(mapId, t); return p && place(t.name, t.title, p, t.id); }), here, 1) : [];
  const professionTrainers = nearest(trainers.filter((t) => t.trainerType === 2 || /trainer|journeyman|expert|artisan|cook|skinner|miner|herbalist|fisher/i.test(t.title)).filter((t) => String(t.title).toLowerCase() !== cls && !/^(priest|mage|warrior|warlock|shaman|druid|hunter|rogue|paladin|pet|portal) trainer$/i.test(t.title) && t.title !== "Weapon Master").map((t) => { const p = spot(mapId, t); return p && place(t.name, t.title, p, t.id); }), here, 2);
  const repairs = nearest((packs.vendors?.vendors || []).filter((v) => v.repairs && reacts(faction, v.observedReactionsByFaction)).map((v) => { const p = spot(mapId, v); return p && place(v.name, "Repairs your gear", p, v.id); }), here, 2);
  // Dangerous ground: elite or much higher-level objective areas, one per creature.
  const seen = new Set(), danger = [];
  for (const a of build.areas || []) {
    const c = a.creature, name = c?.name || null;
    if (!name || seen.has(name)) continue;
    const lo = c.minLevel || 0, hi = c.maxLevel || lo;
    const elite = Boolean(c.elite || c.skull || c.worldboss), high = lo && profile?.level && lo >= profile.level + 3;
    if (!elite && !high) continue;
    seen.add(name);
    danger.push({ ...place(name, `${elite ? "Elite" : "Higher level"}${lo ? ` · level ${lo}${hi !== lo ? `–${hi}` : ""}` : ""}${a.questTitle ? ` · for “${a.questTitle}”` : ""}`, a), elite });
    if (danger.length >= 3) break;
  }
  return {
    mapId, name: build.mapName || MAP_NAMES[mapId] || `Map ${mapId}`,
    band: band ? { min: band.min, max: band.max } : null,
    fit: band && profile?.level ? (profile.level < band.min ? "low" : profile.level > band.max ? "high" : "right") : null,
    questsForYou: quests.length,
    objectiveAreas: (build.areas || []).length,
    hub: quests.length ? (() => { const h = require("./leveling.cjs").hubOf(quests); return h && { x: +h.x.toFixed(4), y: +h.y.toFixed(4), quests: h.count }; })() : null,
    flights, inns, classTrainers, professionTrainers, repairs, danger,
    live: Boolean(build.player?.live),
  };
}
module.exports = { zoneBriefing };

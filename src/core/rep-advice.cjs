"use strict";
// Reputation advice (1.3, J12): for each faction a character knows, the quests that raise it the
// most and that this character can still do, and what the next standing brings. Quests and their
// reputation rewards come from the bundled Forever quest data; standings from the character's save.
const { MAP_NAMES } = require("./companion-tools.cjs");

// Quest reputation tiers (QuestFactionReward): tier -> reputation points before bonuses.
const TIER_POINTS = Object.freeze({ 1: 10, 2: 25, 3: 75, 4: 150, 5: 250, 6: 350, 7: 500, 8: 1000, 9: 5 });
const STANDING = Object.freeze({ 1: "Hated", 2: "Hostile", 3: "Unfriendly", 4: "Neutral", 5: "Friendly", 6: "Honored", 7: "Revered", 8: "Exalted" });
// Home cities: Honored gives a vendor discount there, Exalted lets the other races of that side ride its mounts.
const CITIES = Object.freeze({ 72: "Stormwind", 47: "Ironforge", 69: "Darnassus", 54: "Gnomeregan Exiles", 76: "Orgrimmar", 81: "Thunder Bluff", 68: "Undercity", 530: "Darkspear Trolls" });
function unlockOf(factionId, standing) {
  const city = CITIES[factionId];
  if (standing === 6) return city ? `Honored: 10% off at ${city} vendors.` : "Honored: a discount with this faction's vendors.";
  if (standing === 8) return city ? `Exalted: ${city}'s mounts for any race of your side.` : "Exalted: the top standing, and this faction's best rewards.";
  if (standing === 7) return "Revered: this faction's rarer rewards.";
  if (standing === 5) return "Friendly: this faction's vendors and quests open up.";
  return null;
}
const sideOk = (q, faction) => !faction || !Array.isArray(q.sides) || !q.sides.length || q.sides.includes(faction);
function giverPlace(pack, q) {
  const npcOf = (x) => x && pack?.npcs?.[`${x.kind || "npc"}:${x.id}`];
  const g = (q.givers || []).find(npcOf) || (q.turnIns || []).find(npcOf);
  const npc = npcOf(g);
  const pos = npc?.positions?.[0];
  return npc ? { name: npc.name || null, mapId: pos?.mapId ?? null, zone: pos ? MAP_NAMES[pos.mapId] || null : null, x: pos?.x ?? null, y: pos?.y ?? null } : null;
}
/**
 * The best quests per faction for one character.
 * @returns {{factions: Array<{id,name,standing,standingName,toNext,next,nextUnlock,quests:Array}>}|null}
 */
function repAdvice(profile, pack, { perFaction = 5 } = {}) {
  const reps = profile?.ledger?.reputations;
  const factions = Array.isArray(reps) ? reps : Array.isArray(reps?.factions) ? reps.factions : [];
  if (!factions.length || !pack?.quests) return null;
  const level = Number(profile.level) || 1, faction = profile.faction === "Alliance" || profile.faction === "Horde" ? profile.faction : null;
  const done = new Set(profile?.history?.completedIdsKnown ? profile.history.completedIds : []);
  const byFaction = new Map();
  for (const q of Object.values(pack.quests)) {
    for (const r of q?.rewards?.reputation || []) {
      const points = TIER_POINTS[r.tier];
      if (!points || points < 25) continue;
      if (!byFaction.has(r.factionId)) byFaction.set(r.factionId, []);
      byFaction.get(r.factionId).push({ q, points });
    }
  }
  const out = [];
  for (const f of factions) {
    if (!f || f.standing >= 8) continue;
    const list = (byFaction.get(f.id) || [])
      .filter(({ q }) => !done.has(q.id) && sideOk(q, faction) && (Number(q.minLevel) || 1) <= level && (Number(q.level) || level) >= level - 12)
      // Quests with a known starting NPC first: one without is usually the middle of a chain.
      .sort((a, b) => b.points - a.points || (b.q.givers?.length ? 1 : 0) - (a.q.givers?.length ? 1 : 0) || Math.abs((a.q.level || level) - level) - Math.abs((b.q.level || level) - level) || a.q.id - b.q.id)
      .slice(0, perFaction)
      .map(({ q, points }) => ({ id: q.id, title: q.title, level: q.level || null, points, starts: Boolean(q.givers?.length), giver: giverPlace(pack, q) }));
    const toNext = Number.isFinite(f.max) && Number.isFinite(f.value) ? Math.max(0, f.max - f.value) : null;
    const next = Math.min(8, (f.standing || 4) + 1);
    out.push({ id: f.id, name: f.name, standing: f.standing, standingName: STANDING[f.standing] || null, toNext, next: STANDING[next], nextUnlock: unlockOf(f.id, next), quests: list,
      questPoints: list.reduce((s, x) => s + x.points, 0) });
  }
  out.sort((a, b) => (b.quests.length ? 1 : 0) - (a.quests.length ? 1 : 0) || (a.toNext ?? 1e9) - (b.toNext ?? 1e9));
  return { factions: out };
}
module.exports = { repAdvice, unlockOf, TIER_POINTS, CITIES };

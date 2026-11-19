"use strict";
// Smarter companion (0.47, roadmap 4.4): tools over everything the app already works out, so
// "what should I do tonight?" gets a concrete plan. Each tool returns a small summary of what a
// page shows (Now's next step, Zones, Sheet, All characters, this session); it never
// changes anything. Only offered when the player shares their character with the companion.
const DEFINITIONS = [
  { name: "plan_tonight", description: "Plan tonight's play session for the shared character: the next step, rested XP and level progress, session pace, zone progress, gear, bag space and other characters. Use it first for 'what should I do tonight', 'plan my session', 'what next'.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_zone_progress", description: "Zones for the character's faction near their level: level range, quests done out of the zone's quests, finished zones. Use for 'where should I level', 'which zones have I finished'.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_gear", description: "The character's gear summary from the last save: average item level, empty slots, weakest pieces to replace and upgrades already in bags or bank, plus saved gear sets.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_dungeons", description: "Check whether verified Forever dungeon recommendations are available. Do not substitute Classic or model knowledge when they are unavailable.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_characters", description: "All of the player's characters at a glance: level, class, rested XP grown since logout, gold, bag space, professions, days since played, and 'who to play tonight' suggestions with reasons.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_session", description: "This play session so far: minutes played, levels gained, levels per hour, minutes to the next level, deaths, zones visited, level-ups.", parameters: { type: "object", properties: {}, additionalProperties: false } },
];
const NAMES = new Set(DEFINITIONS.map((d) => d.name));

const safe = (fn) => { try { return fn() ?? null; } catch { return null; } };
const zonesNear = (t) => (t?.continents || []).flatMap((c) => c.zones).filter((z) => ["now", "soon"].includes(z.fit))
  .map((z) => ({ zone: z.name, levels: `${z.min}-${z.max}`, fit: z.fit, questsDone: z.done, quests: z.total, inLog: z.inLog, finished: z.mastered })).slice(0, 12);
function gear(s) {
  if (!s) return null;
  return { averageItemLevel: s.averageItemLevel ?? null, equipmentKnown: s.equipmentKnown, emptySlots: s.missing || [],
    weakest: (s.weakest || []).slice(0, 4).map((w) => ({ slot: w.label || w.slot, item: w.item?.name || null, itemLevel: w.item?.itemLevel ?? null })),
    upgradesInBags: (s.upgrades || []).slice(0, 4).map((u) => ({ slot: u.label || u.slot, item: u.item?.name || u.name || null, where: u.where || null })),
    sets: (s.sets || []).map((x) => x.name) };
}

function characters(v) {
  if (!v) return null;
  return { characters: v.cards.map((c) => ({ name: c.name, level: c.level, className: c.className, faction: c.faction, restedPercent: c.rested?.percent ?? null, gold: c.money === null ? null : Math.floor(c.money / 10000), freeBagSlots: c.bags?.free ?? null, professions: c.professions.map((p) => `${p.name} ${p.rank}/${p.maxRank}`), daysAway: c.daysAway, active: c.active })),
    tonight: v.tonight.map((t) => ({ name: t.name, reasons: t.reasons })) };
}
function session(s) {
  if (!s?.active) return { active: false };
  return { minutes: s.activeMinutes, startLevel: s.startLevel, level: s.level, levelsGained: s.levelsGained, levelsPerHour: s.levelsPerHour, minutesToLevel: s.minutesToLevel, deaths: s.deaths, zonesVisited: s.zones?.length ?? 0 };
}

/** views: name -> () => page data for the active character (the same functions the pages use). */
function createPlannerTools(views) {
  const v = (name) => safe(() => views?.[name]?.());
  const handlers = {
    plan_tonight() {
      const step = v("nextStep")?.step || null, alts = v("alts"), tracker = v("worldTracker"), sheet = v("characterSheet"), s = v("playSession");
      const me = alts?.cards?.find((c) => c.active) || null;
      return { status: "ok",
        nextStep: step ? { kind: step.kind, what: step.title, detail: step.detail, direction: step.dir, progress: step.progress || null } : null,
        character: me ? { name: me.name, level: me.level, levelPercent: me.xp?.percent ?? null, restedPercent: me.rested?.percent ?? null, restedFull: me.rested?.full ?? false, freeBagSlots: me.bags?.free ?? null } : null,
        session: session(s), zoneToClear: tracker?.suggestion || null, zonesNearYourLevel: zonesNear(tracker).slice(0, 5),
        gear: (() => { const g = gear(sheet); return g ? { emptySlots: g.emptySlots, weakest: g.weakest.slice(0, 2), upgradesInBags: g.upgradesInBags } : null; })(),
        otherCharacters: alts?.tonight?.filter((t) => !me || t.name !== me.name) || [],
        note: "Plan from these facts: say what to do first, then next, with names and directions. Rested XP doubles kill XP until it runs out." };
    },
    get_zone_progress() { const t = v("worldTracker"); return t ? { status: "ok", completedQuestsKnown: t.completedKnown, totals: t.totals, zones: zonesNear(t), next: t.suggestion } : { status: "unavailable" }; },
    get_gear() { const g = gear(v("characterSheet")); return g ? { status: "ok", ...g } : { status: "unavailable" }; },
    // Atlas reference rows do not qualify as evidence of suitability or access.
    get_dungeons() { return { status: "no-evidence", message: "No verified Forever dungeon recommendations are available. Do not infer access, level range, entrance, applicable quests or loot." }; },
    get_characters() { const c = characters(v("alts")); return c ? { status: "ok", ...c } : { status: "unavailable" }; },
    get_session() { return { status: "ok", ...session(v("playSession")) }; },
  };
  return { definitions: DEFINITIONS, has: (name) => NAMES.has(name), call: (name) => (NAMES.has(name) ? handlers[name]() : { status: "invalid" }) };
}
module.exports = { createPlannerTools, PLANNER_DEFINITIONS: DEFINITIONS };

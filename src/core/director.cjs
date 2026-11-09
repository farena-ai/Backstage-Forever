"use strict";
const { buildGuidance, validateGuidanceOptions } = require("./guidance.cjs");
const { validateQuestData } = require("./quest-data.cjs");
const { validateState, str } = require("./validation.cjs");
const { applyJourneyAction } = require("./journeys.cjs");

/** A local projection of existing guidance, never another quest database. */
function buildDirector(profile, guidance) {
  const p = profile || {}, quests = validateQuestData(p.quests);
  const byId = new Map((quests || []).map((q) => [q.id, q]));
  const location = p.location || null;
  const choices = (guidance?.status === "ready" ? guidance.candidates || guidance.steps : [])
    .slice(0, 25)
    .filter((s) => byId.has(s.questId))
    .map((step) => {
      const q = byId.get(step.questId);
      // A current-game position owns the phase even when a reference is nearer.
      const destination = step.destination || step.referenceDestination || null;
      const clue = !step.destination && destination?.evidence === "mentioned-in-objective";
      const sameMap = destination?.mapId !== undefined && destination.mapId === location?.mapId;
      const local = Boolean(step.destination && sameMap) || Boolean(q.zone && q.zone === location?.zone);
      const reference = !step.destination && !clue && sameMap;
      const priority = q.complete ? 0 : local ? 1 : reference ? 2 : 3;
      const distance = sameMap && !clue && [location?.x, location?.y, destination.x, destination.y].every(Number.isFinite)
        ? Math.hypot(destination.x - location.x, destination.y - location.y) : null;
      return {
        ...structuredClone(step), priority,
        sourceKind: step.destination ? "game-snapshot" : destination ? clue ? "reference-clue" : "reference" : "game-snapshot",
        distance,
        reason: q.complete ? "Reported ready to turn in in this saved snapshot."
          : local ? "Current game destination or observed objective zone matches your saved map or zone."
          : reference ? "Compatible approximate reference position on your saved map; a straight-line comparison only."
          : clue ? "A reference-mentioned NPC is a clue, not a verified destination."
          : Number.isInteger(q.level) && Number.isInteger(p.level) ? "Ordered by reported quest-level proximity, then quest ID."
          : "Continue the unfinished objectives reported by the game; location and level may be unknown.",
      };
    })
    .sort((a, b) => a.priority - b.priority ||
      (Number.isInteger(byId.get(a.questId).level) && Number.isInteger(p.level) ? Math.abs(byId.get(a.questId).level - p.level) : 10000) -
      (Number.isInteger(byId.get(b.questId).level) && Number.isInteger(p.level) ? Math.abs(byId.get(b.questId).level - p.level) : 10000) || a.questId - b.questId)
    .slice(0, 3);
  const status = guidance?.status === "unavailable" || !guidance ? "unavailable" : choices.length ? "ready" : "empty";
  const bags = p.readiness?.bags;
  return {
    version: 1, status,
    headline: choices.length ? "Choose your next observed quest action" : guidance?.headline || "Import a saved character snapshot for quest guidance.",
    character: { id: p.id ?? null, name: p.name || "Choose a character", realm: p.realm ?? null, className: p.className || null, level: p.level ?? null, race: p.race || null, faction: p.faction || null, location: location ? structuredClone(location) : null },
    freshness: guidance?.freshness ? structuredClone(guidance.freshness) : null,
    choices, primary: choices[0] || null, alternatives: choices.slice(1),
    preparation: p.source?.kind === "wow-addon" && bags?.total > 0 && bags.free < 5
      ? { kind: "bag-space", bags: structuredClone(bags), message: `${bags.free} of ${bags.total} bag slots were free in the saved snapshot.` } : null,
    privateGoals: (p.goals || []).filter((g) => !g.done).slice(0, 3).map((g) => ({ id: g.id, text: g.text })),
    session: { available: status === "ready" && p.source?.kind === "wow-addon" && Boolean(p.source.id && p.clientBuild && guidance.freshness?.updatedAt), maxChoices: choices.length },
    limitations: [...(guidance?.limitations || []), "Same-map distances are normalized straight-line comparisons, not travel times or verified routes.", "Unknown race, faction or location does not establish quest eligibility.", "Private goals are local display only; they are not automatically added to quest sessions or AI requests."],
  };
}

function createDirectorSession(state, profileId, options, { knowledge, now = Date.now(), id } = {}) {
  str(profileId, 100, false);
  const selected = state?.activeProfileId;
  const valid = validateState(state), settings = validateGuidanceOptions(options);
  const profile = valid.profiles.find((p) => p.id === profileId);
  if (selected !== profileId || !profile?.source || !profile.clientBuild)
    throw Error("Choose the current saved addon character for a quest session.");
  const director = buildDirector(profile, buildGuidance(profile, { ...settings, knowledge, now }));
  if (!director.session.available) throw Error("No actionable saved quest session is available.");
  const choices = director.choices.slice(0, { 15: 1, 30: 2, 60: 3 }[settings.minutes]);
  const title = `${profile.name} quest session`.slice(0, 100);
  const create = (base, hooks) => {
    let next = applyJourneyAction(base, { type: "create", title, template: "blank", profileId }, hooks);
    const journeyId = next.journeys.at(-1).id;
    for (const choice of choices)
      next = applyJourneyAction(next, { type: "add-quest", journeyId, profileId, questId: choice.questId }, hooks);
    return { state: next, journeyId };
  };
  // Ask the existing journey owner for exact proof fields without allocating real IDs.
  let stagedId = 0;
  const staged = create({ ...valid, journeys: [] }, { now, id: () => `director-baseline-${++stagedId}` }).state.journeys[0];
  const existing = valid.journeys.find((j) => j.steps.filter((s) => s.quest).length === staged.steps.length && staged.steps.every((expected) =>
    j.steps.some((s) => s.profileId === expected.profileId && s.quest &&
      Object.keys(expected.quest).every((key) => s.quest[key] === expected.quest[key]))));
  if (existing) return { state: structuredClone(valid), journeyId: existing.id, created: false };
  return { ...create(valid, { now, ...(id ? { id } : {}) }), created: true };
}
module.exports = { buildDirector, createDirectorSession };

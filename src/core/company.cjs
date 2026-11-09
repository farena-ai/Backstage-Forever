"use strict";
const { createHash } = require("node:crypto");
const { validateState } = require("./validation.cjs");

/** Local, last-saved facts only. Never copy source identity or private journals. */
function buildCompany(state, { now = Date.now() } = {}) {
  state = validateState(state);
  if (!Number.isFinite(now)) throw Error("Invalid company clock.");
  const profiles = new Map(state.profiles.map((p) => [p.id, p]));
  const hashes = new Map();
  const characters = state.profiles.map((p) => {
    const observed = p.source?.kind === "wow-addon";
    if (observed) hashes.set(p.id, createHash("sha256").update(p.source.id).digest("hex"));
    const savedAt = observed ? p.source.updatedAt : null;
    const ageMs = savedAt === null ? null : now - Date.parse(savedAt);
    const known = observed && Array.isArray(p.quests);
    const pending = p.goals.filter((g) => !g.done);
    return {
      id: p.id, name: p.name, realm: p.realm, className: p.className,
      race: p.race ?? null, faction: p.faction ?? null, level: p.level,
      source: {
        kind: observed ? "saved-addon" : "manual", savedAt, ageMs,
        freshness: ageMs === null ? "unknown" : ageMs < 0 ? "future" : ageMs > 86400000 ? "old" : "recent",
        label: observed ? "Last saved addon snapshot" : "Manual character",
      },
      quests: {
        known, count: known ? p.quests.length : null,
        ready: known ? p.quests.filter((q) => q.complete).length : null,
        items: known ? p.quests.map((q) => ({ id: q.id, title: q.title, ready: q.complete, trackable: Boolean(p.clientBuild) })) : [],
      },
      history: {
        known: observed && p.history?.completedIdsKnown === true,
        completedCount: observed && p.history?.completedIdsKnown === true ? p.history.completedIds.length : null,
      },
      bags: observed && p.readiness?.bags?.total > 0 ? structuredClone(p.readiness.bags) : null,
      equipment: observed && p.readiness?.equipment !== undefined ? structuredClone(p.readiness.equipment) : null,
      goals: { pending: pending.length, previews: pending.slice(0, 3).map((g) => g.text) },
    };
  });
  const totals = {
    characters: characters.length,
    observedProfiles: characters.filter((c) => c.source.kind === "saved-addon").length,
    questLogsKnown: characters.filter((c) => c.quests.known).length,
    questLogsUnknown: characters.filter((c) => !c.quests.known).length,
    quests: characters.reduce((n, c) => n + (c.quests.count ?? 0), 0),
    ready: characters.reduce((n, c) => n + (c.quests.ready ?? 0), 0),
    goalsPending: characters.reduce((n, c) => n + c.goals.pending, 0),
  };
  const journeys = state.journeys.map((j) => ({
    id: j.id, title: j.title, createdAt: j.createdAt,
    steps: j.steps.map((s) => {
      const p = profiles.get(s.profileId);
      let tracking = s.profileId === null ? "unassigned" : !p ? "orphan" : "manual";
      if (s.quest && p) {
        tracking = !p.source || !p.clientBuild ? "unknown"
          : hashes.get(p.id) !== s.quest.sourceHash ? "identity-mismatch"
          : p.clientBuild !== s.quest.build ? "build-mismatch" : "tracked";
      }
      const ready = Boolean(s.quest && tracking === "tracked" && p.quests?.find((q) => q.id === s.quest.id)?.complete);
      const historical = tracking !== "tracked";
      return {
        id: s.id, text: s.text, done: s.done, profileId: s.profileId,
        profileName: p?.name ?? null,
        completion: s.observed ? "observed" : s.done ? "manual" : "pending",
        tracking, ready,
        quest: s.quest ? { id: s.quest.id, build: s.quest.build } : null,
        baselineSavedAt: s.quest?.baselineAt ?? null,
        observed: s.observed ? { ...s.observed, build: s.quest.build, historical } : null,
        sourceLabel: s.observed ? historical ? "Historical saved completion" : "Observed in a newer saved snapshot"
          : s.done ? "Manually checked" : ready ? "Saved ready to turn in; not turned in" : s.quest ? "Tracking saved quest evidence" : "Manual checklist",
      };
    }),
  }));
  // Stable local-ID ties make suggestions independent of active selection/order.
  const ranked = [...characters].sort((a, b) => (b.quests.ready ?? 0) - (a.quests.ready ?? 0) || b.goals.pending - a.goals.pending || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const candidate = ranked.find((c) => c.quests.ready > 0 || c.goals.pending > 0);
  const recommendation = candidate ? {
    profileId: candidate.id,
    reason: candidate.quests.ready > 0 ? "ready-turn-ins" : "unfinished-goals",
    text: candidate.quests.ready > 0 ? `${candidate.quests.ready} ready quest(s) in the last saved log.` : `${candidate.goals.pending} unfinished private goal(s).`,
  } : null;
  return {
    characters, totals, journeys, recommendation,
    limitations: ["Only collected characters and their last saved observations are shown.", "Unknown quest logs and manual characters are excluded from quest totals.", "Ready quests are not turned in. Suggestions do not select a character or establish routes, dungeon eligibility or equipment upgrades."],
  };
}
module.exports = { buildCompany };

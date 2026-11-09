"use strict";
const {
  validateQuestData,
  validateProgress,
  validateHistory,
} = require("./quest-data.cjs");
function buildBrief(
  profile,
  { now = Date.now(), minutes = 30, focus = "balanced", knowledge } = {},
) {
  const p = profile || {};
  const quests = validateQuestData(p.quests),
    xp = validateProgress(p.progress);
  const updatedAt = p.source?.updatedAt;
  const stamp = Date.parse(updatedAt);
  const ageMinutes = Number.isFinite(stamp)
    ? Math.max(0, Math.floor((Number(now) - stamp) / 60000))
    : null;
  const status =
    ageMinutes === null ? "unknown" : ageMinutes > 15 ? "stale" : "fresh";
  const ready = quests?.filter((q) => q.complete) || [];
  const actions = [];
  if (ready.length)
    actions.push({
      id: "turn-ins",
      label: "Review ready quests",
      prompt: `Help me review these observed turn-in-ready quests: ${ready.map((q) => q.title).join("; ")}. Do not invent NPCs or routes; ask for missing details.`,
    });
  if (quests?.length)
    actions.push({
      id: "quest-plan",
      label: "Plan my quest session",
      prompt: `Help me plan a non-combat quest session as a level ${p.level || "?"} ${p.className || "adventurer"}, using only my observed quest objectives. Ask about missing locations instead of inventing routes.`,
    });
  actions.push({
    id: "class-plan",
    label: `Plan for my ${p.className || "character"}`,
    prompt: `Help me plan exploration, professions or a journal checklist for my level ${p.level || "?"} ${p.className || "character"}. Ask what I want to focus on. Do not choose combat actions.`,
  });
  return {
    character: {
      name: p.name || "Choose a character",
      className: p.className || "",
      level: p.level || null,
      zone: p.location?.zone || null,
    },
    freshness: {
      status,
      updatedAt: updatedAt || null,
      ageMinutes,
      message:
        status === "unknown"
          ? "Snapshot time unavailable."
          : status === "stale"
            ? "Saved snapshot is older than 15 minutes; reload or log out to export newer desktop data."
            : "Recent saved snapshot; game changes appear after reload or logout.",
    },
    quests: {
      known: quests !== undefined,
      items: (quests || []).map((q) =>
        knowledge ? { ...q, knowledge: knowledge.details(p, q.id) } : q,
      ),
      ready,
      count: quests?.length ?? null,
      message:
        quests === undefined
          ? "Quest data unavailable."
          : quests.length
            ? `${quests.length} observed quests; ${ready.length} ready to turn in.`
            : "Quest log was observed empty.",
    },
    history:
      p.history === undefined
        ? {
            known: false,
            recent: [],
            message: "Completion history unavailable.",
          }
        : {
            known: true,
            ...validateHistory(p.history),
            message:
              "Recent turn-ins observed while this addon was tracking; older quest names are unknown.",
          },
    progress: xp
      ? {
          known: true,
          ...xp,
          percent: xp.max ? Math.round((xp.current / xp.max) * 100) : null,
          remaining: xp.max - xp.current,
          message: xp.max
            ? `${xp.current} / ${xp.max} XP`
            : "No level XP requirement reported.",
        }
      : { known: false, message: "Experience data unavailable." },
    guidance: require("./guidance.cjs").buildGuidance(p, {
      now,
      minutes,
      focus,
      knowledge,
    }),
    readiness:
      p.readiness === undefined
        ? { known: false, message: "Preparation data unavailable." }
        : {
            known: true,
            ...require("./readiness.cjs").validateReadiness(p.readiness),
            message:
              "Preparation observed in the saved snapshot; this is not a gear recommendation.",
          },
    actions,
  };
}
module.exports = { buildBrief };

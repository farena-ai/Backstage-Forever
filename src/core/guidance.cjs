"use strict";
const { validateQuestData } = require("./quest-data.cjs");
function validateGuidanceOptions(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !["minutes", "focus"].includes(k))
  )
    throw Error("Invalid guidance options.");
  const { minutes = 30, focus = "balanced" } = value;
  if (
    ![15, 30, 60].includes(minutes) ||
    !["balanced", "nearby", "turn-ins"].includes(focus)
  )
    throw Error("Invalid guidance options.");
  return { minutes, focus };
}
function snapshotFreshness(profile, now = Date.now()) {
  const updatedAt =
    profile?.source?.kind === "wow-addon" ? profile.source.updatedAt : null;
  const stamp = Date.parse(updatedAt);
  const ageMinutes = Number.isFinite(stamp)
    ? Math.max(0, Math.floor((Number(now) - stamp) / 60000))
    : null;
  const status =
    ageMinutes === null ? "unknown" : ageMinutes > 15 ? "stale" : "fresh";
  return {
    status,
    updatedAt: Number.isFinite(stamp) ? updatedAt : null,
    ageMinutes,
    message:
      status === "unknown"
        ? "Snapshot time unavailable."
        : status === "stale"
          ? "Saved snapshot is older than 15 minutes; reload or log out to export newer desktop data."
          : "Recent saved snapshot; game changes appear after reload or logout.",
  };
}
function buildGuidance(
  profile,
  { now = Date.now(), minutes = 30, focus = "balanced" } = {},
) {
  validateGuidanceOptions({ minutes, focus });
  if (!Number.isFinite(Number(now))) throw Error("Invalid guidance time.");
  const quests = validateQuestData(profile?.quests);
  const freshness = snapshotFreshness(profile, now);
  const known = quests !== undefined && freshness.updatedAt !== null;
  const ready = known ? quests.filter((q) => q.complete).length : null;
  const local = (q) =>
    Boolean(
      (q.destination?.mapId !== undefined &&
        q.destination.mapId === profile?.location?.mapId) ||
        (q.zone && q.zone === profile?.location?.zone),
    );
  const levelDistance = (q) =>
    Number.isInteger(q.level) && Number.isInteger(profile?.level)
      ? Math.abs(q.level - profile.level)
      : 10000;
  const candidates = known
    ? quests.filter(
        (q) =>
          q.complete ||
          (focus !== "turn-ins" &&
            (focus !== "nearby" || local(q)) &&
            q.objectives.some((o) => !o.done)),
      )
    : [];
  candidates.sort(
    (a, b) =>
      Number(b.complete) - Number(a.complete) ||
      Number(local(b)) - Number(local(a)) ||
      levelDistance(a) - levelDistance(b) ||
      a.id - b.id,
  );
  const steps = candidates
    .slice(0, { 15: 3, 30: 5, 60: 8 }[minutes])
    .map((q) => ({
      questId: q.id,
      title: q.title,
      kind: q.complete ? "turn-in" : "objective",
      reason: q.complete
        ? "Reported ready to turn in in this saved snapshot."
        : local(q)
          ? "Observed in your reported zone or map."
          : "Continue the unfinished objectives reported by the game.",
      objectives: q.complete
        ? q.objectives
        : q.objectives.filter((o) => !o.done),
      ...(q.destination ? { destination: q.destination } : {}),
      source: {
        kind: "game-snapshot",
        observedAt: freshness.updatedAt,
        questId: q.id,
      },
    }));
  const status = !known ? "unavailable" : steps.length ? "ready" : "empty";
  return {
    version: 1,
    status,
    headline:
      status === "unavailable"
        ? "Import a saved character snapshot for quest guidance."
        : steps.length
          ? `${steps.length} observed quest actions for your session`
          : quests.length
            ? focus === "nearby"
              ? "No unfinished quests in your reported zone or map, or ready turn-ins, were reported. Try Balanced."
              : focus === "turn-ins"
                ? "No quests were reported ready to turn in. Try Balanced for unfinished objectives."
                : "No matching unfinished actions were reported."
            : "Your observed quest log is empty.",
    freshness,
    steps,
    counts: {
      observed: known ? quests.length : null,
      ready,
      actionable: known ? candidates.length : null,
      shown: steps.length,
    },
    limitations: [
      "Only quests and objectives observed in the saved game snapshot are available.",
      "This is not a complete quest database or a verified travel route.",
      "Session length limits the number of cards; it does not estimate completion time.",
      "Game changes reach the desktop after reload or logout.",
    ],
  };
}
module.exports = { buildGuidance, validateGuidanceOptions, snapshotFreshness };

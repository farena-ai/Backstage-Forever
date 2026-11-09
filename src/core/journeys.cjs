"use strict";
const { validateCapture } = require("./quest-data.cjs");
const crypto = require("node:crypto");

function fail() {
  throw Error(
    "Invalid journey data. Please check the selected plan or backup.",
  );
}
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail();
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail();
  return value;
}
function time(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
  return value;
}
function questId(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) fail();
  return value;
}

function validateJourneys(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) fail();
  const parents = new Set(),
    steps = new Set();
  for (const journey of value) {
    object(journey, ["id", "title", "createdAt", "steps"]);
    text(journey.id, 100);
    text(journey.title, 100);
    time(journey.createdAt);
    if (
      parents.has(journey.id) ||
      !Array.isArray(journey.steps) ||
      journey.steps.length > 50
    )
      fail();
    parents.add(journey.id);
    for (const step of journey.steps) {
      object(step, ["id", "text", "done", "profileId", "quest", "observed"]);
      text(step.id, 100);
      text(step.text, 300);
      if (steps.has(step.id) || typeof step.done !== "boolean") fail();
      steps.add(step.id);
      if (step.profileId !== null) text(step.profileId, 100);
      if (step.quest !== undefined) {
        const q = step.quest;
        object(q, [
          "id",
          "build",
          "sourceHash",
          "baselineAt",
          "baselineCompleted",
          "baselineTurnInAt",
        ]);
        questId(q.id);
        text(q.build, 100);
        validateCapture({ clientBuild: q.build });
        if (
          typeof q.sourceHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(q.sourceHash) ||
          step.profileId === null
        )
          fail();
        time(q.baselineAt);
        if (
          q.baselineCompleted !== null &&
          typeof q.baselineCompleted !== "boolean"
        )
          fail();
        if (
          q.baselineTurnInAt !== null &&
          Date.parse(time(q.baselineTurnInAt)) > Date.parse(q.baselineAt)
        )
          fail();
      }
      if (step.observed !== undefined) {
        object(step.observed, ["at", "via"]);
        const q = step.quest,
          o = step.observed;
        time(o.at);
        if (
          !q ||
          !["turn-in", "completed-id"].includes(o.via) ||
          Date.parse(o.at) <= Date.parse(q.baselineAt)
        )
          fail();
        if (o.via === "completed-id" && q.baselineCompleted !== false) fail();
        if (
          o.via === "turn-in" &&
          q.baselineTurnInAt !== null &&
          Date.parse(o.at) <= Date.parse(q.baselineTurnInAt)
        )
          fail();
      }
    }
  }
  return structuredClone(value);
}

function sourceHash(profile) {
  return crypto.createHash("sha256").update(profile.source.id).digest("hex");
}
function membership(profile, id) {
  if (profile.history?.completedIdsKnown !== true) return null;
  const ids = profile.history.completedIds;
  let lo = 0,
    hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (ids[mid] === id) return true;
    if (ids[mid] < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
function latestTurnIn(profile, id) {
  const saved = Date.parse(profile.source.updatedAt);
  let newest = null;
  for (const event of profile.history?.recent ?? []) {
    const ms = event.completedAt * 1000;
    if (event.id === id && ms <= saved && (newest === null || ms > newest))
      newest = ms;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

const actionKeys = {
  create: ["title", "template", "profileId"],
  rename: ["journeyId", "title"],
  remove: ["journeyId"],
  "add-note": ["journeyId", "text", "profileId"],
  "add-quest": ["journeyId", "profileId", "questId"],
  "edit-step": ["journeyId", "stepId", "text", "profileId"],
  "set-done": ["journeyId", "stepId", "done"],
  "remove-step": ["journeyId", "stepId"],
};
const templates = {
  blank: [],
  "quest-session": [
    "Choose quests for this session",
    "Prepare bag space and supplies",
    "Review saved quest progress after playing",
  ],
  "dungeon-prep": [
    "Choose a dungeon with your group",
    "Review your equipment and supplies",
    "Make room in your bags",
  ],
};
function applyJourneyAction(
  state,
  action,
  { now = Date.now(), id = crypto.randomUUID } = {},
) {
  object(action, ["type", ...Object.values(actionKeys).flat()]);
  if (
    typeof action.type !== "string" ||
    !Object.hasOwn(actionKeys, action.type)
  )
    fail();
  object(action, ["type", ...actionKeys[action.type]]);
  const next = structuredClone(state);
  next.journeys = validateJourneys(state.journeys);
  const usedIds = new Set(
    next.journeys.flatMap((j) => [j.id, ...j.steps.map((s) => s.id)]),
  );
  function newId() {
    const value = text(id(), 100);
    if (usedIds.has(value)) fail();
    usedIds.add(value);
    return value;
  }
  function assignment(value) {
    if (value === null) return null;
    text(value, 100);
    if (!next.profiles.some((p) => p.id === value)) fail();
    return value;
  }
  if (action.type === "create") {
    const title = text(action.title, 100).trim(),
      template = action.template === undefined ? "blank" : action.template;
    if (
      typeof template !== "string" ||
      !Object.hasOwn(templates, template) ||
      next.journeys.length >= 20
    )
      fail();
    const profileId =
      action.profileId === undefined ? null : assignment(action.profileId);
    if (!Number.isFinite(now)) fail();
    const createdAt = time(new Date(now).toISOString());
    const journey = { id: newId(), title, createdAt, steps: [] };
    journey.steps = templates[template].map((text) => ({
      id: newId(),
      text,
      done: false,
      profileId,
    }));
    next.journeys.push(journey);
  } else {
    text(action.journeyId, 100);
    const journey = next.journeys.find((j) => j.id === action.journeyId);
    if (!journey) fail();
    if (action.type === "rename")
      journey.title = text(action.title, 100).trim();
    else if (action.type === "remove")
      next.journeys = next.journeys.filter((j) => j !== journey);
    else if (action.type === "add-note" || action.type === "add-quest") {
      if (journey.steps.length >= 50) fail();
      const profileId =
        action.type === "add-quest"
          ? assignment(action.profileId)
          : action.profileId === undefined
            ? null
            : assignment(action.profileId);
      const step = { id: newId(), text: "", done: false, profileId };
      if (action.type === "add-note") step.text = text(action.text, 300).trim();
      else {
        const profile = next.profiles.find((p) => p.id === profileId);
        const quest = profile?.quests?.find(
          (q) => q.id === questId(action.questId),
        );
        if (!quest || !profile.source || !profile.clientBuild) fail();
        step.text = quest.title;
        step.quest = {
          id: quest.id,
          build: profile.clientBuild,
          sourceHash: sourceHash(profile),
          baselineAt: profile.source.updatedAt,
          baselineCompleted: membership(profile, quest.id),
          baselineTurnInAt: latestTurnIn(profile, quest.id),
        };
      }
      journey.steps.push(step);
    } else {
      text(action.stepId, 100);
      const step = journey.steps.find((s) => s.id === action.stepId);
      if (!step) fail();
      if (action.type === "remove-step")
        journey.steps = journey.steps.filter((s) => s !== step);
      else if (action.type === "set-done") {
        if (typeof action.done !== "boolean") fail();
        step.done = action.done;
      } else {
        if (
          !Object.hasOwn(action, "text") &&
          !Object.hasOwn(action, "profileId")
        )
          fail();
        if (Object.hasOwn(action, "profileId")) {
          const profileId = assignment(action.profileId);
          if (profileId !== step.profileId) {
            step.profileId = profileId;
            if (step.quest) {
              delete step.quest;
              delete step.observed;
              step.done = false;
            }
          }
        }
        if (Object.hasOwn(action, "text")) {
          if (step.quest) fail();
          step.text = text(action.text, 300).trim();
        }
      }
    }
  }
  next.journeys = validateJourneys(next.journeys);
  return next;
}

/** Reconcile only saved evidence; keep proof even after bounded history rotates. */
function reconcileJourneys(journeys, profiles) {
  const next = validateJourneys(journeys);
  const byId = new Map(profiles.map((p) => [p.id, p])),
    evidence = new Map();
  for (const journey of next)
    for (const step of journey.steps) {
      if (!step.quest || step.observed) continue;
      const profile = byId.get(step.profileId),
        q = step.quest;
      if (!profile?.source || profile.clientBuild !== q.build) continue;
      if (!evidence.has(profile.id)) {
        const saved = Date.parse(profile.source.updatedAt),
          turns = new Map();
        for (const event of profile.history?.recent ?? []) {
          const ms = event.completedAt * 1000;
          if (ms <= saved && (!turns.has(event.id) || ms > turns.get(event.id)))
            turns.set(event.id, ms);
        }
        evidence.set(profile.id, { saved, hash: sourceHash(profile), turns });
      }
      const { saved, hash, turns } = evidence.get(profile.id),
        baseline = Date.parse(q.baselineAt);
      if (hash !== q.sourceHash || saved <= baseline) continue;
      const turn = turns.get(q.id);
      if (
        turn > baseline &&
        (q.baselineTurnInAt === null || turn > Date.parse(q.baselineTurnInAt))
      )
        step.observed = { at: new Date(turn).toISOString(), via: "turn-in" };
      else if (
        q.baselineCompleted === false &&
        membership(profile, q.id) === true
      )
        step.observed = { at: profile.source.updatedAt, via: "completed-id" };
    }
  return next;
}

module.exports = { validateJourneys, applyJourneyAction, reconcileJourneys };

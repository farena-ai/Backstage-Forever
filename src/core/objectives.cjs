"use strict";
const { randomUUID } = require("node:crypto");
const { validateCapture } = require("./quest-data.cjs");
const { SIDES } = require("./ledger.cjs");

const fail = () => { throw new Error("Invalid objective data."); };
function fields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail();
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) fail();
}
function number(value, max = 2147483647) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail();
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
}
function validateObjectives(value, profileIds) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > profileIds.size) fail();
  const owners = new Set();
  for (const o of value) {
    const quest = o?.kind === "quest";
    const rep = o?.kind === "reputation";
    fields(o, ["id", "profileId", "sourceId", "build", "baselineAt", "kind", "title", "completion", ...(quest ? ["questId", "baselineAbsent"] : rep ? ["factionId", "targetStanding"] : ["skillLineId", "targetRank"])]);
    if (!profileIds.has(o.profileId) || owners.has(o.profileId)) fail();
    owners.add(o.profileId);
    text(o.id, 100);
    text(o.sourceId, 200);
    validateCapture({ clientBuild: o.build });
    text(o.title, 300);
    time(o.baselineAt);
    if (quest) {
      number(o.questId);
      if (typeof o.baselineAbsent !== "boolean") fail();
    } else if (rep) {
      number(o.factionId, 100000);
      number(o.targetStanding, 8);
      if (o.targetStanding < 2) fail();
    } else {
      if (o.kind !== "profession") fail();
      number(o.skillLineId);
      number(o.targetRank, 10000);
    }
    if (o.completion !== undefined) {
      fields(o.completion, ["at", "via"]);
      time(o.completion.at);
      if (o.completion.at <= o.baselineAt || !(quest
        ? o.completion.via === "turn-in" || (o.baselineAbsent && o.completion.via === "completed-id")
        : o.completion.via === (rep ? "reputation-standing" : "profession-rank")) || (rep && !o.build)) fail();
    }
  }
  return structuredClone(value);
}
const matches = (o, p) => p?.source?.id === o.sourceId && p.clientBuild === o.build;
const completed = (p, id) => p.history?.completedIdsKnown === true && p.history.completedIds.includes(id);
const professionFor = (p, id) => p.readiness?.workshop?.professions?.items.find(row => row.skillLineId === id);
const factionFor = (p, id) => p.ledger?.reputations?.factions.find(row => row.id === id);

function changeObjective(state, action, now = Date.now) {
  fields(action, ["profileId", "expectedId", "target", "sourceId", "build"]);
  const { profileId, expectedId, target } = action;
  const p = state.profiles.find(row => row.id === profileId);
  if (!p || profileId !== state.activeProfileId) throw new Error("The active character changed. Reopen the objective on that character.");
  const current = state.objectives.find(o => o.profileId === profileId);
  if ((current?.id ?? null) !== expectedId) throw new Error("The pinned objective changed. Review it before trying again.");
  if (target === null) return state.objectives.filter(o => o !== current);
  if (!p.source) throw new Error("Save this character from WoW before pinning an objective.");
  if (action.sourceId !== undefined && (p.source.id !== action.sourceId || (p.clientBuild ?? null) !== action.build)) throw new Error("The saved game identity changed. Reopen the objective before pinning it.");
  const o = { id: randomUUID(), profileId, sourceId: p.source.id, ...(p.clientBuild ? { build: p.clientBuild } : {}), baselineAt: p.source.updatedAt };
  if (target?.kind === "quest") {
    fields(target, ["kind", "questId", "title"]);
    number(target.questId);
    text(target.title, 300);
    const active = p.quests?.find(q => q.id === target.questId);
    const previouslyCompleted = completed(p, target.questId) || p.history?.recent.some(e => e.id === target.questId && e.completedAt * 1000 <= Date.parse(o.baselineAt));
    const repeat = active && previouslyCompleted;
    if (current?.kind === "quest" && current.questId === target.questId && matches(current, p) && !(current.completion && repeat)) return state.objectives;
    if (previouslyCompleted && !active) {
      throw new Error("This quest is already recorded as completed.");
    }
    // A quest back in the log after a turn-in is a new attempt. Only a new
    // dated turn-in can prove it; another completed-ID listing cannot.
    Object.assign(o, { kind: "quest", questId: target.questId, title: active?.title || target.title, baselineAbsent: !previouslyCompleted && p.history?.completedIdsKnown === true });
  } else if (target?.kind === "profession") {
    fields(target, ["kind", "skillLineId", "targetRank"]);
    number(target.skillLineId);
    number(target.targetRank, 10000);
    if (current?.kind === "profession" && current.skillLineId === target.skillLineId && current.targetRank === target.targetRank && matches(current, p)) return state.objectives;
    const row = professionFor(p, target.skillLineId);
    if (!row || target.targetRank !== row.rank + 1 || target.targetRank > row.maxRank) throw new Error("The saved profession checkpoint is no longer available. Review the latest rank.");
    Object.assign(o, { kind: "profession", skillLineId: target.skillLineId, targetRank: target.targetRank, title: row.name });
  } else if (target?.kind === "reputation") {
    fields(target, ["kind", "factionId", "targetStanding"]);
    number(target.factionId, 100000);
    number(target.targetStanding, 8);
    if (current?.kind === "reputation" && current.factionId === target.factionId && current.targetStanding === target.targetStanding && matches(current, p)) return state.objectives;
    const row = factionFor(p, target.factionId);
    const wrongSide = (p.faction === "Alliance" && SIDES.Horde.includes(target.factionId)) || (p.faction === "Horde" && SIDES.Alliance.includes(target.factionId));
    if (!row || wrongSide || target.targetStanding !== row.standing + 1) throw new Error("The saved reputation target is not available. Review the latest faction standing.");
    // A later export can contain a retained observation from before the pin.
    o.baselineAt = new Date(Math.max(Date.parse(o.baselineAt), now())).toISOString();
    Object.assign(o, { kind: "reputation", factionId: row.id, targetStanding: target.targetStanding, title: row.name });
  } else fail();
  return [...state.objectives.filter(row => row !== current), o];
}

// Persist proof at the state boundary, independently of which view is open.
function reconcileObjectives(objectives, profiles) {
  const byId = new Map(profiles.map(p => [p.id, p]));
  return objectives.map(o => {
    const p = byId.get(o.profileId);
    if (o.completion || !o.build || !matches(o, p) || p.source.updatedAt <= o.baselineAt) return o;
    let completion;
    if (o.kind === "quest") {
      const baseline = Date.parse(o.baselineAt), saved = Date.parse(p.source.updatedAt);
      const turns = (p.history?.recent || []).filter(e => e.id === o.questId && e.completedAt * 1000 > baseline && e.completedAt * 1000 <= saved);
      if (turns.length) completion = { at: new Date(Math.min(...turns.map(e => e.completedAt)) * 1000).toISOString(), via: "turn-in" };
      else if (o.baselineAbsent && completed(p, o.questId)) completion = { at: p.source.updatedAt, via: "completed-id" };
    } else if (o.kind === "reputation") {
      const row = factionFor(p, o.factionId), observed = row?.observedAt * 1000;
      if (row?.observedBuild === o.build && row.standing >= o.targetStanding && observed > Date.parse(o.baselineAt) && observed <= Date.parse(p.source.updatedAt)) {
        completion = { at: new Date(observed).toISOString(), via: "reputation-standing" };
      }
    } else {
      const at = p.readiness?.workshop?.professions?.observedAt;
      if (at > o.baselineAt && at <= p.source.updatedAt && professionFor(p, o.skillLineId)?.rank >= o.targetRank) completion = { at, via: "profession-rank" };
    }
    return completion ? { ...o, completion } : o;
  });
}
module.exports = { changeObjective, validateObjectives, reconcileObjectives };

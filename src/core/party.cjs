"use strict";
const { randomUUID } = require("node:crypto");
const { validateState } = require("./validation.cjs");
const MAX_PARTY_BYTES = 64 * 1024;
const DEFAULT_TITLE = "Shared adventure plan";
function invalid() { throw Error("Party plan is invalid. Check its title, steps and format."); }
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function validatePartyContent(value) {
  exact(value, ["title", "steps"]); text(value.title, 100);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 50 || Object.keys(value.steps).length !== value.steps.length || Object.keys(value.steps).some((key, i) => key !== String(i))) invalid();
  const result = { title: value.title, steps: value.steps.map(step => { exact(step, ["text"]); return { text: text(step.text, 300) }; }) };
  if (Buffer.byteLength(JSON.stringify({ format: "backstage-forever-party", version: 1, ...result })) > MAX_PARTY_BYTES) invalid();
  return result;
}
function serializePartyPlan(value) {
  const result = JSON.stringify({ format: "backstage-forever-party", version: 1, ...validatePartyContent(value) }, null, 2);
  if (Buffer.byteLength(result) > MAX_PARTY_BYTES) invalid();
  return result;
}
/** Detect escaped duplicate keys before JSON's last-key-wins behavior can hide them. */
function rejectDuplicateKeys(raw) {
  const objects = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "{") objects.push(new Set());
    else if (c === "}") objects.pop();
    else if (c === '"') {
      const start = i++;
      while (i < raw.length) { if (raw[i] === "\\") i += 2; else if (raw[i] === '"') break; else i++; }
      let after = i + 1; while (/\s/.test(raw[after] ?? "") && after < raw.length) after++;
      if (raw[after] === ":") {
        const key = JSON.parse(raw.slice(start, i + 1)), keys = objects.at(-1);
        if (!keys || keys.has(key)) invalid(); keys.add(key);
      }
    }
  }
}
function parsePartyPlan(raw) {
  try {
    if (!(typeof raw === "string" || Buffer.isBuffer(raw)) || Buffer.byteLength(raw) > MAX_PARTY_BYTES) invalid();
    if (Buffer.isBuffer(raw)) raw = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const value = JSON.parse(raw); rejectDuplicateKeys(raw);
    exact(value, ["format", "version", "title", "steps"]);
    if (value.format !== "backstage-forever-party" || value.version !== 1) invalid();
    return validatePartyContent({ title: value.title, steps: value.steps });
  } catch { invalid(); }
}
function previewPartyPlan(state, input) {
  state = validateState(state); exact(input, ["journeyId"]); text(input.journeyId, 100);
  const journey = state.journeys.find(j => j.id === input.journeyId);
  if (!journey) invalid();
  return validatePartyContent({ title: DEFAULT_TITLE, steps: journey.steps.map(s => ({ text: s.text })) });
}
function selected(state, profileId) {
  if (profileId !== state.activeProfileId) throw Error("Party plan: choose the current character.");
  const profile = profileId === null ? null : state.profiles.find(p => p.id === profileId);
  if (profile === undefined) invalid(); return profile;
}
function roleValue(role = "unspecified") {
  if (!["tank", "healer", "damage", "unspecified"].includes(role)) invalid(); return role;
}
function template(role) {
  return { title: "Dungeon preparation", steps: [
    { text: `Agree on the dungeon plan and roles${role === "unspecified" ? "" : `; chosen role: ${role}`}` },
    { text: "Check known bag space and make room if needed" },
    { text: "Check consumables with your group" },
    { text: "Check equipment repairs before leaving" },
    { text: "Agree on a meeting point with your group" },
  ] };
}
function buildPartyBrief(state, profileId, options = {}) {
  state = validateState(state);
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => k !== "role")) invalid();
  const profile = selected(state, profileId), role = roleValue(options.role), observed = profile?.source?.kind === "wow-addon";
  const equipment = observed ? profile.readiness?.equipment : undefined, bags = observed && profile.readiness?.bags?.total > 0 ? profile.readiness.bags : undefined;
  return {
    character: profile ? { className: profile.className, level: profile.level, observed } : null,
    source: { kind: observed ? "saved-addon" : "manual", savedAt: observed ? profile.source.updatedAt : null, label: observed ? "Last saved addon snapshot" : "Manual checklist; no saved game facts" },
    role,
    equipment: { known: equipment !== undefined, items: structuredClone(equipment ?? []) },
    bags: { known: bags !== undefined, free: bags?.free ?? null, total: bags?.total ?? null },
    template: template(role),
    limitations: ["Role is your choice. Review the plan with your group.", "Facts describe the last saved snapshot; unknown equipment or bag space needs a manual check.", "Every checklist item is manual. No dungeon access, readiness or rewards are promised."],
  };
}
function appendJourney(state, input, profileId, { now = Date.now(), id = randomUUID } = {}) {
  const content = validatePartyContent(input), next = validateState(state);
  if (next.journeys.length >= 20) throw Error("Party plan: you already have 20 journeys. Remove one before adding a plan.");
  if (!Number.isFinite(now)) invalid();
  const used = new Set(next.journeys.flatMap(j => [j.id, ...j.steps.map(s => s.id)]));
  const newId = () => { const value = id(); if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value) || used.has(value)) invalid(); used.add(value); return value; };
  const journey = { id: newId(), title: content.title, createdAt: new Date(now).toISOString(), steps: content.steps.map(step => ({ id: newId(), text: step.text, done: false, profileId })) };
  next.journeys.push(journey);
  return { state: validateState(next), journeyId: journey.id };
}
function commitPartyPlan(state, input, deps) {
  return appendJourney(state, input, null, deps);
}
function createPartyJourney(state, input, deps) {
  exact(input, ["profileId", "role"]); const current = validateState(state);
  selected(current, input.profileId); const role = roleValue(input.role);
  return appendJourney(current, template(role), input.profileId, deps);
}
module.exports = { MAX_PARTY_BYTES, validatePartyContent, serializePartyPlan, parsePartyPlan, previewPartyPlan, buildPartyBrief, commitPartyPlan, createPartyJourney };

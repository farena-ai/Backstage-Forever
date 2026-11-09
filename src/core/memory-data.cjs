"use strict";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid() { throw Error("Invalid saved memory."); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) invalid();
}
function uuid(value) { if (typeof value !== "string" || !UUID.test(value)) invalid(); return value; }
function validateMemories(value, profiles) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) invalid();
  const owners = new Set(profiles.map(p => p.id)), groups = new Set(), ids = new Set();
  for (const group of value) {
    object(group, ["profileId", "exchanges"]);
    if (!owners.has(group.profileId) || groups.has(group.profileId) || !Array.isArray(group.exchanges) || group.exchanges.length > 20) invalid();
    groups.add(group.profileId);
    for (const item of group.exchanges) {
      object(item, ["id", "createdAt", "question", "answer"]); uuid(item.id);
      if (ids.has(item.id)) invalid(); ids.add(item.id);
      if (typeof item.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.createdAt) || !Number.isFinite(Date.parse(item.createdAt)) || new Date(item.createdAt).toISOString() !== item.createdAt) invalid();
      text(item.question, 1000); text(item.answer, 2000);
    }
  }
  return structuredClone(value);
}
function preserveMemories(current, edited) {
  const ids = new Set(Array.isArray(edited?.profiles) ? edited.profiles.map(p => p?.id) : []);
  return { ...edited, memories: structuredClone((current.memories || []).filter(group => ids.has(group.profileId))) };
}
module.exports = { validateMemories, preserveMemories, uuid, object, text };

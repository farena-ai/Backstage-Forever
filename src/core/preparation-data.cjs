"use strict";
// Workshop validation deliberately has no dependency on root state validation.
function invalid() { throw Error("Invalid workshop observation."); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function name(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function boolean(value) { if (typeof value !== "boolean") invalid(); return value; }
function canonical(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
const id = value => integer(value, 1, 2147483647);
function unique(items, key) {
  const seen = new Set();
  for (const item of items) { if (seen.has(item[key])) invalid(); seen.add(item[key]); }
  return items;
}
function list(value, max, read, key) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return unique(Array.from(value, read), key);
}
function profession(value) {
  object(value, ["skillLineId", "professionId", "name", "rank", "maxRank"]);
  const out = { skillLineId: id(value.skillLineId), professionId: id(value.professionId), name: name(value.name), rank: integer(value.rank, 0, 10000), maxRank: integer(value.maxRank, 0, 10000) };
  if (out.rank > out.maxRank) invalid();
  return out;
}
function reagent(value) {
  object(value, ["itemId", "required", "name"]);
  const out = { itemId: id(value.itemId), required: integer(value.required, 1, 100000) };
  if (value.name !== undefined) out.name = name(value.name);
  return out;
}
function recipe(value) {
  object(value, ["id", "skillLineId", "name", "reagentsKnown", "reagents", "outputItemId", "outputMin", "outputMax", "canSkillUp"]);
  const out = { id: id(value.id), skillLineId: id(value.skillLineId), name: name(value.name), reagentsKnown: boolean(value.reagentsKnown), reagents: list(value.reagents, 20, reagent, "itemId") };
  if (!out.reagentsKnown && out.reagents.length) invalid();
  if (value.outputItemId !== undefined) out.outputItemId = id(value.outputItemId);
  for (const key of ["outputMin", "outputMax"]) if (value[key] !== undefined) out[key] = integer(value[key], 1, 10000);
  if (out.outputMin !== undefined && out.outputMax !== undefined && out.outputMin > out.outputMax) invalid();
  if (value.canSkillUp !== undefined) out.canSkillUp = boolean(value.canSkillUp);
  return out;
}
function material(value) {
  object(value, ["itemId", "count", "name"]);
  const out = { itemId: id(value.itemId), count: integer(value.count, 1, 1000000) };
  if (value.name !== undefined) out.name = name(value.name);
  return out;
}
function validateWorkshop(value) {
  if (value === undefined) return undefined;
  object(value, ["professions", "recipes", "materials"]);
  const out = {};
  for (const [key, max, read, uniqueKey] of [["professions",20,profession,"skillLineId"],["recipes",100,recipe,"id"],["materials",256,material,"itemId"]]) {
    const collection = value[key];
    if (collection === undefined) continue;
    object(collection, ["observedAt", "complete", "items", ...(key === "materials" ? ["scope"] : [])]);
    out[key] = { observedAt: canonical(collection.observedAt), complete: boolean(collection.complete), items: list(collection.items, max, read, uniqueKey) };
    if (key === "professions") unique(out[key].items, "professionId");
    if (key === "materials") { if (collection.scope !== "bags-0-4") invalid(); out[key].scope = "bags-0-4"; }
  }
  return out;
}
function captureTime(value) {
  if (typeof value !== "number") return canonical(value);
  if (!Number.isFinite(value) || !Number.isFinite(value * 1000) || Math.abs(value * 1000) > 8640000000000000) invalid();
  return canonical(new Date(value * 1000).toISOString());
}
function normalizeWorkshopCapture(value, sourceAt) {
  if (value === undefined) return undefined;
  object(value, ["professions", "recipes", "materials"]);
  const source = captureTime(sourceAt), out = {};
  for (const key of ["professions", "recipes", "materials"]) {
    if (value[key] === undefined) continue;
    object(value[key], ["observedAt", "complete", "items", ...(key === "materials" ? ["scope"] : [])]);
    const observedAt = captureTime(value[key].observedAt);
    if (observedAt > source) invalid();
    out[key] = { ...value[key], observedAt };
  }
  return validateWorkshop(out);
}
module.exports = { validateWorkshop, normalizeWorkshopCapture };

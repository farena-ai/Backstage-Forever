"use strict";
// Independent of root validation: optional game blocks fail atomically without
// rejecting the character. Private backup/state validation remains strict.
const BLOCK = ["schemaVersion", "status", "recording", "observedAt", "limited", "totalRecords", "records"];
const RECORD = ["id", "method", "entityId", "itemIds", "mapId", "x", "y", "observedAt", "clientBuild", "name", "evidence", "precision", "approximate"];
function invalid() { throw Error("Invalid personal gathering observations."); }
function object(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)) ||
      Reflect.ownKeys(value).some(k => !keys.includes(k) ||
        !Object.getOwnPropertyDescriptor(value, k)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), "value"))) invalid();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function array(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)), "value")) invalid();
  return value;
}
function text(value, max) {
  if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function stamp(value, raw) {
  if (raw) {
    integer(value, 0, 253402300799);
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
function normalize(value, raw, capturedAt) {
  if (value === undefined) return undefined;
  object(value, BLOCK);
  if (value.schemaVersion !== 1 || !["available", "unavailable"].includes(value.status) ||
      typeof value.recording !== "boolean" || typeof value.limited !== "boolean") invalid();
  const observedAt = stamp(value.observedAt, raw);
  if (capturedAt !== undefined && observedAt > stamp(capturedAt, false)) invalid();
  const totalRecords = integer(value.totalRecords, 0, 128), seen = new Set();
  const records = array(value.records, 64).map(record => {
    object(record, RECORD);
    if (!["mining", "herbalism"].includes(record.method) || record.evidence !== "observed-gathering-loot" ||
        record.precision !== "recorded-standing-point" || record.approximate !== true) invalid();
    const entityId = integer(record.entityId, 1, 2147483647), mapId = integer(record.mapId, 1, 2147483647);
    for (const key of ["x", "y"])
      if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] < 0 || record[key] > 1) invalid();
    const clientBuild = text(record.clientBuild, 30);
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/.test(clientBuild)) invalid();
    const id = text(record.id, 160);
    const expected = `wowf:${record.method}:${entityId}:${mapId}:${Math.floor(record.x * 10000 + .5)}:${Math.floor(record.y * 10000 + .5)}:${clientBuild}`;
    if (id !== expected || seen.has(id)) invalid();
    seen.add(id);
    const ids = new Set();
    const itemIds = array(record.itemIds, 8).map(id => {
      integer(id, 1, 2147483647);
      if (ids.has(id)) invalid();
      ids.add(id);
      return id;
    });
    if (!itemIds.length) invalid();
    const at = stamp(record.observedAt, raw);
    if (at > observedAt) invalid();
    return {
      id, method: record.method, entityId, itemIds, mapId, x: record.x, y: record.y,
      observedAt: at, clientBuild, name: text(record.name, 120), evidence: record.evidence,
      precision: record.precision, approximate: true,
    };
  });
  if (totalRecords < records.length || (!value.limited && totalRecords !== records.length)) invalid();
  return { schemaVersion: 1, status: value.status, recording: value.recording, observedAt, limited: value.limited, totalRecords, records };
}
function normalizeGatheringCapture(value, capturedAt) {
  if (value !== undefined) stamp(capturedAt, false);
  return normalize(value, true, capturedAt);
}
function validateGatheringProfile(value) { return normalize(value, false); }
// Equal-second snapshots cannot establish which history change happened last.
// Keep identical shared observations so a clear cannot be undone by a timestamp tie.
function intersectGatheringProfiles(left, right) {
  if (left === undefined || right === undefined) return undefined;
  const a = validateGatheringProfile(left), b = validateGatheringProfile(right);
  const previous = new Map(a.records.map(record => [record.id, JSON.stringify(record)]));
  b.records = b.records.filter(record => previous.get(record.id) === JSON.stringify(record));
  b.limited ||= b.records.length < b.totalRecords;
  return b;
}
module.exports = { normalizeGatheringCapture, validateGatheringProfile, intersectGatheringProfiles };

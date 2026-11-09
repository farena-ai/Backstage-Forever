"use strict";
function fail() {
  throw Error("Invalid quest or experience snapshot.");
}
function obj(v, keys) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail();
}
function text(v) {
  if (typeof v !== "string" || v.length > 200 || /[\x00-\x1f\x7f]/.test(v))
    fail();
  return v;
}
function num(v, min = 0, max = 2147483647) {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail();
  return v;
}
function validateQuestData(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 25) fail();
  const ids = new Set();
  return value.map((q) => {
    obj(q, [
      "id",
      "title",
      "level",
      "zone",
      "complete",
      "objectives",
      "destination",
    ]);
    num(q.id, 1);
    if (ids.has(q.id)) fail();
    ids.add(q.id);
    text(q.title);
    if (
      !q.title.trim() ||
      typeof q.complete !== "boolean" ||
      !Array.isArray(q.objectives) ||
      q.objectives.length > 5
    )
      fail();
    const result = {
      id: q.id,
      title: q.title,
      complete: q.complete,
      objectives: q.objectives.map((o) => {
        obj(o, ["text", "done", "type", "required", "fulfilled"]);
        text(o.text);
        if (typeof o.done !== "boolean") fail();
        const objective = { text: o.text, done: o.done };
        if (o.type !== undefined) objective.type = text(o.type);
        for (const k of ["required", "fulfilled"])
          if (o[k] !== undefined) objective[k] = num(o[k], 0, 100000);
        if (
          objective.required !== undefined &&
          objective.fulfilled > objective.required
        )
          fail();
        return objective;
      }),
    };
    if (q.level !== undefined) result.level = num(q.level, 0, 1000);
    if (q.zone !== undefined) result.zone = text(q.zone);
    if (q.destination !== undefined) {
      obj(q.destination, ["mapId", "x", "y", "text"]);
      const d = { mapId: num(q.destination.mapId, 1) };
      for (const key of ["x", "y"]) {
        const v = q.destination[key];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
          fail();
        d[key] = v;
      }
      if (q.destination.text !== undefined) d.text = text(q.destination.text);
      result.destination = d;
    }
    return result;
  });
}
function validateProgress(value) {
  if (value === undefined) return undefined;
  obj(value, ["current", "max", "rested"]);
  const result = { current: num(value.current), max: num(value.max) };
  if (result.current > result.max) fail();
  if (value.rested !== undefined) result.rested = num(value.rested);
  return result;
}
function validateHistory(value) {
  if (value === undefined) return undefined;
  obj(value, ["completedCount", "recent", "completedIds", "completedIdsKnown"]);
  if (!Array.isArray(value.recent) || value.recent.length > 25) fail();
  const result = {
    recent: value.recent.map((q) => {
      obj(q, ["id", "title", "completedAt"]);
      if (!text(q.title).trim()) fail();
      return {
        id: num(q.id, 1),
        title: q.title,
        completedAt: num(q.completedAt, 0, 253402300799),
      };
    }),
  };
  if (value.completedCount !== undefined)
    result.completedCount = num(value.completedCount, 0, 20000);
  if (value.completedIdsKnown !== undefined) {
    if (typeof value.completedIdsKnown !== "boolean") fail();
    result.completedIdsKnown = value.completedIdsKnown;
  }
  if (value.completedIds !== undefined) {
    if (!Array.isArray(value.completedIds) || value.completedIds.length > 20000)
      fail();
    let previous = 0;
    result.completedIds = value.completedIds.map((id) => {
      num(id, 1);
      if (id <= previous) fail();
      previous = id;
      return id;
    });
  }
  if (result.completedIdsKnown === true && !result.completedIds) fail();
  return result;
}
function validateCapture(value) {
  const result = {};
  for (const [k, pattern] of Object.entries({
    clientBuild: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/,
    locale: /^[a-z]{2}[A-Z]{2}$/,
    captureVersion: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  })) {
    if (value[k] !== undefined) {
      if (typeof value[k] !== "string" || !pattern.test(value[k])) fail();
      result[k] = value[k];
    }
  }
  return result;
}
module.exports = {
  validateQuestData,
  validateProgress,
  validateHistory,
  validateCapture,
};

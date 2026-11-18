"use strict";

// The sandboxed desktop renderer consumes the same pure resolver as Node tests.
(function () {
// V1 owns only the initial open state of two existing desktop disclosures.
// Keep these legacy defaults stable; introducing new defaults requires a new version.
const VERSION = 1;
const DEFAULTS = { nowMoreSuggestions: false, preparationSources: false };
const PRESETS = {
  compact: DEFAULTS,
  guided: { ...DEFAULTS, nowMoreSuggestions: true },
  planner: { nowMoreSuggestions: true, preparationSources: true }
};

const hasKey = (object, key) => typeof key === "string" && Object.hasOwn(object, key);
const isPlainObject = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

function isSupported(record) {
  return record == null || (isPlainObject(record) && Reflect.ownKeys(record).length === 3
    && Object.hasOwn(record, "version") && record.version === VERSION
    && Object.hasOwn(record, "preset") && (record.preset === null || hasKey(PRESETS, record.preset))
    && Object.hasOwn(record, "overrides") && isPlainObject(record.overrides)
    && Reflect.ownKeys(record.overrides).every(key => hasKey(DEFAULTS, key) && typeof record.overrides[key] === "boolean"));
}

function requireSupported(record) {
  if (!isSupported(record)) throw new TypeError("Unsupported desktop view preferences");
}

function resolveViewPreferences(record) {
  if (!isSupported(record)) return { ...DEFAULTS };
  return { ...(record?.preset ? PRESETS[record.preset] : DEFAULTS), ...record?.overrides };
}

// Transitions return a replacement for only the caller-owned desktop view record.
function applyViewPreset(record, preset) {
  requireSupported(record);
  if (!hasKey(PRESETS, preset)) throw new TypeError("Unknown desktop view preset");
  return { version: VERSION, preset, overrides: { ...record?.overrides } };
}

function setViewOverride(record, key, value) {
  requireSupported(record);
  if (!hasKey(DEFAULTS, key) || (value !== null && typeof value !== "boolean")) {
    throw new TypeError("Invalid desktop view override");
  }
  const overrides = { ...record?.overrides };
  if (value === null) delete overrides[key];
  else overrides[key] = value;
  return { version: VERSION, preset: record?.preset ?? null, overrides };
}

function resetViewPreferences(record) {
  requireSupported(record);
  return null;
}

// Discarding this diff cancels preview. It is not a write token or a settings patch.
function previewViewPreset(record, preset) {
  const before = resolveViewPreferences(record);
  const after = resolveViewPreferences(applyViewPreset(record, preset));
  const changes = Object.keys(DEFAULTS).filter(key => before[key] !== after[key])
    .map(key => ({ key, from: before[key], to: after[key] }));
  return { preset, changes };
}

const model = { resolveViewPreferences, previewViewPreset, applyViewPreset, setViewOverride, resetViewPreferences };
if (typeof module !== "undefined") module.exports = model;
else window.DesktopViewPresetModel = model;
})();

"use strict";
// Strict schema validation for request bodies. Unknown fields are rejected,
// numbers must be in range, and coordinates are rounded to 0.5% of the map
// before anything is stored. Validation either returns a normalized value or
// throws ValidationError naming the first offending path.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const APP_VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const MAX_ID = 2147483647;

const COORD_STEPS = 200; // 1 / 0.005
const NODE_KINDS = Object.freeze(["herb", "ore", "chest"]);
const RECIPE_SOURCES = Object.freeze(["trainer", "vendor"]);
const REPORT_CATEGORIES = Object.freeze(["bug", "data", "crash", "suggestion", "other"]);

const LIMITS = Object.freeze({
  maxEntries: 500, // total observation entries per submit, all kinds together
  maxExpanded: 5000, // total stored facts one submit may produce
  nodeItemIds: 16,
  vendorItemIds: 200,
  dropItems: 64,
  maxLoots: 1000,
  nameLength: 120,
  reportText: 2000,
  reportLogBytes: 64 * 1024,
});

class ValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ValidationError";
    this.path = path;
  }
}

function fail(path, message) { throw new ValidationError(path, message); }

function plainObject(value, path, allowed, required = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail(path, "must be an object");
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(path ? `${path}.${key}` : key, "unknown field");
  for (const key of required)
    if (!Object.hasOwn(value, key) || value[key] === undefined) fail(path ? `${path}.${key}` : key, "is required");
  return value;
}

function array(value, path, max, min = 0) {
  if (!Array.isArray(value)) fail(path, "must be an array");
  if (value.length < min) fail(path, `must have at least ${min} entries`);
  if (value.length > max) fail(path, `must have at most ${max} entries`);
  return value;
}

function id(value, path) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ID) fail(path, `must be an integer 1..${MAX_ID}`);
  return value;
}

function intRange(value, path, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer ${min}..${max}`);
  return value;
}

function oneOf(value, path, options) {
  if (typeof value !== "string" || !options.includes(value)) fail(path, `must be one of ${options.join(", ")}`);
  return value;
}

// Rounds a 0..1 map fraction to the 0.5% grid and returns integer grid units
// (0..200). Storing grid units keeps keys exact and comparisons trivial.
function roundCoord(value) {
  return Math.min(COORD_STEPS, Math.max(0, Math.round(value * COORD_STEPS)));
}
function gridToFraction(units) { return Number((units / COORD_STEPS).toFixed(3)); }

function coord(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail(path, "must be a number 0..1");
  return roundCoord(value);
}

function uniqueIds(value, path, max, min = 0) {
  const seen = new Set();
  for (const [i, v] of array(value, path, max, min).entries()) {
    id(v, `${path}[${i}]`);
    if (seen.has(v)) fail(`${path}[${i}]`, "duplicate id");
    seen.add(v);
  }
  return [...seen];
}

// Node names are a fallback identity when the object id is unknown. They are
// game-provided strings, so allow letters, digits and a few punctuation marks
// only; no control characters, no separators used in storage keys.
function nodeName(value, path) {
  if (typeof value !== "string") fail(path, "must be a string");
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name.length || name.length > LIMITS.nameLength) fail(path, `must be 1..${LIMITS.nameLength} characters`);
  if (!/^[\p{L}\p{M}\p{N} '’.,:()&!-]+$/u.test(name)) fail(path, "contains characters that are not allowed");
  return name;
}

function installId(value, path = "installId") {
  if (typeof value !== "string" || !UUID_V4.test(value)) fail(path, "must be a UUID v4");
  return value.toLowerCase();
}

function optionalString(value, path, re) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !re.test(value)) fail(path, "has an invalid format");
  return value;
}

function validateSubmit(body) {
  plainObject(body, "", ["schema", "installId", "build", "appVersion", "observations"], ["schema", "installId", "observations"]);
  if (body.schema !== 1) fail("schema", "must be 1");
  const out = {
    installId: installId(body.installId),
    build: optionalString(body.build, "build", BUILD),
    appVersion: optionalString(body.appVersion, "appVersion", APP_VERSION),
    nodes: [], npcs: [], vendors: [], drops: [], recipes: [],
  };
  const obs = plainObject(body.observations, "observations", ["nodes", "npcs", "vendors", "drops", "recipes"]);
  let entries = 0, expanded = 0;
  const list = (key) => {
    if (obs[key] === undefined) return [];
    const arr = array(obs[key], `observations.${key}`, LIMITS.maxEntries);
    entries += arr.length;
    if (entries > LIMITS.maxEntries) fail("observations", `must contain at most ${LIMITS.maxEntries} entries in total`);
    return arr;
  };

  for (const [i, e] of list("nodes").entries()) {
    const p = `observations.nodes[${i}]`;
    plainObject(e, p, ["kind", "objectId", "name", "mapId", "x", "y", "itemIds"], ["kind", "mapId", "x", "y"]);
    if (e.objectId === undefined && e.name === undefined) fail(p, "needs objectId or name");
    const node = {
      kind: oneOf(e.kind, `${p}.kind`, NODE_KINDS),
      objectId: e.objectId === undefined ? null : id(e.objectId, `${p}.objectId`),
      name: e.name === undefined ? null : nodeName(e.name, `${p}.name`),
      mapId: id(e.mapId, `${p}.mapId`),
      x: coord(e.x, `${p}.x`),
      y: coord(e.y, `${p}.y`),
      itemIds: e.itemIds === undefined ? [] : uniqueIds(e.itemIds, `${p}.itemIds`, LIMITS.nodeItemIds),
    };
    // The object id is the identity when known; the name is only a fallback.
    if (node.objectId !== null) node.name = null;
    expanded += 1 + node.itemIds.length;
    out.nodes.push(node);
  }
  for (const [i, e] of list("npcs").entries()) {
    const p = `observations.npcs[${i}]`;
    plainObject(e, p, ["npcId", "mapId", "x", "y"], ["npcId", "mapId", "x", "y"]);
    out.npcs.push({ npcId: id(e.npcId, `${p}.npcId`), mapId: id(e.mapId, `${p}.mapId`), x: coord(e.x, `${p}.x`), y: coord(e.y, `${p}.y`) });
    expanded += 1;
  }
  for (const [i, e] of list("vendors").entries()) {
    const p = `observations.vendors[${i}]`;
    plainObject(e, p, ["npcId", "itemIds"], ["npcId", "itemIds"]);
    const v = { npcId: id(e.npcId, `${p}.npcId`), itemIds: uniqueIds(e.itemIds, `${p}.itemIds`, LIMITS.vendorItemIds, 1) };
    expanded += v.itemIds.length;
    out.vendors.push(v);
  }
  for (const [i, e] of list("drops").entries()) {
    const p = `observations.drops[${i}]`;
    plainObject(e, p, ["npcId", "loots", "items"], ["npcId", "loots", "items"]);
    const loots = intRange(e.loots, `${p}.loots`, 1, LIMITS.maxLoots);
    const seen = new Set();
    const items = array(e.items, `${p}.items`, LIMITS.dropItems).map((it, j) => {
      const q = `${p}.items[${j}]`;
      plainObject(it, q, ["itemId", "count"], ["itemId", "count"]);
      const itemId = id(it.itemId, `${q}.itemId`);
      if (seen.has(itemId)) fail(`${q}.itemId`, "duplicate id");
      seen.add(itemId);
      return { itemId, count: intRange(it.count, `${q}.count`, 1, loots) };
    });
    expanded += 1 + items.length;
    out.drops.push({ npcId: id(e.npcId, `${p}.npcId`), loots, items });
  }
  for (const [i, e] of list("recipes").entries()) {
    const p = `observations.recipes[${i}]`;
    plainObject(e, p, ["source", "npcId", "spellId", "itemId"], ["source", "npcId"]);
    if (e.spellId === undefined && e.itemId === undefined) fail(p, "needs spellId or itemId");
    out.recipes.push({
      source: oneOf(e.source, `${p}.source`, RECIPE_SOURCES),
      npcId: id(e.npcId, `${p}.npcId`),
      spellId: e.spellId === undefined ? null : id(e.spellId, `${p}.spellId`),
      itemId: e.itemId === undefined ? null : id(e.itemId, `${p}.itemId`),
    });
    expanded += 1;
  }
  if (entries === 0) fail("observations", "must contain at least one entry");
  if (expanded > LIMITS.maxExpanded) fail("observations", `expands to more than ${LIMITS.maxExpanded} facts`);
  return out;
}

// Free text is allowed only here. Control characters other than newline and
// tab are rejected so stored text cannot carry terminal escape sequences.
function cleanText(value, path, maxChars, maxBytes) {
  if (typeof value !== "string") fail(path, "must be a string");
  const text = value.replace(/\r\n?/g, "\n");
  if (/[\x00-\x08\x0b-\x1f\x7f‪-‮⁦-⁩]/.test(text)) fail(path, "contains control characters");
  if (maxChars !== undefined && text.length > maxChars) fail(path, `must be at most ${maxChars} characters`);
  if (maxBytes !== undefined && Buffer.byteLength(text, "utf8") > maxBytes) fail(path, `must be at most ${maxBytes} bytes`);
  return text;
}

function validateReport(body) {
  plainObject(body, "", ["schema", "installId", "category", "text", "appVersion", "build", "log"], ["schema", "installId", "category", "text", "appVersion"]);
  if (body.schema !== 1) fail("schema", "must be 1");
  const text = cleanText(body.text, "text", LIMITS.reportText).trim();
  if (!text.length) fail("text", "must not be empty");
  return {
    installId: installId(body.installId),
    category: oneOf(body.category, "category", REPORT_CATEGORIES),
    text,
    appVersion: optionalString(body.appVersion, "appVersion", APP_VERSION),
    build: optionalString(body.build, "build", BUILD),
    log: body.log === undefined ? null : cleanText(body.log, "log", undefined, LIMITS.reportLogBytes),
  };
}

function validateForget(body) {
  plainObject(body, "", ["schema", "installId"], ["schema", "installId"]);
  if (body.schema !== 1) fail("schema", "must be 1");
  return { installId: installId(body.installId) };
}

module.exports = {
  ValidationError, validateSubmit, validateReport, validateForget,
  roundCoord, gridToFraction, LIMITS, NODE_KINDS, RECIPE_SOURCES, REPORT_CATEGORIES, COORD_STEPS,
};

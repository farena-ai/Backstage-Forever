"use strict";
// The optional "extras" block a character's capture may carry. Four parts,
// each checked on its own, so one damaged part never costs the others:
//   talents  { at, unspent?, tabs: [{ n, t: [[tier, column, rank, maxRank, name], ...] }] }
//            the talents the character has spent, tree by tree in game order (rank above 0 only)
//   recipes  { at, lines: [{ l (skill line), r (skill), c (list is whole), ids: [...] }] }
//            every recipe id the character knows; the workshop list stops at 100 with details
//   keyring  { at, slots, ids: [...] }   item ids on the key ring
//   sessions [[start, lastSeen, copperAtStart, copperAtLastSeen], ...]   oldest first
// The stored shape is the checked wire shape, so checking a stored block again changes nothing.
// Pure: no files, no clock. Nothing here is guessed and nothing leaves this computer.
const { isDeepStrictEqual } = require("node:util");
const MAX_T = 253402300799, ID = 2147483647, MONEY = 1e13;
const LIMITS = Object.freeze({ tabs: 6, talentsPerTab: 60, points: 71, lines: 20, recipesPerLine: 600, keys: 64, sessions: 40, name: 60 });
const bad = () => { throw Error("Invalid extras capture."); };
const whole = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : bad());
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : bad());
// Lua writes an empty list as {} when it was never marked as a list.
const list = (v, max) => { const a = Array.isArray(v) ? v : v && typeof v === "object" && !Object.keys(v).length ? [] : bad(); if (a.length > max) bad(); return a; };
const only = (o, keys) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(); };
const label = (v) => (typeof v === "string" && v.length > 0 && v.length <= LIMITS.name && !/[\x00-\x1f\x7f]/.test(v) ? v : bad());

function talents(raw) {
  plain(raw); only(raw, ["at", "unspent", "tabs"]);
  const out = { at: whole(raw.at, 1, MAX_T) };
  if (raw.unspent !== undefined) out.unspent = whole(raw.unspent, 0, LIMITS.points);
  let spent = 0;
  const tabs = list(raw.tabs, LIMITS.tabs);
  if (!tabs.length) bad();
  out.tabs = tabs.map((tab) => {
    plain(tab); only(tab, ["n", "t"]);
    const seen = new Set();
    const t = list(tab.t, LIMITS.talentsPerTab).map((row) => {
      if (!Array.isArray(row) || row.length !== 5) bad();
      const tier = whole(row[0], 1, 15), column = whole(row[1], 1, 8), maxRank = whole(row[3], 1, 9), rank = whole(row[2], 1, maxRank);
      if (seen.has(`${tier}:${column}`)) bad();
      seen.add(`${tier}:${column}`);
      spent += rank;
      return [tier, column, rank, maxRank, label(row[4])];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { n: label(tab.n), t };
  });
  if (spent > LIMITS.points) bad();
  return out;
}
function recipes(raw) {
  plain(raw); only(raw, ["at", "lines"]);
  const seen = new Set();
  const lines = list(raw.lines, LIMITS.lines).map((line) => {
    plain(line); only(line, ["l", "r", "c", "ids"]);
    const l = whole(line.l, 1, ID);
    if (seen.has(l) || typeof line.c !== "boolean") bad();
    seen.add(l);
    const ids = list(line.ids, LIMITS.recipesPerLine).map((id) => whole(id, 1, ID));
    if (new Set(ids).size !== ids.length) bad();
    return { l, r: whole(line.r, 0, 10000), c: line.c, ids: ids.sort((a, b) => a - b) };
  }).sort((a, b) => a.l - b.l);
  if (!lines.length) bad();
  return { at: whole(raw.at, 1, MAX_T), lines };
}
function keyring(raw) {
  plain(raw); only(raw, ["at", "slots", "ids"]);
  const ids = list(raw.ids, LIMITS.keys).map((id) => whole(id, 1, ID));
  if (new Set(ids).size !== ids.length) bad();
  return { at: whole(raw.at, 1, MAX_T), slots: whole(raw.slots, 1, LIMITS.keys), ids: ids.sort((a, b) => a - b) };
}
function sessions(raw) {
  let last = 0;
  const out = list(raw, LIMITS.sessions).map((s) => {
    if (!Array.isArray(s) || s.length !== 4) bad();
    const start = whole(s[0], last + 1, MAX_T), end = whole(s[1], start, MAX_T);
    last = end;
    return [start, end, whole(s[2], 0, MONEY), whole(s[3], 0, MONEY)];
  });
  if (!out.length) bad();
  return out;
}
const PARTS = Object.freeze({ talents, recipes, keyring, sessions });

/**
 * The block as the addon wrote it -> the checked block, or undefined when nothing in it is usable.
 * Throws only when the block itself is not one (wrong version or not an object); a damaged part
 * is left out and the other parts stay.
 */
function normalizeExtrasCapture(raw) {
  plain(raw);
  if (raw.v !== 1) bad();
  const out = { v: 1 };
  for (const [key, check] of Object.entries(PARTS)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    try { out[key] = check(raw[key]); } catch { /* This part is left out; the others stay. */ }
  }
  return Object.keys(out).length > 1 ? out : undefined;
}
/** A stored profile's extras: must be exactly what the check above produces. */
function validateExtras(extras) {
  if (extras === undefined) return;
  let again;
  try { again = normalizeExtrasCapture(extras); } catch { bad(); }
  if (!isDeepStrictEqual(again, extras)) bad();
}

// ---- Talents ------------------------------------------------------------------------------
/**
 * The saved talents laid on the trees read from the player's game files (game-data.cjs talents()).
 * A tree is matched by its place in the game's order; a talent by tier and column in that tree,
 * and only when the highest rank agrees. What that does not find is looked up by name: in the
 * same tree first, then (when the trees came in another order) in the tree of the same name.
 * Returns null when no talents were saved; otherwise
 * { at, unspent (or null), spent, ranks: Map talentId -> rank, tabs: [{ name, points }], unmatched: [{ name, tab, rank }] }.
 */
function currentTalents(trees, block) {
  if (!block || !Array.isArray(block.tabs)) return null;
  const tabs = Array.isArray(trees?.tabs) ? trees.tabs : [];
  const fold = (s) => String(s ?? "").trim().toLowerCase();
  const ranks = new Map(), unmatched = [], points = [];
  block.tabs.forEach((saved, i) => {
    const byName = tabs.find((t) => fold(t.name) === fold(saved.n));
    const tab = tabs[i] && (!byName || byName === tabs[i]) ? tabs[i] : byName || tabs[i] || null;
    let sum = 0;
    for (const [tier, column, rank, maxRank, name] of saved.t) {
      sum += rank;
      const list = Array.isArray(tab?.talents) ? tab.talents : [];
      const hit = list.find((t) => t.row === tier - 1 && t.column === column - 1 && t.maxRank === maxRank)
        || list.find((t) => fold(t.name) === fold(name) && t.maxRank >= rank)
        || (byName && byName !== tab ? (byName.talents || []).find((t) => fold(t.name) === fold(name) && t.maxRank >= rank) : null);
      if (hit && !ranks.has(hit.id)) ranks.set(hit.id, rank);
      else unmatched.push({ name, tab: saved.n, rank });
    }
    points.push({ name: tab ? String(tab.name ?? saved.n) : saved.n, points: sum });
  });
  return { at: block.at, unspent: Number.isInteger(block.unspent) ? block.unspent : null, spent: points.reduce((n, t) => n + t.points, 0), ranks, tabs: points, unmatched };
}

// ---- Recipes ------------------------------------------------------------------------------
/** Known recipe ids from the id list: { ids: Set, lines: Map skillLineId -> { whole, rank, count } }, or null when none was saved. */
function knownRecipeList(profile) {
  const block = profile?.extras?.recipes;
  if (!block || !Array.isArray(block.lines)) return null;
  const ids = new Set(), lines = new Map();
  for (const line of block.lines) {
    for (const id of line.ids) ids.add(id);
    lines.set(line.l, { whole: line.c === true, rank: line.r, count: line.ids.length });
  }
  return { at: block.at, ids, lines };
}

// ---- Key ring -----------------------------------------------------------------------------
/** Item ids on the saved key ring, or null when no key ring was saved for this character. */
function keyringIds(profile) {
  const block = profile?.extras?.keyring;
  return block && Array.isArray(block.ids) ? new Set(block.ids) : null;
}

module.exports = { LIMITS, normalizeExtrasCapture, validateExtras, currentTalents, knownRecipeList, keyringIds };

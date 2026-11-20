"use strict";
const { randomUUID } = require("node:crypto");

const ROLES = ["tank", "healer", "damage"];
const RSVPS = ["yes", "maybe", "no"];
const SLOTS = ["assigned", "bench", "backup"];
const MAX_ENTRIES = 64, MAX_HISTORY = 50;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const validId = id => typeof id === "string" && UUID.test(id);
const invalid = () => new Error("Guild Run Pack organizer change is invalid.");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validTargets = t => exact(t, ROLES) && ROLES.every(role => Number.isInteger(t[role]) && t[role] >= 0 && t[role] <= MAX_ENTRIES);
const validEntry = entry => exact(entry, ["id", "name", "role", "rsvp", "slot"]) && validId(entry.id) &&
  typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 80 &&
  entry.name === entry.name.trim() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(entry.name) &&
  ROLES.includes(entry.role) && RSVPS.includes(entry.rsvp) && SLOTS.includes(entry.slot);
const emptyBoard = () => ({ revision: 0, targets: { tank: 0, healer: 0, damage: 0 }, entries: [], history: [] });
const validHistory = row => exact(row, ["type", "at", "before", "after"]) &&
  typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) &&
  (row.type === "targets" ? validTargets(row.before) && validTargets(row.after) : row.type === "entry" &&
    (row.before === null || validEntry(row.before)) && (row.after === null || validEntry(row.after)) &&
    Boolean(row.before || row.after) && (!row.before || !row.after || row.before.id === row.after.id));

function validateBoard(board) {
  if (!exact(board, ["revision", "targets", "entries", "history"]) || !Number.isSafeInteger(board.revision) || board.revision < 1 ||
      !validTargets(board.targets) || !Array.isArray(board.entries) || board.entries.length > MAX_ENTRIES ||
      !board.entries.every(validEntry) || new Set(board.entries.map(entry => entry.id)).size !== board.entries.length ||
      !Array.isArray(board.history) || board.history.length !== Math.min(board.revision, MAX_HISTORY) ||
      !board.history.every(validHistory)) throw invalid();
}

function changeBoard(board, change) {
  let { targets, entries } = board;
  let before, after, type;
  if (exact(change, ["type", "targets"]) && change.type === "targets" && validTargets(change.targets)) {
    type = "targets";
    before = targets;
    targets = after = change.targets;
    if (ROLES.every(role => before[role] === after[role])) return board;
  } else if (exact(change, ["type", "id", "name", "role", "rsvp", "slot"]) && change.type === "entry") {
    type = "entry";
    const { id, name, role, rsvp, slot } = change;
    after = { id: id === null ? randomUUID() : id, name, role, rsvp, slot };
    if (!validEntry(after)) throw invalid();
    const index = entries.findIndex(entry => entry.id === id);
    if (id === null ? entries.length >= MAX_ENTRIES : index < 0) throw invalid();
    before = entries[index] ?? null;
    if (before && Object.keys(after).every(key => before[key] === after[key])) return board;
    entries = [...entries];
    if (before) entries[index] = after; else entries.push(after);
  } else if (exact(change, ["type", "id"]) && change.type === "remove" && validId(change.id)) {
    type = "entry";
    before = entries.find(entry => entry.id === change.id);
    if (!before) throw invalid();
    after = null;
    entries = entries.filter(entry => entry.id !== change.id);
  } else throw invalid();

  const next = { revision: board.revision + 1, targets, entries,
    history: [...board.history.slice(-(MAX_HISTORY - 1)), { type, at: new Date().toISOString(), before, after }] };
  validateBoard(next);
  return next;
}

function boardView(board, readOnly) {
  const coverage = Object.fromEntries(ROLES.map(role => {
    const assigned = board.entries.filter(entry => entry.role === role && entry.slot === "assigned");
    const yes = assigned.filter(entry => entry.rsvp === "yes").length;
    const maybe = assigned.filter(entry => entry.rsvp === "maybe").length;
    const target = board.targets[role];
    return [role, { target, yes, maybe, gap: Math.max(0, target - yes) }];
  }));
  return { ...board, coverage, readOnly };
}

module.exports = { emptyBoard, validateBoard, validId, changeBoard, boardView };

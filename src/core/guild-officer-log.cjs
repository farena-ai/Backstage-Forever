"use strict";
const { randomUUID } = require("node:crypto");
const { validId } = require("./guild-organizer.cjs");

const MAX_ROWS = 64;
const inputKeys = ["corrects", "by", "decision", "reason"];
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validLine = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max &&
  value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
const validInput = ({ corrects, by, decision, reason }) => (corrects === null || validId(corrects)) &&
  validLine(by, 80) && validLine(decision, 400) && (reason === "" ? corrects === null : validLine(reason, 400));
const invalid = () => new Error("Guild Run Pack officer decision is invalid.");

function validateLog(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw invalid();
  const ids = new Set(), tips = new Set();
  for (const row of rows) {
    if (!exact(row, [...inputKeys, "id", "at"]) || !validInput(row) || !validId(row.id) || ids.has(row.id) ||
        typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) || new Date(row.at).toISOString() !== row.at ||
        (row.corrects !== null && !tips.delete(row.corrects))) throw invalid();
    ids.add(row.id);
    tips.add(row.id);
  }
}

function appendDecision(rows, input) {
  if (!exact(input, inputKeys) || !validInput(input)) throw invalid();
  if (rows.length >= MAX_ROWS) throw new Error("Guild Run Pack officer log is full. Existing decisions were not changed.");
  const { corrects, by, decision, reason } = input;
  const next = [...rows, { id: randomUUID(), at: new Date().toISOString(), corrects, by, decision, reason }];
  validateLog(next);
  return next;
}

module.exports = { appendDecision, validateLog };

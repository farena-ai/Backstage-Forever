"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { validId } = require("./guild-organizer.cjs");

const FILE = "supply-desk.json";
const MAX_ROWS = 48;
const MAX_HISTORY = 100;
const STATES = ["pledged", "reserved", "delivered", "available"];
const TYPES = ["request", "commitment", "capability"];
const invalid = () => new Error("Supply Desk change is invalid. Check the fields and quantities.");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit &&
  value === value.trim() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const quantity = value => Number.isInteger(value) && value > 0 && value <= 99999;
const valid = {
  request: row => exact(row, ["id", "item", "quantity"]) && validId(row.id) && text(row.item, 80) && quantity(row.quantity),
  commitment: row => exact(row, ["id", "requestId", "volunteer", "quantity", "status"]) && validId(row.id) &&
    validId(row.requestId) && text(row.volunteer, 80) && quantity(row.quantity) && STATES.includes(row.status),
  capability: row => exact(row, ["id", "volunteer", "offer"]) && validId(row.id) && text(row.volunteer, 80) && text(row.offer, 120),
};
const empty = () => ({ revision: 0, requests: [], commitments: [], capabilities: [], history: [] });
const list = { request: "requests", commitment: "commitments", capability: "capabilities" };

function validate(desk) {
  if (!exact(desk, ["revision", ...Object.values(list), "history"]) || !Number.isSafeInteger(desk.revision) || desk.revision < 0) throw invalid();
  for (const type of TYPES) {
    const rows = desk[list[type]];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS || !rows.every(valid[type]) || new Set(rows.map(row => row.id)).size !== rows.length) throw invalid();
  }
  if (!desk.commitments.every(row => desk.requests.some(request => request.id === row.requestId))) throw invalid();
  if (!Array.isArray(desk.history) || desk.history.length !== Math.min(desk.revision, MAX_HISTORY) || !desk.history.every(row =>
    exact(row, ["type", "at", "before", "after", "reason"]) && TYPES.includes(row.type) &&
    typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) && (row.before !== null || row.after !== null) &&
    (row.before === null ? row.reason === null : valid[row.type](row.before) && text(row.reason, 160)) &&
    (row.after === null || valid[row.type](row.after)) && (!row.before || !row.after || row.before.id === row.after.id))) throw invalid();
}

function change(desk, edit) {
  const type = edit?.type;
  if (!edit || typeof edit !== "object" || Array.isArray(edit) || !Object.hasOwn(edit, "type") || !TYPES.includes(type)) throw invalid();
  const rows = desk[list[type]];
  const creating = !Object.hasOwn(edit, "id");
  const { id = randomUUID(), reason = null, remove = false, ...fields } = edit;
  const { type: _type, ...values } = fields;
  const before = creating ? null : rows.find(row => row.id === id);
  if (creating ? Object.hasOwn(edit, "reason") || Object.hasOwn(edit, "remove") || rows.length >= MAX_ROWS : !before || !text(reason, 160)) throw invalid();
  if (Object.hasOwn(edit, "remove") && (remove !== true || !exact(edit, ["type", "id", "reason", "remove"]))) throw invalid();
  if (remove && type === "request" && desk.commitments.some(row => row.requestId === id))
    throw new Error("Supply Desk: remove the request's commitments before removing the request.");
  const after = remove ? null : { ...values, id };
  if (after && (!valid[type](after) || (type === "commitment" && before && before.requestId !== after.requestId))) throw invalid();
  if (before && after && Object.keys(after).every(key => before[key] === after[key])) return desk;
  const next = { ...desk, revision: desk.revision + 1,
    [list[type]]: before ? rows.flatMap(row => row === before ? after ? [after] : [] : [row]) : [...rows, after],
    history: [...desk.history.slice(1 - MAX_HISTORY), { type, at: new Date().toISOString(), before, after, reason }],
  };
  validate(next);
  return next;
}

function registerSupplyDesk({ handle, dataDir }) {
  // Prior releases can reset and reimport without knowing about the sidecar.
  // Never read or write it: only this running app session can own these rows.
  let desk = empty();
  let token = randomUUID();
  function view(desk) {
    return { ...desk, token, requests: desk.requests.map(row => {
      const totals = Object.fromEntries(STATES.map(status => [status, 0]));
      for (const entry of desk.commitments) if (entry.requestId === row.id) totals[entry.status] += entry.quantity;
      return { ...row, totals, remaining: Math.max(0, row.quantity - totals.delivered) };
    }) };
  }
  handle("supplyDesk", (op, ...args) => {
    if (op === "read" && args.length === 0) return view(desk);
    if (op === "reference" && args.length === 0) return { requests: view(desk).requests.map(({ item, quantity, totals, remaining }) => ({ item, quantity, totals, remaining })) };
    const [input] = args;
    if (op !== "change" || args.length !== 1 || !exact(input, ["token", "revision", "edit"])) throw invalid();
    if (input.token !== token || input.revision !== desk.revision) throw new Error("Supply Desk view is no longer current. Reopen it before editing.");
    desk = change(desk, input.edit);
    return view(desk);
  }, { privateOnly: true });
  return { reset() {
    desk = empty();
    token = randomUUID();
    // These files are inert. A locked orphan must not fail a committed reset
    // or prevent attempts to remove the other retired files.
    let failed = false;
    const remove = name => {
      try { fs.rmSync(path.join(dataDir, name), { force: true }); }
      catch { failed = true; }
    };
    try {
      for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const suffix = entry.name.slice(FILE.length + 1, -4);
        if (entry.name === `${FILE}.${suffix}.tmp` && validId(suffix)) remove(entry.name);
      }
    } catch { failed = true; }
    remove(FILE);
    if (failed) console.warn("Reset could not remove all retired Supply Desk files.");
  } };
}
module.exports = { registerSupplyDesk };

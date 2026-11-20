"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const FORMAT = "backstage-forever-plan-pack";
const SCOPE = "forever:deadmines:preparation";
const MAX_BYTES = 4096;
const STEPS = Object.freeze({
  "check-supplies": "Check your consumables and free bag space.",
  "repair-gear": "Check durability and repair your gear before leaving.",
  "confirm-roles": "Agree who will tank, heal and deal damage.",
  "agree-meeting-point": "Agree where your group will meet before entering.",
});
const MESSAGES = Object.freeze({
  invalid: "Plan pack request or JSON is invalid.",
  size: "Plan pack exceeds the 4 KiB limit.",
  version: "Plan pack format or version is not supported.",
  scope: "Only WoW Forever Deadmines preparation is supported.",
  revision: "Use a revision newer than the active plan.",
  stale: "This plan pack review is no longer current. Preview again.",
  previous: "There is no previous plan to restore.",
  read: "Local plan storage could not be read. No plan was changed.",
  write: "Local plan storage could not be updated. No plan was changed.",
});
function fail(key) { throw new Error(MESSAGES[key]); }

// Both schemas are flat objects with primitive values (or an array of step IDs).
// Count member separators outside strings so JSON.parse cannot hide duplicate keys.
function exactJSON(raw, keys) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("invalid"); }
  if (!value || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      (raw.match(/"(?:[^"\\]|\\.)*"|:/gs) || []).filter(token => token === ":").length !== keys.length) fail("invalid");
  return value;
}
function parse(raw) {
  if (typeof raw !== "string") fail("invalid");
  if (raw.length > MAX_BYTES || Buffer.byteLength(raw) > MAX_BYTES) fail("size");
  const { format, version, scope, revision, steps } = exactJSON(raw, ["format", "version", "scope", "revision", "steps"]);
  if (format !== FORMAT || version !== 1) fail("version");
  if (scope !== SCOPE) fail("scope");
  if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(steps) || !steps.length ||
      steps.length > Object.keys(STEPS).length || new Set(steps).size !== steps.length ||
      steps.some(id => typeof id !== "string" || !Object.hasOwn(STEPS, id))) fail("invalid");
  return { format, version, scope, revision, steps };
}

function registerLocalPlanPack({ handle, dataDir }) {
  const file = path.join(dataDir, "local-plan-pack.json"), stage = file + ".tmp";
  // One atomically replaced record keeps active and rollback bytes in the same generation.
  const maxRecord = 4 * MAX_BYTES + 128;
  let pending = null;
  function read() {
    try {
      let stat;
      try { stat = fs.lstatSync(file); } catch (error) {
        if (error.code === "ENOENT") return { bytes: null, record: { active: null, previous: null }, active: null, previous: null };
        throw error;
      }
      if (!stat.isFile() || stat.size > maxRecord) fail("read");
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
      let bytes;
      try {
        const buffer = Buffer.alloc(maxRecord + 1);
        if (!fs.fstatSync(fd).isFile()) fail("read");
        let count = 0;
        while (count <= maxRecord) {
          const n = fs.readSync(fd, buffer, count, buffer.length - count, null);
          if (!n) break;
          count += n;
        }
        if (count > maxRecord) fail("read");
        bytes = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, count));
      } finally { fs.closeSync(fd); }
      const record = exactJSON(bytes, ["active", "previous"]);
      const active = parse(record.active), previous = record.previous === null ? null : parse(record.previous);
      if (previous && previous.revision >= active.revision) fail("read");
      return { bytes, record, active, previous };
    } catch { fail("read"); }
  }
  function promote(record) {
    try {
      fs.rmSync(stage, { force: true });
      const fd = fs.openSync(stage, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(stage, file);
    } catch {
      try { fs.rmSync(stage, { force: true }); } catch {}
      fail("write");
    }
  }
  const snapshot = ({ active, previous }) => ({ active, previousRevision: previous?.revision ?? null, labels: STEPS });
  function preview(current, raw, proposed, operation) {
    const token = randomUUID();
    pending = { token, bytes: current.bytes, raw, operation };
    return { ...snapshot(current), proposed, token };
  }
  handle("localPlanPack", (action, ...args) => {
    switch (action) {
      case "status":
      case "cancel":
        if (args.length) fail("invalid");
        pending = null;
        return action === "status" ? snapshot(read()) : null;
      case "preview": {
        pending = null;
        if (args.length !== 1) fail("invalid");
        const [raw] = args, proposed = parse(raw), current = read();
        if (current.active && proposed.revision <= current.active.revision) fail("revision");
        return preview(current, raw, proposed, "import");
      }
      case "previewRollback": {
        pending = null;
        if (args.length) fail("invalid");
        const current = read();
        if (!current.previous) fail("previous");
        return preview(current, current.record.previous, current.previous, "rollback");
      }
      case "apply": {
        if (args.length !== 1 || typeof args[0] !== "string") fail("invalid");
        if (!pending || pending.token !== args[0]) fail("stale");
        const review = pending;
        pending = null;
        const current = read();
        if (current.bytes !== review.bytes) fail("stale");
        const previous = review.operation === "rollback" ? null : current.active;
        promote({ active: review.raw, previous: previous ? current.record.active : null });
        return snapshot({ active: parse(review.raw), previous });
      }
      default: fail("invalid");
    }
  }, { privateOnly: true });
  return { reset() { pending = null; fs.rmSync(stage, { force: true }); fs.rmSync(file, { force: true }); } };
}
module.exports = { registerLocalPlanPack, LOCAL_PLAN_MESSAGES: Object.values(MESSAGES) };

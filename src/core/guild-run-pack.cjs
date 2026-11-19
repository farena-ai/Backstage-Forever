"use strict";

const FORMAT = "backstage-forever-guild-run";
const VERSION = 1;
const MAX_GUILD_RUN_BYTES = 32 * 1024;
const EVENT_FIELDS = ["eventId", "revision", "status", "title", "destination", "meetingPoint", "start", "duties", "prep"];
const EVENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PREP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const OFFSET = /^[+-](?:[01]\d|2[0-3]):[0-5]\d$/;
const ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/;
const ROLES = ["all", "tank", "healer", "damage"];
const COPY_NOTICE = "Manually shared copy, not live sync. Later changes must be shared separately; you cannot retract copies already sent.";

function invalid() { throw new Error("Guild Run Pack is invalid. Check its format and event fields."); }
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) invalid();
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || !value.isWellFormed() || /[\p{Cc}\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) invalid();
  return value;
}
function list(value, max, project) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, i) => {
    if (!Object.hasOwn(value, i)) invalid();
    return project(value[i]);
  });
}
function select(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || fields.some(key => !Object.hasOwn(value, key))) invalid();
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}
function formatter(zone) {
  if (typeof zone !== "string" || zone.length > 80 || !ZONE.test(zone)) invalid();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
    });
  } catch { invalid(); }
}
function validateStart(start) {
  exact(start, ["utc", "timeZone"]);
  const { utc, timeZone } = start;
  if (typeof utc !== "string" || !UTC.test(utc) || utc.startsWith("0000") || !Number.isFinite(Date.parse(utc)) || new Date(utc).toISOString() !== utc) invalid();
  formatter(timeZone);
  return { utc, timeZone };
}

// The user chooses the UTC offset at a fall-back fold. A spring-forward gap has no valid offset.
function resolveGuildRunStart(input) {
  exact(input, ["local", "offset", "timeZone"]);
  const { local, offset, timeZone } = input;
  if (typeof local !== "string" || !WALL_TIME.test(local) || local.startsWith("0000") ||
      typeof offset !== "string" || !OFFSET.test(offset) || offset === "-00:00") invalid();
  const at = new Date(`${local}:00${offset}`);
  if (!Number.isFinite(at.getTime())) invalid();
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map(({ type, value }) => [type, value]));
  if (`${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== local || parts.second !== "00") invalid();
  return validateStart({ utc: at.toISOString(), timeZone });
}
function validatePack(pack) {
  exact(pack, ["format", "version", ...EVENT_FIELDS]);
  const { format, version, eventId, revision, status } = pack;
  if (format !== FORMAT || version !== VERSION || typeof eventId !== "string" || !EVENT_ID.test(eventId) ||
      !Number.isSafeInteger(revision) || revision < 1 || !["scheduled", "cancelled"].includes(status)) invalid();
  const result = {
    format, version, eventId, revision, status,
    title: text(pack.title, 100), destination: text(pack.destination, 120), meetingPoint: text(pack.meetingPoint, 160),
    start: validateStart(pack.start),
    duties: list(pack.duties, 16, duty => {
      exact(duty, ["role", "text"]);
      if (!ROLES.includes(duty.role)) invalid();
      return { role: duty.role, text: text(duty.text, 240) };
    }),
    prep: list(pack.prep, 32, action => {
      exact(action, ["id", "text"]);
      if (typeof action.id !== "string" || !PREP_ID.test(action.id)) invalid();
      return { id: action.id, text: text(action.text, 240) };
    }),
  };
  if (status === "cancelled" && (result.duties.length || result.prep.length)) invalid();
  if (new Set(result.prep.map(action => action.id)).size !== result.prep.length) invalid();
  return result;
}

function serializeGuildRunPack(pack) {
  const wire = JSON.stringify(validatePack(pack), null, 2);
  if (Buffer.byteLength(wire) > MAX_GUILD_RUN_BYTES) invalid();
  return wire;
}

// Scan valid JSON before accepting the parsed result: JSON.parse silently keeps the last duplicate key.
function rejectDuplicateKeys(raw) {
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") stack.push(new Set());
    else if (raw[i] === "}") stack.pop();
    else if (raw[i] === '"') {
      const start = i++;
      for (; raw[i] !== '"'; i++) if (raw[i] === "\\") i++;
      let end = i + 1;
      while (/[\t\r\n ]/.test(raw[end] ?? "")) end++;
      if (raw[end] === ":") {
        const key = JSON.parse(raw.slice(start, i + 1));
        const keys = stack.at(-1);
        if (keys.has(key)) invalid();
        keys.add(key);
      }
    }
  }
}
function parseGuildRunPack(raw) {
  try {
    if (!(typeof raw === "string" || Buffer.isBuffer(raw)) || Buffer.byteLength(raw) > MAX_GUILD_RUN_BYTES) invalid();
    if (Buffer.isBuffer(raw)) raw = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const value = JSON.parse(raw);
    rejectDuplicateKeys(raw);
    const pack = validatePack(value);
    // Keep imports re-exportable within the same canonical size limit.
    serializeGuildRunPack(pack);
    return pack;
  } catch { invalid(); }
}

function renderGuildRunText(pack) {
  const { title, eventId, revision, status, destination, meetingPoint, start, duties, prep } = pack;
  const at = new Date(start.utc);
  const organizerTime = formatter(start.timeZone).format(at);

  return [
    `${title} [${status === "cancelled" ? "CANCELLED" : "Scheduled"}, revision ${revision}]`,
    `Event: ${eventId}`, `Destination: ${destination}`, `Meeting point: ${meetingPoint}`,
    `${status === "cancelled" ? "Former start" : "Start"}: ${organizerTime} (${start.timeZone}) / ${start.utc}`,
    ...(status === "cancelled" ? ["This run is cancelled; do not use the prep plan."] : [
      ...duties.map(duty => `${duty.role}: ${duty.text}`),
      ...prep.map(action => `Prep: ${action.text}`),
    ]),
    COPY_NOTICE,
  ].join("\n");
}

// Only explicitly authored fields leave the draft. Private state is never an input to serialization.
function previewGuildRunPack(draft, viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const event = select(draft, EVENT_FIELDS);
  const pack = validatePack({
    format: FORMAT, version: VERSION, ...event,
    start: select(event.start, ["utc", "timeZone"]),
    duties: list(event.duties, 16, duty => select(duty, ["role", "text"])),
    prep: list(event.prep, 32, action => select(action, ["id", "text"])),
  });
  serializeGuildRunPack(pack);
  for (const field of ["duties", "prep"]) {
    pack[field].forEach(Object.freeze);
    Object.freeze(pack[field]);
  }
  Object.freeze(pack.start);
  const viewerTime = `${formatter(viewerZone).format(new Date(pack.start.utc))} (${viewerZone})`;
  return { pack: Object.freeze(pack), text: renderGuildRunText(pack), viewerTime };
}

function validateMemberRecord(record) {
  exact(record, ["pack", "completedPrepIds"]);
  const wire = serializeGuildRunPack(record.pack);
  const actions = new Map(record.pack.prep.map(action => [action.id, action.text]));
  const completed = list(record.completedPrepIds, actions.size, id => {
    if (!actions.has(id)) invalid();
    return id;
  });
  if (new Set(completed).size !== completed.length) invalid();
  return { wire, actions, completed };
}

/** The caller chooses when to commit a parsed copy and looks up the prior record by event ID. */
function applyGuildRunPack(current, incoming) {
  const pack = validatePack(incoming);
  const wire = serializeGuildRunPack(pack);
  if (current === null) return { outcome: "imported", record: { pack, completedPrepIds: [] } };
  const previous = validateMemberRecord(current);
  if (pack.eventId !== current.pack.eventId) invalid();
  if (pack.revision < current.pack.revision) return { outcome: "stale", record: current };
  if (pack.revision === current.pack.revision) return { outcome: wire === previous.wire ? "duplicate" : "conflict", record: current };
  if (current.pack.status === "cancelled" && pack.status !== "cancelled") return { outcome: "conflict", record: current };
  const done = new Set(previous.completed);
  const completedPrepIds = pack.prep.filter(action => done.has(action.id) && previous.actions.get(action.id) === action.text).map(action => action.id);
  return { outcome: "updated", record: { pack, completedPrepIds } };
}

/** Member-only state; never pass this record to the public serializer or a provider. */
function setGuildRunPrepDone(record, actionId, done) {
  const { actions, completed } = validateMemberRecord(record);
  if (record.pack.status !== "scheduled" || !actions.has(actionId) || typeof done !== "boolean") invalid();
  const marked = new Set(completed);
  if (done) marked.add(actionId);
  else marked.delete(actionId);
  return { pack: record.pack, completedPrepIds: [...actions.keys()].filter(id => marked.has(id)) };
}

module.exports = {
  MAX_GUILD_RUN_BYTES, previewGuildRunPack, serializeGuildRunPack, parseGuildRunPack,
  resolveGuildRunStart, applyGuildRunPack, setGuildRunPrepDone,
};

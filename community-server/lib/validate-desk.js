"use strict";
// Strict validation for the Backstage Desk endpoints (heartbeat, tickets,
// errors, announcements). Same rules as validate.js: unknown fields are
// rejected and every value is on a fixed list or matches a fixed pattern.
const { fail, plainObject, array, oneOf, intRange, installId, BUILD, MAX_ID } = require("./validate");

const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const OS_MAJOR = /^[0-9]{1,3}$/;
const ISO_WEEK = /^\d{4}-W\d{2}$/;
const TICKET_ID = /^BF-(\d{4,9})$/;
const TICKET_KEY = /^[A-Za-z0-9_-]{43}$/;
const OS_FAMILIES = Object.freeze(["windows", "macos", "linux"]);
const LANGS = Object.freeze(["en", "de", "fr", "es"]);
const CHANNELS = Object.freeze(["stable", "beta", "dev"]);
const FLAGS = Object.freeze(["gameConnected", "addonInstalled", "liveLink", "sharing"]);
const HEARTBEAT_AREAS = Object.freeze(["now", "route", "map", "dungeons", "professions", "ledger", "talents", "journey", "companion"]);
const TICKET_KINDS = Object.freeze(["bug", "data", "translation", "idea", "other"]);
const TICKET_AREAS = Object.freeze(["now", "route", "map", "quests", "dungeons", "professions", "ledger", "talents", "gear",
  "journey", "companion", "travel", "settings", "addon-ingame", "install-update", "website", "other"]);
const FREQUENCIES = Object.freeze(["once", "sometimes", "always"]);
const TICKET_STATUSES = Object.freeze(["new", "looking", "question", "fixed", "closed"]);
const SEVERITIES = Object.freeze(["low", "normal", "high", "critical"]);
const ERROR_ORIGINS = Object.freeze(["main", "renderer"]);
const ANNOUNCEMENT_LEVELS = Object.freeze(["info", "warning"]);
const DESK_LIMITS = Object.freeze({
  summaryMin: 5, summary: 140, detailsMin: 10, details: 4000, expected: 1000, lastError: 2000,
  message: 4000, syncTickets: 50, errorName: 60, errorMessage: 300, stackLines: 12, stackLine: 200,
  announcementTitle: 80, announcementText: 600,
});

function chars(text) { let n = 0; for (const _ of text) n += 1; return n; }

// Plain text: NFC, newlines kept (CRLF folded to LF), tabs tolerated, every
// other control character (C0, DEL, C1) and broken surrogates rejected.
// Limits are in characters (code points). Stored as given; escaped on output.
function deskText(value, path, min, max, { singleLine = false } = {}) {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length > max * 2 + 16) fail(path, `must be at most ${max} characters`);
  if (!value.isWellFormed()) fail(path, "is not valid Unicode");
  const text = value.replace(/\r\n?/g, "\n").normalize("NFC");
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text)) fail(path, "contains control characters");
  if (singleLine && /[\n\t]/.test(text)) fail(path, "must be a single line");
  if (chars(text) > max) fail(path, `must be at most ${max} characters`);
  if (text.trim().length < min) fail(path, `must be at least ${min} characters`);
  return text;
}

function schema1(body) { if (body.schema !== 1) fail("schema", "must be 1"); }
function matching(value, path, re) {
  if (typeof value !== "string" || !re.test(value)) fail(path, "has an invalid format");
  return value;
}
function nullable(value, path, fn) { return value === null ? null : fn(value, path); }
function bool(value, path) { if (typeof value !== "boolean") fail(path, "must be true or false"); return value; }

function validateHeartbeat(body) {
  const keys = ["schema", "installId", "appVersion", "addonVersion", "channel", "os", "osMajor", "lang", "build", "firstSeenWeek", "flags", "areas"];
  plainObject(body, "", keys, keys);
  schema1(body);
  const flags = plainObject(body.flags, "flags", FLAGS, FLAGS);
  const seen = new Set();
  for (const [i, a] of array(body.areas, "areas", HEARTBEAT_AREAS.length).entries()) {
    oneOf(a, `areas[${i}]`, HEARTBEAT_AREAS);
    if (seen.has(a)) fail(`areas[${i}]`, "duplicate area");
    seen.add(a);
  }
  const week = Number(matching(body.firstSeenWeek, "firstSeenWeek", ISO_WEEK).slice(6));
  if (week < 1 || week > 53) fail("firstSeenWeek", "has an invalid format");
  return {
    installId: installId(body.installId),
    appVersion: matching(body.appVersion, "appVersion", SEMVER),
    addonVersion: nullable(body.addonVersion, "addonVersion", (v, p) => matching(v, p, SEMVER)),
    channel: oneOf(body.channel, "channel", CHANNELS),
    os: oneOf(body.os, "os", OS_FAMILIES),
    osMajor: nullable(body.osMajor, "osMajor", (v, p) => matching(v, p, OS_MAJOR)),
    lang: oneOf(body.lang, "lang", LANGS),
    build: nullable(body.build, "build", (v, p) => matching(v, p, BUILD)),
    firstSeenWeek: body.firstSeenWeek,
    flags: Object.fromEntries(FLAGS.map(f => [f, bool(flags[f], `flags.${f}`)])),
    areas: HEARTBEAT_AREAS.filter(a => seen.has(a)),
  };
}

function validateTicket(body) {
  const required = ["schema", "installId", "appVersion", "addonVersion", "os", "osMajor", "lang", "build", "kind", "area", "frequency", "summary", "details", "expected"];
  plainObject(body, "", [...required, "diagnostics"], required);
  schema1(body);
  let diagnostics = null;
  if (body.diagnostics !== undefined && body.diagnostics !== null) {
    const dk = ["screen", "lastError", "gameConnected", "addonInstalled"];
    const d = plainObject(body.diagnostics, "diagnostics", dk, dk);
    diagnostics = {
      screen: matching(d.screen, "diagnostics.screen", /^[A-Za-z0-9][A-Za-z0-9 _.:/-]{0,59}$/),
      lastError: nullable(d.lastError, "diagnostics.lastError", (v, p) => deskText(v, p, 0, DESK_LIMITS.lastError)),
      gameConnected: bool(d.gameConnected, "diagnostics.gameConnected"),
      addonInstalled: bool(d.addonInstalled, "diagnostics.addonInstalled"),
    };
  }
  return {
    installId: installId(body.installId),
    appVersion: matching(body.appVersion, "appVersion", SEMVER),
    addonVersion: nullable(body.addonVersion, "addonVersion", (v, p) => matching(v, p, SEMVER)),
    os: oneOf(body.os, "os", OS_FAMILIES),
    osMajor: nullable(body.osMajor, "osMajor", (v, p) => matching(v, p, OS_MAJOR)),
    lang: oneOf(body.lang, "lang", LANGS),
    build: nullable(body.build, "build", (v, p) => matching(v, p, BUILD)),
    kind: oneOf(body.kind, "kind", TICKET_KINDS),
    area: oneOf(body.area, "area", TICKET_AREAS),
    frequency: nullable(body.frequency, "frequency", (v, p) => oneOf(v, p, FREQUENCIES)),
    summary: deskText(body.summary, "summary", DESK_LIMITS.summaryMin, DESK_LIMITS.summary),
    details: deskText(body.details, "details", DESK_LIMITS.detailsMin, DESK_LIMITS.details),
    expected: deskText(body.expected, "expected", 0, DESK_LIMITS.expected),
    diagnostics,
  };
}

function validateTicketMessage(body) {
  plainObject(body, "", ["schema", "text"], ["schema", "text"]);
  schema1(body);
  return { text: deskText(body.text, "text", 1, DESK_LIMITS.message) };
}

// Returns the ticket number, or null when the value is not a ticket id.
function ticketNumber(value) {
  const m = typeof value === "string" ? TICKET_ID.exec(value) : null;
  return m ? Number(m[1]) : null;
}
function ticketLabel(n) { return `BF-${String(n).padStart(4, "0")}`; }
function ticketKey(value) { return typeof value === "string" && TICKET_KEY.test(value) ? value : null; }

function validateTicketSync(body) {
  plainObject(body, "", ["schema", "tickets"], ["schema", "tickets"]);
  schema1(body);
  const seen = new Set();
  return {
    tickets: array(body.tickets, "tickets", DESK_LIMITS.syncTickets).map((t, i) => {
      const p = `tickets[${i}]`;
      plainObject(t, p, ["ticket", "key", "since"], ["ticket", "key"]);
      const number = ticketNumber(t.ticket);
      if (number === null) fail(`${p}.ticket`, "has an invalid format");
      if (seen.has(number)) fail(`${p}.ticket`, "duplicate ticket");
      seen.add(number);
      if (ticketKey(t.key) === null) fail(`${p}.key`, "has an invalid format");
      const since = t.since === undefined || t.since === null ? 0 : intRange(t.since, `${p}.since`, 0, MAX_ID);
      return { ticket: ticketLabel(number), number, key: t.key, since };
    }),
  };
}

function validateSince(params) {
  let since = 0, seen = false;
  for (const [k, v] of params) {
    if (k !== "since") fail(k.slice(0, 40), "unknown field");
    if (seen) fail("since", "given more than once");
    seen = true;
    if (!/^\d{1,10}$/.test(v) || Number(v) > MAX_ID) fail("since", "must be a message id");
    since = Number(v);
  }
  return since;
}

// Directories never belong in an error report. The app removes them; the
// server removes them again so a client bug cannot store a local path.
// "at f (C:\Users\me\app\main.js:10:3)" -> "at f (main.js:10:3)".
function stripDirs(line) {
  return line
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/+/g, "")
    .replace(/(?:[A-Za-z]:)?[\\/]*(?:[^\s()\\/"']+[\\/]+)+/g, "")
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]+/g, "")
    .replace(/(^|[\s("'])[\\/]+/g, "$1");
}
// For free-form error messages: only things that are clearly absolute paths.
function stripAbsolutePaths(text) {
  return text.replace(/(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\|(?<![\w.:/<-])\/(?=[^\s/]+\/))[^\s"'()<>]*/g, "<path>");
}

function validateError(body) {
  const keys = ["schema", "installId", "appVersion", "os", "osMajor", "lang", "where", "name", "message", "stack"];
  plainObject(body, "", keys, keys);
  schema1(body);
  return {
    installId: installId(body.installId),
    appVersion: matching(body.appVersion, "appVersion", SEMVER),
    os: oneOf(body.os, "os", OS_FAMILIES),
    osMajor: nullable(body.osMajor, "osMajor", (v, p) => matching(v, p, OS_MAJOR)),
    lang: oneOf(body.lang, "lang", LANGS),
    where: oneOf(body.where, "where", ERROR_ORIGINS),
    name: deskText(body.name, "name", 1, DESK_LIMITS.errorName, { singleLine: true }),
    message: stripAbsolutePaths(deskText(body.message, "message", 0, DESK_LIMITS.errorMessage)),
    stack: array(body.stack, "stack", DESK_LIMITS.stackLines).map((l, i) =>
      stripDirs(deskText(l, `stack[${i}]`, 0, DESK_LIMITS.stackLine, { singleLine: true }))),
  };
}

function validateAnnouncementQuery(params) {
  const out = { appVersion: null, os: null, lang: null };
  for (const [k, v] of params) {
    if (!Object.hasOwn(out, k)) fail(k.slice(0, 40), "unknown field");
    if (out[k] !== null) fail(k, "given more than once");
    out[k] = k === "appVersion" ? matching(v, k, SEMVER) : oneOf(v, k, k === "os" ? OS_FAMILIES : LANGS);
  }
  return out;
}

const LINK_HOSTS = Object.freeze(["backstagecoding.com", "www.backstagecoding.com", "bf.backstagecoding.com"]);
// null, or an https link to the project on GitHub or to backstagecoding.com.
function announcementLink(value, path = "link") {
  if (value === null || value === undefined || value === "") return null;
  const bad = () => fail(path, "must be an https link to github.com/farena-ai/Backstage-Forever or backstagecoding.com");
  if (typeof value !== "string" || value.length > 300 || /[\s<>"'\\`\x00-\x1f\x7f]/.test(value)) bad();
  let url;
  try { url = new URL(value); } catch { bad(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !value.startsWith(`https://${url.hostname}`)) bad();
  if (url.hostname === "github.com") {
    if (!/^\/farena-ai\/Backstage-Forever(?:\/|$)/.test(url.pathname) || url.pathname.includes("..")) bad();
  } else if (!LINK_HOSTS.includes(url.hostname)) bad();
  return value;
}

function compareVersions(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

module.exports = {
  validateHeartbeat, validateTicket, validateTicketMessage, validateTicketSync, validateSince, validateError,
  validateAnnouncementQuery, announcementLink, compareVersions, deskText, stripDirs, stripAbsolutePaths,
  ticketNumber, ticketLabel, ticketKey, chars,
  SEMVER, DESK_LIMITS, OS_FAMILIES, LANGS, CHANNELS, FLAGS, HEARTBEAT_AREAS, TICKET_KINDS, TICKET_AREAS,
  FREQUENCIES, TICKET_STATUSES, SEVERITIES, ERROR_ORIGINS, ANNOUNCEMENT_LEVELS,
};

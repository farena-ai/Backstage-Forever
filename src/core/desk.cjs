"use strict";
// Backstage Desk: reports with replies, anonymous statistics, automatic error reports and
// messages from the team. It talks to the same service as community sharing, through that
// client's request helper, and follows the Backstage Desk contract (sections D1 to D9 of
// community-server/CLIENT-CONTRACT.md).
//
// The privacy line: every body that leaves is built by one pure function below from a fixed list
// of fields. Nothing else can get in. No account, character, realm or guild names, no files, no
// chat. Text the player did not type goes through the scrubber (desk-scrub.cjs) first.
// Ticket keys are secrets: they live in the app's own data folder, are never logged, never
// shown, and are sent only in the X-BF-Ticket-Key header (and the sync body the contract asks for).
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { atomic } = require("./store.cjs");
const { scrub, scrubStack } = require("./desk-scrub.cjs");

// The one place that decides whether anonymous statistics are on for a player who never touched
// the switch. The owner may flip this to false; nothing else needs to change.
const STATISTICS_DEFAULT = true;
// Automatic error reports are off until the player switches them on.
const ERRORS_DEFAULT = false;

const START_DELAY = 30 * 1000, TICK_EVERY = 10 * 60 * 1000;
const SYNC_EVERY = 3 * 60 * 60 * 1000, ANNOUNCE_EVERY = 60 * 60 * 1000, HEARTBEAT_AFTER = 60_000;
const BACKOFF_MIN = 60 * 1000, BACKOFF_MAX = 60 * 60 * 1000;
const MAX_TICKETS = 200, MAX_OUTBOX = 20, SYNC_BATCH = 50, MAX_SEEN = 500;
const ERRORS_PER_DAY = 5, ERROR_GAP = 60 * 1000;

const KINDS = Object.freeze(["bug", "data", "translation", "idea", "other"]);
const AREAS = Object.freeze(["now", "route", "map", "quests", "dungeons", "professions", "ledger", "talents", "gear", "journey", "companion", "travel", "settings", "addon-ingame", "install-update", "website", "other"]);
const FREQUENCIES = Object.freeze(["once", "sometimes", "always"]);
const STATUSES = Object.freeze(["new", "looking", "question", "fixed", "closed"]);
const HEARTBEAT_AREAS = Object.freeze(["now", "route", "map", "dungeons", "professions", "ledger", "talents", "journey", "companion"]);
const LANGS = Object.freeze(["en", "de", "fr", "es"]), CHANNELS = Object.freeze(["stable", "beta", "dev"]), SYSTEMS = Object.freeze(["windows", "macos", "linux"]);
const LIMITS = Object.freeze({ summary: [5, 140], details: [10, 4000], expected: [0, 1000], reply: [1, 4000], lastError: 2000, errorName: 60, errorMessage: 300 });
// App screens (routes) → the area names of the heartbeat. Anything else is not counted.
const ROUTE_AREA = Object.freeze({
  now: "now", adventure: "route", "guided-route": "route", "world-map": "map", dungeons: "dungeons", "run-history": "dungeons", attunements: "dungeons",
  preparation: "professions", ledger: "ledger", "ledger-gold": "ledger", "ledger-crafts": "ledger", "ledger-reputation": "ledger", "ledger-cooldowns": "ledger",
  talents: "talents", journey: "journey", assistant: "companion",
});
// App screens → the area list of the report form (a first guess the player can change).
const ROUTE_REPORT_AREA = Object.freeze({
  ...ROUTE_AREA, "quest-guide": "quests", zones: "map", travel: "travel", sheet: "gear", characters: "journey", alts: "journey", badges: "journey",
  company: "other", party: "other", calendar: "other", "practice-lab": "dungeons", game: "settings", connections: "settings", updates: "install-update", privacy: "settings",
});
const SCREEN_RE = /^[a-z][a-z-]{0,31}$/;
// The only screen names a report may carry: the app's own pages. Anything else is sent as "other".
const SCREENS = Object.freeze([...Object.keys(ROUTE_REPORT_AREA), "guide", "commands", "coverage", "report", "reports", "other"]);
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/, BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TICKET_RE = /^BF-\d{1,9}$/, KEY_RE = /^[A-Za-z0-9_-]{43}$/, WEEK_RE = /^\d{4}-W\d{2}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINK_HOSTS = Object.freeze(["backstagecoding.com", "www.backstagecoding.com", "bf.backstagecoding.com"]);
const LINK_REPO = "/farena-ai/Backstage-Forever";

// ---------------------------------------------------------------- pure helpers
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** ISO-8601 week of a time, in UTC: "2026-W48". */
function isoWeek(ms) {
  const d = new Date(ms), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const version = (v) => (typeof v === "string" && VERSION_RE.test(v) ? v : null);
const coreVersion = (v) => { const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(String(v ?? "")); return m ? m[1] : null; };
const build = (v) => (typeof v === "string" && BUILD_RE.test(v) ? v : null);
const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);
/** -1, 0 or 1 for two x.y.z versions; null when either is not one. */
function compareVersions(a, b) {
  if (!version(a) || !version(b)) return null;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
/** Operating system family and major version from Node's own facts. Linux has no meaningful major. */
function systemInfo({ platform = process.platform, release = "", systemVersion = "" } = {}) {
  if (platform === "win32") {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(release));
    return { os: "windows", osMajor: m ? (Number(m[1]) === 10 ? (Number(m[3]) >= 22000 ? "11" : "10") : m[1].slice(0, 3)) : null };
  }
  if (platform === "darwin") { const m = /^(\d{1,3})\./.exec(String(systemVersion)); return { os: "macos", osMajor: m ? m[1] : null }; }
  return { os: "linux", osMajor: null };
}
/** Plain text as the contract wants it: NFC, line breaks as \n, no other control characters. */
function cleanText(value, max) {
  const s = String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  const chars = Array.from(s);
  return max && chars.length > max ? chars.slice(0, max).join("") : s;
}
const length = (s) => Array.from(s).length;
const base = (i) => {
  if (!UUID_RE.test(i?.installId)) throw Error("Desk: no install id.");
  return { schema: 1, installId: i.installId, appVersion: version(i.appVersion) || "0.0.0" };
};
const system = (i) => ({ os: oneOf(SYSTEMS, i?.os, "windows"), osMajor: typeof i?.osMajor === "string" && /^[0-9]{1,3}$/.test(i.osMajor) ? i.osMajor : null, lang: oneOf(LANGS, i?.lang, "en") });

/** D1. The whole heartbeat, from an explicit list. Extra properties of the input are ignored. */
function heartbeatBody(i) {
  const s = system(i), f = i?.flags || {};
  return {
    ...base(i), addonVersion: version(i.addonVersion), channel: oneOf(CHANNELS, i.channel, "dev"),
    os: s.os, osMajor: s.osMajor, lang: s.lang, build: build(i.build),
    firstSeenWeek: typeof i.firstSeenWeek === "string" && WEEK_RE.test(i.firstSeenWeek) ? i.firstSeenWeek : isoWeek(Date.now()),
    flags: { gameConnected: f.gameConnected === true, addonInstalled: f.addonInstalled === true, liveLink: f.liveLink === true, sharing: f.sharing === true },
    areas: HEARTBEAT_AREAS.filter((a) => (i.areas instanceof Set ? i.areas.has(a) : Array.isArray(i.areas) && i.areas.includes(a))),
  };
}
/** D2. A new report. Throws a plain sentence when the player's text does not fit. */
function ticketBody(i) {
  const s = system(i);
  const summary = cleanText(i.summary).replace(/\n+/g, " "), details = cleanText(i.details), expected = cleanText(i.expected);
  if (!KINDS.includes(i.kind)) throw new DeskError("invalid", "Choose what kind of report this is.");
  if (!AREAS.includes(i.area)) throw new DeskError("invalid", "Choose where it happened.");
  if (length(summary) < LIMITS.summary[0]) throw new DeskError("invalid", "Write a short summary, at least 5 characters.");
  if (length(summary) > LIMITS.summary[1]) throw new DeskError("invalid", "The summary is too long. Keep it under 140 characters.");
  if (length(details) < LIMITS.details[0]) throw new DeskError("invalid", "Tell us what happened, at least 10 characters.");
  if (length(details) > LIMITS.details[1]) throw new DeskError("invalid", "What happened is too long. Keep it under 4,000 characters.");
  if (length(expected) > LIMITS.expected[1]) throw new DeskError("invalid", "What you expected is too long. Keep it under 1,000 characters.");
  const d = i.diagnostics;
  return {
    ...base(i), addonVersion: version(i.addonVersion), os: s.os, osMajor: s.osMajor, lang: s.lang, build: build(i.build),
    kind: i.kind, area: i.area, frequency: FREQUENCIES.includes(i.frequency) ? i.frequency : null,
    summary, details, expected,
    diagnostics: d && typeof d === "object" ? {
      screen: SCREENS.includes(d.screen) ? d.screen : "other",
      lastError: typeof d.lastError === "string" && d.lastError.trim() ? cleanText(d.lastError, LIMITS.lastError) : null,
      gameConnected: d.gameConnected === true, addonInstalled: d.addonInstalled === true,
    } : null,
  };
}
/** D7. An automatic error report: type, message and stack, all scrubbed, file names only. */
function errorBody(i, { names = [] } = {}) {
  const s = system(i);
  // Only real error type names ("TypeError", "DOMException"); anything else could be a word from somewhere private.
  const name = /^(?:[A-Z][A-Za-z0-9]{0,50}Error|DOMException)$/.test(i?.name) && !names.some((n) => String(n).toLowerCase() === String(i.name).toLowerCase()) ? i.name : "Error";
  return {
    ...base(i), os: s.os, osMajor: s.osMajor, lang: s.lang,
    where: i.where === "renderer" ? "renderer" : "main", name,
    message: cleanText(scrub(cleanText(i.message, 2000).replace(/\n+/g, " "), { names }).text, LIMITS.errorMessage),
    stack: scrubStack(i.stack, { names }),
  };
}
const errorSignature = (b) => crypto.createHash("sha256").update([b.where, b.name, ...b.stack.slice(0, 3)].join("\n")).digest("hex").slice(0, 16);
/** A link from the team may only point at the project's GitHub repository or backstagecoding.com. */
function linkAllowed(link) {
  if (typeof link !== "string" || link.length > 300) return false;
  let u;
  try { u = new URL(link); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  if (u.hostname === "github.com") return u.pathname === LINK_REPO || u.pathname.startsWith(LINK_REPO + "/");
  return LINK_HOSTS.includes(u.hostname);
}
/** D8. One announcement from the service, or null when anything is off. A bad link is dropped, not followed. */
function validAnnouncement(a) {
  if (!a || typeof a !== "object" || !Number.isSafeInteger(a.id) || a.id < 1) return null;
  const title = typeof a.title === "string" ? cleanText(a.title).replace(/\n+/g, " ") : "", text = typeof a.text === "string" ? cleanText(a.text) : "";
  if (!title || length(title) > 80 || !text || length(text) > 600) return null;
  const from = typeof a.from === "string" ? Date.parse(a.from) : NaN, until = typeof a.until === "string" ? Date.parse(a.until) : NaN;
  return { id: a.id, title, text, level: a.level === "warning" ? "warning" : "info", from: Number.isFinite(from) ? from : null, until: Number.isFinite(until) ? until : null, link: linkAllowed(a.link) ? a.link : null };
}

function friendly(code) {
  return {
    offline: "The service could not be reached. Try again later.",
    blocked: "This install can no longer send reports.",
    rate: "Too many requests right now. Try again in a little while.",
    inbox: "The report inbox is full right now. Try again later.",
    invalid: "The service did not accept this. Check the text and try again.",
    gone: "This report no longer exists.",
  }[code] || "The service could not be reached. Try again later.";
}
class DeskError extends Error { constructor(code, message) { super(message || friendly(code)); this.name = "DeskError"; this.code = code; } }

// ---------------------------------------------------------------- service
class DeskService {
  /**
   * community: the CommunityService (install id, request helper, sharing switch).
   * getFacts(): { addonVersion, build, gameConnected, addonInstalled, liveLink } from local status only.
   * getNames(): names the scrubber must remove (characters, realms, guilds, account folders, user name).
   * automatic: false stops everything the app would send by itself (statistics, error reports, polling, messages
   *   from the team). A development or test run uses it so it never adds to the real service's numbers; what the
   *   player does by hand (send a report, read replies, delete) still works.
   */
  constructor({ dir, community, appVersion = "", channel = "dev", now = Date.now, system: sys = systemInfo(), getFacts = () => ({}), getNames = () => [],
    notify = null, onChange = () => {}, automatic = true, timers = { setTimeout, clearTimeout, setInterval, clearInterval } } = {}) {
    Object.assign(this, { automatic: automatic !== false, community, appVersion: coreVersion(appVersion) || "0.0.0", channel, now, sys, getFacts, getNames, notify, onChange, timers });
    this.dir = dir ? path.join(dir, "desk") : null;
    this.state = this.read();
    this.areas = new Set(); this.areasDay = utcDay(this.now()); // which main sections were opened today: memory only
    this.lastError = null; this.lastScreen = "other";
    this.sentSignatures = new Set(); this.lastErrorSentAt = 0;
    this.nextSyncAt = 0; this.startedAt = this.now();
    this.preview = null; this.handles = []; this.busy = new Set();
  }

  // -------- local store
  file() { return this.dir ? path.join(this.dir, "state.json") : null; }
  read() {
    let raw = {};
    const f = this.file();
    if (f) try { const st = fs.statSync(f); if (st.isFile() && st.size < 4 * 1024 * 1024) raw = JSON.parse(fs.readFileSync(f, "utf8")) || {}; } catch { raw = {}; }
    const time = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const ticket = (t) => (t && TICKET_RE.test(t.ticket) && KEY_RE.test(t.key) ? {
      ticket: t.ticket, key: t.key, summary: text(t.summary, 200), status: oneOf(STATUSES, t.status, "new"), fixedIn: version(t.fixedIn),
      kind: oneOf(KINDS, t.kind, "other"), area: oneOf(AREAS, t.area, "other"),
      lastId: Number.isSafeInteger(t.lastId) && t.lastId >= 0 ? t.lastId : 0, unread: Number.isSafeInteger(t.unread) && t.unread >= 0 ? Math.min(t.unread, 999) : 0,
      createdAt: text(t.createdAt, 40) || null, updatedAt: text(t.updatedAt, 40) || null,
    } : null);
    const out = (o) => {
      if (!o || typeof o.id !== "string" || !/^[a-f0-9]{16}$/.test(o.id)) return null;
      if (o.type === "ticket" && o.body && typeof o.body === "object") return { id: o.id, type: "ticket", body: o.body, queuedAt: time(o.queuedAt) || 0 };
      if (o.type === "reply" && TICKET_RE.test(o.ticket) && typeof o.text === "string") return { id: o.id, type: "reply", ticket: o.ticket, text: o.text.slice(0, 4000), queuedAt: time(o.queuedAt) || 0 };
      return null;
    };
    return {
      schemaVersion: 1,
      statistics: typeof raw.statistics === "boolean" ? raw.statistics : null, // null: the player never chose; STATISTICS_DEFAULT applies
      errors: typeof raw.errors === "boolean" ? raw.errors : null,
      notify: raw.notify === true,
      lang: oneOf(LANGS, raw.lang, "en"),
      firstSeenWeek: typeof raw.firstSeenWeek === "string" && WEEK_RE.test(raw.firstSeenWeek) ? raw.firstSeenWeek : null,
      lastHeartbeatDay: typeof raw.lastHeartbeatDay === "string" && DAY_RE.test(raw.lastHeartbeatDay) ? raw.lastHeartbeatDay : null,
      tickets: (Array.isArray(raw.tickets) ? raw.tickets : []).map(ticket).filter(Boolean).slice(0, MAX_TICKETS),
      outbox: (Array.isArray(raw.outbox) ? raw.outbox : []).map(out).filter(Boolean).slice(0, MAX_OUTBOX),
      seen: (Array.isArray(raw.seen) ? raw.seen : []).filter((n) => Number.isSafeInteger(n) && n > 0).slice(-MAX_SEEN),
      announcements: (Array.isArray(raw.announcements) ? raw.announcements : []).map(validAnnouncement).filter(Boolean).slice(0, 20),
      announceEtag: typeof raw.announceEtag === "string" && raw.announceEtag.length <= 200 ? raw.announceEtag : null,
      announceCheckedAt: time(raw.announceCheckedAt),
      errorDay: typeof raw.errorDay === "string" && DAY_RE.test(raw.errorDay) ? raw.errorDay : null,
      errorCount: Number.isSafeInteger(raw.errorCount) && raw.errorCount >= 0 ? raw.errorCount : 0,
      failures: Number.isSafeInteger(raw.failures) && raw.failures >= 0 && raw.failures < 64 ? raw.failures : 0,
      backoffUntil: time(raw.backoffUntil), blocked: raw.blocked === true,
    };
  }
  save() {
    const f = this.file(); if (!f) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // Announcements are stored as the service sent them (times as text), so a re-read validates them again.
      const announcements = this.state.announcements.map((a) => ({ ...a, from: a.from ? new Date(a.from).toISOString() : null, until: a.until ? new Date(a.until).toISOString() : null }));
      atomic(f, JSON.stringify({ ...this.state, announcements }));
    } catch { /* best effort: state stays in memory */ }
  }
  get statisticsOn() { return this.state.statistics ?? STATISTICS_DEFAULT; }
  get errorsOn() { return this.state.errors ?? ERRORS_DEFAULT; }
  get installId() { return this.community.settings.installId; }
  identity() {
    let facts = {};
    try { facts = this.getFacts() || {}; } catch { facts = {}; }
    return { installId: this.installId, appVersion: this.appVersion, addonVersion: coreVersion(facts.addonVersion), build: facts.build, os: this.sys.os, osMajor: this.sys.osMajor, lang: this.state.lang, facts };
  }
  names() { try { return this.getNames() || []; } catch { return []; } }
  changed() { try { this.onChange(this.unread()); } catch {} }
  unread() { return this.state.tickets.reduce((n, t) => n + (t.unread > 0 ? t.unread : 0), 0); }
  /** What the screens may know about a ticket. The key never leaves this file. */
  publicTicket(t) {
    const cmp = t.fixedIn ? compareVersions(this.appVersion, t.fixedIn) : null;
    return { ticket: t.ticket, summary: t.summary, status: t.status, fixedIn: t.fixedIn, fixedHere: t.status === "fixed" && cmp !== null && cmp >= 0, kind: t.kind, area: t.area, unread: t.unread, createdAt: t.createdAt, updatedAt: t.updatedAt };
  }
  tickets() {
    return {
      tickets: [...this.state.tickets].reverse().map((t) => this.publicTicket(t)),
      waiting: this.state.outbox.map((o) => (o.type === "ticket" ? { id: o.id, type: "ticket", summary: String(o.body.summary || "").slice(0, 200) } : { id: o.id, type: "reply", ticket: o.ticket })),
      unread: this.unread(),
    };
  }

  // -------- network plumbing
  async call(method, route, opts) {
    if (this.state.blocked) throw new DeskError("blocked");
    let res;
    try { res = await this.community.request(method, route, opts); } catch { throw new DeskError("offline"); }
    if (res.status === 403 && res.json?.error === "blocked") { this.state.blocked = true; this.save(); throw new DeskError("blocked"); }
    if (res.status === 429) {
      const after = Number.parseInt(res.headers?.get?.("retry-after") || "", 10);
      this.backoff(Number.isFinite(after) && after > 0 ? after : 600);
      throw new DeskError("rate");
    }
    if (res.status >= 500 && !(res.status === 503 && res.json?.error === "report_inbox_full")) throw new DeskError("offline");
    return res;
  }
  backoff(retryAfterSec = null) {
    const s = this.state;
    if (retryAfterSec !== null) s.backoffUntil = this.now() + Math.max(BACKOFF_MIN, Math.min(BACKOFF_MAX, retryAfterSec * 1000));
    else { s.failures = Math.min(s.failures + 1, 20); s.backoffUntil = this.now() + Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** (s.failures - 1)); }
    this.save();
  }
  recovered() { if (this.state.failures || this.state.backoffUntil) { this.state.failures = 0; this.state.backoffUntil = null; } }
  waiting() { return Boolean(this.state.backoffUntil && this.now() < this.state.backoffUntil); }

  // -------- D1 heartbeat
  /** Navigation feeds this: the screen's area is remembered for today, in memory only. */
  visit({ route, lang } = {}) {
    const day = utcDay(this.now());
    if (day !== this.areasDay) { this.areas = new Set(); this.areasDay = day; }
    if (typeof route === "string" && SCREEN_RE.test(route)) {
      if (SCREENS.includes(route) && !["report", "reports", "guide", "commands", "coverage"].includes(route)) this.lastScreen = route; // the page before Help and the report form
      const area = Object.hasOwn(ROUTE_AREA, route) ? ROUTE_AREA[route] : null;
      if (area) this.areas.add(area);
    }
    if (LANGS.includes(lang) && lang !== this.state.lang) { this.state.lang = lang; this.save(); }
  }
  /** The exact body of the next heartbeat. Settings shows it; heartbeat() sends it. */
  nextHeartbeat() {
    const id = this.identity(), day = utcDay(this.now());
    if (!this.state.firstSeenWeek) { this.state.firstSeenWeek = isoWeek(this.now()); this.save(); }
    return heartbeatBody({
      ...id, channel: this.channel, firstSeenWeek: this.state.firstSeenWeek,
      flags: { gameConnected: id.facts.gameConnected, addonInstalled: id.facts.addonInstalled, liveLink: id.facts.liveLink, sharing: this.community.settings.share === true },
      areas: day === this.areasDay ? this.areas : new Set(),
    });
  }
  /** At most one per UTC day, only while the statistics switch is on. Never throws. */
  async heartbeat() {
    const day = utcDay(this.now());
    if (!this.statisticsOn || !this.automatic) return { status: "off" };
    if (this.state.blocked) return { status: "blocked" };
    if (this.state.lastHeartbeatDay === day) return { status: "sent-today" };
    if (this.waiting() || this.busy.has("heartbeat")) return { status: "waiting" };
    this.busy.add("heartbeat");
    try {
      const body = this.nextHeartbeat();
      const res = await this.call("POST", "/v1/heartbeat", { body });
      if (!this.statisticsOn || body.installId !== this.installId) return { status: "off" }; // switched off or forgotten meanwhile
      if (res.status === 200 || res.status === 400) { this.state.lastHeartbeatDay = day; this.recovered(); this.save(); return { status: res.status === 200 ? "sent" : "rejected" }; }
      this.backoff(); return { status: "offline" };
    } catch (e) { if (e.code === "offline") this.backoff(); return { status: e.code || "offline" }; }
    finally { this.busy.delete("heartbeat"); }
  }

  // -------- D2 to D6 tickets
  diagnostics() {
    const id = this.identity();
    return { screen: this.lastScreen, lastError: this.lastError, gameConnected: id.facts.gameConnected === true, addonInstalled: id.facts.addonInstalled === true };
  }
  /** One normalised form input → the exact body, and how much the scrubber took out of the player's words. */
  compose(input) {
    const id = this.identity(), names = this.names();
    let removed = 0;
    const words = (v) => { if (input.scrub === false) return String(v ?? ""); const r = scrub(String(v ?? ""), { names }); removed += r.removed; return r.text; };
    const body = ticketBody({
      ...id, kind: input.kind, area: input.area, frequency: input.frequency ?? null,
      summary: words(input.summary), details: words(input.details), expected: words(input.expected),
      diagnostics: input.diagnostics === false ? null : this.diagnostics(),
    });
    return { body, removed };
  }
  /** "What will be sent": the same body send() would post now. Invalid text still previews (with what is wrong). */
  reportPreview(input) {
    let problem = null, composed;
    try { composed = this.compose(input); }
    catch (e) {
      if (!(e instanceof DeskError)) throw e;
      problem = e.message;
      // Show what the text would look like even while it is too short or too long.
      const id = this.identity(), names = this.names();
      let removed = 0;
      const words = (v) => { if (input.scrub === false) return cleanText(v); const r = scrub(cleanText(v), { names }); removed += r.removed; return r.text; };
      const s = system(id);
      composed = { removed, body: { ...base(id), addonVersion: version(id.addonVersion), os: s.os, osMajor: s.osMajor, lang: s.lang, build: build(id.build),
        kind: oneOf(KINDS, input.kind, null), area: oneOf(AREAS, input.area, null), frequency: FREQUENCIES.includes(input.frequency) ? input.frequency : null,
        summary: words(input.summary), details: words(input.details), expected: words(input.expected),
        diagnostics: input.diagnostics === false ? null : ticketBody({ ...id, kind: "bug", area: "other", summary: "xxxxx", details: "xxxxxxxxxx", expected: "", diagnostics: this.diagnostics() }).diagnostics } };
    }
    this.preview = problem ? null : { key: JSON.stringify(input), body: composed.body };
    return { body: composed.body, removed: composed.removed, problem };
  }
  remember(body, res) {
    const t = { ticket: res.ticket, key: res.key, summary: body.summary, status: oneOf(STATUSES, res.status, "new"), fixedIn: null, kind: body.kind, area: body.area, lastId: 0, unread: 0,
      createdAt: typeof res.createdAt === "string" ? res.createdAt.slice(0, 40) : new Date(this.now()).toISOString(), updatedAt: null };
    this.state.tickets = [...this.state.tickets.filter((x) => x.ticket !== t.ticket), t].slice(-MAX_TICKETS);
    this.nextSyncAt = Math.min(this.nextSyncAt || Infinity, this.now() + SYNC_EVERY);
    return t;
  }
  async postTicket(body) {
    const res = await this.call("POST", "/v1/tickets", { body });
    if ((res.status === 201 || res.status === 200) && res.json?.ok === true && TICKET_RE.test(res.json.ticket) && KEY_RE.test(res.json.key)) return this.remember(body, res.json);
    if (res.status === 503) throw new DeskError("inbox");
    if (res.status === 400 || res.status === 413 || res.status === 404) throw new DeskError("invalid");
    throw new DeskError("offline");
  }
  queue(entry) {
    if (this.state.outbox.length >= MAX_OUTBOX) throw new DeskError("offline", "Too many reports are already waiting to be sent. Try again when you are online.");
    const item = { id: crypto.randomBytes(8).toString("hex"), queuedAt: this.now(), ...entry };
    this.state.outbox.push(item); this.save(); this.changed();
    return item;
  }
  /** Send a report. With no connection it waits in the outbox and goes out later. */
  async sendReport(input) {
    const key = JSON.stringify(input);
    const body = this.preview && this.preview.key === key && this.preview.body.installId === this.installId ? this.preview.body : this.compose(input).body;
    this.preview = null;
    try {
      const t = await this.postTicket(body);
      this.recovered(); this.save(); this.changed();
      return { sent: true, ticket: t.ticket };
    } catch (e) {
      if (e.code !== "offline") throw e;
      const { installId, ...rest } = body; // the id is added again when it is sent, so "Forget me" in between holds
      this.queue({ type: "ticket", body: rest });
      return { sent: false, queued: true };
    }
  }
  find(ticket) {
    const t = typeof ticket === "string" && TICKET_RE.test(ticket) ? this.state.tickets.find((x) => x.ticket === ticket) : null;
    if (!t) throw new DeskError("gone");
    return t;
  }
  drop(ticket) { this.state.tickets = this.state.tickets.filter((x) => x.ticket !== ticket); this.state.outbox = this.state.outbox.filter((o) => !(o.type === "reply" && o.ticket === ticket)); }
  /** The whole conversation of one ticket. Opening it marks its replies as read. */
  async conversation(ticket) {
    const t = this.find(ticket);
    const res = await this.call("GET", `/v1/tickets/${t.ticket}`, { headers: { "X-BF-Ticket-Key": t.key } });
    if (res.status === 404) { this.drop(t.ticket); this.save(); this.changed(); throw new DeskError("gone"); }
    if (res.status !== 200 || res.json?.ok !== true || !Array.isArray(res.json.messages)) throw new DeskError("offline");
    const j = res.json;
    const messages = j.messages.filter((m) => m && Number.isSafeInteger(m.id) && typeof m.text === "string").slice(-500)
      .map((m) => ({ id: m.id, from: m.from === "team" ? "team" : "player", text: cleanText(m.text, 4000), at: typeof m.at === "string" ? m.at.slice(0, 40) : null }));
    t.status = oneOf(STATUSES, j.status, t.status); t.fixedIn = version(j.fixedIn);
    t.updatedAt = typeof j.updatedAt === "string" ? j.updatedAt.slice(0, 40) : t.updatedAt;
    t.lastId = messages.reduce((n, m) => Math.max(n, m.id), t.lastId); t.unread = 0;
    this.save(); this.changed();
    return { ...this.publicTicket(t), messages, waiting: this.state.outbox.filter((o) => o.type === "reply" && o.ticket === t.ticket).map((o) => ({ id: o.id, text: o.text })) };
  }
  async postReply(t, text) {
    const res = await this.call("POST", `/v1/tickets/${t.ticket}/messages`, { body: { schema: 1, text }, headers: { "X-BF-Ticket-Key": t.key } });
    if (res.status === 404) { this.drop(t.ticket); throw new DeskError("gone"); }
    if (res.status === 400 || res.status === 413) throw new DeskError("invalid");
    if (res.status !== 201 && res.status !== 200) throw new DeskError("offline");
    t.status = oneOf(STATUSES, res.json?.status, "looking");
    if (Number.isSafeInteger(res.json?.id) && res.json.id > t.lastId && t.unread === 0) t.lastId = res.json.id;
    this.nextSyncAt = Math.min(this.nextSyncAt || Infinity, this.now() + SYNC_EVERY);
  }
  async reply({ ticket, text, scrub: wantScrub = true } = {}) {
    const t = this.find(ticket);
    let clean = cleanText(text);
    if (wantScrub !== false) clean = scrub(clean, { names: this.names() }).text;
    if (length(clean) < LIMITS.reply[0]) throw new DeskError("invalid", "Write your reply first.");
    if (length(clean) > LIMITS.reply[1]) throw new DeskError("invalid", "The reply is too long. Keep it under 4,000 characters.");
    try {
      await this.postReply(t, clean);
      this.recovered(); this.save(); this.changed();
      return { sent: true, status: t.status };
    } catch (e) {
      if (e.code === "gone") { this.save(); this.changed(); }
      if (e.code !== "offline") throw e;
      this.queue({ type: "reply", ticket: t.ticket, text: clean });
      return { sent: false, queued: true };
    }
  }
  /** Delete one report on the service and here. It stays here when the service could not be reached. */
  async remove(ticket) {
    const t = this.find(ticket);
    const res = await this.call("DELETE", `/v1/tickets/${t.ticket}`, { headers: { "X-BF-Ticket-Key": t.key } });
    if (res.status !== 200 && res.status !== 404) throw new DeskError("offline");
    this.drop(t.ticket); this.save(); this.changed();
    return { removed: true };
  }
  /** Drop a report or reply that is still waiting to be sent. */
  cancelWaiting(id) {
    const before = this.state.outbox.length;
    this.state.outbox = this.state.outbox.filter((o) => o.id !== id);
    if (this.state.outbox.length !== before) { this.save(); this.changed(); }
    return { removed: this.state.outbox.length !== before };
  }
  /** Retry what waits in the outbox, oldest first. Stops at the first failure. Never throws. */
  async flushOutbox({ force = false } = {}) {
    if (!this.state.outbox.length || this.state.blocked || this.busy.has("outbox") || (!force && !this.automatic)) return { sent: 0 };
    if (!force && this.waiting()) return { sent: 0, waiting: true };
    this.busy.add("outbox");
    let sent = 0;
    try {
      for (const item of [...this.state.outbox]) {
        try {
          if (item.type === "ticket") await this.postTicket({ ...item.body, installId: this.installId });
          else { const t = this.state.tickets.find((x) => x.ticket === item.ticket); if (t) await this.postReply(t, item.text); }
          sent++;
        } catch (e) {
          if (e.code === "offline") { this.backoff(); break; }
          if (e.code === "rate" || e.code === "inbox" || e.code === "blocked") break;
          // invalid or gone: it can never be sent, so it leaves the outbox
        }
        this.state.outbox = this.state.outbox.filter((o) => o.id !== item.id);
      }
      if (sent) this.recovered();
    } finally { this.busy.delete("outbox"); this.save(); if (sent) this.changed(); }
    return { sent };
  }
  openTickets() { return this.state.tickets.filter((t) => t.status !== "closed"); }
  /** D5. One pass over the tickets that are not closed. No tickets, no request. Never throws. */
  async sync({ force = false } = {}) {
    const open = this.openTickets();
    if (!open.length) return { status: "none" };
    if (this.state.blocked) return { status: "blocked" };
    if (this.busy.has("sync")) return { status: "busy" };
    if (!force && (!this.automatic || this.waiting() || this.now() < this.nextSyncAt)) return { status: "waiting" };
    this.busy.add("sync");
    let fresh = 0;
    try {
      for (let i = 0; i < open.length; i += SYNC_BATCH) {
        const batch = open.slice(i, i + SYNC_BATCH);
        const res = await this.call("POST", "/v1/tickets/sync", { body: { schema: 1, tickets: batch.map((t) => ({ ticket: t.ticket, key: t.key, since: t.lastId })) } });
        if (res.status !== 200 || res.json?.ok !== true || !Array.isArray(res.json.tickets)) { if (res.status === 400) break; throw new DeskError("offline"); }
        for (const row of res.json.tickets) {
          const t = row && batch.find((x) => x.ticket === row.ticket);
          if (!t) continue; // only tickets we asked about
          t.status = oneOf(STATUSES, row.status, t.status); t.fixedIn = version(row.fixedIn);
          if (typeof row.updatedAt === "string") t.updatedAt = row.updatedAt.slice(0, 40);
          const unread = Number.isSafeInteger(row.unread) && row.unread >= 0 ? Math.min(row.unread, 999) : t.unread;
          if (unread > t.unread) fresh += unread - t.unread;
          t.unread = unread;
        }
        for (const gone of Array.isArray(res.json.gone) ? res.json.gone : []) if (batch.some((x) => x.ticket === gone)) this.drop(gone);
      }
      this.recovered(); this.nextSyncAt = this.now() + SYNC_EVERY;
      this.save(); this.changed();
      if (fresh > 0 && this.state.notify && typeof this.notify === "function") { try { this.notify(fresh); } catch {} }
      return { status: "synced", fresh };
    } catch (e) {
      if (e.code === "offline") this.backoff();
      return { status: e.code || "offline" };
    } finally { this.busy.delete("sync"); }
  }

  // -------- Backstage Live (contract L1/L2): a team reply seconds after it was written
  /** The open tickets a live stream may listen for: ticket and key, exactly as the session body wants them. */
  liveSubs() { return this.automatic && !this.state.blocked ? this.openTickets().map((t) => ({ ticket: t.ticket, key: t.key })) : []; }
  /**
   * A "ticket" event from the live stream: { ticket, status, fixedIn, unread, lastId }, the same row a sync
   * returns. Only tickets this app holds are touched. The three-hour poll stays as the fallback.
   */
  liveTicket(row) {
    const t = row && typeof row.ticket === "string" ? this.state.tickets.find((x) => x.ticket === row.ticket) : null;
    if (!t) return { status: "unknown" };
    t.status = oneOf(STATUSES, row.status, t.status); t.fixedIn = version(row.fixedIn);
    t.updatedAt = new Date(this.now()).toISOString();
    const unread = Number.isSafeInteger(row.unread) && row.unread >= 0 ? Math.min(row.unread, 999) : t.unread;
    const fresh = Math.max(0, unread - t.unread);
    t.unread = unread;
    this.save(); this.changed();
    if (fresh > 0 && this.state.notify && typeof this.notify === "function") { try { this.notify(fresh); } catch {} }
    return { status: "updated", fresh };
  }

  // -------- D7 automatic error reports
  /** Every unexpected error is remembered (scrubbed) for the report form; it is sent only when the switch is on. */
  captureError(where, error) {
    let body;
    try {
      body = errorBody({ ...this.identity(), where, name: error?.name, message: error?.message, stack: error?.stack }, { names: this.names() });
    } catch { return { status: "error" }; }
    this.lastError = `${body.name}: ${body.message}`.slice(0, LIMITS.lastError);
    if (!this.errorsOn || !this.automatic) return { status: "off" };
    if (this.state.blocked) return { status: "blocked" };
    const signature = errorSignature(body);
    if (this.sentSignatures.has(signature)) return { status: "duplicate" };
    const day = utcDay(this.now());
    if (this.state.errorDay !== day) { this.state.errorDay = day; this.state.errorCount = 0; }
    if (this.state.errorCount >= ERRORS_PER_DAY || (this.lastErrorSentAt && this.now() - this.lastErrorSentAt < ERROR_GAP)) return { status: "limited" };
    this.sentSignatures.add(signature); this.state.errorCount++; this.lastErrorSentAt = this.now(); this.save();
    const done = this.call("POST", "/v1/errors", { body }).then(() => "sent", () => "failed");
    return { status: "sending", done };
  }
  /** A plain message the player saw (a toast), kept only for the diagnostics block. Never sent on its own. */
  noteError(message) { this.lastError = cleanText(scrub(cleanText(message, 2000).replace(/\n+/g, " "), { names: this.names() }).text, LIMITS.lastError) || null; }

  // -------- D8 announcements
  /** Hourly at most, with ETag; rides on the "Use community data" switch (an anonymous read). Never throws. */
  async refreshAnnouncements({ force = false } = {}) {
    const s = this.state;
    if (this.community.settings.download === false || !this.automatic) return { status: "off" };
    if (this.busy.has("announce")) return { status: "busy" };
    if (!force && s.announceCheckedAt && this.now() - s.announceCheckedAt < ANNOUNCE_EVERY) return { status: "fresh" };
    this.busy.add("announce");
    s.announceCheckedAt = this.now();
    try {
      const q = new URLSearchParams({ appVersion: this.appVersion, os: this.sys.os, lang: s.lang });
      const res = await this.community.request("GET", `/v1/announcements?${q}`, { headers: s.announceEtag ? { "If-None-Match": s.announceEtag } : {} });
      if (res.status === 304) return { status: "unchanged" };
      if (res.status !== 200 || res.json?.ok !== true || !Array.isArray(res.json.announcements)) return { status: "offline" };
      s.announcements = res.json.announcements.slice(0, 20).map(validAnnouncement).filter(Boolean);
      const etag = res.headers?.get?.("etag");
      s.announceEtag = typeof etag === "string" && etag.length <= 200 ? etag : null;
      return { status: "updated" };
    } catch { return { status: "offline" }; }
    finally { this.busy.delete("announce"); this.save(); }
  }
  /** Messages the player has not seen yet and that are current. */
  announcements() {
    const now = this.now();
    return this.state.announcements.filter((a) => !this.state.seen.includes(a.id) && (a.from === null || a.from <= now) && (a.until === null || a.until > now))
      .map(({ id, title, text, level, link }) => ({ id, title, text, level, link }));
  }
  announcementSeen(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw Error("Invalid announcement.");
    if (!this.state.seen.includes(id)) { this.state.seen = [...this.state.seen, id].slice(-MAX_SEEN); this.save(); }
    return true;
  }
  /** The link of a current announcement, checked again right before it is opened. */
  announcementLink(id) {
    const a = this.state.announcements.find((x) => x.id === id);
    return a && linkAllowed(a.link) ? a.link : null;
  }

  // -------- settings
  status() {
    return {
      statistics: this.statisticsOn, errors: this.errorsOn, notify: this.state.notify, share: this.community.settings.share === true,
      blocked: this.state.blocked || this.community.settings.blocked === true,
      installId: String(this.installId).slice(0, 8), host: new URL(this.community.baseUrl).host,
      heartbeat: this.nextHeartbeat(), lastHeartbeatDay: this.state.lastHeartbeatDay,
      unread: this.unread(), tickets: this.state.tickets.length, waiting: this.state.outbox.length,
    };
  }
  setSettings(input) {
    const keys = ["statistics", "errors", "notify"];
    if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some((k) => !keys.includes(k)) || Object.values(input).some((v) => typeof v !== "boolean")) throw Error("Invalid privacy settings.");
    Object.assign(this.state, input);
    this.save();
    return this.status();
  }
  /** After "Forget me": the service already deleted this install's tickets and statistics; drop the local side too. */
  wipe() {
    Object.assign(this.state, { tickets: [], outbox: [], lastHeartbeatDay: null, firstSeenWeek: null, errorDay: null, errorCount: 0, failures: 0, backoffUntil: null, blocked: false });
    this.areas = new Set(); this.lastError = null; this.preview = null; this.sentSignatures = new Set(); this.nextSyncAt = 0;
    this.save(); this.changed();
  }
  /** Delete all local data. */
  reset() {
    try { if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true }); } catch {}
    this.state = this.read();
    this.areas = new Set(); this.lastError = null; this.preview = null; this.sentSignatures = new Set(); this.nextSyncAt = 0;
    this.changed();
  }

  // -------- schedule
  /** One pass: outbox, replies, the daily heartbeat, messages from the team. Each part checks its own switch. */
  async tick() {
    await this.flushOutbox().catch(() => {});
    await this.sync().catch(() => {});
    if (this.now() - this.startedAt >= HEARTBEAT_AFTER) await this.heartbeat().catch(() => {});
    await this.refreshAnnouncements().catch(() => {});
  }
  start() {
    if (this.handles.length) return;
    const t = this.timers, run = () => { void this.tick().catch(() => {}); };
    this.handles.push(["t", t.setTimeout(run, START_DELAY)]);
    // Give short sessions their own check-in without waiting for ticket sync.
    this.handles.push(["t", t.setTimeout(() => { void this.heartbeat().catch(() => {}); }, HEARTBEAT_AFTER)]);
    this.handles.push(["i", t.setInterval(run, TICK_EVERY)]);
    for (const [, h] of this.handles) h?.unref?.();
  }
  stop() {
    for (const [k, h] of this.handles) (k === "t" ? this.timers.clearTimeout : this.timers.clearInterval)(h);
    this.handles = [];
  }
}

module.exports = {
  DeskService, DeskError, STATISTICS_DEFAULT, ERRORS_DEFAULT, KINDS, AREAS, FREQUENCIES, STATUSES, HEARTBEAT_AREAS, LANGS, LIMITS, ROUTE_AREA, ROUTE_REPORT_AREA,
  heartbeatBody, ticketBody, errorBody, errorSignature, validAnnouncement, linkAllowed, compareVersions, systemInfo, isoWeek, utcDay, cleanText,
  SYNC_EVERY, ANNOUNCE_EVERY, HEARTBEAT_AFTER, TICK_EVERY, ERRORS_PER_DAY,
};

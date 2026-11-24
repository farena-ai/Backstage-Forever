"use strict";
// Backstage Live: one long-lived Server-Sent Events stream from the Backstage service (contract
// sections L1 and L2). It carries team replies to your reports, your guild's events and sign-ups,
// and the realm party board, seconds after they change.
//
// Rules this file keeps:
//  - No connection at all unless something asked for one (setSubs with at least one subscription).
//  - A session is opened with POST /v1/live/session, then the stream is read with Node's own
//    http/https (no dependency). The stream token and member tokens are never logged or emitted.
//  - When the stream ends for any reason the client opens a new session after a wait that grows
//    from 2 seconds to 5 minutes, and tells its listeners to fetch everything again ("refetch"):
//    the service does not replay what was missed.
//  - Subscriptions can change while it runs; the stream is then reopened with the new list.
//  - stop() closes everything at once and nothing is emitted afterwards.
const { EventEmitter } = require("node:events");
const { StringDecoder } = require("node:string_decoder");

const BACKOFF_MIN = 2000, BACKOFF_MAX = 5 * 60 * 1000;
const SILENCE_LIMIT = 50 * 1000;      // the service pings every 20 s; two missed pings mean the line is dead
const SESSION_TIMEOUT = 20 * 1000, MAX_SESSION_BODY = 4096, MAX_SESSION_REPLY = 16 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;   // one event larger than this is dropped, not kept in memory
const RESUB_DELAY = 300, OFFLINE_AFTER = 3;
const EVENTS = Object.freeze(["hello", "ticket", "guild.event", "guild.event.gone", "guild.signup", "guild.member", "guild.discord", "lfg"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

// ---------------------------------------------------------------- SSE parser (pure)
/**
 * A Server-Sent Events parser fed with chunks of any size. onEvent({ event, data, id }) is called
 * once per dispatched event; data lines are joined with "\n". Lines may end in LF, CRLF or CR, a
 * chunk may end anywhere (even inside a multi-byte character or between CR and LF), lines starting
 * with ":" are comments (onComment), and a leading byte-order mark is ignored.
 */
function createSseParser(onEvent, { onComment = null, maxBytes = MAX_EVENT_BYTES } = {}) {
  const decoder = new StringDecoder("utf8");
  let line = "", data = [], size = 0, name = "", id = "", lastId = "", started = false, skipLf = false, dropped = false;
  function dispatch() {
    if (data.length && !dropped) onEvent({ event: name || "message", data: data.join("\n"), id: lastId });
    data = []; size = 0; name = ""; dropped = false;
  }
  function take(text) {
    if (!text.length) { dispatch(); return; }
    if (text[0] === ":") { if (onComment) onComment(text.slice(text[1] === " " ? 2 : 1)); return; }
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value[0] === " ") value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") { size += value.length + 1; if (size > maxBytes) { dropped = true; data = []; } else if (!dropped) data.push(value); }
    else if (field === "id") { if (!value.includes("\0")) { id = value; lastId = id; } }
    // "retry" and unknown fields are ignored: the client keeps its own waits.
  }
  function push(chunk) {
    let text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (!started && text.length) { started = true; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (skipLf) { skipLf = false; if (c === "\n") continue; }
      if (c === "\r") { take(line); line = ""; skipLf = true; }
      else if (c === "\n") { take(line); line = ""; }
      else if (line.length < maxBytes) line += c;
      else dropped = true; // a line this long is not kept; its event is skipped
    }
  }
  /** The stream ended: an event without its closing blank line is discarded, as the standard says. */
  function end() { line = ""; data = []; size = 0; name = ""; dropped = false; }
  return { push, end };
}
/** All events of one complete text. For tests and small inputs. */
function parseSse(text) {
  const out = [];
  const p = createSseParser((e) => out.push(e));
  p.push(text); p.end();
  return out;
}

// ---------------------------------------------------------------- subscriptions (pure)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * The exact body of POST /v1/live/session from what the app wants to hear about. Only the three
 * kinds of the contract, only their fields, and never more than 4 KB: report tickets are cut first.
 */
function sessionBody(installId, wanted) {
  const subs = [];
  const tickets = (Array.isArray(wanted?.tickets) ? wanted.tickets : []).filter((t) => t && /^BF-\d{1,9}$/.test(t.ticket) && /^[A-Za-z0-9_-]{43}$/.test(t.key)).map((t) => ({ ticket: t.ticket, key: t.key }));
  for (const g of (Array.isArray(wanted?.guild) ? wanted.guild : []).slice(0, 4)) {
    if (g && typeof g.guildId === "string" && /^g_[A-Za-z0-9_-]{1,60}$/.test(g.guildId) && typeof g.member === "string" && TOKEN_RE.test(g.member)) subs.push({ t: "guild", guildId: g.guildId, member: g.member });
  }
  for (const l of (Array.isArray(wanted?.lfg) ? wanted.lfg : []).slice(0, 2)) {
    if (l && typeof l.realm === "string" && l.realm.length >= 1 && l.realm.length <= 40 && ["horde", "alliance"].includes(l.faction)) subs.push({ t: "lfg", realm: l.realm, faction: l.faction });
  }
  const build = (list) => ({ schema: 1, installId, subs: [...(list.length ? [{ t: "tickets", tickets: list }] : []), ...subs] });
  let list = tickets.slice(-30);
  while (list.length && Buffer.byteLength(JSON.stringify(build(list))) > MAX_SESSION_BODY) list = list.slice(1);
  return build(list);
}
/** 2 s doubling to 5 min; `spread` (0..1) moves it up to 20% either way so many apps do not return together. */
function backoffDelay(failures, spread = 0.5) {
  const base = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** Math.max(0, Math.min(failures, 12) - 1));
  return Math.round(Math.min(BACKOFF_MAX, Math.max(BACKOFF_MIN, base * (0.8 + 0.4 * Math.min(1, Math.max(0, spread))))));
}

// ---------------------------------------------------------------- client
class LiveClient extends EventEmitter {
  /**
   * baseUrl: the service (https, or http on this machine for tests). getInstallId(): the install id.
   * enabled: false keeps the client silent for good (a development run that was not pointed at a test service).
   */
  constructor({ baseUrl, getInstallId, enabled = true, now = Date.now, random = Math.random,
    timers = { setTimeout, clearTimeout }, transports = { "http:": require("node:http"), "https:": require("node:https") } } = {}) {
    super();
    Object.assign(this, { baseUrl: String(baseUrl || ""), getInstallId, enabled: enabled !== false, now, random, timers, transports });
    this.wanted = { tickets: [], guild: [], lfg: [] };
    this.state = "idle"; this.since = this.now(); this.retryAt = null; this.failures = 0; this.everLive = false;
    this.req = null; this.res = null; this.timer = null; this.silence = null; this.resub = null; this.generation = 0;
    this.stopped = false; this.blocked = false; this.connectedBody = null;
  }
  /** What the screens may show. Never a token. */
  status() {
    return { state: this.state, since: this.since, retryAt: this.retryAt, needed: this.needed(), blocked: this.blocked,
      subs: { tickets: this.wanted.tickets.length, guild: this.wanted.guild.length, lfg: this.wanted.lfg.length } };
  }
  needed() { return this.enabled && !this.stopped && !this.blocked && (this.wanted.tickets.length + this.wanted.guild.length + this.wanted.lfg.length) > 0; }
  setState(state) {
    if (state === this.state) return;
    this.state = state; this.since = this.now();
    if (state === "live" || state === "idle") this.retryAt = null;
    if (!this.stopped || state === "idle") this.emit("status", this.status());
  }
  /**
   * Replace one kind of subscription: "tickets" [{ticket,key}], "guild" [{guildId,member}], "lfg" [{realm,faction}].
   * An empty list removes it. The connection opens, changes or closes by itself a moment later.
   */
  setSubs(kind, list) {
    if (!Object.hasOwn(this.wanted, kind)) throw Error("Unknown live subscription.");
    const next = Array.isArray(list) ? list.filter(Boolean) : [];
    if (sameJson(next, this.wanted[kind])) return false;
    this.wanted[kind] = next;
    if (this.stopped) return true;
    this.timers.clearTimeout(this.resub);
    this.resub = this.timers.setTimeout(() => this.reconcile(), RESUB_DELAY);
    this.resub?.unref?.();
    return true;
  }
  /** Bring the connection in line with what is wanted now. */
  reconcile() {
    if (this.stopped) return;
    if (!this.needed()) { this.close(); this.failures = 0; this.setState("idle"); return; }
    let body;
    try { body = this.body(); } catch { body = null; }
    if (!body) { this.close(); this.setState("idle"); return; }
    if ((this.res || this.req) && sameJson(body, this.connectedBody)) return; // already on the right stream (or opening it)
    if (this.timer && sameJson(body, this.connectedBody)) return;               // waiting to retry the same thing
    this.close();
    this.failures = 0;
    this.open();
  }
  body() {
    const id = this.getInstallId?.();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const body = sessionBody(id, this.wanted);
    return body.subs.length ? body : null;
  }
  /** Ask for a new stream right now (for example after the computer woke up). */
  retryNow() { if (!this.stopped && this.needed() && !this.res) { this.close(); this.open(); } }
  close() {
    this.generation++;
    this.timers.clearTimeout(this.timer); this.timer = null;
    this.timers.clearTimeout(this.silence); this.silence = null;
    try { this.req?.destroy(); } catch {}
    try { this.res?.destroy(); } catch {}
    this.req = null; this.res = null;
  }
  failed(retryAfterMs = null) {
    if (this.stopped) return;
    this.close();
    if (!this.needed()) { this.setState("idle"); return; }
    this.failures++;
    const wait = retryAfterMs !== null ? Math.min(BACKOFF_MAX, Math.max(BACKOFF_MIN, retryAfterMs)) : backoffDelay(this.failures, this.random());
    this.retryAt = this.now() + wait;
    this.setState(this.failures >= OFFLINE_AFTER ? "offline" : this.everLive ? "reconnecting" : "connecting");
    this.emit("status", this.status());
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.open(); }, wait);
    this.timer?.unref?.();
  }
  target(route) {
    const u = new URL(this.baseUrl.replace(/\/+$/, "") + route);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) throw Error("Live: the service address must be https.");
    return u;
  }
  open() {
    if (this.stopped || !this.needed()) return;
    let body, url;
    try { body = this.body(); url = this.target("/v1/live/session"); } catch { body = null; }
    if (!body) { this.setState("idle"); return; }
    const gen = ++this.generation;
    this.connectedBody = body;
    if (this.state === "idle") this.setState("connecting");
    const text = JSON.stringify(body);
    let done = false;
    const fail = (ms = null) => { if (done || gen !== this.generation) return; done = true; this.failed(ms); };
    let req;
    try {
      req = this.transports[url.protocol].request(url, { method: "POST", timeout: SESSION_TIMEOUT,
        headers: { Accept: "application/json", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, (res) => {
        const chunks = []; let size = 0;
        res.on("data", (c) => { size += c.length; if (size <= MAX_SESSION_REPLY) chunks.push(c); });
        res.on("error", () => fail());
        res.on("end", () => {
          if (done || gen !== this.generation) return;
          let json = null;
          try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { json = null; }
          if (res.statusCode === 403 && json?.error === "blocked") { done = true; this.blocked = true; this.close(); this.setState("idle"); return; }
          if (res.statusCode === 429) { const after = Number.parseInt(res.headers["retry-after"] || "", 10); fail(Number.isFinite(after) && after > 0 ? after * 1000 : 60000); return; }
          // A session the service refuses (a member token it no longer knows, for example) is reported, so its owner can drop it.
          if (res.statusCode === 400 || res.statusCode === 404) { this.emit("rejected", { status: res.statusCode, error: typeof json?.error === "string" ? json.error.slice(0, 40) : null }); fail(BACKOFF_MAX); return; }
          if (res.statusCode !== 200 || json?.ok !== true || typeof json.stream !== "string" || !TOKEN_RE.test(json.stream)) { fail(); return; }
          done = true;
          this.stream(gen, json.stream);
        });
      });
    } catch { fail(); return; }
    this.req = req;
    req.on("timeout", () => { try { req.destroy(); } catch {} fail(); });
    req.on("error", () => fail());
    req.end(text);
  }
  stream(gen, token) {
    if (gen !== this.generation || this.stopped) return;
    let url;
    try { url = this.target(`/v1/live/stream?s=${encodeURIComponent(token)}`); } catch { this.failed(); return; }
    let over = false;
    const lost = () => { if (over || gen !== this.generation) return; over = true; this.failed(); };
    const heard = () => {
      this.timers.clearTimeout(this.silence);
      this.silence = this.timers.setTimeout(lost, SILENCE_LIMIT);
      this.silence?.unref?.();
    };
    let req;
    try {
      req = this.transports[url.protocol].request(url, { method: "GET", headers: { Accept: "text/event-stream", "Cache-Control": "no-store" } }, (res) => {
        if (gen !== this.generation) { try { res.destroy(); } catch {} return; }
        if (res.statusCode !== 200 || !/^text\/event-stream/i.test(String(res.headers["content-type"] || ""))) {
          const after = res.statusCode === 429 ? Number.parseInt(res.headers["retry-after"] || "", 10) : NaN;
          try { res.destroy(); } catch {}
          if (!over) { over = true; this.failed(Number.isFinite(after) && after > 0 ? after * 1000 : null); }
          return;
        }
        this.res = res;
        const parser = createSseParser((e) => { if (gen === this.generation && !this.stopped) this.received(e); }, { onComment: heard });
        res.on("data", (c) => { if (gen !== this.generation) return; heard(); try { parser.push(c); } catch { lost(); } });
        res.on("end", () => { parser.end(); lost(); });
        res.on("close", lost);
        res.on("error", lost);
      });
    } catch { this.failed(); return; }
    this.req = req;
    heard();
    req.on("error", lost);
    req.end();
  }
  received({ event, data }) {
    if (!EVENTS.includes(event)) return;
    let value;
    try { value = JSON.parse(data); } catch { return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (event === "hello") {
      const again = this.everLive;
      this.failures = 0; this.everLive = true;
      this.setState("live");
      // The service replays nothing: every listener reads its whole picture again.
      this.emit("refetch", { reconnect: again, serverTime: typeof value.serverTime === "string" ? value.serverTime.slice(0, 40) : null });
      return;
    }
    if (this.state !== "live") return; // nothing counts before hello
    this.emit("event", event, value);
  }
  /** Close for good (the app is quitting). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.timers.clearTimeout(this.resub); this.resub = null;
    this.close();
    this.state = "idle"; this.retryAt = null;
    this.removeAllListeners();
  }
}

module.exports = { LiveClient, createSseParser, parseSse, sessionBody, backoffDelay, EVENTS, BACKOFF_MIN, BACKOFF_MAX, SILENCE_LIMIT, OFFLINE_AFTER, RESUB_DELAY, MAX_SESSION_BODY };

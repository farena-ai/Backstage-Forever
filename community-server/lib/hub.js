"use strict";
// The realtime hub: an in-process publish/subscribe table and the long-lived
// Server-Sent Events streams that listen to it (CLIENT-CONTRACT.md L1/L2).
//
// Rules this file keeps:
//  - A stream is opened only with a one-time token that POST /v1/live/session
//    handed out after checking every subscription. A token works once, for 60 s.
//  - A stream receives only the topics it was authorised for at session time.
//  - Nothing is replayed: after a reconnect the client refetches.
//  - A slow reader is cut off instead of being buffered without limit.
//  - Nothing here is stored or logged; install hashes are held in memory only
//    while a token or a stream exists.
const crypto = require("node:crypto");

const DEFAULTS = Object.freeze({
  maxStreams: 2000, perInstall: 2, pingMs: 20_000, lifetimeMs: 55 * 60_000, tokenMs: 60_000,
  maxPendingTokens: 10_000, maxBufferBytes: 256 * 1024,
});

function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("base64url"); }
const topic = Object.freeze({
  ticket: (id) => `t:${id}`,
  guild: (guildId) => `g:${guildId}`,
  lfg: (realmKey, faction) => `l:${faction}|${realmKey}`,
});

class Hub {
  constructor({ now = () => Date.now(), options = {} } = {}) {
    this.now = now;
    this.o = { ...DEFAULTS, ...options };
    this.tokens = new Map(); // token hash -> { install, topics:Set, guilds:Map(guildId -> member key), expires }
    this.streams = new Set();
    this.topics = new Map(); // topic -> Set(stream)
    this.counters = { opened: 0, closed: 0, errors: 0, slow: 0, refused: 0, published: 0, lastErrorAt: null };
  }

  // ---------------------------------------------------------------- tokens
  // topics: array of topic strings; guilds: Map(guildId -> member key) for later removal.
  issue(install, topics, guilds = new Map()) {
    const t = this.now();
    if (this.tokens.size >= this.o.maxPendingTokens) this.sweepTokens(t);
    if (this.tokens.size >= this.o.maxPendingTokens) return null;
    const token = crypto.randomBytes(32).toString("base64url");
    this.tokens.set(tokenHash(token), { install, topics: new Set(topics), guilds: new Map(guilds), expires: t + this.o.tokenMs });
    return { token, expiresIn: Math.round(this.o.tokenMs / 1000) };
  }

  // One use only: the token is gone whether or not the stream then opens.
  redeem(token) {
    const key = tokenHash(String(token)), s = this.tokens.get(key);
    if (!s) return null;
    this.tokens.delete(key);
    return s.expires > this.now() ? s : null;
  }

  sweepTokens(t = this.now()) { for (const [k, s] of this.tokens) if (s.expires <= t) this.tokens.delete(k); }

  // --------------------------------------------------------------- streams
  full() { return this.streams.size >= this.o.maxStreams; }

  // Starts the event stream on an accepted request. `headers` are the response headers.
  open(session, req, res, headers) {
    // At most two streams per install: the oldest gives way (it is usually a dead connection the
    // server has not noticed yet).
    const mine = [...this.streams].filter(s => s.install === session.install);
    while (mine.length >= this.o.perInstall) this.close(mine.shift(), "replaced");
    const t = this.now();
    const stream = { install: session.install, topics: session.topics, guilds: session.guilds, req, res, id: 0, opened: t, lastPing: t, closed: false };
    this.streams.add(stream);
    for (const name of stream.topics) {
      let set = this.topics.get(name);
      if (!set) { set = new Set(); this.topics.set(name, set); }
      set.add(stream);
    }
    this.counters.opened += 1;
    const gone = () => this.forget(stream);
    res.on("close", gone);
    res.on("error", () => { this.counters.errors += 1; this.counters.lastErrorAt = this.now(); gone(); });
    try { if (req.socket) { req.socket.setTimeout(0); req.socket.setNoDelay(true); } } catch { /* socket already gone */ }
    res.writeHead(200, headers);
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    this.send(stream, "hello", { serverTime: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") });
    return stream;
  }

  // Removes a stream from every table. Safe to call twice.
  forget(stream) {
    if (stream.closed) return;
    stream.closed = true;
    this.streams.delete(stream);
    for (const name of stream.topics) {
      const set = this.topics.get(name);
      if (set) { set.delete(stream); if (!set.size) this.topics.delete(name); }
    }
    this.counters.closed += 1;
  }

  close(stream, why = "") {
    if (stream.closed) return;
    this.forget(stream);
    try { stream.res.end(why ? `: ${why}\n\n` : undefined); } catch { /* already gone */ }
  }

  kill(stream, slow) {
    if (stream.closed) return;
    this.counters.errors += 1;
    if (slow) this.counters.slow += 1;
    this.counters.lastErrorAt = this.now();
    this.forget(stream);
    try { stream.res.destroy(); } catch { /* already gone */ }
  }

  write(stream, chunk) {
    if (stream.closed) return false;
    const res = stream.res;
    if (res.destroyed || res.writableEnded) { this.forget(stream); return false; }
    // A reader that does not keep up is dropped; it reconnects and refetches.
    if (res.writableLength > this.o.maxBufferBytes) { this.kill(stream, true); return false; }
    try { res.write(chunk); } catch { this.kill(stream, false); return false; }
    return true;
  }

  send(stream, event, data) {
    stream.id += 1;
    return this.write(stream, `id: ${stream.id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // ------------------------------------------------------------ publishing
  publish(name, event, data) {
    const set = this.topics.get(name);
    if (!set || !set.size) return 0;
    let n = 0;
    for (const stream of [...set]) if (this.send(stream, event, data)) n += 1;
    this.counters.published += n;
    return n;
  }

  // A member left or was removed: their streams stop receiving that guild at once.
  dropMember(guildId, memberKey) {
    const name = topic.guild(guildId);
    for (const stream of [...(this.topics.get(name) || [])]) {
      if (memberKey !== null && stream.guilds.get(guildId) !== memberKey) continue;
      stream.topics.delete(name);
      stream.guilds.delete(guildId);
      const set = this.topics.get(name);
      if (set) { set.delete(stream); if (!set.size) this.topics.delete(name); }
    }
    for (const s of this.tokens.values()) {
      if (s.guilds.has(guildId) && (memberKey === null || s.guilds.get(guildId) === memberKey)) { s.guilds.delete(guildId); s.topics.delete(name); }
    }
  }
  dropGuild(guildId) { this.dropMember(guildId, null); }
  dropTopic(name) {
    for (const stream of [...(this.topics.get(name) || [])]) stream.topics.delete(name);
    this.topics.delete(name);
    for (const s of this.tokens.values()) s.topics.delete(name);
  }
  dropInstall(install) {
    for (const stream of [...this.streams]) if (stream.install === install) this.close(stream, "forgotten");
    for (const [k, s] of this.tokens) if (s.install === install) this.tokens.delete(k);
  }

  // Called about once a second by the service (and by tests with their own clock).
  tick(t = this.now()) {
    for (const stream of [...this.streams]) {
      if (t - stream.opened >= this.o.lifetimeMs) { this.close(stream, "reconnect"); continue; }
      if (t - stream.lastPing >= this.o.pingMs) { stream.lastPing = t; this.write(stream, ": ping\n\n"); }
    }
    this.sweepTokens(t);
  }

  stats() { return { streams: this.streams.size, topics: this.topics.size, pendingTokens: this.tokens.size, ...this.counters }; }

  closeAll() { for (const stream of [...this.streams]) this.close(stream, "shutdown"); this.tokens.clear(); }
}

module.exports = { Hub, topic, DEFAULTS };

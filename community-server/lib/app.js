"use strict";
// HTTP layer: routing, JSON-only bodies with size caps, security headers,
// in-memory rate limits and the pack endpoints. Responses never include stack
// traces; the log never includes IPs or install ids.
const http = require("node:http");
const crypto = require("node:crypto");
const { validateSubmit, validateReport, validateForget, validateMine, packVariant, gridToFraction, LIMITS, ValidationError } = require("./validate");
const { hashInstall } = require("./store");
const { PackCache, PACK_FORMAT, PACK_MINOR } = require("./pack");
const { RateLimiter } = require("./ratelimit");
const desk = require("./validate-desk");
const { Auth } = require("./auth");
const { Notifier } = require("./notify");
const { createAdmin } = require("./admin/web");
const { Live } = require("./live");
const { createLiveHttp } = require("./live-http");

const SERVICE_VERSION = require("../package.json").version;
const BODY_LIMITS = {
  "/v1/submit": 256 * 1024, "/v1/report": 160 * 1024, "/v1/forget": 1024, "/v1/mine": 1024,
  "/v1/heartbeat": 2 * 1024, "/v1/tickets": 24 * 1024, "/v1/tickets/:ticket/messages": 12 * 1024,
  "/v1/tickets/sync": 8 * 1024, "/v1/errors": 8 * 1024,
};
const TICKET_PATH = /^\/v1\/tickets\/([^/]{1,40})(\/messages)?$/;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000",
};
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

// discordRequest / discordSleep: only tests pass these (a stand-in for discord.com and for waiting).
function createApp({ store, config, now = () => Date.now(), log = (line) => console.log(line), notifier, auth, discordRequest, discordSleep }) {
  auth = auth || new Auth({ store, salt: config.salt, now, options: config.auth || {} });
  notifier = notifier || new Notifier({ config, log, now });
  const live = new Live({ store, config, now, log, request: discordRequest, sleep: discordSleep });
  const packs = new PackCache(store, { minInstalls: config.minInstalls, rebuildMs: config.packRebuildMs, now });
  const L = config.limits;
  const limiters = {
    ip: new RateLimiter(L.perIp),
    submitInstall: new RateLimiter(L.submitPerInstall),
    submitGlobal: new RateLimiter(L.submitGlobal),
    reportInstall: new RateLimiter(L.reportPerInstall),
    reportGlobal: new RateLimiter(L.reportGlobal),
    forgetInstall: new RateLimiter(L.forgetPerInstall),
    mineInstall: new RateLimiter(L.minePerInstall),
    heartbeatInstall: new RateLimiter(L.heartbeatPerInstall),
    ticketInstall: new RateLimiter(L.ticketPerInstall),
    ticketGlobal: new RateLimiter(L.ticketGlobal),
    ticketRead: new RateLimiter(L.ticketReadPerKey),
    ticketReply: new RateLimiter(L.ticketReplyPerTicket),
    ticketDelete: new RateLimiter(L.ticketDeletePerKey),
    errorInstall: new RateLimiter(L.errorPerInstall),
    errorGlobal: new RateLimiter(L.errorGlobal),
    loginIp: new RateLimiter(L.loginPerIp),
  };
  // Per-process key: client addresses are only ever held as keyed hashes in memory.
  const ipKey = crypto.randomBytes(32);
  const startedAt = now();

  function clientKey(req) {
    let ip = req.socket.remoteAddress || "";
    if (config.trustProxy && LOOPBACK.has(ip)) {
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string" && xff.length) ip = xff.split(",").pop().trim();
    }
    return crypto.createHmac("sha256", ipKey).update(ip).digest("base64url");
  }

  function limit(limiter, key) {
    const r = limiter.hit(key, now());
    if (!r.ok) throw new HttpError(429, "rate_limited", { retryAfterSec: r.retryAfterSec });
  }

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      ...(payload ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length } : {}),
      ...headers,
    });
    res.end(res.req.method === "HEAD" ? undefined : payload);
  }

  function readJson(req, max) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers["content-type"] || "");
      if (!/^application\/json\s*(;\s*charset=utf-8\s*)?$/i.test(type)) return reject(new HttpError(415, "json_required"));
      if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") return reject(new HttpError(415, "encoding_not_supported"));
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > max) return reject(new HttpError(413, "body_too_large"));
      const chunks = []; let size = 0, done = false;
      req.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > max) { done = true; reject(new HttpError(413, "body_too_large")); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (done) return;
        done = true;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new HttpError(400, "invalid_json")); }
      });
      req.on("error", () => { if (!done) { done = true; reject(new HttpError(400, "read_failed")); } });
    });
  }

  function installHash(installId) {
    const hash = hashInstall(config.salt, installId);
    if (store.isBlocked(hash)) throw new HttpError(403, "blocked");
    return hash;
  }

  // The ticket key is the only credential on /v1. A malformed id, a missing
  // key, a wrong key and a ticket that does not exist all give the same 404.
  function keyed(req, segment, limiter) {
    const number = desk.ticketNumber(segment), key = desk.ticketKey(req.headers["x-bf-ticket-key"]);
    if (number === null || key === null) throw new HttpError(404, "not_found");
    if (limiter) limit(limiter, crypto.createHash("sha256").update(key).digest("base64url"));
    return { number, key };
  }
  function ticketRow(number, key) {
    const row = store.desk.ticketByKey(number, key);
    if (!row) throw new HttpError(404, "not_found");
    return row;
  }
  function notify(type, row) {
    try {
      Promise.resolve(notifier.ticketEvent(type, { ticket: desk.ticketLabel(row.id), kind: row.kind, area: row.area, appVersion: row.app_version, summary: row.summary }))
        .catch(() => {});
    } catch { /* a notification can never fail a request */ }
  }

  const ticketRoutes = {
    "GET": (req, res, url, segment) => {
      const { number, key } = keyed(req, segment, limiters.ticketRead);
      const since = desk.validateSince(url.searchParams);
      send(res, 200, store.desk.publicTicket(ticketRow(number, key), since));
    },
    "DELETE": (req, res, url, segment) => {
      const { number, key } = keyed(req, segment, limiters.ticketDelete);
      const id = ticketRow(number, key).id;
      store.desk.deleteTicket(id);
      live.ticketGone(id);
      send(res, 200, { ok: true });
    },
    "POST messages": async (req, res, url, segment) => {
      const { number, key } = keyed(req, segment, null);
      const { text } = desk.validateTicketMessage(await readJson(req, BODY_LIMITS["/v1/tickets/:ticket/messages"]));
      const row = ticketRow(number, key);
      if (row.install && store.isBlocked(row.install)) throw new HttpError(403, "blocked");
      limit(limiters.ticketReply, String(row.id));
      const r = store.desk.playerReply(row, text, now());
      notify("reply", row);
      live.publishTicket(row.id);
      send(res, 201, { ok: true, id: r.id, at: r.at, status: r.status });
    },
  };

  const routes = {
    "GET /v1/health": (req, res) => {
      send(res, 200, { ok: store.ping(), service: "bf-community", version: SERVICE_VERSION, packFormat: PACK_FORMAT, packMinor: PACK_MINOR, mine: true, desk: true, live: true, discord: !!config.discord, uptimeSec: Math.floor((now() - startedAt) / 1000) });
    },
    "POST /v1/heartbeat": async (req, res) => {
      const hb = desk.validateHeartbeat(await readJson(req, BODY_LIMITS["/v1/heartbeat"]));
      const hash = installHash(hb.installId);
      // More than six a day are accepted and ignored.
      if (limiters.heartbeatInstall.hit(hash, now()).ok) store.desk.recordHeartbeat(hash, hb, now());
      send(res, 200, { ok: true });
    },
    "POST /v1/tickets": async (req, res) => {
      const t = desk.validateTicket(await readJson(req, BODY_LIMITS["/v1/tickets"]));
      const hash = installHash(t.installId);
      limit(limiters.ticketInstall, hash);
      limit(limiters.ticketGlobal, "global");
      if (store.desk.openTicketCount() >= config.maxOpenTickets) throw new HttpError(503, "report_inbox_full");
      const made = store.desk.createTicket(hash, t, now());
      notify("new", { id: made.id, kind: t.kind, area: t.area, app_version: t.appVersion, summary: t.summary });
      send(res, 201, { ok: true, ticket: made.ticket, key: made.key, status: made.status, createdAt: made.createdAt });
    },
    "POST /v1/tickets/sync": async (req, res) => {
      const { tickets } = desk.validateTicketSync(await readJson(req, BODY_LIMITS["/v1/tickets/sync"]));
      send(res, 200, { ok: true, ...store.desk.syncTickets(tickets) });
    },
    "POST /v1/errors": async (req, res) => {
      const e = desk.validateError(await readJson(req, BODY_LIMITS["/v1/errors"]));
      const hash = installHash(e.installId);
      limit(limiters.errorInstall, hash);
      limit(limiters.errorGlobal, "global");
      store.desk.recordError(e, now(), config.maxErrorGroups);
      send(res, 200, { ok: true });
    },
    "GET /v1/announcements": (req, res, url) => {
      const q = desk.validateAnnouncementQuery(url.searchParams);
      const body = Buffer.from(JSON.stringify({ ok: true, announcements: store.desk.activeAnnouncements(q, now()) }));
      const etag = `"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 20)}"`;
      const headers = { ...SECURITY_HEADERS, ETag: etag, "Cache-Control": "public, max-age=3600" };
      const inm = String(req.headers["if-none-match"] || "");
      if (inm && inm.split(",").map(s => s.trim().replace(/^W\//, "")).some(t => t === etag || t === "*")) {
        res.writeHead(304, headers); res.end(); return;
      }
      res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    },
    "GET /v1/pack/meta": (req, res, url) => {
      const variant = packVariant(url.searchParams), p = packs.get(variant);
      send(res, 200, { ok: true, format: PACK_FORMAT, ...(variant === 2 ? { minor: PACK_MINOR } : {}), version: p.version, generatedAt: p.generatedAt, minInstalls: config.minInstalls, bytes: p.body.length, gzipBytes: p.gzip.length, counts: p.counts },
        { "Cache-Control": "public, max-age=300" });
    },
    "GET /v1/pack": (req, res, url) => {
      const p = packs.get(packVariant(url.searchParams));
      const headers = {
        ...SECURITY_HEADERS,
        ETag: p.etag,
        "Last-Modified": new Date(p.generatedAt).toUTCString(),
        "Cache-Control": "public, max-age=3600",
        Vary: "Accept-Encoding",
      };
      const inm = String(req.headers["if-none-match"] || "");
      if (inm && inm.split(",").map(s => s.trim().replace(/^W\//, "")).some(t => t === p.etag || t === "*")) {
        res.writeHead(304, headers); res.end(); return;
      }
      const gzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
      const body = gzip ? p.gzip : p.body;
      res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, ...(gzip ? { "Content-Encoding": "gzip" } : {}) });
      res.end(req.method === "HEAD" ? undefined : body);
    },
    "POST /v1/submit": async (req, res) => {
      const sub = validateSubmit(await readJson(req, BODY_LIMITS["/v1/submit"]));
      const hash = installHash(sub.installId);
      limit(limiters.submitInstall, hash);
      limit(limiters.submitGlobal, "global");
      const stored = store.recordSubmission(hash, sub, now());
      send(res, 200, { ok: true, stored });
    },
    "POST /v1/report": async (req, res) => {
      const rep = validateReport(await readJson(req, BODY_LIMITS["/v1/report"]));
      const hash = installHash(rep.installId);
      limit(limiters.reportInstall, hash);
      limit(limiters.reportGlobal, "global");
      if (store.reportCount() >= config.maxReports) throw new HttpError(503, "report_inbox_full");
      const id = store.addReport(hash, rep, now());
      send(res, 201, { ok: true, id });
    },
    // What this install itself contributed, so the app can mark "from you" exactly. The install id
    // is the only credential. An id the server has never seen, a forgotten one and a blocked one all
    // get the same empty answer, so the reply never says whether an id exists.
    "POST /v1/mine": async (req, res) => {
      const { installId } = validateMine(await readJson(req, BODY_LIMITS["/v1/mine"]));
      const hash = hashInstall(config.salt, installId);
      limit(limiters.mineInstall, hash);
      const { rows, total } = store.isBlocked(hash) ? { rows: [], total: 0 } : store.mine(hash, LIMITS.mineKeys);
      const keys = { nodes: [], npcs: [], vendors: [] }, counts = {};
      const count = (mapId, kind) => { const m = counts[mapId] || (counts[mapId] = {}); m[kind] = (m[kind] || 0) + 1; };
      for (const r of rows) {
        const f = r.key.split("|");
        if (r.kind === "node") {
          const named = f[1][0] !== "o";
          keys.nodes.push([f[0], named ? null : Number(f[1].slice(1)), named ? f[1].slice(1) : null, Number(f[2]), gridToFraction(Number(f[3])), gridToFraction(Number(f[4]))]);
          count(f[2], f[0]);
        } else if (r.kind === "npc") {
          keys.npcs.push([Number(f[0]), Number(f[1]), gridToFraction(Number(f[2])), gridToFraction(Number(f[3]))]);
          count(f[1], "npc");
        } else keys.vendors.push([Number(f[0]), Number(f[1])]);
      }
      send(res, 200, { ok: true, total, truncated: total > rows.length, counts, keys: {
        nodes: { columns: ["kind", "objectId", "name", "mapId", "x", "y"], rows: keys.nodes },
        npcs: { columns: ["npcId", "mapId", "x", "y"], rows: keys.npcs },
        vendors: { columns: ["npcId", "itemId"], rows: keys.vendors },
      } });
    },
    "POST /v1/forget": async (req, res) => {
      const { installId } = validateForget(await readJson(req, BODY_LIMITS["/v1/forget"]));
      const hash = hashInstall(config.salt, installId);
      limit(limiters.forgetInstall, hash);
      const removed = store.purgeInstall(hash, { now: now() });
      live.afterForget(hash, removed);
      // Tickets, their messages, heartbeats and the first-seen day go too; the answer keeps its documented shape.
      send(res, 200, { ok: true, removed: { observations: removed.observations, reports: removed.reports } });
    },
  };
  const paths = new Set(Object.keys(routes).map(k => k.split(" ")[1]));
  const liveHttp = createLiveHttp({ live, store, config, now, http: { send, readJson, limit, installHash, HttpError, clientKey, SECURITY_HEADERS } });
  const admin = createAdmin({ store, config, auth, now, log, loginLimiter: limiters.loginIp, clientKey, live });

  async function handle(req, res) {
    const started = now();
    let pathname = "-", label = null;
    try {
      const url = new URL(req.url, "http://localhost");
      pathname = url.pathname;
      // Discord's webhook comes from a handful of Discord addresses for every guild at once: it has
      // its own limit (and its signature check) instead of the per-address one.
      if (pathname !== "/discord/interactions") limit(limiters.ip, clientKey(req));
      if (config.adminEnabled && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
        label = "/admin";
        label = await admin.handle(req, res, url);
        return;
      }
      if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
      const method = req.method === "HEAD" ? "GET" : req.method;
      const handler = routes[`${method} ${pathname}`];
      const ticket = handler ? null : TICKET_PATH.exec(pathname);
      if (ticket) {
        label = ticket[2] ? "/v1/tickets/:ticket/messages" : "/v1/tickets/:ticket";
        const th = ticketRoutes[ticket[2] ? `${method} messages` : method];
        if (!th) throw new HttpError(405, "method_not_allowed", { allow: ticket[2] ? "POST" : "GET, HEAD, DELETE" });
        await th(req, res, url, ticket[1]);
        return;
      }
      const lr = handler ? null : liveHttp.match(method, pathname);
      if (lr) {
        label = lr.label;
        if (!lr.handler) throw new HttpError(405, "method_not_allowed", { allow: lr.allow });
        await lr.handler(req, res, url);
        return;
      }
      if (!handler) {
        if (paths.has(pathname)) {
          const allow = Object.keys(routes).filter(k => k.endsWith(` ${pathname}`)).map(k => k.split(" ")[0]);
          if (allow.includes("GET")) allow.push("HEAD");
          throw new HttpError(405, "method_not_allowed", { allow: allow.join(", ") });
        }
        throw new HttpError(404, "not_found");
      }
      await handler(req, res, url);
    } catch (e) {
      if (e instanceof ValidationError) send(res, 400, { ok: false, error: "invalid", detail: e.message.slice(0, 300) });
      else if (e instanceof HttpError) {
        const headers = {};
        if (e.extra.retryAfterSec) headers["Retry-After"] = String(e.extra.retryAfterSec);
        if (e.extra.allow) headers.Allow = e.extra.allow;
        if (e.status === 413) headers.Connection = "close";
        send(res, e.status, { ok: false, error: e.code }, headers);
      } else {
        log(`${new Date().toISOString()} error ${e && e.message ? e.message : String(e)}`);
        if (!res.headersSent) send(res, 500, { ok: false, error: "internal" });
        else res.destroy();
      }
    } finally {
      if (label) pathname = label;
      else if (!paths.has(pathname)) pathname = "(other)";
      log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${now() - started}ms`);
    }
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => { handle(req, res); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return { server, packs, limiters, auth, notifier, admin, live, liveHttp };
}

module.exports = { createApp, BODY_LIMITS, SECURITY_HEADERS };

"use strict";
// HTTP layer: routing, JSON-only bodies with size caps, security headers,
// in-memory rate limits and the pack endpoints. Responses never include stack
// traces; the log never includes IPs or install ids.
const http = require("node:http");
const crypto = require("node:crypto");
const { validateSubmit, validateReport, validateForget, ValidationError } = require("./validate");
const { hashInstall } = require("./store");
const { PackCache, PACK_FORMAT } = require("./pack");
const { RateLimiter } = require("./ratelimit");

const SERVICE_VERSION = require("../package.json").version;
const BODY_LIMITS = { "/v1/submit": 256 * 1024, "/v1/report": 160 * 1024, "/v1/forget": 1024 };
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

function createApp({ store, config, now = () => Date.now(), log = (line) => console.log(line) }) {
  const packs = new PackCache(store, { minInstalls: config.minInstalls, rebuildMs: config.packRebuildMs, now });
  const L = config.limits;
  const limiters = {
    ip: new RateLimiter(L.perIp),
    submitInstall: new RateLimiter(L.submitPerInstall),
    submitGlobal: new RateLimiter(L.submitGlobal),
    reportInstall: new RateLimiter(L.reportPerInstall),
    reportGlobal: new RateLimiter(L.reportGlobal),
    forgetInstall: new RateLimiter(L.forgetPerInstall),
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

  const routes = {
    "GET /v1/health": (req, res) => {
      send(res, 200, { ok: store.ping(), service: "bf-community", version: SERVICE_VERSION, packFormat: PACK_FORMAT, uptimeSec: Math.floor((now() - startedAt) / 1000) });
    },
    "GET /v1/pack/meta": (req, res) => {
      const p = packs.get();
      send(res, 200, { ok: true, format: PACK_FORMAT, version: p.version, generatedAt: p.generatedAt, minInstalls: config.minInstalls, bytes: p.body.length, gzipBytes: p.gzip.length, counts: p.counts },
        { "Cache-Control": "public, max-age=300" });
    },
    "GET /v1/pack": (req, res) => {
      const p = packs.get();
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
    "POST /v1/forget": async (req, res) => {
      const { installId } = validateForget(await readJson(req, BODY_LIMITS["/v1/forget"]));
      const hash = hashInstall(config.salt, installId);
      limit(limiters.forgetInstall, hash);
      const removed = store.purgeInstall(hash, { now: now() });
      send(res, 200, { ok: true, removed: { observations: removed.observations, reports: removed.reports } });
    },
  };
  const paths = new Set(Object.keys(routes).map(k => k.split(" ")[1]));

  async function handle(req, res) {
    const started = now();
    let pathname = "-";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
      limit(limiters.ip, clientKey(req));
      const method = req.method === "HEAD" ? "GET" : req.method;
      const handler = routes[`${method} ${pathname}`];
      if (!handler) {
        if (paths.has(pathname)) {
          const allow = Object.keys(routes).filter(k => k.endsWith(` ${pathname}`)).map(k => k.split(" ")[0]);
          if (allow.includes("GET")) allow.push("HEAD");
          throw new HttpError(405, "method_not_allowed", { allow: allow.join(", ") });
        }
        throw new HttpError(404, "not_found");
      }
      await handler(req, res);
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
      if (!paths.has(pathname)) pathname = "(other)";
      log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${now() - started}ms`);
    }
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => { handle(req, res); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return { server, packs, limiters };
}

module.exports = { createApp, BODY_LIMITS, SECURITY_HEADERS };

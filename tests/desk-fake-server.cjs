"use strict";
// A small stand-in for the Backstage Desk service, for tests only. It implements sections D1 to D8
// of the Desk contract strictly: unknown fields are rejected, ticket keys are checked, and every
// request is logged so a test can prove what left (or that nothing did).
// Use fake.fetch as the app's fetch, or fake.listen() for a real HTTP server on 127.0.0.1 (window tests).
const crypto = require("node:crypto"), http = require("node:http");

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/, BUILD = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = ["bug", "data", "translation", "idea", "other"], FREQ = ["once", "sometimes", "always"];
const AREAS = ["now", "route", "map", "quests", "dungeons", "professions", "ledger", "talents", "gear", "journey", "companion", "travel", "settings", "addon-ingame", "install-update", "website", "other"];
const HB_AREAS = ["now", "route", "map", "dungeons", "professions", "ledger", "talents", "journey", "companion"];
const keysOf = (o, allowed) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every((k) => allowed.includes(k));
const exact = (o, wanted) => keysOf(o, wanted) && wanted.every((k) => k in o);
const str = (v, min, max) => typeof v === "string" && [...v].length >= min && [...v].length <= max && !/[\x00-\x09\x0b-\x1f\x7f]/.test(v) && v === v.normalize("NFC");
const common = (b) => UUID.test(b.installId) && VERSION.test(b.appVersion) && ["windows", "macos", "linux"].includes(b.os) && (b.osMajor === null || /^[0-9]{1,3}$/.test(b.osMajor)) && ["en", "de", "fr", "es"].includes(b.lang);
const versionOrNull = (v) => v === null || VERSION.test(v), buildOrNull = (v) => v === null || BUILD.test(v);

function fakeDesk({ now = () => Date.now() } = {}) {
  const log = [], tickets = new Map(), heartbeats = [], errors = [], forgotten = [];
  let nextTicket = 1042, announcements = [], announceVersion = 1, down = false, respond = null;
  const iso = () => new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const ok = (status, body, headers = {}) => ({ status, body, headers });
  const bad = (detail) => ok(400, { ok: false, error: "invalid", detail });
  const auth = (id, headers) => { const t = tickets.get(id); return t && headers["x-bf-ticket-key"] === t.key ? t : null; };

  function handle(method, url, headers, body) {
    const u = new URL(url, "http://desk.test"), route = u.pathname;
    if (respond) { const forced = respond({ method, route, headers, body }); if (forced) return forced; }
    if (method === "POST" && route === "/v1/heartbeat") {
      if (!exact(body, ["schema", "installId", "appVersion", "addonVersion", "channel", "os", "osMajor", "lang", "build", "firstSeenWeek", "flags", "areas"])) return bad("fields");
      if (body.schema !== 1 || !common(body) || !versionOrNull(body.addonVersion) || !buildOrNull(body.build) || !["stable", "beta", "dev"].includes(body.channel) || !/^\d{4}-W\d{2}$/.test(body.firstSeenWeek)) return bad("values");
      if (!exact(body.flags, ["gameConnected", "addonInstalled", "liveLink", "sharing"]) || Object.values(body.flags).some((v) => typeof v !== "boolean")) return bad("flags");
      if (!Array.isArray(body.areas) || new Set(body.areas).size !== body.areas.length || body.areas.some((a) => !HB_AREAS.includes(a))) return bad("areas");
      heartbeats.push(body);
      return ok(200, { ok: true });
    }
    if (method === "POST" && route === "/v1/tickets") {
      if (!exact(body, ["schema", "installId", "appVersion", "addonVersion", "os", "osMajor", "lang", "build", "kind", "area", "frequency", "summary", "details", "expected", "diagnostics"])) return bad("fields");
      if (body.schema !== 1 || !common(body) || !versionOrNull(body.addonVersion) || !buildOrNull(body.build)) return bad("values");
      if (!KINDS.includes(body.kind) || !AREAS.includes(body.area) || !(body.frequency === null || FREQ.includes(body.frequency))) return bad("choice");
      if (!str(body.summary, 5, 140) || /\n/.test(body.summary) || !str(body.details, 10, 4000) || !str(body.expected, 0, 1000)) return bad("text");
      const d = body.diagnostics;
      if (d !== null && (!exact(d, ["screen", "lastError", "gameConnected", "addonInstalled"]) || typeof d.screen !== "string" || !(d.lastError === null || str(d.lastError, 0, 2000)) || typeof d.gameConnected !== "boolean" || typeof d.addonInstalled !== "boolean")) return bad("diagnostics");
      const id = `BF-${nextTicket++}`, key = crypto.randomBytes(32).toString("base64url");
      tickets.set(id, { ticket: id, key, install: body.installId, status: "new", fixedIn: null, kind: body.kind, area: body.area, summary: body.summary, createdAt: iso(), updatedAt: iso(), body, messages: [{ id: 1, from: "player", text: body.details, at: iso() }] });
      return ok(201, { ok: true, ticket: id, key, status: "new", createdAt: iso() });
    }
    if (method === "POST" && route === "/v1/tickets/sync") {
      if (!exact(body, ["schema", "tickets"]) || body.schema !== 1 || !Array.isArray(body.tickets) || body.tickets.length > 50) return bad("fields");
      const out = [], gone = [];
      for (const row of body.tickets) {
        if (!exact(row, ["ticket", "key", "since"]) || !Number.isSafeInteger(row.since)) return bad("row");
        const t = tickets.get(row.ticket);
        if (!t || t.key !== row.key) { gone.push(row.ticket); continue; }
        out.push({ ticket: t.ticket, status: t.status, fixedIn: t.fixedIn, updatedAt: t.updatedAt, unread: t.messages.filter((m) => m.from === "team" && m.id > row.since).length, lastId: t.messages.at(-1).id });
      }
      return ok(200, { ok: true, tickets: out, gone });
    }
    const one = /^\/v1\/tickets\/(BF-\d+)(\/messages)?$/.exec(route);
    if (one) {
      const t = auth(one[1], headers);
      if (!t) return ok(404, { ok: false, error: "not_found" });
      if (method === "GET" && !one[2]) {
        const since = Number(u.searchParams.get("since") || 0);
        return ok(200, { ok: true, ticket: t.ticket, status: t.status, fixedIn: t.fixedIn, kind: t.kind, area: t.area, summary: t.summary, createdAt: t.createdAt, updatedAt: t.updatedAt, messages: t.messages.filter((m) => m.id > since) });
      }
      if (method === "POST" && one[2]) {
        if (!exact(body, ["schema", "text"]) || body.schema !== 1 || !str(body.text, 1, 4000)) return bad("text");
        const m = { id: t.messages.at(-1).id + 1, from: "player", text: body.text, at: iso() };
        t.messages.push(m); t.updatedAt = iso();
        if (["fixed", "closed"].includes(t.status)) t.status = "looking";
        return ok(201, { ok: true, id: m.id, at: m.at, status: t.status });
      }
      if (method === "DELETE" && !one[2]) { tickets.delete(t.ticket); return ok(200, { ok: true }); }
    }
    if (method === "POST" && route === "/v1/errors") {
      if (!exact(body, ["schema", "installId", "appVersion", "os", "osMajor", "lang", "where", "name", "message", "stack"])) return bad("fields");
      if (body.schema !== 1 || !common(body) || !["main", "renderer"].includes(body.where) || !str(body.name, 1, 60) || !str(body.message, 0, 300)) return bad("values");
      if (!Array.isArray(body.stack) || body.stack.length > 12 || body.stack.some((l) => !str(l, 0, 200) || /[\\/]/.test(l.replace(/<anonymous>/g, "")))) return bad("stack");
      errors.push(body);
      return ok(200, { ok: true });
    }
    if (method === "GET" && route === "/v1/announcements") {
      if ([...u.searchParams.keys()].sort().join() !== "appVersion,lang,os") return bad("query");
      const etag = `"a${announceVersion}"`;
      if (headers["if-none-match"] === etag) return ok(304, undefined, { etag });
      return ok(200, { ok: true, announcements }, { etag, "cache-control": "public, max-age=3600" });
    }
    if (method === "POST" && route === "/v1/forget") {
      if (!exact(body, ["schema", "installId"]) || !UUID.test(body.installId)) return bad("fields");
      forgotten.push(body.installId);
      let reports = 0;
      for (const [id, t] of tickets) if (t.install === body.installId) { tickets.delete(id); reports++; }
      return ok(200, { ok: true, removed: { observations: 0, reports } });
    }
    if (method === "GET" && route === "/v1/health") return ok(200, { ok: true, service: "bf-community", desk: true });
    if (method === "GET" && route === "/v1/pack") return ok(404, { ok: false, error: "not_found" });
    if (method === "POST" && route === "/v1/submit") return ok(200, { ok: true, stored: 0 });
    return ok(404, { ok: false, error: "not_found" });
  }
  const lower = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]));
  async function fetch(url, init = {}) {
    const headers = lower(init.headers), body = init.body ? JSON.parse(init.body) : undefined;
    const u = new URL(url);
    log.push({ method: init.method || "GET", route: u.pathname, query: u.search, headers, body, raw: init.body || "" });
    if (down) throw new TypeError("fetch failed");
    const r = handle(init.method || "GET", u.pathname + u.search, headers, body);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...r.headers } });
  }
  function listen() {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
        log.push({ method: req.method, route: new URL(req.url, "http://x").pathname, query: new URL(req.url, "http://x").search, headers: req.headers, body, raw });
        if (down) { req.socket.destroy(); return; }
        const r = handle(req.method, req.url, req.headers, body);
        res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
        res.end(r.body === undefined ? "" : JSON.stringify(r.body));
      });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) })));
  }
  return {
    fetch, listen, log, tickets, heartbeats, errors, forgotten,
    setDown: (v) => { down = v; }, setRespond: (fn) => { respond = fn; },
    setAnnouncements: (list) => { announcements = list; announceVersion++; },
    /** What the admin would do: answer a ticket, or change its status. */
    teamReply(id, text, status = "question") { const t = tickets.get(id); t.messages.push({ id: t.messages.at(-1).id + 1, from: "team", text, at: iso() }); t.status = status; t.updatedAt = iso(); },
    setStatus(id, status, fixedIn = null) { const t = tickets.get(id); t.status = status; t.fixedIn = fixedIn; t.updatedAt = iso(); },
    requests: (route) => log.filter((c) => !route || c.route === route || (route instanceof RegExp && route.test(c.route))),
  };
}
module.exports = { fakeDesk };

"use strict";
// HTTP routes of Backstage Live (CLIENT-CONTRACT.md section 11): the realtime
// session and stream, guilds, events and sign-ups, the Discord link, the
// Discord webhooks and the party board. app.js owns the server, the error
// answers and the log; this file only adds routes to it.
//
// Credentials: the install id (body) for calls any install may make, and the
// member token (header X-BF-Member) for everything inside a guild. A missing,
// malformed or unknown token, a token of another guild and a guild that does
// not exist all get the same 404, so nothing here says whether a guild exists.
const crypto = require("node:crypto");
const V = require("./validate-live");
const G = require("./guilds");
const D = require("./discord");
const { topic } = require("./hub");
const { RateLimiter } = require("./ratelimit");
const { esc } = require("./admin/html");

const LIMITS = Object.freeze({ session: 4 * 1024, guild: 2 * 1024, event: 4 * 1024, signup: 2 * 1024, summary: 8 * 1024, small: 1024, listing: 4 * 1024, interaction: 64 * 1024 });
const PAGE_STYLE = "body{font:16px/1.5 system-ui,sans-serif;background:#1b1712;color:#eadfca;margin:0;display:grid;min-height:100vh;place-items:center}main{max-width:32rem;padding:2rem;border:1px solid #6b5a3a;border-radius:8px;background:#26201a}h1{font-size:1.3rem;margin:0 0 .6rem;color:#f0d9a0}p{margin:.4rem 0}code{font-size:1.25rem;letter-spacing:.06em;color:#fff}";
const PAGE_CSP = `default-src 'none'; style-src 'sha256-${crypto.createHash("sha256").update(PAGE_STYLE).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function createLiveHttp({ live, store, config, now, http }) {
  const { send, readJson, limit, installHash, HttpError, clientKey, SECURITY_HEADERS } = http;
  const guilds = store.guilds, L = config.limits;
  const limiters = {
    session: new RateLimiter(L.liveSessionPerInstall),
    create: new RateLimiter(L.guildCreatePerInstall),
    joinInstall: new RateLimiter(L.guildJoinPerInstall),
    joinCode: new RateLimiter(L.guildJoinPerCode),
    codeMiss: new RateLimiter(L.codeMissPerIp),
    member: new RateLimiter(L.guildCallsPerMember),
    lfgWrite: new RateLimiter(L.lfgWritePerInstall),
    lfgRead: new RateLimiter(L.lfgReadPerIp),
    discordStart: new RateLimiter(L.discordStartPerGuild),
    discordTest: new RateLimiter(L.discordTestPerGuild),
    interactions: new RateLimiter(L.discordInteractionsGlobal),
  };
  const notFound = () => new HttpError(404, "not_found");
  const forbidden = () => new HttpError(403, "forbidden");
  const discordOff = () => new HttpError(503, "discord_off");

  // A body that may be left out entirely (leave, start, test, delete).
  async function optionalJson(req, max) {
    const length = req.headers["content-length"];
    if (req.headers["content-type"] === undefined && (length === undefined || length === "0") && req.headers["transfer-encoding"] === undefined) { req.resume(); return undefined; }
    return readJson(req, max);
  }
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > max) return reject(new HttpError(413, "body_too_large"));
      const chunks = []; let size = 0, done = false;
      req.on("data", (c) => { if (done) return; size += c.length; if (size > max) { done = true; reject(new HttpError(413, "body_too_large")); } else chunks.push(c); });
      req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      req.on("error", () => { if (!done) { done = true; reject(new HttpError(400, "read_failed")); } });
    });
  }
  function segment(value) { try { return decodeURIComponent(value); } catch { throw notFound(); } }
  function html(res, status, title, body) {
    const page = Buffer.from(`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Backstage Forever</title><style>${PAGE_STYLE}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>\n`);
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Security-Policy": PAGE_CSP, "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8", "Content-Length": page.length });
    res.end(res.req.method === "HEAD" ? undefined : page);
  }

  // The member behind X-BF-Member, checked against the guild in the address.
  function memberOf(req, guildSegment) {
    const guildId = V.guildIdSegment(guildSegment), token = V.memberToken(req.headers["x-bf-member"]);
    if (!guildId || !token) throw notFound();
    const m = guilds.memberByToken(token, now());
    if (!m || m.guild !== guildId) throw notFound();
    if (store.isBlocked(m.install)) throw new HttpError(403, "blocked");
    const g = guilds.guild(guildId);
    if (!g) throw notFound();
    limit(limiters.member, m.token_hash);
    return { g, m };
  }
  const lead = (m) => m.role === "leader" || m.role === "officer";

  const routes = [
    // ------------------------------------------------------------ realtime
    [/^\/v1\/live\/session$/, "/v1/live/session", {
      POST: async (req, res) => {
        const v = V.validateSession(await readJson(req, LIMITS.session));
        const install = installHash(v.installId);
        limit(limiters.session, install);
        const topics = [], members = new Map();
        // A subscription that is not backed by the right secret is left out, silently:
        // the stream then simply never carries it.
        for (const t of v.tickets) { const row = store.desk.ticketByKey(t.number, t.key); if (row) topics.push(topic.ticket(row.id)); }
        for (const s of v.guilds) {
          const m = guilds.memberByToken(s.member, now());
          if (m && m.guild === s.guildId && !store.isBlocked(m.install)) { topics.push(topic.guild(s.guildId)); members.set(s.guildId, m.name_key); }
        }
        for (const s of v.lfg) topics.push(topic.lfg(V.realmKey(s.realm), s.faction));
        const made = live.hub.issue(install, topics, members);
        if (!made) throw new HttpError(503, "busy", { retryAfterSec: 30 });
        send(res, 200, { ok: true, stream: made.token, expiresIn: made.expiresIn });
      },
    }],
    [/^\/v1\/live\/stream$/, "/v1/live/stream", {
      GET: (req, res, url) => {
        if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", { allow: "GET" });
        const session = live.hub.redeem(V.validateStreamQuery(url.searchParams));
        if (!session) throw notFound();
        if (store.isBlocked(session.install)) throw new HttpError(403, "blocked");
        if (live.hub.full()) { live.hub.counters.refused += 1; throw new HttpError(503, "busy", { retryAfterSec: 60 }); }
        live.hub.open(session, req, res, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      },
    }],

    // -------------------------------------------------------------- guilds
    [/^\/v1\/guilds$/, "/v1/guilds", {
      POST: async (req, res) => {
        const v = V.validateGuildCreate(await readJson(req, LIMITS.guild));
        const install = installHash(v.installId);
        limit(limiters.create, install);
        if (guilds.guildCount() >= config.maxGuilds) throw new HttpError(503, "busy", { retryAfterSec: 3600 });
        const r = live.createGuild(install, v);
        if (r.error) throw new HttpError(409, r.error);
        send(res, 201, { ok: true, guildId: r.guildId, linkCode: r.linkCode, member: r.member, role: r.role });
      },
    }],
    [/^\/v1\/guilds\/join$/, "/v1/guilds/join", {
      POST: async (req, res) => {
        const v = V.validateGuildJoin(await readJson(req, LIMITS.guild));
        const install = installHash(v.installId);
        limit(limiters.joinInstall, install);
        const g = guilds.guildByCodeHash(live.hash(v.linkCode));
        if (!g) { limit(limiters.codeMiss, clientKey(req)); throw notFound(); }
        limit(limiters.joinCode, g.id);
        const r = live.join(g, install, v);
        if (r.error) throw new HttpError(409, r.error);
        send(res, 201, { ok: true, guildId: g.id, guildName: g.name, member: r.member, role: r.role });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})$/, "/v1/guilds/:guild", {
      GET: (req, res, url, id) => {
        const { g, m } = memberOf(req, id);
        send(res, 200, guilds.view(g, m));
      },
      PATCH: async (req, res, url, id) => {
        const { g, m } = memberOf(req, id);
        const v = V.validateGuildPatch(await readJson(req, LIMITS.small));
        if (m.role !== "leader") throw forbidden();
        if (v.thresholds) guilds.setThresholds(g.id, v.thresholds);
        const linkCode = v.rotateCode ? live.rotateCode(g.id) : null;
        send(res, 200, { ...guilds.view(guilds.guild(g.id), guilds.member(g.id, m.name_key)), ...(linkCode ? { linkCode } : {}) });
      },
      DELETE: async (req, res, url, id) => {
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (m.role !== "leader") throw forbidden();
        live.deleteGuild(g);
        send(res, 200, { ok: true });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/leave$/, "/v1/guilds/:guild/leave", {
      POST: async (req, res, url, id) => {
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        live.removeMember(g, m.name_key);
        send(res, 200, { ok: true });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/members\/([^/]{1,220})$/, "/v1/guilds/:guild/members/:name", {
      DELETE: async (req, res, url, id, nameSegment) => {
        const { g, m } = memberOf(req, id);
        const name = V.memberSegment(segment(nameSegment));
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (!lead(m)) throw forbidden();
        const target = guilds.member(g.id, V.nameKey(name));
        if (!target) throw notFound();
        // An officer removes members; only a leader removes an officer or another leader. To go yourself, leave.
        if (target.name_key === m.name_key || (m.role !== "leader" && target.role !== "member")) throw forbidden();
        live.removeMember(g, target.name_key);
        send(res, 200, { ok: true });
      },
    }],

    // --------------------------------------------------- events, sign-ups
    [/^\/v1\/guilds\/([^/]{1,40})\/events$/, "/v1/guilds/:guild/events", {
      GET: (req, res, url, id) => {
        const { g } = memberOf(req, id);
        send(res, 200, { ok: true, ...guilds.listEvents(g.id, V.validateEventsQuery(url.searchParams)) });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/events\/([^/]{1,40})$/, "/v1/guilds/:guild/events/:event", {
      PUT: async (req, res, url, id, eventId) => {
        const { g, m } = memberOf(req, id);
        if (!V.EVENT_ID.test(eventId)) throw notFound();
        const e = V.validateEvent(await readJson(req, LIMITS.event), eventId);
        const r = live.putEvent(g, m, e);
        if (r.error === "forbidden") throw forbidden();
        if (r.error) throw new HttpError(409, r.error);
        send(res, 200, { ok: true, accepted: r.accepted, reason: r.reason, event: r.event });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/events\/([^/]{1,40})\/signups\/([^/]{1,220})$/, "/v1/guilds/:guild/events/:event/signups/:name", {
      PUT: async (req, res, url, id, eventId, nameSegment) => {
        const { g, m } = memberOf(req, id);
        if (!V.EVENT_ID.test(eventId)) throw notFound();
        const name = V.memberSegment(segment(nameSegment));
        const s = V.validateSignup(await readJson(req, LIMITS.signup), name);
        const direct = V.nameKey(s.who.name) === m.name_key;
        if (!direct && !lead(m)) throw forbidden(); // a member answers only for their own character
        const r = live.putSignup(g, eventId, s, direct);
        if (r.error) throw notFound();
        send(res, 200, { ok: true, accepted: r.accepted, reason: r.reason, signup: r.signup });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/events\/([^/]{1,40})\/summary$/, "/v1/guilds/:guild/events/:event/summary", {
      POST: async (req, res, url, id, eventId) => {
        const { g, m } = memberOf(req, id);
        if (!V.EVENT_ID.test(eventId)) throw notFound();
        const s = V.validateSummary(await readJson(req, LIMITS.summary));
        if (!lead(m)) throw forbidden();
        const ev = guilds.eventRow(g.id, eventId);
        if (!ev) throw notFound();
        send(res, 200, { ok: true, ...live.summary(g, ev, s) });
      },
    }],

    // ------------------------------------------------------------ discord
    [/^\/v1\/guilds\/([^/]{1,40})\/discord\/start$/, "/v1/guilds/:guild/discord/start", {
      POST: async (req, res, url, id) => {
        if (!live.discord) throw discordOff();
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (!lead(m)) throw forbidden();
        limit(limiters.discordStart, g.id);
        send(res, 200, { ok: true, url: live.discordStart(g) });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/discord\/test$/, "/v1/guilds/:guild/discord/test", {
      POST: async (req, res, url, id) => {
        if (!live.discord) throw discordOff();
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (!lead(m)) throw forbidden();
        if (!g.discord_guild) throw new HttpError(409, "not_connected");
        limit(limiters.discordTest, g.id);
        send(res, 200, { ok: true, ...(await live.discordTest(g)) });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/discord$/, "/v1/guilds/:guild/discord", {
      DELETE: async (req, res, url, id) => {
        if (!live.discord) throw discordOff();
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (!lead(m)) throw forbidden();
        live.discordDisconnect(g);
        send(res, 200, { ok: true });
      },
    }],
    [/^\/v1\/guilds\/([^/]{1,40})\/discord\/link$/, "/v1/guilds/:guild/discord/link", {
      POST: async (req, res, url, id) => {
        if (!live.discord) throw discordOff();
        const { g, m } = memberOf(req, id);
        const v = V.validateDiscordLink(await readJson(req, LIMITS.small));
        const r = live.discordLink(g, m, v.code);
        if (!r) { limit(limiters.codeMiss, clientKey(req)); throw notFound(); }
        send(res, 200, { ok: true, discord: r.discord });
      },
      DELETE: async (req, res, url, id) => {
        if (!live.discord) throw discordOff();
        const { g, m } = memberOf(req, id);
        V.validateEmpty(await optionalJson(req, LIMITS.small));
        if (guilds.unlinkDiscord(g.id, m.name_key)) live.syncAll(g.id);
        send(res, 200, { ok: true });
      },
    }],
    [/^\/discord\/callback$/, "/discord/callback", {
      GET: async (req, res, url) => {
        if (!live.discord) throw discordOff();
        const r = await live.discordCallback(url.searchParams);
        html(res, r.status, r.title, `<p>${esc(r.text)}</p>`);
      },
    }],
    [/^\/discord\/link$/, "/discord/link", {
      GET: (req, res, url) => {
        if (!live.discord) throw discordOff();
        const code = String(url.searchParams.get("code") ?? "").toUpperCase();
        if (!V.DISCORD_CODE.test(code)) return html(res, 400, "This link is not complete", "<p>Run /backstage link in your guild's Discord server again.</p>");
        html(res, 200, "Link your character", `<p>Open Backstage Forever on this computer, go to Guild and then Discord, and type this code:</p><p><code>${esc(code)}</code></p><p>The code works once and for 15 minutes. You can close this tab afterwards.</p>`);
      },
    }],
    [/^\/discord\/interactions$/, "/discord/interactions", {
      POST: async (req, res) => {
        if (!live.discord) throw discordOff();
        limit(limiters.interactions, "global");
        const raw = await readRaw(req, LIMITS.interaction);
        // Checked on the raw bytes; nothing is parsed before the signature and the timestamp hold.
        if (!D.verifyInteraction(live.discord.publicKey, req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"], raw, now()))
          throw new HttpError(401, "invalid_signature");
        let body;
        try { body = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "invalid_json"); }
        const answer = live.interaction(body);
        if (!answer) throw new HttpError(400, "invalid");
        send(res, 200, answer);
      },
    }],

    // -------------------------------------------------------- party board
    [/^\/v1\/lfg$/, "/v1/lfg", {
      GET: (req, res, url) => {
        const q = V.validateLfgQuery(url.searchParams);
        limit(limiters.lfgRead, clientKey(req));
        send(res, 200, { ok: true, listings: guilds.listListings(q.realm, q.faction, now()) });
      },
    }],
    [/^\/v1\/lfg\/([^/]{1,40})$/, "/v1/lfg/:id", {
      PUT: async (req, res, url, id) => {
        if (!V.LISTING_ID.test(id)) throw notFound();
        const v = V.validateListing(await readJson(req, LIMITS.listing), id);
        const install = installHash(v.installId);
        limit(limiters.lfgWrite, install);
        if (!guilds.get("SELECT 1 AS x FROM lfg WHERE install = ?", install) && guilds.listingCount(now()) >= config.maxListings) throw new HttpError(503, "busy", { retryAfterSec: 600 });
        const r = live.putListing(install, v);
        if (r.error) throw new HttpError(409, r.error);
        send(res, 200, { ok: true, listing: r.listing, expiresIn: Math.round(G.LFG_TTL_MS / 1000) });
      },
      DELETE: async (req, res, url, id) => {
        if (!V.LISTING_ID.test(id)) throw notFound();
        const v = V.validateInstallOnly(await readJson(req, LIMITS.small));
        const install = installHash(v.installId);
        limit(limiters.lfgWrite, install);
        if (!live.deleteListing(install, id)) throw notFound();
        send(res, 200, { ok: true });
      },
    }],
  ];

  // -> null, or { label, handler, allow } for the path (handler is null when the method is not offered).
  function match(method, pathname) {
    for (const [re, label, methods] of routes) {
      const hit = re.exec(pathname);
      if (!hit) continue;
      const fn = methods[method];
      const allow = Object.keys(methods).flatMap(k => (k === "GET" ? ["GET", "HEAD"] : [k])).join(", ");
      return { label, allow, handler: fn ? (req, res, url) => fn(req, res, url, ...hit.slice(1)) : null };
    }
    return null;
  }

  return { match, limiters, LIMITS };
}

module.exports = { createLiveHttp, LIMITS, PAGE_CSP };

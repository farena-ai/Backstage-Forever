"use strict";
// A small in-test stand-in for the Backstage service, implementing the Backstage Live contract
// (live session and stream, guilds, events and sign-ups, Discord, the realm party board) on
// 127.0.0.1. It rejects unknown fields like the real service, so a test fails when the app sends
// anything the contract does not list. Every request is kept in `log`.
const http = require("node:http"), crypto = require("node:crypto");

const token = (n = 32) => crypto.randomBytes(n).toString("base64url");
const exact = (o, required, optional = []) => o && typeof o === "object" && !Array.isArray(o) && required.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));
const who = (c) => exact(c, ["name", "realm"]) && typeof c.name === "string" && c.name.length >= 2 && c.name.length <= 24 && typeof c.realm === "string" && c.realm.length >= 1 && c.realm.length <= 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANSWERS = ["tank", "healer", "damage", "maybe", "no"];
const plainText = (v, max) => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f|]/.test(v) && !/:\/\/|www\./i.test(v);

function validEvent(e) {
  return exact(e, ["id", "version", "creator", "editor", "at", "place", "title", "note", "roles", "cancelled"]) && /^[A-Za-z0-9_-]{1,24}$/.test(e.id) && Number.isSafeInteger(e.version) && e.version >= 1
    && who(e.creator) && who(e.editor) && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) && /^[a-z][a-z0-9]{0,7}$/.test(e.place) && plainText(e.title, 40) && e.title.length >= 2 && plainText(e.note, 80)
    && exact(e.roles, ["tank", "healer", "damage"]) && Object.values(e.roles).every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 40) && typeof e.cancelled === "boolean";
}
function validSignup(s) {
  return exact(s, ["who", "answer", "version", "via"]) && who(s.who) && ANSWERS.includes(s.answer) && Number.isSafeInteger(s.version) && s.version >= 1 && ["game", "desktop", "discord"].includes(s.via);
}
function validListing(l) {
  return exact(l, ["id", "kind", "who", "level", "class", "roles", "place", "note", "need", "at"]) && /^[A-Za-z0-9_-]{16}$/.test(l.id) && ["lfg", "lfm"].includes(l.kind) && who(l.who)
    && Number.isSafeInteger(l.level) && l.level >= 1 && l.level <= 100 && (l.class === null || /^[a-z]{3,12}$/.test(l.class)) && Array.isArray(l.roles) && l.roles.length >= 1 && l.roles.every((r) => ["tank", "healer", "damage"].includes(r))
    && /^[a-z][a-z0-9]{0,7}$/.test(l.place) && plainText(l.note, 60) && (l.need === null || (exact(l.need, ["tank", "healer", "damage"]) && Object.values(l.need).every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 40)))
    && typeof l.at === "string" && Number.isFinite(Date.parse(l.at));
}

function fakeLive({ discord = true } = {}) {
  const log = [], streams = new Set(), sessions = new Map();
  const guilds = new Map(), lfg = new Map(), discordCodes = new Map();
  const state = { discord, offline: false, busy: false, serial: 0, pingMs: 0, rejectSessions: null, slowMs: 0 };
  const lowerKey = (realm, faction, name) => `${realm}|${faction}|${name}`.toLowerCase();
  const eventOrder = (a, b) => a.version - b.version || `${a.editor.name}`.toLowerCase().localeCompare(`${b.editor.name}`.toLowerCase());

  function send(res, status, json, headers = {}) {
    const text = JSON.stringify(json);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(text), ...headers });
    res.end(text);
  }
  const bad = (res, detail = "") => send(res, 400, { ok: false, error: "invalid", detail });
  const notFound = (res) => send(res, 404, { ok: false, error: "not_found" });
  /** Push one event to every open stream whose subscriptions match. */
  function push(event, data, match = () => true) {
    let n = 0;
    for (const s of streams) {
      if (!match(s.subs)) continue;
      s.res.write(`event: ${event}\nid: ${++s.id}\ndata: ${JSON.stringify(data)}\n\n`); n++;
    }
    return n;
  }
  const toGuild = (guildId) => (subs) => subs.some((x) => x.t === "guild" && x.guildId === guildId);
  const toBoard = (realm, faction) => (subs) => subs.some((x) => x.t === "lfg" && x.realm === realm && x.faction === faction);
  const toTicket = (ticket) => (subs) => subs.some((x) => x.t === "tickets" && x.tickets.some((t) => t.ticket === ticket));
  function memberOf(req, g) {
    const t = req.headers["x-bf-member"];
    return typeof t === "string" && g ? g.members.find((m) => m.token === t) || null : null;
  }
  const officer = (m) => m && (m.role === "leader" || m.role === "officer");
  const publicGuild = (g, m) => ({ ok: true, guildId: g.id, guildName: g.guildName, realm: g.realm, faction: g.faction, role: m.role,
    members: g.members.map((x) => ({ name: x.character.name, realm: x.character.realm, role: x.role, discord: x.discord, lastSeen: x.lastSeen })),
    thresholds: { ...g.thresholds }, discord: { ...g.discord } });

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1"), route = url.pathname;
    let raw = "";
    for await (const c of req) raw += c;
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { log.push({ method: req.method, route, body: raw, member: null }); return send(res, 400, { ok: false, error: "invalid_json" }); } }
    const entry = { method: req.method, route, query: Object.fromEntries(url.searchParams), body, member: req.headers["x-bf-member"] || null, headers: req.headers, at: Date.now() };
    log.push(entry);
    if (state.slowMs) await new Promise((r) => setTimeout(r, state.slowMs));
    if (state.offline) { req.socket.destroy(); return; }

    // ---- L1 / L2
    if (req.method === "POST" && route === "/v1/live/session") {
      if (raw.length > 4096) return send(res, 413, { ok: false, error: "body_too_large" });
      if (state.busy) return send(res, 503, { ok: false, error: "busy" });
      if (state.rejectSessions) return send(res, state.rejectSessions, { ok: false, error: state.rejectSessions === 429 ? "rate_limited" : "invalid" }, state.rejectSessions === 429 ? { "Retry-After": "2" } : {});
      if (!exact(body, ["schema", "installId", "subs"]) || body.schema !== 1 || !UUID.test(body.installId) || !Array.isArray(body.subs) || !body.subs.length) return bad(res, "session");
      for (const s of body.subs) {
        if (s?.t === "tickets") { if (!exact(s, ["t", "tickets"]) || !Array.isArray(s.tickets) || !s.tickets.every((t) => exact(t, ["ticket", "key"]))) return bad(res, "tickets"); }
        else if (s?.t === "guild") { if (!exact(s, ["t", "guildId", "member"])) return bad(res, "guild"); const g = guilds.get(s.guildId); if (!g || !g.members.some((m) => m.token === s.member)) return notFound(res); }
        else if (s?.t === "lfg") { if (!exact(s, ["t", "realm", "faction"]) || !["horde", "alliance"].includes(s.faction)) return bad(res, "lfg"); }
        else return bad(res, "subs");
      }
      const t = token(32);
      sessions.set(t, body.subs);
      return send(res, 200, { ok: true, stream: t, expiresIn: 60 });
    }
    if (req.method === "GET" && route === "/v1/live/stream") {
      const subs = sessions.get(url.searchParams.get("s"));
      if (!subs) return notFound(res);
      sessions.delete(url.searchParams.get("s")); // one-time
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const s = { res, subs, id: 0, ping: null };
      streams.add(s);
      res.write(`event: hello\nid: ${++s.id}\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`);
      if (state.pingMs) s.ping = setInterval(() => res.write(": ping\n\n"), state.pingMs);
      res.on("close", () => { clearInterval(s.ping); streams.delete(s); });
      return;
    }

    // ---- G1 / G2
    if (req.method === "POST" && route === "/v1/guilds") {
      if (!exact(body, ["schema", "installId", "realm", "faction", "guildName", "character", "rankIndex"]) || body.schema !== 1 || !UUID.test(body.installId) || !["horde", "alliance"].includes(body.faction)
        || typeof body.guildName !== "string" || body.guildName.length < 2 || body.guildName.length > 24 || !who(body.character) || !Number.isSafeInteger(body.rankIndex) || body.rankIndex < 0 || body.rankIndex > 9) return bad(res, "guild");
      if ([...guilds.values()].some((g) => lowerKey(g.realm, g.faction, g.guildName) === lowerKey(body.realm, body.faction, body.guildName))) return send(res, 409, { ok: false, error: "exists" });
      const id = `g_${token(9)}`, member = token(32), code = `BFG-${token(3).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 4)}-${token(3).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 4)}`;
      guilds.set(id, { id, guildName: body.guildName, realm: body.realm, faction: body.faction, linkCode: code, thresholds: { officerRank: 1, proposeRank: 9, editRank: 1 },
        members: [{ token: member, install: body.installId, character: body.character, role: "leader", discord: null, lastSeen: new Date().toISOString() }],
        events: new Map(), signups: new Map(), discord: { state: "none", guildName: null, channel: null, problem: null }, summaries: [], tests: 0 });
      return send(res, 201, { ok: true, guildId: id, linkCode: code, member, role: "leader" });
    }
    if (req.method === "POST" && route === "/v1/guilds/join") {
      if (!exact(body, ["schema", "installId", "linkCode", "character", "rankIndex", "consent"]) || body.schema !== 1 || !UUID.test(body.installId) || body.consent !== true || !who(body.character) || !Number.isSafeInteger(body.rankIndex)) return bad(res, "join");
      const g = [...guilds.values()].find((x) => x.linkCode === body.linkCode);
      if (!g) return notFound(res);
      const member = token(32), role = body.rankIndex <= g.thresholds.officerRank ? "officer" : "member";
      g.members = g.members.filter((m) => !(m.character.name === body.character.name && m.character.realm === body.character.realm));
      g.members.push({ token: member, install: body.installId, character: body.character, role, discord: null, lastSeen: new Date().toISOString() });
      push("guild.member", { guildId: g.id, members: g.members.length }, toGuild(g.id));
      return send(res, 201, { ok: true, guildId: g.id, guildName: g.guildName, member, role });
    }
    // ---- everything under one guild
    const gm = /^\/v1\/guilds\/(g_[A-Za-z0-9_-]+)(\/.*)?$/.exec(route);
    if (gm) {
      const g = guilds.get(gm[1]), rest = gm[2] || "", m = memberOf(req, g);
      if (!g || !m) return notFound(res);
      m.lastSeen = new Date().toISOString();
      if (rest === "" && req.method === "GET") return send(res, 200, publicGuild(g, m));
      if (rest === "" && req.method === "PATCH") {
        if (m.role !== "leader") return send(res, 403, { ok: false, error: "forbidden" });
        if (!exact(body, ["schema"], ["thresholds", "rotateCode"]) || body.schema !== 1 || (body.rotateCode !== undefined && body.rotateCode !== true)) return bad(res, "patch");
        if (body.thresholds) { if (!exact(body.thresholds, [], ["officerRank", "proposeRank", "editRank"])) return bad(res, "thresholds"); Object.assign(g.thresholds, body.thresholds); }
        if (body.rotateCode) g.linkCode = `BFG-NEW${++state.serial}-ROTA`;
        return send(res, 200, { ...publicGuild(g, m), ...(body.rotateCode ? { linkCode: g.linkCode } : {}) });
      }
      if (rest === "" && req.method === "DELETE") {
        if (m.role !== "leader") return send(res, 403, { ok: false, error: "forbidden" });
        guilds.delete(g.id);
        return send(res, 200, { ok: true });
      }
      if (rest === "/leave" && req.method === "POST") {
        g.members = g.members.filter((x) => x !== m);
        push("guild.member", { guildId: g.id, members: g.members.length }, toGuild(g.id));
        return send(res, 200, { ok: true });
      }
      const mem = /^\/members\/([^/]+)$/.exec(rest);
      if (mem && req.method === "DELETE") {
        if (!officer(m)) return send(res, 403, { ok: false, error: "forbidden" });
        const name = decodeURIComponent(mem[1]);
        g.members = g.members.filter((x) => x.character.name !== name || x.role === "leader");
        return send(res, 200, { ok: true });
      }
      if (rest === "/events" && req.method === "GET") {
        return send(res, 200, { ok: true, events: [...g.events.values()], signups: Object.fromEntries([...g.signups].map(([id, rows]) => [id, [...rows.values()]])) });
      }
      const ev = /^\/events\/([A-Za-z0-9_-]{1,24})$/.exec(rest);
      if (ev && req.method === "PUT") {
        if (!validEvent(body) || body.id !== ev[1]) return bad(res, "event");
        const old = g.events.get(body.id);
        if (old && eventOrder(body, old) <= 0) return send(res, 200, { ok: true, kept: true, version: old.version });
        g.events.set(body.id, body);
        push("guild.event", { guildId: g.id, event: body }, toGuild(g.id));
        return send(res, 200, { ok: true, version: body.version });
      }
      const su = /^\/events\/([A-Za-z0-9_-]{1,24})\/signups\/([^/]+)$/.exec(rest);
      if (su && req.method === "PUT") {
        const name = decodeURIComponent(su[2]);
        if (!validSignup(body) || body.who.name !== name) return bad(res, "signup");
        if (!g.events.has(su[1])) return notFound(res);
        if (name !== m.character.name && !officer(m)) return send(res, 403, { ok: false, error: "forbidden" });
        if (!g.signups.has(su[1])) g.signups.set(su[1], new Map());
        const rows = g.signups.get(su[1]), old = rows.get(name.toLowerCase());
        if (old && body.version <= old.version) return send(res, 200, { ok: true, kept: true, version: old.version });
        rows.set(name.toLowerCase(), body);
        push("guild.signup", { guildId: g.id, eventId: su[1], signup: body }, toGuild(g.id));
        return send(res, 200, { ok: true, version: body.version });
      }
      const sm = /^\/events\/([A-Za-z0-9_-]{1,24})\/summary$/.exec(rest);
      if (sm && req.method === "POST") {
        if (!officer(m)) return send(res, 403, { ok: false, error: "forbidden" });
        if (!exact(body, ["schema", "attended", "bosses", "durationSec"]) || !Array.isArray(body.attended) || !body.attended.every((n) => typeof n === "string")) return bad(res, "summary");
        g.summaries.push({ id: sm[1], ...body });
        return send(res, 200, { ok: true });
      }
      if (rest.startsWith("/discord")) {
        if (!state.discord) return send(res, 503, { ok: false, error: "discord_off" });
        if (rest === "/discord/start" && req.method === "POST") {
          if (!officer(m)) return send(res, 403, { ok: false, error: "forbidden" });
          g.discord = { state: "pending", guildName: null, channel: null, problem: null };
          push("guild.discord", { guildId: g.id, state: "pending" }, toGuild(g.id));
          return send(res, 200, { ok: true, url: `https://discord.com/oauth2/authorize?client_id=1&scope=bot+applications.commands&state=${token(8)}` });
        }
        if (rest === "/discord/test" && req.method === "POST") { if (g.discord.state !== "connected") return send(res, 409, { ok: false, error: "not_connected" }); g.tests++; return send(res, 200, { ok: true }); }
        if (rest === "/discord" && req.method === "DELETE") {
          if (!officer(m)) return send(res, 403, { ok: false, error: "forbidden" });
          g.discord = { state: "none", guildName: null, channel: null, problem: null };
          for (const x of g.members) x.discord = null;
          push("guild.discord", { guildId: g.id, state: "none" }, toGuild(g.id));
          return send(res, 200, { ok: true });
        }
        if (rest === "/discord/link" && req.method === "POST") {
          if (!exact(body, ["schema", "code"]) || typeof body.code !== "string") return bad(res, "link");
          const name = discordCodes.get(body.code);
          if (!name) return notFound(res);
          discordCodes.delete(body.code); m.discord = name;
          return send(res, 200, { ok: true, discord: name });
        }
        if (rest === "/discord/link" && req.method === "DELETE") { m.discord = null; return send(res, 200, { ok: true }); }
      }
      return notFound(res);
    }

    // ---- P1
    const lf = /^\/v1\/lfg(?:\/([A-Za-z0-9_-]{16}))?$/.exec(route);
    if (lf) {
      if (req.method === "GET" && !lf[1]) {
        const realm = url.searchParams.get("realm"), faction = url.searchParams.get("faction");
        if (!realm || !["horde", "alliance"].includes(faction) || [...url.searchParams.keys()].some((k) => !["realm", "faction"].includes(k))) return bad(res, "lfg");
        return send(res, 200, { ok: true, listings: [...lfg.values()].filter((x) => x.realm === realm && x.faction === faction).map((x) => x.listing).reverse() });
      }
      if (req.method === "PUT" && lf[1]) {
        if (!exact(body, ["schema", "installId", "realm", "faction", "listing", "consent"]) || body.schema !== 1 || !UUID.test(body.installId) || body.consent !== true || !["horde", "alliance"].includes(body.faction) || !validListing(body.listing) || body.listing.id !== lf[1]) return bad(res, "listing");
        for (const [id, x] of lfg) if (x.install === body.installId && id !== lf[1]) { lfg.delete(id); push("lfg", { op: "gone", listing: x.listing }, toBoard(x.realm, x.faction)); }
        lfg.set(lf[1], { install: body.installId, realm: body.realm, faction: body.faction, listing: body.listing, at: Date.now() });
        push("lfg", { op: "put", listing: body.listing }, toBoard(body.realm, body.faction));
        return send(res, 200, { ok: true, expiresIn: 1800 });
      }
      if (req.method === "DELETE" && lf[1]) {
        if (!exact(body, ["schema", "installId"]) || !UUID.test(body.installId)) return bad(res, "delete");
        const x = lfg.get(lf[1]);
        if (!x || x.install !== body.installId) return notFound(res);
        lfg.delete(lf[1]);
        push("lfg", { op: "gone", listing: x.listing }, toBoard(x.realm, x.faction));
        return send(res, 200, { ok: true });
      }
    }
    // ---- the few Desk routes a full app touches while a test runs
    if (route === "/v1/tickets/sync") return send(res, 200, { ok: true, tickets: [], gone: [] });
    if (route === "/v1/announcements") return send(res, 200, { ok: true, announcements: [] });
    if (route === "/v1/heartbeat" || route === "/v1/forget") return send(res, 200, { ok: true });
    return notFound(res);
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
  const api = {
    log, state, guilds, lfg, streams,
    /** Requests so far, optionally only those whose path starts with a prefix. */
    requests: (prefix = "") => log.filter((e) => e.route.startsWith(prefix)),
    clear: () => { log.length = 0; },
    push, toGuild, toBoard, toTicket,
    /** End every open stream, as the service does after 55 minutes or when it restarts. */
    dropStreams() { const n = streams.size; for (const s of [...streams]) { clearInterval(s.ping); s.res.destroy(); } streams.clear(); return n; },
    guild: (id) => guilds.get(id),
    anyGuild: () => [...guilds.values()][0] || null,
    /** What Discord's callback and the bot's /backstage channel command would do. */
    discordConnected(guildId, { guildName = "Ashen Vanguard HQ", channel = "#raids" } = {}) {
      const g = guilds.get(guildId); g.discord = { state: "connected", guildName, channel, problem: null };
      push("guild.discord", { guildId, state: "connected" }, toGuild(guildId));
    },
    discordProblem(guildId, problem) { const g = guilds.get(guildId); g.discord = { ...g.discord, state: "problem", problem }; push("guild.discord", { guildId, state: "problem" }, toGuild(guildId)); },
    /** What /backstage link in Discord hands out. */
    discordCode(name = "Abel#0420") { const code = `L-${token(6)}`; discordCodes.set(code, name); return code; },
    /** Another member's app or a Discord button. */
    putEvent(guildId, event) { const g = guilds.get(guildId); g.events.set(event.id, event); push("guild.event", { guildId, event }, toGuild(guildId)); },
    removeEvent(guildId, id) { const g = guilds.get(guildId); g.events.delete(id); g.signups.delete(id); push("guild.event.gone", { guildId, id }, toGuild(guildId)); },
    putSignup(guildId, eventId, signup) { const g = guilds.get(guildId); if (!g.signups.has(eventId)) g.signups.set(eventId, new Map()); g.signups.get(eventId).set(signup.who.name.toLowerCase(), signup); push("guild.signup", { guildId, eventId, signup }, toGuild(guildId)); },
    putListing(realm, faction, listing, install = "9f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f") { lfg.set(listing.id, { install, realm, faction, listing, at: Date.now() }); push("lfg", { op: "put", listing }, toBoard(realm, faction)); },
    removeListing(id) { const x = lfg.get(id); if (!x) return; lfg.delete(id); push("lfg", { op: "gone", listing: x.listing }, toBoard(x.realm, x.faction)); },
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => { api.url = `http://127.0.0.1:${server.address().port}`; resolve(api); })),
    close: () => new Promise((resolve) => { api.dropStreams(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
  return api;
}
module.exports = { fakeLive, validEvent, validSignup, validListing };

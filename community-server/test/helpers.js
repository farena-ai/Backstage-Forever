"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SALT = "test-salt-0123456789abcdef0123456789abcdef";
const T0 = Date.parse("2026-11-24T12:00:00Z");
const DAY = 86_400_000;

function uuid() { return crypto.randomUUID(); }

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-community-test-"));
  return { dir, file: path.join(dir, "community.db"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Turns a database file made by this server back into what the 1.0.0 server left behind: schema 3,
// none of the Backstage Live tables. The file must not be open.
const LIVE_TABLES = ["guild_signups", "guild_events", "guild_summaries", "guild_members", "guilds", "discord_codes", "lfg", "live_daily"];
function asSchema3(file) {
  const { DatabaseSync } = require("node:sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(`${LIVE_TABLES.map(t => `DROP TABLE IF EXISTS ${t};`).join(" ")} PRAGMA user_version = 3;`);
  raw.close();
}

function submit(installId, observations, extra = {}) {
  return { schema: 1, installId, build: "1.15.8.66000", appVersion: "0.31.0", observations, ...extra };
}

function testConfig(overrides = {}) {
  const { loadConfig } = require("../lib/config");
  // Fast scrypt for tests; the real cost is covered by its own test.
  return loadConfig({}, { salt: SALT, packRebuildMs: 0, backupDir: null, auth: { scryptN: 1024 }, publicOrigin: "https://desk.test", ...overrides });
}

// ---------------------------------------------------------------- Desk helpers
function heartbeat(installId, extra = {}) {
  return {
    schema: 1, installId, appVersion: "1.26.0", addonVersion: "1.26.0", channel: "stable", os: "windows", osMajor: "11", lang: "en",
    build: "1.60.1.71037", firstSeenWeek: "2026-W48",
    flags: { gameConnected: true, addonInstalled: true, liveLink: false, sharing: true },
    areas: ["now", "route", "map"], ...extra,
  };
}

function ticket(installId, extra = {}) {
  return {
    schema: 1, installId, appVersion: "1.26.0", addonVersion: "1.26.0", os: "windows", osMajor: "11", lang: "en", build: "1.60.1.71037",
    kind: "bug", area: "talents", frequency: "always", summary: "Planner shows the wrong tree", details: "Steps: open the planner, pick a tree.",
    expected: "The tree I picked.", diagnostics: { screen: "talents", lastError: "TypeError: x (paths removed)", gameConnected: true, addonInstalled: true }, ...extra,
  };
}

function errorReport(installId, extra = {}) {
  return {
    schema: 1, installId, appVersion: "1.26.0", os: "windows", osMajor: "11", lang: "en", where: "main", name: "TypeError",
    message: "x is not a function", stack: ["at f (app.js:10:3)", "at g (app.js:20:5)", "at h (main.cjs:30:7)", "at i (main.cjs:40:9)"], ...extra,
  };
}

// Boots the real HTTP server on a random port with a temp database and a clock the test controls.
async function boot(configOverrides = {}, { notifier, startAt = T0, discordRequest, discordSleep } = {}) {
  const { Store } = require("../lib/store");
  const { createApp } = require("../lib/app");
  const db = tempDb();
  const store = new Store(db.file);
  const logs = [], clock = { t: startAt };
  const app = createApp({ store, config: testConfig(configOverrides), log: (l) => logs.push(l), now: () => clock.t, notifier, discordRequest, discordSleep });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    base, store, logs, clock, db, auth: app.auth, app, live: app.live,
    async close() {
      app.live.stop(); // event streams still open would keep the server from closing
      if (app.live.client) await app.live.client.idle();
      await new Promise((r) => { app.server.close(r); app.server.closeAllConnections(); });
      store.close(); db.cleanup();
    },
  };
}

function post(base, p, body, headers = {}) {
  return fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function form(base, p, fields, { cookie, headers = {} } = {}) {
  const body = fields instanceof URLSearchParams ? fields : new URLSearchParams(fields);
  return fetch(base + p, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body });
}

function get(base, p, { cookie, headers = {} } = {}) {
  return fetch(base + p, { redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
}

async function loginToken(s) {
  const html = await (await get(s.base, "/admin/login")).text();
  return /name="lt" value="([^"]+)"/.exec(html)[1];
}

// Signs in through the real form. Returns the raw response plus the cookie pair and CSRF token on success.
async function signIn(s, name, password, secret, { code } = {}) {
  const totp = require("../lib/totp");
  const res = await form(s.base, "/admin/login", { lt: await loginToken(s), name, password, code: code ?? totp.totp(totp.base32Decode(secret), s.clock.t) });
  const set = res.headers.get("set-cookie");
  const out = { res, status: res.status, setCookie: set, cookie: null, csrf: null, token: null };
  if (res.status === 303 && set) {
    out.cookie = set.split(";")[0];
    out.token = out.cookie.split("=")[1];
    out.csrf = s.auth.csrfFor(out.token);
  }
  return out;
}

// One admin, signed in. The clock moves one TOTP step first so codes are never reused between sign-ins.
async function admin(s, name = "alice", password = "correct horse battery staple") {
  const made = await s.auth.createAdmin(name, password);
  s.clock.t += 30_000;
  const session = await signIn(s, name, password, made.secret);
  if (!session.cookie) throw new Error(`test sign-in failed with ${session.status}`);
  return { ...session, name, password, secret: made.secret, id: s.auth.getAdmin(name).id };
}

// ---------------------------------------------------------------- Live helpers
const REALM = "Thunder Hold";
const MANY_LIVE = { limits: { perIp: { limit: 100000, windowMs: 60_000 }, guildCreatePerInstall: { limit: 1000, windowMs: DAY }, codeMissPerIp: { limit: 100000, windowMs: DAY } } };
function who(name, realm = REALM) { return { name, realm }; }
function call(base, method, p, body, headers = {}) {
  return fetch(base + p, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
async function answer(res) { const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = text; } return { status: res.status, body, headers: res.headers }; }

// Links a guild through the real API. -> { guildId, linkCode, installId, token, H (the member header), name }
async function makeGuild(s, { guildName = "Night Watch", realm = REALM, faction = "horde", leader = "Abel", rankIndex = 0 } = {}) {
  const installId = uuid();
  const r = await answer(await post(s.base, "/v1/guilds", { schema: 1, installId, realm, faction, guildName, character: who(leader, realm), rankIndex }));
  if (r.status !== 201) throw new Error(`guild not made: ${r.status} ${JSON.stringify(r.body)}`);
  return { guildId: r.body.guildId, linkCode: r.body.linkCode, installId, token: r.body.member, H: { "X-BF-Member": r.body.member }, name: leader, realm };
}
async function joinGuild(s, g, name, rankIndex = 5, installId = uuid()) {
  const r = await answer(await post(s.base, "/v1/guilds/join", { schema: 1, installId, linkCode: g.linkCode, character: who(name, g.realm), rankIndex, consent: true }));
  if (r.status !== 201) throw new Error(`not joined: ${r.status} ${JSON.stringify(r.body)}`);
  return { installId, token: r.body.member, role: r.body.role, H: { "X-BF-Member": r.body.member }, name };
}
function eventBody(id, creator, over = {}) {
  return { id, version: 1, creator: who(creator), editor: who(creator), at: "2026-11-27T19:00:00Z", place: "mc", title: "Molten Core", note: "Bring fire resist", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false, ...over };
}
function signupBody(name, answerValue = "tank", version = 1, via = "desktop") { return { who: who(name), answer: answerValue, version, via }; }
function listingBody(installId, id, over = {}, listing = {}) {
  return { schema: 1, installId, realm: REALM, faction: "horde", consent: true, ...over,
    listing: { id, kind: "lfg", who: who("Abel"), level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "Any wing", need: null, at: "2026-11-24T12:00:00Z", ...listing } };
}
async function liveSession(s, installId, subs) {
  const r = await answer(await post(s.base, "/v1/live/session", { schema: 1, installId, subs }));
  if (r.status !== 200) throw new Error(`no session: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.stream;
}

// A real HTTP client on the event stream. -> { status, headers, events:[{id,event,data}], comments:[..], closed, until(pred), close() }
function openStream(base, token) {
  const http = require("node:http");
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/v1/live/stream?s=${encodeURIComponent(token)}`, (res) => {
      const st = { req, res, status: res.statusCode, headers: res.headers, events: [], comments: [], closed: false, text: "" };
      let buf = "", waiters = [];
      const wake = () => { waiters = waiters.filter((w) => { if (!w.pred(st)) return true; clearTimeout(w.timer); w.resolve(st); return false; }); };
      res.setEncoding("utf8");
      res.on("data", (c) => {
        st.text += c; buf += c;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(":")) { st.comments.push(block.slice(1).trim()); continue; }
          const e = {};
          for (const line of block.split("\n")) { const k = line.indexOf(": "); if (k > 0) e[line.slice(0, k)] = line.slice(k + 2); }
          if (e.event) st.events.push({ id: Number(e.id), event: e.event, data: JSON.parse(e.data) });
        }
        wake();
      });
      const end = () => { st.closed = true; wake(); };
      res.on("end", end); res.on("close", end); res.on("error", end);
      st.until = (pred, ms = 3000) => new Promise((ok, fail) => {
        if (pred(st)) return ok(st);
        const w = { pred, resolve: ok, timer: setTimeout(() => { waiters = waiters.filter(x => x !== w); fail(new Error(`stream wait timed out; got ${JSON.stringify(st.events)} ${JSON.stringify(st.comments)}`)); }, ms) };
        waiters.push(w);
      });
      st.close = () => { req.destroy(); };
      resolve(st);
    });
    req.on("error", reject);
  });
}
// Gives the server a moment to act on something a client did (a closed socket, a queued write).
function settle(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { SALT, T0, DAY, uuid, tempDb, asSchema3, LIVE_TABLES, submit, testConfig, heartbeat, ticket, errorReport, boot, post, form, get, loginToken, signIn, admin,
  REALM, MANY_LIVE, who, call, answer, makeGuild, joinGuild, eventBody, signupBody, listingBody, liveSession, openStream, settle };

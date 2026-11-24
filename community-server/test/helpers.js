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
async function boot(configOverrides = {}, { notifier, startAt = T0 } = {}) {
  const { Store } = require("../lib/store");
  const { createApp } = require("../lib/app");
  const db = tempDb();
  const store = new Store(db.file);
  const logs = [], clock = { t: startAt };
  const app = createApp({ store, config: testConfig(configOverrides), log: (l) => logs.push(l), now: () => clock.t, notifier });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    base, store, logs, clock, db, auth: app.auth, app,
    async close() { await new Promise((r) => app.server.close(r)); store.close(); db.cleanup(); },
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

module.exports = { SALT, T0, DAY, uuid, tempDb, submit, testConfig, heartbeat, ticket, errorReport, boot, post, form, get, loginToken, signIn, admin };

"use strict";
// Admin accounts, sign-in and sessions.
//  - Passwords: scrypt with a per-user salt; parameters are stored with the hash.
//  - Second factor: TOTP, per account. An account is made with one unless the
//    owner asks for a password-only account; one can be added or removed
//    later. The secret is encrypted at rest with a key derived from the
//    service salt, so a copy of the database alone cannot produce codes.
//    Nothing a sign-in attempt can see before the password is verified
//    differs between the two kinds of account: one form, one scrypt, one code
//    check (against a throwaway key when there is no authenticator), one
//    answer, one lock-out rule.
//  - Lock-out: per account and for the whole service, kept in the database so
//    a restart does not clear it. Each further lock of the same name within a
//    day lasts twice as long as the one before (15 minutes up to 24 hours).
//  - Sessions: 32 random bytes in the cookie, only a SHA-256 in the database.
//    The CSRF token is an HMAC keyed by the cookie value, so it is bound to
//    the session and cannot be rebuilt from the database either.
const crypto = require("node:crypto");
const totp = require("./totp");
const { iso } = require("./desk");

const NAME = /^[a-z][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 14, MAX_PASSWORD = 256;
const DEFAULTS = Object.freeze({
  scryptN: 1 << 17, scryptR: 8, scryptP: 1,
  sessionAbsoluteMs: 12 * 3600_000, sessionIdleMs: 3600_000,
  maxFails: 5, globalMaxFails: 100, failWindowMs: 15 * 60_000, lockMs: 15 * 60_000,
  maxLockMs: 24 * 3600_000, strikeWindowMs: 24 * 3600_000, pendingMs: 30 * 60_000,
});

function sha256hex(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

function scrypt(password, salt, N, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

class Auth {
  constructor({ store, salt, now = () => Date.now(), options = {} }) {
    this.store = store; this.db = store.db; this.desk = store.desk; this.now = now;
    this.o = { ...DEFAULTS, ...options };
    this.totpKey = Buffer.from(crypto.hkdfSync("sha256", salt, "bf-desk", "admin-totp-secret", 32));
    this.queue = Promise.resolve(); // one scrypt at a time: bounded memory
    this.dummy = null;
    this.decoyKey = crypto.randomBytes(20); // stands in for a secret when an account has no authenticator
  }

  // ------------------------------------------------------------- passwords
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async hashPassword(password) {
    const { scryptN: N, scryptR: r, scryptP: p } = this.o;
    const salt = crypto.randomBytes(16);
    const key = await this.serial(() => scrypt(password, salt, N, r, p));
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  }

  async verifyPassword(password, stored) {
    const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(String(stored));
    if (!m) return false;
    const N = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
    if (N > (1 << 20) || r > 16 || p > 4 || (N & (N - 1)) !== 0) return false;
    const want = Buffer.from(m[5], "base64url");
    const key = await this.serial(() => scrypt(String(password).slice(0, MAX_PASSWORD), Buffer.from(m[4], "base64url"), N, r, p));
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  }

  checkPassword(password) {
    if (typeof password !== "string" || [...password].length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    if (password.length > MAX_PASSWORD) throw new Error(`password must be at most ${MAX_PASSWORD} characters`);
    if (/^(.)\1*$/.test(password)) throw new Error("password must not be one repeated character");
    return password;
  }

  // ------------------------------------------------------------------ TOTP
  sealSecret(base32) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.totpKey, iv);
    const body = Buffer.concat([c.update(base32, "utf8"), c.final()]);
    return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
  }

  openSecret(sealed) {
    try {
      const [v, iv, body, tag] = String(sealed).split(".");
      if (v !== "v1") return null;
      const d = crypto.createDecipheriv("aes-256-gcm", this.totpKey, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
    } catch { return null; }
  }

  // -------------------------------------------------------------- accounts
  normalizeName(name) {
    const n = String(name ?? "").trim().toLowerCase();
    if (!NAME.test(n)) throw new Error("admin name must be 3 to 32 characters: a letter, then letters, digits, dot, dash or underscore");
    return n;
  }

  getAdmin(name) { return this.db.prepare("SELECT * FROM admins WHERE name = ?").get(String(name).toLowerCase()); }
  listAdmins() {
    return this.db.prepare(`SELECT a.id, a.name, a.disabled, a.created_at, a.last_login_at, a.totp_secret <> '' AS authenticator,
      (SELECT COUNT(*) FROM sessions s WHERE s.admin = a.id) AS sessions FROM admins a ORDER BY a.name`).all();
  }

  // With { authenticator: false } the account signs in with its password only
  // (totp_secret is the empty string). The default is password + authenticator.
  async createAdmin(name, password, { authenticator = true } = {}) {
    const n = this.normalizeName(name);
    this.checkPassword(password);
    if (this.getAdmin(n)) throw new Error("an admin with that name already exists");
    const hash = await this.hashPassword(password);
    const secret = authenticator ? totp.newSecret() : null;
    this.db.prepare("INSERT INTO admins(name, pw_hash, totp_secret, created_at) VALUES (?, ?, ?, ?)").run(n, hash, secret ? this.sealSecret(secret) : "", iso(this.now()));
    return { name: n, secret, uri: secret ? totp.otpauthUri(n, secret) : null };
  }

  getAdminById(id) { return this.db.prepare("SELECT * FROM admins WHERE id = ?").get(id); }
  hasAuthenticator(id) { const a = this.getAdminById(id); return !!a && a.totp_secret !== ""; }

  // Command line: take the authenticator off an account. Its sessions end.
  removeAuthenticator(name) {
    const a = this.getAdmin(name);
    if (!a) throw new Error("no such admin");
    this.db.prepare("UPDATE admins SET totp_secret = '', totp_last_step = 0 WHERE id = ?").run(a.id);
    this.clearPending(a.id);
    this.dropSessions(a.id);
    return a.name;
  }

  // ------------------------------------------------------------ my account
  // The admin's own changes, made from a signed-in session. Each one that
  // needs the current password counts a wrong one like a failed sign-in.
  async checkCurrent(admin, password) {
    const now = this.now(), scope = this.scope(admin.name);
    if (this.locked(scope, now)) return "locked";
    const row = this.getAdminById(admin.id);
    if (row && await this.verifyPassword(String(password ?? ""), row.pw_hash)) return "ok";
    const lockedNow = this.recordFail(scope, this.o.maxFails, now);
    this.desk.audit(admin, lockedNow ? "account_locked" : "account_password_wrong", admin.name, "", now);
    if (lockedNow) this.dropSessions(admin.id); // someone is guessing inside a session: end it
    return lockedNow ? "locked" : "wrong";
  }

  // Returns "ok", "wrong", "locked" or "weak:<reason>". Every other session of this admin ends.
  async changePassword(admin, current, next, keepIdHash) {
    try { this.checkPassword(next); } catch (e) { return `weak:${e.message}`; }
    const r = await this.checkCurrent(admin, current);
    if (r !== "ok") return r;
    if (String(next) === String(current)) return "weak:the new password must differ from the current one";
    this.db.prepare("UPDATE admins SET pw_hash = ? WHERE id = ?").run(await this.hashPassword(next), admin.id);
    this.db.prepare("DELETE FROM sessions WHERE admin = ? AND id_hash <> ?").run(admin.id, keepIdHash);
    this.desk.audit(admin, "account_password_change", admin.name, "", this.now());
    return "ok";
  }

  pendingKey(id) { return `totp_pending:${id}`; }
  clearPending(id) { this.db.prepare("DELETE FROM meta WHERE k = ?").run(this.pendingKey(id)); }

  // A new secret waits here until the admin proves the app shows the right code.
  beginAuthenticator(admin) {
    const secret = totp.newSecret();
    this.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run(this.pendingKey(admin.id), JSON.stringify({ s: this.sealSecret(secret), t: this.now() }));
    this.desk.audit(admin, "account_authenticator_start", admin.name, "", this.now());
    return { secret, uri: totp.otpauthUri(admin.name, secret) };
  }

  pendingAuthenticator(admin) {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(this.pendingKey(admin.id));
    if (!row) return null;
    let p; try { p = JSON.parse(row.v); } catch { p = null; }
    const secret = p && this.now() - p.t < this.o.pendingMs ? this.openSecret(p.s) : null;
    if (!secret) { this.clearPending(admin.id); return null; }
    return { secret, uri: totp.otpauthUri(admin.name, secret) };
  }

  // Takes effect only with a correct code. From then on sign-in needs it; other sessions end.
  confirmAuthenticator(admin, code, keepIdHash) {
    const p = this.pendingAuthenticator(admin);
    if (!p) return "expired";
    const step = totp.verifyTotp(totp.base32Decode(p.secret), code, this.now(), 0);
    if (step === null) return "wrong";
    this.db.prepare("UPDATE admins SET totp_secret = ?, totp_last_step = ? WHERE id = ?").run(this.sealSecret(p.secret), step, admin.id);
    this.clearPending(admin.id);
    this.db.prepare("DELETE FROM sessions WHERE admin = ? AND id_hash <> ?").run(admin.id, keepIdHash);
    this.desk.audit(admin, "account_authenticator_add", admin.name, "", this.now());
    return "ok";
  }

  // Returns "ok", "wrong" or "locked". Needs the current password.
  async dropAuthenticator(admin, current, keepIdHash) {
    const r = await this.checkCurrent(admin, current);
    if (r !== "ok") return r;
    this.db.prepare("UPDATE admins SET totp_secret = '', totp_last_step = 0 WHERE id = ?").run(admin.id);
    this.clearPending(admin.id);
    this.db.prepare("DELETE FROM sessions WHERE admin = ? AND id_hash <> ?").run(admin.id, keepIdHash);
    this.desk.audit(admin, "account_authenticator_remove", admin.name, "", this.now());
    return "ok";
  }

  async setPassword(name, password) {
    this.checkPassword(password);
    const a = this.getAdmin(name);
    if (!a) throw new Error("no such admin");
    this.db.prepare("UPDATE admins SET pw_hash = ? WHERE id = ?").run(await this.hashPassword(password), a.id);
    this.dropSessions(a.id);
    return a.name;
  }

  resetTotp(name) {
    const a = this.getAdmin(name);
    if (!a) throw new Error("no such admin");
    const secret = totp.newSecret();
    this.db.prepare("UPDATE admins SET totp_secret = ?, totp_last_step = 0 WHERE id = ?").run(this.sealSecret(secret), a.id);
    this.dropSessions(a.id);
    return { name: a.name, secret, uri: totp.otpauthUri(a.name, secret) };
  }

  setDisabled(idOrName, disabled) {
    const a = typeof idOrName === "number" ? this.db.prepare("SELECT * FROM admins WHERE id = ?").get(idOrName) : this.getAdmin(idOrName);
    if (!a) return null;
    this.db.prepare("UPDATE admins SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, a.id);
    if (disabled) this.dropSessions(a.id);
    return a.name;
  }

  unlock(name) {
    return Number(this.db.prepare("DELETE FROM login_attempts WHERE scope IN (?, ?, 'global')").run(this.scope(name), `strikes:${this.scope(name)}`).changes);
  }

  dropSessions(adminId) { this.db.prepare("DELETE FROM sessions WHERE admin = ?").run(adminId); }

  // -------------------------------------------------------------- lock-out
  scope(name) { return `acct:${sha256hex(String(name).trim().toLowerCase()).slice(0, 32)}`; }

  locked(scope, now) {
    const r = this.db.prepare("SELECT locked_until_ms FROM login_attempts WHERE scope = ?").get(scope);
    return !!r && r.locked_until_ms > now;
  }

  recordFail(scope, max, now) {
    const r = this.db.prepare("SELECT fails, window_ms FROM login_attempts WHERE scope = ?").get(scope);
    let fails = 1, windowMs = now, lockedUntil = 0;
    if (r && now - r.window_ms < this.o.failWindowMs) { fails = r.fails + 1; windowMs = r.window_ms; }
    if (fails >= max) {
      // A name that keeps getting locked is locked for longer each time: 15 min, 30 min, 1 h ... 24 h.
      // The same rule for every name, known or not, with or without an authenticator.
      // The count of earlier locks is forgotten after a quiet day (counted from the end of the last lock).
      let strikes = 0;
      const s = scope === "global" ? null : this.db.prepare("SELECT fails, window_ms FROM login_attempts WHERE scope = ?").get(`strikes:${scope}`);
      if (s && now - s.window_ms < this.o.strikeWindowMs) strikes = s.fails;
      lockedUntil = now + Math.min(this.o.maxLockMs, this.o.lockMs * 2 ** Math.min(strikes, 12));
      if (scope !== "global") {
        this.db.prepare(`INSERT INTO login_attempts(scope, fails, window_ms, locked_until_ms) VALUES (?, ?, ?, 0)
          ON CONFLICT(scope) DO UPDATE SET fails = excluded.fails, window_ms = excluded.window_ms`).run(`strikes:${scope}`, strikes + 1, lockedUntil);
      }
      fails = 0; windowMs = now;
    }
    this.db.prepare(`INSERT INTO login_attempts(scope, fails, window_ms, locked_until_ms) VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET fails = excluded.fails, window_ms = excluded.window_ms, locked_until_ms = excluded.locked_until_ms`)
      .run(scope, fails, windowMs, lockedUntil);
    return lockedUntil > 0;
  }

  // ---------------------------------------------------------------- sign-in
  // Returns { ok: true, token, admin } or { ok: false, reason: "failed" | "locked" }.
  // Unknown name, wrong password, wrong code, replayed code and disabled
  // account are all "failed" and all cost one scrypt and one code check.
  // An account without an authenticator needs no code; one that is sent is ignored.
  async login({ name, password, code }) {
    const now = this.now();
    const who = String(name ?? "").trim().toLowerCase().slice(0, 64);
    const scope = this.scope(who);
    if (this.locked("global", now) || this.locked(scope, now)) return { ok: false, reason: "locked" };
    const admin = NAME.test(who) ? this.getAdmin(who) : undefined;
    if (!this.dummy) this.dummy = await this.hashPassword(crypto.randomBytes(24).toString("base64url"));
    const pwOk = await this.verifyPassword(String(password ?? ""), admin ? admin.pw_hash : this.dummy);
    // Re-read the account: another sign-in may have used this code, or the account may have changed, while scrypt ran.
    const fresh = admin ? this.db.prepare("SELECT totp_secret, totp_last_step, disabled FROM admins WHERE id = ?").get(admin.id) : null;
    const passwordOnly = !!fresh && fresh.totp_secret === "";
    const secret = fresh && !passwordOnly ? this.openSecret(fresh.totp_secret) : null;
    // Always exactly one code check, against the real secret or a throwaway key.
    const found = totp.verifyTotp(secret ? totp.base32Decode(secret) : this.decoyKey, code, this.now(), secret ? fresh.totp_last_step : 0);
    const step = secret ? found : null;
    const codeOk = !!fresh && !fresh.disabled && (passwordOnly || step !== null);
    if (!admin || !pwOk || !codeOk) {
      const lockedNow = this.recordFail(scope, this.o.maxFails, now);
      this.recordFail("global", this.o.globalMaxFails, now);
      this.desk.audit(null, lockedNow ? "login_locked" : "login_failed", admin ? admin.name : "(unknown name)", "", now);
      return { ok: false, reason: "failed" };
    }
    this.db.prepare("UPDATE admins SET totp_last_step = ?, last_login_at = ? WHERE id = ?").run(step ?? 0, iso(now), admin.id);
    this.db.prepare("DELETE FROM login_attempts WHERE scope IN (?, ?)").run(scope, `strikes:${scope}`);
    const token = crypto.randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO sessions(id_hash, admin, created_ms, seen_ms) VALUES (?, ?, ?, ?)").run(sha256hex(token), admin.id, now, now);
    this.desk.audit(admin, "login", "", passwordOnly ? "password only" : "", now);
    return { ok: true, token, admin: { id: admin.id, name: admin.name, authenticator: !passwordOnly } };
  }

  // --------------------------------------------------------------- sessions
  session(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const now = this.now(), idHash = sha256hex(token);
    const r = this.db.prepare(`SELECT s.created_ms, s.seen_ms, a.id, a.name, a.disabled, a.totp_secret <> '' AS authenticator FROM sessions s JOIN admins a ON a.id = s.admin WHERE s.id_hash = ?`).get(idHash);
    if (!r) return null;
    if (r.disabled || now - r.created_ms >= this.o.sessionAbsoluteMs || now - r.seen_ms >= this.o.sessionIdleMs) {
      this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
      return null;
    }
    if (now - r.seen_ms >= 30_000) this.db.prepare("UPDATE sessions SET seen_ms = ? WHERE id_hash = ?").run(now, idHash);
    return { admin: { id: r.id, name: r.name, authenticator: !!r.authenticator }, csrf: this.csrfFor(token), idHash };
  }

  logout(token) {
    if (typeof token === "string") this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256hex(token));
  }

  csrfFor(token) { return crypto.createHmac("sha256", token).update("bf-admin-csrf").digest("base64url"); }

  csrfOk(session, given) {
    const a = Buffer.from(session.csrf), b = Buffer.from(typeof given === "string" ? given : "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  prune(now = this.now()) {
    const sessions = Number(this.db.prepare("DELETE FROM sessions WHERE created_ms <= ? OR seen_ms <= ?")
      .run(now - this.o.sessionAbsoluteMs, now - this.o.sessionIdleMs).changes);
    const attempts = Number(this.db.prepare(`DELETE FROM login_attempts WHERE
        (scope NOT LIKE 'strikes:%' AND locked_until_ms <= ? AND window_ms <= ?) OR (scope LIKE 'strikes:%' AND window_ms <= ?)`)
      .run(now, now - this.o.failWindowMs, now - this.o.strikeWindowMs).changes);
    for (const row of this.db.prepare("SELECT k, v FROM meta WHERE k LIKE 'totp_pending:%'").all()) {
      let t = 0; try { t = Number(JSON.parse(row.v).t) || 0; } catch { t = 0; }
      if (now - t >= this.o.pendingMs) this.db.prepare("DELETE FROM meta WHERE k = ?").run(row.k);
    }
    return { sessions, attempts };
  }
}

module.exports = { Auth, NAME, MIN_PASSWORD, DEFAULTS };

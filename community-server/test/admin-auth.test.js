"use strict";
// Admin sign-in, sessions, lock-out and CSRF, through the real HTTP server with a controlled clock.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const totp = require("../lib/totp");
const { Auth } = require("../lib/auth");
const { Store } = require("../lib/store");
const { boot, form, get, signIn, admin, loginToken, T0 } = require("./helpers");

const PW = "correct horse battery staple";
const code = (secret, t) => totp.totp(totp.base32Decode(secret), t);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("TOTP matches the RFC 6238 test vectors and base32 round-trips", () => {
  const secret = Buffer.from("12345678901234567890");
  const eight = (t) => { // the RFC lists 8-digit codes; ours are the last 6 digits of the same value
    const full = totp.hotp(secret, Math.floor(t / 30));
    return full;
  };
  assert.equal(eight(59), "287082");
  assert.equal(eight(1111111109), "081804");
  assert.equal(eight(1111111111), "050471");
  assert.equal(eight(1234567890), "005924");
  assert.equal(eight(2000000000), "279037");
  assert.equal(eight(20000000000), "353130");
  assert.equal(totp.base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(totp.base32Decode("MZXW6YTBOI").toString(), "foobar");
  assert.equal(totp.base32Decode("mzxw 6ytb oi==").toString(), "foobar");
  const s = totp.newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.equal(totp.base32Encode(totp.base32Decode(s)), s);
  assert.match(totp.otpauthUri("alice", s), /^otpauth:\/\/totp\/Backstage%20Desk:alice\?secret=[A-Z2-7]{32}&issuer=Backstage%20Desk&algorithm=SHA1&digits=6&period=30$/);

  // One step either side is accepted; two steps away is not; a used step and anything before it is refused.
  const key = totp.base32Decode(s), now = T0, step = Math.floor(now / 30000);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now), now), step);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now - 30000), now), step - 1);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now + 30000), now), step + 1);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now - 60000), now), null);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now + 60000), now), null);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now), now, step), null);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now - 30000), now, step), null);
  assert.equal(totp.verifyTotp(key, totp.totp(key, now + 30000), now, step), step + 1);
  for (const junk of ["", "12345", "1234567", "abcdef", null, undefined, 123456.5, " 123456"]) assert.equal(totp.verifyTotp(key, junk, now), null);
});

test("accounts: strong scrypt by default, long passwords only, secrets never stored in the clear", async (t) => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const real = new Auth({ store, salt: "s".repeat(40) });
  assert.deepEqual([real.o.scryptN, real.o.scryptR, real.o.scryptP], [131072, 8, 1]);
  const hash = await real.hashPassword(PW);
  assert.match(hash, /^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.equal(await real.verifyPassword(PW, hash), true);
  assert.equal(await real.verifyPassword(`${PW}!`, hash), false);
  assert.notEqual(await real.hashPassword(PW), hash); // a new salt every time
  assert.equal(await real.verifyPassword(PW, "scrypt$4294967296$8$1$AAAA$AAAA"), false); // absurd cost is refused, not run
  assert.equal(await real.verifyPassword(PW, "plain:hunter2"), false);

  const auth = new Auth({ store, salt: "s".repeat(40), options: { scryptN: 1024 } });
  await assert.rejects(auth.createAdmin("alice", "13 chars long"), /at least 14/);
  await assert.rejects(auth.createAdmin("alice", "aaaaaaaaaaaaaaaaaaaa"), /repeated/);
  await assert.rejects(auth.createAdmin("alice", "x".repeat(300)), /at most/);
  for (const name of ["", "al", "1alice", "alice smith", "alice<script>", "a".repeat(33), "../etc"]) await assert.rejects(auth.createAdmin(name, PW), /admin name/);
  const made = await auth.createAdmin("Alice", PW);
  assert.equal(made.name, "alice");
  await assert.rejects(auth.createAdmin("ALICE", PW), /already exists/);
  assert.match(made.uri, /^otpauth:\/\/totp\//);

  const row = store.db.prepare("SELECT * FROM admins").get();
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes(PW));
  assert.ok(!dump.includes(made.secret), "the TOTP secret is encrypted at rest");
  assert.match(row.totp_secret, /^v1\./);
  assert.equal(auth.openSecret(row.totp_secret), made.secret);
  // A different service salt cannot open it.
  assert.equal(new Auth({ store, salt: "t".repeat(40) }).openSecret(row.totp_secret), null);

  const reset = auth.resetTotp("alice");
  assert.notEqual(reset.secret, made.secret);
  assert.throws(() => auth.resetTotp("nobody"), /no such admin/);
});

test("sign-in: wrong password, wrong code and unknown name all fail the same way; a good one sets a locked-down cookie", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const made = await s.auth.createAdmin("alice", PW);

  const page = await get(s.base, "/admin/login");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form method="post" action="\/admin\/login"/);

  const failures = [
    await signIn(s, "alice", "wrong password 123", made.secret),
    await signIn(s, "alice", PW, made.secret, { code: "000000" }),
    await signIn(s, "alice", PW, made.secret, { code: code(made.secret, s.clock.t - 120_000) }), // an old code
    await signIn(s, "nobody", PW, made.secret),
    await signIn(s, "alice", "", made.secret),
  ];
  const bodies = [];
  for (const f of failures) {
    assert.equal(f.status, 401);
    assert.equal(f.setCookie, null);
    bodies.push((await f.res.text()).replace(/name="lt" value="[^"]+"/, ""));
  }
  assert.equal(new Set(bodies).size, 1, "every failure shows the same page");
  assert.match(bodies[0], /Sign-in failed/);
  s.auth.unlock("alice");

  s.clock.t += 30_000;
  const ok = await signIn(s, "alice", PW, made.secret);
  assert.equal(ok.status, 303);
  assert.equal(ok.res.headers.get("location"), "/admin/");
  const parts = ok.setCookie.split(";").map(x => x.trim());
  assert.match(parts[0], /^__Host-bfadmin=[A-Za-z0-9_-]{43}$/);
  for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=43200"]) assert.ok(parts.includes(flag), `cookie flag ${flag}`);
  assert.ok(!/Domain=/i.test(ok.setCookie), "__Host- cookies carry no Domain");

  // Only a hash of the session id is stored.
  const sessions = s.store.db.prepare("SELECT * FROM sessions").all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id_hash, sha(ok.token));
  assert.ok(!JSON.stringify(sessions).includes(ok.token));

  const home = await get(s.base, "/admin/", { cookie: ok.cookie });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<h1>Dashboard<\/h1>/);
  assert.equal((await get(s.base, "/admin/login", { cookie: ok.cookie })).status, 303); // already signed in

  // The public API never sets or reads cookies.
  const health = await fetch(`${s.base}/v1/health`, { headers: { Cookie: ok.cookie } });
  assert.equal(health.headers.get("set-cookie"), null);
});

test("sign-in: the same code cannot be used twice", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const made = await s.auth.createAdmin("alice", PW);
  const c = code(made.secret, s.clock.t);
  assert.equal((await signIn(s, "alice", PW, made.secret, { code: c })).status, 303);
  const replay = await signIn(s, "alice", PW, made.secret, { code: c });
  assert.equal(replay.status, 401);
  assert.equal(replay.setCookie, null);
  // Nor an earlier code that is still inside the +/- 1 step window.
  assert.equal((await signIn(s, "alice", PW, made.secret, { code: code(made.secret, s.clock.t - 30_000) })).status, 401);
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 303);
});

test("sign-in: the session id is new at every sign-in and the old one stops working", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const made = await s.auth.createAdmin("alice", PW);
  const one = await signIn(s, "alice", PW, made.secret);
  s.clock.t += 30_000;
  // Signing in again while presenting the first cookie (as a browser would).
  const res = await form(s.base, "/admin/login", { lt: await loginToken(s), name: "alice", password: PW, code: code(made.secret, s.clock.t) }, { cookie: one.cookie });
  assert.equal(res.status, 303);
  const two = res.headers.get("set-cookie").split(";")[0];
  assert.notEqual(two, one.cookie);
  assert.equal((await get(s.base, "/admin/", { cookie: one.cookie })).status, 303);
  assert.equal((await get(s.base, "/admin/", { cookie: two })).status, 200);
  // A session id an attacker planted before sign-in is never adopted.
  s.clock.t += 30_000;
  const planted = `__Host-bfadmin=${"A".repeat(43)}`;
  const res3 = await form(s.base, "/admin/login", { lt: await loginToken(s), name: "alice", password: PW, code: code(made.secret, s.clock.t) }, { cookie: planted });
  assert.notEqual(res3.headers.get("set-cookie").split(";")[0], planted);
  assert.equal((await get(s.base, "/admin/", { cookie: planted })).status, 303);
});

test("lock-out: five failures lock the account, also for the right password, until the lock runs out", async (t) => {
  const s = await boot({ limits: { loginPerIp: { limit: 1000, windowMs: 60_000 } } }); t.after(() => s.close());
  const made = await s.auth.createAdmin("alice", PW);
  const bob = await s.auth.createAdmin("bob", PW);
  for (let i = 0; i < 5; i++) assert.equal((await signIn(s, "alice", "wrong password 123", made.secret)).status, 401);
  s.clock.t += 30_000;
  const locked = await signIn(s, "alice", PW, made.secret);
  assert.equal(locked.status, 429);
  assert.equal(locked.setCookie, null);
  assert.match(await locked.res.text(), /Sign-in is locked for a while/);
  // Another account is not affected; an unknown name locks the same way (so a lock reveals nothing).
  assert.equal((await signIn(s, "bob", PW, bob.secret)).status, 303);
  for (let i = 0; i < 5; i++) await signIn(s, "ghost", PW, made.secret);
  assert.equal((await signIn(s, "ghost", PW, made.secret)).status, 429);

  s.clock.t += 14 * 60_000;
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 429);
  s.clock.t += 61_000;
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 303);

  // Failures spread out over more than the window never add up to a lock.
  for (let i = 0; i < 8; i++) { s.clock.t += 4 * 60_000; assert.equal((await signIn(s, "bob", "wrong password 123", bob.secret)).status, 401); }
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "bob", PW, bob.secret)).status, 303);

  // A wrong code counts like a wrong password (the code cannot be guessed by trying).
  for (let i = 0; i < 5; i++) await signIn(s, "alice", PW, made.secret, { code: "000000" });
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 429);
  // The lock is kept in the database, so a restart does not clear it.
  assert.ok(s.store.db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE locked_until_ms > ?").get(s.clock.t).c >= 1);
  const audit = s.store.db.prepare("SELECT action, target FROM audit").all().map(a => `${a.action}:${a.target}`);
  assert.ok(audit.includes("login_failed:alice") && audit.includes("login_locked:alice") && audit.includes("login:alice") === false);
  assert.ok(audit.includes("login_failed:(unknown name)")); // a mistyped name (often a password) is not written down
  assert.ok(!JSON.stringify(audit).includes("ghost"));
});

test("lock-out: the whole service locks after too many failures, and sign-in is limited per network", async (t) => {
  const s = await boot({ auth: { globalMaxFails: 6 }, limits: { loginPerIp: { limit: 1000, windowMs: 60_000 } } }); t.after(() => s.close());
  const made = await s.auth.createAdmin("alice", PW);
  for (let i = 0; i < 6; i++) await signIn(s, `user${i}`, "wrong password 123", made.secret);
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 429);
  s.clock.t += 15 * 60_000 + 1000;
  assert.equal((await signIn(s, "alice", PW, made.secret)).status, 303);

  const s2 = await boot({ limits: { loginPerIp: { limit: 3, windowMs: 15 * 60_000 } } }); t.after(() => s2.close());
  const m2 = await s2.auth.createAdmin("alice", PW);
  for (let i = 0; i < 3; i++) assert.equal((await signIn(s2, "nobody", "wrong password 123", m2.secret)).status, 401);
  const limited = await signIn(s2, "alice", PW, m2.secret);
  assert.equal(limited.status, 429);
  assert.match(await limited.res.text(), /Too many sign-in attempts from this network/);
});

test("sessions end after 1 hour idle and after 12 hours whatever happens", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await admin(s);
  const ok = async () => (await get(s.base, "/admin/tickets", { cookie: a.cookie })).status;
  assert.equal(await ok(), 200);
  s.clock.t += 59 * 60_000;
  assert.equal(await ok(), 200); // 59 minutes idle: still good, and this request counts as activity
  s.clock.t += 59 * 60_000;
  assert.equal(await ok(), 200);
  s.clock.t += 60 * 60_000;
  const idle = await get(s.base, "/admin/tickets", { cookie: a.cookie });
  assert.equal(idle.status, 303); // exactly 60 minutes idle: gone
  assert.equal(idle.headers.get("location"), "/admin/login");
  assert.match(idle.headers.get("set-cookie"), /^__Host-bfadmin=; Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=Strict$/);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c, 0);

  // Absolute limit: active every 30 minutes for 12 hours.
  s.clock.t += 30_000;
  const b = await signIn(s, a.name, a.password, a.secret);
  const started = s.clock.t;
  for (let i = 0; i < 23; i++) { s.clock.t += 30 * 60_000; assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 200, `after ${i + 1} half hours`); }
  s.clock.t = started + 12 * 3600_000 - 1000;
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 200);
  s.clock.t = started + 12 * 3600_000;
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 303);
});

const MANY = { limits: { perIp: { limit: 100000, windowMs: 60_000 } } }; // these tests send hundreds of requests

test("no page, form or file under /admin is reachable without a session", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  s.store.desk.createTicket("h".repeat(64), require("./helpers").ticket("x"), s.clock.t);
  const gets = ["/admin/", "/admin/?days=90", "/admin/tickets", "/admin/tickets/BF-1001", "/admin/errors", "/admin/errors/1", "/admin/announcements", "/admin/announcements/new",
    "/admin/replies", "/admin/admins", "/admin/audit", "/admin/data", "/admin/nothing-here", "/admin/tickets/../data"];
  const posts = ["/admin/tickets/bulk", "/admin/tickets/BF-1001/reply", "/admin/tickets/BF-1001/note", "/admin/tickets/BF-1001/update", "/admin/tickets/BF-1001/delete", "/admin/tickets/BF-1001/block",
    "/admin/errors/1/ticket", "/admin/announcements/save", "/admin/announcements/1/expire", "/admin/replies/save", "/admin/replies/1/delete", "/admin/admins/1/disable",
    "/admin/data/export", "/admin/data/purge", "/admin/data/retention", "/admin/logout"];
  for (const cookie of [undefined, `__Host-bfadmin=${"B".repeat(43)}`, "__Host-bfadmin=", `bfadmin=${a.token}`, `__Host-bfadmin=${a.token.slice(0, 42)}`]) {
    for (const p of gets) {
      const r = await get(s.base, p, { cookie });
      assert.equal(r.status, 303, `GET ${p}`);
      assert.equal(r.headers.get("location"), "/admin/login");
      assert.equal(await r.text(), "");
    }
    for (const p of posts) {
      const r = await form(s.base, p, { csrf: a.csrf, text: "x", confirm: "yes", id: "1001", action: "close" }, { cookie });
      assert.equal(r.status, 303, `POST ${p}`);
      assert.equal(r.headers.get("location"), "/admin/login");
    }
  }
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM tickets").get().c, 1, "nothing was changed");
  assert.equal(s.store.db.prepare("SELECT status FROM tickets").get().status, "new");
  assert.equal((await get(s.base, "/admin")).headers.get("location"), "/admin/");
  // The stylesheet and the script are the only public files.
  assert.equal((await get(s.base, "/admin/static/admin.css")).status, 200);
  assert.equal((await get(s.base, "/admin/static/admin.js")).status, 200);
  assert.equal((await get(s.base, "/admin/static/../web.js")).status, 303);
  assert.equal((await get(s.base, "/admin/static/web.js")).status, 404);
});

test("CSRF: every POST needs the token of this very session, and must come from this site", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s);
  const b = await admin(s, "bob");
  s.store.desk.createTicket("h".repeat(64), require("./helpers").ticket("x"), s.clock.t);
  const posts = ["/admin/tickets/bulk", "/admin/tickets/BF-1001/reply", "/admin/tickets/BF-1001/note", "/admin/tickets/BF-1001/update", "/admin/tickets/BF-1001/delete", "/admin/tickets/BF-1001/block",
    "/admin/errors/1/ticket", "/admin/announcements/save", "/admin/announcements/1/expire", "/admin/replies/save", "/admin/replies/1/delete", `/admin/admins/${b.id}/disable`,
    "/admin/data/export", "/admin/data/purge", "/admin/data/retention", "/admin/logout"];
  const body = { text: "hello there", confirm: "yes", id: "1001", action: "close", status: "closed", title: "T", body: "B", install: "0".repeat(64) };
  for (const p of posts) {
    for (const [label, csrf] of [["missing", undefined], ["empty", ""], ["wrong", "x".repeat(43)], ["another session's", b.csrf], ["the cookie itself (double submit)", a.token], ["truncated", a.csrf.slice(0, 20)]]) {
      const r = await form(s.base, p, csrf === undefined ? body : { ...body, csrf }, { cookie: a.cookie });
      assert.equal(r.status, 403, `${p} with ${label} token`);
    }
    // A correct token sent from another site is refused as well.
    for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
      const r = await form(s.base, p, { ...body, csrf: a.csrf }, { cookie: a.cookie, headers });
      assert.equal(r.status, 403, `${p} from ${JSON.stringify(headers)}`);
    }
  }
  // Nothing happened.
  assert.equal(s.store.db.prepare("SELECT status FROM tickets WHERE id = 1001").get().status, "new");
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM messages").get().c, 1);
  assert.equal(s.store.db.prepare("SELECT disabled FROM admins WHERE name = 'bob'").get().disabled, 0);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c, 2);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM audit WHERE action NOT LIKE 'login%'").get().c, 0);

  // With the right token, from this site, it works; the token is in every form on the page.
  const ok = await form(s.base, "/admin/tickets/BF-1001/note", { csrf: a.csrf, text: "a note" }, { cookie: a.cookie, headers: { Origin: "https://desk.test", "Sec-Fetch-Site": "same-origin" } });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/admin/tickets/BF-1001?done=noted");
  const html = await (await get(s.base, "/admin/tickets/BF-1001", { cookie: a.cookie })).text();
  const forms = html.match(/<form [^>]*method="post"[^>]*>[\s\S]*?<\/form>/g);
  assert.ok(forms.length >= 5);
  for (const f of forms) assert.ok(f.includes(`name="csrf" value="${a.csrf}"`), "a POST form without the CSRF token");
  assert.ok(!html.includes(a.token), "the session id never appears in a page");
  // GET never changes anything.
  for (const p of posts) assert.ok([404, 405].includes((await get(s.base, p, { cookie: a.cookie })).status), `GET ${p}`);
  // The sign-in form has its own short-lived token.
  const noToken = await form(s.base, "/admin/login", { name: "alice", password: a.password, code: "123456" });
  assert.equal(noToken.status, 400);
  const lt = await loginToken(s);
  s.clock.t += 3600_000 + 1000;
  assert.equal((await form(s.base, "/admin/login", { lt, name: "alice", password: a.password, code: code(a.secret, s.clock.t) })).status, 400);
  assert.equal((await form(s.base, "/admin/login", { lt: await loginToken(s), name: "alice", password: a.password, code: code(a.secret, s.clock.t) }, { headers: { Origin: "https://evil.example" } })).status, 403);
});

test("a disabled admin is signed out at once and cannot sign in; sign-out ends the session", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await admin(s), b = await admin(s, "bob");
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 200);

  // Alice disables Bob in the admin area.
  const self = await form(s.base, `/admin/admins/${a.id}/disable`, { csrf: a.csrf }, { cookie: a.cookie });
  assert.equal(self.status, 400); // not yourself
  const r = await form(s.base, `/admin/admins/${b.id}/disable`, { csrf: a.csrf }, { cookie: a.cookie });
  assert.equal(r.status, 303);
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 303);
  assert.equal((await form(s.base, "/admin/tickets/bulk", { csrf: b.csrf, action: "close", id: "1" }, { cookie: b.cookie })).status, 303);
  s.clock.t += 30_000;
  const again = await signIn(s, "bob", b.password, b.secret);
  assert.equal(again.status, 401);
  assert.match(await again.res.text(), /Sign-in failed/); // same message as any other failure

  // Even a session row that somehow survived is refused for a disabled admin.
  const tok = crypto.randomBytes(32).toString("base64url");
  s.store.db.prepare("INSERT INTO sessions(id_hash, admin, created_ms, seen_ms) VALUES (?, ?, ?, ?)").run(sha(tok), b.id, s.clock.t, s.clock.t);
  assert.equal((await get(s.base, "/admin/", { cookie: `__Host-bfadmin=${tok}` })).status, 303);
  // Re-enabling is a command-line job; then Bob can sign in again.
  s.auth.setDisabled("bob", false);
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "bob", b.password, b.secret)).status, 303);

  // Sign out.
  const out = await form(s.base, "/admin/logout", { csrf: a.csrf }, { cookie: a.cookie });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/admin/login");
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 303);
  const actions = s.store.db.prepare("SELECT admin_name, action, target FROM audit ORDER BY id").all().map(x => `${x.admin_name} ${x.action} ${x.target}`.trim());
  assert.ok(actions.includes("alice admin_disable bob"));
  assert.ok(actions.includes("alice logout"));
  assert.ok(actions.includes("alice login"));
});

test("a changed password or a new authenticator secret signs the admin out everywhere", async (t) => {
  const s = await boot(); t.after(() => s.close());
  const a = await admin(s);
  await s.auth.setPassword("alice", "a completely new password");
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 303);
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "alice", a.password, a.secret)).status, 401);
  s.auth.unlock("alice");
  s.clock.t += 30_000;
  const b = await signIn(s, "alice", "a completely new password", a.secret);
  assert.equal(b.status, 303);
  const fresh = s.auth.resetTotp("alice");
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 303);
  s.clock.t += 30_000;
  assert.equal((await signIn(s, "alice", "a completely new password", a.secret)).status, 401); // the old secret no longer works
  assert.equal((await signIn(s, "alice", "a completely new password", fresh.secret)).status, 303);
});

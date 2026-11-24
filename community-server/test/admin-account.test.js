"use strict";
// Accounts with and without an authenticator, and the My account page.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const totp = require("../lib/totp");
const { boot, form, get, signIn, admin, loginToken } = require("./helpers");

const PW = "correct horse battery staple";
const MANY = { limits: { perIp: { limit: 100000, windowMs: 60_000 }, loginPerIp: { limit: 100000, windowMs: 60_000 } } };
const code = (secret, t) => totp.totp(totp.base32Decode(secret), t);
const MIN = 60_000;

// Signs in through the real form with exactly these fields.
async function attempt(s, name, password, codeValue) {
  const res = await form(s.base, "/admin/login", { lt: await loginToken(s), name, password, ...(codeValue === undefined ? {} : { code: codeValue }) });
  const set = res.headers.get("set-cookie");
  const cookie = res.status === 303 && set ? set.split(";")[0] : null;
  return { res, status: res.status, cookie, token: cookie ? cookie.split("=")[1] : null, csrf: cookie ? s.auth.csrfFor(cookie.split("=")[1]) : null, body: res.status === 303 ? "" : (await res.text()).replace(/name="lt" value="[^"]+"/, "") };
}
const post = (s, a, path, fields = {}) => form(s.base, path, { csrf: a.csrf, ...fields }, { cookie: a.cookie });
const page = async (s, a, path) => (await get(s.base, path, { cookie: a.cookie })).text();
const audit = (s) => s.store.db.prepare("SELECT admin_name, action, target, detail FROM audit ORDER BY id").all().map(x => `${x.admin_name}|${x.action}|${x.target}|${x.detail}`);

test("a password-only account signs in without a code; a code that is sent anyway is ignored", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const made = await s.auth.createAdmin("pat", PW, { authenticator: false });
  assert.deepEqual(made, { name: "pat", secret: null, uri: null });
  assert.equal(s.store.db.prepare("SELECT totp_secret FROM admins WHERE name = 'pat'").get().totp_secret, "");
  // Still the strict password rules.
  await assert.rejects(s.auth.createAdmin("short", "13 chars long", { authenticator: false }), /at least 14/);
  assert.match(s.store.db.prepare("SELECT pw_hash FROM admins WHERE name = 'pat'").get().pw_hash, /^scrypt\$\d+\$8\$1\$/);

  for (const sent of [undefined, "", "123456", "000000", "not-a-code"]) {
    const a = await attempt(s, "pat", PW, sent);
    assert.equal(a.status, 303, `code ${JSON.stringify(sent)}`);
    assert.match(a.res.headers.get("set-cookie"), /^__Host-bfadmin=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; Secure; HttpOnly; SameSite=Strict$/);
    assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 200);
  }
  assert.equal((await attempt(s, "pat", "wrong password 123", "")).status, 401);
  assert.ok(audit(s).includes("pat|login||password only"));

  // The notice: calm, on the Dashboard and on the Admins page, and only for such an account.
  const a = await attempt(s, "pat", PW);
  const b = await admin(s, "alice");
  assert.match(await page(s, a, "/admin/"), /<p class="plain-note">This account signs in with a password only\. Anyone who learns the password can sign in\. You can add an authenticator under <a href="\/admin\/account">My account<\/a>\.<\/p>/);
  assert.ok(!(await page(s, b, "/admin/")).includes("password only"));
  for (const who of [a, b]) {
    const admins = await page(s, who, "/admin/admins");
    assert.match(admins, /<p class="plain-note"><b>pat<\/b>: this account signs in with a password only\./);
    assert.match(admins, /<th scope="row">pat.*?<span class="chip st-looking">password only<\/span>/s);
    assert.match(admins, /<th scope="row">alice.*?<td>password \+ authenticator<\/td>/s);
  }
  assert.match(await page(s, a, "/admin/account"), /<span class="chip st-looking">password only<\/span>/);
  assert.match(await page(s, b, "/admin/account"), /<span class="chip st-fixed">password \+ authenticator<\/span>/);
});

test("nothing before the password is verified tells the two kinds of account apart", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const withAuth = await s.auth.createAdmin("alice", PW);
  await s.auth.createAdmin("pat", PW, { authenticator: false });

  // One sign-in form for everyone: the code field is there and is not required.
  const loginPage = await (await get(s.base, "/admin/login")).text();
  assert.match(loginPage, /<input name="code" type="text" inputmode="numeric" pattern="\[0-9\]\{6\}" maxlength="6" autocomplete="one-time-code">/);
  assert.match(loginPage, /Leave it empty if your account has none\./);
  assert.equal((loginPage.match(/<form /g) || []).length, 1);
  assert.ok(!/\balice\b|\bpat\b/.test(loginPage));

  // Count the expensive and the cheap step of every attempt.
  const realScrypt = crypto.scrypt, realVerify = totp.verifyTotp;
  let scrypts = 0, verifies = 0;
  crypto.scrypt = (...args) => { scrypts += 1; return realScrypt(...args); };
  totp.verifyTotp = (...args) => { verifies += 1; return realVerify(...args); };
  t.after(() => { crypto.scrypt = realScrypt; totp.verifyTotp = realVerify; });
  await attempt(s, "warmup", "wrong password 123", ""); // the first unknown name also makes the dummy hash
  s.auth.unlock("warmup");

  const seen = [];
  for (const name of ["alice", "pat", "nobody"]) {
    for (const sent of [undefined, "", "123456", code(withAuth.secret, s.clock.t)]) {
      scrypts = 0; verifies = 0;
      const a = await attempt(s, name, "wrong password 123", sent);
      seen.push({ name, status: a.status, body: a.body, cookie: a.res.headers.get("set-cookie"), headers: [...a.res.headers.keys()].sort().join(","), length: a.res.headers.get("content-length"), scrypts, verifies });
      s.auth.unlock(name);
    }
  }
  for (const x of seen) {
    assert.equal(x.status, 401, x.name);
    assert.equal(x.body, seen[0].body, `${x.name}: same page`);
    assert.equal(x.headers, seen[0].headers, `${x.name}: same headers`);
    assert.equal(x.cookie, null);
    assert.equal(x.scrypts, 1, `${x.name}: one scrypt`);
    assert.equal(x.verifies, 1, `${x.name}: one code check`);
  }
  assert.match(seen[0].body, /Sign-in failed\. Check the name, the password and the code\./);

  // The lock-out is the same too: the same number of tries, the same message, the same length of lock.
  const locks = {};
  for (const name of ["alice", "pat", "nobody"]) {
    let tries = 0, a;
    do { a = await attempt(s, name, "wrong password 123", ""); tries += 1; } while (a.status === 401 && tries < 20);
    const until = s.store.db.prepare("SELECT locked_until_ms FROM login_attempts WHERE scope = ?").get(s.auth.scope(name)).locked_until_ms;
    locks[name] = { tries, status: a.status, body: a.body, lockFor: until - s.clock.t };
  }
  assert.deepEqual(locks.pat, locks.alice);
  assert.deepEqual(locks.nobody, locks.alice);
  assert.deepEqual([locks.alice.tries, locks.alice.status, locks.alice.lockFor], [6, 429, 15 * MIN]);

  // After a correct password an account with an authenticator still needs its code; the answer is the same generic one.
  for (const name of ["alice", "pat", "nobody"]) s.auth.unlock(name);
  s.clock.t += 30_000;
  const missing = await attempt(s, "alice", PW, "");
  assert.equal(missing.status, 401);
  assert.equal(missing.body, seen[0].body);
  assert.equal((await attempt(s, "alice", PW, code(withAuth.secret, s.clock.t))).status, 303);
});

test("lock-out: each further lock of a name lasts twice as long, up to a day; a good sign-in starts over", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  await s.auth.createAdmin("pat", PW, { authenticator: false });
  const lockLength = async (name) => {
    for (let i = 0; i < 5; i++) assert.equal((await attempt(s, name, "wrong password 123")).status, 401);
    assert.equal((await attempt(s, name, PW)).status, 429, "locked, also for the right password");
    return s.store.db.prepare("SELECT locked_until_ms FROM login_attempts WHERE scope = ?").get(s.auth.scope(name)).locked_until_ms - s.clock.t;
  };
  const lengths = [];
  for (let round = 0; round < 9; round++) {
    const len = await lockLength("pat");
    lengths.push(len / MIN);
    s.clock.t += len - 1000;
    assert.equal((await attempt(s, "pat", PW)).status, 429);
    s.clock.t += 2000;
  }
  assert.deepEqual(lengths, [15, 30, 60, 120, 240, 480, 960, 1440, 1440]);
  // Guessing at full speed therefore gets 5 tries per lock: 45 tries in these nine rounds, which took more than four days.
  // A correct sign-in clears the history; the next lock is short again.
  assert.equal((await attempt(s, "pat", PW)).status, 303);
  assert.equal(await lockLength("pat"), 15 * MIN);
  // So does the owner's unlock command, and a quiet day.
  s.auth.unlock("pat");
  assert.equal((await attempt(s, "pat", PW)).status, 303);
  assert.equal(await lockLength("ghost"), 15 * MIN);
  s.clock.t += 16 * MIN;
  assert.equal(await lockLength("ghost"), 30 * MIN);
  s.clock.t += 25 * 3600_000;
  assert.equal(await lockLength("ghost"), 15 * MIN);
  // Housekeeping keeps the history for a day, not longer.
  s.auth.prune(s.clock.t + 23 * 3600_000);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE scope LIKE 'strikes:%'").get().c, 1);
  s.auth.prune(s.clock.t + 25 * 3600_000);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE scope LIKE 'strikes:%'").get().c, 0);
});

test("My account: add an authenticator, confirmed with a code before it takes effect", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  await s.auth.createAdmin("pat", PW, { authenticator: false });
  const a = await attempt(s, "pat", PW), other = await attempt(s, "pat", PW);
  assert.match(await page(s, a, "/admin/account"), /<form method="post" action="\/admin\/account\/authenticator\/start">/);

  let r = await post(s, a, "/admin/account/authenticator/start");
  assert.equal(r.headers.get("location"), "/admin/account");
  const setup = await page(s, a, "/admin/account");
  const secret = /<p class="secret">([A-Z2-7 ]+)<\/p>/.exec(setup)[1].replace(/ /g, "");
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.includes(`otpauth://totp/Backstage%20Desk:pat?secret=${secret}&amp;issuer=Backstage%20Desk`));
  assert.equal(await page(s, a, "/admin/account"), setup, "the same secret is shown until it is confirmed");
  // The waiting secret is stored encrypted, and another admin's page never shows it.
  assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM meta").all()).includes(secret));
  const b = await admin(s, "alice");
  assert.ok(!(await page(s, b, "/admin/account")).includes(secret));

  // Not in effect yet: a wrong code changes nothing, and sign-in still needs no code.
  r = await post(s, a, "/admin/account/authenticator/confirm", { code: "000000" });
  assert.equal(r.headers.get("location"), "/admin/account?err=code");
  assert.match(await page(s, a, "/admin/account?err=code"), /<p class="error" role="alert">That code is not right\./);
  assert.equal(s.auth.hasAuthenticator(s.auth.getAdmin("pat").id), false);
  assert.equal((await attempt(s, "pat", PW)).status, 303);

  // A correct code switches it on. This session stays, the others end.
  const good = code(secret, s.clock.t);
  r = await post(s, a, "/admin/account/authenticator/confirm", { code: good });
  assert.equal(r.headers.get("location"), "/admin/account?done=authadded");
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 200);
  assert.equal((await get(s.base, "/admin/", { cookie: other.cookie })).status, 303);
  assert.ok(!(await page(s, a, "/admin/")).includes("password only"));
  assert.match(await page(s, a, "/admin/account"), /Signing in needs your password and a six-digit code/);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM meta WHERE k LIKE 'totp_pending:%'").get().c, 0);

  // From now on the code is required, and the code used to confirm cannot be used again to sign in.
  assert.equal((await attempt(s, "pat", PW)).status, 401);
  assert.equal((await attempt(s, "pat", PW, "")).status, 401);
  assert.equal((await attempt(s, "pat", PW, good)).status, 401);
  s.auth.unlock("pat");
  s.clock.t += 30_000;
  assert.equal((await attempt(s, "pat", PW, code(secret, s.clock.t))).status, 303);
  assert.equal((await post(s, a, "/admin/account/authenticator/start")).headers.get("location"), "/admin/account?err=has");

  // A setup that is not finished within 30 minutes is dropped; cancel drops it at once.
  await s.auth.createAdmin("sam", PW, { authenticator: false });
  const c = await attempt(s, "sam", PW);
  await post(s, c, "/admin/account/authenticator/start");
  const sam = /<p class="secret">([A-Z2-7 ]+)<\/p>/.exec(await page(s, c, "/admin/account"))[1].replace(/ /g, "");
  s.clock.t += 31 * MIN;
  r = await post(s, c, "/admin/account/authenticator/confirm", { code: code(sam, s.clock.t) });
  assert.equal(r.headers.get("location"), "/admin/account?err=expired");
  assert.equal(s.auth.hasAuthenticator(s.auth.getAdmin("sam").id), false);
  await post(s, c, "/admin/account/authenticator/start");
  r = await post(s, c, "/admin/account/authenticator/cancel");
  assert.equal(r.headers.get("location"), "/admin/account?done=authcancelled");
  assert.ok(!(await page(s, c, "/admin/account")).includes('class="secret"'));

  const log = audit(s);
  assert.ok(log.includes("pat|account_authenticator_start|pat|"));
  assert.ok(log.includes("pat|account_authenticator_add|pat|"));
  assert.ok(!log.join("\n").includes(secret) && !log.join("\n").includes(PW));
});

test("My account: remove the authenticator with the current password", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  const a = await admin(s, "alice", PW);
  s.clock.t += 30_000;
  const other = await signIn(s, "alice", PW, a.secret);
  let r = await post(s, a, "/admin/account/authenticator/remove", { current: "wrong password 123" });
  assert.equal(r.headers.get("location"), "/admin/account?err=current");
  assert.match(await page(s, a, "/admin/account?err=current"), /The current password is not right\. Nothing was changed\./);
  assert.equal(s.auth.hasAuthenticator(a.id), true);
  assert.equal((await post(s, a, "/admin/account/authenticator/remove", {})).headers.get("location"), "/admin/account?err=current");

  r = await post(s, a, "/admin/account/authenticator/remove", { current: PW });
  assert.equal(r.headers.get("location"), "/admin/account?done=authremoved");
  assert.equal(s.auth.hasAuthenticator(a.id), false);
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 200);
  assert.equal((await get(s.base, "/admin/", { cookie: other.cookie })).status, 303);
  assert.match(await page(s, a, "/admin/"), /This account signs in with a password only\./);
  s.auth.unlock("alice");
  assert.equal((await attempt(s, "alice", PW)).status, 303);
  assert.equal((await attempt(s, "alice", PW, "999999")).status, 303); // the old code field no longer matters
  const log = audit(s);
  assert.ok(log.includes("alice|account_password_wrong|alice|"));
  assert.ok(log.includes("alice|account_authenticator_remove|alice|"));

  // The owner's commands do the same from the server.
  const set = s.auth.resetTotp("alice");
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 303); // signed out everywhere
  assert.equal((await attempt(s, "alice", PW)).status, 401);
  s.auth.unlock("alice");
  s.clock.t += 30_000;
  assert.equal((await attempt(s, "alice", PW, code(set.secret, s.clock.t))).status, 303);
  assert.equal(s.auth.removeAuthenticator("alice"), "alice");
  assert.equal((await attempt(s, "alice", PW)).status, 303);
  assert.throws(() => s.auth.removeAuthenticator("nobody"), /no such admin/);
});

test("My account: changing the password needs the current one and signs out every other session", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  await s.auth.createAdmin("pat", PW, { authenticator: false });
  const a = await attempt(s, "pat", PW), other1 = await attempt(s, "pat", PW), other2 = await attempt(s, "pat", PW);
  const b = await admin(s, "alice");
  const NEW = "a brand new long password";
  const change = (fields) => post(s, a, "/admin/account/password", fields);

  for (const [fields, err] of [
    [{ current: "wrong password 123", next: NEW, again: NEW }, "current"],
    [{ current: PW, next: NEW, again: `${NEW}!` }, "match"],
    [{ current: PW, next: "too short", again: "too short" }, "short"],
    [{ current: PW, next: "aaaaaaaaaaaaaaaaaaaa", again: "aaaaaaaaaaaaaaaaaaaa" }, "weak"],
    [{ current: PW, next: PW, again: PW }, "weak"],
    [{ next: NEW, again: NEW }, "current"],
  ]) {
    const r = await change(fields);
    assert.equal(r.headers.get("location"), `/admin/account?err=${err}`, JSON.stringify(fields));
  }
  assert.equal((await attempt(s, "pat", PW)).status, 303, "nothing was changed by the refused tries");
  s.auth.unlock("pat");

  const r = await change({ current: PW, next: NEW, again: NEW });
  assert.equal(r.headers.get("location"), "/admin/account?done=password");
  assert.match(await page(s, a, "/admin/account?done=password"), /Your password was changed\. Every other session of yours was signed out\./);
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 200, "this session stays");
  for (const o of [other1, other2]) assert.equal((await get(s.base, "/admin/", { cookie: o.cookie })).status, 303);
  assert.equal((await get(s.base, "/admin/", { cookie: b.cookie })).status, 200, "another admin is not affected");
  assert.equal((await attempt(s, "pat", PW)).status, 401);
  s.auth.unlock("pat");
  assert.equal((await attempt(s, "pat", NEW)).status, 303);
  assert.match(s.store.db.prepare("SELECT pw_hash FROM admins WHERE name = 'pat'").get().pw_hash, /^scrypt\$/);

  const log = audit(s);
  assert.ok(log.includes("pat|account_password_change|pat|"));
  assert.ok(log.filter(l => l === "pat|account_password_wrong|pat|").length >= 2);
  for (const secret of [PW, NEW, "wrong password 123"]) assert.ok(!JSON.stringify(s.store.db.prepare("SELECT * FROM audit").all()).includes(secret));

  // Guessing the current password from inside a session is counted like failed sign-ins: five wrong ones lock the account and end its sessions.
  const c = await attempt(s, "pat", NEW);
  for (let i = 0; i < 4; i++) assert.equal((await post(s, c, "/admin/account/password", { current: `guess number ${i} long`, next: PW, again: PW })).headers.get("location"), "/admin/account?err=current");
  const fifth = await post(s, c, "/admin/account/password", { current: "guess number five long", next: PW, again: PW });
  assert.equal(fifth.headers.get("location"), "/admin/login");
  assert.match(fifth.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await get(s.base, "/admin/", { cookie: c.cookie })).status, 303);
  assert.equal((await get(s.base, "/admin/", { cookie: a.cookie })).status, 303);
  assert.equal((await attempt(s, "pat", NEW)).status, 429);
  assert.ok(audit(s).includes("pat|account_locked|pat|"));
});

test("My account needs a session and the session's CSRF token like every other page", async (t) => {
  const s = await boot(MANY); t.after(() => s.close());
  await s.auth.createAdmin("pat", PW, { authenticator: false });
  const a = await attempt(s, "pat", PW);
  const posts = ["/admin/account/password", "/admin/account/authenticator/start", "/admin/account/authenticator/confirm", "/admin/account/authenticator/cancel", "/admin/account/authenticator/remove"];
  const body = { current: PW, next: "a brand new long password", again: "a brand new long password", code: "123456" };
  assert.equal((await get(s.base, "/admin/account")).headers.get("location"), "/admin/login");
  for (const p of posts) {
    assert.equal((await form(s.base, p, { ...body, csrf: a.csrf })).headers.get("location"), "/admin/login", `${p} without a session`);
    for (const csrf of [undefined, "", "x".repeat(43), a.token]) assert.equal((await form(s.base, p, csrf === undefined ? body : { ...body, csrf }, { cookie: a.cookie })).status, 403, `${p} with a bad token`);
    assert.equal((await form(s.base, p, { ...body, csrf: a.csrf }, { cookie: a.cookie, headers: { Origin: "https://evil.example" } })).status, 403, `${p} from another site`);
    assert.ok([404, 405].includes((await get(s.base, p, { cookie: a.cookie })).status), `GET ${p}`);
  }
  assert.equal((await attempt(s, "pat", PW)).status, 303, "the password was not changed");
  assert.equal(s.auth.hasAuthenticator(s.auth.getAdmin("pat").id), false);
  assert.equal(s.store.db.prepare("SELECT COUNT(*) AS c FROM meta WHERE k LIKE 'totp_pending:%'").get().c, 0);
  // The page itself: strict headers, one external script, every form carries the token, and error text is never taken from the address.
  const res = await get(s.base, "/admin/account?err=%3Cscript%3Ealert(1)%3C/script%3E&done=%3Cb%3E", { cookie: a.cookie });
  const html = await res.text();
  assert.match(res.headers.get("content-security-policy"), /^default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.ok(!html.includes("alert(1)") && !html.includes('role="alert"'));
  for (const f of html.match(/<form [^>]*method="post"[^>]*>[\s\S]*?<\/form>/g)) assert.ok(f.includes(`name="csrf" value="${a.csrf}"`));
});

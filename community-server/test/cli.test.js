"use strict";
// The owner command-line tool and the demo seeder, run as real processes on a temp database.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { Store, hashInstall } = require("../lib/store");
const { Auth } = require("../lib/auth");
const totp = require("../lib/totp");
const stats = require("../lib/stats");
const { SALT, tempDb, ticket, heartbeat, uuid } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PW = "a long enough password";

function cli(db, args, { input = "", env = {} } = {}) {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "admin.js"), ...args], {
    input, encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BF_COMMUNITY_SALT: SALT, BF_COMMUNITY_DB: db.file, BF_COMMUNITY_ENV_FILE: path.join(db.dir, "none.env"),
      BF_DESK_SCRYPT_LOG2N: "14", BF_DESK_BACKUP_DIR: path.join(db.dir, "nightly"), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("admin accounts are made, changed and disabled only from the command line", (t) => {
  const db = tempDb(); t.after(() => db.cleanup());
  assert.match(cli(db, ["admins"]).out, /No admins yet/);

  const add = cli(db, ["admin-add", "Alice"], { input: `${PW}\n` });
  assert.equal(add.code, 0, add.err);
  const secret = /Secret \(type it in by hand\): ([A-Z2-7]{32})/.exec(add.out)[1];
  assert.match(add.out, /otpauth:\/\/totp\/Backstage%20Desk:alice\?secret=[A-Z2-7]{32}&issuer=Backstage%20Desk/);
  assert.ok(!add.out.includes(PW) && !add.err.includes(PW), "the password is never echoed");
  assert.ok(!add.out.includes(SALT));

  // The account works: same password, a code from the printed secret.
  let store = new Store(db.file);
  let auth = new Auth({ store, salt: SALT });
  const row = store.db.prepare("SELECT * FROM admins").get();
  assert.match(row.pw_hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!JSON.stringify(row).includes(secret));
  store.close();

  assert.match(cli(db, ["admin-add", "alice"], { input: `${PW}\n` }).err, /already exists/);
  assert.match(cli(db, ["admin-add", "bob"], { input: "too short\n" }).err, /at least 14 characters/);
  assert.match(cli(db, ["admin-add", "b"], { input: `${PW}\n` }).err, /admin name/);
  assert.equal(cli(db, ["admin-add", "bob"], { input: "" }).code, 1);
  assert.match(cli(db, ["admins"]).out, /^alice {2}created \S+ {2}last sign-in never {2}sessions 0$/m);

  assert.match(cli(db, ["admin-disable", "alice"]).out, /"alice" is disabled and signed out/);
  assert.match(cli(db, ["admins"]).out, /^alice \(disabled\)/m);
  assert.match(cli(db, ["admin-enable", "alice"]).out, /can sign in again/);
  assert.match(cli(db, ["admin-disable", "nobody"]).err, /no such admin/);

  const reset = cli(db, ["admin-reset-totp", "alice"]);
  const secret2 = /Secret \(type it in by hand\): ([A-Z2-7]{32})/.exec(reset.out)[1];
  assert.notEqual(secret2, secret);
  assert.equal(cli(db, ["admin-password", "alice"], { input: "another long password\n" }).code, 0);
  assert.equal(cli(db, ["admin-unlock", "alice"]).code, 0);

  store = new Store(db.file);
  auth = new Auth({ store, salt: SALT });
  return auth.login({ name: "alice", password: "another long password", code: totp.totp(totp.base32Decode(secret2)) }).then((r) => {
    assert.equal(r.ok, true);
    const audit = store.db.prepare("SELECT admin_name, action, target FROM audit ORDER BY id").all().map(a => `${a.admin_name}|${a.action}|${a.target}`);
    assert.deepEqual(audit.slice(0, 6), ["(command line)|admin_add|alice", "(command line)|admin_disable|alice", "(command line)|admin_enable|alice", "(command line)|admin_reset_totp|alice", "(command line)|admin_password|alice", "(command line)|admin_unlock|alice"]);
    store.close();
  });
});

test("tickets, reply, stats, rollup, backup and notify-test from the command line; the old commands still work", (t) => {
  const db = tempDb(); t.after(() => db.cleanup());
  const store = new Store(db.file);
  const install = uuid(), hash = hashInstall(SALT, install);
  const made = store.desk.createTicket(hash, ticket(install, { summary: "Colour \u001b[31mcodes are not printed raw" }), Date.now() - 60_000);
  store.desk.recordHeartbeat(hash, heartbeat(install), Date.now());
  store.desk.recordHeartbeat(hash, heartbeat(install), Date.parse("2024-06-15T12:00:00Z"));
  store.addReport(hash, { category: "bug", text: "An old report", appVersion: "1.25.0", build: null, log: null });
  store.close();

  const list = cli(db, ["tickets"]);
  assert.match(list.out, /^BF-1001 \S+ \[new\] bug\/talents app 1\.26\.0 windows {2}msgs 1$/m);
  assert.ok(!list.out.includes("\u001b"), "terminal escape codes are replaced");
  const show = cli(db, ["ticket", "BF-1001"]);
  assert.match(show.out, /^BF-1001 \[new\] bug\/talents \(always\)$/m);
  assert.match(show.out, new RegExp(`install ${hash.slice(0, 8)}\\b`));
  assert.ok(!show.out.includes(hash) && !show.out.includes(install));
  assert.match(show.out, /--- player \S+ ---\nSteps: open the planner/);
  assert.equal(cli(db, ["ticket", "1001"]).code, 0);
  assert.equal(cli(db, ["ticket", "BF-4040"]).code, 1);

  assert.match(cli(db, ["reply", "bf-1001", "Thanks,", "we", "are", "looking."]).out, /Reply sent on BF-1001\. Status: looking\./);
  const again = new Store(db.file);
  assert.deepEqual(again.desk.publicTicket(again.desk.ticketByKey(1001, made.key)).messages.map(m => [m.from, m.text]).at(-1), ["team", "Thanks, we are looking."]);
  again.close();
  assert.equal(cli(db, ["reply", "BF-1001"]).code, 1);

  const st = JSON.parse(cli(db, ["stats"]).out);
  for (const key of ["observationsByKind", "installs", "reports", "builds30Days", "revision"]) assert.ok(key in st, `stats still has ${key}`);
  assert.deepEqual(st.reports, { total: 1, unread: 1 });
  assert.equal(st.desk.activeInstalls.today, 1);
  assert.equal(st.desk.activeInstalls.everSeen, 1);
  assert.equal(st.desk.tickets.looking, 1);
  assert.equal(st.desk.retention.oldestHeartbeat, "2024-06-15");
  assert.ok(!JSON.stringify(st).includes(SALT));

  const roll = cli(db, ["rollup"]);
  assert.match(roll.out, /Rolled up 1 month\(s\) \(2024-06\), removed 1 heartbeat rows/);
  assert.match(cli(db, ["rollup"]).out, /Rolled up 0 month\(s\), removed 0 heartbeat rows/);
  assert.match(cli(db, ["backup"]).out, /Wrote .*community-\d{4}-\d{2}-\d{2}\.db/);
  assert.match(cli(db, ["backup"]).out, /already exists/);
  assert.equal(fs.readdirSync(path.join(db.dir, "nightly")).length, 1);
  assert.match(cli(db, ["backup"], { env: { BF_DESK_BACKUP_DIR: "off" } }).err, /switched off/);

  assert.match(cli(db, ["notify-test"]).out, /No alerts are configured/);
  // The manual download check makes no outbound call when the feature is switched off.
  const dl = cli(db, ["downloads-fetch"], { env: { BF_DESK_DOWNLOADS: "off" } });
  assert.equal(dl.code, 0);
  assert.match(dl.out, /Download counts are switched off/);
  assert.match(cli(db, ["downloads-fetch"], { env: { BF_DESK_GITHUB_REPO: "not a repo" } }).err, /BF_DESK_GITHUB_REPO must look like owner\/repository/);
  const bad = cli(db, ["notify-test"], { env: { BF_DESK_NOTIFY_EMAIL: "owner@example.com", BF_DESK_SENDMAIL: path.join(db.dir, "no-such-sendmail") } });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /E-mail to 1 address\(es\): FAILED/);
  assert.ok(!bad.out.includes("owner@example.com") && !bad.err.includes("owner@example.com"), "addresses are not printed");

  // Old commands.
  assert.match(cli(db, ["reports"]).out, /#1 .*\[bug\] app 1\.25\.0/);
  assert.equal(cli(db, ["hash", install]).out.trim(), hash);
  assert.match(cli(db, ["purge-install", install, "--block"]).out, /Removed 0 observation rows, 1 reports, 1 tickets and 1 heartbeat rows; install blocked\./);
  assert.equal(JSON.parse(cli(db, ["pack"]).out).nodes, 0);
  assert.equal(cli(db, ["nonsense"]).code, 1);
  assert.match(cli(db, []).err, /usage: node admin\.js/);
});

test("seed-demo fills a throwaway database that the dashboard can draw, and refuses an existing file", (t) => {
  const db = tempDb();
  let store = null;
  t.after(() => { if (store) store.close(); db.cleanup(); });
  const file = path.join(db.dir, "demo.db");
  const run = (args) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "tools", "seed-demo.js"), ...args], { encoding: "utf8", timeout: 120_000 });
  const first = run([file, "--days", "40"]);
  assert.equal(first.status, 0, first.stderr);
  const counts = JSON.parse(first.stdout);
  assert.ok(counts.heartbeats > 500 && counts.first_seen > 50 && counts.tickets > 10 && counts.error_groups >= 5 && counts.obs > 500, first.stdout);
  const refuse = run([file]);
  assert.equal(refuse.status, 1);
  assert.match(refuse.stderr, /already exists/);
  assert.equal(run([]).status, 1);

  store = new Store(file);
  const d = stats.dashboard(store, { days: 30 });
  assert.ok(d.active.now.mau > 50 && d.active.now.wau > 20);
  assert.ok(d.cohorts.some(c => c.size > 0 && c.weeks[0] && c.weeks[0].n > 0));
  assert.ok(d.support.openedInRange > 0 && d.support.topErrors.length > 0 && d.community.newFacts > 0);
  // Demo admins cannot sign in, and no real-looking data is in there.
  assert.ok(store.db.prepare("SELECT name, disabled, pw_hash FROM admins").all().every(a => a.name.startsWith("demo-") && a.disabled === 1 && a.pw_hash === "demo-no-login"));
});

"use strict";
// Dashboard maths, the 13-month rollup, nightly backups and the schema upgrade,
// all on seeded databases with a fixed clock.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Store, SCHEMA_VERSION } = require("../lib/store");
const stats = require("../lib/stats");
const { runMaintenance } = require("../lib/maintenance");
const { buildPackData } = require("../lib/pack");
const { T0, DAY, tempDb, heartbeat, ticket, submit } = require("./helpers");
const { validateSubmit } = require("../lib/validate");

const h = (n) => crypto.createHash("sha256").update(`install-${n}`).digest("hex");
const at = (day, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
function memory() { return new Store(":memory:"); }
// Records one heartbeat for install n on a UTC day.
function beat(store, n, day, extra = {}) { store.desk.recordHeartbeat(h(n), heartbeat("x", extra), at(day)); }

test("date helpers: ISO weeks, Mondays and the retention cut-off", () => {
  assert.equal(stats.isoWeek("2026-11-24"), "2026-W48");
  assert.equal(stats.isoWeek("2026-01-01"), "2026-W01");
  assert.equal(stats.isoWeek("2027-01-03"), "2026-W53");
  assert.equal(stats.isoWeek("2024-12-30"), "2025-W01");
  assert.equal(stats.mondayOf("2026-11-24"), "2026-11-23");
  assert.equal(stats.mondayOf("2026-11-29"), "2026-11-23");
  assert.equal(stats.mondayOf("2026-11-23"), "2026-11-23");
  assert.equal(stats.addDays("2026-02-28", 1), "2026-03-01");
  // No kept row is ever older than 13 months; whole months go at a time.
  assert.equal(stats.retentionCutoff(at("2026-11-24")), "2025-11-01");
  assert.equal(stats.retentionCutoff(at("2026-11-30")), "2025-11-01");
  assert.equal(stats.retentionCutoff(at("2026-12-01", 0)), "2025-11-01");
  assert.equal(stats.retentionCutoff(at("2026-12-02")), "2025-12-01");
  assert.equal(stats.retentionCutoff(at("2027-01-15")), "2026-01-01");
  assert.equal(stats.median([3, 1, 2]), 2);
  assert.equal(stats.median([4, 1, 2, 3]), 2.5);
  assert.equal(stats.median([]), null);
});

test("DAU, WAU, MAU and stickiness on a seeded database", (t) => {
  const store = memory(); t.after(() => store.close());
  // Today is Tuesday 2026-11-24.
  //  install 1: every day for the last 40 days
  //  install 2: today and 6 days ago (inside the 7-day window)
  //  install 3: 7 days ago only (outside the 7-day window, inside 30)
  //  install 4: 29 days ago only (the edge of the 30-day window)
  //  install 5: 30 days ago only (outside the 30-day window)
  for (let i = 39; i >= 0; i--) beat(store, 1, stats.addDays("2026-11-24", -i));
  beat(store, 2, "2026-11-18"); beat(store, 2, "2026-11-24");
  beat(store, 3, "2026-11-17");
  beat(store, 4, "2026-10-26");
  beat(store, 5, "2026-10-25");
  const d = stats.dashboard(store, { now: T0, days: 30 });
  assert.equal(d.today, "2026-11-24");
  assert.equal(d.start, "2026-10-26");
  assert.equal(d.active.days.length, 30);
  assert.equal(d.active.now.dauToday, 2);
  assert.equal(d.active.now.wau, 2);
  assert.equal(d.active.now.mau, 4);
  const idx = (day) => d.active.days.indexOf(day);
  assert.equal(d.active.dau[idx("2026-11-24")], 2);
  assert.equal(d.active.dau[idx("2026-11-23")], 1);
  assert.equal(d.active.dau[idx("2026-11-18")], 2);
  assert.equal(d.active.wau[idx("2026-11-24")], 2);
  assert.equal(d.active.wau[idx("2026-11-23")], 3); // 17th..23rd: installs 1, 2 and 3
  assert.equal(d.active.wau[idx("2026-11-17")], 2);
  assert.equal(d.active.mau[idx("2026-11-24")], 4); // 26 Oct..24 Nov: 1, 2, 3, 4
  assert.equal(d.active.mau[idx("2026-11-23")], 5); // 25 Oct..23 Nov: all five
  // Stickiness: seven complete days (17th..23rd) hold 1+1+1+1+1+2+2 = 9 active days; 9/7 over MAU 4.
  assert.equal(d.active.now.dauAvg7, 1.3);
  assert.equal(d.active.now.stickiness, 32.1);
  assert.equal(d.active.stickiness[idx("2026-11-24")], 50); // 2 of 4
  // New installs: the server's own first-seen day.
  assert.equal(d.installs.totalEver, 5);
  assert.equal(d.installs.newPerDay[idx("2026-11-18")], 1);
  assert.equal(d.installs.newPerDay[idx("2026-11-24")], 0);
  assert.equal(d.installs.newInRange, 3); // installs 2, 3 and 4; 1 and 5 were first seen before the range

  // A year is drawn one point a week, ending today.
  const y = stats.dashboard(store, { now: T0, days: 365 });
  assert.equal(y.active.days.at(-1), "2026-11-24");
  assert.equal(y.active.days.at(-2), "2026-11-17");
  assert.equal(y.active.days.length, 53);
  assert.equal(stats.dashboard(store, { now: T0, days: 12 }).days, 30); // only the four fixed ranges
});

test("weekly retention cohorts", (t) => {
  const store = memory(); t.after(() => store.close());
  // Week of Mon 2026-11-02 (W45): installs 1..4 first seen.
  //   +1 week (W46): 1, 2, 3 come back; +2 (W47): 1, 2; +3 (W48, this week, partial): 1.
  // Week of Mon 2026-11-09 (W46): installs 5, 6 first seen; +1 (W47): 5; +2 (W48): none.
  for (const n of [1, 2, 3, 4]) beat(store, n, "2026-11-03");
  beat(store, 1, "2026-11-04"); // a second day in the same week does not count as coming back
  for (const n of [1, 2, 3]) beat(store, n, "2026-11-10");
  beat(store, 1, "2026-11-12"); // twice in one week counts once
  for (const n of [1, 2]) beat(store, n, "2026-11-21");
  beat(store, 1, "2026-11-23");
  beat(store, 5, "2026-11-09"); beat(store, 6, "2026-11-15");
  beat(store, 5, "2026-11-16");
  beat(store, 7, "2026-11-24"); // first seen this week: not a cohort yet
  const d = stats.dashboard(store, { now: T0, days: 90 });
  assert.equal(d.cohorts.length, 9);
  assert.deepEqual(d.cohorts.map(c => c.week), ["2026-W39", "2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44", "2026-W45", "2026-W46", "2026-W47"]);
  const w45 = d.cohorts[6], w46 = d.cohorts[7], w47 = d.cohorts[8];
  assert.equal(w45.start, "2026-11-02");
  assert.equal(w45.size, 4);
  assert.deepEqual(w45.weeks.slice(0, 3), [{ n: 3, pct: 75, partial: false }, { n: 2, pct: 50, partial: false }, { n: 1, pct: 25, partial: true }]);
  assert.deepEqual(w45.weeks.slice(3), [null, null, null, null, null]); // weeks that have not started
  assert.equal(w46.size, 2);
  assert.deepEqual(w46.weeks.slice(0, 2), [{ n: 1, pct: 50, partial: false }, { n: 0, pct: 0, partial: true }]);
  assert.equal(w47.size, 0);
  assert.equal(d.cohorts[0].size, 0);
  assert.equal(d.cohorts[0].weeks.length, 8);
  assert.ok(d.cohorts[0].weeks.every(w => w !== null && w.n === 0));
});

test("versions, breakdowns, funnel and feature reach", (t) => {
  const store = memory(); t.after(() => store.close());
  const flags = (g, a, l, s) => ({ gameConnected: g, addonInstalled: a, liveLink: l, sharing: s });
  beat(store, 1, "2026-11-20", { appVersion: "1.25.0", flags: flags(false, false, false, false), areas: [] });
  beat(store, 1, "2026-11-24", { appVersion: "1.26.0", flags: flags(true, true, true, true), areas: ["now", "map"] }); // latest state wins
  beat(store, 2, "2026-11-24", { appVersion: "1.26.0", os: "macos", osMajor: "15", lang: "de", flags: flags(true, true, false, false), areas: ["now"] });
  beat(store, 3, "2026-11-23", { appVersion: "1.9.0", os: "linux", osMajor: null, build: null, flags: flags(true, false, true, true), areas: ["talents"] });
  beat(store, 4, "2026-11-10", { appVersion: "1.27.0", channel: "beta", flags: flags(false, true, false, true), areas: ["now", "ledger"] }); // outside the last 7 days
  const d = stats.dashboard(store, { now: T0, days: 30 });
  assert.equal(d.breakdowns.installs, 4);
  assert.deepEqual(d.breakdowns.version.map(v => [v.label, v.n]), [["1.27.0", 1], ["1.26.0", 2], ["1.9.0", 1]]); // newest first, numeric order
  assert.deepEqual(d.breakdowns.os.map(v => [v.label, v.n, v.pct]), [["Windows 11", 2, 50], ["Linux", 1, 25], ["macOS 15", 1, 25]]);
  assert.deepEqual(d.breakdowns.lang.map(v => [v.label, v.n]), [["en", 3], ["de", 1]]);
  assert.deepEqual(d.breakdowns.build.map(v => [v.label, v.n]), [["1.60.1.71037", 3], ["not known", 1]]);
  assert.equal(d.versions.latest, "1.26.0"); // the beta-only 1.27.0 is not "the latest release"
  assert.equal(d.versions.adoption.firstDay, "2026-11-24");
  assert.deepEqual(d.versions.adoption.share, [100]);
  const share = (v, day) => d.versions.share[d.versions.series.indexOf(v)][d.versions.days.indexOf(day)];
  assert.equal(share("1.26.0", "2026-11-24"), 100);
  assert.equal(share("1.25.0", "2026-11-20"), 100);
  assert.equal(share("1.26.0", "2026-11-19"), null); // a day without data is a gap, not zero
  // Funnel: each step also needs the one before. Install 3 has live link but no addon; install 4 has the addon but no game folder.
  assert.deepEqual(d.funnel.map(f => [f.n, f.pct]), [[4, 100], [3, 75], [2, 50], [1, 25]]);
  assert.equal(d.sharing.n, 3);
  // Reach: installs active in the last 7 days (1, 2, 3), any day in the week counts.
  const reach = Object.fromEntries(d.reach.map(r => [r.label, [r.n, r.pct]]));
  assert.deepEqual(reach.now, [2, 66.7]);
  assert.deepEqual(reach.map, [1, 33.3]);
  assert.deepEqual(reach.talents, [1, 33.3]);
  assert.deepEqual(reach.ledger, [0, 0]);
});

test("community and support numbers", (t) => {
  const store = memory(); t.after(() => store.close());
  const sub = (obs) => validateSubmit(submit("3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", obs));
  store.recordSubmission(h(1), sub({ nodes: [{ kind: "herb", objectId: 1, mapId: 1429, x: 0.1, y: 0.1, itemIds: [5] }, { kind: "ore", objectId: 2, mapId: 1429, x: 0.2, y: 0.2 }], npcs: [{ npcId: 9, mapId: 1411, x: 0.5, y: 0.5 }] }), at("2026-11-20"));
  store.recordSubmission(h(2), sub({ nodes: [{ kind: "herb", objectId: 1, mapId: 1429, x: 0.1, y: 0.1 }], drops: [{ npcId: 7, loots: 3, items: [{ itemId: 8, count: 1 }] }] }), at("2026-11-22"));
  store.recordSubmission(h(1), sub({ vendors: [{ npcId: 3, itemIds: [10, 11] }] }), at("2026-11-22"));

  const mk = (n, when, extra = {}) => store.desk.createTicket(h(n), { ...ticket("x"), ...extra }, when).id;
  const t1 = mk(1, at("2026-11-10", 8)), t2 = mk(2, at("2026-11-17", 8), { appVersion: "1.25.0" }), t3 = mk(3, at("2026-11-23", 8)), t4 = mk(4, at("2026-10-01", 8));
  store.desk.adminReply(t1, null, "hello", "question", at("2026-11-10", 10)); // first reply after 2 h
  store.desk.adminReply(t1, null, "again", null, at("2026-11-11", 10)); // not a first reply
  store.desk.adminReply(t2, null, "fixed", "fixed", at("2026-11-17", 18)); // 10 h, and closes it
  store.desk.updateTicket(t4, { status: "closed" }, at("2026-11-18", 9));
  store.desk.ticketFromErrorGroup(0, null, T0); // no such group: nothing happens
  for (let w = 0; w < 3; w++) for (const n of [1, 2, 3, 4, 5]) beat(store, n, stats.addDays("2026-11-24", -7 * w), { appVersion: n <= 4 ? "1.26.0" : "1.25.0" });

  const d = stats.dashboard(store, { now: T0, days: 30 });
  const day = (list, dayName) => list[d.community.days.indexOf(dayName)];
  const kind = (k) => d.community.perDay[d.community.kinds.indexOf(k)];
  assert.equal(day(kind("herb"), "2026-11-20"), 1);
  assert.equal(day(kind("ore"), "2026-11-20"), 1);
  assert.equal(day(kind("npc"), "2026-11-20"), 1);
  assert.equal(day(kind("herb"), "2026-11-22"), 1); // the same spot from a second install is a new fact from that install
  assert.equal(day(kind("drop"), "2026-11-22"), 1);
  assert.equal(day(kind("vendor"), "2026-11-22"), 2);
  assert.equal(d.community.newFacts, 7); // node items and loot counters are bookkeeping, not facts
  assert.equal(d.community.contributors, 2);
  assert.equal(day(d.community.newContributorsPerDay, "2026-11-20"), 1);
  assert.equal(day(d.community.newContributorsPerDay, "2026-11-22"), 1);
  assert.deepEqual(d.community.zones.map(z => [z.map, z.spots, z.contributors]), [[1429, 2, 2]]);

  const s = d.support, week = (list, monday) => list[s.weeks.indexOf(monday)];
  assert.equal(s.weeks[0], "2026-10-26");
  assert.equal(week(s.opened, "2026-11-09"), 1);
  assert.equal(week(s.opened, "2026-11-16"), 1);
  assert.equal(week(s.opened, "2026-11-23"), 1);
  assert.equal(week(s.closed, "2026-11-16"), 2); // one fixed, one closed
  assert.equal(s.medianFirstReplyHours, 6); // median of 2 h and 10 h
  assert.equal(s.replied, 2);
  assert.equal(s.openNow, 2);
  assert.deepEqual(s.ages.map(a => a.n), [0, 1, 0, 1, 0]); // t3 is 1 to 3 days old, t1 is 14 days old
  // Tickets per 1,000 weekly actives: 1.26.0 had 4 installs in each of 3 weeks = 12 install-weeks and 2 tickets in range.
  const v126 = s.perVersion.find(p => p.version === "1.26.0"), v125 = s.perVersion.find(p => p.version === "1.25.0");
  assert.deepEqual([v126.tickets, v126.installWeeks, v126.rate], [2, 12, 166.7]);
  assert.deepEqual([v125.tickets, v125.installWeeks, v125.rate], [1, 3, 333.3]);
});

test("retention: months older than 13 months are rolled into totals, then deleted; safe to repeat", (t) => {
  const store = memory(); t.after(() => store.close());
  const count = (table) => store.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  const roll = (month, dim, value = "") => { const r = store.db.prepare("SELECT installs, days FROM monthly_rollups WHERE month = ? AND dim = ? AND value = ?").get(month, dim, value); return r ? [r.installs, r.days] : null; };
  // September 2025 (old): install 1 on three days, install 2 on one day, install 3 on one day.
  beat(store, 1, "2025-09-01", { appVersion: "1.20.0", areas: ["now"] });
  beat(store, 1, "2025-09-02", { appVersion: "1.20.0", areas: ["map"] });
  beat(store, 1, "2025-09-30", { appVersion: "1.21.0", areas: [] });
  beat(store, 2, "2025-09-15", { appVersion: "1.20.0", os: "macos", lang: "de", build: null, flags: { gameConnected: false, addonInstalled: false, liveLink: false, sharing: false }, areas: [] });
  beat(store, 3, "2025-09-15", { appVersion: "1.20.0", channel: "beta", areas: ["now"] });
  // October 2025 (old): installs 1 and 4.
  beat(store, 1, "2025-10-31"); beat(store, 4, "2025-10-05");
  // 1 November 2025 is the first kept day when today is 24 November 2026.
  beat(store, 1, "2025-11-01"); beat(store, 5, "2025-11-01");
  beat(store, 1, "2026-11-24");
  const send = (n, day) => store.desk.recordError({ name: "E", message: "m", stack: ["at f (a.js:1:1)"], where: "main", appVersion: "1.20.0", os: "windows" }, at(day));
  send(1, "2025-10-31"); send(1, "2025-11-01");
  assert.equal(count("heartbeats"), 10);

  const r = stats.runRetention(store, T0);
  assert.equal(r.cutoff, "2025-11-01");
  assert.deepEqual(r.months, ["2025-09", "2025-10"]);
  assert.equal(r.heartbeatsDeleted, 7);
  assert.equal(count("heartbeats"), 3);
  assert.equal(store.db.prepare("SELECT MIN(day) AS d FROM heartbeats").get().d, "2025-11-01");

  assert.deepEqual(roll("2025-09", "active"), [3, 5]); // three installs, five install-days
  assert.deepEqual(roll("2025-09", "new"), [3, 0]);
  assert.deepEqual(roll("2025-09", "version", "1.20.0"), [3, 4]);
  assert.deepEqual(roll("2025-09", "version", "1.21.0"), [1, 1]);
  assert.deepEqual(roll("2025-09", "os", "windows"), [2, 4]);
  assert.deepEqual(roll("2025-09", "os", "macos"), [1, 1]);
  assert.deepEqual(roll("2025-09", "lang", "de"), [1, 1]);
  assert.deepEqual(roll("2025-09", "channel", "beta"), [1, 1]);
  assert.deepEqual(roll("2025-09", "build", ""), [1, 1]);
  assert.deepEqual(roll("2025-09", "flag", "gameConnected"), [2, 4]);
  assert.deepEqual(roll("2025-09", "flag", "liveLink"), [0, 0]);
  assert.deepEqual(roll("2025-09", "area", "now"), [2, 2]);
  assert.deepEqual(roll("2025-09", "area", "map"), [1, 1]);
  assert.deepEqual(roll("2025-10", "active"), [2, 2]);
  assert.deepEqual(roll("2025-10", "new"), [1, 0]); // install 4; install 1 was new in September
  assert.equal(roll("2025-11", "active"), null); // not rolled: still kept in full

  // Installs with nothing left lose their first-seen row; the all-time count is kept as a number.
  assert.equal(r.firstSeenPruned, 3); // installs 2, 3 and 4
  assert.equal(count("first_seen"), 2); // installs 1 and 5
  assert.equal(stats.dashboard(store, { now: T0, days: 30 }).installs.totalEver, 5);
  // Old error counts go too; the group and its total stay.
  assert.equal(r.errorRowsDeleted, 1);
  assert.equal(store.db.prepare("SELECT total FROM error_groups").get().total, 2);
  // No monthly total can be traced to an install.
  assert.ok(!JSON.stringify(store.db.prepare("SELECT * FROM monthly_rollups").all()).match(/[0-9a-f]{64}/));

  // Running it again changes nothing.
  const before = JSON.stringify(store.db.prepare("SELECT * FROM monthly_rollups ORDER BY month, dim, value").all());
  const again = stats.runRetention(store, T0);
  assert.deepEqual(again.months, []);
  assert.equal(again.heartbeatsDeleted, 0);
  assert.equal(JSON.stringify(store.db.prepare("SELECT * FROM monthly_rollups ORDER BY month, dim, value").all()), before);
  assert.equal(count("heartbeats"), 3);

  // The dashboard shows the old months as totals, and marks MAU it can no longer compute as a gap.
  const d = stats.dashboard(store, { now: at("2025-11-07"), days: 30 });
  assert.deepEqual(d.history.map(m => [m.month, m.active, m.fresh, m.days]), [["2025-10", 2, 1, 2], ["2025-09", 3, 3, 5]]);
  assert.equal(d.active.mau[d.active.days.indexOf("2025-11-07")], null); // its 30 days reach before the kept data
  assert.equal(d.active.wau[d.active.days.indexOf("2025-11-07")], 2); // 1 to 7 November is all kept
  assert.equal(d.active.wau[d.active.days.indexOf("2025-11-06")], null);

  // One month later the next month goes.
  const next = stats.runRetention(store, at("2026-12-24"));
  assert.equal(next.cutoff, "2025-12-01");
  assert.deepEqual(next.months, ["2025-11"]);
  assert.deepEqual(roll("2025-11", "active"), [2, 2]);
  assert.deepEqual(roll("2025-11", "new"), [1, 0]);
});

test("maintenance: closed tickets are kept, sessions and sign-in counters are pruned, nothing throws", async (t) => {
  const db = tempDb();
  const store = new Store(db.file);
  t.after(() => { store.close(); db.cleanup(); });
  const { Auth } = require("../lib/auth");
  const auth = new Auth({ store, salt: "s".repeat(40), now: () => T0, options: { scryptN: 1024 } });
  const id = store.desk.createTicket(h(1), ticket("x"), at("2024-01-01")).id;
  store.desk.updateTicket(id, { status: "closed" }, at("2024-01-02"));
  const adminId = Number(store.db.prepare("INSERT INTO admins(name, pw_hash, totp_secret, created_at) VALUES ('a', 'x', 'x', 'x')").run().lastInsertRowid);
  const ins = store.db.prepare("INSERT INTO sessions(id_hash, admin, created_ms, seen_ms) VALUES (?, ?, ?, ?)");
  ins.run("fresh", adminId, T0 - 60_000, T0 - 60_000);
  ins.run("idle", adminId, T0 - 2 * 3600_000, T0 - 61 * 60_000);
  ins.run("old", adminId, T0 - 13 * 3600_000, T0 - 1000);
  store.db.prepare("INSERT INTO login_attempts(scope, fails, window_ms, locked_until_ms) VALUES ('stale', 2, ?, 0), ('locked', 0, ?, ?), ('recent', 1, ?, 0)").run(T0 - 3600_000, T0 - 3600_000, T0 + 60_000, T0 - 1000);

  const logs = [];
  const dir = path.join(db.dir, "nightly");
  const out = runMaintenance({ store, auth, config: { backupDir: dir, backupKeep: 2 }, now: T0, log: (l) => logs.push(l) });
  assert.deepEqual(out.pruned, { sessions: 2, attempts: 1 });
  assert.deepEqual(store.db.prepare("SELECT id_hash FROM sessions").all().map(r => r.id_hash), ["fresh"]);
  assert.deepEqual(store.db.prepare("SELECT scope FROM login_attempts ORDER BY scope").all().map(r => r.scope), ["locked", "recent"]);
  assert.equal(store.db.prepare("SELECT status FROM tickets WHERE id = ?").get(id).status, "closed"); // a closed ticket from 2024 is still there
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM messages").get().c, 1);

  // Nightly backup: one dated file a day, a working database, only the newest kept.
  assert.equal(out.backup.created, true);
  assert.deepEqual(fs.readdirSync(dir), ["community-2026-11-24.db"]);
  const copy = new DatabaseSync(path.join(dir, "community-2026-11-24.db"));
  assert.equal(copy.prepare("SELECT COUNT(*) AS c FROM tickets").get().c, 1);
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  copy.close();
  assert.equal(runMaintenance({ store, auth, config: { backupDir: dir, backupKeep: 2 }, now: T0 + 3600_000 }).backup.created, false); // same day: no second copy
  runMaintenance({ store, auth, config: { backupDir: dir, backupKeep: 2 }, now: T0 + DAY });
  runMaintenance({ store, auth, config: { backupDir: dir, backupKeep: 2 }, now: T0 + 2 * DAY });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["community-2026-11-25.db", "community-2026-11-26.db"]);
  // Before 03:00 UTC, and with backups switched off, nothing is written.
  assert.equal(runMaintenance({ store, auth, config: { backupDir: dir, backupKeep: 2 }, now: at("2026-11-27", 2) }).backup, null);
  assert.equal(runMaintenance({ store, auth, config: { backupDir: null }, now: T0 + 5 * DAY }).backup, null);
  assert.equal(fs.readdirSync(dir).length, 2);
  // A step that fails is logged without detail and does not stop the others.
  const broken = runMaintenance({ store, auth, config: { backupDir: path.join(db.file, "not-a-dir"), backupKeep: 2 }, now: T0 + 6 * DAY, log: (l) => logs.push(l) });
  assert.equal(broken.backup, null);
  assert.ok(broken.retention);
  assert.match(logs.join("\n"), /maintenance backup failed: \w+/);
});

// The exact schema the live service has today (schema 1), with data in every table.
const SCHEMA_1 = `
  CREATE TABLE obs (kind TEXT NOT NULL, key TEXT NOT NULL, install TEXT NOT NULL, n INTEGER NOT NULL, first_day TEXT NOT NULL, last_day TEXT NOT NULL, PRIMARY KEY (kind, key, install)) WITHOUT ROWID;
  CREATE INDEX obs_install ON obs(install);
  CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, install TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, app_version TEXT, build TEXT, log TEXT, read INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX reports_install ON reports(install);
  CREATE TABLE blocked (install TEXT PRIMARY KEY, day TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE builds (build TEXT NOT NULL, day TEXT NOT NULL, submissions INTEGER NOT NULL, PRIMARY KEY (build, day)) WITHOUT ROWID;
  CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
  INSERT INTO meta(k, v) VALUES ('revision', '41');
  PRAGMA user_version = 1;`;

function oldDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_1);
  const obs = db.prepare("INSERT INTO obs(kind, key, install, n, first_day, last_day) VALUES (?, ?, ?, ?, ?, ?)");
  for (const n of [1, 2, 3]) {
    obs.run("node", "herb|o1617|1429|90|120", h(n), 1, "2026-10-01", "2026-11-01");
    obs.run("npc", "197|1429|97|84", h(n), 2, "2026-10-02", "2026-11-02");
  }
  obs.run("vendor", "1213|159", h(1), 1, "2026-10-03", "2026-10-03");
  db.prepare("INSERT INTO reports(created_at, install, category, text, app_version, build, log, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("2026-11-01T10:00:00.000Z", h(1), "bug", "An old one-way report", "1.25.0", "1.60.1.71037", "log text", 1);
  db.prepare("INSERT INTO reports(created_at, install, category, text, app_version) VALUES (?, ?, ?, ?, ?)").run("2026-11-02T10:00:00.000Z", h(2), "data", "Another", "1.25.0");
  db.prepare("INSERT INTO blocked(install, day) VALUES (?, ?)").run(h(9), "2026-10-10");
  db.prepare("INSERT INTO builds(build, day, submissions) VALUES (?, ?, ?)").run("1.60.1.71037", "2026-11-01", 12);
  db.close();
}

test("migration: a copy of the live schema 1 database with data upgrades in place and keeps everything", (t) => {
  const tmp = tempDb(); t.after(() => tmp.cleanup());
  oldDatabase(tmp.file);
  const snapshot = (db) => ["obs", "reports", "blocked", "builds"].map(tb => JSON.stringify(db.prepare(`SELECT * FROM ${tb} ORDER BY 1, 2`).all())).join("|");
  const raw = new DatabaseSync(tmp.file);
  const before = snapshot(raw);
  raw.close();

  let store = new Store(tmp.file);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(snapshot(store.db), before, "old rows are untouched");
  assert.equal(store.revision(), 41);
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const name of ["heartbeats", "first_seen", "monthly_rollups", "tickets", "messages", "error_groups", "error_occurrences", "announcements", "saved_replies", "admins", "sessions", "audit", "login_attempts"])
    assert.ok(tables.includes(name), `table ${name}`);
  // Old features still work on the upgraded file.
  assert.equal(store.reportCount(), 2);
  assert.equal(store.listReports({ all: true }).length, 2);
  assert.equal(store.isBlocked(h(9)), true);
  assert.equal(buildPackData(store, 3).nodes.rows.length, 1);
  assert.equal(store.stats().installs.total, 3);
  // New features work next to the old data: the first ticket is BF-1001.
  assert.equal(store.desk.createTicket(h(1), ticket("x"), T0).ticket, "BF-1001");
  store.desk.recordHeartbeat(h(1), heartbeat("x"), T0);
  assert.deepEqual(store.purgeInstall(h(1)), { observations: 3, reports: 1, tickets: 1, heartbeats: 1, blocked: false });
  assert.equal(stats.dashboard(store, { now: T0, days: 90 }).community.contributorsEver, 2);
  store.close();

  // Opening it again changes nothing (the upgrade is idempotent) and the ticket counter is not reset.
  store = new Store(tmp.file);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(store.reportCount(), 1);
  assert.equal(store.desk.createTicket(h(2), ticket("x"), T0).ticket, "BF-1002");
  store.close();
});

test("migration: a half-applied upgrade is finished; a newer database is refused; a new database gets everything", (t) => {
  const tmp = tempDb(); t.after(() => tmp.cleanup());
  oldDatabase(tmp.file);
  // As if the service died after making some of the new tables but before the version was set.
  const raw = new DatabaseSync(tmp.file);
  raw.exec("CREATE TABLE first_seen (install TEXT PRIMARY KEY, day TEXT NOT NULL) WITHOUT ROWID; INSERT INTO first_seen VALUES ('keepme', '2026-01-01');");
  raw.close();
  let store = new Store(tmp.file);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(store.db.prepare("SELECT day FROM first_seen WHERE install = 'keepme'").get().day, "2026-01-01");
  assert.equal(store.desk.createTicket(h(1), ticket("x"), T0).ticket, "BF-1001");
  store.db.exec("PRAGMA user_version = 3");
  store.close();
  assert.throws(() => new Store(tmp.file), /newer than this server/);

  const fresh = new Store(":memory:");
  assert.equal(fresh.db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(fresh.desk.createTicket(h(1), ticket("x"), T0).ticket, "BF-1001");
  assert.equal(fresh.revision(), 0);
  fresh.close();
});

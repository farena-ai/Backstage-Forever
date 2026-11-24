"use strict";
// Dashboard numbers and the retention job. Everything here is an aggregate:
// counts of installs that chose to send statistics. No function returns a
// single install's rows.
const fs = require("node:fs");
const { FLAGS, HEARTBEAT_AREAS, compareVersions } = require("./validate-desk");

const DAY_MS = 86_400_000;
const RANGES = Object.freeze([7, 30, 90, 365]);
const KEEP_MONTHS = 13;

function day(now) { return new Date(now).toISOString().slice(0, 10); }
function dayMs(d) { return Date.parse(`${d}T00:00:00Z`); }
function addDays(d, n) { return day(dayMs(d) + n * DAY_MS); }
function mondayOf(d) { const wd = (new Date(dayMs(d)).getUTCDay() + 6) % 7; return addDays(d, -wd); }
function isoWeek(d) {
  const t = dayMs(d), thursday = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4), week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const week = 1 + Math.round((thursday - 3 * DAY_MS - week1) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }
function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The first day whose heartbeat rows are kept: no kept row is ever older than
// 13 months. Whole calendar months are rolled up at a time.
function retentionCutoff(now) {
  const t = new Date(now);
  const edge = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - KEEP_MONTHS, t.getUTCDate()));
  const first = Date.UTC(edge.getUTCFullYear(), edge.getUTCMonth(), 1);
  return day(edge.getTime() === first ? first : Date.UTC(edge.getUTCFullYear(), edge.getUTCMonth() + 1, 1));
}

function dashboard(store, { now = Date.now(), days = 30 } = {}) {
  const db = store.db;
  if (!RANGES.includes(days)) days = 30;
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const today = day(now), start = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
  const cutoffRow = get("SELECT v FROM meta WHERE k = 'heartbeats_cutoff'");
  const keptFrom = cutoffRow ? cutoffRow.v : "0000-00-00";

  // --- installs
  const newMap = new Map(all("SELECT day, COUNT(*) AS c FROM first_seen WHERE day >= ? GROUP BY day", start).map(r => [r.day, r.c]));
  const pruned = Number((get("SELECT v FROM meta WHERE k = 'first_seen_pruned'") || { v: 0 }).v);
  const installs = {
    days: dayList, newPerDay: dayList.map(d => newMap.get(d) || 0),
    newInRange: [...newMap.values()].reduce((a, b) => a + b, 0),
    totalEver: get("SELECT COUNT(*) AS c FROM first_seen").c + pruned,
  };

  // --- active
  const dauMap = new Map(all("SELECT day, COUNT(*) AS c FROM heartbeats WHERE day >= ? GROUP BY day", start).map(r => [r.day, r.c]));
  const distinct = db.prepare("SELECT COUNT(DISTINCT install) AS c FROM heartbeats WHERE day BETWEEN ? AND ?");
  const window = (d, n) => (addDays(d, -(n - 1)) < keptFrom ? null : distinct.get(addDays(d, -(n - 1)), d).c);
  const step = days > 90 ? 7 : 1;
  const points = dayList.filter((_, i) => (days - 1 - i) % step === 0);
  const active = {
    days: points,
    dau: points.map(d => dauMap.get(d) || 0),
    wau: points.map(d => window(d, 7)),
    mau: points.map(d => window(d, 30)),
  };
  active.stickiness = points.map((d, i) => (active.mau[i] ? pct(active.dau[i], active.mau[i]) : null));
  const dayCount = db.prepare("SELECT COUNT(*) AS c FROM heartbeats WHERE day = ?");
  const last7 = Array.from({ length: 7 }, (_, i) => dayCount.get(addDays(today, -1 - i)).c); // seven complete days
  const mauNow = distinct.get(addDays(today, -29), today).c, wauNow = distinct.get(addDays(today, -6), today).c;
  const avgDau = last7.reduce((a, b) => a + b, 0) / 7;
  active.now = { dauToday: dauMap.get(today) || 0, dauAvg7: Math.round(avgDau * 10) / 10, wau: wauNow, mau: mauNow, stickiness: pct(avgDau, mauNow) };

  // --- weekly retention cohorts: of installs first seen in week N, how many came back in weeks N+1..N+8
  const thisMonday = mondayOf(today), base = addDays(thisMonday, -9 * 7);
  const sizes = new Map(all("SELECT CAST((julianday(day) - julianday(?)) / 7 AS INTEGER) AS w, COUNT(*) AS c FROM first_seen WHERE day >= ? AND day < ? GROUP BY w", base, base, thisMonday).map(r => [r.w, r.c]));
  const back = new Map(all(`SELECT CAST((julianday(f.day) - julianday(?)) / 7 AS INTEGER) AS cw,
      CAST((julianday(h.day) - julianday(?)) / 7 AS INTEGER) AS aw, COUNT(DISTINCT h.install) AS c
    FROM first_seen f JOIN heartbeats h ON h.install = f.install
    WHERE f.day >= ? AND f.day < ? GROUP BY cw, aw`, base, base, base, thisMonday).map(r => [`${r.cw}|${r.aw}`, r.c]));
  const cohorts = [];
  for (let cw = 0; cw < 9; cw++) {
    const weekStart = addDays(base, cw * 7), size = sizes.get(cw) || 0;
    const weeks = [];
    for (let k = 1; k <= 8; k++) {
      const aw = cw + k;
      // A week counts once it has started; the current week is partial and marked so.
      if (addDays(base, aw * 7) > today) { weeks.push(null); continue; }
      const n = back.get(`${cw}|${aw}`) || 0;
      weeks.push({ n, pct: pct(n, size), partial: addDays(base, aw * 7) === thisMonday });
    }
    cohorts.push({ week: isoWeek(weekStart), start: weekStart, size, weeks });
  }

  // --- versions
  const vrows = all("SELECT day, app_version AS v, COUNT(*) AS c FROM heartbeats WHERE day >= ? GROUP BY day, app_version", start);
  const vtotal = new Map();
  for (const r of vrows) vtotal.set(r.v, (vtotal.get(r.v) || 0) + r.c);
  const top = [...vtotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]).sort(compareVersions).reverse();
  const hasOther = vtotal.size > top.length;
  const vseries = [...top, ...(hasOther ? ["other"] : [])];
  const vday = new Map(dayList.map(d => [d, Object.fromEntries(vseries.map(v => [v, 0]))]));
  for (const r of vrows) { const o = vday.get(r.day); if (o) o[top.includes(r.v) ? r.v : "other"] += r.c; }
  const versions = {
    days: dayList, series: vseries,
    share: vseries.map(v => dayList.map(d => { const o = vday.get(d), t = Object.values(o).reduce((a, b) => a + b, 0); return t ? pct(o[v], t) : null; })),
  };

  // --- latest state per install in the range (bare columns follow MAX(day) in SQLite)
  const latest = all("SELECT install, MAX(day) AS day, app_version, channel, os, os_major, lang, build, flags FROM heartbeats WHERE day >= ? GROUP BY install", start);
  const tally = (fn) => {
    const m = new Map();
    for (const r of latest) { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([label, n]) => ({ label, n, pct: pct(n, latest.length) })).sort((a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label)));
  };
  const osName = { windows: "Windows", macos: "macOS", linux: "Linux" };
  const breakdowns = {
    installs: latest.length,
    os: tally(r => `${osName[r.os] || r.os}${r.os_major ? ` ${r.os_major}` : ""}`),
    lang: tally(r => r.lang),
    build: tally(r => r.build || "not known"),
    channel: tally(r => r.channel),
    version: tally(r => r.app_version).sort((a, b) => compareVersions(b.label, a.label)),
  };
  const stable = [...new Set(latest.filter(r => r.channel === "stable").map(r => r.app_version))].sort(compareVersions);
  const newest = stable.length ? stable[stable.length - 1] : null;
  let adoption = null;
  if (newest) {
    const first = get("SELECT MIN(day) AS d FROM heartbeats WHERE app_version = ? AND day >= ?", newest, start).d;
    const span = dayList.filter(d => d >= first).slice(0, 30);
    const onNew = new Map(all("SELECT day, COUNT(*) AS c FROM heartbeats WHERE day >= ? AND app_version = ? GROUP BY day", first, newest).map(r => [r.day, r.c]));
    adoption = { version: newest, firstDay: first, days: span, share: span.map(d => (dauMap.get(d) ? pct(onNew.get(d) || 0, dauMap.get(d)) : null)) };
  }
  versions.latest = newest;
  versions.adoption = adoption;

  // --- setup funnel (flags) and feature reach (areas)
  const bit = (r, name) => (r.flags & (1 << FLAGS.indexOf(name))) !== 0;
  const funnel = [
    { label: "Sent statistics", n: latest.length },
    { label: "Game folder connected", n: latest.filter(r => bit(r, "gameConnected")).length },
    { label: "Addon installed", n: latest.filter(r => bit(r, "gameConnected") && bit(r, "addonInstalled")).length },
    { label: "Live link used", n: latest.filter(r => bit(r, "gameConnected") && bit(r, "addonInstalled") && bit(r, "liveLink")).length },
  ].map(s => ({ ...s, pct: pct(s.n, latest.length) }));
  const sharing = { n: latest.filter(r => bit(r, "sharing")).length };
  sharing.pct = pct(sharing.n, latest.length);
  const weekStart = addDays(today, -6);
  const reachRow = get(`SELECT ${HEARTBEAT_AREAS.map((a, i) => `COUNT(DISTINCT CASE WHEN areas & ${1 << i} THEN install END) AS a${i}`).join(", ")} FROM heartbeats WHERE day >= ?`, weekStart);
  const reach = HEARTBEAT_AREAS.map((a, i) => ({ label: a, n: reachRow[`a${i}`], pct: pct(reachRow[`a${i}`], wauNow) })).sort((a, b) => b.n - a.n);

  // --- community data, from the existing observation tables
  const KINDS = ["herb", "ore", "chest", "npc", "vendor", "drop", "recipe"];
  const crow = all(`SELECT first_day AS day, CASE WHEN kind = 'node' THEN substr(key, 1, instr(key, '|') - 1) ELSE kind END AS k, COUNT(*) AS c
    FROM obs WHERE first_day >= ? AND kind IN ('node','npc','vendor','drop','recipe') GROUP BY day, k`, start);
  const cday = new Map(dayList.map(d => [d, Object.fromEntries(KINDS.map(k => [k, 0]))]));
  for (const r of crow) { const o = cday.get(r.day); if (o && Object.hasOwn(o, r.k)) o[r.k] += r.c; }
  // An install is a new contributor on the first day any of its observations was first seen.
  const contrib = new Map(all("SELECT d AS day, COUNT(*) AS c FROM (SELECT install, MIN(first_day) AS d FROM obs GROUP BY install) WHERE d >= ? GROUP BY d", start).map(r => [r.day, r.c]));
  const community = {
    days: dayList, kinds: KINDS,
    perDay: KINDS.map(k => dayList.map(d => cday.get(d)[k])),
    newFacts: crow.reduce((a, r) => a + r.c, 0),
    newContributorsPerDay: dayList.map(d => contrib.get(d) || 0),
    contributors: get("SELECT COUNT(DISTINCT install) AS c FROM obs WHERE last_day >= ?", start).c,
    contributorsEver: get("SELECT COUNT(DISTINCT install) AS c FROM obs").c,
    zones: all(`SELECT CAST(substr(rest, instr(rest, '|') + 1) AS INTEGER) AS map, COUNT(DISTINCT key) AS spots, COUNT(DISTINCT install) AS contributors,
        SUM(first_day >= ?) AS fresh
      FROM (SELECT key, install, first_day, substr(key, instr(key, '|') + 1) AS rest FROM obs WHERE kind = 'node')
      GROUP BY map ORDER BY spots DESC LIMIT 10`, start),
  };

  // --- support
  const firstWeek = mondayOf(start);
  const weekList = [];
  for (let w = firstWeek; w <= today; w = addDays(w, 7)) weekList.push(w);
  const wk = (ts) => mondayOf(ts.slice(0, 10));
  const opened = new Map(), closed = new Map();
  const trows = all("SELECT created_at, closed_at, first_reply_at, status, app_version, install IS NULL AS internal FROM tickets");
  const replyHours = [];
  for (const t of trows) {
    if (t.created_at.slice(0, 10) >= firstWeek) opened.set(wk(t.created_at), (opened.get(wk(t.created_at)) || 0) + 1);
    if (t.closed_at && t.closed_at.slice(0, 10) >= firstWeek) closed.set(wk(t.closed_at), (closed.get(wk(t.closed_at)) || 0) + 1);
    if (!t.internal && t.first_reply_at && t.created_at.slice(0, 10) >= start) replyHours.push((Date.parse(t.first_reply_at) - Date.parse(t.created_at)) / 3_600_000);
  }
  const AGES = [["Under 1 day", 1], ["1 to 3 days", 3], ["3 to 7 days", 7], ["7 to 30 days", 30], ["Over 30 days", Infinity]];
  const ages = AGES.map(([label]) => ({ label, n: 0 }));
  let openNow = 0;
  for (const t of trows) {
    if (["fixed", "closed"].includes(t.status)) continue;
    openNow += 1;
    const age = (now - Date.parse(t.created_at)) / DAY_MS;
    ages[AGES.findIndex(([, max]) => age < max)].n += 1;
  }
  const installWeeks = new Map();
  for (const r of all("SELECT app_version AS v, CAST((julianday(day) - julianday(?)) / 7 AS INTEGER) AS w, COUNT(DISTINCT install) AS c FROM heartbeats WHERE day >= ? GROUP BY v, w", start, start))
    installWeeks.set(r.v, (installWeeks.get(r.v) || 0) + r.c);
  const ticketsByVersion = new Map();
  for (const t of trows) if (!t.internal && t.app_version && t.created_at.slice(0, 10) >= start) ticketsByVersion.set(t.app_version, (ticketsByVersion.get(t.app_version) || 0) + 1);
  const perVersion = [...new Set([...installWeeks.keys(), ...ticketsByVersion.keys()])].sort(compareVersions).reverse().slice(0, 8).map(v => {
    const weeks = installWeeks.get(v) || 0, n = ticketsByVersion.get(v) || 0;
    return { version: v, tickets: n, installWeeks: weeks, rate: weeks ? Math.round((n / weeks) * 10000) / 10 : null };
  });
  const med = median(replyHours);
  const support = {
    weeks: weekList, opened: weekList.map(w => opened.get(w) || 0), closed: weekList.map(w => closed.get(w) || 0),
    openedInRange: weekList.reduce((a, w) => a + (opened.get(w) || 0), 0), closedInRange: weekList.reduce((a, w) => a + (closed.get(w) || 0), 0),
    medianFirstReplyHours: med === null ? null : Math.round(med * 10) / 10, replied: replyHours.length,
    openNow, ages, perVersion,
    topErrors: store.desk.listErrorGroups({ sinceDay: start, limit: 8 }).filter(g => g.recent > 0),
  };

  const history = all("SELECT month, dim, installs, days FROM monthly_rollups WHERE dim IN ('active','new') ORDER BY month DESC LIMIT 48");
  const months = new Map();
  for (const r of history) { const m = months.get(r.month) || { month: r.month, active: 0, days: 0, fresh: 0 }; if (r.dim === "active") { m.active = r.installs; m.days = r.days; } else m.fresh = r.installs; months.set(r.month, m); }

  return { days, today, start, installs, active, cohorts, versions, breakdowns, funnel, sharing, reach, community, support, history: [...months.values()] };
}

// Rolls heartbeat rows older than 13 months into monthly totals, then deletes
// them. Safe to run at any time and any number of times.
function runRetention(store, now = Date.now()) {
  const db = store.db, cutoff = retentionCutoff(now);
  const result = { cutoff, months: [], heartbeatsDeleted: 0, firstSeenPruned: 0, errorRowsDeleted: 0 };
  store.tx(() => {
    const months = db.prepare("SELECT DISTINCT substr(day, 1, 7) AS m FROM heartbeats WHERE day < ? ORDER BY m").all(cutoff).map(r => r.m);
    const put = db.prepare("INSERT OR REPLACE INTO monthly_rollups(month, dim, value, installs, days) VALUES (?, ?, ?, ?, ?)");
    for (const m of months) {
      const lo = `${m}-01`, hi = `${m}-31`;
      const a = db.prepare("SELECT COUNT(DISTINCT install) AS i, COUNT(*) AS d FROM heartbeats WHERE day BETWEEN ? AND ?").get(lo, hi);
      put.run(m, "active", "", a.i, a.d);
      put.run(m, "new", "", db.prepare("SELECT COUNT(*) AS c FROM first_seen WHERE day BETWEEN ? AND ?").get(lo, hi).c, 0);
      for (const [dim, col] of [["version", "app_version"], ["os", "os"], ["lang", "lang"], ["build", "COALESCE(build, '')"], ["channel", "channel"]])
        for (const r of db.prepare(`SELECT ${col} AS v, COUNT(DISTINCT install) AS i, COUNT(*) AS d FROM heartbeats WHERE day BETWEEN ? AND ? GROUP BY v`).all(lo, hi))
          put.run(m, dim, r.v, r.i, r.d);
      for (const [dim, col, names] of [["flag", "flags", FLAGS], ["area", "areas", HEARTBEAT_AREAS]])
        names.forEach((name, i) => {
          const r = db.prepare(`SELECT COUNT(DISTINCT install) AS i, COUNT(*) AS d FROM heartbeats WHERE day BETWEEN ? AND ? AND ${col} & ${1 << i}`).get(lo, hi);
          put.run(m, dim, name, r.i, r.d);
        });
      result.months.push(m);
    }
    result.heartbeatsDeleted = Number(db.prepare("DELETE FROM heartbeats WHERE day < ?").run(cutoff).changes);
    result.firstSeenPruned = Number(db.prepare("DELETE FROM first_seen WHERE day < ? AND install NOT IN (SELECT DISTINCT install FROM heartbeats)").run(cutoff).changes);
    if (result.firstSeenPruned) db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + ? WHERE k = 'first_seen_pruned'").run(result.firstSeenPruned);
    result.errorRowsDeleted = Number(db.prepare("DELETE FROM error_occurrences WHERE day < ?").run(cutoff).changes);
    db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('heartbeats_cutoff', ?)").run(cutoff);
    db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('retention_ran', ?)").run(new Date(now).toISOString());
  });
  return result;
}

function retentionStatus(store, now = Date.now()) {
  const db = store.db;
  const meta = (k) => (db.prepare("SELECT v FROM meta WHERE k = ?").get(k) || { v: null }).v;
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  let dbBytes = null;
  try { dbBytes = db.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").get().b; } catch { /* in-memory */ }
  return {
    cutoff: retentionCutoff(now), lastRun: meta("retention_ran"), lastBackup: meta("backup_ran"),
    oldestHeartbeat: db.prepare("SELECT MIN(day) AS d FROM heartbeats").get().d,
    rows: Object.fromEntries(["heartbeats", "first_seen", "monthly_rollups", "tickets", "messages", "error_groups", "error_occurrences",
      "announcements", "sessions", "audit", "obs", "reports", "blocked", "gh_downloads", "guilds", "guild_members", "guild_events", "guild_signups", "guild_summaries", "lfg"].map(t => [t, count(t)])),
    dbBytes,
  };
}

// Nightly copy of the database (VACUUM INTO), one file per UTC day, newest `keep` kept.
function runBackup(store, dir, now = Date.now(), keep = 14) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${dir.replace(/[\\/]+$/, "")}/community-${day(now)}.db`;
  if (fs.existsSync(file)) return { file, created: false };
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  store.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* not supported everywhere */ }
  const old = fs.readdirSync(dir).filter(f => /^community-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(`${dir}/${f}`, { force: true });
  store.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('backup_ran', ?)").run(new Date(now).toISOString());
  return { file, created: true, removed: old.length };
}

module.exports = { dashboard, runRetention, retentionStatus, retentionCutoff, runBackup, RANGES, day, addDays, mondayOf, isoWeek, median, pct };

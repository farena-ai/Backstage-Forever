"use strict";
// SQLite storage (node:sqlite, built in). Only aggregated-friendly facts are
// stored: one row per (kind, fact key, hashed install) with a counter and the
// first/last UTC day it was seen. No IPs, names of characters, GUIDs, realms,
// raw install ids or timestamps finer than a day are kept for observations.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 2;
const MAX_COUNTER = 1_000_000;

function day(now) { return new Date(now).toISOString().slice(0, 10); }

// Salted (keyed) SHA-256 of the install id. The raw id is never stored.
function hashInstall(salt, installId) {
  return crypto.createHmac("sha256", salt).update(String(installId).toLowerCase()).digest("hex");
}

function nodeIdent(n) { return n.objectId !== null ? `o${n.objectId}` : `n${n.name}`; }

// Expands one validated submission into storable facts: [kind, key, n].
function facts(sub) {
  const out = [];
  for (const n of sub.nodes) {
    const ident = nodeIdent(n);
    out.push(["node", `${n.kind}|${ident}|${n.mapId}|${n.x}|${n.y}`, 1]);
    for (const itemId of n.itemIds) out.push(["nodeitem", `${n.kind}|${ident}|${itemId}`, 1]);
  }
  for (const n of sub.npcs) out.push(["npc", `${n.npcId}|${n.mapId}|${n.x}|${n.y}`, 1]);
  for (const v of sub.vendors) for (const itemId of v.itemIds) out.push(["vendor", `${v.npcId}|${itemId}`, 1]);
  for (const d of sub.drops) {
    out.push(["droploot", `${d.npcId}`, d.loots]);
    for (const it of d.items) out.push(["drop", `${d.npcId}|${it.itemId}`, it.count]);
  }
  for (const r of sub.recipes) out.push(["recipe", `${r.source}|${r.npcId}|${r.spellId ?? ""}|${r.itemId ?? ""}`, 1]);
  return out;
}

// Schema 2 ("Backstage Desk"): statistics, tickets, error groups, announcements
// and the admin area. Every statement is idempotent so a half-applied upgrade
// can be re-run; nothing here touches the schema 1 tables or their rows.
const DESK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS heartbeats (
    install TEXT NOT NULL, day TEXT NOT NULL,
    app_version TEXT NOT NULL, addon_version TEXT, channel TEXT NOT NULL,
    os TEXT NOT NULL, os_major TEXT, lang TEXT NOT NULL, build TEXT,
    first_week TEXT NOT NULL, flags INTEGER NOT NULL, areas INTEGER NOT NULL,
    PRIMARY KEY (install, day)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS heartbeats_day ON heartbeats(day);
  CREATE TABLE IF NOT EXISTS first_seen (install TEXT PRIMARY KEY, day TEXT NOT NULL) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS first_seen_day ON first_seen(day);
  CREATE TABLE IF NOT EXISTS monthly_rollups (
    month TEXT NOT NULL, dim TEXT NOT NULL, value TEXT NOT NULL,
    installs INTEGER NOT NULL, days INTEGER NOT NULL,
    PRIMARY KEY (month, dim, value)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT, install TEXT,
    status TEXT NOT NULL DEFAULT 'new', fixed_in TEXT,
    kind TEXT NOT NULL, area TEXT NOT NULL, frequency TEXT,
    summary TEXT NOT NULL, expected TEXT NOT NULL DEFAULT '',
    app_version TEXT, addon_version TEXT, os TEXT, os_major TEXT, lang TEXT, build TEXT,
    diagnostics TEXT,
    tags TEXT NOT NULL DEFAULT '', severity TEXT, assignee INTEGER, github TEXT, duplicate_of INTEGER,
    last_from TEXT NOT NULL DEFAULT 'player',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, first_reply_at TEXT, closed_at TEXT
  );
  INSERT INTO sqlite_sequence(name, seq) SELECT 'tickets', 1000
    WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tickets');
  CREATE INDEX IF NOT EXISTS tickets_install ON tickets(install);
  CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    seq INTEGER, sender TEXT NOT NULL, admin INTEGER,
    text TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_ticket ON messages(ticket, seq);
  CREATE TABLE IF NOT EXISTS error_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signature TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, message TEXT NOT NULL, stack TEXT NOT NULL, origin TEXT NOT NULL,
    first_day TEXT NOT NULL, last_day TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, ticket INTEGER
  );
  CREATE TABLE IF NOT EXISTS error_occurrences (
    grp INTEGER NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
    app_version TEXT NOT NULL, os TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (grp, app_version, os, day)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS error_occurrences_day ON error_occurrences(day);
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, text TEXT NOT NULL, level TEXT NOT NULL, link TEXT,
    from_at TEXT NOT NULL, until_at TEXT NOT NULL,
    min_version TEXT, max_version TEXT, os TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '',
    created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL, totp_secret TEXT NOT NULL, totp_last_step INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY, admin INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_ms INTEGER NOT NULL, seen_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL, admin INTEGER, admin_name TEXT NOT NULL,
    action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    scope TEXT PRIMARY KEY, fails INTEGER NOT NULL, window_ms INTEGER NOT NULL, locked_until_ms INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;
  INSERT OR IGNORE INTO meta(k, v) VALUES ('first_seen_pruned', '0');
`;

class Store {
  constructor(dbPath) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    try {
      this.migrate();
      this.prepare();
    } catch (e) {
      this.db.close(); // do not hold the file open when the schema cannot be used
      throw e;
    }
    this.desk = new (require("./desk").Desk)(this);
  }

  migrate() {
    const { user_version: v } = this.db.prepare("PRAGMA user_version").get();
    if (v > SCHEMA_VERSION) throw new Error(`database schema ${v} is newer than this server (${SCHEMA_VERSION})`);
    if (v < 1) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS obs (
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          install TEXT NOT NULL,
          n INTEGER NOT NULL,
          first_day TEXT NOT NULL,
          last_day TEXT NOT NULL,
          PRIMARY KEY (kind, key, install)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS obs_install ON obs(install);
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          install TEXT NOT NULL,
          category TEXT NOT NULL,
          text TEXT NOT NULL,
          app_version TEXT,
          build TEXT,
          log TEXT,
          read INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS reports_install ON reports(install);
        CREATE TABLE IF NOT EXISTS blocked (install TEXT PRIMARY KEY, day TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS builds (
          build TEXT NOT NULL, day TEXT NOT NULL, submissions INTEGER NOT NULL,
          PRIMARY KEY (build, day)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
        INSERT OR IGNORE INTO meta(k, v) VALUES ('revision', '0');
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    if (v < 2) this.db.exec(`BEGIN;
${DESK_SCHEMA}
PRAGMA user_version = 2;
COMMIT;`);
  }

  prepare() {
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      upsertObs: p(`INSERT INTO obs(kind, key, install, n, first_day, last_day) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, key, install) DO UPDATE SET n = min(n + excluded.n, ${MAX_COUNTER}), last_day = excluded.last_day`),
      upsertBuild: p(`INSERT INTO builds(build, day, submissions) VALUES (?, ?, 1)
        ON CONFLICT(build, day) DO UPDATE SET submissions = submissions + 1`),
      bump: p("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'revision'"),
      revision: p("SELECT v FROM meta WHERE k = 'revision'"),
      isBlocked: p("SELECT 1 AS b FROM blocked WHERE install = ?"),
      addReport: p(`INSERT INTO reports(created_at, install, category, text, app_version, build, log) VALUES (?, ?, ?, ?, ?, ?, ?)`),
      countReports: p("SELECT COUNT(*) AS c FROM reports"),
      delObs: p("DELETE FROM obs WHERE install = ?"),
      delReports: p("DELETE FROM reports WHERE install = ?"),
      block: p("INSERT OR IGNORE INTO blocked(install, day) VALUES (?, ?)"),
      published: p(`SELECT kind, key, COUNT(*) AS installs FROM obs WHERE kind = ?
        GROUP BY kind, key HAVING COUNT(*) >= ? ORDER BY key`),
      dropRows: p(`SELECT d.key AS key, d.install AS install, d.n AS hits, COALESCE(l.n, 0) AS loots
        FROM obs d LEFT JOIN obs l
          ON l.kind = 'droploot' AND l.install = d.install AND l.key = substr(d.key, 1, instr(d.key, '|') - 1)
        WHERE d.kind = 'drop' AND d.key IN (SELECT key FROM obs WHERE kind = 'drop' GROUP BY key HAVING COUNT(*) >= ?)
        ORDER BY d.key`),
    };
  }

  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  revision() { return Number(this.q.revision.get().v); }
  isBlocked(hash) { return !!this.q.isBlocked.get(hash); }

  recordSubmission(hash, sub, now = Date.now()) {
    const d = day(now), list = facts(sub);
    this.tx(() => {
      for (const [kind, key, n] of list) this.q.upsertObs.run(kind, key, hash, n, d, d);
      if (sub.build) this.q.upsertBuild.run(sub.build, d);
      this.q.bump.run();
    });
    return list.length;
  }

  reportCount() { return this.q.countReports.get().c; }

  addReport(hash, r, now = Date.now()) {
    const createdAt = new Date(Math.floor(now / 60000) * 60000).toISOString();
    const info = this.q.addReport.run(createdAt, hash, r.category, r.text, r.appVersion ?? null, r.build ?? null, r.log);
    return Number(info.lastInsertRowid);
  }

  // Removes everything an install contributed (observations, old reports,
  // tickets with their messages, heartbeats, first-seen). With block=true,
  // future submissions, reports, tickets and heartbeats from it are refused.
  purgeInstall(hash, { block = false, now = Date.now() } = {}) {
    return this.tx(() => {
      const observations = Number(this.q.delObs.run(hash).changes);
      const reports = Number(this.q.delReports.run(hash).changes);
      const desk = this.desk.purgeInstall(hash);
      if (block) this.q.block.run(hash, day(now));
      this.q.bump.run();
      return { observations, reports, tickets: desk.tickets, heartbeats: desk.heartbeats, blocked: block };
    });
  }

  // Refuses everything that install sends from now on; what it already sent stays.
  blockInstall(hash, now = Date.now()) { return Number(this.q.block.run(hash, day(now)).changes); }

  published(kind, minInstalls) { return this.q.published.all(kind, minInstalls); }
  dropRows(minInstalls) { return this.q.dropRows.all(minInstalls); }

  // --- admin helpers ---
  listReports({ all = false, limit = 50 } = {}) {
    return this.db.prepare(`SELECT id, created_at, category, app_version, build, read, length(log) AS log_bytes,
      substr(text, 1, 160) AS preview FROM reports ${all ? "" : "WHERE read = 0"} ORDER BY id DESC LIMIT ?`).all(limit);
  }
  getReport(id) { return this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id); }
  markRead(id) { return Number(this.db.prepare("UPDATE reports SET read = 1 WHERE id = ?").run(id).changes); }
  deleteReport(id) { return Number(this.db.prepare("DELETE FROM reports WHERE id = ?").run(id).changes); }

  stats(now = Date.now()) {
    const since = (days) => day(now - days * 86400000);
    const g = (sql, ...a) => this.db.prepare(sql).get(...a);
    return {
      observationsByKind: Object.fromEntries(this.db.prepare(
        "SELECT kind, COUNT(*) AS rows, COUNT(DISTINCT key) AS facts FROM obs GROUP BY kind ORDER BY kind").all()
        .map(r => [r.kind, { rows: r.rows, facts: r.facts }])),
      installs: {
        total: g("SELECT COUNT(DISTINCT install) AS c FROM obs").c,
        last7Days: g("SELECT COUNT(DISTINCT install) AS c FROM obs WHERE last_day >= ?", since(7)).c,
        last30Days: g("SELECT COUNT(DISTINCT install) AS c FROM obs WHERE last_day >= ?", since(30)).c,
        blocked: g("SELECT COUNT(*) AS c FROM blocked").c,
      },
      reports: { total: this.reportCount(), unread: g("SELECT COUNT(*) AS c FROM reports WHERE read = 0").c },
      builds30Days: this.db.prepare("SELECT build, SUM(submissions) AS submissions FROM builds WHERE day >= ? GROUP BY build ORDER BY submissions DESC LIMIT 20").all(since(30)),
      revision: this.revision(),
    };
  }

  ping() { return this.db.prepare("SELECT 1 AS ok").get().ok === 1; }
  close() { this.db.close(); }
}

module.exports = { Store, hashInstall, facts, day, SCHEMA_VERSION };

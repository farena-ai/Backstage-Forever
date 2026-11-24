"use strict";
// Backstage Desk storage: heartbeats, tickets and their messages, error
// groups, announcements, saved replies and the audit log. Everything works on
// the Store's database handle. Install ids appear only as the salted hash;
// ticket keys only as a SHA-256.
const crypto = require("node:crypto");
const { FLAGS, HEARTBEAT_AREAS, ticketLabel, compareVersions, chars } = require("./validate-desk");

function day(now) { return new Date(now).toISOString().slice(0, 10); }
function iso(now) { return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function sha256(text) { return crypto.createHash("sha256").update(text).digest(); }
function bits(names, all) { let m = 0; for (const n of names) m |= 1 << all.indexOf(n); return m; }
function flagBits(flags) { return bits(FLAGS.filter(f => flags[f]), FLAGS); }
function areaBits(areas) { return bits(areas, HEARTBEAT_AREAS); }
function likeEscape(s) { return s.replace(/[\\%_]/g, "\\$&"); }

// The signature ignores line and column numbers so one fault groups together
// across releases: name + the first three stack lines.
function errorSignature(name, stack) {
  const lines = stack.slice(0, 3).map(l => l.replace(/:\d+(?::\d+)?(?=\)?\s*$)/, "").trim());
  return crypto.createHash("sha256").update([name, ...lines].join("\n")).digest("hex").slice(0, 32);
}

const PAGE = 25;
const TICKET_FILTERS = Object.freeze({
  open: "t.status IN ('new','looking','question')",
  new: "t.status = 'new'",
  us: "t.status = 'looking'",
  player: "t.status = 'question'",
  fixed: "t.status = 'fixed'",
  closed: "t.status = 'closed'",
  all: "1 = 1",
});

class Desk {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.cache = new Map();
    // Compared against when a ticket does not exist, so a miss costs the same as a wrong key.
    this.dummyKeyHash = crypto.randomBytes(32);
  }

  p(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get(sql, ...a) { return this.p(sql).get(...a); }
  all(sql, ...a) { return this.p(sql).all(...a); }
  run(sql, ...a) { return this.p(sql).run(...a); }

  // ---------------------------------------------------------------- heartbeat
  recordHeartbeat(hash, hb, now = Date.now()) {
    const d = day(now);
    this.store.tx(() => {
      this.run(`INSERT INTO heartbeats(install, day, app_version, addon_version, channel, os, os_major, lang, build, first_week, flags, areas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(install, day) DO UPDATE SET app_version = excluded.app_version, addon_version = excluded.addon_version,
          channel = excluded.channel, os = excluded.os, os_major = excluded.os_major, lang = excluded.lang, build = excluded.build,
          first_week = excluded.first_week, flags = excluded.flags, areas = excluded.areas`,
        hash, d, hb.appVersion, hb.addonVersion, hb.channel, hb.os, hb.osMajor, hb.lang, hb.build, hb.firstSeenWeek,
        flagBits(hb.flags), areaBits(hb.areas));
      this.run("INSERT OR IGNORE INTO first_seen(install, day) VALUES (?, ?)", hash, d);
    });
  }

  // ------------------------------------------------------------------ tickets
  openTicketCount() { return this.get("SELECT COUNT(*) AS c FROM tickets WHERE status <> 'closed'").c; }

  createTicket(hash, t, now = Date.now()) {
    const key = crypto.randomBytes(32).toString("base64url");
    const at = iso(now);
    const id = this.store.tx(() => {
      const info = this.run(`INSERT INTO tickets(key_hash, install, status, kind, area, frequency, summary, expected,
          app_version, addon_version, os, os_major, lang, build, diagnostics, last_from, created_at, updated_at)
        VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?, ?)`,
        sha256(key).toString("hex"), hash, t.kind, t.area, t.frequency, t.summary, t.expected,
        t.appVersion, t.addonVersion, t.os, t.osMajor, t.lang, t.build,
        t.diagnostics ? JSON.stringify(t.diagnostics) : null, at, at);
      const tid = Number(info.lastInsertRowid);
      this.run("INSERT INTO messages(ticket, seq, sender, text, at) VALUES (?, 1, 'player', ?, ?)", tid, t.details, at);
      return tid;
    });
    return { id, ticket: ticketLabel(id), key, status: "new", createdAt: at };
  }

  // The only way the public API reaches a ticket. Constant-time on the key
  // hash; a missing ticket, an internal ticket and a wrong key look the same.
  ticketByKey(number, key) {
    const row = this.get("SELECT * FROM tickets WHERE id = ?", number);
    const stored = row && row.key_hash ? Buffer.from(row.key_hash, "hex") : this.dummyKeyHash;
    const match = crypto.timingSafeEqual(stored, sha256(String(key)));
    return match && row && row.key_hash ? row : null;
  }

  publicTicket(row, since = 0) {
    return {
      ok: true, ticket: ticketLabel(row.id), status: row.status, fixedIn: row.fixed_in, kind: row.kind, area: row.area,
      summary: row.summary, createdAt: row.created_at, updatedAt: row.updated_at,
      messages: this.all("SELECT seq, sender, text, at FROM messages WHERE ticket = ? AND seq > ? AND sender IN ('player','team') ORDER BY seq", row.id, since)
        .map(m => ({ id: m.seq, from: m.sender, text: m.text, at: m.at })),
    };
  }

  nextSeq(id) { return this.get("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE ticket = ?", id).n; }

  playerReply(row, text, now = Date.now()) {
    const at = iso(now);
    const status = ["fixed", "closed", "question"].includes(row.status) ? "looking" : row.status;
    const seq = this.store.tx(() => {
      const n = this.nextSeq(row.id);
      this.run("INSERT INTO messages(ticket, seq, sender, text, at) VALUES (?, ?, 'player', ?, ?)", row.id, n, text, at);
      this.run("UPDATE tickets SET status = ?, last_from = 'player', updated_at = ?, closed_at = CASE WHEN ? IN ('fixed','closed') THEN closed_at ELSE NULL END WHERE id = ?",
        status, at, status, row.id);
      return n;
    });
    return { id: seq, at, status };
  }

  syncTickets(list) {
    const tickets = [], gone = [];
    for (const t of list) {
      const row = this.ticketByKey(t.number, t.key);
      if (!row) { gone.push(t.ticket); continue; }
      const m = this.get(`SELECT COALESCE(MAX(seq), 0) AS last, COALESCE(SUM(CASE WHEN sender = 'team' AND seq > ? THEN 1 ELSE 0 END), 0) AS unread
        FROM messages WHERE ticket = ? AND sender IN ('player','team')`, t.since, row.id);
      tickets.push({ ticket: t.ticket, status: row.status, fixedIn: row.fixed_in, updatedAt: row.updated_at, unread: m.unread, lastId: m.last });
    }
    return { tickets, gone };
  }

  deleteTicket(id) {
    return this.store.tx(() => {
      this.run("DELETE FROM messages WHERE ticket = ?", id);
      this.run("UPDATE tickets SET duplicate_of = NULL WHERE duplicate_of = ?", id);
      this.run("UPDATE error_groups SET ticket = NULL WHERE ticket = ?", id);
      return Number(this.run("DELETE FROM tickets WHERE id = ?", id).changes);
    });
  }

  // Called inside Store.purgeInstall's transaction.
  purgeInstall(hash) {
    const ids = this.all("SELECT id FROM tickets WHERE install = ?", hash).map(r => r.id);
    for (const id of ids) {
      this.run("DELETE FROM messages WHERE ticket = ?", id);
      this.run("UPDATE tickets SET duplicate_of = NULL WHERE duplicate_of = ?", id);
      this.run("UPDATE error_groups SET ticket = NULL WHERE ticket = ?", id);
    }
    this.run("DELETE FROM tickets WHERE install = ?", hash);
    const heartbeats = Number(this.run("DELETE FROM heartbeats WHERE install = ?", hash).changes);
    this.run("DELETE FROM first_seen WHERE install = ?", hash);
    return { tickets: ids.length, heartbeats };
  }

  // ------------------------------------------------------------ admin: tickets
  getTicket(id) { return this.get("SELECT t.*, a.name AS assignee_name FROM tickets t LEFT JOIN admins a ON a.id = t.assignee WHERE t.id = ?", id); }

  ticketMessages(id) {
    return this.all("SELECT m.id, m.seq, m.sender, m.text, m.at, a.name AS admin_name FROM messages m LEFT JOIN admins a ON a.id = m.admin WHERE m.ticket = ? ORDER BY m.id", id);
  }

  listTickets({ filter = "open", q = "", kind, area, version, os, lang, severity, tag, assignee, page = 1 } = {}) {
    const where = [TICKET_FILTERS[filter] || TICKET_FILTERS.open], args = [];
    const eq = (col, v) => { if (v) { where.push(`t.${col} = ?`); args.push(v); } };
    eq("kind", kind); eq("area", area); eq("app_version", version); eq("os", os); eq("lang", lang);
    if (severity === "none") where.push("t.severity IS NULL"); else eq("severity", severity);
    if (assignee === "none") where.push("t.assignee IS NULL");
    else if (assignee) { where.push("t.assignee = ?"); args.push(Number(assignee) || 0); }
    if (tag) { where.push("(' ' || t.tags || ' ') LIKE ? ESCAPE '\\'"); args.push(`% ${likeEscape(tag)} %`); }
    if (q) {
      const like = `%${likeEscape(q)}%`;
      const n = /^(?:BF-)?(\d{1,9})$/i.exec(q.trim());
      where.push(`(t.summary LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.ticket = t.id AND m.text LIKE ? ESCAPE '\\')${n ? " OR t.id = ?" : ""})`);
      args.push(like, like);
      if (n) args.push(Number(n[1]));
    }
    const w = where.join(" AND ");
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM tickets t WHERE ${w}`).get(...args).c;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(Math.max(1, page), pages);
    const rows = this.db.prepare(`SELECT t.id, t.status, t.kind, t.area, t.summary, t.app_version, t.os, t.lang, t.severity, t.tags,
        t.created_at, t.updated_at, t.last_from, t.fixed_in, t.install IS NULL AS internal, a.name AS assignee_name,
        (SELECT COUNT(*) FROM messages m WHERE m.ticket = t.id AND m.sender <> 'note') AS messages
      FROM tickets t LEFT JOIN admins a ON a.id = t.assignee WHERE ${w} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE, (p - 1) * PAGE);
    return { rows, total, page: p, pages };
  }

  ticketCounts() {
    const c = { new: 0, looking: 0, question: 0, fixed: 0, closed: 0 };
    for (const r of this.all("SELECT status, COUNT(*) AS c FROM tickets GROUP BY status")) c[r.status] = r.c;
    return { ...c, open: c.new + c.looking + c.question, all: c.new + c.looking + c.question + c.fixed + c.closed };
  }

  ticketFacets() {
    const col = (c) => this.db.prepare(`SELECT DISTINCT ${c} AS v FROM tickets WHERE ${c} IS NOT NULL ORDER BY 1`).all().map(r => r.v);
    const tags = new Set();
    for (const r of this.all("SELECT DISTINCT tags FROM tickets WHERE tags <> ''")) for (const t of r.tags.split(" ")) if (t) tags.add(t);
    return {
      kind: col("kind"), area: col("area"), version: col("app_version").sort(compareVersions).reverse(), os: col("os"), lang: col("lang"),
      tag: [...tags].sort(),
    };
  }

  otherTickets(install, exceptId) {
    if (!install) return [];
    return this.all("SELECT id, status, kind, summary, created_at FROM tickets WHERE install = ? AND id <> ? ORDER BY id DESC LIMIT 20", install, exceptId);
  }

  adminReply(id, adminId, text, status, now = Date.now()) {
    const at = iso(now);
    return this.store.tx(() => {
      const t = this.get("SELECT status FROM tickets WHERE id = ?", id);
      if (!t) return null;
      const next = status || (t.status === "new" ? "looking" : t.status);
      const n = this.nextSeq(id);
      this.run("INSERT INTO messages(ticket, seq, sender, admin, text, at) VALUES (?, ?, 'team', ?, ?, ?)", id, n, adminId, text, at);
      this.run(`UPDATE tickets SET status = ?, last_from = 'team', updated_at = ?, first_reply_at = COALESCE(first_reply_at, ?),
        closed_at = CASE WHEN ? IN ('fixed','closed') THEN COALESCE(closed_at, ?) ELSE NULL END WHERE id = ?`, next, at, at, next, at, id);
      return { seq: n, status: next };
    });
  }

  addNote(id, adminId, text, now = Date.now()) {
    return Number(this.run("INSERT INTO messages(ticket, seq, sender, admin, text, at) SELECT id, NULL, 'note', ?, ?, ? FROM tickets WHERE id = ?",
      adminId, text, iso(now), id).changes);
  }

  // fields: status, fixedIn, severity, tags, assignee, github, duplicateOf (each optional).
  // Only status and fixedIn are visible to the player, so only they move updated_at.
  updateTicket(id, f, now = Date.now()) {
    const at = iso(now);
    return this.store.tx(() => {
      const t = this.get("SELECT * FROM tickets WHERE id = ?", id);
      if (!t) return null;
      const next = {
        status: f.status ?? t.status,
        fixed_in: f.fixedIn !== undefined ? f.fixedIn : t.fixed_in,
        severity: f.severity !== undefined ? f.severity : t.severity,
        tags: f.tags !== undefined ? f.tags : t.tags,
        assignee: f.assignee !== undefined ? f.assignee : t.assignee,
        github: f.github !== undefined ? f.github : t.github,
        duplicate_of: f.duplicateOf !== undefined ? f.duplicateOf : t.duplicate_of,
      };
      const changed = Object.keys(next).filter(k => next[k] !== t[k]);
      if (!changed.length) return { changed };
      const visible = changed.includes("status") || changed.includes("fixed_in");
      const done = ["fixed", "closed"].includes(next.status);
      this.run(`UPDATE tickets SET status = ?, fixed_in = ?, severity = ?, tags = ?, assignee = ?, github = ?, duplicate_of = ?,
        updated_at = ?, closed_at = ? WHERE id = ?`,
        next.status, next.fixed_in, next.severity, next.tags, next.assignee, next.github, next.duplicate_of,
        visible ? at : t.updated_at, done ? (t.closed_at || at) : null, id);
      return { changed };
    });
  }

  exportTickets() {
    const out = [];
    for (const t of this.all("SELECT * FROM tickets ORDER BY id")) {
      out.push({
        ticket: ticketLabel(t.id), internal: !t.install, install: t.install ? t.install.slice(0, 8) : null,
        status: t.status, fixedIn: t.fixed_in, kind: t.kind, area: t.area, frequency: t.frequency,
        summary: t.summary, expected: t.expected, appVersion: t.app_version, addonVersion: t.addon_version,
        os: t.os, osMajor: t.os_major, lang: t.lang, build: t.build,
        diagnostics: t.diagnostics ? JSON.parse(t.diagnostics) : null,
        tags: t.tags ? t.tags.split(" ") : [], severity: t.severity, github: t.github,
        duplicateOf: t.duplicate_of ? ticketLabel(t.duplicate_of) : null,
        createdAt: t.created_at, updatedAt: t.updated_at, firstReplyAt: t.first_reply_at, closedAt: t.closed_at,
        messages: this.ticketMessages(t.id).map(m => ({ id: m.seq, from: m.sender, admin: m.admin_name || null, text: m.text, at: m.at })),
      });
    }
    return out;
  }

  // ------------------------------------------------------------------- errors
  // Returns false when the group cap is reached and the report was dropped.
  recordError(e, now = Date.now(), maxGroups = 5000) {
    const d = day(now), signature = errorSignature(e.name, e.stack);
    return this.store.tx(() => {
      let g = this.get("SELECT id FROM error_groups WHERE signature = ?", signature);
      if (!g) {
        if (this.get("SELECT COUNT(*) AS c FROM error_groups").c >= maxGroups) return false;
        const info = this.run("INSERT INTO error_groups(signature, name, message, stack, origin, first_day, last_day, total) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
          signature, e.name, e.message, JSON.stringify(e.stack), e.where, d, d);
        g = { id: Number(info.lastInsertRowid) };
      }
      this.run("UPDATE error_groups SET total = total + 1, last_day = ? WHERE id = ?", d, g.id);
      this.run(`INSERT INTO error_occurrences(grp, app_version, os, day, n) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(grp, app_version, os, day) DO UPDATE SET n = n + 1`, g.id, e.appVersion, e.os, d);
      return true;
    });
  }

  listErrorGroups({ sinceDay = "0000-00-00", limit = 200 } = {}) {
    return this.all(`SELECT g.id, g.name, g.message, g.origin, g.first_day, g.last_day, g.total, g.ticket,
        COALESCE(SUM(o.n), 0) AS recent, COUNT(DISTINCT o.app_version) AS versions
      FROM error_groups g LEFT JOIN error_occurrences o ON o.grp = g.id AND o.day >= ?
      GROUP BY g.id ORDER BY recent DESC, g.total DESC, g.id DESC LIMIT ?`, sinceDay, limit);
  }

  getErrorGroup(id) {
    const g = this.get("SELECT * FROM error_groups WHERE id = ?", id);
    if (!g) return null;
    return {
      ...g, stack: JSON.parse(g.stack),
      byVersion: this.all("SELECT app_version, SUM(n) AS n, MIN(day) AS first_day, MAX(day) AS last_day FROM error_occurrences WHERE grp = ? GROUP BY app_version", id)
        .sort((a, b) => compareVersions(b.app_version, a.app_version)),
      byOs: this.all("SELECT os, SUM(n) AS n FROM error_occurrences WHERE grp = ? GROUP BY os ORDER BY n DESC", id),
      byDay: this.all("SELECT day, SUM(n) AS n FROM error_occurrences WHERE grp = ? GROUP BY day ORDER BY day", id),
    };
  }

  // An internal ticket has no player: no install hash and no key, so the public API can never reach it.
  ticketFromErrorGroup(id, adminId, now = Date.now()) {
    const at = iso(now);
    return this.store.tx(() => {
      const g = this.get("SELECT * FROM error_groups WHERE id = ?", id);
      if (!g) return null;
      if (g.ticket && this.get("SELECT 1 AS x FROM tickets WHERE id = ?", g.ticket)) return g.ticket;
      let summary = `${g.name}: ${g.message}`.replace(/\s+/g, " ").trim();
      if (chars(summary) > 140) summary = [...summary].slice(0, 139).join("") + "…";
      const latest = this.get("SELECT app_version, os FROM error_occurrences WHERE grp = ? ORDER BY day DESC LIMIT 1", id);
      const info = this.run(`INSERT INTO tickets(key_hash, install, status, kind, area, summary, app_version, os, tags, assignee, last_from, created_at, updated_at)
        VALUES (NULL, NULL, 'looking', 'bug', 'other', ?, ?, ?, 'auto-error', ?, 'team', ?, ?)`,
        summary, latest ? latest.app_version : null, latest ? latest.os : null, adminId, at, at);
      const tid = Number(info.lastInsertRowid);
      this.run("INSERT INTO messages(ticket, seq, sender, admin, text, at) VALUES (?, NULL, 'note', ?, ?, ?)", tid, adminId,
        `Made from error group #${g.id} (${g.origin} process, ${g.total} reports, first seen ${g.first_day}).\n\n${g.name}: ${g.message}\n${JSON.parse(g.stack).join("\n")}`, at);
      this.run("UPDATE error_groups SET ticket = ? WHERE id = ?", tid, id);
      return tid;
    });
  }

  // ------------------------------------------------------------ announcements
  listAnnouncements() { return this.all("SELECT * FROM announcements ORDER BY until_at DESC, id DESC"); }
  getAnnouncement(id) { return this.get("SELECT * FROM announcements WHERE id = ?", id); }

  saveAnnouncement(a, adminId, now = Date.now()) {
    const at = iso(now);
    const vals = [a.title, a.text, a.level, a.link, a.from, a.until, a.minVersion, a.maxVersion, a.os.join(","), a.lang.join(",")];
    if (a.id) {
      const n = this.run(`UPDATE announcements SET title = ?, text = ?, level = ?, link = ?, from_at = ?, until_at = ?, min_version = ?, max_version = ?,
        os = ?, lang = ?, updated_at = ? WHERE id = ?`, ...vals, at, a.id).changes;
      return Number(n) ? a.id : null;
    }
    return Number(this.run(`INSERT INTO announcements(title, text, level, link, from_at, until_at, min_version, max_version, os, lang, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...vals, adminId, at, at).lastInsertRowid);
  }

  expireAnnouncement(id, now = Date.now()) {
    const at = iso(now);
    return Number(this.run("UPDATE announcements SET until_at = ?, from_at = MIN(from_at, ?), updated_at = ? WHERE id = ? AND until_at > ?", at, at, at, id, at).changes);
  }

  // Server-side targeting. A filter the caller did not send matches only
  // announcements that do not target on that dimension.
  activeAnnouncements({ appVersion, os, lang }, now = Date.now()) {
    const at = iso(now);
    return this.all("SELECT * FROM announcements WHERE from_at <= ? AND until_at > ? ORDER BY id", at, at).filter(a => {
      if (a.min_version && (!appVersion || compareVersions(appVersion, a.min_version) < 0)) return false;
      if (a.max_version && (!appVersion || compareVersions(appVersion, a.max_version) > 0)) return false;
      if (a.os && (!os || !a.os.split(",").includes(os))) return false;
      if (a.lang && (!lang || !a.lang.split(",").includes(lang))) return false;
      return true;
    }).map(a => ({ id: a.id, title: a.title, text: a.text, level: a.level, from: a.from_at, until: a.until_at, link: a.link }));
  }

  // ------------------------------------------------------------ saved replies
  listSavedReplies() { return this.all("SELECT * FROM saved_replies ORDER BY title COLLATE NOCASE, id"); }
  saveSavedReply({ id, title, body }, now = Date.now()) {
    if (id) return Number(this.run("UPDATE saved_replies SET title = ?, body = ?, updated_at = ? WHERE id = ?", title, body, iso(now), id).changes) ? id : null;
    return Number(this.run("INSERT INTO saved_replies(title, body, updated_at) VALUES (?, ?, ?)", title, body, iso(now)).lastInsertRowid);
  }
  deleteSavedReply(id) { return Number(this.run("DELETE FROM saved_replies WHERE id = ?", id).changes); }

  // -------------------------------------------------------------------- audit
  // detail is a short machine-made summary ("status=fixed"); never player text.
  audit(admin, action, target = "", detail = "", now = Date.now()) {
    this.run("INSERT INTO audit(at, admin, admin_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)",
      iso(now), admin ? admin.id : null, admin ? admin.name : "(none)", action, String(target).slice(0, 80), String(detail).slice(0, 200));
  }
  listAudit(page = 1, size = 50) {
    const total = this.get("SELECT COUNT(*) AS c FROM audit").c;
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, page), pages);
    return { rows: this.all("SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?", size, (p - 1) * size), total, page: p, pages };
  }
}

module.exports = { Desk, day, iso, sha256, flagBits, areaBits, errorSignature, TICKET_FILTERS, PAGE };

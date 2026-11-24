"use strict";
// Backstage Live storage: linked guilds and their members, guild events and
// sign-ups, the Discord link and the realm party board. Everything works on
// the Store's database handle.
//
// What is kept, and only for guilds whose members opted in: the guild's name,
// realm and faction; each member's character name, realm, role and rank index;
// for a member who linked Discord, the Discord user id and display name; the
// Discord server and channel ids and names; events, sign-ups and listings.
// Install ids appear only as the salted hash; link codes, member tokens and
// Discord link codes only as hashes. No IP address is ever stored.
const crypto = require("node:crypto");
const { asciiLower, nameKey, realmKey, CODE_ALPHABET } = require("./validate-live");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    realm TEXT NOT NULL, realm_key TEXT NOT NULL, faction TEXT NOT NULL,
    name TEXT NOT NULL, name_key TEXT NOT NULL, code_hash TEXT NOT NULL,
    officer_rank INTEGER NOT NULL DEFAULT 1, propose_rank INTEGER NOT NULL DEFAULT 9, edit_rank INTEGER NOT NULL DEFAULT 1,
    discord_state TEXT NOT NULL DEFAULT 'none', discord_guild TEXT, discord_guild_name TEXT,
    discord_channel TEXT, discord_channel_name TEXT, discord_problem TEXT,
    discord_nonce TEXT, discord_nonce_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, active_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE UNIQUE INDEX IF NOT EXISTS guilds_name ON guilds(realm_key, faction, name_key);
  CREATE UNIQUE INDEX IF NOT EXISTS guilds_code ON guilds(code_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS guilds_discord ON guilds(discord_guild) WHERE discord_guild IS NOT NULL;
  CREATE TABLE IF NOT EXISTS guild_members (
    guild TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name_key TEXT NOT NULL, name TEXT NOT NULL, realm TEXT NOT NULL,
    install TEXT NOT NULL, token_hash TEXT NOT NULL,
    role TEXT NOT NULL, rank INTEGER NOT NULL, founder INTEGER NOT NULL DEFAULT 0,
    discord_user TEXT, discord_name TEXT,
    joined_at TEXT NOT NULL, seen_at TEXT NOT NULL,
    PRIMARY KEY (guild, name_key)
  ) WITHOUT ROWID;
  CREATE UNIQUE INDEX IF NOT EXISTS guild_members_token ON guild_members(token_hash);
  CREATE INDEX IF NOT EXISTS guild_members_install ON guild_members(install);
  CREATE TABLE IF NOT EXISTS guild_events (
    guild TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    id TEXT NOT NULL, version INTEGER NOT NULL,
    creator_name TEXT NOT NULL, creator_realm TEXT NOT NULL, editor_name TEXT, editor_realm TEXT,
    at TEXT NOT NULL, at_ms INTEGER NOT NULL, place TEXT NOT NULL, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    tank INTEGER NOT NULL, healer INTEGER NOT NULL, damage INTEGER NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0, relayed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    discord_message TEXT, discord_channel TEXT, discord_event TEXT, discord_sig TEXT,
    reminded INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS guild_events_at ON guild_events(at_ms);
  CREATE TABLE IF NOT EXISTS guild_signups (
    guild TEXT NOT NULL, event TEXT NOT NULL, name_key TEXT NOT NULL, name TEXT NOT NULL, realm TEXT NOT NULL,
    answer TEXT NOT NULL, version INTEGER NOT NULL, via TEXT NOT NULL, relayed INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
    PRIMARY KEY (guild, event, name_key),
    FOREIGN KEY (guild, event) REFERENCES guild_events(guild, id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS guild_summaries (
    guild TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    event TEXT NOT NULL, title TEXT NOT NULL, place TEXT NOT NULL, at TEXT NOT NULL, at_ms INTEGER NOT NULL,
    attended INTEGER NOT NULL, bosses INTEGER, duration_sec INTEGER, created_at TEXT NOT NULL,
    PRIMARY KEY (guild, event)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS discord_codes (
    code_hash TEXT PRIMARY KEY, discord_guild TEXT NOT NULL, discord_user TEXT NOT NULL, discord_name TEXT NOT NULL, expires_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS lfg (
    id TEXT PRIMARY KEY, install TEXT NOT NULL UNIQUE,
    realm TEXT NOT NULL, realm_key TEXT NOT NULL, faction TEXT NOT NULL,
    kind TEXT NOT NULL, name TEXT NOT NULL, who_realm TEXT NOT NULL, level INTEGER NOT NULL, class TEXT,
    roles TEXT NOT NULL, place TEXT NOT NULL, note TEXT NOT NULL, need TEXT,
    at TEXT NOT NULL, expires_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS lfg_board ON lfg(realm_key, faction, expires_ms);
  CREATE TABLE IF NOT EXISTS live_daily (
    day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (day, metric)
  ) WITHOUT ROWID;
`;

const HOUR = 3_600_000, DAY = 86_400_000;
const AFTER_MS = 4 * HOUR; // an event leaves the live list four hours after it began, as in the addon
const AHEAD_MS = 180 * DAY;
const EVENT_KEEP_MS = 14 * DAY; // a past event is deleted (with its sign-ups) after this
const SUMMARY_KEEP_MS = 180 * DAY;
const REMIND_MS = 15 * 60_000;
const LFG_TTL_MS = 30 * 60_000;
const DISCORD_CODE_MS = 15 * 60_000;
const DISCORD_PENDING_MS = 15 * 60_000;
const MAX_LIVE_EVENTS = 60, MAX_SIGNUPS = 40, MAX_VERSION = 9999, LFG_PAGE = 200;
const METRICS = Object.freeze(["guild_linked", "event_created", "signup_game", "signup_desktop", "signup_discord", "listing"]);

function day(now) { return new Date(now).toISOString().slice(0, 10); }
function iso(now) { return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function sha256hex(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }
// Typed codes are short, so they are hashed with the server's secret salt: a copy of the database
// alone is not enough to try them all.
function codeHash(salt, code) { return crypto.createHmac("sha256", salt).update(`code:${code}`).digest("hex"); }
function randomCode(prefix) {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; out.length < 8 && i < 16; i++) if (bytes[i] < 248) out += CODE_ALPHABET[bytes[i] % 31]; // 248 = 8 * 31: no bias
  if (out.length < 8) return randomCode(prefix);
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`;
}
function newGuildId() { return `g_${crypto.randomBytes(12).toString("base64url")}`; }
function newToken() { return crypto.randomBytes(32).toString("base64url"); }

// ------------------------------------------------------------- the merge rule
// Mirrors BackstageForeverEventMerge in addon/BackstageForever/BackstageForeverEvents.lua.
// Names compare as the addon compares them: ASCII letters folded to lower case, then byte by byte.
function sameName(a, b) { return asciiLower(a) === asciiLower(b); }
function compareNames(a, b) { return Buffer.compare(Buffer.from(asciiLower(a), "utf8"), Buffer.from(asciiLower(b), "utf8")); }
// Who speaks for this version of the event: its editor, or its creator when nobody else edited it.
function eventAuthor(e) { return e.editor && !sameName(e.editor.name, e.creator.name) ? e.editor.name : e.creator.name; }

// Pure. old: the stored event or null ({version, creator:{name}, editor:{name}|null, relayed}).
// incoming: the event that arrived. direct: it came from its own author (not passed on by somebody else).
// -> { accept, reason } with reason one of new, newer, tie, author (accepted) and creator, older, hearsay (refused).
function eventDecision(old, incoming, direct) {
  if (!old) return { accept: true, reason: "new" };
  if (!sameName(old.creator.name, incoming.creator.name)) return { accept: false, reason: "creator" };
  if (direct) {
    // What its author says replaces hearsay; otherwise the higher version, then the later name.
    if (old.relayed) return { accept: true, reason: "author" };
    if (incoming.version > old.version) return { accept: true, reason: "newer" };
    if (incoming.version === old.version && compareNames(eventAuthor(incoming), eventAuthor(old)) > 0) return { accept: true, reason: "tie" };
    return { accept: false, reason: "older" };
  }
  if (!old.relayed) return { accept: false, reason: "hearsay" };
  return incoming.version > old.version ? { accept: true, reason: "newer" } : { accept: false, reason: "older" };
}

// Pure. Mirrors BackstageForeverEventSign: a member speaks for themselves; an answer somebody
// else passed on never replaces a newer or equal one.
function signupDecision(old, version, direct) {
  if (!old) return true;
  if (direct) return !!old.relayed || version > old.version;
  return version > old.version;
}

function roleFor(rank, officerRank) { return rank === 0 ? "leader" : rank <= officerRank ? "officer" : "member"; }

function eventShape(r) {
  const creator = { name: r.creator_name, realm: r.creator_realm };
  return {
    id: r.id, version: r.version, creator, editor: r.editor_name ? { name: r.editor_name, realm: r.editor_realm } : { ...creator },
    at: r.at, place: r.place, title: r.title, note: r.note,
    roles: { tank: r.tank, healer: r.healer, damage: r.damage }, cancelled: !!r.cancelled,
  };
}
function signupShape(r) { return { who: { name: r.name, realm: r.realm }, answer: r.answer, version: r.version, via: r.via }; }
function listingShape(r) {
  return {
    id: r.id, kind: r.kind, who: { name: r.name, realm: r.who_realm }, level: r.level, class: r.class,
    roles: r.roles ? r.roles.split(",") : [], place: r.place, note: r.note, need: r.need ? JSON.parse(r.need) : null, at: r.at,
  };
}
function discordView(g) {
  return {
    state: g.discord_state, guildName: g.discord_guild_name || null,
    channel: g.discord_channel_name ? `#${g.discord_channel_name}` : null, problem: g.discord_problem || null,
  };
}

class Guilds {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.cache = new Map();
  }

  p(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get(sql, ...a) { return this.p(sql).get(...a); }
  all(sql, ...a) { return this.p(sql).all(...a); }
  run(sql, ...a) { return this.p(sql).run(...a); }

  bump(metric, now, n = 1) {
    this.run("INSERT INTO live_daily(day, metric, n) VALUES (?, ?, ?) ON CONFLICT(day, metric) DO UPDATE SET n = n + excluded.n", day(now), metric, n);
  }
  touch(guildId, now) {
    this.run("UPDATE guilds SET active_at = ? WHERE id = ? AND active_at < ?", iso(now), guildId, iso(now - HOUR));
  }

  // -------------------------------------------------------------------- guilds
  guildCount() { return this.get("SELECT COUNT(*) AS c FROM guilds").c; }
  guild(id) { return this.get("SELECT * FROM guilds WHERE id = ?", id) || null; }
  guildByCodeHash(hash) { return this.get("SELECT * FROM guilds WHERE code_hash = ?", hash) || null; }
  guildByDiscord(discordGuild) { return this.get("SELECT * FROM guilds WHERE discord_guild = ?", discordGuild) || null; }
  memberCount(guildId) { return this.get("SELECT COUNT(*) AS c FROM guild_members WHERE guild = ?", guildId).c; }

  // -> { guildId, member, role } or { error: "exists" }. codeHashValue is the hash of the new link code.
  createGuild(install, g, codeHashValue, now = Date.now()) {
    const at = iso(now), id = newGuildId(), token = newToken();
    return this.store.tx(() => {
      if (this.get("SELECT 1 AS x FROM guilds WHERE realm_key = ? AND faction = ? AND name_key = ?", realmKey(g.realm), g.faction, nameKey(g.guildName))) return { error: "exists" };
      this.run(`INSERT INTO guilds(id, realm, realm_key, faction, name, name_key, code_hash, created_at, active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, g.realm, realmKey(g.realm), g.faction, g.guildName, nameKey(g.guildName), codeHashValue, at, at);
      this.run(`INSERT INTO guild_members(guild, name_key, name, realm, install, token_hash, role, rank, founder, joined_at, seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 'leader', ?, 1, ?, ?)`, id, nameKey(g.character.name), g.character.name, g.character.realm, install, sha256hex(token), g.rankIndex, at, at);
      this.bump("guild_linked", now);
      return { guildId: id, member: token, role: "leader" };
    });
  }

  // -> { member, role } or { error: "exists" | "full" }. A name that is already a member can only be
  // joined again from the same install (that renews its token); anybody else is refused.
  join(guild, install, j, maxMembers, now = Date.now()) {
    const at = iso(now), key = nameKey(j.character.name), token = newToken();
    return this.store.tx(() => {
      const old = this.get("SELECT * FROM guild_members WHERE guild = ? AND name_key = ?", guild.id, key);
      if (old && old.install !== install) return { error: "exists" };
      const role = old && old.founder ? "leader" : roleFor(j.rankIndex, guild.officer_rank);
      if (old) {
        this.run("UPDATE guild_members SET token_hash = ?, name = ?, realm = ?, role = ?, rank = ?, seen_at = ? WHERE guild = ? AND name_key = ?",
          sha256hex(token), j.character.name, j.character.realm, role, j.rankIndex, at, guild.id, key);
      } else {
        if (this.memberCount(guild.id) >= maxMembers) return { error: "full" };
        this.run(`INSERT INTO guild_members(guild, name_key, name, realm, install, token_hash, role, rank, founder, joined_at, seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, guild.id, key, j.character.name, j.character.realm, install, sha256hex(token), role, j.rankIndex, at, at);
      }
      this.touch(guild.id, now);
      return { member: token, role, renewed: !!old, members: this.memberCount(guild.id) };
    });
  }

  // The member a token belongs to, or null. Tokens are 32 random bytes, so the hash is the lookup key.
  memberByToken(token, now = Date.now()) {
    const m = this.get("SELECT * FROM guild_members WHERE token_hash = ?", sha256hex(token));
    if (!m) return null;
    if (m.seen_at < iso(now - 10 * 60_000)) this.run("UPDATE guild_members SET seen_at = ? WHERE guild = ? AND name_key = ?", iso(now), m.guild, m.name_key);
    return m;
  }
  member(guildId, key) { return this.get("SELECT * FROM guild_members WHERE guild = ? AND name_key = ?", guildId, key) || null; }
  memberByDiscord(guildId, discordUser) { return this.get("SELECT * FROM guild_members WHERE guild = ? AND discord_user = ?", guildId, discordUser) || null; }

  // The G3 answer for one member.
  view(guild, member) {
    return {
      ok: true, guildId: guild.id, guildName: guild.name, realm: guild.realm, faction: guild.faction, role: member.role,
      members: this.all("SELECT name, realm, role, discord_name, seen_at FROM guild_members WHERE guild = ? ORDER BY rank, name_key", guild.id)
        .map(m => ({ name: m.name, realm: m.realm, role: m.role, discord: m.discord_name || null, lastSeen: m.seen_at })),
      thresholds: { officerRank: guild.officer_rank, proposeRank: guild.propose_rank, editRank: guild.edit_rank },
      discord: discordView(guild),
    };
  }

  setThresholds(guildId, t) {
    return this.store.tx(() => {
      const g = this.guild(guildId);
      const next = { officer: t.officerRank ?? g.officer_rank, propose: t.proposeRank ?? g.propose_rank, edit: t.editRank ?? g.edit_rank };
      this.run("UPDATE guilds SET officer_rank = ?, propose_rank = ?, edit_rank = ? WHERE id = ?", next.officer, next.propose, next.edit, guildId);
      // Roles follow the new officer threshold; the member who linked the guild stays leader.
      for (const m of this.all("SELECT name_key, rank, founder FROM guild_members WHERE guild = ?", guildId))
        this.run("UPDATE guild_members SET role = ? WHERE guild = ? AND name_key = ?", m.founder ? "leader" : roleFor(m.rank, next.officer), guildId, m.name_key);
      return this.guild(guildId);
    });
  }

  setCodeHash(guildId, hash) { return Number(this.run("UPDATE guilds SET code_hash = ? WHERE id = ?", hash, guildId).changes); }

  // removeMember(guildId, key) and deleteGuild(guildId) are defined at the end of this file.

  // Called inside Store.purgeInstall's transaction: leave every guild, drop the listing.
  // -> { left: [{ guildId, memberKey, deleted, members, discordGuild }], listing: row | null }
  purgeInstall(hash) {
    const left = [];
    for (const m of this.all("SELECT guild, name_key FROM guild_members WHERE install = ?", hash)) {
      const g = this.guild(m.guild);
      const r = this.removeMemberInTx(m.guild, m.name_key);
      left.push({ guildId: m.guild, memberKey: m.name_key, deleted: r.deleted, members: r.members, discordGuild: g ? g.discord_guild : null });
    }
    const listing = this.get("SELECT * FROM lfg WHERE install = ?", hash) || null;
    if (listing) this.run("DELETE FROM lfg WHERE install = ?", hash);
    return { left, listing };
  }
  // -------------------------------------------------------------------- events
  eventRow(guildId, id) { return this.get("SELECT * FROM guild_events WHERE guild = ? AND id = ?", guildId, id) || null; }
  liveEventCount(guildId, now) { return this.get("SELECT COUNT(*) AS c FROM guild_events WHERE guild = ? AND at_ms >= ?", guildId, now - AFTER_MS).c; }

  // One event from one member. -> { error: "forbidden" | "full" } or
  // { accepted, reason, event (the stored E1 shape or null), isNew }.
  putEvent(guild, member, e, now = Date.now()) {
    const atMs = Date.parse(e.at), at = iso(now);
    return this.store.tx(() => {
      const row = this.eventRow(guild.id, e.id);
      const old = row ? { version: row.version, creator: { name: row.creator_name }, editor: row.editor_name ? { name: row.editor_name } : null, relayed: !!row.relayed } : null;
      const direct = nameKey(eventAuthor(e)) === member.name_key;
      if (direct) {
        const lead = member.role === "leader" || member.role === "officer";
        const allowed = e.editor
          ? member.role === "leader" || member.rank <= guild.edit_rank
          : (old && sameName(old.creator.name, e.creator.name)) || lead || member.rank <= guild.propose_rank;
        if (!allowed) return { error: "forbidden" };
      }
      if (!old && atMs < now - AFTER_MS) return { accepted: false, reason: "past", event: null, isNew: false };
      if (atMs > now + AHEAD_MS) return { accepted: false, reason: "ahead", event: row ? eventShape(row) : null, isNew: false };
      const d = eventDecision(old, e, direct);
      if (!d.accept) return { accepted: false, reason: d.reason, event: eventShape(row), isNew: false };
      if (!old && this.liveEventCount(guild.id, now) >= MAX_LIVE_EVENTS) return { error: "full" };
      if (old) {
        // A new time means a new reminder and a message that takes answers again.
        const moved = row.at_ms !== atMs;
        this.run(`UPDATE guild_events SET version = ?, editor_name = ?, editor_realm = ?, at = ?, at_ms = ?, place = ?, title = ?, note = ?,
            tank = ?, healer = ?, damage = ?, cancelled = ?, relayed = ?, updated_at = ?, reminded = ?, closed = ? WHERE guild = ? AND id = ?`,
          e.version, e.editor ? e.editor.name : null, e.editor ? e.editor.realm : null, e.at, atMs, e.place, e.title, e.note,
          e.roles.tank, e.roles.healer, e.roles.damage, e.cancelled ? 1 : 0, direct ? 0 : 1, at, moved ? 0 : row.reminded, moved ? 0 : row.closed, guild.id, e.id);
      } else {
        this.run(`INSERT INTO guild_events(guild, id, version, creator_name, creator_realm, editor_name, editor_realm, at, at_ms, place, title, note,
            tank, healer, damage, cancelled, relayed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          guild.id, e.id, e.version, e.creator.name, e.creator.realm, e.editor ? e.editor.name : null, e.editor ? e.editor.realm : null, e.at, atMs,
          e.place, e.title, e.note, e.roles.tank, e.roles.healer, e.roles.damage, e.cancelled ? 1 : 0, direct ? 0 : 1, at, at);
        this.bump("event_created", now);
      }
      this.touch(guild.id, now);
      return { accepted: true, reason: d.reason, event: eventShape(this.eventRow(guild.id, e.id)), isNew: !old };
    });
  }

  signupRow(guildId, eventId, key) { return this.get("SELECT * FROM guild_signups WHERE guild = ? AND event = ? AND name_key = ?", guildId, eventId, key) || null; }

  // One sign-up. direct: the member answers for their own character.
  // -> { error: "not_found" } or { accepted, reason, signup }.
  putSignup(guild, eventId, s, direct, now = Date.now()) {
    return this.store.tx(() => {
      const ev = this.eventRow(guild.id, eventId);
      if (!ev) return { error: "not_found" };
      const key = nameKey(s.who.name), old = this.signupRow(guild.id, eventId, key);
      if (ev.cancelled || now > ev.at_ms + AFTER_MS) return { accepted: false, reason: "closed", signup: old ? signupShape(old) : null };
      if (!signupDecision(old, s.version, direct)) return { accepted: false, reason: "older", signup: signupShape(old) };
      if (!old && this.get("SELECT COUNT(*) AS c FROM guild_signups WHERE guild = ? AND event = ?", guild.id, eventId).c >= MAX_SIGNUPS)
        return { accepted: false, reason: "full", signup: null };
      this.run(`INSERT INTO guild_signups(guild, event, name_key, name, realm, answer, version, via, relayed, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild, event, name_key) DO UPDATE SET name = excluded.name, realm = excluded.realm, answer = excluded.answer,
          version = excluded.version, via = excluded.via, relayed = excluded.relayed, at = excluded.at`,
        guild.id, eventId, key, s.who.name, s.who.realm, s.answer, s.version, s.via, direct ? 0 : 1, iso(now));
      this.bump(`signup_${s.via}`, now);
      this.touch(guild.id, now);
      return { accepted: true, reason: old ? "newer" : "new", signup: signupShape(this.signupRow(guild.id, eventId, key)) };
    });
  }

  // A Discord button press of a linked member: always the member's own, one version on.
  discordSignup(guild, eventId, member, answer, now = Date.now()) {
    const old = this.signupRow(guild.id, eventId, member.name_key);
    const version = Math.min(MAX_VERSION, old ? old.version + 1 : 1);
    // At the version cap the stored answer is marked as passed on, so the member's own answer still replaces it.
    if (old && old.version >= MAX_VERSION) this.run("UPDATE guild_signups SET relayed = 1 WHERE guild = ? AND event = ? AND name_key = ?", guild.id, eventId, member.name_key);
    return this.putSignup(guild, eventId, { who: { name: member.name, realm: member.realm }, answer, version, via: "discord" }, true, now);
  }

  signups(guildId, eventId) {
    return this.all("SELECT * FROM guild_signups WHERE guild = ? AND event = ? ORDER BY at, name_key", guildId, eventId);
  }

  // The full refetch: every stored event of the guild (or those changed since) with its sign-ups.
  listEvents(guildId, since = null) {
    const rows = since
      ? this.all("SELECT * FROM guild_events WHERE guild = ? AND updated_at >= ? ORDER BY at_ms, id", guildId, since)
      : this.all("SELECT * FROM guild_events WHERE guild = ? ORDER BY at_ms, id", guildId);
    const signups = {};
    for (const r of rows) signups[r.id] = this.signups(guildId, r.id).map(signupShape);
    return { events: rows.map(eventShape), signups };
  }
  upcomingEvents(guildId, now, limit = 10) {
    return this.all("SELECT * FROM guild_events WHERE guild = ? AND cancelled = 0 AND at_ms >= ? ORDER BY at_ms, id LIMIT ?", guildId, now - AFTER_MS, limit);
  }
  liveEvents(guildId, now) { return this.all("SELECT * FROM guild_events WHERE guild = ? AND at_ms >= ? ORDER BY at_ms, id", guildId, now - AFTER_MS); }

  // The attendance summary keeps numbers only; the names are used for the Discord post and dropped.
  putSummary(guild, ev, s, now = Date.now()) {
    this.run(`INSERT INTO guild_summaries(guild, event, title, place, at, at_ms, attended, bosses, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild, event) DO UPDATE SET title = excluded.title, place = excluded.place, at = excluded.at, at_ms = excluded.at_ms,
        attended = excluded.attended, bosses = excluded.bosses, duration_sec = excluded.duration_sec`,
      guild.id, ev.id, ev.title, ev.place, ev.at, ev.at_ms, s.attended.length, s.bosses, s.durationSec, iso(now));
    this.touch(guild.id, now);
  }

  setEventDiscord(guildId, id, f) {
    const row = this.eventRow(guildId, id);
    if (!row) return 0;
    const v = (k) => (f[k] !== undefined ? f[k] : row[k]);
    return Number(this.run("UPDATE guild_events SET discord_message = ?, discord_channel = ?, discord_event = ?, discord_sig = ?, reminded = ?, closed = ? WHERE guild = ? AND id = ?",
      v("discord_message"), v("discord_channel"), v("discord_event"), v("discord_sig"), v("reminded"), v("closed"), guildId, id).changes);
  }
  // Events of Discord-connected guilds whose 15-minute reminder is due and not sent yet.
  dueReminders(now) {
    return this.all(`SELECT e.guild, e.id FROM guild_events e JOIN guilds g ON g.id = e.guild
      WHERE e.reminded = 0 AND e.cancelled = 0 AND e.at_ms > ? AND e.at_ms <= ? AND g.discord_guild IS NOT NULL AND g.discord_channel IS NOT NULL`, now, now + REMIND_MS);
  }
  // Events that are over (four hours after the start): their Discord message loses its buttons once.
  dueClose(now) {
    return this.all(`SELECT e.guild, e.id FROM guild_events e JOIN guilds g ON g.id = e.guild
      WHERE e.closed = 0 AND e.discord_message IS NOT NULL AND e.at_ms < ? AND g.discord_guild IS NOT NULL`, now - AFTER_MS);
  }

  // ------------------------------------------------------------------- discord
  discordPending(guildId, nonce, now) {
    this.run("UPDATE guilds SET discord_nonce = ?, discord_nonce_ms = ?, discord_state = CASE WHEN discord_guild IS NULL THEN 'pending' ELSE discord_state END WHERE id = ?", sha256hex(nonce), now, guildId);
  }
  // -> the guild row when the nonce is the one handed out and still fresh; it can be used once.
  discordTakeNonce(guildId, nonce, now) {
    const g = this.guild(guildId);
    if (!g || !g.discord_nonce || g.discord_nonce !== sha256hex(nonce) || now - g.discord_nonce_ms > DISCORD_PENDING_MS) return null;
    this.run("UPDATE guilds SET discord_nonce = NULL, discord_nonce_ms = 0 WHERE id = ?", guildId);
    return g;
  }
  discordConnect(guildId, d) {
    this.run(`UPDATE guilds SET discord_state = ?, discord_guild = ?, discord_guild_name = ?, discord_channel = ?, discord_channel_name = ?, discord_problem = ? WHERE id = ?`,
      d.state, d.guild, d.guildName, d.channel, d.channelName, d.problem, guildId);
    // Messages in an earlier server or channel are not ours to edit any more.
    this.run("UPDATE guild_events SET discord_message = NULL, discord_channel = NULL, discord_event = NULL, discord_sig = NULL WHERE guild = ?", guildId);
  }
  discordCancelPending(guildId) {
    this.run("UPDATE guilds SET discord_nonce = NULL, discord_nonce_ms = 0, discord_state = CASE WHEN discord_state = 'pending' THEN 'none' ELSE discord_state END WHERE id = ?", guildId);
  }
  discordChannel(guildId, channel, channelName) {
    this.run("UPDATE guilds SET discord_channel = ?, discord_channel_name = ?, discord_state = 'connected', discord_problem = NULL WHERE id = ?", channel, channelName, guildId);
    this.run("UPDATE guild_events SET discord_message = NULL, discord_channel = NULL WHERE guild = ?", guildId);
  }
  discordChannelName(guildId, channelName) { this.run("UPDATE guilds SET discord_channel_name = ? WHERE id = ?", channelName, guildId); }
  // -> true when the state or the reason changed (so the caller publishes it once).
  discordState(guildId, state, problem = null) {
    return Number(this.run(`UPDATE guilds SET discord_state = ?, discord_problem = ? WHERE id = ? AND discord_guild IS NOT NULL
      AND (discord_state <> ? OR COALESCE(discord_problem, '') <> ?)`, state, problem, guildId, state, problem || "").changes) > 0;
  }
  discordDisconnect(guildId) {
    return this.store.tx(() => {
      this.run(`UPDATE guilds SET discord_state = 'none', discord_guild = NULL, discord_guild_name = NULL, discord_channel = NULL, discord_channel_name = NULL,
        discord_problem = NULL, discord_nonce = NULL, discord_nonce_ms = 0 WHERE id = ?`, guildId);
      this.run("UPDATE guild_members SET discord_user = NULL, discord_name = NULL WHERE guild = ?", guildId);
      this.run("UPDATE guild_events SET discord_message = NULL, discord_channel = NULL, discord_event = NULL, discord_sig = NULL WHERE guild = ?", guildId);
    });
  }
  createDiscordCode(hash, d, now) {
    // One open code per Discord user and server: asking again replaces the old one.
    this.run("DELETE FROM discord_codes WHERE (discord_guild = ? AND discord_user = ?) OR expires_ms <= ?", d.guild, d.user, now);
    this.run("INSERT OR REPLACE INTO discord_codes(code_hash, discord_guild, discord_user, discord_name, expires_ms) VALUES (?, ?, ?, ?, ?)", hash, d.guild, d.user, d.name, now + DISCORD_CODE_MS);
  }
  // Ties a member to the Discord user behind a one-time code. -> { discord: name } or null.
  redeemDiscordCode(guild, member, hash, now) {
    return this.store.tx(() => {
      const c = this.get("SELECT * FROM discord_codes WHERE code_hash = ?", hash);
      if (!c || c.expires_ms <= now || !guild.discord_guild || c.discord_guild !== guild.discord_guild) return null;
      this.run("DELETE FROM discord_codes WHERE code_hash = ?", hash);
      // One Discord user answers for one character of the guild.
      this.run("UPDATE guild_members SET discord_user = NULL, discord_name = NULL WHERE guild = ? AND discord_user = ?", guild.id, c.discord_user);
      this.run("UPDATE guild_members SET discord_user = ?, discord_name = ? WHERE guild = ? AND name_key = ?", c.discord_user, c.discord_name, guild.id, member.name_key);
      return { discord: c.discord_name };
    });
  }
  unlinkDiscord(guildId, key) {
    return Number(this.run("UPDATE guild_members SET discord_user = NULL, discord_name = NULL WHERE guild = ? AND name_key = ? AND discord_user IS NOT NULL", guildId, key).changes);
  }

  // --------------------------------------------------------------- party board
  // -> { error: "exists" } when another install owns that id, else { listing, replaced: row | null }.
  putListing(install, v, now = Date.now()) {
    const l = v.listing;
    return this.store.tx(() => {
      const byId = this.get("SELECT * FROM lfg WHERE id = ?", l.id);
      if (byId && byId.install !== install) return { error: "exists" };
      const mine = this.get("SELECT * FROM lfg WHERE install = ?", install);
      // One listing per install: a new id (or another realm) replaces the old listing.
      const replaced = mine && (mine.id !== l.id || mine.realm_key !== realmKey(v.realm) || mine.faction !== v.faction) ? mine : null;
      const fresh = !mine || mine.expires_ms <= now || !!replaced;
      if (mine) this.run("DELETE FROM lfg WHERE install = ?", install);
      this.run(`INSERT INTO lfg(id, install, realm, realm_key, faction, kind, name, who_realm, level, class, roles, place, note, need, at, expires_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, l.id, install, v.realm, realmKey(v.realm), v.faction, l.kind, l.who.name, l.who.realm, l.level, l.class,
        l.roles.join(","), l.place, l.note, l.need ? JSON.stringify(l.need) : null, iso(now), now + LFG_TTL_MS);
      if (fresh) this.bump("listing", now);
      return { listing: listingShape(this.get("SELECT * FROM lfg WHERE id = ?", l.id)), replaced: replaced && replaced.expires_ms > now ? replaced : null };
    });
  }
  // -> the removed row, or null when that install has no such listing.
  deleteListing(install, id) {
    const row = this.get("SELECT * FROM lfg WHERE id = ? AND install = ?", id, install);
    if (!row) return null;
    this.run("DELETE FROM lfg WHERE id = ?", id);
    return row;
  }
  listing(id) { return this.get("SELECT * FROM lfg WHERE id = ?", id) || null; }
  removeListing(id) { const row = this.listing(id); if (row) this.run("DELETE FROM lfg WHERE id = ?", id); return row; }
  listListings(realm, faction, now = Date.now()) {
    return this.all("SELECT * FROM lfg WHERE realm_key = ? AND faction = ? AND expires_ms > ? ORDER BY at DESC, id LIMIT ?", realmKey(realm), faction, now, LFG_PAGE).map(listingShape);
  }
  listingCount(now) { return this.get("SELECT COUNT(*) AS c FROM lfg WHERE expires_ms > ?", now).c; }
  // -> the rows that just expired (so "gone" can be published once).
  expireListings(now = Date.now()) {
    const rows = this.all("SELECT * FROM lfg WHERE expires_ms <= ?", now);
    if (rows.length) this.run("DELETE FROM lfg WHERE expires_ms <= ?", now);
    return rows;
  }

  // -------------------------------------------------------------- housekeeping
  // Past events go after 14 days (a numbers-only summary is kept 180 days), old link codes and
  // unfinished Discord connections are cleared, daily counters older than 13 months are dropped.
  expire(now = Date.now()) {
    return this.store.tx(() => {
      const cutoff = now - EVENT_KEEP_MS;
      const old = this.all("SELECT * FROM guild_events WHERE at_ms < ?", cutoff);
      for (const e of old) {
        if (!e.cancelled) {
          const yes = this.get("SELECT COUNT(*) AS c FROM guild_signups WHERE guild = ? AND event = ? AND answer IN ('tank','healer','damage')", e.guild, e.id).c;
          this.run(`INSERT OR IGNORE INTO guild_summaries(guild, event, title, place, at, at_ms, attended, bosses, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
            e.guild, e.id, e.title, e.place, e.at, e.at_ms, yes, iso(now));
        }
        this.run("DELETE FROM guild_signups WHERE guild = ? AND event = ?", e.guild, e.id);
        this.run("DELETE FROM guild_events WHERE guild = ? AND id = ?", e.guild, e.id);
      }
      const summaries = Number(this.run("DELETE FROM guild_summaries WHERE at_ms < ?", now - SUMMARY_KEEP_MS).changes);
      const codes = Number(this.run("DELETE FROM discord_codes WHERE expires_ms <= ?", now).changes);
      this.run("UPDATE guilds SET discord_state = 'none', discord_nonce = NULL, discord_nonce_ms = 0 WHERE discord_state = 'pending' AND discord_nonce_ms < ?", now - DISCORD_PENDING_MS);
      const counters = Number(this.run("DELETE FROM live_daily WHERE day < ?", day(now - 400 * DAY)).changes);
      return { events: old.length, summaries, codes, counters };
    });
  }

  // --------------------------------------------------------------------- admin
  adminList({ q = "", limit = 200 } = {}) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return this.db.prepare(`SELECT g.id, g.name, g.realm, g.faction, g.discord_state, g.discord_problem, g.created_at, g.active_at,
        (SELECT COUNT(*) FROM guild_members m WHERE m.guild = g.id) AS members,
        (SELECT COUNT(*) FROM guild_events e WHERE e.guild = g.id) AS events
      FROM guilds g ${q ? "WHERE g.name LIKE ? ESCAPE '\\' OR g.realm LIKE ? ESCAPE '\\' OR g.id = ?" : ""} ORDER BY g.active_at DESC, g.id LIMIT ?`)
      .all(...(q ? [like, like, q] : []), limit);
  }
  adminDetail(guildId) {
    const g = this.guild(guildId);
    if (!g) return null;
    const roles = { leader: 0, officer: 0, member: 0 };
    const members = this.all("SELECT name, realm, role, rank, discord_user IS NOT NULL AS linked, discord_name, joined_at, seen_at FROM guild_members WHERE guild = ? ORDER BY rank, name_key", guildId);
    for (const m of members) roles[m.role] = (roles[m.role] || 0) + 1;
    return {
      guild: g, members, roles,
      events: this.get("SELECT COUNT(*) AS c FROM guild_events WHERE guild = ?", guildId).c,
      signups: this.get("SELECT COUNT(*) AS c FROM guild_signups WHERE guild = ?", guildId).c,
      summaries: this.get("SELECT COUNT(*) AS c FROM guild_summaries WHERE guild = ?", guildId).c,
    };
  }
  adminListings(now, limit = 300) { return this.all("SELECT * FROM lfg WHERE expires_ms > ? ORDER BY at DESC, id LIMIT ?", now, limit); }

  // Counts for the dashboard and the command line. Aggregates only.
  stats(now = Date.now(), days = 30) {
    const since = day(now - (days - 1) * DAY), c = (sql, ...a) => this.get(sql, ...a).c;
    const metric = Object.fromEntries(METRICS.map(m => [m, 0]));
    for (const r of this.all("SELECT metric, SUM(n) AS n FROM live_daily WHERE day >= ? GROUP BY metric", since)) if (r.metric in metric) metric[r.metric] = r.n;
    const dayList = Array.from({ length: days }, (_, i) => day(now - (days - 1 - i) * DAY));
    const perDay = new Map(this.all("SELECT day, n FROM live_daily WHERE metric = 'listing' AND day >= ?", since).map(r => [r.day, r.n]));
    return {
      days: dayList,
      guilds: c("SELECT COUNT(*) AS c FROM guilds"),
      members: c("SELECT COUNT(*) AS c FROM guild_members"),
      guildsWithDiscord: c("SELECT COUNT(*) AS c FROM guilds WHERE discord_guild IS NOT NULL"),
      guildsWithProblem: c("SELECT COUNT(*) AS c FROM guilds WHERE discord_state = 'problem'"),
      weeklyActiveGuilds: c("SELECT COUNT(*) AS c FROM guilds WHERE active_at >= ?", iso(now - 7 * DAY)),
      guildsLinkedInRange: metric.guild_linked,
      eventsStored: c("SELECT COUNT(*) AS c FROM guild_events"),
      eventsCreated: metric.event_created,
      signups: { game: metric.signup_game, desktop: metric.signup_desktop, discord: metric.signup_discord },
      listingsNow: this.listingCount(now),
      listingsInRange: metric.listing,
      listingsPerDay: dayList.map(d => perDay.get(d) || 0),
    };
  }
}

// Removes one member and that member's own sign-ups. When nobody is left the guild is deleted; when
// the last leader went, the member with the highest in-game rank becomes leader.
// -> { removed, deleted, members }. The body is shared with purgeInstall, which already runs inside a transaction.
Guilds.prototype.removeMemberBody = function removeMemberBody(guildId, key) {
  const m = this.member(guildId, key);
  if (!m) return { removed: false, deleted: false, members: this.memberCount(guildId) };
  this.run("DELETE FROM guild_members WHERE guild = ? AND name_key = ?", guildId, key);
  this.run("DELETE FROM guild_signups WHERE guild = ? AND name_key = ?", guildId, key);
  const members = this.memberCount(guildId);
  if (!members) { this.deleteGuildRows(guildId); return { removed: true, deleted: true, members: 0 }; }
  if (m.role === "leader" && !this.get("SELECT 1 AS x FROM guild_members WHERE guild = ? AND role = 'leader'", guildId)) {
    const next = this.get("SELECT name_key FROM guild_members WHERE guild = ? ORDER BY rank, joined_at, name_key LIMIT 1", guildId);
    this.run("UPDATE guild_members SET role = 'leader', founder = 1 WHERE guild = ? AND name_key = ?", guildId, next.name_key);
  }
  return { removed: true, deleted: false, members };
};
Guilds.prototype.deleteGuildRows = function deleteGuildRows(guildId) {
  this.run("DELETE FROM guild_signups WHERE guild = ?", guildId);
  this.run("DELETE FROM guild_events WHERE guild = ?", guildId);
  this.run("DELETE FROM guild_summaries WHERE guild = ?", guildId);
  this.run("DELETE FROM guild_members WHERE guild = ?", guildId);
  return Number(this.run("DELETE FROM guilds WHERE id = ?", guildId).changes);
};
Guilds.prototype.removeMember = function removeMember(guildId, key) { return this.store.tx(() => this.removeMemberBody(guildId, key)); };
Guilds.prototype.removeMemberInTx = function removeMemberInTx(guildId, key) { return this.removeMemberBody(guildId, key); };
Guilds.prototype.deleteGuild = function deleteGuild(guildId) { return this.store.tx(() => this.deleteGuildRows(guildId)); };

module.exports = {
  Guilds, SCHEMA, METRICS, eventDecision, signupDecision, eventAuthor, sameName, compareNames, roleFor, codeHash, randomCode, sha256hex,
  eventShape, signupShape, listingShape, discordView, iso, day,
  AFTER_MS, AHEAD_MS, EVENT_KEEP_MS, SUMMARY_KEEP_MS, REMIND_MS, LFG_TTL_MS, DISCORD_CODE_MS, DISCORD_PENDING_MS, MAX_LIVE_EVENTS, MAX_SIGNUPS, MAX_VERSION,
};

"use strict";
// Backstage Live, the guild and party half on the desktop: every guild (G), event (E), Discord (D)
// and party board (P) call of the Backstage Live contract, the member tokens, an offline queue for
// sign-ups and event edits, and the reactions to what the game reports through game-guild-feed.
//
// The privacy line of this file:
//  - Nothing here is sent until the player agreed: a guild call needs a member token, and a token
//    exists only after the player pressed Join (or set the guild up as its leader); the realm party
//    board needs its own switch, and posting on it its own consent. After Leave the token is gone,
//    so nothing more can be sent for that guild.
//  - Every body that leaves is built by one pure function below from a fixed list of fields.
//  - Member tokens are secrets like the report keys of Backstage Desk: kept in the app's own data
//    folder, never logged, never shown, sent only in the X-BF-Member header (and the live session
//    body the contract asks for). No view or event of this class carries one.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { atomic } = require("./store.cjs");
const { linky } = require("./guild-events.cjs");

const ROLES = Object.freeze(["tank", "healer", "damage"]);
const ANSWERS = Object.freeze([...ROLES, "maybe", "no"]);
const LETTER = Object.freeze({ t: "tank", h: "healer", d: "damage", m: "maybe", n: "no" });
const VIA = Object.freeze(["game", "desktop", "discord"]);
const FACTIONS = Object.freeze(["horde", "alliance"]);
const CLASSES = Object.freeze(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);
const DISCORD_STATES = Object.freeze(["none", "pending", "connected", "problem"]);
const LIMITS = Object.freeze({ guilds: 4, offers: 8, never: 100, queue: 100, events: 60, signups: 200, listings: 200, handoffListings: 40, title: 40, note: 80, lfgNote: 60, members: 500 });
const LISTING_LIFE = 30 * 60 * 1000, REFRESH_GAP = 5000, WATCH_TTL = 3 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A membership is one character in one guild: "<guildId>~<realm>|<name>". One desktop may hold several
// characters of the same guild (a leader and an alt), each with its own member key.
const MEMBER_ID_RE = /^g_[A-Za-z0-9_-]{1,60}~[^~]{3,80}$/u;
const GUILD_ID_RE = /^g_[A-Za-z0-9_-]{1,60}$/, TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/, CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,24}$/, LISTING_ID_RE = /^[A-Za-z0-9_-]{16}$/, PLACE_RE = /^[a-z][a-z0-9]{0,7}$/;
// What the game itself accepts (its own event and listing ids): anything the desktop creates uses these, or the addon would drop it.
const GAME_ID = "abcdefghijklmnopqrstuvwxyz0123456789";
const gameId = (n, bytes = crypto.randomBytes(n)) => Array.from(bytes, (b) => GAME_ID[b % GAME_ID.length]).join("");
const NAME_RE = /^[\p{L}\p{M}]{2,24}$/u, REALM_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’-]{0,39}$/u, GUILD_NAME_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’.-]{1,23}$/u;

// ---------------------------------------------------------------- pure helpers
const lower = (v) => String(v ?? "").toLowerCase();
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** A character exactly as the game shows it: { name, realm }, or null. */
function who(c) {
  return c && typeof c === "object" && typeof c.name === "string" && NAME_RE.test(c.name) && typeof c.realm === "string" && REALM_RE.test(c.realm) ? { name: c.name, realm: c.realm } : null;
}
const sameWho = (a, b) => Boolean(a && b) && lower(a.name) === lower(b.name) && lower(a.realm) === lower(b.realm);
const whoKey = (c) => `${lower(c.realm)}|${lower(c.name)}`;
const memberId = (g) => `${g.guildId}~${whoKey(g.character)}`;
/** "Abel" or "Abel-Thunder Hold" (as the guild channel names a member) -> { name, realm }. */
function splitName(value, realm) {
  const s = String(value ?? ""), at = s.indexOf("-");
  return who(at > 0 ? { name: s.slice(0, at), realm: s.slice(at + 1) } : { name: s, realm });
}
/** One line a player typed for others: plain, no control or colour codes, no web address; null when it cannot be used. */
function line(value, max, { empty = true } = {}) {
  if (typeof value !== "string") return null;
  const t = value.normalize("NFC").replace(/[\x00-\x1f\x7f-\x9f|‎‏‪-‮⁦-⁩]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (!t) return empty ? "" : null;
  if (linky(t)) return null;
  return Array.from(t).slice(0, max).join("");
}
const faction = (v) => (FACTIONS.includes(lower(v)) ? lower(v) : null);
const guildKey = (realm, fac, name) => `${lower(realm)}|${lower(fac)}|${lower(name)}`;
const time = (v) => { const ms = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(ms) && ms > 0 ? iso(ms) : null; };
const roleCounts = (r) => (r && typeof r === "object" && ROLES.every((k) => int(r[k], 0, 40)) ? { tank: r.tank, healer: r.healer, damage: r.damage } : null);

/** E1. One event in the contract's shape, from an explicit list of fields; null when anything is off. */
function eventShape(e) {
  if (!e || typeof e !== "object") return null;
  const creator = who(e.creator), editor = who(e.editor) || creator, at = time(e.at), roles = roleCounts(e.roles);
  const title = line(e.title, LIMITS.title, { empty: false }), note = line(e.note ?? "", LIMITS.note);
  if (typeof e.id !== "string" || !EVENT_ID_RE.test(e.id) || !int(e.version, 1, 1000000) || !creator || !at || !roles || typeof e.place !== "string" || !PLACE_RE.test(e.place) || !title || Array.from(title).length < 2 || note === null) return null;
  return { id: e.id, version: e.version, creator, editor, at, place: e.place, title, note, roles, cancelled: e.cancelled === true };
}
/** E2. One sign-up in the contract's shape, or null. */
function signupShape(s) {
  const w = who(s?.who);
  if (!w || !ANSWERS.includes(s.answer) || !int(s.version, 1, 1000000) || !VIA.includes(s.via)) return null;
  return { who: w, answer: s.answer, version: s.version, via: s.via };
}
/** P1. One party board listing in the contract's shape, or null. */
function listingShape(l) {
  if (!l || typeof l !== "object") return null;
  const w = who(l.who), at = time(l.at), note = line(l.note ?? "", LIMITS.lfgNote);
  const roles = Array.isArray(l.roles) ? ROLES.filter((r) => l.roles.includes(r)) : [];
  const need = l.need === null || l.need === undefined ? null : roleCounts(l.need);
  if (typeof l.id !== "string" || !LISTING_ID_RE.test(l.id) || !["lfg", "lfm"].includes(l.kind) || !w || !int(l.level, 1, 100) || !roles.length || typeof l.place !== "string" || !PLACE_RE.test(l.place) || note === null || !at || (l.need && !need)) return null;
  return { id: l.id, kind: l.kind, who: w, level: l.level, class: CLASSES.includes(l.class) ? l.class : null, roles, place: l.place, note, need: l.kind === "lfm" ? need : null, at };
}
// The addon's own rule (BackstageForeverEvents.lua): a higher version wins; on a tie the larger
// author name wins, so every replica settles on the same row.
const author = (e) => lower((e.editor || e.creator).name);
const eventWins = (incoming, old) => incoming.version > old.version || (incoming.version === old.version && author(incoming) > author(old));
const signupWins = (incoming, old) => incoming.version > old.version;
/**
 * The one merge rule. known and incoming: { events: [E1], signups: { <eventId>: [E2] } }.
 * Rows from the saved file carry version 0 for sign-ups (the file does not keep their version): they
 * fill a gap and lose against any versioned record. Returns the merged picture and what changed.
 */
function mergeGuild(known, incoming) {
  const events = new Map(), signups = new Map(), changed = { events: [], signups: [] };
  const rows = (id) => { if (!signups.has(id)) signups.set(id, new Map()); return signups.get(id); };
  const addSignup = (id, s, note) => {
    const row = s && who(s.who) && ANSWERS.includes(s.answer) && int(s.version, 0, 1000000) ? { who: who(s.who), answer: s.answer, version: s.version, via: VIA.includes(s.via) ? s.via : "game" } : null;
    if (!row || typeof id !== "string" || !EVENT_ID_RE.test(id)) return;
    const old = rows(id).get(whoKey(row.who));
    if (old && !signupWins(row, old)) return;
    rows(id).set(whoKey(row.who), row);
    if (note) changed.signups.push([id, row.who.name]);
  };
  for (const e of known?.events || []) { const row = eventShape(e); if (row) events.set(row.id, row); }
  for (const [id, list] of Object.entries(known?.signups || {})) for (const s of Array.isArray(list) ? list : []) addSignup(id, s, false);
  for (const e of incoming?.events || []) {
    const row = eventShape(e); if (!row) continue;
    const old = events.get(row.id);
    if (old && !eventWins(row, old)) continue;
    events.set(row.id, row); changed.events.push(row.id);
  }
  for (const [id, list] of Object.entries(incoming?.signups || {})) for (const s of Array.isArray(list) ? list : []) addSignup(id, s, true);
  const out = { events: [...events.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-LIMITS.events), signups: {}, changed };
  for (const e of out.events) { const list = signups.get(e.id); if (list?.size) out.signups[e.id] = [...list.values()].sort((a, b) => a.who.name.localeCompare(b.who.name) || a.who.realm.localeCompare(b.who.realm)).slice(0, LIMITS.signups); }
  // A sign-up for an event nobody knows is not kept, so it did not change anything either.
  changed.signups = changed.signups.filter(([id]) => out.events.some((e) => e.id === id));
  return out;
}
/** What the game's saved file knows (the checked guild block of guild-events.cjs) in the contract's shapes. */
function fromSaved(capture, realm) {
  const out = { events: [], signups: {} };
  for (const e of capture?.events || []) {
    if (!e || typeof e !== "object") continue;
    const creator = splitName(e.creator, realm), editor = e.editor ? splitName(e.editor, realm) : creator;
    const row = eventShape({ id: e.id, version: e.ver, creator, editor, at: Number.isSafeInteger(e?.at) && e.at > 0 && e.at < 1e11 ? iso(e.at * 1000) : null, place: e.dungeon, title: e.title, note: e.note || "", roles: { tank: e.roles?.t, healer: e.roles?.h, damage: e.roles?.d }, cancelled: e.cancelled === true });
    if (!row) continue;
    out.events.push(row);
    out.signups[row.id] = (e.signups || []).map((s) => ({ who: splitName(s.name, realm), answer: LETTER[s.status], version: 0, via: "game" })).filter((s) => s.who && s.answer);
  }
  return out;
}
const publicEvent = (e, signups, me) => {
  const counts = { tank: 0, healer: 0, damage: 0, maybe: 0, no: 0 }, names = { tank: [], healer: [], damage: [], maybe: [], no: [] };
  for (const s of signups || []) { counts[s.answer]++; names[s.answer].push(s.who.name); }
  const mine = me ? (signups || []).find((s) => sameWho(s.who, me)) : null;
  return { ...e, counts, names, mine: mine ? mine.answer : null, mineVia: mine ? mine.via : null };
};

// ---- the bodies that leave, each from a fixed list of fields
function createBody(i) {
  const c = who(i?.character), f = faction(i?.faction);
  if (!UUID_RE.test(i?.installId)) throw new GuildError("invalid", "The app has no install number yet. Try again in a moment.");
  if (!c) throw new GuildError("invalid", "The app does not know this character's name and realm yet. Log in with it and type /reload once.");
  if (!f) throw new GuildError("invalid", "The app does not know this character's faction yet. Log in with it and type /reload once.");
  if (typeof i.guildName !== "string" || !GUILD_NAME_RE.test(i.guildName)) throw new GuildError("invalid", "The app does not know this character's guild yet. Log in with it and type /reload once.");
  return { schema: 1, installId: i.installId, realm: c.realm, faction: f, guildName: i.guildName, character: c, rankIndex: int(i.rankIndex, 0, 9) ? i.rankIndex : 9 };
}
function joinBody(i) {
  const c = who(i?.character);
  if (!UUID_RE.test(i?.installId) || !c || typeof i.linkCode !== "string" || !CODE_RE.test(i.linkCode)) throw new GuildError("invalid", "This guild link is not complete. Ask your guild leader to type the link command in game again.");
  if (i.consent !== true) throw new GuildError("consent", "Nothing is sent until you choose Join.");
  return { schema: 1, installId: i.installId, linkCode: i.linkCode, character: c, rankIndex: int(i.rankIndex, 0, 9) ? i.rankIndex : 9, consent: true };
}
function listingBody(i) {
  const f = faction(i?.faction), listing = listingShape(i?.listing);
  if (!UUID_RE.test(i?.installId) || !f || typeof i.realm !== "string" || !REALM_RE.test(i.realm) || !listing) throw new GuildError("invalid", "This listing is not complete. Check the dungeon, your role and the note.");
  if (i.consent !== true) throw new GuildError("consent", "Nothing is posted until you agree.");
  return { schema: 1, installId: i.installId, realm: i.realm, faction: f, listing, consent: true };
}
function summaryBody(i) {
  const attended = [...new Set((Array.isArray(i?.attended) ? i.attended : []).filter((n) => typeof n === "string" && NAME_RE.test(n)))].slice(0, 80);
  return { schema: 1, attended, bosses: int(i?.bosses, 0, 99) ? i.bosses : 0, durationSec: int(i?.durationSec, 0, 86400) ? i.durationSec : 0 };
}
/** Only Discord's own add-bot page may be opened for step 1. */
function discordUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && !u.username && !u.password && !u.port && ["discord.com", "www.discord.com"].includes(u.hostname) && value.length <= 1000 ? u.href : null;
  } catch { return null; }
}

function friendly(code) {
  return {
    offline: "The service could not be reached. Your change is kept and sent when it is back.",
    rate: "Too many requests right now. Try again in a little while.",
    blocked: "This install can no longer use the service.",
    forbidden: "Your guild rank does not allow this. Ask your guild leader.",
    gone: "The service no longer knows this. It may have been removed.",
    exists: "This guild is already connected. Ask a guild member to type /bf guild link in game, then choose Join here.",
    discord_off: "Discord connection is not available yet.",
    invalid: "The service did not accept this. Check what you typed and try again.",
    consent: "Nothing is sent until you agree.",
    full: "Your guild already has 60 events on the service. Wait for one to pass.",
  }[code] || "The service could not be reached. Try again later.";
}
class GuildError extends Error { constructor(code, message) { super(message || friendly(code)); this.name = "GuildError"; this.code = code; } }

// ---------------------------------------------------------------- service
class GuildService extends EventEmitter {
  /**
   * community: the CommunityService (install id and request helper). live: the LiveClient (or null).
   * feed: the game-guild-feed emitter (or null). setHandoff({ guild, lfg, plan }): hands data to the
   * game for its next /reload. getSaved(): the checked guild blocks of the last saved-file read,
   * [{ name, realm, guild }]. getPlan(character): the group plan to hand to the game, or null.
   */
  constructor({ dir, community, live = null, feed = null, setHandoff = null, getSaved = () => [], getPlan = () => null, now = Date.now,
    randomId = gameId, timers = { setTimeout, clearTimeout } } = {}) {
    super();
    Object.assign(this, { community, live, feed, setHandoff, getSaved, getPlan, now, randomId, timers });
    this.dir = dir ? path.join(dir, "live") : null;
    this.state = this.read();
    this.board = { listings: new Map(), heard: new Map(), loadedAt: 0, error: null };   // the realm board: memory only
    this.party = null; this.partyAt = 0;                                              // the current group from the game: memory only
    this.pending = new Set();                                                         // what changed since the game last read the hand-off
    this.gameKnown = new Map();                                                       // event id -> version the game is known to hold
    this.busy = new Set(); this.lastRefresh = new Map(); this.watchUntil = 0; this.lastHandoff = ""; this.lastCharacter = null;
    this.discordOff = false; this.stopped = false; this.handlers = []; this.boardWhere = null; this.watchTimer = null;
    this.bind();
    this.syncSubs();
  }

  // -------- local store
  file() { return this.dir ? path.join(this.dir, "guild-state.json") : null; }
  read() {
    let raw = {};
    const f = this.file();
    if (f) try { const st = fs.statSync(f); if (st.isFile() && st.size < 8 * 1024 * 1024) raw = JSON.parse(fs.readFileSync(f, "utf8")) || {}; } catch { raw = {}; }
    const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);
    const discord = (d) => ({ state: DISCORD_STATES.includes(d?.state) ? d.state : "none", guildName: text(d?.guildName, 100), channel: text(d?.channel, 100), problem: text(d?.problem, 300) });
    const guild = (g) => {
      const c = who(g?.character), f = faction(g?.faction);
      if (!c || !f || typeof g.guildId !== "string" || !GUILD_ID_RE.test(g.guildId) || typeof g.member !== "string" || !TOKEN_RE.test(g.member) || typeof g.guildName !== "string") return null;
      const merged = mergeGuild({ events: g.events, signups: g.signups }, null);
      return { guildId: g.guildId, guildName: g.guildName.slice(0, 40), realm: text(g.realm, 40) || c.realm, faction: f, character: c, member: g.member,
        role: ["leader", "officer", "member"].includes(g.role) ? g.role : "member", rankIndex: int(g.rankIndex, 0, 9) ? g.rankIndex : 9,
        linkCode: typeof g.linkCode === "string" && CODE_RE.test(g.linkCode) ? g.linkCode : null, linkHeard: g.linkHeard === true,
        joinedAt: int(g.joinedAt, 0, Number.MAX_SAFE_INTEGER) ? g.joinedAt : 0, discord: discord(g.discord), linkedDiscord: text(g.linkedDiscord, 100),
        thresholds: { officerRank: int(g.thresholds?.officerRank, 0, 9) ? g.thresholds.officerRank : 1, proposeRank: int(g.thresholds?.proposeRank, 0, 9) ? g.thresholds.proposeRank : 9, editRank: int(g.thresholds?.editRank, 0, 9) ? g.thresholds.editRank : 1 },
        members: (Array.isArray(g.members) ? g.members : []).map((m) => (who(m) ? { ...who(m), role: ["leader", "officer", "member"].includes(m.role) ? m.role : "member", discord: text(m.discord, 100), lastSeen: time(m.lastSeen) } : null)).filter(Boolean).slice(0, LIMITS.members),
        memberCount: int(g.memberCount, 0, 100000) ? g.memberCount : null, syncedAt: int(g.syncedAt, 0, Number.MAX_SAFE_INTEGER) ? g.syncedAt : 0, testAt: int(g.testAt, 0, Number.MAX_SAFE_INTEGER) ? g.testAt : 0,
        events: merged.events, signups: merged.signups };
    };
    const offer = (o) => {
      const c = who(o?.character), f = faction(o?.faction);
      return c && f && typeof o.code === "string" && CODE_RE.test(o.code) && typeof o.guildName === "string" && GUILD_NAME_RE.test(o.guildName)
        ? { code: o.code, guildName: o.guildName, realm: text(o.realm, 40) || c.realm, faction: f, character: c, rankIndex: int(o.rankIndex, 0, 9) ? o.rankIndex : 9, heardAt: int(o.heardAt, 0, Number.MAX_SAFE_INTEGER) ? o.heardAt : 0 } : null;
    };
    const queued = (q) => {
      if (!q || typeof q.guildId !== "string" || !MEMBER_ID_RE.test(q.guildId) || typeof q.eventId !== "string" || !EVENT_ID_RE.test(q.eventId)) return null;
      if (q.type === "event") { const body = eventShape(q.body); return body ? { type: "event", guildId: q.guildId, eventId: q.eventId, body, queuedAt: int(q.queuedAt, 0, Number.MAX_SAFE_INTEGER) ? q.queuedAt : 0 } : null; }
      if (q.type === "signup") { const body = signupShape(q.body); return body ? { type: "signup", guildId: q.guildId, eventId: q.eventId, body, queuedAt: int(q.queuedAt, 0, Number.MAX_SAFE_INTEGER) ? q.queuedAt : 0 } : null; }
      return null;
    };
    const b = raw.board || {}, mine = b.listing;
    const myListing = mine && listingShape(mine.listing) && faction(mine.faction) && typeof mine.realm === "string" && int(mine.postedAt, 1, Number.MAX_SAFE_INTEGER)
      ? { realm: mine.realm.slice(0, 40), faction: faction(mine.faction), listing: listingShape(mine.listing), postedAt: mine.postedAt } : null;
    return {
      schemaVersion: 1,
      guilds: (Array.isArray(raw.guilds) ? raw.guilds : []).map(guild).filter(Boolean).slice(0, LIMITS.guilds),
      offers: (Array.isArray(raw.offers) ? raw.offers : []).map(offer).filter(Boolean).slice(-LIMITS.offers),
      never: (Array.isArray(raw.never) ? raw.never : []).filter((k) => typeof k === "string" && k.length <= 120).slice(-LIMITS.never),
      queue: (Array.isArray(raw.queue) ? raw.queue : []).map(queued).filter(Boolean).slice(-LIMITS.queue),
      board: { on: b.on === true, postConsent: b.postConsent === true, listing: myListing },
    };
  }
  save() {
    const f = this.file(); if (!f) return;
    try { fs.mkdirSync(this.dir, { recursive: true }); atomic(f, JSON.stringify(this.state)); } catch { /* best effort: state stays in memory */ }
  }
  changed(what = "state") { if (!this.stopped) try { this.emit("change", what); } catch {} }
  get installId() { return this.community?.settings?.installId; }
  /** One membership, by its id ("<guildId>~<realm>|<name>"); a bare guild id means the first character in that guild. */
  guild(id) {
    const g = typeof id === "string" ? this.state.guilds.find((x) => memberId(x) === id) || this.state.guilds.find((x) => x.guildId === id) : null;
    if (!g) throw new GuildError("gone", "You are not a member of this guild in the app.");
    return g;
  }
  has(id) { return this.state.guilds.some((g) => memberId(g) === id); }
  guildOf(character) { return character ? this.state.guilds.find((g) => sameWho(g.character, character)) || null : null; }

  // -------- network plumbing
  async call(method, route, { body, member } = {}) {
    if (this.stopped) throw new GuildError("offline");
    let res;
    try { res = await this.community.request(method, route, { body, headers: member ? { "X-BF-Member": member } : {} }); } catch { throw new GuildError("offline"); }
    const error = typeof res.json?.error === "string" ? res.json.error : "";
    if (res.status === 403 && error === "blocked") throw new GuildError("blocked");
    if (res.status === 403) throw new GuildError("forbidden");
    if (res.status === 429) throw new GuildError("rate");
    if (res.status === 503 && error === "discord_off") { this.discordOff = true; throw new GuildError("discord_off"); }
    if (res.status >= 500) throw new GuildError("offline");
    if (res.status === 409 && error === "exists") throw new GuildError("exists");
    if (res.status === 404) throw new GuildError("gone");
    if (res.status === 400 || res.status === 409 || res.status === 413 || res.status === 415) throw new GuildError(error === "full" ? "full" : "invalid");
    if ((res.status !== 200 && res.status !== 201) || res.json?.ok !== true) throw new GuildError("offline");
    return res.json;
  }
  /** A guild call: only ever with the member token of a guild the player joined. */
  guildCall(g, method, rest = "", body) { return this.call(method, `/v1/guilds/${g.guildId}${rest}`, { body, member: g.member }); }
  /** The service no longer knows our token (removed by the leader, or the guild was deleted): forget it here too. */
  dropGuild(id, { whole = false } = {}) {
    const before = this.state.guilds.length, gone = this.state.guilds.filter((g) => memberId(g) === id || (whole && g.guildId === id) || (whole && id.startsWith(`${g.guildId}~`))).map(memberId);
    this.state.guilds = this.state.guilds.filter((g) => !gone.includes(memberId(g)));
    this.state.queue = this.state.queue.filter((q) => !gone.includes(q.guildId));
    if (this.state.guilds.length === before) return false;
    this.save(); this.syncSubs(); this.updateHandoff(); this.changed("guilds");
    return true;
  }

  // -------- live subscriptions
  boardPlace() { const l = this.state.board.listing; return l && this.listingLive() ? { realm: l.realm, faction: l.faction } : this.boardWhere; }
  syncSubs() {
    if (!this.live || this.stopped) return;
    // One subscription per guild: a second character of the same guild would only bring every event twice.
    const first = new Map();
    for (const g of this.state.guilds) if (!first.has(g.guildId)) first.set(g.guildId, { guildId: g.guildId, member: g.member });
    this.live.setSubs("guild", [...first.values()]);
    const where = this.state.board.on && (this.now() < this.watchUntil || this.listingLive()) ? this.boardPlace() : null;
    this.live.setSubs("lfg", where ? [{ realm: where.realm, faction: where.faction }] : []);
  }
  bind() {
    const on = (emitter, name, fn) => { if (!emitter?.on) return; const h = (...a) => { if (!this.stopped) try { fn(...a); } catch { /* one bad message never stops the rest */ } }; emitter.on(name, h); this.handlers.push([emitter, name, h]); };
    on(this.live, "event", (name, data) => this.onLive(name, data));
    on(this.live, "refetch", () => { void this.refetch(); });
    on(this.live, "rejected", () => { void this.verifyMemberships(); });
    on(this.live, "status", () => this.changed("status"));
    for (const name of ["link", "unlink", "event", "signup", "party", "listing"]) on(this.feed, name, (payload) => this.onFeed(name, payload));
  }

  // -------- G1, G2: becoming a member (the only way a token comes to exist)
  /** G1. The leader or an officer connects the guild. consent must be literally true: the screen showed what is shared. */
  async createGuild({ character, faction: fac, guildName, rankIndex = 0, consent } = {}) {
    if (consent !== true) throw new GuildError("consent");
    if (this.state.guilds.length >= LIMITS.guilds) throw new GuildError("invalid", "This app is already connected to four guilds. Leave one first.");
    const body = createBody({ installId: this.installId, character, faction: fac, guildName, rankIndex });
    if (this.guildOf(body.character)) throw new GuildError("invalid", "This character's guild is already connected.");
    const json = await this.call("POST", "/v1/guilds", { body });
    if (!GUILD_ID_RE.test(json.guildId) || !TOKEN_RE.test(json.member) || typeof json.linkCode !== "string" || !CODE_RE.test(json.linkCode)) throw new GuildError("offline");
    this.addGuild({ guildId: json.guildId, guildName: body.guildName, realm: body.realm, faction: body.faction, character: body.character, member: json.member, role: json.role, rankIndex: body.rankIndex, linkCode: json.linkCode });
    return { guildId: json.guildId };
  }
  addGuild(g) {
    this.state.guilds = [...this.state.guilds.filter((x) => !sameWho(x.character, g.character)), {
      ...g, role: ["leader", "officer", "member"].includes(g.role) ? g.role : "member", linkCode: g.linkCode || null, linkHeard: false, joinedAt: this.now(),
      discord: { state: "none", guildName: null, channel: null, problem: null }, linkedDiscord: null, thresholds: { officerRank: 1, proposeRank: 9, editRank: 1 }, members: [], memberCount: null, syncedAt: 0, testAt: 0, events: [], signups: {} }].slice(-LIMITS.guilds);
    this.state.offers = this.state.offers.filter((o) => !(sameWho(o.character, g.character) && guildKey(o.realm, o.faction, o.guildName) === guildKey(g.realm, g.faction, g.guildName)));
    this.save(); this.syncSubs(); this.changed("guilds");
    // A new membership reads its whole picture once: members, Discord state, events and sign-ups.
    void this.refreshGuild(memberId(g), { force: true }).then(() => this.refreshEvents(memberId(g))).catch(() => {});
  }
  /** The link codes heard in game that still wait for the player's answer. */
  offers() { return this.state.offers.map((o) => ({ code: o.code, guildName: o.guildName, realm: o.realm, faction: o.faction, character: o.character, heardAt: o.heardAt })); }
  /** G2. Join: only from the consent card, with consent literally true. */
  async join(code, { consent } = {}) {
    const offer = this.state.offers.find((o) => o.code === code);
    if (!offer) throw new GuildError("gone", "This invitation is no longer here. Ask a guild member to type /bf guild link in game again.");
    if (consent !== true) throw new GuildError("consent", "Nothing is sent until you choose Join.");
    const body = joinBody({ installId: this.installId, linkCode: offer.code, character: offer.character, rankIndex: offer.rankIndex, consent: true });
    let json;
    try { json = await this.call("POST", "/v1/guilds/join", { body }); }
    catch (e) {
      if (e.code === "gone") { this.state.offers = this.state.offers.filter((o) => o !== offer); this.save(); this.changed("offers"); throw new GuildError("gone", "This guild link code is no longer valid. Ask your guild leader for the new one."); }
      // The same character name joined from another computer: only an officer can clear the old entry.
      if (e.code === "exists") throw new GuildError("exists", "This character already joined from another computer. Ask an officer to remove the old entry on Plans → Guild, then join again.");
      throw e;
    }
    if (!GUILD_ID_RE.test(json.guildId) || !TOKEN_RE.test(json.member)) throw new GuildError("offline");
    this.addGuild({ guildId: json.guildId, guildName: typeof json.guildName === "string" && json.guildName ? json.guildName.slice(0, 40) : offer.guildName, realm: offer.realm, faction: offer.faction, character: offer.character, member: json.member, role: json.role, rankIndex: body.rankIndex, linkCode: null });
    return { guildId: json.guildId };
  }
  /** Not now (asks again the next time the code is heard) or Never for this guild. Nothing is sent either way. */
  decline(code, { never = false } = {}) {
    const offer = this.state.offers.find((o) => o.code === code);
    if (!offer) return { declined: false };
    this.state.offers = this.state.offers.filter((o) => o !== offer);
    if (never) this.state.never = [...new Set([...this.state.never, guildKey(offer.realm, offer.faction, offer.guildName)])].slice(-LIMITS.never);
    this.save(); this.changed("offers");
    return { declined: true };
  }
  /** Guilds the player said Never to, so the choice can be taken back. */
  neverList() { return this.state.never.map((k) => { const [realm, fac, name] = k.split("|"); return { key: k, realm, faction: fac, guildName: name }; }); }
  allowAgain(key) { const n = this.state.never.length; this.state.never = this.state.never.filter((k) => k !== key); if (n !== this.state.never.length) { this.save(); this.changed("offers"); } return { removed: n !== this.state.never.length }; }

  // -------- G3 to G5
  async refreshGuild(guildId, { force = false } = {}) {
    const g = this.guild(guildId), mid = memberId(g), key = `g:${mid}`;
    if (this.busy.has(key) || (!force && this.now() - (this.lastRefresh.get(key) || 0) < REFRESH_GAP)) return { status: "fresh" };
    this.busy.add(key); this.lastRefresh.set(key, this.now());
    try {
      const j = await this.guildCall(g, "GET");
      g.guildName = typeof j.guildName === "string" && j.guildName ? j.guildName.slice(0, 40) : g.guildName;
      g.role = ["leader", "officer", "member"].includes(j.role) ? j.role : g.role;
      g.members = (Array.isArray(j.members) ? j.members : []).map((m) => (who(m) ? { ...who(m), role: ["leader", "officer", "member"].includes(m.role) ? m.role : "member", discord: typeof m.discord === "string" && m.discord ? line(m.discord, 60) : null, lastSeen: time(m.lastSeen) } : null)).filter(Boolean).slice(0, LIMITS.members);
      g.memberCount = g.members.length;
      g.linkedDiscord = g.members.find((m) => sameWho(m, g.character))?.discord || null;
      for (const k of ["officerRank", "proposeRank", "editRank"]) if (int(j.thresholds?.[k], 0, 9)) g.thresholds[k] = j.thresholds[k];
      const d = j.discord || {};
      g.discord = { state: DISCORD_STATES.includes(d.state) ? d.state : "none", guildName: typeof d.guildName === "string" ? line(d.guildName, 100) : null, channel: typeof d.channel === "string" ? line(d.channel, 100) : null, problem: typeof d.problem === "string" ? line(d.problem, 300) : null };
      g.syncedAt = this.now();
      this.save(); this.updateHandoff(); this.changed("guilds");
      return { status: "synced" };
    } catch (e) {
      if (e.code === "gone") this.dropGuild(mid);
      throw e;
    } finally { this.busy.delete(key); }
  }
  /** The full refetch of events and sign-ups, merged with what is already known by the one rule. */
  async refreshEvents(guildId) {
    const g = this.guild(guildId), mid = memberId(g), key = `e:${mid}`;
    if (this.busy.has(key)) return { status: "busy" };
    this.busy.add(key);
    try {
      const j = await this.guildCall(g, "GET", "/events"); // without "since": every stored event, the full refetch
      // The service is one replica among several: its rows are merged in, and rows it no longer lists stay
      // only while the game still holds them (the hand-off and the saved file decide that, not the app).
      const serverIds = new Set((Array.isArray(j.events) ? j.events : []).map((e) => e?.id));
      const kept = { events: g.events.filter((e) => serverIds.has(e.id) || this.gameKnown.has(e.id) || this.state.queue.some((q) => q.guildId === mid && q.eventId === e.id)), signups: g.signups };
      const merged = mergeGuild(kept, { events: j.events, signups: j.signups && typeof j.signups === "object" ? j.signups : {} });
      g.events = merged.events; g.signups = merged.signups;
      for (const id of merged.changed.events) this.pending.add(`e:${id}`);
      for (const [id, name] of merged.changed.signups) this.pending.add(`s:${id}:${lower(name)}`);
      this.save(); this.updateHandoff(); this.changed("events");
      return { status: "synced" };
    } catch (e) {
      if (e.code === "gone") this.dropGuild(mid);
      throw e;
    } finally { this.busy.delete(key); }
  }
  /** After the stream (re)connected, or when a screen asks: read everything again and send what waited. */
  async refetch() {
    for (const g of [...this.state.guilds]) {
      await this.refreshGuild(memberId(g), { force: true }).catch(() => {});
      if (this.state.guilds.includes(g)) await this.refreshEvents(memberId(g)).catch(() => {});
    }
    await this.flush().catch(() => {});
    if (this.state.board.on && (this.now() < this.watchUntil || this.listingLive())) await this.browse().catch(() => {});
  }
  /** The stream refused our session: find the membership the service no longer knows and drop it. */
  async verifyMemberships() { for (const g of [...this.state.guilds]) await this.refreshGuild(memberId(g), { force: true }).catch(() => {}); }
  async rotateCode(guildId) {
    const g = this.guild(guildId);
    const j = await this.guildCall(g, "PATCH", "", { schema: 1, rotateCode: true });
    if (typeof j.linkCode === "string" && CODE_RE.test(j.linkCode)) { g.linkCode = j.linkCode; g.linkHeard = false; }
    this.save(); this.changed("guilds");
    return { rotated: true };
  }
  async setThresholds(guildId, input) {
    const g = this.guild(guildId), thresholds = {};
    for (const k of ["officerRank", "proposeRank", "editRank"]) if (input && int(input[k], 0, 9)) thresholds[k] = input[k];
    if (!Object.keys(thresholds).length) throw new GuildError("invalid");
    const j = await this.guildCall(g, "PATCH", "", { schema: 1, thresholds });
    for (const k of ["officerRank", "proposeRank", "editRank"]) if (int(j.thresholds?.[k], 0, 9)) g.thresholds[k] = j.thresholds[k];
    this.save(); this.changed("guilds");
    return { saved: true };
  }
  /** Leave: the service removes this character's name and sign-ups; the token is deleted here whatever the answer. */
  async leave(guildId) {
    const g = this.guild(guildId);
    let told = true;
    try { await this.guildCall(g, "POST", "/leave"); } catch (e) { if (e.code !== "gone") told = false; }
    if (!told) throw new GuildError("offline", "The service could not be reached, so your name is still on it. You are still a member here. Try Leave again when you are online.");
    this.dropGuild(memberId(g));
    return { left: true };
  }
  async removeMember(guildId, name) {
    const g = this.guild(guildId);
    if (typeof name !== "string" || !NAME_RE.test(name)) throw new GuildError("invalid");
    await this.guildCall(g, "DELETE", `/members/${encodeURIComponent(name)}`);
    g.members = g.members.filter((m) => lower(m.name) !== lower(name)); g.memberCount = g.members.length;
    this.save(); this.changed("guilds");
    return { removed: true };
  }
  /** Delete our guild's data: everything on the service, and the Discord connection. The typed name must match. */
  async deleteGuild(guildId, typed) {
    const g = this.guild(guildId);
    if (typeof typed !== "string" || typed.trim() !== g.guildName) throw new GuildError("invalid", "Type the guild's name exactly to delete its data.");
    try { await this.guildCall(g, "DELETE"); } catch (e) { if (e.code !== "gone") throw e; }
    this.dropGuild(g.guildId, { whole: true }); // every character of this desktop in that guild
    return { deleted: true };
  }

  // -------- E1, E2, E3
  can(g, what) { return g.role === "leader" || g.role === "officer" || g.rankIndex <= (what === "edit" ? g.thresholds.editRank : g.thresholds.proposeRank); }
  enqueue(entry) {
    const same = (q) => q.guildId === entry.guildId && q.type === entry.type && q.eventId === entry.eventId && (entry.type === "event" || sameWho(q.body.who, entry.body.who));
    const item = { ...entry, queuedAt: this.now() };
    this.state.queue = [...this.state.queue.filter((q) => !same(q)), item].slice(-LIMITS.queue);
    this.save();
    return item;
  }
  /**
   * The service answers a PUT with 200 { accepted, reason, event | signup }: a row that loses is not an
   * error, and the answer carries what the service keeps. That stored row then replaces ours here, so
   * the screens show what every other member sees. Returns { accepted, reason }.
   */
  async send(entry) {
    const g = this.guild(entry.guildId);
    const j = entry.type === "event" ? await this.guildCall(g, "PUT", `/events/${entry.eventId}`, entry.body)
      : await this.guildCall(g, "PUT", `/events/${entry.eventId}/signups/${encodeURIComponent(entry.body.who.name)}`, entry.body);
    if (j.accepted !== false) return { accepted: true, reason: typeof j.reason === "string" ? j.reason.slice(0, 20) : "" };
    const reason = typeof j.reason === "string" ? j.reason.slice(0, 20) : "";
    if (entry.type === "event") {
      const stored = eventShape(j.event);
      if (stored) g.events = [...g.events.filter((e) => e.id !== stored.id), stored].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      else if (["past", "ahead", "creator"].includes(reason)) { g.events = g.events.filter((e) => e.id !== entry.eventId); delete g.signups[entry.eventId]; }
    } else {
      const stored = signupShape(j.signup), rows = (g.signups[entry.eventId] || []).filter((s) => !sameWho(s.who, entry.body.who));
      if (stored) g.signups[entry.eventId] = [...rows, stored];
      else if (["closed", "full"].includes(reason)) { if (rows.length) g.signups[entry.eventId] = rows; else delete g.signups[entry.eventId]; }
    }
    this.save(); this.updateHandoff(); this.changed("events");
    return { accepted: false, reason };
  }
  /**
   * Every change goes through the queue: it is sent at once when the service answers, and waits when it
   * does not. A row the service refuses for good is taken out, undone here (undo) and reported.
   */
  async sendOrQueue(entry, undo = null) {
    const item = this.enqueue(entry);
    const result = await this.flush();
    const refused = result.refused.find((r) => r.item === item);
    if (refused) { try { undo?.(); } catch {} this.save(); this.updateHandoff(); this.changed("events"); throw refused.error; }
    // Not taken by the service's own rule: say why when the player can do something about it. ("older" and
    // "hearsay" only mean the service already holds a newer row, which is now shown.)
    const declined = result.declined.find((r) => r.item === item);
    const why = declined && { closed: "This event takes no more answers: it was called off or began more than 4 hours ago.", full: "This event already has 40 answers.", past: "This event began more than 4 hours ago.", ahead: "An event can be at most 180 days ahead.", creator: "Another event already uses this number. Propose it again." }[declined.reason];
    if (why) throw new GuildError("invalid", why);
    if (this.state.queue.includes(item)) { this.changed("queue"); return { sent: false, queued: true }; }
    return { sent: true };
  }
  /** Send what waits: events before sign-ups, oldest first. Stops at the first failure a later try could fix. Never throws. */
  async flush() {
    const out = { sent: 0, refused: [], declined: [] };
    if (!this.state.queue.length || this.busy.has("queue")) return out;
    this.busy.add("queue");
    const tried = new Set();
    try {
      for (;;) {
        // A sign-up for an event the service has not seen yet would be refused, so events go first.
        const item = [...this.state.queue].filter((q) => !tried.has(q)).sort((a, b) => (a.type === b.type ? a.queuedAt - b.queuedAt : a.type === "event" ? -1 : 1))[0];
        if (!item) break;
        tried.add(item);
        if (!this.has(item.guildId)) { this.state.queue = this.state.queue.filter((q) => q !== item); continue; }
        try { const r = await this.send(item); out.sent++; if (!r.accepted) out.declined.push({ item, reason: r.reason }); }
        catch (e) {
          if (e.code === "offline" || e.code === "rate" || e.code === "blocked") break;
          out.refused.push({ item, error: e }); // refused for good: it can never be sent
        }
        this.state.queue = this.state.queue.filter((q) => q !== item);
      }
    } finally { this.busy.delete("queue"); this.save(); if (out.sent) this.changed("queue"); }
    return out;
  }
  /** Once a minute from the app: send what waits, and let an expired listing go. */
  async tick() {
    if (this.stopped) return;
    if (this.state.board.listing && !this.listingLive()) { this.state.board.listing = null; this.save(); this.syncSubs(); this.changed("board"); }
    if (this.state.queue.length) await this.flush().catch(() => {});
  }
  /** An event the game's saved file holds but the service may not: take it in and send it ahead of what depends on it. */
  adoptSaved(g, eventId) {
    if (g.events.some((e) => e.id === eventId)) return true;
    const entry = this.saved().find((e) => sameWho({ name: e.name, realm: e.realm }, g.character));
    const e = entry ? fromSaved(entry.guild, g.realm).events.find((x) => x.id === eventId) : null;
    if (!e) return false;
    this.apply(g, { events: [e] }, { fromGame: true });
    this.enqueue({ type: "event", guildId: memberId(g), eventId, body: e });
    return true;
  }
  apply(g, incoming, { fromGame = false } = {}) {
    const merged = mergeGuild({ events: g.events, signups: g.signups }, incoming);
    g.events = merged.events; g.signups = merged.signups;
    if (!fromGame) { for (const id of merged.changed.events) this.pending.add(`e:${id}`); for (const [id, name] of merged.changed.signups) this.pending.add(`s:${id}:${lower(name)}`); }
    return merged.changed;
  }
  /** Your own answer to an event, from the desktop. It shows at once, and reaches the service now or when it is back. */
  async answer(guildId, eventId, answer) {
    const g = this.guild(guildId);
    if (!ANSWERS.includes(answer) || typeof eventId !== "string" || !this.adoptSaved(g, eventId) || g.events.find((e) => e.id === eventId).cancelled) throw new GuildError("invalid", "This event is no longer on the list.");
    const before = g.signups[eventId] ? [...g.signups[eventId]] : null;
    const old = (before || []).find((s) => sameWho(s.who, g.character));
    if (old && old.answer === answer && old.version > 0) return { sent: true, unchanged: true };
    const body = { who: g.character, answer, version: (old?.version || 0) + 1, via: "desktop" };
    this.apply(g, { signups: { [eventId]: [body] } });
    this.save(); this.updateHandoff(); this.changed("events");
    return this.sendOrQueue({ type: "signup", guildId: memberId(g), eventId, body }, () => { if (before) g.signups[eventId] = before; else delete g.signups[eventId]; this.pending.delete(`s:${eventId}:${lower(g.character.name)}`); });
  }
  /** Propose or change an event from the desktop (members whose rank allows it). */
  async saveEvent(guildId, input) {
    const g = this.guild(guildId);
    const old = input?.id ? g.events.find((e) => e.id === input.id) : null;
    if (input?.id && !old) throw new GuildError("gone", "This event is no longer on the list.");
    if (!this.can(g, old ? "edit" : "propose") && !(old && sameWho(old.creator, g.character))) throw new GuildError("forbidden");
    const body = eventShape({ id: old ? old.id : this.randomId(8), version: old ? old.version + 1 : 1, creator: old ? old.creator : g.character, editor: g.character,
      at: input.at, place: input.place, title: input.title, note: input.note ?? "", roles: input.roles, cancelled: input.cancelled === true });
    if (!body) throw new GuildError("invalid", "Check the title, the time and the numbers. A title needs 2 to 40 characters and no web address.");
    // The game's own events hold at most 9 tanks and 9 healers; more would not survive the trip into the game.
    if (body.roles.tank > 9 || body.roles.healer > 9) throw new GuildError("invalid", "The game allows at most 9 tanks and 9 healers for an event.");
    if (!old && Date.parse(body.at) < this.now() - 3600 * 1000) throw new GuildError("invalid", "The time of the event is in the past.");
    const before = [...g.events];
    this.apply(g, { events: [body] });
    this.save(); this.updateHandoff(); this.changed("events");
    const result = await this.sendOrQueue({ type: "event", guildId: memberId(g), eventId: body.id, body }, () => { g.events = before; this.pending.delete(`e:${body.id}`); });
    return { ...result, id: body.id };
  }
  cancelEvent(guildId, id) {
    const e = this.guild(guildId).events.find((x) => x.id === id);
    if (!e) throw new GuildError("gone", "This event is no longer on the list.");
    return this.saveEvent(guildId, { ...e, cancelled: true });
  }
  /** E3. After the event: who came, how many bosses, how long. Posted to the guild's Discord by the service. */
  async postSummary(guildId, eventId, input) {
    const g = this.guild(guildId);
    if (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId)) throw new GuildError("invalid");
    const j = await this.guildCall(g, "POST", `/events/${eventId}/summary`, summaryBody(input));
    return { sent: true, posted: j.posted === true }; // posted: whether a Discord post was queued
  }

  // -------- Discord (D1, D3)
  /** D1. Returns Discord's own add-bot page for the caller to open in the system browser. */
  async discordStart(guildId) {
    const g = this.guild(guildId);
    const j = await this.guildCall(g, "POST", "/discord/start");
    const url = discordUrl(j.url);
    if (!url) throw new GuildError("offline", "The service answered with a link that is not Discord's. Nothing was opened.");
    this.discordOff = false;
    if (g.discord.state === "none") g.discord = { ...g.discord, state: "pending" };
    this.save(); this.changed("guilds");
    return { url };
  }
  async discordTest(guildId) {
    const g = this.guild(guildId);
    const j = await this.guildCall(g, "POST", "/discord/test");
    // The answer says whether the bot could post, and carries the Discord state with the reason when it could not.
    const d = j.discord;
    if (d && DISCORD_STATES.includes(d.state)) g.discord = { state: d.state, guildName: typeof d.guildName === "string" ? line(d.guildName, 100) : g.discord.guildName, channel: typeof d.channel === "string" ? line(d.channel, 100) : g.discord.channel, problem: typeof d.problem === "string" ? line(d.problem, 300) : null };
    const posted = j.posted !== false;
    if (posted) g.testAt = this.now();
    this.save(); this.updateHandoff(); this.changed("guilds");
    return { posted };
  }
  async discordDisconnect(guildId) {
    const g = this.guild(guildId);
    await this.guildCall(g, "DELETE", "/discord");
    g.discord = { state: "none", guildName: null, channel: null, problem: null }; g.linkedDiscord = null; g.testAt = 0;
    for (const m of g.members) m.discord = null;
    this.save(); this.updateHandoff(); this.changed("guilds");
    return { disconnected: true };
  }
  /** D3. The code Discord gave after /backstage link ties this character to that Discord user. */
  async discordLink(guildId, code) {
    const g = this.guild(guildId);
    const clean = typeof code === "string" ? code.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(clean)) throw new GuildError("invalid", "That does not look like a link code. In Discord type /backstage link and copy the code it shows.");
    let j;
    try { j = await this.guildCall(g, "POST", "/discord/link", { schema: 1, code: clean }); }
    catch (e) { if (e.code === "gone" && this.state.guilds.includes(g)) throw new GuildError("gone", "Discord does not know this code, or it was already used. Type /backstage link in Discord for a new one."); throw e; }
    g.linkedDiscord = typeof j.discord === "string" && j.discord ? line(j.discord, 60) : g.linkedDiscord;
    this.save(); this.changed("guilds");
    void this.refreshGuild(memberId(g), { force: true }).catch(() => {});
    return { linked: true, name: g.linkedDiscord };
  }
  async discordUnlink(guildId) {
    const g = this.guild(guildId);
    await this.guildCall(g, "DELETE", "/discord/link");
    g.linkedDiscord = null; this.save(); this.changed("guilds");
    return { unlinked: true };
  }

  // -------- the realm party board (P1)
  listingLive() { const l = this.state.board.listing; return Boolean(l && this.now() - l.postedAt < LISTING_LIFE); }
  /** Which board the screens look at: the realm and faction of the character in front. */
  setBoardPlace(where) {
    const f = faction(where?.faction);
    const next = f && typeof where.realm === "string" && REALM_RE.test(where.realm) ? { realm: where.realm, faction: f } : null;
    if (JSON.stringify(next) === JSON.stringify(this.boardWhere || null)) return;
    this.boardWhere = next; this.board.listings.clear(); this.board.loadedAt = 0;
    this.syncSubs();
  }
  /** The board's own switch. Off: nothing about the board is asked or sent, and your listing is removed. */
  async setBoard(on) {
    if (on === this.state.board.on) return { on };
    if (!on && this.state.board.listing) await this.removeListing().catch(() => {});
    this.state.board.on = on === true;
    if (!on) { this.state.board.postConsent = false; this.state.board.listing = null; this.board.listings.clear(); this.watchUntil = 0; }
    this.save(); this.syncSubs(); this.updateHandoff(); this.changed("board");
    return { on: this.state.board.on };
  }
  /** A screen showing the board says so every minute or two; the live subscription lasts while one does. */
  watchBoard(watching = true) {
    this.watchUntil = watching && this.state.board.on ? this.now() + WATCH_TTL : 0;
    this.syncSubs();
    this.timers.clearTimeout(this.watchTimer);
    if (this.watchUntil) { this.watchTimer = this.timers.setTimeout(() => this.syncSubs(), WATCH_TTL + 1000); this.watchTimer?.unref?.(); }
  }
  async browse() {
    if (!this.state.board.on) throw new GuildError("consent", "The party board is off. Switch it on first.");
    const where = this.boardPlace();
    if (!where) throw new GuildError("invalid", "The app does not know this character's realm and faction yet. Log in with it and type /reload once.");
    if (this.busy.has("board")) return { status: "busy" };
    this.busy.add("board");
    try {
      const j = await this.call("GET", `/v1/lfg?${new URLSearchParams({ realm: where.realm, faction: where.faction })}`);
      this.board.listings = new Map((Array.isArray(j.listings) ? j.listings : []).map(listingShape).filter(Boolean).slice(0, LIMITS.listings).map((l) => [l.id, l]));
      this.board.loadedAt = this.now(); this.board.error = null;
      this.updateHandoff(); this.changed("board");
      return { status: "synced" };
    } catch (e) { this.board.error = e.message; this.changed("board"); throw e; }
    finally { this.busy.delete("board"); }
  }
  /** Post or edit your listing. The first post needs consent literally true: the card said what others will see. */
  async post(input, { consent } = {}) {
    if (!this.state.board.on) throw new GuildError("consent", "The party board is off. Switch it on first.");
    if (!this.state.board.postConsent && consent !== true) throw new GuildError("consent", "Nothing is posted until you agree.");
    const where = this.boardWhere, mine = this.state.board.listing;
    if (!where) throw new GuildError("invalid", "The app does not know this character's realm and faction yet. Log in with it and type /reload once.");
    const id = typeof input?.id === "string" && /^[a-z0-9]{16}$/.test(input.id) ? input.id : mine && this.listingLive() ? mine.listing.id : this.randomId(16);
    const body = listingBody({ installId: this.installId, realm: where.realm, faction: where.faction, consent: true,
      listing: { id, kind: input?.kind, who: input?.who, level: input?.level, class: lower(input?.class) || null, roles: input?.roles, place: input?.place, note: input?.note ?? "", need: input?.need ?? null, at: iso(this.now()) } });
    await this.call("PUT", `/v1/lfg/${id}`, { body });
    this.state.board.postConsent = true;
    this.state.board.listing = { realm: where.realm, faction: where.faction, listing: body.listing, postedAt: this.now() };
    this.board.listings.set(id, body.listing);
    this.save(); this.syncSubs(); this.updateHandoff(); this.changed("board");
    return { posted: true, id };
  }
  /** Another 30 minutes for the same listing. */
  async renew() {
    const mine = this.state.board.listing;
    if (!mine) throw new GuildError("gone", "You have no listing on the board.");
    const prev = this.boardWhere; this.boardWhere = { realm: mine.realm, faction: mine.faction };
    try { return await this.post({ ...mine.listing }, { consent: true }); } finally { this.boardWhere = prev || this.boardWhere; }
  }
  async removeListing() {
    const mine = this.state.board.listing;
    if (!mine) return { removed: false };
    try { await this.call("DELETE", `/v1/lfg/${mine.listing.id}`, { body: { schema: 1, installId: this.installId } }); }
    catch (e) { if (e.code !== "gone" && this.listingLive()) throw e; } // an expired listing is already gone on the service
    this.state.board.listing = null; this.board.listings.delete(mine.listing.id);
    this.save(); this.syncSubs(); this.updateHandoff(); this.changed("board");
    return { removed: true };
  }
  boardView() {
    const b = this.state.board, now = this.now(), mine = b.listing;
    if (mine && !this.listingLive()) { b.listing = null; this.save(); }
    const rows = new Map();
    for (const l of this.board.heard.values()) if (now - Date.parse(l.at) < LISTING_LIFE) rows.set(l.id, { ...l, source: "game" });
    for (const l of this.board.listings.values()) rows.set(l.id, { ...l, source: "service" });
    const listings = [...rows.values()].filter((l) => !(b.listing && l.id === b.listing.listing.id)).sort((a, b2) => b2.at.localeCompare(a.at)).slice(0, LIMITS.listings);
    return { on: b.on, postConsent: b.postConsent, where: this.boardWhere || null, loadedAt: this.board.loadedAt || null, error: this.board.error,
      mine: b.listing ? { ...b.listing.listing, realm: b.listing.realm, faction: b.listing.faction, postedAt: b.listing.postedAt, expiresAt: b.listing.postedAt + LISTING_LIFE } : null, listings };
  }

  // -------- what the game reports (game-guild-feed)
  onFeed(name, payload) {
    if (!payload || typeof payload !== "object") return;
    const character = who(payload.character);
    if (character) this.lastCharacter = character;
    if (name === "link") {
      const f = faction(payload.faction), code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
      if (!character || !f || !CODE_RE.test(code) || typeof payload.guildName !== "string" || !GUILD_NAME_RE.test(payload.guildName)) return;
      const realm = typeof payload.realm === "string" && REALM_RE.test(payload.realm) ? payload.realm : character.realm;
      // The leader's own code coming back from the game is the proof that step 2 was done.
      const own = this.state.guilds.find((g) => g.linkCode === code);
      if (own && !own.linkHeard) { own.linkHeard = true; this.save(); this.changed("guilds"); }
      // Another character of this player in the same guild is invited like anyone else.
      if (own && sameWho(own.character, character)) return;
      if (this.guildOf(character) || this.state.never.includes(guildKey(realm, f, payload.guildName))) return;
      const offer = { code, guildName: payload.guildName, realm, faction: f, character, rankIndex: int(payload.rankIndex, 0, 9) ? payload.rankIndex : 9, heardAt: this.now() };
      // A newer code for the same guild and character replaces the older one (the leader rotated it).
      this.state.offers = [...this.state.offers.filter((o) => !(sameWho(o.character, character) && guildKey(o.realm, o.faction, o.guildName) === guildKey(realm, f, payload.guildName))), offer].slice(-LIMITS.offers);
      this.save(); this.changed("offers");
      return;
    }
    if (name === "unlink") {
      // The leader ended the link in game: invitations for that guild are withdrawn. Members stay until they leave.
      const f = faction(payload.faction);
      if (!character || !f || typeof payload.guildName !== "string") return;
      const key = guildKey(typeof payload.realm === "string" ? payload.realm : character.realm, f, payload.guildName), before = this.state.offers.length;
      this.state.offers = this.state.offers.filter((o) => guildKey(o.realm, o.faction, o.guildName) !== key);
      for (const g of this.state.guilds) if (g.linkCode && guildKey(g.realm, g.faction, g.guildName) === key) g.linkHeard = false;
      if (before !== this.state.offers.length) this.changed("offers");
      this.save(); this.changed("guilds");
      return;
    }
    if (name === "party") { this.setParty(payload, character); return; }
    if (name === "listing") {
      if (payload.gone === true) {
        if (typeof payload.id === "string" && this.board.heard.delete(payload.id)) { this.updateHandoff(); this.changed("board"); }
        // "/bf lfg list off" in game takes your own listing off the service too.
        if (this.state.board.listing?.listing.id === payload.id) void this.removeListing().catch(() => {});
        return;
      }
      const l = listingShape(payload);
      if (!l) return;
      // Your own listing made in game ("/bf lfg list …") is posted for you, but only if you already agreed
      // to the board and to posting in the app; otherwise it stays in the game.
      if (character && sameWho(l.who, character) && this.state.board.on && this.state.board.postConsent && this.boardWhere && this.state.board.listing?.listing.id !== l.id) {
        void this.post({ ...l }, { consent: true }).catch(() => {});
        return;
      }
      this.board.heard.set(l.id, l);
      if (this.board.heard.size > LIMITS.listings) this.board.heard.delete(this.board.heard.keys().next().value);
      this.changed("board");
      return;
    }
    // Events and sign-ups go to the service only for a guild this character joined in the app.
    const g = this.guildOf(character);
    if (name === "event") {
      const e = eventShape(payload);
      if (!e) return;
      this.gameKnown.set(e.id, Math.max(this.gameKnown.get(e.id) || 0, e.version));
      if (!g) return;
      const changed = this.apply(g, { events: [e] }, { fromGame: true });
      this.pending.delete(`e:${e.id}`);
      if (!changed.events.length) { this.updateHandoff(); return; }
      this.save(); this.updateHandoff(); this.changed("events");
      void this.sendOrQueue({ type: "event", guildId: memberId(g), eventId: e.id, body: e }).catch(() => {});
      return;
    }
    if (name === "signup") {
      const s = signupShape({ ...payload.signup, via: "game" }), eventId = payload.eventId;
      if (!s || typeof eventId !== "string" || !EVENT_ID_RE.test(eventId) || !g || !this.adoptSaved(g, eventId)) return;
      const changed = this.apply(g, { signups: { [eventId]: [s] } }, { fromGame: true });
      this.pending.delete(`s:${eventId}:${lower(s.who.name)}`);
      if (!changed.signups.length) return;
      this.save(); this.updateHandoff(); this.changed("events");
      // A member sets only their own answer; officers may pass on anyone's.
      if (sameWho(s.who, g.character) || g.role !== "member") void this.sendOrQueue({ type: "signup", guildId: memberId(g), eventId, body: s }).catch(() => {});
    }
  }
  setParty(p, character) {
    const members = (Array.isArray(p.members) ? p.members : []).map((m) => {
      const w = who(m);
      return w ? { ...w, class: CLASSES.includes(lower(m.class)) ? lower(m.class) : null, role: ROLES.includes(m.role) ? m.role : null, level: int(m.level, 1, 100) ? m.level : null, online: m.online !== false, ready: typeof m.ready === "boolean" ? m.ready : null,
        // Readiness the game may add later ("missing": plain words). Shown as given, never guessed.
        missing: (Array.isArray(m.missing) ? m.missing : []).map((x) => line(x, 60, { empty: false })).filter(Boolean).slice(0, 6) } : null;
    }).filter(Boolean).slice(0, 40);
    const next = members.length ? { character, leader: who(p.leader) || (typeof p.leader === "string" ? splitName(p.leader, character?.realm) : null), members,
      total: int(p.total, members.length, 40) ? p.total : members.length,
      place: typeof p.place === "string" && PLACE_RE.test(p.place) ? p.place : null, plan: p.plan && typeof p.plan === "object" ? p.plan : null } : null;
    if (JSON.stringify(next) === JSON.stringify(this.party)) return;
    this.party = next; this.partyAt = this.now();
    this.emit("party", next);
    this.changed("party");
  }

  // -------- what the service reports (the live stream)
  onLive(name, data) {
    if (name === "lfg") {
      if (!this.state.board.on) return;
      const l = listingShape(data.listing);
      if (data.op === "gone") { const id = typeof data.listing?.id === "string" ? data.listing.id : null; if (id && this.board.listings.delete(id)) { this.updateHandoff(); this.changed("board"); } return; }
      if (data.op !== "put" || !l) return;
      this.board.listings.set(l.id, l);
      if (this.board.listings.size > LIMITS.listings) this.board.listings.delete(this.board.listings.keys().next().value);
      this.updateHandoff(); this.changed("board");
      return;
    }
    // Every character of this desktop in that guild keeps its own copy.
    for (const g of this.state.guilds.filter((x) => x.guildId === data.guildId)) this.onGuildLive(g, name, data);
  }
  onGuildLive(g, name, data) {
    if (name === "guild.event") { if (this.apply(g, { events: [data.event] }).events.length) { this.save(); this.updateHandoff(); this.changed("events"); } }
    else if (name === "guild.event.gone") {
      if (typeof data.id !== "string" || !g.events.some((e) => e.id === data.id)) return;
      g.events = g.events.filter((e) => e.id !== data.id); delete g.signups[data.id];
      this.state.queue = this.state.queue.filter((q) => !(q.guildId === memberId(g) && q.eventId === data.id));
      this.save(); this.updateHandoff(); this.changed("events");
    } else if (name === "guild.signup") {
      if (typeof data.eventId !== "string" || !EVENT_ID_RE.test(data.eventId)) return;
      if (this.apply(g, { signups: { [data.eventId]: [data.signup] } }).signups.length) { this.save(); this.updateHandoff(); this.changed("events"); }
    } else if (name === "guild.member") {
      if (int(data.members, 0, 100000)) g.memberCount = data.members;
      this.changed("guilds");
      // members: 0 is sent once when the guild was deleted; the read then finds out and forgets the membership.
      void this.refreshGuild(memberId(g), { force: data.members === 0 }).catch(() => {});
    } else if (name === "guild.discord") {
      if (DISCORD_STATES.includes(data.state)) g.discord = { ...g.discord, state: data.state, ...(data.state === "none" ? { guildName: null, channel: null, problem: null } : {}) };
      this.save(); this.updateHandoff(); this.changed("guilds");
      void this.refreshGuild(memberId(g), { force: true }).catch(() => {}); // the server's name and channel come with G3
    }
  }

  // -------- the hand-off to the game (read at its next /reload)
  /** Called after each read of the game's saved file: the game has taken the last hand-off by then. */
  savedFileRead() {
    this.pending.clear();
    this.gameKnown = new Map();
    for (const entry of this.saved()) for (const e of entry.guild?.events || []) this.gameKnown.set(e.id, Math.max(this.gameKnown.get(e.id) || 0, e.ver || 0));
    this.updateHandoff();
    this.changed("handoff");
  }
  saved() { try { return (this.getSaved() || []).filter((e) => e && e.guild); } catch { return []; } }
  /** The character whose data goes into the hand-off: the one last seen in game, else the one given, else the first guild's. */
  frontCharacter(preferred = null) { return this.lastCharacter || who(preferred) || this.state.guilds[0]?.character || null; }
  /** { guild, lfg, plan } in the contract's hand-off shapes: only rows the game lacks or holds older. */
  handoff(preferred = null) {
    const character = this.frontCharacter(preferred), g = this.guildOf(character);
    const out = { guild: null, lfg: null, plan: null };
    if (g) {
      const savedEntry = this.saved().find((e) => sameWho({ name: e.name, realm: e.realm }, g.character));
      const savedAnswers = new Map();
      for (const e of savedEntry?.guild?.events || []) for (const s of e.signups || []) { const w = splitName(s.name, g.realm); if (w) savedAnswers.set(`${e.id}|${whoKey(w)}`, LETTER[s.status]); }
      const nowIso = iso(this.now() - 4 * 3600 * 1000);
      const signups = {};
      for (const e of g.events) {
        if (e.at < nowIso) continue;
        const rows = (g.signups[e.id] || []).filter((s) => s.version > 0 && s.via !== "game" && savedAnswers.get(`${e.id}|${whoKey(s.who)}`) !== s.answer);
        if (rows.length) signups[e.id] = rows;
      }
      // The game takes a sign-up only together with its event's row, so an event with answers to hand over
      // goes along even when the game already holds that version (the addon's merge then leaves it alone).
      const events = g.events.filter((e) => e.at >= nowIso && ((this.gameKnown.get(e.id) || 0) < e.version || signups[e.id]));
      out.guild = { id: g.guildId, guildName: g.guildName, realm: g.realm, events, signups, discord: g.discord.state };
    }
    if (this.state.board.on) {
      const rows = [...this.board.listings.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMITS.handoffListings);
      const where = this.boardPlace();
      if (rows.length && where) out.lfg = { realm: where.realm, faction: where.faction, rows };
    }
    try { out.plan = this.getPlan(character) || null; } catch { out.plan = null; }
    return out;
  }
  /** Hand the newest picture to the game side whenever it changed. */
  updateHandoff(preferred = null) {
    if (this.stopped || typeof this.setHandoff !== "function") return false;
    const data = this.handoff(preferred), key = JSON.stringify(data);
    if (key === this.lastHandoff) return false;
    this.lastHandoff = key;
    try { this.setHandoff(data); } catch { /* the game side is not there: the panel still shows everything */ }
    this.changed("handoff");
    return true;
  }
  /** The group plan changed (group-planner.cjs): it travels in the same hand-off. */
  planChanged() { this.pending.add("plan"); this.updateHandoff(); this.changed("handoff"); }
  /** How many guild events, sign-ups and plan changes wait for the game's next /reload. */
  pendingCount() {
    const data = this.handoff();
    let n = this.pending.has("plan") && data.plan ? 1 : 0;
    for (const e of data.guild?.events || []) if (this.pending.has(`e:${e.id}`)) n++;
    // (board listings are handed over too, but they come and go by the minute and are not counted)
    for (const [id, rows] of Object.entries(data.guild?.signups || {})) for (const s of rows) if (this.pending.has(`s:${id}:${lower(s.who.name)}`)) n++;
    return n;
  }

  // -------- what the screens may know (never a token)
  publicGuild(g) {
    const now = this.now();
    const savedEntry = this.saved().find((e) => sameWho({ name: e.name, realm: e.realm }, g.character));
    // Server data merged with what the saved file knows, by the one rule.
    const merged = mergeGuild({ events: g.events, signups: g.signups }, savedEntry ? fromSaved(savedEntry.guild, g.realm) : null);
    const events = merged.events.filter((e) => Date.parse(e.at) + 4 * 3600 * 1000 >= now).map((e) => ({ ...publicEvent(e, merged.signups[e.id], g.character),
      waiting: this.state.queue.some((q) => q.guildId === memberId(g) && q.eventId === e.id), inGame: (this.gameKnown.get(e.id) || 0) >= e.version }));
    return { guildId: g.guildId, memberId: memberId(g), guildName: g.guildName, realm: g.realm, faction: g.faction, character: g.character, role: g.role, joinedAt: g.joinedAt,
      linkCode: g.role === "member" ? null : g.linkCode, linkHeard: g.linkHeard || (g.memberCount || 0) > 1, thresholds: { ...g.thresholds },
      canPropose: this.can(g, "propose"), canEdit: this.can(g, "edit"), canManage: g.role === "leader" || g.role === "officer", isLeader: g.role === "leader",
      members: g.members.map((m) => ({ ...m, me: sameWho(m, g.character) })), memberCount: g.memberCount ?? g.members.length, syncedAt: g.syncedAt || null,
      discord: { ...g.discord, available: !this.discordOff, testAt: g.testAt || null }, linkedDiscord: g.linkedDiscord,
      events: events.filter((e) => !e.cancelled), waiting: this.state.queue.filter((q) => q.guildId === memberId(g)).length };
  }
  view() {
    return { live: this.live ? this.live.status() : { state: "idle", needed: false }, guilds: this.state.guilds.map((g) => this.publicGuild(g)), offers: this.offers(), never: this.neverList(),
      board: this.boardView(), party: this.party ? { ...this.party, at: this.partyAt } : null, pending: this.pendingCount(), waiting: this.state.queue.length, discordAvailable: !this.discordOff };
  }
  /** "See exactly what is sent": the bodies this app would send now for a character, with the token left out. */
  preview(character) {
    const c = who(character), g = this.guildOf(c), mine = this.state.board.listing;
    return { member: Boolean(g), join: c ? { schema: 1, installId: this.installId, linkCode: "BFG-XXXX-XXXX", character: c, rankIndex: g?.rankIndex ?? 9, consent: true } : null,
      signup: g ? { who: g.character, answer: "healer", version: 1, via: "desktop" } : null, board: this.state.board.on, listing: mine ? { ...mine.listing } : null };
  }
  /** After "Forget me" or a local reset: the service already removed this install from every guild. */
  wipe() {
    this.state = { schemaVersion: 1, guilds: [], offers: [], never: [], queue: [], board: { on: false, postConsent: false, listing: null } };
    this.board.listings.clear(); this.board.heard.clear(); this.pending.clear(); this.party = null; this.watchUntil = 0;
    this.save(); this.syncSubs(); this.updateHandoff(); this.changed("guilds");
  }
  /**
   * "Delete all local data": the memberships and the listing are deleted here at once, and the service is
   * told to drop them too (Leave for every guild, the listing removed), so no name is left behind there.
   * Returns a promise that settles when the service was told (or could not be reached).
   */
  reset() {
    const guilds = this.state.guilds.map((g) => ({ guildId: g.guildId, member: g.member }));
    const mine = this.state.board.listing ? this.state.board.listing.listing.id : null, installId = this.installId;
    try { const f = this.file(); if (f) fs.rmSync(f, { force: true }); } catch {}
    this.wipe();
    return Promise.allSettled([
      ...guilds.map((g) => this.call("POST", `/v1/guilds/${g.guildId}/leave`, { member: g.member })),
      ...(mine ? [this.call("DELETE", `/v1/lfg/${mine}`, { body: { schema: 1, installId } })] : []),
    ]);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.timers.clearTimeout(this.watchTimer);
    for (const [emitter, name, h] of this.handlers) { try { emitter.off(name, h); } catch {} }
    this.handlers = [];
    this.removeAllListeners();
  }
}

module.exports = { GuildService, GuildError, memberId, ROLES, ANSWERS, FACTIONS, CLASSES, LIMITS, LISTING_LIFE,
  who, sameWho, splitName, line, eventShape, signupShape, listingShape, eventWins, signupWins, mergeGuild, fromSaved, createBody, joinBody, listingBody, summaryBody, discordUrl };

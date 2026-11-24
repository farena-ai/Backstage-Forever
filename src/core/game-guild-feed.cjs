"use strict";
// Backstage Live, game side (docs: bf-live-guild-contract "Inside the app: who owns what").
// One EventEmitter the rest of the app listens to. It turns what the addon tells the desktop into
// five events, each also carrying `character` { name, realm } (who was logged in):
//   link     { code, character, rankIndex, guildName, realm, faction }
//   unlink   { character, guildName, realm, faction }                 (the leader typed /bf guild unlink)
//   event    E1 shape: { id, version, creator, editor, at, place, title, note, roles, cancelled }
//   signup   { eventId, signup: { who, answer, version, via: "game" } }
//   party    { leader, members: [{ name, realm, class, role, level, online, ready }], place, plan }
//   listing  P1 shape, or { gone: true, id }
// Two ways in: live signals (seconds; BackstageForeverLive.lua puts them on the live link as question
// pages that begin with bytes 1, 255 and "sig:", which an older app drops whole) and the saved file
// (the "live" and "guild" blocks of a character, read after /reload or logout). The same fact is
// emitted once: whatever arrives second is recognised and dropped.
// The other direction: setHandoff({ guild, lfg, plan }) keeps what the desktop wants the game to
// learn at its next login or /reload; desktop-handoff.cjs writes it (additive, schema 1, capped).
// Everything from the game is untrusted: each field is checked and a signal with anything off is
// dropped whole. Nothing here opens a socket or touches a file.
const { EventEmitter } = require("node:events");

const SIGNAL_PREFIX = "\u0001sig:";
const MAX_SIGNAL_BYTES = 600, MAX_MEMBERS = 40, MAX_SEEN = 4000;
const ANSWER = { t: "tank", h: "healer", d: "damage", m: "maybe", n: "no" };
const ANSWER_KEY = Object.fromEntries(Object.entries(ANSWER).map(([k, v]) => [v, k]));
const ROLE = { t: "tank", h: "healer", d: "damage" };
const ROLE_KEY = { tank: "t", healer: "h", damage: "d" };
const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
const FACTION = { H: "horde", A: "alliance" };
const VIA = { game: "g", desktop: "k", discord: "d" };
const LIMITS = Object.freeze({ events: 60, signupsPerEvent: 40, signups: 600, lfg: 40, planMembers: 40, title: 40, note: 80, lfgNote: 60, bring: 60, guildBytes: 96 * 1024, lfgBytes: 16 * 1024, planBytes: 6 * 1024 });

const bad = () => { throw Error("Invalid live signal."); };
const whole = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : bad());
const digits = (v, lo, hi) => (typeof v === "string" && /^(0|[1-9]\d{0,9})$/.test(v) ? whole(Number(v), lo, hi) : bad());
const bytes = (v) => Buffer.byteLength(v, "utf8");
// A character or guild-channel name: letters only (any script), 2 to 48 bytes, no digits, spaces or marks.
const NAME = /^[^\x00-\x40\x5b-\x60\x7b-\x7f]{2,}$/;
const name = (v) => (typeof v === "string" && bytes(v) >= 2 && bytes(v) <= 48 && NAME.test(v) ? v : bad());
// One line of plain words: no control characters, no "|" (the game's colour and link code).
const words = (v, max, min = 1) => (typeof v === "string" && bytes(v) >= min && bytes(v) <= max && !/[\x00-\x1f\x7f|]/.test(v) && v === v.trim() ? v : bad());
const realmName = (v) => words(v, 60);
const eventId = (v) => (typeof v === "string" && /^[a-z0-9]{6,10}$/.test(v) ? v : bad());
const placeId = (v) => (typeof v === "string" && /^[a-z][a-z0-9]{0,7}$/.test(v) ? v : bad());
const linkCode = (v) => (typeof v === "string" && /^BFG-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v) ? v : bad());
const listingId = (v) => (typeof v === "string" && /^[a-z0-9]{16}$/.test(v) ? v : bad());
const iso = (seconds) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
// "Name-Realm" as the addon writes its own character; the realm may hold spaces and apostrophes.
function who(v) {
  if (typeof v !== "string") bad();
  const at = v.indexOf("-");
  if (at < 2) bad();
  return { name: name(v.slice(0, at)), realm: realmName(v.slice(at + 1)) };
}
// A name as the party or guild channel gives it: "Name", or "Name-Realm" for another realm.
function member(v, realm) {
  if (typeof v !== "string") bad();
  const at = v.indexOf("-");
  return at < 0 ? { name: name(v), realm } : { name: name(v.slice(0, at)), realm: realmName(v.slice(at + 1)) };
}
const roles3 = (v, max) => { const m = /^(\d)\.(\d)\.(\d\d?)$/.exec(String(v)); if (!m) bad(); return { tank: whole(+m[1], 0, 9), healer: whole(+m[2], 0, 9), damage: whole(+m[3], 0, max) }; };

/** A signal's text (after the prefix) -> { type, payload } with `character`, or a throw. */
function parseSignal(text) {
  if (typeof text !== "string" || !text.length || bytes(text) > MAX_SIGNAL_BYTES || /[\x00-\x1f\x7f]/.test(text)) bad();
  const f = text.split("|"), kind = f[0];
  const character = who(f[1]);
  if (kind === "L1") {
    if (f.length !== 6) bad();
    return { type: "link", payload: { code: linkCode(f[4]), character, rankIndex: digits(f[2], 0, 9), guildName: words(f[5], 24, 2), realm: character.realm, faction: FACTION[f[3]] || bad() } };
  }
  if (kind === "X1") {
    if (f.length !== 4) bad();
    return { type: "unlink", payload: { character, guildName: words(f[3], 24, 2), realm: character.realm, faction: FACTION[f[2]] || bad() } };
  }
  if (kind === "E1") {
    if (f.length !== 12) bad();
    const creator = member(f[4], character.realm), editor = f[5] === "-" ? creator : member(f[5], character.realm);
    if (f[9] !== "x" && f[9] !== "-") bad();
    const title = words(f[10], LIMITS.title, 2), note = f[11] === "-" ? "" : words(f[11], LIMITS.note);
    return { type: "event", payload: { id: eventId(f[2]), version: digits(f[3], 1, 9999), creator, editor, at: iso(digits(f[6], 1000000000, 9999999999)), place: placeId(f[7]), title, note, roles: roles3(f[8], 40), cancelled: f[9] === "x", character } };
  }
  if (kind === "U1") {
    if (f.length !== 4) bad();
    const id = eventId(f[2]), rows = f[3].split(","), seen = new Set();
    if (!rows.length || rows.length > 12) bad();
    const signups = rows.map((row) => {
      const p = row.split(":");
      if (p.length !== 3 || !ANSWER[p[1]]) bad();
      const w = member(p[0], character.realm);
      if (seen.has(w.name.toLowerCase())) bad();
      seen.add(w.name.toLowerCase());
      return { eventId: id, signup: { who: w, answer: ANSWER[p[1]], version: digits(p[2], 1, 9999), via: "game" }, character };
    });
    return { type: "signup", payloads: signups };
  }
  if (kind === "P1") {
    if (f.length !== 7) bad();
    const rows = f[5] === "-" ? [] : f[5].split(";"), seen = new Set();
    if (rows.length > MAX_MEMBERS) bad();
    const members = rows.map((row) => {
      const p = row.split(":");
      if (p.length !== 6 || !/^[0-9]$/.test(p[1]) || !/^[thd-]$/.test(p[2]) || !/^[01]$/.test(p[4]) || !/^[01]$/.test(p[5])) bad();
      const w = member(p[0], character.realm);
      if (seen.has(`${w.name}-${w.realm}`.toLowerCase())) bad();
      seen.add(`${w.name}-${w.realm}`.toLowerCase());
      return { ...w, class: p[1] === "0" ? null : CLASSES[+p[1] - 1], role: ROLE[p[2]] || null, level: p[3] === "0" ? null : digits(p[3], 1, 100), online: p[4] === "1", ready: p[5] === "1" };
    });
    const leader = f[2] === "-" ? null : member(f[2], character.realm).name;
    const place = f[3] === "-" ? null : placeId(f[3]), planAt = digits(f[4], 0, 9999999999), total = digits(f[6], 0, MAX_MEMBERS);
    if (total < members.length) bad();
    // The plan as the party holds it: where to, when it was last changed, and who plays what. The
    // "bring" lines stay in the game (the desktop wrote them); roles set in game come back here.
    const plan = planAt ? { place, at: iso(planAt), members: members.filter((m) => m.role).map((m) => ({ name: m.name, realm: m.realm, role: m.role })) } : null;
    return { type: "party", payload: { leader, members, total, place, plan, character } };
  }
  if (kind === "F1") {
    if (f.length === 4 && f[3] === "x") return { type: "listing", payload: { gone: true, id: listingId(f[2]), character } };
    if (f.length !== 10 || (f[3] !== "g" && f[3] !== "m") || !/^[0-9]$/.test(f[5]) || !/^(-|t?h?d?)$/.test(f[6]) || f[6] === "") bad();
    const roles = f[6] === "-" ? [] : [...f[6]].map((c) => ROLE[c]);
    return { type: "listing", payload: { id: listingId(f[2]), kind: f[3] === "g" ? "lfg" : "lfm", who: character, level: digits(f[4], 1, 100), class: f[5] === "0" ? null : CLASSES[+f[5] - 1], roles,
      place: placeId(f[7]), note: f[9] === "-" ? "" : words(f[9], LIMITS.lfgNote), need: f[8] === "-" ? null : roles3(f[8], 40), character } };
  }
  return bad();
}

// ---------------------------------------------------------------- the saved-file block
// character.live = { v:1, at, me:"Name-Realm", faction:"H"|"A", link?: { code, guild, rank }, unlinked?: true,
//   mine?: [{ id, s, v }] (your own sign-ups), party?: "<P1 signal text>", listing?: "<F1 signal text>" }
// Party and listing are kept as the very signal text, so one decoder serves both ways in.
function normalizeLiveCapture(block) {
  if (!block || typeof block !== "object" || Array.isArray(block) || block.v !== 1) bad();
  for (const k of Object.keys(block)) if (!["v", "at", "me", "faction", "link", "unlinked", "mine", "party", "listing"].includes(k)) bad();
  const out = { at: whole(block.at, 1000000000, 9999999999), me: who(block.me) };
  if (block.faction !== undefined) out.faction = FACTION[block.faction] || bad();
  if (block.link !== undefined) {
    const l = block.link;
    if (!l || typeof l !== "object" || Array.isArray(l) || Object.keys(l).some((k) => !["code", "guild", "rank"].includes(k))) bad();
    out.link = { code: linkCode(l.code), guildName: words(l.guild, 24, 2), rankIndex: whole(l.rank, 0, 9) };
  }
  if (block.unlinked !== undefined) { if (block.unlinked !== true) bad(); out.unlinked = true; }
  const mine = block.mine === undefined ? [] : Array.isArray(block.mine) ? block.mine : block.mine && typeof block.mine === "object" && !Object.keys(block.mine).length ? [] : bad();
  if (mine.length > LIMITS.events) bad();
  out.mine = mine.map((r) => { if (!r || typeof r !== "object" || Object.keys(r).some((k) => !["id", "s", "v"].includes(k)) || !ANSWER[r.s]) bad(); return { id: eventId(r.id), answer: ANSWER[r.s], version: whole(r.v, 1, 9999) }; });
  for (const k of ["party", "listing"]) if (block[k] !== undefined) { const parsed = parseSignal(block[k]); if (parsed.type !== k) bad(); out[k] = block[k]; }
  return out;
}

// ---------------------------------------------------------------- hand-off shapes (desktop -> game)
const tryOr = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
// E1 as the desktop holds it -> the row the addon reads, or null. The addon's own event model is
// narrower than the service's: ids are 6 to 10 lower-case letters and digits, places up to 8.
function handoffEvent(e) {
  return tryOr(() => {
    const at = Math.floor(Date.parse(e.at) / 1000), r = e.roles || {};
    const creator = name(e.creator?.name), editor = e.editor && e.editor.name !== e.creator.name ? name(e.editor.name) : "";
    const note = e.note === undefined || e.note === null || e.note === "" ? "" : words(e.note, LIMITS.note);
    return { id: eventId(e.id), ver: whole(e.version, 1, 9999), creator, editor, at: whole(at, 1000000000, 9999999999), place: placeId(e.place), t: whole(r.tank, 0, 9), h: whole(r.healer, 0, 9), d: whole(r.damage, 0, 40),
      x: e.cancelled === true ? 1 : e.cancelled === false || e.cancelled === undefined ? 0 : bad(), title: words(e.title, LIMITS.title, 2), note };
  }, null);
}
function handoffSignup(eventKey, s) {
  return tryOr(() => ({ id: eventId(eventKey), name: name(s.who?.name), s: ANSWER_KEY[s.answer] || bad(), ver: whole(s.version, 1, 9999), via: VIA[s.via] || bad() }), null);
}
function handoffListing(l) {
  return tryOr(() => {
    const roles = Array.isArray(l.roles) ? [...new Set(l.roles)] : bad();
    if (roles.length > 3 || roles.some((r) => !ROLE_KEY[r])) bad();
    const need = l.need === null || l.need === undefined ? null : { t: whole(l.need.tank, 0, 9), h: whole(l.need.healer, 0, 9), d: whole(l.need.damage, 0, 40) };
    const at = Math.floor(Date.parse(l.at) / 1000);
    return { id: listingId(l.id), kind: l.kind === "lfg" ? "g" : l.kind === "lfm" ? "m" : bad(), name: name(l.who?.name), realm: realmName(l.who?.realm), level: whole(l.level, 1, 100),
      cls: l.class === null || l.class === undefined ? 0 : CLASSES.indexOf(l.class) + 1 || bad(), roles: ["tank", "healer", "damage"].filter((r) => roles.includes(r)).map((r) => ROLE_KEY[r]).join(""),
      place: placeId(l.place), note: l.note === undefined || l.note === null || l.note === "" ? "" : words(l.note, LIMITS.lfgNote), need, at: whole(at, 1000000000, 9999999999) };
  }, null);
}
/** What setHandoff was given -> the checked rows desktop-handoff.cjs writes. Bad rows are left out one by one. */
function normalizeHandoff(input) {
  const out = { guild: null, lfg: null, plan: null };
  const g = input?.guild;
  if (g && typeof g === "object" && typeof g.id === "string" && /^g_[A-Za-z0-9_-]{1,40}$/.test(g.id)) {
    const events = (Array.isArray(g.events) ? g.events : Object.values(g.events && typeof g.events === "object" ? g.events : {})).map(handoffEvent).filter(Boolean);
    const ids = new Set(), unique = events.filter((e) => !ids.has(e.id) && ids.add(e.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(0, LIMITS.events);
    const kept = new Set(unique.map((e) => e.id)), signups = [], perEvent = new Map(), seen = new Set();
    for (const [key, list] of Object.entries(g.signups && typeof g.signups === "object" && !Array.isArray(g.signups) ? g.signups : {})) {
      for (const s of Array.isArray(list) ? list : []) {
        const row = handoffSignup(key, s);
        if (!row || !kept.has(row.id) || seen.has(`${row.id}:${row.name.toLowerCase()}`) || (perEvent.get(row.id) || 0) >= LIMITS.signupsPerEvent || signups.length >= LIMITS.signups) continue;
        seen.add(`${row.id}:${row.name.toLowerCase()}`); perEvent.set(row.id, (perEvent.get(row.id) || 0) + 1); signups.push(row);
      }
    }
    signups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out.guild = { id: g.id, events: unique, signups, discord: ["none", "pending", "connected", "problem"].includes(g.discord) ? g.discord : "none" };
    // Optional, and wise: the addon then merges only into the guild it is in right now.
    const gn = tryOr(() => words(g.guildName, 24, 2), null), gr = tryOr(() => realmName(g.realm), null);
    if (gn) out.guild.guildName = gn;
    if (gr) out.guild.realm = gr;
  }
  // lfg: P1 rows, or { realm, faction, rows } so the game shows them only to characters of that realm and side.
  const l = input?.lfg, rows = Array.isArray(l) ? l : Array.isArray(l?.rows) ? l.rows : null;
  if (rows) {
    const ids = new Set(), list = rows.map(handoffListing).filter((r) => r && !ids.has(r.id) && ids.add(r.id)).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, LIMITS.lfg);
    out.lfg = { rows: list };
    const realm = !Array.isArray(l) ? tryOr(() => realmName(l.realm), null) : null, faction = !Array.isArray(l) && (l.faction === "horde" || l.faction === "alliance") ? l.faction : null;
    if (realm) out.lfg.realm = realm;
    if (faction) out.lfg.faction = faction;
  }
  // plan: { place, note?, at?, for?: { name, realm }, members: [{ name, role: "tank"|"healer"|"damage"|null, bring?: "…(≤60)" }] }
  const p = input?.plan;
  if (p && typeof p === "object") {
    out.plan = tryOr(() => {
      const seen = new Set(), members = (Array.isArray(p.members) ? p.members : bad()).slice(0, LIMITS.planMembers).map((m) => {
        const n = name(m?.name);
        if (seen.has(n.toLowerCase())) bad();
        seen.add(n.toLowerCase());
        return { name: n, role: m.role === null || m.role === undefined ? "-" : ROLE_KEY[m.role] || bad(), bring: m.bring === undefined || m.bring === null || m.bring === "" ? "" : words(m.bring, LIMITS.bring) };
      });
      if (!members.length) bad();
      const at = p.at === undefined ? 0 : whole(Math.floor(Date.parse(p.at) / 1000), 1000000000, 9999999999);
      const plan = { place: p.place === null || p.place === undefined ? "" : placeId(p.place), note: p.note === undefined || p.note === null || p.note === "" ? "" : words(p.note, LIMITS.note), at, members };
      if (p.for) plan.for = `${name(p.for.name)}-${realmName(p.for.realm)}`;
      return plan;
    }, null);
  }
  return out;
}

class GameGuildFeed extends EventEmitter {
  constructor({ now = Date.now } = {}) {
    super();
    this.now = now;
    this.seen = new Map();       // fact key -> its content, so the second way in stays silent
    this.handoffState = { guild: null, lfg: null, plan: null };
    this.handoffListeners = new Set();
    this.stats = { signals: 0, refused: 0, saved: 0 };
  }
  /** True the first time this content is seen for this key. */
  fresh(key, content) {
    if (this.seen.get(key) === content) return false;
    if (this.seen.size >= MAX_SEEN) this.seen.delete(this.seen.keys().next().value);
    this.seen.delete(key); this.seen.set(key, content);
    return true;
  }
  deliver(type, payload) {
    const c = payload.character, me = `${c.name}-${c.realm}`.toLowerCase();
    let key, content;
    if (type === "link") { key = `link:${me}`; content = `${payload.code}|${payload.guildName}|${payload.rankIndex}`; }
    else if (type === "unlink") { key = `link:${me}`; content = `-|${payload.guildName}`; }
    else if (type === "event") { key = `event:${me}:${payload.id}`; content = `${payload.version}|${payload.editor.name}|${payload.cancelled}|${payload.at}|${payload.title}|${payload.note}|${payload.place}|${JSON.stringify(payload.roles)}`; }
    else if (type === "signup") { key = `signup:${me}:${payload.eventId}:${payload.signup.who.name.toLowerCase()}`; content = `${payload.signup.answer}|${payload.signup.version}`; }
    else if (type === "party") { key = `party:${me}`; content = JSON.stringify([payload.leader, payload.members, payload.place, payload.plan]); }
    else if (type === "listing") {
      key = `listing:${me}`; content = JSON.stringify({ ...payload, character: undefined, at: undefined });
      // P1 carries the time of the listing: the moment the app learned of it.
      if (!payload.gone && !payload.at) payload = { ...payload, at: new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    else return false;
    if (!this.fresh(key, content)) return false;
    this.emit(type, payload);
    return true;
  }
  /** One live signal's text (without the prefix). Returns how many events it emitted; a bad signal emits none. */
  signal(text) {
    let parsed;
    try { parsed = parseSignal(text); } catch { this.stats.refused++; return 0; }
    this.stats.signals++;
    let n = 0;
    for (const payload of parsed.payloads || [parsed.payload]) if (this.deliver(parsed.type, payload)) n++;
    return n;
  }
  /** Listens to a LiveBridge (subscribeSignals). Returns the unsubscribe function. */
  attach(bridge) {
    if (!bridge || typeof bridge.subscribeSignals !== "function") return () => {};
    return bridge.subscribeSignals((s) => { this.signal(s.text); });
  }
  /**
   * The saved file was read. live: [{ name, realm, faction?, live: <normalizeLiveCapture> }];
   * guild: game-sync's guildCapture() rows ([{ name, realm, guild? }]). Emits what the live link has
   * not already told. Returns how many events it emitted.
   */
  ingestSaved(live = [], guild = []) {
    let n = 0;
    for (const row of Array.isArray(live) ? live : []) {
      const b = row?.live;
      if (!b?.me) continue;
      const character = b.me;
      try {
        if (b.link && b.faction) n += this.deliver("link", { code: b.link.code, character, rankIndex: b.link.rankIndex, guildName: b.link.guildName, realm: character.realm, faction: b.faction }) ? 1 : 0;
        for (const m of b.mine || []) n += this.deliver("signup", { eventId: m.id, signup: { who: character, answer: m.answer, version: m.version, via: "game" }, character }) ? 1 : 0;
        for (const k of ["party", "listing"]) if (b[k]) n += this.signal(b[k]);
      } catch { /* one damaged row never stops the rest */ }
    }
    for (const row of Array.isArray(guild) ? guild : []) {
      const g = row?.guild;
      if (!g || !g.on || !Array.isArray(g.events)) continue;
      const character = tryOr(() => ({ name: name(row.name), realm: realmName(row.realm) }), null);
      if (!character) continue;
      for (const e of g.events) {
        try {
          const creator = member(e.creator, character.realm), editor = e.editor ? member(e.editor, character.realm) : creator;
          n += this.deliver("event", { id: eventId(e.id), version: whole(e.ver, 1, 9999), creator, editor, at: iso(whole(e.at, 1000000000, 9999999999)), place: placeId(e.dungeon), title: words(e.title, LIMITS.title, 2), note: e.note ? words(e.note, LIMITS.note) : "",
            roles: { tank: whole(e.roles.t, 0, 9), healer: whole(e.roles.h, 0, 9), damage: whole(e.roles.d, 0, 40) }, cancelled: e.cancelled === true, character }) ? 1 : 0;
        } catch { /* skip this event */ }
      }
    }
    this.stats.saved += n;
    return n;
  }
  /** What the game should learn at its next login or /reload: { guild, lfg, plan } in the contract's shapes. A part left out is kept as it was; null clears it. */
  setHandoff(input = {}) {
    const next = normalizeHandoff(input), before = JSON.stringify(this.handoffState);
    for (const k of ["guild", "lfg", "plan"]) if (input && Object.prototype.hasOwnProperty.call(input, k)) this.handoffState[k] = next[k];
    const changed = JSON.stringify(this.handoffState) !== before;
    if (changed) for (const fn of this.handoffListeners) { try { fn(); } catch { /* a listener never stops a caller */ } }
    return changed;
  }
  /** The checked rows for desktop-handoff.cjs (compile({ live: feed.handoff() })). */
  handoff() { return this.handoffState; }
  /** Called when setHandoff changed something (main rewrites the hand-off file). */
  onHandoffChange(fn) { this.handoffListeners.add(fn); return () => this.handoffListeners.delete(fn); }
}

const feed = new GameGuildFeed();
module.exports = feed;
Object.assign(module.exports, { GameGuildFeed, SIGNAL_PREFIX, MAX_SIGNAL_BYTES, LIMITS, CLASSES, parseSignal, normalizeLiveCapture, normalizeHandoff, create: (options) => new GameGuildFeed(options) });

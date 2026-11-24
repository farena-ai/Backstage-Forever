"use strict";
// Guild events, the guild page and lockouts on the desktop (roadmap "Social and guild" and the
// lockout calendar). Everything here comes from two optional blocks a character's capture may
// carry in the game's saved file:
//   guild     { v:1, at, on, loot, me?, guild?, realmOffset?, events:[...], past:[...], members:[...] }
//             events the character's addon holds (shared between guild members who run the addon
//             and switched guild events on), finished events it kept, and what sharing guild
//             members last told it
//   lockouts  { v:1, at, na?, rows:[{ n, r, raid?, d?, p?, t? }] }   the game's saved instances
// This module checks both, keeps a longer memory in one local file, and lays the data out for the
// Plans → Guild page and the Calendar. Nothing here uses the network; nothing leaves this computer.
const fs = require("node:fs");
const MAX_T = 9999999999, MIN_T = 1000000000, ID = 2147483647;
const LIMITS = Object.freeze({ title: 40, note: 80, events: 20, past: 30, signups: 40, present: 40, loot: 60, members: 100, profs: 4, crafts: 12,
  lockouts: 40, characters: 100, stored: 200, noteText: 300, notes: 500 });
const STATUS = ["t", "h", "d", "m", "n"];
const ROLE_WORD = { t: "tank", h: "healer", d: "damage", m: "maybe", n: "no" };
const AFTER = 4 * 3600, BEFORE = 1800;
const bad = () => { throw Error("Invalid guild capture."); };
const whole = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : bad());
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : bad());
// Lua writes an empty list as {} when it was never marked as a list.
const list = (v, max) => { const a = Array.isArray(v) ? v : v && typeof v === "object" && !Object.keys(v).length ? [] : bad(); if (a.length > max) bad(); return a; };
const only = (o, keys) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(); };
const byteLength = (s) => Buffer.byteLength(s, "utf8");
/** One line of plain text: no control characters and no game colour or link codes. */
function text(v, max) {
  if (typeof v !== "string" || !v.length || byteLength(v) > max || /[\x00-\x1f\x7f|]/.test(v) || v !== v.trim() || / {2}/.test(v)) bad();
  return v;
}
/** Text a player typed for others to read (an event's title and note): also no web address. */
const words = (v, max) => (linky(text(v, max)) ? bad() : v);
function linky(v) {
  const t = String(v).toLowerCase();
  return t.includes("://") || t.includes("www.") || t.includes(".gg/") || /\w\.(com|net|org|gg|io|ru|tv)(?![a-z])/.test(t);
}
/** A character name as the guild channel gives it: letters and an optional -Realm. */
function memberName(v) {
  if (typeof v !== "string" || byteLength(v) < 2 || byteLength(v) > 48 || /[\d\s\x00-\x1f\x7f|:,]/.test(v)) bad();
  if (/[!-\/:-@\[-`{-~]/.test(v) && !/^[^!-\/:-@\[-`{-~]+-[^!-\/:-@\[-`{-~]+$/.test(v)) bad();
  return v;
}
const eventId = (v) => (typeof v === "string" && /^[a-z0-9]{6,10}$/.test(v) ? v : bad());
const place = (v) => (typeof v === "string" && /^[a-z][a-z0-9]{0,7}$/.test(v) ? v : bad());
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function eventRow(raw, past) {
  plain(raw);
  only(raw, ["id", "ver", "title", "dungeon", "at", "creator", "editor", "t", "h", "d", "note", "cancelled", "relayed", "signups", "present", "loot"]);
  const out = { id: eventId(raw.id), title: words(raw.title, LIMITS.title), dungeon: place(raw.dungeon), at: whole(raw.at, MIN_T, MAX_T), creator: memberName(raw.creator),
    roles: { t: whole(raw.t, 0, 9), h: whole(raw.h, 0, 9), d: whole(raw.d, 0, 40) } };
  if (byteLength(out.title) < 2) bad();
  if (!past) out.ver = whole(raw.ver, 1, 9999);
  else if (raw.ver !== undefined) bad();
  if (raw.editor !== undefined) { if (past) bad(); out.editor = memberName(raw.editor); }
  if (raw.note !== undefined) out.note = words(raw.note, LIMITS.note);
  for (const k of ["cancelled", "relayed"]) if (raw[k] !== undefined) { if (raw[k] !== true || past) bad(); out[k] = true; }
  const seen = new Set();
  out.signups = list(raw.signups, LIMITS.signups).map((s) => {
    plain(s); only(s, past ? ["n", "s"] : ["n", "s", "v"]);
    const name = memberName(s.n);
    if (seen.has(name.toLowerCase()) || !STATUS.includes(s.s)) bad();
    seen.add(name.toLowerCase());
    if (!past) whole(s.v, 1, 9999);
    return { name, status: s.s };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const here = new Set();
  out.present = list(raw.present, LIMITS.present).map((n) => { const name = memberName(n); if (here.has(name.toLowerCase())) bad(); here.add(name.toLowerCase()); return name; }).sort((a, b) => a.localeCompare(b));
  out.loot = list(raw.loot, LIMITS.loot).map((l) => { plain(l); only(l, ["i", "w", "at"]); return { itemId: whole(l.i, 1, ID), who: memberName(l.w), at: whole(l.at, MIN_T, MAX_T) }; })
    .sort((a, b) => a.at - b.at || a.itemId - b.itemId || a.who.localeCompare(b.who));
  return out;
}
function memberRow(raw) {
  plain(raw); only(raw, ["n", "at", "l", "z", "c", "lfd", "p", "crafts"]);
  const out = { name: memberName(raw.n), seenAt: whole(raw.at, MIN_T, MAX_T) };
  if (raw.l !== undefined) out.level = whole(raw.l, 1, 100);
  if (raw.z !== undefined) out.zone = text(raw.z, 40);
  if (raw.c !== undefined) { if (typeof raw.c !== "string" || !/^[A-Z]{1,20}$/.test(raw.c)) bad(); out.classFile = raw.c; }
  if (raw.lfd !== undefined) out.lookingFor = place(raw.lfd);
  const names = new Set();
  out.professions = list(raw.p, LIMITS.profs).map((p) => { plain(p); only(p, ["n", "r"]); const name = text(p.n, 24); if (names.has(name)) bad(); names.add(name); return { name, skill: whole(p.r, 0, 999) }; });
  out.crafts = [...new Set(list(raw.crafts, LIMITS.crafts).map((c) => text(c, 48)))];
  return out;
}
/** The guild block as the addon wrote it -> the checked shape, or a throw. */
function normalizeGuildCapture(block) {
  plain(block);
  if (block.v !== 1) bad();
  only(block, ["v", "at", "on", "loot", "me", "guild", "realmOffset", "events", "past", "members"]);
  if (typeof block.on !== "boolean" || typeof block.loot !== "boolean") bad();
  const out = { at: whole(block.at, MIN_T, MAX_T), on: block.on, loot: block.loot };
  if (block.me !== undefined) out.me = memberName(block.me);
  if (block.guild !== undefined) out.guild = text(block.guild, 40);
  if (block.realmOffset !== undefined) { out.realmOffset = whole(block.realmOffset, -720, 840); if (out.realmOffset % 15) bad(); }
  const ids = new Set();
  const unique = (e) => { if (ids.has(e.id)) bad(); ids.add(e.id); return e; };
  out.events = list(block.events, LIMITS.events).map((e) => unique(eventRow(e, false))).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  out.past = list(block.past, LIMITS.past).map((e) => unique(eventRow(e, true))).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const names = new Set();
  out.members = list(block.members, LIMITS.members).map((m) => { const row = memberRow(m); if (names.has(row.name.toLowerCase())) bad(); names.add(row.name.toLowerCase()); return row; })
    .sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
/** The lockout block -> { at, available, rows:[{ name, resetAt, raid, difficulty?, progress?, total? }] }, or a throw. */
function normalizeLockoutCapture(block) {
  plain(block);
  if (block.v !== 1) bad();
  only(block, ["v", "at", "na", "rows"]);
  if (block.na !== undefined && block.na !== true) bad();
  const out = { at: whole(block.at, MIN_T, MAX_T), available: block.na !== true };
  out.rows = list(block.rows, LIMITS.lockouts).map((r) => {
    plain(r); only(r, ["n", "r", "raid", "d", "p", "t"]);
    if (r.raid !== undefined && r.raid !== true) bad();
    const row = { name: text(r.n, 60), resetAt: whole(r.r, MIN_T, MAX_T), raid: r.raid === true };
    if (r.d !== undefined) row.difficulty = text(r.d, 30);
    if (r.t !== undefined || r.p !== undefined) { row.total = whole(r.t, 1, 40); row.progress = whole(r.p, 0, row.total); }
    return row;
  }).sort((a, b) => a.resetAt - b.resetAt || a.name.localeCompare(b.name));
  if (!out.available && out.rows.length) bad();
  return out;
}

// ---- The desktop's own memory -------------------------------------------------------------
const emptyData = () => ({ version: 1, characters: {}, notes: {} });
const safeKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 100 && k !== "__proto__" && k !== "constructor" && k !== "prototype";
const noteKey = (realm, name) => `${String(realm || "").toLowerCase()}|${String(name).toLowerCase()}`;
/** A note the player keeps about a member: plain text, at most 300 characters. "" removes it. */
function cleanNote(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/ {2,}/g, " ").trim();
  return [...t].slice(0, LIMITS.noteText).join("");
}
const tryOr = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
// Stored events and members are kept in the checked wire shape, so reading the file back checks them again.
const toWireEvent = (e, past) => ({ id: e.id, ...(past ? {} : { ver: e.ver }), title: e.title, dungeon: e.dungeon, at: e.at, creator: e.creator, ...(e.editor ? { editor: e.editor } : {}),
  t: e.roles.t, h: e.roles.h, d: e.roles.d, ...(e.note ? { note: e.note } : {}), ...(e.cancelled ? { cancelled: true } : {}), ...(e.relayed ? { relayed: true } : {}),
  signups: e.signups.map((s) => ({ n: s.name, s: s.status, ...(past ? {} : { v: 1 }) })), present: e.present, loot: e.loot.map((l) => ({ i: l.itemId, w: l.who, at: l.at })) });
/**
 * Any earlier or damaged file -> the current shape. A bad entry is dropped on its own and never
 * costs the rest.
 */
function migrate(raw) {
  const out = emptyData();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (raw.characters && typeof raw.characters === "object" && !Array.isArray(raw.characters)) {
    for (const [id, c] of Object.entries(raw.characters).slice(0, LIMITS.characters)) {
      if (!safeKey(id) || !c || typeof c !== "object") continue;
      const row = { name: typeof c.name === "string" ? c.name.slice(0, 100) : "", realm: typeof c.realm === "string" ? c.realm.slice(0, 100) : "" };
      if (c.guild && typeof c.guild === "object") {
        const g = c.guild;
        const events = (Array.isArray(g.events) ? g.events : []).map((e) => tryOr(() => eventRow(e, false), null)).filter(Boolean);
        const past = (Array.isArray(g.past) ? g.past : []).map((e) => tryOr(() => eventRow(e, true), null)).filter(Boolean).slice(-LIMITS.stored);
        const members = (Array.isArray(g.members) ? g.members : []).map((m) => tryOr(() => memberRow(m), null)).filter(Boolean).slice(0, LIMITS.members);
        row.guild = { at: Number.isSafeInteger(g.at) ? g.at : 0, on: g.on === true, loot: g.loot === true,
          ...(tryOr(() => memberName(g.me), null) ? { me: g.me } : {}), ...(tryOr(() => text(g.guild, 40), null) ? { guild: g.guild } : {}),
          ...(Number.isSafeInteger(g.realmOffset) && g.realmOffset >= -720 && g.realmOffset <= 840 ? { realmOffset: g.realmOffset } : {}),
          events: events.map((e) => toWireEvent(e, false)), past: past.map((e) => toWireEvent(e, true)),
          members: members.map((m) => ({ n: m.name, at: m.seenAt, ...(m.level ? { l: m.level } : {}), ...(m.zone ? { z: m.zone } : {}), ...(m.classFile ? { c: m.classFile } : {}), ...(m.lookingFor ? { lfd: m.lookingFor } : {}),
            p: m.professions.map((p) => ({ n: p.name, r: p.skill })), crafts: m.crafts })) };
      }
      if (c.lockouts && typeof c.lockouts === "object") {
        const l = tryOr(() => normalizeLockoutCapture(c.lockouts), null);
        if (l) row.lockouts = c.lockouts;
      }
      if (row.guild || row.lockouts) out.characters[id] = row;
    }
  }
  if (raw.notes && typeof raw.notes === "object" && !Array.isArray(raw.notes)) {
    for (const [key, value] of Object.entries(raw.notes).slice(0, LIMITS.notes)) {
      const note = cleanNote(value);
      if (safeKey(key) && key.includes("|") && note) out.notes[key] = note;
    }
  }
  return out;
}
/**
 * Takes what the last read of the game's saved file held. entries: [{ id, name, realm, guild?, lockouts? }]
 * with checked blocks. Events and members follow the addon (it is the authority on what is current);
 * finished events the addon has already let go of are kept here, up to 200 per character.
 */
function absorb(data, entries) {
  const out = migrate(data);
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !safeKey(e.id)) continue;
    const old = out.characters[e.id] || {};
    const row = { name: typeof e.name === "string" ? e.name : old.name || "", realm: typeof e.realm === "string" ? e.realm : old.realm || "" };
    if (e.guild && (!old.guild || e.guild.at >= old.guild.at)) {
      const g = e.guild, known = new Set([...g.events, ...g.past].map((x) => x.id));
      const kept = (old.guild?.past || []).map((x) => tryOr(() => eventRow(x, true), null)).filter((x) => x && !known.has(x.id));
      // An event that was on the list last time and is gone now without becoming history was called off or dropped.
      const past = [...kept, ...g.past].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-LIMITS.stored);
      row.guild = { at: g.at, on: g.on, loot: g.loot, ...(g.me ? { me: g.me } : {}), ...(g.guild ? { guild: g.guild } : {}), ...(g.realmOffset !== undefined ? { realmOffset: g.realmOffset } : {}),
        events: g.events.map((x) => toWireEvent(x, false)), past: past.map((x) => toWireEvent(x, true)),
        members: g.members.map((m) => ({ n: m.name, at: m.seenAt, ...(m.level ? { l: m.level } : {}), ...(m.zone ? { z: m.zone } : {}), ...(m.classFile ? { c: m.classFile } : {}), ...(m.lookingFor ? { lfd: m.lookingFor } : {}),
          p: m.professions.map((p) => ({ n: p.name, r: p.skill })), crafts: m.crafts })) };
    } else if (old.guild) row.guild = old.guild;
    if (e.lockouts && (!old.lockouts || e.lockouts.at >= old.lockouts.at)) {
      row.lockouts = { v: 1, at: e.lockouts.at, ...(e.lockouts.available ? {} : { na: true }),
        rows: e.lockouts.rows.map((r) => ({ n: r.name, r: r.resetAt, ...(r.raid ? { raid: true } : {}), ...(r.difficulty ? { d: r.difficulty } : {}), ...(r.total ? { p: r.progress, t: r.total } : {}) })) };
    } else if (old.lockouts) row.lockouts = old.lockouts;
    if (row.guild || row.lockouts) out.characters[e.id] = row;
  }
  const ids = Object.keys(out.characters);
  for (const id of ids.slice(0, Math.max(0, ids.length - LIMITS.characters))) delete out.characters[id];
  return out;
}
class GuildStore {
  constructor({ file, write = (f, t) => require("./store.cjs").atomic(f, t) } = {}) {
    Object.assign(this, { file, write, data: emptyData(), saved: "" });
    try { this.data = migrate(JSON.parse(fs.readFileSync(file, "utf8"))); this.saved = JSON.stringify(this.data); } catch { /* No file yet, or unreadable: start empty. */ }
  }
  #save() {
    const t = JSON.stringify(this.data);
    if (t === this.saved || !this.file) return false;
    try { this.write(this.file, t); this.saved = t; return true; } catch { return false; }
  }
  /** Called with what the game's saved file held; writes only when something changed. */
  absorb(entries) { this.data = absorb(this.data, entries); return this.#save(); }
  /** A note about one member, kept on this computer only. An empty note removes it. */
  setNote(realm, name, value) {
    const note = cleanNote(value);
    const key = noteKey(realm, tryOr(() => memberName(name), null) || bad());
    if (note === null || !safeKey(key)) bad();
    if (note) { if (!(key in this.data.notes) && Object.keys(this.data.notes).length >= LIMITS.notes) bad(); this.data.notes[key] = note; }
    else delete this.data.notes[key];
    this.#save();
    return note;
  }
  clear() { this.data = emptyData(); this.#save(); }
}

// ---- Views ----------------------------------------------------------------------------------
/** The stored blocks of one character, checked again: { guild, lockouts } (either may be null). */
function character(data, id) {
  const c = data?.characters?.[id];
  if (!c) return null;
  return { name: c.name, realm: c.realm, guild: c.guild ? tryOr(() => normalizeGuildCapture({ v: 1, ...c.guild, past: c.guild.past.slice(-LIMITS.past) }), null) : null,
    allPast: c.guild ? c.guild.past.map((e) => tryOr(() => eventRow(e, true), null)).filter(Boolean) : [],
    lockouts: c.lockouts ? tryOr(() => normalizeLockoutCapture(c.lockouts), null) : null };
}
const counts = (e) => { const c = { t: 0, h: 0, d: 0, m: 0, n: 0 }; for (const s of e.signups) c[s.status]++; return c; };
/**
 * The run that belongs to an event: the same instance, overlapping the time from half an hour
 * before the event to four hours after it began; the one that started nearest to it.
 * runs: the desktop's run history rows ({ instanceMap, startedAt, endedAt, ... });
 * instancesOf(dungeonId) -> the game's instance ids of that place (an "other" event has none).
 */
function matchRun(event, runs, instancesOf) {
  const maps = new Set(instancesOf(event.dungeon) || []);
  if (!maps.size) return null;
  let best = null;
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || !maps.has(r.instanceMap) || !Number.isSafeInteger(r.startedAt) || !Number.isSafeInteger(r.endedAt)) continue;
    if (r.startedAt > event.at + AFTER || r.endedAt < event.at - BEFORE) continue;
    if (!best || Math.abs(r.startedAt - event.at) < Math.abs(best.startedAt - event.at) || (Math.abs(r.startedAt - event.at) === Math.abs(best.startedAt - event.at) && r.startedAt < best.startedAt)) best = r;
  }
  return best;
}
/** Each event gets at most one run and each run at most one event: the nearest pair wins. */
function matchRuns(events, runs, instancesOf) {
  const pairs = [];
  for (const e of events) for (const r of Array.isArray(runs) ? runs : []) if (matchRun(e, [r], instancesOf)) pairs.push({ e, r, gap: Math.abs(r.startedAt - e.at) });
  pairs.sort((a, b) => a.gap - b.gap || a.e.at - b.e.at || a.r.startedAt - b.r.startedAt);
  const out = new Map(), used = new Set();
  for (const p of pairs) { if (out.has(p.e.id) || used.has(p.r)) continue; out.set(p.e.id, p.r); used.add(p.r); }
  return out;
}
/** Who signed up and who was there. Whether somebody came is only known for events this character was at. */
function attendance(event) {
  const rows = new Map();
  for (const s of event.signups) rows.set(s.name.toLowerCase(), { name: s.name, answer: s.status, present: false });
  for (const n of event.present) { const k = n.toLowerCase(); if (rows.has(k)) rows.get(k).present = true; else rows.set(k, { name: n, answer: null, present: true }); }
  const known = event.present.length > 0;
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const yes = list.filter((r) => ["t", "h", "d"].includes(r.answer));
  return { known, rows: list.map((r) => ({ ...r, present: known ? r.present : null })), signedYes: yes.length,
    came: known ? list.filter((r) => r.present).length : null, missed: known ? yes.filter((r) => !r.present).map((r) => r.name) : null,
    unannounced: known ? list.filter((r) => r.present && !["t", "h", "d"].includes(r.answer)).map((r) => r.name) : null };
}
function eventView(e, me, placeName) {
  const c = counts(e), mine = me ? e.signups.find((s) => same(s.name, me))?.status || null : null;
  return { id: e.id, title: e.title, dungeon: e.dungeon, place: placeName(e.dungeon), at: e.at, creator: e.creator, editor: e.editor || null, roles: e.roles, note: e.note || null,
    relayed: e.relayed === true, counts: c, mine, mineWord: mine ? ROLE_WORD[mine] : null,
    signups: Object.fromEntries(STATUS.map((s) => [s, e.signups.filter((x) => x.status === s).map((x) => x.name)])) };
}
/**
 * The Plans → Guild page for one character.
 * profiles: saved characters (for "your own characters can make" and names); runs: that character's
 * run history; atlas: { name(dungeonId), instances(dungeonId), bosses(instanceMap) }; facts: item names.
 */
function guildView(data, { profileId = null, profiles = [], now, runs = [], atlas = {}, facts = new Map() } = {}) {
  const placeName = (id) => (id === "other" ? "Other" : tryOr(() => atlas.name?.(id), null) || id);
  const instancesOf = (id) => tryOr(() => atlas.instances?.(id), null) || [];
  const known = Object.entries(data?.characters || {}).filter(([, c]) => c.guild).map(([id, c]) => ({ profileId: id, name: c.name, realm: c.realm, guild: c.guild.guild || null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));
  const chosen = known.find((c) => c.profileId === profileId) || known[0] || null;
  const c = chosen ? character(data, chosen.profileId) : null;
  if (!c?.guild) return { profileId: null, characters: known, now, empty: true };
  const g = c.guild, me = g.me || c.name;
  const upcoming = g.events.filter((e) => !e.cancelled && e.at + AFTER >= now).map((e) => eventView(e, me, placeName));
  // Events still on the addon's list that already began count as history too once four hours passed.
  const finished = [...c.allPast, ...g.events.filter((e) => !e.cancelled && e.at + AFTER < now)].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const matched = matchRuns(finished, runs, instancesOf);
  const tally = new Map();
  const past = finished.map((e) => {
    const a = attendance(e), run = matched.get(e.id) || null, view = eventView(e, me, placeName);
    for (const r of a.rows) {
      const t = tally.get(r.name.toLowerCase()) || { signedYes: 0, came: 0, counted: 0 };
      if (a.known) { t.counted++; if (["t", "h", "d"].includes(r.answer)) t.signedYes++; if (r.present) t.came++; }
      tally.set(r.name.toLowerCase(), t);
    }
    return { ...view, attendance: a, canMatch: instancesOf(e.dungeon).length > 0,
      run: run ? { startedAt: run.startedAt, endedAt: run.endedAt, seconds: run.timed ? run.endedAt - run.startedAt : null, deaths: run.deaths ?? null,
        bosses: (run.bosses || []).map((b) => ({ name: b.name, at: b.at })), knownBosses: tryOr(() => atlas.bosses?.(run.instanceMap), null) ?? null,
        loot: run.loot ? run.loot.map((l) => ({ itemId: l.id, count: l.n, name: facts.get(l.id)?.name || `Item #${l.id}`, quality: facts.get(l.id)?.quality ?? null })) : null } : null,
      guildLoot: e.loot.map((l) => ({ itemId: l.itemId, who: l.who, at: l.at, name: facts.get(l.itemId)?.name || `Item #${l.itemId}`, quality: facts.get(l.itemId)?.quality ?? null })) };
  });
  const notes = data.notes || {};
  const roster = g.members.map((m) => {
    const t = tally.get(m.name.toLowerCase());
    return { name: m.name, classFile: m.classFile || null, level: m.level ?? null, zone: m.zone || null, professions: m.professions, seenAt: m.seenAt,
      lookingFor: m.lookingFor ? placeName(m.lookingFor) : null, note: notes[noteKey(c.realm, m.name)] || "",
      attendance: t && t.counted ? { came: t.came, events: t.counted, signedYes: t.signedYes } : null };
  });
  // Who can make what: professions members shared, recipes they answered /bf guild craft with,
  // and the recipes of your own saved characters.
  const crafts = [];
  for (const m of g.members) {
    for (const p of m.professions) crafts.push({ who: m.name, yours: false, kind: "profession", name: p.name, skill: p.skill });
    for (const r of m.crafts) crafts.push({ who: m.name, yours: false, kind: "recipe", name: r, skill: null });
  }
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if ((p?.realm || "") !== (c.realm || "")) continue;
    const seen = new Set();
    for (const r of p?.readiness?.workshop?.recipes?.items || []) {
      if (typeof r?.name !== "string" || !r.name || seen.has(r.name) || seen.size >= 150) continue;
      seen.add(r.name);
      crafts.push({ who: p.name, yours: true, kind: "recipe", name: r.name, skill: null });
    }
  }
  return { profileId: chosen.profileId, characters: known, now, empty: false, character: c.name, realm: c.realm, guild: g.guild || null, me, savedAt: g.at, on: g.on, lootNotes: g.loot,
    realmOffset: g.realmOffset ?? null, roster, crafts, upcoming, past, totals: { members: roster.length, upcoming: upcoming.length, past: past.length } };
}
/**
 * Guild events and lockouts as calendar entries, in the shape the Calendar already shows.
 * One guild event seen by several of your characters is listed once, for the character that answered it.
 */
function calendarEntries(data, profiles, now, { placeName = (id) => id } = {}) {
  const out = [], seenEvents = new Map();
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  for (const id of Object.keys(data?.characters || {})) {
    const c = character(data, id);
    if (!c) continue;
    const p = byId.get(id);
    const who = { profileId: id, character: p?.name || c.name || "Character", realm: p?.realm || c.realm || "", faction: p?.faction || null };
    for (const e of c.guild ? [...c.guild.events.filter((x) => !x.cancelled), ...c.allPast] : []) {
      const k = counts(e), mine = e.signups.find((s) => same(s.name, c.guild.me || c.name))?.status || null;
      const where = e.dungeon === "other" ? "Other" : tryOr(() => placeName(e.dungeon), null) || e.dungeon;
      const entry = { key: `guild:${e.id}:${e.at}`, kind: "event", at: e.at, title: e.title, minutes: 120,
        detail: `${where} · tanks ${k.t}/${e.roles.t}, healers ${k.h}/${e.roles.h}, damage ${k.d}/${e.roles.d}${mine ? ` · you: ${ROLE_WORD[mine]}` : ""}`, mine, ...who, past: e.at <= now };
      const old = seenEvents.get(e.id);
      if (!old || (!old.mine && mine)) seenEvents.set(e.id, entry);
    }
    for (const r of c.lockouts?.rows || []) {
      if (r.resetAt <= now) continue;
      out.push({ key: `${id}:lock:${r.name}:${r.resetAt}`, kind: "lockout", at: r.resetAt, title: `${r.name} resets`,
        detail: `${r.raid ? "Raid" : "Dungeon"} lockout${r.difficulty ? ` (${r.difficulty})` : ""}${r.total ? ` · ${r.progress} of ${r.total} bosses down` : ""}`, savedAt: c.lockouts.at, ...who, past: false });
    }
  }
  out.push(...seenEvents.values());
  return out.sort((a, b) => a.at - b.at || a.character.localeCompare(b.character) || a.key.localeCompare(b.key));
}
/** Per character: is the lockout list known, and what is still locked. For the Calendar's lockout card. */
function lockoutView(data, profiles, now) {
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  const rows = [];
  for (const id of Object.keys(data?.characters || {})) {
    const c = character(data, id);
    if (!c?.lockouts) continue;
    rows.push({ profileId: id, character: byId.get(id)?.name || c.name || "Character", savedAt: c.lockouts.at, available: c.lockouts.available,
      rows: c.lockouts.rows.filter((r) => r.resetAt > now) });
  }
  return rows.sort((a, b) => a.character.localeCompare(b.character));
}
module.exports = { LIMITS, STATUS, ROLE_WORD, AFTER, BEFORE, normalizeGuildCapture, normalizeLockoutCapture, migrate, absorb, GuildStore, cleanNote, noteKey,
  matchRun, matchRuns, attendance, guildView, calendarEntries, lockoutView, linky };

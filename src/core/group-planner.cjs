"use strict";
// The group planner and "Regulars" (people you have run with). Both are local: this file never
// uses the network. The plan a player lays out (who tanks, who heals, who deals damage, a note per
// slot) is kept per character in one file in the app's data folder and handed to the game for its
// next /reload; regulars are counted from the groups the game reported and from guild events the
// character attended, with the player's own notes.
const fs = require("node:fs");
const { who, sameWho, line, ROLES, CLASSES } = require("./guild-service.cjs");

// Tank / healer / damage slots for the usual group sizes.
const SIZES = Object.freeze({ 5: { tank: 1, healer: 1, damage: 3 }, 10: { tank: 2, healer: 2, damage: 6 }, 20: { tank: 2, healer: 5, damage: 13 }, 40: { tank: 4, healer: 10, damage: 26 } });
const LIMITS = Object.freeze({ note: 60, planNote: 120, regulars: 2000, places: 12, personalNote: 300, plans: 100, seen: 4000 });
const RUN_WINDOW = 4 * 3600 * 1000;
const PLACE_RE = /^[a-z][a-z0-9]{0,7}$/;
const lower = (v) => String(v ?? "").toLowerCase();
const key = (c) => `${lower(c.realm)}|${lower(c.name)}`;
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

// ---------------------------------------------------------------- the plan (pure)
function emptyPlan(place = "other", size = 5) {
  const counts = SIZES[size] || SIZES[5];
  return { place: PLACE_RE.test(place) ? place : "other", size: SIZES[size] ? size : 5, note: "", at: null,
    slots: ROLES.flatMap((role) => Array.from({ length: counts[role] }, () => ({ role, name: null, realm: null, note: "" }))) };
}
/** Any stored or received plan -> the checked shape (never throws; what cannot be used is left empty). */
function planShape(raw) {
  const size = SIZES[raw?.size] ? raw.size : 5;
  const out = emptyPlan(typeof raw?.place === "string" ? raw.place : "other", size);
  const taken = new Set(), free = { tank: [], healer: [], damage: [] };
  out.slots.forEach((s, i) => free[s.role].push(i));
  for (const s of Array.isArray(raw?.slots) ? raw.slots : []) {
    if (!s || !ROLES.includes(s.role) || !free[s.role].length) continue;
    const i = free[s.role].shift(), w = who(s);
    if (w && !taken.has(key(w))) { taken.add(key(w)); out.slots[i].name = w.name; out.slots[i].realm = w.realm; }
    out.slots[i].note = line(s.note ?? "", LIMITS.note) || "";
  }
  out.note = line(raw?.note ?? "", LIMITS.planNote) || "";
  out.at = typeof raw?.at === "string" && Number.isFinite(Date.parse(raw.at)) ? new Date(Date.parse(raw.at)).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
  return out;
}
/** Put a member into a slot (or clear it with null). A member holds one slot: moving takes them out of the old one. */
function assign(plan, index, member) {
  const p = planShape(plan), w = member ? who(member) : null;
  if (!int(index, 0, p.slots.length - 1)) return p;
  if (w) {
    const from = p.slots.findIndex((s) => s.name && sameWho(s, w));
    const there = p.slots[index].name ? { name: p.slots[index].name, realm: p.slots[index].realm } : null;
    // Dropping on a taken slot swaps the two.
    if (from >= 0 && from !== index) { p.slots[from].name = there?.name || null; p.slots[from].realm = there?.realm || null; }
    p.slots[index].name = w.name; p.slots[index].realm = w.realm;
  } else { p.slots[index].name = null; p.slots[index].realm = null; }
  return p;
}
function setSlotNote(plan, index, note) {
  const p = planShape(plan);
  if (int(index, 0, p.slots.length - 1)) p.slots[index].note = line(note ?? "", LIMITS.note) || "";
  return p;
}
/** A new place or size keeps everybody who still fits, role by role. */
function reshape(plan, { place, size } = {}) {
  const old = planShape(plan);
  return planShape({ ...old, place: place ?? old.place, size: size ?? old.size, slots: old.slots });
}
/** Fill the empty slots from the people at hand: first those who named that role, then nobody (no guessing). */
function autoFill(plan, candidates) {
  let p = planShape(plan);
  const placed = new Set(p.slots.filter((s) => s.name).map(key));
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const w = who(c);
    if (!w || placed.has(key(w)) || !ROLES.includes(c.role)) continue;
    const i = p.slots.findIndex((s) => s.role === c.role && !s.name);
    if (i < 0) continue;
    p = assign(p, i, w); placed.add(key(w));
  }
  return p;
}
/**
 * What the planner shows: each slot with what is known about the member in it, and what the group
 * still lacks. candidates: [{ name, realm, class?, role?, level?, online?, missing?:[], source }].
 * place: { id, name, min, max, kind } from the dungeon list or null. own: Map of whoKey -> { attune:
 * [{ name, status }] } for the player's own characters only; nothing is guessed about anyone else.
 */
function planView(plan, { candidates = [], place = null, own = new Map() } = {}) {
  const p = planShape(plan);
  const people = new Map();
  for (const c of candidates) { const w = who(c); if (w && !people.has(key(w))) people.set(key(w), { ...c, ...w }); }
  const slots = p.slots.map((s, index) => {
    if (!s.name) return { index, role: s.role, note: s.note, empty: true, warnings: [] };
    const c = people.get(key(s)) || null, mine = own.get(key(s)) || null, warnings = [];
    if (!c) warnings.push({ kind: "gone", text: "Not in your group right now" });
    else {
      if (c.online === false) warnings.push({ kind: "offline", text: "Offline" });
      else if (c.ready === false && c.source === "party") warnings.push({ kind: "ready", text: "Not marked ready in game" });
      if (place && int(c.level, 1, 100) && int(place.min, 1, 100) && c.level < place.min) warnings.push({ kind: "level", text: `Level ${c.level}: under level ${place.min}` });
      if (c.role && c.role !== s.role) warnings.push({ kind: "role", text: `Signed up as ${c.role}` });
      for (const m of Array.isArray(c.missing) ? c.missing : []) warnings.push({ kind: "missing", text: m, verbatim: true });
    }
    for (const a of mine?.attune || []) if (a.status !== "done") warnings.push({ kind: "key", text: a.status === "unknown" ? "Key or attunement not known yet" : "Key or attunement not finished", detail: a.name });
    return { index, role: s.role, note: s.note, empty: false, name: s.name, realm: s.realm, class: c && CLASSES.includes(c.class) ? c.class : null, level: c?.level ?? null, yours: Boolean(mine), known: Boolean(c), warnings };
  });
  const placed = new Set(p.slots.filter((s) => s.name).map(key));
  const missing = ROLES.map((role) => ({ role, open: slots.filter((s) => s.role === role && s.empty).length })).filter((m) => m.open > 0);
  return { place: p.place, placeName: place?.name || null, size: p.size, note: p.note, at: p.at, slots, missing,
    bench: [...people.values()].filter((c) => !placed.has(key(c))).map((c) => ({ name: c.name, realm: c.realm, class: CLASSES.includes(c.class) ? c.class : null, role: ROLES.includes(c.role) ? c.role : null, level: int(c.level, 1, 100) ? c.level : null, online: c.online !== false, ready: typeof c.ready === "boolean" ? c.ready : null, source: c.source || "party" })),
    filled: slots.filter((s) => !s.empty).length, ready: slots.every((s) => !s.empty && !s.warnings.length) };
}
/**
 * The plan as the game reads it at its next /reload (the addon's shape): { place, note?, at?, for?, members:
 * [{ name, role, bring? }] }. Only filled slots; the slot's note is the "bring" line. In game it shows with /bf plan.
 */
function handoffPlan(plan, forWho = null) {
  const p = planShape(plan), seen = new Set(), members = [];
  for (const s of p.slots) {
    if (!s.name || seen.has(lower(s.name))) continue;   // the game knows party members by name alone
    seen.add(lower(s.name));
    members.push({ name: s.name, role: s.role, ...(s.note ? { bring: s.note } : {}) });
  }
  if (!members.length) return null;
  const w = who(forWho);
  return { place: p.place, ...(p.note ? { note: Array.from(p.note).slice(0, 80).join("") } : {}), ...(p.at ? { at: p.at } : {}), ...(w ? { for: w } : {}), members };
}
/** A plan as the game reports it for the group ({ place, at, members: [{ name, realm, role }] }) -> the planner's own shape. */
function fromGamePlan(g, size = 5) {
  const members = Array.isArray(g?.members) ? g.members.filter((m) => m && ROLES.includes(m.role)) : [];
  const fit = [5, 10, 20, 40].find((n) => n >= Math.max(size, members.length) && ROLES.every((r) => members.filter((m) => m.role === r).length <= SIZES[n][r])) || 40;
  return planShape({ place: g?.place || "other", size: fit, at: g?.at, note: g?.note, slots: members.map((m) => ({ role: m.role, name: m.name, realm: m.realm, note: m.bring || "" })) });
}

// ---------------------------------------------------------------- regulars (pure)
const emptyData = () => ({ version: 1, plans: {}, regulars: {}, seen: [], notes: {} });
const safeKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 140 && !["__proto__", "constructor", "prototype"].includes(k);
function migrate(raw) {
  const out = emptyData();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, plan] of Object.entries(raw.plans && typeof raw.plans === "object" ? raw.plans : {}).slice(0, LIMITS.plans)) if (safeKey(id)) out.plans[id] = planShape(plan);
  for (const [k, r] of Object.entries(raw.regulars && typeof raw.regulars === "object" ? raw.regulars : {}).slice(0, LIMITS.regulars)) {
    const w = who(r);
    if (!w || !safeKey(k) || k !== key(w)) continue;
    const places = {};
    for (const [p, n] of Object.entries(r.places && typeof r.places === "object" ? r.places : {}).slice(0, 60)) if (PLACE_RE.test(p) && int(n, 1, 100000)) places[p] = n;
    out.regulars[k] = { ...w, class: CLASSES.includes(r.class) ? r.class : null, runs: int(r.runs, 0, 100000) ? r.runs : 0, lastRun: int(r.lastRun, 1, Number.MAX_SAFE_INTEGER) ? r.lastRun : null,
      lastSeen: int(r.lastSeen, 1, Number.MAX_SAFE_INTEGER) ? r.lastSeen : null, places };
  }
  out.seen = (Array.isArray(raw.seen) ? raw.seen : []).filter((s) => typeof s === "string" && s.length <= 200).slice(-LIMITS.seen);
  for (const [k, v] of Object.entries(raw.notes && typeof raw.notes === "object" ? raw.notes : {}).slice(0, LIMITS.regulars)) { const note = typeof v === "string" ? line(v, LIMITS.personalNote) : null; if (safeKey(k) && k.includes("|") && note) out.notes[k] = note; }
  return out;
}
/**
 * One sighting of a group. A "run together" is counted once per person, place and four-hour window,
 * and only when the game said which dungeon or raid the group is in.
 */
function recordParty(data, party, now) {
  const out = migrate(data), me = who(party?.character);
  const place = typeof party?.place === "string" && PLACE_RE.test(party.place) ? party.place : null;
  const seen = new Set(out.seen);
  let changed = false;
  for (const m of Array.isArray(party?.members) ? party.members : []) {
    const w = who(m);
    if (!w || (me && sameWho(w, me))) continue;
    const k = key(w), row = out.regulars[k] || { ...w, class: null, runs: 0, lastRun: null, lastSeen: null, places: {} };
    if (CLASSES.includes(m.class) && row.class !== m.class) { row.class = m.class; changed = true; }
    if (!row.lastSeen || now - row.lastSeen > 60000) { row.lastSeen = now; changed = true; }
    if (place) {
      const mark = `${k}|${place}|${Math.floor(now / RUN_WINDOW)}`, before = `${k}|${place}|${Math.floor(now / RUN_WINDOW) - 1}`;
      if (!seen.has(mark) && !(seen.has(before) && row.lastRun && now - row.lastRun < RUN_WINDOW)) { row.runs++; row.places[place] = (row.places[place] || 0) + 1; changed = true; }
      if (!seen.has(mark)) { seen.add(mark); out.seen.push(mark); changed = true; }
      row.lastRun = now;
    }
    out.regulars[k] = row;
  }
  trim(out);
  return { data: out, changed };
}
/** Finished guild events the character was at ("present" lists of the saved file), each counted once. */
function recordEvents(data, events, realm) {
  const out = migrate(data), seen = new Set(out.seen);
  let changed = false;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.id !== "string" || !Array.isArray(e.present) || !e.present.length || !int(e.at, 1, 9999999999)) continue;
    const mark = `ev|${e.id}|${e.at}`;
    if (seen.has(mark)) continue;
    seen.add(mark); out.seen.push(mark); changed = true;
    for (const n of e.present) {
      const s = String(n), at = s.indexOf("-"), w = who(at > 0 ? { name: s.slice(0, at), realm: s.slice(at + 1) } : { name: s, realm });
      if (!w) continue;
      const k = key(w), row = out.regulars[k] || { ...w, class: null, runs: 0, lastRun: null, lastSeen: null, places: {} };
      row.runs++;
      if (typeof e.dungeon === "string" && PLACE_RE.test(e.dungeon) && e.dungeon !== "other") row.places[e.dungeon] = (row.places[e.dungeon] || 0) + 1;
      row.lastRun = Math.max(row.lastRun || 0, e.at * 1000); row.lastSeen = Math.max(row.lastSeen || 0, e.at * 1000);
      out.regulars[k] = row;
    }
  }
  trim(out);
  return { data: out, changed };
}
function trim(data) {
  data.seen = data.seen.slice(-LIMITS.seen);
  const keys = Object.keys(data.regulars);
  if (keys.length > LIMITS.regulars) for (const k of keys.sort((a, b) => (data.regulars[a].lastSeen || 0) - (data.regulars[b].lastSeen || 0)).slice(0, keys.length - LIMITS.regulars)) delete data.regulars[k];
}
/** The typed command that opens a whisper to someone. The player pastes it; the app never types into the game. */
function whisperCommand(c, myRealm = null) {
  const w = who(c);
  if (!w) return null;
  return `/w ${w.name}${myRealm && lower(myRealm) === lower(w.realm) ? "" : `-${w.realm.replace(/[\s']/g, "")}`} `;
}
function regularsView(data, { me = null, placeName = (id) => id } = {}) {
  const d = migrate(data);
  const mine = who(me);
  const rows = Object.values(d.regulars).filter((r) => !(mine && sameWho(r, mine)) && (r.runs > 0 || r.lastSeen)).map((r) => ({ name: r.name, realm: r.realm, class: r.class, runs: r.runs, lastRun: r.lastRun, lastSeen: r.lastSeen,
    places: Object.entries(r.places).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, LIMITS.places).map(([id, n]) => ({ id, name: placeName(id) || id, runs: n })),
    note: d.notes[key(r)] || "", whisper: whisperCommand(r, mine?.realm) }))
    .sort((a, b) => b.runs - a.runs || (b.lastRun || b.lastSeen || 0) - (a.lastRun || a.lastSeen || 0) || a.name.localeCompare(b.name));
  return { rows: rows.slice(0, 300), total: rows.length };
}

// ---------------------------------------------------------------- store
class GroupStore {
  constructor({ file, write = (f, t) => require("./store.cjs").atomic(f, t), now = Date.now } = {}) {
    Object.assign(this, { file, write, now, data: emptyData(), saved: "" });
    try { this.data = migrate(JSON.parse(fs.readFileSync(file, "utf8"))); this.saved = JSON.stringify(this.data); } catch { /* No file yet, or unreadable: start empty. */ }
  }
  save() {
    const t = JSON.stringify(this.data);
    if (t === this.saved || !this.file) return false;
    try { this.write(this.file, t); this.saved = t; return true; } catch { return false; }
  }
  plan(id) { return planShape(safeKey(id) ? this.data.plans[id] : null); }
  setPlan(id, plan) {
    if (!safeKey(id)) throw Error("Invalid plan.");
    const next = planShape({ ...plan, at: new Date(this.now()).toISOString() });
    if (!(id in this.data.plans) && Object.keys(this.data.plans).length >= LIMITS.plans) delete this.data.plans[Object.keys(this.data.plans)[0]];
    this.data.plans[id] = next; this.save();
    return next;
  }
  clearPlan(id) { if (safeKey(id) && this.data.plans[id]) { delete this.data.plans[id]; this.save(); } return emptyPlan(); }
  sawParty(party) { const r = recordParty(this.data, party, this.now()); if (r.changed) { this.data = r.data; this.save(); } return r.changed; }
  sawEvents(events, realm) { const r = recordEvents(this.data, events, realm); if (r.changed) { this.data = r.data; this.save(); } return r.changed; }
  setNote(character, value) {
    const w = who(character);
    if (!w || typeof value !== "string") throw Error("Invalid note.");
    const note = line(value, LIMITS.personalNote);
    if (note === null) throw Error("A note cannot hold a web address.");
    if (note) this.data.notes[key(w)] = note; else delete this.data.notes[key(w)];
    this.save();
    return note;
  }
  forget(character) {
    const w = who(character);
    if (!w) throw Error("Invalid character.");
    delete this.data.regulars[key(w)]; delete this.data.notes[key(w)];
    this.data.seen = this.data.seen.filter((s) => !s.startsWith(`${key(w)}|`));
    this.save();
    return true;
  }
  clear() { this.data = emptyData(); this.save(); }
}

module.exports = { SIZES, LIMITS, emptyPlan, planShape, assign, setSlotNote, reshape, autoFill, planView, handoffPlan, fromGamePlan, migrate, recordParty, recordEvents, regularsView, whisperCommand, GroupStore };

"use strict";
// Addon settings profiles on the desktop ("copy from another character").
//
// In game, /bf profile save NAME keeps a character's Backstage Forever settings as one text code and
// /bf profile share on puts the kept codes into that character's capture (an optional block,
// settingsProfiles). The desktop reads them after a /reload, lists them under Settings, and can
// hand one to another character through the hand-off file. The game offers it there; nothing is
// applied until the player types /bf profile accept.
//
// A code is data. The desktop checks its shape, length and checksum and counts what it holds; it
// never runs it and never trusts it: the addon checks every value again before anything is applied.
// Nothing here leaves this computer.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const PREFIX = "BF1", MAX_CODE = 16000, MAX_PROFILES = 9, MAX_DEPTH = 8, MAX_NODES = 30000, MAX_STRING = 400, MAX_SENDS = 100, MAX_T = 253402300799;
const NAME = /^[a-z0-9][a-z0-9-]{0,19}$/, SUM = /^[0-9a-f]{8}$/;
const label = (v, max = 60) => (typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f|]/.test(v) ? v : null);

// Adler-32 over the bytes, as eight hex digits: the same sum the addon writes.
function sum(text) {
  let a = 1, b = 0;
  for (const byte of Buffer.from(String(text), "latin1")) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return b.toString(16).padStart(4, "0") + a.toString(16).padStart(4, "0");
}

// The reader: one character at a time, counting what it makes, stopping at the first thing that is
// not exactly what the addon writes. Returns the value or throws.
function read(payload) {
  let pos = 0, nodes = 0;
  const fail = () => { throw Error("Invalid profile code."); };
  const value = (depth) => {
    if (++nodes > MAX_NODES) fail();
    const c = payload[pos];
    if (c === "t") { pos++; return true; }
    if (c === "f") { pos++; return false; }
    if (c === "n" || c === "s") {
      const stop = payload.indexOf(";", pos);
      if (stop < 0) fail();
      const raw = payload.slice(pos + 1, stop);
      pos = stop + 1;
      if (c === "n") {
        if (raw.length > 24 || !/^-?\d+(?:\.\d+)?$|^-?\d+\.?\d*e[+-]?\d{1,3}$/.test(raw)) fail();
        const v = Number(raw);
        if (!Number.isFinite(v)) fail();
        return v;
      }
      if (raw.length > MAX_STRING * 3 || /[^A-Za-z0-9_.\-%]/.test(raw) || /%(?![0-9A-Fa-f]{2})/.test(raw)) fail();
      const bytes = Buffer.from(raw.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
      if (bytes.length > MAX_STRING) fail();
      return bytes.toString("utf8");
    }
    if (c === "{") {
      if (depth >= MAX_DEPTH) fail();
      pos++;
      const out = new Map();
      for (;;) {
        const n = payload[pos];
        if (n === "}") { pos++; return out; }
        if (n !== "n" && n !== "s") fail();
        const key = value(depth + 1);
        if (typeof key === "number" && (!Number.isInteger(key) || key < 1 || key > 1e6)) fail();
        if (out.has(key)) fail();
        out.set(key, value(depth + 1));
      }
    }
    return fail();
  };
  const doc = value(0);
  if (pos !== payload.length) fail();
  return doc;
}
const leaves = (v) => (v instanceof Map ? [...v.values()].reduce((n, x) => n + leaves(x), 0) : 1);

/**
 * What a code is, without trusting it: { ok, reason?, sum, from, realm, className, at, settings, tables, hasData }.
 * reason: "form" | "version" | "big" | "sum" | "read" | "empty".
 */
function inspect(code) {
  if (typeof code !== "string") return { ok: false, reason: "form" };
  if (code.length > MAX_CODE) return { ok: false, reason: "big" };
  const m = /^([A-Z]{2}\d+):([0-9a-f]{8}):([A-Za-z0-9_.\-%;{}]*)$/.exec(code);
  if (!m) return { ok: false, reason: "form" };
  if (m[1] !== PREFIX) return { ok: false, reason: "version" };
  if (sum(m[3]) !== m[2]) return { ok: false, reason: "sum" };
  let doc;
  try { doc = read(m[3]); } catch { return { ok: false, reason: "read" }; }
  if (!(doc instanceof Map) || doc.get("v") !== 1) return { ok: false, reason: doc instanceof Map && typeof doc.get("v") === "number" ? "version" : "read" };
  const s = doc.get("s"), meta = doc.get("m");
  if (!(s instanceof Map)) return { ok: false, reason: "empty" };
  const tables = [...s.entries()].filter(([k, v]) => typeof k === "string" && /^[A-Za-z]{1,30}$/.test(k) && v instanceof Map && v.size);
  const settings = tables.reduce((n, [, v]) => n + leaves(v), 0);
  if (!settings) return { ok: false, reason: "empty" };
  const text = (k) => (meta instanceof Map ? label(meta.get(k)) : null);
  const at = meta instanceof Map && Number.isInteger(meta.get("t")) && meta.get("t") > 0 && meta.get("t") <= MAX_T ? meta.get("t") : null;
  return { ok: true, sum: sum(code), from: text("n"), realm: text("r"), className: /^[A-Z]{1,20}$/.test(text("c") || "") ? text("c") : null, at, settings, tables: tables.length, hasData: doc.get("d") instanceof Map };
}

/** The optional capture block of one character, checked: { profiles: [{ name, code, at }], done }. Throws when it is not a block at all. */
function normalizeProfilesCapture(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1) throw Error("Invalid profiles capture.");
  // Lua writes an empty list as {}.
  const list = Array.isArray(raw.profiles) ? raw.profiles : raw.profiles && typeof raw.profiles === "object" && !Object.keys(raw.profiles).length ? [] : null;
  if (!list || list.length > MAX_PROFILES) throw Error("Invalid profiles capture.");
  const profiles = [], seen = new Set();
  for (const row of list) {
    // One bad row never costs the others.
    if (!row || typeof row !== "object" || typeof row.n !== "string" || !NAME.test(row.n) || seen.has(row.n) || typeof row.c !== "string" || row.c.length > MAX_CODE) continue;
    seen.add(row.n);
    profiles.push({ name: row.n, code: row.c, at: Number.isInteger(row.t) && row.t > 0 && row.t <= MAX_T ? row.t : null });
  }
  profiles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { profiles, done: typeof raw.done === "string" && SUM.test(raw.done) ? raw.done : null };
}

const cleanSend = (v) => {
  if (!v || typeof v !== "object" || typeof v.name !== "string" || !NAME.test(v.name) || !label(v.from, 130) || typeof v.code !== "string") return null;
  const seen = inspect(v.code);
  if (!seen.ok || seen.hasData) return null;
  return { name: v.name, from: v.from, code: v.code, sum: seen.sum, at: Number.isFinite(v.at) && v.at > 0 ? Math.floor(v.at) : 0 };
};
/** The profile each character is waiting to be offered in game, keyed "Name-Realm". Kept in one small file. */
class ProfileSends {
  constructor(dir) {
    this.file = path.join(dir, "profile-sends.json");
    this.sends = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw?.schemaVersion === 1 && raw.sends && typeof raw.sends === "object" && !Array.isArray(raw.sends))
        for (const [k, v] of Object.entries(raw.sends).slice(0, MAX_SENDS)) { const c = cleanSend(v); if (c && label(k, 130)) this.sends[k] = c; }
    } catch { /* No file yet. */ }
  }
  get(key) { const s = typeof key === "string" ? this.sends[key] : null; return s ? { ...s } : null; }
  all() { return Object.fromEntries(Object.entries(this.sends).map(([k, v]) => [k, { ...v }])); }
  set(key, send) {
    if (!label(key, 130)) throw Error("Choose a character first.");
    if (send === null) delete this.sends[key];
    else {
      const c = cleanSend(send);
      if (!c) throw Error("This profile cannot be sent to the game.");
      if (!this.sends[key] && Object.keys(this.sends).length >= MAX_SENDS) throw Error("Too many characters are waiting for a profile.");
      this.sends[key] = c;
    }
    this.save();
    return this.get(key);
  }
  /** Forgets sends the game says it has dealt with (accepted or dismissed). done: { "Name-Realm": checksum }. Returns true when something went. */
  settle(done) {
    let changed = false;
    for (const [key, value] of Object.entries(done || {})) if (this.sends[key] && this.sends[key].sum === value) { delete this.sends[key]; changed = true; }
    if (changed) this.save();
    return changed;
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); atomic(this.file, JSON.stringify({ schemaVersion: 1, sends: this.sends }) + "\n"); }
  clear() { this.sends = {}; try { fs.rmSync(this.file, { force: true }); } catch { /* Nothing to remove. */ } }
}

const keyOf = (c) => `${c.name}-${c.realm || ""}`;
/**
 * What the Settings card shows. blocks: [{ id, name, realm, profiles: { profiles, done } }] from the
 * last read of the saved file; characters: the desktop's own list of game characters
 * [{ id, name, realm, className }]; sends: ProfileSends#all().
 */
function profilesView(blocks, characters, sends) {
  const known = (Array.isArray(characters) ? characters : []).filter((c) => c && label(c.name) && label(c.realm));
  const sources = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || !label(b.name) || !b.profiles) continue;
    const rows = b.profiles.profiles.map((p) => {
      const seen = inspect(p.code);
      return { name: p.name, at: p.at, ok: seen.ok && !seen.hasData, settings: seen.ok ? seen.settings : 0, reason: seen.ok ? (seen.hasData ? "data" : null) : seen.reason };
    });
    if (rows.length) sources.push({ id: b.id, key: keyOf(b), name: b.name, realm: b.realm || "", profiles: rows });
  }
  sources.sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));
  const targets = known.map((c) => ({ id: c.id, key: keyOf(c), name: c.name, realm: c.realm, className: c.className || null })).sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm));
  const waiting = Object.entries(sends || {}).map(([key, s]) => ({ key, name: s.name, from: s.from, at: s.at })).sort((a, b) => a.key.localeCompare(b.key));
  return { sources, targets, waiting };
}

module.exports = { MAX_CODE, MAX_PROFILES, sum, inspect, normalizeProfilesCapture, ProfileSends, profilesView, keyOf };

"use strict";
// Route editor and share format (roadmap Q9). A character's edits are an overlay on the generated
// route: steps skipped, notes on steps, steps moved, and the player's own steps. The route itself
// is never stored, so a rebuilt route (new data, another variant) keeps every edit whose step
// still exists; the others wait, counted as "lost", and come back if the step does.
//
// The overlay travels as one text code. Import is strict: known version, bounded size, check
// digits, exact keys, step ids of known quests only, notes capped and plain text. A note is only
// ever shown as text, never as HTML, and its game copy has the game's colour codes taken out.
const crypto = require("node:crypto");
const fs = require("node:fs");
const { VARIANT_IDS, variantId } = require("./route-variants.cjs");
const PREFIX = "BFROUTE1";
const LIMITS = Object.freeze({ code: 48000, skip: 512, notes: 200, note: 200, moves: 400, custom: 60, customText: 160, profiles: 100, handoffSteps: 12, handoffNote: 120, handoffText: 200 });
const RACE_KEYS = Object.freeze(["Human", "Orc", "Dwarf", "Night Elf", "Undead", "Tauren", "Gnome", "Troll"]);
const STEP_ID = /^(?:(?:pickup|class|objective|turnin):\d{1,7}(?:\+\d{1,7}){0,39}|travel:\d{1,7}|dungeon:[a-z0-9-]{1,24}|custom:\d{1,4})$/;
const sum = (body) => crypto.createHash("sha256").update(`${PREFIX}:${body}`).digest("hex").slice(0, 10);
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const stepId = (v) => typeof v === "string" && v.length <= 400 && STEP_ID.test(v);
const unit = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const mapId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
/** Plain text, one line, or null: no control characters, trimmed, at most max characters. */
function text(v, max) {
  if (typeof v !== "string" || /[\x00-\x1f\x7f]/.test(v) || /[^\S ]/.test(v)) return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
const empty = () => ({ v: 1, variant: "solo", skip: [], notes: {}, moves: [], custom: [] });

function cleanCustom(c) {
  if (!plain(c) || typeof c.id !== "string" || !/^custom:\d{1,4}$/.test(c.id)) return null;
  const t = text(c.text, LIMITS.customText);
  if (!t || !(c.after === null || stepId(c.after))) return null;
  const point = mapId(c.mapId) && unit(c.x) && unit(c.y);
  return { id: c.id, text: t, after: c.after, ...(point ? { mapId: c.mapId, x: Math.round(c.x * 10000) / 10000, y: Math.round(c.y * 10000) / 10000 } : {}) };
}
/** Any stored or damaged overlay -> a clean one; a bad entry never costs the rest. */
function cleanOverlay(raw) {
  const out = empty();
  if (!plain(raw)) return out;
  out.variant = variantId(raw.variant);
  for (const id of Array.isArray(raw.skip) ? raw.skip : []) if (stepId(id) && !out.skip.includes(id) && out.skip.length < LIMITS.skip) out.skip.push(id);
  if (plain(raw.notes)) for (const [id, note] of Object.entries(raw.notes)) { const t = text(note, LIMITS.note); if (stepId(id) && t && Object.keys(out.notes).length < LIMITS.notes) out.notes[id] = t; }
  for (const m of Array.isArray(raw.moves) ? raw.moves : []) if (Array.isArray(m) && m.length === 2 && stepId(m[0]) && (m[1] === null || stepId(m[1])) && m[0] !== m[1] && out.moves.length < LIMITS.moves) out.moves.push([m[0], m[1]]);
  const seen = new Set();
  for (const c of Array.isArray(raw.custom) ? raw.custom : []) { const k = cleanCustom(c); if (k && !seen.has(k.id) && out.custom.length < LIMITS.custom) { seen.add(k.id); out.custom.push(k); } }
  return out;
}
const hasEdits = (o) => !!o && (o.skip.length > 0 || Object.keys(o.notes).length > 0 || o.moves.length > 0 || o.custom.length > 0);

/**
 * The route as the player edited it. Own steps go in after their anchor, moves apply in order,
 * notes attach, skipped steps drop out (or stay, marked, with keepSkipped for the editor).
 * edits.lost counts entries whose step is not in this route.
 */
function applyOverlay(route, overlay, { keepSkipped = false } = {}) {
  const o = cleanOverlay(overlay);
  if (!route) return null;
  let steps = route.steps.slice(), lost = 0;
  const has = (id) => steps.some((s) => s.id === id);
  for (const c of o.custom) {
    if (c.after !== null && !has(c.after)) { lost++; continue; }
    const at = c.after === null ? -1 : steps.findIndex((s) => s.id === c.after);
    const near = steps[Math.max(0, at)] || null;
    steps.splice(at + 1, 0, { id: c.id, kind: "custom", ids: [], text: c.text, mapId: c.mapId ?? null, x: c.x ?? null, y: c.y ?? null, level: near?.level || 1, custom: true });
  }
  let moved = 0;
  for (const [id, after] of o.moves) {
    const from = steps.findIndex((s) => s.id === id);
    if (from < 0 || (after !== null && !has(after))) { lost++; continue; }
    const [step] = steps.splice(from, 1);
    steps.splice(after === null ? 0 : steps.findIndex((s) => s.id === after) + 1, 0, step);
    moved++;
  }
  const skip = new Set(o.skip);
  let notes = 0, skipped = 0;
  for (const id of Object.keys(o.notes)) if (has(id)) notes++; else lost++;
  for (const id of skip) if (has(id)) skipped++; else lost++;
  steps = steps.filter((s) => keepSkipped || !skip.has(s.id)).map((s) => ({ ...s, ...(o.notes[s.id] ? { note: o.notes[s.id] } : {}), ...(skip.has(s.id) ? { skipped: true } : {}) }));
  return { ...route, steps, variant: o.variant, edits: { notes, skipped, moved, custom: steps.filter((s) => s.custom).length, lost } };
}

/**
 * One edit (pure): returns the new overlay. route is the generated route for the overlay's
 * variant; up/down work on the order the player sees. Throws a plain sentence on a bad edit.
 */
function edit(overlay, action, route) {
  const o = cleanOverlay(overlay);
  if (!plain(action)) throw Error("Unknown edit.");
  if (action.type === "variant") { if (!VARIANT_IDS.includes(action.variant)) throw Error("Unknown route choice."); o.variant = action.variant; return o; }
  if (action.type === "reset") return { ...empty(), variant: o.variant };
  const view = applyOverlay(route, o, { keepSkipped: true });
  const ids = (view?.steps || []).map((s) => s.id);
  if (action.type === "add") {
    const t = text(action.text, LIMITS.customText);
    if (!t) throw Error(`Write the step in 1 to ${LIMITS.customText} characters, on one line.`);
    if (o.custom.length >= LIMITS.custom) throw Error(`A route holds at most ${LIMITS.custom} steps of your own.`);
    if (!(action.after === null || ids.includes(action.after))) throw Error("Unknown step.");
    const wantsPoint = action.mapId != null || action.x != null || action.y != null;
    if (wantsPoint && !(mapId(action.mapId) && unit(action.x) && unit(action.y))) throw Error("The map point needs a zone and two numbers from 0 to 100.");
    let n = 1; while (o.custom.some((c) => c.id === `custom:${n}`)) n++;
    o.custom.push(cleanCustom({ id: `custom:${n}`, text: t, after: action.after, ...(wantsPoint ? { mapId: action.mapId, x: action.x, y: action.y } : {}) }));
    return o;
  }
  const id = action.id;
  if (!stepId(id) || !ids.includes(id)) throw Error("Unknown step.");
  if (action.type === "skip") { if (!o.skip.includes(id)) { if (o.skip.length >= LIMITS.skip) throw Error("Too many skipped steps. Restore some first."); o.skip.push(id); } }
  else if (action.type === "unskip") o.skip = o.skip.filter((x) => x !== id);
  else if (action.type === "note") {
    if (action.text === "" || action.text == null) delete o.notes[id];
    else {
      const t = text(action.text, LIMITS.note);
      if (!t) throw Error(`A note is 1 to ${LIMITS.note} characters of plain text on one line.`);
      if (!o.notes[id] && Object.keys(o.notes).length >= LIMITS.notes) throw Error(`A route holds at most ${LIMITS.notes} notes.`);
      o.notes[id] = t;
    }
  } else if (action.type === "remove") {
    if (!o.custom.some((c) => c.id === id)) throw Error("Only your own steps can be removed. Skip the others.");
    const gone = o.custom.find((c) => c.id === id);
    o.custom = o.custom.filter((c) => c.id !== id).map((c) => (c.after === id ? { ...c, after: gone.after } : c));
    o.moves = o.moves.filter((m) => m[0] !== id).map((m) => (m[1] === id ? [m[0], gone.after] : m)).filter((m) => m[0] !== m[1]);
    delete o.notes[id]; o.skip = o.skip.filter((x) => x !== id);
  } else if (action.type === "up" || action.type === "down" || action.type === "move") {
    const i = ids.indexOf(id);
    let after;
    if (action.type === "up") { if (i === 0) return o; after = i > 1 ? ids[i - 2] : null; }
    else if (action.type === "down") { if (i === ids.length - 1) return o; after = ids[i + 1]; }
    else { after = action.after; if (!(after === null || (ids.includes(after) && after !== id))) throw Error("Unknown step."); if ((i === 0 ? null : ids[i - 1]) === after) return o; }
    // Moving the same step again replaces its last move when that was the newest edit.
    const last = o.moves[o.moves.length - 1];
    if (last && last[0] === id) o.moves.pop();
    if (o.moves.length >= LIMITS.moves) throw Error("Too many moves on this route. Reset the order first.");
    o.moves.push([id, after]);
  } else throw Error("Unknown edit.");
  return o;
}

/** The overlay as one text code. race: the route it was made on (told to whoever imports it). */
function exportCode(overlay, race) {
  const o = cleanOverlay(overlay);
  if (!RACE_KEYS.includes(race)) throw Error("There is no route to share for this character.");
  if (!hasEdits(o) && o.variant === "solo") throw Error("There are no edits to share yet.");
  const data = { v: 1, r: race, t: o.variant, s: o.skip, n: Object.entries(o.notes), m: o.moves, c: o.custom.map((c) => [c.id, c.text, c.after, c.mapId ?? 0, c.x ?? 0, c.y ?? 0]) };
  const body = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const code = `${PREFIX}.${body}.${sum(body)}`;
  if (code.length > LIMITS.code) throw Error("These edits are too large to share as one code.");
  return code;
}
/**
 * A pasted code -> { race, overlay } or null. knows: { quest(id), map(id), dungeon(key) } say
 * whether an id is in this app's data; a code naming anything else is refused whole.
 */
function importCode(code, knows) {
  if (typeof code !== "string" || !knows) return null;
  const t = code.trim();
  if (t.length > LIMITS.code || !/^BFROUTE1\.[A-Za-z0-9_-]{8,47900}\.[0-9a-f]{10}$/.test(t)) return null;
  const [, body, check] = t.split(".");
  if (sum(body) !== check) return null;
  let d;
  try {
    const json = Buffer.from(body, "base64url");
    if (json.toString("base64url") !== body) return null;
    d = JSON.parse(json.toString("utf8"));
  } catch { return null; }
  if (!plain(d)) return null;
  const keys = Object.keys(d);
  if (keys.length !== 7 || !["v", "r", "t", "s", "n", "m", "c"].every((k) => keys.includes(k)) || d.v !== 1) return null;
  if (!RACE_KEYS.includes(d.r) || !VARIANT_IDS.includes(d.t)) return null;
  if (![d.s, d.n, d.m, d.c].every(Array.isArray) || d.s.length > LIMITS.skip || d.n.length > LIMITS.notes || d.m.length > LIMITS.moves || d.c.length > LIMITS.custom) return null;
  const customIds = new Set();
  for (const c of d.c) {
    if (!Array.isArray(c) || c.length !== 6 || typeof c[0] !== "string" || !/^custom:\d{1,4}$/.test(c[0]) || customIds.has(c[0])) return null;
    customIds.add(c[0]);
  }
  const known = (id) => {
    if (!stepId(id)) return false;
    const [kind, rest] = id.split(":");
    if (kind === "custom") return customIds.has(id);
    if (kind === "travel") return knows.map(Number(rest)) === true;
    if (kind === "dungeon") return knows.dungeon(rest) === true;
    return rest.split("+").every((q) => knows.quest(Number(q)) === true);
  };
  const overlay = { v: 1, variant: d.t, skip: [], notes: {}, moves: [], custom: [] };
  for (const id of d.s) { if (!known(id) || overlay.skip.includes(id)) return null; overlay.skip.push(id); }
  for (const n of d.n) {
    if (!Array.isArray(n) || n.length !== 2 || !known(n[0]) || text(n[1], LIMITS.note) !== n[1] || overlay.notes[n[0]]) return null;
    overlay.notes[n[0]] = n[1];
  }
  for (const m of d.m) { if (!Array.isArray(m) || m.length !== 2 || !known(m[0]) || !(m[1] === null || known(m[1])) || m[0] === m[1]) return null; overlay.moves.push([m[0], m[1]]); }
  for (const c of d.c) {
    const [id, words, after, map, x, y] = c;
    if (text(words, LIMITS.customText) !== words || !(after === null || (known(after) && after !== id))) return null;
    const point = map !== 0 || x !== 0 || y !== 0;
    if (point && !(mapId(map) && knows.map(map) === true && unit(x) && unit(y))) return null;
    overlay.custom.push({ id, text: words, after, ...(point ? { mapId: map, x, y } : {}) });
  }
  // Round trip: what came in must already be in the clean form, or it was not made by this app.
  if (JSON.stringify(cleanOverlay(overlay)) !== JSON.stringify(overlay)) return null;
  return { race: d.r, overlay };
}

// The game shows | codes (colours, links, pictures) in any text; a note must stay plain there.
const gameText = (v, max) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, max);
/**
 * The next steps of an edited route for the desktop -> game hand-off: at most
 * LIMITS.handoffSteps steps from `from`, each with its note. Steps without a clean shape are
 * left out. Returns [] for nothing to hand over.
 */
function handoffSteps(route, from = 0) {
  const KIND = { pickup: "p", class: "c", objective: "o", turnin: "t", travel: "g", dungeon: "d", custom: "x" };
  const out = [];
  for (const s of (route?.steps || []).slice(Math.max(0, from))) {
    if (out.length >= LIMITS.handoffSteps) break;
    const words = gameText(s.text, LIMITS.handoffText);
    if (!KIND[s.kind] || !words || !stepId(s.id)) continue;
    const point = mapId(s.mapId) && unit(s.x) && unit(s.y);
    out.push({ kind: KIND[s.kind], text: words, mapId: mapId(s.mapId) ? s.mapId : 0, x: point ? s.x : null, y: point ? s.y : null, level: Number.isInteger(s.level) && s.level >= 1 && s.level <= 100 ? s.level : 1,
      ids: (s.ids || []).filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647).slice(0, 40), id: s.id, note: s.note ? gameText(s.note, LIMITS.handoffNote) : "" });
  }
  return out;
}

/** route-edits.json in the app's data folder: one overlay per character. */
class RouteEdits {
  constructor({ file = null, write = (f, t) => require("./store.cjs").atomic(f, t) } = {}) {
    Object.assign(this, { file, write, data: {} });
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (plain(raw) && raw.version === 1 && plain(raw.characters)) for (const [id, o] of Object.entries(raw.characters).slice(0, LIMITS.profiles)) if (id.length <= 100 && !["__proto__", "constructor", "prototype"].includes(id)) this.data[id] = cleanOverlay(o);
    } catch { /* No file yet, or unreadable: start empty. */ }
  }
  get(profileId) { return cleanOverlay(this.data[profileId]); }
  set(profileId, overlay) {
    if (typeof profileId !== "string" || !profileId || profileId.length > 100 || ["__proto__", "constructor", "prototype"].includes(profileId)) throw Error("Unknown character.");
    if (!this.data[profileId] && Object.keys(this.data).length >= LIMITS.profiles) throw Error("Too many characters have edited routes.");
    this.data[profileId] = cleanOverlay(overlay);
    if (this.file) this.write(this.file, JSON.stringify({ version: 1, characters: this.data }));
    return this.get(profileId);
  }
  /** Deleted characters take their edits with them. */
  absorb(state) {
    const ids = new Set((state?.profiles || []).map((p) => p.id));
    let changed = false;
    for (const id of Object.keys(this.data)) if (!ids.has(id)) { delete this.data[id]; changed = true; }
    if (changed && this.file) try { this.write(this.file, JSON.stringify({ version: 1, characters: this.data })); } catch { /* Kept in memory. */ }
    return changed;
  }
}
module.exports = { PREFIX, LIMITS, RACE_KEYS, empty, text, cleanOverlay, hasEdits, applyOverlay, edit, exportCode, importCode, handoffSteps, gameText, RouteEdits };

"use strict";
// Screenshot journal (W7). The game writes its screenshots to the Screenshots folder inside the
// game folder. The desktop only reads that folder: it lists the newest pictures, makes small
// previews (kept under the app's own data folder) and places each picture on the Journey
// timeline by the file's time, next to the level and zone the character was in when the saved
// data can tell. Pictures are never moved, changed, copied elsewhere or uploaded.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const LIMITS = Object.freeze({ shots: 200, scan: 5000, bytes: 24 * 1024 * 1024, thumbs: 400, thumbWidth: 360, timeline: 400 });
const NAME = /^[A-Za-z0-9 _().-]{1,120}\.(?:jpe?g|png|tga)$/i;
const PREVIEWABLE = /\.(?:jpe?g|png)$/i;
const MAX_T = 253402300799;

/** The Screenshots folder for a connected game folder, or null. Never a link to somewhere else. */
function screenshotsDir(root, { fsi = fs } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root) || /[\x00-\x1f]/.test(root)) return null;
  const dir = path.join(root, "Screenshots");
  try { const s = fsi.lstatSync(dir); return s.isDirectory() && !s.isSymbolicLink() ? dir : null; } catch { return null; }
}
/**
 * The newest screenshots in a folder: [{ name, at (seconds, the file's time), bytes, preview }],
 * newest first. Only plain picture files with ordinary names; sub-folders and links are skipped.
 */
function listScreenshots(dir, { fsi = fs, limit = LIMITS.shots } = {}) {
  if (!dir) return [];
  let names;
  try { names = fsi.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const rows = [];
  for (const entry of names.slice(0, LIMITS.scan)) {
    if (!entry.isFile() || !NAME.test(entry.name)) continue;
    let stat;
    try { stat = fsi.lstatSync(path.join(dir, entry.name)); } catch { continue; }
    if (!stat.isFile() || stat.size <= 0 || stat.size > LIMITS.bytes) continue;
    const at = Math.floor(stat.mtimeMs / 1000);
    if (!Number.isSafeInteger(at) || at <= 0 || at > MAX_T) continue;
    rows.push({ name: entry.name, at, bytes: stat.size, preview: PREVIEWABLE.test(entry.name) });
  }
  return rows.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Where a character was when a picture was taken, from saved data only.
 * - A play session of this character that covers the time gives the level range of that session
 *   and its zone when it stayed in one zone ("session").
 * - Otherwise the dated level-ups give the level, when the time lies between the first and the
 *   newest save ("journal"), and a quest picked up within the hour gives the zone.
 * - Otherwise nothing is claimed.
 */
function placeScreenshot(shot, { profile = null, sessions = [], mapName = (id) => `Map ${id}` } = {}) {
  const out = { level: null, zone: null, basis: null };
  const ms = shot.at * 1000;
  const session = (sessions || []).find((s) => ms >= s.startedAt - 60000 && ms <= s.endedAt + 120000);
  const levels = (profile?.journal?.levels || []).filter((e) => e.at > 0).sort((a, b) => a.at - b.at);
  const savedAt = Date.parse(profile?.source?.updatedAt || "") / 1000;
  let level = null;
  for (const e of levels) { if (e.at <= shot.at) level = e.level; else break; }
  const inJournal = level !== null && Number.isFinite(savedAt) && shot.at <= savedAt + 3600;
  const giver = (profile?.journal?.givers || []).reduce((best, g) => (Math.abs(g.at - shot.at) <= 3600 && (!best || Math.abs(g.at - shot.at) < Math.abs(best.at - shot.at)) ? g : best), null);
  if (session) {
    out.basis = "session";
    out.level = inJournal ? level : Number.isInteger(session.level) ? session.level : null;
    if (Array.isArray(session.zones) && session.zones.length === 1) out.zone = mapName(session.zones[0]);
    else if (giver) out.zone = mapName(giver.m);
  } else if (inJournal) {
    out.basis = "journal"; out.level = level;
    if (giver) out.zone = mapName(giver.m);
  }
  return out;
}

const localDay = (at) => { const d = new Date(at * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/**
 * The Journey timeline: level-ups, firsts, dungeon runs, deaths and screenshots in one list,
 * newest first, grouped by day. Every row comes from saved data or a file's time.
 */
function timeline({ profile = null, shots = [], sessions = [], deaths = [], runs = [], mapName = (id) => `Map ${id}`, firstWords = {} } = {}) {
  const rows = [];
  for (const e of profile?.journal?.levels || []) if (e.at > 0) rows.push({ kind: "level", at: e.at, title: `Reached level ${e.level}`, level: e.level });
  for (const f of profile?.journal?.firsts || []) if (f.at > 0 && firstWords[f.key]) rows.push({ kind: "first", at: f.at, title: firstWords[f.key], key: f.key });
  for (const r of runs || []) rows.push({ kind: "run", at: r.startedAt, title: r.name, detail: `${r.bosses.length} boss${r.bosses.length === 1 ? "" : "es"} defeated${r.timed && r.deaths ? `, ${r.deaths} death${r.deaths === 1 ? "" : "s"}` : ""}` });
  for (const d of deaths || []) rows.push({ kind: "death", at: Math.floor(d.at / 1000), title: d.mapId ? `Died in ${mapName(d.mapId)}` : "Died", detail: d.killer ? `Most of the damage came from ${d.killer}.` : "" });
  for (const s of shots || []) {
    const place = placeScreenshot(s, { profile, sessions, mapName });
    rows.push({ kind: "shot", at: s.at, title: "Screenshot", name: s.name, preview: s.preview, ...place });
  }
  rows.sort((a, b) => b.at - a.at || a.kind.localeCompare(b.kind));
  const days = [];
  for (const row of rows.slice(0, LIMITS.timeline)) {
    const key = localDay(row.at);
    let day = days[days.length - 1];
    if (!day || day.day !== key) days.push((day = { day: key, at: row.at, rows: [] }));
    day.rows.push(row);
  }
  return { days, counts: { rows: Math.min(rows.length, LIMITS.timeline), shots: rows.filter((r) => r.kind === "shot").length, placed: rows.filter((r) => r.kind === "shot" && r.basis).length } };
}

/**
 * Small previews, cached in the app's own folder under a name made from the picture's name, size
 * and time (so a changed file gets a new preview). `render(file, width)` returns JPEG bytes or
 * null; in the app it is Electron's image reader. The original is opened read-only.
 */
class ThumbCache {
  constructor({ cacheDir, render, fsi = fs }) { Object.assign(this, { cacheDir, render, fsi }); }
  key(shot) { return crypto.createHash("sha1").update(`${shot.name}|${shot.bytes}|${shot.at}`).digest("hex"); }
  /** dir: the Screenshots folder; shot: a row from listScreenshots (the caller checked it is listed). */
  get(dir, shot) {
    if (!dir || !shot || !NAME.test(shot.name) || !shot.preview) return null;
    const file = path.join(dir, shot.name);
    if (path.dirname(file) !== dir) return null;
    const cached = this.cacheDir ? path.join(this.cacheDir, `${this.key(shot)}.jpg`) : null;
    if (cached) { try { const hit = this.fsi.readFileSync(cached); if (hit.length > 16) return hit; } catch { /* Not made yet. */ } }
    let bytes = null;
    try { const s = this.fsi.lstatSync(file); if (!s.isFile() || s.size > LIMITS.bytes) return null; bytes = this.render(file, LIMITS.thumbWidth); } catch { return null; }
    if (!bytes || bytes.length < 16) return null;
    if (cached) { try { this.fsi.mkdirSync(this.cacheDir, { recursive: true }); this.fsi.writeFileSync(cached, bytes); this.prune(); } catch { /* The preview still shows this time. */ } }
    return bytes;
  }
  /** Keep the newest previews only. */
  prune() {
    let files;
    try { files = this.fsi.readdirSync(this.cacheDir).filter((n) => /^[0-9a-f]{40}\.jpg$/.test(n)); } catch { return 0; }
    if (files.length <= LIMITS.thumbs) return 0;
    const aged = files.map((n) => { try { return { n, t: this.fsi.statSync(path.join(this.cacheDir, n)).mtimeMs }; } catch { return { n, t: 0 }; } }).sort((a, b) => b.t - a.t);
    let removed = 0;
    for (const { n } of aged.slice(LIMITS.thumbs)) { try { this.fsi.unlinkSync(path.join(this.cacheDir, n)); removed++; } catch { /* Try again next time. */ } }
    return removed;
  }
  clear() {
    try { for (const n of this.fsi.readdirSync(this.cacheDir)) if (/^[0-9a-f]{40}\.jpg$/.test(n)) this.fsi.unlinkSync(path.join(this.cacheDir, n)); } catch { /* Nothing cached. */ }
  }
}

module.exports = { LIMITS, NAME, screenshotsDir, listScreenshots, placeScreenshot, timeline, ThumbCache };

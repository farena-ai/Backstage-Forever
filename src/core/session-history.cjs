"use strict";
// Session history (0.48, roadmap 3.1): past play sessions per character, kept on this computer
// (sessions.json in the app's data folder): when, how long, levels gained, deaths and zones,
// plus levels per day. Built from the live play session; written at most once a minute.
const fs = require("node:fs");
const MAX_SESSIONS = 300, MIN_MINUTES = 3, WRITE_GAP_MS = 60000, DAYS = 14;

const int = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : null);
const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const sourceId = value => typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
const savedSource = profile => profile?.source?.kind === "wow-addon" ? sourceId(profile.source.id) : null;
const publicRow = ({ savedSourceId, ...row }) => row;
function clean(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || e.id.length > 200 || typeof e.profileId !== "string" || e.profileId.length > 200) return null;
  const startedAt = int(e.startedAt, 0, 1e14), endedAt = int(e.endedAt, 0, 1e14);
  if (startedAt === null || endedAt === null || endedAt < startedAt) return null;
  return { id: e.id, profileId: e.profileId, savedSourceId: sourceId(e.savedSourceId), name: typeof e.name === "string" ? e.name.slice(0, 60) : "", startedAt, endedAt,
    minutes: int(e.minutes, 0, 100000) ?? 0, startLevel: int(e.startLevel, 1, 100), level: int(e.level, 1, 100), levelsGained: num(e.levelsGained, 0, 100) ?? 0,
    deaths: int(e.deaths, 0, 10000) ?? 0, zones: Array.isArray(e.zones) ? e.zones.filter((z) => int(z, 1, 2147483647)).slice(0, 40) : [] };
}
/** Local calendar day "YYYY-MM-DD" for a millisecond time. */
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

class SessionHistory {
  constructor({ file, now = Date.now, write = (f, text) => require("./store.cjs").atomic(f, text) } = {}) {
    Object.assign(this, { file, now, write, sessions: [], dirty: false, writtenAt: 0 });
    try { const raw = JSON.parse(fs.readFileSync(file, "utf8")); this.sessions = (Array.isArray(raw?.sessions) ? raw.sessions : []).map(clean).filter(Boolean).slice(-MAX_SESSIONS); } catch {}
  }
  /** Remember the live session (summary from PlaySession) for the active profile. */
  checkpoint(summary, profile, { savedSourceLinked = false } = {}) {
    if (!summary?.active || !profile?.id || !Number.isFinite(summary.startedAt) || (summary.activeMinutes ?? 0) < MIN_MINUTES) return false;
    const entry = clean({ id: `${profile.id}:${summary.startedAt}`, profileId: profile.id, savedSourceId: savedSourceLinked ? savedSource(profile) : null, name: profile.name, startedAt: summary.startedAt, endedAt: summary.lastAt ?? summary.startedAt,
      minutes: summary.activeMinutes, startLevel: summary.startLevel, level: summary.level, levelsGained: summary.levelsGained, deaths: summary.deaths, zones: summary.zones });
    if (!entry) return false;
    const i = this.sessions.findIndex((s) => s.id === entry.id);
    // A later checkpoint may update the original record, not relabel it or upgrade legacy ownership.
    if (i >= 0) {
      const previous = this.sessions[i].savedSourceId;
      if (previous && previous !== entry.savedSourceId) return false;
      entry.savedSourceId = previous;
    }
    if (i >= 0) this.sessions[i] = entry; else { this.sessions.push(entry); if (this.sessions.length > MAX_SESSIONS) this.sessions.splice(0, this.sessions.length - MAX_SESSIONS); }
    this.dirty = true;
    if (this.now() - this.writtenAt >= WRITE_GAP_MS) this.flush();
    return true;
  }
  flush() {
    if (!this.dirty || !this.file) return;
    try { this.write(this.file, JSON.stringify({ version: 1, sessions: this.sessions })); this.dirty = false; this.writtenAt = this.now(); } catch {}
  }
  /** Delete all local data: forget every session and write the empty file now. */
  clear() { this.sessions = []; this.dirty = true; this.flush(); }
  forget(profileId) { const n = this.sessions.length; this.sessions = this.sessions.filter((s) => s.profileId !== profileId); if (n !== this.sessions.length) { this.dirty = true; this.flush(); } }
  /** Match the exact saved source recorded at checkpoint, not merely a reusable journal ID. */
  forAfterAction(profile) {
    const source = savedSource(profile);
    const mine = source ? this.sessions.filter(s => s.profileId === profile.id && s.savedSourceId === source) : [];
    return { sessions: mine.sort((a, b) => b.startedAt - a.startedAt).slice(0, 30).map(publicRow) };
  }
  /** One character's sessions, newest first, and the last 14 days of levels and minutes. */
  view(profileId) {
    const mine = this.sessions.filter((s) => s.profileId === profileId).sort((a, b) => b.startedAt - a.startedAt);
    const today = this.now(), days = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const key = dayOf(today - i * 86400000), list = mine.filter((s) => dayOf(s.startedAt) === key);
      days.push({ day: key, levels: Math.round(list.reduce((t, s) => t + s.levelsGained, 0) * 100) / 100, minutes: list.reduce((t, s) => t + s.minutes, 0), sessions: list.length });
    }
    const played = mine.reduce((t, s) => t + s.minutes, 0);
    return { sessions: mine.slice(0, 30).map(publicRow), days, totals: { sessions: mine.length, minutes: played, levels: Math.round(mine.reduce((t, s) => t + s.levelsGained, 0) * 100) / 100, deaths: mine.reduce((t, s) => t + s.deaths, 0) } };
  }
}
module.exports = { SessionHistory, dayOf, MAX_SESSIONS };

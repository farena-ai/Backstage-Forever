"use strict";
const { randomUUID } = require("node:crypto");
const { WEEK } = require("./weekly.cjs");
const MAX_TEXT = 280;
const ownerOf = p => JSON.stringify([p.id, p.source?.kind, p.source?.id, p.clientBuild]);
const dated = (at, now) => Number.isSafeInteger(at) && at > 0 && at >= now - WEEK * 1000 && at <= now;
const sessionsFor = (history, profileId, now) => (history?.sessions || []).filter(row =>
  row.profileId === profileId && typeof row.id === "string" && row.id && dated(row.startedAt, now));

// Deliberately not part of State, SessionHistory, backup, or any share/Companion projection.
class PrivateWeekly {
  #notes = new Map();
  #owner = null;
  #token = null;
  #now;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  clear() { this.#notes.clear(); this.#owner = this.#token = null; }
  sync(state) {
    const owners = new Map(state.profiles.map(p => [p.id, ownerOf(p)]));
    const retained = new Set(owners.values());
    for (const owner of this.#notes.keys()) if (!retained.has(owner)) this.#notes.delete(owner);
    const active = owners.get(state.activeProfileId) ?? null;
    if (this.#owner !== active) {
      this.#owner = active;
      this.#token = active ? randomUUID() : null;
    }
  }
  view(state, history) {
    this.sync(state);
    if (!this.#token) return null;
    const profileId = state.activeProfileId, now = this.#now();
    const sessions = sessionsFor(history, profileId, now);
    const current = this.#prune(now);
    const rows = sessions.map(row => ({ source: "observed", kind: "session", at: row.startedAt, sessionId: row.id, minutes: row.minutes, deaths: row.deaths }));
    for (const row of current.values()) rows.push({ ...row });
    // Stable ties keep observed sessions ahead of manual entries at the same instant.
    rows.sort((a, b) => b.at - a.at);
    return { profileId, token: this.#token, rows, limits: { maxText: MAX_TEXT } };
  }
  #prune(now) {
    const current = this.#notes.get(this.#owner) ?? new Map();
    for (const [kind, row] of current) if (!dated(row.at, now)) current.delete(kind);
    return current;
  }
  add(state, history, input) {
    this.sync(state);
    if (!input || !this.#token || input.token !== this.#token) return null;
    const { kind, at, text, sessionId } = input;
    if (!["accomplishment", "correction"].includes(kind) || Object.keys(input).some(key => !["token", "kind", "at", "text", ...(kind === "correction" ? ["sessionId"] : [])].includes(key))) return null;
    const now = this.#now();
    if (!dated(at, now) || typeof text !== "string" || text.length > MAX_TEXT || !text.trim()) return null;
    if (kind === "correction" && !sessionsFor(history, state.activeProfileId, now).some(row => row.id === sessionId && row.startedAt === at)) return null;
    const current = this.#prune(now);
    if (current.has(kind)) return null;
    current.set(kind, { source: "manual", kind, at, text: text.trim(), ...(kind === "correction" ? { sessionId } : {}) });
    this.#notes.set(this.#owner, current);
    return this.view(state, history);
  }
}
module.exports = { PrivateWeekly, ownerOf, dated, sessionsFor };

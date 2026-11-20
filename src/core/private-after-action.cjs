"use strict";
const { randomUUID } = require("node:crypto");
const { dungeonProgression } = require("./dungeon-progression.cjs");
const { ownerOf, dated, sessionsFor } = require("./private-weekly.cjs");

const MAX_TEXT = 280;
const validText = value => typeof value === "string" && value.length <= MAX_TEXT;

function timeline(profile, history, now) {
  const progression = dungeonProgression("dm", profile, [], now);
  const defeats = progression.defeats;
  // Evidence streams are placed in date order, never joined into a run or death explanation.
  const rows = [
    ...sessionsFor(history, profile.id, now).map(({ id, startedAt, minutes, deaths }) =>
      ({ kind: "session", source: "live-link", at: startedAt, sessionId: id, minutes, deaths })),
    ...(defeats?.rows || []).filter(row => dated(row.at * 1000, now)).map(({ name, encounterId, at }) =>
      ({ kind: "defeat", source: "addon-save", at: at * 1000, name, encounterId, captureBuild: defeats.captureBuild })),
  ];
  rows.sort((a, b) => b.at - a.at);
  return { rows, moreDefeats: !!defeats?.moreRetained && rows.filter(row => row.kind === "defeat").length === defeats.rows.length };
}

// App-session-only. Never attach reviews to State, weekly history, or a share DTO.
class PrivateAfterAction {
  #reviews = new Map();
  #owner = null;
  #token = null;
  #now;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  clear() { this.#reviews.clear(); this.#owner = this.#token = null; }
  sync(state) {
    const owners = new Map(state.profiles.map(p => [p.id, ownerOf(p)]));
    const retained = new Set(owners.values());
    for (const owner of this.#reviews.keys()) if (!retained.has(owner)) this.#reviews.delete(owner);
    const active = owners.get(state.activeProfileId) ?? null;
    if (active !== this.#owner) {
      this.#owner = active;
      this.#token = active ? randomUUID() : null;
    }
  }
  view(state, history) {
    this.sync(state);
    if (!this.#token) return null;
    const profile = state.profiles.find(p => p.id === state.activeProfileId);
    const review = this.#reviews.get(this.#owner);
    const scope = JSON.stringify([profile.id, profile.source?.kind, profile.source?.id, profile.source?.updatedAt, profile.clientBuild]);
    return { profileId: profile.id, scope, token: this.#token, ...timeline(profile, history, this.#now()),
      review: review ? { ...review } : null, maxText: MAX_TEXT };
  }
  save(state, history, input) {
    this.sync(state);
    if (!input || !this.#token || input.token !== this.#token || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (input.clear === true && keys.length === 2 && keys.every(key => ["token", "clear"].includes(key))) {
      this.#reviews.delete(this.#owner);
    } else if (keys.length === 3 && keys.every(key => ["token", "note", "improvement"].includes(key)) &&
      validText(input.note) && validText(input.improvement) && input.improvement.trim()) {
      this.#reviews.set(this.#owner, { note: input.note.trim(), improvement: input.improvement.trim() });
    } else return null;
    return this.view(state, history);
  }
}
module.exports = { PrivateAfterAction };

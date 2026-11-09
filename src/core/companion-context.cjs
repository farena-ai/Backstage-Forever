"use strict";
const { object } = require("./memory-data.cjs");
/** One assistant generation, shared by requests, reviewed drafts and local voice. */
class CompanionContext {
  constructor(getState) {
    this.getState = getState;
    this.generation = 0;
    this.view = "other";
    this.listeners = new Set();
    this.profileIds = new Set(getState().profiles.map(p => p.id));
    this.identity = this.key();
  }
  key() {
    const state = this.getState();
    const selected = state.profiles.find(p => p.id === state.activeProfileId);
    return JSON.stringify([state.activeProfileId, state.provider, state.followGameCharacter, selected?.source?.kind, selected?.source?.id]);
  }
  sync() {
    const key = this.key();
    const ids = new Set(this.getState().profiles.map(p => p.id));
    const deleted = [...this.profileIds].some(id => !ids.has(id));
    this.profileIds = ids;
    if (key !== this.identity || deleted) { this.identity = key; this.invalidate("state-context"); }
  }
  invalidate(reason) {
    this.generation++;
    for (const listener of this.listeners) listener({ generation: this.generation, reason });
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(input) {
    object(input, ["profileId", "view"]); this.sync();
    if (input.profileId !== this.getState().activeProfileId || !["ai", "other"].includes(input.view)) throw Error("Choose the current character context.");
    this.view = input.view;
    this.invalidate("renderer-context");
    return this.snapshot();
  }
  snapshot() {
    this.sync();
    return { generation: this.generation, profileId: this.getState().activeProfileId, provider: structuredClone(this.getState().provider), view: this.view };
  }
  isCurrent(token) {
    const current = this.snapshot();
    return token?.generation === current.generation && token.profileId === current.profileId && token.view === current.view && JSON.stringify(token.provider) === JSON.stringify(current.provider);
  }
}
module.exports = { CompanionContext };

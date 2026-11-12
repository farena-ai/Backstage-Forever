"use strict";
// This play session, built from live frames only (memory only; nothing is stored).
// Pace counts only time you are actually playing: gaps between frames longer than a
// minute (alt-tab, AFK, loading) are not counted. Trails keep where you walked per map.
const GAP_MS = 60000, MIN_ACTIVE_MS = 3 * 60000, MOVE = 0.004, MAX_POINTS = 1500, MAX_MAPS = 30, MAX_EVENTS = 200;

class PlaySession {
  constructor({ now = Date.now } = {}) { this.now = now; this.reset(null); }
  reset(key) {
    Object.assign(this, { key, startedAt: null, lastAt: null, activeMs: 0, startProgress: null, progress: null, level: null, startLevel: null, dead: false, deaths: [], levelUps: [], trails: new Map(), zones: new Set() });
  }
  /** Feed the selected character's live frame (or null). Returns the events this frame caused. */
  observe(frame) {
    if (!frame || frame.combat === undefined && !frame.position && !frame.level) return [];
    const key = frame.characterHash ?? null;
    if (key !== this.key) this.reset(key);
    const t = this.now(), events = [];
    if (this.lastAt != null) { const d = t - this.lastAt; if (d > 0 && d <= GAP_MS) this.activeMs += d; }
    if (this.startedAt == null) this.startedAt = t;
    this.lastAt = t;
    const pos = frame.position && Number.isSafeInteger(frame.position.mapId) ? frame.position : null;
    if (Number.isInteger(frame.level) && frame.level > 0) {
      if (this.level != null && frame.level > this.level) {
        const e = { kind: "level", level: frame.level, at: t, ...(pos ? { mapId: pos.mapId, x: pos.x, y: pos.y } : {}) };
        this.levelUps.push(e); events.push(e);
        if (this.levelUps.length > MAX_EVENTS) this.levelUps.shift();
      }
      this.level = frame.level;
      if (this.startLevel == null) this.startLevel = frame.level;
      if (Number.isFinite(frame.xpPercent)) {
        const p = frame.level + Math.min(99.9, Math.max(0, frame.xpPercent)) / 100;
        if (this.startProgress == null) this.startProgress = p;
        this.progress = Math.max(this.progress ?? p, p);
      }
    }
    if (frame.dead && !this.dead) {
      const e = { kind: "death", at: t, ...(pos ? { mapId: pos.mapId, x: pos.x, y: pos.y } : {}) };
      this.deaths.push(e); events.push(e);
      if (this.deaths.length > MAX_EVENTS) this.deaths.shift();
    }
    if (frame.dead !== undefined) this.dead = Boolean(frame.dead);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && !frame.dead) {
      this.zones.add(pos.mapId);
      let trail = this.trails.get(pos.mapId);
      if (!trail) {
        if (this.trails.size >= MAX_MAPS) this.trails.delete(this.trails.keys().next().value);
        trail = []; this.trails.set(pos.mapId, trail);
      }
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last[0] - pos.x, last[1] - pos.y) >= MOVE) {
        trail.push([Math.round(pos.x * 1e4) / 1e4, Math.round(pos.y * 1e4) / 1e4]);
        if (trail.length > MAX_POINTS) trail.splice(0, trail.length - MAX_POINTS);
      }
    }
    return events;
  }
  summary() {
    if (this.startedAt == null) return { active: false };
    const gained = this.progress != null && this.startProgress != null ? this.progress - this.startProgress : 0;
    const hours = this.activeMs / 3600000;
    const perHour = this.activeMs >= MIN_ACTIVE_MS && gained > 0 ? gained / hours : null;
    const left = this.progress != null ? Math.ceil(this.progress + 1e-9) - this.progress : null;
    return {
      active: true, characterHash: this.key,
      activeMinutes: Math.round(this.activeMs / 60000),
      startLevel: this.startLevel, level: this.level,
      levelsGained: Math.round(gained * 100) / 100,
      levelsPerHour: perHour == null ? null : Math.round(perHour * 100) / 100,
      minutesToLevel: perHour && left ? Math.max(1, Math.round((left / perHour) * 60)) : null,
      deaths: this.deaths.length, dead: this.dead,
      levelUps: this.levelUps.map((e) => ({ level: e.level, at: e.at })),
      zones: [...this.zones],
    };
  }
  /** Where you walked on one map this session, with deaths and level-ups there. */
  trail(mapId) {
    const id = Number(mapId);
    return {
      mapId: id, points: (this.trails.get(id) || []).slice(),
      deaths: this.deaths.filter((e) => e.mapId === id).map(({ x, y, at }) => ({ x, y, at })),
      levelUps: this.levelUps.filter((e) => e.mapId === id).map(({ x, y, at, level }) => ({ x, y, at, level })),
    };
  }
}
module.exports = { PlaySession, GAP_MS, MIN_ACTIVE_MS };

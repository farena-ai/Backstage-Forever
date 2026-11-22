"use strict";
// The Journey's own small memory, journey.json in the app's data folder. Four things the game's
// saved file cannot give:
//  - where a character died (zone and time), noted from the live link as it happens;
//  - the capture before the newest one, so Coach's notes can say what changed since;
//  - leveling race codes friends gave you, and the display name you typed for your own;
//  - whether the stream overlay is switched on, and the port it last used.
// Everything is bounded and re-validated on load. Nothing here leaves this computer.
const fs = require("node:fs");
const LIMITS = Object.freeze({ deaths: 400, profiles: 100, friends: 12, name: 24 });
const MAX_MS = 253402300799000, ID = 2147483647;
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const profileKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 100 && k !== "__proto__" && k !== "constructor" && k !== "prototype";
const isoTime = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));

function cleanDeath(d) {
  if (!plain(d) || !int(d.at, 1, MAX_MS)) return null;
  return { at: d.at, ...(int(d.mapId, 1, ID) ? { mapId: d.mapId } : {}), ...(int(d.tip, 1, 5) ? { tip: d.tip } : {}),
    ...(typeof d.killer === "string" && d.killer.trim() && d.killer.length <= 80 && !/[\x00-\x1f\x7f]/.test(d.killer) ? { killer: d.killer } : {}) };
}
/** What Coach's notes remember about one capture: enough to say what changed, nothing more. */
function captureOf(profile) {
  const savedAt = profile?.source?.kind === "wow-addon" && isoTime(profile.source.updatedAt) ? profile.source.updatedAt : null;
  if (!savedAt) return null;
  const known = profile.history?.completedIdsKnown === true && Array.isArray(profile.history.completedIds);
  return { savedAt, level: int(profile.level, 1, 100) ? profile.level : null, played: int(profile.journal?.played, 0, 1e10) ? profile.journal.played : null,
    quests: known ? profile.history.completedIds.length : null, money: int(profile.ledger?.money, 0, 1e13) ? profile.ledger.money : null };
}
function cleanCapture(c) {
  if (!plain(c) || !isoTime(c.savedAt)) return null;
  return { savedAt: c.savedAt, level: int(c.level, 1, 100) ? c.level : null, played: int(c.played, 0, 1e10) ? c.played : null,
    quests: int(c.quests, 0, 1e6) ? c.quests : null, money: int(c.money, 0, 1e13) ? c.money : null };
}
const emptyData = () => ({ version: 1, deaths: {}, captures: {}, race: { name: "", friends: [] }, overlay: { enabled: false, port: null } });

/** Any earlier or damaged file -> the current shape; a bad entry never costs the rest. */
function migrate(raw, { validFriend = () => null } = {}) {
  const out = emptyData();
  if (!plain(raw)) return out;
  if (plain(raw.deaths)) for (const [id, rows] of Object.entries(raw.deaths).slice(0, LIMITS.profiles)) {
    if (!profileKey(id) || !Array.isArray(rows)) continue;
    const list = rows.map(cleanDeath).filter(Boolean).sort((a, b) => a.at - b.at).slice(-LIMITS.deaths);
    if (list.length) out.deaths[id] = list;
  }
  if (plain(raw.captures)) for (const [id, pair] of Object.entries(raw.captures).slice(0, LIMITS.profiles)) {
    if (!profileKey(id) || !plain(pair)) continue;
    const current = cleanCapture(pair.current), previous = cleanCapture(pair.previous);
    if (current) out.captures[id] = { current, previous: previous && Date.parse(previous.savedAt) < Date.parse(current.savedAt) ? previous : null };
  }
  if (plain(raw.race)) {
    if (typeof raw.race.name === "string") out.race.name = raw.race.name.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, LIMITS.name);
    const seen = new Set();
    for (const code of Array.isArray(raw.race.friends) ? raw.race.friends : []) {
      const friend = typeof code === "string" ? validFriend(code) : null;
      if (!friend || seen.has(friend.id) || out.race.friends.length >= LIMITS.friends) continue;
      seen.add(friend.id); out.race.friends.push(code);
    }
  }
  if (plain(raw.overlay)) {
    out.overlay.enabled = raw.overlay.enabled === true;
    out.overlay.port = int(raw.overlay.port, 1024, 65535) ? raw.overlay.port : null;
  }
  return out;
}

class JourneyStore {
  constructor({ file = null, validFriend = () => null, write = (f, text) => require("./store.cjs").atomic(f, text) } = {}) {
    Object.assign(this, { file, write, validFriend, data: emptyData(), saved: "" });
    try { this.data = migrate(JSON.parse(fs.readFileSync(file, "utf8")), { validFriend }); this.saved = JSON.stringify(this.data); } catch { /* No file yet, or unreadable: start empty. */ }
  }
  #save() {
    const text = JSON.stringify(this.data);
    if (text === this.saved || !this.file) return false;
    try { this.write(this.file, text); this.saved = text; return true; } catch { return false; }
  }
  /** A death seen over the live link: the zone and the moment, once per death. */
  recordDeath(profileId, death) {
    const row = cleanDeath(death);
    if (!profileKey(profileId) || !row) return false;
    const list = this.data.deaths[profileId] || [];
    if (list.some((d) => Math.abs(d.at - row.at) < 20000)) return false;
    this.data.deaths[profileId] = [...list, row].sort((a, b) => a.at - b.at).slice(-LIMITS.deaths);
    return this.#save();
  }
  /** The addon's death review arrives a moment after the death: add the cause to that death. */
  annotateDeath(profileId, at, { tip = null, killer = null } = {}) {
    const row = (this.data.deaths[profileId] || []).find((d) => Math.abs(d.at - at) < 20000);
    if (!row) return false;
    const next = cleanDeath({ ...row, ...(tip ? { tip } : {}), ...(killer ? { killer } : {}) });
    if (!next) return false;
    Object.assign(row, next);
    return this.#save();
  }
  deaths(profileId) { return (this.data.deaths[profileId] || []).map((d) => ({ ...d })); }
  /**
   * Called when saved characters change. A character whose capture is newer than the one kept
   * moves that one to "previous". Deleted characters take their notes with them.
   */
  absorb(state) {
    const profiles = state?.profiles || [], ids = new Set(profiles.map((p) => p.id));
    for (const part of ["deaths", "captures"]) for (const id of Object.keys(this.data[part])) if (!ids.has(id)) delete this.data[part][id];
    for (const p of profiles) {
      if (!profileKey(p?.id)) continue;
      const now = captureOf(p), kept = this.data.captures[p.id];
      if (!now) continue;
      if (!kept) this.data.captures[p.id] = { current: now, previous: null };
      else if (Date.parse(now.savedAt) > Date.parse(kept.current.savedAt)) this.data.captures[p.id] = { current: now, previous: kept.current };
    }
    return this.#save();
  }
  captures(profileId) { const c = this.data.captures[profileId]; return c ? structuredClone(c) : { current: null, previous: null }; }
  setRaceName(name) {
    if (typeof name !== "string" || /[\x00-\x1f\x7f]/.test(name) || name.trim().length > LIMITS.name) throw Error("Use a name of at most 24 characters.");
    this.data.race.name = name.trim(); this.#save();
    return this.data.race.name;
  }
  addFriend(code) {
    const friend = this.validFriend(code);
    if (!friend) throw Error("That is not a leveling race code.");
    const known = this.data.race.friends.map((c) => this.validFriend(c)?.id);
    if (known.includes(friend.id)) return false;
    if (this.data.race.friends.length >= LIMITS.friends) throw Error(`The board holds at most ${LIMITS.friends} friends. Remove one first.`);
    this.data.race.friends.push(code); this.#save();
    return true;
  }
  removeFriend(id) {
    const before = this.data.race.friends.length;
    this.data.race.friends = this.data.race.friends.filter((c) => this.validFriend(c)?.id !== id);
    this.#save();
    return this.data.race.friends.length !== before;
  }
  setOverlay({ enabled, port }) {
    if (typeof enabled === "boolean") this.data.overlay.enabled = enabled;
    if (port === null || int(port, 1024, 65535)) this.data.overlay.port = port;
    this.#save();
    return { ...this.data.overlay };
  }
  /** Delete all local data. */
  clear() { this.data = emptyData(); this.#save(); }
}
module.exports = { JourneyStore, LIMITS, migrate, captureOf, cleanDeath };

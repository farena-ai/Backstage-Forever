"use strict";
// Saved talent builds per character (roadmap C1). Kept in its own small file in the app data
// folder (talent-builds.json), never sent anywhere. Each build is the ordered list of talent ids
// plus the names of those talents as the player's own game files gave them when the build was
// saved, so the desktop -> game hand-off can name the next point without reading the game again.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const { MAX_POINTS, CLASS_CODES } = require("./talent-planner.cjs");
const MAX_PROFILES = 100, MAX_BUILDS = 20, MAX_NAME = 40, MAX_LABEL = 60;
const profileKey = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;
const buildId = (v) => typeof v === "string" && /^[a-z0-9]{6,16}$/.test(v);
const label = (v, max = MAX_LABEL) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const talentId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const cleanName = (v) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim() : "");

function cleanBuild(raw) {
  if (!raw || typeof raw !== "object" || !buildId(raw.id) || !label(raw.name, MAX_NAME) || !Object.hasOwn(CLASS_CODES, raw.className)) return null;
  if (!Array.isArray(raw.order) || !raw.order.length || raw.order.length > MAX_POINTS || !raw.order.every(talentId)) return null;
  const names = {};
  for (const id of new Set(raw.order)) {
    const n = raw.names?.[id];
    if (!Array.isArray(n) || !label(n[0]) || !label(n[1]) || !Number.isInteger(n[2]) || n[2] < 1 || n[2] > 9) return null;
    names[id] = [n[0], n[1], n[2]];
  }
  return { id: raw.id, name: raw.name, className: raw.className, order: [...raw.order], names };
}
function normalize(raw) {
  const out = {};
  const profiles = raw && raw.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
  for (const [k, row] of Object.entries(profiles).slice(0, MAX_PROFILES)) {
    if (!profileKey(k) || !row || typeof row !== "object" || !Array.isArray(row.builds)) continue;
    const builds = [], seen = new Set();
    for (const b of row.builds.slice(0, MAX_BUILDS)) { const c = cleanBuild(b); if (c && !seen.has(c.id)) { seen.add(c.id); builds.push(c); } }
    if (builds.length) out[k] = { active: seen.has(row.active) ? row.active : null, builds };
  }
  return out;
}
class TalentBuilds {
  constructor(dir, { newId = () => require("node:crypto").randomBytes(5).toString("hex") } = {}) {
    this.file = path.join(dir, "talent-builds.json");
    this.newId = newId;
    try { this.profiles = normalize(JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch { this.profiles = {}; }
  }
  list(profileId) {
    const row = profileKey(profileId) ? this.profiles[profileId] : null;
    return { active: row?.active || null, builds: (row?.builds || []).map((b) => ({ ...b, order: [...b.order], names: structuredClone(b.names) })) };
  }
  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomic(this.file, JSON.stringify({ schemaVersion: 1, profiles: this.profiles }) + "\n");
  }
  // Adds a build, or replaces the one with the same id. A second build with the same name and
  // class is refused so the list stays readable.
  save(profileId, input) {
    if (!profileKey(profileId)) throw Error("Choose a character first.");
    const name = cleanName(input?.name);
    if (!name) throw Error("Give the build a name first.");
    const row = this.profiles[profileId] || { active: null, builds: [] };
    const existing = buildId(input?.id) ? row.builds.find((b) => b.id === input.id) : null;
    const build = cleanBuild({ ...input, name, id: existing ? existing.id : this.newId() });
    if (!build) throw Error("This build cannot be saved.");
    if (row.builds.some((b) => b !== existing && b.className === build.className && b.name.toLowerCase() === name.toLowerCase())) throw Error(`You already have a build named "${name}". Pick another name.`);
    if (!existing && row.builds.length >= MAX_BUILDS) throw Error(`A character holds up to ${MAX_BUILDS} builds. Delete one first.`);
    if (!this.profiles[profileId] && Object.keys(this.profiles).length >= MAX_PROFILES) throw Error("Too many characters have saved builds.");
    if (existing) row.builds[row.builds.indexOf(existing)] = build; else row.builds.push(build);
    this.profiles[profileId] = row;
    this.write();
    return build.id;
  }
  remove(profileId, id) {
    const row = profileKey(profileId) ? this.profiles[profileId] : null;
    if (!row || !row.builds.some((b) => b.id === id)) throw Error("That build is no longer saved.");
    row.builds = row.builds.filter((b) => b.id !== id);
    if (row.active === id) row.active = null;
    if (!row.builds.length) delete this.profiles[profileId];
    this.write();
  }
  // The one build per character the game is told about. null switches the hand-off off.
  activate(profileId, id) {
    const row = profileKey(profileId) ? this.profiles[profileId] : null;
    if (id !== null && (!row || !row.builds.some((b) => b.id === id))) throw Error("That build is no longer saved.");
    if (!row) return;
    row.active = id;
    this.write();
  }
  // What the game is handed for this character: the active build when it fits the class.
  handoff(profileId, className) {
    const row = profileKey(profileId) ? this.profiles[profileId] : null;
    const b = row?.active ? row.builds.find((x) => x.id === row.active) : null;
    if (!b || b.className !== className) return null;
    return { name: b.name, picks: b.order.map((id) => ({ name: b.names[id][0], tab: b.names[id][1], maxRank: b.names[id][2] })) };
  }
  clear() { this.profiles = {}; try { fs.rmSync(this.file, { force: true }); } catch {} }
}
module.exports = { TalentBuilds, MAX_BUILDS, MAX_NAME, cleanName };

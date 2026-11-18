"use strict";
// Journey journal from the addon: levels reached (with /played seconds), first-time moments and
// zones visited. Bounded and validated; an invalid block is dropped without touching the rest.
const FIRSTS = ["dungeon", "flight", "mount", "death", "rested", "group", "hearth"];
const LIMITS = { levels: 80, firsts: 40, zones: 120, givers: 400, encounters: 100 };
const fail = () => { throw Error("Invalid journal."); };
const int = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : fail());
const MAX_T = 253402300799;
const arr = (v, n) => (v === undefined ? [] : Array.isArray(v) && v.length <= n ? v : fail());

function normalizeEncounterHistory(value) {
  const rows = [], seen = new Set();
  for (const e of arr(value, LIMITS.encounters)) {
    if (!e || typeof e !== "object" || Array.isArray(e)) fail();
    const { name, instanceType } = e;
    if (typeof name !== "string" || Buffer.byteLength(name) > 120 || !name.trim() || /[\x00-\x1f\x7f]/.test(name)) fail();
    if (instanceType !== "party" && instanceType !== "raid") fail();
    const encounterId = int(e.encounterId, 1, 2147483647), instanceMap = int(e.instanceMap, 1, 2147483647);
    const difficultyId = int(e.difficultyId, 0, 2147483647), at = int(e.at, 1, MAX_T);
    const key = `${instanceMap}:${instanceType}:${encounterId}:${difficultyId}:${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ encounterId, name, instanceMap, instanceType, difficultyId, at });
  }
  return rows;
}

function normalizeJournalCapture(j, { ignoreInvalidEncounters = false } = {}) {
  if (!j || typeof j !== "object" || Array.isArray(j)) fail();
  const levels = [], seen = new Set();
  for (const e of arr(j.levels, LIMITS.levels)) {
    if (!e || typeof e !== "object") fail();
    const level = int(e.level, 1, 1000);
    if (seen.has(level)) continue; seen.add(level);
    levels.push({ level, at: int(e.at, 0, MAX_T), ...(e.played === undefined || e.played === null ? {} : { played: int(e.played, 0, 1e10) }) });
  }
  levels.sort((a, b) => a.level - b.level);
  const firsts = [], keys = new Set();
  for (const f of arr(j.firsts, LIMITS.firsts)) {
    if (!f || typeof f !== "object" || !FIRSTS.includes(f.key)) fail();
    if (keys.has(f.key)) continue; keys.add(f.key);
    firsts.push({ key: f.key, at: int(f.at, 0, MAX_T) });
  }
  const zones = [...new Set(arr(j.zones, LIMITS.zones).map((z) => int(z, 1, 2147483647)))];
  // 1.4 (J14): where this character stood when it accepted each quest, and from whom.
  const givers = [], quests = new Set();
  const frac = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : fail());
  for (const g of arr(j.givers, LIMITS.givers)) {
    if (!g || typeof g !== "object" || Array.isArray(g)) fail();
    const q = int(g.q, 1, 2147483647);
    if (quests.has(q)) continue; quests.add(q);
    givers.push({ q, n: int(g.n, 1, 2147483647), m: int(g.m, 1, 2147483647), x: frac(g.x), y: frac(g.y), at: int(g.at, 0, MAX_T) });
  }
  let encounters = [];
  try { encounters = normalizeEncounterHistory(j.encounters); }
  catch (error) { if (!ignoreInvalidEncounters) throw error; }
  return { levels, firsts, zones, ...(givers.length ? { givers } : {}), ...(encounters.length ? { encounters } : {}), ...(j.played === undefined || j.played === null ? {} : { played: int(j.played, 0, 1e10) }) };
}
// Stored profiles are re-validated with the same rules.
const validateJournal = (j) => { if (j !== undefined) normalizeJournalCapture(j); };

/** Speed splits: /played time per level, with this character's best and the best across characters. */
function splits(profile, others = []) {
  const lv = (profile?.journal?.levels || []).filter((e) => Number.isFinite(e.played));
  const rows = [];
  for (let i = 1; i < lv.length; i++) if (lv[i].level === lv[i - 1].level + 1 && lv[i].played > lv[i - 1].played) rows.push({ level: lv[i - 1].level, seconds: lv[i].played - lv[i - 1].played });
  const best = new Map();
  for (const p of [profile, ...others]) {
    const l = (p?.journal?.levels || []).filter((e) => Number.isFinite(e.played));
    for (let i = 1; i < l.length; i++) if (l[i].level === l[i - 1].level + 1 && l[i].played > l[i - 1].played) {
      const s = l[i].played - l[i - 1].played, k = l[i - 1].level;
      if (!best.has(k) || s < best.get(k).seconds) best.set(k, { seconds: s, name: p.name });
    }
  }
  return rows.map((r) => ({ ...r, best: best.get(r.level) || null, personalBest: best.get(r.level)?.name === profile.name && best.get(r.level)?.seconds === r.seconds }));
}
module.exports = { normalizeJournalCapture, normalizeEncounterHistory, validateJournal, splits, FIRSTS, LIMITS };

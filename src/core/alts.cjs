"use strict";
// Characters → All characters (0.43, roadmap 3.7): every character at a glance (level, XP,
// rested experience grown since the last save, gold, bag space, professions) and "who to play
// tonight". Read-only and pure: everything comes from the saved profiles.
const MAX_LEVEL = 60;
const HOUR = 3600;
// Offline rest: 5% of a level every 8 hours in an inn or city, a quarter of that elsewhere, up to 150%.
const INN_PER_HOUR = 0.05 / 8, OUTSIDE_PER_HOUR = INN_PER_HOUR / 4, CAP = 1.5;

const fin = (v) => (Number.isFinite(v) ? v : null);
const savedAt = (p) => { const t = Date.parse(p?.source?.updatedAt || ""); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };

/** Rested XP now, grown from the saved amount; null at max level or without XP data. */
function restedNow(profile, now) {
  const pr = profile?.progress, level = profile?.level;
  if (!pr || !(pr.max > 0) || !(level < MAX_LEVEL)) return null;
  const base = fin(pr.rested) ?? 0, at = savedAt(profile);
  const hours = at && now > at ? (now - at) / HOUR : 0;
  const grow = (rate) => Math.min(pr.max * CAP, base + rate * hours * pr.max);
  const pct = (xp) => Math.round((xp / pr.max) * 100);
  const known = typeof pr.resting === "boolean";
  const xp = Math.round(grow(pr.resting === false ? OUTSIDE_PER_HOUR : INN_PER_HOUR));
  const low = known ? xp : Math.round(grow(OUTSIDE_PER_HOUR));
  return { xp, percent: pct(xp), lowPercent: pct(low), known, resting: known ? pr.resting : null, full: pct(xp) >= CAP * 100, capPercent: CAP * 100 };
}

function professionsOf(p) {
  const items = p?.readiness?.workshop?.professions?.items;
  return Array.isArray(items) ? items.filter((x) => x && typeof x.name === "string").map((x) => ({ name: x.name, rank: x.rank, maxRank: x.maxRank })) : [];
}

function card(p, now, activeId) {
  const bags = p?.readiness?.bags?.total > 0 ? { free: p.readiness.bags.free, total: p.readiness.bags.total } : null;
  const at = savedAt(p);
  return {
    profileId: p.id, name: p.name, realm: p.realm || "", faction: p.faction || null, className: p.className || null, race: p.race || null,
    level: fin(p.level), active: p.id === activeId,
    xp: p.progress?.max > 0 ? { current: p.progress.current, max: p.progress.max, percent: Math.floor((p.progress.current / p.progress.max) * 100) } : null,
    rested: restedNow(p, now), money: Number.isSafeInteger(p.ledger?.money) ? p.ledger.money : null, bags,
    professions: professionsOf(p), zone: p.location?.zone || null, savedAt: at, daysAway: at ? Math.floor(Math.max(0, now - at) / 86400) : null,
  };
}

/** Pure: one plain-words reason per character, scored; the best first. */
function suggestions(cards) {
  const out = [];
  for (const c of cards) {
    if (c.level === null) continue;
    let score = 0; const why = [];
    if (c.rested && c.level < MAX_LEVEL) {
      if (c.rested.full) { score += 60; why.push(`rested XP is full (${c.rested.capPercent}% of a level), so every hour away is wasted`); }
      else if (c.rested.percent >= 50) { score += 20 + c.rested.percent / 5; why.push(`${c.rested.percent}% of a level in rested XP: double experience until it runs out`); }
    }
    if ((c.level === 38 || c.level === 39) && c.level < MAX_LEVEL) { score += 25; why.push(`${40 - c.level === 1 ? "one level" : "two levels"} from 40 and riding`); }
    if (c.level === 59) { score += 25; why.push("one level from 60"); }
    if (c.bags && c.bags.free <= 3) { score -= 5; why.push(`only ${c.bags.free} free bag slot${c.bags.free === 1 ? "" : "s"}: empty your bags first`); }
    if (c.daysAway !== null && c.daysAway >= 14) { score += 10; why.push(`not played for ${c.daysAway} days`); }
    if (c.level >= MAX_LEVEL) score -= 20;
    if (why.length && score > 0) out.push({ profileId: c.profileId, name: c.name, score: Math.round(score), reasons: why });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3);
}

function altsView(state, { now = Math.floor(Date.now() / 1000) } = {}) {
  const profiles = (state?.profiles || []).filter((p) => p && p.id);
  const cards = profiles.map((p) => card(p, now, state?.activeProfileId))
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
  const money = cards.reduce((s, c) => s + (c.money || 0), 0);
  return { now, cards, tonight: suggestions(cards), totals: { characters: cards.length, money, maxLevel: cards.filter((c) => c.level >= MAX_LEVEL).length } };
}

module.exports = { altsView, restedNow, suggestions, MAX_LEVEL };

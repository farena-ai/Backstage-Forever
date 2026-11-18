"use strict";
// 1.4: the weekly recap (J17) and reminders across your characters (J18). Pure, from saved data
// (journal, ledger, badges) and this computer's session history.
const { badgesFor } = require("./badges.cjs");
const { cooldownStatus } = require("./ledger.cjs");
const { altsView } = require("./alts.cjs");
const WEEK = 7 * 86400, MAX_LEVEL = 60;

/** One character's last seven days. history: SessionHistory.view(profileId) or null. */
function recapFor(p, history, now) {
  const start = now - WEEK;
  const levels = (p?.journal?.levels || []).filter((l) => l.at >= start);
  const all = (p?.journal?.levels || []).filter((l) => Number.isFinite(l.played));
  let best = null;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (b.level === a.level + 1 && b.played > a.played && b.at >= start && (!best || b.played - a.played < best.seconds)) best = { level: a.level, seconds: b.played - a.played };
  }
  const book = badgesFor(p);
  const levelBadge = (b) => { const m = /^level-(\d+)$/.exec(b.id); return m && levels.some((l) => l.level === Number(m[1])); };
  const badges = book.badges.filter((b) => b.earned && ((b.at && b.at >= start) || levelBadge(b))).map((b) => ({ id: b.id, name: b.name }));
  const log = (p?.ledger?.moneyLog || []).filter(([, at]) => at <= now);
  const before = [...log].reverse().find(([, at]) => at <= start) || log.find(([, at]) => at >= start) || null;
  const money = Number.isSafeInteger(p?.ledger?.money) ? p.ledger.money : null;
  const gold = before && money !== null ? money - before[0] : null;
  const sessions = (history?.sessions || []).filter((s) => s.startedAt >= start * 1000);
  return { profileId: p.id, name: p.name, level: Number(p.level) || null, levelsGained: levels.length, badges, gold, bestSplit: best,
    minutes: sessions.reduce((t, s) => t + (s.minutes || 0), 0), deaths: sessions.reduce((t, s) => t + (s.deaths || 0), 0), sessions: sessions.length,
    played: levels.length > 0 || sessions.length > 0 || badges.length > 0 };
}
function weeklyRecap(state, { history = () => null, now = Math.floor(Date.now() / 1000) } = {}) {
  const profiles = (state?.profiles || []).filter((p) => p && p.id);
  const rows = profiles.map((p) => recapFor(p, history(p.id), now));
  const active = rows.find((r) => r.profileId === state?.activeProfileId) || null;
  const played = rows.filter((r) => r.played);
  return { from: now - WEEK, to: now, active, characters: played,
    totals: { levels: played.reduce((t, r) => t + r.levelsGained, 0), badges: played.reduce((t, r) => t + r.badges.length, 0), minutes: played.reduce((t, r) => t + r.minutes, 0), deaths: played.reduce((t, r) => t + r.deaths, 0) } };
}
/** Reminders worth a glance: full rested XP, ready cooldowns, mail about to expire, a reached gold goal. */
function reminders(state, { now = Math.floor(Date.now() / 1000) } = {}) {
  const out = [];
  const alts = altsView(state, { now });
  for (const c of alts.cards) if (c.rested?.full && (c.level ?? 0) < MAX_LEVEL) out.push({ kind: "rested", profileId: c.profileId, name: c.name, text: `${c.name}'s rested XP is full: play them for double kill XP.` });
  for (const p of state?.profiles || []) {
    for (const cd of cooldownStatus(p, now)) if (cd.ready) out.push({ kind: "cooldown", profileId: p.id, name: p.name, text: `${p.name}: ${cd.name} (${cd.profession}) is ready.` });
    const mail = p?.ledger?.mail;
    if (mail?.expiresAt && mail.expiresAt > now && mail.expiresAt - now <= 3 * 86400) {
      const days = Math.max(1, Math.ceil((mail.expiresAt - now) / 86400));
      out.push({ kind: "mail", profileId: p.id, name: p.name, text: `${p.name}: mail expires in ${days} day${days === 1 ? "" : "s"}. Visit a mailbox.` });
    }
  }
  const goal = state?.goldGoal;
  if (goal) {
    const have = (state.profiles || []).reduce((t, p) => t + (Number.isSafeInteger(p?.ledger?.money) ? p.ledger.money : 0), 0);
    if (have >= goal.copper) out.push({ kind: "goal", profileId: null, name: null, text: `Gold goal reached${goal.label ? `: ${goal.label}` : ""}.` });
  }
  const order = { rested: 0, cooldown: 1, mail: 2, goal: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || String(a.name).localeCompare(String(b.name))).slice(0, 8);
}
module.exports = { weeklyRecap, recapFor, reminders, WEEK };

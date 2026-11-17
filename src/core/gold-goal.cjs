"use strict";
// Gold goal (0.36, E4): a gold target the player sets themselves (for example their riding
// training and first mount), with progress from the ledger's gold across every character and,
// when the addon has seen gold on at least two days, an estimate from the recent daily gold log.
// The bundled reference has no trainer or mount prices; since 1.3 (J11) the app suggests a
// riding-and-mount target only from prices your own characters saw in game. Stored in the app state as `goldGoal`; never shared or sent to an AI.
const MAX_GOLD = 10000000, COPPER = 10000, DAY = 86400, WINDOW_DAYS = 14;
const fail = () => { throw Error("Invalid gold goal."); };

/** Stored goal shape: { copper, label?, setAt }. Throws when invalid. */
function validateGoldGoal(g) {
  if (g === undefined) return;
  if (!g || typeof g !== "object" || Array.isArray(g) || Object.keys(g).some((k) => !["copper", "label", "setAt"].includes(k))) fail();
  if (!Number.isSafeInteger(g.copper) || g.copper < COPPER || g.copper > MAX_GOLD * COPPER || g.copper % COPPER) fail();
  if (g.label !== undefined && (typeof g.label !== "string" || !g.label.trim() || g.label.length > 60 || /[\x00-\x1f\x7f]/.test(g.label))) fail();
  if (!Number.isSafeInteger(g.setAt) || g.setAt < 0 || g.setAt > 253402300799) fail();
}
/** Player input { gold, label } -> a stored goal; null clears it. */
function goalFromInput(input, now = Math.floor(Date.now() / 1000)) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["gold", "label"].includes(k))) fail();
  const gold = input.gold;
  if (!Number.isSafeInteger(gold) || gold < 1 || gold > MAX_GOLD) fail();
  const label = typeof input.label === "string" ? input.label.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 60) : "";
  if (input.label !== undefined && typeof input.label !== "string") fail();
  const goal = { copper: gold * COPPER, ...(label ? { label } : {}), setAt: now };
  validateGoldGoal(goal);
  return goal;
}

// Each character's gold samples, oldest first: the daily log plus the latest saved gold.
function samples(p) {
  const out = (p.ledger?.moneyLog || []).map(([copper, at]) => ({ copper, at }));
  if (Number.isSafeInteger(p.ledger?.money) && Number.isSafeInteger(p.ledger?.moneyAt) && !out.some((s) => s.at === p.ledger.moneyAt)) out.push({ copper: p.ledger.money, at: p.ledger.moneyAt });
  return out.sort((a, b) => a.at - b.at);
}
/**
 * Account gold per day over the last WINDOW_DAYS: each character counts its last sample at or
 * before the moment (or its first one before it was seen), so gold mailed between your own
 * characters cancels out. null when fewer than one full day of history exists.
 */
function recentRate(profiles, now = Math.floor(Date.now() / 1000)) {
  const series = profiles.map(samples).filter((s) => s.length);
  if (!series.some((s) => s.length >= 2)) return null;
  const all = series.flat().map((s) => s.at);
  const end = Math.max(...all), start = Math.max(Math.min(...all), now - WINDOW_DAYS * DAY);
  if (end - start < DAY) return null;
  const total = (t) => series.reduce((sum, s) => { let v = s[0].copper; for (const x of s) if (x.at <= t) v = x.copper; return sum + v; }, 0);
  const days = (end - start) / DAY, gained = total(end) - total(start);
  return { perDay: Math.round(gained / days), days: Math.round(days * 10) / 10, gained, from: start, to: end };
}
// 1.3 (J11): a riding-and-mount target from prices this account's characters saw in game:
// the riding trainer's window and a vendor's mounts. Cheapest first-riding skill plus the
// cheapest mount; null until both were seen.
function mountSuggestion(profiles) {
  let riding = null, mount = null;
  for (const p of profiles || []) {
    for (const s of p?.ledger?.riding?.services || []) if (s.cost > 0 && (!riding || s.cost < riding.cost || (s.cost === riding.cost && s.level < riding.level))) riding = { ...s, by: p.name, seenAt: p.ledger.riding.seenAt };
    for (const m of p?.ledger?.mounts?.items || []) if (m.cost > 0 && (!mount || m.cost < mount.cost)) mount = { ...m, by: p.name, seenAt: p.ledger.mounts.seenAt };
  }
  if (!riding && !mount) return null;
  const total = (riding?.cost || 0) + (mount?.cost || 0);
  return { riding, mount, copper: total, gold: Math.ceil(total / COPPER), complete: Boolean(riding && mount) };
}
/** Everything the gold goal card shows. */
function goldGoalView(state, { now = Math.floor(Date.now() / 1000) } = {}) {
  const goal = state?.goldGoal || null;
  const profiles = (state?.profiles || []).filter((p) => p?.ledger && Number.isSafeInteger(p.ledger.money));
  const have = profiles.reduce((n, p) => n + p.ledger.money, 0);
  const active = profiles.find((p) => p.id === state?.activeProfileId) || null;
  const rate = recentRate(profiles, now);
  const base = { goal, have, mountSuggestion: mountSuggestion(state?.profiles), characters: profiles.length, activeMoney: active ? active.ledger.money : null, activeName: active?.name || null, rate,
    // What the bundled reference knows about riding and mount costs: nothing, so the player sets the target.
    referenceCosts: false };
  if (!goal) return base;
  const left = Math.max(0, goal.copper - have);
  const days = left === 0 ? 0 : rate && rate.perDay > 0 ? Math.ceil(left / rate.perDay) : null;
  return { ...base, left, progress: Math.min(1, have / goal.copper), reached: left === 0, daysLeft: days };
}
module.exports = { mountSuggestion, validateGoldGoal, goalFromInput, recentRate, goldGoalView, MAX_GOLD };

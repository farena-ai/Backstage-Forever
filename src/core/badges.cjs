"use strict";
// Badges: milestones a character has earned, from its own saved data. Each badge says plainly
// what it's for and, when locked, what's left to earn it.
const { splits } = require("./journal-data.cjs");

const BADGES = [
  ...[10, 20, 30, 40, 50, 60].map((n) => ({ id: `level-${n}`, group: "Levels", name: `Level ${n}`, how: `Reach level ${n}.`, test: (c) => ({ done: c.level >= n, have: c.level, need: n }) })),
  ...[[25, "Errand runner"], [100, "Quest hero"], [500, "Living legend"]].map(([n, name]) => ({ id: `quests-${n}`, group: "Quests", name, how: `Complete ${n} quests.`, test: (c) => ({ done: c.quests >= n, have: c.quests, need: n }) })),
  ...[[5, "Wanderer"], [15, "Pathfinder"], [30, "World explorer"]].map(([n, name]) => ({ id: `explorer-${n}`, group: "Exploring", name, how: `Visit ${n} zones.`, test: (c) => ({ done: c.zones >= n, have: c.zones, need: n }) })),
  { id: "first-dungeon", group: "Firsts", name: "Into the depths", how: "Enter your first dungeon.", test: (c) => ({ done: c.firsts.has("dungeon") }) },
  { id: "first-flight", group: "Firsts", name: "Taking wing", how: "Take your first flight.", test: (c) => ({ done: c.firsts.has("flight") }) },
  { id: "first-mount", group: "Firsts", name: "Saddle up", how: "Ride your own mount.", test: (c) => ({ done: c.firsts.has("mount") }) },
  { id: "first-group", group: "Firsts", name: "Better together", how: "Join a group.", test: (c) => ({ done: c.firsts.has("group") }) },
  { id: "first-hearth", group: "Firsts", name: "Home again", how: "Use your Hearthstone.", test: (c) => ({ done: c.firsts.has("hearth") }) },
  { id: "first-rested", group: "Firsts", name: "Well rested", how: "Earn a rested bonus by logging out in an inn or city.", test: (c) => ({ done: c.firsts.has("rested") }) },
  { id: "first-death", group: "Firsts", name: "Back from the dead", how: "Die once (it happens to everyone) and run back.", test: (c) => ({ done: c.firsts.has("death") }) },
  { id: "speed", group: "Speed", name: "Fast learner", how: "Gain a level in under one hour of play.", test: (c) => ({ done: c.fastest !== null && c.fastest < 3600 }) },
  // 1.1: professions, gold and reputation, from the same saves.
  ...[[75, "Apprentice"], [150, "Journeyman"], [225, "Expert"], [300, "Artisan"]].map(([n, name]) => ({ id: `profession-${n}`, group: "Professions", name, how: `Reach skill ${n} in any profession.`, test: (c) => ({ done: c.profession >= n, have: c.profession, need: n }) })),
  ...[[10, "Pocket money"], [100, "Mount money"], [1000, "Gold baron"]].map(([n, name]) => ({ id: `gold-${n}`, group: "Gold", name, how: `Carry ${n} gold at once.`, test: (c) => ({ done: c.gold >= n, have: Math.floor(c.gold), need: n }) })),
  ...[[6, "rep-honored", "Good friends", "Honored"], [7, "rep-revered", "Trusted ally", "Revered"], [8, "rep-exalted", "Exalted", "Exalted"]].map(([n, id, name, word]) => ({ id, group: "Reputation", name, how: `Reach ${word} with any faction.`, test: (c) => ({ done: c.standing >= n }) })),
];
const GROUPS = Object.freeze(["Levels", "Quests", "Exploring", "Firsts", "Speed", "Professions", "Gold", "Reputation"]);

// Account badges: earned across all your characters together.
const ACCOUNT_BADGES = [
  ...[[2, "Growing family"], [5, "Full house"], [10, "A whole guild of me"]].map(([n, name]) => ({ id: `account-${n}`, name, how: `Play ${n} characters with the addon on.`, test: (a) => ({ done: a.characters >= n, have: a.characters, need: n }) })),
  { id: "account-both", name: "Both sides of the war", how: "Have a Horde and an Alliance character.", test: (a) => ({ done: a.horde && a.alliance }) },
];

function facts(profile) {
  const j = profile?.journal || {};
  const sp = splits(profile);
  return {
    level: Number(profile?.level) || 0,
    quests: profile?.history?.completedIdsKnown ? profile.history.completedIds.length : Number(profile?.history?.completedCount) || 0,
    zones: (j.zones || []).length,
    firsts: new Set((j.firsts || []).map((f) => f.key)),
    firstAt: new Map((j.firsts || []).map((f) => [f.key, f.at])),
    fastest: sp.length ? Math.min(...sp.map((s) => s.seconds)) : null,
    profession: Math.max(0, ...professionRanks(profile)),
    gold: Number.isSafeInteger(profile?.ledger?.money) ? profile.ledger.money / 10000 : 0,
    standing: Math.max(0, ...factionsOf(profile).map((r) => Number(r?.standing) || 0)),
  };
}
// Saved ledgers keep reputations as { seenAt, factions: [...] } (1.1.1: 1.1.0 read only a bare list).
function factionsOf(p) {
  const r = p?.ledger?.reputations;
  return Array.isArray(r) ? r : Array.isArray(r?.factions) ? r.factions : [];
}
function professionRanks(p) {
  const items = p?.readiness?.workshop?.professions?.items;
  return Array.isArray(items) ? items.map((x) => Number(x?.rank)).filter(Number.isFinite) : [];
}
/** Every badge with earned/locked state and progress, plus a count. */
function badgesFor(profile) {
  const f = facts(profile);
  const list = BADGES.map((b) => {
    const r = b.test(f);
    const key = b.id.startsWith("first-") ? b.id.slice(6) : null;
    return { id: b.id, group: b.group, name: b.name, how: b.how, earned: Boolean(r.done), ...(r.need ? { progress: { have: Math.min(r.have, r.need), need: r.need } } : {}), ...(key && f.firstAt.get(key) ? { at: f.firstAt.get(key) } : {}) };
  });
  return { earned: list.filter((b) => b.earned).length, total: list.length, badges: list };
}
function side(p) { const f = String(p?.faction || "").toLowerCase(); return f === "horde" || f === "alliance" ? f : null; }
/** Badges earned across the account: how many characters, and both factions. */
function accountBadges(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const a = { characters: list.length, horde: list.some((p) => side(p) === "horde"), alliance: list.some((p) => side(p) === "alliance") };
  const badges = ACCOUNT_BADGES.map((b) => { const r = b.test(a); return { id: b.id, group: "Account", name: b.name, how: b.how, earned: Boolean(r.done), ...(r.need ? { progress: { have: Math.min(r.have, r.need), need: r.need } } : {}) }; });
  return { earned: badges.filter((b) => b.earned).length, total: badges.length, badges };
}
/** Closest badges still to earn: the ones with the most progress first. */
function nextUp(book, n = 3) {
  return book.badges.filter((b) => !b.earned && b.progress && b.progress.have > 0).map((b) => ({ ...b, share: b.progress.have / b.progress.need })).sort((x, y) => y.share - x.share || x.progress.need - y.progress.need).slice(0, n);
}
/**
 * The Badges page (1.1): one character's book, every character's count, which characters hold each
 * badge, and the account badges. Read-only, from saved data.
 */
function badgeBook(state, profileId) {
  const profiles = Array.isArray(state?.profiles) ? state.profiles : [];
  const chosen = profiles.find((p) => p.id === profileId) || profiles.find((p) => p.id === state?.activeProfileId) || profiles[0] || null;
  const books = new Map(profiles.map((p) => [p.id, badgesFor(p)]));
  const characters = profiles.map((p) => ({ id: p.id, name: p.name, level: Number(p.level) || null, className: p.className || null, faction: side(p), earned: books.get(p.id).earned, total: books.get(p.id).total, active: p.id === chosen?.id }));
  const holders = Object.fromEntries(BADGES.map((b) => [b.id, profiles.filter((p) => books.get(p.id).badges.find((x) => x.id === b.id)?.earned).map((p) => p.name)]));
  const book = chosen ? books.get(chosen.id) : null;
  const recent = book ? book.badges.filter((b) => b.earned && b.at).sort((x, y) => y.at - x.at).slice(0, 5) : [];
  return { character: chosen ? { id: chosen.id, name: chosen.name, className: chosen.className || null, level: Number(chosen.level) || null } : null,
    groups: GROUPS, book, next: book ? nextUp(book) : [], recent, characters, holders, account: accountBadges(profiles),
    totals: { earned: [...books.values()].reduce((s, b) => s + b.earned, 0), unique: Object.values(holders).filter((h) => h.length).length, kinds: BADGES.length } };
}
/** Rested planner: classic rules (5% of a level per 8 hours in an inn or city, up to 150%). */
function rested(profile) {
  const p = profile?.progress;
  if (!p || !Number.isFinite(p.max) || p.max <= 0) return null;
  const r = Number.isFinite(p.rested) ? p.rested : 0;
  const pct = Math.round((r / p.max) * 100);
  const capPct = 150, toCap = Math.max(0, capPct - pct);
  return { xp: r, percentOfLevel: pct, capPercent: capPct, hoursToCap: Math.ceil((toCap / 5) * 8), perNight: 5 };
}
module.exports = { badgesFor, badgeBook, accountBadges, nextUp, rested, BADGES, ACCOUNT_BADGES, GROUPS };

"use strict";
// Badges: milestones a character has earned, from its own saved data. Each badge says plainly
// what it's for and, when locked, what's left to earn it.
const { splits, normalizeEncounterHistory } = require("./journal-data.cjs");
const { validateWorkshop } = require("./preparation-data.cjs");
const { ALL_CLASSES } = require("./class-unlocks.cjs");
const { normalizeLedgerCapture, SIDES, STANDINGS } = require("./ledger.cjs");

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
// These milestones are desktop-only; BADGES is the original catalog shared with the addon.
const PROFESSION_LINES = [
  [171, "alchemy", "Alchemy"], [164, "blacksmithing", "Blacksmithing"],
  [185, "cooking", "Cooking"], [333, "enchanting", "Enchanting"],
  [202, "engineering", "Engineering"], [129, "first-aid", "First Aid"],
  [356, "fishing", "Fishing"], [182, "herbalism", "Herbalism"],
  [165, "leatherworking", "Leatherworking"], [186, "mining", "Mining"],
  [393, "skinning", "Skinning"], [197, "tailoring", "Tailoring"],
];
const EXPANSION_BADGES = PROFESSION_LINES.flatMap(([line, slug, label]) => [150, 300].map((n) => ({
  id: `profession-${slug}-${n}`, group: "Professions", name: `${label} ${n}`,
  how: `Reach skill ${n} in ${label}.`, desktopOnly: true, art: `profession-${n}`, threshold: n,
  test: (c) => {
    const have = c.professions.get(line);
    return have === undefined ? { progressUnavailable: true } : { done: have >= n, have, need: n };
  },
})));
const DUNGEON_BADGES = [
  [1, "dungeon-first-victory", "First dungeon victory", "Win a boss encounter in a dungeon."],
  [5, "dungeon-victories-5", "Dungeon veteran", "Win 5 distinct dungeon boss encounters."],
].map(([n, id, name, how]) => ({
  id, group: "Dungeons", name, how, desktopOnly: true, art: "first-dungeon", threshold: n,
  test: ({ dungeonVictories: have }) => have ? { done: have >= n, have, need: n } : { progressUnavailable: true },
}));
// Reviewed exact-build next links and saved evidence rules: docs/LIVE-ADVENTURE.md.
// Do not expand this list from the merged reference or infer links from titles.
const QUEST_CHAIN_BUILDS = new Set(["1.60.1.70888", "1.60.1.70862"]);
const QUEST_CHAIN_BADGES = [
  ["quest-chain-defias-westfall", "The Defias Brotherhood (Westfall)",
    "Complete the five Westfall investigation quests in The Defias Brotherhood.", [65, 132, 135, 141, 142]],
  ["quest-chain-husbands-revenge", "A Husband's Revenge",
    "Complete The Engraved Ring, Raleigh and the Undercity, and A Husband's Revenge.", [440, 441, 530]],
  ["quest-chain-missing-shipment", "The Missing Shipment",
    "Complete Southsea Freebooters, both Missing Shipment quests, and Stolen Booty.", [887, 890, 892, 888]],
].map(([id, name, how, ids]) => ({
  id, group: "Quest chains", name, how, desktopOnly: true, art: "quests-100", threshold: ids.length,
  test: ({ chainCompletions }) => {
    if (!chainCompletions) return { progressUnavailable: true };
    const have = ids.filter(id => chainCompletions.has(id)).length;
    return { done: have === ids.length, have, need: ids.length };
  },
}));
// A bounded catalog, not a medal for every faction that appears in a save.
const MEDAL_FACTIONS = [
  [72, "stormwind", "Stormwind"],
  [76, "orgrimmar", "Orgrimmar"],
  [576, "timbermaw-hold", "Timbermaw Hold"],
];
const REPUTATION_MEDALS = MEDAL_FACTIONS.flatMap(([factionId, slug, label]) => [7, 8].map((n) => ({
  id: `rep-${slug}-${STANDINGS[n].toLowerCase()}`, group: "Reputation", name: `${label} · ${STANDINGS[n]}`,
  how: `Reach ${STANDINGS[n]} with ${label}.`, desktopOnly: true,
  art: `rep-${STANDINGS[n].toLowerCase()}`, threshold: n,
  test: ({ reputation }) => {
    const have = reputation.get(factionId);
    return have === undefined ? { progressUnavailable: true } : { done: have >= n, have, need: n };
  },
})));
const LATCHED_BADGES = [...EXPANSION_BADGES, ...DUNGEON_BADGES, ...QUEST_CHAIN_BADGES, ...REPUTATION_MEDALS];
const CHARACTER_CATALOG = [...BADGES, ...LATCHED_BADGES];
const GROUPS = Object.freeze(["Levels", "Quests", "Quest chains", "Exploring", "Firsts", "Speed", "Professions", "Gold", "Reputation", "Dungeons"]);

// Account badges: earned across all your characters together.
const ACCOUNT_BADGES = [
  ...[[2, "Growing family"], [5, "Full house"], [10, "A whole guild of me"]].map(([n, name]) => ({ id: `account-${n}`, name, how: `Play ${n} characters with the addon on.`, test: (a) => ({ done: a.characters >= n, have: a.characters, need: n }) })),
  { id: "account-both", name: "Both sides of the war", how: "Have a Horde and an Alliance character.", test: (a) => ({ done: a.horde && a.alliance }) },
];
const EXPANSION_ACCOUNT_BADGES = [
  [3, "Growing roster", "account-2"], [6, "Versatile roster", "account-5"], [9, "Every class", "account-10"],
].map(([n, name, art]) => ({
  id: `account-classes-${n}`, name, how: `Save characters of ${n} different classes with the addon.`, desktopOnly: true, art,
  test: (a) => ({ done: a.classes >= n, have: a.classes, need: n }),
}));
const ACCOUNT_CATALOG = [...ACCOUNT_BADGES, ...EXPANSION_ACCOUNT_BADGES];
// The saved export currently has class names, not stable class IDs. Unknown names stay unknown.
const KNOWN_CLASSES = new Set(ALL_CLASSES.map((name) => name.toLowerCase()));

function facts(profile, desktop) {
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
    ...(desktop ? awardFacts(profile) : {}),
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
function savedSource(p) {
  const s = p?.source;
  if (s?.kind !== "wow-addon" || typeof s.id !== "string" || !s.id.trim() || s.id.length > 200 ||
      typeof s.updatedAt !== "string" || !Number.isFinite(Date.parse(s.updatedAt)) ||
      new Date(s.updatedAt).toISOString() !== s.updatedAt) return null;
  return s;
}
function observedProfessionRanks(p) {
  const source = savedSource(p), collection = p?.readiness?.workshop?.professions;
  if (!source || !collection) return new Map();
  try {
    const { professions } = validateWorkshop({ professions: collection });
    if (professions.observedAt <= source.updatedAt) return new Map(professions.items.map((row) => [row.skillLineId, row.rank]));
  } catch { /* Missing or invalid owned-profession evidence cannot count. */ }
  return new Map();
}
function observedDungeonVictories(profile) {
  const source = savedSource(profile);
  if (!source) return 0;
  const savedAt = Date.parse(source.updatedAt) / 1000;
  try {
    const rows = normalizeEncounterHistory(profile.journal?.encounters);
    return new Set(rows.filter(e => e.instanceType === "party" && e.at <= savedAt)
      .map(e => `${e.instanceMap}:${e.encounterId}`)).size;
  } catch { return 0; }
}
function observedMedalStandings(profile) {
  const source = savedSource(profile), build = profile?.clientBuild, capture = profile?.ledger?.reputations;
  const standings = new Map();
  if (!source || !build || !capture) return standings;
  const characterSide = side(profile);
  try {
    const { reputations: { seenAt, scanId, factions } } = normalizeLedgerCapture({ reputations: capture });
    if (scanId === undefined || seenAt * 1000 > Date.parse(source.updatedAt)) return standings;
    for (const [id] of MEDAL_FACTIONS) {
      const requiredSide = SIDES.Alliance.includes(id) ? "alliance" : SIDES.Horde.includes(id) ? "horde" : null;
      if (requiredSide && characterSide !== requiredSide) continue;
      const row = factions.find(f => f.id === id);
      // A hidden row can share the latest scan's clock second without belonging to it.
      if (row?.scanId === scanId && row.observedAt === seenAt && row.observedBuild === build) standings.set(id, row.standing);
    }
  } catch { /* Invalid optional evidence cannot count. */ }
  return standings;
}
function awardFacts(profile) {
  const history = profile?.history;
  const chainCompletions = savedSource(profile) && QUEST_CHAIN_BUILDS.has(profile.clientBuild) &&
    history?.completedIdsKnown === true && Array.isArray(history.completedIds) ? new Set(history.completedIds) : null;
  return { professions: observedProfessionRanks(profile), dungeonVictories: observedDungeonVictories(profile), chainCompletions,
    reputation: observedMedalStandings(profile) };
}
const AWARD_IDS = new Set(LATCHED_BADGES.map(b => b.id));
function validBadgeAwards(awards) {
  return Array.isArray(awards) && awards.length <= AWARD_IDS.size &&
    new Set(awards).size === awards.length && [...awards].every(id => AWARD_IDS.has(id));
}
// Only the snapshot merger writes awards, on its validated copy of the character.
// Keep IDs, not evidence rows or guessed achievement dates.
function latchBadgeAwards(profile) {
  const facts = awardFacts(profile);
  const awards = new Set(profile.badgeAwards);
  for (const badge of LATCHED_BADGES) if (badge.test(facts).done) awards.add(badge.id);
  if (awards.size) profile.badgeAwards = [...awards];
}
function badgeResult(b, r, group = b.group) {
  return { id: b.id, group, name: b.name, how: b.how, earned: Boolean(r.done),
    ...(r.need ? { progress: { have: Math.min(r.have, r.need), need: r.need } } : {}),
    ...(r.progressUnavailable ? { progressUnavailable: true } : {}),
    ...(b.desktopOnly ? { desktopOnly: true, art: b.art } : {}) };
}
/** The shared Journey catalog by default; opt in to the expanded desktop Badge Case catalog. */
function badgesFor(profile, { desktop = false } = {}) {
  const f = facts(profile, desktop);
  const awards = desktop && savedSource(profile) && validBadgeAwards(profile.badgeAwards)
    ? new Set(profile.badgeAwards) : null;
  const list = (desktop ? CHARACTER_CATALOG : BADGES).map((b) => {
    const key = b.id.startsWith("first-") ? b.id.slice(6) : null;
    const result = awards?.has(b.id) ? { done: true, have: b.threshold, need: b.threshold } : b.test(f);
    return { ...badgeResult(b, result), ...(key && f.firstAt.get(key) ? { at: f.firstAt.get(key) } : {}) };
  });
  return { earned: list.filter((b) => b.earned).length, total: list.length, badges: list };
}
function side(p) { const f = String(p?.faction || "").toLowerCase(); return f === "horde" || f === "alliance" ? f : null; }
function classVariety(profiles) {
  const byIdentity = new Map();
  for (const p of profiles) {
    const source = savedSource(p);
    const key = typeof p?.className === "string" ? p.className.trim().toLowerCase() : "";
    if (!source || !KNOWN_CLASSES.has(key)) continue;
    if (!byIdentity.has(source.id)) byIdentity.set(source.id, key);
    else if (byIdentity.get(source.id) !== key) byIdentity.set(source.id, null);
  }
  return new Set([...byIdentity.values()].filter(Boolean)).size;
}
/** Account badges (including class variety) still reflect the current saved roster.
 *  Removing a qualifying profile can relock them; desktop character awards are latched. */
function accountBadges(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const a = { characters: list.length, horde: list.some((p) => side(p) === "horde"), alliance: list.some((p) => side(p) === "alliance"), classes: classVariety(list) };
  const badges = ACCOUNT_CATALOG.map((b) => badgeResult(b, b.test(a), "Account"));
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
  const books = new Map(profiles.map((p) => [p.id, badgesFor(p, { desktop: true })]));
  const characters = profiles.map((p) => ({ id: p.id, name: p.name, level: Number(p.level) || null, className: p.className || null, faction: side(p), earned: books.get(p.id).earned, total: books.get(p.id).total, active: p.id === chosen?.id }));
  const holders = Object.fromEntries(CHARACTER_CATALOG.map((b) => [b.id, []]));
  for (const p of profiles) for (const b of books.get(p.id).badges) if (b.earned) holders[b.id].push(p.name);
  const book = chosen ? books.get(chosen.id) : null;
  const recent = book ? book.badges.filter((b) => b.earned && b.at).sort((x, y) => y.at - x.at).slice(0, 5) : [];
  return { character: chosen ? { id: chosen.id, name: chosen.name, className: chosen.className || null, level: Number(chosen.level) || null } : null,
    groups: GROUPS, book, next: book ? nextUp(book) : [], recent, characters, holders, account: accountBadges(profiles),
    totals: { earned: [...books.values()].reduce((s, b) => s + b.earned, 0), unique: Object.values(holders).filter((h) => h.length).length, kinds: CHARACTER_CATALOG.length } };
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
module.exports = { badgesFor, badgeBook, accountBadges, nextUp, rested, BADGES, ACCOUNT_BADGES, EXPANSION_BADGES, EXPANSION_ACCOUNT_BADGES, GROUPS, validBadgeAwards, latchBadgeAwards };

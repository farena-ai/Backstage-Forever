"use strict";
// Character sheet (0.36, G5 + A12): the active character's equipped gear by slot, base stats the
// addon read in game, and the gear sets saved with /bf set, with where each set piece is now
// (worn, bags, bank, mail or another character) from the 0.35 ledger. The addon blocks are
// validated strictly; an invalid block is dropped without touching the rest of the character.
// Like the ledger, none of this is shared with the community or sent to an AI.
const MAX_T = 253402300799, ID = 2147483647;
// Equipment slot ids as the game numbers them (INVSLOT_*), with the classic paper-doll layout.
const SLOT_LABELS = Object.freeze({ 1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands", 11: "Ring 1", 12: "Ring 2", 13: "Trinket 1", 14: "Trinket 2", 15: "Back", 16: "Main hand", 17: "Off hand", 18: "Ranged", 19: "Tabard" });
const LAYOUT = Object.freeze({ left: [1, 2, 3, 15, 5, 4, 19, 9], right: [10, 6, 7, 8, 11, 12, 13, 14], bottom: [16, 17, 18] });
// Slots a leveling character normally fills; shirt, tabard, off hand and ranged are optional.
const EXPECTED = Object.freeze([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
// Not counted in the average item level.
const COSMETIC = Object.freeze([4, 19]);
const STAT_KEYS = Object.freeze(["strength", "agility", "stamina", "intellect", "spirit", "armor", "attackPower", "rangedAttackPower", "health", "power"]);
const RESISTS = Object.freeze(["holy", "fire", "nature", "frost", "shadow", "arcane"]);
const POWER = Object.freeze(["mana", "rage", "energy", "focus"]);
const LIMITS = Object.freeze({ sets: 20, setName: 24 });

const fail = () => { throw Error("Invalid character sheet."); };
const int = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : fail());
const obj = (v, keys) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail();
  if (keys && Object.keys(v).some((k) => !keys.includes(k))) fail();
  return v;
};
const absent = (v) => v === undefined || v === null;
const text = (v, max = 100) => (typeof v === "string" && v.length >= 1 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : fail());
// Lua writes an empty list as {} when nothing marked it as an array.
const list = (v, n) => {
  if (absent(v)) return [];
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return [];
  if (!Array.isArray(v) || v.length > n) fail();
  return v;
};

/** Addon `stats` block -> bounded copy; throws when anything is invalid. */
function normalizeStatsCapture(s) {
  obj(s, ["schemaVersion", "seenAt", ...STAT_KEYS, "resist", "powerKind"]);
  if (!absent(s.schemaVersion) && s.schemaVersion !== 1) fail();
  const out = { schemaVersion: 1, seenAt: int(s.seenAt, 0, MAX_T) };
  for (const k of STAT_KEYS) if (!absent(s[k])) out[k] = int(s[k], 0, 10000000);
  if (!absent(s.resist)) {
    obj(s.resist, RESISTS);
    out.resist = {};
    for (const k of RESISTS) if (!absent(s.resist[k])) out.resist[k] = int(s.resist[k], 0, 10000);
  }
  if (!absent(s.powerKind)) { if (!POWER.includes(s.powerKind)) fail(); out.powerKind = s.powerKind; }
  return out;
}
const validateStats = (s) => { if (s !== undefined) normalizeStatsCapture(s); };

const SET_NAME = /^[A-Za-z0-9 _'-]{1,24}$/;
/** Addon `gearSets` block -> bounded copy; throws when anything is invalid. */
function normalizeGearSetsCapture(g) {
  obj(g, ["schemaVersion", "sets"]);
  if (!absent(g.schemaVersion) && g.schemaVersion !== 1) fail();
  const names = new Set();
  const sets = list(g.sets, LIMITS.sets).map((set) => {
    obj(set, ["name", "savedAt", "items"]);
    const name = text(set.name, LIMITS.setName);
    if (!SET_NAME.test(name) || name.trim() !== name || names.has(name.toLowerCase())) fail();
    names.add(name.toLowerCase());
    const slots = new Set();
    const items = list(set.items, 19).map((it) => {
      obj(it, ["slot", "itemId", "name"]);
      const slot = int(it.slot, 1, 19);
      if (slots.has(slot)) fail();
      slots.add(slot);
      return { slot, itemId: int(it.itemId, 1, ID), ...(absent(it.name) ? {} : { name: text(it.name) }) };
    });
    if (!items.length) fail();
    return { name, savedAt: int(set.savedAt, 0, MAX_T), items: items.sort((a, b) => a.slot - b.slot) };
  });
  return { schemaVersion: 1, sets };
}
const validateGearSets = (g) => { if (g !== undefined) normalizeGearSetsCapture(g); };

/** How a worn piece holds up at this level (the Characters gear review uses the same rule). */
function ageRating(level, itemLevel) {
  if (!Number.isInteger(level) || !Number.isFinite(itemLevel) || itemLevel <= 0) return null;
  const gap = level - itemLevel;
  return gap <= 3 ? "fresh" : gap <= 8 ? "aging" : "replace";
}
/** Every item id the sheet may describe: worn, saved in sets, and in the ledger's bags and bank. */
function sheetItemIds(profile) {
  const ids = new Set();
  for (const e of profile?.readiness?.equipment || []) ids.add(e.itemId);
  for (const s of profile?.gearSets?.sets || []) for (const it of s.items) ids.add(it.itemId);
  for (const key of ["bags", "bank"]) for (const e of profile?.ledger?.[key]?.items || []) ids.add(e.id);
  return [...ids].sort((a, b) => a - b);
}
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Where one set piece is now, best place first: worn, bags, bank, mail, another character.
 * Bank and mail are as the addon last saw them; another character only from their ledger.
 */
function whereIs(itemId, profile, others) {
  if ((profile.readiness?.equipment || []).some((e) => e.itemId === itemId)) return { where: "worn" };
  const l = profile.ledger;
  for (const key of ["bags", "bank", "mail"]) if ((l?.[key]?.items || []).some((e) => e.id === itemId)) return { where: key, seenAt: l[key].seenAt };
  for (const o of others) for (const key of ["bags", "bank", "mail"])
    if ((o.ledger?.[key]?.items || []).some((e) => e.id === itemId)) return { where: "other", holder: o.name, place: key };
  return { where: "missing" };
}

/**
 * Everything the Characters -> Sheet page shows for one character.
 * facts: Map itemId -> game item ({ name, quality, itemLevel, requiredLevel, slot, iconFileId, ... })
 * score: (item) -> number (gear-score.cjs scoreItem for this class and level), optional
 * verdict: (item) -> { verdict, text, delta } for bag and bank pieces, optional
 */
function sheetView(profile, { profiles = [], facts = new Map(), score = null, verdict = null } = {}) {
  if (!profile) return null;
  const level = Number.isInteger(profile.level) ? profile.level : null;
  const equipment = Array.isArray(profile.readiness?.equipment) ? profile.readiness.equipment : null;
  const bySlot = new Map((equipment || []).map((e) => [e.slot, e]));
  const fact = (id) => facts.get(id) || null;
  const piece = (id, captured = {}) => {
    const f = fact(id);
    const itemLevel = f?.itemLevel ?? captured.itemLevel ?? null;
    return { itemId: id, name: f?.name || captured.name || `Item #${id}`, quality: Number.isInteger(f?.quality) ? f.quality : captured.quality ?? null,
      itemLevel, requiredLevel: f?.requiredLevel ?? null, iconFileId: f?.iconFileId ?? null, known: Boolean(f) };
  };
  const slots = Object.entries(LAYOUT).flatMap(([side, ids]) => ids.map((slot) => {
    const e = bySlot.get(slot);
    const item = e ? piece(e.itemId, e) : null;
    if (item) {
      item.rating = ageRating(level, item.itemLevel);
      if (score && fact(item.itemId)) item.score = round1(score(fact(item.itemId)));
    }
    // An off hand is not missing next to a two-handed weapon.
    const twoHanded = slot === 17 && /two-hand/i.test(String(fact(bySlot.get(16)?.itemId)?.slot || ""));
    return { slot, label: SLOT_LABELS[slot], side, item, missing: Boolean(equipment) && !item && EXPECTED.includes(slot) && !twoHanded };
  }));
  const counted = slots.filter((s) => s.item && !COSMETIC.includes(s.slot) && Number.isFinite(s.item.itemLevel) && s.item.itemLevel > 0);
  const averageItemLevel = counted.length ? round1(counted.reduce((n, s) => n + s.item.itemLevel, 0) / counted.length) : null;
  const weakest = slots.filter((s) => s.item?.rating && s.item.rating !== "fresh" && !COSMETIC.includes(s.slot))
    .sort((a, b) => a.item.itemLevel - b.item.itemLevel).slice(0, 4).map((s) => ({ slot: s.slot, label: s.label, name: s.item.name, itemLevel: s.item.itemLevel, rating: s.item.rating }));
  const wornScore = score ? round1(slots.reduce((n, s) => n + (s.item?.score || 0), 0)) : null;

  // Upgrades already in the bags or bank, by the same verdict as the item hover cards.
  const upgrades = [];
  if (verdict && equipment) {
    const seen = new Set();
    for (const key of ["bags", "bank"]) for (const e of profile.ledger?.[key]?.items || []) {
      if (seen.has(e.id) || !fact(e.id)) continue;
      seen.add(e.id);
      const v = verdict(fact(e.id));
      if (v && (v.verdict === "upgrade" || v.verdict === "upgrade-later")) upgrades.push({ ...piece(e.id, { name: e.name, quality: e.q }), where: key, verdict: v.verdict, text: v.text, delta: Number.isFinite(v.delta) ? round1(v.delta) : null });
    }
    upgrades.sort((a, b) => (a.verdict === "upgrade" ? 0 : 1) - (b.verdict === "upgrade" ? 0 : 1) || (b.delta ?? 0) - (a.delta ?? 0) || a.name.localeCompare(b.name));
  }

  const others = profiles.filter((p) => p && p.id !== profile.id && p.ledger);
  const sets = (profile.gearSets?.sets || []).map((set) => {
    const items = set.items.map((it) => ({ slot: it.slot, label: SLOT_LABELS[it.slot], ...piece(it.itemId, { name: it.name }), ...whereIs(it.itemId, profile, others) }));
    const count = (w) => items.filter((i) => i.where === w).length;
    const known = items.filter((i) => fact(i.itemId));
    return { name: set.name, savedAt: set.savedAt, items,
      score: score && known.length ? round1(known.reduce((n, i) => n + score(fact(i.itemId)), 0)) : null,
      counts: { worn: count("worn"), bags: count("bags"), away: count("bank") + count("mail") + count("other"), missing: count("missing") } };
  });
  return {
    profileId: profile.id, name: profile.name, className: profile.className || null, race: profile.race || null, faction: profile.faction || null, level,
    savedAt: profile.source?.updatedAt || null, equipmentKnown: Boolean(equipment), slots, averageItemLevel, countedSlots: counted.length,
    missing: slots.filter((s) => s.missing).map((s) => s.label), weakest, wornScore,
    stats: profile.stats || null, upgrades: upgrades.slice(0, 6), setsKnown: Boolean(profile.gearSets), sets,
    ledgerSeen: profile.ledger ? { bags: profile.ledger.bags?.seenAt ?? null, bank: profile.ledger.bank?.seenAt ?? null, mail: profile.ledger.mail?.seenAt ?? null } : null,
  };
}
module.exports = { normalizeStatsCapture, validateStats, normalizeGearSetsCapture, validateGearSets, ageRating, sheetItemIds, sheetView, SLOT_LABELS, LAYOUT, EXPECTED, LIMITS };

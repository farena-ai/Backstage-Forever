"use strict";
// Reputation planner (roadmap C10). Pick a faction and a standing; this lists what the data knows
// that moves the saved character toward it: item hand-ins (with how many you hold in bags and
// bank) and quests that pay reputation with that faction. Every row says where its number comes
// from. Nothing is invented: the quest reference does not record which hand-ins repeat, nor any
// reputation per kill, so those are stated as unknown instead of guessed. Pure.
const buildCompat = require("./build-compat.cjs");
const { MAP_NAMES } = require("./map-names.cjs");
const { STANDINGS, SIDES } = require("./ledger.cjs");

// Where each standing starts on the classic reputation scale (Hated ... Exalted).
const STARTS = Object.freeze({ 1: -42000, 2: -6000, 3: -3000, 4: 0, 5: 3000, 6: 9000, 7: 21000, 8: 42000 });
// Reputation for a reward size when the quest records no exact amount. These are the sizes of
// WoW Forever, not of classic (75, 150, 250, 350, 500 for sizes 3 to 7): the game's own reward
// table and about 2,200 quest hand-ins players recorded (Efficient Games, CC BY 4.0) agree on them.
const TIER_AMOUNT = Object.freeze({ 1: 10, 2: 25, 3: 50, 4: 75, 5: 100, 6: 150, 7: 200, 8: 1, 9: 5 });
// What a quest takes away from a faction, by the same sizes.
const TIER_LOSS = Object.freeze({ 1: -50, 2: -125, 3: -250, 4: -375, 5: -500, 6: -750, 7: -1000, 8: -1, 9: -5 });
/** The usual reputation change of a reward size (negative sizes are losses), or null. */
const standardAmount = (tier) => (Number.isSafeInteger(tier) && tier !== 0 ? (tier > 0 ? TIER_AMOUNT[tier] : TIER_LOSS[-tier]) ?? null : null);
const RACE_BITS = Object.freeze({ Human: 1, Orc: 2, Dwarf: 4, "Night Elf": 8, NightElf: 8, Undead: 16, Scourge: 16, Tauren: 32, Gnome: 64, Troll: 128 });
const MAX_HAND_INS = 12, MAX_QUESTS = 15;
const isId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

/** Reputation one reward row gives: exact when the quest records it, else the standard amount for its size. */
function rewardAmount(row, tiers = null) {
  if (Number.isInteger(row?.amount)) return row.amount > 0 ? { amount: row.amount, exact: true } : null;
  // tiers: the sizes read from the player's own game files (game-data.cjs repTiers().gain), when readable.
  const own = Array.isArray(tiers) && Number.isSafeInteger(row?.tier) && row.tier >= 1 && row.tier <= 9 ? tiers[row.tier] : null;
  const amount = Number.isSafeInteger(own) && own > 0 ? own : TIER_AMOUNT[row?.tier];
  return amount ? { amount, exact: false } : null;
}
function factionSide(id) {
  if (SIDES.Alliance.includes(id)) return "Alliance";
  if (SIDES.Horde.includes(id)) return "Horde";
  return null;
}
/**
 * Points still needed from the saved value to the start of the target standing.
 * The next standing is read from the bar the game reported; further ones use the classic scale,
 * but only when that scale agrees with the bar the game reported for this faction.
 */
function pointsNeeded(faction, target) {
  if (!faction || !Number.isInteger(target) || target < 2 || target > 8) return { need: null, basis: "unknown" };
  if (target <= faction.standing) return { need: 0, basis: "reached" };
  if (target === faction.standing + 1) return { need: Math.max(0, faction.max - faction.value), basis: "saved-bar" };
  const agrees = STARTS[faction.standing] === faction.min && STARTS[faction.standing + 1] === faction.max;
  return agrees ? { need: Math.max(0, STARTS[target] - faction.value), basis: "classic-scale" } : { need: null, basis: "unknown" };
}
function place(pack, refs) {
  const npc = (refs || []).map((r) => pack.npcs?.[`${r.kind || "npc"}:${r.id}`]).find((n) => n?.name);
  if (!npc) return null;
  const pos = npc.positions?.[0];
  return { name: npc.name, zone: pos ? MAP_NAMES[pos.mapId] || null : null, side: npc.side === "Alliance" || npc.side === "Horde" ? npc.side : null };
}
// A hand-in asks only for items: every objective is an item with a count. Whether those items are
// ordinary goods (cloth, stones, ore) or quest items is read from the player's own game files.
const handInItems = (q) => {
  const list = q.objectives || [];
  if (!list.length || list.some((o) => o.type !== "item" || !isId(o.objectId) || !Number.isSafeInteger(o.required) || o.required < 1)) return null;
  if (new Set(list.map((o) => o.objectId)).size !== list.length) return null;
  return list.map((o) => ({ itemId: o.objectId, required: o.required }));
};

/**
 * profile: the saved character. pack: the quest reference. options: factionId, standing (target, 2..8),
 * itemFact(id) -> { name, classId, bonding } from the player's game files (null when unknown).
 */
function repPlan(profile, pack, { factionId = null, standing = null, itemFact = () => null, tiers = null } = {}) {
  const factions = profile?.ledger?.reputations?.factions || [];
  const options = factions.map((f) => ({ id: f.id, name: f.name, standing: f.standing, standingName: STANDINGS[f.standing] }));
  const base = { profileId: profile?.id ?? null, factions: options };
  if (!factions.length) return { ...base, status: "unavailable", reason: "No reputations saved for this character yet. Open the reputation window in game, then type /reload once." };
  const f = factions.find((x) => x.id === factionId) || null;
  if (!f) return { ...base, status: "choose", reason: "Pick a faction." };
  const targets = [];
  for (let s = f.standing + 1; s <= 8; s++) targets.push({ standing: s, name: STANDINGS[s] });
  const target = Number.isInteger(standing) && standing > f.standing && standing <= 8 ? standing : Math.min(8, f.standing + 1);
  const faction = { id: f.id, name: f.name, standing: f.standing, standingName: STANDINGS[f.standing], value: f.value, min: f.min, max: f.max, side: factionSide(f.id), observedAt: f.observedAt ?? null };
  const result = { ...base, status: "available", faction, targets, target: f.standing >= 8 ? null : { standing: target, name: STANDINGS[target] } };
  if (f.standing >= 8) return { ...result, need: 0, basis: "reached", handIns: [], quests: [], notes: ["This faction is already at Exalted."], dungeons: null, totals: null };
  const { need, basis } = pointsNeeded(f, target);
  const notes = [];
  if (basis === "classic-scale") notes.push("Points to a standing beyond the next one use the classic reputation scale.");
  if (basis === "unknown") notes.push("This faction's bar does not follow the classic scale, so only the next standing can be counted.");
  if (faction.side && profile.faction && faction.side !== profile.faction) notes.push(`${f.name} belongs to the ${faction.side}; a ${profile.faction} character cannot normally raise it.`);

  const relation = pack ? buildCompat.relation(pack.build, profile.clientBuild) : "unknown";
  const referenceOk = Boolean(pack?.quests) && (relation === "match" || relation === "carried");
  const dungeons = { supported: false, note: "The data records no reputation per kill, so dungeon runs cannot be counted." };
  if (!referenceOk) {
    return { ...result, need, basis, handIns: [], quests: [], totals: null, dungeons, referenceBuild: pack?.build ?? null, reference: relation,
      notes: [...notes, pack?.quests ? "The quest reference is for another patch than this character, so quests and hand-ins are left out." : "No quest reference is loaded."] };
  }

  const level = Number.isInteger(profile.level) ? profile.level : null, side = profile.faction || null, bit = RACE_BITS[profile.race];
  const historyKnown = profile.history?.completedIdsKnown === true;
  const done = new Set(historyKnown ? profile.history.completedIds : []);
  for (const e of profile.history?.recent || []) done.add(e.id);
  const log = new Map((profile.quests || []).map((q) => [q.id, q]));
  const held = (where) => new Map((profile.ledger?.[where]?.items || []).map((e) => [e.id, e]));
  const bags = held("bags"), bank = held("bank");
  const fact = (id) => { try { return itemFact(id) || null; } catch { return null; } };
  const nameOf = (id) => bags.get(id)?.name || bank.get(id)?.name || pack.items?.[id]?.name || fact(id)?.name || `Item #${id}`;
  // Goods you can gather, buy or trade; a quest item belongs to an ordinary one-time quest.
  const goods = (id) => { const it = fact(id); return it && Number.isInteger(it.classId) ? it.classId !== 12 && it.bonding !== "Quest item" : null; };
  let goodsKnown = true;

  const handIns = [], quests = [];
  let doneCount = 0;
  for (const q of Object.values(pack.quests)) {
    const row = (q.rewards?.reputation || []).find((r) => r.factionId === f.id);
    const gain = row && rewardAmount(row, tiers);
    if (!gain) continue;
    const saved = log.get(q.id), giver = place(pack, q.givers), turnIn = place(pack, q.turnIns);
    if (!saved) {
      if (side && q.sides?.length && !q.sides.includes(side)) continue;
      if (bit && q.raceMask && !(parseInt(q.raceMask.slice(-8), 16) & bit)) continue;
      if (side && giver?.side && giver.side !== side) continue;
    }
    let items = handInItems(q);
    if (items) {
      const kinds = items.map((it) => goods(it.itemId));
      if (kinds.some((k) => k === null)) goodsKnown = false;
      if (!kinds.every((k) => k === true)) items = null;
    }
    const entry = { id: q.id, title: saved?.title || q.title, amount: gain.amount, exact: gain.exact, minLevel: q.minLevel || null,
      status: saved ? (saved.complete ? "turn-in" : "in-log") : "reference", later: !saved && level !== null && Number.isInteger(q.minLevel) && q.minLevel > level,
      giver: giver ? { name: giver.name, zone: giver.zone } : null, turnIn: turnIn ? { name: turnIn.name, zone: turnIn.zone } : null };
    if (items) {
      const rows = items.map((it) => {
        const inBags = bags.get(it.itemId)?.n || 0, inBank = bank.get(it.itemId)?.n || 0;
        return { ...it, name: nameOf(it.itemId), bags: inBags, bank: inBank, held: inBags + inBank };
      });
      const count = need === null ? null : Math.ceil(need / gain.amount);
      const same = (x) => x.title === entry.title && x.amount === entry.amount && x.status === entry.status && JSON.stringify(x.items.map((r) => [r.itemId, r.required])) === JSON.stringify(rows.map((r) => [r.itemId, r.required]));
      if (!handIns.some(same)) handIns.push({ ...entry, handedInBefore: done.has(q.id), items: rows, heldHandIns: Math.min(...rows.map((r) => Math.floor(r.held / r.required))),
        handInsNeeded: count, itemsNeeded: count === null ? null : rows.map((r) => ({ itemId: r.itemId, name: r.name, total: r.required * count, missing: Math.max(0, r.required * count - r.held) })) });
    } else if (done.has(q.id)) doneCount++;
    else if (!quests.some((x) => x.title === entry.title && x.amount === entry.amount && x.status === entry.status)) quests.push(entry);
  }
  const rank = { "turn-in": 0, "in-log": 1, reference: 2 };
  const order = (a, b) => rank[a.status] - rank[b.status] || Number(a.later) - Number(b.later) || b.amount - a.amount || a.id - b.id;
  handIns.sort((a, b) => rank[a.status] - rank[b.status] || Number(a.later) - Number(b.later) || b.heldHandIns - a.heldHandIns || b.amount - a.amount || a.id - b.id);
  quests.sort(order);
  const open = quests.filter((q) => !q.later);
  // Every hand-in pays at least once, unless the saved history says it was already handed in.
  const firstHandIns = handIns.filter((h) => !h.later && !h.handedInBefore);
  const questPoints = open.reduce((n, q) => n + q.amount, 0) + firstHandIns.reduce((n, h) => n + h.amount, 0);
  if (!goodsKnown) notes.push("Some quest items are not in your game data, so a goods hand-in may be listed as an ordinary quest.");
  if (handIns.length) notes.push("The data does not record which hand-ins repeat. The count shown is how many it would take if that one repeats; check in game.");
  if (!historyKnown) notes.push("Finished quests are not known for this character, so some quests listed may already be done.");
  notes.push("Bonuses to reputation gains (racial or event) are not counted.");
  return { ...result, need, basis, notes, dungeons, referenceBuild: pack.build, reference: relation,
    bagsSeenAt: profile.ledger?.bags?.seenAt ?? null, bankSeenAt: profile.ledger?.bank?.seenAt ?? null, bankKnown: Boolean(profile.ledger?.bank),
    handIns: handIns.slice(0, MAX_HAND_INS), quests: quests.slice(0, MAX_QUESTS),
    totals: { handIns: handIns.length, quests: quests.length, openQuests: open.length, questPoints, questsExact: open.every((q) => q.exact) && firstHandIns.every((h) => h.exact), doneQuests: doneCount,
      questsCover: need === null ? null : questPoints >= need } };
}

module.exports = { STARTS, TIER_AMOUNT, TIER_LOSS, standardAmount, rewardAmount, pointsNeeded, repPlan };

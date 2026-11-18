"use strict";
// The quest pack supplies possible reputation sources, not a promise about the current server.
const { MAP_NAMES } = require("./map-names.cjs");
const { STANDINGS } = require("./ledger.cjs");
const RACE_BITS = Object.freeze({ Human: 1, Orc: 2, Dwarf: 4, "Night Elf": 8, NightElf: 8, Undead: 16, Scourge: 16, Tauren: 32, Gnome: 64, Troll: 128 });
const priority = { "turn-in": 0, "in-log": 1, reference: 2 };
const sideOk = (q, side) => !side || !q.sides?.length || q.sides.includes(side);
const raceOk = (q, bit) => !bit || !q.raceMask || Boolean(parseInt(q.raceMask.slice(-8), 16) & bit);
const positive = r => Number.isInteger(r.amount) ? r.amount > 0 : Number.isInteger(r.tier) && r.tier >= 1 && r.tier <= 9;

function place(pack, refs) {
  const npc = (refs || []).map(r => pack.npcs?.[`${r.kind || "npc"}:${r.id}`]).find(n => n?.name);
  if (!npc) return null;
  const pos = npc.positions?.[0];
  return { name: npc.name, zone: pos ? MAP_NAMES[pos.mapId] || null : null };
}

// A reference requirement can be compared with bags, but cannot establish
// readiness, turn-in, or a reputation gain. Storage never counts as carried.
function turnInMaterials(profile, pack, quest, now) {
  if (profile.source?.kind !== "wow-addon" || !profile.clientBuild || profile.clientBuild !== pack.build) return;
  const items = (quest.objectives || []).filter(o => o.type === "item");
  if (!items.length || new Set(items.map(o => o.objectId)).size !== items.length ||
      items.some(o => !Number.isSafeInteger(o.objectId) || o.objectId < 1 || !Number.isSafeInteger(o.required) || o.required < 1)) return;
  const bags = profile.ledger?.bags, savedAt = Math.floor(Date.parse(profile.source.updatedAt) / 1000);
  const dated = bags?.seenAt > 0 && bags.seenAt <= Math.min(savedAt, now);
  const exact = dated && bags.complete === true && bags.seenAt === savedAt;
  const carried = new Map((dated ? bags.items : []).map(row => [row.id, row]));
  return { seenAt: dated ? bags.seenAt : null, rows: items.map(({ objectId: itemId, required }) => {
    const item = carried.get(itemId), count = item?.n ?? (exact ? 0 : null);
    return { itemId, required, name: item?.name || pack.items?.[itemId]?.name || `Item #${itemId}`,
      carried: count, missing: exact ? Math.max(0, required - count) : null };
  }) };
}

function repAdvice(profile, pack, { perFaction = 5, browseOnly = false, now = Math.floor(Date.now() / 1000) } = {}) {
  const factions = profile?.ledger?.reputations?.factions;
  if (!factions?.length || !pack?.quests) return null;
  const level = browseOnly ? 0 : profile.level, side = profile.faction, bit = RACE_BITS[profile.race];
  const historyKnown = !browseOnly && profile.history?.completedIdsKnown === true;
  const done = new Set(historyKnown ? profile.history.completedIds : []);
  if (!browseOnly) for (const e of profile.history?.recent || []) done.add(e.id);
  const log = new Map((browseOnly ? [] : profile.quests || []).map(q => [q.id, q]));
  const links = new Map(), byFaction = new Map(factions.map(f => [f.id, []]));
  for (const q of Object.values(pack.quests)) {
    if (!browseOnly && q.nextQuestId && q.nextQuestId !== q.id) {
      const list = links.get(q.nextQuestId) || [];
      if (list.length < 5) list.push({ id: q.id, title: q.title, completed: done.has(q.id) ? true : historyKnown ? false : null });
      links.set(q.nextQuestId, list);
    }
    const saved = log.get(q.id);
    if (!browseOnly && !saved && (done.has(q.id) || !sideOk(q, side) || !raceOk(q, bit) || q.minLevel > level)) continue;
    const ids = new Set((q.rewards?.reputation || []).filter(positive).map(r => r.factionId));
    for (const id of ids) byFaction.get(id)?.push({ q, saved, status: saved ? saved.complete ? "turn-in" : "in-log" : "reference" });
  }
  const order = (a, b) => priority[a.status] - priority[b.status]
    || (a.status === "reference" ? Number(links.get(a.q.id)?.some(p => p.completed !== true) || false) - Number(links.get(b.q.id)?.some(p => p.completed !== true) || false) : 0)
    || Number(Boolean(b.q.givers?.length)) - Number(Boolean(a.q.givers?.length))
    || Math.abs((a.q.level || level) - level) - Math.abs((b.q.level || level) - level) || a.q.id - b.q.id;
  return { browseOnly, factions: factions.map(f => ({ id: f.id, name: f.name, standingName: STANDINGS[f.standing],
    quests: byFaction.get(f.id).sort(order).slice(0, perFaction).map(({ q, saved, status }) => {
      const materials = status === "in-log" ? turnInMaterials(profile, pack, q, now) : undefined;
      return { id: q.id, title: saved?.title || q.title, status, minLevel: q.minLevel || null, sides: q.sides || [],
        linkedFrom: links.get(q.id) || [], giver: place(pack, q.givers), turnIn: place(pack, q.turnIns),
        ...(materials ? { materials } : {}) };
    }),
  })) };
}
module.exports = { repAdvice };

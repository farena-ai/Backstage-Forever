"use strict";
// Quest intel learned from the player's own game: quest log text (kept only in
// their local profile, never bundled) and where quest items came from when they
// looted them. Optional capture blocks fail atomically without rejecting the
// character; profile validation stays strict.
const LIMITS = Object.freeze({ items: 200, sources: 12, positions: 8, questIds: 5 });
const TEXT_LIMITS = Object.freeze({ description: 1200, objectives: 400 });
function invalid() {
  throw Error("Invalid quest intel.");
}
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((k) => !keys.includes(k))) invalid();
}
function list(value, max, min = 0) {
  if (!Array.isArray(value) || value.length > max || value.length < min) invalid();
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function stamp(value, raw) {
  if (raw) return new Date(integer(value, 0, 253402300799) * 1000).toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
function coordinate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid();
  return value;
}

/** Optional per-quest text: { description?, objectives? }, at least one, bounded. */
function validateQuestText(value) {
  if (value === undefined) return undefined;
  exact(value, ["description", "objectives"]);
  const out = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS))
    if (value[key] !== undefined) out[key] = text(value[key], max);
  if (!Object.keys(out).length) invalid();
  return out;
}

function normalize(value, raw) {
  if (value === undefined) return undefined;
  exact(value, ["schemaVersion", "items"]);
  if (value.schemaVersion !== 1) invalid();
  const seenItems = new Set();
  const items = list(value.items, LIMITS.items).map((item) => {
    exact(item, ["itemId", "name", "questIds", "lastSeen", "sources"]);
    const itemId = integer(item.itemId, 1, 2147483647);
    if (seenItems.has(itemId)) invalid();
    seenItems.add(itemId);
    const quests = new Set();
    const questIds = list(item.questIds, LIMITS.questIds, 1).map((id) => {
      integer(id, 1, 2147483647);
      if (quests.has(id)) invalid();
      quests.add(id);
      return id;
    });
    const seenSources = new Set();
    const sources = list(item.sources, LIMITS.sources, 1).map((s) => {
      exact(s, ["kind", "id", "name", "count", "lastSeen", "positions"]);
      if (!["creature", "object"].includes(s.kind)) invalid();
      const id = integer(s.id, 1, 2147483647), key = `${s.kind}:${id}`;
      if (seenSources.has(key)) invalid();
      seenSources.add(key);
      const source = { kind: s.kind, id };
      if (s.name !== undefined) source.name = text(s.name, 120);
      source.count = integer(s.count, 1, 1000000);
      source.lastSeen = stamp(s.lastSeen, raw);
      if (s.positions !== undefined)
        source.positions = list(s.positions, LIMITS.positions, 1).map((p) => {
          exact(p, ["mapId", "x", "y"]);
          return { mapId: integer(p.mapId, 1, 2147483647), x: coordinate(p.x), y: coordinate(p.y) };
        });
      return source;
    });
    const out = { itemId };
    if (item.name !== undefined) out.name = text(item.name, 120);
    Object.assign(out, { questIds, lastSeen: stamp(item.lastSeen, raw), sources });
    return out;
  });
  return { schemaVersion: 1, items };
}
/** Addon export (epoch seconds) -> profile shape (ISO timestamps). */
function normalizeLootSourcesCapture(value) {
  return normalize(value, true);
}
/** Stored profile shape, strict. */
function validateLootSources(value) {
  return normalize(value, false);
}

function sourceView(s) {
  return { ...s, ...(s.positions ? { positions: s.positions.map((p) => ({ ...p })) } : {}) };
}
/** Learned sources for the given item ids (any quest), most recent first. */
function learnedItemSources(profile, itemIds) {
  const wanted = new Set(itemIds);
  const items = profile?.lootSources?.items;
  if (!Array.isArray(items) || !wanted.size) return [];
  return items.filter((i) => wanted.has(i.itemId)).map((i) => ({ itemId: i.itemId, ...(i.name ? { name: i.name } : {}), lastSeen: i.lastSeen, sources: i.sources.map(sourceView) }));
}
/**
 * What this player's own game taught us about one quest: its quest log text and
 * where its objective items came from. Only keys with data are returned.
 */
function questIntel(profile, questId, record) {
  const out = {};
  const active = Array.isArray(profile?.quests) ? profile.quests.find((q) => q.id === questId) : null;
  if (active?.text) out.questText = { ...active.text };
  const items = profile?.lootSources?.items;
  if (Array.isArray(items) && items.length) {
    const objectiveItems = new Set((record?.objectives || []).filter((o) => o?.type === "item" && Number.isSafeInteger(o.objectId)).map((o) => o.objectId));
    const rows = items.filter((i) => i.questIds.includes(questId) || objectiveItems.has(i.itemId));
    if (rows.length) out.itemSources = learnedItemSources(profile, rows.map((i) => i.itemId));
  }
  return out;
}
module.exports = { validateQuestText, normalizeLootSourcesCapture, validateLootSources, learnedItemSources, questIntel, LIMITS, TEXT_LIMITS };

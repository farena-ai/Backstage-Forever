"use strict";
// Dungeon loot for the Instance Atlas and item hover cards: the boss loot pack joined with item facts
// from the player's own game install and an "upgrade for you" verdict from gear-score.cjs.
const { blockers, replaced, compare } = require("./gear-score.cjs");
const { dropIndex } = require("./boss-loot-data.cjs");
const { BASELINE } = require("./dungeon-atlas.cjs");
const { provenance } = require("./community.cjs");
const INSTANCE_NAMES = Object.fromEntries(BASELINE.map((b) => [b[0], b[1]]));

// What the character wears, by slot, in the same shape enrichRewards() (knowledge-ipc.cjs) uses.
function equipmentContext(p, gameData) {
  const equipment = Array.isArray(p?.readiness?.equipment) ? p.readiness.equipment : null;
  const worn = equipment?.length && gameData ? gameData.items(equipment.map((e) => e.itemId)) : [];
  const bySlot = {};
  // Worn items the game tables do not cover still occupy their slot; they are compared as unknown.
  (equipment || []).forEach((e, i) => { bySlot[e.slot] = worn[i] || { id: e.itemId, name: e.name || `Item #${e.itemId}`, unknown: true, stats: [], armor: 0 }; });
  const ctx = { className: p?.className || undefined, level: Number.isInteger(p?.level) ? p.level : undefined, equipmentKnown: !!equipment };
  return { ctx, bySlot, equipmentKnown: !!equipment };
}

// One item against what the character wears now.
// verdict: upgrade | upgrade-later | not-upgrade | not-for-you | not-equipment | usable | no-class | unknown
function upgradeVerdict(item, { ctx = {}, bySlot = {}, equipmentKnown = false } = {}) {
  if (!item) return { verdict: "unknown", text: "Not in your game data yet", reasons: [] };
  if (!replaced(item, ctx, bySlot).slots.length) return { verdict: "not-equipment", text: null, reasons: [] };
  if (!ctx.className) return { verdict: "no-class", text: "Pick a class for this character to compare", reasons: [] };
  const block = blockers(item, ctx);
  const levelOnly = block.length && block.every((r) => /^Requires level/.test(r));
  if (block.length && !levelOnly) return { verdict: "not-for-you", text: block[0], reasons: block };
  const at = levelOnly ? { ...ctx, level: item.requiredLevel } : ctx;
  if (levelOnly && blockers(item, at).length) return { verdict: "not-for-you", text: blockers(item, at)[0], reasons: blockers(item, at) };
  if (!equipmentKnown) return { verdict: "usable", text: levelOnly ? `Usable by you from level ${item.requiredLevel}` : "Usable by you", reasons: ["/reload in game once so the app can compare it with what you wear"] };
  const rep = replaced(item, at, bySlot), cmp = compare(item, rep.items, at);
  if (!cmp.better) return { verdict: "not-upgrade", text: "Not an upgrade", delta: cmp.delta, reasons: cmp.reasons };
  return levelOnly
    ? { verdict: "upgrade-later", text: `Upgrade for you at level ${item.requiredLevel}`, delta: cmp.delta, reasons: cmp.reasons }
    : { verdict: "upgrade", text: "Upgrade for you", delta: cmp.delta, reasons: cmp.reasons };
}

// Item view fields the renderer needs (no sell price, class masks etc.).
const view = (it) => it ? { name: it.name, quality: it.quality, itemLevel: it.itemLevel, requiredLevel: it.requiredLevel, slot: it.slot, kind: it.kind, armor: it.armor || 0, stats: it.stats || [], damage: it.damage, speed: it.speed, dps: it.dps, bonding: it.bonding, classes: it.classes, iconFileId: it.iconFileId } : null;

// Every boss item of the pack, rated once: Map(itemId -> { item, verdict }).
function rateAll(pack, profile, gameData) {
  const ids = [...new Set(Object.values(pack?.instances || {}).flatMap((i) => i.bosses.flatMap((b) => b.items.map((x) => x.itemId))))];
  const found = ids.length && gameData ? gameData.items(ids) : [];
  const eq = equipmentContext(profile, gameData), out = new Map();
  ids.forEach((id, i) => out.set(id, { item: found[i] || null, verdict: upgradeVerdict(found[i] || null, eq) }));
  return { rated: out, equipmentKnown: eq.equipmentKnown };
}
const isUp = (v) => v.verdict === "upgrade";
// Per atlas instance: counts for the card chip, and the starred items that drop there.
function atlasLootSummary(pack, { profile = null, gameData = null, wished = [] } = {}) {
  if (!pack) return {};
  const { rated } = rateAll(pack, profile, gameData), wish = new Set(wished), out = {};
  for (const [id, inst] of Object.entries(pack.instances)) {
    const seen = new Set(), stars = [];
    let items = 0, upgrades = 0, later = 0;
    for (const b of inst.bosses) for (const x of b.items) {
      if (seen.has(x.itemId)) continue;
      seen.add(x.itemId); items++;
      const r = rated.get(x.itemId);
      if (isUp(r.verdict)) upgrades++; else if (r.verdict.verdict === "upgrade-later") later++;
      if (wish.has(x.itemId)) stars.push({ itemId: x.itemId, boss: b.name, name: r.item?.name || null, quality: r.item?.quality ?? null, iconFileId: r.item?.iconFileId || null });
    }
    out[id] = { bosses: inst.bosses.length, bossesWithLoot: inst.bosses.filter((b) => b.items.length).length, items, upgrades, later, wished: stars };
  }
  return out;
}
// Community drops (0.34) for a boss's creatures that the bundled list lacks, best rate first.
function communityDrops(community, b) {
  if (!community?.drops) return [];
  const listed = new Set(b.items.map((x) => x.itemId)), best = new Map();
  for (const npcId of b.npcIds) for (const d of community.drops.get(npcId) || []) {
    if (listed.has(d.itemId) || d.rate <= 0) continue;
    const prev = best.get(d.itemId);
    if (!prev || d.rate > prev.rate) best.set(d.itemId, d);
  }
  return [...best.values()].sort((a, b2) => b2.rate - a.rate).slice(0, 16);
}
// One instance, boss by boss, with item facts and verdicts.
function instanceLoot(pack, instanceId, { profile = null, gameData = null, wished = [], community = null } = {}) {
  const inst = pack?.instances?.[instanceId];
  if (!inst) return null;
  const extra = new Map(inst.bosses.map((b) => [b, communityDrops(community, b)]));
  const ids = [...new Set(inst.bosses.flatMap((b) => [...b.items.map((x) => x.itemId), ...extra.get(b).map((x) => x.itemId)]))];
  const found = ids.length && gameData ? gameData.items(ids) : [], byId = new Map(ids.map((id, i) => [id, found[i] || null]));
  const eq = equipmentContext(profile, gameData), wish = new Set(wished);
  return {
    instanceId, name: INSTANCE_NAMES[instanceId] || instanceId, equipmentKnown: eq.equipmentKnown, gameData: found.some(Boolean),
    bosses: inst.bosses.map((b) => ({ name: b.name, npcIds: b.npcIds, items: b.items.map((x) => {
      const it = byId.get(x.itemId);
      return { itemId: x.itemId, chance: x.chance, drops: x.drops, item: view(it), verdict: upgradeVerdict(it, eq), wished: wish.has(x.itemId) };
    }), community: extra.get(b).map((x) => {
      const it = byId.get(x.itemId);
      return { itemId: x.itemId, chance: x.rate, samples: x.samples, installs: x.installs, source: provenance(x.installs), item: view(it), verdict: upgradeVerdict(it, eq), wished: wish.has(x.itemId) };
    }) })),
    attribution: pack.attribution,
  };
}
// Hover card data for one item.
function itemCard(pack, itemId, { profile = null, gameData = null, wished = [], index = null, community = null, creatureName = () => null } = {}) {
  const it = gameData ? gameData.items([itemId])[0] || null : null;
  const sources = ((index || dropIndex(pack)).get(itemId) || []).slice(0, 4).map((s) => ({ boss: s.boss, instanceId: s.instanceId, instance: INSTANCE_NAMES[s.instanceId] || s.instanceId, chance: s.chance }));
  const bosses = new Map();
  for (const inst of Object.values(pack?.instances || {})) for (const b of inst.bosses) for (const id of b.npcIds) bosses.set(id, b.name);
  // Community drops: labelled with how many players reported them, never merged into the bundled list.
  const communitySources = (community?.dropsByItem?.get(itemId) || []).slice(0, 3).map((d) => ({ npcId: d.npcId, name: bosses.get(d.npcId) || creatureName(d.npcId) || `Creature #${d.npcId}`, chance: d.rate, samples: d.samples, installs: d.installs, source: provenance(d.installs) }));
  return { itemId, item: view(it), verdict: upgradeVerdict(it, equipmentContext(profile, gameData)), sources, communitySources, wished: wished.includes(itemId) };
}
module.exports = { equipmentContext, upgradeVerdict, atlasLootSummary, instanceLoot, itemCard, INSTANCE_NAMES };

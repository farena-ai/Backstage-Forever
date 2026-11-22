"use strict";
// Dungeon loot for the Instance Atlas and item hover cards: the boss loot pack joined with item facts
// from the player's own game install and an "upgrade for you" verdict from gear-score.cjs.
const { blockers, replaced, compare } = require("./gear-score.cjs");
const { dropIndex } = require("./boss-loot-data.cjs");
const { BASELINE } = require("./dungeon-atlas.cjs");
const { provenance } = require("./community.cjs");
const INSTANCE_NAMES = Object.fromEntries(BASELINE.map((b) => [b[0], b[1]]));
const unknown = (text) => ({ verdict: "unknown", text, reasons: [] });

function ownership(profile, itemId) {
  if (profile?.readiness?.equipment?.some((e) => e.itemId === itemId)) {
    // The profile stores an ISO timestamp; item cards use epoch seconds like ledger scans.
    const updatedAt = profile.source?.updatedAt;
    const ms = typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;
    const seenAt = Number.isFinite(ms) && ms > 0 && new Date(ms).toISOString() === updatedAt ? ms / 1000 : null;
    return { where: "worn", seenAt };
  }
  for (const where of ["bags", "bank", "mail"]) {
    const scan = profile?.ledger?.[where];
    if (scan?.items?.some((e) => e.id === itemId)) return { where, seenAt: scan.seenAt ?? null };
  }
  return null;
}

// What the character wears, by slot, in the same shape enrichRewards() (knowledge-ipc.cjs) uses.
function equipmentContext(p, gameData) {
  const equipment = Array.isArray(p?.readiness?.equipment) ? p.readiness.equipment : null;
  let buildMatches = false;
  try { buildMatches = Boolean(p?.clientBuild && p.clientBuild === gameData?.build()); } catch {}
  const worn = equipment?.length && buildMatches ? gameData.items(equipment.map((e) => e.itemId)) : [];
  const bySlot = {};
  // Worn items the game tables do not cover still occupy their slot; they are compared as unknown.
  (equipment || []).forEach((e, i) => { bySlot[e.slot] = worn[i] || { id: e.itemId, name: e.name || `Item #${e.itemId}`, unknown: true, stats: [], armor: 0 }; });
  const ctx = { className: p?.className || undefined, level: Number.isInteger(p?.level) ? p.level : undefined, equipmentKnown: !!equipment };
  return { ctx, bySlot, equipmentKnown: !!equipment, buildMatches };
}

// One item against what the character wears now.
// verdict: upgrade | upgrade-later | not-upgrade | not-for-you | not-equipment | usable | no-class | unknown
function upgradeVerdict(item, { ctx = {}, bySlot = {}, equipmentKnown = false, buildMatches = false } = {}) {
  if (!item) return unknown("Not in your game data yet");
  if (!replaced(item, ctx, bySlot).slots.length) return { verdict: "not-equipment", text: null, reasons: [] };
  if (!ctx.className) return { verdict: "no-class", text: "Pick a class for this character to compare", reasons: [] };
  if (!buildMatches) return unknown("Saved character and installed game builds do not match or are unknown.");
  if (!Number.isInteger(ctx.level) || !Number.isInteger(item.requiredLevel) || !Number.isInteger(item.classId) || !Number.isInteger(item.subclassId) || !(item.classes === null || Array.isArray(item.classes))) return unknown("Equip requirements are unknown.");
  const block = blockers(item, ctx);
  const levelOnly = block.length && block.every((r) => /^Requires level/.test(r));
  if (block.length && !levelOnly) return { verdict: "not-for-you", text: block[0], reasons: block };
  const at = levelOnly ? { ...ctx, level: item.requiredLevel } : ctx;
  if (levelOnly && blockers(item, at).length) return { verdict: "not-for-you", text: blockers(item, at)[0], reasons: blockers(item, at) };
  if (!equipmentKnown) return { verdict: "usable", text: levelOnly ? `Usable by you from level ${item.requiredLevel}` : "Usable by you", reasons: ["/reload in game once so the app can compare it with what you wear"] };
  const rep = replaced(item, at, bySlot);
  const comparisonItems = rep.slots.some((slot) => slot === 11 || slot === 12) ? [bySlot[11], bySlot[12]] : rep.slots.some((slot) => slot === 13 || slot === 14) ? [bySlot[13], bySlot[14]] : rep.items;
  const mainHand = bySlot[16];
  if (rep.slots.includes(17) && !rep.slots.includes(16) && mainHand && (mainHand.unknown || mainHand.inventoryType === 17)) return unknown("Check the off-hand slot and main-hand weapon in game.");
  if (!Array.isArray(item.stats) || comparisonItems.some((it) => it && (it.unknown || !Array.isArray(it.stats)))) return unknown("Item stats are missing for this comparison.");
  const cmp = compare(item, rep.items, at);
  const detail = { delta: cmp.delta, reasons: cmp.reasons, replaces: rep.items.map((it) => ({ itemId: it.id, name: it.name })) };
  if (!cmp.better) return { verdict: "not-upgrade", text: "Not an upgrade", ...detail };
  return levelOnly
    ? { verdict: "upgrade-later", text: `Upgrade for you at level ${item.requiredLevel}`, ...detail }
    : { verdict: "upgrade", text: "Upgrade for you", ...detail };
}

// Item view fields the renderer needs (no sell price, class masks etc.).
// Some items exist only as game hotfixes, so the local game files do not describe them. The
// bundled community data still knows their names: show the name instead of a bare item number.
let bundledNames = null;
function bundledName(id) {
  if (!bundledNames) {
    bundledNames = new Map();
    try {
      const items = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../../data/forever/pack.json"), "utf8")).items || {};
      for (const it of Object.values(items)) if (Number.isSafeInteger(it?.id) && typeof it.name === "string" && it.name) bundledNames.set(it.id, it.name);
    } catch {}
  }
  return bundledNames.get(id) || null;
}
const nameOnly = (id) => { const name = bundledName(id); return name ? { name, nameOnly: true } : null; };
const view = (it, id) => !it ? nameOnly(id) : { name: it.name, quality: it.quality, itemLevel: it.itemLevel, requiredLevel: it.requiredLevel, slot: it.slot, kind: it.kind, armor: it.armor || 0, stats: it.stats || [], damage: it.damage, speed: it.speed, dps: it.dps, bonding: it.bonding, classes: it.classes, iconFileId: it.iconFileId };

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
      if (wish.has(x.itemId)) stars.push({ itemId: x.itemId, boss: b.name, name: r.item?.name || bundledName(x.itemId), quality: r.item?.quality ?? null, iconFileId: r.item?.iconFileId || null });
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
      return { itemId: x.itemId, chance: x.chance, drops: x.drops, item: view(it, x.itemId), verdict: upgradeVerdict(it, eq), wished: wish.has(x.itemId) };
    }), community: extra.get(b).map((x) => {
      const it = byId.get(x.itemId);
      return { itemId: x.itemId, chance: x.rate, samples: x.samples, installs: x.installs, source: provenance(x.installs), item: view(it, x.itemId), verdict: upgradeVerdict(it, eq), wished: wish.has(x.itemId) };
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
  return { itemId, item: view(it, itemId), verdict: upgradeVerdict(it, equipmentContext(profile, gameData)), ownership: ownership(profile, itemId), sources, communitySources, wished: wished.includes(itemId) };
}
module.exports = { equipmentContext, upgradeVerdict, atlasLootSummary, instanceLoot, itemCard, INSTANCE_NAMES };

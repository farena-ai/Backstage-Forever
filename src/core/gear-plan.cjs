"use strict";
// Gear plan per slot (roadmap C2). For every equipment slot: what the character wears and up to
// three reachable upgrades from every source the data really has, ranked with the stat weights the
// character chose (stat-weights.cjs), and one target the player pins per slot.
//
// Sources, each labelled where it comes from:
//   quest   - quest rewards in the bundled quest reference
//   vendor  - goods players saw at a vendor (bundled reference); a price only when this player saw
//             it in a merchant window (Ledger)
//   dungeon - boss drops with their seen drop chance (bundled reference)
//   drop    - creature drops with their seen drop chance (bundled reference)
//   craft   - recipes this character knows, as the addon saved them
// Item stats come from the player's own game files. Nothing is invented: a slot with no match says
// so, and a source the data lacks is listed under "gaps". Pure: no game access, no network.
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const buildCompat = require("./build-compat.cjs");
const { blockers, compare, slotsFor, scoreItem } = require("./gear-score.cjs");
const { SLOT_LABELS } = require("./sheet.cjs");
const { MAP_NAMES } = require("./map-names.cjs");
const { BASELINE } = require("./dungeon-atlas.cjs");

// Slots in paper-doll order; shirt and tabard carry no stats.
const PLAN_SLOTS = Object.freeze([1, 2, 3, 15, 5, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18]);
const LEVELS_AHEAD = 3, PER_SLOT = 3, MAX_SOURCES = 3;
const RACE_BITS = Object.freeze({ Human: 1, Orc: 2, Dwarf: 4, "Night Elf": 8, NightElf: 8, Undead: 16, Scourge: 16, Tauren: 32, Gnome: 64, Troll: 128 });
const INSTANCES = new Map(BASELINE.map((b) => [b[0], { name: b[1], min: b[3], max: b[4], side: b[5] }]));
// Which source to name first when an item has several: the surest and nearest to hand.
const SOURCE_ORDER = { craft: 0, vendor: 1, quest: 2, dungeon: 3, drop: 4 };
const isId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const round = (n) => Math.round(n * 100) / 100;

function place(pack, refs) {
  const npc = (refs || []).map((r) => pack.npcs?.[`${r.kind || "npc"}:${r.id}`]).find((n) => n?.name);
  if (!npc) return null;
  const pos = npc.positions?.[0];
  return { name: npc.name, zone: pos ? MAP_NAMES[pos.mapId] || null : null, side: npc.side === "Alliance" || npc.side === "Horde" ? npc.side : null };
}

/** Every way the data knows to get an item: Map(itemId -> sources[]), plus what was counted. */
function sourceIndex(profile, { questPack = null, vendorPack = null, bossLootPack = null, lootPack = null, vendorPrices = new Map(), levelsAhead = LEVELS_AHEAD } = {}) {
  const out = new Map(), counts = { quest: 0, vendor: 0, dungeon: 0, drop: 0, craft: 0 };
  const add = (itemId, source) => {
    if (!isId(itemId)) return;
    const list = out.get(itemId) || [];
    list.push(source); out.set(itemId, list); counts[source.kind]++;
  };
  const level = Number.isInteger(profile?.level) ? profile.level : 0, side = profile?.faction || null, bit = RACE_BITS[profile?.race];
  const historyKnown = profile?.history?.completedIdsKnown === true;
  const done = new Set(historyKnown ? profile.history.completedIds : []);
  for (const e of profile?.history?.recent || []) done.add(e.id);
  const inLog = new Map((profile?.quests || []).map((q) => [q.id, q]));
  for (const q of Object.values(questPack?.quests || {})) {
    const rewards = [...(q.rewards?.items || []).map((r) => [r, false]), ...(q.rewards?.choices || []).map((r) => [r, true])];
    if (!rewards.length || done.has(q.id)) continue;
    const saved = inLog.get(q.id);
    if (!saved) {
      if (side && q.sides?.length && !q.sides.includes(side)) continue;
      if (bit && q.raceMask && !(parseInt(q.raceMask.slice(-8), 16) & bit)) continue;
      if (Number.isInteger(q.minLevel) && q.minLevel > level + levelsAhead) continue;
      // A quest far above the character is not reachable yet, whatever its lowest level says.
      if (Number.isInteger(q.level) && q.level > level + levelsAhead + 2) continue;
    }
    const giver = place(questPack, q.givers);
    // Many quests carry no side of their own; the side of the one who gives them does.
    if (!saved && side && giver?.side && giver.side !== side) continue;
    for (const [r, choice] of rewards) add(r.itemId, { kind: "quest", questId: q.id, title: saved?.title || q.title, choice, inLog: Boolean(saved), minLevel: q.minLevel || null, later: Number.isInteger(q.minLevel) && q.minLevel > level, giver });
  }
  for (const v of vendorPack?.vendors || []) {
    // Reachable means players of your own side were seen trading with this vendor.
    const seen = side ? v.observedReactionsByFaction?.[side] : Object.values(v.observedReactionsByFaction || {}).flat();
    if (!Array.isArray(seen) || !seen.some((n) => n >= 4)) continue;
    const zone = v.positions?.[0] ? MAP_NAMES[v.positions[0].mapId] || null : null;
    for (const l of v.listings || []) {
      const price = vendorPrices.get(l.itemId) || null;
      add(l.itemId, { kind: "vendor", npcId: v.id, name: v.name, zone, lastSeen: v.lastSeen || null, price: price ? { copper: price.cost, count: price.n, at: price.at } : null });
    }
  }
  for (const [instanceId, inst] of Object.entries(bossLootPack?.instances || {})) {
    const meta = INSTANCES.get(instanceId);
    if (meta && Number.isInteger(meta.min) && level && meta.min > level + levelsAhead + 2) continue; // far out of reach for now
    for (const b of inst.bosses || []) for (const x of b.items || [])
      add(x.itemId, { kind: "dungeon", instanceId, instance: meta?.name || instanceId, boss: b.name, chance: x.chance, drops: x.drops, levels: meta ? [meta.min, meta.max] : null });
  }
  for (const [id, rows] of Object.entries(lootPack?.items || {})) for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.kind !== "npc" || !r.name || !(r.chance > 0)) continue;
    add(Number(id), { kind: "drop", npcId: r.id, name: r.name, chance: r.chance, drops: r.drops });
  }
  const workshop = profile?.readiness?.workshop, professions = workshop?.professions?.items || [];
  for (const r of workshop?.recipes?.items || []) {
    const profession = professions.find((p) => p.skillLineId === r.skillLineId && Number.isInteger(p.rank) && p.rank > 0);
    if (!profession || !isId(r.outputItemId)) continue;
    add(r.outputItemId, { kind: "craft", recipeId: r.id, name: r.name, profession: profession.name, reagents: r.reagentsKnown ? (r.reagents || []).map((x) => ({ itemId: x.itemId, required: x.required, name: x.name || null })) : null });
  }
  const key = (x) => `${x.kind}|${x.title || x.name || ""}|${x.boss || ""}|${x.instanceId || ""}`;
  for (const [id, list] of out) {
    // Two quests of one name (one per side or per race) read as one way to get the item.
    const seen = new Set(), unique = list.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
    if (unique.length !== list.length) out.set(id, unique);
  }
  for (const list of out.values()) list.sort((a, b) => SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind]
    || Number(b.inLog || false) - Number(a.inLog || false) || Number(a.later || false) - Number(b.later || false)
    || (b.chance || 0) - (a.chance || 0) || String(a.title || a.name || a.boss).localeCompare(String(b.title || b.name || b.boss)));
  return { sources: out, counts };
}

const itemView = (it) => ({ itemId: it.id, name: it.name, quality: Number.isInteger(it.quality) ? it.quality : null, itemLevel: it.itemLevel ?? null, requiredLevel: it.requiredLevel ?? null, kind: it.kind || null, iconFileId: it.iconFileId || null });
const rateable = (it) => it && Number.isInteger(it.requiredLevel) && Number.isInteger(it.classId) && Number.isInteger(it.subclassId) && Array.isArray(it.stats) && (it.classes === null || Array.isArray(it.classes));

/**
 * The whole plan for one character.
 * items(ids) -> item facts in the shape game-data.cjs itemView() returns (null when unknown).
 * installedBuild: the game build those facts were read from.
 */
function gearPlan(profile, { items = () => [], installedBuild = null, questPack = null, vendorPack = null, bossLootPack = null, lootPack = null,
  weights = null, pins = {}, wished = [], vendorPrices = new Map(), levelsAhead = LEVELS_AHEAD } = {}) {
  const base = { profileId: profile?.id ?? null, levelsAhead, perSlot: PER_SLOT };
  const unavailable = (reason) => ({ ...base, status: "unavailable", reason, slots: [] });
  if (!profile) return unavailable("Pick or create a character first.");
  const equipment = Array.isArray(profile.readiness?.equipment) ? profile.readiness.equipment : null;
  if (!equipment) return unavailable("No gear seen for this character yet. Log in with the addon on, then type /reload once.");
  if (!profile.className || !Number.isInteger(profile.level)) return unavailable("The saved class or level of this character is not known.");
  if (!buildCompat.usable(installedBuild, profile.clientBuild)) return unavailable("The saved character and the installed game must be on the same patch to compare item stats.");
  const ctx = { className: profile.className, level: profile.level, equipmentKnown: true, ...(weights ? { weights } : {}) };

  const wornIds = equipment.map((e) => e.itemId);
  const wornFacts = items(wornIds), bySlot = {};
  equipment.forEach((e, i) => { bySlot[e.slot] = wornFacts[i] || { id: e.itemId, name: e.name || `Item #${e.itemId}`, unknown: true, stats: [], armor: 0, quality: e.quality ?? null, itemLevel: e.itemLevel ?? null }; });
  if (equipment.length && !wornFacts.some(Boolean)) return unavailable("Item stats are not available. Connect your WoW Forever folder so the app can read them from your own game files.");

  const questOk = Boolean(questPack) && buildCompat.usable(questPack.build, profile.clientBuild);
  const { sources, counts } = sourceIndex(profile, { questPack: questOk ? questPack : null, vendorPack, bossLootPack, lootPack, vendorPrices, levelsAhead });
  const pinIds = Object.values(pins || {}).filter(isId);
  const ids = [...new Set([...sources.keys(), ...pinIds])].sort((a, b) => a - b);
  const found = ids.length ? items(ids) : [], facts = new Map();
  ids.forEach((id, i) => { if (found[i] && found[i].id === id) facts.set(id, found[i]); });
  const worn = new Set(wornIds), wish = new Set(wished);
  const owned = (id) => {
    for (const where of ["bags", "bank"]) if (profile.ledger?.[where]?.items?.some((e) => e.id === id)) return where;
    return null;
  };

  // One candidate against one slot, or null when it does not fit, cannot be worn or is no gain.
  const rate = (it, slot, { keepWorse = false } = {}) => {
    if (!rateable(it)) return null;
    const fit = slotsFor(it, ctx);
    if (fit.together ? slot !== 16 : !fit.slots.includes(slot)) return null;
    if (it.requiredLevel > profile.level + levelsAhead) return null;
    const at = { ...ctx, level: Math.max(profile.level, it.requiredLevel) };
    if (blockers(it, at, slot).length) return null;
    const current = (fit.together ? [bySlot[16], bySlot[17]] : [bySlot[slot]]).filter(Boolean);
    if (current.some((c) => c.unknown || !Array.isArray(c.stats))) return null;
    // An off-hand piece cannot be judged alone while a two-hander fills both hands.
    if (slot === 17 && bySlot[16]?.inventoryType === 17) return null;
    const cmp = compare(it, current, at);
    if (!cmp.better && !keepWorse) return null;
    const list = sources.get(it.id) || [];
    return { ...itemView(it), delta: cmp.delta, better: cmp.better, reasons: cmp.reasons.filter((r) => !/ Stat \d+$/.test(r)).slice(0, 4), later: it.requiredLevel > profile.level,
      twoHanded: fit.together, owned: owned(it.id), wished: wish.has(it.id), sources: list.slice(0, MAX_SOURCES), moreSources: Math.max(0, list.length - MAX_SOURCES) };
  };

  const perSlot = new Map(PLAN_SLOTS.map((s) => [s, { checked: 0, list: [] }]));
  for (const [id, it] of facts) {
    if (worn.has(id) || !sources.has(id) || !rateable(it)) continue;
    const fit = slotsFor(it, ctx);
    for (const slot of fit.together ? [16] : fit.slots) {
      const row = perSlot.get(slot);
      if (!row) continue;
      row.checked++;
      const c = rate(it, slot);
      if (c) row.list.push(c);
    }
  }
  const slots = PLAN_SLOTS.map((slot) => {
    const w = bySlot[slot] || null, row = perSlot.get(slot);
    const upgrades = row.list.sort((a, b) => b.delta - a.delta || Number(a.later) - Number(b.later) || a.itemId - b.itemId).slice(0, PER_SLOT);
    const twoHandWorn = slot === 17 && bySlot[16]?.inventoryType === 17;
    let note = null;
    if (w?.unknown) note = "Your worn item is not in your game data, so nothing can be compared with it.";
    else if (twoHandWorn) note = "Your two-handed weapon fills both hands.";
    else if (!upgrades.length) note = row.checked ? `Nothing better in the data: ${row.checked} ${row.checked === 1 ? "item" : "items"} for this slot checked.` : "The data has no item for this slot from a source you can reach.";
    let pinned = null;
    const pinId = pins?.[slot] ?? pins?.[String(slot)];
    if (isId(pinId)) {
      const it = facts.get(pinId);
      pinned = (it && rate(it, slot, { keepWorse: true })) || (it ? { ...itemView(it), delta: null, better: null, reasons: [], later: false, owned: owned(pinId), wished: wish.has(pinId), sources: (sources.get(pinId) || []).slice(0, MAX_SOURCES), moreSources: 0 } : { itemId: pinId, name: `Item #${pinId}`, quality: null, delta: null, better: null, reasons: [], sources: [], moreSources: 0, unknown: true });
      pinned.worn = worn.has(pinId);
    }
    return { slot, label: SLOT_LABELS[slot], worn: w ? { itemId: w.id, name: w.name, quality: Number.isInteger(w.quality) ? w.quality : null, itemLevel: w.itemLevel ?? null, iconFileId: w.iconFileId || null, known: !w.unknown, score: w.unknown ? null : round(scoreItem(w, ctx).score) } : null,
      upgrades: upgrades.map((u) => ({ ...u, pinned: u.itemId === pinId })), pinned, checked: row.checked, note };
  });

  const gaps = [];
  if (!questPack) gaps.push("Quest rewards: no quest reference is loaded.");
  else if (!questOk) gaps.push("Quest rewards: the quest reference is for another patch than this character, so it is left out.");
  if (!counts.vendor) gaps.push(vendorPack ? "Vendor goods: no vendor seen trading with your side sells gear in the data." : "Vendor goods: no vendor reference is loaded.");
  if (!counts.dungeon) gaps.push("Dungeon drops: no boss loot reference is loaded.");
  if (!counts.craft) gaps.push("Crafted gear: the only recipe data is what this character knows, and no saved recipe makes an item.");
  const carried = buildCompat.relation(installedBuild, profile.clientBuild) === "carried" || (questOk && buildCompat.relation(questPack.build, profile.clientBuild) === "carried");
  return { ...base, status: "available", className: profile.className, level: profile.level, customWeights: Boolean(weights), slots, counts, gaps, carried,
    referenceBuild: questOk ? questPack.build : null, characterBuild: profile.clientBuild || null,
    pinnedIds: slots.filter((s) => s.pinned).map((s) => s.pinned.itemId) };
}

/** Does this item fit this slot at all (used before a pin is saved)? */
function fitsSlot(item, slot) {
  if (!item || !PLAN_SLOTS.includes(slot)) return false;
  const fit = slotsFor(item, {});
  return fit.together ? slot === 16 : fit.slots.includes(slot);
}

// Pinned targets: one item per slot and character, in their own small file (gear-pins.json).
// The desktop adds them to the wish list it hands to the game, so the in-game atlas marks them.
const MAX_PROFILES = 100;
const profileKey = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;
class GearPins {
  constructor(dir) {
    this.file = path.join(dir, "gear-pins.json");
    this.profiles = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const profiles = raw && raw.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
      for (const [k, v] of Object.entries(profiles).slice(0, MAX_PROFILES)) if (profileKey(k) && v && typeof v === "object" && !Array.isArray(v)) {
        const pins = {};
        for (const [slot, id] of Object.entries(v)) if (PLAN_SLOTS.includes(Number(slot)) && isId(id)) pins[Number(slot)] = id;
        if (Object.keys(pins).length) this.profiles[k] = pins;
      }
    } catch {}
  }
  get(profileId) { return profileKey(profileId) ? { ...(this.profiles[profileId] || {}) } : {}; }
  /** Item ids pinned for one character, in slot order, each once. */
  ids(profileId) { return [...new Set(Object.values(this.get(profileId)))]; }
  /** itemId null clears the slot. */
  set(profileId, slot, itemId) {
    if (!profileKey(profileId) || !PLAN_SLOTS.includes(slot) || !(itemId === null || isId(itemId))) throw Error("Invalid gear target.");
    const pins = { ...(this.profiles[profileId] || {}) };
    if (itemId === null) delete pins[slot]; else pins[slot] = itemId;
    if (Object.keys(pins).length) {
      if (!this.profiles[profileId] && Object.keys(this.profiles).length >= MAX_PROFILES) throw Error("Too many gear plans.");
      this.profiles[profileId] = pins;
    } else delete this.profiles[profileId];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomic(this.file, JSON.stringify({ schemaVersion: 1, profiles: this.profiles }) + "\n");
    return this.get(profileId);
  }
  clear() { this.profiles = {}; try { fs.rmSync(this.file, { force: true }); } catch {} }
}

module.exports = { PLAN_SLOTS, LEVELS_AHEAD, PER_SLOT, sourceIndex, gearPlan, fitsSlot, GearPins };

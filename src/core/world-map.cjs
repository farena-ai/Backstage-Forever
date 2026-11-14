"use strict";
// World Map model: everything a player wants to find on one zone map, from the
// bundled, source-labelled references plus the player's own quests, finds and live link.
const { MAP_NAMES } = require("./companion-tools.cjs");

const GATHER_SPELLS = { 2366: "herb", 2368: "herb", 3570: "herb", 2575: "ore", 2576: "ore", 3564: "ore" };
const KINDS = ["quest-turnin", "quest-giver", "quest-objective", "flight", "class-trainer", "profession-trainer", "vendor", "herb", "ore", "community", "find", "town", "npc"];
// Class trainers (and weapon/portal masters) teach your class; everything else trains a profession.
const CLASS_TITLE = /^(warrior|paladin|hunter|rogue|priest|shaman|mage|warlock|druid|portal) trainer$|weapon master/i;
const trainerKind = (title) => (CLASS_TITLE.test(title || "") ? "class-trainer" : "profession-trainer");
// Factions an NPC is friendly to, from observed reactions (4+ is neutral or better).
function friendlyTo(reactions) {
  const out = [];
  for (const [f, rs] of Object.entries(reactions || {})) if ((rs || []).some((r) => r >= 4)) out.push(f);
  return out.length ? out : null;
}
const MAX_PINS = 1500, MAX_AREAS = 160;
const mapName = (id) => MAP_NAMES[id] || `Map ${id}`;
const pt = (p) => p && Number.isSafeInteger(p.mapId) && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Static pins are built once from the bundled packs and grouped by map.
function buildStaticIndex({ knowledgePack = null, npcReference = null, travelReference = null, vendorPack = null, insights = null, acquisitionPack = null } = {}) {
  const byMap = new Map();
  const add = (pin) => {
    if (!pt(pin)) return;
    if (!byMap.has(pin.mapId)) byMap.set(pin.mapId, []);
    byMap.get(pin.mapId).push(pin);
  };
  const flightNpcs = new Map();
  for (const n of travelReference?.nodes || []) {
    if (n.position) add({ id: `town:${n.id}`, kind: "town", label: n.label, sub: n.kind === "city" ? "City" : "Town", mapId: n.position.uiMap, x: n.position.mapX, y: n.position.mapY, source: "Reviewed travel reference" });
    if (n.flightMaster?.npcId) flightNpcs.set(n.flightMaster.npcId, n.label);
  }
  const special = new Map(); // npcId -> {kind, sub, extra}
  for (const t of insights?.trainers || []) special.set(t.id, { kind: trainerKind(t.title), sub: t.title || "Trainer", label: t.name, positions: t.positions, lastSeen: t.lastSeen, sides: friendlyTo(t.observedReactionsByFaction), extra: { services: (t.services || []).length } });
  for (const v of vendorPack?.vendors || []) if (!special.has(v.id)) special.set(v.id, { kind: "vendor", sub: "Vendor", label: v.name, positions: v.positions, lastSeen: v.lastSeen, sides: friendlyTo(v.observedReactionsByFaction), extra: { sells: (v.listings || []).slice(0, 6).map((l) => l.name).filter(Boolean) } });
  for (const [id, town] of flightNpcs) special.set(id, { ...(special.get(id) || {}), kind: "flight", sub: `Flight Master · ${town}` });
  const seen = new Set();
  const npcRows = [];
  if (knowledgePack) for (const n of Object.values(knowledgePack.npcs || {})) if (n.kind === "npc") npcRows.push({ ...n, build: knowledgePack.build, tier: "observed" });
  for (const n of npcReference?.npcs || []) npcRows.push({ ...n, build: n.build || npcReference.build, tier: "historical" });
  for (const n of npcRows) {
    const s = special.get(n.id);
    const positions = n.positions?.length ? n.positions : s?.positions || [];
    for (const p of positions.slice(0, 3)) {
      const key = `${n.id}:${p.mapId}:${Math.round(p.x * 200)}:${Math.round(p.y * 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sides = n.side ? [n.side] : s?.sides || null;
      add({ id: `npc:${n.id}:${p.mapId}:${Math.round(p.x * 1000)}`, npcId: n.id, kind: s?.kind || "npc", label: n.name, sub: s?.sub || null, sides, mapId: p.mapId, x: p.x, y: p.y, lastSeen: n.lastSeen || s?.lastSeen || null, build: n.build, evidence: n.tier, ...(s?.extra || {}), source: "Efficient Games, CC BY 4.0" });
    }
  }
  // Trainers/vendors that the NPC packs do not list still appear.
  for (const [id, s] of special) {
    if (npcRows.some((n) => n.id === id)) continue;
    for (const p of (s.positions || []).slice(0, 2)) add({ id: `npc:${id}:${p.mapId}:${Math.round(p.x * 1000)}`, npcId: id, kind: s.kind, label: s.label || `NPC #${id}`, sub: s.sub, sides: s.sides || null, mapId: p.mapId, x: p.x, y: p.y, lastSeen: s.lastSeen || null, evidence: "historical", ...(s.extra || {}), source: "Efficient Games, CC BY 4.0" });
  }
  for (const r of acquisitionPack?.rows || []) {
    if (r.kind !== "gathered-object-loot") continue;
    const kind = GATHER_SPELLS[r.gatherSpellId] || "herb";
    for (const p of (r.positions || []).slice(0, 6)) add({ id: `node:${r.sourceKey}:${p.mapId}:${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`, kind, label: r.referenceName || "Resource", sub: kind === "ore" ? "Mining node (reference)" : "Herb (reference)", mapId: p.mapId, x: p.x, y: p.y, lastSeen: r.observedOn || null, evidence: "historical", source: "Efficient Games, CC BY 4.0" });
  }
  return byMap;
}

// Quests that matter to this character: the ones in their log (with reference details) and
// the ones they could pick up (observed in play, not active or done, level and faction fit).
function relevantQuests(profile, index) {
  const out = [];
  if (!index || !profile) return out;
  const qp = profile.clientBuild && profile.clientBuild !== index.pack.build ? { ...profile, clientBuild: undefined } : profile;
  const active = new Set();
  for (const q of profile.quests || []) {
    active.add(q.id);
    let d;
    try { d = index.details(qp, q.id); } catch { continue; }
    if (d.status === "missing") continue;
    out.push({ id: q.id, title: q.title, status: q.complete ? "ready" : "active", log: q, details: d, record: d.record || null });
  }
  const done = new Set(profile.history?.completedIdsKnown ? profile.history.completedIds : []);
  for (const q of Object.values(index.pack.quests)) {
    if (!q.observedInPlay || active.has(q.id) || done.has(q.id) || !q.givers?.length) continue;
    if (q.minLevel && Number.isInteger(profile.level) && profile.level < q.minLevel) continue;
    if (q.level && Number.isInteger(profile.level) && (q.level < profile.level - 6 || q.level > profile.level + 4)) continue;
    if (profile.faction && q.sides?.length && !q.sides.includes(profile.faction)) continue;
    out.push({ id: q.id, title: q.title, status: "available", log: null, details: null, record: q });
  }
  return out;
}

function questPins(profile, index, mapId) {
  const out = [];
  if (!index || !profile) return out;
  const npcAt = (ref) => index.pack.npcs[`${ref.kind}:${ref.id}`];
  for (const r of relevantQuests(profile, index)) {
    const q = r.log, d = r.details;
    if (r.status === "ready") {
      for (const t of d.turnIns) {
        const n = npcAt(t);
        for (const p of n?.positions || []) if (p.mapId === mapId) out.push({ id: `qt:${q.id}:${t.id}`, kind: "quest-turnin", label: n.name, sub: `Turn in: ${q.title}`, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      }
    } else if (r.status === "active") {
      for (const o of d.objectiveLocations) for (const p of (o.positions || []).slice(0, 3)) if (p.mapId === mapId) out.push({ id: `qo:${q.id}:${o.index}:${Math.round(p.x * 1000)}`, kind: "quest-objective", label: q.objectives?.[o.index - 1]?.text || `Objective ${o.index}`, sub: q.title, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      for (const o of d.record.objectives || []) {
        if (!["talkTo", "monster"].includes(o.type) || !o.objectId) continue;
        const done = q.objectives?.[o.index - 1]?.done;
        if (done) continue;
        const n = index.pack.npcs[`npc:${o.objectId}`];
        for (const p of n?.positions || []) if (p.mapId === mapId) out.push({ id: `qn:${q.id}:${o.objectId}`, kind: "quest-objective", label: n.name, sub: `${o.text} · ${q.title}`, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      }
    } else {
      // A quest you could pick up here, at its first giver.
      const rec = r.record;
      for (const g of rec.givers.slice(0, 1)) {
        const n = npcAt(g);
        for (const p of (n?.positions || []).slice(0, 1)) if (p.mapId === mapId) out.push({ id: `qg:${rec.id}`, kind: "quest-giver", label: n.name, sub: `${rec.title} (level ${rec.level ?? "?"})`, questId: rec.id, mapId, x: p.x, y: p.y, source: "Reference; availability unverified" });
      }
    }
  }
  return out;
}

// ---------- objective areas ----------
// Classic con colours: the level at or below which a creature is grey (no experience).
function greyLevel(L) { return L <= 5 ? 0 : L <= 39 ? L - 5 - Math.floor(L / 10) : L - 1 - Math.floor(L / 5); }
/** Difficulty of a creature level for a player level: grey, green, yellow, orange or red (skull: red). */
function difficulty(playerLevel, mobLevel, skull = false) {
  if (!Number.isInteger(playerLevel) || playerLevel < 1) return null;
  if (skull) return "red";
  if (!Number.isInteger(mobLevel)) return null;
  const d = mobLevel - playerLevel;
  if (d >= 5) return "red";
  if (d >= 3) return "orange";
  if (d >= -2) return "yellow";
  return mobLevel <= greyLevel(playerLevel) ? "grey" : "green";
}
const AREA = { link: 0.05, pad: 0.012, min: 0.018, max: 0.12, parts: 3 };
// Single-link clusters of nearby observation spots, largest first.
function clusters(points) {
  const parent = points.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= AREA.link) parent[find(i)] = find(j);
  const groups = new Map();
  points.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}
/** Centre and radius (map fractions) of each significant cluster of spots (at most three). */
function areaShapes(points) {
  if (!points.length) return [];
  const groups = clusters(points);
  const keep = groups.filter((g, i) => i === 0 || g.length >= Math.max(2, Math.ceil(points.length * 0.2))).slice(0, AREA.parts);
  return keep.map((g) => {
    const x = g.reduce((t, p) => t + p.x, 0) / g.length, y = g.reduce((t, p) => t + p.y, 0) / g.length;
    const far = Math.max(...g.map((p) => Math.hypot(p.x - x, p.y - y)));
    return { x: +x.toFixed(4), y: +y.toFixed(4), radius: +Math.min(AREA.max, Math.max(AREA.min, far + AREA.pad)).toFixed(4), spots: g.length };
  });
}
const VERB = { monster: "Kill", item: "Collect", gameObject: "Use" };
const levelText = (c) => (c?.minLevel == null ? (c?.skull ? "??" : "") : c.minLevel === c.maxLevel ? String(c.minLevel) : `${c.minLevel}–${c.maxLevel}`);
/** A plain-words warning for an elite, rare or boss-level objective creature (null when ordinary). */
function creatureWarning(c, playerLevel) {
  if (!c) return null;
  const name = c.name || "This enemy";
  if (c.worldboss || c.skull) return `${name} is a boss-level enemy (level shown as ??). Leave it for a full group.`;
  if (c.elite) {
    const lv = levelText(c);
    const solo = Number.isInteger(playerLevel) && Number.isInteger(c.maxLevel) && playerLevel >= c.maxLevel + 5;
    return `${name} is elite${lv ? ` (level ${lv})` : ""}: much tougher than a normal enemy. ${solo ? "You out-level it, so you may manage alone." : "Bring a group, or come back a few levels higher."}`;
  }
  if (c.rare) return `${name} is a rare spawn: it may not be there when you arrive.`;
  return null;
}
/** One soft area per objective cluster on this map, for quests in the log or available to pick up. */
function objectiveAreas(profile, index, creatures, mapId) {
  const out = [];
  if (!index || !profile) return out;
  const level = Number.isInteger(profile.level) ? profile.level : null;
  for (const r of relevantQuests(profile, index)) {
    if (r.status === "ready") continue;
    const rec = r.record || {};
    const locs = r.details?.objectiveLocations || rec.objectiveLocations || [];
    const objectives = rec.objectives || [];
    const indexes = [...new Set([...objectives.map((o) => o.index), ...locs.map((l) => l.index)])].filter(Number.isSafeInteger).sort((a, b) => a - b);
    for (const i of indexes) {
      const o = objectives.find((x) => x.index === i) || null, loc = locs.find((l) => l.index === i) || null;
      const type = o?.type || loc?.type || null;
      if (type === "talkTo") continue; // talking to an NPC is a pin, not an area
      const logged = r.log?.objectives?.[i - 1];
      if (logged?.done) continue;
      let points = (loc?.positions || []).filter((p) => p.mapId === mapId && pt(p));
      // Kill objectives without progress observations here fall back to where the creature itself was seen.
      if (!points.length && type === "monster" && o?.objectId) points = (index.pack.npcs[`npc:${o.objectId}`]?.positions || []).filter((p) => p.mapId === mapId && pt(p));
      if (!points.length) continue;
      const ref = type === "monster" && o?.objectId ? creatures?.get?.(o.objectId) || null : null;
      const name = type === "monster" ? index.pack.creatures?.[String(o?.objectId)]?.name || ref?.name || null : type === "item" ? index.pack.items?.[String(o?.objectId)]?.name || null : null;
      const required = o?.required ?? loc?.required ?? null;
      const label = name ? `${VERB[type] || ""} ${required > 1 ? required + " " : ""}${name}`.trim()
        : logged?.text ? String(logged.text).replace(/^\d+\/\d+\s+/, "") : typeof o?.text === "string" && o.text ? o.text : indexes.length === 1 && rec.objectiveEvidence ? rec.objectiveEvidence : `Objective ${i}`;
      const creature = ref ? { id: ref.id, name: name || ref.name, minLevel: ref.minLevel, maxLevel: ref.maxLevel, elite: Boolean(ref.elite), rare: Boolean(ref.rare), worldboss: Boolean(ref.worldboss), skull: Boolean(ref.skull), hostile: profile.faction ? ref.hostileTo.includes(profile.faction) : null } : null;
      const diff = creature ? difficulty(level, creature.maxLevel, creature.skull || creature.worldboss) : null;
      areaShapes(points).forEach((shape, k) => out.push({
        id: `oa:${r.id}:${i}:${k}`, kind: "objective-area", questId: r.id, questTitle: r.title || rec.title || `Quest #${r.id}`, status: r.status, index: i, type,
        label, target: name, progress: logged?.text || null, mapId, ...shape, creature, levels: creature ? levelText(creature) || null : null, difficulty: diff,
        warning: creatureWarning(creature, level), source: r.status === "available" ? "Reference; availability unverified" : "Your quest log + reference",
      }));
    }
  }
  return out;
}
// Elite, rare-elite and boss-level objective creatures on this map, one warning per creature.
function hostileCamps(areas) {
  const by = new Map();
  for (const a of areas) {
    const c = a.creature;
    if (!c || !(c.elite || c.worldboss || c.skull)) continue;
    const m = by.get(c.id) || { creatureId: c.id, name: c.name || `Creature #${c.id}`, levels: a.levels, elite: c.elite, rare: c.rare, worldboss: c.worldboss || c.skull, difficulty: a.difficulty, hostile: c.hostile, warning: a.warning, areaId: a.id, x: a.x, y: a.y, quests: [] };
    if (!m.quests.some((q) => q.id === a.questId)) m.quests.push({ id: a.questId, title: a.questTitle, status: a.status });
    by.set(c.id, m);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const FIND = { mining: { gather: "ore", label: "Mining node", sub: "Your mining find" }, herbalism: { gather: "herb", label: "Herb", sub: "Your herbalism find" }, chest: { gather: "chest", label: "Chest", sub: "A chest you opened (chests move between spots)" } };
function findPins(profile, mapId) {
  const out = [];
  for (const r of profile?.gathering?.records || []) {
    if (r.mapId !== mapId || !pt(r)) continue;
    const f = FIND[r.method] || FIND.herbalism;
    out.push({ id: `find:${r.id}`, kind: "find", gather: f.gather, label: r.name || f.label, sub: f.sub, mapId, x: r.x, y: r.y, lastSeen: r.observedAt?.slice?.(0, 10) || null, source: "Recorded by your addon" });
  }
  return out;
}
// Your remembered nodes as a heat map: every point on this map (herb/ore/chest drawn
// separately) plus counts per zone across all maps, busiest first.
function gatheringHeat(profile, mapId) {
  const zones = new Map(), points = [], totals = { herb: 0, ore: 0, chest: 0 };
  for (const r of profile?.gathering?.records || []) {
    const kind = FIND[r.method]?.gather;
    if (!kind || !pt(r)) continue;
    const z = zones.get(r.mapId) || { mapId: r.mapId, mapName: mapName(r.mapId), herb: 0, ore: 0, chest: 0, total: 0 };
    z[kind]++; z.total++; zones.set(r.mapId, z);
    if (r.mapId === mapId) { points.push({ kind, x: r.x, y: r.y }); totals[kind]++; }
  }
  return { points, totals, zones: [...zones.values()].sort((a, b) => b.total - a.total || a.mapName.localeCompare(b.mapName)) };
}

// Community pack (0.34): gathering spots at least 3 players reported, as their own "community" layer
// (never mixed with your finds), and NPC positions only where the bundled data has none.
const COMMUNITY_NODE = { herb: "Herb", ore: "Mining node", chest: "Chest" };
function communityPins(community, mapId, { staticNpcIds = new Set(), npcName = () => null, vendorIds = new Set() } = {}) {
  if (!community) return [];
  const { provenance } = require("./community.cjs");
  const out = [];
  for (const n of community.nodesByMap?.get(mapId) || []) {
    out.push({ id: `community:${n.kind}:${n.objectId ?? n.name}:${n.x}:${n.y}`, kind: "community", gather: n.kind, label: n.name || COMMUNITY_NODE[n.kind], sub: `${COMMUNITY_NODE[n.kind]} · ${provenance(n.installs)}`, mapId, x: n.x, y: n.y, installs: n.installs, itemIds: n.items.map((i) => i.itemId), community: true, source: `${provenance(n.installs)} · spots other players gathered, rounded to 0.5% of the map` });
  }
  for (const [npcId, positions] of community.npcPositions || []) {
    if (staticNpcIds.has(npcId)) continue;
    const p = positions.find((q) => q.mapId === mapId);
    if (!p) continue;
    const vendor = vendorIds.has(npcId) || community.vendors?.has(npcId);
    out.push({ id: `community-npc:${npcId}:${mapId}`, npcId, kind: vendor ? "vendor" : "npc", label: npcName(npcId) || `NPC #${npcId}`, sub: `${vendor ? "Vendor" : "Seen here"} · ${provenance(p.installs)}`, mapId, x: p.x, y: p.y, installs: p.installs, community: true, evidence: "community", source: `${provenance(p.installs)} · not in the bundled reference` });
  }
  return out;
}

class WorldMap {
  constructor({ getState, knowledge, npcReference, travelReference, vendorPack, insights, acquisitionPack, creaturePack = null, live, getCommunity = () => null }) {
    Object.assign(this, { getState, knowledge, live, npcReference, travelReference, vendorPack, insights, getCommunity });
    this.creatures = require("./creature-data.cjs").creatureIndex(creaturePack);
    this.static = buildStaticIndex({ knowledgePack: knowledge?.bundled?.pack, npcReference, travelReference, vendorPack, insights, acquisitionPack });
    this.staticNpcIds = new Set();
    for (const pins of this.static.values()) for (const p of pins) if (p.npcId) this.staticNpcIds.add(p.npcId);
  }
  community() { try { return this.getCommunity?.() || null; } catch { return null; } }
  npcName(npcId) {
    return this.knowledge?.bundled?.pack?.npcs?.[`npc:${npcId}`]?.name || this.creatures.get(npcId)?.name || null;
  }
  profile() { const s = this.getState(); return s.profiles.find((p) => p.id === s.activeProfileId) || null; }
  /** How much the bundled reference knows per leveling zone and faction (Help → Data coverage). */
  coverage() {
    if (this._coverage) return this._coverage;
    const zones = require("./leveling.cjs").loadLevelingPack().zones;
    const pack = this.knowledge?.bundled?.pack;
    const side = (sides, f) => !sides || !sides.length || sides.includes(f);
    const rows = zones.map((z) => {
      const row = { mapId: z.mapId, name: mapName(z.mapId), min: z.min, max: z.max, faction: z.faction, Horde: {}, Alliance: {} };
      for (const f of ["Horde", "Alliance"]) row[f] = { questGivers: 0, objectiveAreas: 0, classTrainers: 0, professionTrainers: 0, vendors: 0, flightMasters: 0 };
      for (const q of Object.values(pack?.quests || {})) {
        const giver = (q.givers || []).map((g) => pack.npcs?.[`${g.kind}:${g.id}`]).find((n) => n?.positions?.some((p) => p.mapId === z.mapId));
        const objective = (q.objectiveLocations || []).some((o) => o.positions?.some((p) => p.mapId === z.mapId));
        for (const f of ["Horde", "Alliance"]) {
          if (!side(q.sides, f)) continue;
          if (giver) row[f].questGivers++;
          if (objective) row[f].objectiveAreas++;
        }
      }
      const seen = { Horde: new Set(), Alliance: new Set() };
      const key = { "class-trainer": "classTrainers", "profession-trainer": "professionTrainers", vendor: "vendors", flight: "flightMasters" };
      for (const pin of this.static.get(z.mapId) || []) {
        const k = key[pin.kind]; if (!k) continue;
        for (const f of ["Horde", "Alliance"]) {
          const id = `${k}:${pin.npcId ?? pin.id}`;
          if (side(pin.sides, f) && !seen[f].has(id)) { seen[f].add(id); row[f][k]++; }
        }
      }
      return row;
    });
    this._coverage = { zones: rows, source: { build: pack?.build || null, builds: pack?.builds || null, observedThrough: pack?.observedThrough || null, attribution: pack?.attribution || null } };
    return this._coverage;
  }
  liveFrame(profile) {
    const st = this.live?.status?.();
    const f = st?.frame;
    if (!f?.position) return null;
    if (profile?.source?.kind === "wow-addon" && f.characterHash) {
      const key = require("./live-bridge.cjs").liveKeyFor(profile.source.id);
      if (key !== f.characterHash) return null; // unknown key (GUID not read yet) never binds
    }
    return f;
  }
  // Why a present live frame was not used: another saved character, or one not saved yet.
  liveIssue(profile, used) {
    const f = this.live?.status?.()?.frame;
    if (used || !f?.position || !f.characterHash || profile?.source?.kind !== "wow-addon") return null;
    return require("./live-bridge.cjs").isKnownLiveKey(f.characterHash) ? "other-character" : "unsaved-character";
  }
  maps() {
    return [...this.static.entries()].map(([mapId, pins]) => ({ mapId, name: mapName(mapId), count: pins.length })).filter((m) => MAP_NAMES[m.mapId] || m.count > 20).sort((a, b) => a.name.localeCompare(b.name));
  }
  build(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid world map request.");
    const profile = this.profile();
    const live = this.liveFrame(profile);
    const saved = pt(profile?.location) ? profile.location : null;
    const requested = Number.isSafeInteger(input.mapId) && input.mapId > 0 ? input.mapId : null;
    const mapId = requested || live?.position.mapId || saved?.mapId || 1454;
    const index = this.knowledge?.index?.(profile || {}) || this.knowledge?.bundled || null;
    const community = this.community();
    const shared = communityPins(community, mapId, { staticNpcIds: this.staticNpcIds, npcName: (id) => this.npcName(id), vendorIds: new Set((this.vendorPack?.vendors || []).map((v) => v.id)) });
    let pins = [...(this.static.get(mapId) || []), ...shared, ...questPins(profile, index, mapId), ...findPins(profile, mapId)];
    // Quest and personal pins draw above reference pins.
    pins.sort((a, b) => KINDS.indexOf(b.kind) - KINDS.indexOf(a.kind));
    if (pins.length > MAX_PINS) pins = pins.slice(pins.length - MAX_PINS);
    // NPCs friendly only to the other faction stay available but are marked (hidden by default in the app).
    if (profile?.faction) pins = pins.map((p) => (p.sides && !p.sides.includes(profile.faction) ? { ...p, otherFaction: true } : p));
    const counts = {};
    for (const p of pins) if (!p.otherFaction) counts[p.kind] = (counts[p.kind] || 0) + 1;
    counts.otherFaction = pins.filter((p) => p.otherFaction).length;
    // Soft areas where quest objectives happen, drawn under the pins.
    const areas = objectiveAreas(profile, index, this.creatures, mapId).slice(0, MAX_AREAS);
    counts["objective-area"] = areas.length;
    const heat = gatheringHeat(profile, mapId);
    counts.heat = heat.points.length;
    return {
      mapId, mapName: mapName(mapId), maps: this.maps(),
      player: {
        live: live && live.position.mapId === mapId ? { x: live.position.x, y: live.position.y, facing: live.position.facing, ageMs: live.ageMs, mounted: live.mounted, combat: live.combat } : null,
        liveElsewhere: live && live.position.mapId !== mapId ? { mapId: live.position.mapId, mapName: mapName(live.position.mapId) } : null,
        saved: saved && saved.mapId === mapId ? { x: saved.x, y: saved.y, at: profile.source?.updatedAt || null } : null,
        name: profile?.name || null, faction: profile?.faction || null, level: profile?.level || null,
        liveIssue: this.liveIssue(profile, live),
        // The renderer applies streamed frames only when they carry this key (null: not an addon character).
        liveKey: profile?.source?.kind === "wow-addon" ? require("./live-bridge.cjs").liveKeyFor(profile.source.id) ?? -1 : null,
      },
      pins, counts, areas, camps: hostileCamps(areas), heat,
      attribution: "Reference data from Efficient Games (https://efficient.games), CC BY 4.0. Positions are approximate community observations." + (community ? " Community layer: spots and NPCs at least 3 Backstage Forever players shared anonymously." : ""),
      community: community ? { version: community.version, generatedAt: community.generatedAt } : null,
    };
  }
  // Everything known about one NPC, in the selected character's terms.
  npc(npcId) {
    if (!Number.isSafeInteger(npcId) || npcId <= 0) throw Error("Invalid NPC.");
    const profile = this.profile();
    const pack = this.knowledge?.bundled?.pack || null;
    const ref = pack?.npcs?.[`npc:${npcId}`] || null;
    const trainer = (this.insights?.trainers || []).find((t) => t.id === npcId) || null;
    const vendor = (this.vendorPack?.vendors || []).find((v) => v.id === npcId) || null;
    const located = (this.npcReference?.npcs || []).find((n) => n.id === npcId) || null;
    const flight = (this.travelReference?.nodes || []).find((n) => n.flightMaster?.npcId === npcId) || null;
    const community = this.community();
    const cPositions = community?.npcPositions?.get(npcId) || [], cVendor = community?.vendors?.get(npcId) || [];
    const cRecipes = community?.recipes?.get(npcId) || [];
    const name = ref?.name || trainer?.name || vendor?.name || located?.name || ((cPositions.length || cVendor.length || cRecipes.length) ? this.npcName(npcId) || `NPC #${npcId}` : null);
    if (!name) return null;
    const sides = ref?.side ? [ref.side] : friendlyTo(trainer?.observedReactionsByFaction || vendor?.observedReactionsByFaction);
    const bundledPositions = ref?.positions?.length ? ref.positions : trainer?.positions?.length ? trainer.positions : vendor?.positions?.length ? vendor.positions : located?.positions || [];
    // Community positions, wares and recipes only fill gaps in the bundled reference, and say so.
    const { provenance } = require("./community.cjs");
    const positions = bundledPositions.length ? bundledPositions : cPositions;
    const communityNotes = [];
    if (!bundledPositions.length && cPositions.length) communityNotes.push(`Position from the community · ${provenance(cPositions[0].installs)}`);
    const communityVendor = !vendor && cVendor.length ? { items: cVendor.slice(0, 60).map((i) => ({ itemId: i.itemId, name: `Item #${i.itemId}`, installs: i.installs })), source: provenance(Math.max(...cVendor.map((i) => i.installs))) } : null;
    if (communityVendor) communityNotes.push(`Wares from the community · ${communityVendor.source}`);
    const communityRecipes = cRecipes.slice(0, 40).map((r) => ({ ...r }));
    if (communityRecipes.length) communityNotes.push(`Recipes from the community · ${provenance(Math.max(...cRecipes.map((r) => r.installs)))}`);
    const level = Number.isInteger(profile?.level) ? profile.level : null;
    const active = new Map((profile?.quests || []).map((q) => [q.id, q]));
    const done = new Set(profile?.history?.completedIdsKnown ? profile.history.completedIds : []);
    const status = (q) => {
      if (done.has(q.id)) return "done";
      const a = active.get(q.id);
      if (a) return a.complete ? "ready" : "active";
      if (profile?.faction && q.sides?.length && !q.sides.includes(profile.faction)) return "other-faction";
      if (level !== null && q.minLevel && level < q.minLevel) return "too-high";
      if (level !== null && q.level && q.level < level - 6) return "low";
      return "available";
    };
    const ORDER = { ready: 0, active: 1, available: 2, low: 3, "too-high": 4, done: 5, "other-faction": 6 };
    const quests = (role) => Object.values(pack?.quests || {}).filter((q) => (q[role] || []).some((r) => r.kind === "npc" && r.id === npcId))
      .map((q) => ({ id: q.id, title: q.title, level: q.level ?? null, minLevel: q.minLevel ?? null, status: status(q) }))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.level ?? 99) - (b.level ?? 99)).slice(0, 40);
    const tKind = trainer ? trainerKind(trainer.title) : null;
    // A class trainer only teaches its own class (weapon masters teach everyone).
    const teaches = tKind === "class-trainer" ? (/^(\w+) trainer$/i.exec(trainer.title || "")?.[1] || null) : null;
    const forYou = !teaches || teaches.toLowerCase() === "portal" ? (teaches ? /mage/i.test(profile?.className || "") : true) : !profile?.className || teaches.toLowerCase() === String(profile.className).toLowerCase();
    const given = quests("givers"), turnIns = quests("turnIns");
    const roles = [];
    if (flight) roles.push(`Flight Master · ${flight.label}`);
    if (trainer) roles.push(trainer.title || "Trainer");
    if (vendor || communityVendor) roles.push("Vendor");
    if (given.length) roles.push("Quest giver");
    return {
      npcId, name, roles, sides,
      otherFaction: Boolean(profile?.faction && sides && !sides.includes(profile.faction)),
      places: positions.slice(0, 6).map((p) => ({ mapId: p.mapId, mapName: mapName(p.mapId), x: p.x, y: p.y })),
      questsGiven: given, questsTurnedIn: turnIns,
      trainer: trainer ? {
        title: trainer.title || "Trainer", kind: tKind, teaches, forYou,
        services: (trainer.services || []).map((sv) => ({ name: sv.name, rank: sv.rankText || null, level: sv.observedLevel || null, skillRank: sv.skillRank || null,
          learnable: tKind === "class-trainer" && forYou && level !== null ? (sv.observedLevel || 0) <= level : null }))
          .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)),
      } : null,
      vendor: vendor ? { items: (vendor.listings || []).filter((l) => l.name).map((l) => ({ itemId: l.itemId, name: l.name })) } : communityVendor,
      communityRecipes, communityNotes,
      flight: flight ? { town: flight.label } : null,
      lastSeen: ref?.lastSeen || trainer?.lastSeen || vendor?.lastSeen || located?.lastSeen || null,
      source: ref || trainer || vendor || located ? "Efficient Games, CC BY 4.0" + (communityNotes.length ? " · Community" : "") : "Community",
    };
  }
  search(query) {
    if (typeof query !== "string" || !query.trim() || query.length > 80) throw Error("Invalid world map search.");
    const q = norm(query);
    const words = q.split(" ");
    const profile = this.profile();
    const live = this.liveFrame(profile);
    const here = live?.position || (pt(profile?.location) ? profile.location : null);
    const results = [];
    const kindWords = { flight: ["flight", "fly", "gryphon", "wind rider", "bat"], "class-trainer": ["trainer", "train", "class"], "profession-trainer": ["trainer", "train", "profession"], vendor: ["vendor", "sell", "merchant", "shop"], herb: ["herb", "herbs"], ore: ["ore", "mine", "mining", "vein"] };
    for (const [mapId, pins] of this.static) {
      for (const p of pins) {
        if (p.kind === "town") continue;
        const hay = norm([p.label, p.sub, ...(p.sells || [])].join(" "));
        const kindHit = Object.entries(kindWords).some(([k, ws]) => p.kind === k && ws.some((w) => q.includes(w)));
        const textHit = words.every((w) => hay.includes(w));
        if (!kindHit && !textHit) continue;
        const sameMap = here && here.mapId === mapId;
        const dist = sameMap ? Math.hypot(p.x - here.x, p.y - here.y) : null;
        results.push({ ...p, mapName: mapName(mapId), distance: dist, score: (norm(p.label) === q ? 3 : 0) + (textHit ? 3 : 0) + (sameMap ? 2 : 0) + (kindHit ? 1 : 0) });
      }
    }
    results.sort((a, b) => b.score - a.score || (a.distance ?? 9) - (b.distance ?? 9) || a.label.localeCompare(b.label));
    const unique = [];
    const keys = new Set();
    for (const r of results) { const k = `${r.npcId || r.id}:${r.mapId}`; if (keys.has(k)) continue; keys.add(k); unique.push(r); if (unique.length >= 25) break; }
    return { query, results: unique, from: here ? { mapId: here.mapId, mapName: mapName(here.mapId), live: Boolean(live) } : null };
  }
}
module.exports = { WorldMap, findPins, communityPins, gatheringHeat, buildStaticIndex, questPins, relevantQuests, objectiveAreas, hostileCamps, areaShapes, difficulty, greyLevel, creatureWarning, KINDS, mapName, trainerKind, friendlyTo };

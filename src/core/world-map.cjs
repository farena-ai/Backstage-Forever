"use strict";
// World Map model: everything a player wants to find on one zone map, from the
// bundled, source-labelled references plus the player's own quests, finds and live link.
const { MAP_NAMES } = require("./companion-tools.cjs");

const GATHER_SPELLS = { 2366: "herb", 2368: "herb", 3570: "herb", 2575: "ore", 2576: "ore", 3564: "ore" };
const KINDS = ["quest-turnin", "quest-giver", "quest-objective", "flight", "trainer", "vendor", "herb", "ore", "find", "town", "npc"];
const MAX_PINS = 1500;
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
  for (const t of insights?.trainers || []) special.set(t.id, { kind: "trainer", sub: t.title || "Trainer", positions: t.positions, lastSeen: t.lastSeen, extra: { services: (t.services || []).length } });
  for (const v of vendorPack?.vendors || []) if (!special.has(v.id)) special.set(v.id, { kind: "vendor", sub: "Vendor", positions: v.positions, lastSeen: v.lastSeen, extra: { sells: (v.listings || []).slice(0, 6).map((l) => l.name).filter(Boolean) } });
  for (const [id, town] of flightNpcs) special.set(id, { ...(special.get(id) || {}), kind: "flight", sub: `Flight Master · ${town}` });
  const seen = new Set();
  const npcRows = [];
  if (knowledgePack) for (const n of Object.values(knowledgePack.npcs || {})) if (n.kind === "npc") npcRows.push({ ...n, build: knowledgePack.build, tier: "observed" });
  for (const n of npcReference?.npcs || []) npcRows.push({ ...n, build: npcReference.build, tier: "historical" });
  for (const n of npcRows) {
    const s = special.get(n.id);
    const positions = n.positions?.length ? n.positions : s?.positions || [];
    for (const p of positions.slice(0, 3)) {
      const key = `${n.id}:${p.mapId}:${Math.round(p.x * 200)}:${Math.round(p.y * 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add({ id: `npc:${n.id}:${p.mapId}:${Math.round(p.x * 1000)}`, npcId: n.id, kind: s?.kind || "npc", label: n.name, sub: s?.sub || null, mapId: p.mapId, x: p.x, y: p.y, lastSeen: n.lastSeen || s?.lastSeen || null, build: n.build, evidence: n.tier, ...(s?.extra || {}), source: "Efficient Games, CC BY 4.0" });
    }
  }
  // Trainers/vendors that the NPC packs do not list still appear.
  for (const [id, s] of special) {
    if (npcRows.some((n) => n.id === id)) continue;
    for (const p of (s.positions || []).slice(0, 2)) add({ id: `npc:${id}:${p.mapId}:${Math.round(p.x * 1000)}`, npcId: id, kind: s.kind, label: s.label || `NPC #${id}`, sub: s.sub, mapId: p.mapId, x: p.x, y: p.y, lastSeen: s.lastSeen || null, evidence: "historical", ...(s.extra || {}), source: "Efficient Games, CC BY 4.0" });
  }
  for (const r of acquisitionPack?.rows || []) {
    if (r.kind !== "gathered-object-loot") continue;
    const kind = GATHER_SPELLS[r.gatherSpellId] || "herb";
    for (const p of (r.positions || []).slice(0, 6)) add({ id: `node:${r.sourceKey}:${p.mapId}:${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`, kind, label: r.referenceName || "Resource", sub: kind === "ore" ? "Mining node (reference)" : "Herb (reference)", mapId: p.mapId, x: p.x, y: p.y, lastSeen: r.observedOn || null, evidence: "historical", source: "Efficient Games, CC BY 4.0" });
  }
  return byMap;
}

function questPins(profile, index, mapId) {
  const out = [];
  if (!index || !profile) return out;
  const qp = profile.clientBuild && profile.clientBuild !== index.pack.build ? { ...profile, clientBuild: undefined } : profile;
  const npcAt = (ref) => index.pack.npcs[`${ref.kind}:${ref.id}`];
  const active = new Set();
  for (const q of profile.quests || []) {
    active.add(q.id);
    let d;
    try { d = index.details(qp, q.id); } catch { continue; }
    if (d.status === "missing") continue;
    if (q.complete) {
      for (const t of d.turnIns) {
        const n = npcAt(t);
        for (const p of n?.positions || []) if (p.mapId === mapId) out.push({ id: `qt:${q.id}:${t.id}`, kind: "quest-turnin", label: n.name, sub: `Turn in: ${q.title}`, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      }
    } else {
      for (const o of d.objectiveLocations) for (const p of (o.positions || []).slice(0, 3)) if (p.mapId === mapId) out.push({ id: `qo:${q.id}:${o.index}:${Math.round(p.x * 1000)}`, kind: "quest-objective", label: q.objectives?.[o.index - 1]?.text || `Objective ${o.index}`, sub: q.title, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      for (const o of d.record.objectives || []) {
        if (!["talkTo", "monster"].includes(o.type) || !o.objectId) continue;
        const done = q.objectives?.[o.index - 1]?.done;
        if (done) continue;
        const n = index.pack.npcs[`npc:${o.objectId}`];
        for (const p of n?.positions || []) if (p.mapId === mapId) out.push({ id: `qn:${q.id}:${o.objectId}`, kind: "quest-objective", label: n.name, sub: `${o.text} · ${q.title}`, questId: q.id, mapId, x: p.x, y: p.y, source: "Your quest log + reference" });
      }
    }
  }
  // Quests you could pick up here: observed in play, not active, not known-complete, level and faction fit.
  const done = new Set(profile.history?.completedIdsKnown ? profile.history.completedIds : []);
  for (const q of Object.values(index.pack.quests)) {
    if (!q.observedInPlay || active.has(q.id) || done.has(q.id) || !q.givers?.length) continue;
    if (q.minLevel && Number.isInteger(profile.level) && profile.level < q.minLevel) continue;
    if (q.level && Number.isInteger(profile.level) && (q.level < profile.level - 6 || q.level > profile.level + 4)) continue;
    if (profile.faction && q.sides?.length && !q.sides.includes(profile.faction)) continue;
    for (const g of q.givers.slice(0, 1)) {
      const n = npcAt(g);
      for (const p of (n?.positions || []).slice(0, 1)) if (p.mapId === mapId) out.push({ id: `qg:${q.id}`, kind: "quest-giver", label: n.name, sub: `${q.title} (level ${q.level ?? "?"})`, questId: q.id, mapId, x: p.x, y: p.y, source: "Reference; availability unverified" });
    }
  }
  return out;
}

function findPins(profile, mapId) {
  const out = [];
  for (const r of profile?.gathering?.records || []) {
    if (r.mapId !== mapId || !pt(r)) continue;
    out.push({ id: `find:${r.id}`, kind: "find", gather: r.method === "mining" ? "ore" : "herb", label: r.name || (r.method === "mining" ? "Mining node" : "Herb"), sub: `Your ${r.method === "mining" ? "mining" : "herbalism"} find`, mapId, x: r.x, y: r.y, lastSeen: r.observedAt?.slice?.(0, 10) || null, source: "Recorded by your addon" });
  }
  return out;
}

class WorldMap {
  constructor({ getState, knowledge, npcReference, travelReference, vendorPack, insights, acquisitionPack, live }) {
    Object.assign(this, { getState, knowledge, live });
    this.static = buildStaticIndex({ knowledgePack: knowledge?.bundled?.pack, npcReference, travelReference, vendorPack, insights, acquisitionPack });
  }
  profile() { const s = this.getState(); return s.profiles.find((p) => p.id === s.activeProfileId) || null; }
  liveFrame(profile) {
    const st = this.live?.status?.();
    const f = st?.frame;
    if (!f?.position) return null;
    if (profile?.source?.kind === "wow-addon" && f.characterHash) {
      const key = require("./live-bridge.cjs").liveKeyFor(profile.source.id);
      if (key !== null && key !== f.characterHash) return null;
    }
    return f;
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
    let pins = [...(this.static.get(mapId) || []), ...questPins(profile, index, mapId), ...findPins(profile, mapId)];
    // Quest and personal pins draw above reference pins.
    pins.sort((a, b) => KINDS.indexOf(b.kind) - KINDS.indexOf(a.kind));
    if (pins.length > MAX_PINS) pins = pins.slice(pins.length - MAX_PINS);
    const counts = {};
    for (const p of pins) counts[p.kind] = (counts[p.kind] || 0) + 1;
    return {
      mapId, mapName: mapName(mapId), maps: this.maps(),
      player: {
        live: live && live.position.mapId === mapId ? { x: live.position.x, y: live.position.y, facing: live.position.facing, ageMs: live.ageMs, mounted: live.mounted, combat: live.combat } : null,
        liveElsewhere: live && live.position.mapId !== mapId ? { mapId: live.position.mapId, mapName: mapName(live.position.mapId) } : null,
        saved: saved && saved.mapId === mapId ? { x: saved.x, y: saved.y, at: profile.source?.updatedAt || null } : null,
        name: profile?.name || null, faction: profile?.faction || null, level: profile?.level || null,
      },
      pins, counts,
      attribution: "Reference data from Efficient Games (https://efficient.games), CC BY 4.0. Positions are approximate community observations.",
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
    const kindWords = { flight: ["flight", "fly", "gryphon", "wind rider", "bat"], trainer: ["trainer", "train"], vendor: ["vendor", "sell", "merchant", "shop"], herb: ["herb", "herbs"], ore: ["ore", "mine", "mining", "vein"] };
    for (const [mapId, pins] of this.static) {
      for (const p of pins) {
        if (p.kind === "town") continue;
        const hay = norm([p.label, p.sub, ...(p.sells || [])].join(" "));
        const kindHit = Object.entries(kindWords).some(([k, ws]) => p.kind === k && ws.some((w) => q.includes(w)));
        const textHit = words.every((w) => hay.includes(w));
        if (!kindHit && !textHit) continue;
        const sameMap = here && here.mapId === mapId;
        const dist = sameMap ? Math.hypot(p.x - here.x, p.y - here.y) : null;
        results.push({ ...p, mapName: mapName(mapId), distance: dist, score: (norm(p.label) === q ? 3 : 0) + (sameMap ? 2 : 0) + (kindHit ? 1 : 0) });
      }
    }
    results.sort((a, b) => b.score - a.score || (a.distance ?? 9) - (b.distance ?? 9) || a.label.localeCompare(b.label));
    const unique = [];
    const keys = new Set();
    for (const r of results) { const k = `${r.npcId || r.id}:${r.mapId}`; if (keys.has(k)) continue; keys.add(k); unique.push(r); if (unique.length >= 25) break; }
    return { query, results: unique, from: here ? { mapId: here.mapId, mapName: mapName(here.mapId), live: Boolean(live) } : null };
  }
}
module.exports = { WorldMap, buildStaticIndex, questPins, KINDS, mapName };

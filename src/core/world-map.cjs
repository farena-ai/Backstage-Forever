"use strict";
// World Map model: everything a player wants to find on one zone map, from the
// bundled, source-labelled references plus the player's own quests, finds and live link.
const { MAP_NAMES } = require("./companion-tools.cjs");

const GATHER_SPELLS = { 2366: "herb", 2368: "herb", 3570: "herb", 2575: "ore", 2576: "ore", 3564: "ore" };
const KINDS = ["quest-turnin", "quest-giver", "quest-objective", "flight", "class-trainer", "profession-trainer", "vendor", "herb", "ore", "find", "town", "npc"];
// Class trainers (and weapon/portal masters) teach your class; everything else trains a profession.
const CLASS_TITLE = /^(warrior|paladin|hunter|rogue|priest|shaman|mage|warlock|druid|portal) trainer$|weapon master/i;
const trainerKind = (title) => (CLASS_TITLE.test(title || "") ? "class-trainer" : "profession-trainer");
// Factions an NPC is friendly to, from observed reactions (4+ is neutral or better).
function friendlyTo(reactions) {
  const out = [];
  for (const [f, rs] of Object.entries(reactions || {})) if ((rs || []).some((r) => r >= 4)) out.push(f);
  return out.length ? out : null;
}
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
  for (const t of insights?.trainers || []) special.set(t.id, { kind: trainerKind(t.title), sub: t.title || "Trainer", label: t.name, positions: t.positions, lastSeen: t.lastSeen, sides: friendlyTo(t.observedReactionsByFaction), extra: { services: (t.services || []).length } });
  for (const v of vendorPack?.vendors || []) if (!special.has(v.id)) special.set(v.id, { kind: "vendor", sub: "Vendor", label: v.name, positions: v.positions, lastSeen: v.lastSeen, sides: friendlyTo(v.observedReactionsByFaction), extra: { sells: (v.listings || []).slice(0, 6).map((l) => l.name).filter(Boolean) } });
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
    Object.assign(this, { getState, knowledge, live, npcReference, travelReference, vendorPack, insights });
    this.static = buildStaticIndex({ knowledgePack: knowledge?.bundled?.pack, npcReference, travelReference, vendorPack, insights, acquisitionPack });
  }
  profile() { const s = this.getState(); return s.profiles.find((p) => p.id === s.activeProfileId) || null; }
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
    let pins = [...(this.static.get(mapId) || []), ...questPins(profile, index, mapId), ...findPins(profile, mapId)];
    // Quest and personal pins draw above reference pins.
    pins.sort((a, b) => KINDS.indexOf(b.kind) - KINDS.indexOf(a.kind));
    if (pins.length > MAX_PINS) pins = pins.slice(pins.length - MAX_PINS);
    // NPCs friendly only to the other faction stay available but are marked (hidden by default in the app).
    if (profile?.faction) pins = pins.map((p) => (p.sides && !p.sides.includes(profile.faction) ? { ...p, otherFaction: true } : p));
    const counts = {};
    for (const p of pins) if (!p.otherFaction) counts[p.kind] = (counts[p.kind] || 0) + 1;
    counts.otherFaction = pins.filter((p) => p.otherFaction).length;
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
      pins, counts,
      attribution: "Reference data from Efficient Games (https://efficient.games), CC BY 4.0. Positions are approximate community observations.",
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
    const name = ref?.name || trainer?.name || vendor?.name || located?.name || null;
    if (!name) return null;
    const sides = ref?.side ? [ref.side] : friendlyTo(trainer?.observedReactionsByFaction || vendor?.observedReactionsByFaction);
    const positions = ref?.positions?.length ? ref.positions : trainer?.positions || vendor?.positions || located?.positions || [];
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
    if (vendor) roles.push("Vendor");
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
      vendor: vendor ? { items: (vendor.listings || []).filter((l) => l.name).map((l) => ({ itemId: l.itemId, name: l.name })) } : null,
      flight: flight ? { town: flight.label } : null,
      lastSeen: ref?.lastSeen || trainer?.lastSeen || vendor?.lastSeen || located?.lastSeen || null,
      source: "Efficient Games, CC BY 4.0",
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
module.exports = { WorldMap, buildStaticIndex, questPins, KINDS, mapName, trainerKind, friendlyTo };

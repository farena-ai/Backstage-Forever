"use strict";
// Live moments: the notable things that just happened in game (a death, an elite, rare or boss
// kill, a cleared dungeon, a profession milestone, a new zone or flight path, an equipped upgrade,
// a finished quest chain), turned into short, real sentences for the app's moment cards.
// Raw moments arrive from the live strip (BackstageForeverMoments.lua, kind 3 pages); ids are
// resolved to names here from the bundled packs. Memory only, except the on/off settings.
const fs = require("node:fs");
const path = require("node:path");
const { MAP_NAMES } = require("./map-names.cjs");

// Strip type codes (BackstageForeverMoments.lua). "dungeon" and "chain" are worked out here.
const TYPES = Object.freeze({ 1: "death", 2: "elite", 3: "rare", 4: "boss", 5: "profession", 6: "zone", 7: "flight", 8: "upgrade" });
const KINDS = Object.freeze(["death", "elite", "rare", "boss", "dungeon", "profession", "zone", "flight", "upgrade", "chain"]);
const LABELS = Object.freeze({ death: "Death screen", elite: "Elite kills", rare: "Rare kills", boss: "Boss kills", dungeon: "Dungeons cleared", profession: "Profession milestones", zone: "New zones", flight: "Flight paths", upgrade: "Gear upgrades", chain: "Quest chains" });
const CLASSIFICATION = Object.freeze({ 1: "elite", 2: "rare", 3: "rare elite", 4: "world boss" });
const SKILLS = Object.freeze({ 129: "First Aid", 164: "Blacksmithing", 165: "Leatherworking", 171: "Alchemy", 182: "Herbalism", 185: "Cooking", 186: "Mining", 197: "Tailoring", 202: "Engineering", 333: "Enchanting", 356: "Fishing", 393: "Skinning" });
// Trainer titles per profession ("Mining Trainer", "Miner", "Journeyman Blacksmith"...).
const STEMS = Object.freeze({ 129: /first aid/i, 164: /blacksmith/i, 165: /leatherwork/i, 171: /alchem/i, 182: /herbalis/i, 185: /cook/i, 186: /min(?:er|ing)/i, 197: /tailor/i, 202: /engineer/i, 333: /enchant/i, 356: /fish/i, 393: /skin(?:ner|ning)/i });
// Rank limit -> the next rank, and the character level it needs (Classic rules).
const NEXT_TIER = Object.freeze({ 75: { name: "Journeyman", max: 150, level: 10 }, 150: { name: "Expert", max: 225, level: 20 }, 225: { name: "Artisan", max: 300, level: 35 } });
const CAPITALS = Object.freeze({ Alliance: [1453, 1455, 1457], Horde: [1454, 1456, 1458] });
const SLOTS = Object.freeze({ 1: "head", 2: "neck", 3: "shoulders", 4: "shirt", 5: "chest", 6: "waist", 7: "legs", 8: "feet", 9: "wrists", 10: "hands", 11: "finger", 12: "finger", 13: "trinket", 14: "trinket", 15: "back", 16: "main hand", 17: "off hand", 18: "ranged", 19: "tabard" });
// Death review tips by code (BackstageForeverDeathReview): the short one and "what to change".
const TIPS = Object.freeze({
  1: { short: "Several enemies at once: pull one at a time.", change: "Fight one enemy at a time. Look around before you attack, pull from the edge of a group, and back away from packs instead of running through them." },
  2: { short: "That was an elite: much tougher than normal.", change: "Elites (gold dragon on their portrait) hit several times harder than normal enemies. Bring a group, or come back a few levels higher." },
  3: { short: "It was well above your level.", change: "Enemies three or more levels above you hit harder and resist more. Quest somewhere closer to your level first; the Now page shows where." },
  4: { short: "Most of the damage came from a spell.", change: "Most of the damage came from one spell. Interrupt it if you can, or step out of whatever is on the ground." },
  5: { short: "Eat and drink to full between fights.", change: "Start every fight at full health and mana: eat and drink between fights, and open with your strongest abilities." },
});
const CORPSE_RUN = Object.freeze([
  "Click Release Spirit: you appear as a ghost at the nearest graveyard.",
  "Run back to your body (the in-game arrow points the way) and click Resurrect when you are close.",
  "Or talk to the Spirit Healer at the graveyard to revive on the spot, at the cost of durability and ten minutes of weakness.",
]);
const MAX_HISTORY = 30, DEATH_FALLBACK_MS = 4000, DEATH_MERGE_MS = 20000;

const norm = (s) => String(s || "").toLowerCase().replace(/[’‘']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const pct = (v) => `${Math.round(v)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Indexes over the bundled packs. Every pack is optional; missing data gives plainer sentences. */
function buildReference({ creatures = null, knowledge = null, bossLoot = null, encounters = null, insights = null, baseline = [] } = {}) {
  const creature = new Map();
  for (const c of Object.values(knowledge?.creatures || {})) if (Number.isSafeInteger(c?.id) && c.name) creature.set(c.id, { name: c.name });
  for (const c of creatures?.creatures || []) if (Number.isSafeInteger(c?.id) && c.name) creature.set(c.id, { ...creature.get(c.id), ...c });
  // Instances: atlas id -> { name, bosses (in order), instanceMap }.
  const instances = new Map();
  for (const row of baseline) instances.set(row[0], { id: row[0], name: row[1], kind: row[2], instanceMap: row[9], bosses: row[10] || [] });
  const bosses = new Map();
  for (const [id, inst] of Object.entries(bossLoot?.instances || {})) {
    for (const b of inst?.bosses || []) for (const npc of b.npcIds || []) if (Number.isSafeInteger(npc)) bosses.set(npc, { name: b.name, instance: id });
  }
  const encounter = new Map();
  for (const e of encounters?.encounters || []) if (Number.isSafeInteger(e?.id)) encounter.set(e.id, { name: e.name, instanceMap: e.instanceMap });
  const quests = new Map(), prev = new Map();
  for (const q of Object.values(knowledge?.quests || {})) {
    if (!Number.isSafeInteger(q?.id)) continue;
    quests.set(q.id, { id: q.id, title: q.title, next: Number.isSafeInteger(q.nextQuestId) ? q.nextQuestId : null });
    if (Number.isSafeInteger(q.nextQuestId) && q.nextQuestId !== q.id) prev.set(q.nextQuestId, q.id);
  }
  const items = new Map();
  for (const i of Object.values(knowledge?.items || {})) if (Number.isSafeInteger(i?.id) && i.name) items.set(i.id, i.name);
  for (const i of Array.isArray(insights?.items) ? insights.items : []) if (Number.isSafeInteger(i?.id) && i.name && !items.has(i.id)) items.set(i.id, i.name);
  return { creature, instances, bosses, encounter, quests, prev, items, trainers: insights?.trainers || [] };
}

// Instance for a boss: by its NPC id (boss loot), else its name in the classic boss lists.
function bossInstance(ref, { npcId = 0, name = "", instanceMap = null } = {}) {
  const byNpc = npcId && ref.bosses.get(npcId);
  if (byNpc) return { boss: byNpc.name, instance: ref.instances.get(byNpc.instance) || null };
  const n = norm(name);
  for (const inst of ref.instances.values()) {
    if (instanceMap && inst.instanceMap !== instanceMap) continue;
    const hit = n && inst.bosses.find((b) => norm(b) === n);
    if (hit) return { boss: hit, instance: inst };
  }
  if (instanceMap) for (const inst of ref.instances.values()) if (inst.instanceMap === instanceMap) return { boss: name || null, instance: inst };
  return { boss: name || null, instance: null };
}
const friendlyTo = (faction, t) => !faction || !t.observedReactionsByFaction || !Object.keys(t.observedReactionsByFaction).length || (t.observedReactionsByFaction[faction] || []).some((v) => v >= 4);
const mapName = (id) => MAP_NAMES[id] || null;
/** Where to learn the next rank: a trainer teaching it, else a trainer of that profession; capitals first. */
function tierTrainer(ref, skillLineId, tierName, { faction = null, mapId = null } = {}) {
  const skill = SKILLS[skillLineId], stem = STEMS[skillLineId];
  if (!skill || !stem) return null;
  const mine = ref.trainers.filter((t) => friendlyTo(faction, t) && Array.isArray(t.positions) && t.positions.length);
  const teaches = (t) => (t.services || []).some((s) => s.name === `${tierName} ${skill}` || (s.name === skill && s.rankText === tierName));
  const forProfession = (t) => stem.test(t.title || "") && !/junior/i.test(t.title || "");
  const capitals = CAPITALS[faction] || [...CAPITALS.Alliance, ...CAPITALS.Horde];
  const rank = (t) => { const m = t.positions[0].mapId; return (t.positions.some((p) => p.mapId === mapId) ? 0 : capitals.includes(m) ? 1 : 2) * 10 + (capitals.indexOf(m) + 1 || 9); };
  const pick = (list) => list.sort((a, b) => rank(a) - rank(b))[0] || null;
  const t = pick(mine.filter(teaches)) || pick(mine.filter(forProfession));
  if (!t) return null;
  const at = t.positions.find((p) => p.mapId === mapId) || t.positions[0];
  return { npcId: t.id, name: t.name, title: t.title, mapId: at.mapId, mapName: mapName(at.mapId), x: at.x, y: at.y, teaches: teaches(t) };
}

/**
 * Raw strip moment -> a card: { kind, title, line, ...details }, or null when it cannot be told.
 * ctx: { level, faction, mapId } of the character now (all optional); zoneBand(mapId) -> { min, max }.
 */
function resolveMoment(raw, ref, ctx = {}, { zoneBand = () => null } = {}) {
  const kind = TYPES[raw?.type];
  if (!kind) return null;
  const { a = 0, b = 0, c = 0 } = raw;
  const npc = (id) => (id ? ref.creature.get(id) || null : null);
  const levelText = (lvl, elite) => (lvl || elite ? ` (${[lvl ? `level ${lvl}` : "", elite ? elite : ""].filter(Boolean).join(", ")})` : "");
  if (kind === "death") {
    const killerLevel = b >> 8, share = b & 255, elite = Boolean(c & 1), tip = (c >> 1) & 7, others = (c >> 4) & 7;
    const info = npc(a);
    const level = killerLevel || (info?.maxLevel ?? null);
    const isElite = elite || Boolean(info?.elite);
    const killer = info?.name || (a ? `Creature #${a}` : null);
    const t = TIPS[tip] || TIPS[5];
    const above = level && ctx.level ? level - ctx.level : null;
    const review = killer
      ? `${killer}${levelText(level, isElite ? "elite" : "")} did ${pct(share)} of the damage${others ? `, with ${others === 1 ? "1 other enemy" : `${others} other enemies`}` : ""}.`
      : "No enemy damage was recorded in your last seconds (a fall, drowning or something unseen?).";
    return {
      kind, title: "You died", line: `${review} Tip: ${tip === 3 && above > 0 ? `it was ${plural(above, "level")} above you.` : t.short}`,
      death: { killer, npcId: a || null, level: level || null, elite: isElite, share: killer ? share : null, others, aboveYou: above, tip: t.short, change: t.change, corpseRun: CORPSE_RUN },
    };
  }
  if (kind === "elite" || kind === "rare") {
    const info = npc(a), name = info?.name || `Creature #${a}`;
    const boss = ref.bosses.get(a);
    if (boss) return resolveMoment({ type: 4, a, b: 0, c }, ref, ctx, { zoneBand });
    const label = CLASSIFICATION[c] || (kind === "rare" ? "rare" : "elite");
    const lvl = b || info?.maxLevel || null;
    const above = lvl && ctx.level ? lvl - ctx.level : null;
    const extra = kind === "rare" ? " Rares carry better loot than most: check what it dropped." : above >= 2 ? ` It was ${plural(above, "level")} above you.` : " Elites hit hard: well fought.";
    return { kind, title: kind === "rare" ? "Rare defeated" : "Elite defeated", subject: name, npcId: a, line: `${name}${levelText(lvl, label)} is down.${extra}` };
  }
  if (kind === "boss") {
    const enc = b ? ref.encounter.get(b) : null;
    const found = bossInstance(ref, { npcId: a, name: npc(a)?.name || enc?.name || "", instanceMap: enc?.instanceMap || null });
    const name = found.boss || npc(a)?.name || enc?.name || "the boss";
    const inst = found.instance;
    const last = inst && inst.bosses.length && norm(inst.bosses[inst.bosses.length - 1]) === norm(name);
    if (last) return { kind: "dungeon", title: `${inst.name} cleared`, subject: name, npcId: a || null, instance: inst.name, line: `Killed ${name}, the last boss: ${inst.name} cleared.${inst.kind === "raid" ? " A raid well done." : " Check your quests: several end here."}` };
    const at = inst ? inst.bosses.findIndex((x) => norm(x) === norm(name)) : -1;
    const left = at >= 0 ? inst.bosses.length - 1 - at : 0;
    return { kind, title: "Boss defeated", subject: name, npcId: a || null, instance: inst?.name || null, line: `Killed ${name}${inst ? ` in ${inst.name}` : ""}.${left ? ` ${left === 1 ? "One boss" : `${left} bosses`} to go.` : ""}` };
  }
  if (kind === "profession") {
    const skill = SKILLS[a] || `Profession ${a}`, rank = b, max = c * 5;
    if (max && rank >= max) {
      const next = NEXT_TIER[max];
      if (!next) return { kind, title: `${skill} ${rank}`, skill, rank, max, line: `${skill} mastered: ${rank} of ${max}.` };
      const trainer = tierTrainer(ref, a, next.name, ctx);
      const where = trainer ? ` at the trainer in ${trainer.mapName || "town"} (${trainer.name})` : " at your profession trainer";
      const level = ctx.level && ctx.level < next.level ? ` once you reach level ${next.level}` : "";
      return { kind, title: `${skill} ${rank}`, skill, rank, max, nextTier: next.name, trainer, line: `${skill} ${rank}: ${next.name} available${where}${level}. It raises the limit to ${next.max}.` };
    }
    return { kind, title: `${skill} ${rank}`, skill, rank, max: max || null, line: `${skill} reached ${rank}${max ? ` of ${max}` : ""}.${max && rank + 25 < max ? ` Next milestone at ${rank + 25}.` : max ? ` ${max - rank} to the limit of this rank.` : ""}` };
  }
  if (kind === "zone") {
    const name = mapName(a) || `Map ${a}`, band = zoneBand(a);
    const fit = band && ctx.level ? (ctx.level < band.min - 2 ? " Careful: it is above your level." : ctx.level > band.max + 2 ? " You have outgrown it, so quests here give little experience." : " Right for your level.") : "";
    return { kind, title: "New zone discovered", subject: name, mapId: a, line: `First visit to ${name}${band ? ` (levels ${band.min}–${band.max})` : ""}.${fit}` };
  }
  if (kind === "flight") {
    const name = mapName(a);
    return { kind, title: "New flight path", subject: name, mapId: a || null, line: `${name ? `Flight path learned in ${name}. ` : "Flight path learned. "}You can now fly here from any flight master you know.` };
  }
  if (kind === "upgrade") {
    const item = ref.items.get(a) || `Item #${a}`, gain = b / 10, slot = SLOTS[c] || null;
    return { kind, title: "Upgrade equipped", subject: item, itemId: a, line: `${item}${slot ? ` (${slot})` : ""}: +${gain.toFixed(1)} gear score for your class over what it replaced.` };
  }
  return null;
}

/** A turned-in quest that ends a chain of two or more -> { title, line, ... }, else null. */
function chainEnd(ref, questId) {
  const q = ref.quests.get(questId);
  if (!q || q.next || !ref.prev.has(questId)) return null;
  const chain = [q];
  for (let id = ref.prev.get(questId), guard = 0; id && guard < 40; id = ref.prev.get(id), guard++) { const p = ref.quests.get(id); if (!p || chain.includes(p)) break; chain.unshift(p); }
  if (chain.length < 2) return null;
  return { kind: "chain", title: "Quest chain complete", subject: q.title, questId, steps: chain.length, line: `${q.title} ends a ${chain.length}-quest story that began with “${chain[0].title}”.` };
}

class MomentsService {
  constructor({ dataDir = null, reference = buildReference(), getContext = () => ({}), zoneBand = () => null, send = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { dataDir, reference, getContext, zoneBand, send, now, setTimer, clearTimer });
    this.history = []; this.counter = 0; this.turned = new Map(); this.lastDeath = null; this.deathTimer = null;
    this.settings = this.readSettings();
  }
  file() { return this.dataDir ? path.join(this.dataDir, "moments.json") : null; }
  readSettings() {
    const out = { enabled: true, kinds: Object.fromEntries(KINDS.map((k) => [k, true])) };
    try {
      const s = JSON.parse(fs.readFileSync(this.file(), "utf8"));
      if (typeof s.enabled === "boolean") out.enabled = s.enabled;
      for (const k of KINDS) if (typeof s.kinds?.[k] === "boolean") out.kinds[k] = s.kinds[k];
    } catch {}
    return out;
  }
  setSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid moment settings.");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw Error("Invalid moment settings.");
    const kinds = input.kinds ?? {};
    if (typeof kinds !== "object" || Array.isArray(kinds) || Object.entries(kinds).some(([k, v]) => !KINDS.includes(k) || typeof v !== "boolean")) throw Error("Invalid moment settings.");
    if (typeof input.enabled === "boolean") this.settings.enabled = input.enabled;
    Object.assign(this.settings.kinds, kinds);
    try { if (this.file()) fs.writeFileSync(this.file(), JSON.stringify(this.settings)); } catch {}
    return this.status();
  }
  status() { return { settings: structuredClone(this.settings), kinds: KINDS.map((k) => ({ kind: k, label: LABELS[k] })), recent: this.history.map((m) => ({ ...m })) }; }
  wanted(kind) { return this.settings.enabled && this.settings.kinds[kind] !== false; }
  // Records and sends a card. Every moment is kept in Recent; only wanted ones pop up.
  publish(card, { at = this.now(), id = null, update = false } = {}) {
    const m = { id: id || `m${++this.counter}-${at}`, at, ...card, ...(update ? { update: true } : {}) };
    const i = this.history.findIndex((h) => h.id === m.id);
    if (i >= 0) this.history[i] = { ...m, update: undefined }; else { this.history.unshift(m); if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY; }
    if (this.wanted(m.kind)) { try { this.send(m); } catch {} }
    return m;
  }
  /** One raw moment from the live bridge. */
  observe(raw) {
    let card = null;
    try { card = resolveMoment(raw, this.reference, this.getContext() || {}, { zoneBand: this.zoneBand }); } catch { card = null; }
    if (!card) return null;
    const at = Number.isFinite(raw.at) ? raw.at : this.now();
    if (card.kind === "death") {
      // A death the frames already reported (older addon path) is replaced by the full review.
      const prev = this.lastDeath && Math.abs(at - this.lastDeath.at) <= DEATH_MERGE_MS ? this.lastDeath : null;
      this.clearTimer(this.deathTimer); this.deathTimer = null;
      if (prev?.review) return null;
      const m = this.publish(card, { at, id: prev?.id || null, update: Boolean(prev) });
      this.lastDeath = { id: m.id, at, review: true };
      return m;
    }
    return this.publish(card, { at });
  }
  /** Play session events (from live frames): a death with no review from the addon still gets a screen. */
  onPlayEvent(e) {
    if (e?.kind !== "death") return;
    const at = Number.isFinite(e.at) ? e.at : this.now();
    if (this.lastDeath && Math.abs(at - this.lastDeath.at) <= DEATH_MERGE_MS) return;
    this.clearTimer(this.deathTimer);
    this.deathTimer = this.setTimer(() => {
      this.deathTimer = null;
      if (this.lastDeath && Math.abs(at - this.lastDeath.at) <= DEATH_MERGE_MS) return;
      const card = resolveMoment({ type: 1, a: 0, b: 0, c: 5 << 1 }, this.reference, this.getContext() || {});
      card.line = "Release your spirit and run back to your body.";
      card.death.killer = null; card.death.share = null; card.death.unknown = true;
      const m = this.publish(card, { at });
      this.lastDeath = { id: m.id, at, review: false };
    }, DEATH_FALLBACK_MS);
  }
  /** Live frame: newly turned-in quests that end a chain. The first list seen per character is the baseline. */
  observeFrame(frame) {
    if (!frame || !Array.isArray(frame.turnedIn) || frame.characterHash == null) return [];
    const before = this.turned.get(frame.characterHash);
    this.turned.set(frame.characterHash, new Set(frame.turnedIn));
    if (!before) return [];
    const out = [];
    for (const id of frame.turnedIn) {
      if (before.has(id)) continue;
      const card = chainEnd(this.reference, id);
      if (card) out.push(this.publish(card));
    }
    return out;
  }
}

/** The packs the app ships, loaded once (each optional). */
function loadReference({ knowledge = null, insights = null, creatures = null } = {}) {
  const atlas = require("./dungeon-atlas.cjs");
  let bossLoot = null;
  try { bossLoot = require("./boss-loot-data.cjs").loadBossLootPack(); } catch {}
  return buildReference({ creatures, knowledge, insights, bossLoot, encounters: atlas.loadEncounters(), baseline: atlas.BASELINE });
}

module.exports = { MomentsService, buildReference, loadReference, resolveMoment, chainEnd, tierTrainer, TYPES, KINDS, LABELS, TIPS, CORPSE_RUN };

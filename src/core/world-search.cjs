"use strict";
// World search ("Search everything", Ctrl+K): one index over everything the app knows.
// Quests, NPCs, world objects, zones, dungeons, bosses, rares, flight points and transports come
// from the bundled reference; items, spells, talents and recipes from the player's own game files;
// NPCs only the community placed from the daily community pack; commands and help from the app.
// The index is built once per data version (lazily, in the main process) and kept in memory; a
// search is one pass over short strings, so typing never waits on it.
// Same-patch rule: a bundled reference checked on another patch than the player's game is refused
// and the result says so. Every result says where its fact comes from.
const { MAP_NAMES } = require("./map-names.cjs");
const { relation } = require("./build-compat.cjs");

// Kind, group title, and a small nudge so the more useful kinds win ties.
const KINDS = Object.freeze([
  ["quest", "Quests", 30], ["npc", "NPCs", 28], ["item", "Items", 20], ["spell", "Spells", 8], ["talent", "Talents", 18], ["recipe", "Recipes", 14],
  ["zone", "Zones", 40], ["dungeon", "Dungeons and raids", 36], ["boss", "Bosses", 30], ["rare", "Rare enemies", 22], ["object", "World objects", 12],
  ["flight", "Flight points", 24], ["transport", "Boats and zeppelins", 20], ["command", "Commands", 26], ["help", "Help", 16],
]);
const KIND_WEIGHT = Object.fromEntries(KINDS.map(([k, , w]) => [k, w]));
const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
const SOURCES = Object.freeze({ game: "Your game files", bundled: "Bundled reference", community: "Community data", app: "Backstage Forever" });
// Match tiers. The gaps are wider than every nudge together, so exact > prefix > word > fuzzy always holds.
const TIER = Object.freeze({ exact: 2000, prefix: 1600, word: 1200, inside: 900, about: 600, fuzzy: 300 });
const MAX_QUERY = 80, GROUP_LIMIT = 5, KIND_LIMIT = 40, FUZZY_BELOW = 6;
const JUNK = /^\[|\(123\)|^<|\bUNUSED\b|\bTEST\b|\bDEPRECATED\b|^zzOLD|\bDND\b/i;
const QUALITY = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"];

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const mapName = (id) => MAP_NAMES[id] || null;
const placed = (p) => p && Number.isSafeInteger(p.mapId) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const coins = (c) => { const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), k = c % 100; return [g ? `${g}g` : "", s ? `${s}s` : "", k || (!g && !s) ? `${k}c` : ""].filter(Boolean).join(" "); };
const percent = (chance) => `${chance >= 0.995 ? 100 : Math.max(1, Math.round(chance * 100))}%`;
const join = (...parts) => parts.filter(Boolean).join(" · ");

// The Field guide's glossary and chapters, so "what is rested" finds its place in Help.
const HELP_TOPICS = Object.freeze([
  ["Quest giver", "A yellow ! over someone's head means they have a quest for you."],
  ["Hand in", "A yellow ? means a finished quest goes back to them. Also called turn in."],
  ["Rested", "Bonus experience you build while logged out in an inn or city."],
  ["Hearthstone", "A stone in your bags that takes you to the inn you chose as home."],
  ["Trainer", "Teaches your class new spells and abilities, usually every two levels."],
  ["Flight master", "Flies you between places you have already visited."],
  ["Enemy level colours", "Grey: no XP. Green: easy. Yellow: fair. Orange: hard. Red or a skull: avoid."],
  ["Elite", "Several times stronger than normal enemies; bring a group."],
  ["Pull and aggro", "Attacking draws an enemy to you. Getting too close also does."],
  ["Corpse run", "When you die, run back to your body as a ghost to come back to life."],
  ["Durability and repair", "Gear wears out when you die or fight. Repair it at many vendors."],
  ["Vendor trash", "Grey items. They are only for selling to a vendor."],
  ["Dungeon", "A private area for a group of five with tougher enemies and better rewards."],
]);
const HELP_PAGES = Object.freeze([
  ["Field guide", "guide", "Start here, look up a word, or find how to do one thing."],
  ["Commands", "commands", "Everything you can type in game."],
  ["Data coverage", "coverage", "How much the app knows, zone by zone."],
  ["Report a problem", "report", "Tell the team about a bug or wrong data."],
  ["Privacy and sharing", "privacy", "What the app shares, and the switches for it."],
  ["Game connection", "game", "Your game folder, the addon and the live link."],
]);

/**
 * Build the index. Every part is optional: what is missing is simply not searched, and `limits`
 * says so in plain words. Returns { entries, counts, limits, lookups, builtMs, bytes }.
 */
function buildIndex({ knowledgePack = null, pins = null, vendorPack = null, insights = null, trainerPack = null, lootPack = null, bossLootPack = null, atlas = null,
  transport = null, worldPack = null, creatures = null, community = null, levelingZones = null, instanceNames = {}, commands = null, game = null, clientBuild = null } = {}) {
  const started = process.hrtime.bigint();
  const entries = [], limits = [];
  const add = (k, id, name, sub, extra = {}) => {
    const n = norm(name);
    if (!n) return;
    entries.push({ k, id, name: String(name), n, sub: sub || "", a: extra.about ? norm(extra.about) : "", src: extra.src || "bundled", ...(extra.lv ? { lv: extra.lv } : {}), ...(extra.side ? { side: extra.side } : {}),
      ...(extra.mapId ? { mapId: extra.mapId } : {}), ...(extra.seen ? { seen: true } : {}), ...(extra.icon ? { icon: extra.icon } : {}), ...(extra.quality != null ? { quality: extra.quality } : {}), ...(extra.alt && norm(extra.alt) !== n ? { alt: norm(extra.alt) } : {}), t: extra.t || null });
  };
  // Same-patch rule: the build-stamped bundled reference is used on any build of its own patch only.
  const bundledBuild = knowledgePack?.build || null;
  const refused = Boolean(bundledBuild && clientBuild && relation(bundledBuild, clientBuild) === "mismatch");
  if (refused) limits.push(`The bundled reference was checked on game build ${bundledBuild}. Your game is on another patch (${clientBuild}), so its quests, NPCs and places are not searched until the app updates.`);
  else if (bundledBuild && clientBuild && relation(bundledBuild, clientBuild) === "carried") limits.push(`Quests, NPCs and places were checked on build ${bundledBuild.split(".").pop()} of your patch. Places rarely move between builds.`);
  const pack = refused ? null : knowledgePack;

  // ---- lookups shared with detail(): where an item comes from.
  const vendorsByItem = new Map(), npcPlace = new Map(), questRewards = new Map(), craftedBy = new Map(), taughtBy = new Map(), trainerCost = new Map();
  const push = (m, key, v) => { if (!m.has(key)) m.set(key, []); m.get(key).push(v); };

  // ---- quests
  const gives = new Map(), questSeen = new Set();
  // Quests seen in play first, so a repeated title keeps the row players actually met.
  for (const q of Object.values(pack?.quests || {}).sort((a, b) => Boolean(b.observedInPlay) - Boolean(a.observedInPlay) || a.id - b.id)) {
    if (!q.title || JUNK.test(q.title)) continue;
    const giverRef = (q.givers || [])[0], giver = giverRef ? pack.npcs?.[`${giverRef.kind}:${giverRef.id}`] : null;
    const at = giver?.positions?.find(placed) || null, zone = at ? mapName(at.mapId) : null;
    for (const g of q.givers || []) if (g.kind === "npc") push(gives, g.id, q);
    for (const r of [...(q.rewards?.items || []), ...(q.rewards?.choices || [])]) if (Number.isSafeInteger(r.itemId)) push(questRewards, r.itemId, { id: q.id, title: q.title, level: q.level ?? null });
    const twin = [q.title, q.level ?? "", giverRef?.id ?? "", (q.sides || []).join("")].join("|");
    if (questSeen.has(twin)) continue;
    questSeen.add(twin);
    add("quest", q.id, q.title, join(q.level ? `Level ${q.level}` : null, giver?.name ? `from ${giver.name}` : null, zone), {
      about: join(giver?.name, zone), lv: q.level || null, side: q.sides?.length === 1 ? q.sides[0] : null, mapId: at?.mapId, seen: Boolean(q.observedInPlay), t: { quest: q.id } });
  }

  // ---- NPCs (one row per NPC: its roles and its first known place)
  const npcs = new Map();
  for (const [mapId, list] of refused ? [] : pins || []) for (const p of list) {
    if (!p.npcId || !p.label) continue;
    let e = npcs.get(p.npcId);
    if (!e) { e = { name: p.label, roles: [], sides: p.sides || null, mapId, x: p.x, y: p.y, kind: p.kind }; npcs.set(p.npcId, e); npcPlace.set(p.npcId, { mapId, x: p.x, y: p.y, name: p.label }); }
    const role = p.kind === "flight" ? "Flight master" : p.kind === "vendor" ? "Vendor" : p.kind === "class-trainer" || p.kind === "profession-trainer" ? (p.sub || "Trainer") : null;
    if (role && !e.roles.includes(role)) { e.roles.push(role); if (e.kind === "npc") e.kind = p.kind; }
  }
  for (const [id, e] of npcs) {
    if (gives.has(id)) e.roles.push("Quest giver");
    const zone = mapName(e.mapId), roles = e.roles.join(", ");
    add("npc", id, e.name, join(roles || "NPC", zone), { about: join(roles, zone, e.roles.some((r) => /trainer/i.test(r)) ? "trainer" : null), side: e.sides?.length === 1 ? e.sides[0] : null, mapId: e.mapId,
      t: { map: { mapId: e.mapId, x: e.x, y: e.y, npcId: id, label: e.name, sub: roles || null, kind: e.kind } } });
  }
  // NPCs only the community placed (never mixed into the bundled rows).
  for (const [npcId, positions] of community?.npcPositions || []) {
    if (npcs.has(npcId)) continue;
    // A name the bundled data lacks may come from the pack: the name the game showed to at least 3 players.
    const bundled = pack?.npcs?.[`npc:${npcId}`]?.name || creatures?.get?.(npcId)?.name || null, p = positions.find(placed);
    const name = bundled || community.npcNames?.get(npcId)?.name || null;
    if (!name || !p) continue;
    const vendor = community.vendors?.has(npcId), zone = join(mapName(p.mapId), bundled ? null : "name from the community");
    npcPlace.set(npcId, { mapId: p.mapId, x: p.x, y: p.y, name });
    add("npc", npcId, name, join(vendor ? "Vendor" : "NPC", zone, `seen by ${p.installs} players`), { about: join(vendor ? "vendor" : null, zone), src: "community", mapId: p.mapId,
      t: { map: { mapId: p.mapId, x: p.x, y: p.y, npcId, label: name, sub: vendor ? "Vendor" : null, kind: vendor ? "vendor" : "npc" } } });
  }
  // World objects from the quest reference (wanted posters, crates).
  for (const o of Object.values(pack?.npcs || {})) {
    if (o.kind !== "object" || !o.name || o.name === "Mailbox") continue;
    const p = (o.positions || []).find(placed);
    if (!p) continue;
    add("object", o.id, o.name, join("Object", mapName(p.mapId)), { about: mapName(p.mapId), mapId: p.mapId, t: { map: { mapId: p.mapId, x: p.x, y: p.y, label: o.name, sub: "Object", kind: "npc" } } });
  }
  for (const v of refused ? [] : vendorPack?.vendors || []) for (const l of v.listings || []) if (Number.isSafeInteger(l.itemId)) push(vendorsByItem, l.itemId, { npcId: v.id, name: v.name, price: Number.isSafeInteger(l.price) ? l.price : null });
  for (const t of refused ? [] : insights?.trainers || []) for (const s of t.services || []) if (Number.isSafeInteger(s.spellId)) push(taughtBy, s.spellId, { npcId: t.id, name: t.name, title: t.title || "Trainer", level: s.observedLevel || null });
  for (const list of Object.values(trainerPack?.classes || {})) for (const s of list) if (Number.isSafeInteger(s.id) && Number.isSafeInteger(s.cost)) trainerCost.set(s.id, { level: s.level || null, cost: s.cost });

  // ---- zones
  const zoneIds = new Set();
  for (const z of levelingZones || []) {
    if (!mapName(z.mapId)) continue;
    zoneIds.add(z.mapId);
    add("zone", z.mapId, mapName(z.mapId), join(`Levels ${z.min}–${z.max}`, z.faction), { lv: Math.round((z.min + z.max) / 2), side: ["Horde", "Alliance"].includes(z.faction) ? z.faction : null, mapId: z.mapId, src: "app", t: { zone: z.mapId } });
  }
  for (const id of Object.keys(MAP_NAMES).map(Number)) if (!zoneIds.has(id)) add("zone", id, MAP_NAMES[id], pins?.get?.(id)?.length ? "City or zone" : "Zone", { mapId: id, src: "app", t: { zone: id } });

  // ---- dungeons, raids and their bosses
  for (const e of atlas?.entries || []) {
    const levels = e.levels ? `Levels ${e.levels.min}–${e.levels.max}` : null;
    add("dungeon", e.id, e.name, join(e.kind === "raid" ? "Raid" : "Dungeon", levels, e.zone), { about: join(e.zone, e.kind), lv: e.levels ? Math.round((e.levels.min + e.levels.max) / 2) : null, side: ["Horde", "Alliance"].includes(e.faction) ? e.faction : null, src: "app", t: { dungeon: e.id } });
    for (const b of e.bosses || []) if (b.name) add("boss", `${e.id}:${b.name}`, b.name, join("Boss", e.name, b.observedInForever ? null : "not yet seen in Forever"), { about: e.name, lv: e.levels?.max || null, src: b.observedInForever && !refused ? "bundled" : "app", t: { dungeon: e.id, boss: b.name } });
  }

  // ---- rares, flight points, transports
  for (const r of refused ? [] : worldPack?.rares || []) {
    const p = (r.positions || []).find(placed);
    if (!p || !r.name) continue;
    const lv = r.minLevel ? (r.minLevel === r.maxLevel ? `level ${r.minLevel}` : `level ${r.minLevel}–${r.maxLevel}`) : null;
    add("rare", r.id, r.name, join(r.elite ? "Rare elite" : "Rare", lv, mapName(p.mapId)), { about: mapName(p.mapId), lv: r.maxLevel || null, mapId: p.mapId, t: { map: { mapId: p.mapId, x: p.x, y: p.y, label: r.name, sub: "Rare enemy · where a player met it", kind: "rare" } } });
  }
  const flightNames = game?.flightPoints || null;
  for (const n of refused ? [] : transport?.nodes || []) {
    if (!placed(n)) continue;
    const name = flightNames?.[n.id]?.[0] || (n.master ? `${n.master}` : null);
    if (!name) continue;
    add("flight", n.id, name, join("Flight point", flightNames?.[n.id] && n.master ? `master ${n.master}` : null, mapName(n.mapId), n.side), { about: join(n.master, mapName(n.mapId), "flight master"), alt: n.master, side: n.side || null, mapId: n.mapId,
      t: { map: { mapId: n.mapId, x: n.x, y: n.y, ...(n.npcId ? { npcId: n.npcId } : {}), label: n.master || name, sub: "Flight master", kind: "flight" } } });
  }
  for (const t of refused ? [] : transport?.transports || []) {
    if (!t.name || JUNK.test(t.name)) continue;
    add("transport", t.id, t.name, t.mode === "zeppelin" ? "Zeppelin" : t.mode === "boat" ? "Boat" : "Transport", { about: t.mode, t: { nav: "travel" } });
  }

  // ---- the player's own game files
  const items = game?.items || null, spells = game?.spells || null;
  if (items) {
    const view = game.itemView || null;
    for (const [id, row] of Object.entries(items)) {
      const name = row?.[0];
      if (!name || JUNK.test(name)) continue;
      const v = view ? view(Number(id), row) : null;
      const type = v ? [v.slot, v.kind].filter(Boolean).join(" ") : "";
      add("item", Number(id), name, join(QUALITY[row[1]] || null, type || null, row[2] > 1 ? `item level ${row[2]}` : null, row[3] > 1 ? `needs level ${row[3]}` : null), { src: "game", lv: row[3] > 1 ? row[3] : null, icon: row[15] || null, quality: row[1], t: { item: Number(id) } });
    }
  } else {
    // Without the game files only the names the bundled reference saw are searchable.
    const seen = new Set();
    for (const it of refused ? [] : insights?.items || []) {
      if (!it.name || seen.has(it.id) || JUNK.test(it.name) || /^Item #/.test(it.name)) continue;
      seen.add(it.id);
      add("item", it.id, it.name, "Name only", { t: { item: it.id } });
    }
    limits.push(game?.reason || "Connect your game folder (Settings → Game connection) to search every item, spell, talent and recipe. Until then only item names from the bundled reference are searched.");
  }
  if (spells) {
    // One row per spell name: the rank a trainer teaches first, otherwise the first with a tooltip.
    const byName = new Map(), recipeSpells = new Set((game.recipes?.rows || []).map((r) => r[0]));
    for (const [id, row] of Object.entries(spells)) {
      const name = row?.[0], n = Number(id);
      if (!name || JUNK.test(name) || recipeSpells.has(n)) continue; // recipes have their own rows
      const taught = taughtBy.has(n) || trainerCost.has(n);
      if (!taught && !row[2]) continue; // internal spells without tooltip text are left out
      const have = byName.get(name);
      if (!have || (taught && !have.taught) || (taught === have.taught && n < have.id)) byName.set(name, { id: n, row, taught });
    }
    for (const [name, s] of byName) {
      const cost = trainerCost.get(s.id), lv = cost?.level || game.spellLevels?.[s.id] || null;
      add("spell", s.id, name, join(s.row[3] || null, s.taught ? "taught by a trainer" : null, lv ? `level ${lv}` : null), { src: "game", lv, icon: s.row[1] || null, t: { spell: s.id } });
    }
  }
  for (const cls of Object.values(game?.talents || {})) for (const tab of cls.tabs || []) for (const t of tab.talents || []) {
    if (!t.name) continue;
    add("talent", `${cls.className}:${t.id}`, t.name, join(`${cls.className} talent`, tab.name, `${t.maxRank} rank${t.maxRank === 1 ? "" : "s"}`), { about: join(cls.className, tab.name), src: "game", icon: t.iconFileId || null, t: { talent: { className: cls.className, talentId: t.id, tab: tab.name, name: t.name } } });
  }
  if (game?.recipes && spells) {
    const lines = game.recipes.lines || {};
    for (const r of game.recipes.rows || []) {
      const name = spells[r[0]]?.[0], line = lines[r[1]]?.[0];
      if (!name || !line) continue;
      if (r[6] > 0) push(craftedBy, r[6], { spellId: r[0], skillLineId: r[1], name, line });
      add("recipe", r[0], name, join(line, r[2] ? `yellow at ${r[2]}` : null), { about: line, src: "game", icon: spells[r[0]]?.[1] || null, t: { recipe: { skillLineId: r[1], spellId: r[0], name } } });
    }
  } else if (items && game.recipesFailed) limits.push("Recipes could not be read from your game files, so they are not searched.");

  // ---- commands and help
  for (const c of commands?.CATALOG || []) add("command", c.word, c.command, c.what, { alt: c.word, about: join(c.what, c.when, c.group, c.also ? [].concat(c.also).join(" ") : null), src: "app", t: { command: c.word, text: c.command } });
  for (const f of commands?.FEATURES || []) add("help", `feature:${f.name}`, f.name, f.what, { about: join(f.what, f.where), src: "app", t: { nav: "commands" } });
  for (const [name, text] of HELP_TOPICS) add("help", `word:${name}`, name, text, { about: text, src: "app", t: { nav: "guide" } });
  for (const [name, nav, text] of HELP_PAGES) add("help", `page:${nav}`, name, text, { about: text, src: "app", t: { nav } });

  const counts = {};
  let bytes = 0;
  for (const e of entries) { counts[e.k] = (counts[e.k] || 0) + 1; bytes += 2 * (e.name.length + e.n.length + e.sub.length + e.a.length) + 96; }
  return { entries, counts, limits, refused, bytes, builtMs: Number(process.hrtime.bigint() - started) / 1e6,
    lookups: { vendorsByItem, npcPlace, questRewards, craftedBy, taughtBy, trainerCost, lootPack: refused ? null : lootPack, bossLootPack: refused ? null : bossLootPack, instanceNames, community } };
}

// ---------------------------------------------------------------- ranking
/** How well one entry's text answers the query words: a tier from TIER, or 0. */
function matchTier(e, q, words) {
  if (e.alt) { const own = tierOf(e.n, e.a, q, words), other = tierOf(e.alt, "", q, words); return own > other ? own : other; }
  return tierOf(e.n, e.a, q, words);
}
function tierOf(n, a, q, words) {
  if (n === q) return TIER.exact;
  if (n.startsWith(q)) return TIER.prefix;
  let word = true, inside = true;
  for (const w of words) {
    if (!(n.startsWith(w) || n.includes(" " + w))) word = false;
    if (!n.includes(w)) { inside = false; break; }
  }
  if (inside) return word ? TIER.word : TIER.inside;
  if (a) { for (const w of words) if (!n.includes(w) && !a.includes(w)) return 0; return TIER.about; }
  return 0;
}
/** Edit distance, given up once it passes `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** Typing mistakes: every query word is within one edit (two for long words) of a word of the name. */
function fuzzyTier(e, words) {
  const parts = e.n.split(" ");
  for (const w of words) {
    if (e.n.includes(w)) continue;
    if (w.length < 4) return 0;
    const max = w.length >= 8 ? 2 : 1;
    if (!parts.some((p) => p[0] === w[0] && editDistance(w, p.length > w.length + max ? p.slice(0, w.length) : p, max) <= max)) return 0;
  }
  return TIER.fuzzy;
}
/** Small pushes that never cross a tier: kind, your faction, your level range, your zone, a short name. */
function nudge(e, ctx) {
  let s = KIND_WEIGHT[e.k] || 0;
  if (ctx.faction && e.side) s += e.side === ctx.faction ? 25 : -60;
  if (ctx.level && e.lv) { const d = Math.abs(e.lv - ctx.level); s += d <= 3 ? 20 : d <= 8 ? 10 : 0; }
  if (ctx.mapId && e.mapId === ctx.mapId) s += 15;
  if (e.seen) s += 10;
  return s - Math.min(e.n.length, 40) * 0.4;
}
const publicRow = (e, score, ctx) => ({ kind: e.k, id: e.id, name: e.name, sub: e.sub, source: e.src, sourceLabel: SOURCES[e.src], score: Math.round(score),
  ...(e.lv ? { level: e.lv } : {}), ...(e.side ? { side: e.side, otherFaction: Boolean(ctx.faction && e.side !== ctx.faction) } : {}), ...(e.mapId ? { zone: mapName(e.mapId) } : {}),
  ...(e.icon ? { icon: e.icon } : {}), ...(e.quality != null ? { quality: e.quality } : {}), target: e.t });

/**
 * Search the index. ctx: { faction, level, mapId } of the selected character (all optional).
 * opts.kind limits to one kind (and returns more of it). Returns groups by kind, best group first.
 */
function search(index, query, ctx = {}, opts = {}) {
  if (typeof query !== "string" || query.length > MAX_QUERY) throw Error("Invalid search.");
  const started = process.hrtime.bigint();
  const q = norm(query), words = q.split(" ").filter(Boolean);
  const only = typeof opts.kind === "string" && KIND_LABEL[opts.kind] ? opts.kind : null;
  const out = { query, groups: [], total: 0, fuzzy: false, limits: index?.limits || [], counts: index?.counts || {}, ms: 0 };
  if (!index || !words.length) return out;
  const hits = [];
  for (const e of index.entries) {
    if (only && e.k !== only) continue;
    const tier = matchTier(e, q, words);
    if (tier) hits.push([tier + nudge(e, ctx), e]);
  }
  if (hits.length < FUZZY_BELOW && q.length >= 4) {
    const have = new Set(hits.map(([, e]) => e));
    for (const e of index.entries) {
      if ((only && e.k !== only) || have.has(e)) continue;
      const tier = fuzzyTier(e, words);
      if (tier) { hits.push([tier + nudge(e, ctx), e]); out.fuzzy = true; }
    }
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name) || String(a[1].id).localeCompare(String(b[1].id)));
  const groups = new Map(), limit = only ? KIND_LIMIT : Number.isSafeInteger(opts.limit) && opts.limit > 0 && opts.limit <= KIND_LIMIT ? opts.limit : GROUP_LIMIT;
  for (const [score, e] of hits) {
    let g = groups.get(e.k);
    if (!g) { g = { kind: e.k, label: KIND_LABEL[e.k], total: 0, best: score, results: [] }; groups.set(e.k, g); }
    g.total++;
    if (g.results.length < limit) g.results.push(publicRow(e, score, ctx));
  }
  out.groups = [...groups.values()].sort((a, b) => b.best - a.best);
  out.total = hits.length;
  out.ms = Number(process.hrtime.bigint() - started) / 1e6;
  return out;
}

// ---------------------------------------------------------------- details
/** Where an item comes from, as far as the packs know. Each line says its source and may link somewhere. */
function itemSources(index, itemId) {
  const L = index?.lookups, out = [];
  if (!L) return out;
  const place = (npcId) => { const p = L.npcPlace.get(npcId); return p ? { map: { mapId: p.mapId, x: p.x, y: p.y, npcId, label: p.name } } : null; };
  for (const v of (L.vendorsByItem.get(itemId) || []).slice(0, 4)) out.push({ type: "vendor", text: `Sold by ${v.name}${v.price != null ? ` for ${coins(v.price)}` : ""}`, source: "bundled", target: place(v.npcId) });
  for (const [instanceId, inst] of Object.entries(L.bossLootPack?.instances || {})) for (const b of inst.bosses || []) {
    const hit = (b.items || []).find((i) => i.itemId === itemId);
    if (hit && out.filter((o) => o.type === "boss").length < 3) out.push({ type: "boss", text: `Drops from ${b.name} in ${L.instanceNames[instanceId] || instanceId} · ${percent(hit.chance)}`, source: "bundled", target: { dungeon: instanceId, boss: b.name } });
  }
  for (const d of (L.lootPack?.items?.[itemId] || []).slice(0, 3)) out.push({ type: "drop", text: `${d.kind === "object" ? "Found in" : "Drops from"} ${d.name} · ${percent(d.chance)} of ${d.drops} looted`, source: "bundled", target: d.kind === "npc" ? place(d.id) : null });
  for (const d of (L.community?.dropsByItem?.get(itemId) || []).slice(0, 2)) { const p = L.npcPlace.get(d.npcId); out.push({ type: "drop", text: `Drops from ${p?.name || `creature #${d.npcId}`} · ${percent(d.rate)} · seen by ${d.installs} players`, source: "community", target: place(d.npcId) }); }
  for (const q of (L.questRewards.get(itemId) || []).slice(0, 3)) out.push({ type: "quest", text: `Reward from the quest ${q.title}${q.level ? ` (level ${q.level})` : ""}`, source: "bundled", target: { quest: q.id } });
  for (const r of (L.craftedBy.get(itemId) || []).slice(0, 2)) out.push({ type: "recipe", text: `Made with ${r.line}: ${r.name}`, source: "game", target: { recipe: { skillLineId: r.skillLineId, spellId: r.spellId, name: r.name } } });
  return out.map((o) => ({ ...o, sourceLabel: SOURCES[o.source] }));
}
/** Who teaches a spell, at what level and for how much, where the trainer packs know. */
function spellSources(index, spellId) {
  const L = index?.lookups, out = [];
  if (!L) return out;
  const cost = L.trainerCost.get(spellId);
  if (cost) out.push({ type: "trainer", text: join(cost.level ? `Trainers teach it at level ${cost.level}` : "Taught by trainers", cost.cost != null ? coins(cost.cost) : null), source: "bundled", sourceLabel: SOURCES.bundled, target: null });
  for (const t of (L.taughtBy.get(spellId) || []).slice(0, 3)) { const p = L.npcPlace.get(t.npcId); out.push({ type: "trainer", text: join(`${t.name}, ${t.title}`, p ? mapName(p.mapId) : null), source: "bundled", sourceLabel: SOURCES.bundled, target: p ? { map: { mapId: p.mapId, x: p.x, y: p.y, npcId: t.npcId, label: t.name } } : null }); }
  return out;
}

// ---------------------------------------------------------------- service
/**
 * Keeps one index per data version. `sources()` returns the bundled packs (read once);
 * the game tables are used only when they are ready without reading the game; otherwise they are
 * read in the background after the first search and the index is rebuilt.
 */
class WorldSearch {
  constructor({ sources, gameData = null, getProfile = () => null, getCommunity = () => null, getLive = () => null, defer = (fn) => setTimeout(fn, 30), now = Date.now } = {}) {
    Object.assign(this, { sources, gameData, getProfile, getCommunity, getLive, defer, now });
    this.index = null; this.key = null; this.checkedAt = 0; this.warming = false; this.warmed = new Set();
  }
  game() {
    const g = this.gameData;
    if (!g) return { build: null, tables: {}, pending: false, reason: null };
    let build = null;
    try { build = g.build(); } catch (e) { return { build: null, tables: {}, pending: false, reason: e?.code === "NOGAME" ? null : "Your game files could not be read, so items, spells, talents and recipes are not searched." }; }
    const tables = {}; let pending = false;
    for (const kind of ["items", "spells", "talents", "recipes", "extras"]) {
      if (g.cached(kind)) { try { tables[kind] = g.load(kind); } catch { /* unreadable: left out */ } }
      else if (!this.warmed.has(`${build}:${kind}`)) pending = true;
    }
    return { build, tables, pending, reason: null };
  }
  // Read the game tables that are not cached yet, off the request path, then rebuild.
  warm(build) {
    if (this.warming) return;
    this.warming = true;
    this.defer(() => {
      for (const kind of ["items", "spells", "talents", "recipes", "extras"]) {
        const tag = `${build}:${kind}`;
        if (this.warmed.has(tag)) continue;
        this.warmed.add(tag);
        try { if (!this.gameData.cached(kind)) this.gameData.load(kind); } catch { /* stays unsearched; the limits line says so */ }
      }
      this.warming = false; this.key = null;
    });
  }
  ensure() {
    // Data versions are looked at again at most every 5 seconds; typing reuses the index.
    if (this.index && this.key && this.now() - this.checkedAt < 5000) return this.index;
    this.checkedAt = this.now();
    const game = this.game(), community = (() => { try { return this.getCommunity() || null; } catch { return null; } })();
    const T = game.tables;
    const key = [game.build, community?.version || "", T.items?.hotfix ?? "", ...["items", "spells", "talents", "recipes", "extras"].map((k) => (T[k] ? 1 : 0)), game.pending ? "p" : ""].join("|");
    if (this.index && key === this.key) return this.index;
    const s = this.sources();
    const profile = this.getProfile();
    const index = buildIndex({ ...s, community, clientBuild: game.build || profile?.clientBuild || null,
      game: T.items || T.spells ? { build: game.build, items: T.items?.items || null, itemView: require("./game-data.cjs").itemView, spells: T.spells?.spells || null, talents: T.talents?.talents || null, recipes: T.recipes?.recipes || null,
        flightPoints: T.extras?.extras?.flightPoints || null, spellLevels: T.extras?.extras?.spellLevels || null } : { reason: game.reason } });
    if (game.pending) { index.limits.unshift("Reading your game files. Items, spells, talents and recipes appear in a moment."); this.warm(game.build); }
    index.gameBuild = game.build; index.communityVersion = community?.version || null;
    this.index = index; this.key = key;
    return index;
  }
  context() {
    const p = this.getProfile(); let live = null;
    try { live = this.getLive() || null; } catch {}
    return { faction: ["Horde", "Alliance"].includes(p?.faction) ? p.faction : null, level: Number.isInteger(p?.level) ? p.level : null, mapId: live?.position?.mapId || p?.location?.mapId || null };
  }
  search(query, opts = {}) {
    if (typeof query !== "string" || !query.trim() || query.length > MAX_QUERY) throw Error("Invalid search.");
    if (opts === null || typeof opts !== "object" || Array.isArray(opts)) throw Error("Invalid search.");
    const index = this.ensure();
    return { ...search(index, query, this.context(), opts), index: this.stats() };
  }
  detail(kind, id) {
    const index = this.ensure();
    if (kind === "item" && Number.isSafeInteger(id) && id > 0) return { kind, id, sources: itemSources(index, id) };
    if (kind === "spell" && Number.isSafeInteger(id) && id > 0) {
      let spell = null;
      try { spell = this.gameData?.spell(id) || null; } catch {}
      return { kind, id, spell, sources: spellSources(index, id) };
    }
    throw Error("Invalid search detail.");
  }
  stats() {
    const i = this.index;
    return i ? { entries: i.entries.length, counts: i.counts, builtMs: Math.round(i.builtMs * 10) / 10, bytes: i.bytes, gameBuild: i.gameBuild || null, communityVersion: i.communityVersion || null, refused: i.refused } : null;
  }
}

module.exports = { WorldSearch, buildIndex, search, matchTier, fuzzyTier, editDistance, nudge, itemSources, spellSources, norm, KINDS, SOURCES, TIER, HELP_TOPICS, HELP_PAGES, MAX_QUERY };

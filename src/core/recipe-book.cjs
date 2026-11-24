"use strict";
// Recipe book (E2), computed skill path (E1), who can craft it (E3) and "cook what you carry" (E5).
// Pure projections. The recipe list, colours, materials and recipe items come from the player's
// own game files (game-data.cjs "recipes"); what a trainer asks comes from the bundled trainer
// pack; vendors, drops and quest rewards from the bundled community packs; prices only from what
// the player saw (auction price memory and vendor windows). Nothing is filled in by guessing.
const { MAP_NAMES } = require("./map-names.cjs");
const buildCompat = require("./build-compat.cjs");

const MAX_SKILL = 300, COOKING = 185, FISHING = 356;
const MAX_ID = 2147483647;
const isId = (n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_ID;
const KIND_ORDER = Object.freeze({ auto: 0, trainer: 1, vendor: 2, quest: 3, dungeon: 4, drop: 5 });
// Sources a player can plan around; drops and quest rewards are luck or one-offs.
const PATH_KINDS = Object.freeze(["auto", "trainer", "vendor"]);

/** Skill at which a recipe turns each colour. orange is null when the skill to learn it is not recorded. */
function thresholds(yellow, grey, learn = null) {
  const y = Math.max(0, yellow | 0), g = Math.max(y, grey | 0);
  return { orange: Number.isInteger(learn) && learn > 0 ? learn : null, yellow: y, green: Math.floor((y + g) / 2), grey: g };
}
function colourAt(t, skill) {
  if (!Number.isInteger(skill)) return null;
  return skill >= t.grey ? "grey" : skill >= t.green ? "green" : skill >= t.yellow ? "yellow" : "orange";
}
/** Chance of a skill point: always while orange, then falling in a line to zero at grey. */
function skillUpChance(t, skill) {
  if (skill < t.yellow) return 1;
  if (skill >= t.grey || t.grey <= t.yellow) return 0;
  return (t.grey - skill) / (t.grey - t.yellow);
}

/**
 * Where recipes come from, from the bundled packs. A pack checked on another patch than the
 * installed game is left out (same-patch rule); `carried` says a pack is from another build.
 */
function sourceIndex({ trainerPack = null, vendorPack = null, lootPack = null, bossLootPack = null, questPack = null, instanceNames = {}, build = null } = {}) {
  const ok = (pack, packBuild) => Boolean(pack) && (!build || buildCompat.usable(packBuild, build));
  let carried = false;
  const used = (packBuild) => { if (build && buildCompat.relation(packBuild, build) === "carried") carried = true; };
  const trainer = new Map(), vendors = new Map(), drops = new Map(), questItems = new Map(), questSpells = new Map(), vendorListed = new Set();
  const push = (map, key, value) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  if (ok(trainerPack, trainerPack?.build)) {
    used(trainerPack.build);
    for (const [profession, rows] of Object.entries(trainerPack.professions || {})) for (const r of rows) {
      if (!isId(r.id) || trainer.has(r.id)) continue;
      const copper = r.cost !== null && r.cost !== undefined ? r.cost : r.honored !== null && r.honored !== undefined ? Math.round(r.honored / 0.9) : null;
      trainer.set(r.id, { profession, skill: r.skill > 0 ? r.skill : null, copper, estimated: (r.cost === null || r.cost === undefined) && copper !== null, level: r.level > 0 ? r.level : null });
    }
  }
  if (ok(vendorPack, vendorPack?.build)) {
    used(vendorPack.build);
    for (const v of vendorPack.vendors || []) {
      const sides = Object.entries(v.observedReactionsByFaction || {}).filter(([, seen]) => Array.isArray(seen) && seen.some((n) => n >= 4)).map(([side]) => side).sort();
      const zone = v.positions?.[0] ? MAP_NAMES[v.positions[0].mapId] || null : null;
      for (const l of v.listings || []) { vendorListed.add(l.itemId); push(vendors, l.itemId, { npcId: v.id, name: v.name, zone, sides }); }
    }
  }
  if (ok(lootPack, lootPack?.builds?.[0])) {
    used(lootPack.builds[0]);
    for (const [id, rows] of Object.entries(lootPack.items || {})) for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.name || !(r.chance > 0)) continue;
      push(drops, Number(id), { kind: "drop", name: r.name, object: r.kind === "object", chance: r.chance, drops: r.drops });
    }
  }
  if (ok(bossLootPack, bossLootPack?.builds?.[0])) {
    used(bossLootPack.builds[0]);
    for (const [instanceId, inst] of Object.entries(bossLootPack.instances || {})) for (const b of inst.bosses || []) for (const x of b.items || [])
      push(drops, x.itemId, { kind: "dungeon", name: b.name, instance: instanceNames[instanceId] || instanceId, chance: x.chance, drops: x.drops });
  }
  if (ok(questPack, questPack?.build)) {
    used(questPack.build);
    for (const q of Object.values(questPack.quests || {})) {
      const base = { questId: q.id, title: q.title, sides: Array.isArray(q.sides) ? q.sides.filter((s) => s === "Alliance" || s === "Horde").sort() : [] };
      for (const r of q.rewards?.items || []) push(questItems, r.itemId, { ...base, choice: false });
      for (const r of q.rewards?.choices || []) push(questItems, r.itemId, { ...base, choice: true });
      for (const s of q.rewards?.spells || []) push(questSpells, s.spellId, { ...base, choice: false });
    }
  }
  return { trainer, vendors, drops, questItems, questSpells, vendorListed, carried };
}

/** What one material costs, from prices the player saw: the cheaper of auction memory and a vendor window. */
function unitPrice(itemId, prices, vendorSeen) {
  const a = prices?.get(itemId), v = vendorSeen?.get(itemId);
  const options = [a ? { copper: a.latest, at: a.latestAt, source: "auction" } : null, v ? { copper: v.unit, at: v.at, source: "vendor" } : null].filter(Boolean).sort((x, y) => x.copper - y.copper);
  return options[0] || null;
}

const sideOf = (profile) => (profile?.faction === "Alliance" || profile?.faction === "Horde" ? profile.faction : null);
/**
 * Sources as one character sees them: vendors and quests only players of the other faction were
 * seen with are marked and moved behind the rest; a vendor price is what the player saw himself.
 */
function forCharacter(sources, side, vendorSeen = new Map()) {
  for (const s of sources) {
    if (s.kind === "vendor") { const p = vendorSeen.get(s.itemId); s.price = p ? { copper: p.unit, at: p.at } : null; }
    if (s.kind === "vendor" || s.kind === "quest") s.otherSide = Boolean(side && s.sides.length && !s.sides.includes(side));
  }
  sources.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(Boolean(a.otherSide)) - Number(Boolean(b.otherSide)));
  return sources;
}

/** Recipe ids a character's save shows as known, and whether that list can be trusted to be whole. */
function knownRecipes(profile) {
  const saved = profile?.readiness?.workshop?.recipes, ids = new Set((saved?.items || []).map((r) => r.id));
  // The extras block also holds every known recipe id per profession (capture-extras.cjs). With it the
  // 100-recipe limit of the detailed list no longer hides anything. whole(skillLineId) says whether
  // the game handed over the full list of that one profession (the saved skill line id).
  const list = require("./capture-extras.cjs").knownRecipeList(profile);
  if (list) {
    for (const id of list.ids) ids.add(id);
    const whole = (line) => list.lines.get(line)?.whole === true;
    return { ids, observed: true, listed: true, capped: false, complete: [...list.lines.keys()].every(whole), whole };
  }
  const complete = saved?.complete === true, capped = (saved?.items?.length || 0) >= 100;
  return { ids, observed: Boolean(saved), listed: false, complete, capped, whole: () => complete && !capped };
}
const professionsOf = (profile) => (profile?.readiness?.workshop?.professions?.items || []).filter((p) => isId(p.skillLineId));

/**
 * Game facts for one skill line: `game` is { recipes: {lines, rows, teach}, spells(ids), items(ids) }.
 * Returns plain recipe rows without anything about a character.
 */
function lineRecipes(game, skillLineId, index) {
  const rows = (game?.recipes?.rows || []).filter((r) => r[1] === skillLineId);
  const spellFacts = game.spells(rows.map((r) => r[0]));
  const itemIds = new Set();
  for (const r of rows) { if (r[6]) itemIds.add(r[6]); for (let i = 0; i < r[8].length; i += 2) itemIds.add(r[8][i]); for (let i = 0, t = game.recipes.teach[r[0]] || []; i < t.length; i += 2) itemIds.add(t[i]); }
  const idList = [...itemIds], found = game.items(idList), items = new Map(idList.map((id, i) => [id, found[i]]));
  const itemsReadable = found.some(Boolean);
  const out = [];
  let leftOut = 0;
  rows.forEach((r, i) => {
    const [spell, , yellow, grey, auto, skillUps, madeId, madeCount, uses] = r;
    const madeItem = madeId ? items.get(madeId) : null;
    // A recipe for an item the game does not have is a leftover in the files, not something to chase.
    if (madeId && itemsReadable && !madeItem) { leftOut++; return; }
    const name = spellFacts[i]?.name || madeItem?.name;
    if (!name) { leftOut++; return; }
    const sources = [];
    let learn = null;
    const need = (skill) => { if (Number.isInteger(skill) && skill > 0 && (learn === null || skill < learn)) learn = skill; };
    if (auto > 0) { sources.push({ kind: "auto", skill: auto }); need(auto); }
    const t = index?.trainer.get(spell);
    if (t) { sources.push({ kind: "trainer", skill: t.skill, copper: t.copper, estimated: t.estimated, level: t.level }); need(t.skill); }
    const teach = game.recipes.teach[spell] || [];
    const recipeItems = [];
    for (let k = 0; k < teach.length; k += 2) {
      const itemId = teach[k], skill = teach[k + 1] > 0 ? teach[k + 1] : null, itemName = items.get(itemId)?.name || null;
      if (itemsReadable && !itemName) continue;
      recipeItems.push({ itemId, name: itemName, skill });
      let found = false;
      for (const v of index?.vendors.get(itemId) || []) { found = true; sources.push({ kind: "vendor", itemId, itemName, skill, npcId: v.npcId, name: v.name, zone: v.zone, sides: v.sides }); }
      for (const d of index?.drops.get(itemId) || []) { found = true; sources.push({ kind: d.kind, itemId, itemName, skill, name: d.name, instance: d.instance || null, object: Boolean(d.object), chance: d.chance, drops: d.drops }); }
      for (const q of index?.questItems.get(itemId) || []) { found = true; sources.push({ kind: "quest", itemId, itemName, skill, questId: q.questId, title: q.title, choice: q.choice, sides: q.sides }); }
      if (found) need(skill);
    }
    for (const q of index?.questSpells.get(spell) || []) sources.push({ kind: "quest", questId: q.questId, title: q.title, choice: false, sides: q.sides });
    // A recipe item nobody recorded a place for still tells the skill it needs.
    if (!sources.length) for (const it of recipeItems) need(it.skill);
    sources.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.chance || 0) - (a.chance || 0) || String(a.name || a.title || "").localeCompare(String(b.name || b.title || "")));
    const materials = [];
    for (let k = 0; k < uses.length; k += 2) { const it = items.get(uses[k]); materials.push({ itemId: uses[k], name: it?.name || `Item #${uses[k]}`, count: uses[k + 1], quality: it?.quality ?? null, iconFileId: it?.iconFileId || null }); }
    out.push({
      id: spell, skillLineId, name, iconFileId: madeItem?.iconFileId || spellFacts[i]?.iconFileId || null, quality: madeItem?.quality ?? null,
      ...thresholds(yellow, grey, learn), skillUps: skillUps > 0 ? skillUps : 1,
      made: madeId ? { itemId: madeId, name: madeItem?.name || name, count: madeCount || 1 } : null,
      materials, recipeItems, sources, sourceKinds: [...new Set(sources.map((s) => s.kind))],
    });
  });
  out.sort((a, b) => a.yellow - b.yellow || a.grey - b.grey || a.name.localeCompare(b.name) || a.id - b.id);
  return { recipes: out, leftOut };
}

/** The skill line of the game files a saved profession belongs to: by id, else by its English name. */
function lineFor(game, saved) {
  const lines = game?.recipes?.lines || {};
  if (lines[saved.skillLineId]) return saved.skillLineId;
  const name = String(saved.name || "").toLowerCase();
  const hit = Object.entries(lines).find(([, l]) => l[0].toLowerCase() === name);
  return hit ? Number(hit[0]) : null;
}
/** Professions to choose from: the character's own first, then every other one the game files define. */
function professionChoices(profile, game) {
  const lines = game?.recipes?.lines || {}, counts = new Map();
  for (const r of game?.recipes?.rows || []) counts.set(r[1], (counts.get(r[1]) || 0) + 1);
  const mine = [], taken = new Set();
  for (const p of professionsOf(profile)) {
    const line = lineFor(game, p);
    if (!line || taken.has(line) || !counts.get(line)) continue;
    taken.add(line);
    mine.push({ skillLineId: line, name: p.name, rank: p.rank, maxRank: p.maxRank, yours: true, recipes: counts.get(line) });
  }
  const others = Object.entries(lines).map(([id, l]) => ({ skillLineId: Number(id), name: l[0], rank: null, maxRank: null, yours: false, recipes: counts.get(Number(id)) || 0 }))
    .filter((l) => !taken.has(l.skillLineId) && l.recipes >= 10 && !/\[DNT\]|^Test /.test(l.name)).sort((a, b) => a.name.localeCompare(b.name));
  return [...mine, ...others];
}

/**
 * The recipe book of one profession for one character.
 * prices: ledger.priceIndex(profiles); vendorSeen: economy.vendorIndex(profiles).
 */
function recipeBook(profile, game, index, { skillLineId = null, prices = new Map(), vendorSeen = new Map() } = {}) {
  if (!game?.recipes) return { status: "no-game-data", reason: "The recipe list is read from your own game files. Connect your WoW Forever folder in Settings, then open this page again." };
  const choices = professionChoices(profile, game);
  if (!choices.length) return { status: "empty", reason: "Your game files list no profession recipes this app can read.", choices };
  const choice = choices.find((c) => c.skillLineId === skillLineId) || choices[0];
  const { recipes, leftOut } = lineRecipes(game, choice.skillLineId, index);
  const known = knownRecipes(profile), rank = choice.yours && Number.isInteger(choice.rank) ? choice.rank : null;
  const listWhole = professionsOf(profile).some((p) => lineFor(game, p) === choice.skillLineId && known.whole(p.skillLineId));
  const side = sideOf(profile);
  for (const r of recipes) {
    r.known = choice.yours && known.ids.has(r.id);
    r.colour = rank === null ? null : colourAt(r, rank);
    // "Learnable now": not known, a recorded way to get it, and enough skill for it.
    r.learnable = !r.known && rank !== null && r.orange !== null && rank >= r.orange && r.sources.length > 0;
    forCharacter(r.sources, side, vendorSeen);
    let cost = 0;
    for (const m of r.materials) { const p = unitPrice(m.itemId, prices, vendorSeen); m.unit = p?.copper ?? null; m.priceAt = p?.at ?? null; m.priceSource = p?.source ?? null; cost = cost === null || !p ? null : cost + p.copper * m.count; }
    r.cost = r.materials.length ? cost : null;
  }
  const count = (kind) => recipes.filter((r) => (kind === "none" ? !r.sources.length : r.sourceKinds.includes(kind))).length;
  const notes = [];
  if (choice.yours && !known.observed) notes.push("No recipes are saved for this character yet. Open the profession window in game once, then /reload or log out.");
  else if (choice.yours && known.listed && !listWhole) notes.push("The game did not hand over the full recipe list at the last save, so a recipe marked as missing can be one you know. Open each profession window in game once, then /reload.");
  else if (choice.yours && !known.listed && (!known.complete || known.capped)) notes.push("Your save holds at most 100 recipes per character and may miss some, so a recipe marked as missing can be one you know. Open each profession window in game to refresh it.");
  if (!choice.yours) notes.push("This character does not have this profession in its save, so nothing is marked as known.");
  if (leftOut) notes.push(`${leftOut} ${leftOut === 1 ? "entry" : "entries"} in the game files left out: the item it makes is not in this game.`);
  if (index?.carried) notes.push("Some trainer, vendor or drop data was checked on another build of the same patch.");
  notes.push("Trainer skill and cost: seen in trainer windows by other players (not every trainer recipe is recorded). Vendors and drops: community reference; limited stock is not recorded in it.");
  return {
    status: "available", choices, profession: choice, rank, recipes, notes,
    counts: { total: recipes.length, known: recipes.filter((r) => r.known).length, missing: recipes.filter((r) => !r.known).length, learnable: recipes.filter((r) => r.learnable).length,
      trainer: count("trainer"), vendor: count("vendor"), drop: recipes.filter((r) => r.sourceKinds.includes("drop") || r.sourceKinds.includes("dungeon")).length, quest: count("quest"), auto: count("auto"), none: count("none") },
  };
}

/**
 * A skill path worked out from the recipe table: for every skill point the orange or yellow recipe
 * with the lowest expected material cost, joined into ranges. Costs use only seen prices; a recipe
 * with a material never seen has no cost and cannot be called the cheapest.
 * recipes: rows from recipeBook() (with known, cost, materials).
 */
function levelingPath(recipes, { rank = null, from = 1, to = MAX_SKILL } = {}) {
  const start = Math.max(1, Math.min(from, to)), end = Math.max(start, to);
  const usable = [], fallback = [];
  let noSkill = 0, otherSource = 0;
  for (const r of recipes) {
    if (!r.materials.length || r.grey <= 0) continue;
    const planned = r.known || r.sourceKinds.some((k) => PATH_KINDS.includes(k));
    // A recipe you already know is usable from your skill on, whatever it needed to learn.
    const at = r.orange !== null ? r.orange : r.known && rank !== null ? rank : null;
    if (at === null) { noSkill++; continue; }
    if (!planned) otherSource++;
    (planned ? usable : fallback).push({ r, at: r.known && rank !== null ? Math.min(at, rank) : at });
  }
  const steps = [];
  for (let s = start; s < end; s++) {
    const at = (list) => list.filter((u) => u.at <= s && s < u.r.green).map((u) => {
      const chance = skillUpChance(u.r, s);
      return { r: u.r, chance, expected: u.r.cost === null ? null : u.r.cost / chance };
    });
    // Recipes from a trainer or vendor (or already known) first; drops, quest rewards and
    // recipes with no recorded source only where nothing else gives skill.
    let cands = at(usable);
    const uncertain = !cands.length;
    if (uncertain) cands = at(fallback);
    const priced = cands.filter((c) => c.expected !== null).sort((a, b) => a.expected - b.expected || a.r.name.localeCompare(b.r.name));
    const unpriced = cands.filter((c) => c.expected === null).sort((a, b) => b.chance - a.chance || a.r.materials.length - b.r.materials.length || a.r.name.localeCompare(b.r.name));
    const pick = priced[0] || null;
    const key = (uncertain ? "x" : "") + (pick ? `p${pick.r.id}` : unpriced.length ? `u${unpriced[0].r.id}` : "gap");
    const last = steps.at(-1);
    if (last && last.key === key) { last.to = s + 1; last.crafts += pick ? 1 / pick.chance : 0; continue; }
    steps.push({ key, uncertain, from: s, to: s + 1, crafts: pick ? 1 / pick.chance : 0, pick, others: (pick ? priced.slice(1) : []).slice(0, 2), unpriced: unpriced.slice(0, 3), unpricedCount: unpriced.length });
  }
  const brief = (c) => ({ id: c.r.id, name: c.r.name, iconFileId: c.r.iconFileId, known: Boolean(c.r.known), colour: c.chance === 1 ? "orange" : "yellow", cost: c.r.cost,
    sourceKinds: c.r.sourceKinds, materials: c.r.materials.map((m) => ({ itemId: m.itemId, name: m.name, count: m.count, unit: m.unit })) });
  const ranges = steps.map((st) => {
    const out = { from: st.from, to: st.to, kind: st.pick ? "priced" : st.unpriced.length ? "unpriced" : "gap", uncertain: st.uncertain && (Boolean(st.pick) || st.unpriced.length > 0), current: rank !== null && rank >= st.from && rank < st.to, done: rank !== null && rank >= st.to };
    if (st.pick) {
      const crafts = Math.ceil(st.crafts - 1e-9);
      Object.assign(out, { recipe: brief(st.pick), crafts, cost: st.pick.r.cost * crafts,
        materials: st.pick.r.materials.map((m) => ({ itemId: m.itemId, name: m.name, count: m.count * crafts })),
        others: st.others.map(brief), unpricedCount: st.unpricedCount });
    } else if (st.unpriced.length) Object.assign(out, { options: st.unpriced.map(brief), unpricedCount: st.unpricedCount });
    return out;
  });
  const priced = ranges.filter((r) => r.kind === "priced");
  return {
    from: start, to: end, rank, ranges,
    total: priced.length ? priced.reduce((n, r) => n + r.cost, 0) : null,
    covered: priced.reduce((n, r) => n + (r.to - r.from), 0), points: end - start,
    leftOut: { noSkill, otherSource },
  };
}

const words = (q) => String(q || "").toLowerCase().trim().slice(0, 100).split(/\s+/).filter(Boolean);
/**
 * Who of your saved characters can make an item, and who is closest in skill.
 * Without game files only the recipes saved with each character can be searched.
 */
function whoCanCraft(profiles, game, index, query, { limit = 20 } = {}) {
  const w = words(query);
  if (!w.length || w.join("").length < 2) return { status: "empty", query: w.join(" "), results: [], gameData: Boolean(game?.recipes) };
  const match = (name) => { const n = String(name || "").toLowerCase(); return w.every((x) => n.includes(x)); };
  const chars = (profiles || []).map((p) => ({ p, known: knownRecipes(p), professions: professionsOf(p) })).filter((c) => c.professions.length || c.known.ids.size);
  const results = [];
  const who = (p) => ({ profileId: p.id, name: p.name, realm: p.realm || "", faction: p.faction || null, className: p.className || null, level: Number.isInteger(p.level) ? p.level : null });
  if (game?.recipes) {
    const lines = game.recipes.lines, hits = [];
    const madeIds = [...new Set(game.recipes.rows.map((r) => r[6]).filter(Boolean))], madeItems = game.items(madeIds), madeName = new Map(madeIds.map((id, i) => [id, madeItems[i]]));
    const spellNames = game.spells(game.recipes.rows.map((r) => r[0]));
    const itemsReadable = madeItems.some(Boolean);
    game.recipes.rows.forEach((r, i) => {
      const item = r[6] ? madeName.get(r[6]) : null, name = item?.name || spellNames[i]?.name;
      if (!name || (r[6] && !item && itemsReadable) || !match(name)) return;
      hits.push({ row: r, name, item, spell: spellNames[i] });
    });
    hits.sort((a, b) => (a.name.toLowerCase() === w.join(" ") ? -1 : 0) - (b.name.toLowerCase() === w.join(" ") ? -1 : 0) || a.name.length - b.name.length || a.name.localeCompare(b.name));
    const byLine = new Map();
    for (const h of hits.slice(0, limit)) {
      const line = h.row[1];
      if (!byLine.has(line)) byLine.set(line, new Map(lineRecipes(game, line, index).recipes.map((x) => [x.id, x])));
      const full = byLine.get(line).get(h.row[0]);
      if (!full) continue;
      const makers = [];
      for (const c of chars) {
        const prof = c.professions.find((p) => lineFor(game, p) === line);
        const knows = c.known.ids.has(full.id);
        if (!prof && !knows) continue;
        const rank = prof ? prof.rank : null;
        const gap = knows ? 0 : full.orange !== null && rank !== null ? Math.max(0, full.orange - rank) : null;
        makers.push({ ...who(c.p), knows, rank, maxRank: prof ? prof.maxRank : null, gap, colour: knows && rank !== null ? colourAt(full, rank) : null,
          saveMayMiss: !knows && !(prof ? c.known.whole(prof.skillLineId) : c.known.complete && !c.known.capped) });
      }
      makers.sort((a, b) => Number(b.knows) - Number(a.knows) || (a.gap === null) - (b.gap === null) || (a.gap ?? 0) - (b.gap ?? 0) || (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name));
      results.push({ id: full.id, name: full.name, iconFileId: full.iconFileId, quality: full.quality, itemId: full.made?.itemId || null, profession: lines[line][0], skillLineId: line,
        orange: full.orange, yellow: full.yellow, grey: full.grey, materials: full.materials.map((m) => ({ itemId: m.itemId, name: m.name, count: m.count })), sourceKinds: full.sourceKinds, makers });
    }
    results.sort((a, b) => Number(b.makers.some((m) => m.knows)) - Number(a.makers.some((m) => m.knows)) || b.makers.length - a.makers.length || a.name.localeCompare(b.name));
    return { status: "available", query: w.join(" "), gameData: true, results, more: Math.max(0, hits.length - limit), characters: chars.length };
  }
  const seen = new Map();
  for (const c of chars) for (const r of c.p.readiness?.workshop?.recipes?.items || []) {
    if (!match(r.name)) continue;
    const prof = c.professions.find((p) => p.skillLineId === r.skillLineId);
    let row = seen.get(r.id);
    if (!row) { row = { id: r.id, name: r.name, iconFileId: null, quality: null, itemId: r.outputItemId || null, profession: prof?.name || null, skillLineId: r.skillLineId, orange: null, yellow: null, grey: null,
      materials: r.reagentsKnown ? r.reagents.map((m) => ({ itemId: m.itemId, name: m.name || `Item #${m.itemId}`, count: m.required })) : [], sourceKinds: [], makers: [] }; seen.set(r.id, row); }
    row.makers.push({ ...who(c.p), knows: true, rank: prof?.rank ?? null, maxRank: prof?.maxRank ?? null, gap: 0, colour: null, saveMayMiss: false });
  }
  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { status: "available", query: w.join(" "), gameData: false, results: list.slice(0, limit), more: Math.max(0, list.length - limit), characters: chars.length };
}

/** What a character holds: bags and bank from the Ledger, else the bags saved with the workshop. */
function holdings(profile) {
  const have = new Map(), l = profile?.ledger;
  let source = null, seenAt = null, bank = false;
  if (l?.bags?.items) {
    source = "ledger"; seenAt = l.bags.seenAt ?? null;
    for (const e of l.bags.items) have.set(e.id, (have.get(e.id) || 0) + e.n);
    if (l.bank?.items) { bank = true; for (const e of l.bank.items) have.set(e.id, (have.get(e.id) || 0) + e.n); }
  } else if (profile?.readiness?.workshop?.materials?.items) {
    source = "workshop";
    const at = Date.parse(profile.readiness.workshop.materials.observedAt);
    seenAt = Number.isFinite(at) ? Math.floor(at / 1000) : null;
    for (const e of profile.readiness.workshop.materials.items) have.set(e.itemId, (have.get(e.itemId) || 0) + e.count);
  }
  return { have, source, seenAt, bank, bankSeenAt: bank ? l.bank.seenAt ?? null : null };
}

/**
 * "Cook what you just looted": cooking recipes against what the character holds.
 *  ready: known recipes you hold everything for; short: known, you hold an ingredient but not all;
 *  learn: recipes you do not know for ingredients you hold (with where they come from).
 * An ingredient here is a material no vendor in the reference sells (spices do not count).
 */
function cookNow(profile, game, index, { skillLineId = COOKING, vendorSeen = new Map() } = {}) {
  const professions = professionsOf(profile);
  const fishing = professions.find((p) => p.skillLineId === FISHING || /^fishing$/i.test(p.name)) || null;
  const fishingNote = "The fishing skill each zone needs is not in the game files this app can read, so it is not shown.";
  const base = { fishing: fishing ? { rank: fishing.rank, maxRank: fishing.maxRank } : null, fishingNote };
  const cooking = professions.find((p) => p.skillLineId === skillLineId || /^cooking$/i.test(p.name)) || null;
  const held = holdings(profile);
  const basics = { ...base, cooking: cooking ? { rank: cooking.rank, maxRank: cooking.maxRank } : null, inventory: { source: held.source, seenAt: held.seenAt, bank: held.bank, bankSeenAt: held.bankSeenAt, kinds: held.have.size } };
  if (!cooking) return { status: "no-cooking", reason: "This character has no Cooking in its save.", ...basics, ready: [], short: [], learn: [] };
  if (!held.source) return { status: "no-bags", reason: "No saved bags for this character yet. Log in with the addon, then /reload or log out.", ...basics, ready: [], short: [], learn: [] };
  const known = knownRecipes(profile), rank = cooking.rank;
  let recipes;
  if (game?.recipes) recipes = lineRecipes(game, lineFor(game, cooking) || skillLineId, index).recipes.map((r) => ({ ...r, known: known.ids.has(r.id) }));
  else recipes = (profile.readiness.workshop.recipes?.items || []).filter((r) => r.skillLineId === cooking.skillLineId && r.reagentsKnown && r.reagents.length)
    .map((r) => ({ id: r.id, name: r.name, iconFileId: null, quality: null, known: true, orange: null, yellow: null, green: null, grey: null, sources: [], sourceKinds: [],
      made: r.outputItemId ? { itemId: r.outputItemId, name: r.name, count: r.outputMin || 1 } : null, savedColour: r.difficulty || null,
      materials: r.reagents.map((m) => ({ itemId: m.itemId, name: m.name || `Item #${m.itemId}`, count: m.required })) }));
  const SAVED = { optimal: "orange", medium: "yellow", easy: "green", trivial: "grey" };
  const ready = [], short = [], learn = [];
  for (const r of recipes) {
    if (!r.materials.length) continue;
    const mats = r.materials.map((m) => ({ itemId: m.itemId, name: m.name, count: m.count, have: held.have.get(m.itemId) || 0, iconFileId: m.iconFileId || null, vendor: Boolean(index?.vendorListed.has(m.itemId)) }));
    const crafts = Math.min(...mats.map((m) => Math.floor(m.have / m.count)));
    const holdsIngredient = mats.some((m) => m.have > 0 && !m.vendor);
    const colour = r.grey === null || r.grey === undefined ? SAVED[r.savedColour] || null : colourAt(r, rank);
    const row = { id: r.id, name: r.name, iconFileId: r.iconFileId, quality: r.quality, itemId: r.made?.itemId || null, makes: r.made?.count || 1, colour, yellow: r.yellow, grey: r.grey, orange: r.orange, materials: mats, crafts };
    if (r.known && crafts >= 1) ready.push(row);
    else if (r.known && holdsIngredient) short.push({ ...row, missing: mats.filter((m) => m.have < m.count).map((m) => ({ itemId: m.itemId, name: m.name, need: m.count - m.have, vendor: m.vendor })) });
    else if (!r.known && holdsIngredient) learn.push({ ...row, canLearn: r.orange !== null ? rank >= r.orange : null, sources: forCharacter(r.sources, sideOf(profile), vendorSeen).slice(0, 3), sourceCount: r.sources.length });
  }
  const order = { orange: 0, yellow: 1, green: 2, grey: 3, null: 4 };
  const byColour = (a, b) => order[a.colour] - order[b.colour] || b.crafts - a.crafts || a.name.localeCompare(b.name);
  ready.sort(byColour); short.sort(byColour);
  learn.sort((a, b) => Number(b.canLearn === true) - Number(a.canLearn === true) || (a.orange ?? 999) - (b.orange ?? 999) || a.name.localeCompare(b.name));
  const notes = [];
  if (!game?.recipes) notes.push("Your game files could not be read, so only recipes saved with this character are checked.");
  if (!known.whole(cooking.skillLineId)) notes.push("Your save may not hold every recipe you know; a recipe under \"You could learn\" can be one you already have.");
  if (!held.bank) notes.push(held.source === "workshop" ? "Only the bags saved with your professions are counted." : "Your bank was not seen yet, so only bags are counted. Open the bank once in game.");
  return { status: "available", ...basics, gameData: Boolean(game?.recipes), ready, short: short.slice(0, 30), learn: learn.slice(0, 30), notes };
}

module.exports = { forCharacter, MAX_SKILL, COOKING, FISHING, PATH_KINDS, thresholds, colourAt, skillUpChance, sourceIndex, unitPrice, knownRecipes, lineRecipes, lineFor, professionChoices, recipeBook, levelingPath, whoCanCraft, holdings, cookNow };

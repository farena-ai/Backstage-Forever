"use strict";
// Skill-up colours, the best next recipe, a skill-up countdown and a shopping list.
// Pure projections of saved observations; every chance below is an estimate.
const { MAP_NAMES } = require("./map-names.cjs");

// Classic crafting: orange always skills up, yellow usually, green rarely, grey never.
// Yellow and green slide from 100% to 50% and from 50% to 0% as your skill rises;
// the midpoints below are the expected chance used for the countdown.
const SKILL_COLORS = Object.freeze({
  optimal: Object.freeze({ color: "orange", label: "Orange", chance: 1, words: "always a skill-up" }),
  medium: Object.freeze({ color: "yellow", label: "Yellow", chance: 0.75, words: "usually a skill-up" }),
  easy: Object.freeze({ color: "green", label: "Green", chance: 0.25, words: "sometimes a skill-up" }),
  trivial: Object.freeze({ color: "grey", label: "Grey", chance: 0, words: "no skill-ups" }),
});
const UNKNOWN = Object.freeze({ color: "unknown", label: "Colour unknown", chance: null, words: "skill-up chance not observed" });
// Prefer orange, then yellow; an unobserved colour that can still skill up sits before green.
const RANK = Object.freeze({ optimal: 0, medium: 1, unknown: 2, easy: 3, trivial: 4 });

/** The observed colour key (optimal/medium/easy/trivial), or "unknown". Grey is never inferred. */
function difficultyOf(recipe) {
  return Object.hasOwn(SKILL_COLORS, recipe?.difficulty) ? recipe.difficulty : "unknown";
}
function skillColor(recipe) {
  const key = difficultyOf(recipe);
  return { difficulty: key, observed: key !== "unknown", ...(key === "unknown" ? UNKNOWN : SKILL_COLORS[key]) };
}
const colorRank = (recipe) => RANK[difficultyOf(recipe)];
/** Units of material one craft takes (0 when unknown). */
const materialUnits = (recipe) => (recipe?.reagentsKnown ? recipe.reagents.reduce((n, r) => n + r.required, 0) : 0);

/**
 * Estimated crafts to the next skill point and to the profession's current cap
 * (the trainer cap you have learned), if this recipe kept its colour. Null without a rank.
 */
function skillUpCountdown(profession, recipe) {
  if (!profession || !recipe || !Number.isSafeInteger(profession.rank) || !Number.isSafeInteger(profession.maxRank)) return null;
  const c = skillColor(recipe), points = Math.max(0, profession.maxRank - profession.rank);
  const chance = recipe.canSkillUp === false ? 0 : c.chance;
  const at = { rank: profession.rank, maxRank: profession.maxRank, pointsToCap: points };
  if (points === 0)
    return { ...at, estimate: true, difficulty: c.difficulty, color: c.color, chance, craftsPerPoint: null, craftsToNextPoint: null, craftsToCap: 0, status: "at-cap", detail: `${profession.name} is at its current cap (${profession.maxRank}). Train the next rank to keep going.` };
  if (chance === null)
    return { ...at, estimate: true, difficulty: c.difficulty, color: c.color, chance: null, craftsPerPoint: null, craftsToNextPoint: null, craftsToCap: null, status: "unknown", detail: "This recipe's skill-up colour was not observed. Open your profession in game once so the addon can read it." };
  if (chance === 0)
    return { ...at, estimate: true, difficulty: c.difficulty, color: c.color, chance: 0, craftsPerPoint: null, craftsToNextPoint: null, craftsToCap: null, status: "grey", detail: `${recipe.name} is grey for you: it no longer gives skill-ups. Pick an orange or yellow recipe.` };
  const perPoint = 1 / chance;
  return {
    ...at, estimate: true, difficulty: c.difficulty, color: c.color, chance,
    craftsPerPoint: Math.round(perPoint * 10) / 10,
    craftsToNextPoint: Math.ceil(perPoint),
    craftsToCap: Math.ceil(points / chance),
    status: "estimate",
    detail: `Estimate: about ${Math.ceil(points / chance)} crafts of ${recipe.name} for the ${points} point${points === 1 ? "" : "s"} to ${profession.maxRank}, if it stayed ${c.label.toLowerCase()}. Recipes turn yellow, green and grey as you improve, so switch when the colour drops.`,
  };
}

// The seller's observed spot nearest to you on your map, else its first observed spot.
function near(positions, here) {
  const list = Array.isArray(positions) ? positions : [];
  const same = here ? list.filter((p) => p.mapId === here.mapId) : [];
  const d = (p) => Math.hypot(p.x - here.x, p.y - here.y);
  return same.length ? same.reduce((a, b) => (d(b) < d(a) ? b : a)) : list[0] || null;
}
function savedThrough(profile, now) {
  return profile?.source?.kind === "wow-addon" && profile.clientBuild
    ? Math.min(now, Math.floor(Date.parse(profile.source.updatedAt) / 1000)) : 0;
}
const dated = (at, through) => Number.isSafeInteger(at) && at > 0 && at <= through;
// Each location has its own clock. Never sum observations of potentially moved stock.
function storageLeads(itemId, profile, places, now) {
  const through = savedThrough(profile, now), out = [];
  for (const place of places) {
    const snapshot = profile?.ledger?.[place];
    if (!dated(snapshot?.seenAt, through)) continue;
    const item = snapshot.items.find(e => e.id === itemId);
    if (item) out.push({ profileId: profile.id, name: profile.name, realm: profile.realm ?? null,
      clientBuild: profile.clientBuild, place, count: item.n, seenAt: snapshot.seenAt, complete: snapshot.complete === true });
  }
  return out;
}
function rememberedPrice(profile, itemId, now) {
  const through = savedThrough(profile, now);
  const item = profile?.ledger?.prices?.find(e => e.id === itemId);
  const latest = item?.hist.reduce((best, entry) => {
    const [price, at] = entry;
    if (!dated(at, through)) return best;
    return !best || at > best[1] || (at === best[1] && price < best[0]) ? entry : best;
  }, null);
  return latest ? { source: "saved-auction-buyout", unitCopper: latest[0], seenAt: latest[1], ageSeconds: now - latest[1] } : null;
}
const purchaseCost = (quantity, unit) => quantity === 0 ? 0 :
  quantity !== null && Number.isSafeInteger(quantity * unit) && unit > 0 ? quantity * unit : null;
function fullPurchaseCost(amounts) {
  if (!amounts.length || amounts.includes(null)) return null;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  return Number.isSafeInteger(total) ? total : null;
}

/** Materials and historical source leads; the purchase scenario uses only the carried shortfall. */
function shoppingList(rows, { crafts = 1, profile = null, profiles = [], now = Math.floor(Date.now() / 1000) } = {}) {
  const here = profile?.location && Number.isSafeInteger(profile.location.mapId) && Number.isFinite(profile.location.x) && Number.isFinite(profile.location.y) ? profile.location : null;
  const finds = new Map();
  // Gathering finds only: chest loot is random, not a place to gather a material.
  for (const r of profile?.gathering?.records || []) if (r.method !== "chest") for (const id of r.itemIds || []) if (!finds.has(id)) finds.set(id, r);
  const out = (rows || []).map((row) => {
    const sellers = [...(row.historicalSellers?.suggestions || []), ...(row.historicalSellers?.browse || [])];
    const seller = sellers[0] || null, at = seller ? near(seller.positions, here) : null;
    const gathered = (row.acquisition?.sources || []).find((s) => s.kind === "gathered-object-loot") || null;
    const own = finds.get(row.itemId) || null;
    const source = seller ? "vendor" : own || gathered ? "gather" : "other";
    const need = row.quantityKind === "exact" && Number.isSafeInteger(row.missing) && row.missing >= 0 ? row.missing : null;
    const price = rememberedPrice(profile, row.itemId, now);
    return {
      itemId: row.itemId, name: row.name, required: row.required, have: row.have, missing: row.missing, need, quantityKind: row.quantityKind, source,
      ownStorage: storageLeads(row.itemId, profile, ["bank", "mail"], now),
      altStock: profile ? profiles.filter(p => p.id !== profile.id).flatMap(p => storageLeads(row.itemId, p, ["bags", "bank", "mail"], now)) : [],
      projectedPurchase: need, price, estimatedCopper: purchaseCost(need, price?.unitCopper),
      vendor: seller ? { id: seller.id, name: seller.name, suggested: Boolean(seller.suggested), mapId: at?.mapId ?? null, mapName: at ? MAP_NAMES[at.mapId] || `Map ${at.mapId}` : null, x: at?.x ?? null, y: at?.y ?? null, otherSellers: Math.max(0, (row.historicalSellers?.observedSellerCount || sellers.length) - 1) } : null,
      gather: own ? { kind: own.method, name: own.name, mapId: own.mapId, mapName: MAP_NAMES[own.mapId] || `Map ${own.mapId}`, x: own.x, y: own.y, yours: true }
        : gathered ? { kind: gathered.gatherSpellId === 2368 ? "herbalism" : gathered.gatherSpellId === 2576 ? "mining" : "gathering", name: gathered.referenceName, mapId: gathered.positions?.[0]?.mapId ?? null, mapName: gathered.positions?.[0] ? MAP_NAMES[gathered.positions[0].mapId] || `Map ${gathered.positions[0].mapId}` : null, x: gathered.positions?.[0]?.x ?? null, y: gathered.positions?.[0]?.y ?? null, yours: false }
        : null,
    };
  });
  return {
    crafts,
    rows: out,
    batchPurchaseEstimate: fullPurchaseCost(out.map(row => row.estimatedCopper)),
    counts: { vendor: out.filter((r) => r.source === "vendor").length, gather: out.filter((r) => r.source === "gather").length, other: out.filter((r) => r.source === "other").length },
    note: "Vendor listings are historical observations: stock, price and access are unverified. Gather/buy means no seller was observed; try gathering, the auction house or trade.",
  };
}
function nextPointPurchaseEstimate(list, attempts) {
  if (!attempts || !list.rows.length) return null;
  const amounts = list.rows.map(r => purchaseCost(r.quantityKind === "exact"
    ? Math.max(0, (r.required / list.crafts) * attempts - r.have) : null, r.price?.unitCopper));
  return { attempts, estimatedCopper: fullPurchaseCost(amounts) };
}
module.exports = { SKILL_COLORS, RANK, difficultyOf, skillColor, colorRank, materialUnits, skillUpCountdown, shoppingList, nextPointPurchaseEstimate };

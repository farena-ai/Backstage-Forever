"use strict";
const { shoppingList } = require("./profession-skillup.cjs");
const { acquisitionFacts } = require("./acquisition-data.cjs");

// Keep the expansion a small manual plan.
const MAX_ITEMS = 20;
const MAX_ATTEMPTS = 1000;
const opaque = reason => ({ status: "unknown", reason, directReady: null, steps: [], rows: [], batchPurchaseEstimate: null });

/** Trace only exact saved item IDs and fixed yields. Never recurse through alt recipes or stock. */
function workshopDecision(model, profile, profiles, { acquisitionPack, now = Math.floor(Date.now() / 1000) }) {
  const root = model.selectedRecipe;
  if (!root || !model.planning.available) return null;
  const workshop = profile.readiness.workshop;
  if (workshop.professions.observedAt > workshop.recipes.observedAt ||
      Object.values(workshop).some(c => Date.parse(c.observedAt) >= (now + 1) * 1000))
    return opaque("The saved profession or recipe dates do not support this batch trace.");
  if (!model.planning.inventoryExact)
    return opaque("A complete, compatible carried-bag observation is needed. Storage and alt leads cannot establish a shortfall.");

  const directReady = model.shoppingRows.every(r => r.missing === 0);
  const bags = new Map(model.materials.map(m => [m.itemId, m]));
  const producers = new Map(), owned = new Set(model.professions.map(p => p.skillLineId));
  for (const r of model.recipes) {
    if (!r.outputItemId) continue;
    if (!producers.has(r.outputItemId)) producers.set(r.outputItemId, []);
    producers.get(r.outputItemId).push(r);
  }
  const nodes = new Map(), order = [], visiting = new Set();
  let problem;
  // Build consumer-before-supplier order by reversing DFS postorder. Every shared
  // material sees all of its demand before bag stock is deducted or crafts rounded.
  function visit(itemId) {
    if (visiting.has(itemId)) { problem = "A recipe dependency cycle was observed."; return; }
    if (nodes.has(itemId) || problem) return;
    if (nodes.size === MAX_ITEMS) { problem = "This recipe family exceeds the batch trace limit."; return; }
    visiting.add(itemId);
    const candidates = directReady ? [] : producers.get(itemId) || [];
    const producer = candidates.length === 1 ? candidates[0] : null;
    nodes.set(itemId, { producer, ambiguous: candidates.length > 1 });
    if (producer?.id === root.id) problem = "A recipe dependency cycle was observed.";
    if (!problem && producer && owned.has(producer.skillLineId) && producer.reagentsKnown)
      for (const child of producer.reagents) visit(child.itemId);
    visiting.delete(itemId);
    order.push(itemId);
  }
  for (const r of root.reagents) visit(r.itemId);
  if (problem) return opaque(problem);

  const demand = new Map(), names = new Map();
  function add(reagents, attempts) {
    for (const r of reagents) {
      demand.set(r.itemId, (demand.get(r.itemId) || 0) + r.required * attempts);
      if (r.name && !names.has(r.itemId)) names.set(r.itemId, r.name);
    }
  }
  add(root.reagents, model.selection.crafts);
  const steps = [], raw = [];
  for (const itemId of order.reverse()) {
    const required = demand.get(itemId);
    if (!required) continue;
    const name = names.get(itemId) || bags.get(itemId)?.name || `Item ${itemId}`;
    const have = bags.get(itemId)?.count || 0, missing = Math.max(0, required - have);
    const { producer, ambiguous } = nodes.get(itemId);
    if (missing && (producer || ambiguous)) {
      if (ambiguous || !owned.has(producer.skillLineId) || !producer.reagentsKnown || !producer.reagents.length ||
          !producer.outputMin || producer.outputMin !== producer.outputMax)
        return opaque(`No single owned recipe with known inputs and fixed output is established for ${name}.`);
      const attempts = Math.ceil(missing / producer.outputMin);
      if (attempts > MAX_ATTEMPTS) return opaque("This recipe family exceeds the batch trace limit.");
      steps.push({ recipeId: producer.id, name: producer.name, itemId, itemName: name, attempts, required,
        fromBags: Math.min(have, required), output: attempts * producer.outputMin });
      add(producer.reagents, attempts);
    } else raw.push({ itemId, name, required, have, missing, quantityKind: "exact" });
  }
  const ids = raw.filter(r => r.missing > 0).map(r => r.itemId);
  const acquisition = ids.length ? acquisitionFacts(acquisitionPack, profile, ids).rows : [];
  // Legacy shopping tolerates browse-only leads. The decision uses only exact-build
  // qualified leads or the character's own dated observation on that build. The
  // merged vendor directory cannot attribute an individual listing to one build.
  const sourceByItem = new Map(acquisition.map(r => [r.itemId, r.sources.filter(s => s.qualification === "qualified-historical")]));
  const rows = raw.map(r => {
    const sources = sourceByItem.get(r.itemId) || [];
    const vendor = sources.find(s => s.kind === "historical-vendor-listing");
    return { ...r, acquisition: { sources }, historicalSellers: { suggestions: vendor ? [
      { id: vendor.entityId, name: vendor.referenceName, positions: vendor.positions, suggested: true },
    ] : [] } };
  });
  const gathering = profile.gathering?.records.filter(r => r.clientBuild === profile.clientBuild &&
    r.observedAt <= profile.source.updatedAt && Date.parse(r.observedAt) < (now + 1) * 1000);
  const scoped = { ...profile, gathering: { records: gathering } };
  const list = shoppingList(rows, { crafts: model.selection.crafts, profile: scoped, profiles, now });
  return {
    status: "planned", directReady, steps: steps.reverse(), batchPurchaseEstimate: list.batchPurchaseEstimate,
    observedAt: workshop.materials.observedAt,
    rows: list.rows.map(row => {
      const sources = sourceByItem.get(row.itemId) || [];
      if (row.vendor) row.vendor.observedAt = sources.find(s => s.kind === "historical-vendor-listing").lastSeen;
      if (row.gather) row.gather.observedAt = row.gather.yours
        ? gathering.find(r => r.method !== "chest" && r.itemIds.includes(row.itemId)).observedAt
        : sources.find(s => s.kind === "gathered-object-loot").observedOn;
      return { ...row, options: !row.missing ? ["already-have"] : [
        ...(row.gather ? ["gather"] : []), ...(row.vendor ? ["vendor"] : []), ...(row.price ? ["buy"] : []),
      ] };
    }),
  };
}
module.exports = { workshopDecision };

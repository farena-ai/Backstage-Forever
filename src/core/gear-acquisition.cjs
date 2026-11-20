"use strict";
// Reviewed exact-build relations, not the merged quest/vendor/boss packs. See docs/LIVE-P01-ACQUISITION.md.
const BUILD = "1.60.1.70888";
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const WINDOW = "2026-11-10 to 2026-11-12";
const id = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const date = s => {
  const ms = typeof s === "string" ? Date.parse(s) : NaN;
  return Number.isFinite(ms) && new Date(ms).toISOString() === s ? ms : NaN;
};
const isChest = (it, itemId) => it?.id === itemId && it.classId === 4 && [5, 20].includes(it.inventoryType);

function gearAcquisition(profile, gameData, wished, now = Date.now()) {
  const result = { slot: "chest", profileId: profile?.id ?? null, leads: [] };
  const unavailable = reason => ({ ...result, status: "unavailable", reason });
  const savedAt = date(profile?.source?.updatedAt);
  if (profile?.source?.kind !== "wow-addon" || !(savedAt <= now))
    return unavailable("A dated addon save for the active character is required.");
  const clientBuild = profile.clientBuild;
  let installed;
  try { installed = gameData.build(); } catch {}
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(clientBuild || "") || installed !== clientBuild)
    return unavailable("The saved character and installed game builds must match to verify the chest slot.");

  const ref = clientBuild === BUILD;
  const quest = profile.quests?.find(q => q.id === 166);
  const inLog = !!quest && Number.isInteger(profile.level) && profile.level >= 14;
  const vendorSide = profile.faction === "Alliance";
  const workshop = profile.readiness?.workshop;
  const recipes = workshop?.recipes, professions = workshop?.professions;
  const recipeDate = date(recipes?.observedAt), professionDate = date(professions?.observedAt);
  const crafts = professionDate <= recipeDate && recipeDate <= savedAt ? recipes.items.flatMap(r => {
    const profession = professions.items.find(p => p.skillLineId === r.skillLineId && Number.isInteger(p.rank) && p.rank > 0);
    if (!profession || !id(r.outputItemId) || !r.reagentsKnown || !r.reagents.length) return [];
    return [{ kind: "craft", itemId: r.outputItemId, sourceId: r.id, sourceName: r.name, qualification: "saved-recipe", observedAt: recipes.observedAt,
      skillLineId: r.skillLineId, professionName: profession.name, savedRank: profession.rank,
      reagents: r.reagents.map(({ itemId, required }) => ({ itemId, required })) }];
  }).sort((a, b) => a.itemId - b.itemId || a.sourceId - b.sourceId) : [];
  const candidates = [
    ...(ref ? [{ kind: "quest", itemId: 2041, sourceId: 166, sourceName: "The Defias Brotherhood",
      qualification: inLog ? "saved-in-log" : "reference-only", questMinLevel: 14, rewardChoice: true,
      savedReadyToTurnIn: inLog ? quest.complete === true : null, collectionWindow: WINDOW }] : []),
    ...(ref ? [{ kind: "vendor", itemId: 285, sourceId: 956, sourceName: "Dorin Songblade", observedFaction: "Alliance",
      qualification: vendorSide ? "historical" : "reference-only", collectionWindow: WINDOW }] : []),
    ...crafts,
    ...(ref ? [{ kind: "dungeon", itemId: 6682, sourceId: 4428, sourceName: "Death Speaker Jargba", instanceId: "rfk",
      instanceName: "Razorfen Kraul", qualification: "historical", collectionWindow: WINDOW }] : []),
  ];
  const ids = [...new Set(candidates.map(r => r.itemId))];
  let items;
  try { items = ids.length ? gameData.items(ids) : []; } catch { return unavailable("Chest item data is unavailable."); }
  const byId = new Map(ids.map((n, i) => [n, items[i]]));
  const starred = new Set(wished);
  const leads = candidates.filter(row => isChest(byId.get(row.itemId), row.itemId)).map(row => {
    const it = byId.get(row.itemId);
    const requiredLevel = Number.isInteger(it.requiredLevel) && it.requiredLevel >= 0 ? it.requiredLevel : null;
    const equipLevel = requiredLevel === null || !Number.isInteger(profile.level) ? "unknown" : profile.level >= requiredLevel ? "met" : "not-met";
    const equipClass = it.classes === null ? "no-class-mask" : !Array.isArray(it.classes) || !it.classes.length || !profile.className ? "unknown" :
      it.classes.includes(profile.className) ? "met" : "not-met";
    return { ...row, clientBuild, itemName: it.name, armorKind: it.kind ?? null, requiredLevel, equipLevel, equipClass,
      allowedClasses: Array.isArray(it.classes) ? [...it.classes] : null, availableNow: null, wished: starred.has(row.itemId) };
  });
  const gaps = {};
  for (const kind of ["quest", "vendor", "dungeon"]) if (!leads.some(row => row.kind === kind)) {
    gaps[kind] = ref ? "The reference item could not be verified in the chest slot from installed item data." : "No reviewed source for this build.";
  }
  if (!leads.some(row => row.kind === "craft")) gaps.craft = "No compatible saved recipe with known chest output, profession and reagents.";
  return { ...result, status: "available", clientBuild, savedAt: profile.source.updatedAt, attribution: ref ? ATTRIBUTION : null, leads, gaps };
}
module.exports = { gearAcquisition };

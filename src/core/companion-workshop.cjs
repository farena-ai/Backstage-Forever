"use strict";
const { buildProfessionCoach } = require("./profession-coach.cjs");

// Deliberately narrow: never resolve a partial recipe name or borrow one from conversation history.
function workshopQuestion(prompt) {
  const match = /^(?:what materials do i need for|can i craft) (?:saved )?recipe\s+#?(\d+)(?:\s+for\s+(\d+)\s+crafts?)?\s*\??$/i.exec(prompt.trim());
  return match ? { recipeId: Number(match[1]), crafts: Number(match[2] ?? 1) } : null;
}

function workshopAnswer(question, { state, profile, shareProfile, acquisitionPack }) {
  const { recipeId, crafts } = question;
  if (!Number.isSafeInteger(recipeId) || recipeId < 1 || recipeId > 2147483647 || !Number.isSafeInteger(crafts) || crafts < 1 || crafts > 20) {
    return "Use an exact recipe ID and 1–20 craft attempts, for example: What materials do I need for recipe #2330 for 2 crafts?";
  }
  if (!shareProfile) return "Turn on ‘Use my active character’ in Companion to check saved recipe materials locally.";
  const refresh = "Open the profession window and check your bags in game, then log out and import the updated save in Backstage Forever.";
  const savedAt = Date.parse(profile?.source?.updatedAt);
  if (profile?.id !== state.activeProfileId || profile?.source?.kind !== "wow-addon" || !profile.clientBuild || !Number.isFinite(savedAt) || savedAt > Date.now()) {
    return `No dated addon save with a known build is available for the active character. ${refresh}`;
  }
  const plan = buildProfessionCoach(state, profile.id, { recipeId, crafts }, { acquisitionPack });
  if (!plan.planning.available || !plan.selectedRecipe || !plan.shoppingList.rows.length) {
    return `Recipe #${recipeId}: requirements unavailable in this character’s save. ${refresh}`;
  }
  const exact = plan.planning.inventoryExact;
  const bagAt = plan.coverage.materials.observedAt;
  const rows = plan.shoppingList.rows.map(row => {
    const carried = row.have === null ? "carried unknown" : `${exact ? "" : "at least "}${row.have} saved carried`;
    const shortfall = row.projectedPurchase === null ? "shortfall unknown" : `${row.projectedPurchase} short`;
    const gather = plan.shoppingRows.find(r => r.itemId === row.itemId)?.acquisition?.sources.find(s =>
      s.kind === "gathered-object-loot" && s.clientBuild === profile.clientBuild && s.qualification === "qualified-historical");
    const lead = gather ? ` Historical gathering reference: ${gather.referenceName} (build ${gather.clientBuild}, observed ${gather.observedOn}); current availability and access unknown.` : "";
    return `- ${row.name} (item #${row.itemId}): ${row.required} required, ${carried}, ${shortfall}.${lead}`;
  });
  const next = !exact ? `Carried counts are incomplete, older or unknown. ${refresh}` :
    plan.shoppingList.rows.some(row => row.projectedPurchase > 0) ? "Check the missing materials against your current bags in Professions before crafting." :
      "Saved carried materials cover this batch; verify your current bags before crafting. Output and skill gains are not guaranteed.";
  return [
    `**${plan.selectedRecipe.name} (recipe #${recipeId})** — ${crafts} craft attempt${crafts === 1 ? "" : "s"}`,
    `Last saved for ${profile.name} · build ${profile.clientBuild} · ${profile.source.updatedAt} (not live).${bagAt ? ` Carried observation: ${bagAt}.` : ""}`,
    rows.join("\n"),
    `Bank, mail and other characters do not count as carried supply. ${next}`,
  ].join("\n\n");
}

module.exports = { workshopQuestion, workshopAnswer };

"use strict";
const { buildPreparation } = require("./preparation.cjs");
const { validateState, str } = require("./validation.cjs");
const { acquisitionFacts } = require("./acquisition-data.cjs");
function validateProfessionOptions(value = {}) {
  const fail = () => {
    throw Error("Invalid profession coach request.");
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) => !["skillLineId", "recipeId", "crafts"].includes(k),
    )
  )
    fail();
  const out = { crafts: value.crafts === undefined ? 1 : value.crafts };
  if (!Number.isSafeInteger(out.crafts) || out.crafts < 1 || out.crafts > 20)
    fail();
  for (const key of ["skillLineId", "recipeId"])
    if (value[key] !== undefined) {
      if (
        !Number.isSafeInteger(value[key]) ||
        value[key] < 1 ||
        value[key] > 2147483647
      )
        fail();
      out[key] = value[key];
    }
  return out;
}
/** One workshop projection; legacy checklist actions continue to use its resolved recipe/attempts. */
function buildProfessionCoach(
  state,
  profileId,
  options = {},
  { acquisitionPack = null, vendorPack = null } = {},
) {
  if (profileId !== null) str(profileId, 100, false);
  const settings = validateProfessionOptions(options),
    valid = validateState(state);
  const profile = valid.profiles.find((p) => p.id === profileId),
    w = profile?.readiness?.workshop;
  const base = buildPreparation(
    valid,
    profileId,
    { crafts: settings.crafts },
    { vendorPack },
  );
  const dated =
    profile?.source?.kind === "wow-addon" &&
    Boolean(profile.clientBuild) &&
    Object.values(w || {}).every(
      (c) => c.observedAt <= profile.source.updatedAt,
    );
  const professions = base.professions
    .slice()
    .sort((a, b) => a.skillLineId - b.skillLineId);
  const requirements = (r) =>
    r.reagentsKnown &&
    r.reagents.length > 0 &&
    r.reagents.length <= 10 &&
    r.reagents.every(
      (x) =>
        Number.isSafeInteger(x.required * settings.crafts) &&
        x.required <= 100000,
    );
  const eligible = (r) =>
    dated &&
    professions.some((p) => p.skillLineId === r.skillLineId) &&
    w.professions.observedAt <= w.recipes.observedAt &&
    r.canSkillUp === true &&
    requirements(r);
  const quantities = new Map(base.materials.map((m) => [m.itemId, m.count]));
  const exact =
    dated &&
    w?.materials?.complete &&
    w.materials.observedAt >= w.recipes?.observedAt;
  const score = (r) => {
    const missing = r.reagents.map((x) =>
      Math.max(
        0,
        x.required * settings.crafts - (quantities.get(x.itemId) || 0),
      ),
    );
    return [
      exact ? (missing.every((n) => n === 0) ? 0 : 1) : 2,
      exact ? missing.filter((n) => n > 0).length : 0,
      exact ? missing.reduce((a, b) => a + b, 0) : 0,
      r.id,
    ];
  };
  const compare = (a, b) => {
    const aa = score(a),
      bb = score(b);
    for (let i = 0; i < aa.length; i++)
      if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
  };
  const candidates = base.recipes.filter(eligible).sort(compare);
  const explicit =
    settings.recipeId !== undefined
      ? base.recipes.find((r) => r.id === settings.recipeId)
      : null;
  const skillLineId =
    settings.skillLineId ??
    explicit?.skillLineId ??
    candidates[0]?.skillLineId ??
    professions[0]?.skillLineId ??
    null;
  const profession =
    professions.find((p) => p.skillLineId === skillLineId) || null;
  const recipe =
    settings.recipeId !== undefined
      ? explicit?.skillLineId === skillLineId && profession
        ? explicit
        : null
      : candidates.find((r) => r.skillLineId === skillLineId) || null;
  const model = recipe
    ? buildPreparation(
        valid,
        profileId,
        { recipeId: recipe.id, crafts: settings.crafts },
        { vendorPack },
      )
    : base;
  model.selection = {
    skillLineId,
    recipeId: settings.recipeId ?? recipe?.id ?? null,
    crafts: settings.crafts,
    automatic: settings.recipeId === undefined,
  };
  model.profession = profession;
  model.selectedRecipe = recipe;
  model.ownedProfessionChoices = professions;
  model.recipeChoices = base.recipes
    .filter((r) => r.skillLineId === skillLineId && profession)
    .sort((a, b) => a.id - b.id)
    .map((r) => ({ ...r, levelingEligible: eligible(r) }));
  if (!recipe || !requirements(recipe)) {
    model.shoppingRows = [];
    model.status = "unavailable";
    model.planning = {
      available: false,
      checklistAvailable: false,
      inventoryExact: false,
      requirementsKnown: false,
      reason:
        recipe && !requirements(recipe)
          ? "This recipe's required materials are unknown or ambiguous."
          : settings.recipeId !== undefined
            ? "The selected recipe is unavailable for this currently observed owned profession."
            : !dated
              ? "Import a saved addon character with compatible source dates and build."
              : "No current learned skill-up recipe is observed. Open your own profession normally, or choose a saved recipe for a manual plan.",
    };
  }
  for (const row of model.shoppingRows) {
    // Zero is established only by a complete fresh count. A missing partial row is unknown.
    if (!model.planning.inventoryExact && !quantities.has(row.itemId)) {
      row.have = null;
      row.quantityKind = "unknown";
    }
  }
  const acquisition = acquisitionFacts(
    acquisitionPack,
    profile,
    model.shoppingRows.map((r) => r.itemId),
  );
  for (const row of model.shoppingRows)
    row.acquisition = acquisition.rows.find((r) => r.itemId === row.itemId);
  model.acquisitionReference = {
    status: acquisition.status,
    reference: acquisition.reference,
    limitations: acquisition.limitations,
  };
  // Gathering references describe a historical method, never a rank requirement or current node.
  const spell = { 182: 2368, 186: 2576 }[skillLineId];
  const gatheringIds =
    spell && acquisition.status === "available" && Array.isArray(acquisitionPack?.rows)
      ? [
          ...new Set(
            acquisitionPack.rows
              .filter((r) => r.gatherSpellId === spell)
              .map((r) => r.itemId),
          ),
        ].slice(0, 40)
      : [];
  model.gatheringReference = gatheringIds.length
    ? acquisitionFacts(acquisitionPack, profile, gatheringIds)
    : null;
  const cap =
    dated && profession?.maxRank > 0 && profession.rank === profession.maxRank;
  const leveling = recipe && eligible(recipe) && model.planning.available;
  const missing = model.shoppingRows.filter((r) => r.missing > 0);
  const kind =
    leveling && model.planning.inventoryExact && !missing.length
      ? "craft-ready"
      : cap
        ? "profession-cap"
        : leveling && model.planning.inventoryExact
          ? "materials-needed"
          : recipe
            ? "craft-plan"
            : "observe-profession";
  model.recommendation = {
    kind,
    title:
      kind === "craft-ready"
        ? `Try ${recipe.name}`
        : kind === "materials-needed"
          ? `Gather supplies for ${recipe.name}`
          : kind === "profession-cap"
            ? `Check ${profession.name} training`
            : recipe
              ? `Plan ${recipe.name}`
              : "Open your own profession",
    detail:
      kind === "profession-cap"
        ? "Check whether further training is available. A higher rank, trainer, cost or unlock is not established."
        : kind === "materials-needed"
          ? `${missing.length} material shortfall${missing.length === 1 ? "" : "s"} for ${settings.crafts} attempt${settings.crafts === 1 ? "" : "s"}, using observed supplies.`
          : kind === "craft-ready"
            ? `Saved supply covers ${settings.crafts} attempt${settings.crafts === 1 ? "" : "s"}; output and skill-ups are not guaranteed.`
            : recipe
              ? "Manual crafting plan; a current skill-up recommendation or sufficient supply is not established."
              : "Observe learned recipes and materials in game. Partial catalogs may omit other useful choices.",
    levelingEligible: Boolean(leveling),
    atObservedCap: Boolean(cap),
    qualification: cap
      ? "Check training before expecting rank progress."
      : null,
  };
  return structuredClone(model);
}
module.exports = { validateProfessionOptions, buildProfessionCoach };

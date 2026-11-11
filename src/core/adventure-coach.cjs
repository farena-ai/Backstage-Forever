"use strict";
const { buildGuidance } = require("./guidance.cjs");
const { buildDirector } = require("./director.cjs");
const { validateWorkshop } = require("./preparation-data.cjs");
const { buildProfessionCoach } = require("./profession-coach.cjs");
const { defaultState } = require("./validation.cjs");
const { createHash } = require("node:crypto");
function validateCoachOptions(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((k) => k !== "mode") ||
    (value.mode !== undefined &&
      !["adventure", "questing", "professions"].includes(value.mode))
  )
    throw Error("Invalid adventure coach options.");
  return { mode: value.mode || "adventure" };
}
const signature = (id, facts) =>
  id + ":" + createHash("sha256").update(JSON.stringify(facts)).digest("hex");
// Drain the existing three-card projection before applying the coach's own cap.
// Reusing each planner batch preserves its ordering and reference qualifications.
function directorPool(profile, guidance) {
  let remaining = guidance.candidates.slice(0, 25);
  const steps = [];
  for (let batch = 0; batch < 9 && remaining.length; batch++) {
    const choices = buildDirector(profile, {
      ...guidance,
      candidates: remaining,
    }).choices;
    if (!choices.length) break;
    steps.push(...choices);
    const selected = new Set(choices.map((step) => step.questId));
    remaining = remaining.filter((step) => !selected.has(step.questId));
  }
  return steps;
}
/** Public normalized facts only. No journal goals, source IDs, commands or providers. */
function buildAdventureCoach(
  profile,
  options = {},
  { knowledge, guidanceOptions = {} } = {},
) {
  const { mode } = validateCoachOptions(options),
    p = profile || {},
    rows = [];
  const result = {
    version: 1,
    status: "unavailable",
    mode,
    recommendation: null,
    alternatives: [],
    limitations: [
      "Desktop guidance uses last saved observations, not live game inventory.",
      "Open your own profession normally to observe learned recipes and carried materials.",
      "You choose every action. Craft skill-ups and output are not guaranteed.",
      "Advice covers observed recipes only; a partial catalog may omit other choices.",
    ],
  };
  if (
    p.source?.kind !== "wow-addon" ||
    !Number.isFinite(Date.parse(p.source.updatedAt)) ||
    !p.clientBuild
  )
    return result;
  const add = (
    rank,
    kind,
    identity,
    title,
    reason,
    detail,
    evidence,
    facts,
    extra = {},
  ) => {
    const id = kind + ":" + identity;
    rows.push({
      rank,
      order: rows.length,
      value: {
        id,
        kind,
        title,
        reason,
        detail,
        evidence,
        ...extra,
        signature: signature(id, facts),
      },
    });
  };
  const bags = p.readiness?.bags;
  if (
    Number.isSafeInteger(bags?.total) &&
    bags.total > 0 &&
    bags.total <= 1000 &&
    Number.isSafeInteger(bags.free) &&
    bags.free >= 0 &&
    bags.free <= 2 &&
    bags.free <= bags.total
  )
    add(
      mode === "questing" ? 1 : 0,
      "bags",
      "carried",
      "Make room in your bags",
      `${bags.free} of ${bags.total} carried slots were free.`,
      "Review your carried items before collecting more. Nothing is sold or deleted automatically.",
      "Last saved carried bags",
      [bags.free, bags.total],
    );
  let guidance;
  try {
    guidance = buildGuidance(p, { ...guidanceOptions, knowledge });
  } catch {
    guidance = null;
  }
  if (guidance) {
    const steps =
      mode === "questing"
        ? guidance.candidates.slice(0, 25)
        : directorPool(p, guidance);
    for (const step of steps) {
      const quest = (p.quests || []).find((q) => q.id === step.questId),
        actionable =
          Boolean(step.destination) ||
          (step.objectives || []).some(
            (o) =>
              o.done === false &&
              typeof o.text === "string" &&
              o.text.trim().length > 0,
          ),
        local =
          actionable &&
          (step.priority <= 1 ||
            (quest?.zone && quest.zone === p.location?.zone) ||
            (step.destination?.mapId !== undefined &&
              step.destination.mapId === p.location?.mapId));
      let rank =
        mode === "questing"
          ? 0
          : mode === "professions"
            ? 3
            : step.kind === "turn-in"
              ? 1
              : local
                ? 2
                : 4;
      // A check-log fallback follows established quest work within its tier.
      if (
        mode !== "questing" &&
        step.kind !== "turn-in" &&
        !actionable &&
        !step.referenceDestination
      )
        rank += 0.5;
      const detail =
        (step.objectives || [])
          .slice(0, 10)
          .map((o) => o.text)
          .filter((value) => value.trim().length > 0)
          .join(" · ")
          .slice(0, 800) || "Check your quest log for the next step.";
      const publicStep = {
        questId: step.questId,
        kind: step.kind,
        title: step.title,
        reason: step.reason,
        sourceKind: step.sourceKind || "game-snapshot",
        ...(step.destination
          ? { destination: structuredClone(step.destination) }
          : {}),
        ...(step.referenceDestination
          ? { referenceDestination: structuredClone(step.referenceDestination) }
          : {}),
      };
      add(
        rank,
        "quest",
        step.questId,
        step.title,
        step.reason,
        detail,
        step.sourceKind === "reference-clue"
          ? "Public reference clue · verify quest details"
          : step.sourceKind === "reference"
            ? "Approximate public reference"
            : "Last saved quest log",
        [quest, publicStep],
        { questStep: publicStep },
      );
    }
  }
  let w;
  try {
    w = validateWorkshop(p.readiness?.workshop);
  } catch {
    w = null;
  }
  if (w && Object.values(w).every((c) => c.observedAt <= p.source.updatedAt)) {
    const professions = w.professions?.items || [],
      recipes = w.recipes?.items || [],
      materials = new Map(
        (w.materials?.items || []).map((m) => [m.itemId, m.count]),
      );
    for (const r of recipes) {
      const owner = professions.find((o) => o.skillLineId === r.skillLineId);
      if (
        !owner ||
        w.professions.observedAt > w.recipes.observedAt ||
        r.canSkillUp !== true ||
        !r.reagentsKnown ||
        !r.reagents.length ||
        r.reagents.length > 10 ||
        !w.materials?.complete ||
        w.materials.observedAt < w.recipes.observedAt
      )
        continue;
      if (
        !r.reagents.every(
          (x) =>
            materials.has(x.itemId) && materials.get(x.itemId) >= x.required,
        )
      )
        continue;
      const facts = r.reagents
        .map((x) => [x.itemId, x.required, materials.get(x.itemId)])
        .sort((a, b) => a[0] - b[0]);
      add(
        mode === "questing" ? 2 : mode === "professions" ? 1 : 3,
        "craft-ready",
        r.id,
        `Try ${r.name}`,
        "Saved carried materials cover one learned skill-up-capable recipe attempt.",
        "Materials ready for one craft attempt; skill-up and output are not guaranteed. Verify your current bags before crafting.",
        "Learned recipe + complete dated carried counts",
        [r.id, r.skillLineId, owner.rank, owner.maxRank, facts],
        { recipeId: r.id, professionId: owner.professionId },
      );
    }
    for (const o of professions)
      if (o.maxRank > 0 && o.rank === o.maxRank)
        add(
          mode === "questing" ? 3 : mode === "professions" ? 2 : 5,
          "profession-cap",
          o.skillLineId,
          `Check ${o.name} training`,
          `${o.name} was at its observed rank cap (${o.rank}/${o.maxRank}).`,
          "Check whether further training is available. A higher rank or accessible trainer is not established by this observation.",
          "Last saved owned profession",
          [o.skillLineId, o.rank, o.maxRank],
          { professionId: o.professionId },
        );
  }
  // The workshop owns automatic supply selection; no alternate source database or command path.
  try {
    const profession = buildProfessionCoach({...defaultState(),activeProfileId:p.id,profiles:[p]},p.id);
    const next = profession.recommendation;
    if(next.kind === "materials-needed") add(mode === "questing" ? 4 : mode === "professions" ? 2.5 : 4.25,
      next.kind,profession.selection.recipeId,next.title,next.detail,next.detail,
      "Learned recipe + complete dated carried counts",
      [profession.selection,profession.profession,profession.shoppingRows.map(r=>[r.itemId,r.required,r.have,r.missing])],
      {recipeId:profession.selection.recipeId,professionId:profession.profession.professionId});
  } catch { /* Invalid observations remain unavailable, as with existing workshop advice. */ }
  rows.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.value.kind === "quest" && b.value.kind === "quest"
        ? a.order - b.order
        : a.value.id.localeCompare(b.value.id)),
  );
  // Questing keeps bag pressure visible even when three quest choices exist.
  let visible = rows.slice(0, 3);
  const warning = rows.find((r) => r.value.kind === "bags");
  if (mode === "questing" && warning && !visible.includes(warning))
    visible[visible.length - 1] = warning;
  result.status = visible.length
    ? "ready"
    : guidance?.status === "unavailable" && !w
      ? "unavailable"
      : "empty";
  result.recommendation = visible[0]?.value || null;
  result.alternatives = visible.slice(1).map((r) => r.value);
  return structuredClone(result);
}
module.exports = { buildAdventureCoach, validateCoachOptions };

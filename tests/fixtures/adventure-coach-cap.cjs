"use strict";
const modes = ["adventure", "professions", "questing"];
function profile({ rank = 75, mixed = false } = {}) {
  const at = "2026-11-11T12:00:00.000Z",
    collection = (items) => ({ observedAt: at, complete: true, items });
  return {
    id: "cap-fixture", name: "Synthetic", realm: "Synthetic", className: "Mage", level: 12,
    notes: "", goals: [], quests: [], clientBuild: "1.60.1.70862",
    source: { kind: "wow-addon", id: "synthetic", updatedAt: at },
    readiness: {
      bags: { free: 5, total: 16 },
      workshop: {
        professions: collection([
          { skillLineId: 171, professionId: 4, name: "Alchemy", rank, maxRank: 75 },
          ...(mixed ? [{ skillLineId: 164, professionId: 2, name: "Blacksmithing", rank: 50, maxRank: 75 }] : []),
        ]),
        recipes: {
          ...collection(Array.from({ length: 3 }, (_, i) => ({
            id: 100 + i, name: `Synthetic recipe ${i + 1}`,
            skillLineId: mixed && i === 1 ? 164 : 171,
            canSkillUp: true, reagentsKnown: true,
            reagents: [{ itemId: 765, required: 1 }],
          }))),
          complete: false,
        },
        materials: { ...collection([{ itemId: 765, count: 10 }]), scope: "bags-0-4" },
      },
    },
  };
}
module.exports = { profile, modes };

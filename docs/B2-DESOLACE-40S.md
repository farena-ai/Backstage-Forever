# B2 qualification: Horde Desolace, quest levels 40–49

**Disposition: no bundled extension.** The locked `1.60.1.70888` data corroborate the existing level-40 **Carved Centaur Totems** pickup, objective and hand-in; they do not establish an actionable successor. This is a source review of one Horde slice, not live acceptance, a review of Alliance, or proof of continuous coverage. Baseline: `84ae2483891c8ed1cab7a1a2ec3ab826882b701e`.

## Locked evidence

Verified byte count, SHA-256 and embedded `meta.clientBuild` for `quests.enUS.json`, `npcs.json`, `turn_ins.json` and `objectives.json` separately on each of the four builds (16 files). See the [immutable source lock](../data/forever/source-lock.json) and [attribution and limitations](../data/forever/NOTICE). Data from Efficient Games, licensed under [CC BY 4.0](../data/forever/LICENSE); Blizzard game content is excluded from that license.

Selected quest records with `zoneAreaId = 405` and **quest level** 40–49, not minimum required level. Joined exact quest IDs to NPC/object `offers` and `takes` with positions on **`uiMap 1443`**, turn-in observations, and objective positions on the same map. The counts include all sides at discovery (before Horde eligibility screening); they describe this exact filter, not all quests playable in Desolace.

| Client build | Area/band quest records | Map-1443 NPC/object offers / takes | Observed turn-ins | Map-1443 objective positions |
| --- | ---: | --- | --- | --- |
| `1.60.1.70888` | 21 [1] | `93225`, `94872`, `94873`, `96222` / `93225`, `94873` [2] | `93225`, `94873` [3] | `93225` [4] |
| `1.60.1.70862` | 20 [5] | None / none [6] | None [7] | None [8] |
| `1.60.1.70840` | 13 [9] | None / none [10] | None [11] | None [12] |
| `1.60.1.70790` | 0 [13] | None / none [14] | None [15] | None [16] |

## Existing quest and extension candidates

All points below are normalized `(x, y)` on map `1443`. For `70888`, the four exact quest IDs below have no recorded incoming `nextQuestId` edge, and `93225` has no outgoing `nextQuestId`. That does not prove no prerequisites or establish a link from `93225` to either reputation quest.[1]

| ID and quest level / minimum [1] | Exact-build evidence on `70888` | Disposition |
| --- | --- | --- |
| `93225` Carved Centaur Totems, 40 / 30 | Horde NPC `5412` Gurda Wildmane offers and takes it at `(0.5625, 0.5957)`.[2] An item-gain observation supports the route's approximate objective point `(0.6801, 0.8253)`; a Horde Troll turn-in was observed at character level 37.[3][4] The quest race mask includes Orc, Undead, Tauren and Troll; only the Troll turn-in is observed.[1][3] | Corroborates the three existing steps on this build only. Not a guaranteed offer for every Horde character or a new route approval. |
| `94873` Buying Friendship: Gelkis, 45 / 30 | Gurda offers it at `(0.5625, 0.5957)`; `253140` Molkar takes it at `(0.3568, 0.9211)`.[2] A Horde Troll turn-in at character level 38 corroborates play, but there is no objective-position row.[3][4] Quest text explicitly requires Neutral standing with Gelkis.[1] | Strongest extension candidate. Do not turn the observed offer into a universal waypoint: no verified continuity from `93225`, and the bundled route does not evaluate the reputation gate. Keep the reference quest. |
| `94872` Buying Friendship: Magram, 45 / 30 | Gurda offers it at `(0.5625, 0.5957)`; hand-in actor and point remain unknown in these files.[2][3] Quest text explicitly requires Neutral with Magram, and no objective position is recorded.[1][4] | No route step. Do not infer the Gelkis hand-in or eligibility from the similar title. |
| `96222` Khan Hratha, 42 / 35 | `253066` Umarak offers it at `(0.4346, 0.7894)`; actor side is unspecified. The text names the Maraudine Key Fragment, but no obtaining point, hand-in point or turn-in observation is recorded.[1][2][3] No objective point was observed.[4] | No Horde promotion. Existing behavior outside this Horde review is unchanged. |

To reconsider the Gelkis extension, obtain build-matched evidence of actual offer availability and prerequisites after the selected entry quest for the intended characters. The route would also need to verify the Gelkis Neutral gate from the character’s own state before giving directions and stay browse-only if build or standing is unknown. No coordinate, travel handoff or route approval was added.

## Verification

- `npm run build:guided-route` and `npm run check:guided-route` passed; regenerated Lua is byte-identical to the baseline Git blob.
- A desktop-builder/Fengari probe matched step IDs, quest IDs, levels, maps and serialized coordinates across all eight race routes (2,668 steps). `93225` remains pickup → objective → hand-in for the four Horde races and absent for Alliance. Neither reputation candidate was emitted. Both Dwarf and Gnome retained the level 1–9 gap and existing `travel:1436` first step.
- **23/23** passed: `node --test tests/guided-route.test.cjs tests/route-review.test.cjs tests/route-givers.test.cjs tests/addon-route.test.cjs tests/desktop-route-recovery.test.cjs`. No runtime, data, or generated changes; live-client acceptance was not run.

## Sources

[1] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quests.enUS.json — Efficient Games — 1.60.1.70888, quests.enUS.json
[2] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/npcs.json — Efficient Games — 1.60.1.70888, npcs.json
[3] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/turn_ins.json — Efficient Games — 1.60.1.70888, turn_ins.json
[4] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/objectives.json — Efficient Games — 1.60.1.70888, objectives.json
[5] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/quests.enUS.json — Efficient Games — 1.60.1.70862, quests.enUS.json
[6] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/npcs.json — Efficient Games — 1.60.1.70862, npcs.json
[7] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/turn_ins.json — Efficient Games — 1.60.1.70862, turn_ins.json
[8] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/objectives.json — Efficient Games — 1.60.1.70862, objectives.json
[9] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/quests.enUS.json — Efficient Games — 1.60.1.70840, quests.enUS.json
[10] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/npcs.json — Efficient Games — 1.60.1.70840, npcs.json
[11] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/turn_ins.json — Efficient Games — 1.60.1.70840, turn_ins.json
[12] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/objectives.json — Efficient Games — 1.60.1.70840, objectives.json
[13] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/quests.enUS.json — Efficient Games — 1.60.1.70790, quests.enUS.json
[14] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/npcs.json — Efficient Games — 1.60.1.70790, npcs.json
[15] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/turn_ins.json — Efficient Games — 1.60.1.70790, turn_ins.json
[16] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/objectives.json — Efficient Games — 1.60.1.70790, objectives.json

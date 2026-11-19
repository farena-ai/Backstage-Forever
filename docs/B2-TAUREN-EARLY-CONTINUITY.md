# B2 qualification: Tauren early continuity (Mulgore)

**Disposition: retain the existing Horde Tauren opening, but do not bridge levels 4–9.** The locked evidence corroborates the existing *The Hunt Begins* loop on `1.60.1.70862` only. It does not establish a navigable continuation through Mulgore or a prerequisite-safe handoff to the Barrens. This is a bounded source and fixture qualification, not live acceptance. Post-1.10 work is based on `64faf9a9f23f81042c40446632fc119de31ae065`; the 1.10.0 release is unchanged.

## Exact-build evidence

Verified byte count, SHA-256 and embedded `meta.clientBuild` for all 16 locked files: `quests.enUS.json`, `npcs.json`, `turn_ins.json` and `objectives.json` for each build. See the [immutable source lock](../data/forever/source-lock.json) and [attribution and limitations](../data/forever/NOTICE). Data from Efficient Games, licensed under [CC BY 4.0](../data/forever/LICENSE); Blizzard game content is excluded from that license.

Selected quest records with `zoneAreaId` 215 or 220 (Mulgore / Red Cloud Mesa) and **quest level** 4–9, regardless of side at discovery. Joined exact quest IDs to NPC/object `offers` and `takes` (including actors outside Mulgore), turn-ins and objective observations. Checked waypoint positions separately on **`uiMap 1412`**. Quest area, waypoint map, quest level and minimum entry level are not interchangeable.

| Client build | Area/band quest records | Exact offers / takes / turn-ins / objective observations |
| --- | ---: | --- |
| `1.60.1.70888` | 28 [1] | 0 / 0 / 0 / 0 [2][3][4] |
| `1.60.1.70862` | 28 [5] | 0 / 0 / 0 / 0 [6][7][8] |
| `1.60.1.70840` | 20 [9] | 0 / 0 / 0 / 0 [10][11][12] |
| `1.60.1.70790` | 21 [13] | 0 / 0 / 0 / 0 [14][15][16] |

## Route boundaries and exclusions

- **Corroborated opening loop, `747` The Hunt Begins (quest level 2, minimum 1):** on `70862`, Horde NPC `2980` Grull Hawkwind offers and takes it at normalized `(0.4448, 0.7759)` on map `1412`.[5][6]
  The existing objective point `(0.5085, 0.8525)` is one observed item-gain position, not a guaranteed spawn or the only place to obtain both items.[8]
  A level-2 Horde Tauren turn-in corroborates play.[7]
- **Hunt continuation, `750 → 780`:** the `70862` offer for `750` (quest level 3, minimum 1) is from Grull at the same point.[5][6]
  Its `nextQuestId` names `780` *The Battleboars* (4 / 1), but the source has no `747 → 750` edge.[5]
  There is no observed `750` hand-in and no offer, objective position or hand-in for `780`.[6][7][8]
  Do not fill the gap from the similar titles or reuse the `747` objective point.
- **Strongest continuity candidate, `752 → 753 → 755 → 757 → 763`:** `70862` establishes those directed links.[5]
  Horde NPC `2981` Chief Hawkwind offers `752` at `(0.4395, 0.7674)`; `2991` Greatmother Hawkwind takes it and offers `753` at `(0.4874, 0.8088)`, all on map `1412`.[6]
  There is a Horde Tauren turn-in of `752` and an item-gain point for `753` at `(0.4884, 0.8111)`.[7][8]
  The text names Chief Hawkwind as the `753` recipient, but the observed `752` pickup does not establish the exact `753` hand-in.[5][6][7]
  The named Seer Graytongue (`755`), Bristleback Belts (`757`, 4 / 1) and Baine Bloodhoof (`763`, 5 / 1) identify recipients or objectives, not observed waypoint locations.[5]
  No exact offer, take, turn-in or objective position was observed for those three IDs on `70862`.[6][7][8]
  `70840` lacks `753`, `755` and `763` records; do not fill those links from another build.[9]
- **Other candidates remain reference-only.** `748` *Poison Water* (5 / 4) has the Tauren race bit only, but no actionable offer, objective or take; `748`, `754`, `756` and `758` are thematically related, not linked by these `nextQuestId` rows. `99079 → 99081 → 99101` is recorded on `70862`, but the presence of the Tauren bit does not establish an actual offer and its next recorded quest `99080` is level 11 despite minimum 4. `95350` has a Horde offer on map `1412` on `70790`, but the quest is level 13, minimum 7, and area `1637`. It is not a bridge.[5][13][14]
- **The existing level-10 Barrens step is not a verified handoff.** On `70862`, area `17` quest `6384` *Ride to Orgrimmar* (10 / 10) follows `6365` *Meats to Orgrimmar* in the quest data. NPC `3615` Devrak offers `6384` on map `1413`, and NPC `6929` Innkeeper Gryshka takes it on `1454`. The matching turn-in is Horde Troll, not Tauren, and there is no verified Mulgore-to-`6365` link. This review does not change the pre-existing steps or certify that offer for a Tauren just arriving in the Barrens.[5][6][7]

## What would unlock a narrow extension

On one known supported build, follow a Horde Tauren from `753` through `755 → 757 → 763`. Capture the exact hand-in of `753` and the resulting offers and hand-ins, including giver/recipient GUID-derived actor IDs, map and normalized positions. Capture an actual belt gain for `757` with its objective index and map/point. Confirm which completions, level, race/class or other state gate each offer; an unrestricted race mask and a sequence link do not prove individual eligibility. Stop at the observed `763` hand-in in Bloodhoof Village unless a subsequent same-build quest and its prerequisites are independently proved. A missing observation is not proof that a quest is unavailable.

## Verification

- Guided-route regeneration and reproduction check passed. The generated `BackstageForeverGuideData.lua` is byte-identical to the pinned Git blob.
- An ordered desktop-builder/Fengari comparison matched all eight race tables (2,668 steps), including quest IDs, step order, levels, map IDs and serialized coordinates. Tauren still report a 4–9 gap; the last emitted opening step is `turnin:747` on `1412`; the next steps are `travel:1413` and `pickup:6384`, both level 10 at desktop `(0.5153, 0.3037)` / Lua `(0.515, 0.304)`. No filtered Mulgore gap candidate was emitted for Tauren.
- **23/23** passed: `node --test tests/guided-route.test.cjs tests/route-review.test.cjs tests/route-givers.test.cjs tests/addon-route.test.cjs tests/desktop-route-recovery.test.cjs`. No new reviews, skips, route points, generated content or runtime changes; no live-client validation.

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

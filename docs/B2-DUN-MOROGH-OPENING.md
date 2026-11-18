# B2 qualification: Dwarf/Gnome opening (Dun Morogh)

**Disposition: leave levels 1–9 unsupported in the bundled route.** Review scope is the shared Alliance starter map (`uiMap 1426`) for Dwarf and Gnome, at integration baseline `8aa437831b04bfc3a5c37203ad2f7dafbe36fb88`. No steps, approvals, skips, or waypoints were added. This is a reference-data exclusion, not a claim that the quests cannot be played, and not a review of Tauren or later levels.

## Locked evidence

Verified byte count, SHA-256, and embedded `meta.clientBuild` for `quests.enUS.json`, `npcs.json`, `turn_ins.json`, and `objectives.json` separately on all four builds (16 files). The [source lock](../data/forever/source-lock.json) contains each immutable URL and digest. Data from Efficient Games ([attribution and limitations](../data/forever/NOTICE)), licensed under [CC BY 4.0](../data/forever/LICENSE); Blizzard game content is excluded from that license.

Per build, selected quest records with `zoneAreaId` 1 or 132 (Dun Morogh / Coldridge Valley), quest level 1–9 inclusive, then matched exact IDs to NPC/object offers anywhere and to turn-in and objective records. Separately checked NPC/object positions on `uiMap 1426` without treating a quest's area ID as a coordinate or inferring an offer from an actor's presence.

| Client build | Early quest records | Matched offers / turn-ins / objective evidence | Observed map-1426 offer IDs | Starter route qualified? |
| --- | ---: | --- | --- | --- |
| `1.60.1.70888` [1] | 36 | 0 / 0 / 0 | None | No, both races |
| `1.60.1.70862` [2] | 36 | 0 / 0 / 0 | `96392`, `96393` (outside band) [8] | No, both races |
| `1.60.1.70840` [3] | 21 | 0 / 0 / 0 | None | No, both races |
| `1.60.1.70790` [4] | 30 | 0 / 0 / 0 | None | No, both races |

## Representative exclusions

| Quest IDs and observed chain order | Reason kept out of the starter route |
| --- | --- |
| `179` Dwarven Outfitters (quest level 1; minimum 1 on all four builds [1][2][3][4]) | No recorded incoming `nextQuestId` edge; that does not establish no prerequisites. No exact giver/turn-in or objective waypoint; coordinates unknown. |
| `233 → 234` Coldridge Valley Mail Delivery (quest levels 3 → 4; both minimum 1 [1][2][4]) | Same title, distinct IDs. `70840` has `234` but no `233` record to substantiate the edge [3]. No observed giver/turn-in coordinates for either stage on any locked build. |
| `182 → 218 → 282 → 420` The Troll Cave, The Stolen Journal, Senir’s Observations (quest levels 4 → 5 → 5 → 5; all minimum 1 [1][2][4]) | `70840` only substantiates the `282 → 420` edge [3]. Giver, objective and turn-in positions unknown for the selected stages. |
| `96392` Farsen’s Watch, `96393` Old Ironforge Incursion | Minimum level 9 does not make these starter steps: quest levels 13 and 16, respectively, on the build where their Alliance offer was observed, with incoming links `96408 → 96392` and `96391 → 96393`.[2][8] The observed giver is Earthseer Farsen (`264936`, map `1426`, normalized `(0.6486, 0.5845)`); this is not an objective or hand-in coordinate.[8] Cook Ghilm (`1355`, Alliance, map `1426`, `(0.6836, 0.5442)`) has no recorded quest offer there.[8] |

The starter candidates above have an unrestricted source race mask where present, but that alone proves neither an Alliance offer nor eligibility for Dwarf or Gnome. Chain links are source evidence for sequence, not proof that every prerequisite has been captured. Leave existing quest reference records intact; promote nothing until same-build evidence establishes the relevant faction/race, prerequisites, and exact quest-to-actor/map links.

## Qualification

- `npm run build:guided-route` followed by `npm run check:guided-route`: passed; regenerated `BackstageForeverGuideData.lua` is byte-identical to baseline.
- Bundled desktop-builder and generated Lua/Fengari probe: both races retain the level-1–9 gap. Their first existing step is `travel:1436` (Alliance Westfall, level 10), with desktop point `(0.5991, 0.1943)` and serialized point `(0.599, 0.194)`. No starter-map waypoint or excluded ID is emitted for either race. This endpoint is not a qualified handoff from Dun Morogh. A broader probe found later existing Barrens turn-ins (`1111`, `1178`) at levels 36/37; those are outside this slice and were not qualified or modified.
- `node --test tests/guided-route.test.cjs tests/route-review.test.cjs tests/route-givers.test.cjs tests/addon-route.test.cjs`: 18/18 passed. No change to B1, route logic, renderer, or bundled content. Live-client acceptance deferred; no continuous leveling coverage or release claim.

## Sources

[1] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quests.enUS.json — Efficient Games — 1.60.1.70888, quests.enUS.json
[2] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/quests.enUS.json — Efficient Games — 1.60.1.70862, quests.enUS.json
[3] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/quests.enUS.json — Efficient Games — 1.60.1.70840, quests.enUS.json
[4] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/quests.enUS.json — Efficient Games — 1.60.1.70790, quests.enUS.json
[8] https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/npcs.json — Efficient Games — 1.60.1.70862, npcs.json

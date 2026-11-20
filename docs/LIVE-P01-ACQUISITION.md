# LIVE-P01 · Chest acquisition pilot

Open **Adventure → Dungeons & raids → Chest gear acquisition leads**. This is a read-only view. It uses the active character’s saved build and the matching installed item table to confirm the exact item ID and the chest inventory types (5 and 20). It reads the existing per-character loot wish list; a star neither changes the display order nor proves ownership. The pilot does not score items or change Sheet, Preparation, the addon, or the existing community drop reference.

## Reviewed Forever reference data

All three bundled relations below come from `wowf` build `1.60.1.70888`, collection window 2026-11-10 through 2026-11-12, under the same source commit. The bundled multi-build packs alone were **not** used to establish any of these per-build relations. Installed item data, not an item’s name, establishes its slot and known equip restrictions.

| Source | Exact evidence and limits |
| --- | --- |
| Quest #166 → Tunic of Westfall #2041 | The quest record reports `minLevel: 14` and `rewards.choices` contains `itemId: 2041, count: 1`.[1] The save must contain exact quest ID 166 and meet that minimum to display the saved-log state. The lead is reference-only otherwise; it does not infer predecessor completion or pickup availability. |
| Merchant #956 → Scalemail Vest #285 | `vendors[956].entries["item:285"].itemId` is 285. Same-ID `npcs[956]` identifies Dorin Songblade with `Merchant` and side `Alliance`; `creatures[956]` independently identifies Dorin Songblade with Alliance reactions `[5,6]`.[2][3][4] This is historical evidence, not present stock, price, faction access, or a dated observation of the individual item. |
| Creature #4428 → Death Speaker Robes #6682 | Format-3 `sources["npc:4428|group"].items[6682]` contains one non-quest observation. `creatures[4428].name` is Death Speaker Jargba in the same build’s creature details; the bundled Atlas associates that exact NPC and item with Razorfen Kraul (`rfk`).[5][6] The sample is not a drop-rate estimate and does not prove current availability, entry eligibility, lockout or personal loot. |
| Saved recipe → its exact output item ID | No generic recipe catalog is used. The saved recipe must have a positive matching profession rank, known reagent IDs and quantities, and ordered observation dates bounded by the active character’s save. The matching installed item row must confirm the output as chest armor. Minimum skill rank, carried materials, station requirements and current craftability are not proved. |

Data from [Efficient Games](https://efficient.games), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Selected and normalized exact-ID relations only; costs, coordinates, chances, yields, and unrelated rows omitted. No underlying Blizzard client code or assets are included.

## Source checks

Before inspecting row membership, check raw byte counts and SHA-256. The quest and creature-details pins are also in `data/forever/source-lock.json`; the merchant, NPC and creature pins are in `data/forever-vendors/source-lock.json`. The exact loot original is pinned below because the merged boss pack lock does not pin raw per-build files.

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| [1] | 5178761 | `433fc57290a162eca1c688c277a96234d39b7198edb1326ed4d6ec8fa4a65d60` |
| [2] | 234773 | `c3da2ed0c0d62e15ee261370dceb23557faaf14aaef579fa7d11067c9cdd9cfd` |
| [3] | 298166 | `c2b1b2e0ab58c187835428223c23f87c5a43bb36af51d20f1c6fd1c28fa60722` |
| [4] | 565733 | `1bf31b9f4462987773d6f76d269b179153b022442753ec8ead11092e84c2f13a` |
| [5] | 724577 | `5c1fef073bf493a18b09a36def59b5ca7fca4afa6d2067b96b7b8758d2d46409` |
| [6] | 1664807 | `415d59b7566c1fb70938784aea545919cdf3d4a432ad30dbc2b2d2995d09b9b8` |

1. [Exact-build quest original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quests.enUS.json)
2. [Exact-build vendor original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/vendors.json)
3. [Exact-build NPC original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/npcs.json)
4. [Exact-build creature reaction original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/creatures.json)
5. [Exact-build loot original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/loot.json)
6. [Exact-build creature details original](https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/creature_details.enUS.json)

Run `node --test tests/gear-acquisition.test.cjs` for projection and request checks and `node scripts/gear-acquisition-smoke.cjs` for the isolated desktop check. The smoke uses synthetic character and installed-item data with the real main/preload/renderer and reviewed reference relations; it does not verify a live client.

# Your Forever quest reference

The local unreleased travel reference is a separate bounded offline pack; see [travel guidance and evidence limits](TRAVEL-GUIDANCE.md). Its compiler/check does not modify this quest ledger, supplementary insights, seller pack or native addon waypoints.

BF includes its quest reference. You do not need an AI connection, account signup or database download. Connect the game and load the companion addon. In-game guidance updates as you play outside combat; the desktop receives a saved snapshot on logout or game exit. Use a voluntary `/reload` when you want that desktop snapshot now or need to load an addon update. Routine progress does not require routine reloads.

Quest Guide starts with your character's quests. Search locally by name or quest number to inspect reported chain links, givers, finishers, approximate observed locations and listed rewards. Reward choices mean choose one; they are separate from guaranteed items. Missing details stay unknown. A reported next-quest link does not establish every prerequisite or guarantee your character can accept it.

Where compatible evidence supports a destination, **Copy game waypoint** prepares a short `/bf guide` command. Paste it into WoW yourself. The addon checks the command and quest state before placing a supported marker; if placement is unavailable it can print coordinates. BF never moves, targets, fights, interacts, automatically reloads or opens game panels for you.

Saved game destinations and historical reference locations are distinct. NPC reference coordinates record where a player stood while interacting, not an exact spawn or guaranteed route. A named NPC mentioned in an objective remains a clue, even if a historical interaction coordinate exists. Quest facts have a collection date, build and source report count. One report is not independent corroboration. Server-cache records alone do not prove a quest is playable.

## What the 0.12 reference contains

The bundled Efficient Games observations match live Forever product `wowf`, build **1.60.1.70862**, English `enUS`, with observations through **November 9, 2026**. The refreshed pack has **3,884 quest cache records**, of which **379** have offer, turn-in or objective-progress evidence. It also includes 341 interacted NPC records and 36 interacted objects. Default browsing prioritizes your current quests and records with played evidence; additional cache-only entries require an explicit choice and do not independently trigger recommendations.

The same fixed matching-build test profiles were used before and after the refresh, without a saved game destination:

| Reference test phase | Previous coordinate destinations | Refreshed coordinate destinations | Refreshed named-NPC clues |
| --- | ---: | ---: | ---: |
| Ready turn-in | 163 | 301 | 44 |
| Unfinished objective | 81 | 129 | 68 |
| Reference browsing | 212 | 373 | 40 |

Counts are unique quests, not a count of points. Clues are separate from coordinate-qualified results. These synthetic checks measure structural reference potential, not actual player accuracy, eligibility, live-client acceptance or universal coverage. The data contains explicit giver/finisher/objective positions for 374 unique quests; phase and objective-shape guards can reduce usable results. Some malformed optional observations are dropped during normalization. Another build or locale may have no compatible reference; BF shows that instead of mixing unrelated Classic, Era, beta or unlicensed locations.

No second external publisher met the compatibility and licensing requirements for this pass. The complementary path is supported current-client observations, with the game point and its qualification kept separate from historical references.

## Supplementary field notes (local, unreleased)

The current local review build adds a separate offline `data/forever-insights/` artifact; public 0.12.3 and the held 1.0 release are unchanged. Quest Guide places these historical facts after the existing waypoint action. Exact quest ID/title, reference source commit/build and saved build/locale when known must agree. Manual reference browsing does not establish player availability. Incompatible or missing facts stay unavailable.

The same Efficient Games pin supplies 3,677 quest sharing observations, 33 static reported duration limits, 928 starting-item IDs and 131 item/count drop lists. The base remains **3,884 quest cache records**. Sharing counts are recorded answers from contributor files, not distinct people, independent witnesses or probabilities; disagreement remains mixed and absence unknown. A duration is not a countdown. A starting item proves neither ownership nor quest access; a drop entry establishes no drop rate, location or guarantee. Missing optional facts imply no restriction or prerequisite.

The artifact also retains 34 exactly joined trainers with 2,074 service listings, covering 1,139 distinct spell IDs, and 5,014 status-valid English item names for later local guidance. Trainer positions are approximate interaction points. Level zero has unknown-requirement/already-known ambiguity; positive reported levels establish neither learnability nor learned status. Missing faction reaction evidence remains unknown. Observation names have unspecified locale even though cache names are enUS. No costs, ambiguous ability relationships, narrative text, racial mechanics, eligibility rules or item stats are included.

All seven source files have exact byte/hash/metadata locks and separate collected dates under `data/forever-insights/source-lock.json`. Normalization omitted one invalid zero-count drop row, 943 invalid item-name records and 14 removed item-name records. All 131 raw drop lists retain at least one valid entry, so normalized nonempty-list coverage is also 131. The 45 sharing rows outside the cache are counted as unjoined and never manufacture full quest records. Per-file source counts stay distinct. These supplementary facts update **with app releases only**; Refresh reference continues to update the separate existing six-file quest ledger. There is no additional network request, and these facts are not silently added to automatic AI context, Director rankings or native addon markers.

## Freshness and privacy

Automatic reference checks download public whole-build datasets. They do not send character names, quest lists, account details, notes, goals or AI credentials. Disable automatic checks or refresh manually when wanted. Failed or oversized downloads preserve the last valid data. For the same build, a newer bundled observation date takes precedence over an older valid cache after an app upgrade; equal-date or newer caches remain usable. The last check date and the source collection date mean different things.

Full completed-quest ID sets stay local. With **Use my active character** enabled, an explicitly submitted question may include a bounded selection of relevant sourced facts. Its preview uses the same approved context helper. Browsing, refreshing references and local planning never submit an AI question.

## Historical supply sellers

A separate offline catalog contains **91 vendors with listings**, **1,301 listing rows** and **487 item IDs** from the same pinned build/source. Two raw vendor records had no listings and were dropped. This catalog does not change the six-file quest cache or add network requests.

Suggestions require a compatible observed character build and explicit historical nonhostile reaction evidence for the character's reported faction. Missing evidence stays unknown; it does not mean hostile or inaccessible. This snapshot has no Alliance reaction arrays. Multiple-map mobile vendor history is browse-only. Reference locations are approximate interaction points, and current stock, price and access are unverified. No observed seller means no matching observation, not that a material is unobtainable. No automatic purchase or vendor waypoint is created.

## Source and license

Data from [Efficient Games](https://efficient.games), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [JIVESCORP/eg-link-output-wowf, immutable commit 23f9636486d3d60479dc0bcee2356053c33faf2c](https://github.com/JIVESCORP/eg-link-output-wowf/tree/23f9636486d3d60479dc0bcee2356053c33faf2c). Backstage Coding filters, normalizes, indexes and combines the records; those are changes to the compilation. The separate quest and seller artifacts retain their own license/notices. App code remains MIT. The compilation license does not transfer ownership of Blizzard's game content.

## For source developers

### Qualified acquisition data (local, unreleased)

`data/forever-acquisition/` is a separate offline increment for a following profession/map consumer. It contains exactly **seven relations / seventeen historical player-standing points**, capped at the first three distinct valid normalized positions in each original record's array order. Relation order is authored and stable: `object:1617|spell:2368` → 765; `object:1618|spell:2368|bountifulHarvest:1` → 2447; `object:1619|spell:2368` → 2449; `object:1731|spell:2576` → 2770 and 2835; `npc:11910|quest` → 2589; and `vendors[3005].entries["item:2320"]` → 2320. Object labels join the same numeric ID in `npcs.approached`; corpse identity joins `creatures`; the merchant joins vendor/NPC/creature identity, Merchant interaction and exact item listing. No Poor Copper fallback, reversed relationship, skinning claim, odds, yields, prices or inferred requirements are included.

Four original `eg-` files are locked to Efficient Games commit `23f9636486d3d60479dc0bcee2356053c33faf2c`, product `wowf`, build `1.60.1.70862`. The lock preserves original metadata: creature contributions span **November 7–9, 2026**, while loot/NPC/vendor contributions and selected point observations are **November 9**. Contributing saved files and loot windows count observations, never active spawns or independent people. Per-relation observed contexts remain visible; `requiredSkillLineId`, `requiredRank` and `availableNow` are null, and `exactObjectPosition` is false. Vendor limited-stock evidence is unknown for this selected listing. No client files or map textures ship.

The public projection returns `{version:1,status,reference,rows,limitations}` with explicit unknown rows for uncovered requested item IDs. Each row has `itemId,status,reason,sources`; each bounded source retains exact `sourceKey,kind,entityId`, reference-labelled name, positions, evidence/date/build, counts, context and unknowns, plus `qualification,reason`. It exposes no profile/source identifiers, notes, goals, keys or private paths, and does no provider I/O. Material display names must come from actual same-ID recipe/material observations. A matching dated saved addon build permits only **qualified historical** places to look, never current gatherability or access. Vendor suggestions also need wholly nonhostile observed reactions for the saved faction; absent/opposing/conflicting evidence is browse-only. Manual, undated or different-build profiles are browse-only. In particular, **70888 is not verified by this 70862 reference**. A corrupt/missing resource is unavailable as a whole, while independent observed recipe planning remains possible.

The original CC BY 4.0 license bytes and attribution/change notice are preserved. This license covers the publisher's compilation/player observations and excludes Blizzard underlying game content/assets. `BackstageForeverAcquisition.lua` is a deterministic data-only export with matching provenance; no TOC, UI, capture, HUD, owned-install or runtime integration is made here. Existing quest/seller/insights/travel resources, dependencies and source version 0.12.3 remain unchanged; 1.0 is held.

```powershell
npm run check:forever-acquisition
npm run test:acquisition
node scripts/build-forever-acquisition.cjs --source-dir work/proactive-research --check
$env:ACQUISITION_SOURCE_DIR = 'work/proactive-research'
node --test tests/acquisition-data.test.cjs
```

The ordinary shipped check authenticates the authored canonical compiled identity, all raw descriptors, exact license and generated-Lua parity **without claiming raw reproduction**. An explicit `--source-dir` authenticates the four original Buffers, then reproduces pack/lock/Lua/license/notice from them; non-check generation writes only fixed in-repository targets. Its license source is `eg-LICENSE` in that directory, with the already verified `data/forever-insights/LICENSE` as fallback; it is not a fifth data Buffer. No fetching occurs. Runtime loading pins the 6,051-byte pack SHA256 `6447033020706c08abf1005f97a6fe86ac3ba081b72935a7781b185f978f940b` in authored source, so changing both local facts and an adjacent checksum cannot authorize different data. Tests with the environment variable prove actual raw reproduction and Fengari data parity; absent that variable only the optional raw-source case is skipped. These checks do not certify real-client behavior.

Ordinary tests and the offline checks use bundled artifacts and small tracked fixtures, without ignored research files or network access:

```powershell
npm run check:addon-reference
npm run check:forever-vendors
npm run check:forever-insights
```

For full reproduction, obtain the exact files at the immutable URLs in each source lock. The compiler checks bytes, SHA256, metadata and bounds before normalization. Put the six quest inputs together in one folder and the three seller inputs in another, then run:

```powershell
node scripts/build-forever-data.cjs --source-dir "C:\path\to\quest-inputs" --check
node scripts/build-forever-vendors.cjs --source-dir "C:\path\to\seller-inputs" --check
node scripts/build-forever-insights.cjs --source-dir "C:\path\to\seven-insights-inputs" --check
```

Do not substitute another build or infer undocumented prerequisites. Keep the shipped license and notice with redistributed derived data. See [measured validation](VALIDATION.md) and the source locks under `data/forever/` and `data/forever-vendors/`.

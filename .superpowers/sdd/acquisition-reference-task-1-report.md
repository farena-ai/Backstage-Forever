# Acquisition reference Task 1 delivery report

Date: 2026-11-11. Base: `ab0a4223d60447476a922f47410f67c39deb8130`.

## Scope and result

Implemented the offline acquisition compiler, strict known-relation schema, authenticated bundled loader, qualified public projection, deterministic data-only Lua export, focused tests, scripts and source/license documentation. Exactly seven relations and seventeen historical standing points. No profession consumer, UI, capture, HUD, TOC or owned-install integration is included. No agents were dispatched. Existing quest/vendor/insights/travel resources and dependencies are unchanged. Source version remains 0.12.3; 1.0 remains held.

## Actual RED and GREEN evidence

Before any runtime implementation:

```powershell
node --test tests/acquisition-data.test.cjs
```

Actual RED: 16 tests, 0 pass, 15 fail, 1 skip. Every executed case failed the explicit `Acquisition data module must exist` assertion, not a missing-import exception. Optional raw-source case was skipped because ACQUISITION_SOURCE_DIR was absent.

After initial implementation, real raw-source/Fengari GREEN was 16/16 with zero skips. During self-review, a new regression exposed Date.parse accepting shortcut/impossible dates as qualifying saved evidence:

```powershell
node --test --test-name-pattern='parseable date shortcut' tests/acquisition-data.test.cjs
```

Actual RED: 1 test / 1 failure, expected `browse-only` but received `qualified-historical`. After strict dated timestamp validation, the same command passed 1/1. This does not impose a recency or real-client certification claim.

Final focused GREEN after the date fix and additional descriptor/raw corruption coverage:

```powershell
$env:ACQUISITION_SOURCE_DIR = 'work/proactive-research'
node --test tests/acquisition-data.test.cjs
```

Actual final result: **17 tests, 17 pass, 0 fail, 0 skipped**, duration 1116.0371 ms. Includes real four-buffer compiler reproduction, all four exact-byte/hash pin rejections, corrupt raw format/license/build/grammar/member/ID/name mutations, strict schema/semantic corruption, canonical identity despite recomputed editable checksum, raw-descriptor bytes/hash/URL/meta/date/limit corruption, exact license rejection, private canaries, defensive copies, bounded requests and positions, unknown materials, source contexts/corpse distinction, 70888/manual/undated browse-only behavior, Horde qualification versus unknown/opposing/conflicting reactions, and execution of every exported data value in the actual installed Fengari interpreter.

Actual generation/check commands, all exit 0:

```powershell
node scripts/build-forever-acquisition.cjs --source-dir work/proactive-research
node scripts/build-forever-acquisition.cjs --source-dir work/proactive-research --check
node scripts/build-forever-acquisition.cjs --check
node --check src/core/acquisition-data.cjs
node --check scripts/build-forever-acquisition.cjs
node --check tests/acquisition-data.test.cjs
git diff --check
```

The explicit source-dir check reports locked four-file raw reproduction plus pack/lock/Lua/license/notice parity. The no-source-dir check explicitly reports shipped identity/provenance/license/Lua parity and says raw originals were not reproduced. No network access or download occurs in either mode. The CLI validates all fixed output paths and physical ancestor containment before writes and rejects output symlinks; it accepts no arbitrary output directory or fetch option. Generation performs no cleanup/deletion.

A read-only comparison against HEAD confirmed **17 existing pinned data/export resources byte-identical**. The TOC and package-lock Git diff is empty. A preliminary raw comparison including the TOC encountered its pre-existing CRLF working-tree versus LF Git representation; that was a comparison-method mismatch, not an edit. The corrected exact-byte check covered the 17 data/export resources, and the TOC was separately checked with Git's own normalization. Package content outside scripts compares equal to HEAD; version 0.12.3 and dependency/lock contents remain unchanged. No affected existing runtime was edited, so no vendor/travel/insights tests, full suite, build or GUI check was run.

## Generated artifacts: exact bytes and SHA256

| Artifact | Bytes | SHA256 |
|---|---:|---|
| data/forever-acquisition/pack.json | 6051 | 6447033020706c08abf1005f97a6fe86ac3ba081b72935a7781b185f978f940b |
| data/forever-acquisition/source-lock.json | 2811 | dffd85edccf247b5d11dbb353e3bf5836a6d4c54ba9e68f924687c3583141f49 |
| data/forever-acquisition/LICENSE | 18659 | 5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0 |
| data/forever-acquisition/NOTICE.md | 1305 | 80a91163655ef28f118cd3a41b6f627563534bb3a9434da89ce90a346eafb51a |
| addon/BackstageForever/BackstageForeverAcquisition.lua | 7340 | ea98a4bf603b4aa752d6b2fadba6b3c6bde41e9391640b38f069d608ae5d7b35 |

Compiled canonical identity is an authored constant in src/core/acquisition-data.cjs, separate from the editable source lock. Editing both pack and adjacent checksum fails loading. License bytes retain the original LF/blank-EOF form through explicit Git attributes. Lua and new data text have LF attributes.

## Immutable source and interpretation

Four exact originals are read from existing work/proactive-research; no researchOnly sample is copied as production input. Source repository JIVESCORP/eg-link-output-wowf, commit `23f9636486d3d60479dc0bcee2356053c33faf2c`, product wowf, reference build 1.60.1.70862. Raw total 2,514,059 bytes against 3,145,728 aggregate bound; per-file limits/hashes and exact original metadata are authored in the module and retained in the shipped lock. Loot format must be 3. Creature contributions are November 7–9; other inputs and selected position observations are November 9.

Relations, in authored stable order: object1617/spell2368→765 (2 points), object1618/spell2368/bountifulHarvest:1→2447 (3), object1619/spell2368→2449 (1), object1731/spell2576→2770 (3), the same exact source→2835 (3), npc11910/quest→2589 (3), vendor3005 exact item2320 listing (2). Position selection takes first three distinct valid normalized original positions in original array order, never a guessed node/spawn coordinate. Source identity/name joins use exact IDs, with vendor/NPC/creature name agreement and Merchant evidence. Source-kind/context grammar is checked; corpse loot is not skinning, and talent/quest context is retained without declaring requirements. Poor Copper562111 and the additional coverage candidates remain absent. Vendor10940/10938 stays in the existing separate vendor pipeline; no disenchanting/shard relation is invented.

Observation/contributing-file/window counts retain their original meaning and are never spawn counts. Required skill/rank/current availability remain null and exactObjectPosition remains false. The selected merchant has historical Horde[5] reactions and no Alliance reaction evidence; absent limited-stock field stays null rather than becoming unlimited/current stock.

## Exact public export and consumer DTO contract

The module exports exactly these five functions:

- `compileAcquisition(inputBuffers)` accepts exactly four original Buffers keyed eg-loot.json, eg-npcs.json, eg-creatures.json, eg-vendors.json; authenticates all raw bytes/hashes before parsing; returns a detached deterministic validated pack, not a serialized string. No I/O.
- `validateAcquisitionPack(value)` validates bounded known-relation subsets and exact public schema/provenance/context/unknown semantics, returning a defensive clone. This is schema validation; `loadAcquisitionPack` additionally authenticates the canonical complete bundled identity. Unknown fields and invalid records fail atomically; no repair occurs.
- `loadAcquisitionPack(directory=defaultDirectory)` reads pack.json/source-lock.json/LICENSE/NOTICE.md with bounded reads and authenticates canonical pack identity, exact raw descriptors, exact license bytes and required notices. Failure throws exactly `Acquisition reference unavailable.` without paths/imported content.
- `acquisitionFacts(pack,profile,itemIds)` performs no I/O. Up to40 distinct positive ordinary IDs; input arrays are also bounded at1000. Duplicates are removed preserving request order. Returns detached `{version:1,status,reference,rows,limitations}`. `status` is `available` or `unavailable`. `reference` is null on unavailable, otherwise `{sourceRepository,sourceCommit,product,clientBuild,license,licenseUrl,attribution,sourceDates,changes}`. Rows are `{itemId,status,reason,sources}`; row status is `qualified-historical`, `browse-only`, `unknown` or `unavailable`. An uncovered ID has zero sources and explicit no-observed-source reason. Invalid pack returns all requested rows unavailable, with no partial facts; malformed caller item lists throw.
- `buildAddonAcquisition(pack)` validates and returns deterministic data-only Lua assigning `BackstageForeverAcquisition`; no imports, event handlers, game actions or executable imported text. Lua represents JSON null unknowns as nil and arrays as sequential numeric tables; full field-by-field parity is tested in Fengari.

Each DTO source carries at most three points and the following exact allowlisted names: `sourceKey,kind,entityId,referenceName,nameKind,gatherSpellId,requiredSkillLineId,requiredRank,positions,positionCountInOriginal,positionEvidence,exactObjectPosition,contributingFiles,observedLootWindows,context,observedOn,clientBuild,observedReactionsByFaction,reactionContributingFiles,listingContributingFiles,lastSeen,limitedStock,availableNow,qualification,reason`. `positions` is an array of `{mapId,x,y}`. `nameKind` is `reference-source-name`. Source qualification is `qualified-historical` or `browse-only`. No material display name is invented; following consumers must join actual same-ID observed recipe/material names. At most three sources per requested item are exposed. `limitations` is an array of public explanatory strings. `sourceDates` retains one `{first,last}` object per eg- original basename.

Qualification requires profile.source.kind `wow-addon`, a valid ISO timestamp with timezone in profile.source.updatedAt, and exact profile.clientBuild `1.60.1.70862`. Manual/missing/invalid-date/mismatched-build evidence is browse-only with an explicit reason. Vendor additionally requires actual profile.faction Horde or Alliance with nonempty wholly nonhostile observed reactions4–8; unknown/opposing/conflicting/hostile history remains browse-only, as does multiple-map merchant history. This never establishes gatherability, requirements, stock, safety, access or current presence. Profile/source identifiers, names, notes, goals, keys and paths are excluded, including tested private canaries. No provider context/access exists here.

## Rights and limitations

Exact attribution retained: `Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.` License URL https://creativecommons.org/licenses/by/4.0/. Actual generation copied existing `work/proactive-research/eg-LICENSE`, hash/bytes above. The CLI also supports the already verified existing `data/forever-insights/LICENSE` copy when the source directory contains just the four originals; license is not a fifth compileAcquisition data Buffer. Source pin, attribution and changed-data notice are included in pack/lock/NOTICE.md/Lua and documentation. The grant covers publisher compilation/player observations and excludes Blizzard underlying content/assets. No raw megabyte source files, client Lua, guide prose, textures or map assets ship. Implementation code remains MIT; observations are not relicensed as MIT.

Coverage is deliberately seven relations, not a general profession/spawn database. The existing November11 coverage note establishes no publisher70888 pin; this task does not infer disappearance, present gatherability or current-build compatibility. Unknown requirements/access/current presence remain unknown. Tests are offline and synthetic around genuine pinned public source data; no real character, game/input/auth/audio/paid/installer/OS-settings operation, watcher or publication was performed. Source/build flags and historical qualification must remain visible in the following consumer. Real client/map/harvest behavior is unverified. Parent independent SPEC/QUALITY review is the next gate before profession coach work; full-series suite/build/copied-artifact gates remain with the parent. No release was attempted.

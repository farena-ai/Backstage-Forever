# Qualified acquisition reference

## Purpose

Supply the profession coach and map with a small, reproducible Forever material-to-source reference. This is an independently reviewable data increment before the profession consumer, not a claim of complete profession/spawn coverage. Umbrella2026-11-11-proactive-adventure-series.md binds constraints. No UI/capture/game API change here. Source0.12.3/1.0held; no publication, installer or external player/account operations.

Research: work/proactive-data-research.md, work/proactive-current-data-note.md and work/proactive-research/acquisition-{input-descriptor,sample}.json. Parent verified all27 research-manifest files,3,137,429bytes, exact lengths/limits/hashes. Research sample is evidence, not a runtime artifact to copy blindly. Current EG main9fcae73cc74fea4f1c4f2f09df9ca811b0f893ae has no70888 directory/index entry; that is an unknown coverage boundary, not absence of resources. Keep the proven70862 pin and explicit historical/browse status for other builds.

## Immutable inputs and facts

Repository JIVESCORP/eg-link-output-wowf, commit23f9636486d3d60479dc0bcee2356053c33faf2c, productwowf/build1.60.1.70862. Four exact originals under work/proactive-research:

| Original | Bytes | SHA256 | Limit |
|---|---:|---|---:|
| eg-loot.json |975413|6409dd43e4d28ef7a43820147571cce76aea8b1b92823246872173cbd5d82dc6|2097152|
| eg-npcs.json |499984|aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded|1048576|
| eg-creatures.json |797697|f39ef280ce15d5162b2068e9deab438f1de0c3af0f19351a24e49d5deffa5ffc|1048576|
| eg-vendors.json |240965|8f9eebe8ef227deadbcef1eaad79aae4ca75e51240903db7fa2c25225ba1a5da|1048576|

Aggregate max3145728bytes, actual2514059. Raw URL root https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/23f9636486d3d60479dc0bcee2356053c33faf2c/data/wowf/1.60.1.70862/ with original basename minus eg-. Validate exact byte/hash before parsing, correct meta dataset/schemaVersion1/product/build/license/attribution; lootformat3. Retain each file's actual collectedOn: creaturesNov7–9, othersNov9. Position observations here are Nov9. No source fetch in compiler/runtime/check.

Exactly seven material relations, from actual exact-key item membership, not name similarity:

| Source selector | Item | Kind |
|---|---:|---|
|object:1617\|spell:2368|765|gathered-object-loot|
|object:1618\|spell:2368\|bountifulHarvest:1|2447|gathered-object-loot|
|object:1619\|spell:2368|2449|gathered-object-loot|
|object:1731\|spell:2576|2770|gathered-object-loot|
|object:1731\|spell:2576|2835|gathered-object-loot|
|npc:11910\|quest|2589|creature-corpse-loot|
|vendors[3005].entries["item:2320"]|2320|historical-vendor-listing|

Cap three existing valid positions per relation, total17points. Stable deterministic selection/order documented and tested against original records. Join object/NPC identity and names by exact ID to the same-build npc/creature data; vendor requires exact vendor/item identity, Merchant evidence and observed faction reactions. Item2589 corpse loot is not skinning; quest and bountifulHarvest:1 contexts remain visible. No PoorCopper562111 fallback. No chances, prices, yields, world coordinates, species guesses, inferred reverse relationships, trainer/recipe availability or minimum gathering requirements. requiredSkillLineId/requiredRank/availableNow remain null; exactObjectPosition=false. Positions mean approximate historical player-standing loot/interaction points, never object spawns or current presence. Counts describe observations/contributors, not spawn counts.

## Artifacts, rights and interfaces

Create data/forever-acquisition/{pack.json,source-lock.json,LICENSE,NOTICE.md}; generated addon/BackstageForever/BackstageForeverAcquisition.lua contains data only, same facts and provenance. It is not wired into TOC/owned install until the following consumer task. Existing quest/vendor/insights/travel resources are unchanged. No raw megabyte inputs, client Lua, guide prose, textures or map assets shipped.

EG compilation/player observations licensed CC BY4.0; underlying game content excluded by publisher. Retain exact attribution `Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.`, source/pin/license URL and change notice (selected seven relations, capped positions, omitted odds/yields/prices, preserved unknowns). Copy original CC BY license18659bytes SHA5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0. Add attribution in docs/THIRD-PARTY-NOTICES.md. Add LF attributes for this data directory and generated Lua; license blank EOF explicitly preserved rather than edited away. No dependency or lock changes.

New src/core/acquisition-data.cjs owns strict compiler/validation/load/projection interfaces:
- `compileAcquisition(inputBuffers)`: four-key object of original Buffers named by eg- basenames, exact pins/limits/meta checked; detached deterministic pack. No I/O or network. Seven selectors are authored constants, not broad discovery or a mutable source-lock authority.
- `validateAcquisitionPack(value)`: strict schema/bounds/unique relations/IDs/contexts/qualification/provenance; reject arbitrary fields and malformed counts atomically. At most64relations/16positions each, normalized finite0..1 coordinates, positive ordinary IDs and bounded strings. Initial canonical output must remain7/17.
- `loadAcquisitionPack(directory=defaultDirectory)`: bounded128KiB compiled pack; canonical compiled identity pinned in source, not authorized by an adjacent mutable checksum. Validate source-lock raw descriptors, license bytes, known source/build/dates and compiled identity; failure throws fixed unavailable error without disclosing private paths. No partial repaired pack.
- `acquisitionFacts(pack,profile,itemIds)`: no I/O, returns detached `{version:1,status,reference,rows,limitations}`. At most40distinct positive requested item IDs, at most3sources/item and3points/source. Uncovered item remains explicit unknown. Output only approved public facts; exclude profile/source identifiers, private notes/goals/keys/paths. No provider access.
- `buildAddonAcquisition(pack)`: deterministic safely escaped data-only Lua serialization; no executable imported text or untrusted commands.

Projection always preserves historical/approximate/current-availability-unknown semantics. Matching dated saved addon build can yield qualified historical places-to-look; this never establishes gatherability, access, stock, price, safety or an unlocked/fastest route. For vendor, default qualification additionally needs wholly nonhostile observed reactions4–8 for actual saved faction; unknown/conflicting/opposing reactions are browse-only. Manual/undated/different-build profile yields browse-only with explicit reason; current70888 cannot be silently treated as70862. Damaged/missing pack can yield unavailable projection while observed recipe planning stays usable. Material display names come from actual same-ID recipe/material observations; short English source names remain labelled reference names.

## Compiler/check and acceptance

scripts/build-forever-acquisition.cjs supports --source-dir for explicit developer-owned originals and --check. No raw dir: --check validates shipped artifacts, canonical identity, descriptors/license and generated-Lua parity only; it does not claim raw-source reproduction. With explicit source dir, reproduce from four locked originals and compare pack/lock/Lua/license. Non-check build writes only fixed verified in-repo output targets; no cleanup/deletion/fetch. New npm check:forever-acquisition and test:acquisition commands. Optional raw tests use ACQUISITION_SOURCE_DIR; final parent suite supplies it for zero skipped reproduction. Generated bytes/canonical hashes recorded in task report.

Meaningful RED/GREEN tests: exact7/17/IDs, compile original-byte reproduction, hash/meta/license/source grammar/ID-join fail closed, corpse vs skinning/talent-context distinction, unknown requirements not zero, no unmatched source fallback, mutable local checksum cannot reauthorize altered facts, corrupted whole pack unavailable, defensive copies/limits and privacy canaries, build/manual/date/faction qualification and safe Lua parity. No GUI/full suite/build needed for pure data. Parent independent SPEC/QUALITY gate before profession consumer. Automated source evidence does not certify real client behavior;1.0held.

Self-review: focused reusable fact boundary, all original bytes/rights and unknowns explicit, no stale-build promotion, no new user authority needed. Observed subset coverage is intentionally modest; following increments supply useful UI and personal observations instead of fabricating a larger database.

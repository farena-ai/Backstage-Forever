# Guided travel review-fix report

Prepared before the scoped fix commit. Base HEAD: 316c6a26ce693fa0910a50349d2d2bc12de76096. One implementation owner; no additional agents, GUI or unrelated runtime work.

## Findings addressed

- [x] Important I1: ordinary level progression and talent/spec changes no longer become geographic connections merely because they use from/to grammar. Generic from/to alone no longer establishes travel. Named known endpoints or explicit transport wording preserve real trips containing incidental level/talent words. Unknown named places such as Darnassus/Exodar remain recognized for ordinary movement requests and bare place pairs. Corrections following nontravel progression/spec questions return null through the existing shared correction helper.
- [x] Important I2: via/through waypoints and chained endpoint to separators now produce the existing ambiguous clarification, with one question and no route option. Ordinary reversed wording such as how to get to tb from org remains a single trip.
- [x] Minor M1: the excluded node-77 assertion now reads flightMaster?.taxiNode. A separate synthetic nested-field mutation control proves the assertion would detect the research-only node instead of passing vacuously.

Only src/core/travel.cjs, tests/travel.test.cjs and tests/travel-data.test.cjs changed, plus this report. No exports/result shapes, source descriptors, generated pack/lock, coverage, licenses, integration, version or release settings changed. questionForEvidence and companion-conversation.cjs are unchanged.

## RED then GREEN

First added the focused regression tests before implementation, including a synthetic node-77 mutation using the old predicate.

```powershell
$env:TRAVEL_SOURCE_DIR='work/guided-travel-inputs'
npm run test:travel
```

Observed RED: 38 tests, 35 pass, 3 fail, 0 skipped. Expected failures were the nested node-77 mutation returning false, the level-10 to level-20 question producing a travel intent, and via Crossroads producing unknown-endpoint instead of ambiguous. The positive-control cases for real city travel with incidental progression words and named unknown places already passed.

Minimal parser/predicate changes then produced 38/38 GREEN. Self-review added fastest-way progression and leveling-route variants to the existing progression test before adjusting their classification:

```powershell
node --test tests/travel.test.cjs
```

Observed additional RED: 27 tests, 26 pass, 1 fail. Fastest-way wording incorrectly bypassed the progression guard. Separating actual transport/place evidence from generic route/fastest-way wording fixed it; generic wording still recognizes travel when no clear progression/spec-change form is present.

Final validation after formatting:

```powershell
$env:TRAVEL_SOURCE_DIR='work/guided-travel-inputs'
npm run test:travel
npm run check:forever-travel
node scripts/build-forever-travel.cjs --source-dir work/guided-travel-inputs --check
node work/guided-travel-audit.cjs
node --check src/core/travel.cjs
git diff --check
```

Final GREEN: 38/38 pass (11 data/compiler tests and 27 parser/planner tests), 0 failures, 0 skipped. Tests include actual original-byte raw-input reproduction and all existing qualification/correction/unknown/faction/availability safeguards. Offline check, original-byte reproduction, syntax and diff checks passed. No separate conversation test rerun: its pure helper and code are unchanged; exact correction behavior and new nontravel antecedents are exercised by the travel tests. No full suite, GUI, package, network, live data or publication work performed.

## Preserved evidence and limits

The repeated audit compiled the same three original inputs twice and compared both outputs with shipped bytes. Isolated shipped-only validation passed with outside-tree file reads and network entry points denied. All 18 protected older data/addon file hashes still match the pre-task baseline.

Pack remains 12,514 bytes, SHA256 6c9f49c58cad59056243fa4f8ffdab3a034504735143601f58b22c90127a6dbe. Lock remains 3,892 bytes, SHA256 daa20fe9083a19c333bdfb05820c5054078af00363eebb5de717466011367e5b. Coverage remains 17 nodes, 16 directed transports, one road itinerary, one scoped negative and four sources. All prior attribution and evidence exclusions are unchanged.

Self-review checked that level/talent keywords are not unconditional travel exclusions, unknown endpoints remain literal bounded names, multiple stops are not composed or labeled as cities, correction reuse still requires original recognized user travel, and the nested-field mutation test detects the excluded node. This remains a conservative bounded parser rather than general natural-language understanding or a game ontology. Parent owns focused independent re-review and later integration/full-suite/GUI/package verification.

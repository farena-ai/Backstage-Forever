# Guided travel task 1 report

Prepared before the scoped implementation commit. Base HEAD: fd50ac334bc60f298ea274021e315380b3899ce1. Branch: codex/pre-1.0-product-polish. One implementation owner; no other agents spawned.

## Completion and scope

- [x] Read the full binding travel design/plan, umbrella, task brief, TDD instructions and all requested evidence files.
- [x] RED before compiler/validator implementation, minimal implementation, GREEN; actual pinned input reproduction and atomic invalid-data rejection.
- [x] RED before pure parser/planner implementation, GREEN; additional observed failing regressions fixed before final verification.
- [x] Offline package/serial CI/release check registered, future packaged-resource parity list extended, beginner guidance and attribution documented.
- [x] Self-review, exact older-resource hash parity, syntax/diff checks and this report completed before commit.

Implemented only the bounded data/compiler/planner task. No main/preload/IPC/UI integration, generic AI pipeline, new dependencies, version/billing/capture/game-input/player-file/auth/audio/paid inference/install/settings/watchers/publication changes. Source version remains 0.12.3; 1.0 remains held. Parent owns independent review and later full suite, GUI and packaging. The existing pure questionForEvidence helper is imported, not changed.

## Coverage and evidence decisions

Final pack: 17 nodes (10 named cities and 7 distinct boarding stops), 16 directed transports (6 flights, 6 zeppelins, 2 tram directions, 2 Stormwind Harbour/Auberdine boat directions), 1 Org-to-TB road itinerary, 1 Org-to-TB direct-zeppelin negative, 4 sources. No path search or implicit access legs.

Flights: 23>22, 22>23, 23>25, 25>23, 25>22, 22>25. Doras/NPC3310/taxi23/quest6385, Tal/NPC2995/taxi22/quest6363, Devrak/NPC3615/taxi25/quest6361. Hash-locked NPC TaxiNode/Horde/name/position and quest factual locality joins are checked during compilation. No NPC77 locality inference, timing, cost, quest narrative, guide prose/images, authored map or client Lua redistribution. World coordinates are omitted; only three normalized source positions survive in reference nodes, never travel commands or directions.

E1 is exact-build published community observation, build 1.60.1.70862, observed 2026-11-09. E2/E3 are general published Forever guides dated 2026-11-06. E4 stays explicitly prelaunch general guidance dated 2026-10-14. All reviewed 2026-11-10; review date never replaces publication/observation date. Returned sources and plain text retain those distinctions.

Ratchet-to-Booty-Bay transport was deliberately excluded after parent clarification: the examined evidence proves that direction but not neutral Forever eligibility; reverse was not explicitly enumerated. Both cities remain recognizable and return uncovered. Optional skycutter, temporary portal, contradictory Theramore and all other flight observations remain excluded. The zeppelin negative and road itinerary are Org-to-TB only, never auto-reversed. Absence of a covered connection never means no route exists.

## TDD evidence (commands and observed counts)

1. Initial RED: node --test tests/travel-data.test.cjs — 9 tests: 0 pass, 8 fail, 1 optional raw-input test skipped. Expected assertions: validator/compiler must exist, and generated-resource LF policy absent.
2. First compiler GREEN: set TRAVEL_SOURCE_DIR=work/guided-travel-inputs; node --test tests/travel-data.test.cjs — 9/9 pass, no skips; actual original bytes compile twice identically and changed bytes/hash fail.
3. Initial planner RED: node --test tests/travel.test.cjs — 18/18 fail with expected assertion Pure travel planner must exist. First minimal run reached 16/18; endpoint extraction and coverage wording corrected, then 18/18 GREEN.
4. Hardening RED: node --test tests/travel-data.test.cjs tests/travel.test.cjs — 31 tests: 26 pass, 4 fail, 1 skip. Observed defects: valid-looking modified factual text accepted; unknown bare origin replaced by saved city; conjoined targets not marked ambiguous; undated build snapshot qualified flight. Minimal fixes and immutable canonical factual identity produced 31/31 GREEN with raw input enabled.
5. Correction RED: node --test tests/travel.test.cjs — 22 tests: 20 pass, 2 fail. Exact reported correction not recognized and unrelated prior question hijacked into travel. Shared questionForEvidence grammar and original-user-only parse fixed both. node --test tests/travel.test.cjs tests/companion-conversation.test.cjs — 29/29 GREEN at that stage.
6. Saved-origin RED: node --test tests/travel.test.cjs — 24 tests: 22 pass, 2 fail. Same-place/uncovered lost saved qualification; here/there could become an unknown literal endpoint. Both corrected, 24/24 GREEN.

Final GREEN commands:

~~~powershell
$env:TRAVEL_SOURCE_DIR='work/guided-travel-inputs'
npm run test:travel
node --test tests/companion-conversation.test.cjs
npm run check:forever-travel
node scripts/build-forever-travel.cjs --source-dir work/guided-travel-inputs --check
node work/guided-travel-audit.cjs
node --check src/core/travel-data.cjs
node --check src/core/travel-sources.cjs
node --check src/core/travel.cjs
node --check scripts/build-forever-travel.cjs
node --check scripts/packaged-smoke.cjs
git diff --check
~~~

Final focused travel tests: 34/34 pass, 0 fail, 0 skipped (10 data/compiler + 24 parser/planner). Existing affected conversation tests: 7/7 pass. Offline check and original-byte reproduction passed. Syntax checks passed. Tracked diff check passed; final staged diff checked before commit. Without TRAVEL_SOURCE_DIR, exactly one optional developer reproduction test skips; shipped-only tests remain fully offline. No full suite, GUI, package or release executed.

## Reproduction, offline isolation and preservation

Compiled pack: 12514 bytes; SHA256 6c9f49c58cad59056243fa4f8ffdab3a034504735143601f58b22c90127a6dbe.
Source lock: 3892 bytes; SHA256 daa20fe9083a19c333bdfb05820c5054078af00363eebb5de717466011367e5b.

Two independent compile(sourceDir) calls yielded byte-identical pack and lock, equal to shipped files. Compiler consumes exact original flights.json (21454 bytes; 4f5192576501cf17ceb4cbf0cbb56a63658525a5e0e16f299506ddf66d16e1cd), npcs.json (499984 bytes; aaa77747a6ad15f2828168e784fe0d639c9ced14c696a830bdb1688a22a9aded), quests.enUS.json (4141584 bytes; fece8cc749952f9a3eb8eeb223e6ebaea3d4d8244dd6ebd7c18091e93f5bed47), at immutable pin 23f9636486d3d60479dc0bcee2356053c33faf2c. Exact raw metadata/URLs are immutable code descriptors and independently checked lock fields. The full CC BY legal text is the original 18659 bytes, SHA256 5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0; LF attributes preserve bytes on Windows.

The audit copied only the two core data modules, compiler and four shipped resources into an isolated temporary tree with no work/raw inputs. In a fresh child process all file reads outside that shipped tree and fetch/http/https/net network entry points were denied. checkBundle passed. This directly proves raw sources and network are unnecessary for offline validation; no original research directories were renamed or touched. The compiler itself has no fetch path and requires --source-dir for explicit builds.

All 18 pre-recorded files in data/forever, data/forever-vendors, data/forever-insights and addon retain exact SHA256 parity:

~~~text
f5b745ef98087f531e719ee8ca6a96809444573ecc7173c6fa68eaad39b3cc3f  data/forever/LICENSE
f3d2a3b7ccf1c6735aa21c0c363e497078018ef8203c91c13be2ffb2298e63c6  data/forever/NOTICE
e38bef68092d8917faf45ad1c2ed1e4682e0445d1eef00de7ea4c169f9d3eea8  data/forever/pack.json
0f49e81a42698e57da4457e9c2390e4802a797eb44bb72a4ddf522b7f0fb54f0  data/forever/source-lock.json
f5b745ef98087f531e719ee8ca6a96809444573ecc7173c6fa68eaad39b3cc3f  data/forever-vendors/LICENSE
7c973f6a555bff62bf10ffeb3f2947d910281e43e5e9562ff1bca1a2fe63cf8a  data/forever-vendors/NOTICE
cf508a3b213c32eb5c0293113d46e963c83e70c5e9a64eb212b77a14e46b1af6  data/forever-vendors/pack.json
d96756ba2f7e54c72584dd586ef5c78d34c77671904cf50817a22bf62acf8ec3  data/forever-vendors/source-lock.json
5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0  data/forever-insights/LICENSE
14fd8fe516a55acf0ba159a2e0c267159f19a02bd4d63204d86bc5f7adeffe39  data/forever-insights/NOTICE
7fb3e8954fcf1bb801511f54dfc0b21110c92ea763cdc3c56502f7c8f902e22e  data/forever-insights/pack.json
0db62728e5ab771ec7fe03f1e17ee1f64635f2d070a1692b686cdabe24cc736d  data/forever-insights/source-lock.json
8f5e15b5af0cd4d1034137b0785eeffbe135630dd35d5ff492b4d5f6516c975a  addon/BackstageForever/BackstageForever.lua
0dd639487ce7e694484c7b1bef398dc6c2099efb3ccc32db3327123350411a3b  addon/BackstageForever/BackstageForever.toc
c98e806838e09476da57cf269df957c9771a7601a9b0ca708a56df0581cbef1d  addon/BackstageForever/BackstageForeverHUD.lua
a0c87f204f60bc140d40ed304fefa508afc07b43e11466e232c779d8ee30445c  addon/BackstageForever/BackstageForeverPlan.lua
57b5901216bc92c9898a7822d75cf677602405906da0caa6e68945a707d37bc9  addon/BackstageForever/BackstageForeverReference.lua
ae75f643f3f2c592e87338f2d0c86321f6d86d535002a3e8264124082c073a22  addon/BackstageForever/README.md
~~~

Ignored local evidence: work/guided-travel-before-hashes.json, work/guided-travel-audit.cjs, work/guided-travel-audit.json and work/guided-travel-inputs/. No raw inputs added to Git.

## Export contract for the integration implementer

src/core/travel-data.cjs exports:

- loadTravelReference(bytes: Buffer|string): validated reference object; throws a Travel reference error on malformed, oversized or changed data. Maximum compiled bytes 256 KiB. Exact canonical factual identity is code-pinned, so changing both pack and file-local lock does not authorize altered directions or wording. Whitespace-only JSON formatting is accepted at load; --check verifies exact shipped byte hashes.
- validateTravelReference(object): validates schema, bounds, static source metadata, directed endpoints/modes/factions, aliases, positions, negatives and canonical identity; returns the same object or throws. This is not a dynamic general graph API.
- compileTravelReference(inputs): takes exactly three name-to-Buffer entries; validates bytes/hash/meta and factual master/locality/direct-hop joins; returns canonical pack JSON string plus newline. No I/O.
- PACK_BYTES=262144, INPUT_BYTES=4194304, TOTAL_BYTES=5242880.

scripts/build-forever-travel.cjs exports compile(sourceDir, optionalLock), returning {pack:string, lock:string}; checkBundle() validates shipped pack/lock/license/notice without raw access and returns true or throws. CLI: --check OR --source-dir DIRECTORY [--check]; duplicate/unknown/missing arguments reject.

src/core/travel-sources.cjs exports deeply frozen COMMIT, BUILD, INPUTS, SOURCES, CITIES, ENDPOINTS, MASTERS, FLIGHTS, TRANSPORTS, ROAD_STEPS. URLs are controlled by static SOURCES only. Existing companion-conversation.cjs supplies questionForEvidence; no mutable ConversationSession instance is accessed.

src/core/travel.cjs exports parseTravelIntent(question, {previousQuestion, profile}={}) and planTravel(reference, intent, {profile}={}). Both are synchronous and have no I/O or side effects.

parseTravelIntent returns null for nontravel/overlong/nonstring input or correction without a recognized travel antecedent. Otherwise it returns:

~~~js
{
  status: 'ready' | 'clarify',
  question: 'original user question (max 12000 chars)',
  originId: 'orgrimmar' | null,
  destinationId: 'thunder-bluff' | null,
  originLabel: 'Orgrimmar' | null,
  destinationLabel: 'Thunder Bluff' | null,
  originSource: 'explicit' | 'saved-location' | 'unknown',
  // Only for clarify:
  reason: 'missing-endpoint' | 'unknown-endpoint' | 'ambiguous',
  clarification: 'one clear question'
}
~~~

Unknown labels are bounded plain letters/digits/spaces/apostrophes/hyphens (max 80 chars), never executable actions/URLs. Here/there/home are unresolved, not places. Fixed aliases accept org/tb/uc/sw, exact city names, Grom'gol apostrophe normalization and named boarding stops. IF abbreviation is intentionally omitted to avoid grammar ambiguity. Explicit unknown origins never fall back to saved location. Profile origin uses only dated wow-addon location.subZone/location.zone recognized as a city, always qualified as last saved, not live.

planTravel returns:

~~~js
{
  status: 'route' | 'clarify' | 'uncovered' | 'same-place' | 'unavailable',
  text: 'safe plain text with conditions, source dates/scopes, citations and coverage',
  origin: {id: 'orgrimmar' | null, label: 'Orgrimmar'} | null,
  destination: {id: 'thunder-bluff' | null, label: 'Thunder Bluff'} | null,
  options: [{id, title, mode, conditional: true, steps: ['plain text'], sourceIds: ['E1']}],
  cautions: ['plain text'],
  sources: [{id, product, publisher, url, scope, reviewedOn, license,
             // E1: commit, build, observedOn; guides: author, publishedOn
           }],
  coverage: 'small dated reference summary'
}
~~~

All statuses have every base field; no facts means empty options/sources. Invalid/missing reference returns unavailable, with no route, source or provider guess. A named unsupported endpoint yields uncovered while retaining the literal label. Unknown faction yields clarify for a covered faction-specific trip; opposing faction yields uncovered, with no restricted option. All offered transports remain conditional; exact-build flights additionally require shared wow-addon source.kind, valid source.updatedAt, matching clientBuild and Horde faction. This still does not establish learned routes or live availability. Other guide facts remain general and date-labelled. Selection is direct endpoints (or a clearly disclosed city boarding segment) plus the one curated road itinerary; no graph search/composition. Same-place is named-place equality only.

Safe integration pattern:

~~~js
const {loadTravelReference} = require('./travel-data.cjs');
const {parseTravelIntent, planTravel} = require('./travel.cjs');
let reference = null;
try { reference = loadTravelReference(shippedBytes); } catch { /* feature unavailable */ }
const profile = shareProfile ? approvedProfile : undefined;
const intent = parseTravelIntent(currentUserQuestion, {
  previousQuestion: approvedPreviousOriginalUserQuestion,
  profile,
});
if (intent) {
  const reply = planTravel(reference, intent, {profile});
  // Return reply.text to the old string API; preserve reply for future cards.
  // Recognized unavailable/uncovered/clarify results stay local, not a provider guess.
}
// null intent can continue through the existing authorized companion pipeline.
~~~

Example: fastest from org to tb + dated matching Horde addon profile => route, conditional flight then road; Doras/offered/unlocks unknown, Razor Hill and lifts, narrow direct-zeppelin correction, dated E1/E2/E3 citations, fastest unknown. org to uc => conditional dated E4 zeppelin segment with outside-gate boarding and Tirisfal endpoint. org to Darnassus => uncovered, Darnassus retained, no fabricated route. Share off + how to get to tb => clarify starting place. Exact This is for wow forever, not retail correction + original OrgTB user question => same resolved trip; same correction after Hunter pet advice => null.

Caller requirements: omit profile entirely when sharing is off; do not pass arbitrary renderer previousQuestion or AI prose. Revalidate ownership/privacy/session boundaries before selecting prior original user text, and discard stale intent on boundary changes. The planner cannot attest where its caller obtained a string. It does not implement pending clarification conversational state, own conversations, open links or create plans. Those are the next task. Resolve source IDs against static registry in main; never accept arbitrary external URLs/actions from renderer/model output. Render text as text, not HTML.

## Self-review and limitations

Reviewed source facts against the independent research pin and report; checked every shipped direction, output qualification and deliberate exclusion. Source URL registry, canonical content hash and bounded atomic validation make plausible-looking edited wording fail closed. No source counts are promoted to confidence/users/independent publishers. The one direct zeppelin negative does not contradict positive flights or other zeppelin pairs.

Parser is deliberately conservative: unsupported spellings, IF, conjunction-heavy/multi-stop requests and unresolved pronouns clarify rather than guessing. No global shortest/fastest solver, access-leg invention, player unlock observation, live operational availability, race/level/safety guarantee, learned hearthstone or cross-faction exceptions. Saved timestamps qualify a snapshot, not freshness/live position. Broader route coverage requires new evidence and a reviewed canonical identity. Companion integration, UI actions, local reply conversation commits, full suite, GUI and packaged artifact verification remain parent/next-task work.

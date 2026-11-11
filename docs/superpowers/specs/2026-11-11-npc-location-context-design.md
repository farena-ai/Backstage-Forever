# Reliable NPC locations and honest current-location context

Status: accepted design for Task 2, to follow the independent Task 1 review. The contracts below govern implementation. Version 0.13.5 is already prepared by Task 1; rewrite its current notes for the final combined scope. Version 1.0 remains held for Frank's hands-on acceptance.

## Exact problem and accepted scope

The user asked where in Org Cairne Bloodhoof was. The companion treated an old BoulderLodeMine save as current and improvised travel to Org. The user is already in Org. Two independent facts were conflated: where the player says he is now, and where an NPC has actually been observed. A question mentioning a city establishes neither the player's current location nor the NPC's presence there.

Implement a local NPC location answer before any AI/model/key lookup. Use the existing validated KnowledgeService index only when its build matches an observed character build; otherwise or when the NPC is absent there, use a separately identified historical reference compilation. An older reference must remain visibly older even if it happens to match a manual profile's claimed build. Unknown or ambiguous NPC locations receive a useful bounded local answer, not provider improvisation.

No new live desktop feed, process/memory access, game input, audio access, private profile inspection, generic web search, route expansion, addon changes, public publication or version change belongs to this feature. Native Compass already receives supported public events inside the game; desktop SavedVariables are saved snapshots. The product must keep that distinction.

## Research verified during this preparation

Pinned primary source:
https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/3067c6919046428152f2152fa551f44a8c215d79/data/wowf/1.60.1.70790/npcs.json

- Commit: 3067c6919046428152f2152fa551f44a8c215d79.
- Build/product/dataset/schema: 1.60.1.70790 / wowf / npcs / 1.
- Raw bytes: 882823. SHA256: 1f053dc1f283061a78637a8447914296e90d7344911a8ff5b86e508bf602805a.
- Metadata collection range: 2026-11-09 through 2026-11-11. Metadata source files: 4. Those dates/counts are not each NPC's lastSeen or independent corroboration.
- Exactly 616 rows in `npcs`; 758 positions across 20 map IDs, maximum 7 positions per NPC. Every current pinned NPC row has positions and lastSeen. `objects` and `approached` are distinct sections and excluded.
- Minimal id/name/lastSeen/sources/positions projection serializes to 80564 bytes before provenance. This is small enough to retain all 616 rows, with an 8-position validation bound per row. A five-NPC curated patch would create arbitrary coverage holes for negligible savings.
- A real duplicate canonical name exists: Valennia Stormfist, IDs 252383, 253590 and 253844. This is a mandatory ambiguity fixture.
- Cairne 3057: lastSeen 2026-11-05, sources 1, windows 2, side Horde, map 1456, x .5989, y .5167. Show approximately 59.9, 51.7 in Thunder Bluff; this is a historical interaction point, not a live spawn. Omit gossip/options/prose/world coordinates.
- Other regression rows: Nazgrel 3230 at 1454/.3239/.3629 (lastSeen Nov 7); Thrall 4949 at 1454/.3209/.3787 (Nov 7); Lady Sylvanas Windrunner 10181 at 1458/.5777/.9173 (Nov 5); Vol'jin 10540 at 1454/.344/.3668 (Nov 5).
- Existing current 70862 knowledge pack has no observed `npc:3057` point; its creature name record is not position evidence. Steering records that latest 70888 likewise has no point. Do not fetch latest at question time or treat a creature name as coordinates.
- Existing `data/forever-insights/LICENSE` hash verified: 5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0. Existing compiler records 18659 bytes. Reuse this verified CC BY 4.0 license text in the new bundle, with its own NOTICE.

## Options considered

1. Recommended: local exact-build observations plus separately compiled historical NPC reference; narrow volatile user-location context and shared provider policy. Reliable without an AI subscription, small deterministic data footprint, visible provenance, no runtime network dependency.
2. Only patch the shared AI instruction. This improves location precedence but leaves absent NPC evidence to model recall. It does not solve the actual reliability failure.
3. Fetch live pages or attempt a desktop live feed. This adds privacy, licensing, availability and game-integration work outside the accepted scope. The historical source cannot establish current state by becoming a network request.

## Proposed modules and contracts

### Historical compilation and validation

New `src/core/npc-location-sources.cjs`: immutable NPC source URL/build/commit/raw bytes/hash/exact metadata and verified license bytes/hash. No network code. Curated bounded map-label/alias entries for 1454 Orgrimmar and 1456 Thunder Bluff can reuse already sourced travel map associations; 1458 Undercity may be included with explicit reviewed mapping evidence. Unknown map IDs display `Map <id>`, never guessed labels. This mapping is presentation vocabulary, not an import of Classic coordinates or a new baseline dataset.

New `src/core/npc-location-data.cjs`:
- `normalizeNpcLocations(rawBytes, immutableSource)` validates raw metadata and extracts only the NPC section.
- `validateNpcLocationPack(value)` strictly validates the runtime shape and rejects unknown keys.
- Pack: schemaVersion/kind/product/build/sourceCommit/license/attribution/source file metadata; sorted NPC rows with numeric id, bounded name, valid per-NPC lastSeen, contributingFiles, optional bounded observedWindows if retained, and positions as mapId/x/y. Prefer omit side/windows because this feature needs neither eligibility nor observation-strength claims.
- No gossip, interaction text, options, levels, world coordinates, game text descriptions, objects, approached entities or character records.
- Bounds: raw input <= 2 MiB; pack <= 256 KiB; <= 1000 rows, <= 8 valid points per row, safe positive integer IDs, finite normalized coordinates [0,1], valid ISO days, names <= 200 printable chars. Distinct keys/IDs; impossible metadata or top-level corruption fails the pack. Compiler may drop malformed optional positions/rows deterministically and count them, but pinned expected coverage must remain 616 NPCs and 758 points so an unnoticed drop fails the release check. Never replace lastSeen with collection date.
- Stable numeric ID ordering and stable point order with exact duplicate points removed. Preserve separate valid points; do not average maps, infer a spawn, or select the nearest point from a stale character location.

New `scripts/build-forever-npc-locations.cjs` follows the existing insights compiler pattern: `--source-dir <dir>` compiles supplied bytes after immutable byte/hash/metadata checks; `--check` validates bundled output, expected coverage, source-lock, compiled checksum, NOTICE and LICENSE entirely offline. No automatic source fetch in compiler or app. Release script must include this check.

New `data/forever-npc-locations/{pack.json,source-lock.json,LICENSE,NOTICE}`. NOTICE identifies Efficient Games/CC BY 4.0, immutable commit/build/raw URL, collection range, projection changes, separate NPC lastSeen, historical interaction-point meaning and incomplete coverage. App update supplies the bundle; no runtime updater/cache mixing with the quest pack. Existing `data/**/*` packaging already includes it. Document attribution in `docs/THIRD-PARTY-NOTICES.md` and explain bounded feature in the existing companion/privacy docs, not an import guide.

### Query classification, matching and evidence selection

New `src/core/npc-location.cjs`, pure and separately testable:
- `parseNpcLocationIntent(prompt)` returns null for non-location questions and a bounded query descriptor for explicit forms: `where is <name>`, `where can I find <name>`, `where in <place> is <name>`, `location of <name>`, `find NPC <name>`, `where is NPC #3057`. Exact examples and supported punctuation get tests. Multiple-NPC planning is outside this phase; an input naming several distinct NPCs asks which one to look up first. Strip only recognized grammar, not arbitrary words from a name.
- Intercept only a recognized NPC name/ID or explicit NPC keyword. Ordinary profession-material, item, bank, landmark and geography questions retain their existing planning/general path; the NPC resolver must not hijack them. Known travel endpoints alone remain travel/general geography rather than an NPC lookup. `Where should I level?`, generic quest-route planning, and ordinary character questions remain AI. Safety/scope refusal continues to run first. An explicit unknown NPC yields a safe local unknown/unavailable answer. A plain unknown named-entity question such as `Where is Zorblax?` can ask `Do you mean an NPC? Give its exact name or NPC ID.` locally; this clarification must not invent an NPC or coordinates. Recognized NPC location intent never falls through to AI.
- `lookupNpcLocations(intent, {profile, shareProfile, currentIndex, historicalPack, reportedLocation})` returns a bounded DTO/text result and has no side effects. Renderer never supplies coordinates, evidence, URLs or build qualification.
- Matching order: explicit NPC ID; normalized exact full canonical name; then full-token matching of all supplied name tokens (minimum meaningful token length, no fuzzy edit distance). Normalize case, repeated spaces, typographic apostrophes and apostrophe omission so Voljin/Vol'jin work. Compare literal data, never create regex from publisher names. Unique short name Cairne and unique Sylvanas are allowed; ambiguous matches return up to 5 names+IDs, with omitted count. Multiple distinct IDs sharing a name never collapse to one. Never substring-match Cairn inside Cairne or promote Bloodhoof Village to Cairne.
- Resolve identity across evidence tiers by NPC ID, preserving contradictory names as an ambiguity rather than merging arbitrary aliases. For exact ID the ID wins identity, with its qualified reference name. Do not filter all candidates to the city mentioned by the question: that would hide the evidence needed to correct the city premise.
- Tier 1: current `knowledge.index(profile)` only if `index.compatible(profile)` is true; read its already validated `pack.npcs` entries of kind NPC. This is independent of a quest association, because the current defect in `referenceFacts()` requires finding an NPC through a quest first. Direct observation points outrank the historical tier for that ID, with the current build and NPC lastSeen. A current name-only row does not suppress an available older historical point.
- Tier 2: the 70790 NPC compilation, always status `historical-reference` in this feature. No `KnowledgeService.packs` insertion, no `KnowledgeIndex.compatible()` weakening, no new current-build quest/waypoint implications. If profile sharing is off or build unobserved/mismatched, no saved-character-derived tier-1 qualification is available. Historical public facts still answer the question.
- No game-reported quest destination unless the saved validated destination explicitly identifies the queried NPC by ID/kind. Generic quest zone/title/objective destination is insufficient. First implementation may omit this optional third input entirely; the local answer is already useful and the source does not need more joins. Quest 93739's Orgrimmar zone does not place every named objective NPC in Orgrimmar.
- Statuses: `found`, `ambiguous`, `unknown`, `unavailable`; found entities each have `exact-build-observation` or `historical-reference`. Display at most 3 points per entity with a count for additional stored points. Missing/invalid positions remain unknown, never coordinates 0,0. Missing/corrupt historical bundle disables that evidence tier only; current exact evidence may still work. If no trusted data source remains, local `unavailable` answer.
- DTO: `{status, headline, entities:[{id,name,evidenceTier,build,sourceCommit,lastSeen,contributingFiles,positions:[{mapId,mapLabel?,x,y}],additionalPositions}],candidates,omittedCandidates,cautions,sources}`. Use a static source identifier for any future source action; no renderer-provided external URL opener. This phase can render a non-clickable source citation/details and avoid new IPC actions entirely.

### Main service integration

Modify `src/core/companion-service.cjs` after Task 1 handoff:
1. Keep exact input validation, per-question memory selection and `requests.run` serialization.
2. Prepare the main-owned conversation scope and tentative user report; run `scopeResponse` first.
3. Resolve recognized NPC questions locally before TravelCompanion, model checks, getKey or provider dispatch.
4. On success, require current request signal/context, complete the reviewable memory draft, commit the session with `kind:'npc'`, then return `{text,kind:'npc',npc,conversation}`. Unknown/ambiguous/unavailable are also successful local replies and can be reviewed like any local answer.
5. Successful NPC response retires any previous travel choice so stale travel buttons cannot act on an unrelated current answer. Failed/canceled/concurrent requests must not erase a previously completed valid choice or mutate retained reports. Clear/policy refusal follows existing choices reset semantics.
6. Legacy `ask` still returns `.text`.

Modify `src/main.cjs` to load the validated historical pack once using the existing safe optional-pack failure pattern and inject a pure NPC resolver/reference dependency into CompanionService. No new provider access or IPC surface for NPC search is required: existing `askCompanion` is sufficient. The full NPC bundle never enters a provider prompt.

Modify `src/core/companion-conversation.cjs` to accept `npc` completed-turn kind while preserving existing history budgets (6 turns / 6000 chars within 12000 total), original question preservation, token identity and scope boundaries.

## Current player location: source and lifetime

Use a small `src/core/companion-location.cjs` pure helper, called by the conversation/service rather than renderer. `parseReportedCurrentLocation(originalPrompt)` recognizes only direct first-person current-location assertions/corrections with known bounded place aliases: `I'm in Org`, `I am now in Orgrimmar`, `I'm already in Org`, `No, I'm in Orgrimmar now`, including a following sentence/question. An explicit `not <old place>` correction can follow a positive assertion but is never itself a positive location.

The helper must not extract from selected saved memory, AI replies, prior quoted history, markdown code/quote blocks, third-person statements, hypothetical/future/past/negated statements, `where in Org is Cairne`, or strings such as `the AI said "I'm in Org"`. Do not scan arbitrary quoted spans. Narrow known alias coverage is preferable to broad NLP guessing; the provider policy still honors clear current original user text even where a helper cannot canonicalize it. Two conflicting positive current assertions in one question produce no retained canonical report and a clarification if the answer depends on it.

Retain at most one report in the volatile ConversationSession, tagged to the originating completed user turn and the exact existing owner/shareProfile/sorted memoryIds scope. Stage a report for the current request without mutating retained state; commit it only with a successful response. An aborted/failed/refused prompt must not become the next turn's location. Older reports expire when their original turn leaves the 6-turn history. A direct newer report replaces the older one; no profile/journal mutation, persistence, export or permanent memory promotion occurs.

Existing hard clear boundaries clear the report: active character, provider/model/auth settings, source identity/root/disconnect, follow-game context, import/restore/reset, renderer destruction/navigation and Clear conversation. Sharing/memory selection scope changes clear it. Existing soft navigation and completed-memory-save semantics can retain a report only inside unchanged scope. A normal new saved snapshot does not silently turn the report into live observation; keep provenance distinct and do not blindly override explicit user words with a later file reread. Cancellation discards the staged report while preserving the prior committed report just as completed history is preserved.

For AI character context when sharing is on, use one stable allowlisted representation: `location` is the effective planning location; `locationSource` is `user-report` or `saved-snapshot`; `savedLocation` preserves old validated saved location when a user report is overriding it; `snapshotUpdatedAt` retains the real save stamp. An overriding city-only report contains a zone only: never copy old mine mapId/x/y/subZone beneath the new city. `reportedLocation` carries only canonical zone/source, with no invented coordinates/timestamp/live flag. User report supplies player planning context only, never NPC presence, quest eligibility or game verification.

When sharing is off, `profileContext` remains empty and Claude receives no profile object. A location explicitly typed in the current question is part of the question and may be used; scope-owned prior report may support local answers in that same sharing-off scope, but no additional character profile payload is sent. The existing bounded recent user text and shared policy cover provider follow-ups. Toggling sharing cannot carry reports across the boundary.

## Shared policy and preview parity

Update `src/core/wow-policy.cjs` once for all seven transport combinations: original current user first-person assertions/corrections about current location take precedence over older saved location and historical conversation for planning, with explicit user-report attribution. Do not treat an NPC question's city premise as either player location or verified NPC city. If only a saved location exists, say `your saved snapshot places you ...`, never `you are ...` or infer online status. NPC coordinates require supplied qualified local facts; no absent-fact model recall. Use per-NPC lastSeen for NPC observation dates and collection range only for the file.

`providers.approvedProfile` must validate and preserve the new location fields on a second pass. Claude subscription calls `approvedProfile(context)` again, so adding fields only to the first call silently discards them. Keep a single public projection/validator used by preview, API providers, OpenAI subscription and Claude subscription; test serialized parity and unchanged total context cap. Do not pass arbitrary `options` or client fields into approved context.

The existing `knowledge-ipc.cjs` contextPreview has 2-3 arguments and no session awareness. Extend it compatibly to a fourth optional `memoryIds=[]`, and inject a pure `getLocationContext`/service preview callback so preview uses exactly the same owner+sharing+memory scope and current original draft report as send. This callback must not prepare/commit a conversation, clear it, advance generation or mutate memory. It should ignore a retained report if the preview's scope would reset on send. Validate the extra argument array length, uniqueness and UUID shape, and use only selected IDs (not memory text) for scope identity.

Renderer: add a read-only `Memory.selectedIds()` and provide it plus `ready:()=>companionReady` to QuestGuide preview. Include those IDs in the preview request/cache key; invalidate/re-request preview on memory selection, share choice, completed reply, clear and location report changes. Await pending conversation-clear readiness before a preview reads retained state. Preserve the current draft, focus/caret, disclosure state and action-generation checks from Task 1. Existing preview still returns null when sharing is off. Do not sneak session context into a preview that claims no character context is shared.

## Interface: same conversation, one clear answer

No new dashboard, setup step or provider requirement. Update existing companion copy to say local NPC locations and travel need no model. NPC replies get `Forever NPC reference · local` heading, never `Companion · AI suggestion`. Use the existing safe formatted reply renderer for main-owned human-readable answer text and qualifications. A distinct local NPC badge and updated copy are sufficient. Do not create a new map, waypoint action, renderer module, dashboard or UI state system for this phase. Escape all names/source labels; never inject publisher HTML or turn coordinates into executable commands.

Expected answer for the original query:
`The reference I have for Cairne Bloodhoof is in Thunder Bluff, around 59.9, 51.7 (Map 1456). I don't have a verified Orgrimmar location for him.`
Then a short source line: `Older Forever build 1.60.1.70790 · last observed November 5, 2026 · approximate interaction point; not a live location.`

When the user explicitly adds `I'm already in Org`, acknowledge `You're in Orgrimmar, as you reported` only if useful; never send him to Org or assert BoulderLodeMine as current. Do not claim Cairne cannot exist in Org now: the source establishes a historical Thunder Bluff observation and a missing verified Org point, not universal absence.

Ambiguity: `Which Valennia Stormfist do you mean?` followed by up to 5 names/IDs/qualified map labels. A reply with exact `NPC #<id>` is supported by normal parsing. List the IDs in safe formatted text; no new suggestion-button state is necessary. Unknown: `I don't have a verified location for <name> in this local reference. Check the exact NPC name or ID.` Unavailable: say local reference is unavailable and preserve the question for retry.

Audit existing voice behavior without changing the audio implementation: `Voice.answer()` reads latest assistant text and should work for NPC text. Memory's copy about local travel must include local NPC lookup. Cost copy must make zero-provider NPC behavior clear. Context preview remains character/public source context rather than implying a local answer was transmitted. No new manual waypoint or journey action for NPC observations in this phase.

## Implementation sequence and proof requirements

The parent records this spec and the implementation plan, then explicitly releases source/GUI ownership after the independent Task 1 review. These steps define implementation and verification requirements; their evidence is recorded separately.

1. Write failing source/compiler tests for immutable hash/metadata/license, full 616/758 coverage, excluded text, deterministic output, invalid keys/IDs/coords/dates/size limits, corruption and offline check. Implement minimal modules and compiler, then compile the pinned source. Retain downloaded raw source only in ignored work, not the tracked bundle.
2. Write failing pure query/evidence tests: Cairne full/short/ID, Voljin apostrophe variants, names with publisher punctuation, known city exclusions, unknown NPC, duplicate exact names, multi-name clarification without implementing a multi-NPC feature, profession/material/item/bank/geography non-interception, plain unknown-entity clarification, missing points, all tiers unavailable, current exact point overrides historical, current name-only falls back historical, manual/mismatched/sharing-off cannot claim exact build, historical collection date is not lastSeen, contradictory city question does not hide the historical point.
3. Write failing conversation/location/provider tests: original current first-person correction overrides mine save; question `where in Org is Cairne` does not; quotes/code/AI/history/saved-memory/future/past/hypothetical/negative do not; six-turn expiry; new report after cancellation/failure cannot stick; exact context budget; source/build/character/provider/sharing/memory boundaries. Test all seven transports including the Claude double-allowlist path. Private notes/goals/source IDs/account/path/key canaries remain absent.
4. Write failing CompanionService tests for no model/key/getKey/transport calls on found/ambiguous/unknown/unavailable NPC answers, main-owned memory draft/session behavior, legacy text, refusal precedence, repeated queries, unrelated AI history, travel-choice retirement, concurrency/late reply/stop/clear. Validate preview purity and exact scope/send parity including memory selection during pending clear.
5. Implement minimal integration and focused renderer changes after ownership handoff. Verify readable headings, source qualification, escaped markup, no phantom coordinates, correct cost/model hint, accessible status/choices and no new screen. Add focused renderer checks rather than re-testing every static string.
6. Native app smoke uses an isolated fixture user-data directory and synthetic saved character at BoulderLodeMine. Ask `where in org is Cairne Bloodhoof` with no model/key and with sharing off; capture real rendered local badge/Thunder Bluff point/lastSeen/historical build/no-provider evidence. Then `I'm already in Org. Where is Cairne?`; inspect preview/report distinction and a subsequent non-NPC AI request with stub transport to prove context precedence. No access to the user's real profile or game process. Exercise ambiguity, unknown, disabled/corrupt historical data fallback, repeated questions, scope changes and Task 1 focus/rapid-action regressions. Stop optional speech; do not access real audio/game to prove a text feature.
7. Run focused tests, new offline bundle check, full existing CI and native fixture checks. Full release/install/updater publication proof remains the parent's later release step; do not call local tests release completion.

Proposed exact verification commands once files exist:

```powershell
node scripts/build-forever-npc-locations.cjs --check
node --test --test-concurrency=1 tests/npc-location-data.test.cjs tests/npc-location-compiler.test.cjs tests/npc-location.test.cjs tests/companion-location.test.cjs tests/companion-service.test.cjs tests/companion-conversation.test.cjs tests/wow-policy.test.cjs tests/knowledge-ipc.test.cjs tests/core.test.cjs tests/claude.test.cjs
node scripts/npc-companion-smoke.cjs
npm test
npm run test:conversation
npm run test:companion-recovery
npm run test:travel-companion
```

## Source boundaries after explicit handoff

New files: npc-location-sources/data/resolver and companion-location core modules; historical bundle/compiler/tests; native smoke fixture. Use the existing safe reply renderer; no new NPC renderer or state module is needed. Existing files likely changed: companion-service/conversation, providers, wow-policy, knowledge-ipc, main, preload (only contextPreview argument forwarding), app (reply kind/copy/preview refresh), quest-guide and memory (scope-aware preview/copy), package scripts/CI offline check, companion/privacy/third-party documentation. Do not change addon, terrain, travel graph, journal schema, provider auth, audio internals or version except a separately justified integration requirement reviewed by parent.

## Remaining risks and resolved choices

- Historical points are not verified live spawn locations; every point retains build/date/source qualification. Current exact-build observations are also approximate historical observations, not current game telemetry.
- Full 616 NPC slice is accepted; output is bounded and approximately 80 KiB before envelope. No need to join broader creatures/trainers/quest prose.
- Narrow first-person canonical reporting avoids treating city premises and quoted AI nonsense as player facts. Unsupported location phrasing still receives shared-policy handling in AI but is not silently persisted as canonical context.
- Preview/send parity and Claude's second allowlist are material correctness gates, not cosmetic work.
- Safe unavailable answers are essential; a failed optional data load must not fall back to an unqualified model NPC location.
- This proposal contains no source implementation and makes no runtime, GUI, live-game or release-success claim.

## Final combined 0.13.5 release-note integration after handoff

Task 1 already owns the 0.13.5 metadata. Once implementation is authorized, rewrite the final 0.13.5 notes and changelog around the combined UI-timing plus local NPC/location-context scope. Remove any Task-1-only claim that the reference is unchanged: the existing quest reference remains separately pinned, while this release adds a distinct historical NPC reference. Preserve truthful historical release notes and do not claim live desktop NPC coverage, verified current spawns, or release completion before the parent's later publication proof. No metadata change is made during this design-only preparation.



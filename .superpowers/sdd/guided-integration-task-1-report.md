# Guided grounded integration task 1 report

Prepared before the scoped implementation commit. Base: 29df0c01c464e4d3d3fcf3c71d611b8ce121c423. Branch: codex/pre-1.0-product-polish. Sole implementation and synthetic Electron GUI owner; no additional agents spawned.

## Completed scope

- [x] Read the complete binding integration design/plan, umbrella, task brief, approved travel/conversation reports and required TDD/frontend instructions.
- [x] Local travel enters the existing admitted CompanionService request after scope refusal and before provider/model/auth dispatch. Legacy and structured endpoints share the same original question, memory and conversation pipeline.
- [x] Main-owned USER-only trip continuation, missing origin/destination/faction handling, matching-build qualification, privacy whitelist, typed trusted DTO and current opaque choice ownership.
- [x] Atomic manual Company journey creation/reuse, exact request keys, fixed-ID source opener and main-owned qualified-text copy.
- [x] Safe focused reply formatting, route options/unknowns/evidence, local badge, original art/fonts, no-model local submission, conservative current state painting and readable chat positioning.
- [x] RED/GREEN, actual isolated Electron fixture, serial affected gates, visual inspection, docs, serial package/CI/release alias and this precommit report.

The later five-section shell is not implemented here. Source display version remains 0.12.3 and 1.0 remains held. No dependency, provider transport framing, native game protocol, resource pack, original artwork or publication changes. No actual player files, game input, accounts, audio, paid inference, browser source launch, user clipboard writes, installer, OS settings or watcher jobs were used. New fixture external surfaces are replaced before source main bootstrap; fake clipboard and shell writers are injected. Updates/reference automatic fetching are disabled in the synthetic profile and fixture startup. Temporary cleanup verifies the real temporary parent and fixture prefix.

## Interfaces and ownership

`CompanionService` adds optional injected `travel`. Its local branch is inside the existing `requests.run`, after scope filtering, before model/key/context/provider dispatch. `ConversationSession.commit` explicitly accepts main-produced `ai` or `travel`. Renderer input cannot supply a response kind/history/action. Ordinary AI still requires its selected model and retains all seven existing transports and native CLI settlement behavior.

Structured result: `{text, kind:'travel', conversation, travel:{status,headline,origin,destination,options,cautions,claims,sources,coverage,choiceToken}}`. Full qualified `.text` remains available to legacy callers, completed history, reviewed memory and copy. Claims come from validated reference negatives; options and provenance come from the existing planner. No private owner keys are returned. The local profile whitelist is faction, clientBuild, location fields and source kind/updatedAt only; share-off supplies no profile. A trip-only reported faction cannot borrow an observed source/build and remains labelled user-reported.

`TravelCompanion` in `src/core/travel-companion.cjs` provides resolve/commit staging plus three exact trusted main actions:

- `createTravelPlan({profileId,token,optionId})` -> `{state,journeyId,reused}`. Exact one argument/three keys. The option title/steps are retained in main. Existing `applyJourneyAction` builds the entire manual plan off-store, then one `saveState` commits; 20-plan/50-step validation or write failure commits nothing. Actual identical manual plans are reused, including their manual completion state; no quest/observed/game-action fields are introduced.
- `openTravelSource(sourceId)` -> `{opened:true}`. Exactly one ID from the deeply frozen static source registry; no caller URL, token or model authority.
- `copyTravelGuidance(token)` -> `{copied:true}`. Exactly one current opaque route token. Main copies only retained fully qualified text using an injected clipboard writer. No renderer text or browser clipboard permission is accepted. Non-actionable local replies expose selectable full guidance.

Completed choices and pending trips use hard reset retirement plus relevant owner/provider/source/profile/reference fingerprints, not raw CompanionContext.generation. Normal renderer-context navigation and memory-save retain completed choices. Stop retires choice/pending even for a completed-but-held review, while prior completed conversation can remain. Source location/build/identity changes reject old actions; changed saved origin cannot silently retarget a trip continuation. Scope changes retire choices inside request admission. Rejected concurrency cannot mutate them; failed ordinary requests do not replace successful choices or pending USER intent. Successful unrelated AI requests retire the trip.

The renderer guards asynchronous plan-save results with existing mutation epoch, chat generation and active profile. An already committed but held old response cannot restore an earlier character or disturb the newer text/caret. New chat messages are positioned at their start; unchanged paints and ordinary navigation preserve internal scroll. Local/AI badges remain distinct; memory review uses neutral response wording and remains untrusted memory.

## Exact RED/GREEN evidence

1. `node --test tests/travel-companion.test.cjs`: initial RED 0/9, local reply expected but ordinary AI returned, model gate absent, trusted actions absent. Minimal pipeline/owner implementation GREEN 9/9.
2. Pending/report regressions: RED 10/12 (report-only faction was lost on short follow-up; an unrelated short pet question was absorbed as an endpoint), then GREEN 12/12. Explicit starting city with sharing off: RED 12/13, then GREEN 13/13. Tests ensure only recognized short place answers complete a pending trip.
3. `node --test tests/companion-reply.test.cjs`: RED 0/2 missing focused renderer; GREEN 2/2. Real browser DOM checks later confirm no script/image/SVG/model anchor/button execution while paragraphs/lists/bold/code render.
4. `node scripts/travel-companion-smoke.cjs` before main/UI integration: RED timeout awaiting trusted route result under existing early model gate. GREEN after routing/card integration. Subsequent meaningful UI REDs found generic sanitization hiding the no-model setup message, a late plan save restoring Alpha after Beta was selected, and a long route scrolled directly to its cautions. Each has an actual UI regression and minimal fix; original nodes/caret/held controls remain checked. A final actual-UI RED also showed expanded evidence closing during a background paint; a volatile WeakMap keyed by the current travel DTO preserves that disclosure and its exact internal scroll, followed by Electron GREEN.
5. Failed-request staging regression: RED 15/16 (failed ordinary AI retired a valid choice), then GREEN 16/16 after staging all travel changes until successful commit. Capacity/step-overflow and source-fingerprint refusals preserve complete original state.
6. Generic quest-route classification: original memory-backend fixture failed because `Explain the quest route` was classified as city travel. A temporary test phrase migration was reversed after parent review. Pure and shared-service RED rerun: `node --test --test-name-pattern='generic quest' tests/travel.test.cjs tests/travel-companion.test.cjs` -> 0/2, expected null/AI but got clarification/travel. The narrow pure guard preserves explicit modes, geographic endpoints and unknown explicit travel destinations. `node --test --test-concurrency=1 tests/travel.test.cjs tests/travel-companion.test.cjs tests/companion-reply.test.cjs` -> 47/47 at that stage. Original memory-backend fixture then passed unchanged, all seven transports.
7. Main copy: focused unit RED 0/1 and actual Electron bridge RED (undefined method), then GREEN with injected main clipboard, trusted sender/exact arity/forged/stale rejection. No system clipboard content was replaced.
8. Saved-origin continuation: focused RED 0/1 (new saved location silently retargeted a prior trip); current-trip fingerprint gating and retained parsed endpoints fixed it.

Final registered focused command:

```powershell
npm run test:travel-companion
```

Final result: **21/21 unit checks passed** (19 travel integration + 2 formatting), followed serially by **actual Electron PASS**. Final parser change has the earlier 28/28 parser receipt within the 47-test gate; subsequent additions only changed integration/copy/fixture behavior. All focused commands report zero failures/skips/cancellations at final GREEN.

Affected unit gate, before the final narrowly covered parser/copy/source-follow-up additions:

```powershell
node --test --test-concurrency=1 tests/travel-companion.test.cjs tests/companion-reply.test.cjs tests/companion-conversation.test.cjs tests/companion-service.test.cjs tests/companion-request.test.cjs tests/memory.test.cjs tests/renderer-updates.test.cjs tests/renderer-interaction.test.cjs tests/wow-policy.test.cjs tests/game-sync-memory.test.cjs tests/memory-ipc.test.cjs tests/knowledge-integration.test.cjs
```

Result: **122/122 passed**, no failures/skips. Later changes were checked only by their focused covering tests, per parent instruction; the parent owns final whole-series validation.

Actual Electron gates ran strictly serially:

- `node scripts/travel-companion-smoke.cjs`: PASS; exact original Org/TB + correction use zero inference/key calls after bootstrap; conditional flight and road/negative, USER follow-ups, share-off faction, unconfigured ordinary AI error, generic quest route fake-AI dispatch, safe DOM, fixed source opening, synthetic main clipboard, save/reuse, navigation/memory save versus hard boundaries, actual identical-ID checkpoint restore/import, exact arity/trusted sender, held physical Save, late save/character/caret, 984x635 zero horizontal overflow, reduced motion, automatic first-option visibility and preserved internal scroll. Provider setup/bootstrap can independently inspect credentials; counters are reset before the actual local question pair.
- `node scripts/conversation-smoke.cjs`: PASS; its original deliberate provider question is now the equivalent nontravel hunter-pet question plus exact Forever correction. All outgoing-history/privacy/whitespace/memory/Clear/Stop/retry/late/physical Enter/Shift+Enter/IME/real restore/import/reset assertions remain. The exact former Org/TB trip is covered by the new local fixture.
- `node scripts/companion-recovery-smoke.cjs`: PASS unchanged, including original physically held Send, completed-but-held review Stop, stale successes/errors and native ownership.
- `node scripts/memory-backend-smoke.cjs`: final PASS with the original `Explain the quest route` phrase restored. All seven fake routes, exact preview/send, main drafts, source prep, private canaries, restart/import/prune/reset and trusted arity remain.
- `node scripts/voice-memory-smoke.cjs`: PASS unchanged, original physical pointer/key holds, exact typed node/range, readiness and acknowledgement races, dictation insertion, explicit send/save/select/preview/read/Stop; fake audio workers only.

A fixture-only newline escaping mistake caused one generated-main launch error while making the fake Markdown reply multiline. It was corrected using JSON serialization; no runtime behavior was changed to hide it. Final actual DOM capture includes real multiline bold/list rendering.

## Visual and exported evidence

Current synthetic captures under `.superpowers/sdd/travel-companion-captures/`:

- `travel-full.png` — source look/fonts/art preserved, local route badge, headline, primary option and concise mandatory unknowns.
- `travel-984x635.png` — compact route, editable draft/range and original controls; no horizontal overflow.
- `travel-sources.png`, `travel-observation-source.png` — expanded dated general and exact-build evidence views; source scopes remain separate, no publisher/confidence count claim.
- `manual-plan.png` — flight/road plans in existing Company, every step explicitly manual.
- `safe-reply.png` — actual bold/list text; raw HTML and dangerous Markdown URL remain inert displayed text.
- `synthetic-evidence.json` — trusted route DTO, exact IPC rejection checks and synthetic outgoing ordinary AI prompts/context only.

Full/compact/source/manual/safe reply captures were visually inspected. No historical sealed bundle was altered. Capture directories remain ignored local review evidence; report and source are in the scoped commit.

## Preservation and limits

`git diff --exit-code 29df0c01c464e4d3d3fcf3c71d611b8ce121c423 -- data addon assets` passed. Travel pack remains 12,514 bytes with SHA256 `6c9f49c58cad59056243fa4f8ffdab3a034504735143601f58b22c90127a6dbe`; all 16 transport edges and original native/resources are untouched. No recompile or coverage expansion occurred.

Syntax checks passed for changed core/main/preload/renderer/fixture JavaScript. `git diff --check` passed; only existing CRLF normalization notices appeared. Existing model/transport tests preserve the seven-route request framing and 6-pair/6000-history/12000-total conversation limits.

This is a bounded dated reference, not a live route, unlock, cost, time, safety or game-action authority. Real account/provider quality, actual audio, player acceptance, packaging and release are not claimed. Full suite/package/publication deliberately remain parent-owned. The existing long scrollable voice/memory panels and internal Company destination remain until the later shell task. Independent SPEC/QUALITY review is required before that task. GUI ownership is released only with the final scoped commit SHA handoff.

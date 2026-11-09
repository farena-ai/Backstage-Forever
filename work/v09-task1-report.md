# Adventure Director 0.9 Task 1 implementation handoff

Implemented only the pure Director, atomic session helper, trusted IPC/preload/main integration, brief/guidance additions, focused unit tests and an actual synthetic source-Electron backend fixture. No renderer, native addon, version, data, provider, credential or release edits.

## Contracts and public model

`src/core/director.cjs` exports exactly:

- `buildDirector(profile, guidance)` produces a detached pure local projection.
- `createDirectorSession(state, profileId, options, { knowledge, now, id } = {})` returns `{ state, journeyId, created }` synchronously.

Director model:

```text
{
  version: 1,
  status: "ready" | "empty" | "unavailable",
  headline,
  character: { id, name, realm, className, level, race, faction, location },
  freshness: existing guidance freshness object | null,
  choices: [0..3 existing guidance cards + { priority, sourceKind, distance, reason }],
  primary: choices[0] | null,
  alternatives: choices.slice(1),
  preparation: { kind: "bag-space", bags: {free,total}, message } | null,
  privateGoals: [0..3 {id,text} pending local goals],
  session: { available, maxChoices: choices.length },
  limitations: [...existing guidance limitations, geometry/unknown identity/privacy facts]
}
```

`character` is an explicit public identity whitelist; unknown optional identity/location fields are null. Source identity and private notes are absent. `sourceKind` is `game-snapshot`, `reference`, or `reference-clue`. The original card's `source`, actual `destination`, `referenceDestination`, objective, phase kind and qualified knowledge fields are preserved. Actual current-game destinations always take precedence when evaluating reference positions. Mention-only NPC references never become destinations or proximity facts. `distance` is normalized same-map straight-line geometry or null; it does not reorder the documented level/ID ties and must never be presented as route, yards or travel time.

Ranking is ready turn-in, current game same-map/observed same-zone unfinished work, compatible same-map reference position, reported quest-level proximity, numeric ID. The bounded full actionable candidate set is ranked before the three-choice cap. Existing balanced/nearby/turn-ins filtering remains owned by guidance. Bag preparation appears only for saved addon bags with a positive total and fewer than five free slots, matching the existing native threshold. Pending private goal text is for local display only.

`session.available` indicates that the supplied profile has actionable saved addon guidance, source identity, build and saved time. It does not authorize a different active character: main checks the latest active selection when starting. `maxChoices` is the available choice count; actual minute caps are 15→1, 30→2, 60→3.

`src/core/guidance.cjs` gained one narrow authorized carrier: `guidance.candidates` contains all <=25 actionable validated enriched cards. The existing enrichment and phase/source qualification path runs once; `guidance.steps` remains the original 3/5/8 display slice and all old fields/counts remain unchanged. This avoids copying quest enrichment/evidence logic or capping before Director ranking. `buildDirector` retains a fallback to `guidance.steps` for a previously constructed guidance object.

`buildBrief`/`adventureBrief` now attach `.director` alongside unchanged `.guidance`. `guidancePlan` attaches `.director` alongside every old guidance field and the bounded candidate carrier.

## Atomicity, reuse and trust

The new preload method is `window.backstage.startDirectorSession(profileId, options)`. Extra arguments are forwarded to main and rejected, rather than silently discarded. The main registration uses the existing `handle` wrapper, inheriting trusted sender/main-frame/exact-file-URL checks, reset rejection and sanitized errors. The dedicated handler enforces exactly two arguments and the existing strict `validateGuidanceOptions` contract. Options only accept `minutes` and `focus`; renderer quest IDs, source proof and extra fields are rejected.

The handler synchronously reads the latest saved state and invokes the pure helper; it saves exactly once only for a new complete session, then returns a detached clone of the actual latest saved state with `journeyId` and `created`. Reuse has no write. There are no awaits between lookup, action creation and save. Ordinary save protection continues to belong to `mergeOrdinaryState`; this change never lets renderer state replace journeys.

The pure helper validates state/options and explicitly compares the original active selection, so validation's existing populated-null-selection repair cannot authorize a stale/null selection. It requires a saved addon profile with known source/build/time and actionable log. It uses `applyJourneyAction` exclusively for journey creation, IDs and every quest baseline/proof field. A temporary detached empty journey list and bounded private IDs ask that existing owner to construct comparison baselines without allocating real IDs or consuming the 20-journey capacity. Existing plans are scanned within validated 20x50 bounds for the exact selected tracked-quest set and exact profile/source hash/build/baseline time/completed membership/latest turn-in fields. Titles and additional manual notes do not defeat reuse; additional tracked quests do. A new session then uses the same existing action owner against the full detached state. Failure at any point cannot mutate the input or save a partial journey.

Private goal and note text never enters session steps or provider contexts. No provider protocol/context code changed and refreshing/building plans never calls inference.

## TDD evidence and corrections

1. Wrote pure tests before adding `director.cjs`. `node --test tests/director.test.cjs` initially failed with `MODULE_NOT_FOUND` for the not-yet-existing feature module. Added production implementation; fixture's knowledge stub first lacked the existing required `followUps()` method, corrected the stub, then all 8 initial pure tests passed. The feature-module absence is recorded honestly as an initial load failure, not an assertion-level RED.
2. Wrote IPC/integration tests before adding `director-ipc.cjs`/main/preload integration. `node --test tests/director-ipc.test.cjs` initially failed `MODULE_NOT_FOUND` for the missing integration module. After implementation, pure+IPC+existing guidance passed 18/18.
3. Parent clarified all-candidate ranking. Added regression with 25 quests and candidate 25 carrying a compatible same-map reference. `node --test tests/director.test.cjs` failed with `1 !== 25` under the old display-slice implementation. Added the single shared `guidance.candidates` enrichment carrier and ranked it before capping. The regression passed for all three minute options, visible guidance limits stayed 3/5/8, and actual session choice matched Director.
4. Added manual-note reuse regression; it failed with the injected `identical tracked selection must reuse` error when old total-step count forced allocation. Reuse now compares exactly the tracked-quest set while retaining manual notes. Extra tracked quests still require a new session.
5. Self-review added explicit documented tie-break regression: near level-40 quest and farther level-12 quests. RED was actual `[1,3,2]`, expected `[2,3,1]`. Removed the unsolicited geometry tie-break; level proximity then numeric ID now follows the spec precisely. This new change justified rerunning the full suite after the earlier 339/339 pass.
6. Actual Electron fixture initially reported a null primary because its synthetic raw saved location omitted required `subZone`. Added `subZone` to the fixture, without changing production parsing. Final normal and genuine short-path fixtures pass.

## Verification commands and results

Run from the repository root. Exact focused final command:

```powershell
node --test tests/director.test.cjs tests/director-ipc.test.cjs tests/guidance.test.cjs tests/company-ipc.test.cjs tests/adventure.test.cjs tests/knowledge-integration.test.cjs
```

Result: **32/32 PASS**, including 15 new pure/IPC Director tests. Existing adventure/knowledge provider-payload tests assert approved public context and omission of private journals/history across transports.

```powershell
node scripts/director-backend-smoke.cjs
node scripts/director-backend-smoke.cjs --short-path
```

Final outputs:

```text
Director backend source Electron normal: strict trusted IPC, latest saved baselines, renamed reuse, stale ordinary save, selection, privacy, import/restart/reset, no inference/launch PASS
Director backend source Electron genuine 8.3: strict trusted IPC, latest saved baselines, renamed reuse, stale ordinary save, selection, privacy, import/restart/reset, no inference/launch PASS
```

The Windows short-path fixture calls the real `GetShortPathName` API, requires distinct `~n` aliases, and checks filesystem identity; it never silently treats a normal path as a short-path pass. Each fixture uses canonical OS-temporary paths, bounded deadlines and cleanup restricted to its verified direct temp child. Tests drive the actual packaged-source main and preload in Electron. They cover unavailable/manual rejection, all trusted checks, current GameSync baselines after newer saves, session count/selection, renamed reuse, ordinary stale saves, explicit follow-off, provider-context privacy, actual persisted-session restart reuse, deliberate import replacement, pending-reset rejection and zero inference/launch counters before and after restarts. They fake runtime/status/dialog/provider dependencies only inside the launched fixture process; no production bypass was added.

```powershell
node scripts/command-center-smoke.cjs
node scripts/company-backend-smoke.cjs
```

Results:

```text
PASS: automatic source-backed plans, session/focus autosave, character isolation, restart persistence, explicit AI draft without inference, compact/reduced-motion layout and import replanning. Synthetic profiles only.
Company backend source Electron normal: trusted IPC, templates, GameSync completion/pruning, private journals, stale saves, selection, backup/restart/reset PASS
```

These existing affected flows were selected because brief/guidance now carry Director and Director creates Company journeys. Company backend also verifies private public-context boundaries and durable completion proof. Renderer markup/lifecycle was not modified in this task.

Final whole-unit command, with the complete local log retained:

```powershell
npm test *> work/v09-task1-unit-final.log; $result = $LASTEXITCODE; Get-Content work/v09-task1-unit-final.log | Select-Object -Last 10; exit $result
```

Final result: **340/340 PASS**, 0 fail, 0 skipped, 0 cancelled. The earlier whole suite passed 339/339 before the final tie-break regression/fix; it was repeated only because that self-review produced a behavior change. `git diff --check` passed.

Other focused intermediate commands were `node --test tests/director.test.cjs`, `node --test tests/director-ipc.test.cjs`, and `node --test tests/director.test.cjs tests/director-ipc.test.cjs tests/guidance.test.cjs`. An intermediate command also named nonexistent `tests/ai-privacy.test.cjs`; Node ran the real matching tests and its 23-test result was not counted as independent privacy coverage. The final 32-test focused command above names the actual privacy-owning tests explicitly.

## Self-review and limits

Checked source ownership, active selection versus normalization, exact argument/option rejection, lookup bounds, cap-after-ranking, source/phase precedence, level/ID ties, unknown versus observed-empty behavior, title/manual-note-independent reuse, all baseline fields, no ID consumption on reuse, full-cap/failing-ID atomicity, detached outputs, latest-store return, reset/import replacement, ordinary-save preservation and private text locality. No alternative baselines or reconciliation were introduced.

Additional guidance carrier was explicitly authorized by the parent's all-candidate clarification. All other modified files match Task 1 ownership. No tests or actions touched actual player folders, actual user data, credentials, paid inference, microphone, installer execution, game launch or gameplay. Synthetic client preparation only copied managed files into temporary fixture directories. Read-only actual Electron application launch is the source test harness, not game launch.

Renderer presentation, pending UI duplicate guards, queue/epoch integration and native ranking remain later tasks. Real-client API behavior and owner acceptance remain deferred. This task makes no graphical/native/real-player acceptance claim. Independent Task 1 review is owned by the parent before Task 2; implementation stops after this commit.

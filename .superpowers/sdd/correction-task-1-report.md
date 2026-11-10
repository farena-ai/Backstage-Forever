# Correction task 1 report — cancellable AI and question recovery

Status: complete; ready for independent spec and quality review. Scope is correction Task 1 only. Base: `1bd75d5049bbdf127bd45105deb5adcd15206d15`, branch `codex/pre-1.0-product-polish`.

## Changes

- Added main-owned `CompanionRequest` identity/controller lifecycle. Stop and CompanionContext invalidation reject the current reply immediately. Late transport fulfillment/rejection cannot complete memory or release a newer request's ownership.
- Added trusted, zero-argument `cancelAsk` preload/main route. The renderer supplies no abort signal, endpoint, or request identifier. Existing ask result remains a string; existing safe error handling is preserved.
- API fetch and ChatGPT streaming combine external abort with existing timeouts. ChatGPT checks cancellation around token acquisition without changing token/authentication protocols. Claude propagates cancellation through subscription-status and inference workers while preserving isolation and argument/environment restrictions.
- Claude retains request ownership and its working directory until worker completion. Native kill exceptions no longer falsely settle a live worker; errors from a process with a PID also require close. No overlapping work is allowed while termination is unconfirmed.
- Added Stop response, a persistent stopped/error message, and explicit Edit question. The transcript remains after Stop/error. Edit preserves newer drafts and current sharing choices and never automatically resends or restores earlier memory choices. Obsolete finally blocks no longer repaint the current companion controls.
- Documented cancellation boundaries in `docs/PROVIDERS.md`.

## Files

- `src/core/companion-request.cjs`
- `src/core/providers.cjs`
- `src/core/chatgpt.cjs`
- `src/core/claude.cjs`
- `src/main.cjs`
- `src/preload.cjs`
- `src/renderer/app.js`
- `tests/companion-request.test.cjs`
- `tests/chatgpt.test.cjs`
- `tests/claude.test.cjs`
- `scripts/companion-recovery-smoke.cjs`
- `docs/PROVIDERS.md`
- `.superpowers/sdd/correction-task-1-report.md`

Parent-owned `docs/PRODUCT-READINESS.md` is excluded.

## RED evidence

1. `node --test --test-concurrency=1 tests/companion-request.test.cjs`: initial absent-module harness failure was corrected to a minimal scaffold. Behavioral RED then failed the Stop assertion (`false !== true`); the pre-cancellation hung promise also kept the runner alive. That specific fixture runner was terminated, and the tests now have explicit 2-second bounds. The implementation then passed all four lifecycle/body tests.
2. `node --test --test-concurrency=1 --test-name-pattern='external|ownership when kill' tests/chatgpt.test.cjs tests/claude.test.cjs`: three expected failures before adapter changes. ChatGPT body signal and Claude status signal did not abort (`false !== true`); kill exception incorrectly settled the native runner (`true !== false`).
3. `node scripts/companion-recovery-smoke.cjs`: actual Electron RED before renderer implementation: `Waiting requires a visible Stop response action`, expected 1, actual 0. Main/preload and synthetic backend were already wired. The completed fixture passes the recovery behavior and stale-completion checks.

One fixture harness defect (Electron evaluate receives Electron as its first argument) was corrected during GREEN; this was not a product defect.

## GREEN verification

All Electron fixtures ran serially against separate temporary synthetic app data. No live sign-in, paid request, audio capture/playback, real player-file access, game control, installer, dependency change, release, settings change, or scheduled watcher was used.

- `node --test --test-concurrency=1 tests/companion-request.test.cjs tests/chatgpt.test.cjs tests/claude.test.cjs tests/core.test.cjs tests/memory.test.cjs tests/memory-ipc.test.cjs` — **59 passed**. Covers route/auth payload regressions, timeout/abort propagation through stalled body reads, stale success/error, double Stop, second-request ownership, unconfirmed CLI lock, real synthetic Node child termination, private directory retention, context/memory ownership and safe errors.
- `node --test --test-concurrency=1 tests/companion-request.test.cjs` — **4 passed** after adding timeout bounds to the initially hung RED fixture.
- `node scripts/companion-recovery-smoke.cjs` — **PASS**. Actual main/preload/renderer: Stop then new request, old success/error rejection, no cancelled-memory draft, navigation/provider/character invalidation, Stop/error editing via keyboard, newer draft protection, changed sharing choice preserved, trusted origin/arity, and original question node remains connected with exact focus/caret after late completion.
- `node scripts/memory-backend-smoke.cjs` — **PASS**. Existing normal-path actual Electron regression: seven fake provider routes, exact memory preview/send, stale responses, privacy, save/restart/import/prune/reset and context invalidation.
- `node scripts/voice-memory-smoke.cjs` — **PASS**. Existing actual Electron physical pointer/key lifecycle regression with fake audio workers: held original controls, text/range/focus, continued typing, delayed readiness/acknowledgement, navigation/character/blur races, memory review and no accidental send.
- `git diff --check` — **PASS** (repository line-ending conversion notices only).

## Self-review and limits

- Confirmed only the matching request's finally releases ownership. A fake transport that ignores abort cannot emit a result or overwrite newer memory.
- Confirmed the native worker branch deliberately keeps the ownership lock on unconfirmed termination. The user receives a stopping message if another question is attempted. Stop can return the UI to editing even while that safety lock remains.
- Existing routes, models, credential storage, provider token flows, scope refusal, sanitizer, and manual sharing/memory review boundaries remain intact.
- Native termination validation uses a real synthetic Node child plus controlled fake CLI processes; no official installed CLI or real subscription was invoked. Process close and local abort do not prove remote provider processing stopped or undo charges.
- Context changes still retire/reset conversation as previously designed; explicit Stop/error retains the transcript in the current context.
- Existing memory backend confirms blur and same-character observation updates do not cancel a request. Existing physical-control regression covers held-control identity; new fixture additionally asserts original question-node identity during stale completion.
- Version, tags, publication, dependencies, and installer are unchanged. This is a bounded correction, not 1.0 certification.

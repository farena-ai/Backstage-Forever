# Final restore truthfulness correction — I1

Date: 2026-11-10. Canonical checkout: `C:/Users/faren/Documents/Codex/2026-11-08/referenced-chatgpt-conversation-this-is-an/outputs/Backstage-Forever`. Branch: `codex/pre-1.0-product-polish`. Starting HEAD: `7045e25338f01d9cf21d57ea97a70bdd4467136b`. Owning finding: `work/series-final-review.md`, Important I1. Binding recovery and umbrella designs were read before the change.

## Result and scope

A confirmed restore remains a confirmed restore when subsequent history, adventure brief, game-status or display-paint work fails. The renderer retains the restored state, clears old drafts/messages and source status, retires the reviewed restore preview, and shows a fixed restored-but-display-unavailable warning. The existing **Refresh recovery history** button retries failed display reads without calling restore again. Late detail-retry completions cannot rearm retry state after Recovery invalidation. Genuine pre-commit failure and native cancellation retain their previous messages and preview behavior.

The app host now separates committed replacement from optional detail refresh. Brief and game-status reads settle independently, status applies only to the same state/mutation context, and a rejected optional display refresh returns an explicit unavailable detail result instead of rejecting the committed restore. Recovery handles its post-commit history read under a separate boundary and retains the committed warning across failed refresh attempts. The fixed help text explains display-only retry.

No backend, filesystem/journal protocol, reference pack, provider implementation, version, dependency, public key, addon or native code changed. Art, navigation routes, source ownership and approved character-guidance poll/search behavior were preserved. No additional workers were used.

## TDD evidence

1. `node --test --test-name-pattern='committed' tests/recovery-renderer.test.cjs tests/renderer-updates.test.cjs`
   - RED before production changes: **4 tests, 0 pass, 4 fail**. The actual Recovery module emitted the false no-replacement text after successful restore/history rejection, ignored the unavailable-details outcome, and the actual app host callback rejected on brief and game-status failures. Log: `work/restore-truthfulness-red.log`.
   - Initial GREEN after both boundaries were fixed: **4 tests, 4 pass, 0 fail**. Log: `work/restore-truthfulness-green.log`.
2. `node --test --test-name-pattern='obsolete display' tests/recovery-renderer.test.cjs`
   - RED: **1 test, 0 pass, 1 fail**. A held detail retry completed after invalidation and incorrectly caused a second detail read in the new view. Log: `work/restore-truthfulness-stale-red.log`. The subsequent generation check fixes this and is included in final GREEN below.
3. `node --test --test-name-pattern='rejected post-commit display' tests/renderer-updates.test.cjs`
   - RED: **1 test, 0 pass, 1 fail**, with the actual host callback leaking a rejected post-commit paint. Log: `work/restore-truthfulness-paint-red.log`. Containment is included in final GREEN below.
4. `node scripts/recovery-smoke.cjs --postcommit-only`
   - RED on original production source: **4 preliminary checks passed; the new fifth check failed** while waiting for truthful restored/unavailable status after the injected history rejection. Log: `work/restore-truthfulness-electron-red.log`.
   - Final GREEN: **5 checks passed**, including all three history/brief/game-status failure variants inside the new fifth check. Log: `work/restore-truthfulness-electron-green.log`.

The new tests load actual owning renderer files and the existing full app VM harness; no production functions are copied into tests. Eight unit tests were added in total (five focused Recovery module cases and three actual app-host cases), including preservation of genuine pre-commit/cancel semantics.

## Final scoped verification

```powershell
node --test --test-concurrency=1 tests/recovery-renderer.test.cjs tests/renderer-updates.test.cjs tests/renderer-interaction.test.cjs tests/refresh-renderer.test.cjs tests/recovery-ipc.test.cjs tests/recovery-store.test.cjs tests/recovery-checkpoints.test.cjs tests/startup-recovery.test.cjs tests/backup-limits.test.cjs
node scripts/recovery-smoke.cjs --postcommit-only
git diff --check
```

- Unit result: **131 tests, 131 pass, zero fail/cancelled/skipped/todo**, duration 3469.738 ms. Log: `work/restore-truthfulness-scoped-units.log`.
- Synthetic Electron result: **5 focused checks passed** on final runtime source. Each post-commit variant verifies actual restored `state.json` notes, newly seeded saved-memory removal, byte-for-byte unchanged synthetic credentials, restored active profile, a disabled old restore preview, fixed warning text without the injected private error, disconnected game status, and exactly one replacement despite the subsequent display retry. The history-rejection variant also holds Enter and verifies that the original Restore and nearby Support nodes plus focus survive until key release.
- Diff whitespace check passed. Git emitted only its existing CRLF-normalization notices for edited files.
- Screenshots: `work/recovery-ui/recovery-postcommit-recoveryList.png`, `work/recovery-ui/recovery-postcommit-adventureBrief.png`, `work/recovery-ui/recovery-postcommit-gameStatus.png`. The history-failure screenshot was visually inspected: the warning, display retry and retired Restore state are visible in the existing full-width Recovery panel; neighboring Support remains intact.

## Self-review and limits

Reviewed the scoped source/test/help diff after GREEN. The commit boundary and display retry are explicit, fixed errors do not expose injected private error text, the new helper checks state/mutation ownership, Recovery checks generation after awaited detail retry, and no old preview is reused after committed replacement. Pre-commit/cancel checks and the affected existing privacy/retention/startup/locking tests pass.

The focus runner executes the first four existing setup checks and the one new check, then exits; the full existing Recovery fixture now has **15 checks**, with three failure variants in the added check. The parent owns regeneration and execution of the full genuine 8.3 alias fixture, integrated full unit suite, independent delta review, rebuild and packaged-artifact addendum. No full unit suite, packaging, other feature GUI suite or old passing broad check was repeated here. The final synthetic post-commit cases verify disconnected status; the existing full-fixture real synthetic source-retirement case remains for the parent full run.

Only isolated synthetic journals and fake native/provider/audio surfaces were used. No actual player/game files, gameplay, audio capture, account sign-in, paid request, installer, OS setting, scheduled watcher, push, PR, tag or release was performed. Version/public preview remains 0.12.3; **1.0 remains held for owner acceptance**. This report is scoped correction evidence, not a publication or real-player acceptance claim.

# Recovery Task 1 implementation report

Status: implemented; ready for parent independent SPEC/QUALITY review. Public version remains 0.12.3; 1.0, packaging acceptance and releases remain held.

## Scope and base

Started from 4e5a19e0abe4ed4b14f3541020cc6f8e131299c2 on codex/pre-1.0-product-polish. Parent's docs-only 19b03c3 commit did not alter the tested code baseline; use that commit as review base. Included the parent's recovery-design/recovery-plan memory-privacy clarifications. Excluded the parent's uncommitted future verified-character-guidance plan amendment.

The implementation commit's exact full SHA is reported in the final handoff. This report is finalized before that commit; it does not attempt to embed its own future commit hash.

## Delivered

- Read-only/lazy recovery manager, strict generated UUID envelopes, current validateState checks, SHA-256 damage checks, safe metadata, 3-point / 64 MiB each / 128 MiB total retention, 64-entry bounded enumeration and a 128 MiB aggregate envelope-read budget, canonical data-root/8.3 handling, regular-file and single-link checks, child-junction refusal, unique atomic temporary files, managed crash-temporary cleanup and unrelated-sentinel preservation.
- Default-on automatic event hooks after successful initialization, changed successful saves coalesced to 15 minutes, changed ordinary close, manual creation, identical-payload deduplication and explicit off behavior. Existing malformed/unreadable preferences fail closed and remain untouched until deliberate repair/toggle.
- Memory-free validated ordinary backup payloads; credentials never read/copied by recovery. Nonfatal automatic checkpoint failures. Import safety protection and mandatory restore safety point, including automatic-off. Selected payload is read before rotation can evict it.
- StoreStartupError narrowly identifies journal versus credential faults. Journal-only valid startup restoration preserves exact raw damaged bytes, refuses unsafe/mutated/oversized inputs, disconnects the owned game connection, retains credentials/unrelated files, explicitly relaunches, and always quits even if relaunch fails. Failed initialization with a nonempty journal creates no recovery files.
- Strict preload/IPC arity and input shape, main-owned preview/hash/current-context generation, native Cancel default, post-dialog rechecks, shared import/restore cancellation/disconnect lifecycle, source/observation retirement and stale-form source rejection.
- Field Guide panel with automatic toggle, count/date/reason metadata, manual creation, bounded selection and preview, deliberate restore and history clear; existing interaction guard keeps held controls/focus and late replies safe. Existing Support panel preserved; diagnostics include only safe recovery phase/automatic/count, never point IDs/dates/paths/text.
- Profile deletion clears all managed history/originals before commit and fails closed on purge failure. Reset clears history/preferences without recapture. Explicit saved-memory remove/clear (including empty clear) and external import purge prior raw originals and their managed crash temporaries; ordinary memory save does not purge originals.
- README, getting-started, privacy and support/recovery wording plus serial test:recovery entries in package and both existing CI workflows. No dependency, provider, addon, reference data, version, release, installer, real player/game/audio/auth/paid/settings or watcher work.

## RED evidence

- `node --test tests/recovery-checkpoints.test.cjs`: 7 initial assertions failed because the manager did not exist.
- `node --test tests/recovery-store.test.cjs`: 7 initial assertions failed because lifecycle/restore/typed-error methods were missing.
- `node --test tests/recovery-ipc.test.cjs`: 8 initial assertions failed because trusted recovery handlers did not exist.
- `node --test --test-name-pattern='journal fault alone|startup (point|journal|preservation|restart)' tests/startup-recovery.test.cjs`: 5 failures, no restore/restart behavior before implementation.
- `node scripts/recovery-smoke.cjs`: actual Electron initial RED, recoveryList missing from the bridge; later targeted full-width layout assertion failed before grid-column correction.
- `node --test --test-name-pattern='recovery projects' tests/diagnostics.test.cjs`: safe phase/automatic projection missing before implementation.
- `node --test --test-name-pattern='hidden damaged-original|purge failure' tests/memory.test.cjs`: 5 failures before privacy purge integration.
- `node --test --test-name-pattern='same-clock' tests/recovery-checkpoints.test.cjs`: timestamps tied before monotonic creation ordering.
- `node --test --test-name-pattern='crash temporaries' tests/recovery-checkpoints.test.cjs`: raw-memory and other owned crash temporaries remained before strict cleanup support.
- `node --test --test-name-pattern='malformed preferences' tests/recovery-checkpoints.test.cjs`: malformed existing preference incorrectly appeared automatic-on before fail-closed status correction.
- Startup restore connection-file canary failed before explicit owned-connection retirement.
- `node --test --test-name-pattern='aggregate read budget' tests/recovery-checkpoints.test.cjs`: externally added envelopes could exceed the bounded read budget before the final precommit self-review fix.

Every production behavior was followed by a scoped GREEN run. Some additional regression/fault-verification tests passed immediately against already-covered implementation; they are verification, not claimed new RED cycles. Initial manager test fixtures omitted required realm/goals and one alias fixture used a different clock; those fixture errors were corrected, not treated as feature failures.

## Final verification

`node --test --test-concurrency=1 tests/recovery-checkpoints.test.cjs tests/recovery-store.test.cjs tests/recovery-ipc.test.cjs tests/startup-recovery.test.cjs tests/memory.test.cjs tests/diagnostics.test.cjs tests/diagnostics-ipc.test.cjs tests/store.test.cjs tests/backup-limits.test.cjs tests/game-sync-memory.test.cjs tests/profile-sync.test.cjs`

109 passed, 0 failed, 0 skipped. The final precommit aggregate-read-budget self-review change then passed `node --test tests/recovery-checkpoints.test.cjs tests/recovery-store.test.cjs tests/recovery-ipc.test.cjs`: 29 passed, 0 failed (including the new RED→GREEN case); no unrelated green suites were repeated. Includes genuine Windows 8.3 alias coverage, real Windows sharing locks denying checkpoint reads/atomic preference rename, a readable-but-not-replaceable journal proving original preservation on actual rename failure, hardlinks, child junctions, a 64 MiB+1 sparse original, bounded enumeration flood, safe startup/relaunch success/failure and unchanged no-checkpoint startup bytes/entries. Envelope/aggregate retention tests use injected smaller limits to exercise rotation without allocating hundreds of MiB; production constants are clamped to 64/128 MiB. The existing source-extracted import fixture was narrowly updated to execute the actual shared replacement function after that extraction changed.

Serial actual synthetic Electron runs:

- `node scripts/recovery-smoke.cjs`: 13 checks passed. Automatic initial protection, strict bridge, physical Enter control/focus retention, preview/native cancel/restore, memory exclusion/clearing and credential bytes preserved, native restore across navigation/reset, actual held synthetic saved-source read retired by restore, stale source form rejected, limit/ordinary-save/retry, real unavailable storage/retry, late history reply, profile deletion, history off/manual behavior, reset/unrelated sentinel, compact/full keyboard/layout.
- `node scripts/support-smoke.cjs`: 10 checks passed; exact preview/copy/export, safe facts/no network, held controls/focus, navigation/reset/native-save races preserved.
- `node scripts/living-backend-smoke.cjs`: passed existing synthetic source setup/follow/cross-account/disconnect/reset lifecycle checks.
- `node scripts/memory-backend-smoke.cjs`: passed existing trusted IPC, all seven fake provider routes, exact preview/send, main drafts/ownership, privacy, stale-response deletion, ordinary save/restart/import/prune/reset checks.
- `node scripts/setup-smoke.cjs`: passed first-run synthetic setup, five-file readback, saved observation import, briefing, explicit draft, reduced motion and setup reopening.

Screenshots inspected: work/recovery-ui/recovery-full-viewport.png and recovery-compact-viewport.png, plus full-page counterparts generated by the fixture. Full-width fantasy-styled panel, all actions visible/readable, no horizontal overflow, held controls stable. Final copy-only singularization corrected 1 character/1 journey after those captures; no behavior changed. Prior packaged review artifacts were not overwritten.

`git diff --check`: clean (repository line-ending notices only). Full series tests/source acceptance/package gates were intentionally not rerun; parent owns those later gates.

## Limits and review notes

- Raw damaged-original retention is an explicit privacy exception to ordinary memory-free checkpoints and is disclosed/deletable. It is not included in the checkpoint 128 MiB total; its separate maximum is 64 MiB and a different previous original is never overwritten.
- Startup/native dialogs are tested through injected native Electron surfaces and real main/helper execution. No actual restart of a player's app, real corrupt journal, provider/auth call, microphone or installer was exercised.
- Filesystem controls reject known links/aliases/oversized entries and preserve unrelated files. Recovery is not an encrypted notebook, disk-failure guarantee, or protection against an administrator concurrently replacing app-owned storage.
- A failed replacement can leave game observation disconnected, and a failed privacy purge can remove some eligible history before returning failure; it must never claim successful deletion or replace the journal when the required purge fails.
- Parent independent review, later whole-series validation, isolated review packaging, and owner 1.0 acceptance remain required. No approval/release claim is made here.


## Independent-review corrections (after 4191e2a)

Review source: work/series-recovery-review.md, which evaluated 4191e2a7322bd4b01e7d21f86a24f3d65b16c60c and identified three concrete findings. All three were accepted and corrected in this follow-up; the exact final correction SHA is supplied in the final handoff after this precommit report amendment. No earlier test evidence is being relabeled as independent approval.

1. Durable source retirement: shared import/restore and reset now require validated removal of the app-owned persisted game-connection file before Store journal replacement. The same strict helper serves startup restore. A live GameSync disconnect cannot silently authorize success while the stored connection survives. Failed replacement/reset leaves original journal/key bytes intact; live observation may already be disconnected.
2. Empty-memory privacy action: the existing Clear button is enabled for a valid chosen character whenever idle, including zero exchanges. Its confirmation and help explicitly explain complete removal of a retained damaged original/private text. Actual renderer clicks now prove an empty-list purge succeeds, and a hardlinked raw original produces a visible refusal with both raw bytes and journal bytes unchanged.
3. Crash-safe bounded rotation: a new envelope remains a unique uncommitted stage until permanent history has room. Production rotation never evicts the last prior usable point. Promotion failure rolls back successfully evicted files; process-exit boundaries leave at least one usable committed point and never a fourth permanent point or permanent bytes above the configured aggregate cap. Later authorized creation validates/cleans abandoned complete memory-free stages; list/failed-startup inspection stay read-only. Cleanup refusal creates no further stages. An existing interrupted raw-original stage also refuses another preservation attempt, avoiding repeated private staging copies.

Additional space accounting is explicit: permanent history remains 3 points / 128 MiB with 64 MiB per point; checkpoint rotation can temporarily require one extra memory-free envelope up to 64 MiB. The one retained raw original has its own 64 MiB maximum and its preservation may temporarily use one additional raw stage up to 64 MiB. Raw remnants are never automatically discarded as ordinary checkpoint stages. Documentation reflects these separate lifetimes and caps.

Fresh RED→GREEN evidence:

- `node --test --test-name-pattern='persisted-disconnect' tests/recovery-ipc.test.cjs`: initially failed because real GameSync unlink sharing denial still allowed Store restoration. After the strict helper, the same locked-file case passed. Expanded reset assertion then failed before adding reset's strict postcondition and passed afterward. The fixture uses real Windows FileShare.Read denial, real GameSync disconnect/reset, real Store and extracted actual main handlers. Unlock/retry succeeds; a newly initialized GameSync with _connect observed makes zero reconnect attempts.
- `node scripts/recovery-smoke.cjs`: the added actual empty-memory Clear assertion failed because the button was disabled. After the renderer correction, all 14 checks passed, including actual clear/purge and visible hardlink failure. An intermediate harness attempt incorrectly tried to accept a JS dialog already settled by the injected native Electron dialog; it was replaced by an explicit synthetic confirm response. That was a fixture failure, not an application result. The leftover isolated fixture window was closed normally via its own DevTools session. Its synthetic scratch directory remains at C:/Users/faren/AppData/Local/Temp/bf-recovery-ui-nTNMrD after automatic review rejected combined force-process/temp-directory cleanup; no player data was involved.
- `node --test --test-name-pattern='process exit' tests/recovery-checkpoints.test.cjs`: initially failed at promotion (four permanent points) and eviction (permanent byte total over budget). Both passed after staging/rotation correction. The completed cases force child-process exit after actual promotion, after the first eviction, and after the last eviction, using near-budget history that requires two evictions. They also assert read-only post-crash listing and a successful later startup capture.
- `node --test --test-name-pattern='interrupted raw-original' tests/recovery-checkpoints.test.cjs`: initially allowed another preservation attempt; the new guard passed with three repeated attempts leaving the raw stage and damaged journal unchanged.

Affected GREEN run: `node --test tests/recovery-checkpoints.test.cjs tests/recovery-ipc.test.cjs tests/recovery-store.test.cjs tests/startup-recovery.test.cjs tests/memory.test.cjs tests/backup-limits.test.cjs` — 72 passed, zero failed/skipped. Subsequent narrow verification added the last-eviction/relaunch cases: 3 crash cases and 1 persisted-disconnect case passed. Final `node --test --test-name-pattern='interrupted raw-original|process exit|failed promotion' tests/recovery-checkpoints.test.cjs` — 5 passed, zero failed/skipped, including byte-exact rollback after promotion denial and no accumulation across repeated denied stage cleanup. No broad unaffected suite was repeated.

Only recovery/main/memory-renderer boundaries, their tests and privacy/help/report text changed in the correction. Parent future guidance plan remains excluded. No new GameSync protocol, provider, addon, reference-data, dependency, version, release or real external-service work. Parent delta review still required; whole-series/package gates remain separate.

# Correction task 2 report — preserved-data startup recovery

Status: complete; ready for independent spec and quality review. Scope is correction Task 2 only. Base: `fc8a9423feae2de013c6f6af1f8c8762c0047d52`, branch `codex/pre-1.0-product-polish`. Task 1 is preserved. Parent-owned `docs/PRODUCT-READINESS.md` is excluded.

## Changes

- Added narrowly injected async `showStartupFailure({ dialog, shell, dataDir })`. It offers **Quit** (default and cancel) and **Open data folder**, shows the actual `app.getPath("userData")` directory locally, and uses fixed neutral startup wording rather than attributing every initializer failure to saved-data damage.
- Explicit Open calls only `shell.openPath(dataDir)` and awaits it. A returned native error string or rejection produces fixed safe File Explorer guidance with the same exact directory. Raw exceptions, keys, state contents and native error output are never presented or logged by recovery. Copy is fixed apart from the required actual directory.
- Bounded helper: at most two dialogs and one directory-open operation; no filesystem import, recursive enumeration, writes, reset, restore, rename, move, deletion, diagnostic file or retry loop. A rejected native dialog settles safely.
- Main startup now awaits recovery and unconditionally calls quit in `finally`, including when the helper itself unexpectedly rejects. Startup-failure shutdown marks quit approved, so an already-created updater cannot divert it into install-on-quit. No restore wizard was added.
- README links directly to the new **If the app cannot start** section. Getting started gives the usual `%APPDATA%\Backstage Forever` directory and exact-dialog-path precedence for custom locations, requires a whole-folder copy with the app closed, distinguishes `state.json`/`credentials.json`, limits manual state renaming to an identified state failure with a chosen valid exported backup, and directs restore through the app's validated import/confirmation. It explains memory/credential exclusions, existing-key preservation, re-entry/reconnection implications and safe support information.

## Files owned

- `src/main.cjs`
- `src/core/startup-recovery.cjs`
- `tests/startup-recovery.test.cjs`
- `README.md`
- `docs/GETTING-STARTED.md`
- `.superpowers/sdd/correction-task-2-report.md`

## RED before implementation

`node --test tests/startup-recovery.test.cjs` — final pre-implementation run: **14 tests, 13 expected failures, 1 existing quit-path pass**; exit 1.

- Helper behavior failed with `startup failure needs an actionable preserved-data helper`, actual `undefined`, expected `function`.
- Real main startup with invalid state, invalid credentials, or an unrelated initializer failed `a broad startup catch must not diagnose saved-data failure`: the old catch showed `Saved data could not be read safely... Restore a valid backup or move the data folder...`.
- The helper-rejection integration assertion failed `0 !== 1` because startup never attempted the recovery helper.
- The initial test harness misplaced its helper-attempt assertion; that test-only defect was corrected and the final RED above was rerun before any production implementation.

## GREEN verification

- `node --test tests/startup-recovery.test.cjs` — **14 passed**, exit 0. Covers Quit/default/cancel/unrecognized choices, exact directory, explicit Open and awaited completion, returned open error and rejected open, primary and follow-up dialog rejection, invalid state and credential Store initialization, unrelated initializer wording/privacy, main waiting for the recovery choice, and guaranteed quit even on helper rejection.
- `node --test --test-concurrency=1 tests/store.test.cjs tests/core.test.cjs tests/memory.test.cjs` — **28 passed**, exit 0. Existing coverage includes validation, atomic invalid-import preservation, encrypted credential isolation/reset, ordinary Store load/save, memory export/import/reset exclusions and real Windows 8.3 alias behavior. Provider checks in the existing core file use synthetic protocol fixtures.
- `git diff --check` — **PASS**; only repository CRLF-to-LF notices for the main source file.

Every startup fixture uses its own freshly created `bf-startup-*` directory. State bytes, credential bytes, a nested binary sentinel and exact directory entries are checked unchanged after each successful recovery scenario. Invalid-state and invalid-key fixtures exercise the real Store constructor; integration tests execute the real main source and recovery helper through a VM with Electron native surfaces injected and an unrelated constructor failure injected where needed. Cleanup resolves the fixture path and checks its temporary parent and prefix before removing only that isolated fixture.

## Self-review and limits

- Confirmed exact path comes from main-owned `app.getPath("userData")`, never renderer input or an exception; Electron's bundled default app honors `productName`, consistent with the documented usual folder.
- Confirmed arbitrary/undefined response is treated as Quit; a failed dialog never grants permission to open a folder. An open error cannot inject private native output into either dialog.
- Confirmed no error object crosses into recovery; both helper and main defensive catches allow the clean quit path without unhandled promise rejection. Task 1 cancellation and shutdown hooks remain intact.
- Recovery itself preserves files. Other initialization services retain their existing normal startup behavior; this change does not claim to roll back prior initialization activity or identify an unknown failure's cause.
- Native dialogs and File Explorer are controlled fakes in these tests, not an actual Windows GUI acceptance run. Tests prove application options, exact open target, ordering and failure handling; native rendering/Explorer behavior remains a manual acceptance item.
- No real player files, accounts/sign-in, audio, paid requests, game input, installers, OS settings, scheduled watchers, version/dependency/tag/publication changes were used. Version remains 0.12.3. This correction is not 1.0 certification.

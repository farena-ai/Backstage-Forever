# Companion recovery fixture boundary correction

Base reviewed: `3e1391a` (all correction tasks integrated). This change is fixture-only; no product source, dependencies, version, or publication changed.

## Diagnosis and corrected evidence

The serialized parent gate in `work/readiness-short-companion.log` failed the initial exact Stop count assertion after backend request admission. No other GUI worker was running. Earlier speculation that GUI overlap sufficiently explained this failure is withdrawn: overlap is neither necessary nor established as the cause.

The fixture treated main-process request admission as completion of renderer presentation. Those are different boundaries. `app.js` requests `render()` and then starts `api.ask()`; `Memory.deferRender()` can legitimately queue that render while the original physical input dispatch is held. `interaction.js` releases the queued render after physical release/default dispatch. The old count assertion could therefore inspect the preceding presentation.

The original uninstrumented failure does not reveal its exact guard state. A deterministic actual Electron regression now proves the faulty assumption without requiring overlap or a short path:

1. Focus the actual Send button and hold physical Enter through request admission.
2. Instrument the existing `Memory.deferRender` return without changing its behavior.
3. Observe `deferredPaints=1`, original Send node still connected/current, and `stopCount=0` while the fake main transport is already pending.
4. The old immediate assertion fails unchanged: expected 1, actual 0.
5. Release physical Enter and wait for the actual visible Stop action. The original exact count assertion then passes. No arbitrary delay, focus predicate, or weakened assertion was introduced to claim completion.

The fixture retains the held original control checks and every existing cancellation, memory, draft, sharing, identity, focus/caret, and trusted IPC assertion. Other pending-request scenarios now also wait for their actual Stop presentation after admission. The final focus scenario records the request index before Send and waits for its matching admission instead of assuming request insertion has already happened.

## Genuine Windows 8.3 coverage

Previously the fixture called `realpath(os.tmpdir())` before creating its app-data directory. Thus a short TEMP environment did not mean a short `BF_USER_DATA` input reached Electron. The fixture now creates its owned synthetic directory beneath raw `os.tmpdir()`. Canonicalization is reserved for identity checks and guarded cleanup.

The focused wrapper `work/run-companion-fixture-short.ps1` uses the genuine Windows short alias of the existing long temporary root, checks distinct spellings plus equal device/inode, sets TEMP/TMP only for the fixture, then restores them. The fixture checks that Electron's actual userData path resolves to the same owned directory. The short run logged:

`{"aliasedTemp":true,"aliasedInputPassed":true,"appRetainedInput":true,"sameOwnedDirectory":true}`

This proves an aliased TEMP root and aliased `BF_USER_DATA` input exercised actual Electron app-data access. It does not claim every repository or application path uses an 8.3 spelling. Cleanup resolves the owned directory, verifies its canonical parent equals the approved temporary root and its expected fixture prefix, then removes only that owned directory.

## Verification

All runs were serial; this agent was the sole GUI worker.

- Focused RED: `node scripts/companion-recovery-smoke.cjs` with held Enter and the old admission-boundary assertion — expected exact count failure, after the recorded deferred-render/original-node evidence above.
- GREEN normal: `node scripts/companion-recovery-smoke.cjs` — PASS; `aliasedTemp=false`, Electron retained input, same owned directory.
- GREEN genuine 8.3: `./work/run-companion-fixture-short.ps1` — PASS; wrapper same-device/inode proof and fixture app-data alias/identity checks passed. Output: `work/readiness-fixture-fixed-short.log`.
- Both GREEN runs retained `deferredPaints=1`, original connected/current Send node and pre-release `stopCount=0`, then passed all original lifecycle assertions after actual presentation completion.
- `git diff --check` — PASS.

No broad unit or GUI suites were rerun. Existing whole-branch unit/product evidence remains owned by the parent gate. No real account, paid request, audio recording/playback, game/player data, game control, installation, persistent OS setting, watcher, or release operation was involved. All launched fixture windows closed.

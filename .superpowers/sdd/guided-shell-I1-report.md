# Guided shell I1 correction report

Prepared before the scoped correction commit. Base `8710b32b73d71b444bff321c8530a434d12524c1`; branch `codex/pre-1.0-product-polish`. Read `work/guided-shell-review.md` and the actual Voice/fixture ownership paths. Sole implementation and synthetic GUI owner; no subagents.

## Fix

I1 is resolved with a separate volatile `capabilityError`. A current rejected capability check updates the folded Voice summary to **Needs attention** and retains the fixed retry instruction in the voice status. The disclosure can stay folded; the error is visible without opening it. A successful explicit retry clears only the capability error.

Capability checking does not repurpose audio `phase` or overwrite an existing audio-error message. Successful checks retain the previous normal status-update behavior outside the audio-error phase. An existing unconfirmed-stop error takes status precedence and remains in phase `error` after both rejected and successful capability checks. Its existing reveal/Stop behavior remains. Attention takes precedence over the dictated-draft summary when an error coexists; the actual draft stays intact.

The existing generation/current-owner test gates both failure and success. Invalidation clears this owner's capability error. No startup, stop, acknowledgement, timer, main service, IPC, native worker, or ownership generation semantics changed. The existing capability-control refresh retains its interaction guard and regional repaint.

## RED to GREEN

Before production changes:

```powershell
node --test tests/voice-renderer.test.cjs
node scripts/voice-memory-smoke.cjs
```

- Focused unit RED: **0/3 pass, 3 failures**. Initial rejection and subsequent current-owner rejection had the generic summary instead of Needs attention. A capability rejection also replaced an unconfirmed-stop message with the capability message.
- Actual Electron RED: held manual capability request, physically fold Voice, release rejected response; summary remained `Voice · optional dictation and reading`, failing `/Needs attention/`.
- After the bounded state correction, focused units were **3/3 GREEN** and the actual Voice fixture passed.
- The expanded real fixture additionally checks successful retry clears attention, a late rejected check after leaving and returning cannot mark the replacement owner, and failed/successful capability checks cannot erase the fixed unconfirmed-stop error. Existing exact node/caret, physical hold/release, pending readiness/ack, fold cancellation, memory/privacy and late-reply assertions remain unchanged.

Receipts are retained under `.superpowers/sdd/player-shell-logs/`: `I1-unit-red.log`, `I1-gui-red.log`, `I1-unit-green.log`, `I1-gui-green.log`.

## Final verification after stable changes

```powershell
node --test tests/voice-renderer.test.cjs tests/player-navigation.test.cjs tests/renderer-interaction.test.cjs tests/refresh-renderer.test.cjs tests/voice.test.cjs tests/voice-ipc.test.cjs
node scripts/voice-memory-smoke.cjs
node scripts/player-shell-smoke.cjs
```

**74/74 units passed**, zero failures/skips/cancellations. Includes the three new renderer cases, original capability refresh/node ownership cases, native-control/navigation guards, exact IPC arity, fake-worker startup/cancel/termination deadlines, late acknowledgement, and unconfirmed-disposal protection.

**2/2 actual Electron GUI commands passed strictly serially**, with no edits during the final run. The shell fixture retained its 26 captures, both factions, all eleven visible destinations, keyboard paths, actual 984×635 unconfigured Send visibility, 200% zoom/reduced motion, select contrast, zero broken images and horizontal overflow. Final logs: `I1-final-units.log`, `I1-final-voice-memory.log`, `I1-final-player-shell.log`.

JavaScript syntax and `git diff --check` pass. Compared with the base, assets/data/addon/native bytes, package/lockfile/version, and player-navigation CSS are unchanged. Only the renderer Voice module, its existing actual fixture, the new focused unit fixture, and this report are committed. No real audio/player data/game input/auth/provider/paid/installation/OS/watcher/remote actions were performed. The voice worker and capability rejection are synthetic.

Full npm test, packaging, fresh independent review and owner acceptance remain parent-owned. No broad 21-command GUI rerun was needed for this isolated capability-error correction. Source remains 0.12.3; 1.0 remains held. GUI ownership is released with the final commit SHA.

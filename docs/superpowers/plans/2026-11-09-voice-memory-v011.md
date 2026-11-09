# Voice and Optional Memory 0.11 Implementation Plan

> REQUIRED: subagent-driven-development, one implementer at a time, independent SPEC/QUALITY task review; TDD and no human check-ins under authorized through0.12 request.

Goal: optional local voice and explicit private memory without changing provider access or game automation boundaries.

## Global constraints

Read full docs/superpowers/specs/2026-11-09-adventure-series-v09-v012-design.md and 2026-11-09-voice-memory-v011-design.md. Exact schemas/bounds/epochs/provenance/ownership/privacy bind every task. No real microphone/playback/credential/game writes, consent, paid inference, actual install/launch or watcher. Canonical temporary roots, bounded fake hooks, normal/genuine Windows83. Parent owns version/docs/required npm+bothCI gates/package/publication. Work reports stay ignored, never force-add. Preserve original graphical assets and all existing queues/guards.

## Task 1: Main-owned memory and preview/send parity

Files: focused src/core/memory-data.cjs, memory.cjs, memory-ipc.cjs, companion-context.cjs; narrow validation/store/company-ipc ordinary-merge/profile-sync/game-sync source-transition/main/preload integration and actual backend/privacy tests; scripts/memory-backend-smoke.cjs. No renderer/native/helper/version/data/provider protocol changes.

- [ ] RED strict optional schema, old migration, main-owned preservation, profile prune/import/reset/export and atomic failure before implementation.
- [ ] Implement explicit save/delete/clear using main-generated IDs/time and response-context binding; no forged/stale reply saving or ordinary renderer history replacement.
- [ ] RED and implement shared pure selected-memory preview/ask augmentation, all API/subscription routes identical bounded prompt, original-question scope/retrieval preserved; no automatic memory selection or private journal fields.
- [ ] Main assistant context/invalidation contract must cover nav/profile/provider/import/reset/delete/clear and late response effects. Record exact IPC/response-token/model contract for subsequent tasks.
- [ ] Actual synthetic Electron backend, local fake providers, focused/full once final normal/genuine83. Commit/report work/v011-task1-report.md then independent review.

## Task 2: Fixed local speech worker and trusted voice lifecycle

Files: src/native/voice-helper.ps1 and .cs; focused src/core/voice.cjs, voice-ipc.cjs/runtime helper if useful; narrow main/preload/.gitattributes/packaged checks and voice unit/backend fixture. No renderer/memory schema/provider protocol/native game/version/data changes.

- [ ] Read Task1 exact context contract. RED strict process/protocol/cancellation/runtime preparation tests before implementation.
- [ ] Implement fixed WindowsPowerShell System.Speech worker and verified runtime preparation. Bound and validate both sides, no shell/text interpolation, no execution-policy bypass/audio artifacts/automatic start.
- [ ] Strict main context/session/epoch startup cancellation, PTT hard stop/dispose/kill, explicit TTS/Stop, null-profile fallback, safe capability discovery and cleanup.
- [ ] Fake workers only for audio paths; safe real capability enumeration allowed. Test packaged source bytes and short paths, context races/errors/owned cleanup. Full once final, report work/v011-task2-report.md with exact UI contracts, independent review.

## Task 3: Graphical voice and private memory experience

Files: focused renderer voice.js/css and memory.js/css; narrow app/index plus actual renderer VM helper loads; scripts/voice-memory-smoke.cjs. No core/helper/native/provider/version/data changes.

- [ ] RED actual Electron hold/release/draft/explicit send and optional memory selection preview first.
- [ ] Implement accessible graphical optional voice controls with visible local recording state/time, editable incomplete draft, explicit Read/Stop, typed fallback; no paid inference/audio in tests.
- [ ] Explicit Save exchange, review/delete/clear memory and separate selected-memory future-use preview; queue/epochs/context token/latest saves; no stale display/dictation/TTS/save or automatic selection.
- [ ] Actual physical mouse/keyboard/default behavior plus startup-release/blur/nav/character/reset/import/clear/provider/held-ack races. Blur stops input/startup but preserves an otherwise current explicitly requested TTS reading or AI response so the player can return focus to the game. Normal/genuine83 and inspected fictional full/compact/unavailable/error previews; affected flows and full once final. Report work/v011-task3-report.md, independent review.
- [ ] Parent version0.11.0 docs/gates/fresh packaged milestone and safe capability-only probe; then formal0.12 party+finalQuestGuide plan. Final signed public0.12 only; owner real-player/microphone check before1.0.

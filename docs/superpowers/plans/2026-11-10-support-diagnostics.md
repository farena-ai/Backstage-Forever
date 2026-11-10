# Support diagnostics implementation

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development, test-driven-development and independent task review.

**Goal:** one-click preparation of a safe local support report with deliberate exact copy/save.
**Architecture:** pure fixed projection + main-owned report lifecycle/IPC; focused guide renderer module, existing shell/interaction patterns.
**Tech Stack:** existing Node/Electron/vanilla renderer/Playwright only.

## Global Constraints

Binding specs: docs/superpowers/specs/2026-11-10-resilience-guidance-series.md and 2026-11-10-support-diagnostics-design.md. Reuse current branch/checkout. Preserve private data, source ownership, follow/manual preferences, safeStorage and current/original control contracts. No actual player/game/audio/auth/paid/installer/settings/watchers or release/version/dependency changes. Tests synthetic, GUI serial; one implementer, independent SPEC/QUALITY gate, full-series strongest review later.

## Task 1: Safe report service and beginner UI

Files: create src/core/diagnostics.cjs and diagnostics-ipc.cjs; src/renderer/support.js and support.css; modify src/main.cjs/preload.cjs/renderer/index.html/app.js narrowly; create tests/diagnostics.test.cjs, diagnostics-ipc.test.cjs and scripts/support-smoke.cjs; docs/SUPPORT-AND-RECOVERY.md and PRIVACY.md. Register test:support in package.json and both workflow serial lists. Do not change reference data/checkpoint Store in this task.

Interfaces: buildDiagnostics(input,{now}) -> bounded safe object/text projection; service prepares {id,text} and owns one immutable snapshot (5min). registerDiagnosticsHandlers({handle,collect,dialog,clipboard,getWindow,dataDir,...}) returns {clear}; trusted preload methods diagnosticsPreview() -> {id,text}, copyDiagnostics(id) -> safe result, exportDiagnostics(id) -> safe cancelled/saved result. Strict arity and ID shape. Main collect assembles only local safe statuses; no provider sign-in/status worker/network. Main reset calls clear; all free-form messages and model names excluded. Later checkpoints can expose store.recoveryStatus() for bounded count/status, absent now means unavailable.

- [ ] Read source status shapes, existing handler/renderer interaction patterns and TDD/frontend skills. Write RED tests for report omission of nested canaries, malformed allowed enums, source names/paths/errors/model names/secret statuses, exact bounded text, time injection; run node --test tests/diagnostics.test.cjs and record expected failure.
- [ ] Implement minimal fixed projection, snapshot ID/clock/expiry ownership, deterministic readable text. No generic recursive redaction/dump. Add RED service/IPC tests for exact clipboard/file equality, stale/regenerated/expired IDs, reset, cancelled dialog, late dialog ownership, inside-data-dir normal/alias export denial and native/read/write errors; run node --test tests/diagnostics-ipc.test.cjs before implementation.
- [ ] Implement trusted main/preload registration and collector, all native calls injected for tests; validate current token again after dialog. Use existing atomic write; validate canonical parent to prevent app-data overwrite. Do not collect profile contents or contact providers. Sanitize errors into fixed messages.
- [ ] Add actual isolated Electron RED fixture for guide Support & Recovery discovery, preview, copy/export via fake dialogs/clipboard, malicious context exclusion, navigation/late response/reset, original held controls/focus and full/984x635 layout. Implement focused renderer/CSS, escaped preview, clear waiting/error/status, actions disabled until current preview, lifecycle invalidation. Existing guide help and nav labels retain unique accessible names.
- [ ] Run node scripts/support-smoke.cjs and affected existing smoke/product-polish only when shared renderer changes warrant; syntax-check new files, focused units. Register serial CI command and explain local preview/manual sharing/privacy in docs. No unnecessary green full-suite repeats.
- [ ] Self-review, commit owned files, report .superpowers/sdd/support-task-1-report.md with exact RED/GREEN/commands/counts/screens/limits and final SHA after finalized report. Independent review uses full base..head diff. Parent coordinates later component designs and final integrated review.

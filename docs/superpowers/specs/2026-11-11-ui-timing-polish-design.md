# Setup and Plans timing polish

## Goal and evidence

Fix the two unresolved 0.13.4 Windows validation failures while preserving the polished five-section interface. Keep 1.0 held for Frank's hands-on acceptance. The published 0.13.4 release pipeline passed; independent validation failed in `living-setup-smoke.cjs:141` (Refresh target detached after disclosure) and `company-smoke.cjs:219` (renamed plan's current Delete control absent at assertion). At planning time these were unresolved timing failures, not established product defects. Controlled actual-app reproduction subsequently proved both fixture races and a user-facing same-screen disclosure collapse.

## Chosen design

Reproduce both failures with controlled scheduling in the actual isolated Electron app. Acknowledgements must bind to the intended route/disclosure/request, current rendered data and focused control. Preserve real pointer/key input and explicit original-node ownership assertions. Reject stale same-label controls and acknowledgements belonging to another action. The alternatives are arbitrary longer sleeps (conceals races) or a broad interaction rewrite (unjustified risk). Neither is appropriate.

Change fixtures when they race legitimate asynchronous rendering. Change product behavior only when a deterministic user-facing defect remains after correct acknowledgement. Any product correction must retain current artwork, accessible keyboard navigation, autosave, cancellation and pending-state clarity. Related polish is bounded to these two flows; no new screens or redesign.

## Qualified product correction

The executed Game connection render can replace native Connection checks and Optional activation panels after the player has deliberately opened them while a status response is outstanding. Preserve the immediate native open/closed state and focused summary of these panels, plus setup Connection checks, only through an executed paint with the same owner: route, setup mode/generation, journal replacement generation, onboarded state, active character, connection state and an ephemeral explicit-folder-choice generation. Capture after existing interaction guards allow the render to execute; never capture queued render requests. Read the native state directly so queued toggle events cannot resurrect an earlier choice.

The status API intentionally exposes no folder path. Setup preparation/disconnect already changes setup generation; Game connection's explicit Choose folder command additionally changes the ephemeral disclosure generation, including cancellation conservatively. No root path, persistence, new preference, consent, provider state or journal data is added. Route/setup/profile/import/reset/folder changes retire the old owner. Missing panels carry no retained state into later paints. Existing artwork and CSS remain unchanged. Retain same-screen closed choices and keyboard summary focus as well as open choices.

Game-connection navigation fixture acknowledgement binds to the exact physical button's renderer action, not the next unrelated action or an early route heading. Other route helpers retain their earlier route/heading boundary because their suites deliberately hold route-specific reads to test retirement. Renamed-plan acknowledgement binds in one current DOM snapshot to the saved journey ID, exact new Delete label, visible unique card and focused current control; main-store visibility and old-label focus alone cannot pass. Keep separate original-node held-input assertions intact.

This proven product change is prepared as **0.13.5 preview** with aligned app/lockfile/addon/capture/current documentation metadata and a new release note. Existing release notes, tags and evidence remain sealed. Independent review and parent-owned normal validation/publication remain separate gates; **1.0 stays held**.

## Boundaries

- Reuse the clean canonical checkout at `562ef0268ea6f09d52f48b9481e988b89cb14b9a` on `codex/pre-1.0-product-polish`.
- Preserve failed receipts, all published/failed tags, earlier release notes and sealed review artifacts.
- Use disposable fictional profiles, installs and game observations. No installed-app restart, installer execution, real journal/provider/audio/game/credential access or OS setting changes.
- No weakened assertions, forced synthetic clicks, removed gates, longer deadlines or reruns solely to obtain green.
- No dependency, game protocol, verified-data, privacy or signing changes.
- Main validation must pass after independent review. A fixture-only correction needs no empty desktop update; a real product correction receives a new preview patch and the existing full publication/authenticated-download checks.
- No watcher jobs or recurring threads. 1.0 remains held.

## Acceptance

Each original failure has a deterministic RED receipt, a reasoned minimal fix and GREEN evidence using the same perturbation. The complete affected GUI commands pass with original privacy, write-count and physical-interaction checks. Any helper change receives a regression that distinguishes current from stale acknowledgements. Adjacent setup/navigation/autosave checks run only where changed code warrants them. Native captures cover any product layout change; unchanged artwork needs no regeneration. Independently review the whole task delta, run normal Windows validation and report remaining limitations honestly.

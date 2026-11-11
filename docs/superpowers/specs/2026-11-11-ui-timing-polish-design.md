# Setup and Plans timing polish

## Goal and evidence

Fix the two unresolved 0.13.4 Windows validation failures while preserving the polished five-section interface. Keep 1.0 held for Frank's hands-on acceptance. The published 0.13.4 release pipeline passed; independent validation failed in `living-setup-smoke.cjs:141` (Refresh target detached after disclosure) and `company-smoke.cjs:219` (renamed plan's current Delete control absent at assertion). These are unresolved timing failures, not established product defects.

## Chosen design

Reproduce both failures with controlled scheduling in the actual isolated Electron app. Acknowledgements must bind to the intended route/disclosure/request, current rendered data and focused control. Preserve real pointer/key input and explicit original-node ownership assertions. Reject stale same-label controls and acknowledgements belonging to another action. The alternatives are arbitrary longer sleeps (conceals races) or a broad interaction rewrite (unjustified risk). Neither is appropriate.

Change fixtures when they race legitimate asynchronous rendering. Change product behavior only when a deterministic user-facing defect remains after correct acknowledgement. Any product correction must retain current artwork, accessible keyboard navigation, autosave, cancellation and pending-state clarity. Related polish is bounded to these two flows; no new screens or redesign.

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

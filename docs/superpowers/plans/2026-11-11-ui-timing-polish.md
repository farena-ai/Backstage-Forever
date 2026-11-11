# Setup and Plans Timing Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Eliminate both recorded timing failures with exact current-state acknowledgements and preserve beginner-friendly setup and Plans interactions.

**Architecture:** Diagnose both guarded-render acknowledgement boundaries in one bounded task because they share native-input and asynchronous paint semantics. Separate physical activation, completed application work and current DOM ownership; repair only the layer proven faulty. Independently review before normal GitHub validation.

**Tech Stack:** Existing Electron, Node test runner, Playwright physical inputs and current renderer modules; no dependencies.

## Global Constraints

Follow the companion spec `docs/superpowers/specs/2026-11-11-ui-timing-polish-design.md`. Keep 1.0 held. No real installed-app/game/profile/provider/audio/credential changes. Preserve prior artifacts, tags, assertions and timeouts. Do not publish an empty desktop update for fixture-only repairs.

## Task 1: Diagnose, repair and qualify both timing boundaries

**Primary files:** `scripts/living-setup-smoke.cjs`, `scripts/company-smoke.cjs`; shared fixture helpers only if needed. Relevant production code is read first and modified only after a deterministic product defect. Regression files belong under `tests/`. Update this plan's checkboxes and record evidence under ignored `work/ui-timing-polish-report.md`.

- [ ] Read the exact failure logs `work/installed-0134-validation-failure.log` and `work/installed-0134-main-validation-failure.log`, affected scripts and actual renderer event/paint path.
- [ ] Reproduce Refresh disclosure/target retirement and renamed-plan keyboard ownership failures deterministically in an isolated actual app. Save RED logs and state receipts identifying what has completed and what remains queued. Do not declare a passing rerun a fix.
- [ ] Add a minimal regression before changing a helper or product. Use real deferred work rather than a test that merely repeats implementation. Reject stale same-name controls, completed unrelated actions and hidden old DOM.
- [ ] Make the minimal correction. Preserve natural pointer/key input, title autosave and exact focus, independent main writes, cancellation and original-node held-input checks. Audit adjacent uses of the same changed boundary.
- [ ] Run the same controlled reproduction GREEN, then the complete affected commands:

```powershell
npm run test:living-setup
npm run test:company
```

Expected: complete original acceptance flows, zero failures; no skipped or weakened gates. Run focused regression tests and adjacent setup/autosave checks only for changed shared behavior. Capture native screenshots if a product appearance changes.

- [ ] Self-review the diff, preserve raw receipts, write exact cause/scope/RED-GREEN/commands/capture paths/limitations to the report, and commit only scoped files. Return source/GUI ownership to the parent.

## Task 2: Independent review and normal validation

- [ ] Generate a review package from the recorded Task 1 base to its exact final HEAD. A fresh reviewer checks spec and quality without repeating green GUI runs. Correct Important/Critical findings and re-review.
- [ ] Push the reviewed source normally to main and follow Windows validation inline. Require a complete green run, diagnose concrete failures, and preserve failure logs rather than rerunning for luck.
- [ ] If Task 1 changes product behavior, align a new strict preview version and release notes, review that delta, use a fresh tag and the existing full release pipeline, then verify public assets with the installed updater in an isolated cache without installation. If fixture-only, retain 0.13.4 desktop version and state clearly that the repairs improve verification rather than pretend to add visible features.
- [ ] Report what changed, actual validation and any remaining pre-1.0 acceptance. Keep 1.0 held for Frank's hands-on check.

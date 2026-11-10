# Whole-product readiness evaluation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** evaluate the complete player experience, implement evidence-backed polish, and provide a truthful 1.0 readiness decision.

**Architecture:** inspect the current source and isolated actual UI first. Preserve the existing focused renderer/core/native components; derive correction tasks from confirmed findings instead of adding speculative integrations.

**Tech Stack:** existing Electron45.2.3/Node24/vanilla renderer/Lua and current Playwright fixtures; no new dependency.

## Global Constraints

Read docs/superpowers/specs/2026-11-10-product-readiness-design.md. No1.0 publication, game input, real player files, audio, account consent, paid inference, installer execution, settings change or recurring watcher. Preserve published tags/assets/key, source ownership, saved/native distinction, follow/manual choices, privacy, queues and current versus original-node test contracts. Reuse the current checkout/feature branch. One implementation worker at a time; independent SPEC/QUALITY review and strongest whole-branch review.

## Task 1: Whole-source product evaluation

Files: read src/renderer, src/core, src/main.cjs, src/preload.cjs, addon, docs and relevant scripts/tests; write ignored work/product-readiness-source-report.md only.

- [ ] Inspect all12 surfaces named in the spec, from welcome through Updates. Trace the nine player journeys, including failure/empty/current-source behavior and actual help/privacy copy against code.
- [ ] Inventory confirmed issues with file:line, trigger, user impact, priority, correction and covering checks. Include UI/information hierarchy, model/provider recovery, cancellation, privacy/data portability, accessibility, update/install resilience and native observation boundaries. Verify the three initial hypotheses rather than treating them as established defects.
- [ ] Provide a feature-gap matrix with before1.0/after1.0/unsupported distinctions. Give player value, data/API/consent/license requirements, cost/maintenance and observable acceptance. Do not propose game automation or invent a complete quest database.
- [ ] Document unverified owner gates separately. Report only evidence actually inspected; no green-suite reruns or production changes for this evaluation.
- [ ] Independent audit-quality review checks coverage and whether recommendations follow evidence. Source report feeds the final assessment and subsequent correction plan.

## Task 2: Actual UI evaluation and baseline

Files: existing scripts and isolated work/product-readiness-* instrumentation/screenshots; no product source mutation.

- [ ] Run the bounded baseline unit runner: `node work/run-v08-unit-suite.cjs product-readiness-baseline`; require zero failures/skips/cancellations, record actual count.
- [ ] Reuse actual Electron/main/preload/renderer fixture patterns with synthetic manual and observed characters, fake model/audio/inference and game launch blockers. Inspect every surface, including narrow/full, loading/unknown/error states; keep GUI fixtures serial.
- [ ] Capture an evidence index with exact viewport/state/source commit. Inspect screenshots and keyboard/contrast/overflow behavior; record limitations for actual DPI, screen reader, live game/audio and clean-machine acceptance. Do not label CSS zoom as real OS scaling certification.
- [ ] Consolidate source/UI findings into docs/PRODUCT-READINESS.md and a user-facing outputs assessment. Preserve priority and unverified gates, with page-by-page coverage and measured evidence.

The next correction spec/plan is written after Tasks1–2 evidence. Its tasks will identify exact files, interfaces, regression commands and acceptance for the confirmed findings; no product code is changed under an unspecified placeholder task. This document is the complete evaluation phase, not an open-ended implementation instruction.

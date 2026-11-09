# Preparation and Professions 0.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development, one implementer at a time and independent SPEC/QUALITY task reviews. Continue through the authorized series without approval questions; only a complete blocker needs human input.

**Goal:** Use observed professions, recipes and carried materials for an honest useful local preparation workshop.

**Architecture:** Pure optional preparation-data validation; guarded existing addon capture; pure shortfall model and trusted latest-state checklist IPC; focused graphical renderer. Preserve existing state/proof/provider boundaries.

**Tech Stack:** Existing Node/Electron, vanilla JS/CSS, Lua/Fengari, node:test and Playwright; no new production dependency/data source.

## Global constraints

Read the full series and 0.10 designs at docs/superpowers/specs/2026-11-09-adventure-series-v09-v012-design.md and 2026-11-09-preparation-professions-v010-design.md. Their exact keys/caps/clock/unknown/provenance/lifecycle/privacy rules bind all tasks. No actual game/profile/credential/mic/inference/launch/install actions or scheduled watchers. Native public observations only outside combat; desktop last-saved. RED before production, canonical temporary roots, bounded hooks, real normal/genuine Windows83. Parent owns version/docs/gates/publication.

## Task 1: Strict observations, local planner and trusted preparation actions

Files: create src/core/preparation-data.cjs, preparation.cjs, preparation-ipc.cjs, tests/preparation-data.test.cjs, preparation.test.cjs, preparation-ipc.test.cjs, scripts/preparation-backend-smoke.cjs; narrow readiness.cjs/validation.cjs/game-sync.cjs/main.cjs/preload.cjs source normalization/integration and affected source/privacy fixture assertions only. No renderer/native/version/data/provider protocol changes.

- [x] Write/observe RED validation/migration, all schema bounds/unknown versus partial/empty, timestamp source ceilings and malformed input before implementation. Export exact validateWorkshop/normalizeWorkshopCapture contracts from design, no root-validation cycle.
- [x] Implement shared strict schema and GameSync normalization, preserving main ownership of captured readiness, old snapshots/backup compatibility and all current guards.
- [x] RED then implement pure buildPreparation and atomic manual createPreparationJourney helper/IPC. Validate current owned profession/recipe, crafts, exact versus lower-bound counts; unrelated character observations stay separate; no fake transfer or craftability/level-up claim.
- [x] Actual Electron synthetic GameSync captures exercise latest facts, renderer-forgery rejection, private context exclusion, manual checklist/no quest proof, reset/import/active selection/restart. Run normal/genuine83, affected core/privacy/Company/Director checks, full units once final. Commit/report exact model/API/TDD/logs/limits work/v010-task1-report.md; independent review.

## Task 2: Guarded native profession/recipe/carried-material collection

Files: addon/BackstageForever/BackstageForever.lua only existing capture resource; new tests/addon-preparation.test.cjs and narrow addon lifecycle/transport fixtures. No desktop/core schema/provider/data/TOC/version edits. Consume Task1 exact schema and normalization.

- [x] RED Lua exact Forever table APIs/learned recipes and counts before capture changes; use pinned research API reference files for signatures, not copied UI implementation.
- [x] Implement bounded collectors/cache/invalidation/coalesced events; no views/filters expanded, crafting, links or storage beyond specified bags. Optional/ambiguous requirements unknown. Keep core character/quest/XP/native guidance useful when new APIs fail.
- [x] RED/implement decoder depth12 and rich multi-character reload roundtrip plus optional-workshop-first budget shedding within existing byte/node caps. Preserve all five managed resources/current HUD lifecycle.
- [x] Run affected Lua/schema/GameSync/resource suites and full units once final. Commit/report work/v010-task2-report.md; independent review and resolve all contract concerns before UI.

## Task 3: Graphical preparation workshop

Files: focused src/renderer/preparation.js/css, narrow app.js/index.html/Company or Director navigation wiring, scripts/preparation-smoke.cjs and actual renderer VM helper dependencies. No backend/native/version/provider/data changes.

- [x] Read Task1 exact public model; RED actual Electron Preparation page and genuine synthetic saved recipe/shortfall before UI.
- [x] Build illustrated class/faction workshop with visible compact primary action, recipe/crafts autosave, dated scope/partial/unknown labels, other-character facts and safe manual/offline empty states. Preserve existing art and readable native controls.
- [x] Use existing queue/epochs/interaction lifecycle for explicit manual shopping-checklist action, retry, Company navigation and stale/reset/import/selection guards. No implicit inference or source-state writes from display preferences.
- [x] Actual physical-click/focus/select/keyboard tests, newer saves/dirty drafts, replaced recipe/profession, partial bags, manual profiles, restart and no secret/journey automatic AI context. Normal/genuine83; capture/inspect fictional full/compact/empty/error variants. Run affected source/VM/full once final; commit/report work/v010-task3-report.md, independent review.
- [x] Parent bumps metadata/current fixtures0.10.0, docs and new required npm/both CI gates; integrated tests/fresh packaged milestone build then begins0.11 spec/plan. Combined signed public0.12 and final whole-series review occur later, no1.0 publication.

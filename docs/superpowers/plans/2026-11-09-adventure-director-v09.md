# Adventure Director 0.9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task, one implementer at a time, independent SPEC/QUALITY review. Continue without design-approval questions under the owner's request to build through 0.12. Steps use checkboxes.

**Goal:** Explain the next useful observed quest action and create a tracked session in one explicit click.

**Architecture:** Focused pure Director over existing guidance and journey mutations; trusted latest-state IPC; focused renderer; guarded native ranking. Existing state/mutation ownership remains.

**Tech Stack:** Existing Electron/Node/vanilla JS/CSS, Lua/Fengari, node:test and Playwright. No new production dependency.

## Global constraints

Read docs/superpowers/specs/2026-11-09-adventure-series-v09-v012-design.md and docs/superpowers/specs/2026-11-09-adventure-director-v09-design.md. Their exact source/privacy/lifecycle/limits and ownership rules bind every task. No game input, live microphone, real user/credential/game writes, paid inference, actual launch/installer or recurring watcher. Desktop remains last-saved, native observations outside combat. Preserve all 0.8 queues/proof/selection/provider/update boundaries. RED before production changes, bounded fixture hooks, actual normal and genuine Windows 8.3 variations. Parent owns version/docs/final packaging/publication.

## Task 1: Director model, atomic session and trusted integration

Files: create src/core/director.cjs, src/core/director-ipc.cjs, tests/director.test.cjs, tests/director-ipc.test.cjs, scripts/director-backend-smoke.cjs; modify src/core/adventure.cjs, src/main.cjs, src/preload.cjs narrowly. No renderer/native/version/data/provider changes.

Interfaces: exact exports and startDirectorSession from the 0.9 design. Integrate `.director` into existing brief/guidance responses. Read existing guidance, journeys, company IPC and Store to use their contracts; do not duplicate validation/baselines.

- [ ] RED pure tests for module/ranking/three-choice cap/source/missing data, private goal locality and session count/reuse/atomicity/selection rejection.
- [ ] Implement pure model and immutable all-or-nothing session with main-owned current log baselines. Bound lookup and deterministic tie-breaking; exact profile/hash/build/baseline reuse across renamed journeys; no private goal text in quest steps or cloud context.
- [ ] RED then implement trusted strict main/preload integration and actual synthetic Electron backend test covering current-state saves, reuse, reset/import, extra args, stale ordinary save preservation and no automatic inference. No production testing bypass.
- [ ] Run focused and full units once final, existing affected command-center/Company/privacy flows as justified and new backend normal/genuine short-path. Self-review/commit/report work/v09-task1-report.md with exact commands/logs/RED/GREEN/limits. Independent task review before Task 2.

## Task 2: Polished Director interface

Files: focused src/renderer/director.js and director.css; narrow app.js/index.html/command-center.js wiring; scripts/director-smoke.cjs and relevant real renderer VM dependency updates. No backend/native/version/provider/data changes.

- [ ] Read Task 1 report for exact model. RED actual Electron primary choice/alternatives and one-click session before adding UI.
- [ ] Implement class/faction Director presentation, saved source/reason/destination qualifiers and existing focus/minute controls; primary Start quest session visible at 1000x700, manual/unknown/prepared/offline states usable. Retain detailed steps; no duplicated second settings system.
- [ ] Use existing mutation queue/epochs and 0.8 interaction guards for stateful action; explicit open Company for returned journey, reuse feedback, pending duplicate protection/error retry. No implicit selection/follow change or AI. Private local goal previews never enter Explain draft.
- [ ] Actual Electron tests: single physical click/held preceding ack/poll, same-ID update and different-character switch during dirty text, stale/reset/import replies, reuse/rename, keyboard/select/contrast/reduced motion, compact/restart and privacy. Capture fictional Alliance/Horde/compact/empty/error previews under work/v09-ui-evidence/ and inspect.
- [ ] Run affected source/VM and new Director normal/genuine short-path; full units once final. Self-review/commit/report work/v09-task2-report.md; independent SPEC/QUALITY review.

## Task 3: Native director ranking and milestone gate

Files: addon/BackstageForever/BackstageForeverPlan.lua and focused addon-plan/live tests, HUD only if existing reserved layout needs narrow reason wiring. No new game APIs/resources/capture/provider/data/desktop changes. Parent handles version.

- [ ] RED Lua cases for same-map/current-source/zone/reported-level ordering, deterministic unknowns and caps before planner edits.
- [ ] Improve ranking and short truthful reason while preserving source/phase rows, explicit waypoint actions, combat/current identity/hide/coalescing/clearing and current source priority.
- [ ] Run affected Lua/resource suite and full units once final, compiler reproduction. Self-review/commit/report work/v09-task3-report.md; independent review.
- [ ] Parent versions 0.9.0 metadata/current fixtures, documents Director and series scope, adds new backend/UI npm and both CI gates. Run integrated checks, fresh packaged milestone build and record acceptance. Then create 0.10 spec/plan. Public combined signed 0.12 and whole-series review occur after later milestones; do not publish 1.0.

# 0.7 Living Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use one implementer at a time, task specification/quality review after each, final whole-branch review before publishing.

**Goal:** Automatic companion preparation, reliable saved-character switching and useful native guidance that updates while playing without routine reloads.

**Architecture:** Pure bundled Lua reference/planner; event-driven native Compass; local desktop runtime/setup and robust multi-account import; single-action beginner setup. Desktop remains last-saved, AI optional.

**Tech Stack:** Electron 45.2.3 / Node, vanilla JS/CSS, Lua, node:test/Fengari and Playwright. No new production dependency by default.

## Global constraints

Read the full design `docs/superpowers/specs/2026-11-09-living-companion-v07-design.md`. All tasks preserve its safety/privacy, boundedness, lifecycle, manual selection, licensing, process-path and freshness rules. Tests use synthetic temp profiles, stub launches and no real game input/paid inference. Keep exact existing source pack, update key and provider boundaries unchanged. Source production fixes require failing regression first. Reuse the current checkout/feature branch; no new worktree is needed.

### Task 1: Reference compiler and pure native planner

Files: create `scripts/build-addon-reference.cjs`, `addon/BackstageForever/BackstageForeverReference.lua`, `addon/BackstageForever/BackstageForeverPlan.lua`, focused Node/Lua tests, generated-file LF attribute. Do not wire TOC/HUD/GameSync yet.

- [ ] Explore normalized pack and existing KnowledgeIndex destination/title semantics.
- [ ] Add failing compiler/escaping/reproduction and pure Lua planner tests for the design's public contract, focus/priority/source/build/title/unknown/coordinate bounds and deterministic step cap.
- [ ] Implement offline deterministic <=1 MiB reference generation with required attribution and safe literal strings; generate tracked resource.
- [ ] Implement the pure planner with current observation priority and conservative source directions; no APIs/game input in planner.
- [ ] Run relevant compiler/knowledge/Lua tests, self-review, commit/report; independent task review and close findings.

### Task 2: Native live guidance, lifecycle and managed resources

Files: capture/HUD/TOC, GameSync owned resource list or shared addon-files module, installer/readback fixtures, focused lifecycle/HUD/Lua tests. Consumes Task1 `BackstageForeverBuildPlan` contract.

- [ ] Write failing event-burst/lifecycle/multi-character/HUD focus+marker tests and five-owned-file readback/repair tests.
- [ ] Wire reference/planner before capture/HUD in TOC, managed five-file preparation and packaged/setup fixture expectations.
- [ ] Add native three-step display, per-character focus/session memory and explicit guarded waypoint click. Preserve fallback/basic HUD and controls.
- [ ] Add bounded feature-detected event coalescing with immediate critical events, safe timer generations and combat/login/logout preservation.
- [ ] Verify current game data changes the displayed plan without reload, stale timer cannot update another session, no automatic marker/action/AI.
- [ ] Run affected addon/game-sync tests and applicable setup/package fixture source checks, self-review, commit/report; independent review.

### Task 3: Runtime-aware setup and multi-account import backend

Files: new `src/core/game-runtime.cjs`, GameSync, main/preload narrow IPC, focused unit/IPC/import tests. No renderer overhaul yet. Define exported public field shape in report for Task4.

- [ ] Write failing tests for runtime tri-state/path/launch safety, no/one/multiple discovery, stale async setup/reset/disconnect, composite snapshots/newest-per-character/follow semantics.
- [ ] Implement bounded cached Windows process metadata probe and explicit validated literal executable launch with injected tests.
- [ ] Implement startCompanion/launchGame handlers and additive status fields, preserving existing APIs and epochs.
- [ ] Import all valid bounded account exports atomically/deterministically; preserve manual selection, notes, sources and stale boundaries; expose partial/omitted counts safely.
- [ ] Run related unit/real Electron integration with stub process/launch paths, self-review, commit/report; independent review.

### Task 4: One-action setup and honest living/saved UI

Files: renderer app/setup helper/CSS as needed, setup/UI/command-center/autosave/integration smoke fixtures; retain global dropdown contrast helper and existing art.

- [ ] Add failing real Electron first-run, prepared-without-snapshot, discovered multiple choices, runtime branch, optional AI, cancellation/reset, per-character switching and 1000x700/reduced-motion cases.
- [ ] Implement Start my adventure, auto single candidate, clear choice/folder fallback, prepared entry without save gate, explicit launch button, quiet next-login activation and optional reload instructions.
- [ ] Remove routine reload nags across relevant pages; distinguish live in-game guidance from last-saved desktop. Healthy setup stays quiet and can be reopened.
- [ ] Verify autosave/dirty fields/focus/privacy and null-selection fixes remain, inspect fictional faction/compact previews, commit/report; independent review.

### Task 5: Integrated release and documentation (parent)

- [ ] Version package/lock/TOC/captureVersion consistently to 0.7.0 and add compiler check to CI/release/unit gates as appropriate.
- [ ] Update beginner/setup/addon/compatibility/privacy/licensing/guidance/roadmap/validation/changelog/release notes, accurately distinguishing fixture and live evidence.
- [ ] Full unit/audit and six meaningful source desktop flows; fresh NSIS build and packaged exact source/data/key plus five owned resources readback/repair.
- [ ] Whole-branch review by strongest available reviewer, consolidate/fix important findings, rebuild/retest changed affected paths.
- [ ] Fast-forward main, tag v0.7.0, publish through existing signed workflow under existing owner authorization; monitor in this session only.
- [ ] Download and authenticate public installer/source/manifest/checksums. If the existing app is open, prepare its normal authenticated update without executing installation. Deliver simple activation instructions and measured limits. No scheduled release watchers.

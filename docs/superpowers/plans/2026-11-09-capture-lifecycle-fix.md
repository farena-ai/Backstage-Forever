# Capture Lifecycle Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent blank active characters and preserve complete captured rosters/progress across reload/logout.

**Architecture:** Canonical validated-state selection, and explicit addon login/logout lifecycle gates around the existing bounded capture/export functions.

**Tech Stack:** Electron/Node, Lua, node:test, Fengari, Playwright.

## Global constraints

- Preserve valid chosen character, follow preference, notes, credentials, supported API/combat guards and snapshot bounds.
- No game input, paid inference or real SavedVariables edits during implementation tests.

### Task 1: selection and lifecycle repair

Files: src/core/validation.cjs, addon/BackstageForever/BackstageForever.lua, tests/core.test.cjs or tests/profile-sync.test.cjs, a focused Lua regression fixture/test, and an existing isolated Electron fixture if needed.

- [ ] Write failing tests: populated roster/null selection/follow false; existing valid selection unchanged; empty roster null; invalid ID rejected; pre-login events cannot overwrite old saved roster; first login restores and adds a second character; logout/postlogout zero API events preserve last prepared export; new login/reload retains both characters.
- [ ] Observe expected red failures before source edits.
- [ ] Implement minimal canonical selection repair and login/logout gates; add PLAYER_ENTERING_WORLD refresh without input automation.
- [ ] Run relevant core/profile/Lua tests and real Electron UI/integration/command-center tests; inspect for preserved validation/privacy/size boundaries.
- [ ] Commit, independent specification/quality review, correct findings.

### Task 2: release acceptance

Before release acceptance, implement the added dropdown requirement as its own reviewed task: inspect global and page-specific select styles, add meaningful failing real Electron contrast assertions, theme opened options/optgroups and selection with adequate contrast, preserve native keyboard/focus/disabled behavior, and inspect an actual expanded Windows popup. Scope is renderer CSS plus its existing UI fixture, not a new custom dropdown framework. Commit and review the task before the final whole-branch gate. Rebuild after renderer changes.

- [ ] Set package/lock/TOC/captureVersion consistently to 0.6.1; update tests expecting capture version, changelog and beginner release notes.
- [ ] Full unit suite, relevant desktop checks, build/packaged source-resource readback, final review.
- [ ] Publish v0.6.1 through the existing signed release workflow; monitor in this session.
- [ ] Download and verify public signature/version/size/hash; deliver installer and clear installation/reload instructions, documenting limits.

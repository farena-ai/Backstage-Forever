# Game-aware companion implementation plan

> Use subagent-driven-development with explicit file ownership and independent review. Parent integrates main/renderer/release; no concurrent edits to shared files.

**Goal:** 0.3.0 advanced-but-simple WoW Forever companion with saved-character sync, provider model pickers, Ollama Cloud, specialist policy and richer illustrated UI.
**Architecture:** Optional guarded addon -> bounded JSON SavedVariables parser/watcher -> profile merge -> explicitly approved prompt context. Main-only provider catalogs and credentials. Original local graphics.
**Stack:** Electron/Node, Lua addon, existing signing workflow, Node tests/Playwright.

## Global constraints
- World of Warcraft: Forever is the only companion domain. No game memory, input automation, forced reload, hidden pixels, arbitrary code execution or live combat computation.
- Saved snapshots are not realtime; show age and reload/logout write cadence honestly.
- No private account names, paths, tokens or real player fixtures in public source/artifacts.
- Keep existing profiles/notes/goals, schemaVersion 1 backup compatibility and update trust.
- All model queries are catalog reads only; no inference to discover entitlement, no silent provider/model/API-billing fallback.
- No external scheduled watcher jobs; app timers only.

## Task 1: catalogs/provider backends
Own src/core/providers.cjs validation.cjs chatgpt.cjs claude.cjs model-catalog.cjs and matching new/updated provider tests. Consume shared policy module from Task3, do not edit it. Add ollama-cloud validation/key slot; provider API GET catalog adapters, ChatGPT account-specific list, official Claude non-inference catalog or honest unavailable status. Preserve old tests, red-green new behavior. Implement optional profile source/location/race/faction validation; no merging/main changes. Report interfaces work/catalog-report.md, no commit.

## Task 2: game snapshot bridge and addon
Own src/core/game-sync.cjs, addon/BackstageForever/*, tests/game-sync.test.cjs and addon tests. Read design. Implement safe parser/watcher/discovery/connect/one-click own-addon install, generated JSON-only export, runtime guarded Interface16001 and bounded roster. No production game-folder modifications during tests; use synthetic paths/records. Red-green meaningful parser/race/limits/install tests; optional Lua runtime testing coordinated with parent package ownership. Report work/game-sync-report.md. Do not edit main, validation, renderer or package; no commit.

## Task 3: specialist policy
Own src/core/wow-policy.cjs, tests/wow-policy.test.cjs and docs/COMPANION.md only. Export INSTRUCTION and scopeResponse(prompt) -> string|null; central instruction domain fixed and clear off-topic/code/automation refusals before backend billing. Neutral data-only approved selected-character context, useful out-of-combat guidance and uncertainty localized to unsupported facts. Explain policy limits; do not promise perfect semantic classification. TDD and report work/policy-report.md; coordinate imports with catalog agent. No main/provider/renderer changes, no commit.

## Task 4: parent integration/art/UX
Main owns catalog credential isolation/cache invalidation, game profile merge/storage/lifecycle and IPC. Renderer owns graphical roster/situation cards/Game Connection, beginner model select with auto refresh/status, Ollama local/cloud choice, approved active-character context and task-oriented AI. Generate original illustration assets, update sources/notices. Extend real Electron flows and provider/game fixtures before implementation where behavior changes. Inspect wide/compact layout and use no real characters in screenshots.

## Task 5: review/release
Independent review against six owner requirements, fix important issues and run 0.3.0 local/CI/update signing/live-feed checks. Update docs/changelog/compatibility/roadmap/validation; publish via existing tag-only release workflow with source/installer/signature/checksums. Record installed-client acceptance/snapshot latency and catalog-vs-entitlement limitations; no claims of continuous live data or unperformed OAuth/inference tests.

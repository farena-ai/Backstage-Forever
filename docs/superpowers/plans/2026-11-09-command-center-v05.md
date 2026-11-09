# BF 0.5 implementation plan

**Goal:** Deliver the approved character command center, source-backed observed-quest guidance and final visual polish.
**Architecture:** Native addon captures bounded public state, validated local profiles retain journals, deterministic planner rebuilds from saved observations, renderer presents player actions. Optional AI is explicit.
**Tech Stack:** Electron45, CommonJS, vanilla renderer/CSS, Lua, Node24 test runner, Fengari, Playwright.

## Global Constraints

Follow the exact interfaces and trust/delivery constraints in the sibling design. Preserve private notes/goals, encrypted credentials, optional schema1 compatibility, no auto inference, no gameplay automation, no embedded client secret. 0.5.0 is a Windows release, not a store beta track.

### Task1: snapshot and planner backend
Files: src/core/guidance.cjs, adventure.cjs, quest-data.cjs or readiness.cjs, validation.cjs, game-sync.cjs, profile-sync.cjs, providers.cjs, main.cjs/preload.cjs; addon scripts; corresponding tests.
- [x] Write failing guidance/readiness/Lua tests using the design's output shape; run `node --test tests/guidance.test.cjs tests/readiness.test.cjs tests/addon.test.cjs` and confirm expected failures.
- [x] Implement optional readiness and deterministic source-backed planner; add IPC with validated profile selection/options and expose via brief. Friendly capture diagnostics without raw data. Keep errors/secret values out of exports.
- [x] Run unit suite and task review; resolve correctness/security findings before frontend work.

### Task2: command-center UX and final polish
Files: src/renderer/app.js, new command-center.css loaded by index.html; scripts/command-center-smoke.cjs, setup-smoke/preview as needed.
- [ ] Write failing real Electron checks: default plan, automatic session/focus updates, two-character isolation, imported/manual freshness, no inference, no successful dock across pages, game setup remains accessible, 1000x700 controls usable.
- [ ] Build dashboard/roster/readiness/plan cards using task1 interfaces, keep data escaped, preferences local and auto-saved, explicit AI explanation only. Add ornate class/faction polish while retaining original assets and accessibility.
- [ ] Run `npm run test:setup`, `npm run test:ui`, `npm run test:command-center`; capture synthetic previews and inspect Alliance/Horde and compact/reduced-motion output. Task review before integration.

### Task3: docs, integration and 0.5 release
Files: package.json/lock, addon TOC, docs/releases/0.5.0.md, README and beginner/compatibility/privacy/guidance/validation docs; release CI.
- [ ] Document precise supported observed-quest scope, per-toon collection, normal reload/write boundary, provider/cost controls, automatic plan rebuild, diagnostic recovery and unsupported account-link state.
- [ ] Run all136+ unit tests, setup/UI/autosave/integration/command-center checks, `npm run dist` and `npm run test:packaged`; independent whole-branch review; repair important findings.
- [ ] Publish reviewed0.5.0 through existing tag workflow, wait in this session without recurring jobs, verify public production-key signature/hash/size. Offer the real installer and synthetic screenshots; distinguish release availability from actual installed update.

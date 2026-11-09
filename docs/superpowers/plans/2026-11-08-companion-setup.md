# Companion setup implementation plan

> Use subagent-driven-development with separate file ownership and independent final review. Continue within existing build/publication authorization.

**Goal:** 0.4.0 automatically prepares a useful, graphical, game-aware companion and repairs the waiting dead end.
**Architecture:** Packaged external addon resources -> managed game connection with actionable diagnostics -> bounded saved quests/XP -> local briefing and guarded in-game compass; root integrates main/renderer and release.
**Stack:** Existing Electron/Node/Lua, original PNGs plus CSS/SVG interface graphics, Node/Lua/Playwright tests, signed GitHub updates.

## Global constraints
- No game process/memory reading, input automation, forced reload/logout, hidden telemetry, combat decisions or unattended paid AI.
- Readonly public API snapshots, <1 MiB export, schemaVersion 1 compatibility, preserved notes/goals, protected secrets.
- Fields and limits follow the design; absence of quest/progress data never means observed completion or no quests.
- Preserve cancellation, explicit character selection, three-way journal merging and secure update trust.
- No recurring release watcher jobs. Native game settings and unrelated addons are untouched.

## Task 1: managed setup and diagnostics

Own `src/core/game-sync.cjs`, new `src/core/game-discovery.cjs`, matching tests and a packaged-install fixture script if needed. Do not edit main/package/renderer/addon/schema files. Add `prepare(root?)` that connects/repairs installed addon and refreshes, startup repair for already connected folder, clear phases/checks/nextAction, bounded common-drive/registry discovery. Source parser accepts optional quests/progress through shared validation helpers once Task 2 exports them. Owned files include `BackstageForever.toc`, `BackstageForever.lua`, `BackstageForeverHUD.lua`. Parent supplies packaged `process.resourcesPath/addon/BackstageForever` vs source repository addonDir.

- [ ] Reproduce shipped install failure and report exact cause to parent.
- [ ] Red/green repair/diagnostics/discovery/reset tests using synthetic roots.
- [ ] Implement generation-safe install, verify contents, preserve unrelated files and last good profiles.
- [ ] Report API/status shape and limitations in `work/setup-v4-report.md`; no commit/shared edits.

## Task 2: quests, progress and in-game compass

Own `addon/BackstageForever/*`, `src/core/quest-data.cjs`, `adventure.cjs`, `validation.cjs`, `profile-sync.cjs`, `providers.cjs`, relevant provider context in `claude.cjs`, tests for those changes. Do not edit game-sync/main/renderer/package. Export `validateQuestData(value)` and `validateProgress(value)` as normalized clones; GameSync calls them. Export `approvedProfile(profile)` from providers for all transports; no notes/goals/source IDs. Export `buildBrief(profile,{now?})` with observed quests, ready turn-ins, XP, class-aware planning actions and explicit freshness/unknown data. Main bridge exposes this read-only result. Guard public API table fields/scalars, bounded in-memory roster/export, quest/XP events, optional compact out-of-combat HUD with `/bf` show/hide/status. Verify primary API documentation at Gethe/wow-ui-source forever generated QuestLogDocumentation.lua; no unverified navigation/route/NPC claims.

- [ ] Red/green schema, merge/context, briefing and Lua runtime tests.
- [ ] Add guarded quest/XP capture and optional HUD as separate script, loader version 0.4.0.
- [ ] Add local briefing and bounded approved context shared by transports.
- [ ] Report exact return interfaces in `work/adventure-v4-report.md`; no commit/shared edits.

## Task 3: interface graphics

Own new `src/renderer/enchanted.css`, original code-native SVG ornament assets only. Read frontend-design. Root adds stylesheet and class hooks. Deliver sculpted graphical controls, rune/ember atmospheric effects and motion, first-run setup journey/quest-board/XP/guidance card styles. Existing class/faction variables and original PNGs remain. Responsive 1000x700, readable focus and reduced-motion handling. No raster image generation needed to extend UI ornaments.

- [ ] Implement production styles matching hooks parent supplies.
- [ ] Inspect rendering with parent preview fixtures; report `work/graphics-v4-report.md`.

## Task 4: root integration and acceptance

Root owns main/preload, app.js/index.html, package/build, setup UI, docs/scripts/release. Add bootstrap/setup/briefing lifecycle, automatic folder preparation/native fallback and startup managed repair. `prepareGame(root?) -> {state,gameStatus}`; keep existing methods compatible. Persist setup acknowledgement/finish state locally (no credentials) and expose visible reopenable setup. Display the actual reason/next step, auto-progress when a snapshot appears, optional AI, offline/manual escape. Dashboard uses `buildBrief` and explicit context-aware send actions; no automatic inference. Packaged addon extraResources, source-installed package tests install/readback all files. Fix actual owner's empty addon folder with verified release files after local tests; do not start/control game.

- [ ] Extend packaged install regression before production path fix.
- [ ] Implement first-run and migration flow; actionable statuses, setup visibility, quest/XP briefing/context.
- [ ] Run unit, UI, integration, Lua and packaged tests; inspect Alliance/Horde/compact/reduced-motion views.
- [ ] Independent final review, resolve important findings.
- [ ] Build/publish 0.4.0 via tag workflow, verify public signed download, copy verified release to outputs and give next in-game loading step honestly.

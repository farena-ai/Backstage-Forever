# BF0.6 quest knowledge implementation plan

**Goal:** ship exact-ID/build Forever chains, NPC locations, rewards, next-step knowledge and user-controlled waypoint guidance with automatic data setup/refresh.
**Architecture:** CC BY licensed live observation pack + MIT normalizer/cache/lookup, backward-compatible public addon snapshots, source-aware deterministic guidance and common whitelisted AI context, local Quest Guide UI. Keep actual game destinations separate from reference markers.
**Tech stack:** existing Electron45/Node24/CommonJS/Lua/Playwright/Fengari. No new AI or database service dependency required.

## Task2: knowledge engine and native/context integration
Own files: new src/core/knowledge*.cjs, scripts/build-forever-data.cjs, data/forever/*, core guidance/adventure/quest-data/validation/game-sync/profile-sync/providers, main/preload, addon scripts, corresponding tests. Updater task must be committed/reviewed first. Do not edit renderer besides later agreed interface hookup; don't alter version/signing keys.
- [ ] Write failing normalizer/query/guidance/security fixtures from explicit examples/bounds in sibling design. Lock initial source commit/hash/license, normalized factualpack and reproducible compiler. Exclude undocumented prerequisites and narrative descriptions; never merge beta/retail or unknown builds.
- [ ] Implement safe bounded build-specific cache/autorefresh with no personal-data requests, last-good/bundled fallback, opt-out/reset/cancellation/dedup and publisher attribution. Add strict IPC for status/refresh/search/details/clipboard. Original data inputs remain work fixtures; ship normalized factpack and source lock only.
- [ ] Add optional native clientBuild/locale/captureVersion, objective metadata and completed-ID observation through guarded public APIs; propagate backwards-compatible fields without journal loss. Add validated numeric `/bf guide` slash command with user-controlled waypoint and refusal paths.
- [ ] Enrich guidance/brief/context with bounded sourced facts, separate followup candidates and accurate unknown/conflict/source states. Exclude full completed IDs, readiness, notes, goals, account/source identifiers and keys from all provider contexts. Shared preview helper returns actual whitelisted facts.
- [ ] Run unit/Lua/security/real-data compiler checks plus provider/context regressions; report exact API shapes to renderer task. Independent task review and any corrections before Task3.

## Task3: Quest Guide UI and regression acceptance
Own files: renderer helper/CSS/app/index, scripts/knowledge-smoke.cjs, source-backed synthetic preview fixtures. Existing updater renderer changes must be preserved.
- [ ] Write failing realElectron fixtures for automatic enriched plan, exact-ID same-title separation, local search/details/chains/reward choices/source evidence, game-build mismatch/offline/partial coverage, opt-out/refresh/cancel/reset and numeric clipboard commands. No inference during any of these actions.
- [ ] Implement novice-first defaults/current quests, attractive Quest Guide, clear chain status/unknowns, concise data-status/freshness, copy/paste waypoint flow and AI source preview using Task2 interfaces. Preserve0.5 class/faction/compact layout, all prior controls and backup freshness fix.
- [ ] Run command-center/setup/UI/autosave/integration/knowledge checks; capture and inspect synthetic Alliance/Horde/compact previews. Independent task review before final release.

## Task4: packaging, docs and0.6 release
- [ ] Add knowledge tests/data packaging to existing CI/release gates; version0.6.0 in package/lock/addon. Update beginner/source/privacy/licensing/compatibility/updater recovery docs with exact limits and no unsupported verification claims.
- [ ] Fullunit146+ and updater/network/Lua/data checks, sixpriorGUIchecks+knowledge/runtimeupdate, audit, fixedsource packaged build/readback and wholebranch review; resolve all important findings.
- [ ] Publish through tag workflow, wait in thissession without recurring jobs, verify public signature/hash/size and actualElectron interrupted-transfer recovery. Deliver verified installer, source and beginner steps; distinguish availability/integrity from actual installed upgrade.

# Self-contained runtime packaging implementation plan

> Required: subagent-driven-development/test-driven-development; one implementation/GUI/build owner, independent strongest correction review before sealing.

**Goal:** make Claude SDK loading work on machines without the development checkout.
**Architecture:** pin SDK's three existing required peers as production dependencies, strengthen canonical packaged test with isolated application/profile roots and owned resolution checks. No new build tool or runtime permission.
**Tech stack:** existing npm lock/Electron-builder/Playwright/CommonJS; exact design docs/superpowers/specs/2026-11-10-runtime-peer-packaging-design.md.

## Global constraints

Source0.12.3/1.0held/no publication or installer. No actualplayer/game/input/auth/audio/paid/OSsettings/watchers. Preserve all existing authority/privacy/native/cancellation/no-MCP-tools behavior and data/art/addon/native bytes. Allowed existing-peer pins ONLY @anthropic-ai/sdk1.6.0, @modelcontextprotocol/sdk1.32.2, zod4.6.7; keep existing ClaudeSDK0.3.319/jose6.2.16. Offline lock update/no upgrades/new downloads. Previous sealed outputs immutable; failedcandidate/log receipts preserved.

## Task 1: Production peer closure and isolated packaged gate

Files modify package.json/package-lock.json, scripts/packaged-smoke.cjs, docs/THIRD-PARTY-NOTICES.md and precise developer packaging guidance if needed; no application/provider/renderer logic. Existing canonical fixture variables/contracts should remain clear for parent's richer derived actual-feature test; report exact data/profile/app paths and insertion seams.

- [x] Strengthen the REAL canonical packaged fixture first. Create an owned temporary runroot outside repository, separate app and profile siblings, copy win-unpacked into app, launch and restart from copiedcwd with production --user-data-dir and BF_USER_DATA cleared, disable app/reference automatic starts. Load actual SDK/core and resolve @anthropic-ai/sdk, @modelcontextprotocol/sdk/client/index.js and zod (or current public exports) under that copied app's resources, never ancestor checkout/global modules. Preserve all existing source/data/key/quest/nativeSDK/addon5/foreignfile checks. Assert temp root containment before recursive cleanup. Run node scripts/packaged-smoke.cjs against current oldbuild; expected RED missing required peer. Capture receipt before package edits.
- [x] Confirm installed/lockversions match exact pins; promote three peers using npm offline lock operations with --ignore-scripts --no-audit --no-fund as appropriate. Do not alter SDK/jose/dependency versions or add new library download. License/NOTICE review uses installed primary manifests; preserve upstream licenses, add clear ThirdPartyAttribution. npm ls --omit=dev must identify production peers.
- [x] Verify build output resolved targets remain under checkout before rebuilding; npm run pack (directory only, no installer). Run canonical isolated packaged fixture GREEN; both startups and peer paths/Core load must succeed with no inference/login/audio/game. Record concrete counts, paths within copiedresources and original-byte preservation. Cover package metadata/runtime tests if meaningful; parent owns full npmtest/richerreview/ZIP afterward. No stringmirror/vacuous tests.
- [x] Self-review/parse/diff/lock scope, markstepscomplete. BEFOREscopedcommit write .superpowers/sdd/guided-peer-packaging-report.md exactRED/GREEN/buildcommands/productionpeerpaths/licenses/no capabilitychanges/limits. Commit scoped files and report following existing convention, send finalSHA/releaseGUI/buildowner. Strongest fresh source reviewer addendum required before delivery. Parent richer work/guided-packaged helpers may need adaptation to new canonical fixture—document seams, do not edit those owned helpers.

Self-review: copiedapp outsidecheckout is the necessary negative control; cwd alone cannot prevent ancestor module fallback. Explicit peers express existing SDK runtime requirements and preserve public app semantics. No decision about paid services or public release is required.


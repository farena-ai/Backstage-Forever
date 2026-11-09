# Cinematic desktop and automatic updates implementation plan

> Execute using subagent-driven-development. File ownership avoids concurrent edits. Test-first behavior changes and independent final review are required.

**Goal:** 0.2.0 cinematic desktop, authenticated automatic Windows updates, useful Grok/roadmap guidance.
**Architecture:** Main-owned signed-release updater, narrow IPC, local raster art plus CSS material treatments, tag-triggered release signing.
**Tech Stack:** Electron, Node crypto/fs/https, Ed25519, NSIS, Playwright, existing GUI.

## Global constraints
- Brand: Backstage Forever / Backstage Coding / Designed by Frank Arena.
- No game automation, memory inspection, live combat decisions, remote renderer content or credential exposure.
- No OS scheduled tasks, cron, chat automations or release watcher jobs. App runtime timers only.
- Updates execute only installers authenticated by pinned Ed25519 signature plus SHA256/size and strict repository/URL/version binding.
- Never commit or ship signing private keys. Windows Authenticode remains distinct and honestly unsigned.
- Preserve schemaVersion 1 backups and all existing user flows.

## Task 1 — updater core and main integration
Own src/core/updater.cjs, src/main.cjs, src/preload.cjs, tests/updater.test.cjs. Consume assets/update-public-key.pem from parent. Implement protocol and bridge from design. Use injectables for fetch/spawn/timers to test without real installer execution. Write failing tests, verify red, implement, run green. Ensure before-quit waits for final verification/spawn with no recursive quit loops; downloads concurrent with UI cannot survive reset or run after opt-out. Keep automatic checks packaged-only. Store update preferences independently and validate them. Report status contract and actual evidence in work/update-report.md. No package/workflow/UI edits.

## Task 2 — release signing and automation
Own scripts/sign-update.cjs, tests/update-signing.test.cjs, .github/workflows/release.yml, docs/UPDATES.md. Implement signer consuming BF_UPDATE_SIGNING_KEY env (PEM) or parent-provided protected helper; exact envelope/payload contract from design. Validate key matches public key and actual installer version/name/size/hash. Workflow trusted explicit v* tags: validate version, npm ci/tests/UI/integration/dist/package checks, sign manifest with repository secret, publish assets/checksums. Never print private key/token or allow untrusted PR signing. Parent handles secure key generation/secret enrollment and current release publication. Include release-key recovery/rotation, initial 0.1.0 manual upgrade, network/privacy preferences, Authenticode distinction. Red/green tests and report work/signing-report.md.

## Task 3 — cinematic art and renderer integration
Parent owns generated assets, CSS/renderer, package version, GUI tests and screenshots. Generate original landscape locally bundled; improve material/depth/typography/class identity, retain accessible labels/flows. Add Updates navigation/control panel and unobtrusive status/progress. Test new controls red then green and preserve existing tests. No placeholder success states or generated fake live data. Record artwork prompt/provenance.

## Task 4 — review, packaging and publishing
Independent security and UX review, fix important findings, meaningful local and fresh-Windows verification. Update README/privacy/roadmap/changelog/validation, build0.2.0 installer, sign manifest, verify manifest+installer with bundled key, publish confirmed public MIT repo/release. Provide screenshots, installer, source and checksums. Record exact limits: old0.1.0 requires one manual upgrade, Grok still blocked unless separately verified, live accounts/game APIs/clean-machine install status truthful.

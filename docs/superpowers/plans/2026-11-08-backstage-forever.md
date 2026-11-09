# Backstage Forever Implementation Plan

> Execute this plan in the current session using subagent-driven-development; independent implementation units have explicit file ownership.

**Goal:** Working Windows desktop companion and distributable preview.
**Architecture:** Secure Electron main/preload; dependency-light local renderer; plain JSON profiles, encrypted credentials, native file dialogs.
**Tech Stack:** Electron, Node.js built-in test runner, electron-builder NSIS, Playwright for real Electron smoke tests.

## Global Constraints
- Brand: Backstage Forever, from Backstage Coding, designed by Frank Arena.
- No game automation, combat computation, memory inspection, telemetry, remote renderer content, or background AI calls.
- Four providers: Ollama, OpenAI API, Anthropic API, xAI API; subscriptions are distinct from API authentication and billing.
- Keys stay in main, encrypted at rest with safeStorage; no plaintext fallback, no export or renderer readback.
- Confirm GitHub owner/repository before publishing. No release watcher jobs.
- Windows installer is unsigned preview until signing and clean-machine gates pass.

## Task 1: Desktop service boundary
Files: src/core/{validation,store,providers}.cjs, src/main.cjs, src/preload.cjs, tests/core.test.cjs.
Read the design contract first. Write Node tests before implementation for malformed state, profile context privacy, atomic import, fixed cloud origins and loopback-only Ollama. Run `node --test tests/core.test.cjs` red then green. Main exposes exactly the bridge in the design, validates every IPC sender against main frame/local URL, disables navigation/new windows/permissions and uses a CSP. Implement native backup/import/delete dialogs. No keys in state. Network error text is generic. Document actual exports in implementation report.

## Task 2: Renderer and installer integration
Files: package.json, src/renderer/*, assets/*, scripts/smoke.cjs, .github/workflows/ci.yml.
Build an original visual identity with local SVG landscape and crest. Implement all bridge interactions, onboarding, dashboard, characters, goals, notes, provider setup, opt-in context preview, ephemeral chat, backup/import/reset and help. Write a failing Electron smoke test before renderer behavior then run green. Use semantic forms, textContent for untrusted strings and focus states. Install pinned dependencies, build NSIS locally, run `npm test`, `npm run test:ui`, `npm run dist`. No publish command or personal data in artifacts.

## Task 3: Optional addon and beginner documentation
Files: addon/BackstageForever/*, tests/addon.test.cjs, README.md, docs/{GETTING-STARTED,PROVIDERS,PRIVACY,COMPATIBILITY,RELEASING,ROADMAP}.md, SECURITY.md, CHANGELOG.md.
Write structural contract tests first, then a conservative Lua prototype with player-triggered out-of-combat copy panel. No network, executable import, auto install or modifications to game files. Explicitly mark experimental and interface certification pending. Comprehensive novice instructions explain downloading/extracting/installing, independent friend setup, each provider and model selection, separate API access, backups and data/key deletion. Describe manual update flow and unsigned preview limitation. Add dated primary-source links and separate indexed documentation from direct/local verification. Run `node --test tests/addon.test.cjs`. No license choice on behalf of owner; state licensing pending owner decision.

## Task 4: Review and delivery
Inspect all changes against the design; independent review core security and UX. Fix important issues, rerun covering checks. Record test counts, installer SHA256, launch verification and unmet release gates in docs/VALIDATION.md. Initialize local feature branch and commit reviewable source, never push without owner confirmation. Deliver source ZIP, installer and screenshot. Update roadmap and distinguish implemented/verified/planned features.

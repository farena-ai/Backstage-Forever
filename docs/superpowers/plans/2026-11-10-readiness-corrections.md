# Pre-1.0 product corrections

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task, with test-driven-development and independent task review.

**Goal:** correct confirmed whole-product usability/recovery gaps and deliver an assessed, tested review candidate.

**Architecture:** preserve existing Electron/core/renderer boundaries, add bounded request ownership and failure presentation helpers where they reduce shared-state risk. Existing fantasy art and public game observation contracts remain authoritative.

**Tech Stack:** current Electron, Node, vanilla renderer and Playwright; no new dependencies.

## Global Constraints

Binding spec: docs/superpowers/specs/2026-11-10-readiness-corrections.md. Keep 0.12.3 and existing tags/publication unchanged, 1.0 held. Reuse current checkout/branch. No real player files/game input/audio/auth/paid inference/installer/settings/watchers. Preserve source provenance, memory/share consent, safeStorage, follow/manual choices, tools-disabled provider isolation, current/original-node interaction contracts. One implementation worker at a time. All tests synthetic; GUI serial. Write RED/GREEN evidence and exact commands to task reports; commit task files only; independent SPEC/QUALITY gate each task.

## Task 1: Cancellable AI and recoverable questions

Files: src/main.cjs, src/preload.cjs, src/core/providers.cjs, src/core/chatgpt.cjs, src/core/claude.cjs, src/renderer/app.js; focused new src/core/companion-request.cjs if needed; tests/companion-request.test.cjs and existing adapter tests; scripts/companion-recovery-smoke.cjs; docs/PROVIDERS.md.

Interfaces: zero-argument preload cancelAsk invokes trusted backstage:cancelAsk. Main owns request identity/controller and uses CompanionContext invalidation. Adapter ask options gain optional signal; no renderer signal or endpoint supplied. Existing ask result string remains unchanged. New request lifecycle helper must reject stale results even if a fake transport ignores abort. Only matching finally releases ownership. CLI cancellation preserves existing termination/isolation semantics; unconfirmed termination must not silently permit overlapping work.

- [x] Read owning code/tests. Write tests demonstrating hung request cancellation, double Stop, second request, late old fulfillment/rejection, context change and no cancelled-memory draft. Run focused tests and record expected RED before implementation.
- [x] Implement main-owned cancellation; propagate external abort combined with timeouts through response body reads and official CLI, without changing auth/token flow, provider routes or model selection. Explicit Stop and context retirement cancel matching work; validate cancelAsk arity. Preserve sanitizer behavior and no key exposure.
- [x] Add visible Stop response while waiting, retain transcript, show persistent stopped/error state. Offer Edit question after failure/stop; restore only on explicit action, never overwrite newer draft. Do not automatically resend or silently restore previous sharing/memory choices. Keep generation guard and memory review ownership.
- [x] Add actual main/preload/renderer synthetic fixture covering Stop then new ask, late response, navigation/provider/character invalidation, error edit, newer draft preservation and keyboard focus. Run node scripts/companion-recovery-smoke.cjs. Adapters use local fakes only. Run affected unit files via node --test --test-concurrency=1 with explicit paths.
- [x] Document local cancellation limits, self-review, commit and report exact files/commands/results/limitations in .superpowers/sdd/correction-task-1-report.md.

## Task 2: Actionable preserved-data startup failure

Files: src/main.cjs; create src/core/startup-recovery.cjs and tests/startup-recovery.test.cjs; README.md and docs/GETTING-STARTED.md.

Interfaces: a narrowly injected async showStartupFailure({dialog,shell,dataDir}) helper shows an error dialog with Quit/default and Open data folder, no private error text. Open only the exact app-owned directory from app.getPath, handle openPath error safely; app still quits cleanly after the action. No restore/reset/write/move/delete/recursive enumeration in this helper.

- [x] Write failing tests for exact actionable path, unrelated initializer wording, user cancel/default, Open folder, failed folder open, dialog rejection; sentinel state/key bytes must remain identical. Run node --test tests/startup-recovery.test.cjs and record RED.
- [x] Replace broad misleading catch copy with awaited helper and guaranteed quit. Do not automatically diagnose corruption or reset data. Bound user-visible messages; no raw error/key/private file content. Expose actual directory only locally in recovery dialog.
- [x] Add precise safe recovery procedure: close app, preserve a copy of entire folder before manual action, distinguish state.json and credentials.json, restore only a chosen valid profile backup via app after preserving/renaming failed state, memory/credentials exclusion and re-entry implications, contact support with version/category rather than private files. Include exact usual Windows location and dialog-supplied path for custom locations. Fix bootstrap README pointer to actual section.
- [x] Run focused test + affected existing Store tests; self-review, commit, report .superpowers/sdd/correction-task-2-report.md.

## Task 3: Whole-shell accessibility, compact polish and current help

Files: src/renderer/app.js, src/renderer/styles.css, src/renderer/quest-guide.css, src/renderer/voice.css as needed; create scripts/product-polish-smoke.cjs; docs/GETTING-STARTED.md only if necessary.

Interfaces: first shell keyboard control is button[data-action=skip-content]; focuses main#main-content[tabindex=-1], labelled by the stable current-page title in the shell breadcrumb, no hash/URL change. Regional Company/Party/Preparation paints replace their h1, so the shell-owned title provides a persistent accessible name without changing module ownership. No automatic background focus move. AI core controls/actions precede optional voice; voice Stop remains visible while active. Existing action navigation and component lifecycle APIs retained.

- [x] Write actual synthetic Electron failing regression for skip Tab/Enter focus/URL, compact no-model Configure action, configured Send reachable near composer, stopped/error actions from Task1 retained, duplicate manual label and app update title. Use current-control assertions; original-node assertions remain explicit. Run node scripts/product-polish-smoke.cjs for RED.
- [x] Implement focused skip control and focus-visible style. Move optional voice below core composer/sharing/Send controls. Provide inline Configure AI connection when selected model absent; preserve typed draft through navigation. Shorten repetitive introductory copy and compact spacing while preserving privacy/context preview. Keep real manual setup dock suppression and unavailable-folder warning.
- [x] Increase meaningful compact Quest Guide source/action/destination text to readable minimum 12px; preserve hierarchical decorative labels and proven source qualifiers. Correct duplicate Manual journal, rename Windows updates to Backstage Forever updates, neutral/amber disconnected indicator synchronized by root render and header polling.
- [x] Replace Field Guide wall of stale prose with concise task sections linking Company, Party, Preparation, Quest Guide, Game Connection, AI/Connections. Explain local/offline value, native vs saved data, no reload needed for native Compass vs desktop disk saves, explicit optional selected-memory sharing, session chat/no retained audio, backup profiles/plans excluding credentials/memory, import clears memory/disconnects observation, private backup vs portable party file, reference/update network checks separate from AI, practical recovery links. No new provider capability or complete-data promises.
- [x] Run fixture serial at 1440x960/1000x700 and actual Electron zoom200, inspect captured screenshots and keyboard focus; no overflow/broken images. Run affected existing smoke/voice-memory/setup/knowledge fixtures only where changed contracts warrant. Self-review, commit, report .superpowers/sdd/correction-task-3-report.md.

## Task 4: Integrated assessment and review candidate

Files: docs/PRODUCT-READINESS.md; user-facing sibling outputs/Backstage-Forever-Readiness/ASSESSMENT.md; .superpowers/sdd/progress.md; test registration/CI if new fixture requires inclusion.

- [x] Consolidate source audit and measured UI evidence into page-by-page and nine-journey coverage, distinguish fixed issues from roadmap and unverified owner gates. Rank features by value/data/API/license/consent/cost and observable acceptance. Explicitly separate unsupported complete/live-data promises and game automation.
- [x] Run full unit suite once for integrated changed code using bounded work/run-v08-unit-suite.cjs; register/run new serial fixtures and affected existing interaction flows. Inspect final screenshots. Do not rerun green unchanged suites without a concrete reason. Build a local unpacked review candidate only if final source gates pass; no installed app execution or public/version changes. A review-only launcher may pass the same --user-data-dir isolation used by packaged fixtures, with a separate clearly named review folder and beginner instructions; no profile copying, installer, real-account action or automatic launch.
- [x] Strongest independent whole-branch review of e7a5737..final HEAD; fix important findings with fresh focused RED/GREEN and re-review. Mark precise readiness gaps; 1.0 held. Produce final report, commands, file list and evidence links without claiming live game, speech, screen reader or clean-machine certification.


### Task 4 integration checkpoint

Selected corrections Tasks 1–3 are complete and independently approved through `fc8a942`, `7fb5603` and `6b8de7d`; the checked steps above are supported by their correction reports. Assessment, reusable CI commands and the single integrated normal-path unit gate are complete: 594/594, zero failed/cancelled/skipped/todo, `work/readiness-integrated.log`, application-source HEAD `6b8de7dad49d156b73564ea0530c3779b51eff92`. Parent integration completed: 50 targeted units under a genuine alias; recovery normal/actual aliased app-data and product-polish short-environment passes; fresh unpacked build at 1f9e471; 79 packaged source/data/key matches and five-file repair; isolated startup/restart update preferences disabled; all 78 delivered app files match. Strongest final review approves local branch/candidate through the fixture correction42da057 and subsequent documentation. Artifact ZIP/hash verification is the final mechanical delivery record in the sibling review bundle. Remote CI is not run in this local pre-1.0 review; no push or PR is planned. CI registration applies to future authorized pushes/releases. Do not interpret completed bounded corrections as 1.0 acceptance or publication authorization.


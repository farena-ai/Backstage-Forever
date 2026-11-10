# Correction Task 3 — interface, help and keyboard polish

Status: complete; ready for independent review. Repository: Backstage-Forever, branch `codex/pre-1.0-product-polish`; starting base `7fb560330aa55daa73774ce45ef333ca33cb09c1`. Version remains 0.12.3. No dependencies, release, tag, installer, real game data, account sign-in, paid inference, real audio, OS settings or watcher changes.

## Changes

- Added the first shell keyboard button, `button[data-action=skip-content]`, with a visible keyboard focus ring. Enter focuses `main#main-content[tabindex=-1]` without changing the trusted file URL. Main has a persistent accessible name from the current-page breadcrumb title. The skip control uses the existing shell control identity convention.
- Parent-approved plan amendment: Company/Party/Preparation regional paints replace their content h1. The original attempt to assign its ID lost the accessible name during those paints, caught by all-page actual Electron testing. A stable shell-owned title supplies the name without changing feature-module ownership or adding a MutationObserver. The authorized plan amendment is included in this commit.
- Kept question, character-sharing checkbox, public context preview, Send/Stop and Clear ahead of optional voice. Suggestions follow core actions. Optional voice remains expanded and retains its Stop. Added a compact, inline Configure AI connection action when no model is selected; navigation preserves the typed draft.
- Shortened repeated AI introductory prose and compact spacing without dropping privacy/context text. Kept the fantasy class/faction art, existing interaction lifecycles and reduced motion.
- Raised functional quest sources, actions, destinations, quest-row qualifications, chain statuses and reward/NPC source notes to 12px minimum. Decorative atlas microtype retains its hierarchy. Tightened compact decorative banner/detail spacing so the existing game waypoint action and full preceding qualification still fit the original compact boundary.
- Rebuilt Field Guide around six tasks, with existing-page actions for Company, Characters, Party, Preparation, Quest Guide, Game Connection, AI Companion, Connections and Updates. Help accurately distinguishes native live Compass from desktop disk saves, private backups from portable party plans, session chat from explicit local memory, selected per-question sharing from saving, and reference/update network checks from AI. It explains memory/credential backup exclusions, import clearing memory and disconnecting game observation, recovery routes and no audio files. Community/public observations do not imply player eligibility. Existing backup/import/delete actions remain available; the original guide headline remains compatible with the existing smoke fixture.
- Removed duplicate “Manual journal · Manual journal” roster labels, renamed Windows updates to Backstage Forever updates, and added neutral disconnected/amber unavailable status indicators. A shared narrow painter updates current connection-chip text/state both after root render and during actual header polling, without replacing held controls during editing.

## RED evidence before implementation

Command: `node scripts/product-polish-smoke.cjs` in the canonical repository.

The initial isolated actual Electron run failed for eight expected missing/corrected behaviors, rather than fixture launch errors:

1. First Tab had no `skip-content` action.
2. Manual roster contained `Manual journal · Manual journal`.
3. Disconnected chip had no state-specific indicator.
4. Compact no-model Configure AI connection action did not exist.
5. Optional voice preceded Send.
6. Field Guide lacked the Company task link/current boundaries.
7. Backstage Forever updates heading was missing.
8. Compact functional qualifiers measured 10–11px.

Additional actual failures guided corrections: regional h1 replacement broke the initial main label; placing Delete all local data inside a closed disclosure broke the unchanged voice-memory fixture; enlarging source notes initially pushed the unchanged knowledge fixture's compact waypoint action below its viewport; changing the guide headline broke its unchanged smoke contract. These were corrected in production, without weakening existing fixtures.

Final spacing RED: the fantasy button cascade overrode the initial skip rule to `position: relative`, leaving an unintended 45px row above the shell. The added actual computed-position assertion failed (`relative`, expected `fixed`), and configured Send bottom was 665.45px at 984×635. Increasing the skip rule's specificity restored fixed positioning. No privacy text, voice control or functional font reduction was used to recover that space.

## GREEN commands and coverage

All commands below completed successfully, using synthetic isolated data and existing dependencies:

- `node scripts/product-polish-smoke.cjs` — final run after the fixed-position correction: first physical Tab/Enter, on-screen focus-visible skip, no URL/hash change, all eleven shell pages, stable label through regional paints, no widget-driven focus move, actual status polling on current/original held chip, connected/disconnected/unavailable text, compact draft/configuration round-trip, Send keyboard reach before voice, exact shortest viewport fold, functional font measurements, task navigation/privacy text, app heading, computed native select contrast under light/dark preferences, no measured horizontal overflow/broken images, real Electron zoom factor 2 and keyboard skip at that zoom.
- `node scripts/companion-recovery-smoke.cjs` — unchanged Task 1 main/preload/renderer lifecycle covering stopped/error recovery, editable question focus, late success/error isolation, memory ownership and held-review Stop/new request behavior.
- `node scripts/voice-memory-smoke.cjs` — unchanged real renderer with fake audio workers: original held controls, typed node/range/focus, dictation draft/selection, explicit send/save/share/preview, read/Stop and startup/navigation/character races.
- `node scripts/knowledge-smoke.cjs` — unchanged source-aware game/reference waypoint, full compact game qualification and copy-action fold, quests/public preview, retained native control/selection and asynchronous identity/race checks.
- `node scripts/smoke.cjs` — unchanged onboarding/profile/goals/private notes/context/catalog choices, class/faction themes, snapshot draft preservation, provider navigation, guide, safe text, persistence and computed native select contrast/keyboard/focus.
- `node scripts/living-setup-smoke.cjs` — unchanged manual/ready/no-snapshot/setup, unavailable-folder recovery, follow/private journal, timestamps/focus, partial coverage, compact keyboard/reduced motion and lifecycle cases.
- `node --check src/renderer/app.js`
- `node --check scripts/product-polish-smoke.cjs`
- `git diff --check`

The five existing GUI fixtures passed serially after their respective corrections. The final isolated skip specificity change was covered by the final focused product fixture; the whole 19-fixture suite was not unnecessarily repeated. Git reported line-ending normalization notices, with no whitespace errors.

Process exception: one preliminary companion-recovery attempt was started while an earlier product-fixture session was finishing. It failed its first visible Stop assertion. Competing native-window focus is a plausible cause, not established proof; this overlapping run is discarded and is not counted as product evidence. Companion-recovery was then run alone and passed. All subsequent GUI fixture runs were strictly serial.

## Final measured layout and captures

Evidence: `work/product-polish-ui/manifest.json`, 15 final PNG captures. Screenshots are synthetic and were visually inspected at full/compact/original-compact/zoom sizes. Full-page captures show the content below the fold; separate viewport captures establish the original compact fold.

- Explicit `BrowserWindow.setContentSize(1440, 960)` yields renderer 1440×960, document scroll width 1425px; explicit 1000×700 yields 1000×700, document scroll width 985px. These are content dimensions, unlike the baseline's outer window dimensions.
- Original baseline outer window 1000×700 produced renderer 984×635. Final bounded checks and viewport captures explicitly reproduce 984×635 content, document scroll width 969px. No capture claims it is identical to the additional 1000×700 content viewport.
- Configured original-compact question bottom: 410px. Send: y575.453125px, height45px, bottom620.453125px; fully visible within 635px. Gap after question: 165.453125px. Keyboard reaches it before optional voice.
- No-model Configure at 1000×700: y314px, height42px; also asserted fully within the original 984×635 boundary. The draft survives navigation to Connections and back.
- Measured compact reference status, source/build qualification, auto-check action, refresh action, search label, reference toggle and limitation footnote: each 12px. Selected quest source/action qualifications are further covered by the unchanged actual knowledge fixture and inspected saved-game capture.
- Zoom: actual `webContents.getZoomFactor() === 2`, CSS viewport720×480, document scroll width712px. Native `webContents.capturePage()` produces the complete 1440×960 visible zoom capture. The initial Playwright fullPage zoom crop was replaced and is not final evidence.
- All final layout captures: zero broken images and no document horizontal overflow. Current manual/reference browsing and saved-game distinction remains visible.

Key final captures:

- `skip-keyboard-focus.png`: visible fixed skip button and keyboard ring.
- `ai-baseline-compact-viewport.png`: entire configured Send within original compact viewport; local privacy/context review retained.
- `ai-no-model-baseline-compact-viewport.png`: inline visible Configure, draft and checkbox/context.
- `ai-full.png`, `ai-compact.png`, `guide-full.png`, `guide-compact.png`, `quest-full.png`, `quest-compact.png`.
- `quest-baseline-compact-viewport.png`: original compact quest source controls and qualified reference browsing.
- `quest-zoom200.png`: native actual Electron 200% viewport, not a cropped Playwright artifact.
- Unchanged knowledge fixture saved-game evidence: `work/v012-quest-ui-evidence/quest-guide-game-area.png`.

## Self-review, scope and limits

Task 1 AI cancellation and Task 2 startup recovery changes were retained. No feature-module source, backend, version/dependency/package setting or GETTING-STARTED edit was needed. The parent-owned untracked `docs/PRODUCT-READINESS.md` is excluded. The scoped commit contains the four renderer/CSS files, new product fixture, this report and the explicitly authorized plan amendment; regenerated ignored task brief remains working evidence.

These checks establish bounded synthetic behavior, readable computed sizes, inspected layouts and computed native select/option contrast. They do not certify real native popup appearance, screen readers, Windows DPI/high-contrast modes, real voice quality, live provider entitlement/billing, real game behavior, clean-machine installation/update or release readiness. Vertical scrolling remains normal for help, voice, memory, expanded context and zoomed content. Version 1.0 and publication remain held for owner acceptance.

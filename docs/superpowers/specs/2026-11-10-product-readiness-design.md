# Whole-product polish and 1.0 readiness

Owner request: evaluate BF as a whole before 1.0, improve UI and ease of use, correct concrete defects, and identify missing features that matter to players. Reuse the canonical checkout on branch `codex/pre-1.0-product-polish`, based on published 0.12.3 commit975df4516e161c0f6e132d4b7a93a4a5385f014b. Version1.0 remains held.

## Approach

Choose a player-journey evaluation followed by a bounded corrective polish. A visual-only pass leaves usability/recovery gaps; a feature expansion adds unvalidated moving parts. Preserve original fantasy class/faction art and refine hierarchy, readability and useful actions. Evaluate larger integrations by player value, verified feasibility and maintenance burden before recommending them.

## Coverage and evidence

Cover welcome/onboarding, Adventure, Company, Party, Preparation, Quest Guide, Characters, AI Companion, Connections, Game Connection, Field Guide and Updates. Examine first-use, useful populated, manual/unknown, loading, empty, failure/retry and stale/source-replacement behavior where applicable. Assess compact1000x700 and ordinary1440x960 layouts, Windows scaling/zoom boundaries, keyboard/focus, labels/announcements, dark native menus, contrast, reduced motion and content density. Inspect actual renderer/main/core/addon boundaries and representative synthetic UI evidence; distinguish source inspection, actual fixture observations, measured results and unperformed owner checks.

Follow these player journeys: install/update and reach a useful first action without AI; collect/switch characters without losing edits; understand what is live versus saved; choose a next quest and understand destination uncertainty; plan materials/session/party; connect optional AI and recover from failures; review voice/memory/sharing; back up/restore/delete knowingly; find help and recover from a stalled setup/update.

Findings require a reproducible condition or exact source evidence, user impact, priority, proposed correction and validation. Classify release blockers, useful pre1.0 corrections and post1.0 proposals separately. Do not equate missing data with broken setup, inferred coordinates with verified destinations, or a passing fixture with real-player acceptance.

## Implementation policy

After evaluation, write a precise correction plan for confirmed findings. The initial known gaps are outdated in-app feature/privacy help, no obvious non-destructive AI-response stop action, and no direct keyboard skip-to-content route; verify them before implementation. Include coherent visual/readability corrections when supported by screenshots/measurements. Avoid another wholesale redesign or arbitrary new navigation merely for novelty. Keep fixes reviewable, independently reviewed and covered by meaningful actual-module/Electron regressions.

## Binding boundaries

- No1.0 tag/publication. Preserve existing published tags, release assets, update signing key and provider protocols.
- Existing game public-API/SavedVariables/source-ownership/follow/privacy/queue/voice/memory/party boundaries remain. No game input, protected API bypass, hidden live bridge or guessed quest facts.
- Test only isolated synthetic profiles/game folders and fake providers/audio. No real player files, microphone/playback, account consent, paid inference, installer execution, Windows settings or recurring release watchers.
- No new dependency, new third-party artwork, account service or model call for cosmetic/help improvements. Larger missing features receive explicit feasibility/acceptance and roadmap placement.
- Preserve player edits, current control ownership, explicit sharing, negative/unknown states and all original interaction tests. Use atomic current-control observations; do not weaken held-original-node assertions or wait for expected focus to hide races.
- Produce a comprehensive assessment, implemented-fix evidence, honest remaining owner gates and a prioritized roadmap. Tests must support claims; clean-machine, real client/audio and publisher identity remain distinct until actually verified.

Self-review: scope is whole-product evaluation, with implementation decomposed after evidence. Existing authorization covers reversible source fixes. No new external integration, credential or paid action is inferred. Prior completed0.9–0.12 tasks remain complete and are not re-dispatched.

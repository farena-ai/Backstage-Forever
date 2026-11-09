# Changelog

## 0.6.1 — 2026-11-09

- Gave native dropdown options explicit dark backgrounds, readable text and a clear selection state across the app.
- Repaired populated rosters with an empty active selection so the dashboard and character selector agree, preserving deliberate choices and follow preferences.
- Prevented pre-login addon events from overwriting a saved roster before restoration. Preserved the latest prepared export during logout and ignored teardown events until login; world entry refreshes observations.
- Added synthetic lifecycle/selection regressions for multi-character capture and complete saved progress. See docs/releases/0.6.1.md for activation and acceptance limits.

## 0.6.0 — 2026-11-09

- Added a bundled, separately licensed live-Forever reference pack with exact-ID/build lookup, reported quest links, NPC/objective observations, listed rewards and source provenance. Coverage is partial; reference-only cache records do not establish playability or every prerequisite.
- Added local Quest Guide and automatic reference enrichment for saved character plans. Supported complete completion-ID observations allow bounded follow-up candidates with explicit availability uncertainty. No AI connection is required for reference browsing or local planning.
- Added optional client build, locale, capture version and objective metadata through guarded public addon APIs. Completed quest ID sets remain local; all provider routes share a bounded approved reference context and matching preview.
- Added player-controlled numeric waypoint commands with build, quest-phase, combat and public-API checks. BF never moves, targets, fights, interacts, opens game maps automatically or forces a reload.
- Added cancellable build-specific public reference checks, offline bundled/last-good fallback, automatic-check controls and data attribution. Whole-build downloads send no character details.
- Fixed update recovery with bounded fresh retries, interrupted-stream handling, sanitized stage diagnostics, safe partial cleanup and Windows cache-path checks. Newer manifest failures no longer appear as up-to-date; verified older installers remain preserved. Retry and official Releases recovery stay available without weakening signature/hash/size checks.
- See docs/releases/0.6.0.md and docs/VALIDATION.md for release gates, measured results and remaining live-client/installed-upgrade limits.

## 0.5.0 — 2026-11-09

- Added deterministic source-backed observed-quest guidance, automatic plans and bounded session/focus selection without AI or invented routes.
- Added optional local equipped-item/bag-capacity snapshots with strict validation and graceful public-API failure handling; private journals and provider boundaries preserved.
- Added a character command center, per-character automatic planning preferences, compact status, expanded evidence, and class/faction visual polish. Removed the repeated successful-setup banner.
- Added fixed native capture diagnostics and real Electron command-center acceptance coverage. See docs/releases/0.5.0.md for scope and verification limits.

## 0.4.1 — 2026-11-08

- Made Adventure Compass use native WoW dialog artwork and close controls, title dragging, a separate collapse button, compact content sizing and visible hide/show instructions. Position/visibility/collapse persist per character after the updated saved-variable declaration loads.

- Fixed character capture aborting when public class/race/faction APIs return multiple values. This left Adventure Compass waiting and the desktop without a snapshot.
- Lua runtime tests now use realistic multi-return player APIs and reject interpreter stderr even when the interpreter reports exit status zero.

## 0.4.0 — 2026-11-08

- Added first-run/migration companion setup, bounded Forever discovery and fallback folder selection, automatic three-file addon preparation/readback/repair, clear phases and next actions.
- Fixed packaged addon resource placement after a shipped-bundle regression escaped source-only tests; packaged installation/readback is now a required release check.
- Added a local quest/objective/ready-turn-in/XP dashboard and optional draggable/collapsible in-game Adventure Compass, hidden during combat. Desktop snapshots still require voluntary reload/logout.
- Added actual public-API waypoints, up to 25 observed recent turn-ins and optional bounded completed-count; no complete historical quest-name or optimal-route claims.
- Expanded bounded approved public AI context with preview/opt-out; private notes/goals/identifiers stay excluded. Public game race/faction are accepted independently without a fixed race whitelist.
- Added automatic settings/model/profile/note saving, encrypted key saving on blur, retryable status, Enter-to-send and Shift+Enter newline with composition handling. No background inference.
- Added sculpted SVG/CSS controls, gems/runes, ambient motion and reduced-motion/hidden-window handling while retaining original artwork.
- Preserved schema-version-1 optional-field compatibility, stable character edit targets and journals across snapshot imports. Added setup/autosave checks to CI. See docs/releases/0.4.0.md and docs/VALIDATION.md for evidence and limits.

## 0.3.0 preview — 2026-11-08

- Added optional Game Connection with guarded one-click addon installation and five-second saved-snapshot checks. WoW saves on `/reload` or logout, not continuously. Imported roster updates preserve notes/goals; only visited characters are known.
- Added last-played following by default; deliberate profile selection pauses following until re-enabled.
- Added provider/auth-specific model discovery and separate Ollama Cloud native chat with its own key. Catalog requests do not run inference or prove every plan entitlement; failures preserve the selection without paid fallback.
- Made the companion a permanent WoW Forever specialist with local off-topic gating, shared provider policy, saved-context preview and persistent opt-out. Public active-character context now defaults on; private notes/goals and source identifiers remain excluded.
- Expanded graphical roster and planning presentation with nine original class portraits and Alliance/Horde environments, with neutral fallback.
- Retained signed automatic update integrity. Windows Authenticode, real-game acceptance and live subscription acceptance remain separate gates. This entry records implementation, not publication.

## 0.2.0 — 2026-11-08

- Original painted fantasy scenery, dimensional companion medallion, bronze/leather frames, parchment journal and bundled Cinzel/Source Sans 3 typography.
- Automatic authenticated Windows release checks/downloads, install-on-exit, restart-now, manual checks and persistent preferences. Source builds never automatically check or execute installers; 0.1.0 requires one manual upgrade.
- Pinned Ed25519 update manifests, SHA256/size and repository/version binding, bounded downloads, cache revalidation, cancellation/reset protection and tag-triggered signed release publication.
- Updater, signing and UI preference tests; existing profile and provider privacy defaults preserved.
- Clarified Grok inference-isolation work and next acceptance/model-discovery/addon milestones.

## 0.1.0 preview — 2026-11-08

- Introduced Backstage Forever from Backstage Coding, designed by Frank Arena.
- Added a Windows desktop foundation for manually maintained characters, goals and notes, optional AI, provider settings and local data controls.
- Added Ollama, OpenAI, Anthropic and xAI adapter protocols with fixture-based verification; no live cloud certification is claimed.
- Added an experimental out-of-combat manual-copy addon prototype with a required verified interface placeholder. No game files were installed or changed.
- Added beginner setup, provider, privacy, compatibility and manual release instructions.

Preview limitations: unsigned installer and clean-machine/upgrade checks pending; Frank confirmed the public MIT repository farena-ai/Backstage-Forever; addon client/API compatibility unverified; no live bridge or automatic updater. See docs/VALIDATION.md for measured results rather than treating this feature list as an acceptance certificate.

- Added explicit ChatGPT browser subscription authentication and an app-private official Claude Code subscription transport with fixture tests. Real consent/inference acceptance remains pending; xAI API is available while Grok subscription tools/hooks isolation is reviewed.

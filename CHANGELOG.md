# Changelog

## 0.16.2 — a live arrow you can see on real maps, 2026-11-12

- The live arrow on the World Map and radar is now a bright blue arrow on a dark disc (red in combat), with a blue trail, so it stands out on the game's warm, gold zone art. The old gold arrow blended into it.
- Live frames bind only to a character whose live key was read from the addon's saved data; an unknown key no longer falls back to accepting the frame.
- App/lock, TOC and capture metadata align at 0.16.2 preview. **1.0 remains held.**

## 0.16.1 — live position shows in the app, 2026-11-11

- Fixed: the World Map arrow, "● Live" status and the companion's live context ignored every live frame from a real character. The app stores characters under a private digest of the game id, but compared it with the addon's live key (a hash of the raw id), so they never matched. The live key is now learned while reading the addon's saved data; frames from another character are still dropped.
- App/lock, TOC and capture metadata align at 0.16.1 preview. **1.0 remains held.**

## 0.16.0 — real zone maps from your game, live link on by default, 2026-11-11

- World Map and radar now show each zone's real map art, read from the player's own WoW Forever installation (local storage, DB2 map tables, BLP textures) with every explored-area overlay, composed once per game build into a local cache. Nothing is bundled, uploaded or redistributed; the procedural parchment remains the fallback when the game isn't connected or a zone has no art.
- Radar keeps the map's true proportions so terrain and pins line up.
- The live game link is on by default for new installs and every character (an explicit off is remembered); the addon explains the top-left strip once in chat.
- World Map says why your position is not live (WoW minimized, window covered, link off, game not running), clears a stale live arrow, and puts the "last saved" label on a readable plate.
- App/lock, TOC and capture metadata align at 0.16.0 preview. **1.0 remains held.**

## 0.15.1 — pop-out radar, 2026-11-11

- Always-on-top radar window around the live position with nearby pins and a tracked World Map target (direction, distance band, rim arrow); isolated preload/IPC; combat pauses details.
- App/lock, TOC and capture metadata align at 0.15.1 preview. **1.0 remains held.**

## 0.15.0 — World Map, in-game finder and Instance Atlas, 2026-11-11

- World Map page: original parchment cartography with the live arrow, trail and remembered paths; quest, flight, trainer, vendor, herb, ore and personal-find pins with clustering; "Near you"; cross-zone Find; waypoint copy.
- In-game `/bf find` (compiled offline finder, about 900 places) and `/bf way` native waypoints with super-tracking. Managed addon set is now fourteen files.
- Instance Atlas: classic-era baseline plus observed Forever encounters (bundled, CC BY 4.0), difficulty colours for your level, linked quests, entrance waypoints and a World Map deep link.
- App/lock, TOC and capture metadata align at 0.15.0 preview. **1.0 remains held.**

## 0.14.1 — first published tool-using AI and live game link preview, 2026-11-11

- Live-link UI check verifies the Companion side panel line by content, because narrow CI windows hide that panel. No app change. The unpublished 0.14.0 tag is preserved.
- App/lock, TOC and capture metadata align at 0.14.1 preview.

## 0.14.0 — tool-using AI and live game link, 2026-11-11

- AI questions can call seven bounded, read-only local lookups (NPCs, quests with objective NPC locations, items/vendors, travel, approved character, live state, waypoint command) across every provider transport, with a lookup trail on each answer. Models that reject tools get one plain retry on the same provider and model.
- Optional live game link: `/bf live on` draws a calibrated 40-cell status strip; the desktop reads only that strip (about 2 Hz) to know current position, facing, level, target, tracked quest, XP and bag space. Combat freezes details; protected client values stay unknown. No input, memory reads, screenshots or network.
- Verified in the real Forever client: fixed protected-value arithmetic and quest log return handling found during the hands-on check; added `/bf live status` diagnostics.
- Managed addon set is now thirteen files. New gates `test:companion-tools` and `test:live-link`. App/lock, TOC and capture metadata align at 0.14.0 preview. **1.0 remains held.**

## 0.13.7 — packaged validation shutdown and cleanup, 2026-11-11

- Preserve the unpublished 0.13.6 tag, notes and failed receipt. Its packaged application passed startup/restart, 133 reviewed byte matches, SDK loading and twelve-file addon install/readback/repair, then Windows blocked deletion of the disposable test executable.
- Wait for both application shutdown and the exact launched child process to close before restarting or removing the disposable packaged fixture. Revalidate its resolved TEMP parent and owned basename before copying/removing; no installed application or unrelated process is targeted.
- Retry transient Windows sharing/executable locks within one bounded removal budget, and keep stubborn locks or shutdown errors as test failures. The final packaged PASS line now prints only after successful cleanup; all functional acceptance assertions remain intact.
- Align app/lock, addon TOC, emitted capture and current documentation at 0.13.7 preview. No product behavior, dependency, data, game protocol, provider, audio or updater-trust changes beyond version metadata. **1.0 remains held for Frank's hands-on acceptance**; normal CI/build/publication and installed-updater proof remain separate gates.

## 0.13.6 — saved-character preview compatibility, 2026-11-11

- Restore read-only public context previews for an explicitly named stored character while another character is selected. The 0.13.5 candidate failed this existing Company backend contract during Windows validation and was not published; its tag, notes and failed receipts remain unchanged.
- Keep volatile location reports and the current question's report scoped to the selected character. Other-character previews show only that character's approved saved facts, without changing selection, conversation, memory or provider state. Null/omitted profile IDs still resolve to the selected character.
- Preserve strict current-character requirements for sending questions and using memory, the existing public-field allowlist, sharing opt-out and preview/send parity. Add a real-service regression covering retained and draft reports across both preview scopes.
- Carry forward local sourced NPC guidance, conservative current-location reports, cross-tier NPC identity reconciliation, complete-point city checks and connection timing fixes. No dependency, protocol, authentication, audio or update-trust change.
- App/lock, addon TOC, emitted capture and current documentation align at 0.13.6 preview. Windows CI, publication and authenticated installed-updater evidence remain separate gates; **1.0 remains held for Frank's hands-on acceptance**.

## 0.13.5 — local NPC guidance, current-location context and connection timing, 2026-11-11

- Keep Connection checks, optional activation and setup checks in the player's current open or closed state through status paints of the same screen. Preserve focused disclosure summaries; changing screen, character, setup session, folder or journal replacement retires the old choice.
- Bind setup navigation/Refresh checks to their exact physical renderer actions. Wait for the renamed plan's unique current card, exact new Delete label and natural Tab focus after the guarded paint.
- Answer recognized NPC names/IDs locally with compatible observed-build evidence first and a separately pinned CC BY 4.0 historical reference of 616 NPCs / 758 points. Keep build, per-NPC lastSeen and approximate/non-live qualifications; ambiguity and unavailable evidence never become guessed coordinates.
- Prioritize explicit current first-person player reports over old saved locations for AI planning, with shared preview/provider projection and bounded volatile scope. NPC city premises, quotes and historical memory do not report current location; sharing opt-out and cancellation stay intact.
- Preserve private journals, held-input ownership, write-count assertions and original timeouts. No dependency, game protocol, provider-authentication, audio or updater-trust changes. Existing quest data remains separately pinned.
- App/lock, addon TOC and emitted capture metadata align at 0.13.5 preview. Source preparation is not publication or installed-upgrade proof; **1.0 remains held for Frank's hands-on acceptance**.

## 0.13.4 — remaining preview validation and compact Party correction, 2026-11-11

- The 0.13.3 candidate passed voice validation, then failed before publication because the travel fixture expected assistant-history counts to grow across a deliberate sharing reset. Earlier failed tags, notes and evidence remain unchanged.
- Travel acceptance binds each actual main request and terminal result to its current renderer generation, prompt, profile, sharing choice and new reply/recovery identity. Support acceptance uses the current Adventure / Next step breadcrumb. No privacy, cancellation or ownership assertion was removed.
- Party keeps its first manual action inside the actual 984×635 viewport by compacting only its navigation/setup chrome. Existing artwork, role controls and readable labels remain; narrow native 200% layouts retain unclipped identity and scrollable actions.
- Audited all remaining source workflow commands from travel through character guidance; corrected the two concrete later blockers and retained their full gates. No dependency, data, schema, protocol, provider or updater-trust change.
- Package/lock, TOC and actual emitted capture are 0.13.4 preview. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.3 — Voice validation acknowledgement, 2026-11-11

- The 0.13.2 candidate passed Map validation, then failed the voice/memory smoke before publication. Its fixture released held readiness after a physical disclosure click before the queued native cancellation handler was acknowledged. All failed tags, historical notes and evidence remain unchanged.
- Voice smoke now observes native disclosure toggles, main cancellation and stopped state before releasing held readiness, then asserts exact speech-request, command and worker counts remain unchanged. Active/error folding, capability rejection and draft disclosure checks retain their privacy/cancellation assertions. Plan reading explicitly opens the existing folded quest-plan and Voice tools.
- The shared test navigation helper acknowledges native toggle delivery; fresh evidence folders preserve prior captures. No product renderer, audio service, dependency, data, schema, protocol or timeout change.
- Package/lock, TOC and emitted capture are aligned at 0.13.3 preview. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.2 — Map validation acknowledgement, 2026-11-11

- The 0.13.1 candidate passed the full unit suite, then failed the actual Map smoke gate before publication because the fixture read the dossier before its guarded paint completed. The 0.13.0/0.13.1 tags, historical notes and evidence remain unchanged.
- Map acceptance now waits for the exact selected public point ID, pressed controls, dossier title and evidence qualification. Pointer and keyboard actions select different points; the later older-reference click receives the same acknowledgement. Disclosure/profile checks also wait for their expected state. All thirteen gates and original assertions remain.
- Reproduced the old failure and passed the full isolated Map smoke with delayed real InteractionGuard callbacks. No renderer/product behavior, dependency, data, schema, protocol, recovery fixture or timeout changes.
- Aligned package/lock, addon TOC and actual emitted capture at 0.13.2 preview for the existing authenticated updater. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.1 — preview delivery correction, 2026-11-11

- The 0.13.0 candidate failed CI before publication. Its tag and evidence remain unchanged; this patch prepares the same reviewed features for the normal authenticated preview updater. Installed 0.12.3 can update directly once published.
- Corrected recovery fault-injection fixtures to use native Windows canonical paths, including genuine 8.3 temporary roots, with explicit proof that crash/promotion/cleanup injections execute. Production path guards and rollback/crash assertions remain unchanged.
- Replaced 140 full gathering-fixture replays with validated persisted history derived from an actual collected record plus real cap-crossing interactions. Exact 128 retention, oldest eviction, newest 64 export, deduplication, paused/unavailable login and clear remain checked; the 20-second deadline is unchanged.
- Aligned package/lock, TOC and emitted capture version at 0.13.1 preview. No product feature, dependency, data, schema, protocol or signing-trust change. 1.0 remains held for hands-on acceptance.

## 0.13.0 — installed Proactive Adventure preview, 2026-11-11

- Delivers the reviewed local series through the existing authenticated preview updater: proactive native/last-saved desktop Compass, one Professions workshop, native BF Layers and last-saved desktop Map, five-section sidebar, reliable conversation, sourced travel, diagnostics and recovery. Earlier local-review entries below remain historical evidence.
- Adds separate qualified acquisition/insights/travel references with explicit older-build, faction, partial-coverage and approximate-standing-point limits; no game automation, automatic AI or expanded sharing consent.
- Aligns package/lock, addon TOC and actual emitted capture version at 0.13.0. Setup/repair owns twelve files and preserves foreign files. No dependency, schema, protocol or game-build change.
- Requires acquisition validation plus Compass/Profession/Map acceptance in validation and tagged publication. Existing tests and Ed25519 updater trust remain required.
- 1.0 stays held. Real client rendering/gathering/performance, live providers/audio, clean-machine and actual installed upgrade acceptance remain separate owner checks. Publication and authenticated public-download results are recorded separately from this source preparation.

## Unreleased local review — proactive Compass, 2026-11-11

- Added local native and last-saved desktop recommendations for bags, quests, qualified craft attempts and observed profession rank caps, with independent Adventure/Quests/Professions goals.
- Added quiet signature-based native dismissal, guarded current-character callbacks and optional working quest details. Unknown, partial or stale material supply cannot claim readiness; individually valid learned recipes remain useful in partial observed catalogs.
- Added the sixth owned addon module with install/repair coverage, strict read-only desktop IPC and a graphical Adventure coach using existing art and five-section navigation.
- No capture/reference schema, public data pack, native command, provider or version change. Source remains 0.12.3; 1.0 and owner in-client acceptance are held. No release or installer was run.

## 0.12.3 — combined preview checkpoint, 2026-11-09

- Hardened idle fixture selection preparation against real refreshes replacing a previously resolved element. Original current-field text/focus/caret and intentional held-node checks remain; the 0.12.2 app release was cancelled before publication and its tag is preserved.

- Repaired the Quest Guide test's generic-heading wait so chain assertions follow the selected quest's completed detail. The 0.12.1 production workflow stopped before publication; its tag is also preserved.

- Corrected a Preparation retry test that inspected retained old material cards before the genuine read/paint completed. The focus assertion remains; delayed replies and newer deliberate focus receive explicit coverage.
- The 0.12.0 candidate was not published: its release was cancelled when a tag validation exposed this fixture race. Its tag is preserved. The combined public checkpoint is 0.12.3, with unchanged feature scope and update-signing trust.

- Delivered the Adventure Director, Preparation, optional Windows voice/private memory and Party milestones as one update, with 1.0 held for owner acceptance.
- Added an illustrated class/faction Quest Guide atlas, explicit reported chain links, observed reward and source-qualified destination panels, visible unknowns and readable compact controls.
- Refreshed compatible licensed Forever observations through November 9 and separately compiled historical seller facts with strict build/faction/date/partial-inventory qualifiers. Older same-build caches no longer hide a newer bundle.
- Added guarded map-specific/current quest-area observations, preserving direct points and clear area qualification without map-opening or gameplay input.
- Added deliberate portable plan preview/export/import, new manual unassigned imports and explicit selected-supply AI question drafts; no automatic sharing or inference.
- Preserved keyboard/native-control focus, drafts, queued saves and error ownership across source/character/navigation/reset/import changes. See the release notes and validation evidence for scope and measured limits.

## 0.11.0 — development milestone, 2026-11-09

- Added optional fixed local Windows speech, visible hold/release draft input, explicit reading/Stop and typed fallback with bounded process/protocol ownership.
- Added reviewed main-owned per-character saved exchanges, separate per-question selection/preview parity across providers, and memory exclusion from backups/replacement import.
- Preserved context, privacy and stale-effect boundaries; real microphone/voice quality remains owner-led acceptance. Delivered publicly with 0.12.


## 0.10.0 — development milestone, 2026-11-09

- Added a graphical Preparation workshop using observed owned professions, learned recipes and carried materials, with per-character recipe/batch preferences and source dates.
- Added exact shortfalls only for complete applicable bag observations; partial/unknown quantities remain explicit and other characters are never silently pooled.
- Added deliberate atomic manual shopping checklists in Company, without crafting, purchases, transfer or invented quest proof.
- Added guarded native collectors and dated caches, plus deep snapshot reload and both byte/node export budgeting that preserves collected characters before optional workshop detail.
- Preserved dirty input, held controls, native dropdown readability and compact navigation. Public delivery remains combined into the 0.12.3 checkpoint.


## 0.9.0 — development milestone, 2026-11-09

- Added explained Adventure Director choices and one-click tracked Company sessions, ranking all bounded eligible quests before the visible cap.
- Added native current-map/zone and level-aware ranking with factual reasons, qualified source labels and unknown-objective fallbacks.
- Preserved held mouse/keyboard/native-control actions and disclosure focus across queued updates with a shared renderer interaction guard.
- Private goals remain local; no automatic AI, gameplay actions or new reference data. Combined public delivery is the 0.12.3 checkpoint.


## 0.8.0 — 2026-11-09

- Added Company, a saved-character overview with source-labelled ready turn-ins, private goals and known preparation facts, preserving deliberate selection/follow behavior and class/faction artwork.
- Added local cross-character journeys and editable quest-session/dungeon-preparation checklists, with bounded migration, autosave, backup/restore and orphaned-character handling.
- Linked steps to observed saved quests and retained new compatible completion evidence without treating ready objectives, disappearance, historical repeatable completion or missing data as a new turn-in.
- Preserved private journey contents outside automatic AI context and protected game-owned evidence from ordinary form saves.
- Added a quiet live native bag-space cue from existing supported observations, with unavailable/zero-capacity, combat, character/session and layout guards. No gameplay automation, new data source or AI charge is introduced.

## 0.7.0 — 2026-11-09

- Added a bounded pure native quest planner and offline, source-labelled Lua reference compilation. Current out-of-combat game observations update native guidance without routine reloads or desktop AI.
- Expanded Adventure Compass with per-character focus/session preferences, compact current steps, explicit guarded waypoint action and reserved source/phase labels. Combat hides it; lifecycle generations prevent old timers or actions crossing character sessions.
- Prepared five managed addon files with staging/readback, module-first/loader-last commit and bounded application rollback; unrelated files remain untouched.
- Added runtime-aware setup and explicit validated client launch, safe unknown-status fallback, single-install automatic preparation and clear multiple/no-install choices. No initial desktop snapshot or AI connection is required to enter a prepared companion.
- Combined valid account exports with per-character timestamp guards, stable identity and partial/capacity reporting. Re-enabling following can apply the current connection's known saved active character immediately without a new save; private journals and deliberate selection remain protected.
- Clarified native live guidance versus last-saved desktop/AI context and removed routine level/zone reload nags. See docs/LIVING-COMPANION.md, docs/releases/0.7.0.md and docs/VALIDATION.md for activation, evidence and limits.

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

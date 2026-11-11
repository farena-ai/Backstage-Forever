# Backstage Forever product roadmap

## Find your way around

The journal has five main sections: **Adventure** for your next step, **Quests** for the saved quest atlas, **Companion** for questions and local travel, **Characters** for your roster, and **Plans** for checklists. Adventure contains **Next step** and **Professions**, the single saved workshop. Plans contains **My plans** (formerly Company), **Party**, and a shortcut to Professions. **Settings** contains **Game connection**, **AI connection** (formerly Connections), and **Updates**. **Help → Field guide** contains support reports, recovery checkpoints, and backup tools.

Voice, Memory, and quest reference details open when you need them. Folding Voice stops pending or active speech. The memory summary always shows how many exchanges are selected for this question; saving an exchange does not consent to sharing it. Provider costs and character-sharing choices remain visible. Local travel has a **Show road guide** shortcut when a road alternative is documented; **How we know** holds dated source details. These are guides and manual plans, never game actions.

Manual character creation offers Forever's nine confirmed classes plus Other. Existing imported or custom class names remain unchanged. Original class and faction artwork remains in use. The source display version is 0.12.3; 1.0 publication remains held for owner review.


Updated 2026-11-09 (America/Chicago). The 0.9–0.12 series is implemented as the combined 0.12 preview checkpoint. Publication and measured acceptance are recorded separately in VALIDATION.md; 1.0 remains held for Frank’s hands-on check. Later research items are proposals, not delivery promises. Backstage Coding; designed by Frank Arena. BF should make the next useful action obvious, using verified Forever facts and the player's actual progress. More UI or more model calls are not acceptance criteria.

## Foundation through 0.5

Windows companion, guided addon installation, local profiles, public character snapshots, observed quests/objectives and XP, optional provider connections, encrypted credential storage, signed app-update manifests, and original class/faction artwork. The live client now demonstrates character capture, quest/XP display, race/faction import and desktop snapshot import. Native Compass styling, title dragging, close/collapse controls and reopen instructions have been observed or fixture-tested; see VALIDATION.md for the exact boundary.

0.5 adds a compact character command center, deterministic observed-quest plans, per-character session/focus preferences, source evidence, optional local equipment/bag observations and friendly native capture diagnostics. Live acceptance recorded for 0.4.1 does not certify every new 0.5 API field; see VALIDATION.md for measured results.

Desktop data still reaches disk through player-triggered reload/logout. In-game out-of-combat UI can update from supported events. BF is not a continuous desktop feed, complete quest database or autonomous game controller.

## Successful setup stays quiet in 0.5

The repeated successful setup dock is suppressed after a valid current-folder import. Incomplete setup actions and the Game Connection setup entry remain available. Compact connection/freshness status replaces the permanent success message.

## Character command center: 0.5 delivery and continued research

- Compact connection health and explicit freshness: live in-addon observation, last disk save, last account-API update, missing data and errors have distinct labels.
- Automatically collect each character visited with the addon enabled, preserving private journals and intentional active-character selection. Explain first-login collection once during setup.
- Research and validate optional official Battle.net account linking for a broader initial roster. Offline/addon mode remains usable without an account login. Handle multiple WoW accounts/regions and missing/low-level characters without silently deleting profiles.
- Verify Forever identity semantics (first name, surname, ruleset versus realm), stable IDs and source precedence. Migrate existing profiles safely and offer deliberate merging of manual/imported duplicates without losing notes.
- Add supported public equipment, bags, professions, skills, talents, currencies, travel access and quest-completion IDs incrementally. Unavailable/protected fields stay unknown.
- Make imports idempotent and resilient to partial files, stale API responses, malformed fields and unexpected runtime errors. Actionable addon diagnostics replace indefinite waiting.

Acceptance: two characters retain separate correct data and notes across reload/logout/restart; identity mapping is confirmed in the real client. Optional roster linking must pass real consent, multiple-account, refresh/expiry, revoke, stale/missing-character and encryption tests before being advertised.

## 0.6: Forever quest reference delivery

0.6 introduces a bundled, licensed Efficient Games live-Forever reference pack, build-specific automatic refresh, exact-ID quest details, reported chain links, NPC/objective positions, listed rewards and source-aware follow-up candidates. Local Quest Guide needs no AI account. Player-controlled waypoint commands use supported native APIs with build and quest-state checks. The updater gains bounded retries, stage-specific recovery and safer cache handling. See FOREVER-DATA.md and UPDATES.md for scope and measured limits.

This is a coverage-limited reference layer, not certification of every quest or a complete prerequisite and travel graph. Next data milestones are:

- Expand measured quest/NPC coverage across more zones and live client builds; add prerequisite conditions only when their meaning is verified.
- Extend the licensed reference layer to item acquisition, spells, class/race differences, professions, vendors and travel where suitable sources exist.
- Prefer supported official game/API data. Evaluate community sources individually for accuracy and licensing; do not copy a guide database or AGPL code into the MIT product by assumption.
- Every recommendation can show its source, game version, freshness and reason. Separate observed facts from estimates and AI wording. No invented quest chains or coordinates.
- Validate representative guidance against real Forever play, then expand coverage. Offline caches remain useful without a model/provider connection.
- Extend reported chain links into a route planner that respects verified conditions, actual completed IDs, active objectives, level, travel access and user goals. Do not infer hard prerequisites from correlations.

Acceptance: representative route fixtures cover prerequisites, inaccessible content, missing data, updated quests and both factions. Validate the initial content slice in Forever. Measure dead-end suggestions, factual correctness and coverage before expanding.

## 0.7: Living Companion

This release focuses on three practical improvements: prepare the companion with one primary setup action, import/switch saved characters reliably, and keep useful native quest guidance changing during play without routine reloads. The bundled native reference/planner can work with the desktop closed. Five managed addon resources are staged, verified and repaired together; explicit player clicks can show supported waypoints. Current game observations and qualified community facts remain distinct.

Setup distinguishes prepared files, a running game and the last saved capture. A first desktop snapshot and an AI account are not prerequisites for entering the app once files are prepared. Saved account exports are combined conservatively, and re-enabling following can apply an already-known saved active character without another logout. Local runtime checks and explicit launch use only the configured validated client.

Acceptance: no routine reload prompt for native progress updates; no stale action from another character/session; correct snapshot imports despite another character's later save; no/multiple-install choices and unknown runtime remain usable; journal/provider/privacy boundaries preserved. Synthetic fixtures, packaged resources, signed publication and real-client acceptance have separate evidence in VALIDATION.md.

### Further adventure-coach work after 0.7

- Extend the existing next-step plan with source-backed alternatives for nearby objectives, turn-ins, travel and preparation, explaining why each action helps.
- Extend existing 15/30/60-minute session preferences with relaxed exploration, profession progress, dungeon preparation and other player-selected goals.
- Recompute deterministic local plans after a new permitted snapshot. The native addon provides supported out-of-combat progress cues without requiring cloud AI. Desktop plans explicitly retain last-save freshness.
- Contextual reminders: a ready turn-in, prerequisite satisfied, relevant training, low supplies or gear worth reviewing, only where supported data justifies it. Quiet mode, cooldowns and relevance filters prevent notification spam.
- Optional persistent per-character conversation/session memory with clear review/delete controls; private journal sharing remains separate and explicit.
- Optional background AI summaries require explicit enablement, cost/rate limits, cancellation and caching. No model call for every game event, no silent API fallback.

Acceptance: correct next actions from recorded play scenarios, no repeated reminders or surprise inference costs, cancellation and provider outages leave the local planner working. Measure time to first useful suggestion and recommendation usefulness with players.

## 0.8 Adventure Company: planning foundation

Company brings collected characters, saved ready turn-ins, private goals and preparation facts into one overview. Shared local journeys span characters; player-owned steps and editable quest/dungeon checklists remain useful offline. Steps linked to saved observed quests can retain newly proved completion while respecting baseline, identity, build, repeatable and history-availability boundaries. Merely viewing Company does not change selection or following.

Native Compass gains a quiet low-bag-space cue using existing permitted observations, without notification spam or extra inference. Desktop journeys remain last-saved; a continuous transport or new account login is not implied. Privacy, backup/migration, stale responses, source ownership and orphaned-character steps are release gates.

### Further account-wide progression and data work

The following remain research or later releases; the 0.8 planning foundation does not establish their source coverage or implementation:

- An alt roster showing which character has relevant professions, materials, gear or unfinished goals, limited to verified collected data.
- Shopping/crafting plans, reagent shortfalls, profession paths and suitable gear-upgrade options with acquisition sources.
- Dungeon preparation tailored to class, level, actual gear and role preferences; player-controlled group checklists.
- Auction price context only after validating Forever endpoints, source coverage, rulesets/faction handling, freshness and rate limits. Do not label a stale listing as a guaranteed buy or profit.
- Completion journeys and cross-character goal planning without treating observed recent turn-ins as a complete history.

Acceptance: account/source boundaries, freshness and missing characters remain visible; no automatic purchases, mail, trading or gameplay actions.

## 0.9: Adventure Director

- One explained primary quest action and up to two alternatives, selected from all eligible captured candidates before applying display limits.
- Respect current game destinations, qualified references, observed map/zone and reported level; unknown class/race/faction requirements remain unknown.
- One explicit action creates or reuses a tracked Company session with current saved baselines. Private goals remain local and do not enter automatic AI context.
- Improve native local ranking and reasons without routine reloads or gameplay control. Preserve compact first-screen actions, drafts and keyboard/pointer/native-select behavior.

Acceptance: deterministic source-backed choices, atomic session/reuse, correct character/follow behavior, private context exclusions and real Electron/Lua lifecycle checks. Session length is a choice limit, not an estimated duration.

## 0.10: Preparation and Professions

- Guarded observations of owned professions, learned recipes/reagents and specified carried bags through Forever-compatible public APIs.
- Simple recipe/craft-count selection, exact shortfalls only when observations support them, and honest partial/unknown states.
- Separate dated observations from other collected characters; no automatic assumption that materials can be transferred.
- Graphical workshop and deliberately created manual shopping checklists. No crafting, item use, purchase or bank/account-storage automation.

Acceptance: exact-build API shapes, strict bounds/source ownership, cache/session isolation, rich capture/reload/budget preservation, unknown versus empty counts, local privacy and compact accessible UI. Item acquisition suggestions require separately qualified sources; no invented vendor/drop/skill-up path.

## 0.11: Optional voice and conversation memory

- Optional push-to-talk questions, interruptible spoken replies and hands-free reading of an explicitly requested plan. Microphone activation is visible; no always-on recording by default.
- Local Windows speech where available, editable transcript review before Send, interruptible reading and a typed fallback. No surprise cloud transcription or audio recording persistence.
- Explicit per-character saved exchanges with review/delete; choosing to store an exchange does not automatically send it with later questions. Private journals/goals/journeys stay excluded.

Acceptance: safe capability discovery, bounded/cancellable microphone and output lifetimes, no automatic inference, per-character isolation and identical selected-memory preview/send across provider modes. Live microphone/recognition/playback and consent remain owner-led checks.

## 0.12: Party planning and the Quest Guide presentation/data pass

- Preview/export/import user-approved party plans and dungeon checklists. Imported plans are new manual, unassigned steps without captured completion proof. No messages to friends/guild channels or automatic game actions.
- Rich quest/destination dossiers and coordinate views with class/faction art, readable evidence, map/date/phase labels and useful missing-point states.
- Refresh the compatible licensed Forever snapshot, improve guarded public game destination capture and measure source coverage. Retain reliable points rather than import incompatible or unlicensed locations.
- Separately compiled same-build historical supply-vendor facts preserve the existing quest-cache protocol. Historical reactions/locations do not guarantee access, current stock or prices.
- Final visual pass: consistent class/faction tokens, spacing, icon hierarchy, control states and polished empty/error screens; restrained transitions rather than effects competing with the game.
- Verify 100/125/150/200 percent Windows scaling, compact windows, keyboard/focus, contrast, screen readers, reduced motion and low idle CPU/GPU. Native addon styling must fit WoW and remain unobtrusive.

Acceptance: a new user can connect, import, select a character and get useful guidance without knowing AI terminology. UI remains responsive alongside the game and graphics have measurable frame/idle budgets. Automated gates precede the combined signed 0.12 release; the owner performs [the hands-on check](OWNER-CHECK-012.md) before any 1.0 release-quality decision.

## 1.0 quality bar

- Verified installation, update, rollback/recovery, uninstall/data preservation and publisher signing path on supported Windows systems.
- Tested game-client compatibility matrix and real end-to-end multi-character acceptance, not just source fixtures.
- Model/provider outages, expired logins and rate limits have clear recovery; API/subscription access remain distinct.
- Secret storage, source-data licensing, local deletion/export, optional service retention and privacy documentation reviewed.
- Versioned recommendation evaluation set and a published supported-content scope. No claim to cover every quest until coverage is measured.

## Architecture and permitted automation

Use three complementary layers: the native addon observes permitted public out-of-combat game state and displays immediate local cues; the desktop owns encrypted providers, local profiles, rich planning and versioned knowledge; optional supported account APIs enrich roster and historical/profile data. A source-aware context model reconciles them by freshness and authority. Do not invent a hidden live bridge across the SavedVariables disk boundary.

Automate setup, addon repair, imports, local rule evaluation, plan rebuilding, reminders, model discovery and app updates. Preserve player control of movement, targeting, combat, purchases and game actions. Never use memory reading, injection, protected-value bypass or simulated gameplay input. Information, preparation and decision support provide value without a botting feature list.

## Evidence for optional account roster research

BF's current addon exports only characters that execute its capture events; another toon must be visited to supply its detailed snapshot. Existing local character directories can at most provide incomplete discovery hints, not authoritative level, inventory or quest state.

A third-party API author's direct tests report a Forever account profile and character/media endpoints: https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334 and https://github.com/Pinta365/blizzard_api#readme . The author explicitly describes the interface as undocumented, reports level-10/logout eligibility, delayed account data, and Forever-specific identity semantics. These are research leads, not Blizzard support guarantees or BF live certification. Verify with an authorized user session before product promises.

Battle.net linking is separate from AI-provider login. Use registered official authorization, narrow scopes, state/PKCE where supported, encrypted local tokens and revoke/delete controls. Never embed an application client secret in a distributed desktop binary; if a confidential-client exchange is required, design a minimal secure service and disclose its data handling before implementation. Do not scrape account passwords, session cookies or account-switching screens.

No scheduled release watchers or external recurring jobs form part of this roadmap.

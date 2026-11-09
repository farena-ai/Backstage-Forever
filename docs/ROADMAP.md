# Backstage Forever product roadmap

Updated 2026-11-09 (America/Chicago). Proposed milestones, not delivery dates or claims of shipped support. Backstage Coding; designed by Frank Arena. BF should make the next useful action obvious, using verified Forever facts and the player's actual progress. More UI or more model calls are not acceptance criteria.

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

- Build a licensed, versioned knowledge layer for quests/prerequisites/rewards, NPCs/coordinates, items, spells, class/race differences, professions, vendors and travel.
- Prefer supported official game/API data. Evaluate community sources individually for accuracy and licensing; do not copy a guide database or AGPL code into the MIT product by assumption.
- Every recommendation can show its source, game version, freshness and reason. Separate observed facts from estimates and AI wording. No invented quest chains or coordinates.
- 0.5 ships source-backed guidance for the observed quest log. Next, validate a small external zone/level knowledge slice, then expand coverage. Offline caches remain useful without a model/provider connection.
- Introduce a quest-chain graph and route planner respecting actual completed IDs, active objectives, faction/race/class restrictions, level, travel access and user goals.

Acceptance: representative route fixtures cover prerequisites, inaccessible content, missing data, updated quests and both factions. Validate the initial content slice in Forever. Measure dead-end suggestions, factual correctness and coverage before expanding.

## Milestone 0.7: proactive adventure coach

- A one-click “What should I do next?” action returns a short executable-by-the-player plan: nearby objectives, turn-ins, next destination, why it helps and optional alternatives.
- Session goals such as “I have 30 minutes,” relaxed exploration, profession progress, dungeon preparation or leveling efficiency influence recommendations.
- Recompute deterministic local plans after a new permitted snapshot. The native addon provides supported out-of-combat progress cues without requiring cloud AI. Desktop plans explicitly retain last-save freshness.
- Contextual reminders: a ready turn-in, prerequisite satisfied, relevant training, low supplies or gear worth reviewing, only where supported data justifies it. Quiet mode, cooldowns and relevance filters prevent notification spam.
- Optional persistent per-character conversation/session memory with clear review/delete controls; private journal sharing remains separate and explicit.
- Optional background AI summaries require explicit enablement, cost/rate limits, cancellation and caching. No model call for every game event, no silent API fallback.

Acceptance: correct next actions from recorded play scenarios, no repeated reminders or surprise inference costs, cancellation and provider outages leave the local planner working. Measure time to first useful suggestion and recommendation usefulness with players.

## Milestone 0.8: account-wide planning and progression

- An alt roster showing which character has relevant professions, materials, gear or unfinished goals, limited to verified collected data.
- Shopping/crafting plans, reagent shortfalls, profession paths and suitable gear-upgrade options with acquisition sources.
- Dungeon preparation tailored to class, level, actual gear and role preferences; player-controlled group checklists.
- Auction price context only after validating Forever endpoints, source coverage, rulesets/faction handling, freshness and rate limits. Do not label a stale listing as a guaranteed buy or profit.
- Completion journeys and cross-character goal planning without treating observed recent turn-ins as a complete history.

Acceptance: account/source boundaries, freshness and missing characters remain visible; no automatic purchases, mail, trading or gameplay actions.

## Milestone 0.9: voice, presentation and player-driven sharing

- Optional push-to-talk questions, interruptible spoken replies and hands-free reading of an explicitly requested plan. Microphone activation is visible; no always-on recording by default.
- Rich route/quest cards and accessible map views where data and asset licenses permit. Actual character media is optional after supported API availability, user consent and rights are verified.
- Share/export a user-approved party plan or checklist. No messages to friends/guild channels without an explicit player action.
- Final visual pass: consistent class/faction tokens, spacing, icon hierarchy, control states and polished empty/error screens; restrained transitions rather than effects competing with the game.
- Verify 100/125/150/200 percent Windows scaling, compact windows, keyboard/focus, contrast, screen readers, reduced motion and low idle CPU/GPU. Native addon styling must fit WoW and remain unobtrusive.

Acceptance: a new user can connect, import, select a character and get useful guidance without knowing AI terminology. UI remains responsive alongside the game and graphics have measurable frame/idle budgets.

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

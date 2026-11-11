# The Forever companion

Backstage Forever is permanently specialized for **World of Warcraft: Forever**, played in Blizzard's dedicated client. Every question in the companion screen assumes that game. The assistant should never ask which game “Forever” means.

Use it for class and leveling choices, zone and quest planning, dungeon preparation, professions, gear principles and group plans outside combat. Macro and addon setup/configuration can be discussed; the companion cannot execute code. It does not control inputs, inspect game processes or memory, make live combat decisions, automate farming or bypass anti-cheat.

## Automatic local guidance

Adventure builds a deterministic plan from your saved observed quest log without calling a provider. Session/focus controls save per character. Each step retains its reported source and save timestamp. Turn-ins and unfinished objectives can be prioritized, but unobserved prerequisites, NPCs and routes are not invented. Explain my plan drafts a public quest question for review; you still choose whether to send it. Equipment/bag preparation details stay local and are excluded from automatic provider context. See [Guidance](GUIDANCE.md).

## Local NPC reference

Ask an NPC location by full name, a unique short name, or exact **NPC #ID**. Recognized names and explicit NPC questions are handled locally before model/key/provider access; no AI account is needed. Ambiguous names ask for an exact ID, and unknown/unavailable evidence stays unknown. Ordinary material, item, bank and geography questions retain their existing planning path.

The resolver prefers compatible observed-build points, then a separate historical reference containing 616 NPCs and 758 interaction points from Forever build 1.60.1.70790. Answers retain build, per-NPC lastSeen, source and approximate/non-live qualifications. Cairne's historical Thunder Bluff point around 59.9, 51.7 was last observed November 5, 2026; the file's November 9–11 collection dates do not change that observation. Asking where in Orgrimmar he is does not prove his presence there. No automatic route, waypoint or game action is created.

A direct **I'm already in Org** statement can supply a user-reported planning city for the retained conversation. The preview shows that source and keeps the old saved location separate; old mine coordinates are never attached to a newly reported city. Reports expire with their retained turn (at most six exchanges) and clear with existing character/provider/source/sharing/memory/clear boundaries. Failed/cancelled questions cannot retain a new report. Quotes, past/future/hypothetical statements, AI replies and saved memory cannot create one. Sharing off omits automatic character context. Desktop location remains last saved even if its timestamp is today; native Compass updates inside the game.

## Character context and honest uncertainty

0.6 adds bounded relevant Forever reference facts to the shared approved context: compatible exact-ID quest links, NPC/reference coordinates, listed rewards, chain status and source provenance. The same whitelist supplies the visible preview and every provider route. Character-sharing opt-out applies to these facts too. Full completed-ID sets and full reference packs remain local. The AI can explain supplied evidence, but its own answer does not establish a new verified quest fact. Local Quest Guide remains usable without a model.

The active-character preview shows the selected context used for a question; players can opt out. Only approved public character fields, bounded observed quests/objectives and actual destinations, XP, up to 10 recent observed turn-ins and optional completed-count belong in the request. The preview shows the approved payload; up to 10 quests and 3 objectives per quest are shared. A local dashboard and optional in-game Compass use observed data without inference. Recent history is a bounded tracking window, not a complete quest history or verified quest-guide database. Race and faction come from separate public game APIs; unfamiliar races are accepted without guessing a faction. Saved snapshots arrive through the addon's normal logout/UI-reload write cadence, so their timestamp matters: a saved zone or level is not a live observation. Private notes/goals are untrusted and excluded by default. Account identifiers, GUIDs, machine paths and credentials do not belong in automatic context.

The assistant knows which game this is. It may not know a specific Forever quest, item or patch rule. It must explain uncertainty about that fact instead of inventing equipment, quest progress, location or a verified quest database. General WoW guidance should be labeled when Forever-specific behavior is unverified.

Example interaction:

> Player: Where should I level?
>
> Companion: Your saved snapshot shows level 24 in the Barrens; check its timestamp, since you may have moved since that save. Let's start with the quests in your saved log and their compatible reference details. If a quest's location or prerequisite is missing, I'll say so. Would you prefer solo questing or dungeon preparation?

The character details above are illustrative, not real imported data. Without approved context, the companion can ask for class, level and current zone while offering a useful general approach. It should not ask which game you mean.

## Enforcement and limits

`src/core/wow-policy.cjs` owns the shared `INSTRUCTION` for all provider backends and `scopeResponse(prompt)`. The parent request handler calls the gate on the raw user question before provider execution, so obvious unrelated requests such as “Write a Python web server,” “Build a React app,” weather questions, real-world recipes and essays receive a local friendly game-scope response without paid inference. Mentioning WoW does not turn a separate general software project into companion work.

The gate is a conservative English intent heuristic, not a complete semantic classifier or a security boundary. Ambiguous and implicit MMO questions pass to the provider under the shared instruction; ordinary names such as Python (a serpent pet) or React (a character) are not forbidden keywords. Novel phrasing, other languages and mixed intent can evade simple matching. Provider behavior is probabilistic, and tests validate the local gate and instruction contract rather than guaranteeing every model response. Architectural absence of tool/game-control execution is required independently of the prompt.

Verify with `node --test tests/wow-policy.test.cjs`.

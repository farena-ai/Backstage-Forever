# Proactive Compass design

## Outcome and boundaries

Make the existing in-game Compass proactively choose a useful next step from current permitted public observations, not just list quests. Native update must work without desktop/AI/reload. Desktop Adventure offers the same kinds of guidance from explicitly last-saved facts. Source0.12.3,1.0held; no publication. Umbrella2026-11-11-proactive-adventure-series.md binds all constraints. No new reference/data pack or capture fields needed for this increment.

## Decision model

New focused pure native `addon/BackstageForever/BackstageForeverCoach.lua` exports `BackstageForeverBuildCoach(character, options)`; options.mode one of adventure(default),questing,professions. No game APIs/I/O or writes. Compose existing BuildPlan/BuildPreparation without changing their quest/reference/command contracts. New focused desktop `src/core/adventure-coach.cjs` exports `buildAdventureCoach(profile, options={})`; reuse existing validated guidance/preparation data with same policy. Exact native/desktop fields differ at normalizer boundaries; shared behavioral fixtures cover equivalent outcomes, not identical raw payload shapes.

Output detached bounded `{version:1,status,mode,recommendation,alternatives,limitations}`. recommendation/alternatives are opportunities `{id,kind,title,reason,detail,evidence,questStep?,recipeId?,professionId?,signature}`; stable IDs include kind/quest or recipe/skill identity, never private source identifier. At most3 total visible opportunities (one main/two alternatives); inspect at most25quests,20professions,100recipes,256material observations,10reagents per candidate. Reject malformed/secret/nonfinite/ambiguous facts; unknown never becomes zero. No arbitrary extension fields in IPC.

Kinds and deterministic ordering:
- `bags`: known positive capacity and0–2 free carried slots; explain free slots, suggest making room without automatic selling/deleting. Keep existing preparation line. Highest priority in adventure/professions; remains visible warning in questing.
- `quest`: compose existing quest-plan steps with all current/reference/clue qualifications and waypoint authorization unchanged. In adventure, ready turn-in first, then local actionable objective; profession opportunities precede distant/unlocated unfinished quest when useful. Questing preserves existing order and prefers quests.
- `craft-ready`: a learned owned recipe explicitly canSkillUp=true, unambiguous positive reagents, complete fresh carried counts establish enough for one batch. Say materials ready for a craft attempt; skill-up/output not guaranteed. No recipe whose observation/material completeness/date cannot establish availability. In professions prefer this over quests; adventure after ready/local quest. Tie by stable IDs.
- `profession-cap`: observed owned rank equals positive maxRank; suggest checking whether further training is available, never promise another rank exists or an available trainer. Prefer after craft-ready in professions, behind current quests in adventure. No location invented.

Empty/unavailable states explain the next useful observation (play/open own profession normally) with no forced window opening or repetitive reload prompts. No level-up milestones based on unsupported Forever tables. No bank/alt pooling, exact route/ETA/pathfinding from Euclidean distance or material-source claims.

## Native lifecycle and UI

Load new pure file after Plan and before HUD in TOC; add to owned-addon install/current/repair/parity lists without touching unrelated files. Keep generated quest reference resource bytes, BuildPlan, BuildPreparation and capture/schema/native command protocol intact. HUD is consumer, not factual authority. Same current-capture callbacks update coaching automatically. Combat hides panel and retires unsafe callbacks; failed capture clears actionable coach state rather than leaving previous character/location actions. Login/logout/character changes invalidate all callbacks, dismissed facts and session state. No polling/ticker/OnUpdate loop added.

Use existing WoW panel textures/templates and original branded feel: one dominant next-step title, short why/reason and evidence label, at most two optional alternatives. Expose an easy goal cycle Adventure/Quests/Professions, retain existing focus/minutes controls where reachable, hide/collapse/drag and /bf show/hide/status. All primary actions fit existing compact panel without overlap. No sound/toast/chat spam. `Not now` quietly dismisses current recommendation for its current factual signature; only changed relevant observations can surface it again, not unrelated XP/capture timestamps. Bounded20 dismissal entries per session, discarded on owner/session invalidation. Dismissal is neither quest completion nor game evidence. Multiple dismissals yield a truthful quiet state. Closures revalidate epoch/current character/signature/selected opportunity on click. Only an existing valid questStep may arm existing waypoint button; profession/bag advice cannot forge a quest command.

Native mode stored in existing per-character HUD settings with migration/default; no desktop-to-running-game settings bridge implied. Existing focus/minutes values remain accepted. User data preferences survive updates; no new SavedVariables root or private data inclusion.

## Desktop and tidy navigation

New strict read-only preload/main endpoint `adventureCoach(profileId, options)` with exactly2args and options onlymode; main validates active saved character/source and returns bounded public DTO with last-saved timestamp/freshness. Reject arbitrary/additional arguments; no provider/key/network/mutation. Use existing architecture for profile identity; no renderer-supplied character payload.

Adventure gets a rich coach hero before detailed Director with mode choice and short why, qualified observation age and local/no-AI status. Existing Director and Character guidance remain accessible under concise details/link, not deleted. Preserve stable input nodes/focus/caret during async saves/render, stale-character/navigation fences and unconfigured compact first-action visibility984×635. Native/desktop mode choices are independent views; don't claim sync. Render all names/values escaped, source information readable, no arbitrary URLs/game commands from new rows. Existing hero art/typography/faction colors used; no new flat dashboard grid.

Five-section sidebar unchanged. This task only adds Next step Adventure grouping/subtab if necessary and clear path to current Preparation; do not add unimplemented Professions/Map tabs. Later increments move/group them once working. Preserve all eleven legacy destinations, active nav semantics, Settings/Help access and responsive/native-select/reduced-motion/200% behavior. No new top-level icon or duplicated preparation implementation.

## Acceptance

Actual Lua tests cover ranking/modes/unknown vs empty, stale material dates, bad/secret facts, no skill-up guarantee, combat/logout/character/capture retirement, quiet dismissal relevance, old callback rejection, hide/show/collapse/drag, quest waypoint guard and owned sixth addon file. JS tests cover same policy and strict IPC/privacy; no provider/key calls. Actual Electron synthetic GUI covers Adventure and existing nav, both factions, mode changes, stale navigation/profile refresh and first viewport at1440×960 and984×635, no overflow/broken art/unreadable controls; captures dated/qualified. Existing quest/preparation/lifecycle/UI tests run as covering checks, adjust fixtures only for real new load/nav contracts preserving original assertions. Final integrated full suite/build outsidecheckout owned by parent. Automated tests are not in-client acceptance;1.0held.

Self-review: this phase deliberately delivers immediate useful opportunities without pretending material acquisition or active-node discovery is already supported. Native decision rules are public-data-only and bounded; same-owner signature dismissal cannot suppress future genuinely changed progress forever. No unresolved purpose/authority decision requires user interruption.

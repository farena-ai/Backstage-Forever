# Your next adventure, without extra setup

## Proactive Compass — 0.13 preview, 1.0 held

Adventure now recommends one useful next step and up to two alternatives: make room in nearly full bags, work on observed quests, attempt a learned skill-up-capable recipe with established carried materials, or check whether further profession training is available. **Adventure**, **Quests**, and **Professions** change the priorities. Unknown or partial inventory never means craft-ready, and skill-ups/output are never guaranteed. No bank/alt pooling, invented trainers, routes, prices or material sources are added.

Inside WoW the Compass updates from permitted current capture events without AI or the desktop. **Not now** quietly dismisses that recommendation for its current facts; unrelated XP or capture timestamps do not bring it back. Relevant progress can resurface it. Dismissals are bounded to 20 entries for the current session and never complete quests. **Quest details** exposes the existing Focus and minutes/card-limit controls; **Less** folds them away. Hide, collapse, drag and `/bf show`, `/bf hide`, `/bf status` remain. Only an explicitly displayed supported quest step can offer a manual waypoint.

On desktop, Adventure's Compass is explicitly **Last saved** and **No AI**. Its goal preference is independent of the in-game preference. Use **Review quest choices** for the detailed Director or **Open Professions** for the single workshop under Adventure → Professions. The five main navigation sections and all existing destinations remain. Native goal preferences survive addon updates; setup/repair owns twelve files and preserves unrelated addon files. This preview is version **0.13.7**; **1.0 and actual in-client acceptance remain held**.

Living Companion gives you current local quest guidance inside WoW and a saved plan on the desktop. The native Compass updates from supported events outside combat, even with the desktop closed. Adventure rebuilds when a saved snapshot arrives. Both work without a Save button, API key or AI subscription. See [Living Companion](LIVING-COMPANION.md).

## Connect once

Choose Start my adventure. BF finds your Forever installation when it can, offers a choice if needed, and prepares/verifies its own addon files. Prepare before launching the game to avoid an activation reload. Enable BackstageForever if needed, enter your character and use the native Compass. You can enter the desktop app before its first snapshot arrives; logout/game exit normally supplies that saved data.

BF checks saved exports while open and rebuilds the desktop plan when new data arrives. To add another toon, visit it with the addon enabled; its saved capture arrives on logout or an optional reload. Characters you have not visited do not yet have detailed addon snapshots. No Battle.net account-wide roster login is added in 0.7.

## Live native guidance in 0.7

The Compass uses current ready turn-ins and unfinished objectives, with current game markers first and compatible approximate references where available. Balanced, nearby and turn-in focus adjust the short plan. Session preferences control card count rather than a promised travel or completion time. Current game titles stay authoritative; unknown objectives and finishers stay unknown.

Use its waypoint action yourself where a supported destination exists. The existing guide checks the live build, quest phase and public marker APIs again on click. Combat hides the Compass; safe event updates resume outside combat. Position, visibility, collapse and native focus/session settings belong to each character. No routine reload, desktop connection or background AI request is needed for these native updates.

## Forever references in 0.6

Adventure can enrich your saved quest steps with compatible exact-ID Forever references. Quest Guide lets you inspect chain links, NPCs, approximate observed positions and rewards locally. Your actual game-provided destination stays separate from a community reference marker. A matching build and quest ID are required before BF applies a reference to your character's guidance. Current game observations win when English quest titles conflict.

Follow-up cards show reported next quests only when your known saved completion history supports checking them next. They say **Check availability**: a chain link does not prove every race, class, reputation or other condition. Missing links and unknown conditions stay visible. BF does not make up a prerequisite graph from nearby IDs or similarly named quests.

Use **Copy game waypoint** where a compatible destination is available, then paste the prepared `/bf guide` command into WoW. The updated addon rechecks the build and active quest phase before placing a supported marker. Reference-only markers are explicitly labelled. Missing map APIs fall back to printed coordinates; no automatic movement, combat or interaction occurs. If BF asks for a reload after updating its addon, save a new snapshot before using this action.

Data refresh and local guidance work without an AI provider. The initial pack is bundled; automatic checks fetch public whole-build data without your character details. Disable automatic reference checks or refresh manually in Quest Guide. See [coverage and source notices](FOREVER-DATA.md).

## Read your saved quest plan

The first guidance release covers quests actually observed in your saved game log. It uses reported objectives, completion state, zone and destinations when the game provides them. Ready turn-ins and relevant nearby-zone work receive priority. Session length controls how much work BF presents; it does not promise a measured completion time.

Every step shows why it was suggested. Expand its evidence to see the observed quest/objectives and save time. A game-provided destination is a location reference, not a certified shortest route. BF does not invent missing NPCs, prerequisites, coordinates, rewards or unobserved quests. It is not a complete quest guide database.

Completed objective text and quest completion are distinct: completing an objective does not always mean the game reports a quest ready to turn in. If a quest disappeared from a later snapshot, BF stops treating it as active. Recent observed turn-ins are not your complete historical quest log.

## Saved means saved

The desktop reads disk snapshots, not live character state. Native Compass guidance updates outside combat from supported public events; those observations reach the desktop on logout, game exit or voluntary UI reload. A recent save is still a save. For ordinary play, let the game save naturally. If you specifically want fresh desktop or AI context now, voluntarily reload and wait for import. BF never forces this action.

Manual characters have no verified quest snapshot. Missing or restricted data remains unknown; BF offers setup guidance rather than filling the gaps with guesses. Freshness and connection status are separate: the addon can be installed correctly while your character's last save is old.

## Equipment and preparation

Where the client exposes supported public data, BF can display bounded equipped-item and bag-capacity observations. Missing fields are not empty slots or proof that a character has no equipment. These preparation observations stay local and are not automatically added to provider requests.

## Ask the AI when you want an explanation

Explain my plan opens the AI Companion with a draft question. Review it and press Enter or Send question. Shift+Enter adds a line. Nothing is sent automatically. The existing Use my active character control determines whether public saved-character context accompanies the question. Private notes, goals, account identifiers and local paths are not automatically included. Provider API costs and subscription plan limits still apply.

Local plans continue working without a provider. AI wording is a suggestion, not new verified game evidence. BF keeps the saved-source plan separate from a model's explanation.

## Stay in control

In WoW, drag Adventure Compass by its title. X hides it, - collapses it, and `/bf show` restores it. The panel shows these instructions and closing it prints a reminder. It hides during combat. Position and visibility use per-character saved settings; restart WoW once after upgrading if a new saved-variable declaration needs to load.

BF automates preparation, imports and planning. You choose and perform game actions. There is no automatic movement, combat, trading, purchasing, input simulation, memory reading or protected-value bypass.

## If something is missing

- No character: check Game Connection, enable the addon in-game and save a snapshot.
- Waiting in Compass: check its message; leave combat and use the normal reload/logout flow after updating addon files. Capture failures should prompt a safe retry rather than show raw player data or script errors.
- No quest steps: BF distinguishes an observed empty log from unavailable quest data. It will not manufacture a quest to fill a card.
- Old level/location: save in WoW. Refresh saved snapshot only rereads what is already on disk.
- Another character's plan: select the intended toon. Choosing one deliberately pauses following the last played character until you enable that option again.
- A cloud provider is unavailable: use local guidance while reconnecting; BF never silently switches you to a billed API.

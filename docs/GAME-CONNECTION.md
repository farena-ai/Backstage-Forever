# Game connection and setup

Choose **Start my adventure** on first launch. You can reopen companion setup from Game Connection after an upgrade or whenever needed. The app looks in bounded common C–Z drive locations and registry entries, without recursively scanning your drives. One validated installation can be prepared automatically; several produce a simple choice, and no result offers a native folder picker. Select your dedicated Forever client folder or a parent containing `_forever_`. Other clients are rejected.

Setup automatically prepares and verifies all twelve owned BackstageForever addon files, and repairs missing/outdated owned files on a connected startup. Unrelated addon files are preserved. The local reference and planner load before capture and HUD. File preparation is distinct from a game load or a saved snapshot. You may enter the app and start playing once files are prepared; no AI provider or initial desktop capture is required.

Prepare while Forever is closed when possible, then use Open Forever where available or your normal launcher. Enable BackstageForever in the game if needed. If already playing, you can load new files on the next game launch. A newly added addon may require a game restart before it appears; an already installed addon can generally load an update through a voluntary UI reload. BF never forces an interruption or claims prepared files are proof of a live game load.

Native Compass guidance updates outside combat as supported quest, XP, level and location events arrive. No routine reload is needed. Logout/game exit saves captures for the desktop, which checks every five seconds while open. Voluntary reload remains available when you specifically want a fresh desktop snapshot. Refreshing BF cannot force unsaved game changes onto disk.

## Two views of your adventure

The optional in-game Adventure Compass builds a short local quest plan from guarded public APIs and compatible bundled references. It can work with BF closed. Use focus/session controls to adjust the native plan and its explicit waypoint action for a supported destination. Drag its title, use - to collapse or X to close, or use `/bf show`, `/bf hide` and `/bf status`. It hides during combat. Unsupported frame APIs leave the saved export usable.

The desktop dashboard shows the most recently saved public character details, observed quests/objectives, ready turn-ins, available XP, up to 25 recent turn-ins observed while tracking, and an optional public completed-count. Actual game-provided waypoints may appear; no optimal routes or invented NPC destinations are supplied. Missing or restricted data is unknown. A completed-count is not a complete historical quest-name list.

Race and faction are read independently from `UnitRace` and `UnitFactionGroup`; unfamiliar races are not rejected or assigned an assumed faction. Only characters visited with the addon enabled are known. The addon cannot discover every account character.

## Characters and recovery

Follow my last played character starts enabled. Deliberately choosing another profile pauses following until its checkbox is restored. Newer snapshots update game fields without rolling back notes/goals or unsaved journal edits. Stable identities survive game name/realm changes. A manual profile links only on a unique exact name/realm match; ambiguous matches stay separate. The roster supports 100 profiles; existing profiles can update at capacity.

Disconnect stops imports and keeps profiles. Missing/invalid exports preserve the last good profiles and show a retryable next step. A disconnected user is not automatically reconnected. Backup files include profiles and snapshot metadata; machine-specific folder settings remain separate. Raw account identifiers, local paths and source IDs are excluded from approved AI context.

The addon declares Forever Interface 16001 and guards public APIs. Synthetic parser/Lua/Electron tests do not establish actual client loading or HUD appearance. See [Compatibility](COMPATIBILITY.md) and [Validation](VALIDATION.md).

Local runtime checks use bounded OS metadata to distinguish the configured Forever executable from another WoW client. Unknown status does not block setup. Open Forever accepts no executable path or arguments from the renderer and validates the configured client before an explicit launch request. A launch request is not proof that the addon loaded. Account authentication remains in your normal game flow.

## Automatic local guidance

Adventure builds its quest plan when saved data arrives and when you switch characters. Session/focus changes save automatically and rebuild the plan without running AI. Source evidence and freshness remain visible. Optional equipment/bag observations are local preparation information, not gear scores or recommendations. See [Guidance](GUIDANCE.md) for the first supported quest slice and recovery steps.


## When a quest has no destination

A prepared connection does not guarantee every quest has a public location. BF keeps a valid game point first, can use supported map-specific observations, and labels an unfinished quest-area fallback as an area rather than an exact NPC. Ready turn-ins never borrow an unfinished area. Historical reference points remain approximate; named-NPC clues are not confirmed destinations. Missing or ambiguous facts stay unknown instead of becoming invented coordinates.

Check the source and saved date before repeating setup. The in-game Compass can follow supported current observations while the desktop still shows the last disk save. Logout/game exit catches the desktop up naturally; a voluntary `/reload` can save sooner when wanted. Reloading repeatedly cannot create missing reference data or make an unsupported API available. See [reference coverage](FOREVER-DATA.md).

## Native map and saved discoveries

The prepared companion now has twelve owned files, including its own world-map pin XML. Startup repair checks every owned file and preserves unrelated addon files. If WoW is already running, load this update once by your normal restart/reload choice. After activation, natural map opens, quest/goal updates and supported gathering events update native layers without routine reloads; the desktop continues to import only normal saved captures.

Open the game's map and expand **BF Layers > Layers & recording** for relevant quest/material layers, older references, pause and confirmed clear. My finds are approximate past interactions, not active resources. The initial automatic subset requires known English targets and unambiguous own Mining/Herbalism cast plus single-object/material loot evidence; unsupported or protected reads are skipped. Native historical coverage is the existing seven acquisition relations, narrower than desktop seller browsing. The separate desktop Map view is not part of this foundation.

Files prepared is not evidence that the running addon loaded them. The optional gathering schema in a connected valid saved capture provides a new-format receipt, even when there are no finds or APIs are unavailable. It does not certify live map rendering or harvesting. Imported/restored backups remain historical and cannot supply a connected receipt. Private local history, pause/clear behavior and normal save timing are described in [Privacy](PRIVACY.md).

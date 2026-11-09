# Game connection and setup

Choose **Set up my companion** on first launch, after an upgrade, or from the persistent setup entry. The app looks in bounded common C–Z drive locations and registry entries, without recursively scanning your drives. If needed, select your dedicated Forever client folder or a parent containing `_forever_`. Other clients are rejected.

Setup automatically prepares and verifies all three owned BackstageForever addon files, and repairs missing/outdated owned files on a connected startup. Unrelated addon files are preserved. Its checks and next action explain whether the folder is unavailable, files need preparation, the game needs a saved snapshot, or the connection is ready. Choosing a folder is not proof that the game loaded the addon.

Enable BackstageForever in the game. A newly added addon may require a voluntary game restart before it appears. Never assume a desktop ready indicator can load an addon into a running client.

**Levelled up or changed areas? Type `/reload` in WoW to refresh your companion.** Logout also saves. The desktop checks saved exports every five seconds while open; it cannot see unsaved game changes. No reload, logout or launch is forced.

## Two views of your adventure

The optional in-game Adventure Compass updates out of combat using guarded public APIs. Drag its title to reposition, use - to collapse or X to close, or use `/bf show`, `/bf hide` and `/bf status`. It hides during combat. Unsupported frame APIs leave the saved export usable.

The desktop dashboard shows the most recently saved public character details, observed quests/objectives, ready turn-ins, available XP, up to 25 recent turn-ins observed while tracking, and an optional public completed-count. Actual game-provided waypoints may appear; no optimal routes or invented NPC destinations are supplied. Missing or restricted data is unknown. A completed-count is not a complete historical quest-name list.

Race and faction are read independently from `UnitRace` and `UnitFactionGroup`; unfamiliar races are not rejected or assigned an assumed faction. Only characters visited with the addon enabled are known. The addon cannot discover every account character.

## Characters and recovery

Follow my last played character starts enabled. Deliberately choosing another profile pauses following until its checkbox is restored. Newer snapshots update game fields without rolling back notes/goals or unsaved journal edits. Stable identities survive game name/realm changes. A manual profile links only on a unique exact name/realm match; ambiguous matches stay separate. The roster supports 100 profiles; existing profiles can update at capacity.

Disconnect stops imports and keeps profiles. Missing/invalid exports preserve the last good profiles and show a retryable next step. A disconnected user is not automatically reconnected. Backup files include profiles and snapshot metadata; machine-specific folder settings remain separate. Raw account identifiers, local paths and source IDs are excluded from approved AI context.

The addon declares Forever Interface 16001 and guards public APIs. Synthetic parser/Lua/Electron tests do not establish actual client loading or HUD appearance. See [Compatibility](COMPATIBILITY.md) and [Validation](VALIDATION.md).

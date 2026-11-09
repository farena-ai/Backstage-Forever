# Getting started

Backstage Forever is a Windows desktop app from Backstage Coding, designed by Frank Arena. It is useful offline: create characters, keep private notes and track goals. AI is optional. The game does not need to be running.

## Install the preview

1. Download the Windows setup executable from [Backstage Forever Releases](https://github.com/farena-ai/Backstage-Forever/releases). Check the file's SHA256 against the separately supplied validation record when available; a checksum alone is not publisher authentication.
2. If the files arrive as a ZIP, right-click it, choose **Extract All**, and open the extracted folder. Do not run files from inside the ZIP.
3. Run the supplied Windows setup executable. This preview uses a per-user NSIS installer. It installs for your Windows account, rather than configuring every account on the computer.
4. The preview is unsigned, so Windows may show an unknown-publisher warning or block it. Verify the source with Frank before proceeding. Do not disable Windows protections globally. Windows publisher (Authenticode) signing remains pending. App-update downloads use a separate pinned Ed25519 signature and installer hash; that does not establish the Windows publisher identity.
5. Launch Backstage Forever from its shortcut and choose **Start my adventure**. BF searches common Forever locations and bounded registry entries, then prepares/verifies its addon automatically. If several installations are found, choose yours; if none is found, choose the folder once. You can start playing once files are prepared, without a desktop snapshot or AI connection. Prepare before launching the game when possible. Enable Backstage Forever in the game's AddOns list if needed. Manual journals remain optional. [Living Companion](LIVING-COMPANION.md) explains activation when the game is already running.

If no installer was supplied, use the source commands in the README. Node.js/npm are only needed for source development, not a packaged desktop installation.

## Your first session

Inside WoW, Adventure Compass updates its local quest guidance from supported public events outside combat. It works with the desktop app closed. Use its focus/session controls and waypoint action where available; every game action stays yours. No routine reload or AI connection is needed for native guidance.

The desktop automatically imports captures when the game saves on logout/game exit or voluntary reload. Adventure then builds a saved plan. Desktop session/focus preferences save for the selected character. Visit additional toons with the addon enabled and let their captures save naturally. Follow my last played character changes the desktop selection after saves; deliberate selection pauses following. See [Living Companion](LIVING-COMPANION.md) for fresh desktop/AI context and activation boundaries.

In 0.6, **Quest Guide** starts with your character's quests and includes the bundled Forever reference. Inspect a quest for reported chain links, NPC locations, rewards and source evidence. Compatible details also enrich Adventure automatically. You do not need to import a database or configure another account. If the updated addon has not loaded yet, use `/reload`; BF needs the new snapshot's client build to apply references safely. See [Your Forever quest reference](FOREVER-DATA.md).

You can also create a manual character, keep a private journal and add goals you mark complete. Manual profiles have no observed quest log until connected and matched. Changes are stored on this computer under the app's Windows user-data folder. See [Quest guidance](GUIDANCE.md) for source evidence, freshness, limitations and controls.

You can stop here and continue offline. For AI, open Connections and choose a provider. Provider and model selections save immediately; text settings and API keys save when you leave the field. Watch the save status and retry if it reports a failure; the secondary Save control remains available. The model list refreshes automatically; choose a model explicitly. Refresh models retries discovery, and Advanced allows manual entry if discovery is unavailable. Cloud API mode requires your own API key. Explicit subscription modes instead use official account sign-in routes. See [Providers](PROVIDERS.md).

Character fields and notes also save automatically (text when you leave the field). Unknown race/faction stays unknown until supplied manually or reported by the game; unfamiliar races such as Sunborn are accepted. Game race and faction come from their separate public APIs, never an invented race-to-faction lookup.

In AI Companion, ask about World of Warcraft: Forever and press Send or Enter. Shift+Enter inserts a newline; input-method composition does not send prematurely. Use my active character starts enabled and shows exactly which bounded public character, quest/objective, XP and recent turn-in details accompany the question. Uncheck it to keep those details out; that choice persists. Notes and goals are excluded from automatic context. Anything you type into the prompt is sent, so do not paste a secret. Replies are plain text and can be wrong. Chat is temporary and is not a saved notebook. No paid question runs automatically in the background.

## Backup, restore and deletion

Use the app's backup/export control and choose a file in the native Windows dialog. Store that file somewhere you control; it contains profiles, notes, goals and provider preferences in readable JSON. It does not contain API keys. Import using the app's import control and select a backup. Review the confirmation: importing replaces the app's current state. A malformed file should leave current data intact. A backup is data, never executable code.

To move computers, export on the old computer, install on the new one and import there. Re-enter API keys and reconnect subscription accounts separately. Do not send a friend your private backup unless you want them to have its contents. Every friend should create their own profiles and use their own provider account.

Use Delete Key for an individual stored provider credential. Use the reset/delete-data control to clear app state and credentials after its native confirmation. Backups you saved elsewhere and records held by a cloud provider must be deleted separately. Uninstalling alone is not a promise that user data is erased. See [Privacy](PRIVACY.md).

## Optional experimental addon

Reopen companion setup whenever needed. It checks the dedicated Forever client folder, prepares/verifies its five managed files and repairs missing/outdated resources. Only a valid Forever client or a parent containing `_forever_` is accepted. Enable it if needed and visit characters you want captured. Native guidance updates outside combat without routine reloads. Logout/game exit saves for the desktop; voluntary reload can save sooner. Desktop timestamps describe saved data, not live character monitoring. Choosing another character pauses following until you restore Follow my last played character. See [Game connection](GAME-CONNECTION.md) and [Compatibility](COMPATIBILITY.md). Actual in-client behavior requires acceptance on your client; desktop tests use synthetic exports.

The local adventure dashboard displays observed quests/objectives, ready turn-ins and available XP. Recent history contains at most 25 observed turn-ins. Supported clients may additionally provide a complete set of completed quest IDs; that set stays local, and unknown history stays unknown. Game-provided destinations and approximate community reference locations are labelled separately. Where supported, **Copy game waypoint** prepares a short `/bf guide` command for you to paste into WoW. The addon checks it before placing a marker; it never moves your character. In-game, Adventure Compass is draggable, collapsible and hidden during combat. Use `/bf show`, `/bf hide` or `/bf status`. Its out-of-combat updates do not make desktop snapshots live.

## Updates and help

Version 0.2.0 and later installed Windows builds check while open, download authenticated updates and install on exit by default. Open Updates to check now, restart into a downloaded version or change preferences. Sessions are never forcibly restarted. Users on 0.1.0 must manually install the newer build once: export a backup while the old app is open, close it, then run the downloaded installer. There is no OS service, scheduled job or release watcher. Actual old-to-new installation acceptance remains pending. For help include version, Windows version and reproduction steps with secrets/private data removed.

If an older BF installation finds an update but cannot download it, use the newest Windows installer on the official Releases page. Close BF before running setup. The 0.6 updater includes retry and recovery fixes, but an older running copy needs one successful upgrade to receive them. See [update recovery](UPDATES.md#recovering-a-failed-update).


ChatGPT preview account switching requires resetting app data because one registration/account is saved per installation. Export profiles first if you want to keep them, then reset and reconnect your chosen account. Live interactive subscription consent and paid inference acceptance remain unperformed. Grok subscription mode is unavailable; use xAI API mode.

# Getting started

## Find your way around

The journal has five main sections: **Adventure** for your next step, **Quests** for the saved quest atlas, **Companion** for questions and local travel, **Characters** for your roster, and **Plans** for checklists. Adventure contains **Next step** and **Professions**, the single saved workshop. Plans contains **My plans** (formerly Company), **Party**, and a shortcut to Professions. **Settings** contains **Game connection**, **AI connection** (formerly Connections), and **Updates**. **Help → Field guide** contains support reports, recovery checkpoints, and backup tools.

Voice, Memory, and quest reference details open when you need them. Folding Voice stops pending or active speech. The memory summary always shows how many exchanges are selected for this question; saving an exchange does not consent to sharing it. Provider costs and character-sharing choices remain visible. Local travel has a **Show road guide** shortcut when a road alternative is documented; **How we know** holds dated source details. These are guides and manual plans, never game actions.

Manual character creation offers Forever's nine confirmed classes plus Other. Existing imported or custom class names remain unchanged. Original class and faction artwork remains in use. The source display version is 0.12.3; 1.0 publication remains held for owner review.


Backstage Forever is a Windows desktop app from Backstage Coding, designed by Frank Arena. It is useful offline: create characters, keep private notes and track goals. AI is optional. The game does not need to be running.

## Install the preview

1. Download the Windows setup executable from [Backstage Forever Releases](https://github.com/farena-ai/Backstage-Forever/releases). Check the file's SHA256 against the separately supplied validation record when available; a checksum alone is not publisher authentication.
2. Choose the file ending **Windows-x64-Setup.exe**. The **Source.zip** archive is for developers and contains no setup executable. A normal installation does not need Node.js, npm or source commands.
3. Run the supplied Windows setup executable. This preview uses a per-user NSIS installer. It installs for your Windows account, rather than configuring every account on the computer.
4. The preview is unsigned, so Windows may show an unknown-publisher warning or block it. Check the official repository download and its provided validation record before proceeding. Do not disable Windows protections globally. Windows publisher (Authenticode) signing remains pending. App-update downloads use a separate pinned Ed25519 signature and installer hash; that does not establish the Windows publisher identity.
5. Launch Backstage Forever from its shortcut and choose **Start my adventure**. BF searches common Forever locations and bounded registry entries, then prepares/verifies its addon automatically. If several installations are found, choose yours; if none is found, choose the folder once. You can start playing once files are prepared, without a desktop snapshot or AI connection. Prepare before launching the game when possible. Enable Backstage Forever in the game's AddOns list if needed. Manual journals remain optional. [Living Companion](LIVING-COMPANION.md) explains activation when the game is already running.

If you intentionally want to run the source archive, extract it first and follow the README source commands from the project folder. Otherwise download the Windows setup executable.

## Your first session

Inside WoW, Adventure Compass updates its local quest guidance from supported public events outside combat. It works with the desktop app closed. Use its focus/session controls and waypoint action where available; every game action stays yours. No routine reload or AI connection is needed for native guidance.

Open the game's world map normally for **BF Layers**: quest help, relevant material references and your recorded finds. **Layers & recording** holds filters, pause and confirmed clear. Older build references are optional browsing; finds mean approximate past interactions, never active resources or items collected. Recording initially covers only known English Mining/Herbalism interactions with unambiguous current cast and loot evidence. The desktop receives those private observations only when the game saves. New-format receipt and real client acceptance remain separate; see [Compatibility](COMPATIBILITY.md).

The desktop automatically imports captures when the game saves on logout/game exit or voluntary reload. Adventure then builds a saved plan. Desktop session/focus preferences save for the selected character. Visit additional toons with the addon enabled and let their captures save naturally. Follow my last played character changes the desktop selection after saves; deliberate selection pauses following. See [Living Companion](LIVING-COMPANION.md) for fresh desktop/AI context and activation boundaries.

**Quest Guide** starts with your character's saved quests and includes the bundled Forever reference. Inspect a quest for reported chain links, NPC locations, rewards and source evidence. Compatible details also enrich Adventure automatically. You do not need to import a database or configure another account. The saved capture's client build determines which references the desktop can safely apply; a normal logout supplies new captures after the addon loads. You can also browse references before a character arrives. See [Your Forever quest reference](FOREVER-DATA.md).

You can also create a manual character, keep a private journal and add goals you mark complete. Manual profiles have no observed quest log until connected and matched. Changes are stored on this computer under the app's Windows user-data folder. See [Quest guidance](GUIDANCE.md) for source evidence, freshness, limitations and controls.

You can stop here and continue offline. For AI, open Connections and choose a provider. Provider and model selections save immediately; text settings and API keys save when you leave the field. Watch the save status and retry if it reports a failure; the secondary Save control remains available. The model list refreshes automatically; choose a model explicitly. Refresh models retries discovery, and Advanced allows manual entry if discovery is unavailable. Cloud API mode requires your own API key. Explicit subscription modes instead use official account sign-in routes. See [Providers](PROVIDERS.md).

Character fields and notes also save automatically (text when you leave the field). Unknown race/faction stays unknown until supplied manually or reported by the game; unfamiliar races such as Sunborn are accepted. Game race and faction come from their separate public APIs, never an invented race-to-faction lookup.

In AI Companion, ask about World of Warcraft: Forever and press Send or Enter. Shift+Enter inserts a newline; input-method composition does not send prematurely. Use my active character starts enabled and shows exactly which bounded public character, quest/objective, XP and recent turn-in details accompany the question. Uncheck it to keep those details out; that choice persists. Notes and goals are excluded from automatic context. Anything you type into the prompt is sent, so do not paste a secret. Replies are plain text and can be wrong. Ordinary chat is temporary. Only an exchange you explicitly review and save becomes local memory for the current character; saving it does not select it for another question. Choose specific saved exchanges separately and inspect their question preview before Send. No paid question runs automatically in the background.

## Choose your next adventure

Open **Characters** (or Adventure's **Character guidance** action) for automatic saved identity, equipment review and qualified historical class-training listings. The exact saved race/faction stays visible; unverified racial traits remain unknown. No provider or extra setup is needed. **Create character checklist** creates or reopens a manual Company plan. **Ask about this character** opens an editable public draft with a separate Send action, preserving your sharing preference. See [Character guidance](CHARACTER-GUIDANCE.md) for source/build/date limits and historical browsing.

Open **Adventure → Next step** for the Compass recommendation. **Review quest choices** opens the detailed Director and its alternatives. Choose your session length/focus and use **Start quest session** to create or reuse a tracked Company plan. This works without AI and does not operate the game. The time choice limits how many quests the plan tracks; it is not a promised finishing time. See [Director help](ADVENTURE-DIRECTOR.md).

Open **Adventure → Professions** for saved professions, recipes and carried materials. Auto chooses a useful observed learned recipe; you can select an owned profession or explicit saved recipe and 1–20 craft attempts. Choices autosave for this character, independently of native goals. Attempts do not guarantee output or skill gains. Review the dates and complete/partial labels, then use **Add shopping checklist** if wanted. Partial inventory is not a zero shortfall. Other characters remain separate; BF does not buy, craft or transfer items. See [Preparation help](PREPARATION.md).

## Plan across your characters

Open **Plans → My plans** to see collected characters, saved ready turn-ins, private goals and known preparation facts together. Choose a character deliberately to open their Adventure. Merely browsing Company leaves your current character and following preference alone.

Create a shared journey from a blank plan or an editable quest-session/dungeon-preparation checklist. Add your own steps or pick a character and a quest from its saved log. Manual checks and newly observed game completions receive distinct labels. BF does not infer a turn-in just because a quest disappeared. Everything works without an AI provider; plans stay local and out of automatic AI context. See [Adventure Company](ADVENTURE-COMPANY.md) for repeatable quests, shared steps, reassignment and backups.

## Prepare a party and share a plan

Open **Plans → Party**, choose your own role (or leave it unselected), and use **Create dungeon checklist** for five manual preparation checks in Company. Saved equipment and bag facts help your review; they do not guarantee dungeon access or readiness.

To share, open **Plans → My plans**, choose the exact plan and use **Share plan**. Review/edit its title and every step before explicitly saving the file. Remove personal wording yourself. BF does not attach private structured data or send the file to anyone. A friend can choose **Import plan**, inspect the preview, then explicitly add it as new manual, unchecked and unassigned steps. Opening the file alone changes nothing. This is different from restoring a profile backup. See [Party help](PARTY-PLANS.md).

## Optional voice and saved exchanges

In **AI Companion**, compatible local Windows engines make **Hold to dictate** available. Hold it while speaking, release, review the editable draft and explicitly Send. If you typed meanwhile, BF leaves a separate draft for you to insert deliberately. Voice does not send a question by itself. Use **Read answer** in AI Companion or **Read plan** on Adventure for an explicit local reading; **Stop voice** interrupts it. Missing or blocked engines leave typing available; BF does not change Windows permissions or install speech packs.

Review an answer before **Save exchange**. Saved exchanges stay on this computer for that character. Select them separately for each new question, inspect the preview, then Send if wanted. You can delete individual exchanges or clear the character's memory. Local deletion cannot erase a provider's records. See [Voice and memory help](VOICE-AND-MEMORY.md).

## Follow up naturally

In AI Companion, recent completed messages accompany your next question. A correction such as “This is for WoW Forever, not retail” can retain the question you were discussing. Earlier AI answers are suggestions, not verified game facts. The page explains this sharing; the selected provider, billing mode and character-sharing choice remain visible.

Up to six exchanges stay in this app session, with older text omitted or clipped to fit the request. Your current question and explicitly selected saved memory remain intact. Leaving and returning to the page keeps completed same-owner conversation, but cancels unfinished work. Clear conversation starts fresh and removes the unsaved review draft, without deleting saved exchanges. Reload, character/provider/source/access changes and import/reset/restore also start fresh. Changing sharing or memory choices starts a new conversation; saved memory must be selected again for each question.

## Backup, restore and deletion

Your journal has automatic local protection without extra setup. Open **Field Guide → Automatic local protection** to see dated points, turn protection off/on, create a point now, preview/restore a point or clear history. Up to 3 memory-free private points are kept (64 MiB each, 128 MiB combined). Changed saves are coalesced to 15 minutes; startup and ordinary close also protect changes. A recent edit may be newer than the last point. Ordinary journaling still works if a checkpoint fails. Turning automatic protection off retains history.

Restore requires preview and a native confirmation, creates a current-journal safety point even when automatic protection is off, clears saved memory, preserves keys and disconnects game observation. External import creates a safety point only when automatic protection is on; the confirmation says when it is off. Character deletion removes ALL local recovery history and damaged originals before deleting the character; reset also resets the automatic choice. Clear history keeps the choice so future saves can be protected. See [Support and recovery](SUPPORT-AND-RECOVERY.md).

Use the app's backup/export control and choose a file in the native Windows dialog. Store that file somewhere you control; it contains profiles, notes, goals and provider preferences in readable JSON. It does not contain API keys, subscription credentials or saved conversation memory. Import using the app's import control and select a backup. Review the confirmation: importing replaces the app's current profiles/plans and clears local conversation memory. A malformed file should leave current data intact. A backup is data, never executable code.

To move computers, export on the old computer, install on the new one and import there. Re-enter API keys and reconnect subscription accounts separately. Do not send a friend your private backup unless you want them to have its contents. Every friend should create their own profiles and use their own provider account.

Use Delete Key for an individual stored provider credential. Use the reset/delete-data control to clear app state and credentials after its native confirmation. Backups you saved elsewhere and records held by a cloud provider must be deleted separately. Uninstalling alone is not a promise that user data is erased. See [Privacy](PRIVACY.md).

## If the app cannot start

A startup failure can come from saved state, credentials or another component. Only a specifically identified journal read/validation failure can offer **Restore and restart**, and only if a valid checkpoint and safely preservable original are available. Credential and unrelated failures do not offer journal restore. **Quit** is the default; **Open data folder** opens only this installation's actual app-data directory and then the app quits. Neither choice resets, restores, renames or deletes files. If Windows cannot open the folder, the follow-up dialog shows its exact path for File Explorer.

If offered, **Restore and restart** is deliberate: it preserves the exact damaged journal (up to 64 MiB), replaces it with the newest validated checkpoint, clears active saved memory, preserves API keys and disconnects game observation. The retained raw original can contain memory/private text. Clear history, character deletion/reset, explicit memory deletion/clear and external import purge old originals; ordinary checkpoints never include saved memory. A failed preservation refuses replacement; a later write failure can leave observation disconnected. If restart fails after a successful restore, reopen the app manually.

The usual Windows directory is `%APPDATA%\Backstage Forever` (normally `C:\Users\<your Windows user>\AppData\Roaming\Backstage Forever`). Use the exact **Data folder** path shown in the startup dialog if it differs, including source runs with a custom `BF_USER_DATA` location. This is the desktop app's data folder, not the game or addon folder.

1. Close Backstage Forever completely. Before changing anything, copy the **entire data folder** to a separate safe location. Keep the original copy untouched; it can contain private profiles, notes, saved memory and credentials. Do not send it to support or a friend.
2. Distinguish the files before choosing a recovery path. `state.json` holds profiles, plans, preferences and saved conversation memory. `credentials.json` holds encrypted API keys; app-owned subscription credentials live separately in the same data folder. A profile backup exported by the app excludes API keys, subscription credentials and conversation memory. Reinstalling the app does not itself repair these files.
3. Only if you have a chosen, previously exported valid profile backup **and the failure has been identified as `state.json`**, preserve the whole-folder copy first, then rename the failed `state.json` to a unique name such as `state.failed-2026-11-10.json` while the app is closed. Do not overwrite an existing file, edit the JSON, rename credentials or move/delete the entire data folder. Launch the app; with that state file absent it starts with empty profiles. Use the app's **Import backup** control to select your chosen backup and review the replacement confirmation. Do not place the backup directly over `state.json`. Import validates the backup and replaces current profiles/plans/preferences, clearing saved conversation memory. Invalid backups leave the current state intact.
4. Restoring a profile backup cannot restore saved conversation memory or credentials. Existing readable API keys remain on this installation when importing; a new installation or separately recovered credential failure needs keys re-entered and subscription accounts reconnected. Do not treat a credential failure as permission to discard `state.json` or credential files. If the cause is unknown, no suitable backup exists, or startup still fails, stop manual recovery and keep the preserved copy for yourself.
5. Contact support through the official repository with the app version (from the release/installer if it cannot open), Windows version, what you did just before startup failed, and the known failure category if established (state, credential storage or another initializer; otherwise **unknown**). Do not attach private data folders, state/backup files, credentials, keys, account details or raw exception text. Share only a redacted description unless a specific safe diagnostic is requested.

## Optional experimental addon

Reopen companion setup whenever needed. It checks the dedicated Forever client folder, prepares/verifies its six managed files and repairs missing/outdated resources. Only a valid Forever client or a parent containing `_forever_` is accepted. Enable it if needed and visit characters you want captured. Native guidance updates outside combat without routine reloads. Logout/game exit saves for the desktop; voluntary reload can save sooner. Desktop timestamps describe saved data, not live character monitoring. Choosing another character pauses following until you restore Follow my last played character. See [Game connection](GAME-CONNECTION.md) and [Compatibility](COMPATIBILITY.md). Actual in-client behavior requires acceptance on your client; desktop tests use synthetic exports.

The local adventure dashboard displays observed quests/objectives, ready turn-ins and available XP. Recent history contains at most 25 observed turn-ins. Supported clients may additionally provide a complete set of completed quest IDs; that set stays local, and unknown history stays unknown. Game-provided destinations and approximate community reference locations are labelled separately. Where supported, **Copy game waypoint** prepares a short `/bf guide` command for you to paste into WoW. The addon checks it before placing a marker; it never moves your character. In-game, Adventure Compass is draggable, collapsible and hidden during combat. Use `/bf show`, `/bf hide` or `/bf status`. Its out-of-combat updates do not make desktop snapshots live.

## Updates and help

Version 0.2.0 and later installed Windows builds check while open, download authenticated updates and install on exit by default. Open Updates to check now, restart into a downloaded version or change preferences. Sessions are never forcibly restarted. Users on 0.1.0 must manually install the newer build once: export a backup while the old app is open, close it, then run the downloaded installer. There is no OS service, scheduled job or release watcher. Actual old-to-new installation acceptance remains pending. For help include version, Windows version and reproduction steps with secrets/private data removed.

If an older BF installation finds an update but cannot download it, use the newest Windows installer on the official Releases page. Close BF before running setup. The 0.6 updater includes retry and recovery fixes, but an older running copy needs one successful upgrade to receive them. See [update recovery](UPDATES.md#recovering-a-failed-update).


ChatGPT preview account switching requires resetting app data because one registration/account is saved per installation. Export profiles first if you want to keep them, then reset and reconnect your chosen account. Saved conversation memory is not in that backup and is removed by reset. Live interactive subscription consent and paid inference acceptance remain unperformed. Grok subscription mode is unavailable; use xAI API mode.


## Local travel in Companion

In Companion, try “what is the fastest way from org to tb”. This small dated local reference works without choosing a model. Follow clarification questions for missing places or faction. Review conditional flight and road options, unknown unlocks and source dates. Save trip plan creates a manual checklist in **Plans → My plans**; you check off the steps. Other questions still need your configured AI connection. Nothing moves or controls your character.

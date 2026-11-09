# Getting started

Backstage Forever is a Windows desktop app from Backstage Coding, designed by Frank Arena. It is useful offline: create characters, keep private notes and track goals. AI is optional. The game does not need to be running.

## Install the preview

1. Download the Windows setup executable from [Backstage Forever Releases](https://github.com/farena-ai/Backstage-Forever/releases). Check the file's SHA256 against the separately supplied validation record when available; a checksum alone is not publisher authentication.
2. If the files arrive as a ZIP, right-click it, choose **Extract All**, and open the extracted folder. Do not run files from inside the ZIP.
3. Run the supplied Windows setup executable. This preview uses a per-user NSIS installer. It installs for your Windows account, rather than configuring every account on the computer.
4. The preview is unsigned, so Windows may show an unknown-publisher warning or block it. Verify the source with Frank before proceeding. Do not disable Windows protections globally. A signed public release is still pending.
5. Launch Backstage Forever from its shortcut. Complete the welcome flow and add your character's name, realm, class and level. These are manual records, not live game readings.

If no installer was supplied, use the source commands in the README. Node.js/npm are only needed for source development, not a packaged desktop installation.

## Your first session

Add a character, then a goal you can mark complete. Use notes for information you want to keep locally. Select the active character when switching between profiles. Changes are stored on this computer under the app's Windows user-data folder.

You can stop here and continue offline. For AI, open Connections, choose a provider and save its access settings. The model list refreshes automatically; choose a model and save. Refresh models retries discovery, and Advanced allows manual entry if discovery is unavailable. Cloud API mode requires your own API key. Explicit subscription modes instead use official account sign-in routes. See [Providers](PROVIDERS.md).

In AI Companion, ask about World of Warcraft: Forever and press Send. Use my active character starts enabled and shows exactly which public character details accompany the question. Uncheck it to keep those details out; that choice persists. Notes and goals are excluded from automatic context. Anything you type into the prompt is sent, so do not paste a secret. Replies are plain text and can be wrong. Chat is temporary and is not a saved notebook. No paid question runs automatically in the background.

## Backup, restore and deletion

Use the app's backup/export control and choose a file in the native Windows dialog. Store that file somewhere you control; it contains profiles, notes, goals and provider preferences in readable JSON. It does not contain API keys. Import using the app's import control and select a backup. Review the confirmation: importing replaces the app's current state. A malformed file should leave current data intact. A backup is data, never executable code.

To move computers, export on the old computer, install on the new one and import there. Re-enter API keys and reconnect subscription accounts separately. Do not send a friend your private backup unless you want them to have its contents. Every friend should create their own profiles and use their own provider account.

Use Delete Key for an individual stored provider credential. Use the reset/delete-data control to clear app state and credentials after its native confirmation. Backups you saved elsewhere and records held by a cloud provider must be deleted separately. Uninstalling alone is not a promise that user data is erased. See [Privacy](PRIVACY.md).

## Optional experimental addon

Open Game Connection, choose the dedicated Forever client folder and install the companion addon. Enable it in WoW and visit each character you want imported. **Levelled up or changed areas? Type `/reload` in WoW to refresh your companion.** Logging out also saves. The desktop checks saved files every five seconds while open; the displayed timestamp describes a saved snapshot, not continuous live monitoring. Choosing another character pauses automatic selection until you restore Follow my last played character. See [Game connection](GAME-CONNECTION.md) and [Compatibility](COMPATIBILITY.md). Actual in-client loading still requires acceptance on your client; desktop tests use synthetic exports.

## Updates and help

Version 0.2.0 and later installed Windows builds check while open, download authenticated updates and install on exit by default. Open Updates to check now, restart into a downloaded version or change preferences. Sessions are never forcibly restarted. Users on 0.1.0 must manually install the newer build once: export a backup while the old app is open, close it, then run the downloaded installer. There is no OS service, scheduled job or release watcher. Actual old-to-new installation acceptance remains pending. For help include version, Windows version and reproduction steps with secrets/private data removed.


ChatGPT preview account switching requires resetting app data because one registration/account is saved per installation. Export profiles first if you want to keep them, then reset and reconnect your chosen account. Live interactive subscription consent and paid inference acceptance remain unperformed. Grok subscription mode is unavailable; use xAI API mode.

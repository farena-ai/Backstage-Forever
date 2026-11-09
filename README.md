# Backstage Forever

**Your character command center and Forever quest companion, from Backstage Coding. Designed by Frank Arena.**

![Backstage Forever Quest Guide](assets/quest-guide-preview.png)

*Fictional player state with public Forever reference facts; your own character shapes the class and faction presentation.*

**[Download the Windows preview](https://github.com/farena-ai/Backstage-Forever/releases)** · **[Install and get started](docs/GETTING-STARTED.md)** · **[Choose an AI connection](docs/PROVIDERS.md)**

Version **0.6.0 is a Windows desktop preview** with a bundled Forever quest reference, reported chain links, NPC locations, listed rewards, automatic character guidance and improved update recovery. Local Quest Guide and planning work without AI. Exact quest IDs and compatible game builds keep similarly named quests separate. Session/focus choices save per character, and saved progress rebuilds the plan automatically. Each friend installs their own copy and connects their own account. No shared backend or owner's credentials are included.

## Install

1. Open [Releases](https://github.com/farena-ai/Backstage-Forever/releases) and select the Windows setup executable attached to the preview release.
2. If downloading a ZIP, extract it first. Run the setup executable for your Windows account.
3. Launch Backstage Forever and choose **Set up my companion**. It looks for your Forever client, asks for a folder if needed, prepares and verifies its addon, then explains the next step. Enable/load the addon in-game and voluntarily `/reload` or log out to save a snapshot. Manual profiles and AI setup remain optional.

The installer is **unsigned**. Windows may display an unknown-publisher warning; verify the download source before proceeding. Windows publisher signing and clean-machine installation/upgrade acceptance remain pending. App-update downloads use a separate pinned Ed25519 signature and installer hash/size verification. See [Getting started](docs/GETTING-STARTED.md) for full beginner instructions, backups and deletion.

## What this preview includes

- A local Quest Guide with build-specific Forever facts, reported chains, quest givers/turn-ins, approximate observed locations, reward choices and inspectable sources. The initial pack is bundled; optional automatic whole-build reference checks need no AI account and send no character details. Coverage is partial; cache records and chain links do not prove playability or every prerequisite. See [Forever reference coverage](docs/FOREVER-DATA.md).
- Player-controlled **Copy game waypoint** commands for compatible supported destinations. Paste the prepared command into WoW; the addon checks the build and quest phase before placing a marker or printing coordinates. No automatic movement, combat, interaction or map opening.
- Bounded automatic retries and clear recovery for interrupted app updates. If an older updater cannot download the new release, use the official Windows installer once to receive the fixes. See [update recovery](docs/UPDATES.md#recovering-a-failed-update).

- Local character profiles, goals and private notes; backup/import/reset controls.
- Painted citadel scenery, an embossed companion medallion, bronze/leather framing and a parchment journal, with bundled offline fonts.
- Automatic checks and downloads of authenticated releases, installation on exit, restart-now and preference controls.
- Optional offline local Ollama, separate Ollama Cloud, or OpenAI, Anthropic and xAI API connections with your own key. Friendly model catalogs refresh on startup, connection opening, authentication, saving and manual refresh; no paid inference probes or silent provider/model/billing fallback.
- Explicit ChatGPT browser subscription authentication and Claude subscription authentication through the separately installed official Claude Code tool, using app-private credentials.
- First-run and migration setup discovers the Forever client or offers a folder picker, automatically prepares/verifies the addon and repairs its missing or outdated files. Clear checks explain whether to choose a folder, prepare files, reload or play. Saved-file checks run every five seconds while open; notes and goals survive imports.
- A character command center automatically builds source-backed quest steps from saved objectives, ready turn-ins and game-provided destinations. Session length/focus preferences save per character, and evidence stays inspectable. No AI connection is required for local plans. Missing data remains unknown; the planner does not invent quest chains or routes. See [Guidance](docs/GUIDANCE.md).
- Optional public equipped-item and bag-capacity observations stay local; unavailable APIs do not block character capture.
- A local adventure dashboard shows observed quests/objectives, ready turn-ins, XP, recent observed completions and actual public-API waypoints when available. An optional draggable/collapsible in-game Adventure Compass updates out of combat and hides during combat; `/bf show`, `/bf hide` and `/bf status` control it. This is not a complete quest database or optimal route planner.
- Connections, models and character fields save automatically; text fields and encrypted API keys save when focus leaves them. Notes persist locally. Enter sends an explicit AI question; Shift+Enter adds a line, with input-method composition preserved.
- A permanent World of Warcraft: Forever specialist, with a local gate for obvious unrelated requests and a shared provider policy. The gate is a heuristic, not a perfect classifier. No code execution or gameplay automation.
- **Use my active character is on by default**, with a persistent opt-out and visible context preview. The preview shows bounded public identity, race/faction, location, snapshot time, quest/objective details, XP and recent observed completion history that accompany a submitted question; notes, goals, raw GUIDs, account identifiers and paths are excluded.

API adapters and subscription transports have fixture coverage. **Live interactive subscription consent and paid inference acceptance have not been performed.** Fixtures do not prove account eligibility, live API access or billing coverage. API mode and subscription mode are separate; errors do not silently switch to API charging. This preview supports one saved ChatGPT registration/account per installation; reset app data to switch accounts, after exporting your profiles if needed.

Grok subscription mode is currently unavailable in the interface. Official Grok OAuth exists, but an isolated inference adapter is deferred pending a verified tools/hooks boundary. Use xAI API mode in this preview.

**Levelled up or changed areas? Type `/reload` in WoW to refresh your companion.** WoW writes addon snapshots on UI reload or logout; five-second desktop checks cannot make unsaved game data live. Only characters visited with the addon enabled can be known. The newest account snapshot supplies the active character; Follow last played character starts enabled, and deliberately selecting another profile pauses it until you restore the checkbox. There is no account API or continuous live feed. Read [Game Connection](docs/GAME-CONNECTION.md), [Companion](docs/COMPANION.md) and [Compatibility](docs/COMPATIBILITY.md).

ChatGPT account catalogs determine visible subscription models; API catalogs and Claude CLI initialization do not guarantee plan entitlement. ChatGPT subscription access and API billing are separate. Claude uses the official CLI with an app-private profile and no API fallback.

Nine original class portraits and Alliance/Horde environments shape the selected character's dashboard, roster and journal. Unknown classes and factions retain neutral fallback. These illustrations are not portraits captured from your actual character.

## Your data

Profiles stay in this Windows account's app-data folder. API keys are encrypted separately and never included in exported backups. Subscription credentials are also excluded; Claude's official tool manages its own app-private credential files. Prompts you send go to your selected provider. Read [Privacy](docs/PRIVACY.md) and [Providers](docs/PROVIDERS.md) before connecting.

Installed Windows builds check shortly after startup and every six hours while open, download verified updates, and install on exit by default. The Updates screen offers manual checks, restart-now and preference controls. No forced mid-game restart or external watcher job is created. **0.1.0 needs one manual installer upgrade to gain this updater.** See [Automatic updates](docs/UPDATES.md). Source builds never automatically check or run installers.

## Run or build from source

Install Node.js LTS with npm, extract the complete source archive, and open PowerShell in the project folder:

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:integration
npm run test:setup
npm run test:autosave
npm run test:command-center
npm run test:knowledge
npm run dist
```

`npm start` opens the desktop. `npm run dist` builds the Windows installer in the configured output folder. See [Validation](docs/VALIDATION.md) for measured results and [Releasing](docs/RELEASING.md) for release gates.

```text
src/
  main.cjs            Desktop lifecycle and validated app bridge
  preload.cjs         Narrow interface available to the screen
  core/               Local storage, providers and authentication
  renderer/           Local interface and styles
assets/               Original vector artwork and preview image
addon/                Optional guarded SavedVariables companion addon
tests/                Local, protocol-fixture and integration checks
docs/                 Setup, privacy, compatibility and release evidence
```

## Artwork and license

The painted environment and medallion are original generated fantasy artwork bundled locally; no Blizzard artwork or game assets were copied. The original Backstage crest remains in the identity system. Bundled Cinzel and Source Sans 3 fonts include their SIL Open Font License notices. See [Artwork notes](docs/ARTWORK.md). Brand and product design: Frank Arena, Backstage Coding.

Application code is licensed under [MIT](LICENSE). Efficient Games' derived reference compilation retains [CC BY 4.0 attribution and notices](docs/THIRD-PARTY-NOTICES.md). This project is not an official Blizzard product. See [Security](SECURITY.md) and [Changelog](CHANGELOG.md).

# Where players find Backstage Forever

Backstage Forever has two parts:

- **The in-game addon** (`addon/BackstageForever`): Adventure Compass, guided route, arrows, quest progress in tooltips, the ask panel and more. It works on its own.
- **The desktop app**: Now, World Map, Professions, the companion and everything else. It installs and updates the addon by itself.

Players look for addons on **CurseForge** and **Wago**, which are also what most addon managers use, and some on **WoWInterface**. The addon goes on all three. Its page links to the desktop app.

## What ships automatically

| Where | What | When |
|---|---|---|
| GitHub release | The app (Windows installer, Mac zips, Linux AppImage: see [LINUX.md](LINUX.md)), source, and `BackstageForever-Addon-<version>.zip` | Every release tag (`release.yml`) |
| CurseForge, Wago, WoWInterface | The addon, built for the WoW Forever flavor (Interface 16xxx) by the BigWigs packager | Every release tag, once the site's ID and token are set (`addon-sites.yml`) |

Every pull request builds the addon package without uploading anything, so a broken package never reaches a release.

## One-time setup (owner only)

Each site needs an account, a project and an API token. Nobody else should create these: they belong to Backstage Coding.

### CurseForge

1. Sign in at the [CurseForge Authors Console](https://authors.curseforge.com/) with the Backstage Coding account.
2. Create a project: game **World of Warcraft**, class **Addons**, name **Backstage Forever**. Use the listing text below. CurseForge moderates new projects, which usually takes a few days.
3. Copy the project ID (the number on the project page).
4. Create an API token under **API Tokens**.
5. On GitHub (farena-ai/Backstage-Forever → Settings → Secrets and variables → Actions):
   - secret `CF_API_KEY` = the token
   - variable `CURSEFORGE_PROJECT_ID` = the project ID

### Wago Addons

1. Sign in at [addons.wago.io](https://addons.wago.io/) and create the project **Backstage Forever**.
2. Create an API key under **Account → API keys**.
3. GitHub: secret `WAGO_API_TOKEN` = the key, variable `WAGO_PROJECT_ID` = the project ID (the short code on the project page).

### WoWInterface

1. Sign in at [wowinterface.com](https://www.wowinterface.com/) and upload the first version by hand: use `BackstageForever-Addon-<version>.zip` from the GitHub release. WoWInterface only gives an addon ID after the first upload.
2. Create an API token under **Author Portal → API Tokens**.
3. GitHub: secret `WOWI_API_TOKEN` = the token, variable `WOWI_ADDON_ID` = the addon ID.

After that, every release tag uploads the new version to each site that has its ID and token. Nothing else changes in the release process.

## Listing text

**Name:** Backstage Forever

**Summary (one line):** A free leveling companion for WoW Forever: an Adventure Compass, a guided route, arrows to your next quest, trainer and flight finders, and an ask panel. Pairs with the free Backstage Forever desktop app.

**Description:**

> Backstage Forever helps you level in World of Warcraft: Forever without alt-tabbing to websites.
>
> - **Adventure Compass:** your XP pace, quests ready to hand in and the next step, in a small panel that hides in combat.
> - **Guided route:** `/bf route guide` walks your race's route step by step with the game's own arrow.
> - **Find things:** `/bf next`, `/bf train`, `/bf find flight` point the arrow at what you need.
> - **Quest progress in tooltips:** hover an enemy you need and see "3/8".
> - **Helpers:** auto-dismount at flight masters, a Sell junk button, quiet enemy-player alerts.
> - **Ask panel:** click the owl on the minimap and ask in plain words.
>
> **The desktop app** (free, Windows and Mac) adds a live Now page, the World Map, professions advice, dungeon plans, character portraits and a companion that answers from WoW Forever's own data. It installs and updates this addon for you: https://www.backstagecoding.com and https://github.com/farena-ai/Backstage-Forever/releases
>
> The addon reads only your own character, never automates play and sends nothing over the internet. Your characters stay on your computer; the desktop app shares only what its privacy page lists, each part with its own off switch.
>
> From Backstage Coding, designed by Frank Arena and Jason Babiuch.

**Categories:** Quests & Leveling, Map & Minimap, Professions, Companions or Miscellaneous (whichever the site offers).

**Screenshots:** in-game shots of the Compass, guided route and ask panel (taken by the owner in a normal session), plus app shots made from the anonymized demo state: `BF_PREVIEW_STATE=<anonymized state> node scripts/dev-preview-pages.cjs OUTDIR`. Never use screenshots that show real character names or realms.

**License:** MIT (same as the repository).

## The desktop app

The app itself can't go on addon sites, which only host addons. Players get it from:

- the GitHub release page (installer, Mac zips, and the update feed the app uses);
- https://www.backstagecoding.com (link to the latest release);
- the addon's page on CurseForge, Wago and WoWInterface (link in the description).

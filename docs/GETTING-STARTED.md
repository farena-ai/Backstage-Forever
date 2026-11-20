# Getting started

Backstage Forever is a free leveling companion for World of Warcraft: Forever: a desktop app plus a small in-game addon that the app installs for you. This guide takes about five minutes.

## 1. Install

**Windows 10 or 11**
1. Open the [latest release](https://github.com/farena-ai/Backstage-Forever/releases/latest) and download the file ending in **Windows-x64-Setup.exe**. (The Source.zip is for developers.)
2. Right-click the downloaded installer and open **Properties → Digital Signatures**. Check that the signature is valid and the signer is **Frank Arena**, then run it. If the signature is missing or invalid, don't run the installer; download it again from the official release. It installs for your Windows account only.
3. The app keeps itself up to date from then on (Settings → Updates).

**macOS (Apple silicon or Intel)**
1. Download the **macOS-arm64** zip (Apple silicon, M1 and later) or the **macOS-x64** zip (Intel) from the same release.
2. Unzip it and move **Backstage Forever** to Applications.
3. Open it. It isn't notarized yet, so the first time macOS says it can't check it: click **Done**, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, then **Open Anyway** again. (On macOS 14 and older: right-click the app, choose **Open**, then **Open** again.)
4. On a Mac the live link isn't available yet, and new versions are downloaded by hand from the releases page. Everything that works from your saved characters works.

You can check a download against `SHA256SUMS.txt` in the same release.

## 2. Set it up

Open the app. New players see a short welcome tour; then, on **Now**, click **Set it all up**. It:
- finds World of Warcraft: Forever (or asks you to pick its folder once),
- installs the Backstage Forever addon into the game,
- turns on the live link (Windows).

If WoW was already running, quit it and start it again once so it loads the new addon. In the character select screen, make sure **Backstage Forever** is ticked under **AddOns**.

## 3. Play

Log in. You'll see the **Adventure Compass** panel and an **owl button** on the edge of your minimap. Good first commands (type them in chat):

- `/bf help` lists everything.
- `/bf route guide` follows the guided route for your race, one step at a time, with the game's arrow.
- `/bf next` puts the arrow on the nearest thing to do; `/bf train` on your trainer.
- Click the **owl** to ask the companion a question; the answer appears in a panel over your game.

The app follows you while you play (Windows, with the live link). Without it, the app updates whenever the game saves: when you log out or type `/reload`.

## 4. Find your way around the app

- **Now**: your next step, where to level, your quest log and training. **Mini Now** keeps the next step in a small window beside the game; **Speak steps** reads it aloud.
- **World Map**: your game's own map art with painted pins; click one for details or an arrow in game. ▶ replays your path this session.
- **Adventure**: the guided route, every zone with your quest progress, dungeons and raids with their loot, and profession plans.
- **Characters**: every character at a glance, the character sheet, talents, and your journey (badges, speed splits, past sessions).
- **Ledger**: bags, bank and mail across characters, gold and the prices you saw, reputation and cooldowns.
- **Plans**: your own checklists and party plans.
- **Companion**: ask anything about the game. It answers common questions (quests, next steps, training, "what should I do tonight?") with no setup. For more, turn on the free AI that runs on your PC with one click, or connect the AI provider you choose in Settings → AI connection.
- **Settings**: game connection, AI connection and updates. **Help**: the field guide, every command, data coverage and support.

## 5. If something isn't right

- **The addon doesn't show in game:** quit WoW completely and start it again (new addon files only load on a full restart), and tick Backstage Forever under AddOns.
- **The app doesn't follow you live:** type `/bf live` in game to check it's on. If you play over remote desktop, with HDR or a colour filter, type `/bf live safe`. The app says so on Settings → Game connection when it can't read the line.
- **A message reads oddly in German:** the German is machine-translated; please tell us with the "Translation fix" form on GitHub.
- **Anything else:** Help → Support makes a report you can share, with secrets left out, and Help → Field guide explains every word the app uses.

## Removing it

Uninstall Backstage Forever from Windows Settings → Apps (or move it to the Trash on a Mac). To remove your data too, first use Help → Field guide → Delete all local data. The addon folder is `Interface\AddOns\BackstageForever` in your game folder.

See also: [Privacy](PRIVACY.md) · [Compatibility](COMPATIBILITY.md) · [Commands and features (in the app: Help → Commands)](../src/renderer/commands.js)

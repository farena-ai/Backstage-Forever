# Backstage Forever on Linux

For players who run WoW Forever through a compatibility layer (Wine, Lutris, Bottles and the like).
The Linux build is new and has had far less testing than the Windows app. Please report what breaks.

## Install

1. Download `Backstage-Forever-<version>-Linux-x64.AppImage` from the
   [latest release](https://github.com/farena-ai/Backstage-Forever/releases/latest).
   Check it against `SHA256SUMS.txt` on the same page with `sha256sum -c --ignore-missing SHA256SUMS.txt`.
2. Make it runnable: `chmod +x Backstage-Forever-*-Linux-x64.AppImage`, then start it.
3. In **Settings → Game connection**, choose your WoW Forever folder yourself: the `_forever_`
   folder inside the game's install, usually somewhere under your Wine prefix
   (`.../drive_c/Program Files (x86)/World of Warcraft/_forever_`). The app does not search for it on Linux.

If it does not start:

- "AppImages require FUSE": install `libfuse2` (Ubuntu 22.04 and newer do not ship it), or run the
  file with `--appimage-extract-and-run`.
- A sandbox error on Ubuntu 24.04 and newer: start it with `--no-sandbox`.

## What works

The Linux build is **saved-only**, like the Mac build: the app reads what the addon saved after you
type `/reload` or log out. Everything that comes from a save works: Now, the guided route, the World
Map, Travel, Dungeons & raids, Professions, the Ledger, Plans and your Journey. The addon itself is
the same on every system.

## What does not work on Linux

These parts use Windows features and are switched off:

- **Live link** (the app following the game while you play), and with it Moments, the radar and the
  answer panel over the game window.
- **Launching the game** from the app and seeing whether it is running.
- **Finding the game folder** by itself.
- **Voice** and the **built-in free AI**. AI services you connect yourself still work.
- **Automatic updates.** The app does not update itself: download the new AppImage from the
  releases page and replace the old file. Your journal stays (it lives in `~/.config/Backstage Forever`).

## For maintainers

- `npm run dist:linux` builds `dist/Backstage-Forever-<version>-Linux-x64.AppImage` (unsigned, x64).
  Build it on Linux; electron-builder cannot make an AppImage on Windows.
- The `linux` job in `.github/workflows/release.yml` builds it on `ubuntu-latest` after the Windows
  release and the Mac job, checks that the AppImage holds the app and the addon, and adds the file and
  its line in `SHA256SUMS.txt` to the same release. It runs after the Mac job because both rewrite
  `SHA256SUMS.txt`. It does not touch `backstage-update.json`, which is the Windows update file.
- Platform gates live in `src/core/live-bridge.cjs`, `game-runtime.cjs`, `game-discovery.cjs`,
  `voice.cjs`, `local-ai.cjs` and `updater.cjs` (each checks for `win32`; the updater also knows `darwin`).

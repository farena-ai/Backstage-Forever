# Security

## Reporting a problem

Please report security problems privately, not in a public issue: use **Report a vulnerability** on the repository's **Security** tab (GitHub private vulnerability reporting). Include the app version, the steps to see the problem and what you expected, with any keys, backups or personal data removed. We aim to answer within a week.

## How Backstage Forever is built to be safe

- **Desktop app.** A local page with a strict content security policy, a narrow preload bridge, and every request checked again in the main process. Each extra window (radar, Mini Now, the ask panel) has its own bridge and accepts requests only from its own page.
- **Credentials.** API keys are kept with the operating system's protected storage (Electron `safeStorage`) and never shown back in full. AI providers are reached only at their fixed addresses; a local Ollama is reached only on this computer; redirects are refused and requests are size- and time-limited.
- **Updates.** The Windows app downloads updates only from this repository's releases and installs one only after checking its signed manifest (`assets/update-public-key.pem`) and the installer's SHA-256.
- **The game.** The addon uses only Blizzard's public addon interface and never automates play. The app never sends input to the game, never reads its memory and never changes the game's files outside its own addon folder.
- **Community sharing** (on by default, off in Settings → Privacy & sharing) sends only anonymous gathering spots and creature positions, rounded to 0.5% of the map, with a random install id, exactly as listed in [community-server/CLIENT-CONTRACT.md](community-server/CLIENT-CONTRACT.md): no names, character ids, realm, account or chat.
- **What the app shares.** Your characters stay on your computer. The app shares only what the live map needs and anonymous statistics that help improve it, with no account, character or realm names and no files. Reports are sent only when you write one. Each of these has its own off switch.
- **Statistics, reports and error reports** go to the same service as community sharing, exactly as listed in sections D1 to D8 of [community-server/CLIENT-CONTRACT.md](community-server/CLIENT-CONTRACT.md). Every request body is built from a fixed list of fields; text the player did not type passes a scrubber that removes file paths, names, e-mail addresses, network addresses and long tokens. Automatic error reports are off until switched on. The key that lets an install read the replies to its own report is kept only on that computer and is never logged.

These are design rules backed by tests, not a promise that there are no bugs.

## If a key is exposed

Revoke it right away in the provider's console; deleting it from the app cannot revoke copies elsewhere. Exported backups contain your private notes and should be treated as sensitive.

## Builds

Release assets are published from tagged commits, with SHA-256 checksums in `SHA256SUMS.txt`. Current Windows installers carry a timestamped Authenticode signature from **Frank Arena**; the Windows updater also verifies a signed update manifest. macOS builds are ad-hoc signed, not notarized.

Licensed under the [MIT License](LICENSE).

# Security

## Reporting a problem

Please report security problems privately, not in a public issue: use **Report a vulnerability** on the repository's **Security** tab (GitHub private vulnerability reporting). Include the app version, the steps to see the problem and what you expected, with any keys, backups or personal data removed. We aim to answer within a week.

## How Backstage Forever is built to be safe

- **Desktop app.** A local page with a strict content security policy, a narrow preload bridge, and every request checked again in the main process. Each extra window (radar, Mini Now, the ask panel) has its own bridge and accepts requests only from its own page.
- **Credentials.** API keys are kept with the operating system's protected storage (Electron `safeStorage`) and never shown back in full. AI providers are reached only at their fixed addresses; a local Ollama is reached only on this computer; redirects are refused and requests are size- and time-limited.
- **Updates.** The Windows app downloads updates only from this repository's releases and installs one only after checking its signed manifest (`assets/update-public-key.pem`) and the installer's SHA-256.
- **The game.** The addon uses only Blizzard's public addon interface and never automates play. The app never sends input to the game, never reads its memory and never changes the game's files outside its own addon folder.
- **Community sharing** (on by default, off in Settings → Game connection) sends only anonymous gathering spots and creature positions, rounded to 0.5% of the map, with a random install id, exactly as listed in [community-server/CLIENT-CONTRACT.md](community-server/CLIENT-CONTRACT.md): no names, character ids, realm, account or chat.
- **No telemetry.** Nothing else is sent anywhere.

These are design rules backed by tests, not a promise that there are no bugs.

## If a key is exposed

Revoke it right away in the provider's console; deleting it from the app cannot revoke copies elsewhere. Exported backups contain your private notes and should be treated as sensitive.

## Builds

Release assets are published from tagged commits, with SHA-256 checksums in `SHA256SUMS.txt`. Current Windows installers carry a timestamped Authenticode signature from **Frank Arena**; the Windows updater also verifies a signed update manifest. macOS builds are ad-hoc signed, not notarized.

Licensed under the [MIT License](LICENSE).

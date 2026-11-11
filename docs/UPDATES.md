# Automatic updates

Backstage Forever 0.2.0 and newer installed Windows builds check for updates after startup and every six hours while running. Newer authenticated releases download in the background and install on normal exit when that preference is enabled. Check now, Restart and update, automatic checks, and install-on-exit controls are available in Updates. No mid-session restart is forced. Source/development builds do not automatically contact the release service.

Version 0.1.0 has no updater: install a newer Windows release manually once. Profiles remain in the existing user-data directory. Downloads and preferences are held separately in the app-owned updates cache. Reset clears update work and settings as well as the documented profile reset behavior.

Checks contact GitHub's public releases API and download from GitHub release asset hosts. GitHub receives the usual connection information, including IP address. No profile, conversation, provider token, or game data is sent as part of update checks. Turn automatic checks off to stop recurring checks; Check now remains available. Disable install-on-exit to keep control of installation timing.

With automatic checks off, a manual check may still download an authenticated newer release. Choose Restart and update to install it; normal exit will not install it in that mode. Reset clears queued updates and turns automatic checks off until explicitly re-enabled.

## The 0.13 preview

The 0.13.0, 0.13.1 and 0.13.2 candidates were not published; their tags and evidence are preserved. After the earlier fixture corrections, 0.13.2 passed Map validation but exposed a voice-smoke sequencing race between physical disclosure closure and its queued native cancellation handler. 0.13.3 corrects the fixture acknowledgement and is the next publication candidate. No intermediate installation is needed.

Installed 0.12.3 can receive 0.13.3 through this existing authenticated preview channel once its release is published. Open **Updates → Check now** in the older app, then choose when to install. No forced restart is added; existing automatic download/install-on-exit preferences still apply. This delivers the reviewed Proactive Compass, Professions, Map and companion improvements; 1.0 stays held for hands-on acceptance. See [0.13 release notes](releases/0.13.3.md). Preparing the version and CI is not proof of publication, authenticated public download or a successful installed upgrade; those results are recorded separately.

## Recovering a failed update

If an older installation finds 0.5.0 but says the update could not be verified or downloaded, open the [official Releases page](https://github.com/farena-ai/Backstage-Forever/releases) and download the newest Windows setup executable. Close BF and run that installer normally. Your existing profiles and encrypted connections remain in the same Windows account's app-data folder. Export a profile backup first if you want an additional copy. An old running updater cannot acquire its own fixes until the app has been upgraded.

The 0.6 updater retries temporary network failures up to three times and offers **Retry update** and **Open Releases**. A failed metadata request remains an error rather than appearing as “up to date.” Signature, file-size and hash checks stay mandatory. If Windows cannot safely write or clean up its update cache, BF explains the cache failure instead of continuing another download. No Windows security setting needs to be changed.

During development, actual installed Electron requests sometimes received HTTP 504 from GitHub. Earlier attempts completed fully authenticated downloads, including recovery after an interrupted transfer. These observations do not establish the exact cause of every failed update or guarantee that a remote outage has ended. See [measured recovery and diagnostics](updater-reliability.md).

## What authenticates a release

The bundled Ed25519 public key authenticates `backstage-update.json`. Its envelope contains exactly base64 `payload` and `signature`; the signature covers the original UTF-8 payload bytes. The payload contains `schemaVersion` (1), `version`, `releaseTag`, `url`, `sha256`, `size`, and `publishedAt`. The version, tag, installer filename and URL must agree and point to this repository. The updater verifies downloaded byte count and SHA256, then verifies again immediately before execution. GitHub metadata alone never authorizes an installer.

This app-update signature is separate from Windows Authenticode. The installer currently has no Windows publisher certificate; Windows can display an unknown-publisher warning during manual installation. Do not describe the installer as Authenticode signed.

## Publishing

Only explicit `vMAJOR.MINOR.PATCH` tag pushes trigger `.github/workflows/release.yml`. The tag must match `package.json`, whose explicit `releaseChannel` must be `preview` or `stable`. Preview releases carry GitHub's prerelease flag; stable releases do not. Windows CI installs locked dependencies, runs unit/UI/integration tests, builds the installer, runs the packaged smoke test, signs its manifest, archives tagged source, and publishes the release assets and SHA256SUMS. New releases remain drafts until every asset uploads successfully, then publish with the selected channel. A rerun updates existing release assets rather than creating a duplicate release and preserves an already published release's preview/stable status. There are no release watcher jobs or schedules. CI rebuilds are repeatable from tagged source and locked dependencies; binary byte-for-byte reproducibility is not asserted.

The protected repository secret `BF_UPDATE_SIGNING_KEY` holds the Ed25519 private PEM and is exposed only to the signing step. The public key is `assets/update-public-key.pem`. Private keys are never committed, copied into build assets, passed as command-line arguments, or printed. Local release signing uses the owner's protected DPAPI key helper to supply this same environment variable only in memory:

```text
node scripts/sign-update.cjs --installer <installer-path> --version 0.13.3 --output <new-manifest-path>
```

The installer basename must be `Backstage-Forever-0.13.3-Windows-x64-Setup.exe`. The signer rejects a non-Ed25519 key, a key that does not match the bundled public key, incorrect filenames, invalid versions, empty installers or installers over 512 MiB, and existing output files. Never set a production private key in a shell command or shell history.

## Recovery and key rotation

Keep a protected offline recovery copy of the signing key. If the CI secret is lost but the key survives, restore the repository secret securely; do not generate a replacement silently. If the private key is compromised, revoke/replace the secret and stop automatic signed releases until recovery is planned. Current clients trust their bundled key only and cannot safely accept a new key from unsigned GitHub metadata. A key change requires a manually verified installer from the owner that embeds the replacement public key, or a separately implemented and reviewed old-key-authenticated rotation protocol. No such rotation protocol is currently implemented. A lost key without a recovery copy likewise requires a manual upgrade.

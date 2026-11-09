# Releases and manual updates

This is a **0.1.0 unsigned Windows preview** from Backstage Coding, designed by Frank Arena. Do not describe it as signed, publicly published or verified on a clean machine. See VALIDATION.md for the checks actually performed.

## Build from source

In the extracted project folder with Node.js LTS and npm installed:

```powershell
npm ci
npm test
npm run test:ui
npm run test:integration
npm run dist
```

The Windows build is a per-user NSIS installer. Inspect the configured output folder in package.json and keep the installer together with its version and SHA256 validation record. Never include user data, keys or personal backups in source/installer archives. The optional addon stays a separate experimental template.

## Gates before public distribution

- Frank has confirmed the public repository `farena-ai/Backstage-Forever`; verify release artifacts and destination before publishing.
- Frank approved MIT licensing; include LICENSE and required third-party notices in source distributions. Claude Code is separately installed and remains under Anthropic's terms; its binary is not bundled or relicensed.
- Sign the application/installer with the intended publisher identity and verify signatures.
- Test install, first run, uninstall, data retention/deletion and upgrade on a clean Windows machine.
- Review source/installer contents, privacy statements and compatibility claims, and attach actual test evidence and checksums.
- Live interactive subscription consent and paid inference acceptance have not been performed. Run live provider checks only after deliberate user authentication/consent; API/subscription fixture success is not live authentication proof. Verify ChatGPT consent, refresh/logout and subscription-only routing, plus Claude app-private official CLI sign-in, no-tool invocation and sign-out/reset. Grok subscription mode is unavailable; an isolated official CLI adapter is deferred roadmap work. Never spend credits merely to make a test badge green.
- Recheck official CLI capability and policy behavior. Safe mode preserves administrator policy, so managed-hook behavior needs explicit deployment review; do not claim the child process is an OS sandbox.
- Keep all subscription credentials and app-private CLI homes out of installers, source archives, backups and logs. Use a fresh profile for acceptance.

No publication is performed merely by building. Never add release watcher jobs, scheduled checks or recurring threads.

## Manual update path

Obtain a newer installer from the confirmed `farena-ai/Backstage-Forever` GitHub Releases location when a release is actually published. While the app is open, export a backup. Then close the app, verify the publisher/signature and supplied checksum, and run the newer installer over the current per-user installation. Reopen and check profiles/settings. This is the planned manual path; upgrade and clean-machine verification are pending. There is no automatic updater, simulated update check or background release monitor.

If an upgrade fails, retain your backup and ask for version-specific recovery guidance before deleting data or downgrading. Provider keys are not portable backups and may need to be entered again.

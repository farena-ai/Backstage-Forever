# Validation — November 8, 2026

Version 0.1.0 is a desktop foundation preview. These checks establish the behaviors tested here, not blanket compatibility with accounts, game versions or managed Windows deployments.

## Passed locally

- `npm test`: 42 tests, 42 passed, 0 failed. Covers validated profiles/imports, key isolation, four API protocols, privacy context, endpoint restrictions, safe errors, single-instance guard, ChatGPT OAuth protocol/OIDC verification/refresh/revocation/cancellation, and restricted app-private Claude transport. OAuth and provider tests use synthetic credentials and fixtures; no live account consent or paid inference occurred.
- `npm run test:ui`: real Electron first run, profile creation, goals, whitespace recovery, private notes, safe text rendering, provider/auth mode navigation, help and persistence after restart.
- `npm run test:integration`: real Electron IPC, actual Windows safeStorage encryption, excluded secrets in bootstrap/exports, backup/import dialogs with test-controlled file choices, invalid-import preservation, credential preservation, local HTTP provider fixture, privacy payload, reset during a delayed reply, deletion of app-owned credentials and clearing cached subscription identity.
- `npm audit`: zero reported vulnerabilities across the installed production and development tree. The lockfile overrides affected minimatch 7–10 dependencies with patched 11.0.5; successful Windows packaging exercises its build usage. Earlier dependency versions below 7 retain their compatible APIs.
- Independent review found and resolved mutable-state save poisoning, late replies after reset/import, stale subscription identity, multi-instance overwrite, refresh after sign-out, and overlapping mutations during asynchronous reset.
- Fresh Windows CI also runs the suite. An intermittent first-run GUI timeout led to explicit test-window painting and a 45-second cold-start allowance; production window/power settings are unchanged. Failed GUI checks preserve a diagnostic screenshot.

## Distribution checks

The per-user x64 NSIS installer is built with `npm run dist`, with original application icon and MIT license included. It is intentionally unsigned. Installer and source checksums accompany the downloadable files. Public source is `farena-ai/Backstage-Forever`; updates are manual downloads from that repository’s Releases page.

`npm run test:packaged` passed: the built Windows executable opened the branded interface from its ASAR bundle, exposed the isolated preload bridge, reported version 0.1.0 and had Windows secure credential storage available. Its executable metadata reports Backstage Forever. This launch check did not change player profiles or credentials. A clean-machine install, upgrade and uninstall have not been certified. No code-signing certificate, automatic updater, scheduled watcher or store submission was configured.

## Compatibility evidence and remaining gates

The local installed game metadata identified product `wowf`, version `1.60.1.70862`, with a dedicated `_forever_` folder. No game files were modified, and no in-client API test ran. The optional addon remains a template requiring an interface value verified from the running client. No game-data import, live combat support, or automated play is advertised.

ChatGPT subscription mode implements the documented open-source sign-in route. Claude subscription mode invokes the user-installed official native executable with app-private configuration; administrator policies can affect that external tool. Actual browser consent, account entitlement, token refresh against provider servers and live inference require user-led acceptance. There is one saved ChatGPT registration per installation in this preview.

Grok OAuth exists in its official CLI, as Sara’s design also recognizes. Backstage Forever does not yet provide an accepted Grok subscription inference adapter: its currently documented CLI exposes retained MCP meta-tools and managed hooks even with empty tool selection. The UI marks this route unavailable; xAI API mode remains implemented. This is a current implementation limit, not a claim that Grok subscription integration is impossible.

Next gates: subscription acceptance with real accounts; a safe Grok adapter; account-aware model discovery; clean Windows installation/upgrade/uninstall; code signing; addon/client verification; accessible keyboard/screen-reader acceptance. See ROADMAP.md for phases.

# Build roadmap

## 0.2.0 — implemented

- Original painted fantasy scenery and medallion; metal/leather panels, parchment journal and offline fantasy typography.
- Authenticated automatic Windows updates: checks, downloads, install-on-exit, restart-now, opt-out, pinned Ed25519 manifest and installer verification. First upgrade from 0.1.0 is manual. Release signing uses explicit tag-triggered builds; no recurring watchers.
- Existing local roster, private notes/goals, backup/import/reset, four API adapters, local Ollama, ChatGPT OAuth and app-private official Claude subscription transport.

## Next: provider acceptance and simpler setup

1. Exercise real ChatGPT/Claude sign-in, prompts, refresh, logout, limits, cancellation and reset with authorized accounts. Protocol fixtures are not live account certification.
2. Add account-aware model discovery and friendly selection; retain explicit subscription/API modes and no paid fallback.
3. Complete Grok subscription transport. OAuth already exists. Verify an isolated official invocation or supported direct OAuth inference route, own-home credentials, no-tool/no-game boundaries, cancellation/logout/reset, transcript handling and no API fallback. Test malicious prompts and user-led live sign-in before enabling it.

## Next: useful game data

Verify addon interface/capabilities in the intended Forever client with exact build evidence. Add versioned manual export/import for supported character/equipment/quest details, schema validation and visible freshness. Do not execute Lua imports or inspect game memory. The current addon remains an experimental manual-copy template.

## Release acceptance

Actual clean-machine install/upgrade/uninstall and self-update, keyboard/screen-reader use, failed-download recovery and data preservation. Add Windows Authenticode when a publisher certificate is configured. App-update signatures already authenticate release downloads; Windows publisher identity remains distinct.

## Later

Verified quest/gear/profession planning data, intentional friend sharing, optional voice and further original class art. No combat computation, automated play, unsupported live bridge, credential sharing or release watcher jobs.

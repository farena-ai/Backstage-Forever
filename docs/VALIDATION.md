# Validation — November 8, 2026

## 0.4.0 verification scope

The 0.3.0 source-addon tests passed while the shipped bundle failed to copy addon files after folder selection. This regression was reproduced in the packaged application: source copies alone were insufficient evidence. Version 0.4.0 moves owned addon sources to unpacked resources and requires the actual packaged application to prepare and read back all three owned files. Final packaged/full-suite results are recorded below only after execution; no source result certifies that release gate.

The built Windows executable passed the full packaged regression: choose a synthetic game folder, automatically install and compare all three files byte-for-byte, close the app, remove its HUD file, restart, wait for verified repair and compare all three files again. An unrelated file survives. The same run verifies isolated user data, Windows secure storage, preload isolation and packaged SDK loading. The named owner's existing empty addon folder was repaired and all three final files read back against this source; no game launch/reload or actual in-client rendering was automated. The first real saved character snapshot is still a player-led acceptance step. Full dependency audit: zero reported vulnerabilities.

Implemented setup includes bounded common-location/registry discovery, native picker fallback, automatic preparation/repair, exact readback, explicit health checks/next actions, reconnect/reset/disconnect cancellation and unrelated-file preservation. Local targeted setup tests passed (12 tests). Adventure/quest/history checks run JavaScript contracts and a real Fengari Lua VM, covering guarded public APIs, combat suppression, persistence, unavailable/restricted data, empty-vs-unknown state, actual waypoints, bounded history/counts and export-budget shedding with 100 synthetic identities. These are synthetic fixtures, not actual client loading/HUD acceptance.

`npm test`: **136/136 passed**. Real Electron UI, storage/provider/game integration, setup and autosave checks passed. Setup covers first-run, three prepared files, the reload step, automatic import, native XP meter, quest briefing, reopening, current-folder readiness and no implicit inference. Autosave covers immediate model selection, text/select persistence across navigation, encrypted key blur, arbitrary race/faction in the actual request, private-note exclusion, Enter/Shift+Enter and navigation while a catalog is deliberately stalled. Character-A edits stay with A across a newer character-B import. Setup's primary action is visible without scrolling, and the fixture reports no CSP violations.

Independent review findings were fixed and verified: Lua escaping can enlarge the physical saved file, so transport has a separate bounded allowance while decoded JSON remains capped at 1 MiB; the real Lua export is round-tripped through the actual SavedVariables parser. A new game folder clears connection-specific counters and cannot borrow readiness from retained profiles. The update preference harness now faithfully dispatches additive listeners and all timers, verifying that the stale poll actually occurs. Earlier counts below are historical evidence, not current results.

The approved payload includes up to 10 quests, 3 objectives each and 10 recent observed turn-ins, public identity/race/faction/location/time and XP; private journals, paths/raw GUIDs/account identifiers stay excluded. Game history stores up to 25 observed turn-ins; optional completed-count is read only within a 20,000-entry bound and never exports a full historical quest-ID/name list. Schema version 1 uses optional fields and preserves unknown data honestly. Waypoints come from actual public APIs, not invented routes.

Actual Forever-client loading, native HUD pixels, live subscription consent/paid inference, clean-machine installation/real self-upgrade, screen-reader acceptance and Authenticode remain separate gates. Desktop saved-file polling is still five seconds and requires voluntary reload/logout writes. Nothing here claims a realtime desktop feed, full quest-guide database or automatic gameplay.

## Historical 0.3.0 game-aware companion evidence

Implementation covers a guarded SavedVariables addon, restricted non-executable export parser, bounded folder scanning, five-second saved-file polling, roster merging with retained notes/goals, cancellation/disconnect and last-played following. Provider tests cover catalog protocols, auth separation, caching/races, separate Ollama Cloud native chat and no inference entitlement probes. Specialist tests cover the shared instruction, local off-topic heuristic and approved context exclusions.

Local 0.3.0 results: `npm test` **120/120 passed**, including a real Lua VM harness. Real Electron UI and integration checks passed. The integration uses a synthetic game folder to exercise addon installation, imports, levels, deliberate selection, reset-during-folder-dialog cancellation and stale journal saves across newer imports. UI checks keep a dirty character-A form stable while main imports character B; saving preserves both journals and newer game fields. Independent review found and closed connection resurrection, stale-dialog, selection and journal overwrite races.

`npm run dist` builds the per-user Windows x64 NSIS installer. Packaged startup passed with an isolated temporary user-data directory, Windows secure storage, isolated preload and the packaged Claude SDK core loading successfully. Native vendor CLI bundles are excluded; Claude requires the user's official installed executable. `npm audit` reported zero vulnerabilities across production and development dependencies. Wide, compact, Alliance/Hunter and Horde/Mage screenshots were inspected. CI and signed public-update verification are additional release gates; actual installer execution/self-upgrade is not implied by these checks.

Static loader/configuration evidence identifies Forever product wowf, version 1.60.1.70862 and Interface 16001. Synthetic addon-runtime tests exercise event/export logic but do not establish actual in-game loading. No real-game acceptance, live OAuth plan entitlement, paid inference acceptance, clean-machine installation or actual self-update is claimed. A successful model catalog response is not paid inference certification: ChatGPT account visibility is authoritative for listing, while API catalogs and Claude CLI initialization do not guarantee plan entitlement.

Public active-character context now defaults on with persistent opt-out. It includes public identity, level, race/faction, location and snapshot timestamp, excluding raw GUIDs, account identifiers, paths, notes and goals. A saved file is fresh only after WoW writes it on `/reload` or logout. No account API, continuous feed, code-execution tool, gameplay automation or autonomous paid inference is supplied.

Nine original class portraits and Alliance/Horde environments are included and inspected in wide and compact layouts; neutral fallback is retained. Signed Ed25519 update integrity is distinct from unsigned Windows Authenticode. Release availability is established by the public Releases page and its workflow.

## Historical evidence


## 0.2.0 cinematic interface and updates

The 0.2.0 build adds original painted raster art, bundled licensed fonts and a material-rich interface. Existing data/provider flows remain compatible. New update controls have real Electron preference/restart-persistence coverage; wide and compact layouts are rendered and checked for horizontal overflow.

Automatic Windows updates authenticate an Ed25519-signed manifest against the bundled public key, bind version/tag/repository/URL/installer name, bound transfers, verify SHA256/size and reverify cached files before fixed-argument installer execution. Preferences, cancellation/reset, tampering, redirects, duplicate timers, install-on-exit, manual checks after opt-out and explicit restart are covered by fixture tests. Tests inject installer launches: they do not certify a real self-upgrade. The signing private key is OS-protected locally and stored as a protected repository release secret; only its public verification key ships.

The signed release workflow validates an explicit version/channel tag, runs all checks, builds and signs an update manifest, uploads assets to a draft and then publishes. App update authentication is separate from Windows publisher identity; installers remain without Authenticode. Users upgrading from 0.1.0 need one manual install. Current test/build/CI results are reported in the release notes and corresponding workflow run. Live cloud account acceptance and game API verification remain unperformed.

Local evidence: `npm test` 62/62 passed; real Electron UI and storage/reset integration passed; 0.2.0 installer built and packaged startup passed. The actual local installer was signed through its update manifest and successfully verified against the bundled production public key. Wide and 1000px-window screenshots were inspected; compact layout had no horizontal overflow. `npm audit` reported zero vulnerabilities. Independent review closed all important findings, including update timer/reset races, NSIS restart flags, manual install after opt-out, overlapping preference saves and stale status polling. No real self-update/old-to-new installation was executed; installer launches in update tests are injected.

## Prior 0.1.0 foundation evidence (historical)

Version 0.1.0 is a desktop foundation preview. These checks establish the behaviors tested here, not blanket compatibility with accounts, game versions or managed Windows deployments.

## Passed locally

- `npm test`: 42 tests, 42 passed, 0 failed. Covers validated profiles/imports, key isolation, four API protocols, privacy context, endpoint restrictions, safe errors, single-instance guard, ChatGPT OAuth protocol/OIDC verification/refresh/revocation/cancellation, and restricted app-private Claude transport. OAuth and provider tests use synthetic credentials and fixtures; no live account consent or paid inference occurred.
- `npm run test:ui`: real Electron first run, profile creation, goals, whitespace recovery, private notes, safe text rendering, provider/auth mode navigation, help and persistence after restart.
- `npm run test:integration`: real Electron IPC, actual Windows safeStorage encryption, excluded secrets in bootstrap/exports, backup/import dialogs with test-controlled file choices, invalid-import preservation, credential preservation, local HTTP provider fixture, privacy payload, reset during a delayed reply, deletion of app-owned credentials and clearing cached subscription identity.
- `npm audit`: zero reported vulnerabilities across the installed production and development tree. The lockfile overrides affected minimatch 7–10 dependencies with patched 11.0.5; successful Windows packaging exercises its build usage. Earlier dependency versions below 7 retain their compatible APIs.
- Independent review found and resolved mutable-state save poisoning, late replies after reset/import, stale subscription identity, multi-instance overwrite, refresh after sign-out, and overlapping mutations during asynchronous reset.
- Fresh Windows CI also runs the suite. An intermittent first-run GUI timeout led to explicit test-window painting and a 45-second cold-start allowance; production window/power settings are unchanged. Failed GUI checks preserve a diagnostic screenshot.

## 0.1.0 distribution checks (historical)

The per-user x64 NSIS installer is built with `npm run dist`, with original application icon and MIT license included. It is intentionally unsigned. Installer and source checksums accompany the downloadable files. Public source is `farena-ai/Backstage-Forever`; updates are manual downloads from that repository’s Releases page.

`npm run test:packaged` passed: the built Windows executable opened the branded interface from its ASAR bundle, exposed the isolated preload bridge, reported version 0.1.0 and had Windows secure credential storage available. Its executable metadata reports Backstage Forever. This launch check did not change player profiles or credentials. A clean-machine install, upgrade and uninstall have not been certified. No code-signing certificate, automatic updater, scheduled watcher or store submission was configured.

## 0.1.0 compatibility evidence and remaining gates (historical)

The local installed game metadata identified product `wowf`, version `1.60.1.70862`, with a dedicated `_forever_` folder. No game files were modified, and no in-client API test ran. The optional addon remains a template requiring an interface value verified from the running client. No game-data import, live combat support, or automated play is advertised.

ChatGPT subscription mode implements the documented open-source sign-in route. Claude subscription mode invokes the user-installed official native executable with app-private configuration; administrator policies can affect that external tool. Actual browser consent, account entitlement, token refresh against provider servers and live inference require user-led acceptance. There is one saved ChatGPT registration per installation in this preview.

Grok OAuth exists in its official CLI, as Sara’s design also recognizes. Backstage Forever does not yet provide an accepted Grok subscription inference adapter: its currently documented CLI exposes retained MCP meta-tools and managed hooks even with empty tool selection. The UI marks this route unavailable; xAI API mode remains implemented. This is a current implementation limit, not a claim that Grok subscription integration is impossible.

Next gates: subscription acceptance with real accounts; a safe Grok adapter; account-aware model discovery; clean Windows installation/upgrade/uninstall; code signing; addon/client verification; accessible keyboard/screen-reader acceptance. See ROADMAP.md for phases.


## 0.4.1 live capture and Compass repair (2026-11-08, America/Chicago)

A live Forever session loaded the 0.4.0 HUD but wrote a nil account export. Reproduced in the Lua VM with realistic multi-return class/race/faction APIs; the prior single-return harness concealed the problem. Explicit single-result calls fixed capture. All 136 unit tests passed, including realistic tuples, oversized HUD text, restored anchors, drag callbacks, close/collapse/reopen and combat guards. The packaged smoke check passed automatic installation/readback and startup repair after the final HUD resource was staged into the packaged fixture. Release CI rebuilds the installer from its tagged source.

Observed in the actual game after the player's voluntary reload: class, level, location, XP and nine active quests in Compass. A later reload produced a successful desktop import with race and faction; the selected imported profile displayed level 15 and public snapshot metadata. Observed native dialog textures, close/minimize buttons and permanent instructions; the player repositioned the panel. No player identifiers, account paths or screenshots are published as evidence. Live hide/reopen, per-character persistence after a full client restart, combat transitions, later level changes and full quest/waypoint coverage are not claimed by these observations.

The game-folder scripts were repaired and byte-verified locally. Program Files denied direct writes to the installed companion resource copy; 0.4.1 must be installed normally to make the resource repair permanent. This local repair is not evidence that self-upgrade completed. Installers remain without Windows Authenticode signing; application update manifests use separate Ed25519 integrity verification.

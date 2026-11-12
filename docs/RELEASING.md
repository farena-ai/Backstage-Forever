# Building and publishing releases

## 0.13.7 NPC/reference validation

The candidate combines connection timing fixes with local NPC lookup and bounded user-reported location context. The existing quest reference remains separately pinned; the new historical NPC bundle is checked offline and ships with its own attribution.

The unpublished 0.13.5 and 0.13.6 tags remain preserved. The candidate retains the restored read-only public preview of another stored character and selected-character ownership for current reports, sending and memory. Keep the original Company, Director and Preparation backend fixtures; their explicit other-character preview calls are valid compatibility checks.

Version 0.13.7 fixes disposable packaged-test teardown after the 0.13.6 functional packaged checks passed but TEMP executable removal failed with EBUSY. Packaged acceptance must await both application shutdown and the exact launched child process close, validate the owned resolved TEMP root, and complete bounded cleanup before printing PASS. A stubborn lock or shutdown failure must still fail the gate. No installed app path or unrelated process may be used for test cleanup.

Run the existing gates plus:

```powershell
npm run check:forever-npc-locations
npm run test:npc-companion
```

The native NPC check uses fictional isolated saved profiles and fake external surfaces. It verifies original Cairne-in-Org lookup, explicit current-report preview/send, sharing/owner boundaries, ambiguity, unavailable/corrupt reference, zero local provider/key requests, compact rendering and caret preservation. It does not prove live game locations, real provider entitlement/audio, installation or public delivery. Both commands are required by Windows validation and tagged release workflows. **1.0 remains held.**


Public MIT application repository: farena-ai/Backstage-Forever. Backstage Coding, designed by Frank Arena. Version 0.13.7 remains a Windows-first preview; 1.0 is held for owner acceptance. Reference data retains separate CC BY 4.0 notices. Installers are not Windows Authenticode signed; Ed25519 app-update signatures separately authenticate downloads. See UPDATES.md for trust, key management and rotation.

## Local validation

Use Node.js 24 LTS and locked dependencies:

```powershell
npm ci
npm run check:addon-reference
npm run check:forever-vendors
npm run check:forever-insights
npm run check:forever-travel
npm run check:forever-acquisition
npm test
npm run test:ui
npm run test:integration
npm run test:living-backend
npm run test:living-setup
npm run test:company-backend
npm run test:company
npm run test:adventure-coach
npm run test:profession-coach
npm run test:setup
npm run test:autosave
npm run test:command-center
npm run test:knowledge
npm run dist
npm run test:packaged
```

The complete required gate list is maintained in `.github/workflows/ci.yml` and `.github/workflows/release.yml`; the commands above are a local entry point, not a replacement for those full gates. `npm test` already includes native Compass/Profession/Map tests, so a duplicate native-suite step is unnecessary.

The per-user x64 NSIS installer is written to dist. User records, provider credentials, CLI homes, signing private keys and scratch files must never be included. Include LICENSE, font notices and artwork provenance. Official Claude/Grok tools are not bundled or relicensed.

The bundled `data/forever` pack, source lock, CC BY license and change notice must be present in the ASAR. Packaged acceptance checks source/data byte hashes as well as actual automatic twelve-file addon installation and repair in a synthetic client. The tracked `BackstageForeverReference.lua` is an offline, safely escaped compilation of the validated bundled pack; `npm run check:addon-reference` must reproduce its exact LF bytes without writing. The installer does not generate Lua from runtime public downloads. Reference inputs stay out of the shipped app and source archive. If changing the original pack or compiler, separately reproduce the full pack from the six hash-locked inputs with the command in FOREVER-DATA.md. Ordinary unit tests remain offline and use tracked fixtures. Unit files run serially to avoid competing Lua VM CPU deadlines; the test deadlines and assertions remain unchanged.

## Signed publication

Set package version and releaseChannel explicitly (preview/stable), update docs, review/test/commit, then push an exact vMAJOR.MINOR.PATCH tag. The release workflow validates version/channel, runs locked installation and tests, builds, signs with the protected repository secret, archives source and generates checksums. New releases remain drafts until all assets upload. Never put private keys on command lines, in logs or in source. Do not upload competing manual builds while that workflow owns the version’s assets.

App checks run only while open. No watcher service, scheduled task, cron, chat automation or recurring polling job is created. Tag-triggered CI produces releases only when deliberately triggered.

## Acceptance evidence

Record actual results in VALIDATION.md. Fixtures do not certify live consent, entitlements, billing or game APIs. Clean-machine install/upgrade/uninstall, real self-update, accessibility, Windows publisher signing and in-client addon tests remain separate gates until performed. Never spend provider credits just for a badge. No beta/testing store track is used by this workflow.
